//! 예산현황(13단계): 집행현황의 모든 세부사업에 대한 연도×재원 장부(엑셀 "집행·이월 현황" 시트 규칙).
//!
//! - 예산현액·집행액은 집행현황에서 와요(화면 src/budgetStatus.ts가 계산). 여기 저장하는 것은 세부사업마다의 **설정과 직접 적은 값**
//!   (단년도/다년도·기간·재원·이월 사업·재원별 직접 입력·메모) 한 덩어리 JSON이에요 — 표 `bstatus`(세부사업 이름 → JSON).
//!   계산 규칙은 화면에만 두고 core는 저장만 해요(집행현황 kv 저장과 같은 수준).
//! - 엑셀 내보내기: 화면이 계산한 줄들을 받아 사용자의 시도57호선 엑셀처럼 열 19개(C~U)로 써요. 가져오기는 집행현황의
//!   `budget_xlsx::read_grid`(칸 글자 그대로)를 그대로 쓰고 화면이 판단해요.

use std::path::Path;

use rusqlite::params;
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, XlsxError};
use serde::{Deserialize, Serialize};

use crate::{Error, Result, Store};

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS bstatus (
    name  TEXT PRIMARY KEY,
    setup TEXT NOT NULL
);";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BStatusSetup {
    pub name: String,
    /// 화면의 Setup JSON 그대로
    pub setup: String,
}

