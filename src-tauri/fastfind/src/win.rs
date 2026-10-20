//! 윈도우 전용: 드라이브 변경 기록(USN) 읽기, 서비스, 이름 통로.
//! 이 작업 공간(리눅스)에서는 컴파일 확인을 못 해요 — 윈도우 빌드에서 확인.

use std::ffi::{c_void, OsString};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, LocalFree, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::Storage::FileSystem::{CreateFileW, FlushFileBuffers, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW, ReadFile, WriteFile};
use windows_sys::Win32::System::Ioctl::{FSCTL_CREATE_USN_JOURNAL, FSCTL_ENUM_USN_DATA, FSCTL_QUERY_USN_JOURNAL, FSCTL_READ_USN_JOURNAL};
use windows_sys::Win32::System::Pipes::{ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe};
use windows_sys::Win32::System::IO::DeviceIoControl;

use windows_service::service::{
    ServiceAccess, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode, ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
};
use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use windows_service::{define_windows_service, service_dispatcher};

use crate::index::{parse_records, Volume};
use crate::state::Shared;

pub const SERVICE_NAME: &str = "GilogSearch";
pub const PIPE_NAME: &str = r"\\.\pipe\gilog-search";
const EXE_NAME: &str = "gilog-search.exe";

const GENERIC_READ: u32 = 0x8000_0000;
const FILE_SHARE_RW: u32 = 0x1 | 0x2;
const OPEN_EXISTING: u32 = 3;
const DRIVE_FIXED: u32 = 3;
const PIPE_ACCESS_DUPLEX: u32 = 0x3;
const FILE_FLAG_FIRST_PIPE_INSTANCE: u32 = 0x0008_0000;
const ERROR_HANDLE_EOF: u32 = 38;
const ERROR_PIPE_CONNECTED: u32 = 535;
const ERROR_JOURNAL_NOT_ACTIVE: u32 = 1179;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Program Files\giLog Search — 서비스 실행 파일·기록이 사는 곳(관리자만 고칠 수 있는 폴더)
fn install_dir() -> PathBuf {
    let pf = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    pf.join("giLog Search")
}

/// 짧은 기록(1MB 넘으면 새로 써요) — 사용자 PC에서 안 될 때 원인 보기용
fn log(msg: &str) {
    let p = install_dir().join("log.txt");
    if fs::metadata(&p).map(|m| m.len() > 1 << 20).unwrap_or(false) {
        let _ = fs::remove_file(&p);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&p) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{t} {msg}");
    }
}

pub fn main(arg: &str) -> i32 {
    match arg {
        "run" => match service_dispatcher::start(SERVICE_NAME, ffi_service_main) {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("서비스로만 돌아요: {e}");
                1
            }
        },
        "install" => install(),
        "check" => check(),
        "console" => console(),
        _ => {
            eprintln!("gilog-search {} — install · check · run · console", crate::VERSION);
            1
        }
    }
}

// ---------- 드라이브 ----------

/// 이 PC에 붙은 NTFS 고정 드라이브("C:" …)
fn ntfs_drives() -> Vec<String> {
    let mut out = Vec::new();
    let mask = unsafe { GetLogicalDrives() };
    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i as u8) as char;
        let root = wide(&format!("{letter}:\\"));
        if unsafe { GetDriveTypeW(root.as_ptr()) } != DRIVE_FIXED {
            continue;
        }
        let mut fsname = [0u16; 32];
        let ok = unsafe { GetVolumeInformationW(root.as_ptr(), null_mut(), 0, null_mut(), null_mut(), null_mut(), fsname.as_mut_ptr(), fsname.len() as u32) };
        if ok == 0 {
            continue;
        }
        let end = fsname.iter().position(|&c| c == 0).unwrap_or(fsname.len());
        if String::from_utf16_lossy(&fsname[..end]) == "NTFS" {
            out.push(format!("{letter}:"));
        }
    }
    out
}

struct Handle(HANDLE);
unsafe impl Send for Handle {}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

