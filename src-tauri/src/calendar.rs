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

/// 화면(Edge와 같은 인터넷 길 – 회사 프록시 자동 설정을 따라가요)이 받아 온 공휴일을 저장해요(0.8.2).
#[tauri::command]
pub fn save_holidays(state: State<AppState>, list: Vec<Holiday>, now: String) -> Result<Vec<Holiday>, String> {
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
    /// 등록한 앱 이름으로는 알림이 안 보이는 PC에서 PowerShell 이름으로 띄워요(사용자가 시험해 보고 고름).
    via_powershell: std::sync::atomic::AtomicBool,
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
    // 켜는 중(화면 그리기 전)에 꺼내도 그대로 보여요. 그 뒤 "준비" 신호는 아무 일도 하지 않아요.
    crate::window::mark_shown();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 알림이 실제로 뜨는지 화면에서 볼 수 있게 남겨 두는 상태예요(시험 단추와 함께 써요).
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyStatus {
    /// 앱이 들고 있는 알림 수(앞으로 7일)
    pub pending: usize,
    /// 다음 알림 때(밀리초), 없으면 0
    pub next_at: i64,
    /// 띄운 알림 수(앱을 켠 뒤)
    pub shown: usize,
    /// 마지막으로 띄우지 못한 이유. 없으면 빈 글자
    pub last_error: String,
    /// 윈도우 알림에 쓴 앱 이름. 등록한 이름이 안 되면 "PowerShell"로 바꿔 띄워요.
    pub via: String,
}

static STATUS: Mutex<Option<NotifyStatus>> = Mutex::new(None);

fn note_status(f: impl FnOnce(&mut NotifyStatus)) {
    if let Ok(mut g) = STATUS.lock() {
        f(g.get_or_insert_with(NotifyStatus::default));
    }
}

/// 설치한 앱의 이름을 윈도우에 알려 둬요. 시작 메뉴 바로가기가 없거나 이름표가 빠져 있어도 알림이 뜨게
/// HKCU\Software\Classes\AppUserModelId\<identifier>에 표시 이름을 적고, 이 앱이 그 이름으로 돈다고 알려요.
#[cfg(windows)]
pub fn register_app_id(app: &AppHandle) {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let id = app.config().identifier.clone();
    let key = wide(&format!("Software\\Classes\\AppUserModelId\\{id}"));
    let name = wide("DisplayName");
    let value = wide("기록");
    unsafe {
        RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, value.as_ptr() as *const core::ffi::c_void, (value.len() * 2) as u32);
        let idw = wide(&id);
        SetCurrentProcessExplicitAppUserModelID(idw.as_ptr());
    }
}

#[cfg(not(windows))]
pub fn register_app_id(_app: &AppHandle) {}

/// 윈도우 알림을 띄워요. 등록한 앱 이름으로 안 되면 PowerShell 이름으로 한 번 더 해 봐요. 실패하면 이유를 돌려줘요.
#[cfg(windows)]
fn toast(app: &AppHandle, title: &str, body: &str, open: Option<Reminder>) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_winrt_notification::{Sound, Toast};
    let make = |id: &str| {
        let handle = app.clone();
        let open = open.clone();
        Toast::new(id).title(title).text1(body).sound(Some(Sound::Reminder)).on_activated(move |_| {
            show_main(&handle);
            if let Some(r) = &open {
                let _ = handle.emit("reminder-open", r.clone());
            }
            Ok(())
        })
    };
    let ps = app.state::<Reminders>().via_powershell.load(std::sync::atomic::Ordering::Relaxed);
    if ps {
        let r = make(Toast::POWERSHELL_APP_ID).show().map(|_| "PowerShell".to_string()).map_err(|e| e.to_string());
        return finish(r);
    }
    let id = app.config().identifier.clone();
    let result = match make(&id).show() {
        Ok(()) => Ok("기록".to_string()),
        Err(e1) => match make(Toast::POWERSHELL_APP_ID).show() {
            Ok(()) => Ok(format!("PowerShell (기록 이름으로는 실패: {e1})")),
            Err(e2) => Err(format!("{e1} / {e2}")),
        },
    };
    finish(result)
}

