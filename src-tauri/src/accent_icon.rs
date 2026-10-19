//! 강조색에 맞춘 앱 아이콘 — 작업표시줄·창 제목·트레이(2026-10-19 사용자: 테마와 무관하게 보라로 보였어요).
//! 그림은 `tools/brand/accent_icons.py`가 손 맞춤 아이콘(brand/icons)의 색만 바꿔 만든 `icons/accent/<색>-<크기>.png`예요.
//! - 트레이: 트레이 아이콘을 그 색 그림으로 바꿔요.
//! - 창: Tauri의 `set_icon`은 제목줄용 작은 아이콘만 바꿔요. 작업표시줄은 큰 아이콘(ICON_BIG)을 쓰니
//!   윈도우에 큰·작은 아이콘을 직접 넣어요(WM_SETICON).
//! - 바로가기(2026-10-19 사용자: 바로가기도 보라): exe 안 그림은 바꿀 수 없으니 색마다 .ico를 AppData에 두고,
//!   기록 exe를 가리키는 바로가기(바탕화면·시작 메뉴·작업표시줄 고정)의 아이콘을 그 파일로 바꿔요. 보라면 exe 그림으로 되돌려요.
//! 설치 파일과 exe 파일 자체의 아이콘은 보라 그대로예요.
use tauri::image::Image;
use tauri::{AppHandle, Manager};

const SIZES: [u32; 10] = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

macro_rules! set {
    ($n:literal) => {
        [
            include_bytes!(concat!("../icons/accent/", $n, "-16.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-20.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-24.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-32.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-40.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-48.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-64.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-96.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-128.png")).as_slice(),
            include_bytes!(concat!("../icons/accent/", $n, "-256.png")).as_slice(),
        ]
    };
}

static PURPLE: [&[u8]; 10] = set!("purple");
static NOCTUA: [&[u8]; 10] = set!("noctua");
static BLUE: [&[u8]; 10] = set!("blue");
static INK: [&[u8]; 10] = set!("ink");

fn table(accent: &str) -> &'static [&'static [u8]; 10] {
    match accent {
        "noctua" => &NOCTUA,
        "blue" => &BLUE,
        "ink" => &INK,
        _ => &PURPLE,
    }
}

/// 원하는 크기와 같거나 바로 큰 그림(없으면 가장 큰 것)과 그 크기.
fn pick(accent: &str, want: u32) -> (&'static [u8], u32) {
    let t = table(accent);
    let i = SIZES.iter().position(|&s| s >= want).unwrap_or(SIZES.len() - 1);
    (t[i], SIZES[i])
}

/// 트레이 아이콘 크기(작은 아이콘, 100% 16 · 125% 20 · 150% 24 · 200% 32).
fn tray_size() -> u32 {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON};
        let s = GetSystemMetrics(SM_CXSMICON);
        if s > 0 {
            return s as u32;
        }
    }
    32
}

#[cfg_attr(not(windows), allow(dead_code))]
fn ico(accent: &str) -> &'static [u8] {
    match accent {
        "noctua" => include_bytes!("../icons/accent/noctua.ico"),
        "blue" => include_bytes!("../icons/accent/blue.ico"),
        "ink" => include_bytes!("../icons/accent/ink.ico"),
        _ => include_bytes!("../icons/accent/purple.ico"),
    }
}

/// 강조색에 맞춰 트레이·창(작업표시줄)·바로가기 아이콘을 바꿔요. 앱을 켤 때와 설정에서 강조색을 바꿀 때 불러요.
pub fn apply(app: &AppHandle, accent: &str) {
    #[cfg(windows)]
    {
        // 바로가기는 파일을 읽고 쓰니 따로 돌려요(창이 기다리지 않게).
        let dir = app.path().app_config_dir().ok();
        let accent = accent.to_string();
        std::thread::spawn(move || {
            if let Some(dir) = dir {
                shortcuts::update(&dir, &accent);
            }
        });
    }
    if let Some(tray) = app.tray_by_id("main") {
        let (png, _) = pick(accent, tray_size());
        if let Ok(img) = Image::from_bytes(png) {
            let _ = tray.set_icon(Some(img));
        }
    }
    if let Some(w) = app.get_webview_window(crate::window::LABEL) {
        #[cfg(windows)]
        {
            if let Ok(hwnd) = w.hwnd() {
                win::set(hwnd.0 as _, accent);
                return;
            }
        }
        let (png, _) = pick(accent, 32);
        if let Ok(img) = Image::from_bytes(png) {
            let _ = w.set_icon(img);
        }
    }
}

