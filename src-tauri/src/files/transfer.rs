//! 같은 이름 미리 보기·클립보드·복사·옮기기(`fs_transfer`, 진행 "fs-progress", 취소 `fs_cancel`).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::*;

// ---------- 같은 이름 · 복사 · 옮기기 ----------

/// 겹치는 파일 하나: 복사할 파일과 이미 있는 파일
#[derive(Serialize, Clone, Debug)]
pub struct Conflict {
    pub src: Entry,
    pub dst: Entry,
}

/// 원본 하나를 대상 폴더 안의 어디로 보내는지(폴더는 안의 파일까지 펼쳐요). (원본 파일, 대상 파일)
pub(super) fn plan(sources: &[PathBuf], dest: &Path) -> Vec<(PathBuf, PathBuf)> {
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
pub(super) struct Progress {
    done: usize,
    total: usize,
    name: String,
}

pub(super) static CANCEL: AtomicBool = AtomicBool::new(false);

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
