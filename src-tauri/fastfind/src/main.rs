// 창(검은 명령 창) 없이 돌아요 — 설치 파일이 check를 부를 때 창이 번쩍이지 않게
#![cfg_attr(windows, windows_subsystem = "windows")]
//! 기록 빠른 찾기 도우미(gilog-search.exe) — 2026-10-20 사용자 2안(Everything 방식).
//!
//! 윈도우 서비스로 돌며 NTFS 드라이브마다 파일 목록(이름·부모 폴더·속성)을 들고 있다가,
//! 기록 앱이 이름 통로(\\.\pipe\gilog-search)로 물으면 바로 답해요.
//! 목록은 드라이브의 변경 기록(USN)을 읽어 몇 초 만에 만들고, 그 뒤로 1초마다 바뀐 것만 맞춰요.
//! 변경 기록을 읽으려면 관리자 권한이 필요해 서비스(LocalSystem)로 돌아요.
//!
//! 명령:
//!   gilog-search install   관리자로 실행 — Program Files\giLog Search에 복사하고 서비스로 등록·시작
//!   gilog-search check     이미 같은 것이 깔려 돌고 있으면 0(설치 파일이 관리자 허용을 다시 묻지 않게)
//!   gilog-search run       서비스 관리자가 부르는 것
//!   gilog-search console   시험용 — 서비스 없이 돌며 5초마다 상태를 log.txt에(관리자로)

mod index;
mod state;
#[cfg(windows)]
mod win;

use serde::{Deserialize, Serialize};

pub use index::{Hit, Query};

/// 앱이 보내는 물음 한 줄(JSON)
#[derive(Deserialize, Debug)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Request {
    Status,
    Find(Query),
}

#[derive(Serialize, Debug)]
pub struct DriveState {
    pub drive: String,
    pub count: usize,
    pub ready: bool,
}

#[derive(Serialize, Debug)]
#[serde(untagged)]
pub enum Response {
    Status { version: &'static str, drives: Vec<DriveState> },
    Find { hits: Vec<Hit>, more: bool },
    Error { error: String },
}

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() {
    let arg = std::env::args().nth(1).unwrap_or_default();
    #[cfg(windows)]
    {
        let code = win::main(&arg);
        std::process::exit(code);
    }
    #[cfg(not(windows))]
    {
        eprintln!("윈도우에서만 돌아요 ({arg})");
        std::process::exit(1);
    }
}
