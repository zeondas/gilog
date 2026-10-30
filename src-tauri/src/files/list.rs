//! 폴더 읽기 – 목록·하위 폴더·드라이브·홈, 윈도우 탐색기 "홈" 항목, 열린 폴더 지켜보기(`fs_watch`).

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::*;

/// 폴더 안 목록. 숨김 파일은 show_hidden일 때만.
#[tauri::command]
pub async fn fs_list(app: AppHandle, path: String, show_hidden: bool) -> Result<Vec<Entry>, String> {
    // 이 폴더의 사진을 미리 보기로 읽게 허용해요 – 처음엔 아무 곳도 허용하지 않아서(✔4)
    crate::guard::allow_preview_dir(&app, Path::new(&path));
    tauri::async_runtime::spawn_blocking(move || list(Path::new(&path), show_hidden)).await.map_err(|e| e.to_string())?
}

pub(crate) fn list(dir: &Path, show_hidden: bool) -> Result<Vec<Entry>, String> {
    // zip 파일은 폴더처럼 들어가요(호환 B, 2026-10-20 사용자) – "…\자료.zip\사진" 같은 경로
    if !dir.is_dir() {
        if let Some((z, inner)) = zip_split(dir) {
            return list_zip(&z, &inner);
        }
    }
    let mut out = Vec::new();
    for e in fs::read_dir(dir).map_err(io)? {
        let Ok(e) = e else { continue };
        if let Some(en) = entry_of(&e.path()) {
            if en.hidden && !show_hidden {
                continue;
            }
            out.push(en);
        }
    }
    Ok(out)
}

/// 트리용: 하위 폴더만, 그 아래 폴더가 더 있는지(꺾쇠)와 함께
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TreeDir {
    pub name: String,
    pub path: String,
    pub has_children: bool,
}

#[tauri::command]
pub async fn fs_subdirs(path: String, show_hidden: bool) -> Result<Vec<TreeDir>, String> {
    tauri::async_runtime::spawn_blocking(move || subdirs(Path::new(&path), show_hidden)).await.map_err(|e| e.to_string())?
}

pub(crate) fn subdirs(dir: &Path, show_hidden: bool) -> Result<Vec<TreeDir>, String> {
    let mut out: Vec<TreeDir> = list(dir, show_hidden)?
        .into_iter()
        .filter(|e| e.dir)
        .map(|e| {
            let has_children = fs::read_dir(&e.path)
                .map(|it| it.flatten().any(|c| c.file_type().map(|t| t.is_dir()).unwrap_or(false)))
                .unwrap_or(false);
            TreeDir { name: e.name, path: e.path, has_children }
        })
        .collect();
    out.sort_by_key(|d| d.name.to_lowercase());
    Ok(out)
}

/// 드라이브 목록
#[tauri::command]
pub fn fs_drives() -> Vec<Drive> {
    #[cfg(windows)]
    {
        crate::files_win::drives()
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
        vec![
            Drive { name: "/".into(), path: "/".into(), label: "루트".into(), kind: "fixed".into(), free: 0, total: 0 },
            Drive { name: "~".into(), path: home, label: "홈".into(), kind: "fixed".into(), free: 0, total: 0 },
        ]
    }
}

/// 처음 여는 폴더(문서)
#[tauri::command]
pub fn fs_home(app: AppHandle) -> String {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "C:\\".into())
}

/// 경로가 폴더로 있는지(경로 칸에 고쳐 적은 것 확인)
#[tauri::command]
pub fn fs_is_dir(path: String) -> bool {
    let p = Path::new(&path);
    p.is_dir() || (!p.exists() && zip_split(p).is_some_and(|(z, inner)| zip_has_dir(&z, &inner)))
}

/// 윈도우 탐색기 "홈"의 항목(즐겨찾기 폴더·최근 파일). group "fav"(폴더) · "recent"(파일), name은 윈도우가 보여 주는 이름.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct QuickItem {
    #[serde(flatten)]
    pub entry: Entry,
    pub group: String,
}

#[tauri::command]
pub async fn fs_quick() -> Vec<QuickItem> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(|| {
            crate::files_win::quick_items()
                .into_iter()
                .filter_map(|(name, path)| {
                    let mut entry = entry_of(Path::new(&path))?;
                    entry.name = name;
                    let group = if entry.dir { "fav" } else { "recent" }.to_string();
                    Some(QuickItem { entry, group })
                })
                .collect()
        })
        .await
        .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

// ---------- 폴더 감시 ----------

/// 지금 창들이 보고 있는 폴더를 지켜보다 바뀌면 "fs-changed"(그 폴더 경로)를 보내요.
#[derive(Default)]
pub struct Watch(pub Mutex<Option<notify::RecommendedWatcher>>);

#[tauri::command]
pub fn fs_watch(app: AppHandle, state: tauri::State<Watch>, dirs: Vec<String>) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    let handle = app.clone();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            let mut sent = HashSet::new();
            for p in ev.paths {
                if let Some(parent) = p.parent() {
                    let d = parent.to_string_lossy().into_owned();
                    if sent.insert(d.clone()) {
                        let _ = handle.emit("fs-changed", d);
                    }
                }
            }
        }
    })
    .map_err(|e| e.to_string())?;
    for d in dirs.iter().collect::<HashSet<_>>() {
        let _ = w.watch(Path::new(d), RecursiveMode::NonRecursive);
    }
    *state.0.lock().unwrap() = Some(w);
    Ok(())
}
