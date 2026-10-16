//! 캘린더 (8단계): 일정·종류 명령, 공휴일 받기, 일정 알림, 트레이.
//!
//! - 공휴일은 holidays.hyunbin.page의 basic.json(우주항공청 월력요항을 정리한 자료, 대체·임시공휴일 포함)에서 받아요.
//!   인증키가 필요 없어요. 받지 못하면 저장해 둔 것(처음엔 앱에 넣어 온 것)을 그대로 보여 줘요.
//! - 알림: 화면이 앞으로 7일 동안 울릴 알림 목록을 보내 주면, 여기서 15초마다 시각을 보고 윈도우 알림을 띄워요.
//!   잠겨 있어도, 창을 닫아 트레이에 있어도 울려요. 앱을 끝내면 울리지 않아요(사양서).
//!   알림을 누르면 창을 앞으로 꺼내고 화면에 "reminder-open"을 보내 그 일정을 열어요.
//! - 창의 X는 끝내기가 아니라 트레이로 숨기기예요. 트레이 메뉴의 "끝내기"로 끝내요.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use gilog_core::{CalKind, CalendarData, Event, EventInput, Holiday};
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, State, Window, WindowEvent};

use crate::{with_store, AppState};

const HOLIDAYS_URL: &str = "https://holidays.hyunbin.page/basic.json";

// ---------- 일정과 종류 ----------

#[tauri::command]
pub fn calendar_data(state: State<AppState>) -> Result<CalendarData, String> {
    with_store(&state, |s| s.calendar_data())
}

#[tauri::command]
pub fn add_event(state: State<AppState>, event: EventInput) -> Result<Event, String> {
    with_store(&state, |s| s.add_event(&event))
}

#[tauri::command]
pub fn update_event(state: State<AppState>, id: i64, event: EventInput) -> Result<Event, String> {
    with_store(&state, |s| s.update_event(id, &event))
}

#[tauri::command]
pub fn delete_event(state: State<AppState>, id: i64) -> Result<(), String> {
    with_store(&state, |s| s.delete_event(id))
}

#[tauri::command]
pub fn cal_kinds(state: State<AppState>) -> Result<Vec<CalKind>, String> {
    with_store(&state, |s| s.cal_kinds())
}

#[tauri::command]
pub fn add_cal_kind(state: State<AppState>, name: String) -> Result<Vec<CalKind>, String> {
    with_store(&state, |s| s.add_cal_kind(&name))
}

#[tauri::command]
pub fn set_cal_kind_color(state: State<AppState>, id: i64, color: Option<i64>) -> Result<Vec<CalKind>, String> {
    with_store(&state, |s| s.set_cal_kind_color(id, color))
}

#[tauri::command]
pub fn set_cal_kind_visible(state: State<AppState>, id: i64, visible: bool) -> Result<Vec<CalKind>, String> {
    with_store(&state, |s| s.set_cal_kind_visible(id, visible))
}

#[tauri::command]
pub fn delete_cal_kind(state: State<AppState>, id: i64) -> Result<usize, String> {
    with_store(&state, |s| s.delete_cal_kind(id))
}

// ---------- 공휴일 ----------

/// 받은 자료의 한 날짜: 예전 모양(글자 하나)과 지금 모양(글자 목록)을 모두 받아요.
#[derive(Deserialize)]
#[serde(untagged)]
enum Names {
    One(String),
    Many(Vec<String>),
}

async fn download_holidays() -> Result<Vec<Holiday>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("giLog/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "offline".to_string())?;
    let res = client.get(HOLIDAYS_URL).send().await.map_err(|_| "offline".to_string())?;
    if !res.status().is_success() {
        return Err("offline".into());
    }
    let bytes = res.bytes().await.map_err(|_| "offline".to_string())?;
    let map: HashMap<String, Names> = serde_json::from_slice(&bytes).map_err(|_| "offline".to_string())?;
    let mut list: Vec<Holiday> = map
        .into_iter()
        .flat_map(|(date, names)| {
            let names = match names {
                Names::One(n) => vec![n],
                Names::Many(v) => v,
            };
            names.into_iter().map(move |name| Holiday { date: date.clone(), name })
        })
        .collect();
    list.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(list)
}

/// 공휴일을 인터넷에서 받아 저장하고, 저장한 공휴일 전체를 돌려줘요. 받지 못하면 "offline"이에요.
/// 받는 동안은 자료 파일을 잡고 있지 않아요(오래 걸려도 다른 화면이 멈추지 않게).
#[tauri::command]
pub async fn refresh_holidays(state: State<'_, AppState>, now: String) -> Result<Vec<Holiday>, String> {
    let list = download_holidays().await?;
    with_store(&state, |s| s.replace_holidays(&list, &now))
}

// ---------- 알림 ----------

