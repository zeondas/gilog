//! Claude Code 실행 – 신문고 민원 불러오기(`run_claude`)·멈추기·진행 상태, 로그 줄, 실행 파일·작업 폴더 검사.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{with_store, AppState};

use super::*;

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
pub(super) struct RunInner {
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
    /// Claude가 열어 보고 "기록에 이미 있음"으로 건너뛴 접수번호(`_건너뜀.json`) – 화면이 "본 번호"에 더해 다음부터 열지 않아요
    #[serde(default)]
    pub skipped: Vec<String>,
    /// 목록에서 "이미 있는 접수번호"라 뺀 수(`_진행.json`의 skipped) – 아래 줄 "건너뜀 N건"(2026-10-20 진행 막대)
    pub skip_count: Option<u32>,
}

/// 진행 파일 이름(read_inbox는 `_`로 시작하는 파일을 읽지 않아요)
pub const PROGRESS_FILE: &str = "_진행.json";
/// 실행 기록 – 명령줄·Claude가 보낸 stream-json 요약·stderr·종료 코드(돌릴 때마다 덮어씀).
/// 신문고 본문·민원인 정보가 섞이지 않게 도구 결과·Claude 글은 넣지 않고 종류·도구 이름·주소·파일 경로만 남겨요.
pub const LOG_FILE: &str = "_claude.log";
/// Claude가 열어 보고 건너뛴 접수번호 목록 {"nos":[…]}(돌릴 때마다 지우고 새로)
pub const SKIPPED_FILE: &str = "_건너뜀.json";

/// stream-json 한 줄이 민원 파일(`<접수번호>.json`, `_`로 시작하지 않는 것)을 쓰는 Write인지
pub(super) fn writes_case(v: &serde_json::Value) -> bool {
    if v["type"] != "assistant" {
        return false;
    }
    v["message"]["content"].as_array().is_some_and(|a| {
        a.iter().any(|b| {
            b["type"] == "tool_use"
                && b["name"] == "Write"
                && b["input"]["file_path"].as_str().is_some_and(|p| {
                    let f = p.rsplit(['\\', '/']).next().unwrap_or(p);
                    f.to_ascii_lowercase().ends_with(".json") && !f.starts_with('_')
                })
        })
    })
}

/// 로그 끝 "걸린 시간" 줄: 전체 · 첫 건까지 · 건당 평균(둘째 건부터)
pub(super) fn timing_line(case_at: &[f64], total: f64) -> String {
    match case_at {
        [] => format!("## 걸린 시간 {total:.0}초 · 민원 0건"),
        [one] => format!("## 걸린 시간 {total:.0}초 · 민원 1건 · 첫 건까지 {one:.0}초"),
        [first, .., last] => {
            let n = case_at.len();
            format!("## 걸린 시간 {total:.0}초 · 민원 {n}건 · 첫 건까지 {first:.0}초 · 건당 평균 {:.1}초", (last - first) / (n - 1) as f64)
        }
    }
}

/// stream-json 한 줄을 로그에 남길 모양으로 줄여요(개인정보가 들어갈 수 있는 글·도구 결과는 길이만).
/// `seen`: 브라우저 고르기 도구(list_connected_browsers·select_browser·switch_browser)의 tool_use id –
/// 그 결과(브라우저 이름 목록)만 글을 남겨요. 어느 브라우저에 붙었는지 보려고(2026-10-20 엣지로 붙음 신고).
pub(super) fn log_line(v: &serde_json::Value, raw: &str, seen: &mut std::collections::HashSet<String>) -> String {
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
                            let name = b["name"].as_str().unwrap_or("?");
                            if name.contains("browser") && !name.contains("batch") {
                                if let Some(id) = b["id"].as_str() { seen.insert(id.to_string()); }
                                parts.push(format!("tool_use {name} {}", inp.to_string().chars().take(300).collect::<String>()));
                                continue;
                            }
                            // 무엇을 눌렀는지(2026-10-20 사용자: 불필요한 단추를 누름) – find 글·누른 자리·동작만, 친 글은 길이만
                            if name.ends_with("__find") || name.ends_with("__computer") || name.ends_with("__browser_batch") || name.ends_with("__javascript_tool") {
                                parts.push(format!("tool_use {} {}", name.rsplit("__").next().unwrap_or(name), click_hint(inp)));
                                continue;
                            }
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
                        let shown = if b["tool_use_id"].as_str().map_or(false, |id| seen.contains(id)) {
                            let t = match &b["content"] {
                                serde_json::Value::String(s) => s.clone(),
                                serde_json::Value::Array(a) => a.iter().filter_map(|c| c["text"].as_str()).collect::<Vec<_>>().join(" "),
                                _ => String::new(),
                            };
                            format!(" {}", t.replace('\n', " ").chars().take(500).collect::<String>())
                        } else { String::new() };
                        parts.push(format!("tool_result {}자{}{}", n, if b["is_error"] == true { " 오류" } else { "" }, shown));
                    }
                }
            }
            format!("user: {}", parts.join(" · "))
        }
        _ => format!("{t} {}", v["subtype"].as_str().unwrap_or("")),
    }
}

