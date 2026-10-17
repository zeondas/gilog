//! 탐색기 찾기의 "안의 글자": 파일 속 글자에 찾는 말이 있는지 봐요.
//!
//! - 글자 파일(txt·csv·md·log·html·xml·json·ini 등): UTF-8, UTF-16, 한국어 윈도우 글자(CP949)를 알아봐요.
//! - 오피스(docx·xlsx·pptx)와 한글 hwpx: 압축 안의 XML 글자.
//! - 한글 hwp(5.0): 안의 본문(BodyText) 구역을 풀어 문단 글자를 읽어요. 암호·배포용 문서는 못 읽어요.
//! - PDF: 쪽마다 글자를 뽑아요. 그림으로 된(스캔) PDF는 못 읽어요.
//! 회사 보안(DRM)이 걸린 파일은 내용이 암호라 찾지 못해요.

use std::fs;
use std::io::Read;
use std::path::Path;

/// 이보다 큰 파일은 안의 글자를 보지 않아요(찾기가 너무 오래 걸려요).
const MAX_BYTES: u64 = 60 * 1024 * 1024;

/// needle은 소문자로 받아요.
pub fn contains(path: &Path, needle: &str) -> bool {
    if needle.is_empty() {
        return true;
    }
    if fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(true) {
        return false;
    }
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let text = match ext.as_str() {
        "txt" | "csv" | "tsv" | "md" | "log" | "html" | "htm" | "xml" | "json" | "ini" | "cfg" | "sql" | "js" | "ts" | "css" | "bat" | "ps1" => plain(path),
        "docx" | "xlsx" | "pptx" | "hwpx" => zip_xml(path, &ext),
        "hwp" => hwp(path),
        "pdf" => pdf(path),
        _ => None,
    };
    text.map(|t| squash(&t).contains(&squash(needle))).unwrap_or(false)
}

/// 소문자로, 연속 공백은 하나로(오피스 문서는 글자 사이 줄바꿈이 끼어요)
fn squash(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.extend(c.to_lowercase());
            space = false;
        }
    }
    out
}

pub(crate) fn decode(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE.decode(&bytes[2..]).0.into_owned();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE.decode(&bytes[2..]).0.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::EUC_KR.decode(bytes).0.into_owned(),
    }
}

fn plain(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|b| decode(&b))
}

