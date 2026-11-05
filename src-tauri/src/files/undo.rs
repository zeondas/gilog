//! 되돌리기 걸음(`fs_undo`)과 지우기(휴지통·완전 삭제).

use std::fs;
use std::path::Path;

use serde::Deserialize;
use tauri::AppHandle;

use super::*;

// ---------- 되돌리기·다시 하기(Ctrl+Z·Y, 호환 A1) ----------

/// 되돌리기 한 걸음. 화면이 일을 할 때 거꾸로 할 걸음을 미리 만들어 둬요.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum Step {
    /// 옮기기(이름 바꾸기 포함). 대상에 같은 이름 폴더가 있으면 안으로 합쳐요, 파일이 있으면 건너뛰어요.
    Move { from: String, to: String },
    /// 복사(폴더는 통째로). 대상이 있으면 건너뛰어요.
    Copy { from: String, to: String },
    /// 휴지통으로
    Trash { paths: Vec<String> },
    /// 휴지통에서 꺼내기 – since(유닉스 초) 뒤에 지운 것 가운데 가장 새것
    Restore { paths: Vec<String>, since: i64 },
    /// 빈 폴더 만들기
    Mkdir { path: String },
}

#[tauri::command]
pub async fn fs_undo(app: AppHandle, steps: Vec<Step>) -> Result<Summary, String> {
    check_steps(&steps, &crate::guard::protected(&app))?;
    tauri::async_runtime::spawn_blocking(move || Ok(run_steps(&steps))).await.map_err(|e| e.to_string())?
}

/// 되돌리기 걸음도 화면이 보내요 – 지우기·옮기기와 같은 검사를 거쳐요
pub(crate) fn check_steps(steps: &[Step], prot: &crate::guard::Protected) -> Result<(), String> {
    use crate::guard::{plain, removable, writable};
    for st in steps {
        match st {
            Step::Move { from, to } => {
                removable(from, prot)?;
                writable(to, prot)?;
            }
            Step::Copy { from, to } => {
                plain(from)?;
                writable(to, prot)?;
            }
            Step::Trash { paths } => {
                for p in paths {
                    removable(p, prot)?;
                }
            }
            Step::Restore { paths, .. } => {
                for p in paths {
                    writable(p, prot)?;
                }
            }
            Step::Mkdir { path } => {
                writable(path, prot)?;
            }
        }
    }
    Ok(())
}

pub(crate) fn run_steps(steps: &[Step]) -> Summary {
    let mut sum = Summary::default();
    let mut tell = |r: Result<usize, String>, path: &str| match r {
        Ok(n) => sum.done += n,
        Err(e) => sum.errors.push((path.to_string(), e)),
    };
    for st in steps {
        match st {
            Step::Move { from, to } => tell(move_back(Path::new(from), Path::new(to)).map(|_| 1), from),
            Step::Copy { from, to } => {
                let (f, t) = (Path::new(from), Path::new(to));
                let r = if t.exists() {
                    Err("exists".to_string())
                } else if !f.exists() {
                    Err("not_found".to_string())
                } else {
                    t.parent().map(fs::create_dir_all).transpose().map_err(io).and_then(|_| copy_tree(f, t)).map(|_| 1)
                };
                tell(r, from)
            }
            Step::Mkdir { path } => tell(fs::create_dir_all(path).map(|_| 1).map_err(io), path),
            Step::Trash { paths } => {
                let have: Vec<&String> = paths.iter().filter(|p| Path::new(p).exists()).collect();
                let n = have.len();
                let r = if n == 0 { Ok(0) } else { trash::delete_all(&have).map(|_| n).map_err(|e| format!("trash:{e}")) };
                tell(r, paths.first().map(String::as_str).unwrap_or(""))
            }
            Step::Restore { paths, since } => tell(restore(paths, *since), paths.first().map(String::as_str).unwrap_or("")),
        }
    }
    sum
}

