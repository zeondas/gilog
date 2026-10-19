//! 표준 지시부(2026-10-19 사용자 1안 — 모든 공사가 hwpx 양식 하나, 공사별로 민원 여러 건을 한 지시부에).
//!
//! 양식(앱에 넣어 둔 `assets/order_standard.hwpx`, 설정에서 다른 파일을 고를 수도 있어요)의 자리:
//! - 머리 표: `{공사명}` `{축약 공사명}` `{연번}` `{지시일}` `{현장대리인}` `{시공사}`
//! - 항목 묶음: `1. {공사내용} ({주소})` 문단 → `○ {고려사항}` 문단 → `{위치도}`·`{현장사진}` 칸이 든 표 문단.
//!   항목마다 이 묶음을 되풀이하고 번호를 1, 2, 3…으로 바꿔요. 고려사항이 없으면 ○ 문단을 빼요.
//! - 그림은 칸 안쪽에 비율대로 맞춰(가운데) 글자처럼 넣어요. 폰 사진의 돌림(EXIF)은 그림 자체를 돌려 넣고,
//!   긴 변 1600px보다 크면 줄여요(파일이 무거워지지 않게).
//!
//! 바꾼 문단의 줄 배치 정보(`hp:linesegarray`)는 지워요 — 한글이 열 때 다시 계산해요.

use std::collections::BTreeMap;
use std::io::{Cursor, Read};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::order::{attr, elements, fill_text, jpeg_rotation, write_zip, OrderReport};
use crate::{Error, Result};

/// 앱에 넣어 둔 표준 양식(사용자가 2026-10-19 보낸 v2)
pub const STANDARD_TEMPLATE: &[u8] = include_bytes!("../assets/order_standard.hwpx");

/// 지시부 항목 하나(민원 한 건)
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StdItem {
    /// 공사내용(간결하게, 예: 포트홀 보수)
    pub title: String,
    /// 지역 + 위치
    pub address: String,
    /// 고려사항(없으면 ○ 줄을 빼요)
    pub note: String,
    /// 위치도 그림 파일
    pub map: String,
    /// 현장사진(첫 장)
    pub photo: String,
}

fn bad(msg: impl Into<String>) -> Error {
    Error::Invalid(msg.into())
}

fn unzip(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>, bool)>> {
    let mut z = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| bad("양식 파일을 열 수 없어요"))?;
    let mut out = Vec::new();
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|_| bad("양식 파일을 읽을 수 없어요"))?;
        let mut buf = Vec::new();
        e.read_to_end(&mut buf)?;
        let stored = e.compression() == zip::CompressionMethod::Stored;
        out.push((e.name().to_string(), buf, stored));
    }
    Ok(out)
}

/// 그림을 읽어 돌림을 바로잡고 줄여 JPEG로 만들어요. (JPEG 바이트, 폭, 높이)
fn prep_image(path: &str) -> Result<(Vec<u8>, u32, u32)> {
    let bytes = std::fs::read(path)?;
    let rot = jpeg_rotation(&bytes);
    let img = image::load_from_memory(&bytes).map_err(|_| bad(format!("그림을 읽을 수 없어요: {path}")))?;
    let img = match rot {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    };
    let img = if img.width().max(img.height()) > 1600 { img.resize(1600, 1600, image::imageops::FilterType::Triangle) } else { img };
    // 투명한 곳(PNG 위치도)은 흰 바탕으로
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let mut rgb = image::RgbImage::new(w, h);
    for (x, y, p) in rgba.enumerate_pixels() {
        let a = p[3] as u32;
        let mix = |c: u8| ((c as u32 * a + 255 * (255 - a)) / 255) as u8;
        rgb.put_pixel(x, y, image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])]));
    }
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85)
        .encode_image(&rgb)
        .map_err(|_| bad(format!("그림을 바꿀 수 없어요: {path}")))?;
    Ok((out, w, h))
}

