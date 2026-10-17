//! 지시부 채우기: 양식(pptx·hwpx)의 자리 글자 `{연번}` 같은 것을 바꾸고,
//! pptx는 이름이 "위치도"·"현장사진"인 도형 자리에 그림을 비율대로 맞춰 넣어요(위쪽 맞춤, 가로 가운데).
//! 사진이 여럿이면 "현장사진2"·"현장사진3" 자리에 차례로 넣어요(자리가 없으면 건너뛰어요).
//! hwpx는 지금은 글자만 바꿔요.
//!
//! 글자는 문단 단위로 바꿔요: 한 자리 글자가 여러 조각(run)에 나뉘어 있어도 찾고,
//! 바꾼 문단은 첫 조각의 서식을 써요. 값에 줄바꿈이 있으면 같은 서식의 문단을 더해요.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderKind {
    Pptx,
    Hwpx,
}

impl OrderKind {
    pub fn of(path: &Path) -> Option<OrderKind> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "pptx" => Some(OrderKind::Pptx),
            "hwpx" => Some(OrderKind::Hwpx),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OrderFill {
    /// 자리 이름(중괄호 없이) → 값
    pub text: BTreeMap<String, String>,
    /// 그림 자리 이름 → 그림 파일(jpg·png)
    pub images: BTreeMap<String, String>,
}

/// 채운 결과: 양식에 없던 자리 글자·그림 자리를 알려 줘요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderReport {
    pub missing: Vec<String>,
}

