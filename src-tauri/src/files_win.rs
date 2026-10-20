//! 탐색기의 윈도우 전용 부분: 드라이브 목록, 기본 프로그램으로 열기, 윈도우 아이콘, 윈도우 우클릭 메뉴.
//!
//! - 우클릭 메뉴(2026-10-18 사용자 2안): 윈도우 탐색기와 같은 메뉴를 그대로 띄워요(윈도우 11의 짧은 메뉴가 아니라
//!   "더 많은 옵션 표시"의 전체 메뉴). 회사 보안 프로그램이 넣은 보안 해제 항목도 여기 나와야 해요 —
//!   보안 프로그램이 윈도우 탐색기에서만 보이게 막았다면 안 나올 수 있어요(회사 PC DrmMenuCheck로 확인).
//!   "보내기"처럼 하위 메뉴를 늦게 채우는 항목을 위해 메뉴가 떠 있는 동안 창 메시지를 메뉴에 넘겨요.
//!   "이름 바꾸기"는 윈도우가 기록 화면 안에서 할 수 없어 화면에 F2로 넘겨요.
//! - 아이콘: 윈도우가 그 확장자(폴더)에 쓰는 아이콘을 받아 PNG로 바꿔 화면에 넘겨요(확장자마다 한 번).
//! 리눅스 작업 공간에서는 시험할 수 없어요 — 윈도우에서 확인할 것(시험 항목).

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;

use windows::core::{Interface, PCSTR, PCWSTR, PSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL,
    FILE_FLAGS_AND_ATTRIBUTES,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_APPS, VK_SHIFT,
};
use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    DefSubclassProc, ILFree, IContextMenu, IContextMenu2, IContextMenu3, IShellFolder, RemoveWindowSubclass, SHBindToObject,
    SHGetFileInfoW, SHGetImageList, SHOpenFolderAndSelectItems, SHParseDisplayName, SetWindowSubclass, ShellExecuteW, CMF_EXPLORE, CMF_EXTENDEDVERBS, CMF_NORMAL, CMIC_MASK_PTINVOKE,
    CMINVOKECOMMANDINFO, CMINVOKECOMMANDINFOEX, GCS_VERBW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_OVERLAYINDEX, SHGFI_SMALLICON,
    SHGFI_SYSICONINDEX, SHGFI_TYPENAME, SHGFI_USEFILEATTRIBUTES, SHIL_EXTRALARGE, SHIL_JUMBO, SHIL_LARGE, SHIL_SMALL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CreatePopupMenu, DestroyIcon, DestroyMenu, GetClassNameW, GetCursorPos, GetForegroundWindow, GetIconInfo, TrackPopupMenuEx,
    HICON, ICONINFO, MF_SEPARATOR, MF_STRING, SW_SHOWNORMAL, TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_DRAWITEM, WM_INITMENUPOPUP, WM_MEASUREITEM, WM_MENUCHAR,
};

use crate::files::Drive;

/// 유니코드 글자로 부르기(SEE_MASK_UNICODE와 같은 값, windows 크레이트에 이름이 없어요)
const CMIC_MASK_UNICODE: u32 = 0x0000_4000;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn from_wide(b: &[u16]) -> String {
    let n = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf16_lossy(&b[..n])
}

pub fn drives() -> Vec<Drive> {
    let mut out = Vec::new();
    let mask = unsafe { GetLogicalDrives() };
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        let root = format!("{letter}:\\");
        let w = wide(&root);
        let kind = match unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) } {
            2 => "removable",
            3 => "fixed",
            4 => "network",
            5 => "cdrom",
            _ => "other",
        };
        let mut label = [0u16; 261];
        // 빈 DVD 등은 읽지 못해요 — 이름 없이 두어요.
        let _ = unsafe { GetVolumeInformationW(PCWSTR(w.as_ptr()), Some(&mut label), None, None, None, None) };
        let (mut free, mut total) = (0u64, 0u64);
        let _ = unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), Some(&mut total), None) };
        out.push(Drive { name: format!("{letter}:"), path: root, label: from_wide(&label), kind: kind.into(), free, total });
    }
    out
}