/// from → to로 옮겨요. 같은 드라이브면 이름만, 다른 드라이브면 복사 뒤 지워요.
/// to에 같은 이름 폴더가 이미 있으면 안의 것을 하나씩 옮겨 합치고, 파일이 있으면 "exists".
pub(crate) fn move_back(from: &Path, to: &Path) -> Result<(), String> {
    if !from.exists() {
        return Err("not_found".into());
    }
    let same_but_case = from.to_string_lossy().to_lowercase() == to.to_string_lossy().to_lowercase();
    if to.exists() && !same_but_case {
        if from.is_dir() && to.is_dir() {
            let mut first_err = None;
            for e in fs::read_dir(from).map_err(io)?.flatten() {
                if let Err(er) = move_back(&e.path(), &to.join(e.file_name())) {
                    first_err.get_or_insert(er);
                }
            }
            let _ = fs::remove_dir(from);
            return first_err.map_or(Ok(()), Err);
        }
        return Err("exists".into());
    }
    if let Some(p) = to.parent() {
        fs::create_dir_all(p).map_err(io)?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_tree(from, to)?;
    if from.is_dir() { fs::remove_dir_all(from) } else { fs::remove_file(from) }.map_err(io)
}

/// 폴더째 복사(파일이면 파일 하나). 대상에 있는 파일은 덮지 않아요.
pub(super) fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    if from.is_dir() {
        fs::create_dir_all(to).map_err(io)?;
        for e in fs::read_dir(from).map_err(io)?.flatten() {
            copy_tree(&e.path(), &to.join(e.file_name()))?;
        }
        Ok(())
    } else if to.exists() {
        Err("exists".into())
    } else {
        fs::copy(from, to).map(|_| ()).map_err(io)
    }
}

/// 휴지통에서 그 경로로 지운 것 가운데 since 뒤의 가장 새것을 제자리로 꺼내요.
/// 윈도우 휴지통의 이름은 확장자를 숨긴 채 올 수 있어 원래 이름은 우리가 아는 것으로 써요.
pub(super) fn restore(paths: &[String], since: i64) -> Result<usize, String> {
    let items = trash::os_limited::list().map_err(|e| format!("trash:{e}"))?;
    let mut pick: Vec<trash::TrashItem> = Vec::new();
    for p in paths {
        let want = Path::new(p);
        let (Some(parent), Some(name)) = (want.parent(), want.file_name()) else { continue };
        let name = name.to_string_lossy().to_lowercase();
        let stem = want.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let parent_l = parent.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase();
        let best = items
            .iter()
            .filter(|it| it.original_parent.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase() == parent_l)
            .filter(|it| {
                let n = it.name.to_string_lossy().to_lowercase();
                n == name || n == stem
            })
            // 리눅스 휴지통은 지운 때를 못 읽으면 음수예요
            .filter(|it| it.time_deleted < 0 || it.time_deleted >= since - 10)
            .max_by_key(|it| it.time_deleted);
        if let Some(it) = best {
            pick.push(trash::TrashItem { id: it.id.clone(), name: want.file_name().unwrap().to_os_string(), original_parent: parent.to_path_buf(), time_deleted: it.time_deleted });
        }
    }
    let n = pick.len();
    if n == 0 {
        return Err("not_in_trash".into());
    }
    trash::os_limited::restore_all(pick).map_err(|e| match e {
        trash::Error::RestoreCollision { .. } => "exists".to_string(),
        e => format!("trash:{e}"),
    })?;
    Ok(n)
}

pub(super) fn copy_empty_dirs(src: &Path, dst: &Path) {
    let _ = fs::create_dir_all(dst);
    if let Ok(it) = fs::read_dir(src) {
        for e in it.flatten() {
            if e.path().is_dir() {
                copy_empty_dirs(&e.path(), &dst.join(e.file_name()));
            }
        }
    }
}

/// 옮기고 남은 빈 폴더들을 지워요(파일이 남아 있으면 그 폴더는 두어요 – 건너뛴 파일).
pub(super) fn remove_if_empty_tree(p: &Path) -> bool {
    if let Ok(it) = fs::read_dir(p) {
        let mut empty = true;
        for e in it.flatten() {
            let c = e.path();
            if c.is_dir() {
                if !remove_if_empty_tree(&c) {
                    empty = false;
                }
            } else {
                empty = false;
            }
        }
        if empty {
            return fs::remove_dir(p).is_ok();
        }
    }
    false
}

/// 지우기. permanent가 거짓이면 휴지통으로 보내요.
#[tauri::command]
pub async fn fs_delete(app: AppHandle, paths: Vec<String>, permanent: bool) -> Result<(), String> {
    let prot = crate::guard::protected(&app);
    for p in &paths {
        crate::guard::removable(p, &prot)?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        if permanent {
            for p in &paths {
                let p = Path::new(p);
                if p.is_dir() {
                    fs::remove_dir_all(p).map_err(io)?;
                } else {
                    fs::remove_file(p).map_err(io)?;
                }
            }
            Ok(())
        } else {
            trash::delete_all(&paths).map_err(|e| format!("trash:{e}"))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
