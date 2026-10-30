//! 집행현황(12단계) 명령. 저장 규칙은 core의 budget, 엑셀은 core의 budget_xlsx에 있어요.

use gilog_core::budget_xlsx::{BudgetExport, GridSheet};
use gilog_core::{BudgetShareOp, BudgetImportProject, BudgetLevel, BudgetProject, BudgetRowInput};
use tauri::State;

use crate::{code, with_store, AppState};

type Year = Vec<BudgetProject>;

#[tauri::command]
pub fn budget_data(state: State<AppState>, year: i64) -> Result<Year, String> {
    with_store(&state, |s| s.budget_data(year))
}

#[tauri::command]
pub fn save_budget_project(state: State<AppState>, year: i64, id: Option<i64>, after: Option<i64>, name: String, budget: Option<i64>) -> Result<Year, String> {
    with_store(&state, |s| s.save_budget_project(year, id, after, &name, budget))
}

#[tauri::command]
pub fn save_budget_item(state: State<AppState>, project: i64, id: Option<i64>, name: String, budget: Option<i64>) -> Result<Year, String> {
    with_store(&state, |s| s.save_budget_item(project, id, &name, budget))
}

/// 바뀐 해와 그 공사 번호(새로 넣었으면 새 번호)
#[tauri::command]
pub fn save_budget_row(state: State<AppState>, item: i64, id: Option<i64>, row: BudgetRowInput) -> Result<(Year, i64), String> {
    with_store(&state, |s| s.save_budget_row(item, id, &row))
}

#[tauri::command]
pub fn set_budget_stage(state: State<AppState>, id: i64, stage: String) -> Result<Year, String> {
    with_store(&state, |s| s.set_budget_stage(id, &stage))
}

#[tauri::command]
pub fn set_budget_memo(state: State<AppState>, level: BudgetLevel, id: i64, memo: String) -> Result<Year, String> {
    with_store(&state, |s| s.set_budget_memo(level, id, &memo))
}

#[tauri::command]
pub fn set_budget_open(state: State<AppState>, level: BudgetLevel, id: i64, open: bool, all: bool) -> Result<Year, String> {
    with_store(&state, |s| s.set_budget_open(level, id, open, all))
}

#[tauri::command]
pub fn move_budget(state: State<AppState>, level: BudgetLevel, id: i64, dir: i64) -> Result<Year, String> {
    with_store(&state, |s| s.move_budget(level, id, dir))
}

#[tauri::command]
pub fn move_budget_item(state: State<AppState>, id: i64, to: i64) -> Result<Year, String> {
    with_store(&state, |s| s.move_budget_item(id, to))
}

#[tauri::command]
pub fn move_budget_row(state: State<AppState>, id: i64, to: i64) -> Result<Year, String> {
    with_store(&state, |s| s.move_budget_row(id, to))
}

#[tauri::command]
pub fn delete_budget(state: State<AppState>, level: BudgetLevel, id: i64) -> Result<Year, String> {
    with_store(&state, |s| s.delete_budget(level, id))
}

#[tauri::command]
pub fn copy_budget_year(state: State<AppState>, from: i64, to: i64) -> Result<Year, String> {
    with_store(&state, |s| s.copy_budget_year(from, to))
}

/// 바뀐 해와 넣은 공사 수
#[tauri::command]
pub fn import_budget(state: State<AppState>, year: i64, projects: Vec<BudgetImportProject>, replace: Option<bool>) -> Result<(Year, usize, usize), String> {
    with_store(&state, |s| s.import_budget(year, &projects, replace.unwrap_or(false)))
}

#[tauri::command]
pub fn budget_excel_write(app: tauri::AppHandle, path: String, data: BudgetExport) -> Result<(), String> {
    let path = crate::guard::export_to(&path, &crate::guard::protected(&app))?;
    gilog_core::budget_xlsx::write_budget_xlsx(&path, &data).map_err(code)
}

#[tauri::command]
pub fn budget_excel_read(path: String) -> Result<Vec<GridSheet>, String> {
    gilog_core::budget_xlsx::read_grid(std::path::Path::new(&path)).map_err(code)
}

// ---------- 팀 공유(2026-10-20) ----------

#[tauri::command]
pub fn budget_years(state: State<AppState>) -> Result<Vec<i64>, String> {
    with_store(&state, |s| s.budget_years())
}

#[tauri::command]
pub fn set_budget_owner(state: State<AppState>, id: i64, owner: Option<i64>) -> Result<Year, String> {
    with_store(&state, |s| s.set_budget_owner(id, owner))
}

/// 받은 줄을 넣고 넣은 수를 돌려줘요.
#[tauri::command]
pub fn budget_share_apply(state: State<AppState>, ops: Vec<BudgetShareOp>) -> Result<usize, String> {
    with_store(&state, |s| s.budget_share_apply(&ops))
}

#[tauri::command]
pub fn budget_share_clear(state: State<AppState>) -> Result<(), String> {
    with_store(&state, |s| s.budget_share_clear())
}