fn bad(msg: impl Into<String>) -> Error {
    Error::Invalid(msg.into())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn unesc(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

/// `<tag ...>…</tag>`·`<tag/>` 덩어리의 [시작, 끝) 자리들(겹치지 않게 바깥 것만).
/// `tag`는 "a:p"처럼 접두어까지 넣어요. "a:pPr" 같은 더 긴 이름은 건너뛰어요.
fn elements(xml: &str, tag: &str) -> Vec<(usize, usize)> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(off) = xml[i..].find(&open) {
        let s = i + off;
        let after = xml[s + open.len()..].chars().next();
        if !matches!(after, Some(' ') | Some('>') | Some('/') | Some('\n') | Some('\r') | Some('\t')) {
            i = s + open.len();
            continue;
        }
        let gt = match xml[s..].find('>') {
            Some(g) => s + g,
            None => break,
        };
        if xml.as_bytes()[gt - 1] == b'/' {
            out.push((s, gt + 1));
            i = gt + 1;
            continue;
        }
        // 같은 이름이 안에 또 있을 수 있어요(표 안 문단 등) — 깊이를 세요.
        let mut depth = 1;
        let mut j = gt + 1;
        let end = loop {
            let no = xml[j..].find(&open).map(|o| j + o);
            let nc = match xml[j..].find(&close) {
                Some(o) => j + o,
                None => return out,
            };
            match no {
                Some(o) if o < nc => {
                    let a = xml[o + open.len()..].chars().next();
                    let g = xml[o..].find('>').map(|g| o + g).unwrap_or(o);
                    if matches!(a, Some(' ') | Some('>') | Some('\n') | Some('\r') | Some('\t')) && xml.as_bytes()[g - 1] != b'/' {
                        depth += 1;
                    }
                    j = o + open.len();
                }
                _ => {
                    depth -= 1;
                    j = nc + close.len();
                    if depth == 0 {
                        break j;
                    }
                }
            }
        };
        out.push((s, end));
        i = end;
    }
    out
}

/// 문단 안 글자 조각 `<t>…</t>`의 안쪽 자리 [시작, 끝)들. 안에 다른 태그가 든 조각은 건너뛰어요.
fn text_spans(p: &str, t: &str) -> Vec<(usize, usize)> {
    elements(p, t)
        .into_iter()
        .filter_map(|(s, e)| {
            let g = s + p[s..e].find('>')? + 1;
            if p.as_bytes()[g - 2] == b'/' {
                return None;
            }
            let ce = e - t.len() - 3;
            let inner = &p[g..ce];
            (!inner.contains('<')).then_some((g, ce))
        })
        .collect()
}

/// 문단 하나의 자리 글자를 바꿔요. 바뀌었으면 새 문단(줄바꿈이면 여러 문단)을 돌려줘요.
fn fill_paragraph(p: &str, t: &str, text: &BTreeMap<String, String>, used: &mut Vec<String>) -> Option<String> {
    let spans = text_spans(p, t);
    if spans.is_empty() {
        return None;
    }
    let full: String = spans.iter().map(|&(a, b)| unesc(&p[a..b])).collect();
    if !full.contains('{') {
        return None;
    }
    let mut out = full.clone();
    for (k, v) in text {
        let key = format!("{{{k}}}");
        if out.contains(&key) {
            used.push(k.clone());
            out = out.replace(&key, v);
        }
    }
    if out == full {
        return None;
    }
    let one = |line: &str| {
        let mut s = String::with_capacity(p.len());
        let mut last = 0;
        for (n, &(a, b)) in spans.iter().enumerate() {
            s.push_str(&p[last..a]);
            if n == 0 {
                s.push_str(&esc(line));
            }
            last = b;
        }
        s.push_str(&p[last..]);
        s
    };
    let lines: Vec<&str> = out.split('\n').map(|l| l.trim_end_matches('\r')).collect();
    Some(lines.iter().map(|l| one(l)).collect())
}

fn fill_text(xml: &str, p_tag: &str, t_tag: &str, text: &BTreeMap<String, String>, used: &mut Vec<String>) -> String {
    // 바깥 문단만 보면 표 안 문단을 못 보니, 안쪽 문단(안에 같은 태그가 없는 것)을 차례로 바꿔요.
    let mut s = xml.to_string();
    let mut i = 0;
    loop {
        let list = elements(&s[i..], p_tag);
        let Some(&(a, b)) = list.first() else { break };
        let (a, b) = (i + a, i + b);
        let inner_start = s[a..b].find('>').map(|g| a + g + 1).unwrap_or(b);
        // 안에 문단이 또 있으면 그 안으로 들어가요.
        if !elements(&s[inner_start..b], p_tag).is_empty() {
            i = inner_start;
            continue;
        }
        match fill_paragraph(&s[a..b], t_tag, text, used) {
            Some(new) => {
                let n = new.len();
                s.replace_range(a..b, &new);
                i = a + n;
            }
            None => i = b,
        }
    }
    s
}

/// 그림 크기(픽셀). PNG·JPEG만 읽어요.
pub fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() > 24 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" {
        let w = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
        let h = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
        return Some((w, h));
    }
    if bytes.len() > 4 && bytes[0] == 0xFF && bytes[1] == 0xD8 {
        let mut i = 2;
        while i + 9 < bytes.len() {
            if bytes[i] != 0xFF {
                i += 1;
                continue;
            }
            let m = bytes[i + 1];
            if m == 0xD8 || m == 0x01 || (0xD0..=0xD7).contains(&m) || m == 0xFF {
                i += if m == 0xFF { 1 } else { 2 };
                continue;
            }
            let len = u16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as usize;
            if (0xC0..=0xCF).contains(&m) && m != 0xC4 && m != 0xC8 && m != 0xCC {
                let h = u16::from_be_bytes([bytes[i + 5], bytes[i + 6]]) as u32;
                let w = u16::from_be_bytes([bytes[i + 7], bytes[i + 8]]) as u32;
                return Some((w, h));
            }
            i += 2 + len;
        }
    }
    None
}

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!(" {name}=\"");
    let s = tag.find(&key)? + key.len();
    let e = tag[s..].find('"')? + s;
    Some(&tag[s..e])
}

struct Pic {
    name: String,
    ext: &'static str,
    bytes: Vec<u8>,
    size: (u32, u32),
}