/// 윈도우 기본 프로그램으로 열기
pub fn shell_open(path: &str) -> Result<(), String> {
    let p = wide(path);
    let op = wide("open");
    let r = unsafe { ShellExecuteW(None, PCWSTR(op.as_ptr()), PCWSTR(p.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    // 32보다 크면 성공이에요.
    if r.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!("open:{}", r.0 as isize))
    }
}

// ---------- 아이콘 ----------

/// 키마다 그 파일·폴더의 윈도우 아이콘을 PNG(data:) 주소로 돌려줘요.
/// 키: "<dir>" 폴더 일반(브라우저 미리 보기용 뒤받침), ".pptx" 확장자(실제 파일이 없을 때), 그 밖에는 실제 경로.
///
/// 실제 경로는 윈도우 탐색기처럼 **그 파일에 붙은 아이콘**을 받아요(한컴·보안 프로그램이 파일에 심은 아이콘,
/// 특수 폴더·바로가기 화살표·보안 자물쇠 오버레이까지). 받아 두는 열쇠는 "확장자"가 아니라
/// **시스템 아이콘 번호 + 오버레이 번호**예요 — 윈도우도 이렇게 같은 그림을 나눠 써서, 파일 2,000개여도
/// 번호 조회만 파일마다, PNG 변환은 번호 조합마다 한 번이에요(2026-10-19 탐색기 아이콘 세션).
pub fn icons(keys: &[String], size: u32) -> HashMap<String, String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD;
    // 셸 COM(이미지 리스트·오버레이)을 쓰니 이 블로킹 스레드에서 COM을 켜요.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }
    // 보이는 크기보다 한 단계 큰 그림을 받아 또렷하게(16→작은16·32→큰32·48→특대48·그 위→점보256).
    let shil = if size <= 16 {
        SHIL_SMALL
    } else if size <= 32 {
        SHIL_LARGE
    } else if size <= 48 {
        SHIL_EXTRALARGE
    } else {
        SHIL_JUMBO
    };
    let iml: Option<IImageList> = unsafe { SHGetImageList(shil as i32).ok() };
    let mut out = HashMap::new();
    // (아이콘 번호, 오버레이 번호) → PNG data: 주소. 같은 조합은 한 번만 만들어요.
    let mut combo: HashMap<(i32, u32), String> = HashMap::new();
    for k in keys {
        let data = if let Some((idx, ov)) = sys_icon_index(k) {
            if let Some(d) = combo.get(&(idx, ov)) {
                Some(d.clone())
            } else if let Some(png) = iml.as_ref().and_then(|l| unsafe { imagelist_png(l, idx, ov) }) {
                let d = format!("data:image/png;base64,{}", b64.encode(png));
                combo.insert((idx, ov), d.clone());
                Some(d)
            } else {
                None
            }
        } else {
            None
        };
        // 번호 조회가 안 되면(이미지 리스트 실패 등) 예전 방식으로 그 하나만 받아요.
        let data = data.or_else(|| icon_png_direct(k, size).map(|png| format!("data:image/png;base64,{}", b64.encode(png))));
        if let Some(d) = data {
            out.insert(k.clone(), d);
        }
    }
    out
}

/// 키의 시스템 아이콘 번호와 오버레이 번호(1~15, 없으면 0)를 받아요. 실제 경로만 오버레이가 나와요.
fn sys_icon_index(key: &str) -> Option<(i32, u32)> {
    let (path, attrs, use_attrs) = key_to_path(key);
    let w = wide(&path);
    let mut info = SHFILEINFOW::default();
    let mut flags = SHGFI_SYSICONINDEX | SHGFI_OVERLAYINDEX;
    if use_attrs {
        flags |= SHGFI_USEFILEATTRIBUTES;
    }
    let ok = unsafe { SHGetFileInfoW(PCWSTR(w.as_ptr()), attrs, Some(&mut info), std::mem::size_of::<SHFILEINFOW>() as u32, flags) };
    if ok == 0 {
        return None;
    }
    // 오버레이 번호는 iIcon의 위 8비트((iIcon >> 24) & 0xFF)에 들어와요(1~15, 없으면 0).
    let idx = info.iIcon & 0x00FF_FFFF;
    let ov = ((info.iIcon >> 24) & 0xFF) as u32;
    Some((idx, ov))
}

