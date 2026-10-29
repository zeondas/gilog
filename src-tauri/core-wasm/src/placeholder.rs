//! 자리 표시자: 윈도우·파일·인터넷·실행이 필요한 앱 명령이 브라우저 미리 보기에서 할 일.
//!
//! 규칙은 새로 짜지 않아요. 저장이 걸린 것(민원 불러오기·지시부 만들기·JPG·보내기)은 앱 명령과 같은 순서로 core를 부르고
//! 파일 일만 빼요(파일 이름은 지어 두기만). 나머지는 지나가거나(null) 미리 보기 값을 돌려줘요.
//! 화면이 미리 보기에서 아예 부르지 않는 명령(탐색기 `fs_*`·구글·주소 웹·두 번째 기록)은 "io"예요 –
//! 탐색기 미리 보기는 `src/filesApi.ts`의 가짜 폴더가 맡아요.

use gilog_core::{CaseInput, Order, OrderPatch};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{hello, json as to_json, out, Args, Session};

/// 앱에는 있지만 브라우저에서는 자리 표시자인 명령(이름은 앱 `generate_handler!`와 같게).
pub const PLACEHOLDER: &[&str] = &[
    // 앱 설정(prefs.json)·창·입력기
    "profile_name",
    "open_twin",
    "get_prefs",
    "set_prefs",
    "quit_app",
    "auto_unlock",
    "set_ime",
    "window_ready",
    // 윈도우 PIN(Hello)
    "pin_status",
    "pin_enable",
    "pin_disable",
    "pin_unlock",
    "pin_rekey",
    // 백업·저장 위치(파일)
    "export_backup",
    "import_backup",
    "move_data",
    "backup_info",
    "open_backup_folder",
    "restore_and_open",
    // 주소 – 웹·표 바꾸기(파일)
    "juso_http",
    "road_table_info",
    "road_table_import",
    "road_table_reset",
    // 캘린더 – 공휴일 받기·윈도우 알림
    "refresh_holidays",
    "set_reminders",
    "test_notification",
    "notify_status",
    "set_notify_mode",
    // 구글
    "google_listen",
    "google_wait",
    "open_google_login",
    "google_http",
    // 민원처리 – 파일·실행
    "read_inbox",
    "make_order",
    "order_jpg",
    "send_order",
    "set_process_exe",
    "check_sent",
    "open_path",
    "open_portal",
    "run_claude",
    "pick_photos",
    "stop_claude",
    "claude_status",
    "show_in_folder",
    // 탐색기(브라우저는 src/filesApi.ts의 가짜 폴더)
    "fs_list",
    "fs_subdirs",
    "fs_drives",
    "fs_home",
    "fs_is_dir",
    "fs_mkdir",
    "fs_rename",
    "fs_rename_many",
    "fs_conflicts",
    "fs_transfer",
    "fs_cancel",
    "fs_undo",
    "fs_clip_set",
    "fs_clip_get",
    "fs_fast_status",
    "fs_fast_setup",
    "fs_start_drag",
    "fs_properties",
    "fs_lnk_target",
    "fs_mods",
    "fs_make_links",
    "fs_resolve",
    "fs_zip_extract",
    "fs_delete",
    "fs_open",
    "fs_explorer",
    "fs_icons",
    "fs_context_menu",
    "fs_reveal",
    "fs_types",
    "fs_quick",
    "fs_find",
    "fs_watch",
];

/// 미리 보기에만 있는 명령(앱에는 없어요) – 이름은 늘 `preview_`로 시작해요.
pub const PREVIEW_ONLY: &[&str] = &["preview_inbox"];

/// 앱 설정 처음 값(앱 `Prefs::default`와 같게 – 화면 `DEFAULT_PREFS`)
fn default_prefs() -> Value {
    json!({
        "dataDir": "", "theme": "system", "accent": "purple", "startScreen": "journal", "fontSize": 13, "urgentDays": 2,
        "askPassword": true, "autoLock": true, "autoLockMin": 10, "sideCollapsed": false, "pinUnlock": false,
        "closeAction": "tray", "autoStart": false
    })
}

