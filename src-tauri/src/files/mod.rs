//! 탐색기(11단계)에서 앱(Rust)이 맡는 파일 일이에요.
//!
//! - 폴더 읽기·드라이브 목록·새 폴더·이름 바꾸기·복사·옮기기·지우기(휴지통/완전 삭제)·찾기·폴더 감시.
//! - 같은 이름 처리: 화면이 먼저 `fs_conflicts`로 겹치는 파일을 받아 사용자에게 묻고(한 파일씩, 1안),
//!   고른 것(`over`·`skip`·`both`)을 `fs_transfer`에 함께 보내요. 폴더가 겹치면 합치고 안의 파일을 다시 따져요.
//!   "둘 다 두기"는 새 파일 이름의 확장자 앞에 " (2)"(있으면 (3)…)를 붙여요.
//! - 윈도우에만 있는 것(드라이브 이름·남은 용량, 윈도우 아이콘, 윈도우 우클릭 메뉴, 숨김 속성,
//!   기본 프로그램으로 열기)은 `files_win.rs`에 있어요. 리눅스(작업 공간)에서는 비슷한 흉내로 돌아요.
//! - 탐색기의 화면 상태(탭·열 폭 등)는 화면이 암호화 파일 kv의 `files.state`에 저장해요. 여기서는 저장하지 않아요.

use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// 목록 한 줄
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub size: u64,
    /// 수정한 때(밀리초). 읽지 못하면 0
    pub modified: i64,
    /// 만든 때(밀리초, 일괄 이름 바꾸기의 생성일 열)
    pub created: i64,
    pub hidden: bool,
    /// 회사 보안(DRM)이 걸린 것으로 보이는 파일
    pub locked: bool,
}

/// 드라이브 단추 하나
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// "C:"
    pub name: String,
    /// "C:\"
    pub path: String,
    pub label: String,
    /// fixed · removable · network · cdrom · other
    pub kind: String,
    pub free: u64,
    pub total: u64,
}

pub(crate) fn ms(t: std::io::Result<std::time::SystemTime>) -> i64 {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn io(e: std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::NotFound => "not_found".into(),
        std::io::ErrorKind::PermissionDenied => "denied".into(),
        std::io::ErrorKind::AlreadyExists => "exists".into(),
        _ => format!("io:{e}"),
    }
}

fn entry_of(path: &Path) -> Option<Entry> {
    let meta = fs::metadata(path).ok().or_else(|| fs::symlink_metadata(path).ok())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned());
    let dir = meta.is_dir();
    Some(Entry {
        hidden: is_hidden(path, &meta),
        locked: !dir && looks_locked(path),
        name,
        path: path.to_string_lossy().into_owned(),
        dir,
        size: if dir { 0 } else { meta.len() },
        modified: ms(meta.modified()),
        created: ms(meta.created()),
    })
}

#[cfg(windows)]
fn is_hidden(_path: &Path, meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    // FILE_ATTRIBUTE_HIDDEN(2) | FILE_ATTRIBUTE_SYSTEM(4)
    meta.file_attributes() & 0x6 != 0
}

#[cfg(not(windows))]
fn is_hidden(path: &Path, _meta: &fs::Metadata) -> bool {
    path.file_name().map(|n| n.to_string_lossy().starts_with('.')).unwrap_or(false)
}

/// 회사 보안 프로그램이 잠근 파일인지 머리 부분으로 짐작해요.
/// 어떤 보안 프로그램인지 아직 몰라요(사용자가 회사에서 확인 예정) – 흔한 국산 DRM 표시만 봐요.
/// 틀려도 배지 하나라 해가 없어요. 회사 PC에서 맞는지 확인할 것(시험 항목).
fn looks_locked(path: &Path) -> bool {
    const MARKS: [&[u8]; 6] = [b"SCDSA00", b"<!-- FasooSecureContainer", b"DRMONE", b"MarkAny", b"<DOCUMENT SAFER", b"DSCSFTCF"];
    let Ok(mut f) = fs::File::open(path) else { return false };
    let mut head = [0u8; 512];
    let n = f.read(&mut head).unwrap_or(0);
    let head = &head[..n];
    MARKS.iter().any(|m| head.windows(m.len()).any(|w| w == *m))
}

mod archive;
mod find;
mod list;
mod names;
mod shell;
mod transfer;
mod undo;
#[cfg(test)]
mod tests;

pub use archive::*;
pub use find::*;
pub use list::*;
pub use names::*;
pub use shell::*;
pub use transfer::*;
pub use undo::*;