/// 시스템 이미지 리스트에서 번호 idx의 아이콘(오버레이 ov 합성 포함)을 받아 PNG로 바꿔요.
unsafe fn imagelist_png(iml: &IImageList, idx: i32, ov: u32) -> Option<Vec<u8>> {
    unsafe {
        // ILD_TRANSPARENT + 오버레이 번호를 위 자리에 담으면(INDEXTOOVERLAYMASK = ov << 8) 오버레이까지 그려 줘요.
        let flags = ILD_TRANSPARENT.0 | if ov != 0 { ov << 8 } else { 0 };
        let icon = iml.GetIcon(idx, flags).ok()?;
        let png = hicon_to_png(icon);
        let _ = DestroyIcon(icon);
        png
    }
}

/// 키 → (아이콘을 물을 경로, 파일 속성, USEFILEATTRIBUTES 여부)
fn key_to_path(key: &str) -> (String, FILE_FLAGS_AND_ATTRIBUTES, bool) {
    if key == "<dir>" {
        ("folder".to_string(), FILE_ATTRIBUTE_DIRECTORY, true)
    } else if key.starts_with('.') {
        (format!("a{key}"), FILE_ATTRIBUTE_NORMAL, true)
    } else {
        (key.to_string(), FILE_ATTRIBUTE_NORMAL, false)
    }
}

/// 뒤받침: 이미지 리스트를 못 쓸 때 그 하나의 아이콘 핸들을 바로 받아요(오버레이 없음).
fn icon_png_direct(key: &str, size: u32) -> Option<Vec<u8>> {
    let (path, attrs, use_attrs) = key_to_path(key);
    let w = wide(&path);
    let mut info = SHFILEINFOW::default();
    let mut flags = SHGFI_ICON | if size <= 16 { SHGFI_SMALLICON } else { SHGFI_LARGEICON };
    if use_attrs {
        flags |= SHGFI_USEFILEATTRIBUTES;
    }
    let ok = unsafe { SHGetFileInfoW(PCWSTR(w.as_ptr()), attrs, Some(&mut info), std::mem::size_of::<SHFILEINFOW>() as u32, flags) };
    if ok == 0 || info.hIcon.is_invalid() {
        return None;
    }
    let png = unsafe { hicon_to_png(info.hIcon) };
    unsafe {
        let _ = DestroyIcon(info.hIcon);
    }
    png
}

unsafe fn bitmap_bgra(hbm: windows::Win32::Graphics::Gdi::HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut bm = BITMAP::default();
        if GetObjectW(HGDIOBJ(hbm.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void)) == 0 {
            return None;
        }
        let (w, h) = (bm.bmWidth as u32, bm.bmHeight as u32);
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w as i32,
            biHeight: -(h as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let dc = CreateCompatibleDC(None);
        let n = GetDIBits(dc, hbm, 0, h, Some(buf.as_mut_ptr() as *mut c_void), &mut bmi, DIB_RGB_COLORS);
        let _ = DeleteDC(dc);
        if n == 0 {
            return None;
        }
        Some((w, h, buf))
    }
}

unsafe fn hicon_to_png(icon: HICON) -> Option<Vec<u8>> {
    unsafe {
        let mut ii = ICONINFO::default();
        GetIconInfo(icon, &mut ii).ok()?;
        let color = bitmap_bgra(ii.hbmColor);
        let mask = bitmap_bgra(ii.hbmMask);
        let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0));
        let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0));
        let (w, h, mut px) = color?;
        // 알파가 모두 0인 옛 아이콘은 마스크로 투명을 정해요.
        let no_alpha = px.chunks_exact(4).all(|p| p[3] == 0);
        if no_alpha {
            if let Some((mw, _, m)) = mask {
                if mw == w {
                    for (i, p) in px.chunks_exact_mut(4).enumerate() {
                        p[3] = if m.get(i * 4).copied().unwrap_or(0) == 0 { 255 } else { 0 };
                    }
                }
            }
        }
        // BGRA → RGBA
        for p in px.chunks_exact_mut(4) {
            p.swap(0, 2);
        }
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut wr = enc.write_header().ok()?;
            wr.write_image_data(&px).ok()?;
        }
        Some(out)
    }
}

