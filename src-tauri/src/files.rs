//! 탐색기(11단계)에서 앱(Rust)이 맡는 파일 일이에요.
//!
//! - 폴더 읽기·드라이브 목록·새 폴더·이름 바꾸기·복사·옮기기·지우기(휴지통/완전 삭제)·찾기·폴더 감시.
//! - 같은 이름 처리: 화면이 먼저 `fs_conflicts`로 겹치는 파일을 받아 사용자에게 묻고(한 파일씩, 1안),
//!   고른 것(`over`·`skip`·`both`)을 `fs_transfer`에 함께 보내요. 폴더가 겹치면 합치고 안의 파일을 다시 따져요.
//!   "둘 다 두기"는 새 파일 이름의 확장자 앞에 " (2)"(있으면 (3)…)를 붙여요.
//! - 윈도우에만 있는 것(드라이브 이름·남은 용량, 윈도우 아이콘, 윈도우 우클릭 메뉴, 숨김 속성,
//!   기본 프로그램으로 열기)은 `files_win.rs`에 있어요. 리눅스(작업 공간)에서는 비슷한 흉내로 돌아요.
//! - 탐색기의 화면 상태(탭·열 폭 등)는 화면이 암호화 파일 kv의 `files.state`에 저장해요. 여기서는 저장하지 않아요.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// 목록 한 줄
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub size: u64,
    /// 수정한 때(밀리초). 읽지 못하면 0
    pub modified: i64,
    /// 만든 때(밀리초, 일괄 이름 바꾸기의 생성일 열)
    pub created: i64,
    pub hidden: bool,
    /// 회사 보안(DRM)이 걸린 것으로 보이는 파일
    pub locked: bool,
}

/// 드라이브 단추 하나
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// "C:"
    pub name: String,
    /// "C:\"
    pub path: String,
    pub label: String,
    /// fixed · removable · network · cdrom · other
    pub kind: String,
    pub free: u64,
    pub total: u64,
}

pub(crate) fn ms(t: std::io::Result<std::time::SystemTime>) -> i64 {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn io(e: std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "not_found".into(),
        std::io::ErrorKind::PermissionDenied => "denied".into(),
        std::io::ErrorKind::AlreadyExists => "exists".into(),
        _ => format!("io:{e}"),
    }
}

fn entry_of(path: &Path) -> Option<Entry> {
    let meta = fs::metadata(path).ok().or_else(|| fs::symlink_metadata(path).ok())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned());
    let dir = meta.is_dir();
    Some(Entry {
        hidden: is_hidden(path, &meta),
        locked: !dir && looks_locked(path),
        name,
        path: path.to_string_lossy().into_owned(),
        dir,
        size: if dir { 0 } else { meta.len() },
        modified: ms(meta.modified()),
        created: ms(meta.created()),
    })
}

#[cfg(windows)]
fn is_hidden(_path: &Path, meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    // FILE_ATTRIBUTE_HIDDEN(2) | FILE_ATTRIBUTE_SYSTEM(4)
    meta.file_attributes() & 0x6 != 0
}

#[cfg(not(windows))]
fn is_hidden(path: &Path, _meta: &fs::Metadata) -> bool {
    path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false)
}

/// 회사 보안 프로그램이 잠근 파일인지 머리 부분으로 짐작해요.
/// 어떤 보안 프로그램인지 아직 몰라요(사용자가 회사에서 확인 예정) – 흔한 국산 DRM 표시만 봐요.
/// 틀려도 배지 하나라 해가 없어요. 회사 PC에서 맞는지 확인할 것(시험 항목).
fn looks_locked(path: &Path) -> bool {
    const MARKS: [&[u8]; 6] = [b"SCDSA00", b"<!-- FasooSecureContainer", b"DRMONE", b"MarkAny", b"<DOCUMENT SAFER", b"DSCSFTCF"];
    let Ok(mut f) = fs::File::open(path) else { return false };
    let mut head = [0u8; 512];
    let n = f.read(&mut head).unwrap_or(0);
    let head = &head[..n];
    MARKS.iter().any(|m| head.windows(m.len()).any(|w| w == *m))
}

/// 폴더 안 목록. 숨김 파일은 show_hidden일 때만.
#[tauri::command]
pub async fn fs_list(app: AppHandle, path: String, show_hidden: bool) -> Result<Vec<Entry>, String> {
    // 이 폴더의 사진을 미리 보기로 읽게(✔4)
    crate::guard::allow_preview_dir(&app, Path::new(&path));
    tauri::async_runtime::spawn_blocking(move || list(Path::new(&path), show_hidden)).await.map_err(|e| e.to_string())?
}

pub(crate) fn list(dir: &Path, show_hidden: bool) -> Result<Vec<Entry>, String> {
    // zip 파일은 폴더처럼 들어가요(호환 B, 2026-10-20 사용자) – "…\자료.zip\사진" 같은 경로
    if !dir.is_dir() {
        if let Some((z, inner)) = zip_split(dir) {
            return list_zip(&z, &inner);
        }
    }
    let mut out = Vec::new();
    for e in fs::read_dir(dir).map_err(io)? {
        let Ok(e) = e else { continue };
        if let Some(en) = entry_of(&e.path()) {
            if en.hidden && !show_hidden {
                continue;
            }
            out.push(en);
        }
    }
    Ok(out)
}

/// 트리용: 하위 폴더만, 그 아래 폴더가 더 있는지(꺾쇠)와 함께
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TreeDir {
    pub name: String,
    pub path: String,
    pub has_children: bool,
}

#[tauri::command]
pub async fn fs_subdirs(path: String, show_hidden: bool) -> Result<Vec<TreeDir>, String> {
    tauri::async_runtime::spawn_blocking(move || subdirs(Path::new(&path), show_hidden)).await.map_err(|e| e.to_string())?
}

pub(crate) fn subdirs(dir: &Path, show_hidden: bool) -> Result<Vec<TreeDir>, String> {
    let mut out: Vec<TreeDir> = list(dir, show_hidden)?
        .into_iter()
        .filter(|e| e.dir)
        .map(|e| {
            let has_children = fs::read_dir(&e.path)
                .map(|it| it.flatten().any(|c| c.file_type().map(|t| t.is_dir()).unwrap_or(false)))
                .unwrap_or(false);
            TreeDir { name: e.name, path: e.path, has_children }
        })
        .collect();
    out.sort_by_key(|d| d.name.to_lowercase());
    Ok(out)
}

/// 드라이브 목록
#[tauri::command]
pub fn fs_drives() -> Vec<Drive> {
    #[cfg(windows)]
    {
        crate::files_win::drives()
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
        vec![
            Drive { name: "/".into(), path: "/".into(), label: "루트".into(), kind: "fixed".into(), free: 0, total: 0 },
            Drive { name: "~".into(), path: home, label: "홈".into(), kind: "fixed".into(), free: 0, total: 0 },
        ]
    }
}

/// 처음 여는 폴더(문서)
#[tauri::command]
pub fn fs_home(app: AppHandle) -> String {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "C:\\".into())
}

/// 경로가 폴더로 있는지(경로 칸에 고쳐 적은 것 확인)
#[tauri::command]
pub fn fs_is_dir(path: String) -> bool {
    let p = Path::new(&path);
    p.is_dir() || (!p.exists() && zip_split(p).is_some_and(|(z, inner)| zip_has_dir(&z, &inner)))
}

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
fn zip_name(raw: &[u8]) -> String {
    let s = match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::EUC_KR.decode(raw).0.into_owned(),
    };
    s.replace('\\', "/")
}

fn zip_open(z: &Path) -> Result<zip::ZipArchive<fs::File>, String> {
    zip::ZipArchive::new(fs::File::open(z).map_err(io)?).map_err(|_| "bad_zip".to_string())
}

