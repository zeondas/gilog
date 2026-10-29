//! 브라우저 미리 보기용 저장 모듈(품질 보완 ②-3 2차).
//!
//! 윈도우 앱은 화면이 Tauri로 `src-tauri/src`의 명령을 부르고, 명령이 `gilog-core`(저장 규칙)를 불러요.
//! 브라우저 미리 보기(지킴이·부하 시험·매뉴얼 캡처)에는 Tauri가 없으니, 이 크레이트가 **같은 명령 이름**을 받아
//! **같은 core 함수**를 불러요(`commands.rs` – 앱 명령 층 몸통과 같은 모양, 규칙을 새로 짜지 않아요).
//! 윈도우·파일·인터넷·실행이 필요한 명령은 `placeholder.rs`의 자리 표시자예요(앱 흉내 없이 지나가거나 저장만 해요).
//!
//! 화면에서는 `call(명령, JSON 인자)` 하나로 불러요(`tools/preview/core.ts`). 결과는 JSON 글자, 실패는 앱과 같은 실패 이름이에요.
//! 앱 명령 목록과 이 두 목록이 맞는지는 `tests/app_commands.rs`가 봐요(빠지면 실패).

mod commands;
mod placeholder;

use std::cell::RefCell;
use std::collections::BTreeMap;

use gilog_core::Store;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::prelude::*;

pub use commands::BROWSER;
pub use placeholder::{PLACEHOLDER, PREVIEW_ONLY};

/// 미리 보기 한 번(탭 하나)의 상태예요. 앱에서는 `AppState`(열린 자료 파일)와 AppData 파일들이 맡는 자리예요.
pub struct Session {
    /// 메모리 저장소(`Store::memory`). 잠가도 버리지 않아요 – 미리 보기에서는 다시 풀면 같은 자료가 보여야 해요.
    pub(crate) store: Option<Store>,
    pub(crate) unlocked: bool,
    /// 미리 보기 가짜 드라이브: 경로 → 바이트(엑셀 쓰기·읽기). 파일 대신이에요.
    pub(crate) drive: BTreeMap<String, Vec<u8>>,
    pub(crate) ph: placeholder::State,
}

impl Session {
    fn new() -> Session {
        Session { store: None, unlocked: false, drive: BTreeMap::new(), ph: placeholder::State::default() }
    }

    /// 앱의 `with_store`와 같아요: 잠겨 있으면 "locked".
    pub(crate) fn store(&mut self) -> Result<&mut Store, String> {
        match (&mut self.store, self.unlocked) {
            (Some(s), true) => Ok(s),
            _ => Err("locked".into()),
        }
    }
}

thread_local! {
    static SESSION: RefCell<Session> = RefCell::new(Session::new());
}

/// 명령 인자(JSON 객체). 이름은 화면이 보내는 그대로(camelCase)예요 – Tauri가 바꿔 주는 것과 같아요.
pub(crate) struct Args<'a>(pub &'a Value);

impl Args<'_> {
    pub(crate) fn get<T: DeserializeOwned>(&self, key: &str) -> Result<T, String> {
        serde_json::from_value(self.0.get(key).cloned().unwrap_or(Value::Null)).map_err(|_| "invalid".to_string())
    }
    pub(crate) fn s(&self, key: &str) -> Result<String, String> {
        self.get(key)
    }
    pub(crate) fn id(&self, key: &str) -> Result<i64, String> {
        self.get(key)
    }
}

/// core의 결과를 화면에 줄 JSON으로(실패는 앱의 `code`와 같은 이름)
pub(crate) fn out<T: Serialize>(r: gilog_core::Result<T>) -> Result<Value, String> {
    let v = r.map_err(|e| e.code().to_string())?;
    serde_json::to_value(v).map_err(|_| "io".to_string())
}

pub(crate) fn json<T: Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|_| "io".to_string())
}