// ---------- 우클릭 메뉴 ----------

thread_local! {
    /// 메뉴가 떠 있는 동안 창 메시지를 넘겨줄 메뉴(하위 메뉴·그림 있는 항목용)
    static ACTIVE: RefCell<Option<IContextMenu>> = const { RefCell::new(None) };
}

unsafe extern "system" fn menu_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
    if matches!(msg, WM_INITMENUPOPUP | WM_DRAWITEM | WM_MEASUREITEM | WM_MENUCHAR) {
        let handled = ACTIVE.with(|a| {
            let a = a.borrow();
            let cm = a.as_ref()?;
            if let Ok(c3) = cm.cast::<IContextMenu3>() {
                let mut r = LRESULT(0);
                if unsafe { c3.HandleMenuMsg2(msg, wp, lp, Some(&mut r)) }.is_ok() {
                    return Some(r);
                }
            } else if let Ok(c2) = cm.cast::<IContextMenu2>() {
                if unsafe { c2.HandleMenuMsg(msg, wp, lp) }.is_ok() {
                    return Some(LRESULT(0));
                }
            }
            None
        });
        if let Some(r) = handled {
            return r;
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wp, lp) }
}

struct Pidl(*mut ITEMIDLIST);
impl Drop for Pidl {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ILFree(Some(self.0)) };
        }
    }
}

fn parse(path: &str) -> Result<Pidl, String> {
    let w = wide(path);
    let mut p: *mut ITEMIDLIST = std::ptr::null_mut();
    unsafe { SHParseDisplayName(PCWSTR(w.as_ptr()), None, &mut p, 0, None) }.map_err(|e| format!("parse:{e}"))?;
    Ok(Pidl(p))
}

/// 기록이 메뉴 맨 아래에 더하는 줄 "보안해제 바로가기"의 번호(윈도우 항목 번호와 겹치지 않게 그 범위 밖)
const ID_REVEAL: u32 = 0x7F00;