fn finish(result: Result<String, String>) -> Result<(), String> {
    match result {
        Ok(via) => {
            note_status(|s| {
                s.shown += 1;
                s.via = via;
            });
            Ok(())
        }
        Err(e) => {
            note_status(|s| s.last_error = e.clone());
            Err(e)
        }
    }
}

#[cfg(not(windows))]
fn toast(_app: &AppHandle, title: &str, body: &str, _open: Option<Reminder>) -> Result<(), String> {
    println!("[알림] {title} – {body}");
    finish(Ok("콘솔".into()))
}

/// "알림 시험": 지금 바로 알림 하나를 띄워 봐요. 실패하면 윈도우가 돌려준 이유가 와요.
/// 알림을 PowerShell 이름으로 띄울지 정해요(화면이 저장해 두고 켤 때마다 보내요).
#[tauri::command]
pub fn set_notify_mode(reminders: State<Reminders>, powershell: bool) {
    reminders.via_powershell.store(powershell, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub fn test_notification(app: AppHandle) -> Result<NotifyStatus, String> {
    toast(&app, "기록 알림 시험", "이 알림이 보이면 일정 알림도 이렇게 떠요.", None)?;
    notify_status(app.state::<Reminders>())
}

#[tauri::command]
pub fn notify_status(reminders: State<Reminders>) -> Result<NotifyStatus, String> {
    let list = reminders.list.lock().map_err(|_| "io".to_string())?;
    let now = now_ms();
    let next = list.iter().filter(|r| r.at >= now - LATE_MS).map(|r| r.at).min().unwrap_or(0);
    let mut s = STATUS.lock().map_err(|_| "io".to_string())?.clone().unwrap_or_default();
    s.pending = list.len();
    s.next_at = next;
    Ok(s)
}

fn start_reminder_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        let rem = app.state::<Reminders>();
        for r in due(&rem, now_ms()) {
            let _ = toast(&app, &r.title, &r.body, Some(r.clone()));
        }
    });
}

// ---------- 트레이 ----------

pub fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "기록 열기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "끝내기", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("기록")
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
    register_app_id(app.handle());
    start_reminder_loop(app.handle().clone());
    Ok(())
}

/// 창의 X(Alt+F4도)를 누르면 설정 "닫기(X) 단추"대로 해요(prefs.json `closeAction`, 잠금 화면에서도 같아요).
/// - minimize: 작업표시줄로 내려요.
/// - tray(처음 값): 트레이로 숨겨요. 처음 한 번은 알림으로 알려 줘요.
/// - quit: 화면에 "기록을 끝낼까요?"를 띄워요(close-ask). 끝내기를 누르면 화면이 quit_app을 불러요.
/// 창 자리·크기는 세 경우 모두 window.rs가 먼저 저장해요.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    use tauri::Emitter;
    static TOLD: Mutex<bool> = Mutex::new(false);
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        match crate::close_action(window.app_handle()).as_str() {
            "minimize" => {
                let _ = window.minimize();
            }
            "quit" => {
                // 작업표시줄 우클릭 "창 닫기"처럼 내려가 있을 때도 묻는 창이 보이게 꺼내요.
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = window.emit("close-ask", ());
            }
            _ => {
                let _ = window.hide();
                if let Ok(mut told) = TOLD.lock() {
                    if !*told {
                        *told = true;
                        let _ = toast(window.app_handle(), "기록은 계속 켜져 있어요", "일정 알림을 띄우려고 작업 표시줄 구석(트레이)에 남아 있어요. 완전히 끝내려면 트레이 아이콘을 우클릭해 \"끝내기\"를 누르세요.", None);
                    }
                }
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
