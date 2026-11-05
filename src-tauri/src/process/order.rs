//! 지시부 – 표준 hwpx 만들기(`make_order`), 쪽마다 JPG(`order_jpg`), 폰으로 보내기·메일 보냄 표시·보냈는지 확인.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use gilog_core::{fill_standard, korean_date, Case, Order, OrderPatch, StdItem, Work};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{with_store, AppState};

use super::*;

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
    /// 가져올 폴더·다운로드 폴더(설정) – 불러올 때 못 찾은 사진을 다시 찾는 곳
    #[serde(default)]
    pub inbox: String,
    #[serde(default)]
    pub downloads: String,
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
    /// 현장사진 없이 들어간 민원 접수번호(2026-10-21 – 화면이 알려요)
    pub no_photo: Vec<String>,
}

/// 양식의 {주소}: 지역 + 위치. 주소불명이면 그 말만.
pub(super) fn address(c: &Case) -> String {
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
pub(super) fn page_names(stem: &str, n: usize) -> Vec<String> {
    if n == 1 {
        vec![format!("{stem}.jpg")]
    } else {
        (1..=n).map(|k| format!("{stem}_{k}.jpg")).collect()
    }
}

/// 한글이 쪽마다 쓴 그림 파일을 쪽 순서로(이름 끝 숫자 순, 숫자 없는 것이 첫 쪽)
pub(super) fn sort_pages(names: &mut [String]) {
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
    // 사진 경로가 없으면(불러올 때 못 찾음·옮겨짐) 민원 폴더·가져올 폴더·다운로드 폴더에서 이름으로 한 번 더 찾아요.
    let user_dl = std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("Downloads"));
    let (inbox_dir, dl_dir) = (PathBuf::from(req.inbox.trim()), PathBuf::from(req.downloads.trim()));
    let mut dirs: Vec<&Path> = vec![folder.as_path()];
    for d in [inbox_dir.as_path(), dl_dir.as_path()] {
        if !d.as_os_str().is_empty() {
            dirs.push(d);
        }
    }
    if let Some(d) = user_dl.as_deref() {
        dirs.push(d);
    }
    let pic = |p: &String| -> String {
        let p = p.trim();
        if p.is_empty() {
            return String::new();
        }
        if Path::new(p).is_file() {
            return p.to_string();
        }
        find_file(p, &dirs).map(|f| f.display().to_string()).unwrap_or_default()
    };
    let items: Vec<StdItem> = cases
        .iter()
        .map(|c| StdItem {
            title: if c.short.trim().is_empty() { c.summary.clone() } else { c.short.clone() },
            address: address(c),
            note: c.note.clone(),
            map: pic(&c.map),
            photo: c.photos.iter().map(|p| pic(p)).find(|p| !p.is_empty()).unwrap_or_default(),
        })
        .collect();
    let no_photo: Vec<String> = cases.iter().zip(&items).filter(|(_, it)| it.photo.is_empty()).map(|(c, _)| c.no.clone()).collect();
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
    Ok(OrderResult { order, cases, works, missing: report.missing, no_photo })
}

/// PowerShell 글자 안에 넣을 경로('는 두 번).
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn ps_str(p: &Path) -> String {
    format!("'{}'", p.display().to_string().replace('\'', "''"))
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn jpg_script(file: &Path, jpg: &Path) -> String {
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
pub(super) fn run_powershell(script: &str) -> Result<(), String> {
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
pub fn send_order(app: tauri::AppHandle, state: State<AppState>, id: i64, outbox: String) -> Result<Order, String> {
    // 보낼 폴더가 자료 폴더·앱 설정 폴더·윈도우 폴더면 막아요(②-2 ✔1)
    crate::guard::export_to(outbox.trim(), &crate::guard::protected(&app))?;
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

/// 지시부를 메일(korea.kr)로 보냈다고 적어요 – Claude가 끝낸 뒤 화면이 불러요(2026-10-20).
/// `ok`: 보낸메일함에서 같은 제목을 찾았는지(못 찾았으면 "확인 필요", 사람이 [보냈어요로 표시]하면 true) · `subject`: 보낸 제목(보낸 증거 카드)
#[tauri::command]
pub fn order_mailed(state: State<AppState>, id: i64, to: String, at: String, subject: Option<String>, ok: Option<bool>) -> Result<Order, String> {
    with_store(&state, |s| {
        s.update_order(
            id,
            &OrderPatch {
                mail_to: Some(to.trim().to_string()),
                mailed_at: Some(at.trim().to_string()),
                mail_subject: subject.map(|v| v.trim().to_string()),
                mail_ok: Some(ok.unwrap_or(true)),
                ..Default::default()
            },
        )
    })
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