/// 글자처럼 넣는 그림(python-hwpx·한글 2020 모양)
fn pic_xml(bin: &str, id: u32, w: u32, h: u32) -> String {
    format!(
        "<hp:pic textWrap=\"SQUARE\" textFlow=\"BOTH_SIDES\" reverse=\"0\" id=\"{id}\" zOrder=\"0\" numberingType=\"PICTURE\" lock=\"0\" dropcapstyle=\"None\" href=\"\" groupLevel=\"0\" instid=\"{inst}\">\
<hp:offset x=\"0\" y=\"0\"/><hp:orgSz width=\"{w}\" height=\"{h}\"/><hp:curSz width=\"{w}\" height=\"{h}\"/><hp:flip horizontal=\"0\" vertical=\"0\"/>\
<hp:rotationInfo angle=\"0\" centerX=\"{cx}\" centerY=\"{cy}\" rotateimage=\"1\"/>\
<hp:renderingInfo><hc:transMatrix e1=\"1\" e2=\"0\" e3=\"0\" e4=\"0\" e5=\"1\" e6=\"0\"/><hc:scaMatrix e1=\"1\" e2=\"0\" e3=\"0\" e4=\"0\" e5=\"1\" e6=\"0\"/><hc:rotMatrix e1=\"1\" e2=\"0\" e3=\"0\" e4=\"0\" e5=\"1\" e6=\"0\"/></hp:renderingInfo>\
<hp:imgRect><hc:pt0 x=\"0\" y=\"0\"/><hc:pt1 x=\"{w}\" y=\"0\"/><hc:pt2 x=\"{w}\" y=\"{h}\"/><hc:pt3 x=\"0\" y=\"{h}\"/></hp:imgRect>\
<hp:imgClip left=\"0\" right=\"{w}\" top=\"0\" bottom=\"{h}\"/><hp:inMargin left=\"0\" right=\"0\" top=\"0\" bottom=\"0\"/><hp:imgDim dimwidth=\"{w}\" dimheight=\"{h}\"/>\
<hc:img binaryItemIDRef=\"{bin}\" bright=\"0\" contrast=\"0\" effect=\"REAL_PIC\" alpha=\"0\"/><hp:effects/>\
<hp:sz width=\"{w}\" height=\"{h}\" widthRelTo=\"ABSOLUTE\" heightRelTo=\"ABSOLUTE\" protect=\"0\"/>\
<hp:pos treatAsChar=\"1\" affectLSpacing=\"0\" flowWithText=\"1\" allowOverlap=\"0\" holdAnchorAndSO=\"0\" vertRelTo=\"PARA\" horzRelTo=\"COLUMN\" vertAlign=\"TOP\" horzAlign=\"LEFT\" vertOffset=\"0\" horzOffset=\"0\"/>\
<hp:outMargin left=\"0\" right=\"0\" top=\"0\" bottom=\"0\"/><hp:shapeComment/></hp:pic>",
        inst = id + 1,
        cx = w / 2,
        cy = h / 2
    )
}

/// 줄 배치 정보를 지워요(한글이 다시 계산).
fn strip_linesegs(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while let Some(o) = s[i..].find("<hp:linesegarray>") {
        out.push_str(&s[i..i + o]);
        let close = "</hp:linesegarray>";
        match s[i + o..].find(close) {
            Some(e) => i = i + o + e + close.len(),
            None => {
                i += o;
                break;
            }
        }
    }
    out.push_str(&s[i..]);
    out
}

/// 그림 칸 안쪽 크기(HWP 단위): `{key}`가 든 표 칸의 크기 − 칸 여백 − 줄 간격 몫.
fn cell_box(block: &str, key: &str) -> (u32, u32) {
    let tc = elements(block, "hp:tc").into_iter().map(|(a, b)| &block[a..b]).find(|t| t.contains(key));
    let num = |t: &str, tag: &str, at: &str| -> Option<u32> {
        let s = t.find(tag)?;
        let e = t[s..].find('>')? + s;
        attr(&t[s..=e], at)?.parse().ok()
    };
    let Some(t) = tc else { return (23_500, 19_000) };
    let (w, h) = (num(t, "<hp:cellSz", "width").unwrap_or(24_806), num(t, "<hp:cellSz", "height").unwrap_or(20_243));
    let m = |at| num(t, "<hp:cellMargin", at).unwrap_or(0);
    // 줄 간격(글자 높이의 60%쯤)이 그림 줄 아래에 붙어 칸이 늘지 않게 900을 남겨요.
    (w.saturating_sub(m("left") + m("right") + 100), h.saturating_sub(m("top") + m("bottom") + 900))
}

