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
pub async fn fs_list(path: String, show_hidden: bool) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || list(Path::new(&path), show_hidden)).await.map_err(|e| e.to_string())?
}

pub(crate) fn list(dir: &Path, show_hidden: bool) -> Result<Vec<Entry>, String> {
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
    Path::new(&path).is_dir()
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
    } else {
        Ok(())
    }
}

/// 새 폴더. 만든 경로를 돌려줘요.
#[tauri::command]
pub fn fs_mkdir(dir: String, name: String) -> Result<String, String> {
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
pub fn fs_rename(path: String, name: String) -> Result<String, String> {
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
pub fn fs_rename_many(items: Vec<RenameItem>) -> Result<Vec<RenameItem>, String> {
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
                sum.done += if s.is_dir() || to.is_dir() { work.iter().filter(|(a, _)| a.starts_with(s)).count().max(1) } else { 1 };
            }
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
        if target.exists() || src == dst {
            let key = dst.to_string_lossy().into_owned();
            match decisions.get(&key).map(String::as_str).unwrap_or(if src == dst { "both" } else { "skip" }) {
                "over" if src != dst => {}
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
            Ok(()) => sum.done += 1,
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
    Ok(sum)
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
pub async fn fs_delete(paths: Vec<String>, permanent: bool) -> Result<(), String> {
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
#[tauri::command]
pub fn fs_open(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::files_win::shell_open(&path)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
}

/// 윈도우 탐색기로 열어요. select면 그 파일을 고른 채로 부모 폴더를 열어요.
#[tauri::command]
pub fn fs_explorer(path: String, select: bool) -> Result<(), String> {
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
pub fn fs_context_menu(window: tauri::WebviewWindow, dir: String, names: Vec<String>, x: f64, y: f64) -> Result<String, String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let origin = window.inner_position().map(|p| (p.x, p.y)).unwrap_or((0, 0));
        let scale = window.scale_factor().unwrap_or(1.0);
        crate::files_win::context_menu(hwnd.0 as isize, origin, scale, &dir, &names, x, y)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, dir, names, x, y);
        Err("windows_only".into())
    }
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
        Ok(find(&spec, &tell))
    })
    .await
    .map_err(|e| e.to_string())?
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
        let p = fs_mkdir(d.to_string_lossy().into_owned(), "새 폴더".into()).unwrap();
        assert!(Path::new(&p).is_dir());
        assert_eq!(fs_mkdir(d.to_string_lossy().into_owned(), "새 폴더".into()), Err("exists".into()));
        assert_eq!(fs_mkdir(d.to_string_lossy().into_owned(), "a:b".into()), Err("bad_name".into()));
        let s = subdirs(&d, false).unwrap();
        assert_eq!(s.len(), 1);
        assert!(!s[0].has_children);
    }
}