/// 누르기 도구 입력 요약: find는 찾는 글, computer는 동작·자리(ref/좌표), 친 글(text)은 길이만, browser_batch는 차례대로
pub(super) fn click_hint(inp: &serde_json::Value) -> String {
    let one = |a: &serde_json::Value| -> String {
        let mut v = Vec::new();
        for k in ["query", "action", "ref", "coordinate", "scroll_direction"] {
            if !a[k].is_null() { v.push(format!("{k}={}", a[k].to_string().trim_matches('"').chars().take(80).collect::<String>())); }
        }
        // 화면 안 명령(javascript_tool)은 명령 앞부분을 남겨요 – 무엇을 눌렀는지 보이게(2026-10-21 사용자: 정말 그 단추였는지). 명령 글엔 민원 글이 없어요.
        if a["action"] == "javascript_exec" {
            if let Some(t) = a["text"].as_str() { v.push(format!("js={}", t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect::<String>())); }
        } else if let Some(t) = a["text"].as_str() { v.push(format!("text={}자", t.chars().count())); }
        // 누르기에 Claude가 붙인 한 줄 설명(무엇을 누르는지)
        if let Some(t) = a["action_summary"].as_str() { v.push(format!("({})", t.chars().take(60).collect::<String>())); }
        v.join(" ")
    };
    if let Some(list) = inp["actions"].as_array() {
        list.iter().map(|a| format!("[{} {}]", a["tool"].as_str().or(a["name"].as_str()).unwrap_or("?"), one(a.get("input").or(a.get("args")).unwrap_or(a)))).collect::<Vec<_>>().join(" ")
    } else { one(inp) }
}

/// 멈춘 이유를 사람이 읽을 말로(원인 목록 ①~⑥). 모르면 첫 줄을 그대로 보여요.
pub(super) fn explain(stderr: &str, result: &str, code: Option<i32>) -> String {
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
    /// 모델(sonnet·opus·haiku, 비우면 Claude Code 기본값) – 2026-10-20 속도: 처음 값 sonnet
    #[serde(default)]
    pub model: String,
}