/// 화면이 보내는 알림 한 건. at은 울릴 때(1970년부터 밀리초, PC 시각)예요.
#[derive(Deserialize, Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub at: i64,
    pub title: String,
    pub body: String,
    /// 일정 번호와 그 날짜(반복 일정은 그 회차의 날짜). 알림을 누르면 이 일정을 열어요.
    pub event: i64,
    pub date: String,
}

#[derive(Default)]
pub struct Reminders {
    list: Mutex<Vec<Reminder>>,
    /// 이미 울린 것 (일정 번호, 울릴 때)
    fired: Mutex<HashSet<(i64, i64)>>,
}

/// 늦게 깨어났을 때(절전 등) 이만큼 지난 알림까지는 울려요.
const LATE_MS: i64 = 10 * 60 * 1000;

#[tauri::command]
pub fn set_reminders(reminders: State<Reminders>, list: Vec<Reminder>) -> Result<(), String> {
    *reminders.list.lock().map_err(|_| "io".to_string())? = list;
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// 울릴 때가 된 알림을 꺼내요. 같은 알림은 한 번만 울려요.
fn due(rem: &Reminders, now: i64) -> Vec<Reminder> {
    let (Ok(list), Ok(mut fired)) = (rem.list.lock(), rem.fired.lock()) else {
        return vec![];
    };
    let out: Vec<Reminder> = list
        .iter()
        .filter(|r| r.at <= now && now - r.at < LATE_MS && !fired.contains(&(r.event, r.at)))
        .cloned()
        .collect();
    for r in &out {
        fired.insert((r.event, r.at));
    }
    // 하루 넘게 지난 기록은 버려요.
    fired.retain(|(_, at)| now - at < 24 * 3600 * 1000);
    out
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg(windows)]
fn toast(app: &AppHandle, title: &str, body: &str, open: Option<Reminder>) {
    use tauri::Emitter;
    use tauri_winrt_notification::{Sound, Toast};
    // 설치한 앱은 시작 메뉴 바로가기에 이 이름(identifier)이 붙어 있어 알림에 "giLog"로 보여요.
    let id = app.config().identifier.clone();
    let handle = app.clone();
    let t = Toast::new(&id).title(title).text1(body).sound(Some(Sound::Reminder)).on_activated(move |_| {
        show_main(&handle);
        if let Some(r) = &open {
            let _ = handle.emit("reminder-open", r.clone());
        }
        Ok(())
    });
    let _ = t.show();
}

#[cfg(not(windows))]
fn toast(_app: &AppHandle, title: &str, body: &str, _open: Option<Reminder>) {
    println!("[알림] {title} — {body}");
}

fn start_reminder_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        let rem = app.state::<Reminders>();
        for r in due(&rem, now_ms()) {
            toast(&app, &r.title, &r.body, Some(r.clone()));
        }
    });
}

// ---------- 트레이 ----------

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "giLog 열기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "끝내기", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("giLog")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    start_reminder_loop(app.handle().clone());
    Ok(())
}

/// 창의 X를 누르면 끝내지 않고 트레이로 숨겨요. 처음 한 번은 알림으로 알려 줘요.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    static TOLD: Mutex<bool> = Mutex::new(false);
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
        if let Ok(mut told) = TOLD.lock() {
            if !*told {
                *told = true;
                toast(window.app_handle(), "giLog는 계속 켜져 있어요", "일정 알림을 띄우려고 작업 표시줄 구석(트레이)에 남아 있어요. 완전히 끝내려면 트레이 아이콘을 우클릭해 \"끝내기\"를 누르세요.", None);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(event: i64, at: i64) -> Reminder {
        Reminder { at, title: "t".into(), body: "b".into(), event, date: "2026-10-16".into() }
    }

    #[test]
    fn reminders_fire_once_and_not_when_too_late() {
        let rem = Reminders::default();
        *rem.list.lock().unwrap() = vec![r(1, 1_000_000), r(2, 2_000_000), r(3, 1_000_000 - LATE_MS - 1)];
        assert!(due(&rem, 999_999).is_empty());
        let got: Vec<i64> = due(&rem, 1_000_000).iter().map(|x| x.event).collect();
        assert_eq!(got, vec![1]);
        assert!(due(&rem, 1_000_500).is_empty());
        // 목록을 다시 보내도 울린 것은 다시 울리지 않아요.
        *rem.list.lock().unwrap() = vec![r(1, 1_000_000), r(2, 2_000_000)];
        assert!(due(&rem, 1_500_000).is_empty());
        assert_eq!(due(&rem, 2_000_001).len(), 1);
    }

    #[test]
    fn holiday_names_accept_both_shapes() {
        let m: HashMap<String, Names> = serde_json::from_str(r#"{"2025-05-05":["어린이날","부처님 오신 날"],"2024-10-01":"임시공휴일"}"#).unwrap();
        assert!(matches!(m["2025-05-05"], Names::Many(ref v) if v.len() == 2));
        assert!(matches!(m["2024-10-01"], Names::One(_)));
    }
}
