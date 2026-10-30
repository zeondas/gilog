//! 현장 사진 고르기 – Claude가 민원마다 사진을 보고 한 장을 골라요(`pick_photos`).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickItem {
    pub no: String,
    /// 민원 요약 한 줄(무엇이 고장인지 – 민원인 이름·연락처는 없어요)
    #[serde(default)]
    pub summary: String,
    /// 받은 현장사진 경로들(2장 이상)
    pub photos: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickRequest {
    pub exe: String,
    #[serde(default)]
    pub model: String,
    /// 기록을 남길 폴더(가져올 폴더) – `_사진고름.log`
    pub inbox: String,
    pub items: Vec<PickItem>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickResult {
    pub no: String,
    /// 고른 사진 경로(받은 목록 안의 것)
    pub pick: String,
    pub reason: String,
}

/// 사진 고르기 지침: 사진 경로만 주고 Read로 열어 보게 해요. 답은 JSON 배열 하나.
pub(super) fn pick_prompt(items: &[PickItem]) -> String {
    let mut s = String::from(
        "# 기록 현장사진 고르기\n\n도로 보수 지시부에 넣을 현장사진을 민원마다 1장 골라요.\n\
         - 아래 사진 파일을 Read로 열어 보고, **보수가 필요한 곳(파임·균열·파손·시설물 상태)이 가장 잘 드러나는 사진** 1장을 골라요.\n\
         - 멀리서 찍어 대상이 작은 사진·흔들린 사진·화면 캡처·지도는 피해요.\n\
         - 다른 도구는 쓰지 않아요. 파일을 쓰거나 고치지 않아요.\n\
         - 마지막 답은 JSON 배열 하나만: [{\"no\":\"접수번호\",\"pick\":사진 번호(1부터),\"reason\":\"고른 이유 한 줄(20자 안팎)\"}]\n\n",
    );
    for it in items {
        s.push_str(&format!("## {}\n민원: {}\n", it.no, it.summary.trim()));
        for (i, p) in it.photos.iter().enumerate() {
            s.push_str(&format!("{}. {}\n", i + 1, p));
        }
        s.push('\n');
    }
    s
}

/// Claude 마지막 답에서 고른 것을 읽어요. 번호가 범위를 벗어나거나 모르는 접수번호는 빼요.
pub(super) fn parse_picks(result: &str, items: &[PickItem]) -> Vec<PickResult> {
    let (Some(a), Some(b)) = (result.find('['), result.rfind(']')) else { return vec![] };
    let Ok(v) = serde_json::from_str::<Vec<serde_json::Value>>(&result[a..=b]) else { return vec![] };
    v.iter()
        .filter_map(|x| {
            let no = x["no"].as_str()?.trim();
            let it = items.iter().find(|i| i.no == no)?;
            let n = x["pick"].as_u64().or_else(|| x["pick"].as_str().and_then(|s| s.trim().parse().ok()))? as usize;
            let pick = it.photos.get(n.checked_sub(1)?)?.clone();
            Some(PickResult { no: no.into(), pick, reason: x["reason"].as_str().unwrap_or("").trim().chars().take(60).collect() })
        })
        .collect()
}

/// 현장사진이 여러 장인 민원마다 Claude가 사진을 열어 보고 1장을 골라요(2026-10-21 22:59 사용자 ①1안).
/// 브라우저는 쓰지 않고 Read만 허락해요. 3분 넘으면 멈추고 고른 것 없이 돌아가요(사진 순서는 그대로).
#[tauri::command]
pub async fn pick_photos(state: State<'_, AppState>, req: PickRequest) -> Result<Vec<PickResult>, String> {
    let exe = checked_exe(&req.exe, &saved_process(&state)?)?;
    for i in &req.items {
        for p in &i.photos {
            crate::guard::plain(p)?;
        }
    }
    tauri::async_runtime::spawn_blocking(move || pick_photos_blocking(req, exe)).await.map_err(|e| e.to_string())?
}

pub(super) fn pick_photos_blocking(req: PickRequest, exe: PathBuf) -> Result<Vec<PickResult>, String> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    let items: Vec<PickItem> = req.items.into_iter().filter(|i| i.photos.len() > 1).collect();
    if items.is_empty() {
        return Ok(vec![]);
    }
    let mut dirs: Vec<String> = items.iter().flat_map(|i| i.photos.iter()).filter_map(|p| Path::new(p).parent().map(|d| d.display().to_string())).collect();
    dirs.sort();
    dirs.dedup();
    let cwd = dirs.first().cloned().unwrap_or_else(|| req.inbox.clone());
    let mut args: Vec<String> = ["-p", "아래 지침대로 현장사진을 골라요.", "--output-format", "json", "--permission-mode", "acceptEdits", "--permission-prompts", "none", "--allowedTools", "Read"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    for d in &dirs {
        args.push("--add-dir".into());
        args.push(d.clone());
    }
    if !req.model.trim().is_empty() {
        args.push("--model".into());
        args.push(req.model.trim().into());
    }
    let t0 = std::time::Instant::now();
    let mut cmd = Command::new(&exe);
    cmd.current_dir(&cwd).args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "noclaude".to_string() } else { e.to_string() })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(pick_prompt(&items).as_bytes()).map_err(io)?;
    }
    let mut out = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(o) = out.as_mut() {
            let _ = o.read_to_string(&mut s);
        }
        s
    });
    let limit = std::time::Duration::from_secs(180);
    let mut timed_out = false;
    loop {
        if child.try_wait().map_err(io)?.is_some() {
            break;
        }
        if t0.elapsed() > limit {
            timed_out = true;
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000).status();
            }
            let _ = child.kill();
            let _ = child.wait();
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
    let raw = reader.join().unwrap_or_default();
    let result = serde_json::from_str::<serde_json::Value>(raw.trim()).ok().and_then(|v| v["result"].as_str().map(|s| s.to_string())).unwrap_or_default();
    let picks = parse_picks(&result, &items);
    // 걸린 시간·고른 수만 남겨요(사진 내용·민원 글은 안 남김)
    let _ = fs::write(
        PathBuf::from(req.inbox.trim()).join("_사진고름.log"),
        format!("민원 {}건 · 사진 {}장 · {:.1}초 · 고름 {}건{}\n", items.len(), items.iter().map(|i| i.photos.len()).sum::<usize>(), t0.elapsed().as_secs_f64(), picks.len(), if timed_out { " · 3분 넘어 멈춤" } else { "" }),
    );
    Ok(picks)
}
