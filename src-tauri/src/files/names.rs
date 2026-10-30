//! 이름 – 윈도우가 못 쓰는 이름 검사, 새 폴더, 이름 바꾸기(하나·여러 개).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::*;

/// 윈도우가 장치 이름으로 쓰는 이름(CON, PRN, AUX, NUL, COM1~9, LPT1~9) – 확장자가 붙어도 못 써요
pub(crate) fn reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end().to_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && matches!(stem.as_bytes()[3], b'1'..=b'9'))
}

pub(super) fn check_name(name: &str) -> Result<(), String> {
    let bad = name.trim().is_empty()
        || name.chars().any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || (c as u32) < 32)
        || name == "."
        || name == ".."
        || name.ends_with('.')
        || name.ends_with(' ');
    if bad {
        Err("bad_name".into())
    } else if reserved_name(name) {
        Err("reserved_name".into())
    } else {
        Ok(())
    }
}

/// 새 폴더. 만든 경로를 돌려줘요.
#[tauri::command]
pub fn fs_mkdir(app: AppHandle, dir: String, name: String) -> Result<String, String> {
    crate::guard::writable(&dir, &crate::guard::protected(&app))?;
    mkdir(dir, name)
}

pub(crate) fn mkdir(dir: String, name: String) -> Result<String, String> {
    check_name(&name)?;
    let p = Path::new(&dir).join(name.trim());
    if p.exists() {
        return Err("exists".into());
    }
    fs::create_dir(&p).map_err(io)?;
    Ok(p.to_string_lossy().into_owned())
}

/// 이름 바꾸기. 바뀐 경로를 돌려줘요. 대소문자만 바꾸는 것도 돼요.
#[tauri::command]
pub fn fs_rename(app: AppHandle, path: String, name: String) -> Result<String, String> {
    crate::guard::removable(&path, &crate::guard::protected(&app))?;
    rename_one(Path::new(&path), &name).map(|p| p.to_string_lossy().into_owned())
}

pub(crate) fn rename_one(path: &Path, name: &str) -> Result<PathBuf, String> {
    check_name(name)?;
    let to = path.with_file_name(name);
    let same_but_case = to.to_string_lossy().to_lowercase() == path.to_string_lossy().to_lowercase();
    if to.exists() && !same_but_case {
        return Err("exists".into());
    }
    fs::rename(path, &to).map_err(io)?;
    Ok(to)
}

/// 일괄 이름 바꾸기 한 줄
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct RenameItem {
    pub path: String,
    pub name: String,
}

/// 일괄 이름 바꾸기. 겹치는 이름은 화면이 미리 막지만, 여기서도 한 줄이라도 실패하면 이미 바꾼 것을 되돌려요.
/// 바꾼 결과(되돌리기용: 새 경로 → 옛 이름)를 돌려줘요.
#[tauri::command]
pub fn fs_rename_many(app: AppHandle, items: Vec<RenameItem>) -> Result<Vec<RenameItem>, String> {
    let prot = crate::guard::protected(&app);
    for it in &items {
        crate::guard::removable(&it.path, &prot)?;
    }
    rename_many(&items)
}

pub(crate) fn rename_many(items: &[RenameItem]) -> Result<Vec<RenameItem>, String> {
    for it in items {
        check_name(&it.name)?;
    }
    // 서로 이름을 맞바꾸는 경우(a→b, b→a)를 위해 먼저 임시 이름으로 옮겨요.
    let mut temp: Vec<(PathBuf, PathBuf, String)> = Vec::new(); // (임시, 원래, 새 이름)
    let undo_temp = |temp: &Vec<(PathBuf, PathBuf, String)>| {
        for (t, orig, _) in temp.iter().rev() {
            let _ = fs::rename(t, orig);
        }
    };
    for (i, it) in items.iter().enumerate() {
        let p = PathBuf::from(&it.path);
        let t = p.with_file_name(format!(".gilog-rename-{}-{}", std::process::id(), i));
        if let Err(e) = fs::rename(&p, &t) {
            undo_temp(&temp);
            return Err(io(e));
        }
        temp.push((t, p, it.name.clone()));
    }
    let mut done: Vec<(PathBuf, PathBuf)> = Vec::new(); // (새 경로, 원래)
    for (t, orig, name) in &temp {
        let to = orig.with_file_name(name);
        if to.exists() {
            for (n, o) in done.iter().rev() {
                let _ = fs::rename(n, o);
            }
            for (t2, o2, _) in &temp {
                if t2.exists() {
                    let _ = fs::rename(t2, o2);
                }
            }
            return Err("exists".into());
        }
        if let Err(e) = fs::rename(t, &to) {
            for (n, o) in done.iter().rev() {
                let _ = fs::rename(n, o);
            }
            for (t2, o2, _) in &temp {
                if t2.exists() {
                    let _ = fs::rename(t2, o2);
                }
            }
            return Err(io(e));
        }
        done.push((to, orig.clone()));
    }
    Ok(done
        .into_iter()
        .map(|(n, o)| RenameItem { path: n.to_string_lossy().into_owned(), name: o.file_name().unwrap().to_string_lossy().into_owned() })
        .collect())
}