fn zip_ms(dt: Option<zip::DateTime>) -> i64 {
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

fn zip_has_dir(z: &Path, inner: &str) -> bool {
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
                // ".." 같은 이름으로 임시 폴더 밖에 쓰지 않게
                if rest.split('/').any(|c| c == ".." || c.is_empty()) {
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

/// 윈도우가 장치 이름으로 쓰는 이름(CON, PRN, AUX, NUL, COM1~9, LPT1~9) – 확장자가 붙어도 못 써요
pub(crate) fn reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end().to_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

fn check_name(name: &str) -> Result<(), String> {
    let bad = name.trim().is_empty()
        || name.chars().any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || (c as u32) < 32)
        || name == "."
        || name == ".."
        || name.ends_with('.')
        || name.ends_with(' ');
    if bad {
        Err("bad_name".into())
    } else if reserved_name(name) {
        Err("reserved_name".into())
    } else {
        Ok(())
    }
}

/// 새 폴더. 만든 경로를 돌려줘요.
#[tauri::command]
pub fn fs_mkdir(app: AppHandle, dir: String, name: String) -> Result<String, String> {
    crate::guard::writable(&dir, &crate::guard::protected(&app))?;
    mkdir(dir, name)
}

pub(crate) fn mkdir(dir: String, name: String) -> Result<String, String> {
    check_name(&name)?;
    let p = Path::new(&dir).join(name.trim());
    if p.exists() {
        return Err("exists".into());
    }
    fs::create_dir(&p).map_err(io)?;
    Ok(p.to_string_lossy().into_owned())
}

/// 이름 바꾸기. 바뀐 경로를 돌려줘요. 대소문자만 바꾸는 것도 돼요.
#[tauri::command]
pub fn fs_rename(app: AppHandle, path: String, name: String) -> Result<String, String> {
    crate::guard::removable(&path, &crate::guard::protected(&app))?;
    rename_one(Path::new(&path), &name).map(|p| p.to_string_lossy().into_owned())
}

pub(crate) fn rename_one(path: &Path, name: &str) -> Result<PathBuf, String> {
    check_name(name)?;
    let to = path.with_file_name(name);
    let same_but_case = to.to_string_lossy().to_lowercase() == path.to_string_lossy().to_lowercase();
    if to.exists() && !same_but_case {
        return Err("exists".into());
    }
    fs::rename(path, &to).map_err(io)?;
    Ok(to)
}

/// 일괄 이름 바꾸기 한 줄
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct RenameItem {
    pub path: String,
    pub name: String,
}

/// 일괄 이름 바꾸기. 겹치는 이름은 화면이 미리 막지만, 여기서도 한 줄이라도 실패하면 이미 바꾼 것을 되돌려요.
/// 바꾼 결과(되돌리기용: 새 경로 → 옛 이름)를 돌려줘요.
#[tauri::command]
pub fn fs_rename_many(app: AppHandle, items: Vec<RenameItem>) -> Result<Vec<RenameItem>, String> {
    let prot = crate::guard::protected(&app);
    for it in &items {
        crate::guard::removable(&it.path, &prot)?;
    }
    rename_many(&items)
}

pub(crate) fn rename_many(items: &[RenameItem]) -> Result<Vec<RenameItem>, String> {
    for it in items {
        check_name(&it.name)?;
    }
    // 서로 이름을 맞바꾸는 경우(a→b, b→a)를 위해 먼저 임시 이름으로 옮겨요.
    let mut temp: Vec<(PathBuf, PathBuf, String)> = Vec::new(); // (임시, 원래, 새 이름)
    let undo_temp = |temp: &Vec<(PathBuf, PathBuf, String)>| {
        for (t, orig, _) in temp.iter().rev() {
            let _ = fs::rename(t, orig);
        }
    };
    for (i, it) in items.iter().enumerate() {
        let p = PathBuf::from(&it.path);
        let t = p.with_file_name(format!(".gilog-rename-{}-{}", std::process::id(), i));
        if let Err(e) = fs::rename(&p, &t) {
            undo_temp(&temp);
            return Err(io(e));
        }
        temp.push((t, p, it.name.clone()));
    }
    let mut done: Vec<(PathBuf, PathBuf)> = Vec::new(); // (새 경로, 원래)
    for (t, orig, name) in &temp {
        let to = orig.with_file_name(name);
        if to.exists() {
            for (n, o) in done.iter().rev() {
                let _ = fs::rename(n, o);
            }
            for (t2, o2, _) in &temp {
                if t2.exists() {
                    let _ = fs::rename(t2, o2);
                }
            }
            return Err("exists".into());
        }
        if let Err(e) = fs::rename(t, &to) {
            for (n, o) in done.iter().rev() {
                let _ = fs::rename(n, o);
            }
            for (t2, o2, _) in &temp {
                if t2.exists() {
                    let _ = fs::rename(t2, o2);
                }
            }
            return Err(io(e));
        }
        done.push((to, orig.clone()));
    }
    Ok(done
        .into_iter()
        .map(|(n, o)| RenameItem { path: n.to_string_lossy().into_owned(), name: o.file_name().unwrap().to_string_lossy().into_owned() })
        .collect())
}

// ---------- 같은 이름 · 복사 · 옮기기 ----------

/// 겹치는 파일 하나: 복사할 파일과 이미 있는 파일
#[derive(Serialize, Clone, Debug)]
pub struct Conflict {
    pub src: Entry,
    pub dst: Entry,
}

/// 원본 하나를 대상 폴더 안의 어디로 보내는지(폴더는 안의 파일까지 펼쳐요). (원본 파일, 대상 파일)
fn plan(sources: &[PathBuf], dest: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut out = Vec::new();
    fn walk(src: &Path, dst: &Path, out: &mut Vec<(PathBuf, PathBuf)>) {
        if src.is_dir() {
            if let Ok(it) = fs::read_dir(src) {
                for e in it.flatten() {
                    walk(&e.path(), &dst.join(e.file_name()), out);
                }
            }
        } else {
            out.push((src.to_path_buf(), dst.to_path_buf()));
        }
    }
    for s in sources {
        if let Some(name) = s.file_name() {
            // 원본이 이미 이 폴더에 있으면(같은 폴더에 붙여 넣기) 윈도우처럼 "이름 - 복사본"으로 만들어요.
            let to = dest.join(name);
            let to = if s.parent() == Some(dest) { copy_name(&to) } else { to };
            walk(s, &to, &mut out);
        }
    }
    out
}

/// "이름 - 복사본.확장자", 있으면 "이름 - 복사본 (2).확장자" … (폴더는 이름 전체)
pub(crate) fn copy_name(p: &Path) -> PathBuf {
    let dir = p.parent().unwrap_or(Path::new(""));
    let name = p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let (stem, ext) = match (p.is_dir(), name.rfind('.')) {
        (false, Some(i)) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.clone(), String::new()),
    };
    let first = dir.join(format!("{stem} - 복사본{ext}"));
    if !first.exists() {
        return first;
    }
    let mut n = 2;
    loop {
        let c = dir.join(format!("{stem} - 복사본 ({n}){ext}"));
        if !c.exists() {
            return c;
        }
        n += 1;
    }
}

/// 윈도우 클립보드 파일 목록(DROPFILES) 바이트: 머리 20바이트(pFiles=20, pt, fNC, fWide=1) + 넓은 글자 경로들, 끝은 0 두 번.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn drop_files_bytes(paths: &[String]) -> Vec<u8> {
    let mut b: Vec<u8> = Vec::new();
    for v in [20i32, 0, 0, 0, 1] {
        b.extend(v.to_le_bytes());
    }
    for p in paths {
        for w in p.encode_utf16() {
            b.extend(w.to_le_bytes());
        }
        b.extend(0u16.to_le_bytes());
    }
    b.extend(0u16.to_le_bytes());
    b
}

/// DROPFILES 바이트 → 경로들(넓은 글자·좁은 글자 둘 다)
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_drop_files(b: &[u8]) -> Vec<String> {
    if b.len() < 20 {
        return vec![];
    }
    let off = u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize;
    let wide = i32::from_le_bytes([b[16], b[17], b[18], b[19]]) != 0;
    let mut out = Vec::new();
    if off >= b.len() {
        return out;
    }
    if wide {
        let ws: Vec<u16> = b[off..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        for part in ws.split(|&w| w == 0) {
            if part.is_empty() {
                break;
            }
            out.push(String::from_utf16_lossy(part));
        }
    } else {
        for part in b[off..].split(|&c| c == 0) {
            if part.is_empty() {
                break;
            }
            out.push(String::from_utf8_lossy(part).into_owned());
        }
    }
    out
}

#[derive(Serialize)]
pub struct Clip {
    pub paths: Vec<String>,
    pub cut: bool,
}

/// Ctrl+C·X: 파일을 윈도우 클립보드에(빈 목록이면 비우기)
#[tauri::command]
pub fn fs_clip_set(paths: Vec<String>, cut: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::files_win::clip_set(&paths, cut)
    }
    #[cfg(not(windows))]
    {
        let _ = (paths, cut);
        Err("windows_only".into())
    }
}

/// Ctrl+V: 윈도우 클립보드의 파일 목록
#[tauri::command]
pub fn fs_clip_get() -> Result<Clip, String> {
    #[cfg(windows)]
    {
        crate::files_win::clip_get().map(|(paths, cut)| Clip { paths, cut })
    }
    #[cfg(not(windows))]
    {
        Err("windows_only".into())
    }
}

/// 대상에 같은 이름의 파일이 이미 있는 것들. 원본과 대상이 같은 파일이면(같은 폴더로 복사) 겹침이에요.
#[tauri::command]
pub async fn fs_conflicts(sources: Vec<String>, dest: String) -> Result<Vec<Conflict>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let srcs: Vec<PathBuf> = sources.iter().map(PathBuf::from).collect();
        conflicts(&srcs, Path::new(&dest))
    })
    .await
    .map_err(|e| e.to_string())
}

pub(crate) fn conflicts(sources: &[PathBuf], dest: &Path) -> Vec<Conflict> {
    plan(sources, dest)
        .into_iter()
        .filter(|(_, d)| d.is_file())
        .filter_map(|(s, d)| Some(Conflict { src: entry_of(&s)?, dst: entry_of(&d)? }))
        .collect()
}

/// "이름 (2).확장자" – 없는 번호를 찾아요.
pub(crate) fn unique_path(p: &Path) -> PathBuf {
    if !p.exists() {
        return p.to_path_buf();
    }
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    // 이미 "이름 (3)"이면 그 뒤 번호부터
    let (base, start) = match stem.rfind(" (") {
        Some(i) if stem.ends_with(')') => match stem[i + 2..stem.len() - 1].parse::<u32>() {
            Ok(n) => (stem[..i].to_string(), n + 1),
            Err(_) => (stem.clone(), 2),
        },
        _ => (stem.clone(), 2),
    };
    let dir = p.parent().unwrap_or(Path::new(""));
    let mut n = start;
    loop {
        let c = dir.join(format!("{base} ({n}){ext}"));
        if !c.exists() {
            return c;
        }
        n += 1;
    }
}

