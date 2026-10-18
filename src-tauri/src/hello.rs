//! 윈도우 PIN(Windows Hello)으로 잠금 풀기 (2026-10-18 사용자 결정, 사양서 "저장과 암호화").
//!
//! - 처음 값은 꺼짐. 켜면 비밀번호를 한 번 확인 → Hello 확인 창 → 비밀번호를 이 PC의 윈도우 계정에 묶어
//!   (DPAPI) 자료 파일 밖 AppData의 `pin.bin`에 둬요. 다른 PC·다른 윈도우 계정에서는 꺼낼 수 없어요.
//! - 잠금 화면은 늘 비밀번호 칸이 먼저이고, 켜져 있으면 "PIN으로 풀기"를 눌러 Hello 창을 띄워요.
//! - 보관한 비밀번호로 열지 못하면(다른 PC에서 비밀번호를 바꾼 경우) PIN 풀기를 끄고 "pin_stale"을 돌려줘요.
//! - 비밀번호를 바꾸면 화면이 `pin_rekey`를 불러 Hello를 한 번 더 받고 새 비밀번호로 바꿔 보관해요.
//!
//! 실패 이름: hello_unavailable(이 PC에서 못 씀) · hello_canceled(취소) · hello_failed(그 밖) · pin_stale · pin_off

use std::fs;
use std::path::PathBuf;

use gilog_core::Store;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{data_dir, io, read_prefs, write_prefs, AppState};

fn blob_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(io)?;
    fs::create_dir_all(&dir).map_err(io)?;
    Ok(dir.join("pin.bin"))
}

/// 보관한 비밀번호를 지우고 설정을 꺼요.
pub(crate) fn turn_off(app: &AppHandle) -> Result<(), String> {
    if let Ok(p) = blob_path(app) {
        let _ = fs::remove_file(p);
    }
    let mut prefs = read_prefs(app)?;
    if prefs.pin_unlock {
        prefs.pin_unlock = false;
        write_prefs(app, &prefs)?;
    }
    Ok(())
}

fn is_on(app: &AppHandle) -> bool {
    read_prefs(app).map(|p| p.pin_unlock).unwrap_or(false) && blob_path(app).map(|p| p.is_file()).unwrap_or(false)
}

/// Hello 창을 띄우고 끝날 때까지 기다려요(화면 줄을 막지 않게 따로 돌려요).
async fn verify(window: &WebviewWindow, message: &str) -> Result<(), String> {
    let hwnd = os::hwnd_of(window);
    let message = message.to_string();
    tauri::async_runtime::spawn_blocking(move || os::verify(hwnd, &message))
        .await
        .map_err(|_| "hello_failed".to_string())?
}

#[derive(Serialize)]
pub(crate) struct PinStatus {
    /// 이 PC에서 Hello를 쓸 수 있는지(PIN이 없거나 회사 정책으로 막히면 false)
    available: bool,
    /// 켜져 있고 보관한 비밀번호가 있는지
    on: bool,
}

#[tauri::command]
pub(crate) async fn pin_status(app: AppHandle) -> Result<PinStatus, String> {
    let available = tauri::async_runtime::spawn_blocking(os::available).await.unwrap_or(false);
    Ok(PinStatus { available, on: is_on(&app) })
}

/// 켜기: 비밀번호 확인 → Hello → 보관. 앱이 열려 있을 때만 해요.
#[tauri::command]
pub(crate) async fn pin_enable(app: AppHandle, window: WebviewWindow, password: String) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let guard = state.store.lock().map_err(io)?;
        let store = guard.as_ref().ok_or_else(|| "locked".to_string())?;
        store.check_password(&password).map_err(crate::code)?;
    }
    verify(&window, "기록 잠금을 윈도우 PIN으로 풀 수 있게 해요.").await?;
    let blob = os::protect(password.as_bytes())?;
    fs::write(blob_path(&app)?, blob).map_err(io)?;
    let mut prefs = read_prefs(&app)?;
    prefs.pin_unlock = true;
    write_prefs(&app, &prefs)
}

#[tauri::command]
pub(crate) fn pin_disable(app: AppHandle) -> Result<(), String> {
    turn_off(&app)
}