fn open_volume(drive: &str) -> Result<Handle, u32> {
    let p = wide(&format!(r"\\.\{drive}"));
    let h = unsafe { CreateFileW(p.as_ptr(), GENERIC_READ, FILE_SHARE_RW, null(), OPEN_EXISTING, 0, null_mut()) };
    if h == INVALID_HANDLE_VALUE {
        Err(unsafe { GetLastError() })
    } else {
        Ok(Handle(h))
    }
}

fn ioctl(h: HANDLE, code: u32, inp: *const c_void, insz: u32, out: *mut c_void, outsz: u32) -> Result<usize, u32> {
    let mut n = 0u32;
    let ok = unsafe { DeviceIoControl(h, code, inp, insz, out, outsz, &mut n, null_mut()) };
    if ok == 0 {
        Err(unsafe { GetLastError() })
    } else {
        Ok(n as usize)
    }
}

/// 변경 기록 번호(id)와 다음 기록 자리(next)
fn query_journal(h: HANDLE) -> Result<(u64, i64), u32> {
    let mut buf = [0u8; 96];
    ioctl(h, FSCTL_QUERY_USN_JOURNAL, null(), 0, buf.as_mut_ptr() as *mut c_void, buf.len() as u32)?;
    let id = u64::from_le_bytes(buf[0..8].try_into().unwrap_or_default());
    let next = i64::from_le_bytes(buf[16..24].try_into().unwrap_or_default());
    Ok((id, next))
}

/// 변경 기록이 꺼진 드라이브(D: 등)는 켜요(32MB)
fn ensure_journal(h: HANDLE) -> Result<(u64, i64), u32> {
    match query_journal(h) {
        Err(ERROR_JOURNAL_NOT_ACTIVE) => {
            #[repr(C)]
            struct Create {
                max: u64,
                delta: u64,
            }
            let c = Create { max: 32 << 20, delta: 8 << 20 };
            ioctl(h, FSCTL_CREATE_USN_JOURNAL, &c as *const Create as *const c_void, std::mem::size_of::<Create>() as u32, null_mut(), 0)?;
            query_journal(h)
        }
        r => r,
    }
}

/// 드라이브의 파일을 모두 읽어 목록을 만들어요(몇 초)
fn scan(h: HANDLE, high: i64, vol: &mut Volume, stop: &AtomicBool) -> Result<(), u32> {
    #[repr(C)]
    struct MftEnum {
        start: u64,
        low: i64,
        high: i64,
    }
    let mut med = MftEnum { start: 0, low: 0, high };
    let mut buf = vec![0u8; 1 << 20];
    loop {
        if stop.load(Ordering::SeqCst) {
            return Ok(());
        }
        match ioctl(h, FSCTL_ENUM_USN_DATA, &med as *const MftEnum as *const c_void, std::mem::size_of::<MftEnum>() as u32, buf.as_mut_ptr() as *mut c_void, buf.len() as u32) {
            Ok(n) if n >= 8 => {
                med.start = u64::from_le_bytes(buf[0..8].try_into().unwrap_or_default());
                for r in parse_records(&buf[8..n]) {
                    vol.apply(&r);
                }
                if n == 8 {
                    return Ok(());
                }
            }
            Ok(_) => return Ok(()),
            Err(ERROR_HANDLE_EOF) => return Ok(()),
            Err(e) => return Err(e),
        }
    }
}

/// 그 뒤 바뀐 것을 1초마다 맞춰요. 기록이 끊기면(넘침·꺼짐) Err로 돌아가 처음부터 다시 읽어요.
fn follow(h: HANDLE, id: u64, mut usn: i64, slot: &RwLock<crate::state::Slot>, stop: &AtomicBool) -> Result<(), u32> {
    #[repr(C)]
    struct ReadJ {
        start: i64,
        mask: u32,
        only_close: u32,
        timeout: u64,
        wait_bytes: u64,
        id: u64,
    }
    let mut buf = vec![0u8; 1 << 16];
    while !stop.load(Ordering::SeqCst) {
        let rj = ReadJ { start: usn, mask: 0xFFFF_FFFF, only_close: 0, timeout: 0, wait_bytes: 0, id };
        let n = ioctl(h, FSCTL_READ_USN_JOURNAL, &rj as *const ReadJ as *const c_void, std::mem::size_of::<ReadJ>() as u32, buf.as_mut_ptr() as *mut c_void, buf.len() as u32)?;
        if n < 8 {
            thread::sleep(Duration::from_secs(1));
            continue;
        }
        let next = i64::from_le_bytes(buf[0..8].try_into().unwrap_or_default());
        let recs = parse_records(&buf[8..n]);
        if !recs.is_empty() {
            let mut s = slot.write().unwrap_or_else(|e| e.into_inner());
            for r in &recs {
                s.vol.apply(r);
            }
        }
        if recs.is_empty() || next == usn {
            thread::sleep(Duration::from_secs(1));
        }
        usn = next;
    }
    Ok(())
}