/// 옮기기·복사 결과
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Summary {
    pub done: usize,
    pub skipped: usize,
    /// (경로, 이유)
    pub errors: Vec<(String, String)>,
    /// 되돌리기용: 새로 생긴 것 (원본, 대상) – 통째로 옮긴·새로 만든 폴더는 폴더 하나로(덮어쓴 것은 빼요)
    pub pairs: Vec<(String, String)>,
    /// 덮어쓴 파일 수(되돌릴 수 없어요)
    pub overwritten: usize,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: usize,
    total: usize,
    name: String,
}

static CANCEL: AtomicBool = AtomicBool::new(false);

/// 복사(copy)·옮기기(move). decisions는 대상 파일 경로 → over · skip · both (겹친 것만, 없으면 skip)
#[tauri::command]
pub async fn fs_transfer(
    app: AppHandle,
    op: String,
    sources: Vec<String>,
    dest: String,
    decisions: HashMap<String, String>,
) -> Result<Summary, String> {
    let prot = crate::guard::protected(&app);
    crate::guard::writable(&dest, &prot)?;
    for s in &sources {
        // 옮기기는 원본이 없어지니 지우기와 같은 검사, 복사는 읽기만
        if op == "move" {
            crate::guard::removable(s, &prot)?;
        } else {
            crate::guard::plain(s)?;
        }
    }
    CANCEL.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let srcs: Vec<PathBuf> = sources.iter().map(PathBuf::from).collect();
        let tell = |done: usize, total: usize, name: &str| {
            let _ = app.emit("fs-progress", Progress { done, total, name: name.to_string() });
        };
        transfer(op == "move", &srcs, Path::new(&dest), &decisions, &tell)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn fs_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

pub(crate) fn transfer(
    is_move: bool,
    sources: &[PathBuf],
    dest: &Path,
    decisions: &HashMap<String, String>,
    tell: &dyn Fn(usize, usize, &str),
) -> Result<Summary, String> {
    if !dest.is_dir() {
        return Err("not_found".into());
    }
    for s in sources {
        // 폴더를 자기 안으로 옮기거나 복사하면 끝이 없어요.
        if s.is_dir() && dest.starts_with(s) {
            return Err("into_self".into());
        }
    }
    let mut sum = Summary::default();
    let work = plan(sources, dest);
    let total = work.len();
    // 옮기기는 같은 드라이브에서 겹침이 없으면 폴더째 한 번에 옮겨요(빠르고, 빈 폴더도 따라가요).
    let mut handled: HashSet<PathBuf> = HashSet::new();
    let mut pairs: Vec<(PathBuf, PathBuf)> = Vec::new();
    if is_move {
        for s in sources {
            let Some(name) = s.file_name() else { continue };
            let to = dest.join(name);
            if s == &to {
                sum.skipped += 1;
                handled.insert(s.clone());
                continue;
            }
            if !to.exists() && fs::rename(s, &to).is_ok() {
                handled.insert(s.clone());
                pairs.push((s.clone(), to.clone()));
                sum.done += if s.is_dir() || to.is_dir() { work.iter().filter(|(a, _)| a.starts_with(s)).count().max(1) } else { 1 };
            }
        }
    }
    // 대상에 없던 폴더(통째로 새로 생기는 폴더) – 되돌릴 때 폴더 하나로 다뤄요
    let mut fresh: Vec<(PathBuf, PathBuf)> = Vec::new();
    for s in sources {
        if handled.contains(s) || !s.is_dir() {
            continue;
        }
        let Some(name) = s.file_name() else { continue };
        let to = dest.join(name);
        let to = if s.parent() == Some(dest) { copy_name(&to) } else { to };
        if !to.exists() {
            fresh.push((s.clone(), to));
        }
    }
    let mut n = 0usize;
    for (src, dst) in &work {
        if handled.iter().any(|h| src.starts_with(h)) {
            continue;
        }
        if CANCEL.load(Ordering::SeqCst) {
            sum.errors.push((src.to_string_lossy().into_owned(), "cancelled".into()));
            break;
        }
        n += 1;
        tell(n, total, &src.file_name().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default());
        let mut target = dst.clone();
        let mut over = false;
        if target.exists() || src == dst {
            let key = dst.to_string_lossy().into_owned();
            match decisions.get(&key).map(String::as_str).unwrap_or(if src == dst { "both" } else { "skip" }) {
                "over" if src != dst => over = true,
                "both" => target = unique_path(dst),
                _ => {
                    sum.skipped += 1;
                    continue;
                }
            }
        }
        if let Some(parent) = target.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                sum.errors.push((src.to_string_lossy().into_owned(), io(e)));
                continue;
            }
        }
        let r = if is_move {
            fs::rename(src, &target).or_else(|_| fs::copy(src, &target).and_then(|_| fs::remove_file(src)))
        } else {
            fs::copy(src, &target).map(|_| ())
        };
        match r {
            Ok(()) => {
                sum.done += 1;
                if over {
                    sum.overwritten += 1;
                } else if !fresh.iter().any(|(_, t)| target.starts_with(t)) {
                    pairs.push((src.clone(), target.clone()));
                }
            }
            Err(e) => sum.errors.push((src.to_string_lossy().into_owned(), io(e))),
        }
    }
    // 빈 폴더도 복사·옮기기(파일이 없어 plan에 안 잡힌 것)
    for s in sources {
        if handled.contains(s) || !s.is_dir() {
            continue;
        }
        copy_empty_dirs(s, &dest.join(s.file_name().unwrap_or_default()));
        if is_move && sum.errors.is_empty() {
            let _ = remove_if_empty_tree(s);
        }
    }
    for (s, t) in fresh {
        if t.exists() {
            pairs.push((s, t));
        }
    }
    sum.pairs = pairs.into_iter().map(|(a, b)| (a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned())).collect();
    Ok(sum)
}

// ---------- 되돌리기·다시 하기(Ctrl+Z·Y, 호환 A1) ----------

/// 되돌리기 한 걸음. 화면이 일을 할 때 거꾸로 할 걸음을 미리 만들어 둬요.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum Step {
    /// 옮기기(이름 바꾸기 포함). 대상에 같은 이름 폴더가 있으면 안으로 합쳐요, 파일이 있으면 건너뛰어요.
    Move { from: String, to: String },
    /// 복사(폴더는 통째로). 대상이 있으면 건너뛰어요.
    Copy { from: String, to: String },
    /// 휴지통으로
    Trash { paths: Vec<String> },
    /// 휴지통에서 꺼내기 – since(유닉스 초) 뒤에 지운 것 가운데 가장 새것
    Restore { paths: Vec<String>, since: i64 },
    /// 빈 폴더 만들기
    Mkdir { path: String },
}

#[tauri::command]
pub async fn fs_undo(app: AppHandle, steps: Vec<Step>) -> Result<Summary, String> {
    check_steps(&steps, &crate::guard::protected(&app))?;
    tauri::async_runtime::spawn_blocking(move || Ok(run_steps(&steps))).await.map_err(|e| e.to_string())?
}

/// 되돌리기 걸음도 화면이 보내요 – 지우기·옮기기와 같은 검사를 거쳐요
pub(crate) fn check_steps(steps: &[Step], prot: &crate::guard::Protected) -> Result<(), String> {
    use crate::guard::{plain, removable, writable};
    for st in steps {
        match st {
            Step::Move { from, to } => {
                removable(from, prot)?;
                writable(to, prot)?;
            }
            Step::Copy { from, to } => {
                plain(from)?;
                writable(to, prot)?;
            }
            Step::Trash { paths } => {
                for p in paths {
                    removable(p, prot)?;
                }
            }
            Step::Restore { paths, .. } => {
                for p in paths {
                    writable(p, prot)?;
                }
            }
            Step::Mkdir { path } => {
                writable(path, prot)?;
            }
        }
    }
    Ok(())
}

pub(crate) fn run_steps(steps: &[Step]) -> Summary {
    let mut sum = Summary::default();
    let mut tell = |r: Result<usize, String>, path: &str| match r {
        Ok(n) => sum.done += n,
        Err(e) => sum.errors.push((path.to_string(), e)),
    };
    for st in steps {
        match st {
            Step::Move { from, to } => tell(move_back(Path::new(from), Path::new(to)).map(|_| 1), from),
            Step::Copy { from, to } => {
                let (f, t) = (Path::new(from), Path::new(to));
                let r = if t.exists() {
                    Err("exists".to_string())
                } else if !f.exists() {
                    Err("not_found".to_string())
                } else {
                    t.parent().map(fs::create_dir_all).transpose().map_err(io).and_then(|_| copy_tree(f, t)).map(|_| 1)
                };
                tell(r, from)
            }
            Step::Mkdir { path } => tell(fs::create_dir_all(path).map(|_| 1).map_err(io), path),
            Step::Trash { paths } => {
                let have: Vec<&String> = paths.iter().filter(|p| Path::new(p).exists()).collect();
                let n = have.len();
                let r = if n == 0 { Ok(0) } else { trash::delete_all(&have).map(|_| n).map_err(|e| format!("trash:{e}")) };
                tell(r, paths.first().map(String::as_str).unwrap_or(""))
            }
            Step::Restore { paths, since } => tell(restore(paths, *since), paths.first().map(String::as_str).unwrap_or("")),
        }
    }
    sum
}

/// from → to로 옮겨요. 같은 드라이브면 이름만, 다른 드라이브면 복사 뒤 지워요.
/// to에 같은 이름 폴더가 이미 있으면 안의 것을 하나씩 옮겨 합치고, 파일이 있으면 "exists".
pub(crate) fn move_back(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Err("not_found".into());
    }
    let same_but_case = from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    if to.exists() && !same_but_case {
        if from.is_dir() && to.is_dir() {
            let mut first_err = None;
            for e in fs::read_dir(from).map_err(io)?.flatten() {
                if let Err(er) = move_back(&e.path(), &to.join(e.file_name())) {
                    first_err.get_or_insert(er);
                }
            }
            let _ = fs::remove_dir(from);
            return first_err.map_or(Ok(()), Err);
        }
        return Err("exists".into());
    }
    if let Some(p) = to.parent() {
        fs::create_dir_all(p).map_err(io)?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_tree(from, to)?;
    if from.is_dir() { fs::remove_dir_all(from) } else { fs::remove_file(from) }.map_err(io)
}

