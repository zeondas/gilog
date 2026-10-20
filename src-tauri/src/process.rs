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

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use gilog_core::{fill_standard, korean_date, Case, CaseInput, CasePatch, Order, OrderPatch, ProcessData, StdItem, Work, WorkInput};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{with_store, AppState};

fn io(e: std::io::Error) -> String {
    e.to_string()
}

#[tauri::command]
pub fn process_data(state: State<AppState>) -> Result<ProcessData, String> {
    with_store(&state, |s| s.process_data())
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
pub fn update_case(state: State<AppState>, no: String, patch: CasePatch) -> Result<Case, String> {
    with_store(&state, |s| s.update_case(&no, &patch))
}

#[tauri::command]
pub fn delete_case(state: State<AppState>, no: String) -> Result<(), String> {
    with_store(&state, |s| s.delete_case(&no))
}

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
fn free_path(dir: &Path, name: &str) -> PathBuf {
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
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to)?;
    fs::remove_file(from)
}

/// 새 지시부 이름: 지시부 파일도, 같은 이름의 JPG도 없을 때까지 "(2)"·"(3)"을 붙여요.
fn order_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let free = |s: &str| !dir.join(format!("{s}.{ext}")).exists() && !dir.join(format!("{s}.jpg")).exists();
    if free(stem) {
        return dir.join(format!("{stem}.{ext}"));
    }
    let s = (2..).map(|n| format!("{stem} ({n})")).find(|s| free(s)).unwrap();
    dir.join(format!("{s}.{ext}"))
}

