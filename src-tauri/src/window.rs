//! 앱 시작 창: 숨긴 채 만들고, 크기·자리를 정하고, 화면이 처음 그려진 뒤 보여 줘요.
//!
//! - 켤 때 화면 전체 크기로 떴다가 줄어들며 흰 바탕이 보이던 것(2026-10-17 사용자)을 없애요.
//!   창 설정은 `tauri.conf.json`(1600×900, 가운데, `create: false` — 여기서 바탕색을 붙여 만들어요).
//! - 창 바탕색은 앱 테마 바탕색(`--surface`)과 같아요. 설정에서 테마를 바꾸거나 윈도우 테마가 바뀌면 따라가요.
//! - 마지막 자리·크기·최대화를 `prefs.json` 옆 `window.json`에 기억해요(옮기거나 크기를 바꾸면 조금 뒤, 트레이로 숨길 때).
//!   저장된 자리가 지금 모니터 밖이면(모니터를 뺐을 때) 처음처럼 1600×900 가운데로 열어요.
//! - 화면이 `window_ready`를 부르면 보여요. 화면에 오류가 나도 창이 영영 안 보이지 않게 몇 초 뒤엔 그냥 보여요.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::window::Color;
use tauri::{App, AppHandle, Manager, PhysicalPosition, PhysicalSize, Theme, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent};

const LABEL: &str = "main";
/// 화면이 준비됐다고 알리지 않아도 이만큼 지나면 보여요.
const FALLBACK: Duration = Duration::from_secs(4);
/// 옮기기·크기 바꾸기가 이만큼 멈추면 저장해요.
const QUIET: Duration = Duration::from_millis(400);

/// tokens.css의 `--surface` (밝게 / 어둡게)
const LIGHT_BG: Color = Color(0xFF, 0xFF, 0xFF, 0xFF);
const DARK_BG: Color = Color(0x17, 0x16, 0x1C, 0xFF);

static SHOWN: AtomicBool = AtomicBool::new(false);

/// 기억해 두는 창 모양. 자리·크기는 실제 화면 픽셀이고, 최대화했을 때도 되돌릴 크기를 남겨요.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Saved {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

static STATE: Mutex<Option<Saved>> = Mutex::new(None);

fn state_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("window.json"))
}

fn load(app: &AppHandle) -> Option<Saved> {
    let text = fs::read_to_string(state_path(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

fn store(app: &AppHandle, s: &Saved) {
    if let Some(p) = state_path(app) {
        if let Ok(text) = serde_json::to_string_pretty(s) {
            let _ = fs::write(p, text);
        }
    }
}

/// 직사각형 (x, y, 폭, 높이)
type Rect = (i32, i32, u32, u32);

/// 저장된 창을 그대로 놓을 수 있는지: 창 위쪽(제목 줄) 띠가 어느 모니터 작업 영역과 가로 100px·세로 20px 넘게 겹치면 돼요.
/// 겹치는 모니터의 작업 영역을 돌려줘요(크기를 그 안으로 줄이려고).
fn fits(s: &Saved, areas: &[Rect]) -> Option<Rect> {
    if s.width < 200 || s.height < 150 {
        return None;
    }
    let bar = (s.x, s.y, s.width, 40u32);
    areas.iter().copied().find(|a| {
        let w = (bar.0 + bar.2 as i32).min(a.0 + a.2 as i32) - bar.0.max(a.0);
        let h = (bar.1 + bar.3 as i32).min(a.1 + a.3 as i32) - bar.1.max(a.1);
        w >= 100 && h >= 20
    })
}

/// 테마 설정(system / light / dark)과 윈도우 테마로 창 바탕색을 정해요.
fn bg_for(theme_pref: &str, system: Theme) -> Color {
    match theme_pref {
        "dark" => DARK_BG,
        "light" => LIGHT_BG,
        _ if system == Theme::Dark => DARK_BG,
        _ => LIGHT_BG,
    }
}

fn forced_theme(theme_pref: &str) -> Option<Theme> {
    match theme_pref {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    }
}

/// 설정의 테마에 맞춰 창 바탕색(크기를 바꿀 때 잠깐 보이는 곳)과 제목 줄 밝기를 맞춰요.
pub fn apply_theme(app: &AppHandle, theme_pref: &str) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_theme(forced_theme(theme_pref));
        let system = w.theme().unwrap_or(Theme::Light);
        let _ = w.set_background_color(Some(bg_for(theme_pref, system)));
    }
}

/// 앱을 켤 때(setup) 창을 숨긴 채 만들고 자리·크기를 정해요.
pub fn create(app: &mut App, theme_pref: &str) -> tauri::Result<()> {
    let handle = app.handle().clone();
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == LABEL)
        .cloned()
        .expect("창 설정이 없어요");
    let builder = WebviewWindowBuilder::from_config(&handle, &config)?
        .visible(false)
        .theme(forced_theme(theme_pref))
        .background_color(bg_for(theme_pref, Theme::Light));
    let w = builder.build()?;
    // 시스템 테마는 창을 만든 뒤에야 알 수 있어요.
    apply_theme(&handle, theme_pref);
    restore(&w);
    seed(&w);

    // 안전장치: 화면이 준비를 알리지 못해도 몇 초 뒤엔 보여요.
    let h = handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FALLBACK);
        if !SHOWN.load(Ordering::SeqCst) {
            reveal(&h);
        }
    });
    Ok(())
}

