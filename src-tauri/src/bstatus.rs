//! 예산현황(13단계) 명령. 저장은 core의 bstatus(세부사업 설정 JSON), 엑셀 쓰기도 core.

use gilog_core::{BStatusExport, BStatusSetup};
use tauri::State;

use crate::{code, with_store, AppState};

#[tauri::command]
pub fn bstatus_list(state: State<AppState>) -> Result<Vec<BStatusSetup>, String> {
    with_store(&state, |s| s.bstatus_list())
}

#[tauri::command]
pub fn bstatus_set(state: State<AppState>, name: String, setup: String) -> Result<(), String> {
    with_store(&state, |s| s.bstatus_set(&name, &setup))
}

#[tauri::command]
pub fn bstatus_excel_write(path: String, data: BStatusExport) -> Result<(), String> {
    gilog_core::bstatus::write_bstatus_xlsx(std::path::Path::new(&path), &data).map_err(code)
}