/// zip 안의 그림 파일(jpg·jpeg·png)을 가져올 폴더에 풀고 그 절대 경로들을 돌려줘요(이름 순). zip은 지우지 않아요.
fn unzip_images(z: &Path, into: &Path) -> std::io::Result<Vec<String>> {
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
fn find_file(name: &str, dirs: &[&Path]) -> Option<PathBuf> {
    let n = name.trim();
    if n.is_empty() {
        return None;
    }
    let p = Path::new(n);
    if p.is_absolute() {
        return p.is_file().then(|| p.to_path_buf());
    }
    dirs.iter().map(|d| d.join(n)).find(|p| p.is_file())
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
}

/// 가져올 폴더 파일 하나에 민원 하나, 또는 여러 건의 배열이 들어 있어요.
fn parse_inbox_file(text: &str) -> Option<Vec<CaseInput>> {
    let text = text.trim_start_matches('\u{feff}');
    if let Ok(one) = serde_json::from_str::<CaseInput>(text) {
        if !one.no.trim().is_empty() {
            return Some(vec![one]);
        }
    }
    serde_json::from_str::<Vec<CaseInput>>(text).ok().filter(|v| !v.is_empty())
}

#[tauri::command]
pub fn read_inbox(state: State<AppState>, inbox: String, downloads: String, root: String) -> Result<InboxResult, String> {
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

    let mut res = InboxResult { added: vec![], skipped: 0, failed: vec![], missing_files: vec![] };
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
            // zip 첨부(신문고가 가끔 묶어 줘요)는 풀어서 안의 그림 파일을 사진으로 — 2026-10-20 사용자: 보통은 낱개, 가끔 zip
            let mut photos: Vec<String> = Vec::new();
            for n in &c.photos {
                if n.trim().to_ascii_lowercase().ends_with(".zip") {
                    match find_file(n, &dirs) {
                        Some(z) => match unzip_images(&z, &inbox) {
                            Ok(list) if !list.is_empty() => photos.extend(list),
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
                        if !name.trim().is_empty() {
                            res.missing_files.push(name.trim().to_string());
                        }
                        String::new()
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
    Ok(res)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderRequest {
    /// 새 지시부로 묶을 접수번호들(같은 공사). `order`가 있으면 쓰지 않아요.
    #[serde(default)]
    pub nos: Vec<String>,
    /// 다시 만들 지시부 번호(같은 연번·같은 파일 이름)
    #[serde(default)]
    pub order: Option<i64>,
    /// 민원 폴더(설정)
    pub root: String,
    /// 지시일 YYYY-MM-DD
    pub date: String,
    /// 표준 양식 파일(설정). 비우면 앱에 넣어 둔 양식.
    #[serde(default)]
    pub tpl: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderResult {
    pub order: Order,
    /// 지시부에 든 건(항목 순서)
    pub cases: Vec<Case>,
    pub works: Vec<Work>,
    /// 양식에 없던 자리
    pub missing: Vec<String>,
}

/// 양식의 {주소}: 지역 + 위치. 주소불명이면 그 말만.
fn address(c: &Case) -> String {
    if c.place == gilog_core::UNKNOWN_PLACE || c.area.trim().is_empty() || c.place.starts_with(c.area.trim()) {
        c.place.clone()
    } else {
        format!("{} {}", c.area.trim(), c.place)
    }
}

/// 지시부 파일 이름 앞부분: 지시일(YYMMDD)_축약 공사명-연번(두 자리). 예: 261019_동부권 도로시설물 1지구-03
pub fn order_stem(date: &str, work: &str, seq: i64) -> String {
    let d: String = date.chars().filter(|c| c.is_ascii_digit()).collect();
    let d = if d.len() == 8 { d[2..].to_string() } else { d };
    format!("{d}_{}-{seq:02}", safe_name(work))
}

/// 쪽마다 만든 JPG 이름: 한 쪽이면 stem.jpg, 여러 쪽이면 stem_1.jpg, stem_2.jpg…
fn page_names(stem: &str, n: usize) -> Vec<String> {
    if n == 1 {
        vec![format!("{stem}.jpg")]
    } else {
        (1..=n).map(|k| format!("{stem}_{k}.jpg")).collect()
    }
}

/// 한글이 쪽마다 쓴 그림 파일을 쪽 순서로(이름 끝 숫자 순, 숫자 없는 것이 첫 쪽)
fn sort_pages(names: &mut [String]) {
    let key = |n: &String| -> u64 {
        let stem = n.rsplit_once('.').map(|x| x.0).unwrap_or(n);
        let digits: String = stem.chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
        digits.parse().unwrap_or(0)
    };
    names.sort_by(|a, b| key(a).cmp(&key(b)).then(a.cmp(b)));
}

/// [지시부 만들기]: 같은 공사 민원 여러 건을 표준 양식 한 파일로(민원 폴더에 `지시일_축약-연번.hwpx`).
/// `order`가 있으면 그 지시부를 다시 만들어요(같은 연번·같은 파일, JPG는 지워요).
#[tauri::command]
pub fn make_order(state: State<AppState>, req: OrderRequest) -> Result<OrderResult, String> {
    let (old, work, cases, agent) = with_store(&state, |s| {
        let (old, work, cases) = match req.order {
            Some(id) => {
                let o = s.order(id)?;
                let cases = s.order_cases(id)?;
                (Some(o.clone()), s.work(o.work)?, cases)
            }
            None => {
                let (w, list) = s.plan_order(&req.nos)?;
                (None, w, list)
            }
        };
        let agent = work
            .contact
            .and_then(|id| s.contacts_data().ok()?.contacts.into_iter().find(|c| c.id == id))
            .map(|c| c.name)
            .unwrap_or_default();
        Ok((old, work, cases, agent))
    })?;
    if cases.is_empty() {
        return Err("고른 민원이 없어요".into());
    }
    let tpl = req.tpl.trim();
    if !tpl.is_empty() && !Path::new(tpl).is_file() {
        return Err("template".into());
    }
    let seq = old.as_ref().map(|o| o.seq).unwrap_or(work.next_seq);
    let date = old.as_ref().map(|o| o.date.clone()).filter(|d| !d.is_empty()).unwrap_or_else(|| req.date.trim().to_string());
    let folder = PathBuf::from(req.root.trim());
    fs::create_dir_all(&folder).map_err(io)?;
    let out = match &old {
        Some(o) if !o.file.is_empty() && Path::new(&o.file).parent().is_some_and(|p| p.is_dir()) => PathBuf::from(&o.file),
        _ => order_path(&folder, &order_stem(&date, &work.name, seq), "hwpx"),
    };

    let mut header = BTreeMap::new();
    header.insert("공사명".to_string(), if work.full.trim().is_empty() { work.name.clone() } else { work.full.clone() });
    header.insert("축약 공사명".to_string(), work.name.clone());
    header.insert("연번".to_string(), format!("{seq:02}"));
    header.insert("지시일".to_string(), korean_date(&date));
    header.insert("현장대리인".to_string(), agent);
    header.insert("시공사".to_string(), work.co.clone());
    let items: Vec<StdItem> = cases
        .iter()
        .map(|c| StdItem {
            title: if c.short.trim().is_empty() { c.summary.clone() } else { c.short.clone() },
            address: address(c),
            note: c.note.clone(),
            map: c.map.clone(),
            photo: c.photos.first().cloned().unwrap_or_default(),
        })
        .collect();
    let report = fill_standard((!tpl.is_empty()).then(|| Path::new(tpl)), &out, &header, &items).map_err(crate::code)?;

    let file = out.display().to_string();
    let (order, cases, works) = with_store(&state, |s| {
        let order = match &old {
            Some(o) => {
                for j in &o.jpgs {
                    let _ = fs::remove_file(j);
                }
                s.update_order(
                    o.id,
                    &OrderPatch { file: Some(file.clone()), jpgs: Some(vec![]), stage: Some("made".into()), outbox: Some(vec![]), sent_at: Some(String::new()), dirty: Some(false), ..Default::default() },
                )?
            }
            None => {
                let nos: Vec<String> = cases.iter().map(|c| c.no.clone()).collect();
                s.create_order(work.id, seq, &date, &file, &nos)?
            }
        };
        let cases = s.order_cases(order.id)?;
        Ok((order, cases, s.process_data()?.works))
    })?;
    Ok(OrderResult { order, cases, works, missing: report.missing })
}

/// PowerShell 글자 안에 넣을 경로('는 두 번).
#[cfg_attr(not(windows), allow(dead_code))]
fn ps_str(p: &Path) -> String {
    format!("'{}'", p.display().to_string().replace('\'', "''"))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn jpg_script(file: &Path, jpg: &Path) -> String {
    // 한글: 그림(JPG)으로 저장하면 쪽마다 파일이 생겨요(빈 임시 폴더에 받아요).
    format!(
        "$ErrorActionPreference='Stop'\n\
         $h = New-Object -ComObject HWPFrame.HwpObject\n\
         try {{ $h.RegisterModule('FilePathCheckDLL','FilePathCheckerModule') | Out-Null }} catch {{}}\n\
         try {{ $h.XHwpWindows.Item(0).Visible = $false }} catch {{}}\n\
         try {{\n\
           if (-not $h.Open({src}, 'HWPX', 'forceopen:true')) {{ throw 'open' }}\n\
           $h.SaveAs({dst}, 'JPG', '') | Out-Null\n\
         }} finally {{ $h.Clear(1); $h.Quit() }}\n",
        src = ps_str(file),
        dst = ps_str(jpg)
    )
}

#[cfg(windows)]
fn run_powershell(script: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // 스크립트는 임시 파일로(글자 깨짐·따옴표 문제 없이). 한글 경로 때문에 BOM 붙은 UTF-8로 써요.
    let path = std::env::temp_dir().join(format!("gilog_jpg_{}.ps1", std::process::id()));
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend(script.as_bytes());
    fs::write(&path, bytes).map_err(io)?;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&path)
        .creation_flags(0x0800_0000)
        .output()
        .map_err(io);
    let _ = fs::remove_file(&path);
    let out = out?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        let line = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
        Err(if line.is_empty() { "jpg".into() } else { line })
    }
}

/// 지시부 파일로 쪽마다 JPG를 만들어요(한글이 있어야 해요). 바뀐 지시부를 돌려줘요.
#[tauri::command]
pub async fn order_jpg(state: State<'_, AppState>, id: i64) -> Result<Order, String> {
    let o = with_store(&state, |s| s.order(id))?;
    let file = PathBuf::from(&o.file);
    if o.file.is_empty() || !file.is_file() {
        return Err("nofile".into());
    }
    for j in &o.jpgs {
        let _ = fs::remove_file(j);
    }
    // 한글이 쪽마다 파일을 쓰니 빈 임시 폴더에 받아 쪽 순서로 옮겨요.
    let tmp = std::env::temp_dir().join(format!("gilog_jpg_{}_{id}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(io)?;
    #[cfg(windows)]
    {
        let script = jpg_script(&file, &tmp.join("p.jpg"));
        let r = tauri::async_runtime::spawn_blocking(move || run_powershell(&script)).await.map_err(|e| e.to_string())?;
        if let Err(e) = r {
            let _ = fs::remove_dir_all(&tmp);
            return Err(e);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (jpg_script, fs::remove_dir_all(&tmp));
        return Err("windows".into());
    }
    #[allow(unreachable_code)]
    {
        let mut names: Vec<String> = fs::read_dir(&tmp)
            .map_err(io)?
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter(|n| n.to_ascii_lowercase().ends_with(".jpg") || n.to_ascii_lowercase().ends_with(".jpeg"))
            .collect();
        sort_pages(&mut names);
        if names.is_empty() {
            let _ = fs::remove_dir_all(&tmp);
            return Err("nojpg".into());
        }
        let dir = file.parent().unwrap_or(Path::new(".")).to_path_buf();
        let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("지시부").to_string();
        let mut jpgs = Vec::new();
        for (from, to) in names.iter().zip(page_names(&stem, names.len())) {
            let to = dir.join(to);
            let _ = fs::remove_file(&to);
            move_file(&tmp.join(from), &to).map_err(io)?;
            jpgs.push(to.display().to_string());
        }
        let _ = fs::remove_dir_all(&tmp);
        with_store(&state, |s| s.update_order(id, &OrderPatch { jpgs: Some(jpgs.clone()), ..Default::default() }))
    }
}

/// 폰으로 보내기: 지시부의 JPG(쪽마다)를 모두 보낼 폴더에 복사하고 "보내는 중"으로 적어요.
#[tauri::command]
pub fn send_order(state: State<AppState>, id: i64, outbox: String) -> Result<Order, String> {
    let o = with_store(&state, |s| s.order(id))?;
    if o.jpgs.is_empty() || o.jpgs.iter().any(|j| !Path::new(j).is_file()) {
        return Err("nojpg".into());
    }
    let outbox = PathBuf::from(outbox.trim());
    fs::create_dir_all(&outbox).map_err(io)?;
    let mut sent = Vec::new();
    for j in &o.jpgs {
        let jpg = Path::new(j);
        let name = jpg.file_name().and_then(|n| n.to_str()).unwrap_or("지시부.jpg").to_string();
        let to = free_path(&outbox, &name);
        fs::copy(jpg, &to).map_err(io)?;
        sent.push(to.display().to_string());
    }
    with_store(&state, |s| s.update_order(id, &OrderPatch { stage: Some("queued".into()), outbox: Some(sent.clone()), ..Default::default() }))
}

/// 지시부를 메일(korea.kr)로 보냈다고 적어요 – Claude가 보낸 메일함에서 확인한 뒤 화면이 불러요(2026-10-20).
#[tauri::command]
pub fn order_mailed(state: State<AppState>, id: i64, to: String, at: String) -> Result<Order, String> {
    with_store(&state, |s| s.update_order(id, &OrderPatch { mail_to: Some(to.trim().to_string()), mailed_at: Some(at.trim().to_string()), ..Default::default() }))
}

/// 보내는 중인 지시부를 살펴요: JPG가 모두 "보냄" 폴더에 있으면 전송 완료(보낼 폴더의 원본은 지워요),
/// 하나라도 어디에도 없으면 다시 보낼 수 있게 되돌려요. 바뀐 지시부만 돌려줘요.
#[tauri::command]
pub fn check_sent(state: State<AppState>, now: String) -> Result<Vec<Order>, String> {
    let list = with_store(&state, |s| s.process_data())?.orders;
    let mut changed = Vec::new();
    for o in list.into_iter().filter(|o| o.stage == "queued") {
        // Claude(민원처리 세션)가 대화에 올린 뒤 "보냄" 폴더에 같은 이름을 써 두면 그 쪽은 보낸 거예요.
        // 세션은 파일을 옮기거나 지울 수 없어서 원본은 기록이 지워요(2026-10-18).
        let done_of = |f: &Path| f.parent().zip(f.file_name()).map(|(d, n)| d.join(SENT_DIR).join(n)).is_some_and(|p| p.is_file());
        let files: Vec<PathBuf> = o.outbox.iter().map(PathBuf::from).collect();
        let all_done = !files.is_empty() && files.iter().all(|f| done_of(f));
        let lost = files.is_empty() || files.iter().any(|f| !done_of(f) && !f.is_file());
        let patch = if all_done {
            for f in &files {
                let _ = fs::remove_file(f);
            }
            OrderPatch { stage: Some("sent".into()), sent_at: Some(now.clone()), ..Default::default() }
        } else if lost {
            OrderPatch { stage: Some("made".into()), outbox: Some(vec![]), ..Default::default() }
        } else {
            continue;
        };
        changed.push(with_store(&state, |s| s.update_order(o.id, &patch))?);
    }
    Ok(changed)
}

/// Claude가 대화에 올린 파일을 옮겨 두는 보낼 폴더 안 폴더
pub const SENT_DIR: &str = "보냄";

/// 지시부 파일이나 민원 폴더를 윈도우 기본 프로그램(파워포인트·한글·탐색기)으로 열어요.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err("missing".into());
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(&p).spawn().map_err(io)?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&p).spawn().map_err(io)?;
    }
    Ok(())
}

/// 크롬 실행 파일 자리(설치 위치 두 곳). 없으면 None.
#[cfg(windows)]
fn chrome_exe() -> Option<PathBuf> {
    let rel = ["Google", "Chrome", "Application", "chrome.exe"];
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].iter().filter_map(std::env::var_os).map(|base| rel.iter().fold(PathBuf::from(base), |p, s| p.join(s))).find(|p| p.is_file())
}

/// 신문고(업무처리포털)를 **크롬**으로 열어요(2026-10-19 사용자 1안 – 회사 정책이 엣지에서 신문고를 IE 모드로 열어
/// Claude 확장이 읽지 못해요). 크롬이 없으면 "nochrome". 이 주소만 받아요.
#[tauri::command]
pub fn open_portal(url: String) -> Result<(), String> {
    if !(url == "https://gov.epeople.go.kr" || url.starts_with("https://gov.epeople.go.kr/")) {
        return Err("invalid".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const NO_WINDOW: u32 = 0x0800_0000;
        let Some(chrome) = chrome_exe() else { return Err("nochrome".into()) };
        std::process::Command::new(chrome).arg(&url).creation_flags(NO_WINDOW).spawn().map_err(io)?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().map_err(io)?;
    }
    Ok(())
}

/// 탐색기를 열어 그 파일을 골라 보여요(파일함이 생기기 전까지 "이 민원 파일 보기").
#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err("missing".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer는 /select, 뒤 경로를 따옴표째 받아야 띄어쓰기가 있어도 돼요.
        std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", p.display())).spawn().map_err(io)?;
    }
    #[cfg(not(windows))]
    {
        let dir = p.parent().unwrap_or(&p).to_path_buf();
        std::process::Command::new("xdg-open").arg(dir).spawn().map_err(io)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(safe_name("봉일천리  209-10 / 앞?"), "봉일천리 209-10 앞");
        assert_eq!(case_stem("2026-10-15", "봉일천리 209-10", "포트홀"), "261015_봉일천리 209-10_포트홀");
        assert_eq!(case_stem("2026-10-15", "주소불명", ""), "261015_주소불명");
        assert_eq!(case_stem("2026-10-15", "선유리_455", "균열"), "261015_선유리455_균열");
    }

    #[test]
    fn order_names_step_aside() {
        let d = std::env::temp_dir().join(format!("gilog_order_{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        let a = order_path(&d, "261015_봉일천리 209-10_포트홀", "pptx");
        assert!(a.ends_with("261015_봉일천리 209-10_포트홀.pptx"));
        fs::write(d.join("261015_봉일천리 209-10_포트홀.jpg"), b"x").unwrap();
        assert!(order_path(&d, "261015_봉일천리 209-10_포트홀", "pptx").ends_with("261015_봉일천리 209-10_포트홀 (2).pptx"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn final_answer_states() {
        assert_eq!(final_state("LOGIN_REQUIRED", false).0, "login");
        assert_eq!(final_state("새 민원 3건을 가져왔어요", false).0, "done");
        assert_eq!(final_state("오류: 확장 연결 안 됨\n자세히", true).0, "error");
        assert_eq!(final_state("신문고 로그인 화면이 떠서 멈췄어요", false).0, "login");
        assert!(final_state("PAGE_UNREADABLE", false).1.contains("IE 모드"));
        // 지시부 메일(2026-10-20)
        assert_eq!(final_state("MAIL_SENT", false).0, "done");
        assert_eq!(final_state("ATTACH_FAILED 파일 입력란을 못 찾았어요", false), ("error".into(), "첨부를 붙이지 못했어요 – 파일 입력란을 못 찾았어요".into()));
        assert_eq!(final_state("MAIL_FAILED", false).1, "메일을 보내지 못했어요");
    }

    #[test]
    fn explain_reasons() {
        assert!(explain("error: unknown option '--permission-prompts'", "", Some(1)).contains("옵션"));
        assert!(explain("", "Claude in Chrome extension is not connected", Some(1)).contains("확장"));
        assert!(explain("TypeError: fetch failed", "", Some(1)).contains("인터넷"));
        assert!(explain("", "", Some(3)).contains("종료 코드 3"));
    }

    #[test]
    fn log_line_hides_bodies() {
        let v: serde_json::Value = serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","content":"홍길동 010-1234-5678","is_error":false}]}});
        let l = log_line(&v, "");
        assert!(!l.contains("홍길동") && l.contains("tool_result"));
        let v: serde_json::Value = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"D:\\a.json","content":"비밀"}},{"type":"text","text":"적었어요"}]}});
        let l = log_line(&v, "");
        assert!(l.contains("tool_use Write file_path=D:\\a.json") && !l.contains("비밀") && !l.contains("적었어요"));
    }

    #[test]
    fn unzip_only_images() {
        let dir = std::env::temp_dir().join(format!("gilog-unzip-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let z = dir.join("첨부.zip");
        {
            let f = fs::File::create(&z).unwrap();
            let mut w = zip::ZipWriter::new(f);
            let o = zip::write::SimpleFileOptions::default();
            for (n, b) in [("b.jpg", b"jpg".as_slice()), ("a.png", b"png".as_slice()), ("memo.txt", b"txt".as_slice()), ("sub/c.JPEG", b"j".as_slice())] {
                w.start_file(n, o).unwrap();
                std::io::Write::write_all(&mut w, b).unwrap();
            }
            w.finish().unwrap();
        }
        let out = unzip_images(&z, &dir).unwrap();
        let names: Vec<String> = out.iter().map(|p| Path::new(p).file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["첨부_a.png", "첨부_b.jpg", "첨부_c.JPEG"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn inbox_file_one_or_many() {
        assert_eq!(parse_inbox_file("\u{feff}{\"no\":\"1AA-1\",\"photos\":[\"a.jpg\"]}").unwrap()[0].photos, vec!["a.jpg"]);
        assert_eq!(parse_inbox_file("[{\"no\":\"1\"},{\"no\":\"2\"}]").unwrap().len(), 2);
        assert!(parse_inbox_file("{}").is_none());
        assert!(parse_inbox_file("깨진 파일").is_none());
    }

    #[test]
    fn script_quotes_paths() {
        let s = jpg_script(Path::new("D:/민원/261019_O'Neil-03.hwpx"), Path::new("C:/t/p.jpg"));
        assert!(s.contains("'D:/민원/261019_O''Neil-03.hwpx'"));
        assert!(s.contains("HWPFrame.HwpObject"));
    }

    #[test]
    fn order_names_and_pages() {
        assert_eq!(order_stem("2026-10-19", "동부권 도로시설물 1지구", 3), "261019_동부권 도로시설물 1지구-03");
        assert_eq!(page_names("a", 1), vec!["a.jpg"]);
        assert_eq!(page_names("a", 2), vec!["a_1.jpg", "a_2.jpg"]);
        let mut v: Vec<String> = ["p010.jpg", "p002.jpg", "p.jpg", "p9.jpg"].iter().map(|s| s.to_string()).collect();
        sort_pages(&mut v);
        assert_eq!(v, ["p.jpg", "p002.jpg", "p9.jpg", "p010.jpg"]);
    }
}

// ---------- 민원 불러오기: Claude가 신문고를 읽어요 (2026-10-18 사용자 1안) ----------
//
// 단추를 누르면 Claude Code를 창 없이 실행해요(`claude -p --chrome`). Claude는 **크롬**의 Claude 확장으로
// 신문고 민원처리목록을 읽고, 새 민원 한 건마다 가져올 폴더에 결과 파일을 놓아요.
// 엣지는 안 돼요(2026-10-19 확인): 회사 정책이 신문고를 IE 모드로 열어 확장이 그 탭을 읽지 못하고,
// Claude는 멈추는 말이 LOGIN_REQUIRED뿐이라 "로그인 풀림"으로 끝났어요. 그래서 지침에 PAGE_UNREADABLE을 더했어요.
// 화면은 2초마다 `claude_status`와 `read_inbox`로 진행과 새 줄을 가져와요.
// 진행 수는 Claude가 가져올 폴더에 쓰는 `_진행.json`({"total":N,"done":k})에서 읽어요.
// 신문고 로그인이 풀려 있으면 Claude는 아무것도 쓰지 않고 마지막 답을 `LOGIN_REQUIRED`로 끝내요(사용자 1안 – 멈추고 알림).

#[derive(Default)]
pub struct ClaudeRun {
    inner: std::sync::Arc<std::sync::Mutex<RunInner>>,
}

#[derive(Default)]
struct RunInner {
    child: Option<std::process::Child>,
    status: RunStatus,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    /// idle · running · done · login · stopped · error
    pub state: String,
    pub total: Option<u32>,
    pub done: Option<u32>,
    /// 오류일 때 사람이 읽을 이유(`explain`)
    pub message: String,
    /// 이번 실행의 `_claude.log` 경로(끝난 뒤, 화면의 [로그 열기])
    pub log: String,
    /// Claude가 열어 보고 "기록에 이미 있음"으로 건너뛴 접수번호(`_건너뜀.json`) — 화면이 "본 번호"에 더해 다음부터 열지 않아요
    #[serde(default)]
    pub skipped: Vec<String>,
}

/// 진행 파일 이름(read_inbox는 `_`로 시작하는 파일을 읽지 않아요)
pub const PROGRESS_FILE: &str = "_진행.json";
/// 실행 기록 – 명령줄·Claude가 보낸 stream-json 요약·stderr·종료 코드(돌릴 때마다 덮어씀).
/// 신문고 본문·민원인 정보가 섞이지 않게 도구 결과·Claude 글은 넣지 않고 종류·도구 이름·주소·파일 경로만 남겨요.
pub const LOG_FILE: &str = "_claude.log";
/// Claude가 열어 보고 건너뛴 접수번호 목록 {"nos":[…]}(돌릴 때마다 지우고 새로)
pub const SKIPPED_FILE: &str = "_건너뜀.json";

/// stream-json 한 줄을 로그에 남길 모양으로 줄여요(개인정보가 들어갈 수 있는 글·도구 결과는 길이만).
fn log_line(v: &serde_json::Value, raw: &str) -> String {
    let t = v["type"].as_str().unwrap_or("");
    match t {
        // 시작 정보(버전·도구·MCP 서버 상태)·마지막 답은 그대로 – 민원 글이 들어가지 않아요
        "system" | "result" => raw.chars().take(4000).collect(),
        "assistant" => {
            let mut parts = Vec::new();
            if let Some(blocks) = v["message"]["content"].as_array() {
                for b in blocks {
                    match b["type"].as_str().unwrap_or("") {
                        "tool_use" => {
                            let inp = &b["input"];
                            let hint = ["url", "file_path", "path", "pattern", "command"]
                                .iter()
                                .find_map(|k| inp[k].as_str().map(|s| format!(" {k}={}", s.chars().take(160).collect::<String>())))
                                .unwrap_or_default();
                            parts.push(format!("tool_use {}{}", b["name"].as_str().unwrap_or("?"), hint));
                        }
                        "text" => parts.push(format!("text {}자", b["text"].as_str().map(|s| s.chars().count()).unwrap_or(0))),
                        other => parts.push(other.to_string()),
                    }
                }
            }
            format!("assistant: {}", parts.join(" · "))
        }
        "user" => {
            let mut parts = Vec::new();
            if let Some(blocks) = v["message"]["content"].as_array() {
                for b in blocks {
                    if b["type"] == "tool_result" {
                        let n = match &b["content"] {
                            serde_json::Value::String(s) => s.chars().count(),
                            serde_json::Value::Array(a) => a.iter().map(|c| c["text"].as_str().map(|s| s.chars().count()).unwrap_or(0)).sum(),
                            _ => 0,
                        };
                        parts.push(format!("tool_result {}자{}", n, if b["is_error"] == true { " 오류" } else { "" }));
                    }
                }
            }
            format!("user: {}", parts.join(" · "))
        }
        _ => format!("{t} {}", v["subtype"].as_str().unwrap_or("")),
    }
}

/// 멈춘 이유를 사람이 읽을 말로(원인 목록 ①~⑥). 모르면 첫 줄을 그대로 보여요.
fn explain(stderr: &str, result: &str, code: Option<i32>) -> String {
    let all = format!("{stderr}\n{result}");
    let low = all.to_lowercase();
    let first = all.lines().find(|l| !l.trim().is_empty()).unwrap_or("").chars().take(160).collect::<String>();
    if low.contains("unknown option") || low.contains("unknown argument") || low.contains("invalid argument") || low.contains("too many arguments") {
        format!("Claude Code 버전이 달라 옵션이 안 맞아요 – {first}")
    } else if low.contains("not logged in") || low.contains("please run /login") || low.contains("invalid api key") || low.contains("authentication") || low.contains("oauth") {
        "Claude Code 로그인이 필요해요 – 터미널에서 `claude`를 열어 로그인해 주세요".into()
    } else if low.contains("chrome") || low.contains("extension") || low.contains("browser") {
        format!("크롬의 Claude 확장과 이어지지 않았어요 – 크롬이 켜져 있고 확장에 로그인돼 있는지 봐 주세요 ({first})")
    } else if low.contains("enotfound") || low.contains("econnrefused") || low.contains("etimedout") || low.contains("fetch failed") || low.contains("certificate") || low.contains("proxy") || low.contains("network") {
        format!("인터넷 연결이 막혔어요(회사 프록시·보안 프로그램) – {first}")
    } else if low.contains("rate limit") || low.contains("usage limit") || low.contains("overloaded") {
        "Claude 사용 한도에 걸렸어요 – 잠시 뒤 다시 눌러 주세요".into()
    } else if !first.is_empty() {
        first
    } else {
        format!("이유를 남기지 않고 끝났어요(종료 코드 {})", code.map(|c| c.to_string()).unwrap_or_else(|| "없음".into()))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    /// Claude 실행 파일(설정, 처음 값 "claude")
    pub exe: String,
    /// 가져올 폴더
    pub inbox: String,
    /// 크롬 다운로드 폴더
    pub downloads: String,
    /// 지침 전체(화면이 만들어 넘겨요 – 공사 처리 범위·이미 있는 기록 포함)
    pub guide: String,
    /// 모델(sonnet·opus·haiku, 비우면 Claude Code 기본값) — 2026-10-20 속도: 처음 값 sonnet
    #[serde(default)]
    pub model: String,
}

/// 마지막 답에서 상태를 읽어요. 지침대로 LOGIN_REQUIRED가 아니어도 "로그인" 얘기로 끝나면 로그인 풀림으로 봐요(원인 ⑤).
fn final_state(result: &str, is_error: bool) -> (String, String) {
    // 지시부 메일(2026-10-20): 첨부·보내기 실패는 이유 한 줄과 함께 실패로
    let after = |tag: &str| result.split(tag).nth(1).map(|r| r.trim_start_matches([':', ' ', '–', '-']).lines().next().unwrap_or("").trim().to_string()).unwrap_or_default();
    if result.contains("ATTACH_FAILED") {
        let why = after("ATTACH_FAILED");
        return ("error".into(), if why.is_empty() { "첨부를 붙이지 못했어요".into() } else { format!("첨부를 붙이지 못했어요 – {why}") });
    }
    if result.contains("MAIL_FAILED") {
        let why = after("MAIL_FAILED");
        return ("error".into(), if why.is_empty() { "메일을 보내지 못했어요".into() } else { format!("메일을 보내지 못했어요 – {why}") });
    }
    if result.contains("MAIL_SENT") {
        return ("done".into(), String::new());
    }
    if result.contains("PAGE_UNREADABLE") {
        ("error".into(), "Claude가 크롬 화면을 읽지 못했어요 – 크롬에 Claude 확장이 켜져 있고 엣지 확장은 꺼져 있는지 봐 주세요(엣지는 IE 모드라 못 읽어요)".into())
    } else if result.contains("LOGIN_REQUIRED") || (!is_error && result.contains("로그인") && !result.contains("새 민원")) {
        ("login".into(), String::new())
    } else if is_error {
        ("error".into(), result.to_string())
    } else {
        ("done".into(), String::new())
    }
}

/// Claude 실행 파일: 설정에 경로가 있으면 그것, "claude"(처음 값)면 설치기가 넣는 자리
/// `%USERPROFILE%\.local\bin\claude.exe`를 먼저 봐요(설치 직후 PATH가 아직 안 잡혀도 돼요).
fn claude_exe(set: &str) -> PathBuf {
    if !set.is_empty() && set != "claude" {
        return PathBuf::from(set);
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let p = PathBuf::from(home).join(".local").join("bin").join(if cfg!(windows) { "claude.exe" } else { "claude" });
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("claude")
}

#[tauri::command]
pub fn run_claude(run: State<ClaudeRun>, req: RunRequest) -> Result<(), String> {
    use std::io::{BufRead, Write};
    use std::process::{Command, Stdio};
    let mut g = run.inner.lock().map_err(|_| "busy".to_string())?;
    if let Some(c) = g.child.as_mut() {
        if c.try_wait().ok().flatten().is_none() {
            return Err("running".into());
        }
    }
    let inbox = PathBuf::from(req.inbox.trim());
    fs::create_dir_all(&inbox).map_err(io)?;
    let _ = fs::remove_file(inbox.join(PROGRESS_FILE));
    let _ = fs::remove_file(inbox.join(SKIPPED_FILE));
    let exe = claude_exe(req.exe.trim());
    let mut args: Vec<String> = [
        "-p", "아래 지침대로 국민신문고 민원을 가져와요.", "--chrome", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits", "--permission-prompts", "none",
        "--allowedTools", "mcp__claude-in-chrome,Read,Write,Edit,Glob",
        "--add-dir", req.downloads.trim(),
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let model = req.model.trim();
    if !model.is_empty() {
        args.push("--model".into());
        args.push(model.into());
    }

    // 실행 기록 – 돌릴 때마다 새로 써요. 지침 본문은 넣지 않아요(민원대장 기록 발췌가 들어 있어요).
    let log_path = inbox.join(LOG_FILE);
    let log = std::sync::Arc::new(std::sync::Mutex::new(fs::File::create(&log_path).map_err(io)?));
    // 줄마다 시작부터 지난 시간 `[+12.3s]` — 어느 걸음이 느린지 재요(2026-10-20)
    let t0 = std::time::Instant::now();
    let w = move |log: &std::sync::Arc<std::sync::Mutex<fs::File>>, s: &str| {
        if let Ok(mut f) = log.lock() {
            let _ = writeln!(f, "[+{:.1}s] {s}", t0.elapsed().as_secs_f64());
        }
    };
    w(&log, "# 기록 민원 불러오기 실행 기록(돌릴 때마다 덮어씀 – 시각은 파일 수정 시각)");
    w(&log, &format!("exe: {}", exe.display()));
    w(&log, &format!("cwd: {}", inbox.display()));
    w(&log, &format!("args: {}", args.iter().map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() }).collect::<Vec<_>>().join(" ")));
    w(&log, &format!("stdin: 지침 {}자", req.guide.chars().count()));
    w(&log, "");

    let mut cmd = Command::new(&exe);
    cmd.current_dir(&inbox).args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            w(&log, &format!("spawn 실패: {e}"));
            return Err(if e.kind() == std::io::ErrorKind::NotFound { "noclaude".to_string() } else { e.to_string() });
        }
    };
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(req.guide.as_bytes()) {
            w(&log, &format!("stdin 쓰기 실패: {e}"));
            return Err(io(e));
        }
        // 닫아야 Claude가 지침 끝을 알아요.
        drop(stdin);
        w(&log, "stdin: 지침 넘김(닫음)");
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    g.child = Some(child);
    g.status = RunStatus { state: "running".into(), log: log_path.to_string_lossy().into_owned(), ..Default::default() };
    drop(g);

    // 사용자가 멈추면 child가 없어져요 – 읽는 쪽은 그때 "stopped"를 덮어쓰지 않아요.
    let inner = run.inner.clone();
    let err_text = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(e) = stderr {
        let et = err_text.clone();
        let log = log.clone();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(e).lines().map_while(Result::ok) {
                w(&log, &format!("stderr: {line}"));
                if let Ok(mut s) = et.lock() {
                    if s.len() < 4000 {
                        s.push_str(&line);
                        s.push('\n');
                    }
                }
            }
        });
    }
    std::thread::spawn(move || {
        let mut last: Option<(String, String)> = None;
        let mut result_text = String::new();
        if let Some(out) = stdout {
            for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    w(&log, &format!("stdout: {}", line.chars().take(500).collect::<String>()));
                    continue;
                };
                w(&log, &log_line(&v, &line));
                if v["type"] == "result" {
                    result_text = v["result"].as_str().unwrap_or("").to_string();
                    last = Some(final_state(&result_text, v["is_error"].as_bool().unwrap_or(false)));
                }
            }
        }
        let Ok(mut g) = inner.lock() else { return };
        let code = g.child.as_mut().and_then(|c| c.wait().ok()).and_then(|s| s.code());
        w(&log, "");
        w(&log, &format!("exit: {}", code.map(|c| c.to_string()).unwrap_or_else(|| "없음".into())));
        if g.status.state != "running" {
            w(&log, "state: stopped(사용자가 멈춤)");
            return;
        }
        let stderr_all = err_text.lock().map(|s| s.clone()).unwrap_or_default();
        let (state, message) = match last {
            Some((s, r)) if s == "error" && !result_text.contains("PAGE_UNREADABLE") => ("error".to_string(), explain(&stderr_all, &r, code)),
            Some(x) => x,
            None if code == Some(0) => ("done".into(), String::new()),
            None => ("error".into(), explain(&stderr_all, &result_text, code)),
        };
        w(&log, &format!("state: {state}{}", if message.is_empty() { String::new() } else { format!(" – {message}") }));
        g.status.state = state;
        g.status.message = message;
        g.child = None;
    });
    Ok(())
}

#[tauri::command]
pub fn stop_claude(run: State<ClaudeRun>) -> Result<(), String> {
    let mut g = run.inner.lock().map_err(|_| "busy".to_string())?;
    if let Some(mut c) = g.child.take() {
        #[cfg(windows)]
        {
            // claude가 띄운 자식 프로세스까지 함께 끝내요.
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &c.id().to_string()]).creation_flags(0x0800_0000).status();
        }
        let _ = c.kill();
        let _ = c.wait();
    }
    if g.status.state == "running" {
        g.status.state = "stopped".into();
    }
    Ok(())
}

#[tauri::command]
pub fn claude_status(run: State<ClaudeRun>, inbox: String) -> Result<RunStatus, String> {
    let g = run.inner.lock().map_err(|_| "busy".to_string())?;
    let mut s = g.status.clone();
    if s.state.is_empty() {
        s.state = "idle".into();
    }
    if let Ok(t) = fs::read_to_string(PathBuf::from(inbox.trim()).join(SKIPPED_FILE)) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')) {
            s.skipped = v["nos"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(|x| x.trim().to_string())).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
        }
    }
    if let Ok(t) = fs::read_to_string(PathBuf::from(inbox.trim()).join(PROGRESS_FILE)) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(t.trim_start_matches('\u{feff}')) {
            s.total = v["total"].as_u64().map(|n| n as u32);
            s.done = v["done"].as_u64().map(|n| n as u32);
        }
    }
    Ok(s)
}