/// 칸에 맞춘 크기(비율 그대로)
fn fit(px: (u32, u32), bx: (u32, u32)) -> (u32, u32) {
    let (pw, ph) = (px.0.max(1) as f64, px.1.max(1) as f64);
    let s = (bx.0 as f64 / pw).min(bx.1 as f64 / ph);
    ((pw * s) as u32, (ph * s) as u32)
}

/// 표준 지시부를 써요. `tpl`이 없으면 앱에 넣어 둔 양식을 써요.
pub fn fill_standard(tpl: Option<&Path>, out: &Path, header: &BTreeMap<String, String>, items: &[StdItem]) -> Result<OrderReport> {
    if items.is_empty() {
        return Err(bad("항목이 없어요"));
    }
    let raw = match tpl {
        Some(p) => std::fs::read(p)?,
        None => STANDARD_TEMPLATE.to_vec(),
    };
    let mut files = unzip(&raw)?;
    let sec_i = files.iter().position(|f| f.0 == "Contents/section0.xml").ok_or_else(|| bad("양식에 본문이 없어요"))?;
    let xml = String::from_utf8(files[sec_i].1.clone()).map_err(|_| bad("양식 본문을 읽을 수 없어요"))?;

    // 항목 묶음: {공사내용} 문단부터 {위치도} 표 문단까지(바깥 문단 기준)
    let paras = elements(&xml, "hp:p");
    let find = |key: &str| paras.iter().position(|&(a, b)| xml[a..b].contains(key));
    let (Some(t), Some(ph)) = (find("{공사내용}"), find("{위치도}")) else {
        return Err(bad("양식에 {공사내용}·{위치도} 자리가 없어요"));
    };
    if ph < t {
        return Err(bad("양식의 항목 순서가 맞지 않아요"));
    }
    let (start, end) = (paras[t].0, paras[ph].1);
    let block = xml[start..end].replacen("<hp:t>1. {공사내용}", "<hp:t>{번호}. {공사내용}", 1);
    let bx = cell_box(&block, "{위치도}");
    let bx2 = cell_box(&block, "{현장사진}");

    let mut used: Vec<String> = Vec::new();
    let mut bins: Vec<Vec<u8>> = Vec::new();
    let mut body = String::new();
    for (n, it) in items.iter().enumerate() {
        let mut b = block.clone();
        if it.note.trim().is_empty() {
            // ○ 고려사항 문단을 빼요(바깥 문단 중 {고려사항}이 든 것).
            if let Some(&(a, e)) = elements(&b, "hp:p").iter().find(|&&(a, e)| b[a..e].contains("{고려사항}") && !b[a..e].contains("<hp:tbl")) {
                b.replace_range(a..e, "");
            }
        }
        // 표 번호가 겹치지 않게
        if let Some(o) = b.find("<hp:tbl id=\"") {
            let s = o + "<hp:tbl id=\"".len();
            if let Some(len) = b[s..].find('"') {
                let id: u64 = b[s..s + len].parse().unwrap_or(1_224_459_277);
                b.replace_range(s..s + len, &(id + n as u64).to_string());
            }
        }
        for (key, path, boxed) in [("{위치도}", &it.map, bx), ("{현장사진}", &it.photo, bx2)] {
            let tag = format!("<hp:t>{key}</hp:t>");
            let rep = if path.trim().is_empty() {
                "<hp:t/>".to_string()
            } else {
                let (jpg, w, h) = prep_image(path.trim())?;
                bins.push(jpg);
                let (dw, dh) = fit((w, h), boxed);
                pic_xml(&format!("BIN{:04}", bins.len()), 1_900_000_000 + bins.len() as u32 * 2, dw, dh)
            };
            b = b.replacen(&tag, &rep, 1);
        }
        let mut text = BTreeMap::new();
        text.insert("번호".to_string(), (n + 1).to_string());
        text.insert("공사내용".to_string(), it.title.trim().to_string());
        text.insert("주소".to_string(), it.address.trim().to_string());
        text.insert("고려사항".to_string(), it.note.trim().to_string());
        let mut u = Vec::new();
        body.push_str(&fill_text(&b, "hp:p", "hp:t", &text, &mut u));
    }
    // 머리 표 + 항목들 + 그 뒤(끝.) — 항목부터 뒤는 줄 배치를 다시 계산하게
    let mut sec = format!("{}{}", &xml[..start], strip_linesegs(&body));
    sec.push_str(&strip_linesegs(&xml[end..]));
    let sec = fill_text(&sec, "hp:p", "hp:t", header, &mut used);
    files[sec_i].1 = sec.into_bytes();

    if !bins.is_empty() {
        for (name, bytes, _) in files.iter_mut() {
            if name == "Contents/content.hpf" {
                let items: String = (1..=bins.len())
                    .map(|k| format!("<opf:item id=\"BIN{k:04}\" href=\"BinData/BIN{k:04}.jpg\" media-type=\"image/jpeg\" isEmbeded=\"1\"/>"))
                    .collect();
                let s = String::from_utf8_lossy(bytes).replacen("</opf:manifest>", &format!("{items}</opf:manifest>"), 1);
                *bytes = s.into_bytes();
            }
            if name == "Contents/header.xml" {
                let s = String::from_utf8_lossy(bytes).into_owned();
                if s.contains("<hh:binDataList") {
                    return Err(bad("그림이 든 양식은 아직 쓸 수 없어요"));
                }
                let list: String = (1..=bins.len())
                    .map(|k| format!("<hh:binItem id=\"{}\" Type=\"Embedding\" BinData=\"BIN{k:04}.jpg\" Format=\"jpg\"/>", k - 1))
                    .collect();
                let s = s.replacen("</hh:refList>", &format!("<hh:binDataList itemCnt=\"{}\">{list}</hh:binDataList></hh:refList>", bins.len()), 1);
                *bytes = s.into_bytes();
            }
        }
        for (k, jpg) in bins.into_iter().enumerate() {
            files.push((format!("BinData/BIN{:04}.jpg", k + 1), jpg, false));
        }
    }
    write_zip(out, &files)?;
    let missing = header.keys().filter(|k| !used.contains(k)).map(|k| format!("{{{k}}}")).collect();
    Ok(OrderReport { missing })
}