#[cfg(windows)]
mod win {
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateIconFromResourceEx, DestroyIcon, SendMessageW, HICON, ICON_BIG, ICON_SMALL, LR_DEFAULTCOLOR, SM_CXICON,
        SM_CXSMICON, WM_SETICON,
    };

    /// 지금 창에 넣어 둔 아이콘(바꿀 때 앞의 것을 지워요).
    static HELD: Mutex<(usize, usize)> = Mutex::new((0, 0));

    fn make(accent: &str, size: i32) -> HICON {
        let (png, _) = super::pick(accent, size.max(16) as u32);
        // PNG를 그대로 아이콘으로 만들어요(윈도우 비스타부터 됨). 0x00030000 = 아이콘 자료 버전.
        unsafe { CreateIconFromResourceEx(png.as_ptr(), png.len() as u32, 1, 0x0003_0000, size, size, LR_DEFAULTCOLOR) }
    }

    pub fn set(hwnd: HWND, accent: &str) {
        unsafe {
            let dpi = GetDpiForWindow(hwnd);
            let dpi = if dpi == 0 { 96 } else { dpi };
            let big = GetSystemMetricsForDpi(SM_CXICON, dpi).max(32);
            let small = GetSystemMetricsForDpi(SM_CXSMICON, dpi).max(16);
            let hb = make(accent, big);
            let hs = make(accent, small);
            if !hb.is_null() {
                SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, hb as isize);
            }
            if !hs.is_null() {
                SendMessageW(hwnd, WM_SETICON, ICON_SMALL as usize, hs as isize);
            }
            if let Ok(mut g) = HELD.lock() {
                let (ob, os) = *g;
                if ob != 0 && !hb.is_null() {
                    DestroyIcon(ob as HICON);
                }
                if os != 0 && !hs.is_null() {
                    DestroyIcon(os as HICON);
                }
                *g = (
                    if hb.is_null() { ob } else { hb as usize },
                    if hs.is_null() { os } else { hs as usize },
                );
            }
        }
    }
}

/// 기록 exe를 가리키는 바로가기의 아이콘을 강조색 .ico로 바꿔요(보라면 exe 그림으로 되돌림).
#[cfg(windows)]
mod shortcuts {
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHChangeNotify, SHGetKnownFolderPath, ShellLink, FOLDERID_Desktop, FOLDERID_Programs, FOLDERID_RoamingAppData,
        KF_FLAG_DEFAULT, SHCNE_ASSOCCHANGED, SHCNF_IDLIST,
    };

    fn known(id: &windows::core::GUID) -> Option<PathBuf> {
        unsafe {
            let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
            let s = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as *const core::ffi::c_void));
            s.map(PathBuf::from)
        }
    }

    /// 폴더 안 .lnk(하위 폴더 한 단계까지).
    fn links(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                if depth > 0 {
                    links(&p, depth - 1, out);
                }
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
                out.push(p);
            }
        }
    }

    fn same(a: &str, b: &Path) -> bool {
        let a = a.trim().trim_matches('"').replace('/', "\\");
        a.eq_ignore_ascii_case(&b.to_string_lossy().replace('/', "\\"))
    }

    fn text(buf: &[u16]) -> String {
        let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..n])
    }

    pub fn update(config_dir: &Path, accent: &str) {
        let Ok(exe) = std::env::current_exe() else { return };
        let exe = std::fs::canonicalize(&exe).map(|p| PathBuf::from(p.to_string_lossy().trim_start_matches(r"\\?\").to_string())).unwrap_or(exe);
        // 보라 = exe 안 그림(처음과 같게), 다른 색 = AppData\kr.gilog.app\icons\<색>.ico
        let (icon, index) = if !matches!(accent, "noctua" | "blue" | "ink") {
            (exe.clone(), 0)
        } else {
            let dir = config_dir.join("icons");
            let _ = std::fs::create_dir_all(&dir);
            let file = dir.join(format!("{accent}.ico"));
            let data = super::ico(accent);
            if std::fs::metadata(&file).map(|m| m.len() as usize != data.len()).unwrap_or(true) && std::fs::write(&file, data).is_err() {
                return;
            }
            (file, 0)
        };
        let mut found = Vec::new();
        if let Some(d) = known(&FOLDERID_Desktop) {
            links(&d, 0, &mut found);
        }
        if let Some(d) = known(&FOLDERID_Programs) {
            links(&d, 1, &mut found);
        }
        if let Some(d) = known(&FOLDERID_RoamingAppData) {
            links(&d.join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"), 0, &mut found);
        }
        let mut changed = false;
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            for lnk in found {
                let link: IShellLinkW = match CoCreateInstance(&ShellLink as *const _, None, CLSCTX_INPROC_SERVER) {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                let Ok(file) = link.cast::<IPersistFile>() else { continue };
                let path = HSTRING::from(lnk.as_os_str());
                if file.Load(&path, STGM_READWRITE).is_err() {
                    continue;
                }
                let mut target = [0u16; 1024];
                if link.GetPath(&mut target, std::ptr::null_mut(), 0).is_err() || !same(&text(&target), &exe) {
                    continue;
                }
                let mut cur = [0u16; 1024];
                let mut cur_index = 0i32;
                let _ = link.GetIconLocation(&mut cur, &mut cur_index);
                let cur = text(&cur);
                let now_default = cur.is_empty() || same(&cur, &exe);
                let want_default = icon == exe;
                if (want_default && now_default && cur_index == 0) || (!want_default && same(&cur, &icon) && cur_index == index) {
                    continue;
                }
                if link.SetIconLocation(&HSTRING::from(icon.as_os_str()), index).is_ok() && file.Save(&path, true).is_ok() {
                    changed = true;
                }
            }
            if changed {
                // 탐색기·작업표시줄이 아이콘을 다시 읽게 알려요.
                SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
            }
        }
    }
}
