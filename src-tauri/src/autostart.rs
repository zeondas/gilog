//! 윈도우 시작할 때 자동 실행(설정 → 일반, 2026-10-19 사용자).
//!
//! - 켜면 현재 사용자 시작 프로그램(HKCU\Software\Microsoft\Windows\CurrentVersion\Run)에
//!   이름 "giLog"(식별자 — 보이는 글자 "기록"이 아님) = `"실행 파일" --autostart`로 등록하고, 끄면 지워요.
//!   등록·삭제·읽기는 tauri-plugin-autostart(auto-launch)가 해요.
//! - 윈도우 설정 → 앱 → 시작 프로그램(작업 관리자 시작 앱)에서 끈 것(`Explorer\StartupApproved\Run`)도
//!   auto-launch가 꺼진 것으로 읽고, 앱에서 다시 켜면 그 표시를 "켜짐"으로 바꿔요.
//! - `--autostart`로 켜지면 창을 숨긴 채 트레이에만 둬요(window.rs).

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// 자동 실행 등록 명령에 붙이는 인자
pub const ARG: &str = "--autostart";
/// 시작 프로그램에 적는 이름
pub const NAME: &str = "giLog";

/// 이번에 자동 실행으로 켜졌는지(실행 인자에 --autostart)
pub fn launched() -> bool {
    std::env::args().skip(1).any(|a| a == ARG)
}

/// 레지스트리의 실제 상태. 못 읽으면 None(그때는 prefs 값을 써요).
pub fn is_on(app: &AppHandle) -> Option<bool> {
    app.autolaunch().is_enabled().ok()
}

/// 켜기·끄기. 실패하면 "autostart"
pub fn set(app: &AppHandle, on: bool) -> Result<(), String> {
    let al = app.autolaunch();
    let r = if on { al.enable() } else { al.disable() };
    r.map_err(|_| "autostart".to_string())
}