/// XML 태그를 빼고 글자만(엔터티 몇 가지는 풀어요)
pub(crate) fn strip_xml(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 2);
    let mut in_tag = false;
    for c in xml.chars() {
        match c {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn zip_xml(path: &Path, ext: &str) -> Option<String> {
    let f = fs::File::open(path).ok()?;
    let mut z = zip::ZipArchive::new(f).ok()?;
    let mut out = String::new();
    for i in 0..z.len() {
        let mut file = z.by_index(i).ok()?;
        let n = file.name().to_string();
        let wanted = match ext {
            "docx" => n.starts_with("word/") && n.ends_with(".xml"),
            "xlsx" => n == "xl/sharedStrings.xml" || (n.starts_with("xl/worksheets/") && n.ends_with(".xml")),
            "pptx" => n.starts_with("ppt/slides/") && n.ends_with(".xml"),
            "hwpx" => n.starts_with("Contents/section") && n.ends_with(".xml"),
            _ => false,
        };
        if !wanted || file.size() > MAX_BYTES {
            continue;
        }
        let mut s = String::new();
        if file.read_to_string(&mut s).is_ok() {
            out.push_str(&strip_xml(&s));
            out.push(' ');
        }
    }
    Some(out)
}

/// 한글 hwp 5.0: 복합 문서 안 "BodyText/Section0.." 스트림(보통 압축) → 레코드 → 문단 글자(태그 67)
fn hwp(path: &Path) -> Option<String> {
    let mut comp = cfb::open(path).ok()?;
    // FileHeader의 속성: 첫 비트 압축, 둘째 비트 암호
    let mut header = Vec::new();
    comp.open_stream("/FileHeader").ok()?.read_to_end(&mut header).ok()?;
    if header.len() < 40 {
        return None;
    }
    let flags = u32::from_le_bytes([header[36], header[37], header[38], header[39]]);
    let compressed = flags & 1 != 0;
    if flags & 2 != 0 {
        return None;
    }
    let mut out = String::new();
    for i in 0..1000 {
        let name = format!("/BodyText/Section{i}");
        let Ok(mut s) = comp.open_stream(&name) else { break };
        let mut raw = Vec::new();
        if s.read_to_end(&mut raw).is_err() {
            break;
        }
        let data = if compressed {
            let mut d = Vec::new();
            if flate2::read::DeflateDecoder::new(&raw[..]).read_to_end(&mut d).is_err() {
                continue;
            }
            d
        } else {
            raw
        };
        out.push_str(&hwp_records_text(&data));
        out.push(' ');
    }
    Some(out)
}

/// hwp 레코드 묶음에서 문단 글자(HWPTAG_PARA_TEXT = 67)만 모아요.
pub(crate) fn hwp_records_text(data: &[u8]) -> String {
    let mut out = String::new();
    let mut p = 0usize;
    while p + 4 <= data.len() {
        let h = u32::from_le_bytes([data[p], data[p + 1], data[p + 2], data[p + 3]]);
        p += 4;
        let tag = h & 0x3FF;
        let mut size = ((h >> 20) & 0xFFF) as usize;
        if size == 0xFFF {
            if p + 4 > data.len() {
                break;
            }
            size = u32::from_le_bytes([data[p], data[p + 1], data[p + 2], data[p + 3]]) as usize;
            p += 4;
        }
        if p + size > data.len() {
            break;
        }
        if tag == 67 {
            let units: Vec<u16> = data[p..p + size].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let mut k = 0usize;
            while k < units.len() {
                let u = units[k];
                // 조절 글자: 1~31 중 일부는 뒤에 7칸(14바이트)을 더 차지해요.
                match u {
                    0..=31 => {
                        if matches!(u, 1..=3 | 11..=12 | 14..=18 | 21..=23) {
                            k += 8;
                        } else {
                            if u == 13 || u == 10 {
                                out.push(' ');
                            }
                            k += 1;
                        }
                    }
                    _ => {
                        out.push_str(&String::from_utf16_lossy(&[u]));
                        k += 1;
                    }
                }
            }
            out.push(' ');
        }
        p += size;
    }
    out
}

fn pdf(path: &Path) -> Option<String> {
    let doc = lopdf::Document::load(path).ok()?;
    let pages: Vec<u32> = doc.get_pages().keys().copied().collect();
    doc.extract_text(&pages).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn decodes_korean_text_files() {
        let (euc, _, _) = encoding_rs::EUC_KR.encode("봉일천리 포트홀");
        assert_eq!(decode(&euc), "봉일천리 포트홀");
        assert_eq!(decode("봉일천리".as_bytes()), "봉일천리");
        let mut u16 = vec![0xFF, 0xFE];
        for u in "연풍리".encode_utf16() {
            u16.extend_from_slice(&u.to_le_bytes());
        }
        assert_eq!(decode(&u16), "연풍리");
    }

    #[test]
    fn office_xml_and_squash() {
        let d = std::env::temp_dir().join(format!("gilog-text-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let p = d.join("a.docx");
        let f = fs::File::create(&p).unwrap();
        let mut z = zip::ZipWriter::new(f);
        z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all("<w:p><w:r><w:t>봉일천리</w:t></w:r><w:r><w:t>209-10</w:t></w:r></w:p>".as_bytes()).unwrap();
        z.finish().unwrap();
        assert!(contains(&p, "봉일천리"));
        assert!(contains(&p, "209-10"));
        assert!(!contains(&p, "연풍리"));
        assert_eq!(strip_xml("<a>x &amp; y</a>").trim(), "x & y");
    }

    #[test]
    fn hwp_para_text_records() {
        // 레코드 머리: 태그 67, 크기 = 글자 수 * 2
        let text: Vec<u16> = "포트홀 보수".encode_utf16().chain([13u16]).collect();
        let size = (text.len() * 2) as u32;
        let head = 67u32 | (size << 20);
        let mut data = head.to_le_bytes().to_vec();
        for u in text {
            data.extend_from_slice(&u.to_le_bytes());
        }
        // 다른 레코드(태그 66) 하나 끼워 넣기
        let other = 66u32 | (4u32 << 20);
        data.extend_from_slice(&other.to_le_bytes());
        data.extend_from_slice(&[0, 0, 0, 0]);
        assert_eq!(hwp_records_text(&data).trim(), "포트홀 보수");
    }
}
