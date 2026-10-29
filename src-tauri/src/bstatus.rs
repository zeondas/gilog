//! 예산현황(13단계) 명령. 저장은 core의 bstatus(세부사업 설정 JSON), 엑셀 쓰기도 core.

use gilog_core::{BStatusExport, BStatusSetup};
use tauri::State;

use crate::{code, with_store, AppState};

#[tauri::command]
pub fn bstatus_list(state: State<AppState>) -> Result<Vec<BStatusSetup>, String> {
    // 읽기 전에 이름·공사 번호를 uid로 맞춰요(집행현황에서 이름이 바뀌어도 설정이 따라가게)
    with_store(&state, |s| {
        s.bstatus_sync()?;
        s.bstatus_list()
    })
}

#[tauri::command]
pub fn bstatus_set(state: State<AppState>, name: String, setup: String) -> Result<(), String> {
    with_store(&state, |s| s.bstatus_set(&name, &setup))
}

#[tauri::command]
pub fn bstatus_excel_write(app: tauri::AppHandle, path: String, data: BStatusExport) -> Result<(), String> {
    let path = crate::guard::export_to(&path, &crate::guard::protected(&app))?;
    gilog_core::bstatus::write_bstatus_xlsx(&path, &data).map_err(code)
}
