//! 파일·폴더·신문고 열기 – 윈도우 기본 프로그램, 크롬, 탐색기에서 골라 보기.

use std::path::PathBuf;

use super::*;

/// 지시부 파일이나 민원 폴더를 윈도우 기본 프로그램(파워포인트·한글·탐색기)으로 열어요.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = crate::guard::plain(&path)?;
    // 지시부·민원 폴더만 여는 자리예요 – 실행 파일은 열지 않아요(✔1)
    if crate::guard::is_exec(&p) {
        return Err(crate::guard::DENIED.into());
    }
    if !p.exists() {
        return Err("missing".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(&p).spawn().map_err(io)?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&p).spawn().map_err(io)?;
    }
    Ok(())
}

/// 크롬 실행 파일 자리(설치 위치 두 곳). 없으면 None.
#[cfg(windows)]
pub(super) fn chrome_exe() -> Option<PathBuf> {
    let rel = ["Google", "Chrome", "Application", "chrome.exe"];
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].iter().filter_map(std::env::var_os).map(|base| rel.iter().fold(PathBuf::from(base), |p, s| p.join(s))).find(|p| p.is_file())
}

/// 신문고(업무처리포털)를 **크롬**으로 열어요(2026-10-19 사용자 1안 – 회사 정책이 엣지에서 신문고를 IE 모드로 열어
/// Claude 확장이 읽지 못해요). 크롬이 없으면 "nochrome". 이 주소만 받아요.
#[tauri::command]
pub fn open_portal(url: String) -> Result<(), String> {
    // 신문고 + 공직자 통합메일(보낸 증거 카드의 [보낸메일함 열기], 2026-10-20)
    let ok = ["https://gov.epeople.go.kr", "https://mail.korea.kr"].iter().any(|h| url == *h || url.starts_with(&format!("{h}/")));
    if !ok {
        return Err("invalid".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const NO_WINDOW: u32 = 0x0800_0000;
        let Some(chrome) = chrome_exe() else { return Err("nochrome".into()) };
        std::process::Command::new(chrome).arg(&url).creation_flags(NO_WINDOW).spawn().map_err(io)?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().map_err(io)?;
    }
    Ok(())
}

/// 탐색기를 열어 그 파일을 골라 보여요(파일함이 생기기 전까지 "이 민원 파일 보기").
#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err("missing".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer는 /select, 뒤 경로를 따옴표째 받아야 띄어쓰기가 있어도 돼요.
        std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", p.display())).spawn().map_err(io)?;
    }
    #[cfg(not(windows))]
    {
        let dir = p.parent().unwrap_or(&p).to_path_buf();
        std::process::Command::new("xdg-open").arg(dir).spawn().map_err(io)?;
    }
    Ok(())
}
