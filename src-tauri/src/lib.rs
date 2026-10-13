use std::path::PathBuf;
use std::sync::Mutex;

use gilog_core::Store;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// 열려 있는 자료 파일을 들고 있어요. None이면 잠긴 상태예요.
struct AppState {
    store: Mutex<Option<Store>>,
}

/// 자료를 두는 폴더예요. 문서\giLog
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .map(|d| d.join("giLog"))
        .map_err(|_| "io".to_string())
}

fn code(e: gilog_core::Error) -> String {
    e.code().to_string()
}

#[derive(Serialize)]
struct Status {
    /// 자료 파일이 이미 만들어져 있는지
    exists: bool,
    /// 지금 열려 있는지
    unlocked: bool,
    /// 자료 폴더 경로 (화면에 보여 주는 용도)
    folder: String,
}

#[tauri::command]
fn status(app: AppHandle, state: State<AppState>) -> Result<Status, String> {
    let dir = data_dir(&app)?;
    let unlocked = state.store.lock().map_err(|_| "io".to_string())?.is_some();
    Ok(Status {
        exists: gilog_core::exists(&dir),
        unlocked,
        folder: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn create_store(app: AppHandle, state: State<AppState>, password: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let store = Store::create(&dir, &password).map_err(code)?;
    *state.store.lock().map_err(|_| "io".to_string())? = Some(store);
    Ok(())
}

#[tauri::command]
fn unlock(app: AppHandle, state: State<AppState>, password: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let store = Store::open(&dir, &password).map_err(code)?;
    *state.store.lock().map_err(|_| "io".to_string())? = Some(store);
    Ok(())
}

#[tauri::command]
fn lock(state: State<AppState>) -> Result<(), String> {
    // 들고 있던 것을 버리면 파일이 닫히고 열쇠도 메모리에서 사라져요.
    *state.store.lock().map_err(|_| "io".to_string())? = None;
    Ok(())
}

#[tauri::command]
fn change_password(
    state: State<AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let mut guard = state.store.lock().map_err(|_| "io".to_string())?;
    let store = guard.as_mut().ok_or_else(|| "locked".to_string())?;
    store.change_password(&old_password, &new_password).map_err(code)
}

#[tauri::command]
fn get_value(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    let guard = state.store.lock().map_err(|_| "io".to_string())?;
    let store = guard.as_ref().ok_or_else(|| "locked".to_string())?;
    store.get(&key).map_err(code)
}

#[tauri::command]
fn set_value(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let guard = state.store.lock().map_err(|_| "io".to_string())?;
    let store = guard.as_ref().ok_or_else(|| "locked".to_string())?;
    store.set(&key, &value).map_err(code)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            store: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            status,
            create_store,
            unlock,
            lock,
            change_password,
            get_value,
            set_value
        ])
        .run(tauri::generate_context!())
        .expect("giLog를 시작하지 못했어요");
}