/// 폴더째 복사(파일이면 파일 하나). 대상에 있는 파일은 덮지 않아요.
fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(io)?;
        for e in fs::read_dir(from).map_err(io)?.flatten() {
            copy_tree(&e.path(), &to.join(e.file_name()))?;
        }
        Ok(())
    } else if to.exists() {
        Err("exists".into())
    } else {
        fs::copy(from, to).map(|_| ()).map_err(io)
    }
}

/// 휴지통에서 그 경로로 지운 것 가운데 since 뒤의 가장 새것을 제자리로 꺼내요.
/// 윈도우 휴지통의 이름은 확장자를 숨긴 채 올 수 있어 원래 이름은 우리가 아는 것으로 써요.
fn restore(paths: &[String], since: i64) -> Result<usize, String> {
    let items = trash::os_limited::list().map_err(|e| format!("trash:{e}"))?;
    let mut pick: Vec<trash::TrashItem> = Vec::new();
    for p in paths {
        let want = Path::new(p);
        let (Some(parent), Some(name)) = (want.parent(), want.file_name()) else { continue };
        let name = name.to_string_lossy().to_lowercase();
        let stem = want.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let parent_l = parent.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase();
        let best = items
            .iter()
            .filter(|it| it.original_parent.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase() == parent_l)
            .filter(|it| {
                let n = it.name.to_string_lossy().to_lowercase();
                n == name || n == stem
            })
            // 리눅스 휴지통은 지운 때를 못 읽으면 음수예요
            .filter(|it| it.time_deleted < 0 || it.time_deleted >= since - 10)
            .max_by_key(|it| it.time_deleted);
        if let Some(it) = best {
            pick.push(trash::TrashItem { id: it.id.clone(), name: want.file_name().unwrap().to_os_string(), original_parent: parent.to_path_buf(), time_deleted: it.time_deleted });
        }
    }
    let n = pick.len();
    if n == 0 {
        return Err("not_in_trash".into());
    }
    trash::os_limited::restore_all(pick).map_err(|e| match e {
        trash::Error::RestoreCollision { .. } => "exists".to_string(),
        e => format!("trash:{e}"),
    })?;
    Ok(n)
}

fn copy_empty_dirs(src: &Path, dst: &Path) {
    let _ = fs::create_dir_all(dst);
    if let Ok(it) = fs::read_dir(src) {
        for e in it.flatten() {
            if e.path().is_dir() {
                copy_empty_dirs(&e.path(), &dst.join(e.file_name()));
            }
        }
    }
}

/// 옮기고 남은 빈 폴더들을 지워요(파일이 남아 있으면 그 폴더는 두어요 – 건너뛴 파일).
fn remove_if_empty_tree(p: &Path) -> bool {
    if let Ok(it) = fs::read_dir(p) {
        let mut empty = true;
        for e in it.flatten() {
            let c = e.path();
            if c.is_dir() {
                if !remove_if_empty_tree(&c) {
                    empty = false;
                }
            } else {
                empty = false;
            }
        }
        if empty {
            return fs::remove_dir(p).is_ok();
        }
    }
    false
}

/// 지우기. permanent가 거짓이면 휴지통으로 보내요.
#[tauri::command]
pub async fn fs_delete(app: AppHandle, paths: Vec<String>, permanent: bool) -> Result<(), String> {
    let prot = crate::guard::protected(&app);
    for p in &paths {
        crate::guard::removable(p, &prot)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        if permanent {
            for p in &paths {
                let p = Path::new(p);
                if p.is_dir() {
                    fs::remove_dir_all(p).map_err(io)?;
                } else {
                    fs::remove_file(p).map_err(io)?;
                }
            }
            Ok(())
        } else {
            trash::delete_all(&paths).map_err(|e| format!("trash:{e}"))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 윈도우 기본 프로그램으로 열어요(폴더면 윈도우 탐색기).
/// 실행 파일(exe·bat 등, 그런 것을 가리키는 바로 가기 포함)은 화면이 "실행할까요?"를 받은 뒤 `run: true`로 다시 불러야 열어요
/// – 아니면 `need_confirm`(품질 보완 ② ✔1, 2026-10-29).
#[tauri::command]
pub fn fs_open(path: String, run: Option<bool>) -> Result<(), String> {
    let p = crate::guard::plain(&path)?;
    if !run.unwrap_or(false) && runs_program(&p) {
        return Err(crate::guard::NEED_CONFIRM.into());
    }
    #[cfg(windows)]
    {
        crate::files_win::shell_open(&path)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

/// 열면 프로그램이 도는지 – 실행 파일이거나 실행 파일을 가리키는 바로 가기
fn runs_program(p: &Path) -> bool {
    if crate::guard::is_exec(p) {
        return true;
    }
    let lnk = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk"));
    lnk && fs_lnk_target(p.to_string_lossy().into_owned()).is_some_and(|t| crate::guard::is_exec(Path::new(&t)))
}

/// 윈도우 탐색기로 열어요. select면 그 파일을 고른 채로 부모 폴더를 열어요.
#[tauri::command]
pub fn fs_explorer(path: String, select: bool) -> Result<(), String> {
    let p = crate::guard::plain(&path)?;
    // explorer에 실행 파일 경로를 그대로 주면 실행돼요 – 고른 채로 보이기만 해요
    if !select && !p.is_dir() && runs_program(&p) {
        return Err(crate::guard::DENIED.into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("explorer.exe");
        if select {
            // explorer는 따옴표를 붙인 "/select,경로"를 한 덩어리로 받아야 해요.
            c.raw_arg(format!("/select,\"{path}\""));
        } else {
            c.arg(&path);
        }
        c.spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let target = if select { Path::new(&path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or(path) } else { path };
        std::process::Command::new("xdg-open").arg(&target).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

/// 윈도우 탐색기 "홈"의 항목(즐겨찾기 폴더·최근 파일). group "fav"(폴더) · "recent"(파일), name은 윈도우가 보여 주는 이름.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuickItem {
    #[serde(flatten)]
    pub entry: Entry,
    pub group: String,
}

#[tauri::command]
pub async fn fs_quick() -> Vec<QuickItem> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            crate::files_win::quick_items()
                .into_iter()
                .filter_map(|(name, path)| {
                    let mut entry = entry_of(Path::new(&path))?;
                    entry.name = name;
                    let group = if entry.dir { "fav" } else { "recent" }.to_string();
                    Some(QuickItem { entry, group })
                })
                .collect()
        })
        .await
        .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// 파일 형식 이름(윈도우 탐색기 "유형" 열과 같은 글). 키 ".xlsx"·"<dir>". 윈도우가 아니면 비어 있어요(화면이 "XLSX 파일"로 채워요).
#[tauri::command]
pub async fn fs_types(keys: Vec<String>) -> HashMap<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || crate::files_win::types(&keys)).await.unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        let _ = keys;
        HashMap::new()
    }
}

/// 윈도우 탐색기로 넘기기(보안 해제): dir을 열어 names를 골라 두고, popup이면 그 파일의 우클릭 메뉴를 띄워요.
#[tauri::command]
pub fn fs_reveal(dir: String, names: Vec<String>, popup: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::files_win::reveal(&dir, &names, popup)
    }
    #[cfg(not(windows))]
    {
        let _ = (names, popup);
        std::process::Command::new("xdg-open").arg(&dir).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

/// 윈도우 아이콘(PNG 데이터 주소). 폴더는 "<dir>", 그 밖에는 확장자(".pptx")나 경로(.exe·.lnk·.ico).
#[tauri::command]
pub async fn fs_icons(keys: Vec<String>, size: u32) -> HashMap<String, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || crate::files_win::icons(&keys, size)).await.unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        let _ = (keys, size);
        HashMap::new()
    }
}

/// 윈도우 우클릭 메뉴를 그 자리에 띄워요(x, y는 화면 안 CSS 픽셀). paths가 비면 그 폴더 빈 곳 메뉴예요.
/// 메뉴가 닫힐 때까지 기다려요. 돌려주는 값: "" 안 고름 · "done" 실행함 · "rename" 화면이 이름 바꾸기를 시작해요.
/// names는 dir 안의 이름들이에요(한 폴더 것만).
#[tauri::command]
pub fn fs_context_menu(window: tauri::WebviewWindow, dir: String, names: Vec<String>, x: f64, y: f64, extra: Option<Vec<MenuExtra>>) -> Result<String, String> {
    let extra = extra.unwrap_or_default();
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let origin = window.inner_position().map(|p| (p.x, p.y)).unwrap_or((0, 0));
        let scale = window.scale_factor().unwrap_or(1.0);
        crate::files_win::context_menu(hwnd.0 as isize, origin, scale, &dir, &names, x, y, &extra)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, dir, names, x, y, extra);
        Err("windows_only".into())
    }
}

/// 우클릭 메뉴에 기록이 더하는 줄(label "-"는 구분선, items가 있으면 아래 메뉴)
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct MenuExtra {
    pub id: String,
    pub label: String,
    pub checked: bool,
    pub items: Vec<MenuExtra>,
}

