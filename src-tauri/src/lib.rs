mod ime;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use gilog_core::{ContactInput, ContactsData, DayInfo, Entry, EntryInput, JournalData, Store};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// 열려 있는 자료 파일을 들고 있어요. None이면 잠긴 상태예요.
struct AppState {
    store: Mutex<Option<Store>>,
}

fn code(e: gilog_core::Error) -> String {
    e.code().to_string()
}

fn io<E>(_: E) -> String {
    "io".to_string()
}

// ---------- 앱 설정 (암호 없이도 읽어야 하는 것) ----------
// AppData\Roaming\kr.gilog.app\prefs.json 에 두어요. 민감한 내용은 없어요.

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
struct Prefs {
    /// 자료 폴더. 비어 있으면 문서\giLog
    data_dir: String,
    /// 시스템 / 밝게 / 어둡게
    theme: String,
    start_screen: String,
    font_size: u32,
    urgent_days: u32,
    ask_password: bool,
    auto_lock: bool,
    auto_lock_min: u32,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            data_dir: String::new(),
            theme: "system".into(),
            start_screen: "journal".into(),
            font_size: 13,
            urgent_days: 2,
            ask_password: true,
            auto_lock: true,
            auto_lock_min: 10,
        }
    }
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(io)?;
    fs::create_dir_all(&dir).map_err(io)?;
    Ok(dir.join("prefs.json"))
}

fn read_prefs(app: &AppHandle) -> Result<Prefs, String> {
    let path = prefs_path(app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(_) => Ok(Prefs::default()),
    }
}

fn write_prefs(app: &AppHandle, prefs: &Prefs) -> Result<(), String> {
    let text = serde_json::to_string_pretty(prefs).map_err(io)?;
    fs::write(prefs_path(app)?, text).map_err(io)
}

/// 자료를 두는 폴더예요. 기본은 문서\giLog
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let prefs = read_prefs(app)?;
    if !prefs.data_dir.is_empty() {
        return Ok(PathBuf::from(prefs.data_dir));
    }
    app.path().document_dir().map(|d| d.join("giLog")).map_err(io)
}

#[tauri::command]
fn get_prefs(app: AppHandle) -> Result<Prefs, String> {
    read_prefs(&app)
}

#[tauri::command]
fn set_prefs(app: AppHandle, state: State<AppState>, prefs: Prefs) -> Result<(), String> {
    let old = read_prefs(&app)?;
    let mut prefs = prefs;
    // 자료 폴더는 move_data로만 바꿔요.
    prefs.data_dir = old.data_dir.clone();
    if prefs.ask_password != old.ask_password {
        if prefs.ask_password {
            keyring_delete();
        } else {
            // 열쇠를 윈도우 자격 증명 관리자에 맡겨요. 열려 있을 때만 할 수 있어요.
            let guard = state.store.lock().map_err(io)?;
            let store = guard.as_ref().ok_or_else(|| "locked".to_string())?;
            keyring_save(&store.key_hex())?;
        }
    }
    write_prefs(&app, &prefs)
}

// ---------- 윈도우 자격 증명 관리자 ----------

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("giLog", "data-key").map_err(|_| "keyring".to_string())
}

fn keyring_save(key_hex: &str) -> Result<(), String> {
    keyring_entry()?.set_password(key_hex).map_err(|_| "keyring".to_string())
}

fn keyring_load() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}

fn keyring_delete() {
    if let Ok(e) = keyring_entry() {
        let _ = e.delete_credential();
    }
}

// ---------- 자료 파일 열고 닫기 ----------

#[derive(Serialize)]
struct Status {
    exists: bool,
    unlocked: bool,
    folder: String,
}

#[tauri::command]
fn status(app: AppHandle, state: State<AppState>) -> Result<Status, String> {
    let dir = data_dir(&app)?;
    let unlocked = state.store.lock().map_err(io)?.is_some();
    Ok(Status {
        exists: gilog_core::exists(&dir),
        unlocked,
        folder: dir.to_string_lossy().to_string(),
    })
}

