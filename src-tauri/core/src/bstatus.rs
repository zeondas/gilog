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