fn volume_worker(i: usize, drive: String, shared: Arc<Shared>, stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::SeqCst) {
        let t0 = Instant::now();
        let r = (|| -> Result<(), u32> {
            let h = open_volume(&drive)?;
            let (id, next) = ensure_journal(h.0)?;
            let mut v = Volume::new(&drive);
            scan(h.0, next, &mut v, &stop)?;
            log(&format!("{drive} 목록 {}개 {:.1}초", v.len(), t0.elapsed().as_secs_f32()));
            {
                let mut s = shared.slots[i].write().unwrap_or_else(|e| e.into_inner());
                s.vol = v;
                s.ready = true;
            }
            follow(h.0, id, next, &shared.slots[i], &stop)
        })();
        if let Err(e) = r {
            log(&format!("{drive} 다시 읽기(오류 {e})"));
            let mut s = shared.slots[i].write().unwrap_or_else(|e| e.into_inner());
            s.ready = false;
            s.vol = Volume::new(&drive);
        }
        for _ in 0..30 {
            if stop.load(Ordering::SeqCst) {
                return;
            }
            thread::sleep(Duration::from_secs(1));
        }
    }
}

// ---------- 이름 통로 ----------

fn pipe_server(shared: Arc<Shared>, stop: Arc<AtomicBool>) {
    // 시스템·관리자는 모두, 로그인한 사용자는 읽고 쓰기(묻고 답 받기)만
    let sddl = wide("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;IU)");
    let mut psd: *mut c_void = null_mut();
    let ok = unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut psd, null_mut()) };
    if ok == 0 {
        log(&format!("통로 권한 만들기 실패 {}", unsafe { GetLastError() }));
        return;
    }
    let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: psd, bInheritHandle: 0 };
    let name = wide(PIPE_NAME);
    let mut first = true;
    while !stop.load(Ordering::SeqCst) {
        // 처음 하나는 "첫 통로"로 — 다른 프로그램이 이름을 먼저 차지했으면 만들지 않아요
        let mode = PIPE_ACCESS_DUPLEX | if first { FILE_FLAG_FIRST_PIPE_INSTANCE } else { 0 };
        let h = unsafe { CreateNamedPipeW(name.as_ptr(), mode, 0, 255, 1 << 16, 1 << 16, 0, &sa) };
        if h == INVALID_HANDLE_VALUE {
            if first {
                log(&format!("통로 만들기 실패 {}", unsafe { GetLastError() }));
            }
            thread::sleep(Duration::from_secs(2));
            continue;
        }
        first = false;
        let ok = unsafe { ConnectNamedPipe(h, null_mut()) };
        if ok == 0 && unsafe { GetLastError() } != ERROR_PIPE_CONNECTED {
            unsafe { CloseHandle(h) };
            continue;
        }
        let hh = h as usize;
        let sh = shared.clone();
        thread::spawn(move || client(hh as HANDLE, &sh));
    }
    unsafe { LocalFree(psd) };
}

