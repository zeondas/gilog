//! 윈도우와 이어지는 일 – 기본 프로그램으로 열기, 윈도우 탐색기, 파일 형식 이름·아이콘, 우클릭 메뉴, 끌기, 속성, 바로 가기, 경로 풀기.

use std::collections::HashMap;
use std::path::Path;

use serde::Deserialize;
use tauri::AppHandle;

use super::*;

/// 윈도우 기본 프로그램으로 열어요(폴더면 윈도우 탐색기).
/// 실행 파일(exe·bat 등, 그런 것을 가리키는 바로 가기 포함)은 앱이 `need_confirm:<번호>`로 일회용 번호를 주고,
/// 화면이 "실행할까요?"에서 [실행]을 받은 뒤 그 번호(`ticket`)로 다시 불러야만 열어요(②-2 ✔2 ①1안 – 번호는 그 경로·한 번·60초).
#[tauri::command]
pub fn fs_open(path: String, ticket: Option<String>) -> Result<(), String> {
    let p = crate::guard::plain(&path)?;
    if runs_program(&p) && !crate::guard::take_ticket(&p, ticket.as_deref().unwrap_or("")) {
        return Err(format!("{}:{}", crate::guard::NEED_CONFIRM, crate::guard::run_ticket(&p)));
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
pub(super) fn runs_program(p: &Path) -> bool {
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
