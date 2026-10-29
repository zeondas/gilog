//! 화면(웹뷰)이 보낸 경로를 지우기·옮기기·실행 전에 거르는 곳이에요(품질 보완 ②, 2026-10-29 `wip/guardrails`).
//!
//! 화면에 스크립트가 한 번이라도 끼어들면 곧바로 영구 삭제·프로그램 실행으로 이어지지 않게 두 번째 겹을 둬요.
//! 사용자가 탐색기에서 하는 보통 일(문서·사진 폴더 지우기·옮기기·열기)은 그대로 돼요.
//!
//! - `plain`: 빈 경로·NUL·`..`·장치 경로(`\\?\`·`\\.\`)를 막아요.
//! - `removable`: 지우기·옮기기·이름 바꾸기 원본. 드라이브 맨 위·네트워크 공유 맨 위·윈도우 폴더·프로그램 폴더·
//!   사용자 폴더 자체·앱 설정 폴더·자료 폴더(안쪽 포함)는 막아요.
//! - `writable`: 복사·옮기기·새 폴더 대상. 앱 설정 폴더·자료 폴더 안은 막아요.
//! - `is_exec`: 열면 프로그램이 도는 파일(exe·bat 등). `fs_open`은 화면이 "실행할까요?"를 받은 뒤에만 열어요.
//!
//! 막으면 오류 이름은 `path_denied`예요(실행 파일 확인이 필요하면 `need_confirm`).

use std::path::{Component, Path, PathBuf};

pub const DENIED: &str = "path_denied";
pub const NEED_CONFIRM: &str = "need_confirm";

/// 열면 프로그램이 도는 확장자(소문자, 점 없이)
const EXEC_EXT: [&str; 20] = [
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "scr", "pif", "hta", "cpl", "reg", "appref-ms",
];

/// 지우거나 옮기면 안 되는 윈도우 폴더(드라이브 바로 아래, 안쪽 포함)
const SYSTEM_TOP: [&str; 3] = ["windows", "program files", "program files (x86)"];

fn denied() -> String {
    DENIED.to_string()
}

/// 받은 경로의 첫 거르기: 빈 것·NUL·`..`·장치 경로
pub fn plain(p: &str) -> Result<PathBuf, String> {
    let t = p.trim();
    if t.is_empty() || t.contains('\0') {
        return Err(denied());
    }
    let slashed = t.replace('/', "\\");
    // \\?\·\\.\(장치·긴 경로 접두사)는 화면이 보낼 일이 없어요
    if slashed.starts_with("\\\\?\\") || slashed.starts_with("\\\\.\\") || slashed.starts_with("\\??\\") {
        return Err(denied());
    }
    let path = PathBuf::from(t);
    if path.components().any(|c| matches!(c, Component::ParentDir)) || slashed.split('\\').any(|c| c == "..") {
        return Err(denied());
    }
    Ok(path)
}

/// 비교용 모양: 정규화(있으면) → 윈도우 접두사 떼기 → `\` → 소문자 → 끝 `\` 떼기
pub fn key_of(p: &Path) -> String {
    let real = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    norm(&real.to_string_lossy())
}

fn norm(s: &str) -> String {
    let mut s = s.replace('/', "\\");
    if let Some(rest) = s.strip_prefix("\\\\?\\UNC\\") {
        s = format!("\\\\{rest}");
    } else if let Some(rest) = s.strip_prefix("\\\\?\\") {
        s = rest.to_string();
    }
    let mut s = s.to_lowercase();
    while s.len() > 1 && s.ends_with('\\') && !s.ends_with(":\\") {
        s.pop();
    }
    if s.ends_with(":\\") {
        s.pop();
    }
    s
}

/// 지키는 곳(앱 설정 폴더·자료 폴더) – 그 폴더와 안쪽 모두
#[derive(Clone, Debug, Default)]
pub struct Protected {
    keys: Vec<String>,
}

impl Protected {
    pub fn new(dirs: &[PathBuf]) -> Self {
        Protected { keys: dirs.iter().map(|d| key_of(d)).filter(|k| !k.is_empty()).collect() }
    }
    fn covers(&self, key: &str) -> bool {
        self.keys.iter().any(|k| key == k || key.starts_with(&format!("{k}\\")))
    }
}