/// 윈도우 우클릭 메뉴를 띄우고 고른 것을 실행해요.
/// 돌려주는 값: "" 아무것도 안 고름 · "done" 실행함 · "rename" 화면이 이름 바꾸기를 시작해야 해요
/// · "reveal" 화면이 윈도우 탐색기로 넘겨야 해요(회사 보안 프로그램 메뉴는 윈도우 탐색기에서만 나와요, 2026-10-18).
/// hwnd는 앱 창, (x, y)는 화면 안 CSS 픽셀(음수면 마우스 자리), scale은 화면 배율.
pub fn context_menu(hwnd_raw: isize, origin: (i32, i32), scale: f64, dir: &str, names: &[String], x: f64, y: f64) -> Result<String, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let hwnd = HWND(hwnd_raw as *mut c_void);
        let dir_pidl = parse(dir)?;
        let folder: IShellFolder = SHBindToObject(None, dir_pidl.0, None).map_err(|e| format!("bind:{e}"))?;
        let cm: IContextMenu = if names.is_empty() {
            // 빈 곳: 그 폴더의 바탕 메뉴(새로 만들기·붙여 넣기·속성 등)
            folder.CreateViewObject(hwnd).map_err(|e| format!("view:{e}"))?
        } else {
            let mut kids: Vec<Pidl> = Vec::new();
            for n in names {
                let w = wide(n);
                let mut p: *mut ITEMIDLIST = std::ptr::null_mut();
                let mut attrs = 0u32;
                folder
                    .ParseDisplayName(hwnd, None, PCWSTR(w.as_ptr()), None, &mut p, &mut attrs)
                    .map_err(|e| format!("child:{e}"))?;
                kids.push(Pidl(p));
            }
            let raw: Vec<*const ITEMIDLIST> = kids.iter().map(|k| k.0 as *const ITEMIDLIST).collect();
            let cm = folder.GetUIObjectOf(hwnd, &raw, None).map_err(|e| format!("ui:{e}"))?;
            drop(kids);
            cm
        };
        let menu = CreatePopupMenu().map_err(|e| format!("menu:{e}"))?;
        let mut flags = CMF_NORMAL | CMF_EXPLORE;
        if GetKeyState(VK_SHIFT.0 as i32) < 0 {
            flags |= CMF_EXTENDEDVERBS;
        }
        const FIRST: u32 = 1;
        let hr = cm.QueryContextMenu(menu, 0, FIRST, ID_REVEAL - 1, flags);
        if hr.is_err() {
            let _ = DestroyMenu(menu);
            return Err(format!("query:{hr:?}"));
        }
        if !names.is_empty() {
            let label = wide("보안해제 바로가기");
            let _ = AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null());
            let _ = AppendMenuW(menu, MF_STRING, ID_REVEAL as usize, PCWSTR(label.as_ptr()));
        }
        let pt = if x < 0.0 || y < 0.0 {
            let mut p = POINT::default();
            let _ = GetCursorPos(&mut p);
            p
        } else {
            POINT { x: origin.0 + (x * scale).round() as i32, y: origin.1 + (y * scale).round() as i32 }
        };
        ACTIVE.with(|a| *a.borrow_mut() = Some(cm.clone()));
        let _ = SetWindowSubclass(hwnd, Some(menu_proc), 0x6731, 0);
        let cmd = TrackPopupMenuEx(menu, (TPM_RETURNCMD | TPM_RIGHTBUTTON).0, pt.x, pt.y, hwnd, None).0 as u32;
        let _ = RemoveWindowSubclass(hwnd, Some(menu_proc), 0x6731);
        ACTIVE.with(|a| *a.borrow_mut() = None);
        if cmd < FIRST {
            let _ = DestroyMenu(menu);
            return Ok(String::new());
        }
        if cmd == ID_REVEAL {
            let _ = DestroyMenu(menu);
            return Ok("reveal".into());
        }
        let id = (cmd - FIRST) as usize;
        let mut verb = [0u16; 128];
        let _ = cm.GetCommandString(id, GCS_VERBW, None, PSTR(verb.as_mut_ptr() as *mut u8), verb.len() as u32);
        let verb = from_wide(&verb).to_lowercase();
        if verb == "rename" {
            let _ = DestroyMenu(menu);
            return Ok("rename".into());
        }
        let dir_w = wide(dir);
        let info = CMINVOKECOMMANDINFOEX {
            cbSize: std::mem::size_of::<CMINVOKECOMMANDINFOEX>() as u32,
            fMask: CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE,
            hwnd,
            lpVerb: PCSTR(id as *const u8),
            lpVerbW: PCWSTR(id as *const u16),
            lpDirectoryW: PCWSTR(dir_w.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ptInvoke: pt,
            ..Default::default()
        };
        let r = cm.InvokeCommand(&info as *const _ as *const CMINVOKECOMMANDINFO);
        let _ = DestroyMenu(menu);
        r.map_err(|e| format!("invoke:{e}"))?;
        Ok("done".into())
    }
}

// ---------- 윈도우 탐색기로 넘기기 (보안 해제) ----------

