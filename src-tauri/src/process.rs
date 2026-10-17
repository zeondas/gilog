//! 민원처리(10단계) 명령. 저장 규칙은 core의 process·order에 있고, 여기는 파일·폴더·윈도우 프로그램 일을 해요.
//!
//! - 받은편지함: AI가 민원 한 건마다 JSON 파일 하나를 놓아요(사양서 "민원처리" 흐름 2).
//!   사진·위치도 파일 이름은 받은편지함 → 다운로드 폴더 순으로 찾고, 민원 폴더(설정, 기본 D:\민원처리) 한 곳에
//!   `접수일_위치_보수내용_사진1.jpg`처럼 이름을 붙여 옮겨요(시안 Process·Files 판 — 파일함이 이 이름으로 찾아요).
//!   읽은 JSON은 받은편지함의 "읽음" 폴더로 옮겨요(이미 있는 접수번호도). 못 읽은 파일은 그대로 두고 이름을 알려 줘요.
//! - 지시부: 양식을 채워 민원 폴더에 쓰고(`make_order`), JPG는 파워포인트·한글로 따로 만들어요(`order_jpg`, 몇 초 걸려 따로 돌려요).
//! - 폰으로 보내기(사용자 2안): JPG를 보낼편지함 폴더에 복사하고 "보내는 중"(queued)으로 둬요.
//!   Claude가 대화에 올린 뒤 그 파일을 보낼편지함의 "보냄" 폴더로 옮기면 `check_sent`가 보고 전송 완료(sent)로 바꿔요.
//!   보낼편지함에도 "보냄"에도 없으면(누가 지웠으면) 다시 보낼 수 있게 지시부 만듦(made)으로 돌려요.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use gilog_core::{fill_order, Case, CaseInput, CasePatch, OrderFill, ProcessData, Work, WorkInput};
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

/// 파일을 옮겨요(드라이브가 달라도 — 복사하고 지워요).
fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to)?;
    fs::remove_file(from)
}

/// 이름만 적힌 첨부를 찾아요: 절대 경로면 그대로, 아니면 받은편지함 → 다운로드 폴더.
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