impl Store {
    /// 모든 세부사업의 설정
    pub fn bstatus_list(&self) -> Result<Vec<BStatusSetup>> {
        let mut st = self.conn.prepare("SELECT name, setup FROM bstatus ORDER BY name")?;
        let rows = st.query_map([], |r| Ok(BStatusSetup { name: r.get(0)?, setup: r.get(1)? }))?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// 한 세부사업의 설정을 통째로 바꿔요(없으면 새로)
    pub fn bstatus_set(&self, name: &str, setup: &str) -> Result<()> {
        if name.trim().is_empty() {
            return Err(Error::Invalid("세부사업 이름이 비어 있어요".into()));
        }
        self.conn.execute(
            "INSERT INTO bstatus (name, setup) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET setup = excluded.setup",
            params![name, setup],
        )?;
        Ok(())
    }

    /// 세부사업 이름이 집행현황에서 바뀌었을 때(지금은 화면이 안 불러요 — 뒀어요)
    pub fn bstatus_rename(&self, from: &str, to: &str) -> Result<()> {
        self.conn.execute("UPDATE OR REPLACE bstatus SET name = ?2 WHERE name = ?1", params![from, to])?;
        Ok(())
    }

    /// 이름이 바뀌어도 설정이 따라가게 — 읽기 전에 한 번 맞춰요(2026-10-26 집행·예산 연동 세션).
    /// - 설정 JSON의 `uids`(그 사업의 집행현황 세부사업 줄 uid, 해마다 하나)로 지금 이름을 찾아 키가 다르면 키를 옮겨요.
    /// - `uids`가 없는 옛 설정은 키와 같은 이름의 세부사업 uid들을 채워 넣어요(옛 이름 키 옮기기의 시작점).
    /// - `split`의 "해:공사 번호"(숫자 — PC마다 다름)는 "해:공사 uid"로 옮겨요.
    /// - 무언가를 바꾸기 전, kv `bstatus.backup`에 바꾸기 전 전체를 한 번만 남겨요(옮기다 잘못되어도 되살리게).
    pub fn bstatus_sync(&self) -> Result<()> {
        let rows = self.bstatus_list()?;
        let mut changes: Vec<(String, Option<String>, String)> = Vec::new(); // (옛 키, 새 키, 새 setup)
        for r in &rows {
            let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&r.setup) else { continue };
            if !v.is_object() {
                continue;
            }
            let mut dirty = false;
            // 1) uids 채우기(옛 설정): 키와 같은 이름의 세부사업 줄(해마다)
            let mut uids: Vec<String> = v
                .get("uids")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            if uids.is_empty() {
                let mut st = self.conn.prepare("SELECT uid FROM budget_projects WHERE name = ?1 ORDER BY year")?;
                let found = st.query_map(params![r.name], |x| x.get::<_, String>(0))?;
                uids = found.collect::<std::result::Result<Vec<_>, _>>()?;
                if !uids.is_empty() {
                    dirty = true;
                }
            }
            // 2) 지금 이름 찾기(가장 최근 해 기준) → 키 옮기기
            let mut new_key: Option<String> = None;
            if !uids.is_empty() {
                let marks = vec!["?"; uids.len()].join(",");
                let sql = format!("SELECT name FROM budget_projects WHERE uid IN ({marks}) ORDER BY year DESC LIMIT 1");
                let mut st = self.conn.prepare(&sql)?;
                let cur: Option<String> = st
                    .query_map(rusqlite::params_from_iter(uids.iter()), |x| x.get::<_, String>(0))?
                    .next()
                    .transpose()?;
                if let Some(cur) = cur {
                    if cur != r.name {
                        new_key = Some(cur.clone());
                    }
                    // 같은 이름으로 새 해 줄이 생겼으면 uid 목록에 더해요
                    let name_now = new_key.as_deref().unwrap_or(&r.name);
                    let mut st = self.conn.prepare("SELECT uid FROM budget_projects WHERE name = ?1 ORDER BY year")?;
                    let all: Vec<String> = st
                        .query_map(params![name_now], |x| x.get::<_, String>(0))?
                        .collect::<std::result::Result<Vec<_>, _>>()?;
                    for u in all {
                        if !uids.contains(&u) {
                            uids.push(u);
                            dirty = true;
                        }
                    }
                }
            }
            if dirty || v.get("uids").is_none() && !uids.is_empty() {
                v["uids"] = serde_json::json!(uids);
                dirty = true;
            }
            // 3) split "해:공사 번호" → "해:공사 uid"
            if let Some(split) = v.get_mut("split").and_then(|x| x.as_object_mut()) {
                let keys: Vec<String> = split.keys().cloned().collect();
                for k in keys {
                    let Some((year, id_part)) = k.split_once(':') else { continue };
                    if id_part.is_empty() || !id_part.bytes().all(|b| b.is_ascii_digit()) {
                        continue; // 이미 uid
                    }
                    let Ok(rid) = id_part.parse::<i64>() else { continue };
                    let uid: Option<String> = self
                        .conn
                        .query_row("SELECT uid FROM budget_rows WHERE id = ?1", params![rid], |x| x.get(0))
                        .map(Some)
                        .or_else(|e| if e == rusqlite::Error::QueryReturnedNoRows { Ok(None) } else { Err(e) })?;
                    if let Some(uid) = uid {
                        if let Some(val) = split.remove(&k) {
                            split.insert(format!("{year}:{uid}"), val);
                            dirty = true;
                        }
                    }
                }
            }
            if dirty || new_key.is_some() {
                changes.push((r.name.clone(), new_key, serde_json::to_string(&v).map_err(|e| Error::Invalid(e.to_string()))?));
            }
        }
        if changes.is_empty() {
            return Ok(());
        }
        // 바꾸기 전 백업(한 번만)
        if self.get("bstatus.backup")?.is_none() {
            let backup = serde_json::to_string(&rows).map_err(|e| Error::Invalid(e.to_string()))?;
            self.set("bstatus.backup", &backup)?;
        }
        for (old, new_key, setup) in changes {
            match new_key {
                Some(nk) => {
                    // 옮길 자리에 이미 다른 설정이 있으면 키는 두고 내용만 고쳐요(지워 보이는 일이 없게)
                    let exists: bool = self.conn.prepare("SELECT 1 FROM bstatus WHERE name = ?1")?.exists(params![&nk])?;
                    if exists {
                        self.conn.execute("UPDATE bstatus SET setup = ?2 WHERE name = ?1", params![old, setup])?;
                    } else {
                        self.conn.execute("UPDATE bstatus SET name = ?2, setup = ?3 WHERE name = ?1", params![old, nk, setup])?;
                    }
                }
                None => {
                    self.conn.execute("UPDATE bstatus SET setup = ?2 WHERE name = ?1", params![old, setup])?;
                }
            }
        }
        Ok(())
    }
}