fn client(h: HANDLE, sh: &Shared) {
    let mut req = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let mut n = 0u32;
        let ok = unsafe { ReadFile(h, buf.as_mut_ptr(), buf.len() as u32, &mut n, null_mut()) };
        if ok == 0 || n == 0 {
            break;
        }
        req.extend_from_slice(&buf[..n as usize]);
        if req.contains(&b'\n') || req.len() > 1 << 16 {
            break;
        }
    }
    let line = String::from_utf8_lossy(&req).into_owned();
    let mut out = serde_json::to_vec(&sh.answer(&line)).unwrap_or_default();
    out.push(b'\n');
    let mut off = 0usize;
    while off < out.len() {
        let mut n = 0u32;
        let chunk = (out.len() - off).min(1 << 20) as u32;
        if unsafe { WriteFile(h, out[off..].as_ptr(), chunk, &mut n, null_mut()) } == 0 || n == 0 {
            break;
        }
        off += n as usize;
    }
    unsafe {
        FlushFileBuffers(h);
        DisconnectNamedPipe(h);
        CloseHandle(h);
    }
}

fn start(stop: Arc<AtomicBool>) -> Arc<Shared> {
    let drives = ntfs_drives();
    log(&format!("시작 {} 드라이브 {:?}", crate::VERSION, drives));
    let shared = Arc::new(Shared::new(&drives));
    for (i, d) in drives.into_iter().enumerate() {
        let (sh, st) = (shared.clone(), stop.clone());
        thread::spawn(move || volume_worker(i, d, sh, st));
    }
    let (sh, st) = (shared.clone(), stop);
    thread::spawn(move || pipe_server(sh, st));
    shared
}

// ---------- 서비스 ----------

define_windows_service!(ffi_service_main, service_main);

fn service_main(_args: Vec<OsString>) {
    if let Err(e) = run_service() {
        log(&format!("서비스 오류 {e}"));
    }
}

fn status(state: ServiceState) -> ServiceStatus {
    ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state: state,
        controls_accepted: if state == ServiceState::Running { ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN } else { ServiceControlAccept::empty() },
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    }
}

fn run_service() -> windows_service::Result<()> {
    let (tx, rx) = mpsc::channel::<()>();
    let handler = move |ev| match ev {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = tx.send(());
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    };
    let handle = service_control_handler::register(SERVICE_NAME, handler)?;
    handle.set_service_status(status(ServiceState::Running))?;
    let stop = Arc::new(AtomicBool::new(false));
    let _shared = start(stop.clone());
    // 기록 앱을 지웠으면(설치 폴더의 도우미가 10분 넘게 없으면) 스스로 빠져요 — 지울 때 관리자 허용을 다시 묻지 않게
    let mut gone = 0;
    loop {
        match rx.recv_timeout(Duration::from_secs(600)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if source_gone() {
                    gone += 1;
                    if gone >= 2 {
                        log("기록 앱이 지워져 도우미도 빠져요");
                        remove_self();
                        break;
                    }
                } else {
                    gone = 0;
                }
            }
        }
    }
    stop.store(true, Ordering::SeqCst);
    handle.set_service_status(status(ServiceState::Stopped))?;
    Ok(())
}

/// 설치할 때 적어 둔 기록 앱 쪽 도우미 파일이 없어졌는지
fn source_gone() -> bool {
    match fs::read_to_string(install_dir().join("source.txt")) {
        Ok(p) if !p.trim().is_empty() => !PathBuf::from(p.trim()).exists(),
        _ => false,
    }
}

fn remove_self() {
    if let Ok(mgr) = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT) {
        if let Ok(s) = mgr.open_service(SERVICE_NAME, ServiceAccess::DELETE) {
            let _ = s.delete();
        }
    }
    // 이 프로그램이 끝난 뒤 폴더를 지워요
    use std::os::windows::process::CommandExt;
    let dir = install_dir();
    let _ = std::process::Command::new("cmd")
        .args(["/c", "ping", "127.0.0.1", "-n", "6", ">nul", "&", "rmdir", "/s", "/q"])
        .arg(&dir)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn service_info(target: PathBuf) -> ServiceInfo {
    ServiceInfo {
        name: OsString::from(SERVICE_NAME),
        display_name: OsString::from("기록 빠른 찾기"),
        service_type: ServiceType::OWN_PROCESS,
        start_type: ServiceStartType::AutoStart,
        error_control: ServiceErrorControl::Normal,
        executable_path: target,
        launch_arguments: vec![OsString::from("run")],
        dependencies: vec![],
        account_name: None,
        account_password: None,
    }
}