/// 윈도우 탐색기 창을 열어 dir 안의 names를 골라 두고, 그 창이 앞에 오면 우클릭 메뉴(메뉴 키)를 대신 눌러 줘요.
/// 회사 보안 프로그램(소프트캠프 문서보안)은 윈도우 탐색기에서만 메뉴를 보여 줘서 이렇게 넘겨요(2026-10-18 사용자 1안).
/// 메뉴 키는 탐색기 창이 3초 안에 앞에 올 때만 눌러요 — 안 오면 창만 열려 있고 우클릭은 사용자가 해요.
pub fn reveal(dir: &str, names: &[String], popup: bool) -> Result<(), String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let dir_pidl = parse(dir)?;
        let folder: IShellFolder = SHBindToObject(None, dir_pidl.0, None).map_err(|e| format!("bind:{e}"))?;
        let mut kids: Vec<Pidl> = Vec::new();
        for n in names {
            let w = wide(n);
            let mut p: *mut ITEMIDLIST = std::ptr::null_mut();
            let mut attrs = 0u32;
            if folder.ParseDisplayName(HWND::default(), None, PCWSTR(w.as_ptr()), None, &mut p, &mut attrs).is_ok() {
                kids.push(Pidl(p));
            }
        }
        let raw: Vec<*const ITEMIDLIST> = kids.iter().map(|k| k.0 as *const ITEMIDLIST).collect();
        let before = GetForegroundWindow();
        SHOpenFolderAndSelectItems(dir_pidl.0, if raw.is_empty() { None } else { Some(&raw) }, 0).map_err(|e| format!("open:{e}"))?;
        if popup && !raw.is_empty() {
            let before = before.0 as isize;
            std::thread::spawn(move || {
                for _ in 0..30 {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let fg = GetForegroundWindow();
                    if fg.0 as isize == before || fg.0.is_null() {
                        continue;
                    }
                    let mut cls = [0u16; 64];
                    let n = GetClassNameW(fg, &mut cls) as usize;
                    if String::from_utf16_lossy(&cls[..n]) == "CabinetWClass" {
                        // 고른 파일이 화면에 자리 잡을 때까지 조금 기다렸다가 메뉴 키를 눌러요.
                        std::thread::sleep(std::time::Duration::from_millis(350));
                        if GetForegroundWindow() == fg {
                            press_menu_key();
                        }
                        return;
                    }
                }
            });
        }
        Ok(())
    }
}

/// 메뉴 키(Shift+F10과 같은 일)를 한 번 눌렀다 떼요.
unsafe fn press_menu_key() {
    let key = |up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_APPS, dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() }, ..Default::default() } },
    };
    let inputs = [key(false), key(true)];
    unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
}

// ---------- 파일 형식 이름 ----------

/// 윈도우 탐색기의 "유형" 열과 같은 이름("Microsoft Excel 워크시트"). 키는 ".xlsx" 또는 "<dir>"(폴더).
/// 파일이 없어도 확장자만으로 물어요(SHGFI_USEFILEATTRIBUTES).
pub fn types(keys: &[String]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for k in keys {
        let (name, attrs) = if k == "<dir>" { ("folder".to_string(), FILE_ATTRIBUTE_DIRECTORY) } else { (format!("x{k}"), FILE_ATTRIBUTE_NORMAL) };
        let w = wide(&name);
        let mut info = SHFILEINFOW::default();
        let ok = unsafe {
            SHGetFileInfoW(PCWSTR(w.as_ptr()), attrs, Some(&mut info), std::mem::size_of::<SHFILEINFOW>() as u32, SHGFI_TYPENAME | SHGFI_USEFILEATTRIBUTES)
        };
        if ok != 0 {
            let t = from_wide(&info.szTypeName);
            if !t.is_empty() {
                out.insert(k.clone(), t);
            }
        }
    }
    out
}

// ---------- 홈(윈도우 탐색기 "홈" = 빠른 실행 목록) ----------

/// 윈도우 탐색기 "홈"에 보이는 것: 즐겨찾기(고정·자주 쓴 폴더)와 최근 파일. (보이는 이름, 실제 경로)
/// 윈도우가 주는 차례 그대로예요. 실제 폴더·파일이 아닌 것(라이브러리 등)은 빼요.
pub fn quick_items() -> Vec<(String, String)> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::Common::STRRET;
    use windows::Win32::UI::Shell::{IEnumIDList, StrRetToStrW, SHCONTF_FOLDERS, SHCONTF_NONFOLDERS, SHGDN_FORPARSING, SHGDN_NORMAL};
    let mut out = Vec::new();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let Ok(root) = parse("shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}") else { return out };
        let Ok(folder): windows::core::Result<IShellFolder> = SHBindToObject(None, root.0, None) else { return out };
        let mut en: Option<IEnumIDList> = None;
        if folder.EnumObjects(HWND::default(), (SHCONTF_FOLDERS.0 | SHCONTF_NONFOLDERS.0) as u32, &mut en).is_err() {
            return out;
        }
        let Some(en) = en else { return out };
        let text = |child: *const ITEMIDLIST, flags| -> Option<String> {
            let mut sr = STRRET::default();
            folder.GetDisplayNameOf(child, flags, &mut sr).ok()?;
            let mut p = windows::core::PWSTR::null();
            StrRetToStrW(&mut sr, Some(child), &mut p).ok()?;
            let s = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as *const c_void));
            s
        };
        for _ in 0..200 {
            let mut one = [std::ptr::null_mut::<ITEMIDLIST>(); 1];
            let mut got = 0u32;
            if en.Next(&mut one, Some(&mut got)).is_err() || got == 0 {
                break;
            }
            let child = Pidl(one[0]);
            let path = text(child.0, SHGDN_FORPARSING);
            let name = text(child.0, SHGDN_NORMAL);
            if let (Some(path), Some(name)) = (path, name) {
                if path.len() > 2 && (path.as_bytes()[1] == b':' || path.starts_with("\\\\")) {
                    out.push((name, path));
                }
            }
        }
    }
    out
}