/// 슬라이드에서 이름이 `name`인 도형을 그림으로 바꿔요. 바꿨으면 true.
fn put_picture(slide: &mut String, name: &str, rid: &str, id: u32, pic: &Pic) -> bool {
    for (a, b) in elements(slide, "p:sp") {
        let sp = &slide[a..b];
        let Some(c) = sp.find("<p:cNvPr") else { continue };
        let ce = sp[c..].find('>').map(|g| c + g).unwrap_or(c);
        if attr(&sp[c..=ce], "name").map(unesc).as_deref() != Some(name) {
            continue;
        }
        let num = |tag: &str, at: &str| -> Option<i64> {
            let t = sp.find(tag)?;
            let te = sp[t..].find('>')? + t;
            attr(&sp[t..=te], at)?.parse().ok()
        };
        let (Some(x), Some(y), Some(w), Some(h)) = (num("<a:off", "x"), num("<a:off", "y"), num("<a:ext", "cx"), num("<a:ext", "cy")) else {
            continue;
        };
        let (iw, ih) = (pic.size.0.max(1) as f64, pic.size.1.max(1) as f64);
        let sc = (w as f64 / iw).min(h as f64 / ih);
        let (pw, ph) = ((iw * sc) as i64, (ih * sc) as i64);
        let px = x + (w - pw) / 2;
        let xml = format!(
            "<p:pic><p:nvPicPr><p:cNvPr id=\"{id}\" name=\"{}\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>\
<p:blipFill><a:blip r:embed=\"{rid}\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>\
<p:spPr><a:xfrm><a:off x=\"{px}\" y=\"{y}\"/><a:ext cx=\"{pw}\" cy=\"{ph}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>",
            esc(name)
        );
        slide.replace_range(a..b, &xml);
        return true;
    }
    false
}

fn max_shape_id(slide: &str) -> u32 {
    let mut m = 1;
    let mut i = 0;
    while let Some(o) = slide[i..].find("<p:cNvPr") {
        let s = i + o;
        let e = slide[s..].find('>').map(|g| s + g).unwrap_or(s);
        if let Some(v) = attr(&slide[s..=e], "id").and_then(|v| v.parse().ok()) {
            m = m.max(v);
        }
        i = e + 1;
    }
    m
}

