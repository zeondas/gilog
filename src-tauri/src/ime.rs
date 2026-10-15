//! 윈도우 한글 입력기를 한글(또는 영문) 상태로 바꿔요.
//! 지금 커서가 있는 창의 입력기 창에 "변환 모드"를 묻고 바꾸는 메시지를 보내요. 다른 프로세스(WebView2)의 창에도 통해요.
#[cfg(windows)]
pub fn set_korean(korean: bool) {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::UI::Input::Ime::ImmGetDefaultIMEWnd;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetGUIThreadInfo, SendMessageW, GUITHREADINFO};

    const WM_IME_CONTROL: u32 = 0x0283;
    const IMC_GETCONVERSIONMODE: usize = 0x0001;
    const IMC_SETCONVERSIONMODE: usize = 0x0002;
    const IME_CMODE_NATIVE: isize = 0x0001;

    unsafe {
        // 앞에 있는 창의 스레드에서 커서가 있는 창을 찾아요. 없으면 앞 창을 써요.
        let mut info: GUITHREADINFO = zeroed();
        info.cbSize = size_of::<GUITHREADINFO>() as u32;
        let mut target = GetForegroundWindow();
        if GetGUIThreadInfo(0, &mut info) != 0 && !info.hwndFocus.is_null() {
            target = info.hwndFocus;
        }
        if target.is_null() {
            return;
        }
        let ime = ImmGetDefaultIMEWnd(target);
        if ime.is_null() {
            return;
        }
        let mode = SendMessageW(ime, WM_IME_CONTROL, IMC_GETCONVERSIONMODE, 0);
        let want = if korean { mode | IME_CMODE_NATIVE } else { mode & !IME_CMODE_NATIVE };
        if want != mode {
            SendMessageW(ime, WM_IME_CONTROL, IMC_SETCONVERSIONMODE, want);
        }
    }
}

#[cfg(not(windows))]
pub fn set_korean(_korean: bool) {}