/// 지시일 "2026년 10월 19일"
pub fn korean_date(d: &str) -> String {
    let p: Vec<&str> = d.trim().split('-').collect();
    match p.as_slice() {
        [y, m, dd] => format!("{y}년 {}월 {}일", m.trim_start_matches('0'), dd.trim_start_matches('0')),
        _ => d.trim().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &Path, name: &str) -> Option<Vec<u8>> {
        crate::order::read_zip(path).unwrap().into_iter().find(|f| f.0 == name).map(|f| f.1)
    }

    fn text(path: &Path, name: &str) -> String {
        String::from_utf8(entry(path, name).unwrap()).unwrap()
    }

    fn photo(path: &Path, w: u32, h: u32) {
        image::RgbImage::from_pixel(w, h, image::Rgb([200, 100, 50])).save(path).unwrap();
    }

    fn header() -> BTreeMap<String, String> {
        let mut h = BTreeMap::new();
        h.insert("공사명".into(), "2026년 동부권 도로시설물 정비 연간단가 공사(1지구, 하반기)".into());
        h.insert("축약 공사명".into(), "동부권 도로시설물 1지구".into());
        h.insert("연번".into(), "03".into());
        h.insert("지시일".into(), korean_date("2026-10-19"));
        h.insert("현장대리인".into(), "소병민".into());
        h.insert("시공사".into(), "주식회사 지현".into());
        h
    }

    #[test]
    fn two_items_numbered_with_pictures() {
        let d = tempfile::tempdir().unwrap();
        let (map, ph, out) = (d.path().join("m.png"), d.path().join("p.jpg"), d.path().join("o.hwpx"));
        photo(&map, 400, 300);
        photo(&ph, 3000, 4000);
        let items = vec![
            StdItem { title: "포트홀 보수".into(), address: "조리읍 등원리 230-1".into(), note: String::new(), map: map.display().to_string(), photo: ph.display().to_string() },
            StdItem { title: "포트홀 보수".into(), address: "조리읍 봉일천리 209-10".into(), note: "야간 작업 <협의>".into(), map: String::new(), photo: ph.display().to_string() },
        ];
        let r = fill_standard(None, &out, &header(), &items).unwrap();
        assert!(r.missing.is_empty(), "{:?}", r.missing);
        let s = text(&out, "Contents/section0.xml");
        assert!(!s.contains("{공사") && !s.contains("{위치도}") && !s.contains("{번호}"), "자리가 남았어요");
        assert!(s.contains("<hp:t>1. 포트홀 보수 (조리읍 등원리 230-1)</hp:t>"), "{s}");
        assert!(s.contains("<hp:t>2. 포트홀 보수 (조리읍 봉일천리 209-10)</hp:t>"));
        // 첫 항목은 고려사항이 없어 ○ 줄이 하나뿐
        assert_eq!(s.matches("○").count(), 1);
        assert!(s.contains("○ 야간 작업 &lt;협의&gt;"));
        assert!(s.contains("2026년 10월 19일") && s.contains("동부권 도로시설물 1지구") && s.contains("03"));
        assert_eq!(s.matches("<hp:pic ").count(), 3);
        assert_eq!(s.matches("<hp:tbl id=\"").count(), 3); // 머리 표 + 사진 표 둘
        assert!(s.contains("끝."));
        assert!(entry(&out, "BinData/BIN0003.jpg").is_some());
        assert!(text(&out, "Contents/content.hpf").contains("BinData/BIN0003.jpg"));
        assert!(text(&out, "Contents/header.xml").contains("<hh:binDataList itemCnt=\"3\">"));
        let z = crate::order::read_zip(&out).unwrap();
        assert_eq!((z[0].0.as_str(), z[0].2), ("mimetype", true));
        // 세로 사진(3:4)은 칸 높이에 맞춰 줄고, 긴 변은 1600px로 줄여 넣어요
        let jpg = entry(&out, "BinData/BIN0002.jpg").unwrap();
        assert_eq!(crate::order::image_size(&jpg), Some((1200, 1600)));
        let i = s.find("binaryItemIDRef=\"BIN0002\"").unwrap();
        let sz = &s[i..i + 200];
        assert!(sz.contains("<hp:sz width=\"14295\" height=\"19061\""), "{sz}");
    }

    /// 견본 만들기: GILOG_ORDER_SAMPLE=<폴더>(map.png·photo.jpg·photo2.jpg가 있는 곳) cargo test --lib order_sample
    #[test]
    fn order_sample() {
        let Ok(dir) = std::env::var("GILOG_ORDER_SAMPLE") else { return };
        let d = Path::new(&dir);
        let f = |n: &str| d.join(n).display().to_string();
        let items = vec![
            StdItem { title: "포트홀 보수".into(), address: "조리읍 등원리 230-1".into(), note: String::new(), map: f("map.png"), photo: f("photo2.jpg") },
            StdItem { title: "포트홀 보수".into(), address: "조리읍 봉일천리 209-10".into(), note: "야간 작업으로 시공하고, 교통 통제 방법은 감독관과 미리 협의 바랍니다.".into(), map: f("map.png"), photo: f("photo.jpg") },
            StdItem { title: "경계석 교체".into(), address: "조리읍 봉일천리 146-1".into(), note: String::new(), map: f("map.png"), photo: f("photo2.jpg") },
        ];
        fill_standard(None, &d.join("261019_동부권 도로시설물 1지구-03.hwpx"), &header(), &items).unwrap();
    }

    #[test]
    fn date_words() {
        assert_eq!(korean_date("2026-10-09"), "2026년 10월 9일");
    }
}