/// 받은편지함 파일 하나에 민원 하나, 또는 여러 건의 배열이 들어 있어요.
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
        .collect();
    files.sort();

    let mut res = InboxResult { added: vec![], skipped: 0, failed: vec![], missing_files: vec![] };
    for file in files {
        let fname = file.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        let Some(list) = fs::read_to_string(&file).ok().and_then(|t| parse_inbox_file(&t)) else {
            res.failed.push(fname);
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
            let dirs = [inbox.as_path(), downloads.as_path()];
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
            c.photos = c.photos.iter().enumerate().map(|(i, n)| take(n, &format!("사진{}", i + 1))).filter(|p| !p.is_empty()).collect();
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
    pub no: String,
    /// 민원 폴더의 맨 위(설정, 기본 D:\민원처리)
    pub root: String,
    /// 지시자(설정의 이름·연락처를 화면이 이어 붙여요)
    pub signer: String,
    /// 지시일 "2026. 10. 17."
    pub date: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderResult {
    pub case: Case,
    pub seq: i64,
    pub work_name: String,
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

#[tauri::command]
pub fn make_order(state: State<AppState>, req: OrderRequest) -> Result<OrderResult, String> {
    let (c, w) = with_store(&state, |s| {
        let c = s.case(&req.no)?;
        let id = c.work.ok_or_else(|| gilog_core::Error::Invalid("공사를 먼저 골라 주세요".into()))?;
        Ok((c.clone(), s.work(id)?))
    })?;
    let tpl = PathBuf::from(w.tpl.trim());
    if w.tpl.trim().is_empty() || !tpl.is_file() {
        return Err("template".into());
    }
    let ext = tpl.extension().and_then(|e| e.to_str()).unwrap_or("pptx").to_ascii_lowercase();
    let folder = PathBuf::from(if c.folder.trim().is_empty() { req.root.trim() } else { c.folder.trim() });
    fs::create_dir_all(&folder).map_err(io)?;

    // 연번은 쓰기 직전에 받아요(적어 둔 번호가 있으면 그것).
    let seq = with_store(&state, |s| s.take_seq(w.id, &c.seq))?;
    let mut text = BTreeMap::new();
    text.insert("연번".to_string(), seq.to_string());
    text.insert("지시자".to_string(), req.signer.trim().to_string());
    text.insert("주소".to_string(), address(&c));
    text.insert("보수내용".to_string(), c.summary.clone());
    text.insert("고려사항".to_string(), c.note.clone());
    text.insert("지시일".to_string(), req.date.trim().to_string());
    let mut images = BTreeMap::new();
    if !c.map.is_empty() {
        images.insert("위치도".to_string(), c.map.clone());
    }
    for (i, p) in c.photos.iter().enumerate() {
        let key = if i == 0 { "현장사진".to_string() } else { format!("현장사진{}", i + 1) };
        images.insert(key, p.clone());
    }
    // 다시 만들면 전 파일을 덮어써요(이름이 같아요).
    let out = folder.join(format!("{}.{ext}", case_stem(&c.received, &c.place, &c.short)));
    // 그림 자리가 없는 사진(현장사진2…)은 "없는 자리"로 알리지 않아요.
    let report = fill_order(&tpl, &out, &OrderFill { text, images }).map_err(crate::code)?;
    let missing = report.missing.into_iter().filter(|m| m.starts_with('{') || m == "위치도" || m == "현장사진").collect();

    let case = with_store(&state, |s| {
        s.update_case(
            &c.no,
            &CasePatch {
                seq: Some(seq.to_string()),
                stage: Some("made".into()),
                folder: Some(folder.display().to_string()),
                order_file: Some(out.display().to_string()),
                order_jpg: Some(String::new()),
                ..Default::default()
            },
        )
    })?;
    Ok(OrderResult { case, seq, work_name: w.name, missing })
}

/// PowerShell 글자 안에 넣을 경로('는 두 번).
#[cfg_attr(not(windows), allow(dead_code))]
fn ps_str(p: &Path) -> String {
    format!("'{}'", p.display().to_string().replace('\'', "''"))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn jpg_script(file: &Path, jpg: &Path) -> String {
    let is_hwpx = file.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("hwpx"));
    if is_hwpx {
        // 한글: 그림으로 저장하면 쪽마다 파일이 생길 수 있어 첫 쪽을 찾아 이름을 맞춰요.
        format!(
            "$ErrorActionPreference='Stop'\n\
             $h = New-Object -ComObject HWPFrame.HwpObject\n\
             try {{ $h.RegisterModule('FilePathCheckDLL','FilePathCheckerModule') | Out-Null }} catch {{}}\n\
             try {{ $h.XHwpWindows.Item(0).Visible = $false }} catch {{}}\n\
             try {{\n\
               if (-not $h.Open({src}, 'HWPX', 'forceopen:true')) {{ throw 'open' }}\n\
               $h.SaveAs({dst}, 'JPG', '') | Out-Null\n\
             }} finally {{ $h.Clear(1); $h.Quit() }}\n\
             $want = {dst}\n\
             if (-not (Test-Path -LiteralPath $want)) {{\n\
               $stem = [IO.Path]::GetFileNameWithoutExtension($want)\n\
               $f = Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($want)) -Filter ($stem + '*.jpg') | Sort-Object Name | Select-Object -First 1\n\
               if ($f) {{ Move-Item -LiteralPath $f.FullName -Destination $want }} else {{ throw 'nojpg' }}\n\
             }}\n",
            src = ps_str(file),
            dst = ps_str(jpg)
        )
    } else {
        // 파워포인트: 첫 장을 가로 1920px로 내보내요. 다른 발표 파일이 열려 있으면 파워포인트는 그대로 둬요.
        format!(
            "$ErrorActionPreference='Stop'\n\
             $pp = New-Object -ComObject PowerPoint.Application\n\
             $p = $pp.Presentations.Open({src}, -1, 0, 0)\n\
             try {{\n\
               $w = 1920; $hh = [int](1920 * $p.PageSetup.SlideHeight / $p.PageSetup.SlideWidth)\n\
               $p.Slides.Item(1).Export({dst}, 'JPG', $w, $hh)\n\
             }} finally {{ $p.Close() }}\n\
             if ($pp.Presentations.Count -eq 0) {{ $pp.Quit() }}\n",
            src = ps_str(file),
            dst = ps_str(jpg)
        )
    }
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

/// 지시부 파일로 JPG를 만들어 경로를 돌려줘요. pptx는 파워포인트, hwpx는 한글이 있어야 해요.
#[tauri::command]
pub async fn order_jpg(state: State<'_, AppState>, no: String) -> Result<Case, String> {
    let c = with_store(&state, |s| s.case(&no))?;
    let file = PathBuf::from(&c.order_file);
    if c.order_file.is_empty() || !file.is_file() {
        return Err("nofile".into());
    }
    let jpg = file.with_extension("jpg");
    let _ = fs::remove_file(&jpg);
    #[cfg(windows)]
    {
        let script = jpg_script(&file, &jpg);
        tauri::async_runtime::spawn_blocking(move || run_powershell(&script)).await.map_err(|e| e.to_string())??;
    }
    #[cfg(not(windows))]
    {
        let _ = jpg_script;
        return Err("windows".into());
    }
    #[allow(unreachable_code)]
    {
        if !jpg.is_file() {
            return Err("nojpg".into());
        }
        with_store(&state, |s| s.update_case(&no, &CasePatch { order_jpg: Some(jpg.display().to_string()), ..Default::default() }))
    }
}

/// 폰으로 보내기: JPG를 보낼편지함에 복사하고 "보내는 중"으로 적어요.
#[tauri::command]
pub fn send_order(state: State<AppState>, no: String, outbox: String) -> Result<Case, String> {
    let c = with_store(&state, |s| s.case(&no))?;
    let jpg = PathBuf::from(&c.order_jpg);
    if c.order_jpg.is_empty() || !jpg.is_file() {
        return Err("nojpg".into());
    }
    let outbox = PathBuf::from(outbox.trim());
    fs::create_dir_all(&outbox).map_err(io)?;
    let name = jpg.file_name().and_then(|n| n.to_str()).unwrap_or("지시부.jpg").to_string();
    let to = free_path(&outbox, &name);
    fs::copy(&jpg, &to).map_err(io)?;
    with_store(&state, |s| {
        s.update_case(&no, &CasePatch { stage: Some("queued".into()), outbox_file: Some(to.display().to_string()), ..Default::default() })
    })
}

/// 보내는 중인 건을 살펴요: "보냄" 폴더에 있으면 전송 완료, 어디에도 없으면 다시 보낼 수 있게 되돌려요. 바뀐 건만 돌려줘요.
#[tauri::command]
pub fn check_sent(state: State<AppState>, now: String) -> Result<Vec<Case>, String> {
    let list = with_store(&state, |s| s.process_data())?.cases;
    let mut changed = Vec::new();
    for c in list.into_iter().filter(|c| c.stage == "queued") {
        let f = PathBuf::from(&c.outbox_file);
        if f.is_file() {
            continue;
        }
        let done = f.parent().zip(f.file_name()).map(|(d, n)| d.join(SENT_DIR).join(n)).is_some_and(|p| p.is_file());
        let patch = if done {
            CasePatch { stage: Some("sent".into()), sent_at: Some(now.clone()), ..Default::default() }
        } else {
            CasePatch { stage: Some("made".into()), outbox_file: Some(String::new()), ..Default::default() }
        };
        changed.push(with_store(&state, |s| s.update_case(&c.no, &patch))?);
    }
    Ok(changed)
}

/// Claude가 대화에 올린 파일을 옮겨 두는 보낼편지함 안 폴더
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
    fn inbox_file_one_or_many() {
        assert_eq!(parse_inbox_file("\u{feff}{\"no\":\"1AA-1\",\"photos\":[\"a.jpg\"]}").unwrap()[0].photos, vec!["a.jpg"]);
        assert_eq!(parse_inbox_file("[{\"no\":\"1\"},{\"no\":\"2\"}]").unwrap().len(), 2);
        assert!(parse_inbox_file("{}").is_none());
        assert!(parse_inbox_file("깨진 파일").is_none());
    }

    #[test]
    fn script_quotes_paths() {
        let s = jpg_script(Path::new("D:/민원/지시부_1_O'Neil.pptx"), Path::new("D:/민원/지시부_1_O'Neil.jpg"));
        assert!(s.contains("'D:/민원/지시부_1_O''Neil.pptx'"));
        assert!(s.contains("PowerPoint.Application"));
        assert!(jpg_script(Path::new("a.hwpx"), Path::new("a.jpg")).contains("HWPFrame.HwpObject"));
    }
}