/// 마지막 답에서 상태를 읽어요. 지침대로 LOGIN_REQUIRED가 아니어도 "로그인" 얘기로 끝나면 로그인 풀림으로 봐요(원인 ⑤).
pub(super) fn final_state(result: &str, is_error: bool) -> (String, String) {
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
    // 보내기는 눌렀는데 보낸메일함에서 같은 제목을 못 찾음 → 보냄 + "확인 필요"(2026-10-20 진행 막대)
    if result.contains("MAIL_UNCONFIRMED") {
        return ("done".into(), "unconfirmed".into());
    }
    if result.contains("MAIL_SENT") {
        return ("done".into(), String::new());
    }
    if result.contains("NO_CHROME") {
        return ("error".into(), "Claude가 크롬에 붙지 못했어요 – 크롬을 켜고 Claude 확장에 로그인해 주세요(엣지에만 확장이 이어져 있으면 엣지는 쓰지 않아요)".into());
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

/// 설정 "민원처리"의 처음 값(`settingsStore.ts`의 `DEFAULT_PROCESS`와 같아요) – 저장된 값이 없을 때 써요
pub(super) const DEFAULT_INBOX: &str = "D:\\민원처리\\가져오기";
pub(super) const DEFAULT_DOWNLOADS: &str = "D:\\";
pub(super) const DEFAULT_OUTBOX: &str = "D:\\민원처리\\보내기";

/// 암호화 파일에 저장된 설정의 민원처리 칸 – 화면이 보낸 경로를 믿지 않고 앱이 직접 읽어 실행 파일·폴더를 견줘요(✔2)
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct SavedProcess {
    pub claude: String,
    pub inbox: String,
    pub downloads: String,
    pub outbox: String,
}

pub(crate) fn parse_saved_process(settings: Option<&str>) -> SavedProcess {
    let v: serde_json::Value = settings.and_then(|t| serde_json::from_str(t).ok()).unwrap_or(serde_json::Value::Null);
    let p = &v["process"];
    let get = |k: &str, d: &str| p[k].as_str().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).unwrap_or_else(|| d.to_string());
    SavedProcess { claude: get("claude", "claude"), inbox: get("inbox", DEFAULT_INBOX), downloads: get("downloads", DEFAULT_DOWNLOADS), outbox: get("outbox", DEFAULT_OUTBOX) }
}

pub(super) fn saved_process(state: &State<AppState>) -> Result<SavedProcess, String> {
    let raw = with_store(state, |s| s.get("settings"))?;
    Ok(parse_saved_process(raw.as_deref()))
}

/// 경로 비교: 앞뒤 빈칸·`/`·끝 `\`·대소문자를 무시 – 경로 검사와 같은 `guard::norm` 하나로 비교해요(②-2 ✔3)
pub(super) fn same_path(a: &str, b: &str) -> bool {
    crate::guard::norm(a) == crate::guard::norm(b)
}

/// 설정 저장(`set_value("settings")`)이 Claude 실행 파일 자리를 바꾸지 않는지(②-2 ✔2).
/// 바꾸는 것은 전용 명령 `set_process_exe`로만 해요 – 새 값이 읽히지 않는 글이면 막아요.
pub(crate) fn settings_keep_exe(old: Option<&str>, new: &str) -> bool {
    if serde_json::from_str::<serde_json::Value>(new).is_err() {
        return false;
    }
    same_path(&parse_saved_process(old).claude, &parse_saved_process(Some(new)).claude)
}

/// 저장된 설정 글에서 Claude 실행 파일 자리만 바꾼 글(다른 값은 그대로)
pub(crate) fn with_process_exe(old: Option<&str>, exe: &str) -> Result<String, String> {
    let mut v: serde_json::Value = old.and_then(|t| serde_json::from_str(t).ok()).unwrap_or_else(|| serde_json::json!({}));
    if !v.is_object() {
        v = serde_json::json!({});
    }
    if !v["process"].is_object() {
        v["process"] = serde_json::json!({});
    }
    v["process"]["claude"] = serde_json::Value::String(exe.to_string());
    serde_json::to_string(&v).map_err(|e| e.to_string())
}

/// 설정 → 민원처리의 Claude 실행 파일 자리를 바꿔요(위험 명령 묶음, ②-2 ✔2). 실행할 때 이름 검사(`checked_exe`)는 그대로예요.
#[tauri::command]
pub fn set_process_exe(state: State<AppState>, exe: String) -> Result<(), String> {
    with_store(&state, |s| {
        let old = s.get("settings")?;
        let next = with_process_exe(old.as_deref(), &exe).map_err(gilog_core::Error::Meta)?;
        s.set("settings", &next)
    })
}

/// 실행할 Claude: 화면이 보낸 값이 저장된 설정 값과 같고, 파일 이름이 claude(.exe)일 때만(✔2)
pub(crate) fn checked_exe(req_exe: &str, saved: &SavedProcess) -> Result<PathBuf, String> {
    let or_default = |x: &str| if x.trim().is_empty() { "claude".to_string() } else { x.trim().to_string() };
    let (req, set) = (or_default(req_exe), or_default(&saved.claude));
    if !same_path(&req, &set) {
        return Err(crate::guard::DENIED.into());
    }
    // 처음 값 "claude"(설치기가 넣는 자리·PATH)는 경로가 아니라 이름이에요
    if set != "claude" {
        crate::guard::plain(&set)?;
    }
    let exe = claude_exe(&set);
    let full = exe.to_string_lossy().to_lowercase();
    let name = full.rsplit(['\\', '/']).next().unwrap_or("");
    if name != "claude.exe" && name != "claude" {
        return Err(crate::guard::DENIED.into());
    }
    Ok(exe)
}

/// [민원 불러오기]는 가져올 폴더, 지시부 메일은 보낼 폴더\메일에서만 돌고, 받는 폴더는 설정의 다운로드 폴더만(✔2)
pub(crate) fn checked_dirs(inbox: &str, downloads: &str, saved: &SavedProcess) -> Result<(), String> {
    crate::guard::plain(inbox)?;
    crate::guard::plain(downloads)?;
    let mail = format!("{}\\메일", saved.outbox.trim_end_matches(['\\', '/']));
    if !(same_path(inbox, &saved.inbox) || same_path(inbox, &mail)) || !same_path(downloads, &saved.downloads) {
        return Err(crate::guard::DENIED.into());
    }
    Ok(())
}

/// Claude 실행 파일: 설정에 경로가 있으면 그것, "claude"(처음 값)면 설치기가 넣는 자리
/// `%USERPROFILE%\.local\bin\claude.exe`를 먼저 봐요(설치 직후 PATH가 아직 안 잡혀도 돼요).
pub(super) fn claude_exe(set: &str) -> PathBuf {
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
pub fn run_claude(state: State<AppState>, run: State<ClaudeRun>, req: RunRequest) -> Result<(), String> {
    use std::io::{BufRead, Write};
    use std::process::{Command, Stdio};
    let saved = saved_process(&state)?;
    let exe = checked_exe(&req.exe, &saved)?;
    checked_dirs(&req.inbox, &req.downloads, &saved)?;
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
    let mut args: Vec<String> = [
        "-p", "아래 지침대로 국민신문고 민원을 가져와요.", "--chrome", "--output-format", "stream-json", "--verbose",
        "--permission-mode", "acceptEdits", "--permission-prompts", "none",
        // 쓰기는 Write만(지침이 Write로만 쓰게 해요) – Edit는 뺐어요(✔2). 쓸 수 있는 곳은 작업 폴더(가져올 폴더)와 받는 폴더뿐이에요.
        "--allowedTools", "mcp__claude-in-chrome,Read,Write,Glob",
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
    // 줄마다 시작부터 지난 시간 `[+12.3s]` – 어느 걸음이 느린지 재요(2026-10-20)
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
        let mut browser_ids = std::collections::HashSet::new();
        // 민원 파일(<접수번호>.json)을 쓴 때 – 끝에 "건당 평균"을 남겨요(2026-10-21 신속 자동화)
        let mut case_at: Vec<f64> = Vec::new();
        if let Some(out) = stdout {
            for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                    w(&log, &format!("stdout: {}", line.chars().take(500).collect::<String>()));
                    continue;
                };
                w(&log, &log_line(&v, &line, &mut browser_ids));
                if writes_case(&v) {
                    let now = t0.elapsed().as_secs_f64();
                    let gap = case_at.last().map_or(now, |p| now - p);
                    case_at.push(now);
                    w(&log, &format!("## 민원 {}건째 씀 (이번 건 {gap:.1}초)", case_at.len()));
                }
                if v["type"] == "result" {
                    result_text = v["result"].as_str().unwrap_or("").to_string();
                    last = Some(final_state(&result_text, v["is_error"].as_bool().unwrap_or(false)));
                }
            }
        }
        let Ok(mut g) = inner.lock() else { return };
        let code = g.child.as_mut().and_then(|c| c.wait().ok()).and_then(|s| s.code());
        w(&log, "");
        w(&log, &timing_line(&case_at, t0.elapsed().as_secs_f64()));
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
            s.skip_count = v["skipped"].as_u64().map(|n| n as u32);
        }
    }
    Ok(s)
}