/// 저장된 자리·크기를 적용해요. 없거나 지금 모니터 밖이면 설정의 처음 값(1600×900 가운데)을 그대로 둬요.
fn restore(w: &WebviewWindow) {
    let Some(saved) = load(w.app_handle()) else { return };
    let areas: Vec<Rect> = w
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let a = m.work_area();
            (a.position.x, a.position.y, a.size.width, a.size.height)
        })
        .collect();
    let Some(area) = fits(&saved, &areas) else { return };
    let width = saved.width.min(area.2);
    let height = saved.height.min(area.3);
    // 먼저 그 모니터로 옮긴 뒤 크기를 정해요(모니터마다 배율이 다르면 옮길 때 크기가 바뀌어요).
    let _ = w.set_position(PhysicalPosition::new(saved.x, saved.y));
    let _ = w.set_size(PhysicalSize::new(width, height));
    if saved.maximized {
        // 숨긴 창은 최대화 표시만 해 두고, 보일 때 최대화해서 보여요.
        let _ = w.maximize();
    }
    if let Ok(mut g) = STATE.lock() {
        *g = Some(Saved { width, height, ..saved });
    }
}

/// 창을 처음 보여 줘요(한 번만).
fn reveal(app: &AppHandle) {
    if mark_shown() {
        return;
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 창을 보였다고 적어 둬요(트레이·한 번 더 켜기·알림으로 먼저 꺼낸 때도). 이미 보였으면 true.
pub fn mark_shown() -> bool {
    SHOWN.swap(true, Ordering::SeqCst)
}

/// 처음 켤 때 지금 모양을 기억의 바탕으로 잡아요(처음 켠 뒤 바로 최대화해도 되돌릴 크기가 남게).
fn seed(w: &WebviewWindow) {
    let Ok(mut g) = STATE.lock() else { return };
    if g.is_none() {
        if let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) {
            *g = Some(Saved { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: false });
        }
    }
}

/// 화면이 처음 그려지면 불러요(잠금 화면이든 앱 화면이든).
#[tauri::command]
pub fn window_ready(app: AppHandle) {
    reveal(&app);
}

/// 지금 창 모양을 읽어 기억해 둬요. 최소화 중이면 그대로 두고, 최대화 중이면 되돌릴 크기는 그대로 두고 최대화만 적어요.
fn capture(w: &Window) -> Option<Saved> {
    if !SHOWN.load(Ordering::SeqCst) || w.is_minimized().unwrap_or(false) {
        return None;
    }
    let maximized = w.is_maximized().unwrap_or(false);
    let mut g = STATE.lock().ok()?;
    let next = if maximized {
        let base = (*g)?;
        Saved { maximized: true, ..base }
    } else {
        let pos = w.outer_position().ok()?;
        let size = w.inner_size().ok()?;
        Saved { x: pos.x, y: pos.y, width: size.width, height: size.height, maximized: false }
    };
    *g = Some(next);
    Some(next)
}

fn save_now(w: &Window) {
    if let Some(s) = capture(w) {
        store(w.app_handle(), &s);
    }
}

/// 옮기기·크기 바꾸기가 멈추면 한 번 저장해요(끄는 길이 여러 가지라 그때그때 저장해 둬요).
fn save_soon(w: &Window) {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    static RUNNING: AtomicBool = AtomicBool::new(false);
    if let Ok(mut l) = LAST.lock() {
        *l = Some(Instant::now());
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let w = w.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(150));
        let quiet = LAST.lock().ok().and_then(|l| *l).is_none_or(|t| t.elapsed() >= QUIET);
        if quiet {
            save_now(&w);
            RUNNING.store(false, Ordering::SeqCst);
            break;
        }
    });
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != LABEL {
        return;
    }
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => save_soon(window),
        // X는 트레이로 숨기기예요(calendar.rs). 숨기기 전에 자리를 저장해요.
        WindowEvent::CloseRequested { .. } => save_now(window),
        WindowEvent::ThemeChanged(_) => {
            let pref = crate::theme_pref(window.app_handle());
            if pref == "system" {
                apply_theme(window.app_handle(), &pref);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(x: i32, y: i32, width: u32, height: u32) -> Saved {
        Saved { x, y, width, height, maximized: false }
    }

    #[test]
    fn saved_place_must_be_on_a_monitor() {
        let one = [(0, 0, 1920, 1040)];
        assert!(fits(&s(160, 90, 1600, 900), &one).is_some());
        // 오른쪽 모니터에 두었는데 그 모니터를 뺐어요.
        assert!(fits(&s(2100, 100, 1600, 900), &one).is_none());
        // 제목 줄이 화면 위로 넘어가 잡을 수 없어요.
        assert!(fits(&s(100, -500, 1600, 900), &one).is_none());
        // 왼쪽으로 많이 걸쳐 있어도 제목 줄이 100px 넘게 보이면 그대로.
        assert!(fits(&s(-1400, 50, 1600, 900), &one).is_some());
        let two = [(0, 0, 1920, 1040), (1920, 0, 2560, 1400)];
        assert_eq!(fits(&s(2100, 100, 1600, 900), &two), Some((1920, 0, 2560, 1400)));
        assert!(fits(&s(0, 0, 10, 10), &one).is_none());
    }

    #[test]
    fn background_follows_theme() {
        assert_eq!(bg_for("dark", Theme::Light), DARK_BG);
        assert_eq!(bg_for("light", Theme::Dark), LIGHT_BG);
        assert_eq!(bg_for("system", Theme::Dark), DARK_BG);
        assert_eq!(bg_for("system", Theme::Light), LIGHT_BG);
    }
}
