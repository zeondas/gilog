//! 화면(웹뷰)이 보낸 경로를 지우기·옮기기·실행 전에 거르는 곳이에요(품질 보완 ②, 2026-10-29 `wip/guardrails`).
//!
//! 화면에 스크립트가 한 번이라도 끼어들면 곧바로 영구 삭제·프로그램 실행으로 이어지지 않게 두 번째 겹을 둬요.
//! 사용자가 탐색기에서 하는 보통 일(문서·사진 폴더 지우기·옮기기·열기)은 그대로 돼요.
//!
//! - `plain`: 빈 경로·NUL·`..`·장치 경로(`\\?\`·`\\.\`)를 막아요.
//! - `removable`: 지우기·옮기기·이름 바꾸기 원본. 드라이브 맨 위·네트워크 공유 맨 위·윈도우 폴더·프로그램 폴더·
//!   사용자 폴더 자체·앱 설정 폴더·자료 폴더(안쪽 포함)는 막아요.
//! - `writable`: 복사·옮기기·새 폴더 대상. 앱 설정 폴더·자료 폴더 안은 막아요.
//! - `export_to`: 엑셀·백업 내보내기·폰으로 보내기·자료 폴더 옮기기 대상(②-2). `writable`에 더해 윈도우·프로그램 폴더도 막아요.
//! - `is_exec`: 열면 프로그램이 도는 파일(exe·bat 등). `fs_open`은 앱이 준 일회용 번호(`run_ticket`)를 받아야만 열어요(②-2).
//!
//! 경로는 절대 경로만 받아요(상대 경로·`C:foo` 거부). 비교는 `key_of`/`norm` 한 곳에서 해요 – 아직 없는 경로는
//! 있는 부모 폴더를 실제 경로로 바꿔 잇고, `\\localhost\c$\…`·`\\?\C:\…`는 `c:\…`와 같은 키가 돼요.
//!
//! 막으면 오류 이름은 `path_denied`예요(실행 파일 확인이 필요하면 `need_confirm:<번호>`).

use std::path::{Component, Path, PathBuf};

pub const DENIED: &str = "path_denied";
pub const NEED_CONFIRM: &str = "need_confirm";

/// 열면 프로그램이 도는 확장자(소문자, 점 없이)
const EXEC_EXT: [&str; 30] = [
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "scr", "pif", "hta", "cpl", "reg", "appref-ms",
    // ②-2: 인터넷 바로 가기·탐색기 명령·자바·관리 콘솔·도움말·엑셀 추가 기능·매크로 문서·클릭원스·설정·라이브러리
    "url", "scf", "jar", "msc", "chm", "xll", "docm", "application", "settingcontent-ms", "library-ms",
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
    if !absolute(&slashed) {
        return Err(denied());
    }
    let path = PathBuf::from(t);
    if path.components().any(|c| matches!(c, Component::ParentDir)) || slashed.split('\\').any(|c| c == "..") {
        return Err(denied());
    }
    Ok(path)
}

/// 절대 경로인지(`\`로 바꾼 글자로): `C:\…`·`\\서버\…`, 리눅스 시험은 `\…`(`/…`). `C:foo`·`foo\bar`는 아니에요.
fn absolute(slashed: &str) -> bool {
    let b = slashed.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\' {
        return true;
    }
    if slashed.starts_with("\\\\") {
        return slashed.len() > 2;
    }
    // 드라이브 없는 `\…`는 윈도우에선 "지금 드라이브 기준"이라 받지 않아요(리눅스 시험만 `/…`)
    cfg!(not(windows)) && slashed.starts_with('\\')
}

/// 비교용 모양: 실제 경로(없으면 있는 부모까지 바꾸고 나머지를 이어요) → 윈도우 접두사·관리 공유 → `\` → 소문자 → 끝 `\` 떼기
pub fn key_of(p: &Path) -> String {
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = p.to_path_buf();
    loop {
        if let Ok(mut real) = std::fs::canonicalize(&cur) {
            for t in tail.iter().rev() {
                real.push(t);
            }
            return norm(&real.to_string_lossy());
        }
        match (cur.file_name().map(|n| n.to_os_string()), cur.parent()) {
            (Some(n), Some(par)) if !par.as_os_str().is_empty() => {
                tail.push(n);
                cur = par.to_path_buf();
            }
            _ => return norm(&p.to_string_lossy()),
        }
    }
}