/// 드라이브·공유 맨 위, 윈도우·프로그램 폴더, 사용자 폴더 자체인지
fn system_key(key: &str) -> bool {
    if key.is_empty() || key == "\\" {
        return true;
    }
    // 리눅스(작업 공간 시험) 맨 위·홈
    if key.starts_with('\\') && !key.starts_with("\\\\") {
        let parts: Vec<&str> = key.split('\\').filter(|x| !x.is_empty()).collect();
        return parts.is_empty() || (parts.len() <= 2 && parts[0] == "home") || (parts.len() == 1 && parts[0] == "root");
    }
    // \\서버\공유 맨 위
    if let Some(rest) = key.strip_prefix("\\\\") {
        return rest.split('\\').filter(|x| !x.is_empty()).count() <= 2;
    }
    let parts: Vec<&str> = key.split('\\').filter(|x| !x.is_empty()).collect();
    match parts.as_slice() {
        [] => true,
        [d] => d.ends_with(':'),
        [_, top, ..] if SYSTEM_TOP.contains(top) => true,
        // C:\Users, C:\Users\이름 자체(안쪽 문서·사진은 돼요)
        [_, "users"] | [_, "users", _] => true,
        _ => false,
    }
}

/// 지우기·옮기기·이름 바꾸기 원본
pub fn removable(p: &str, prot: &Protected) -> Result<PathBuf, String> {
    let path = plain(p)?;
    let key = key_of(&path);
    if system_key(&key) || prot.covers(&key) {
        return Err(denied());
    }
    Ok(path)
}

/// 복사·옮기기·새 폴더·바로 가기 대상
pub fn writable(p: &str, prot: &Protected) -> Result<PathBuf, String> {
    let path = plain(p)?;
    if prot.covers(&key_of(&path)) {
        return Err(denied());
    }
    Ok(path)
}

/// 열면 프로그램이 도는 파일인지(확장자로)
pub fn is_exec(p: &Path) -> bool {
    let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let name = name.trim_end_matches(['.', ' ']);
    EXEC_EXT.iter().any(|e| name.ends_with(&format!(".{e}")))
}

/// 사진 미리 보기(asset 주소)가 읽을 수 있게 그 폴더만 허용해요(✔4 ①1안 – 디스크 전체 허용 없앰).
/// 탐색기가 연 폴더·찾기 결과 폴더·민원처리 사진 폴더를 그때그때 넓혀요(하위 폴더는 넣지 않아요).
pub fn allow_preview_dir(app: &tauri::AppHandle, dir: &Path) {
    use tauri::Manager;
    if dir.as_os_str().is_empty() || plain(&dir.to_string_lossy()).is_err() {
        return;
    }
    let _ = app.asset_protocol_scope().allow_directory(dir, false);
}

/// 파일 경로들의 폴더를 허용(같은 폴더는 한 번)
pub fn allow_preview_files<'a>(app: &tauri::AppHandle, files: impl IntoIterator<Item = &'a str>) {
    let mut seen = std::collections::HashSet::new();
    for f in files {
        if let Some(d) = Path::new(f.trim()).parent() {
            if d.is_absolute() && seen.insert(d.to_path_buf()) {
                allow_preview_dir(app, d);
            }
        }
    }
}