/// 기록에서 윈도우 탐색기·바탕 화면으로 끌어 내기 – 줄을 끌기 시작하면 화면이 불러요(놓을 때까지 기다려요)
#[tauri::command]
pub fn fs_start_drag(window: tauri::WebviewWindow, paths: Vec<String>) -> Result<String, String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        crate::files_win::start_drag(hwnd.0 as isize, &paths)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, paths);
        Err("windows_only".into())
    }
}

/// Alt+Enter 속성 창
#[tauri::command]
pub fn fs_properties(paths: Vec<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::files_win::properties(&paths)
    }
    #[cfg(not(windows))]
    {
        let _ = paths;
        Err("windows_only".into())
    }
}

/// 바로가기(.lnk)가 가리키는 곳 – 없거나 못 읽으면 None
#[tauri::command]
pub fn fs_lnk_target(path: String) -> Option<String> {
    #[cfg(windows)]
    {
        crate::files_win::lnk_target(&path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        None
    }
}

/// 지금 누르고 있는 Ctrl·Shift·Alt(기록 창 안에 놓을 때)
#[tauri::command]
pub fn fs_mods() -> (bool, bool, bool) {
    #[cfg(windows)]
    {
        crate::files_win::modifiers()
    }
    #[cfg(not(windows))]
    {
        (false, false, false)
    }
}

/// Alt 누른 채 놓기: dest에 "이름 - 바로 가기.lnk"를 만들어요. 만든 경로들을 돌려줘요.
#[tauri::command]
pub fn fs_make_links(app: AppHandle, paths: Vec<String>, dest: String) -> Result<Vec<String>, String> {
    crate::guard::writable(&dest, &crate::guard::protected(&app))?;
    for p in &paths {
        crate::guard::plain(p)?;
    }
    let mut out = Vec::new();
    for p in &paths {
        let src = Path::new(p);
        let stem = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.trim_end_matches(['\\', ':']).to_string());
        let mut at = Path::new(&dest).join(format!("{stem} - 바로 가기.lnk"));
        let mut n = 2;
        while at.exists() {
            at = Path::new(&dest).join(format!("{stem} - 바로 가기 ({n}).lnk"));
            n += 1;
        }
        #[cfg(windows)]
        crate::files_win::make_link(p, &at.to_string_lossy())?;
        #[cfg(not(windows))]
        return Err("windows_only".into());
        #[allow(unreachable_code)]
        out.push(at.to_string_lossy().into_owned());
    }
    Ok(out)
}

/// 주소 칸에 적은 것 → 실제 경로와 폴더인지. %USERPROFILE% 같은 환경 변수와 shell:downloads 같은 이름도 풀어요.
#[tauri::command]
pub fn fs_resolve(input: String) -> Option<(String, bool)> {
    let p = expand_env(input.trim());
    let p = if p.to_lowercase().starts_with("shell:") {
        #[cfg(windows)]
        {
            crate::files_win::shell_path(&p)?
        }
        #[cfg(not(windows))]
        {
            return None;
        }
    } else {
        p
    };
    let path = Path::new(&p);
    if path.exists() {
        return Some((p.clone(), path.is_dir()));
    }
    // zip 안 경로
    let (z, inner) = zip_split(path)?;
    if zip_has_dir(&z, &inner) {
        return Some((p.clone(), true));
    }
    let pre = inner.clone();
    let mut a = zip_open(&z).ok()?;
    (0..a.len()).any(|i| a.by_index_raw(i).is_ok_and(|f| zip_name(f.name_raw()) == pre)).then(|| (p.clone(), false))
}