fn table_info(custom: bool) -> Value {
    if custom {
        json!({ "count": 55200, "date": "2026-10-18", "custom": true })
    } else {
        json!({ "count": 55118, "date": "2026-10-18", "custom": false })
    }
}

/// Claude 실행 흉내(민원 불러오기·지시부 메일) 상태
#[derive(Default)]
pub(crate) struct Run {
    state: String,
    total: Option<i64>,
    done: Option<i64>,
    log: String,
    skip_count: Option<i64>,
    mail_steps: i64,
}

impl Run {
    fn status(&self) -> Value {
        let state = if self.state.is_empty() { "idle" } else { &self.state };
        let mut v = json!({ "state": state, "total": self.total, "done": self.done, "message": "", "log": self.log, "skipped": [] });
        if let Some(n) = self.skip_count {
            v["skipCount"] = json!(n);
        }
        v
    }
}

/// 자리 표시자들이 기억하는 것
pub(crate) struct State {
    prefs: Value,
    pin_on: bool,
    custom_table: bool,
    /// Claude가 차례로 가져올 폴더에 놓을 보기 민원(`preview_inbox`)
    queue: Vec<Value>,
    /// 가져올 폴더에 놓인 민원 – 다음 `read_inbox`가 읽어요
    inbox: Vec<Value>,
    run: Run,
}

impl Default for State {
    fn default() -> Self {
        State { prefs: default_prefs(), pin_on: false, custom_table: false, queue: vec![], inbox: vec![], run: Run::default() }
    }
}

/// 앱 `process::safe_name`과 같은 파일 이름 다듬기(파일 이름만 지어요)
fn safe_name(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '_') && !c.is_control())
        .collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    let t: String = t.chars().take(40).collect();
    t.trim().trim_end_matches('.').to_string()
}

fn yymmdd(date: &str) -> String {
    let d: String = date.chars().filter(|c| c.is_ascii_digit()).collect();
    if d.len() == 8 {
        d[2..].to_string()
    } else {
        d
    }
}

/// 앱 `process::case_stem`: 접수일(YYMMDD)_위치_보수내용
fn case_stem(received: &str, place: &str, short: &str) -> String {
    [yymmdd(received), safe_name(place), safe_name(short)].into_iter().filter(|x| !x.is_empty()).collect::<Vec<_>>().join("_")
}

/// 앱 `process::order_stem`: 지시일(YYMMDD)_축약 공사명-연번(두 자리)
fn order_stem(date: &str, work: &str, seq: i64) -> String {
    format!("{}_{}-{seq:02}", yymmdd(date), safe_name(work))
}

fn join(dir: &str, name: &str) -> String {
    let dir = dir.trim().trim_end_matches(['\\', '/']);
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}\\{name}")
    }
}

fn file_name(p: &str) -> &str {
    p.rsplit(['\\', '/']).next().unwrap_or(p)
}

