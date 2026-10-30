//! 민원처리(10단계) 명령. 저장 규칙은 core의 process·order에 있고, 여기는 파일·폴더·윈도우 프로그램 일을 해요.
//!
//! - 가져올 폴더: AI가 민원 한 건마다 JSON 파일 하나를 놓아요(사양서 "민원처리" 흐름 2).
//!   사진·위치도 파일 이름은 가져올 폴더 → 다운로드 폴더 순으로 찾고, 민원 폴더(설정, 기본 D:\민원처리) 한 곳에
//!   `접수일_위치_보수내용_사진1.jpg`처럼 이름을 붙여 옮겨요(시안 Process·Files 판 – 파일함이 이 이름으로 찾아요).
//!   읽은 JSON은 가져올 폴더의 "읽음" 폴더로 옮겨요(이미 있는 접수번호도). 못 읽은 파일은 그대로 두고 이름을 알려 줘요.
//! - 지시부(2026-10-19 표준 지시부): 같은 공사 민원 여러 건을 표준 hwpx 양식 한 파일(`지시일_축약 공사명-연번.hwpx`)로
//!   민원 폴더에 써요(`make_order`). JPG는 한글로 쪽마다 따로 만들어요(`order_jpg`, 몇 초 걸려 따로 돌려요).
//! - 폰으로 보내기(사용자 2안): 지시부의 JPG를 모두 보낼 폴더에 복사하고 "보내는 중"(queued)으로 둬요.
//!   Claude가 대화에 올린 뒤 그 파일을 보낼 폴더의 "보냄" 폴더로 옮기면 `check_sent`가 보고 전송 완료(sent)로 바꿔요.
//!   보낼 폴더에도 "보냄"에도 없으면(누가 지웠으면) 다시 보낼 수 있게 지시부 만듦(made)으로 돌려요.

use gilog_core::{Case, CasePatch, ProcessData, Work, WorkInput};
use tauri::State;

use crate::{with_store, AppState};

fn io(e: std::io::Error) -> String {
    e.to_string()
}

#[tauri::command]
pub fn process_data(app: tauri::AppHandle, state: State<AppState>) -> Result<ProcessData, String> {
    let d = with_store(&state, |s| s.process_data())?;
    allow_case_photos(&app, &d.cases);
    Ok(d)
}

/// 민원 사진·위치도 폴더만 미리 보기로 읽게(✔4)
fn allow_case_photos(app: &tauri::AppHandle, cases: &[Case]) {
    crate::guard::allow_preview_files(app, cases.iter().flat_map(|c| c.photos.iter().map(|p| p.as_str()).chain(std::iter::once(c.map.as_str()))));
}

#[tauri::command]
pub fn save_work(state: State<AppState>, id: Option<i64>, work: WorkInput) -> Result<Vec<Work>, String> {
    with_store(&state, |s| s.save_work(id, &work))
}

#[tauri::command]
pub fn delete_work(state: State<AppState>, id: i64) -> Result<Vec<Work>, String> {
    with_store(&state, |s| s.delete_work(id))
}

#[tauri::command]
pub fn update_case(app: tauri::AppHandle, state: State<AppState>, no: String, patch: CasePatch) -> Result<Case, String> {
    let c = with_store(&state, |s| s.update_case(&no, &patch))?;
    allow_case_photos(&app, std::slice::from_ref(&c));
    Ok(c)
}

#[tauri::command]
pub fn delete_case(state: State<AppState>, no: String) -> Result<(), String> {
    with_store(&state, |s| s.delete_case(&no))
}

mod claude;
mod inbox;
mod open;
mod order;
mod pick;
#[cfg(test)]
mod guard_tests;
#[cfg(test)]
mod tests;

pub use claude::*;
pub use inbox::*;
pub use open::*;
pub use order::*;
pub use pick::*;