// ── 윈도우 클립보드(파일) ─────────────────────────────────────────────
// Ctrl+C·X·V(2026-10-20 사용자 1안): 윈도우 탐색기와 같은 꼴(CF_HDROP + "Preferred DropEffect")로 넣고 읽어요.
// 그래서 윈도우 탐색기·바탕 화면·메일 첨부와 서로 붙여 넣을 수 있어요. 잘라내기는 DropEffect 2(옮기기), 복사는 5.

const CF_HDROP: u32 = 15;

/// 다른 프로그램이 잠깐 잡고 있으면 몇 번 다시 열어요.
unsafe fn clip_open() -> Result<(), String> {
    use windows::Win32::System::DataExchange::OpenClipboard;
    let mut last = String::new();
    for _ in 0..10 {
        match OpenClipboard(None) {
            Ok(()) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    Err(format!("clipboard_busy:{last}"))
}

unsafe fn clip_put(fmt: u32, bytes: &[u8]) -> Result<(), String> {
    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::SetClipboardData;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)).map_err(|e| e.to_string())?;
    let p = GlobalLock(h) as *mut u8;
    if p.is_null() {
        let _ = GlobalFree(Some(h));
        return Err("clipboard_lock".into());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
    let _ = GlobalUnlock(h);
    if let Err(e) = SetClipboardData(fmt, Some(HANDLE(h.0))) {
        let _ = GlobalFree(Some(h));
        return Err(e.to_string());
    }
    Ok(())
}

unsafe fn clip_read(fmt: u32) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    IsClipboardFormatAvailable(fmt).ok()?;
    let h = GetClipboardData(fmt).ok()?;
    let g = HGLOBAL(h.0);
    let size = GlobalSize(g);
    let p = GlobalLock(g) as *const u8;
    if p.is_null() {
        return None;
    }
    let v = std::slice::from_raw_parts(p, size).to_vec();
    let _ = GlobalUnlock(g);
    Some(v)
}

fn effect_format() -> u32 {
    use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
    unsafe { RegisterClipboardFormatW(windows::core::w!("Preferred DropEffect")) }
}

/// 파일 목록을 클립보드에. 빈 목록이면 클립보드를 비워요(잘라낸 것을 붙인 뒤).
pub fn clip_set(paths: &[String], cut: bool) -> Result<(), String> {
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard};
    unsafe {
        clip_open()?;
        let r = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|e| e.to_string())?;
            if paths.is_empty() {
                return Ok(());
            }
            clip_put(CF_HDROP, &crate::files::drop_files_bytes(paths))?;
            clip_put(effect_format(), &(if cut { 2u32 } else { 5u32 }).to_le_bytes())
        })();
        let _ = CloseClipboard();
        r
    }
}

/// 클립보드의 파일 목록과 잘라내기인지. 파일이 없으면 빈 목록.
pub fn clip_get() -> Result<(Vec<String>, bool), String> {
    use windows::Win32::System::DataExchange::CloseClipboard;
    unsafe {
        clip_open()?;
        let paths = clip_read(CF_HDROP).map(|b| crate::files::parse_drop_files(&b)).unwrap_or_default();
        let effect = clip_read(effect_format()).filter(|b| b.len() >= 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]])).unwrap_or(5);
        let _ = CloseClipboard();
        Ok((paths, effect & 2 != 0 && effect & 1 == 0))
    }
}