fn page_names(stem: &str, n: usize) -> Vec<String> {
    if n == 1 {
        vec![format!("{stem}.jpg")]
    } else {
        (1..=n).map(|k| format!("{stem}_{k}.jpg")).collect()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrderRequest {
    #[serde(default)]
    nos: Vec<String>,
    #[serde(default)]
    order: Option<i64>,
    root: String,
    date: String,
}

fn code(e: gilog_core::Error) -> String {
    e.code().to_string()
}

/// 자리 표시자. 모르는 이름이면 None.
pub(crate) fn placeholder(s: &mut Session, cmd: &str, a: &Args) -> Option<Result<Value, String>> {
    Some(match cmd {
        // ---------- 앱 설정·창 ----------
        "get_prefs" => Ok(s.ph.prefs.clone()),
        "set_prefs" => (|| {
            let mut p: Value = a.get("prefs")?;
            if !p.is_object() {
                return Err("invalid".to_string());
            }
            // 앱처럼 자료 폴더·PIN 풀기는 이 명령으로 못 바꿔요.
            p["dataDir"] = s.ph.prefs["dataDir"].clone();
            p["pinUnlock"] = json!(s.ph.pin_on);
            s.ph.prefs = p;
            Ok(Value::Null)
        })(),
        "auto_unlock" => {
            let ask = s.ph.prefs["askPassword"].as_bool().unwrap_or(true);
            if !ask && s.store.is_some() {
                s.unlocked = true;
                Ok(json!(true))
            } else {
                Ok(json!(false))
            }
        }
        "quit_app" | "set_ime" | "window_ready" => Ok(Value::Null),
        "profile_name" => Ok(Value::Null),

        // ---------- 윈도우 PIN → 확인 창 ----------
        "pin_status" => Ok(json!({ "available": true, "on": s.ph.pin_on })),
        "pin_enable" => (|| {
            let password = a.s("password")?;
            s.store()?.check_password(&password).map_err(code)?;
            if !hello() {
                return Err("hello_canceled".to_string());
            }
            s.ph.pin_on = true;
            Ok(Value::Null)
        })(),
        "pin_disable" => {
            s.ph.pin_on = false;
            Ok(Value::Null)
        }
        "pin_unlock" => (|| {
            if !s.ph.pin_on || s.store.is_none() {
                return Err("pin_stale".to_string());
            }
            if !hello() {
                return Err("hello_canceled".to_string());
            }
            s.unlocked = true;
            Ok(Value::Null)
        })(),
        "pin_rekey" => (|| {
            if !s.ph.pin_on {
                return Ok(Value::Null);
            }
            if !hello() {
                s.ph.pin_on = false;
                return Err("pin_off".to_string());
            }
            Ok(Value::Null)
        })(),

        // ---------- 백업·저장 위치 (파일 없음) ----------
        "backup_info" => Ok(json!({ "folder": "문서\\giLog\\backup (미리 보기)", "count": 7, "latest": "2026-10-20", "latestPath": "gilog_2026-10-20.gilogbak" })),
        "open_backup_folder" | "export_backup" => Ok(Value::Null),
        // 백업 파일이 없으니 지금 자료 그대로 – 비밀번호 확인·잠금·맡긴 열쇠/PIN 끄기만 앱과 같게
        "import_backup" | "restore_and_open" => (|| {
            let password = a.s("password")?;
            let store = s.store.as_ref().ok_or_else(|| "not_found".to_string())?;
            store.check_password(&password).map_err(code)?;
            s.unlocked = cmd == "restore_and_open";
            s.ph.prefs["askPassword"] = json!(true);
            s.ph.pin_on = false;
            Ok(Value::Null)
        })(),
        "move_data" => {
            s.unlocked = false;
            Ok(Value::Null)
        }

        // ---------- 주소 표 ----------
        "road_table_info" => Ok(table_info(s.ph.custom_table)),
        "road_table_import" => {
            s.ph.custom_table = true;
            Ok(table_info(true))
        }
        "road_table_reset" => {
            s.ph.custom_table = false;
            Ok(table_info(false))
        }

        // ---------- 캘린더: 인터넷·윈도우 알림 ----------
        "refresh_holidays" => Err("offline".into()),
        "set_reminders" | "set_notify_mode" => Ok(Value::Null),
        "notify_status" | "test_notification" => Ok(json!({ "pending": 0, "nextAt": 0, "shown": 0, "lastError": "", "via": "미리 보기" })),

        // ---------- 민원처리: 파일·실행 ----------
        "preview_inbox" => (|| {
            // ready: true면 가져올 폴더에 바로 놓아요(시험 자료 – 다음 read_inbox가 읽어요), 아니면 Claude 실행 흉내가 하나씩 놓아요.
            let (list, ready): (Vec<Value>, Option<bool>) = (a.get("list")?, a.get("ready")?);
            if ready.unwrap_or(false) {
                s.ph.inbox.extend(list);
            } else {
                s.ph.queue = list;
            }
            Ok(Value::Null)
        })(),
        // 앱 read_inbox와 같은 순서 – 사진은 민원 폴더에 `접수일_위치_보수내용_사진N`으로 옮겼다고 치고 이름만 지어요.
        "read_inbox" => (|| {
            let root = a.s("root")?;
            s.store()?;
            let files = std::mem::take(&mut s.ph.inbox);
            let mut skipped = 0;
            let mut ready = Vec::new();
            for f in files {
                let Ok(mut c) = serde_json::from_value::<CaseInput>(fill_case(f)) else { continue };
                if c.no.trim().is_empty() || s.store()?.has_case(&c.no).map_err(code)? {
                    skipped += 1;
                    continue;
                }
                let stem = case_stem(&c.received, &c.place, &c.short);
                c.photos = (1..=c.photos.len()).map(|i| join(&root, &format!("{stem}_사진{i}.jpg"))).collect();
                c.map = if c.map.trim().is_empty() { String::new() } else { join(&root, &format!("{stem}_위치도.png")) };
                c.folder = root.trim().to_string();
                ready.push(c);
            }
            let added = s.store()?.add_cases(&ready).map_err(code)?;
            to_json(json!({ "added": added, "skipped": skipped, "failed": [], "missingFiles": [], "held": 0 }))
        })(),
        // 앱 make_order와 같은 순서 – 양식 채우기(파일)만 빼요.
        "make_order" => (|| {
            let req: OrderRequest = a.get("req")?;
            let st = s.store()?;
            let (old, work, cases) = match req.order {
                Some(id) => {
                    let o = st.order(id).map_err(code)?;
                    let cases = st.order_cases(id).map_err(code)?;
                    let w = st.work(o.work).map_err(code)?;
                    (Some(o), w, cases)
                }
                None => {
                    let (w, list) = st.plan_order(&req.nos).map_err(code)?;
                    (None, w, list)
                }
            };
            if cases.is_empty() {
                return Err("고른 민원이 없어요".into());
            }
            let seq = old.as_ref().map(|o| o.seq).unwrap_or(work.next_seq);
            let date = old.as_ref().map(|o| o.date.clone()).filter(|d| !d.is_empty()).unwrap_or_else(|| req.date.trim().to_string());
            let file = match &old {
                Some(o) if !o.file.is_empty() => o.file.clone(),
                _ => join(&req.root, &format!("{}.hwpx", order_stem(&date, &work.name, seq))),
            };
            let no_photo: Vec<String> = cases.iter().filter(|c| c.photos.is_empty()).map(|c| c.no.clone()).collect();
            let order: Order = match &old {
                Some(o) => st
                    .update_order(
                        o.id,
                        &OrderPatch { file: Some(file), jpgs: Some(vec![]), stage: Some("made".into()), outbox: Some(vec![]), sent_at: Some(String::new()), dirty: Some(false), ..Default::default() },
                    )
                    .map_err(code)?,
                None => {
                    let nos: Vec<String> = cases.iter().map(|c| c.no.clone()).collect();
                    st.create_order(work.id, seq, &date, &file, &nos).map_err(code)?
                }
            };
            let cases = st.order_cases(order.id).map_err(code)?;
            let works = st.process_data().map_err(code)?.works;
            to_json(json!({ "order": order, "cases": cases, "works": works, "missing": [], "noPhoto": no_photo }))
        })(),
        // 한글이 쪽마다 JPG를 쓴다고 치고(건이 둘 이상이면 두 쪽) 이름만 적어요.
        "order_jpg" => (|| {
            let id = a.id("id")?;
            let st = s.store()?;
            let o = st.order(id).map_err(code)?;
            if o.file.is_empty() {
                return Err("nofile".into());
            }
            let n = if st.order_cases(id).map_err(code)?.len() > 1 { 2 } else { 1 };
            let (dir, name) = o.file.rsplit_once(['\\', '/']).unwrap_or(("", o.file.as_str()));
            let stem = name.rsplit_once('.').map(|x| x.0).unwrap_or(name);
            let jpgs: Vec<String> = page_names(stem, n).iter().map(|p| join(dir, p)).collect();
            out(st.update_order(id, &OrderPatch { jpgs: Some(jpgs), ..Default::default() }))
        })(),
        "send_order" => (|| {
            let (id, outbox) = (a.id("id")?, a.s("outbox")?);
            let st = s.store()?;
            let o = st.order(id).map_err(code)?;
            if o.jpgs.is_empty() {
                return Err("nojpg".into());
            }
            let sent: Vec<String> = o.jpgs.iter().map(|j| join(&outbox, file_name(j))).collect();
            out(st.update_order(id, &OrderPatch { stage: Some("queued".into()), outbox: Some(sent), ..Default::default() }))
        })(),
        // 미리 보기에는 Claude가 없어요 – 보내는 중으로 남아요.
        "check_sent" => Ok(json!([])),
        "set_process_exe" => (|| {
            let exe = a.s("exe")?;
            let st = s.store()?;
            let mut v: Value = st.get("settings").map_err(code)?.and_then(|t| serde_json::from_str(&t).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
            if !v["process"].is_object() {
                v["process"] = json!({});
            }
            v["process"]["claude"] = json!(exe);
            out(st.set("settings", &v.to_string()))
        })(),
        "open_path" | "show_in_folder" | "open_portal" => Ok(Value::Null),
        // 미리 보기: 사진이 여럿이면 마지막 사진을 고른 것으로
        "pick_photos" => (|| {
            let req: Value = a.get("req")?;
            let items = req["items"].as_array().cloned().unwrap_or_default();
            let picks: Vec<Value> = items
                .iter()
                .filter_map(|i| {
                    let photos = i["photos"].as_array()?;
                    (photos.len() > 1).then(|| json!({ "no": i["no"], "pick": photos[photos.len() - 1], "reason": "파임이 가까이 크게 보여요" }))
                })
                .collect();
            Ok(Value::Array(picks))
        })(),
        "run_claude" => (|| {
            let req: Value = a.get("req")?;
            let r = &mut s.ph.run;
            if req["guide"].as_str().unwrap_or("").starts_with("# 기록 지시부 메일") {
                // 메일쓰기 → 받는 사람·제목·본문 → 첨부 → 보내기, 네 걸음
                *r = Run { state: "running".into(), total: Some(4), done: Some(0), log: "D:\\민원처리\\보낼편지함\\메일\\_claude.log".into(), skip_count: None, mail_steps: 4 };
                return Ok(Value::Null);
            }
            let skip = s.store.as_ref().and_then(|st| st.process_data().ok()).map(|d| d.cases.len() as i64);
            *r = Run { state: "running".into(), total: Some(s.ph.queue.len() as i64), done: Some(0), log: "D:\\민원처리\\받은편지함\\_claude.log".into(), skip_count: skip, mail_steps: 0 };
            Ok(Value::Null)
        })(),
        "stop_claude" => {
            if s.ph.run.state == "running" {
                s.ph.run.state = "stopped".into();
            }
            s.ph.queue.clear();
            Ok(Value::Null)
        }
        // 부를 때마다 한 걸음: 메일이면 걸음 하나, 불러오기면 보기 민원 하나를 가져올 폴더에
        "claude_status" => {
            let r = &mut s.ph.run;
            if r.state == "running" && r.mail_steps > 0 {
                r.mail_steps -= 1;
                r.done = Some(4 - r.mail_steps);
                if r.mail_steps == 0 {
                    r.state = "done".into();
                }
            } else if r.state == "running" {
                if s.ph.queue.is_empty() {
                    r.state = "done".into();
                } else {
                    let next = s.ph.queue.remove(0);
                    s.ph.inbox.push(next);
                    r.done = Some(r.done.unwrap_or(0) + 1);
                }
            }
            Ok(s.ph.run.status())
        }

        // ---------- 브라우저에서 부르지 않는 것 ----------
        "open_twin" | "juso_http" | "google_listen" | "google_wait" | "open_google_login" | "google_http" => Err("io".into()),
        c if c.starts_with("fs_") && PLACEHOLDER.contains(&c) => Err("io".into()),

        _ => return None,
    })
}

/// 보기 민원(일부 칸만)을 core `CaseInput` 모양으로 – 빠진 칸은 빈 값
fn fill_case(mut v: Value) -> Value {
    if !v.is_object() {
        return v;
    }
    for k in ["no", "received", "due", "area", "place", "summary", "short", "reason", "map", "folder"] {
        if !v[k].is_string() {
            v[k] = json!("");
        }
    }
    if !v["photos"].is_array() {
        v["photos"] = json!([]);
    }
    if !v["work"].is_i64() {
        v["work"] = Value::Null;
    }
    v
}