/// %이름% 을 환경 변수 값으로(없는 이름은 그대로)
pub(crate) fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) if j > 0 => {
                let name = &after[..j];
                match std::env::var(name) {
                    Ok(v) => out.push_str(&v),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[j + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

// ---------- 찾기 ----------

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FindSpec {
    /// 이름 조건: "*.jpg;*.png", "봉일천리" (*·? 없으면 들어 있는지)
    pub name: String,
    /// 안의 글자
    pub text: String,
    pub roots: Vec<String>,
    pub sub: bool,
    /// 수정한 날 범위(밀리초, 0이면 없음). to는 그날 끝까지 화면이 맞춰 보내요.
    pub from: i64,
    pub to: i64,
    /// 크기 범위(바이트, 0이면 없음)
    pub min_size: u64,
    pub max_size: u64,
    pub locked_only: bool,
    /// 민원처리 이름 규칙(접수일6자리_위치_보수내용)
    pub complaints_only: bool,
    pub show_hidden: bool,
    /// 설정에서 빠른 찾기를 껐으면 도우미를 쓰지 않아요
    pub no_fast: bool,
}

/// 찾은 파일 하나(폴더 이름 포함)
#[derive(Serialize, Clone, Debug)]
pub struct Found {
    #[serde(flatten)]
    pub entry: Entry,
    pub folder: String,
}

const FIND_LIMIT: usize = 5000;

#[tauri::command]
pub async fn fs_find(app: AppHandle, spec: FindSpec) -> Result<Vec<Found>, String> {
    CANCEL.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let tell = |n: usize, dir: &str| {
            let _ = app.emit("fs-find-progress", serde_json::json!({ "found": n, "dir": dir }));
        };
        // 빠른 찾기 도우미가 있으면 그것으로(모든 드라이브·바로), 없거나 그 드라이브 목록이 아직이면 폴더를 차례로 뒤져요
        let r = match find_fast(&spec, &fast_ask, &tell) {
            Some(r) => r,
            None => find(&spec, &tell),
        };
        // 찾은 파일의 사진 미리 보기(✔4)
        crate::guard::allow_preview_files(&app, r.iter().map(|f| f.entry.path.as_str()));
        Ok(r)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- 빠른 찾기(도우미 gilog-search, 2026-10-20 사용자 2안) ----------

/// 빠른 찾기 상태(설정 줄·찾기 칸이 봐요)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct FastStatus {
    pub installed: bool,
    pub running: bool,
    pub drives: Vec<FastDrive>,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FastDrive {
    pub drive: String,
    pub count: usize,
    pub ready: bool,
}

#[derive(Deserialize)]
struct FastHit {
    p: String,
    d: bool,
}

/// 도우미에 한 줄 묻고 한 줄 받기(이름 통로 \\.\pipe\gilog-search). 도우미가 없으면 None.
#[cfg(windows)]
fn fast_ask(req: &serde_json::Value) -> Option<serde_json::Value> {
    use std::io::Write;
    let mut pipe = None;
    for _ in 0..20 {
        match fs::OpenOptions::new().read(true).write(true).open(r"\\.\pipe\gilog-search") {
            Ok(f) => {
                pipe = Some(f);
                break;
            }
            // ERROR_PIPE_BUSY(다른 물음에 답하는 중)·ERROR_FILE_NOT_FOUND(통로를 바꿔 끼우는 틈) – 잠깐 뒤 다시
            Err(e) if matches!(e.raw_os_error(), Some(231) | Some(2)) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(_) => return None,
        }
    }
    let mut f = pipe?;
    let mut line = serde_json::to_vec(req).ok()?;
    line.push(b'\n');
    f.write_all(&line).ok()?;
    let mut out = Vec::new();
    let mut buf = [0u8; 1 << 16];
    loop {
        match f.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                out.extend_from_slice(&buf[..n]);
                if out.ends_with(b"\n") {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    serde_json::from_slice(&out).ok()
}

#[cfg(not(windows))]
fn fast_ask(_req: &serde_json::Value) -> Option<serde_json::Value> {
    None
}

/// 도우미 서비스가 등록돼 있는지(멈춰 있어도)
#[cfg(windows)]
fn fast_installed() -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("sc.exe")
        .args(["query", "GilogSearch"])
        .creation_flags(0x0800_0000)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn fast_installed() -> bool {
    false
}

fn fast_status_with(ask: &dyn Fn(&serde_json::Value) -> Option<serde_json::Value>) -> FastStatus {
    if let Some(v) = ask(&serde_json::json!({ "op": "status" })) {
        let drives: Vec<FastDrive> = serde_json::from_value(v["drives"].clone()).unwrap_or_default();
        return FastStatus { installed: true, running: true, drives };
    }
    FastStatus { installed: fast_installed(), running: false, drives: vec![] }
}

#[tauri::command]
pub async fn fs_fast_status() -> FastStatus {
    tauri::async_runtime::spawn_blocking(|| fast_status_with(&fast_ask)).await.unwrap_or_default()
}

/// 설정 → 탐색기 [설치]: 설치 폴더의 도우미를 관리자로 install(관리자 허용을 물어요)
#[tauri::command]
pub async fn fs_fast_setup(app: AppHandle, op: String) -> Result<(), String> {
    if op != "install" {
        return Err("bad_op".into());
    }
    let exe = app.path().resource_dir().map_err(|e| e.to_string())?.join("gilog-search.exe");
    if !exe.exists() {
        return Err("no_helper".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            match crate::files_win::run_elevated(&exe, "install")? {
                0 => Ok(()),
                c => Err(format!("install_failed:{c}")),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = exe;
            Err("windows_only".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 빠른 찾기 도우미가 목록에서 빼는 곳 – 도우미(fastfind/src/index.rs `is_skipped_path`)와 같은 규칙
fn fast_skipped_path(path: &str) -> bool {
    const SKIP_TOP: [&str; 9] = ["windows", "windows.old", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information", "recovery", "perflogs"];
    let p = path.replace('/', "\\").to_lowercase();
    let parts: Vec<&str> = p.split('\\').filter(|x| !x.is_empty()).collect();
    (parts.len() >= 2 && SKIP_TOP.contains(&parts[1])) || (parts.len() >= 4 && parts[1] == "users" && parts[3] == "appdata")
}

/// 경로의 드라이브("C:")
fn drive_of(p: &str) -> Option<String> {
    let b = p.as_bytes();
    (b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic()).then(|| p[..2].to_ascii_uppercase())
}

/// 도우미로 찾기. 쓸 수 없으면 None(폴더를 차례로 뒤지는 찾기로).
/// 이름은 도우미가 거르고, 수정한 날·크기·잠김·민원·안의 글자는 여기서 파일을 열어 걸러요.
pub(crate) fn find_fast(spec: &FindSpec, ask: &dyn Fn(&serde_json::Value) -> Option<serde_json::Value>, tell: &dyn Fn(usize, &str)) -> Option<Vec<Found>> {
    // 어디서만 있고 이름이 비면(그 폴더 아래 모두) 예전처럼 뒤지는 쪽이 알맞아요
    if spec.no_fast || (!spec.roots.is_empty() && spec.name.trim().is_empty()) {
        return None;
    }
    let st = fast_status_with(ask);
    if !st.running {
        return None;
    }
    let ready: HashSet<String> = st.drives.iter().filter(|d| d.ready).map(|d| d.drive.to_ascii_uppercase()).collect();
    if ready.is_empty() {
        return None;
    }
    // 어디서가 도우미 목록에서 뺀 폴더(Windows·Program Files·AppData 등) 아래면 뒤지는 찾기로
    if spec.roots.iter().any(|r| fast_skipped_path(r)) {
        return None;
    }
    // 어디서가 목록이 없는 드라이브(네트워크·USB 등)면 뒤지는 찾기로
    if spec.roots.iter().any(|r| drive_of(r).map(|d| !ready.contains(&d)).unwrap_or(true)) {
        return None;
    }
    let files_only = !spec.text.trim().is_empty() || spec.locked_only || spec.complaints_only || spec.min_size > 0 || spec.max_size > 0;
    let v = ask(&serde_json::json!({
        "op": "find",
        "name": spec.name,
        "roots": spec.roots,
        "sub": spec.sub,
        "hidden": spec.show_hidden,
        "dirs": !files_only,
        "limit": 50_000,
    }))?;
    let hits: Vec<FastHit> = serde_json::from_value(v.get("hits")?.clone()).ok()?;
    let needle = spec.text.trim().to_lowercase();
    let all = spec.roots.is_empty();
    // 결과가 많으면 잠김 표시(파일 머리 읽기)는 건너뛰어요 – 치는 대로 찾기가 늦어지지 않게
    let check_lock = spec.locked_only || hits.len() <= 2000;
    let mut out = Vec::new();
    for (i, h) in hits.iter().enumerate() {
        if CANCEL.load(Ordering::SeqCst) || out.len() >= FIND_LIMIT {
            break;
        }
        if i % 500 == 0 && i > 0 {
            tell(out.len(), &h.p);
        }
        let path = Path::new(&h.p);
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if spec.complaints_only && !is_complaint_name(&name) {
            continue;
        }
        let Ok(meta) = fs::metadata(path) else { continue }; // 지워졌거나 볼 권한이 없는 곳
        let dir = meta.is_dir();
        if dir != h.d && files_only {
            continue;
        }
        let e = Entry {
            hidden: is_hidden(path, &meta),
            locked: !dir && check_lock && looks_locked(path),
            name,
            path: h.p.clone(),
            dir,
            size: if dir { 0 } else { meta.len() },
            modified: ms(meta.modified()),
            created: ms(meta.created()),
        };
        if (spec.from > 0 && e.modified < spec.from)
            || (spec.to > 0 && e.modified > spec.to)
            || (spec.min_size > 0 && e.size < spec.min_size)
            || (spec.max_size > 0 && e.size > spec.max_size)
            || (spec.locked_only && !e.locked)
        {
            continue;
        }
        if !needle.is_empty() && !crate::files_text::contains(path, &needle) {
            continue;
        }
        let parent = path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        // 모든 드라이브에서 찾으면 폴더 칸은 전체 경로(어느 드라이브인지 보이게), 아니면 폴더 이름
        let folder = if all { parent } else { Path::new(&parent).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or(parent) };
        out.push(Found { entry: e, folder });
    }
    Some(out)
}

/// 이름 조건 하나가 맞는지: *·?가 있으면 와일드카드(대소문자 무시), 없으면 들어 있는지.
pub(crate) fn name_matches(pattern: &str, name: &str) -> bool {
    let pats: Vec<&str> = pattern.split(';').map(str::trim).filter(|p| !p.is_empty()).collect();
    if pats.is_empty() {
        return true;
    }
    let n = name.to_lowercase();
    pats.iter().any(|p| {
        let p = p.to_lowercase();
        if p.contains('*') || p.contains('?') {
            glob(&p, &n)
        } else {
            n.contains(&p)
        }
    })
}

fn glob(p: &str, s: &str) -> bool {
    let p: Vec<char> = p.chars().collect();
    let s: Vec<char> = s.chars().collect();
    let (mut i, mut j, mut star, mut mark) = (0usize, 0usize, None::<usize>, 0usize);
    while j < s.len() {
        if i < p.len() && (p[i] == '?' || p[i] == s[j]) {
            i += 1;
            j += 1;
        } else if i < p.len() && p[i] == '*' {
            star = Some(i);
            mark = j;
            i += 1;
        } else if let Some(st) = star {
            i = st + 1;
            mark += 1;
            j = mark;
        } else {
            return false;
        }
    }
    while i < p.len() && p[i] == '*' {
        i += 1;
    }
    i == p.len()
}

/// 민원처리 파일 이름 규칙: 6자리 숫자_위치_보수내용(그 뒤 _사진1 등)
pub(crate) fn is_complaint_name(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() > 8 && b[..6].iter().all(u8::is_ascii_digit) && b[6] == b'_' && name[7..].contains('_')
}

pub(crate) fn find(spec: &FindSpec, tell: &dyn Fn(usize, &str)) -> Vec<Found> {
    let mut out = Vec::new();
    let needle = spec.text.trim().to_lowercase();
    let mut stack: Vec<PathBuf> = spec.roots.iter().map(PathBuf::from).collect();
    let mut seen_dirs = 0usize;
    while let Some(dir) = stack.pop() {
        if CANCEL.load(Ordering::SeqCst) || out.len() >= FIND_LIMIT {
            break;
        }
        seen_dirs += 1;
        if seen_dirs % 50 == 0 {
            tell(out.len(), &dir.to_string_lossy());
        }
        let Ok(items) = list(&dir, spec.show_hidden) else { continue };
        for e in items {
            if e.dir {
                if spec.sub {
                    stack.push(PathBuf::from(&e.path));
                }
                continue;
            }
            if !name_matches(&spec.name, &e.name)
                || (spec.from > 0 && e.modified < spec.from)
                || (spec.to > 0 && e.modified > spec.to)
                || (spec.min_size > 0 && e.size < spec.min_size)
                || (spec.max_size > 0 && e.size > spec.max_size)
                || (spec.locked_only && !e.locked)
                || (spec.complaints_only && !is_complaint_name(&e.name))
            {
                continue;
            }
            if !needle.is_empty() && !crate::files_text::contains(Path::new(&e.path), &needle) {
                continue;
            }
            let folder = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| dir.to_string_lossy().into_owned());
            out.push(Found { entry: e, folder });
            if out.len() >= FIND_LIMIT {
                break;
            }
        }
    }
    out
}

// ---------- 폴더 감시 ----------

/// 지금 창들이 보고 있는 폴더를 지켜보다 바뀌면 "fs-changed"(그 폴더 경로)를 보내요.
#[derive(Default)]
pub struct Watch(pub Mutex<Option<notify::RecommendedWatcher>>);

#[tauri::command]
pub fn fs_watch(app: AppHandle, state: tauri::State<Watch>, dirs: Vec<String>) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    let handle = app.clone();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let mut sent = HashSet::new();
            for p in ev.paths {
                if let Some(parent) = p.parent() {
                    let d = parent.to_string_lossy().into_owned();
                    if sent.insert(d.clone()) {
                        let _ = handle.emit("fs-changed", d);
                    }
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    for d in dirs.iter().collect::<HashSet<_>>() {
        let _ = w.watch(Path::new(d), RecursiveMode::NonRecursive);
    }
    *state.0.lock().unwrap() = Some(w);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gilog-files-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn unique_numbers() {
        let d = tmp("uniq");
        fs::write(d.join("사진1.jpg"), "a").unwrap();
        assert_eq!(unique_path(&d.join("사진1.jpg")), d.join("사진1 (2).jpg"));
        fs::write(d.join("사진1 (2).jpg"), "a").unwrap();
        assert_eq!(unique_path(&d.join("사진1.jpg")), d.join("사진1 (3).jpg"));
        assert_eq!(unique_path(&d.join("사진1 (2).jpg")), d.join("사진1 (3).jpg"));
        assert_eq!(unique_path(&d.join("없음.txt")), d.join("없음.txt"));
        fs::create_dir(d.join("폴더")).unwrap();
        assert_eq!(unique_path(&d.join("폴더")), d.join("폴더 (2)"));
    }

    #[test]
    fn copy_with_decisions_and_merge() {
        let d = tmp("copy");
        let a = d.join("a");
        let b = d.join("b");
        fs::create_dir_all(a.join("사진")).unwrap();
        fs::create_dir_all(b.join("사진")).unwrap();
        fs::write(a.join("사진/1.jpg"), "new1").unwrap();
        fs::write(a.join("사진/2.jpg"), "new2").unwrap();
        fs::write(a.join("사진/3.jpg"), "new3").unwrap();
        fs::write(a.join("x.txt"), "x").unwrap();
        fs::write(b.join("사진/1.jpg"), "old1").unwrap();
        fs::write(b.join("사진/2.jpg"), "old2").unwrap();
        let srcs = vec![a.join("사진"), a.join("x.txt")];
        let cs = conflicts(&srcs, &b);
        assert_eq!(cs.len(), 2);
        let mut dec = HashMap::new();
        dec.insert(b.join("사진/1.jpg").to_string_lossy().into_owned(), "over".to_string());
        dec.insert(b.join("사진/2.jpg").to_string_lossy().into_owned(), "both".to_string());
        let s = transfer(false, &srcs, &b, &dec, &|_, _, _| {}).unwrap();
        assert_eq!(s.done, 4);
        assert_eq!(fs::read_to_string(b.join("사진/1.jpg")).unwrap(), "new1");
        assert_eq!(fs::read_to_string(b.join("사진/2.jpg")).unwrap(), "old2");
        assert_eq!(fs::read_to_string(b.join("사진/2 (2).jpg")).unwrap(), "new2");
        assert_eq!(fs::read_to_string(b.join("사진/3.jpg")).unwrap(), "new3");
        assert!(a.join("x.txt").exists());
    }

    #[test]
    fn copy_into_same_folder_keeps_both() {
        let d = tmp("same");
        fs::write(d.join("f.txt"), "1").unwrap();
        let s = transfer(false, &[d.join("f.txt")], &d, &HashMap::new(), &|_, _, _| {}).unwrap();
        assert_eq!(s.done, 1);
        assert!(d.join("f - 복사본.txt").exists());
        let s = transfer(false, &[d.join("f.txt")], &d, &HashMap::new(), &|_, _, _| {}).unwrap();
        assert_eq!(s.done, 1);
        assert!(d.join("f - 복사본 (2).txt").exists());
        // 폴더도 통째로 "폴더 - 복사본"
        fs::create_dir_all(d.join("사진.2026")).unwrap();
        fs::write(d.join("사진.2026/a.jpg"), "a").unwrap();
        assert!(conflicts(&[d.join("사진.2026")], &d).is_empty());
        transfer(false, &[d.join("사진.2026")], &d, &HashMap::new(), &|_, _, _| {}).unwrap();
        assert!(d.join("사진.2026 - 복사본/a.jpg").exists());
    }

    #[test]
    fn transfer_pairs_undo_and_redo() {
        let d = tmp("undo");
        let (a, b) = (d.join("a"), d.join("b"));
        fs::create_dir_all(a.join("현장/사진")).unwrap();
        fs::write(a.join("현장/사진/1.jpg"), "1").unwrap();
        fs::write(a.join("메모.txt"), "m").unwrap();
        fs::create_dir_all(b.join("현장")).unwrap(); // 대상에 같은 이름 폴더가 이미 있음 → 합치기
        fs::write(b.join("현장/있던.txt"), "x").unwrap();
        fs::write(b.join("메모.txt"), "old").unwrap();
        let mut dec = HashMap::new();
        dec.insert(b.join("메모.txt").to_string_lossy().into_owned(), "both".to_string());
        // 복사: 새로 생긴 것만 짝으로(합친 폴더는 파일 단위, "메모 (2).txt")
        let s = transfer(false, &[a.join("현장"), a.join("메모.txt")], &b, &dec, &|_, _, _| {}).unwrap();
        let got: HashSet<String> = s.pairs.iter().map(|(_, t)| t.clone()).collect();
        assert!(got.contains(&b.join("현장/사진/1.jpg").to_string_lossy().into_owned()), "{got:?}");
        assert!(got.contains(&b.join("메모 (2).txt").to_string_lossy().into_owned()), "{got:?}");
        assert!(!got.contains(&b.join("현장").to_string_lossy().into_owned()));
        // 덮어쓰기는 짝에서 빠져요
        let mut over = HashMap::new();
        over.insert(b.join("메모.txt").to_string_lossy().into_owned(), "over".to_string());
        let s2 = transfer(false, &[a.join("메모.txt")], &b, &over, &|_, _, _| {}).unwrap();
        assert_eq!((s2.overwritten, s2.pairs.len()), (1, 0));
        // 새 폴더로 통째로 옮기기 → 짝은 폴더 하나, 되돌리면 제자리, 다시 하면 또 옮김
        let c = d.join("c");
        fs::create_dir_all(&c).unwrap();
        let s3 = transfer(true, &[a.join("현장")], &c, &HashMap::new(), &|_, _, _| {}).unwrap();
        assert_eq!(s3.pairs, vec![(a.join("현장").to_string_lossy().into_owned(), c.join("현장").to_string_lossy().into_owned())]);
        let back: Vec<Step> = s3.pairs.iter().rev().map(|(f, t)| Step::Move { from: t.clone(), to: f.clone() }).collect();
        assert_eq!(run_steps(&back).errors.len(), 0);
        assert!(a.join("현장/사진/1.jpg").exists() && !c.join("현장").exists());
        let again: Vec<Step> = s3.pairs.iter().map(|(f, t)| Step::Move { from: f.clone(), to: t.clone() }).collect();
        assert_eq!(run_steps(&again).done, 1);
        assert!(c.join("현장/사진/1.jpg").exists());
        // 되돌리는 자리에 같은 이름이 생겼으면 건너뛰고 알려요
        fs::write(a.join("새것.txt"), "n").unwrap();
        fs::write(c.join("새것.txt"), "c").unwrap();
        let r = run_steps(&[Step::Move { from: c.join("새것.txt").to_string_lossy().into_owned(), to: a.join("새것.txt").to_string_lossy().into_owned() }]);
        assert_eq!(r.errors[0].1, "exists");
        // 복사 다시 하기·새 폴더
        let r = run_steps(&[
            Step::Copy { from: c.join("현장").to_string_lossy().into_owned(), to: d.join("e/현장").to_string_lossy().into_owned() },
            Step::Mkdir { path: d.join("새 폴더").to_string_lossy().into_owned() },
        ]);
        assert_eq!(r.done, 2);
        assert!(d.join("e/현장/사진/1.jpg").exists() && d.join("새 폴더").is_dir());
    }

    #[test]
    fn merge_folders_by_rename() {
        let d = tmp("merge");
        fs::create_dir_all(d.join("가/속")).unwrap();
        fs::write(d.join("가/속/1.txt"), "1").unwrap();
        fs::write(d.join("가/겹침.txt"), "new").unwrap();
        fs::create_dir_all(d.join("나/속")).unwrap();
        fs::write(d.join("나/겹침.txt"), "old").unwrap();
        let r = run_steps(&[Step::Move { from: d.join("가").to_string_lossy().into_owned(), to: d.join("나").to_string_lossy().into_owned() }]);
        assert_eq!(r.errors.len(), 1); // 겹친 파일만 남아요
        assert!(d.join("나/속/1.txt").exists());
        assert_eq!(fs::read_to_string(d.join("나/겹침.txt")).unwrap(), "old");
        assert!(d.join("가/겹침.txt").exists() && !d.join("가/속").exists());
    }

    #[test]
    fn zip_as_folder() {
        let d = tmp("zipdir");
        let zp = d.join("자료.zip");
        {
            let f = fs::File::create(&zp).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("공문.hwp", o).unwrap();
            std::io::Write::write_all(&mut z, b"hwp").unwrap();
            z.add_directory("사진/", o).unwrap();
            z.start_file("사진/1.jpg", o).unwrap();
            std::io::Write::write_all(&mut z, b"jpg1").unwrap();
            z.start_file("사진/깊이/2.jpg", o).unwrap();
            std::io::Write::write_all(&mut z, b"jpg2").unwrap();
            z.finish().unwrap();
        }
        let top = list(&zp, false).unwrap();
        let mut names: Vec<(String, bool)> = top.iter().map(|e| (e.name.clone(), e.dir)).collect();
        names.sort();
        assert_eq!(names, vec![("공문.hwp".into(), false), ("사진".into(), true)]);
        let pics = list(&zp.join("사진"), false).unwrap();
        assert_eq!(pics.len(), 2);
        assert!(fs_is_dir(zp.join("사진").to_string_lossy().into_owned()));
        assert!(!fs_is_dir(zp.join("공문.hwp").to_string_lossy().into_owned()));
        assert_eq!(fs_resolve(zp.join("공문.hwp").to_string_lossy().into_owned()).map(|x| x.1), Some(false));
        let out = zip_extract(&[zp.join("사진").to_string_lossy().into_owned(), zp.join("공문.hwp").to_string_lossy().into_owned()], &d.join("tmp")).unwrap();
        assert_eq!(fs::read(Path::new(&out[0]).join("깊이").join("2.jpg")).unwrap(), b"jpg2");
        assert_eq!(fs::read(&out[1]).unwrap(), b"hwp");
        assert!(zip_ms(Some(zip::DateTime::from_date_and_time(2026, 10, 20, 9, 30, 0).unwrap())) == 1_792_488_600_000);
    }

    #[test]
    fn reserved_and_env() {
        assert!(reserved_name("CON") && reserved_name("nul.txt") && reserved_name("com3.hwp") && reserved_name("LPT9"));
        assert!(!reserved_name("CONTACT") && !reserved_name("COM10") && !reserved_name("공문.hwp") && !reserved_name("com0"));
        assert_eq!(check_name("aux.txt").unwrap_err(), "reserved_name");
        std::env::set_var("GILOG_T", "C:\\Users\\hun");
        assert_eq!(expand_env("%GILOG_T%\\Downloads"), "C:\\Users\\hun\\Downloads");
        assert_eq!(expand_env("100% 끝 %없는이름%"), "100% 끝 %없는이름%");
    }

    /// 실제 휴지통을 써요 – `cargo test -- --ignored trash_and_restore`로만
    #[test]
    #[ignore]
    fn trash_and_restore() {
        let d = tmp("trash");
        fs::write(d.join("공문.hwp"), "x").unwrap();
        fs::create_dir_all(d.join("사진")).unwrap();
        let ps = vec![d.join("공문.hwp").to_string_lossy().into_owned(), d.join("사진").to_string_lossy().into_owned()];
        let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
        assert_eq!(run_steps(&[Step::Trash { paths: ps.clone() }]).done, 2);
        assert!(!d.join("공문.hwp").exists());
        let r = run_steps(&[Step::Restore { paths: ps, since }]);
        assert_eq!((r.done, r.errors.len()), (2, 0), "{:?}", r.errors);
        assert!(d.join("공문.hwp").exists() && d.join("사진").is_dir());
    }

    #[test]
    fn fast_find_filters_and_falls_back() {
        let d = tmp("fast");
        fs::create_dir_all(d.join("공사")).unwrap();
        fs::write(d.join("공사/261015_봉일천리_포트홀.pptx"), vec![0u8; 3000]).unwrap();
        fs::write(d.join("공사/포트홀 메모.txt"), "배수로 포트홀").unwrap();
        let root = d.to_string_lossy().into_owned();
        let hits = vec![
            serde_json::json!({ "p": d.join("공사").to_string_lossy(), "d": true }),
            serde_json::json!({ "p": d.join("공사/261015_봉일천리_포트홀.pptx").to_string_lossy(), "d": false }),
            serde_json::json!({ "p": d.join("공사/포트홀 메모.txt").to_string_lossy(), "d": false }),
            serde_json::json!({ "p": d.join("공사/지워진.txt").to_string_lossy(), "d": false }),
        ];
        let ask = move |q: &serde_json::Value| -> Option<serde_json::Value> {
            match q["op"].as_str()? {
                "status" => Some(serde_json::json!({ "version": "1", "drives": [{ "drive": "C:", "count": 4, "ready": true }] })),
                _ => Some(serde_json::json!({ "hits": hits, "more": false })),
            }
        };
        let base = FindSpec {
            name: "포트홀".into(),
            text: String::new(),
            roots: vec![],
            sub: true,
            from: 0,
            to: 0,
            min_size: 0,
            max_size: 0,
            locked_only: false,
            complaints_only: false,
            show_hidden: false,
            no_fast: false,
        };
        assert!(find_fast(&FindSpec { no_fast: true, ..base.clone() }, &ask, &|_, _| {}).is_none());
        let r = find_fast(&base, &ask, &|_, _| {}).unwrap();
        assert_eq!(r.len(), 3, "지워진 파일은 빠져요");
        assert_eq!(r[0].folder, root, "모든 드라이브면 폴더 칸은 전체 경로");
        // 조건은 여기서 걸러요
        let r = find_fast(&FindSpec { min_size: 2000, ..base.clone() }, &ask, &|_, _| {}).unwrap();
        assert_eq!(r.iter().map(|f| f.entry.name.as_str()).collect::<Vec<_>>(), vec!["261015_봉일천리_포트홀.pptx"]);
        let r = find_fast(&FindSpec { complaints_only: true, ..base.clone() }, &ask, &|_, _| {}).unwrap();
        assert_eq!(r.len(), 1);
        let r = find_fast(&FindSpec { text: "배수로".into(), ..base.clone() }, &ask, &|_, _| {}).unwrap();
        assert_eq!(r.iter().map(|f| f.entry.name.as_str()).collect::<Vec<_>>(), vec!["포트홀 메모.txt"]);
        // 목록 없는 드라이브·도우미 없음·이름 없이 폴더만이면 뒤지는 찾기로
        assert!(find_fast(&FindSpec { roots: vec!["Z:\\x".into()], ..base.clone() }, &ask, &|_, _| {}).is_none());
        assert!(find_fast(&FindSpec { roots: vec!["C:\\Windows".into()], ..base.clone() }, &ask, &|_, _| {}).is_none());
        assert!(find_fast(&FindSpec { roots: vec!["C:\\Users\\a\\AppData\\Local".into()], ..base.clone() }, &ask, &|_, _| {}).is_none());
        assert!(find_fast(&FindSpec { roots: vec!["C:\\x".into()], name: String::new(), ..base.clone() }, &ask, &|_, _| {}).is_none());
        assert!(find_fast(&base, &|_| None, &|_, _| {}).is_none());
        assert!(!fast_status_with(&|_| None).running);
    }

    #[test]
    fn drop_files_round_trip() {
        let ps = vec!["C:\\민원\\a.pptx".to_string(), "D:\\사진 1.jpg".to_string()];
        let b = drop_files_bytes(&ps);
        assert_eq!(&b[0..4], &20u32.to_le_bytes());
        assert_eq!(parse_drop_files(&b), ps);
        assert!(parse_drop_files(&drop_files_bytes(&[])).is_empty());
        assert!(parse_drop_files(&[1, 2]).is_empty());
    }

    #[test]
    fn move_whole_and_skip() {
        let d = tmp("move");
        let a = d.join("a");
        let b = d.join("b");
        fs::create_dir_all(a.join("빈폴더")).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("1.txt"), "1").unwrap();
        fs::write(a.join("2.txt"), "new").unwrap();
        fs::write(b.join("2.txt"), "old").unwrap();
        let s = transfer(true, &[a.join("1.txt"), a.join("2.txt"), a.join("빈폴더")], &b, &HashMap::new(), &|_, _, _| {}).unwrap();
        assert_eq!(s.skipped, 1);
        assert!(b.join("1.txt").exists() && !a.join("1.txt").exists());
        assert!(a.join("2.txt").exists());
        assert_eq!(fs::read_to_string(b.join("2.txt")).unwrap(), "old");
        assert!(b.join("빈폴더").is_dir());
        assert!(transfer(true, &[a.clone()], &a.join("빈폴더"), &HashMap::new(), &|_, _, _| {}).is_err());
    }

    #[test]
    fn rename_many_swap_and_undo_on_clash() {
        let d = tmp("ren");
        fs::write(d.join("a.txt"), "a").unwrap();
        fs::write(d.join("b.txt"), "b").unwrap();
        fs::write(d.join("c.txt"), "c").unwrap();
        let it = |p: &str, n: &str| RenameItem { path: d.join(p).to_string_lossy().into_owned(), name: n.into() };
        let back = rename_many(&[it("a.txt", "b.txt"), it("b.txt", "a.txt")]).unwrap();
        assert_eq!(fs::read_to_string(d.join("a.txt")).unwrap(), "b");
        assert_eq!(back.len(), 2);
        // c.txt로 바꾸려는 것은 이미 있어서 실패하고, 모두 원래대로예요.
        assert!(rename_many(&[it("a.txt", "x.txt"), it("b.txt", "c.txt")]).is_err());
        assert!(d.join("a.txt").exists() && d.join("b.txt").exists() && !d.join("x.txt").exists());
        assert!(rename_many(&[it("a.txt", "bad?.txt")]).is_err());
    }

    #[test]
    fn names_and_find() {
        assert!(name_matches("*.jpg;*.png", "사진1.JPG"));
        assert!(!name_matches("*.jpg", "사진1.jpeg"));
        assert!(name_matches("봉일천리", "261015_봉일천리 209-10_포트홀.pptx"));
        assert!(name_matches("2610??_*", "261015_a_b.jpg"));
        assert!(name_matches("", "아무거나"));
        assert!(is_complaint_name("261015_봉일천리 209-10_포트홀_사진1.jpg"));
        assert!(!is_complaint_name("민원 원문 목록.hwp"));
        let d = tmp("find");
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("261015_봉일천리_포트홀.jpg"), "x").unwrap();
        fs::write(d.join("sub/261016_연풍리_반사경.jpg"), "x").unwrap();
        fs::write(d.join("메모.txt"), "봉일천리 209-10 포트홀").unwrap();
        let spec = FindSpec { name: "*.jpg".into(), roots: vec![d.to_string_lossy().into_owned()], sub: true, ..Default::default() };
        assert_eq!(find(&spec, &|_, _| {}).len(), 2);
        let spec = FindSpec { roots: vec![d.to_string_lossy().into_owned()], sub: false, ..spec };
        assert_eq!(find(&spec, &|_, _| {}).len(), 1);
        let spec = FindSpec { name: String::new(), text: "209-10".into(), roots: vec![d.to_string_lossy().into_owned()], sub: true, ..Default::default() };
        let r = find(&spec, &|_, _| {});
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].entry.name, "메모.txt");
    }

    #[test]
    fn mkdir_and_bad_names() {
        let d = tmp("mk");
        let p = mkdir(d.to_string_lossy().into_owned(), "새 폴더".into()).unwrap();
        assert!(Path::new(&p).is_dir());
        assert_eq!(mkdir(d.to_string_lossy().into_owned(), "새 폴더".into()), Err("exists".into()));
        assert_eq!(mkdir(d.to_string_lossy().into_owned(), "a:b".into()), Err("bad_name".into()));
        let s = subdirs(&d, false).unwrap();
        assert_eq!(s.len(), 1);
        assert!(!s[0].has_children);
    }
}
