//! 재기 기록(공통 ✔1, 2026-11-07 사용자 1안 – 초시계 대신 앱이 스스로 재요). 설정에서 켰을 때만 화면이 불러요.
//! - `perf_memory`: 기록 프로세스와 그 아래 프로세스(WebView2 – msedgewebview2 여럿)의 작업 집합(Working Set) 합(바이트).
//!   작업 관리자 "메모리" 칸(개인 작업 집합)보다 조금 커요 – 공유 메모리까지 세서, 250MB 기준엔 넉넉한 쪽으로 재요.
//! - `perf_save`: 재기 값(숫자만 – 민원인 정보 없음)을 설정 폴더(prefs.json 옆) `load-log.json`으로 써요.
use tauri::AppHandle;

#[tauri::command]
pub fn perf_memory() -> Option<u64> {
    memory_bytes()
}

#[tauri::command]
pub fn perf_save(app: AppHandle, text: String) -> Result<String, String> {
    let dir = crate::profile::config_dir(&app).map_err(crate::io)?;
    std::fs::create_dir_all(&dir).map_err(crate::io)?;
    let path = dir.join("load-log.json");
    gilog_core::write_atomic(&path, text.as_bytes()).map_err(crate::io)?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(windows)]
fn memory_bytes() -> Option<u64> {
    use std::collections::{HashMap, HashSet};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    unsafe {
        // 프로세스 표(부모 → 자식)
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE || snap.is_null() {
            return None;
        }
        let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                kids.entry(e.th32ParentProcessID).or_default().push(e.th32ProcessID);
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        // 나와 그 아래(손주까지) 모두
        let me = GetCurrentProcessId();
        let mut todo = vec![me];
        let mut seen = HashSet::new();
        let mut total: u64 = 0;
        while let Some(pid) = todo.pop() {
            if !seen.insert(pid) {
                continue;
            }
            if let Some(k) = kids.get(&pid) {
                todo.extend(k.iter().copied().filter(|&c| c != pid && c != 0));
            }
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                continue;
            }
            let mut m: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
            m.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
            if K32GetProcessMemoryInfo(h, &mut m, m.cb) != 0 {
                total += m.WorkingSetSize as u64;
            }
            CloseHandle(h);
        }
        Some(total)
    }
}

#[cfg(not(windows))]
fn memory_bytes() -> Option<u64> {
    None
}
