//! 도로명주소 → 지번: 웹(주소정보누리집 검색 API)과 내장 표 바꾸기 (2026-10-21 주소 변환 웹 세션).
//!
//! - 웹 찾기 규칙은 화면 쪽 `src/addressWeb.ts`에 있어요. 여기는 화면 요청이 막힐 때 대신 보내기(`juso_http`)만 해요.
//!   주소는 주소정보누리집 검색 API 하나만 받아요.
//! - 내장 표 바꾸기: 사용자가 고른 경기도 전체자료(cp949)에서 파주시 줄만 뽑아 AppData `roadaddr.txt`에 두고,
//!   앱을 켤 때 그 파일이 있으면 앱에 넣은 표 대신 써요(빌드 없이 갱신).
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::io;

const JUSO: &str = "https://business.juso.go.kr/addrlink/addrLinkApi.do?";
/// 앱에 넣은 표를 받은 날(data/README.md)
pub const BUILTIN_DATE: &str = "2026-10-18";
/// 경기도 파일에서 파주시가 이보다 적으면 잘못 고른 파일로 봐요(extract.py와 같게).
const MIN_ROWS: usize = 40000;

fn table_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::profile::config_dir(app).map_err(io)?;
    fs::create_dir_all(&dir).map_err(io)?;
    Ok(dir.join("roadaddr.txt"))
}

/// 화면 요청이 막힐 때 대신 보내요(주소정보누리집 검색 API만, GET).
#[tauri::command]
pub async fn juso_http(url: String) -> Result<String, String> {
    if !url.starts_with(JUSO) {
        return Err("invalid".into());
    }
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|_| "offline".to_string())?;
    if !res.status().is_success() {
        return Err(format!("http {}", res.status().as_u16()));
    }
    res.text().await.map_err(|_| "offline".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    /// 지상 건물 곳 수
    count: usize,
    /// 자료 날짜 YYYY-MM-DD (바꾼 파일은 바꾼 날)
    date: String,
    /// 사용자가 바꾼 표인지(아니면 앱에 넣은 표)
    custom: bool,
}

fn ymd(t: std::time::SystemTime) -> String {
    let secs = t.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) + 9 * 3600;
    let days = secs.div_euclid(86400);
    // 1970-01-01부터 날 수 → 날짜(Howard Hinnant 방식)
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn info(app: &AppHandle) -> TableInfo {
    let path = table_path(app).ok();
    let meta = path.as_ref().and_then(|p| fs::metadata(p).ok());
    let count = gilog_core::road_table_count();
    match meta {
        Some(m) => TableInfo { count, date: m.modified().map(ymd).unwrap_or_default(), custom: true },
        None => TableInfo { count, date: BUILTIN_DATE.into(), custom: false },
    }
}

/// 앱을 켤 때: 바꾼 표가 있으면 그것을, 없으면 앱에 넣은 표를 미리 풀어 둬요.
pub fn load_saved(app: &AppHandle) {
    if let Ok(p) = table_path(app) {
        if let Ok(text) = fs::read_to_string(&p) {
            if gilog_core::set_road_table(&text) > 0 {
                return;
            }
        }
    }
    gilog_core::road_to_jibun("");
}

#[tauri::command]
pub async fn road_table_info(app: AppHandle) -> TableInfo {
    info(&app)
}

/// 경기도 전체자료(`rnaddrkor_gyunggi.txt`, cp949) → 파주시 줄만 뽑아 표를 바꿔요.
/// 실패: "few:N"(파주시 줄이 너무 적음 – 다른 파일), "io".
#[tauri::command]
pub async fn road_table_import(app: AppHandle, path: String) -> Result<TableInfo, String> {
    let bytes = fs::read(&path).map_err(io)?;
    let text = match std::str::from_utf8(&bytes) {
        Ok(t) => t.to_string(),
        Err(_) => encoding_rs::EUC_KR.decode(&bytes).0.into_owned(),
    };
    // 이미 뽑아 둔 표(paju_roadaddr.txt 모양)도 받아요.
    let paju = if text.lines().next().map(|l| l.split('|').count() >= 23).unwrap_or(false) { gilog_core::extract_paju(&text) } else { text };
    let rows = paju.lines().count();
    if rows < MIN_ROWS {
        return Err(format!("few:{rows}"));
    }
    if gilog_core::set_road_table(&paju) == 0 {
        return Err(format!("few:0"));
    }
    fs::write(table_path(&app)?, paju).map_err(io)?;
    Ok(info(&app))
}

/// 앱에 넣은 표로 되돌려요.
#[tauri::command]
pub async fn road_table_reset(app: AppHandle) -> Result<TableInfo, String> {
    if let Ok(p) = table_path(&app) {
        let _ = fs::remove_file(p);
    }
    gilog_core::reset_road_table();
    Ok(info(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        let t = std::time::UNIX_EPOCH + Duration::from_secs(1_792_540_800); // 2026-10-21 00:00 UTC
        assert_eq!(ymd(t), "2026-10-21");
    }
}