/// "앱을 열 때 암호 묻기"가 꺼져 있으면 자격 증명 관리자의 열쇠로 바로 열어요.
#[tauri::command]
fn auto_unlock(app: AppHandle, state: State<AppState>) -> Result<bool, String> {
    let prefs = read_prefs(&app)?;
    if prefs.ask_password {
        return Ok(false);
    }
    let Some(key) = keyring_load() else {
        return Ok(false);
    };
    let dir = data_dir(&app)?;
    match Store::open_with_key_hex(&dir, &key) {
        Ok(store) => {
            *state.store.lock().map_err(io)? = Some(store);
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

#[tauri::command]
fn create_store(app: AppHandle, state: State<AppState>, password: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let store = Store::create(&dir, &password).map_err(code)?;
    *state.store.lock().map_err(io)? = Some(store);
    Ok(())
}

#[tauri::command]
fn unlock(app: AppHandle, state: State<AppState>, password: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let store = Store::open(&dir, &password).map_err(code)?;
    *state.store.lock().map_err(io)? = Some(store);
    Ok(())
}

#[tauri::command]
fn lock(state: State<AppState>) -> Result<(), String> {
    *state.store.lock().map_err(io)? = None;
    Ok(())
}

#[tauri::command]
fn change_password(state: State<AppState>, old_password: String, new_password: String) -> Result<(), String> {
    let mut guard = state.store.lock().map_err(io)?;
    let store = guard.as_mut().ok_or_else(|| "locked".to_string())?;
    store.change_password(&old_password, &new_password).map_err(code)?;
    // 자격 증명 관리자에 맡긴 열쇠가 있으면 새 열쇠로 바꿔요.
    if keyring_load().is_some() {
        let _ = keyring_save(&store.key_hex());
    }
    Ok(())
}

#[tauri::command]
fn get_value(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let guard = state.store.lock().map_err(io)?;
    let store = guard.as_ref().ok_or_else(|| "locked".to_string())?;
    store.get(&key).map_err(code)
}

#[tauri::command]
fn set_value(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let guard = state.store.lock().map_err(io)?;
    let store = guard.as_ref().ok_or_else(|| "locked".to_string())?;
    store.set(&key, &value).map_err(code)
}

// ---------- 업무연락처 ----------
// 바꾸는 명령은 모두 바뀐 뒤의 연락처·프로젝트 전체를 돌려줘요. 화면은 그것으로 다시 그려요.

fn with_store<T>(state: &State<AppState>, f: impl FnOnce(&mut Store) -> gilog_core::Result<T>) -> Result<T, String> {
    let mut guard = state.store.lock().map_err(io)?;
    let store = guard.as_mut().ok_or_else(|| "locked".to_string())?;
    f(store).map_err(code)
}

#[tauri::command]
fn contacts_data(state: State<AppState>) -> Result<ContactsData, String> {
    with_store(&state, |s| s.contacts_data())
}

#[tauri::command]
fn add_contact(state: State<AppState>, contact: ContactInput) -> Result<ContactsData, String> {
    with_store(&state, |s| {
        s.add_contact(&contact)?;
        s.contacts_data()
    })
}

#[tauri::command]
fn update_contact(state: State<AppState>, id: i64, contact: ContactInput) -> Result<ContactsData, String> {
    with_store(&state, |s| {
        s.update_contact(id, &contact)?;
        s.contacts_data()
    })
}

#[tauri::command]
fn set_contact_memo(state: State<AppState>, id: i64, memo: String) -> Result<ContactsData, String> {
    with_store(&state, |s| {
        s.set_contact_memo(id, &memo)?;
        s.contacts_data()
    })
}

#[tauri::command]
fn delete_contact(state: State<AppState>, id: i64) -> Result<ContactsData, String> {
    with_store(&state, |s| {
        s.delete_contact(id)?;
        s.contacts_data()
    })
}

#[tauri::command]
fn add_project(state: State<AppState>, name: String) -> Result<ContactsData, String> {
    with_store(&state, |s| {
        s.add_project(&name)?;
        s.contacts_data()
    })
}

#[tauri::command]
fn set_project_color(state: State<AppState>, id: i64, color: Option<i64>) -> Result<ContactsData, String> {
    with_store(&state, |s| {
        s.set_project_color(id, color)?;
        s.contacts_data()
    })
}

#[tauri::command]
fn delete_project(state: State<AppState>, id: i64) -> Result<ContactsData, String> {
    with_store(&state, |s| {
        s.delete_project(id)?;
        s.contacts_data()
    })
}

// ---------- 한글 입력 ----------

/// 입력 칸에 들어갈 때 화면이 불러요. 메일 칸은 영문, 나머지는 한글이에요.
#[tauri::command]
fn set_ime(korean: bool) {
    ime::set_korean(korean);
}

// ---------- 업무일지 ----------
// 처음에 전체를 한 번 읽고, 바꾸는 명령은 바뀐 기록 하나(또는 머리 줄)만 돌려줘요.

#[tauri::command]
fn journal_data(state: State<AppState>) -> Result<JournalData, String> {
    with_store(&state, |s| s.journal_data())
}

#[tauri::command]
fn add_journal_entry(state: State<AppState>, entry: EntryInput) -> Result<Entry, String> {
    with_store(&state, |s| s.add_entry(&entry))
}

#[tauri::command]
fn update_journal_entry(state: State<AppState>, id: i64, entry: EntryInput) -> Result<Entry, String> {
    with_store(&state, |s| s.update_entry(id, &entry))
}

#[tauri::command]
fn delete_journal_entry(state: State<AppState>, id: i64) -> Result<(), String> {
    with_store(&state, |s| s.delete_entry(id))
}

#[tauri::command]
fn set_journal_day(state: State<AppState>, day: DayInfo) -> Result<DayInfo, String> {
    with_store(&state, |s| s.set_day(&day))
}

// ---------- 백업과 저장 위치 ----------

#[tauri::command]
fn export_backup(state: State<AppState>, path: String) -> Result<(), String> {
    let guard = state.store.lock().map_err(io)?;
    let store = guard.as_ref().ok_or_else(|| "locked".to_string())?;
    store.export_backup(&PathBuf::from(path)).map_err(code)
}

/// 백업을 불러오면 지금 자료가 백업 내용으로 바뀌고 앱이 잠겨요. 백업의 암호로 다시 열어야 해요.
#[tauri::command]
fn import_backup(app: AppHandle, state: State<AppState>, path: String, password: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let mut guard = state.store.lock().map_err(io)?;
    *guard = None;
    gilog_core::restore_backup(&dir, &PathBuf::from(path), &password).map_err(code)?;
    // 맡겨 둔 열쇠는 이제 맞지 않아요.
    keyring_delete();
    let mut prefs = read_prefs(&app)?;
    prefs.ask_password = true;
    write_prefs(&app, &prefs)
}

/// 자료 폴더를 옮겨요. 옮긴 뒤 앱이 잠겨요.
#[tauri::command]
fn move_data(app: AppHandle, state: State<AppState>, folder: String) -> Result<(), String> {
    let from = data_dir(&app)?;
    let to = PathBuf::from(&folder);
    if to == from {
        return Ok(());
    }
    let mut guard = state.store.lock().map_err(io)?;
    *guard = None;
    gilog_core::move_data(&from, &to).map_err(code)?;
    let mut prefs = read_prefs(&app)?;
    prefs.data_dir = folder;
    write_prefs(&app, &prefs)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { store: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            get_prefs,
            set_prefs,
            status,
            auto_unlock,
            create_store,
            unlock,
            lock,
            change_password,
            get_value,
            set_value,
            export_backup,
            import_backup,
            move_data,
            contacts_data,
            add_contact,
            update_contact,
            set_contact_memo,
            delete_contact,
            add_project,
            set_project_color,
            delete_project,
            journal_data,
            add_journal_entry,
            update_journal_entry,
            delete_journal_entry,
            set_journal_day,
            set_ime
        ])
        .run(tauri::generate_context!())
        .expect("giLog를 시작하지 못했어요");
}
