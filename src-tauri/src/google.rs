//! 구글 캘린더 연동(9단계)에서 앱(Rust)이 맡는 일이에요.
//!
//! - 구글 로그인: 이 PC 안에서만 열리는 주소(127.0.0.1:임의 번호)를 잠깐 열어 두고, 기본 브라우저로
//!   구글 로그인 창을 띄워요. 로그인이 끝나면 구글이 그 주소로 돌아오며 일회용 코드를 넘겨줘요.
//! - 인터넷 요청: 화면(Edge와 같은 길)이 먼저 보내고, 막히면 여기서 대신 보내요(공휴일과 같은 순서).
//!   구글 주소만 받아요.
//!
//! 로그인 정보·내보낸 목록은 화면이 암호화 파일(kv)에 저장해요. 여기서는 아무것도 저장하지 않아요.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 로그인 창을 띄우고 기다리는 시간
const WAIT: Duration = Duration::from_secs(300);

type Callback = Result<(String, String), String>;

static PENDING: Mutex<Option<Receiver<Callback>>> = Mutex::new(None);

#[derive(Serialize)]
pub struct AuthCode {
    code: String,
    state: String,
}

/// 주소의 ?a=b&c=d 에서 값 하나를 꺼내요(%xx와 +를 풀어요).
fn query_value(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|p| {
        let (k, v) = p.split_once('=')?;
        (k == key).then(|| decode(v))
    })
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or(""), 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>기록</title><body style=\"font-family:'Malgun Gothic',sans-serif;padding:48px;color:#1C1B22\"><h2 style=\"color:#4B37C4\">구글 연결을 마쳤어요</h2><p>이 창을 닫고 기록으로 돌아가세요.</p></body>";
const PAGE_FAIL: &str = "<!doctype html><meta charset=utf-8><title>기록</title><body style=\"font-family:'Malgun Gothic',sans-serif;padding:48px;color:#1C1B22\"><h2 style=\"color:#B42318\">구글 연결을 마치지 못했어요</h2><p>이 창을 닫고 기록에서 다시 시도해 주세요.</p></body>";

fn respond(mut s: TcpStream, page: &str) {
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        page.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(page.as_bytes());
    let _ = s.flush();
}

/// 요청 한 건을 읽어 로그인 결과가 들어 있으면 돌려줘요. 아니면(아이콘 요청 등) None.
fn handle(mut s: TcpStream) -> Option<Callback> {
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = [0u8; 8192];
    let n = s.read(&mut buf).ok()?;
    let req = String::from_utf8_lossy(&buf[..n]);
    let path = req.lines().next()?.split_whitespace().nth(1)?.to_string();
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
    if let Some(code) = query_value(query, "code") {
        respond(s, PAGE_OK);
        return Some(Ok((code, query_value(query, "state").unwrap_or_default())));
    }
    if let Some(err) = query_value(query, "error") {
        respond(s, PAGE_FAIL);
        return Some(Err(if err == "access_denied" { "denied".into() } else { err }));
    }
    let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    None
}

/// 로그인 결과를 받을 주소를 열고 그 번호를 돌려줘요. 결과는 `google_wait`로 받아요.
#[tauri::command]
pub fn google_listen(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let (tx, rx) = channel::<Callback>();
    *PENDING.lock().map_err(|_| "io".to_string())? = Some(rx);
    std::thread::spawn(move || {
        let until = Instant::now() + WAIT;
        while Instant::now() < until {
            match listener.accept() {
                Ok((s, _)) => {
                    let _ = s.set_nonblocking(false);
                    if let Some(r) = handle(s) {
                        let _ = tx.send(r);
                        // 로그인한 브라우저 뒤에 숨은 기록 창을 앞으로 꺼내요.
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                        return;
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
        }
        let _ = tx.send(Err("timeout".into()));
    });
    Ok(port)
}

/// 로그인이 끝날 때까지 기다려요. 5분이 지나면 "timeout", 사용자가 거절하면 "denied"예요.
#[tauri::command]
pub async fn google_wait() -> Result<AuthCode, String> {
    let rx = PENDING.lock().map_err(|_| "io".to_string())?.take().ok_or("no_login")?;
    let r = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(WAIT + Duration::from_secs(5)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "timeout".to_string())?;
    let (code, state) = r?;
    Ok(AuthCode { code, state })
}

/// 구글 로그인 주소를 기본 브라우저로 열어요. 구글 로그인 주소만 받아요.
#[tauri::command]
pub fn open_google_login(url: String) -> Result<(), String> {
    if !url.starts_with("https://accounts.google.com/") {
        return Err("invalid".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 검은 창이 잠깐 뜨지 않게 해요(CREATE_NO_WINDOW).
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct HttpReply {
    status: u16,
    body: String,
}

/// 구글로 보내는 요청을 앱이 대신 보내요(화면 쪽 요청이 막힐 때). 받지 못하면 "offline"이에요.
#[tauri::command]
pub async fn google_http(method: String, url: String, headers: Vec<(String, String)>, body: Option<String>) -> Result<HttpReply, String> {
    let ok_host = ["https://oauth2.googleapis.com/", "https://www.googleapis.com/", "https://tasks.googleapis.com/"];
    if !ok_host.iter().any(|h| url.starts_with(h)) {
        return Err("invalid".into());
    }
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "invalid".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.request(m, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let res = req.send().await.map_err(|_| "offline".to_string())?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(|_| "offline".to_string())?;
    Ok(HttpReply { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_query_values() {
        let q = "state=ab%2Fc&code=4%2F0Ad-x+y&scope=x";
        assert_eq!(query_value(q, "code").as_deref(), Some("4/0Ad-x y"));
        assert_eq!(query_value(q, "state").as_deref(), Some("ab/c"));
        assert_eq!(query_value(q, "none"), None);
        assert_eq!(decode("100%"), "100%");
    }
}