/// 이 컴퓨터 자신을 가리키는 서버 이름인지(`\\localhost\c$` 같은 관리 공유)
fn local_host(h: &str) -> bool {
    let h = h.to_lowercase();
    if matches!(h.as_str(), "localhost" | "127.0.0.1" | "::1" | "0:0:0:0:0:0:0:1" | ".") {
        return true;
    }
    std::env::var("COMPUTERNAME").map(|c| !c.is_empty() && c.to_lowercase() == h).unwrap_or(false)
}

pub(crate) fn norm(s: &str) -> String {
    let mut s = s.trim().replace('/', "\\");
    if let Some(rest) = s.strip_prefix("\\\\?\\UNC\\") {
        s = format!("\\\\{rest}");
    } else if let Some(rest) = s.strip_prefix("\\\\?\\") {
        s = rest.to_string();
    }
    // \\localhost\c$\x → c:\x (같은 파일이 다른 키로 보호를 비켜 가지 않게)
    if let Some(rest) = s.strip_prefix("\\\\") {
        let mut it = rest.splitn(3, '\\');
        let (host, share, more) = (it.next().unwrap_or(""), it.next().unwrap_or(""), it.next());
        let sb = share.as_bytes();
        if local_host(host) && sb.len() == 2 && sb[0].is_ascii_alphabetic() && sb[1] == b'$' {
            s = format!("{}:\\{}", &share[..1], more.unwrap_or(""));
        }
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

/// 윈도우·프로그램 폴더 안인지(드라이브 바로 아래 Windows·Program Files)
fn system_folder(key: &str) -> bool {
    let parts: Vec<&str> = key.split('\\').filter(|x| !x.is_empty()).collect();
    matches!(parts.as_slice(), [d, top, ..] if d.ends_with(':') && SYSTEM_TOP.contains(top))
}

/// 내보내기 대상(엑셀·백업 파일·폰으로 보내기 폴더·자료 폴더 옮길 곳) – 자료 폴더·앱 설정 폴더·윈도우 폴더는 막아요(②-2 ✔1).
/// 자료 파일(gilog.db·key.json·backup\*)이 엑셀 내용으로 덮이지 않게 해요.
pub fn export_to(p: &str, prot: &Protected) -> Result<PathBuf, String> {
    let path = plain(p)?;
    let key = key_of(&path);
    if prot.covers(&key) || system_folder(&key) {
        return Err(denied());
    }
    Ok(path)
}

/// 압축 파일 안 항목의 상대 이름이 풀 폴더 밖을 가리키지 않는지(②-2 ✔3): 빈 칸·`..`·드라이브(`C:`)·맨 앞 `/`·`\` 거부
pub fn safe_rel(rel: &str) -> bool {
    if rel.is_empty() || rel.starts_with(['/', '\\']) || rel.contains('\0') {
        return false;
    }
    if !rel.split(['/', '\\']).all(|c| !c.is_empty() && c != ".." && c != "." && !c.contains(':')) {
        return false;
    }
    Path::new(rel).components().all(|c| matches!(c, Component::Normal(_)))
}

// ---------- 실행 확인 일회용 번호(②-2 ✔2 ①1안) ----------
// 앱이 `need_confirm:<번호>`로 번호를 주고, 화면이 "실행할까요?"에서 [실행]을 받은 뒤 그 번호로 다시 불러야만 열어요.
// 번호는 그 경로 하나·한 번만·`TICKET_SECS`초 안에만 써요.

pub const TICKET_SECS: u64 = 60;

struct Ticket {
    id: String,
    key: String,
    at: std::time::Instant,
}

static TICKETS: std::sync::Mutex<Vec<Ticket>> = std::sync::Mutex::new(Vec::new());

fn fresh_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    // RandomState는 실행마다 운영체제 난수로 씨앗을 받아요
    let mut out = String::new();
    for i in 0..2u8 {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(n);
        h.write_u8(i);
        h.write_u32(std::process::id());
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

/// 이 경로를 한 번 실행해도 되는 번호를 줘요(지난 번호는 지워요)
pub fn run_ticket(p: &Path) -> String {
    let id = fresh_id();
    if let Ok(mut t) = TICKETS.lock() {
        t.retain(|x| x.at.elapsed().as_secs() < TICKET_SECS);
        t.push(Ticket { id: id.clone(), key: key_of(p), at: std::time::Instant::now() });
        if t.len() > 16 {
            let cut = t.len() - 16;
            t.drain(..cut);
        }
    }
    id
}

/// 번호가 이 경로의 것이고 아직 살아 있으면 쓰고(한 번만) true
pub fn take_ticket(p: &Path, id: &str) -> bool {
    take_ticket_within(p, id, TICKET_SECS)
}

fn take_ticket_within(p: &Path, id: &str, secs: u64) -> bool {
    if id.is_empty() {
        return false;
    }
    let key = key_of(p);
    let Ok(mut t) = TICKETS.lock() else { return false };
    let Some(i) = t.iter().position(|x| x.id == id) else { return false };
    let x = t.remove(i);
    x.key == key && x.at.elapsed().as_secs() < secs
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
    match crate::data_dir(app) {
        Ok(d) => dirs.push(d),
        // prefs를 못 읽어도 기본 자료 폴더(문서\giLog)는 지켜요(②-2 ✔1)
        Err(_) => {
            if let Ok(d) = crate::default_data_dir(app) {
                dirs.push(d);
            }
        }
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
    fn only_absolute_paths() {
        for bad in ["a.txt", "폴더\\a.xlsx", "C:foo", "c:foo\\bar.xlsx", ".\\x", "\\\\"] {
            assert_eq!(plain(bad).unwrap_err(), DENIED, "{bad:?}");
        }
        assert!(plain("C:\\a.xlsx").is_ok());
        assert!(plain("c:/a/b.xlsx").is_ok());
        assert!(plain("\\\\srv\\공유\\a.xlsx").is_ok());
        // 리눅스 시험 경로는 `/…`
        #[cfg(not(windows))]
        assert!(plain("/tmp/a").is_ok());
        #[cfg(windows)]
        assert_eq!(plain("\\Windows\\x").unwrap_err(), DENIED);
    }

    #[test]
    fn admin_shares_get_drive_keys() {
        assert_eq!(norm("\\\\localhost\\c$\\Users\\Me\\"), "c:\\users\\me");
        assert_eq!(norm("\\\\127.0.0.1\\D$\\자료"), "d:\\자료");
        assert_eq!(norm("\\\\?\\UNC\\localhost\\c$\\Windows"), "c:\\windows");
        assert_eq!(norm("\\\\localhost\\c$"), "c:");
        // 다른 서버·보통 공유는 그대로
        assert_eq!(norm("\\\\srv\\c$\\a"), "\\\\srv\\c$\\a");
        assert_eq!(norm("\\\\localhost\\share\\a"), "\\\\localhost\\share\\a");
        let prot = Protected::default();
        assert_eq!(export_to("\\\\localhost\\c$\\Windows\\a.xlsx", &prot).unwrap_err(), DENIED);
        assert_eq!(export_to("\\\\localhost\\c$\\Program Files\\a.xlsx", &prot).unwrap_err(), DENIED);
    }

    #[test]
    fn missing_paths_use_existing_parent() {
        let (t, _) = prot_tmp();
        let deep = t.0.join("문서").join("giLog").join("backup").join("새 폴더").join("a.xlsx");
        let parent_key = key_of(&t.0.join("문서").join("giLog").join("backup"));
        assert_eq!(key_of(&deep), format!("{parent_key}\\새 폴더\\a.xlsx").to_lowercase());
    }

    #[test]
    fn export_targets() {
        let (t, prot) = prot_tmp();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let data = t.0.join("문서").join("giLog");
        // 자료 파일·백업 폴더·key.json·아직 없는 파일까지 자료 폴더 안은 막아요
        for p in [data.join("gilog.db"), data.join("gilog.key.json"), data.join("backup").join("gilog_2026-10-29.gilogbak"), data.join("민원.xlsx"), data.clone(), t.0.join("appdata").join("prefs.json")] {
            assert_eq!(export_to(&s(&p), &prot).unwrap_err(), DENIED, "{p:?}");
        }
        // 윈도우·프로그램 폴더
        for p in ["C:\\Windows\\a.xlsx", "c:/windows/system32/a.xlsx", "C:\\Program Files (x86)\\a.xlsx"] {
            assert_eq!(export_to(p, &prot).unwrap_err(), DENIED, "{p}");
        }
        // 상대 경로·드라이브 상대
        for p in ["민원.xlsx", "C:민원.xlsx", "D:\\a\\..\\b.xlsx"] {
            assert_eq!(export_to(p, &prot).unwrap_err(), DENIED, "{p}");
        }
        // 보통 폴더는 돼요(없는 파일도)
        assert!(export_to(&s(&t.0.join("문서").join("민원대장_2026.xlsx")), &prot).is_ok());
        assert!(export_to("D:\\민원처리\\보내기", &prot).is_ok());
        assert!(export_to("C:\\Users\\me\\Desktop\\a.xlsx", &prot).is_ok());
        assert!(export_to("C:\\work\\windows\\a.xlsx", &prot).is_ok());
        assert!(export_to("D:\\", &prot).is_ok());
    }

    #[test]
    fn zip_relative_names() {
        for ok in ["a.txt", "사진/1.jpg", "a/b/c.hwp", "a..b.txt"] {
            assert!(safe_rel(ok), "{ok}");
        }
        for bad in ["", "/abs", "\\abs", "C:/x", "c:x", "a/../b", "..", "a//b", "a/./b", "\\\\srv\\s", "a\\..\\b", "x\0y"] {
            assert!(!safe_rel(bad), "{bad:?}");
        }
    }

    #[test]
    fn run_tickets() {
        let (t, _) = prot_tmp();
        let exe = t.0.join("setup.exe");
        let other = t.0.join("other.exe");
        // 번호 없이·지어낸 번호는 안 돼요
        assert!(!take_ticket(&exe, ""));
        assert!(!take_ticket(&exe, "0123456789abcdef0123456789abcdef"));
        // 받은 번호는 그 경로에 한 번만
        let id = run_ticket(&exe);
        assert_eq!(id.len(), 32);
        assert!(take_ticket(&exe, &id));
        assert!(!take_ticket(&exe, &id));
        // 다른 경로에는 못 써요(그리고 그 번호는 버려져요)
        let id2 = run_ticket(&exe);
        assert!(!take_ticket(&other, &id2));
        assert!(!take_ticket(&exe, &id2));
        // 시간이 지나면 안 돼요
        let id3 = run_ticket(&exe);
        assert!(!take_ticket_within(&exe, &id3, 0));
        // 번호는 매번 달라요
        assert_ne!(run_ticket(&exe), run_ticket(&exe));
    }

    #[test]
    fn exec_extensions() {
        for p in [
            "a.exe", "C:\\x\\SETUP.EXE", "run.bat", "x.cmd", "s.ps1", "v.vbs", "j.js", "i.msi", "s.scr", "a.exe.", "r.reg", "링크.url", "a.scf", "a.jar", "a.msc", "도움.chm",
            "a.xll", "매크로.docm", "a.application", "a.settingcontent-ms", "a.library-ms",
        ] {
            assert!(is_exec(Path::new(p)), "{p}");
        }
        for p in ["a.hwpx", "b.pdf", "사진.jpg", "exe", "a.json", "a.jsx", "폴더"] {
            assert!(!is_exec(Path::new(p)), "{p}");
        }
    }
}