fn read_zip(path: &Path) -> Result<Vec<(String, Vec<u8>, bool)>> {
    let f = std::fs::File::open(path)?;
    let mut z = zip::ZipArchive::new(f).map_err(|_| bad("양식 파일을 열 수 없어요"))?;
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

fn write_zip(path: &Path, files: &[(String, Vec<u8>, bool)]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let f = std::fs::File::create(&tmp)?;
        let mut z = zip::ZipWriter::new(f);
        for (name, bytes, stored) in files {
            // hwpx의 mimetype은 맨 앞·압축 없이 그대로여야 해요.
            let m = if *stored { zip::CompressionMethod::Stored } else { zip::CompressionMethod::Deflated };
            let o = zip::write::SimpleFileOptions::default().compression_method(m);
            z.start_file(name.as_str(), o).map_err(|_| bad("지시부 파일을 쓸 수 없어요"))?;
            z.write_all(bytes)?;
        }
        z.finish().map_err(|_| bad("지시부 파일을 쓸 수 없어요"))?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn rels_path(slide: &str) -> String {
    let (dir, file) = slide.rsplit_once('/').unwrap_or(("", slide));
    format!("{dir}/_rels/{file}.rels")
}

/// 양식 `tpl`을 채워 `out`에 써요.
pub fn fill_order(tpl: &Path, out: &Path, fill: &OrderFill) -> Result<OrderReport> {
    let kind = OrderKind::of(tpl).ok_or_else(|| bad("양식은 pptx나 hwpx여야 해요"))?;
    let mut files = read_zip(tpl)?;
    let mut used: Vec<String> = Vec::new();
    let mut placed: Vec<String> = Vec::new();

    let pics: Vec<Pic> = if kind == OrderKind::Pptx {
        fill.images
            .iter()
            .filter(|(_, p)| !p.trim().is_empty())
            .map(|(name, p)| {
                let bytes = std::fs::read(p)?;
                let size = image_size(&bytes).ok_or_else(|| bad(format!("그림을 읽을 수 없어요: {p}")))?;
                let ext = if bytes.starts_with(b"\x89PNG") { "png" } else { "jpeg" };
                Ok(Pic { name: name.clone(), ext, bytes, size })
            })
            .collect::<Result<_>>()?
    } else {
        Vec::new()
    };

    let mut new_files: Vec<(String, Vec<u8>, bool)> = Vec::new();
    let mut rels_add: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut exts: Vec<&str> = Vec::new();
    let mut media_n = 0;

    for (name, bytes, _) in files.iter_mut() {
        let is_text = match kind {
            OrderKind::Pptx => name.starts_with("ppt/slides/slide") && name.ends_with(".xml"),
            OrderKind::Hwpx => name.starts_with("Contents/section") && name.ends_with(".xml"),
        };
        if !is_text {
            continue;
        }
        let Ok(xml) = String::from_utf8(bytes.clone()) else { continue };
        let mut xml = match kind {
            OrderKind::Pptx => fill_text(&xml, "a:p", "a:t", &fill.text, &mut used),
            OrderKind::Hwpx => fill_text(&xml, "hp:p", "hp:t", &fill.text, &mut used),
        };
        if kind == OrderKind::Pptx {
            let mut id = max_shape_id(&xml);
            for pic in &pics {
                if placed.contains(&pic.name) {
                    continue;
                }
                media_n += 1;
                let rid = format!("rIdGilog{media_n}");
                id += 1;
                if put_picture(&mut xml, &pic.name, &rid, id, pic) {
                    placed.push(pic.name.clone());
                    let media = format!("gilog_{media_n}.{}", pic.ext);
                    new_files.push((format!("ppt/media/{media}"), pic.bytes.clone(), false));
                    rels_add.entry(rels_path(name)).or_default().push(format!(
                        "<Relationship Id=\"{rid}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/{media}\"/>"
                    ));
                    if !exts.contains(&pic.ext) {
                        exts.push(pic.ext);
                    }
                }
            }
        }
        *bytes = xml.into_bytes();
    }

    for (name, bytes, _) in files.iter_mut() {
        if let Some(add) = rels_add.remove(name.as_str()) {
            let s = String::from_utf8_lossy(bytes).into_owned();
            let s = s.replacen("</Relationships>", &format!("{}</Relationships>", add.join("")), 1);
            *bytes = s.into_bytes();
        }
        if name == "[Content_Types].xml" {
            let mut s = String::from_utf8_lossy(bytes).into_owned();
            for e in &exts {
                if !s.contains(&format!("Extension=\"{e}\"")) {
                    let ty = if *e == "png" { "image/png" } else { "image/jpeg" };
                    s = s.replacen("</Types>", &format!("<Default Extension=\"{e}\" ContentType=\"{ty}\"/></Types>"), 1);
                }
            }
            *bytes = s.into_bytes();
        }
    }
    // 그림을 넣은 슬라이드에 관계 파일이 없던 경우
    for (path, add) in rels_add {
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{}</Relationships>",
            add.join("")
        );
        new_files.push((path, xml.into_bytes(), false));
    }
    files.extend(new_files);
    write_zip(out, &files)?;

    let mut missing: Vec<String> = fill.text.keys().filter(|k| !used.contains(k)).map(|k| format!("{{{k}}}")).collect();
    missing.extend(pics.iter().filter(|p| !placed.contains(&p.name)).map(|p| p.name.clone()));
    missing.sort();
    missing.dedup();
    Ok(OrderReport { missing })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SLIDE: &str = r#"<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="a" xmlns:p="p" xmlns:r="r"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="표 자리"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>연번 {연</a:t></a:r><a:r><a:t>번}</a:t></a:r></a:p><a:p><a:r><a:t>{보수내용}</a:t></a:r></a:p><a:p><a:pPr/><a:r><a:t>그대로 &amp; 둠</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="5" name="위치도"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000" y="2000"/><a:ext cx="4000" cy="2000"/></a:xfrm></p:spPr></p:sp>
</p:spTree></p:cSld></p:sld>"#;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        v.extend(w.to_be_bytes());
        v.extend(h.to_be_bytes());
        v.extend([8, 2, 0, 0, 0]);
        v
    }

    fn make_pptx(path: &Path) {
        let files = vec![
            ("[Content_Types].xml".to_string(), br#"<Types xmlns="x"><Default Extension="xml" ContentType="application/xml"/></Types>"#.to_vec(), false),
            ("ppt/slides/slide1.xml".to_string(), SLIDE.as_bytes().to_vec(), false),
            ("ppt/slides/_rels/slide1.xml.rels".to_string(), br#"<Relationships xmlns="x"></Relationships>"#.to_vec(), false),
        ];
        write_zip(path, &files).unwrap();
    }

    fn entry(path: &Path, name: &str) -> String {
        read_zip(path).unwrap().into_iter().find(|f| f.0 == name).map(|f| String::from_utf8(f.1).unwrap()).unwrap()
    }

    #[test]
    fn fills_text_across_runs_and_lines() {
        let d = tempfile::tempdir().unwrap();
        let (tpl, out, img) = (d.path().join("t.pptx"), d.path().join("o.pptx"), d.path().join("m.png"));
        make_pptx(&tpl);
        std::fs::write(&img, png(200, 100)).unwrap();
        let mut f = OrderFill::default();
        f.text.insert("연번".into(), "15".into());
        f.text.insert("보수내용".into(), "포트홀 <1곳>\n소파보수".into());
        f.text.insert("지시일".into(), "2026-10-17".into());
        f.images.insert("위치도".into(), img.display().to_string());
        f.images.insert("현장사진".into(), img.display().to_string());
        let r = fill_order(&tpl, &out, &f).unwrap();
        assert_eq!(r.missing, vec!["{지시일}".to_string(), "현장사진".to_string()]);
        let s = entry(&out, "ppt/slides/slide1.xml");
        assert!(s.contains(r#"<a:rPr b="1"/><a:t>연번 15</a:t></a:r><a:r><a:t></a:t>"#), "{s}");
        assert!(s.contains("<a:t>포트홀 &lt;1곳&gt;</a:t></a:r></a:p><a:p><a:r><a:t>소파보수</a:t>"), "{s}");
        assert!(s.contains("<a:t>그대로 &amp; 둠</a:t>"));
        // 4000×2000 칸에 2:1 그림 → 꽉 참, 이름 붙은 네모는 없어져요
        assert!(s.contains(r#"<a:off x="1000" y="2000"/><a:ext cx="4000" cy="2000"/>"#), "{s}");
        assert!(!s.contains("<p:sp><p:nvSpPr><p:cNvPr id=\"5\""));
        assert!(entry(&out, "ppt/slides/_rels/slide1.xml.rels").contains("../media/gilog_1.png"));
        assert!(entry(&out, "[Content_Types].xml").contains(r#"Extension="png""#));
    }

    #[test]
    fn picture_keeps_ratio_top_center() {
        let mut slide = SLIDE.to_string();
        let pic = Pic { name: "위치도".into(), ext: "png", bytes: vec![], size: (100, 100) };
        assert!(put_picture(&mut slide, "위치도", "rId9", 9, &pic));
        assert!(slide.contains(r#"<a:off x="2000" y="2000"/><a:ext cx="2000" cy="2000"/>"#), "{slide}");
        assert!(!put_picture(&mut slide, "없는 자리", "rId10", 10, &pic));
    }

    #[test]
    fn hwpx_text_and_mimetype_stays_stored() {
        let d = tempfile::tempdir().unwrap();
        let (tpl, out) = (d.path().join("t.hwpx"), d.path().join("o.hwpx"));
        let sec = r#"<hs:sec xmlns:hp="p"><hp:p id="1"><hp:run charPrIDRef="3"><hp:t>주소: {주소}</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>표<hp:tab/>칸</hp:t></hp:run></hp:p></hs:sec>"#;
        write_zip(&tpl, &[("mimetype".into(), b"application/hwp+zip".to_vec(), true), ("Contents/section0.xml".into(), sec.as_bytes().to_vec(), false)]).unwrap();
        let mut f = OrderFill::default();
        f.text.insert("주소".into(), "봉일천리 209-10".into());
        fill_order(&tpl, &out, &f).unwrap();
        let z = read_zip(&out).unwrap();
        assert_eq!((z[0].0.as_str(), z[0].2), ("mimetype", true));
        let s = entry(&out, "Contents/section0.xml");
        assert!(s.contains("<hp:t>주소: 봉일천리 209-10</hp:t>"), "{s}");
        assert!(s.contains("<hp:t>표<hp:tab/>칸</hp:t>"));
    }

    #[test]
    fn jpeg_size() {
        // SOI, APP0(길이 4), SOF0: 높이 300, 너비 400
        let j = [0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 11, 8, 1, 44, 1, 144, 3, 0, 0, 0, 0];
        assert_eq!(image_size(&j), Some((400, 300)));
    }
}