// ---------- 엑셀 ----------

/// 화면이 계산해 보내는 한 줄
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BStatusLine {
    /// "pj"(세부사업) · "it"(연도) · "gun"(재원)
    pub level: String,
    /// 사업기간 칸: 세부사업은 "단년도"·"2025~2027년", 연도 줄은 "2026년", 재원 줄은 재원 이름
    pub period: String,
    pub name: String,
    /// C~U 19칸(원 단위): 당해예산 소계·본예산·1추~4추·전년도 이월 소계·명시·사고·예산현액·집행 소계·당해·명시·사고·집행률(%·소수)·다음연도 이월 소계·명시·사고·불용액
    pub v: Vec<f64>,
    /// 집행률이 없으면(예산현액 0) false
    pub has_rate: bool,
    pub memo: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BStatusExport {
    pub year: i64,
    pub unit: i64,
    pub date: String,
    pub lines: Vec<BStatusLine>,
}

const FONT: &str = "맑은 고딕";
const LINE: u32 = 0xBFBFBF;
const MARGIN_IN: f64 = 1.5 / 2.54;
/// 위 줄 묶음(이름, 걸치는 열 수)
const GROUPS: [(&str, u16); 8] = [("당해예산 ①", 6), ("전년도 이월 ②", 3), ("예산현액 ①+②", 1), ("집행액", 4), ("집행률", 1), ("다음연도 이월", 3), ("불용액", 1), ("메모", 1)];
const SUBS: [&str; 20] = ["소계", "본예산", "1추", "2추", "3추", "4추", "소계", "명시이월", "사고이월", "", "소계", "당해", "명시", "사고", "", "소계", "명시이월", "사고이월", "", ""];
const RATE_COL: usize = 14;

fn xerr(e: XlsxError) -> Error {
    match e {
        XlsxError::IoError(e) => Error::Io(e),
        other => Error::Invalid(other.to_string()),
    }
}

fn base(size: f64, bold: bool, fill: Option<u32>, color: u32) -> Format {
    let mut f = Format::new()
        .set_font_name(FONT)
        .set_font_charset(129)
        .set_font_family(2)
        .set_font_size(size)
        .set_font_color(Color::RGB(color))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(LINE))
        .set_align(FormatAlign::VerticalCenter);
    if bold {
        f = f.set_bold();
    }
    if let Some(c) = fill {
        f = f.set_background_color(Color::RGB(c));
    }
    f
}