/// 명령 하나를 불러요. 앱에 없는 이름이면 "io"(옛 흉내와 같아요).
pub fn dispatch(session: &mut Session, cmd: &str, args: &Value) -> Result<Value, String> {
    let a = Args(args);
    if let Some(r) = commands::browser(session, cmd, &a) {
        return r;
    }
    if let Some(r) = placeholder::placeholder(session, cmd, &a) {
        return r;
    }
    Err("io".into())
}

/// 화면이 부르는 곳: `call("add_complaint", "{\"complaint\":{…}}")` → 결과 JSON 글자. 실패하면 실패 이름(글자)을 던져요.
#[wasm_bindgen]
pub fn call(cmd: &str, args: &str) -> Result<String, JsValue> {
    let args: Value = if args.trim().is_empty() { Value::Object(Default::default()) } else { serde_json::from_str(args).map_err(|_| JsValue::from_str("invalid"))? };
    SESSION.with(|s| {
        let r = dispatch(&mut s.borrow_mut(), cmd, &args);
        match r {
            Ok(v) => Ok(v.to_string()),
            Err(e) => Err(JsValue::from_str(&e)),
        }
    })
}

/// 가짜 드라이브에 파일을 넣어요(시험 도구가 엑셀 가져오기 파일을 미리 둘 때).
#[wasm_bindgen]
pub fn drive_put(path: &str, bytes: Vec<u8>) {
    SESSION.with(|s| {
        s.borrow_mut().drive.insert(path.to_string(), bytes);
    })
}

/// 가짜 드라이브의 파일(없으면 undefined) – 엑셀 내보내기 결과를 시험 도구가 읽을 때.
#[wasm_bindgen]
pub fn drive_get(path: &str) -> Option<Vec<u8>> {
    SESSION.with(|s| s.borrow().drive.get(path).cloned())
}

/// 윈도우 Hello 대신 확인 창(미리 보기에서만). 시험(네이티브)에서는 늘 "확인"이에요.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, js_name = confirm)]
    fn window_confirm(text: &str) -> bool;
}