/// 앱이 지키는 폴더 – 앱 설정 폴더(AppData)·자료 폴더(문서\giLog 또는 옮긴 곳)
pub fn protected(app: &tauri::AppHandle) -> Protected {
    let mut dirs = Vec::new();
    if let Ok(d) = crate::profile::config_dir(app) {
        dirs.push(d);
    }
    if let Ok(d) = crate::data_dir(app) {
        dirs.push(d);
    }
    Protected::new(&dirs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prot_tmp() -> (tempdir::Dir, Protected) {
        let t = tempdir::Dir::new("guard");
        let app = t.0.join("appdata");
        let data = t.0.join("문서").join("giLog");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::create_dir_all(data.join("backup")).unwrap();
        std::fs::write(data.join("gilog.db"), b"x").unwrap();
        let p = Protected::new(&[app, data]);
        (t, p)
    }

    mod tempdir {
        pub struct Dir(pub std::path::PathBuf);
        impl Dir {
            pub fn new(tag: &str) -> Self {
                let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
                let p = std::env::temp_dir().join(format!("gilog-{tag}-{}-{n}", std::process::id()));
                std::fs::create_dir_all(&p).unwrap();
                Dir(p)
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    #[test]
    fn plain_rejects_parent_and_device_paths() {
        for bad in ["", "  ", "C:\\a\\..\\Windows", "C:/a/../b", "..\\x", "\\\\?\\C:\\x", "\\\\.\\PhysicalDrive0", "a\0b", "/tmp/a/../b"] {
            assert_eq!(plain(bad).unwrap_err(), DENIED, "{bad:?}");
        }
        assert!(plain("D:\\민원처리\\가져오기").is_ok());
        assert!(plain("\\\\서버\\공유\\문서\\a.hwpx").is_ok());
        assert!(plain("C:\\a\\b..c.txt").is_ok());
    }

    #[test]
    fn system_places_are_denied() {
        for k in [
            "c:", "d:", "c:\\windows", "c:\\windows\\system32\\drivers", "c:\\program files", "c:\\program files (x86)\\x\\y.dll", "c:\\users", "c:\\users\\me",
            "\\\\server\\share", "\\\\server", "\\", "\\home\\me", "\\root",
        ] {
            assert!(system_key(k), "{k}");
        }
        for k in ["c:\\users\\me\\documents\\a", "d:\\민원처리", "c:\\work\\windows", "\\\\server\\share\\a", "\\tmp\\x"] {
            assert!(!system_key(k), "{k}");
        }
    }

    #[test]
    fn norm_strips_prefixes_and_case() {
        assert_eq!(norm("\\\\?\\C:\\Users\\Me\\"), "c:\\users\\me");
        assert_eq!(norm("\\\\?\\UNC\\srv\\share\\a"), "\\\\srv\\share\\a");
        assert_eq!(norm("C:\\"), "c:");
        assert_eq!(norm("D:/A/b/"), "d:\\a\\b");
    }

    #[test]
    fn removable_denies_roots_and_app_folders() {
        let (t, prot) = prot_tmp();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        assert_eq!(removable("/", &prot).unwrap_err(), DENIED);
        assert_eq!(removable("C:\\", &prot).unwrap_err(), DENIED);
        assert_eq!(removable("C:\\Windows", &prot).unwrap_err(), DENIED);
        assert_eq!(removable("C:\\Program Files\\giLog", &prot).unwrap_err(), DENIED);
        assert_eq!(removable("D:\\자료\\..\\..", &prot).unwrap_err(), DENIED);
        assert_eq!(removable(&s(&t.0.join("appdata")), &prot).unwrap_err(), DENIED);
        assert_eq!(removable(&s(&t.0.join("appdata").join("prefs.json")), &prot).unwrap_err(), DENIED);
        assert_eq!(removable(&s(&t.0.join("문서").join("giLog")), &prot).unwrap_err(), DENIED);
        assert_eq!(removable(&s(&t.0.join("문서").join("giLog").join("gilog.db")), &prot).unwrap_err(), DENIED);
        assert_eq!(removable(&s(&t.0.join("문서").join("giLog").join("backup")), &prot).unwrap_err(), DENIED);
        // 보통 폴더·파일은 돼요
        let ok = t.0.join("문서").join("사진");
        std::fs::create_dir_all(&ok).unwrap();
        assert!(removable(&s(&ok), &prot).is_ok());
        assert!(removable(&s(&t.0.join("문서")), &prot).is_ok());
        assert!(removable("D:\\민원처리\\가져오기\\1AA-2510-0001.json", &prot).is_ok());
    }

    #[test]
    fn writable_denies_inside_app_folders_only() {
        let (t, prot) = prot_tmp();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        assert_eq!(writable(&s(&t.0.join("appdata")), &prot).unwrap_err(), DENIED);
        assert_eq!(writable(&s(&t.0.join("문서").join("giLog").join("backup")), &prot).unwrap_err(), DENIED);
        assert!(writable(&s(&t.0.join("문서")), &prot).is_ok());
        assert!(writable("D:\\", &prot).is_ok());
        assert_eq!(writable("D:\\a\\..\\b", &prot).unwrap_err(), DENIED);
    }

    #[test]
    fn exec_extensions() {
        for p in ["a.exe", "C:\\x\\SETUP.EXE", "run.bat", "x.cmd", "s.ps1", "v.vbs", "j.js", "i.msi", "s.scr", "a.exe.", "r.reg"] {
            assert!(is_exec(Path::new(p)), "{p}");
        }
        for p in ["a.hwpx", "b.pdf", "사진.jpg", "exe", "a.json", "a.jsx", "폴더"] {
            assert!(!is_exec(Path::new(p)), "{p}");
        }
    }
}