/// 관리자로 실행: Program Files\giLog Search에 복사하고 서비스로 등록·시작(이미 있으면 멈추고 바꿔 끼움)
fn install() -> i32 {
    let r = (|| -> Result<(), String> {
        let me = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = install_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("폴더 {e}"))?;
        let target = dir.join(EXE_NAME);
        let mgr = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT | ServiceManagerAccess::CREATE_SERVICE).map_err(|e| format!("서비스 관리자 {e}"))?;
        let access = ServiceAccess::QUERY_STATUS | ServiceAccess::STOP | ServiceAccess::START | ServiceAccess::CHANGE_CONFIG;
        let existing = mgr.open_service(SERVICE_NAME, access).ok();
        if let Some(s) = &existing {
            if s.query_status().map(|st| st.current_state != ServiceState::Stopped).unwrap_or(false) {
                let _ = s.stop();
                let t = Instant::now();
                while t.elapsed() < Duration::from_secs(15) && s.query_status().map(|st| st.current_state != ServiceState::Stopped).unwrap_or(false) {
                    thread::sleep(Duration::from_millis(300));
                }
            }
        }
        if me != target {
            let mut last = String::new();
            let mut done = false;
            for _ in 0..20 {
                match fs::copy(&me, &target) {
                    Ok(_) => {
                        done = true;
                        break;
                    }
                    Err(e) => last = e.to_string(),
                }
                thread::sleep(Duration::from_millis(500));
            }
            if !done {
                return Err(format!("복사 {last}"));
            }
        }
        let _ = fs::write(dir.join("source.txt"), me.to_string_lossy().as_bytes());
        let _ = fs::write(dir.join("version.txt"), crate::VERSION);
        let info = service_info(target);
        let svc = match existing {
            Some(s) => {
                s.change_config(&info).map_err(|e| format!("설정 {e}"))?;
                s
            }
            None => mgr.create_service(&info, access).map_err(|e| format!("등록 {e}"))?,
        };
        let _ = svc.set_description("기록 탐색기의 빠른 찾기 — 드라이브의 파일 이름 목록을 들고 있다가 바로 찾아 줘요");
        svc.start(&[] as &[&std::ffi::OsStr]).map_err(|e| format!("시작 {e}"))?;
        Ok(())
    })();
    match r {
        Ok(()) => {
            log("설치 끝");
            0
        }
        Err(e) => {
            log(&format!("설치 실패 {e}"));
            eprintln!("{e}");
            2
        }
    }
}

/// 같은 판의 도우미가 깔려 돌고 있으면 0 — 아니면 1(설치 파일이 관리자 허용을 물어 install을 돌려요)
fn check() -> i32 {
    let Ok(me) = std::env::current_exe() else { return 1 };
    // 판이 같으면 바꿔 끼우지 않아요(앱을 새로 깔 때마다 관리자 허용을 묻지 않게 — 도우미를 고칠 때만 Cargo.toml 판을 올려요)
    let ver = fs::read_to_string(install_dir().join("version.txt")).unwrap_or_default();
    if ver.trim() != crate::VERSION || !install_dir().join(EXE_NAME).exists() {
        return 1;
    }
    // 기록 앱 자리가 바뀌었으면 다시 적어야 해요
    let src = fs::read_to_string(install_dir().join("source.txt")).unwrap_or_default();
    if src.trim() != me.to_string_lossy() {
        return 1;
    }
    let Ok(mgr) = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT) else { return 1 };
    let Ok(s) = mgr.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS) else { return 1 };
    match s.query_status() {
        Ok(st) if st.current_state == ServiceState::Running => 0,
        _ => 1,
    }
}

/// 시험용: 서비스 없이 돌며 5초마다 상태를 log.txt에 적어요(관리자로, 끝내기는 작업 관리자)
fn console() -> i32 {
    let stop = Arc::new(AtomicBool::new(false));
    let shared = start(stop);
    loop {
        thread::sleep(Duration::from_secs(5));
        let s = serde_json::to_string(&shared.answer(r#"{"op":"status"}"#)).unwrap_or_default();
        log(&s);
    }
}
