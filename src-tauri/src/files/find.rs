//! 찾기 – 이름·날짜·크기·글 내용(`fs_find`), 빠른 찾기 색인(fastfind) 상태·설치.

use std::collections::HashSet;
use std::fs;
#[cfg(windows)]
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::*;

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

pub(super) const FIND_LIMIT: usize = 5000;

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
        // 찾은 파일이 든 폴더의 사진을 미리 보기로 읽게 허용해요 – 처음엔 아무 곳도 허용하지 않아서(✔4)
        crate::guard::allow_preview_files(&app, r.iter().map(|f| f.entry.path.as_str()));
        Ok(r)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- 빠른 찾기 – 따로 설치한 도우미 gilog-search가 드라이브 색인으로 이름을 찾아요(2026-10-20 사용자 2안) ----------

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
pub(super) struct FastHit {
    p: String,
    d: bool,
}

/// 도우미에 한 줄 묻고 한 줄 받기(이름 통로 \\.\pipe\gilog-search). 도우미가 없으면 None.
#[cfg(windows)]
pub(super) fn fast_ask(req: &serde_json::Value) -> Option<serde_json::Value> {
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
pub(super) fn fast_ask(_req: &serde_json::Value) -> Option<serde_json::Value> {
    None
}

/// 도우미 서비스가 등록돼 있는지(멈춰 있어도)
#[cfg(windows)]
pub(super) fn fast_installed() -> bool {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("sc.exe")
        .args(["query", "GilogSearch"])
        .creation_flags(0x0800_0000)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
pub(super) fn fast_installed() -> bool {
    false
}

pub(super) fn fast_status_with(ask: &dyn Fn(&serde_json::Value) -> Option<serde_json::Value>) -> FastStatus {
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
pub(super) fn fast_skipped_path(path: &str) -> bool {
    const SKIP_TOP: [&str; 9] = ["windows", "windows.old", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information", "recovery", "perflogs"];
    let p = path.replace('/', "\\").to_lowercase();
    let parts: Vec<&str> = p.split('\\').filter(|x| !x.is_empty()).collect();
    (parts.len() >= 2 && SKIP_TOP.contains(&parts[1])) || (parts.len() >= 4 && parts[1] == "users" && parts[3] == "appdata")
}

/// 경로의 드라이브("C:")
pub(super) fn drive_of(p: &str) -> Option<String> {
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

pub(super) fn glob(p: &str, s: &str) -> bool {
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