/// 잠금 화면 "PIN으로 풀기": Hello → 보관한 비밀번호로 열기.
#[tauri::command]
pub(crate) async fn pin_unlock(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !is_on(&app) {
        turn_off(&app)?;
        return Err("pin_stale".into());
    }
    verify(&window, "기록 잠금을 풀어요.").await?;
    let blob = fs::read(blob_path(&app)?).map_err(io)?;
    let password = match os::unprotect(&blob).ok().and_then(|b| String::from_utf8(b).ok()) {
        Some(p) => p,
        None => {
            turn_off(&app)?;
            return Err("pin_stale".into());
        }
    };
    let dir = data_dir(&app)?;
    match Store::open(&dir, &password) {
        Ok(store) => {
            *app.state::<AppState>().store.lock().map_err(io)? = Some(store);
            Ok(())
        }
        Err(gilog_core::Error::WrongPassword) => {
            turn_off(&app)?;
            Err("pin_stale".into())
        }
        Err(e) => Err(crate::code(e)),
    }
}

/// 비밀번호를 바꾼 뒤: 켜져 있으면 Hello를 한 번 더 받고 새 비밀번호로 바꿔 보관해요.
/// 취소하면 옛 비밀번호가 남지 않게 끄고 "pin_off"를 돌려줘요. 꺼져 있으면 아무것도 안 해요.
#[tauri::command]
pub(crate) async fn pin_rekey(app: AppHandle, window: WebviewWindow, password: String) -> Result<(), String> {
    if !is_on(&app) {
        return Ok(());
    }
    {
        let state = app.state::<AppState>();
        let guard = state.store.lock().map_err(io)?;
        let store = guard.as_ref().ok_or_else(|| "locked".to_string())?;
        store.check_password(&password).map_err(crate::code)?;
    }
    if verify(&window, "새 비밀번호를 PIN 풀기용으로 다시 보관해요.").await.is_err() {
        turn_off(&app)?;
        return Err("pin_off".into());
    }
    match os::protect(password.as_bytes()).and_then(|b| fs::write(blob_path(&app)?, b).map_err(io)) {
        Ok(()) => Ok(()),
        Err(_) => {
            turn_off(&app)?;
            Err("pin_off".into())
        }
    }
}

#[cfg(windows)]
mod os {
    use std::ffi::c_void;

    use windows::core::{factory, HSTRING};
    use windows_future::IAsyncOperation;
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability};
    use windows::Win32::Foundation::{LocalFree, HLOCAL, HWND};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    /// 보관한 것을 다른 앱이 같은 계정으로 꺼내기 조금 더 어렵게 섞는 값이에요.
    const ENTROPY: &[u8] = b"kr.gilog.app/pin-unlock";

    pub fn hwnd_of(window: &tauri::WebviewWindow) -> isize {
        window.hwnd().map(|h| h.0 as isize).unwrap_or(0)
    }

    pub fn available() -> bool {
        UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.get())
            .map(|a| a == UserConsentVerifierAvailability::Available)
            .unwrap_or(false)
    }

    pub fn verify(hwnd: isize, message: &str) -> Result<(), String> {
        if !available() {
            return Err("hello_unavailable".into());
        }
        let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>().map_err(|_| "hello_failed".to_string())?;
        // 데스크톱 앱은 창 손잡이를 줘야 Hello 창이 앱 창 위에 떠요.
        let op: IAsyncOperation<UserConsentVerificationResult> =
            unsafe { interop.RequestVerificationForWindowAsync(HWND(hwnd as *mut c_void), &HSTRING::from(message)) }
                .map_err(|_| "hello_failed".to_string())?;
        match op.get() {
            Ok(UserConsentVerificationResult::Verified) => Ok(()),
            Ok(UserConsentVerificationResult::Canceled) => Err("hello_canceled".into()),
            Ok(UserConsentVerificationResult::DeviceNotPresent)
            | Ok(UserConsentVerificationResult::NotConfiguredForUser)
            | Ok(UserConsentVerificationResult::DisabledByPolicy) => Err("hello_unavailable".into()),
            _ => Err("hello_failed".into()),
        }
    }

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
    }

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut c_void)));
        v
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptProtectData(&input, &HSTRING::from("giLog"), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                .map_err(|_| "pin_off".to_string())?;
            Ok(take(out))
        }
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        let input = blob(data);
        let entropy = blob(ENTROPY);
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                .map_err(|_| "pin_stale".to_string())?;
            Ok(take(out))
        }
    }
}

/// 리눅스 작업 공간: 컴파일만 되게 막아 둬요(브라우저 미리 보기는 api.ts가 흉내 내요).
#[cfg(not(windows))]
mod os {
    pub fn hwnd_of(_: &tauri::WebviewWindow) -> isize {
        0
    }
    pub fn available() -> bool {
        false
    }
    pub fn verify(_: isize, _: &str) -> Result<(), String> {
        Err("hello_unavailable".into())
    }
    pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("pin_off".into())
    }
    pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
        Err("pin_stale".into())
    }
}
