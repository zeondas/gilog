//! 받은 민원 읽기 – 파일 이름 규칙, 첨부·위치도 찾아 옮기기, 가져올 폴더의 결과 파일 읽기(`read_inbox`).

use std::fs;
use std::path::{Path, PathBuf};

use gilog_core::{Case, CaseInput};
use serde::Serialize;
use tauri::State;

use crate::{with_store, AppState};

use super::*;

/// 파일 이름에 쓸 수 없는 글자를 빼요. 띄어쓰기는 하나로 남겨요("봉일천리 209-10").
pub fn safe_name(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '_') && !c.is_control())
        .collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    let t: String = t.chars().take(40).collect();
    t.trim().trim_end_matches('.').to_string()
}

/// 파일 이름 앞부분: 접수일(YYMMDD)_위치_보수내용. 보수내용이 없으면 접수일_위치.
pub fn case_stem(received: &str, place: &str, short: &str) -> String {
    let d: String = received.chars().filter(|c| c.is_ascii_digit()).collect();
    let d = if d.len() == 8 { d[2..].to_string() } else { d };
    [d, safe_name(place), safe_name(short)].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join("_")
}

/// 같은 이름이 있으면 "이름 (2).jpg"처럼 비켜 가요.
pub(super) fn free_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((a, b)) => (a.to_string(), format!(".{b}")),
        None => (name.to_string(), String::new()),
    };
    (2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap()
}

/// 파일을 옮겨요(드라이브가 달라도 – 복사하고 지워요).
pub(super) fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to)?;
    fs::remove_file(from)
}

/// 새 지시부 이름: 지시부 파일도, 같은 이름의 JPG도 없을 때까지 "(2)"·"(3)"을 붙여요.
pub(super) fn order_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let free = |s: &str| !dir.join(format!("{s}.{ext}")).exists() && !dir.join(format!("{s}.jpg")).exists();
    if free(stem) {
        return dir.join(format!("{stem}.{ext}"));
    }
    let s = (2..).map(|n| format!("{stem} ({n})")).find(|s| free(s)).unwrap();
    dir.join(format!("{s}.{ext}"))
}

/// zip 안의 그림 파일(jpg·jpeg·png)을 가져올 폴더에 풀고 그 절대 경로들을 돌려줘요(이름 순). zip은 지우지 않아요.
pub(super) fn unzip_images(z: &Path, into: &Path) -> std::io::Result<Vec<String>> {
    let f = fs::File::open(z)?;
    let mut a = zip::ZipArchive::new(f).map_err(|e| std::io::Error::other(e.to_string()))?;
    let mut out = Vec::new();
    let stem = z.file_stem().and_then(|s| s.to_str()).unwrap_or("zip").to_string();
    for i in 0..a.len() {
        let mut e = a.by_index(i).map_err(|e| std::io::Error::other(e.to_string()))?;
        if e.is_dir() {
            continue;
        }
        let name = Path::new(e.name()).file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let ext = Path::new(&name).extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(ext.as_str(), "jpg" | "jpeg" | "png") {
            continue;
        }
        let to = free_path(into, &format!("{stem}_{name}"));
        let mut w = fs::File::create(&to)?;
        std::io::copy(&mut e, &mut w)?;
        out.push(to.display().to_string());
    }
    out.sort();
    Ok(out)
}

/// 이름만 적힌 첨부를 찾아요: 절대 경로면 그대로, 아니면 가져올 폴더 → 다운로드 폴더 → 내 폴더\Downloads.
/// 받은 첨부를 찾아요: 이름 그대로 → 대소문자만 다른 것 → 크롬이 같은 이름에 붙인 " (1)" 꼴(가장 새 것).
/// 이렇게 넓게 찾는 까닭: Claude가 적은 이름과 크롬이 받은 이름이 조금 다르면 못 찾아 사진 없이 지시부에 들어갔어요(2026-10-21 사용자 신고).
pub(super) fn find_file(name: &str, dirs: &[&Path]) -> Option<PathBuf> {
    let n = name.trim();
    if n.is_empty() {
        return None;
    }
    let p = Path::new(n);
    if p.is_absolute() {
        if p.is_file() {
            return Some(p.to_path_buf());
        }
    }
    let base = p.file_name().and_then(|f| f.to_str()).unwrap_or(n);
    if let Some(hit) = dirs.iter().map(|d| d.join(base)).find(|p| p.is_file()) {
        return Some(hit);
    }
    let want = base.to_lowercase();
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for d in dirs {
        let Ok(rd) = fs::read_dir(d) else { continue };
        for e in rd.flatten() {
            let path = e.path();
            let Some(fname) = path.file_name().and_then(|f| f.to_str()) else { continue };
            if !path.is_file() || !same_download(&fname.to_lowercase(), &want) {
                continue;
            }
            let t = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            if best.as_ref().map_or(true, |(bt, _)| t > *bt) {
                best = Some((t, path));
            }
        }
    }
    best.map(|(_, p)| p)
}

