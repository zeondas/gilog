//! zip 안 보기(읽기만)·꺼내기 – 모듈 이름을 `zip`으로 하면 zip 상자(crate)와 이름이 겹쳐 `archive`예요.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::*;

// ---------- zip 안 보기(읽기만) ----------

/// 경로가 zip 파일이거나 그 안이면 (zip 파일, 안쪽 경로 "a/b")
pub(crate) fn zip_split(path: &Path) -> Option<(PathBuf, String)> {
    for anc in path.ancestors() {
        if anc.as_os_str().is_empty() {
            break;
        }
        if anc.is_dir() {
            return None;
        }
        if anc.is_file() {
            let is_zip = anc.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"));
            if !is_zip {
                return None;
            }
            let rest = path.strip_prefix(anc).ok()?;
            let inner = rest.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/");
            return Some((anc.to_path_buf(), inner));
        }
    }
    None
}

/// zip 안 이름: UTF-8이 아니면 한국 윈도우 압축(CP949)으로 읽어요
pub(super) fn zip_name(raw: &[u8]) -> String {
    let s = match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::EUC_KR.decode(raw).0.into_owned(),
    };
    s.replace('\\', "/")
}

pub(super) fn zip_open(z: &Path) -> Result<zip::ZipArchive<fs::File>, String> {
    zip::ZipArchive::new(fs::File::open(z).map_err(io)?).map_err(|_| "bad_zip".to_string())
}

pub(super) fn zip_ms(dt: Option<zip::DateTime>) -> i64 {
    let Some(d) = dt else { return 0 };
    // 1970-01-01부터 날 수(그레고리력)
    let (y, m, dd) = (d.year() as i64, d.month() as i64, d.day() as i64);
    let (y2, m2) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + dd - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    ((days * 86400) + d.hour() as i64 * 3600 + d.minute() as i64 * 60 + d.second() as i64) * 1000
}

pub(super) fn zip_has_dir(z: &Path, inner: &str) -> bool {
    if inner.is_empty() {
        return true;
    }
    let Ok(mut a) = zip_open(z) else { return false };
    let pre = format!("{inner}/");
    (0..a.len()).any(|i| a.by_index_raw(i).is_ok_and(|f| zip_name(f.name_raw()).starts_with(&pre)))
}

pub(crate) fn list_zip(z: &Path, inner: &str) -> Result<Vec<Entry>, String> {
    let mut a = zip_open(z)?;
    let pre = if inner.is_empty() { String::new() } else { format!("{inner}/") };
    let base = if inner.is_empty() { z.to_path_buf() } else { z.join(inner.replace('/', std::path::MAIN_SEPARATOR_STR)) };
    let mut out: Vec<Entry> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for i in 0..a.len() {
        let Ok(f) = a.by_index_raw(i) else { continue };
        let name = zip_name(f.name_raw());
        let Some(rest) = name.strip_prefix(&pre) else { continue };
        let rest = rest.trim_end_matches('/');
        if rest.is_empty() {
            continue;
        }
        let (first, deeper) = match rest.split_once('/') {
            Some((a, _)) => (a, true),
            None => (rest, f.is_dir()),
        };
        if !seen.insert(first.to_string()) {
            continue;
        }
        let dir = deeper;
        out.push(Entry {
            name: first.to_string(),
            path: base.join(first).to_string_lossy().into_owned(),
            dir,
            size: if dir { 0 } else { f.size() },
            modified: zip_ms(f.last_modified()),
            created: 0,
            hidden: false,
            locked: false,
        });
    }
    Ok(out)
}

/// zip 안의 것들을 임시 폴더에 풀어 그 경로를 돌려줘요(복사해 나가기·열기). 폴더면 안의 것까지.
#[tauri::command]
pub async fn fs_zip_extract(paths: Vec<String>) -> Result<Vec<String>, String> {
    for p in &paths {
        crate::guard::plain(p)?;
    }
    tauri::async_runtime::spawn_blocking(move || zip_extract(&paths, &std::env::temp_dir().join("giLog-zip"))).await.map_err(|e| e.to_string())?
}

pub(crate) fn zip_extract(paths: &[String], tmp_root: &Path) -> Result<Vec<String>, String> {
    let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let base = tmp_root.join(stamp.to_string());
    let mut out = Vec::new();
    for p in paths {
        let Some((z, inner)) = zip_split(Path::new(p)) else { return Err("not_found".into()) };
        if inner.is_empty() {
            return Err("not_found".into());
        }
        let last = inner.rsplit('/').next().unwrap_or(&inner).to_string();
        if !crate::guard::safe_rel(&last) {
            return Err(crate::guard::DENIED.into());
        }
        let target = base.join(&last);
        let pre = format!("{inner}/");
        let mut a = zip_open(&z)?;
        let mut found = false;
        for i in 0..a.len() {
            let mut f = a.by_index(i).map_err(|_| "bad_zip".to_string())?;
            let name = zip_name(f.name_raw());
            let name = name.trim_end_matches('/');
            let to = if name == inner {
                target.clone()
            } else if let Some(rest) = name.strip_prefix(&pre) {
                // ".."·드라이브(`C:`)·맨 앞 `/`·`\\` 같은 이름으로 임시 폴더 밖에 쓰지 않게(②-2 ✔3)
                if !crate::guard::safe_rel(rest) {
                    continue;
                }
                target.join(rest.replace('/', std::path::MAIN_SEPARATOR_STR))
            } else {
                continue;
            };
            found = true;
            if f.is_dir() {
                fs::create_dir_all(&to).map_err(io)?;
                continue;
            }
            if let Some(par) = to.parent() {
                fs::create_dir_all(par).map_err(io)?;
            }
            let mut w = fs::File::create(&to).map_err(io)?;
            std::io::copy(&mut f, &mut w).map_err(io)?;
        }
        if !found {
            return Err("not_found".into());
        }
        if !target.exists() {
            fs::create_dir_all(&target).map_err(io)?;
        }
        out.push(target.to_string_lossy().into_owned());
    }
    Ok(out)
}