/// 내보내기 — 사용자의 시도57호선 엑셀 열 순서(C~U) 그대로, 앞에 사업기간·사업명 두 열, 뒤에 메모
pub fn write_bstatus_xlsx(path: &Path, data: &BStatusExport) -> Result<()> {
    let unit = if data.unit == 1000 { 1000.0 } else { 1.0 };
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name(format!("{} 예산현황", data.year)).map_err(xerr)?;
    ws.set_column_width(0, 12.0).map_err(xerr)?;
    ws.set_column_width(1, 34.0).map_err(xerr)?;
    for c in 2..=20u16 {
        ws.set_column_width(c, 13.0).map_err(xerr)?;
    }
    ws.set_column_width(21, 30.0).map_err(xerr)?;
    let title = Format::new()
        .set_font_name("HY헤드라인M")
        .set_font_charset(129)
        .set_font_family(1)
        .set_font_size(20)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);
    ws.merge_range(0, 0, 0, 21, &format!("{}년 예산현황", data.year), &title).map_err(xerr)?;
    ws.set_row_height(0, 50).map_err(xerr)?;
    let sub = Format::new().set_font_name(FONT).set_font_charset(129).set_font_size(10).set_font_color(Color::RGB(0x595959));
    ws.write_string_with_format(1, 0, format!("기준일 {} · 단위 {}", data.date, if unit == 1.0 { "원" } else { "천원" }), &sub).map_err(xerr)?;
    ws.set_row_height(1, 24).map_err(xerr)?;
    let head = base(10.0, true, Some(0xF2F2F2), 0x002060).set_align(FormatAlign::Center);
    // 머리 두 줄(2·3행): 사업기간·사업명은 두 줄 병합, 묶음은 가로 병합, 묶음 없는 열(예산현액·집행률·불용액·메모)도 두 줄 병합
    ws.merge_range(2, 0, 3, 0, "사업기간", &head).map_err(xerr)?;
    ws.merge_range(2, 1, 3, 1, "사업명", &head).map_err(xerr)?;
    let mut c: u16 = 2;
    for (g, n) in GROUPS {
        if n == 1 {
            ws.merge_range(2, c, 3, c, g, &head).map_err(xerr)?;
        } else {
            ws.merge_range(2, c, 2, c + n - 1, g, &head).map_err(xerr)?;
            for k in 0..n {
                ws.write_string_with_format(3, c + k, SUBS[(c + k - 2) as usize], &head).map_err(xerr)?;
            }
        }
        c += n;
    }
    ws.set_row_height(2, 24).map_err(xerr)?;
    ws.set_row_height(3, 22).map_err(xerr)?;

    let fm = |level: &str| -> (Format, Format, Format, Format) {
        let (size, bold, fill, indent) = match level {
            "pj" => (11.0, true, Some(0xE8E5F5), 0u8),
            "it" => (10.0, true, Some(0xF6F6F9), 1),
            _ => (10.0, false, None, 2),
        };
        let b = base(size, bold, fill, 0x000000);
        (
            b.clone().set_indent(indent),
            b.clone().set_num_format("#,##0;[Red]-#,##0;\"-\"").set_align(FormatAlign::Right),
            b.clone().set_num_format("0%").set_align(FormatAlign::Center),
            b.set_text_wrap(),
        )
    };
    let mut row: u32 = 4;
    let mut pj_start: Option<u32> = None;
    let mut it_start: Option<u32> = None;
    let close = |ws: &mut rust_xlsxwriter::Worksheet, start: &mut Option<u32>, row: u32| -> Result<()> {
        if let Some(s) = start.take() {
            if row - 1 > s {
                ws.group_rows(s + 1, row - 1).map_err(xerr)?;
            }
        }
        Ok(())
    };
    for l in &data.lines {
        if l.level == "pj" {
            close(ws, &mut it_start, row)?;
            close(ws, &mut pj_start, row)?;
            pj_start = Some(row);
        } else if l.level == "it" {
            close(ws, &mut it_start, row)?;
            it_start = Some(row);
        }
        let (txt, num, pct, memo) = fm(&l.level);
        ws.write_string_with_format(row, 0, &l.period, &txt).map_err(xerr)?;
        ws.write_string_with_format(row, 1, &l.name, &txt).map_err(xerr)?;
        for (i, v) in l.v.iter().enumerate().take(19) {
            let col = (i + 2) as u16;
            if i == RATE_COL {
                if l.has_rate {
                    ws.write_number_with_format(row, col, *v / 100.0, &pct).map_err(xerr)?;
                } else {
                    ws.write_blank(row, col, &pct).map_err(xerr)?;
                }
            } else {
                ws.write_number_with_format(row, col, *v / unit, &num).map_err(xerr)?;
            }
        }
        ws.write_string_with_format(row, 21, &l.memo, &memo).map_err(xerr)?;
        let lines = l.memo.lines().count().max(1) as f64;
        ws.set_row_height(row, (17.0 * lines + 6.0).max(if l.level == "pj" { 26.0 } else { 22.0 })).map_err(xerr)?;
        row += 1;
    }
    close(ws, &mut it_start, row)?;
    close(ws, &mut pj_start, row)?;
    let last = row.max(5) - 1;
    ws.set_freeze_panes(4, 2).map_err(xerr)?;
    ws.set_view_page_break_preview();
    ws.set_zoom(70);
    ws.set_paper_size(9);
    ws.set_landscape();
    ws.set_margins(MARGIN_IN, MARGIN_IN, MARGIN_IN, MARGIN_IN, 0.3, 0.3);
    ws.set_print_center_horizontally(true);
    ws.set_print_fit_to_pages(1, 0);
    ws.set_repeat_rows(0, 3).map_err(xerr)?;
    ws.set_print_area(0, 0, last, 21).map_err(xerr)?;
    wb.save(path).map_err(xerr)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Store;

    #[test]
    fn setup_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::create(dir.path(), "1234").unwrap();
        assert!(s.bstatus_list().unwrap().is_empty());
        s.bstatus_set("시도57호선 배수개선", "{\"multi\":true}").unwrap();
        s.bstatus_set("시도57호선 배수개선", "{\"multi\":false}").unwrap();
        s.bstatus_set("도로포장", "{}").unwrap();
        let l = s.bstatus_list().unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l.iter().find(|x| x.name == "시도57호선 배수개선").unwrap().setup, "{\"multi\":false}");
        assert!(s.bstatus_set("  ", "{}").is_err());
        s.bstatus_rename("도로포장", "도로포장 유지관리").unwrap();
        assert!(s.bstatus_list().unwrap().iter().any(|x| x.name == "도로포장 유지관리"));
    }

    #[test]
    fn sync_follows_rename_and_maps_row_ids() {
        use crate::BudgetRowInput;
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::create(dir.path(), "1234").unwrap();
        s.save_budget_project(2026, None, None, "시도1호선 포장", Some(1_000_000)).unwrap();
        let p = s.budget_data(2026).unwrap().remove(0);
        s.save_budget_item(p.id, None, "공사", None).unwrap();
        let item = s.budget_data(2026).unwrap().remove(0).items.remove(0);
        let input = BudgetRowInput { name: "1차 포장".into(), kind: "공사".into(), co: "".into(), cmt: 500_000, exp: 500_000, act: 0, stage: "완료".into() };
        let (_, rid) = s.save_budget_row(item.id, None, &input).unwrap();
        let ruid = s.budget_data(2026).unwrap().remove(0).items.remove(0).rows.remove(0).uid;
        // 옛 설정: uids 없음 + split이 공사 번호(숫자)
        s.bstatus_set("시도1호선 포장", &format!(r#"{{"multi":false,"split":{{"2026:{rid}":{{"국비":100000}}}}}}"#)).unwrap();
        s.bstatus_sync().unwrap();
        let l = s.bstatus_list().unwrap();
        let v: serde_json::Value = serde_json::from_str(&l[0].setup).unwrap();
        assert_eq!(v["uids"][0].as_str().unwrap(), p.uid, "옛 이름 키에 uid가 채워져요");
        assert!(v["split"].get(format!("2026:{ruid}")).is_some(), "공사 번호가 uid로 옮겨져요");
        assert!(v["split"].get(format!("2026:{rid}")).is_none());
        // 백업이 남아요
        assert!(s.get("bstatus.backup").unwrap().is_some());
        // 이름을 바꿔도 설정이 따라가요
        s.save_budget_project(2026, Some(p.id), None, "시도1호선(구간 변경) 포장", Some(1_000_000)).unwrap();
        s.bstatus_sync().unwrap();
        let l = s.bstatus_list().unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].name, "시도1호선(구간 변경) 포장");
        // 한 번 더 돌려도 그대로(멱등)
        s.bstatus_sync().unwrap();
        assert_eq!(s.bstatus_list().unwrap()[0].name, "시도1호선(구간 변경) 포장");
    }

    #[test]
    fn excel_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.xlsx");
        let line = |level: &str, period: &str, name: &str| BStatusLine { level: level.into(), period: period.into(), name: name.into(), v: vec![1_000_000_000.0; 19], has_rate: true, memo: String::new() };
        let data = BStatusExport { year: 2026, unit: 1, date: "2026-10-19".into(), lines: vec![line("pj", "2025~2027년", "시도57호선"), line("it", "2025년", ""), line("gun", "시비", ""), line("pj", "단년도", "도로포장")] };
        write_bstatus_xlsx(&path, &data).unwrap();
        let sheets = crate::budget_xlsx::read_grid(&path).unwrap();
        assert_eq!(sheets[0].name, "2026 예산현황");
        assert_eq!(sheets[0].rows[2][0], "사업기간");
        assert_eq!(sheets[0].rows[4][1], "시도57호선");
    }
}