/// `got`이 `want`와 같거나 크롬 중복 이름("사진 (2).jpg")인지(둘 다 소문자)
pub(super) fn same_download(got: &str, want: &str) -> bool {
    if got == want {
        return true;
    }
    let (ws, we) = match want.rfind('.') {
        Some(i) => (&want[..i], &want[i..]),
        None => (want, ""),
    };
    let Some(mid) = got.strip_prefix(ws).and_then(|r| r.strip_suffix(we)) else { return false };
    let mid = mid.trim_start();
    mid.len() > 2 && mid.starts_with('(') && mid.ends_with(')') && mid[1..mid.len() - 1].chars().all(|c| c.is_ascii_digit())
}

/// 위치도로 보이는 그림 이름인지(안전신문고 `…_MAPIMG.png`, 지도·위치·map)
pub(super) fn is_map_name(path: &str) -> bool {
    let f = Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or(path).to_lowercase();
    f.contains("mapimg") || f.contains("지도") || f.contains("위치") || f.contains("map")
}

/// zip에서 푼 그림을 (위치도, 현장사진)으로 나눠요. 위치도로 보이는 것이 하나도 없고 png가 맨 끝에 하나면 그것을 위치도로(안전신문고 "맨 아래 png" 규칙).
pub(super) fn split_map(list: Vec<String>) -> (Vec<String>, Vec<String>) {
    let (mut maps, mut rest): (Vec<String>, Vec<String>) = list.into_iter().partition(|p| is_map_name(p));
    if maps.is_empty() && rest.len() > 1 {
        let pngs = rest.iter().filter(|p| p.to_lowercase().ends_with(".png")).count();
        if pngs == 1 && rest.last().is_some_and(|p| p.to_lowercase().ends_with(".png")) {
            maps.push(rest.pop().unwrap());
        }
    }
    (maps, rest)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxResult {
    pub added: Vec<Case>,
    /// 이미 표에 있어 건너뛴 건수
    pub skipped: usize,
    /// 읽지 못한 파일 이름
    pub failed: Vec<String>,
    /// 찾지 못한 첨부 파일 이름
    pub missing_files: Vec<String>,
    /// 첨부가 아직 안 내려와 다음 번으로 미룬 파일 수(`hold`일 때만)
    pub held: usize,
}

/// 첨부를 기다리는 동안 민원 파일을 미루는 가장 긴 시간(2026-10-21 신속 자동화 ②1안 – Claude는 받기만 누르고 다음 건으로 가요)
pub const HOLD_SECS: u64 = 90;

/// 적힌 첨부 중 아직 받기 폴더에 없는 것이 있는지(빈 이름은 셈하지 않아요)
pub(super) fn waiting_for_files(names: &[&str], dirs: &[&Path]) -> bool {
    names.iter().any(|n| !n.trim().is_empty() && find_file(n, dirs).is_none())
}

/// 가져올 폴더 파일 하나에 민원 하나, 또는 여러 건의 배열이 들어 있어요.
pub(super) fn parse_inbox_file(text: &str) -> Option<Vec<CaseInput>> {
    let text = text.trim_start_matches('\u{feff}');
    if let Ok(one) = serde_json::from_str::<CaseInput>(text) {
        if !one.no.trim().is_empty() {
            return Some(vec![one]);
        }
    }
    serde_json::from_str::<Vec<CaseInput>>(text).ok().filter(|v| !v.is_empty())
}

#[tauri::command]
pub fn read_inbox(app: tauri::AppHandle, state: State<AppState>, inbox: String, downloads: String, root: String, hold: Option<bool>) -> Result<InboxResult, String> {
    let hold = hold.unwrap_or(false);
    let inbox = PathBuf::from(inbox.trim());
    let downloads = PathBuf::from(downloads.trim());
    let root = PathBuf::from(root.trim());
    if !inbox.is_dir() {
        return Err("inbox".into());
    }
    let done_dir = inbox.join("읽음");
    let mut files: Vec<PathBuf> = fs::read_dir(&inbox)
        .map_err(io)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("json")))
        // `_진행.json` 같은 Claude의 메모 파일은 민원이 아니에요.
        .filter(|p| !p.file_name().and_then(|n| n.to_str()).unwrap_or("").starts_with('_'))
        .collect();
    files.sort();

    let mut res = InboxResult { added: vec![], skipped: 0, failed: vec![], missing_files: vec![], held: 0 };
    for file in files {
        let fname = file.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let Some(list) = fs::read_to_string(&file).ok().and_then(|t| parse_inbox_file(&t)) else {
            // Claude가 아직 쓰는 중일 수 있어요 – 막 바뀐 파일은 다음에 다시 읽어요.
            let fresh = fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|d| d.as_secs() < 10);
            if !fresh {
                res.failed.push(fname);
            }
            continue;
        };
        // 실행 중에는 첨부가 다 내려올 때까지(최대 HOLD_SECS) 이 파일을 다음 번으로 미뤄요 – 사진 없이 들어가지 않게.
        if hold {
            let young = fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|d| d.as_secs() < HOLD_SECS);
            let user_dl = std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("Downloads"));
            let mut dirs = vec![inbox.as_path(), downloads.as_path()];
            if let Some(d) = user_dl.as_deref() {
                dirs.push(d);
            }
            let names: Vec<&str> = list.iter().flat_map(|c| c.photos.iter().map(|x| x.as_str()).chain(std::iter::once(c.map.as_str()))).collect();
            if young && waiting_for_files(&names, &dirs) {
                res.held += 1;
                continue;
            }
        }
        let mut ready = Vec::new();
        for mut c in list {
            let known = with_store(&state, |s| s.has_case(&c.no))?;
            if known {
                res.skipped += 1;
                continue;
            }
            let folder = root.clone();
            fs::create_dir_all(&folder).map_err(io)?;
            let stem = case_stem(&c.received, &c.place, &c.short);
            // 크롬 처음 값(내 폴더\Downloads)도 봐요 – 설정의 다운로드 폴더를 안 고쳐도 사진을 찾게(2026-10-19 1안).
            let user_dl = std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("Downloads"));
            let mut dirs = vec![inbox.as_path(), downloads.as_path()];
            if let Some(d) = user_dl.as_deref() {
                dirs.push(d);
            }
            // zip 첨부(신문고가 가끔 묶어 줘요)는 풀어서 안의 그림 파일을 사진으로 – 2026-10-20 사용자: 보통은 낱개, 가끔 zip
            let mut photos: Vec<String> = Vec::new();
            for n in &c.photos {
                if n.trim().to_ascii_lowercase().ends_with(".zip") {
                    match find_file(n, &dirs) {
                        // 일괄 받기 zip(접수번호.zip, 2026-10-21 22:59 사용자): 위치도 이름이면 map, 나머지는 현장사진
                        Some(z) => match unzip_images(&z, &inbox) {
                            Ok(list) if !list.is_empty() => {
                                let (maps, rest) = split_map(list);
                                if c.map.trim().is_empty() {
                                    if let Some(m) = maps.first() {
                                        c.map = m.clone();
                                    }
                                }
                                photos.extend(rest);
                            }
                            _ => res.missing_files.push(n.trim().to_string()),
                        },
                        None => res.missing_files.push(n.trim().to_string()),
                    }
                } else {
                    photos.push(n.clone());
                }
            }
            let mut take = |name: &str, label: &str| -> String {
                match find_file(name, &dirs) {
                    Some(p) => {
                        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("jpg").to_ascii_lowercase();
                        let to = free_path(&folder, &format!("{stem}_{label}.{ext}"));
                        match move_file(&p, &to) {
                            Ok(()) => to.display().to_string(),
                            Err(_) => p.display().to_string(),
                        }
                    }
                    None => {
                        // 못 찾은 이름은 남겨 둬요 – [지시부 만들기] 때 한 번 더 찾아요(2026-10-21).
                        if !name.trim().is_empty() {
                            res.missing_files.push(name.trim().to_string());
                        }
                        name.trim().to_string()
                    }
                }
            };
            c.photos = photos.iter().enumerate().map(|(i, n)| take(n, &format!("사진{}", i + 1))).filter(|p| !p.is_empty()).collect();
            c.map = take(&c.map.clone(), "위치도");
            c.folder = folder.display().to_string();
            ready.push(c);
        }
        let added = with_store(&state, |s| s.add_cases(&ready))?;
        res.added.extend(added);
        let _ = fs::create_dir_all(&done_dir);
        let _ = move_file(&file, &free_path(&done_dir, &fname));
    }
    allow_case_photos(&app, &res.added);
    Ok(res)
}
