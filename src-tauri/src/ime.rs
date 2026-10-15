//! 윈도우 한글 입력기를 한글(또는 영문) 상태로 바꿔요.
//! 지금 커서가 있는 창의 입력기 창에 "변환 모드"를 묻고 바꾸는 메시지를 보내요. 다른 프로세스(WebView2)의 창에도 통해요.
//!
//! 0.6.0까지는 한 번만 바꿨는데, 다른 앱에서 돌아오는 순간에는 윈도우가 창 전환을 끝내기 전이라 빗나가거나
//! 윈도우가 그 뒤에 예전 상태(영문)를 되살려 영어로 입력되는 일이 있었어요(사용자 신고).
//! 그래서 giLog 창이 실제로 앞에 와 있을 때만 바꾸고, 조금씩 시간을 두고 몇 번 더 맞춰요.

/// 한 번 맞추는 사이 간격(밀리초). 바로, 그리고 창 전환이 끝날 만한 때까지 몇 번 더 맞춰요.
#[cfg(windows)]
const RETRY_MS: [u64; 5] = [0, 60, 150, 300, 600];

#[cfg(windows)]
mod win {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Input::Ime::ImmGetDefaultIMEWnd;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_KEYBOARD, KEYEVENTF_KEYUP};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, SendMessageW, GUITHREADINFO,
    };

    const WM_IME_CONTROL: u32 = 0x0283;
    const IMC_GETCONVERSIONMODE: usize = 0x0001;
    const IMC_SETCONVERSIONMODE: usize = 0x0002;
    const IME_CMODE_NATIVE: isize = 0x0001;

    /// 맨 앞 창이 giLog 창인지 봐요. (WebView2 화면은 다른 프로세스지만 맨 앞 창 자체는 giLog 거예요)
    pub fn ours_in_front() -> bool {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                return false;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(fg, &mut pid);
            pid == std::process::id()
        }
    }

    /// 앞에 있는 창의 스레드에서 커서가 있는 창을 찾아요. 없으면 앞 창을 써요.
    unsafe fn focus_target() -> HWND {
        let mut info: GUITHREADINFO = zeroed();
        info.cbSize = size_of::<GUITHREADINFO>() as u32;
        let mut target = GetForegroundWindow();
        if GetGUIThreadInfo(0, &mut info) != 0 && !info.hwndFocus.is_null() {
            target = info.hwndFocus;
        }
        target
    }

    /// 지금 커서가 있는 창의 입력기를 한글/영문으로 맞춰요. 맞출 창이 없으면 false예요.
    pub fn set_mode(korean: bool) -> bool {
        unsafe {
            let target = focus_target();
            if target.is_null() {
                return false;
            }
            let ime = ImmGetDefaultIMEWnd(target);
            if ime.is_null() {
                return false;
            }
            let mode = SendMessageW(ime, WM_IME_CONTROL, IMC_GETCONVERSIONMODE, 0);
            let want = if korean { mode | IME_CMODE_NATIVE } else { mode & !IME_CMODE_NATIVE };
            if want != mode {
                SendMessageW(ime, WM_IME_CONTROL, IMC_SETCONVERSIONMODE, want);
            }
            true
        }
    }

    /// 키 하나를 다시 누른 것처럼 보내요. 입력기가 한글로 바뀐 뒤라 한글 자모로 들어가요.
    pub fn press(vk: u16) {
        unsafe {
            let mut inputs: [INPUT; 2] = zeroed();
            for (i, up) in [false, true].into_iter().enumerate() {
                inputs[i].r#type = INPUT_KEYBOARD;
                inputs[i].Anonymous.ki.wVk = vk;
                inputs[i].Anonymous.ki.dwFlags = if up { KEYEVENTF_KEYUP } else { 0 };
            }
            SendInput(2, inputs.as_ptr(), size_of::<INPUT>() as i32);
        }
    }
}

/// 입력기를 한글(true) 또는 영문(false)으로 맞춰요. giLog 창이 앞에 올 때까지 기다렸다가, 몇 번 더 맞춰요.
/// 맞추라는 요청 번호. 새 요청이 오면 앞 요청의 남은 재시도는 멈춰요(한글 칸 → 메일 칸으로 빨리 옮겨도 뒤집히지 않게).
#[cfg(windows)]
static GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(windows)]
pub fn set_korean(korean: bool) {
    use std::sync::atomic::Ordering;
    let me = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let mut last = 0u64;
        for ms in RETRY_MS {
            std::thread::sleep(std::time::Duration::from_millis(ms - last));
            last = ms;
            if GEN.load(Ordering::SeqCst) != me {
                return;
            }
            if win::ours_in_front() {
                win::set_mode(korean);
            }
        }
    });
}

/// 한글 칸인데 영문 상태로 글자가 들어오려 할 때: 한글로 바꾸고 그 키를 다시 보내 한글 자모로 들어가게 해요.
/// vk는 그 키의 윈도우 키 번호예요(A~Z는 대문자 글자 번호).
#[cfg(windows)]
pub fn retype_korean(vk: u16) {
    if !win::ours_in_front() {
        return;
    }
    win::set_mode(true);
    win::press(vk);
    // 그 뒤에 윈도우가 상태를 되돌리지 않게 한 번 더 맞춰요.
    set_korean(true);
}

#[cfg(not(windows))]
pub fn set_korean(_korean: bool) {}

#[cfg(not(windows))]
pub fn retype_korean(_vk: u16) {}