pub(crate) fn hello() -> bool {
    #[cfg(target_arch = "wasm32")]
    {
        window_confirm("[미리 보기] Windows Hello 흉내 – 확인 = PIN 맞음, 취소 = 취소")
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn run(s: &mut Session, cmd: &str, a: Value) -> Result<Value, String> {
        dispatch(s, cmd, &a)
    }

    #[test]
    fn every_listed_name_dispatches() {
        // 목록에 적은 이름은 모두 받는 곳이 있어야 해요(빈 인자라 실패해도 "모르는 명령"은 아니어야).
        let mut s = Session::new();
        for n in BROWSER {
            assert!(commands::browser(&mut s, n, &Args(&json!({}))).is_some(), "browser {n}");
        }
        for n in PLACEHOLDER.iter().chain(PREVIEW_ONLY) {
            assert!(placeholder::placeholder(&mut s, n, &Args(&json!({}))).is_some(), "placeholder {n}");
        }
    }

    #[test]
    fn lock_keeps_data_and_rules_are_core() {
        let mut s = Session::new();
        assert_eq!(run(&mut s, "status", json!({})).unwrap()["exists"], json!(false));
        assert_eq!(run(&mut s, "create_store", json!({"password": "12"})).unwrap_err(), "password_too_short");
        run(&mut s, "create_store", json!({"password": "1234"})).unwrap();
        assert_eq!(run(&mut s, "create_store", json!({"password": "1234"})).unwrap_err(), "already_exists");
        let c = run(&mut s, "add_complaint", json!({"complaint": {"intake": "전화", "received": "2026-10-21", "ctype": "포트홀", "area": "", "place": "봉일천리 113", "person": "", "phone": "", "body": "", "action": "", "due": "", "status": ""}})).unwrap();
        assert_eq!(c["no"], json!(1));
        assert_eq!(c["status"], json!(gilog_core::DEFAULT_STATUS));
        run(&mut s, "lock", json!({})).unwrap();
        assert_eq!(run(&mut s, "complaints", json!({})).unwrap_err(), "locked");
        assert_eq!(run(&mut s, "unlock", json!({"password": "9999"})).unwrap_err(), "wrong_password");
        run(&mut s, "unlock", json!({"password": "1234"})).unwrap();
        assert_eq!(run(&mut s, "complaints", json!({})).unwrap().as_array().unwrap().len(), 1);
        assert_eq!(run(&mut s, "add_complaint", json!({"complaint": {"intake": "", "received": "2026-13-40", "ctype": "", "area": "", "place": "x", "person": "", "phone": "", "body": "", "action": "", "due": "", "status": ""}})).unwrap_err(), "invalid");
        assert_eq!(run(&mut s, "no_such_command", json!({})).unwrap_err(), "io");
    }

    #[test]
    fn excel_goes_through_the_fake_drive() {
        let mut s = Session::new();
        run(&mut s, "create_store", json!({"password": "1234"})).unwrap();
        let data = json!({"rows": [["1", "홍길동", "도로관리과", "주무관", "010-1234-5678", "", "", "", "", "", "", ""]], "intake": [], "status": []});
        run(&mut s, "excel_write", json!({"path": "D:\\연락처.xlsx", "kind": "contacts", "data": data})).unwrap();
        assert!(s.drive.get("D:\\연락처.xlsx").is_some_and(|b| b.starts_with(b"PK")));
        let back = run(&mut s, "excel_read", json!({"path": "D:\\연락처.xlsx", "kind": "contacts"})).unwrap();
        assert_eq!(back["rows"][0][1], json!("홍길동"));
        assert_eq!(run(&mut s, "excel_read", json!({"path": "D:\\없음.xlsx", "kind": "contacts"})).unwrap_err(), "io");
    }

    #[test]
    fn inbox_then_order_uses_core_rules() {
        let mut s = Session::new();
        run(&mut s, "create_store", json!({"password": "1234"})).unwrap();
        let works = run(&mut s, "save_work", json!({"id": null, "work": {"name": "소파보수", "full": "", "co": "○○건설", "contact": null, "project": null, "scope": "", "nextSeq": 3, "tpl": ""}})).unwrap();
        let w = works[0]["id"].as_i64().unwrap();
        run(&mut s, "preview_inbox", json!({"list": [{"no": "1AA-1", "received": "2026-10-20", "place": "봉일천리 113", "short": "포트홀", "work": w, "photos": ["a.jpg", "b.jpg"]}]})).unwrap();
        run(&mut s, "run_claude", json!({"req": {"guide": "# 민원 불러오기"}})).unwrap();
        assert_eq!(run(&mut s, "claude_status", json!({"inbox": ""})).unwrap()["done"], json!(1));
        assert_eq!(run(&mut s, "claude_status", json!({"inbox": ""})).unwrap()["state"], json!("done"));
        let r = run(&mut s, "read_inbox", json!({"inbox": "", "downloads": "", "root": "D:\\민원처리", "hold": false})).unwrap();
        assert_eq!(r["added"].as_array().unwrap().len(), 1);
        assert_eq!(r["added"][0]["photos"][1], json!("D:\\민원처리\\261020_봉일천리 113_포트홀_사진2.jpg"));
        let o = run(&mut s, "make_order", json!({"req": {"nos": ["1AA-1"], "order": null, "root": "D:\\민원처리", "date": "2026-10-21", "tpl": ""}})).unwrap();
        assert_eq!(o["order"]["seq"], json!(3));
        assert_eq!(o["order"]["file"], json!("D:\\민원처리\\261021_소파보수-03.hwpx"));
        assert_eq!(o["works"][0]["nextSeq"], json!(4));
        let id = o["order"]["id"].clone();
        let j = run(&mut s, "order_jpg", json!({"id": id})).unwrap();
        assert_eq!(j["jpgs"], json!(["D:\\민원처리\\261021_소파보수-03.jpg"]));
        let q = run(&mut s, "send_order", json!({"id": id, "outbox": "D:\\보낼편지함"})).unwrap();
        assert_eq!(q["stage"], json!("queued"));
        let d = run(&mut s, "process_data", json!({})).unwrap();
        assert_eq!(d["cases"][0]["stage"], json!("queued"));
    }
}
