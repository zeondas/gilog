//! 시험용 두 번째 기록(2026-10-25 사용자 — 집행현황 팀 공유를 한 PC에서 두 구글 계정으로 시험).
//!
//! 실행 인자 `--profile B`(또는 `--profile=B`)로 켜면 같은 PC에서 따로 도는 기록이 하나 더 떠요.
//! - 한 번 더 켜기 막기(single-instance)를 쓰지 않아요 – 원래 기록과 함께 떠요.
//! - 앱 설정(prefs.json·window.json·pin.bin 등)은 AppData\kr.gilog.app\profiles\B,
//!   자료는 문서\giLog-B, 자격 증명 이름은 giLog-B, 화면 저장소는 AppData\Local\kr.gilog.app\profiles\B –
//!   원래 기록의 자료·구글 연결과 섞이지 않아요.
//! - 창 제목·트레이 글자에 "시험 B"를 붙이고, 자동 실행·바로가기 아이콘은 건드리지 않아요.
//! 설정 → 모듈별 → 집행현황 팀 공유 카드의 [시험용 두 번째 기록 열기]가 이 인자로 자기 자신을 한 번 더 켜요.

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

/// 시험용 두 번째 기록의 이름(처음 값)
pub const TWIN: &str = "B";

fn parse(args: &[String]) -> Option<String> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let v = if a == "--profile" {
            it.next().cloned()
        } else {
            a.strip_prefix("--profile=").map(str::to_string)
        };
        if let Some(v) = v {
            // 폴더 이름에 쓰니 영문·숫자 8자까지만
            let v: String = v.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
            return if v.is_empty() { None } else { Some(v) };
        }
    }
    None
}

/// 이번 실행의 시험 이름. 보통 실행이면 None
pub fn name() -> Option<&'static str> {
    static P: OnceLock<Option<String>> = OnceLock::new();
    P.get_or_init(|| parse(&std::env::args().skip(1).collect::<Vec<_>>())).as_deref()
}

/// 폴더·자격 증명 이름 뒤에 붙는 글자("" 또는 "-B")
pub fn suffix() -> String {
    name().map(|p| format!("-{p}")).unwrap_or_default()
}

/// 앱 설정 폴더(AppData\Roaming\kr.gilog.app, 시험이면 그 아래 profiles\B)
pub fn config_dir<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    let base = app.path().app_config_dir()?;
    Ok(match name() {
        Some(p) => base.join("profiles").join(p),
        None => base,
    })
}

/// 시험이면 화면 저장소(WebView2) 폴더를 따로 – 보통 실행이면 None(원래 자리)
pub fn webview_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let p = name()?;
    app.path().app_local_data_dir().ok().map(|d| d.join("profiles").join(p))
}

/// 창 제목·트레이 글자
pub fn title() -> String {
    match name() {
        Some(p) => format!("기록 · 시험 {p}"),
        None => "기록".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::parse;
    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }
    #[test]
    fn reads_profile_arg() {
        assert_eq!(parse(&v(&["--profile", "B"])).as_deref(), Some("B"));
        assert_eq!(parse(&v(&["--autostart", "--profile=b2"])).as_deref(), Some("b2"));
        assert_eq!(parse(&v(&["--profile", "..\\x"])).as_deref(), Some("x"));
        assert_eq!(parse(&v(&["--profile"])), None);
        assert_eq!(parse(&v(&["--autostart"])), None);
    }
}
