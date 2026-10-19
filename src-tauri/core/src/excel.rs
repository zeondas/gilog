//! 엑셀(.xlsx) 가져오기·내보내기 (2026-10-17 사용자, docs/excel/README.md 양식)
//!
//! - 내보내기: 화면이 칸 글자(머릿기호는 □ ○ - 글자와 띄어쓰기)를 만들어 보내면 양식 서식·인쇄 설정을 그대로 입혀 써요.
//! - 가져오기: 시트를 찾아 3행(열 제목 줄)을 알아보고, 그 아래 줄을 글자로 돌려줘요. 칸 이름으로 열을 찾는 것은 화면이 해요.
//! - 머릿기호·날짜 규칙은 화면 쪽(bullets.ts, journal.ts) 하나만 써요.

use std::path::Path;

use calamine::{open_workbook_auto, Data, Reader};
use rust_xlsxwriter::{
    Color, DataValidation, Format, FormatAlign, FormatBorder, FormatUnderline, Url, Workbook, Worksheet, XlsxError,
};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// 어느 시트인지
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SheetKind {
    Complaints,
    Contacts,
    /// 업무일지 — 기록 한 건 = 한 줄(2026-10-19 사용자 1안). 같은 파일 둘째 시트가 `JournalDays`예요.
    Journal,
    /// 업무일지 둘째 시트 "날짜별" — 하루 한 줄(출근·교통·날씨·비고)
    JournalDays,
}

impl SheetKind {
    pub fn title(self) -> &'static str {
        match self {
            SheetKind::Complaints => "민원대장",
            SheetKind::Contacts => "업무연락처",
            SheetKind::Journal => "업무일지",
            SheetKind::JournalDays => "날짜별",
        }
    }

    /// (제목, 폭, 왼쪽 맞춤)
    fn columns(self) -> &'static [(&'static str, f64, bool)] {
        match self {
            SheetKind::Complaints => &[
                ("연번", 6.0, false),
                ("접수유형", 11.0, false),
                ("접수일", 11.0, false),
                ("민원유형", 11.0, false),
                ("지역", 9.0, false),
                ("위치", 18.0, true),
                ("민원인", 9.0, false),
                ("연락처", 14.0, false),
                ("내용", 34.0, true),
                ("조치내용", 34.0, true),
                ("마감일", 11.0, false),
                ("상태", 11.1, false),
                ("메모", 34.0, true),
            ],
            SheetKind::Contacts => &[
                ("연번", 6.0, false),
                ("이름", 11.8, false),
                ("소속", 20.0, false),
                ("직위", 16.0, false),
                ("무선", 13.5, false),
                ("유선", 13.5, false),
                ("이메일", 23.6, false),
                ("프로젝트", 33.5, false),
                ("메모", 34.0, true),
            ],
            SheetKind::Journal => &[
                ("연번", 6.0, false),
                ("날짜", 11.0, false),
                ("시각", 7.5, false),
                ("구분", 10.0, false),
                ("상대", 22.0, false),
                ("연락처", 14.0, false),
                ("프로젝트", 20.0, false),
                ("내용", 64.0, true),
            ],
            SheetKind::JournalDays => &[
                ("날짜", 11.0, false),
                ("출근", 8.0, false),
                ("교통", 12.0, false),
                ("날씨", 12.0, false),
                ("비고", 50.0, true),
            ],
        }
    }

    /// 제목 줄을 알아볼 때 꼭 있어야 하는 칸
    fn key_headers(self) -> &'static [&'static str] {
        match self {
            SheetKind::Complaints => &["접수일", "내용"],
            SheetKind::Contacts => &["이름", "소속"],
            SheetKind::Journal => &["날짜", "내용"],
            SheetKind::JournalDays => &["날짜", "출근"],
        }
    }
}

/// 화면이 보내는 내보낼 자료
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExcelExport {
    /// 자료 줄(열 순서는 양식 그대로, 연번 칸 포함)
    pub rows: Vec<Vec<String>>,
    /// 민원대장 접수유형 목록(B열 목록 칸)
    pub intake: Vec<String>,
    /// 민원대장 상태 목록(L열 목록 칸)
    pub status: Vec<String>,
    /// 업무일지 둘째 시트 "날짜별" 줄(업무일지일 때만)
    pub days: Vec<Vec<String>>,
}

/// 가져온 시트: 3행 열 제목과 그 아래 줄(모든 칸이 빈 줄은 빼요)
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExcelSheet {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    /// 업무일지: 둘째 시트 "날짜별"(없으면 비어요)
    #[serde(default)]
    pub extra: Vec<ExcelSheet>,
}

const GRAY: u32 = 0x808080;
const FONT: &str = "맑은 고딕";
/// 1cm = 0.3937인치. 여백은 사방 1.5cm.
const MARGIN_IN: f64 = 1.5 / 2.54;

fn xerr(e: XlsxError) -> Error {
    match e {
        XlsxError::IoError(e) => Error::Io(e),
        other => Error::Invalid(other.to_string()),
    }
}

/// 내보내기: 양식(README) 그대로 써요.
pub fn write_xlsx(path: &Path, kind: SheetKind, data: &ExcelExport) -> Result<()> {
    let mut wb = Workbook::new();
    write_sheet(&mut wb, kind, &data.rows, data)?;
    // 업무일지는 같은 파일에 둘째 시트 "날짜별"을 더해요.
    if kind == SheetKind::Journal {
        write_sheet(&mut wb, SheetKind::JournalDays, &data.days, data)?;
    }
    wb.save(path).map_err(xerr)?;
    Ok(())
}

fn write_sheet(wb: &mut Workbook, kind: SheetKind, rows: &[Vec<String>], data: &ExcelExport) -> Result<()> {
    let cols = kind.columns();
    let last_col = (cols.len() - 1) as u16;
    let ws: &mut Worksheet = wb.add_worksheet();
    ws.set_name(kind.title()).map_err(xerr)?;
    ws.set_default_row_height(30);

    // 한글 글꼴은 엑셀이 쓰는 것처럼 문자 집합 129(한글)·family 1을 붙여야 그 글꼴로 보여요(2026-10-17 사용자: 제목이 헤드라인으로 안 보여요).
    let title = Format::new()
        .set_font_name("HY헤드라인M")
        .set_font_charset(129)
        .set_font_family(1)
        .set_font_size(20)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);
    let head = Format::new()
        .set_font_name(FONT)
        .set_font_charset(129)
        .set_font_family(2)
        .set_font_size(10)
        .set_bold()
        .set_font_color(Color::RGB(0x002060))
        .set_background_color(Color::RGB(0xF2F2F2))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(GRAY))
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap();
    let cell = Format::new()
        .set_font_name(FONT)
        .set_font_charset(129)
        .set_font_family(2)
        .set_font_size(10)
        .set_num_format("@")
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(GRAY))
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap();
    let center = cell.clone().set_align(FormatAlign::Center);
    let left = cell.clone().set_align(FormatAlign::Left);
    let number = center.clone().set_num_format("0_);[Red]\\(0\\)");
    let link = center.clone().set_font_size(11).set_font_color(Color::Theme(10, 0)).set_underline(FormatUnderline::Single);

    // 열 폭: README 값은 파일에 적힌 폭(엑셀이 칸 여백 5px를 더해 적은 값)이라, 엑셀 화면 폭으로 바꿔 넣어 같은 값이 적히게 해요.
    for (i, (_, w, _)) in cols.iter().enumerate() {
        ws.set_column_width(i as u16, *w - 5.0 / 7.0).map_err(xerr)?;
    }
    // 1행 제목(병합), 2행 빈 줄, 3행 열 제목
    ws.merge_range(0, 0, 0, last_col, kind.title(), &title).map_err(xerr)?;
    ws.set_row_height(0, 50).map_err(xerr)?;
    ws.set_row_height(1, 30).map_err(xerr)?;
    ws.set_row_height(2, 30).map_err(xerr)?;
    for (i, (name, _, _)) in cols.iter().enumerate() {
        ws.write_string_with_format(2, i as u16, *name, &head).map_err(xerr)?;
    }

    // 4행부터 자료
    for (r, row) in rows.iter().enumerate() {
        let rr = (r + 3) as u32;
        for (c, (name, _, is_left)) in cols.iter().enumerate() {
            let v = row.get(c).map(String::as_str).unwrap_or("");
            let cc = c as u16;
            if matches!(kind, SheetKind::Contacts | SheetKind::Journal) && *name == "연번" {
                match v.parse::<f64>() {
                    Ok(n) => ws.write_number_with_format(rr, cc, n, &number).map_err(xerr)?,
                    Err(_) => ws.write_string_with_format(rr, cc, v, &center).map_err(xerr)?,
                };
            } else if kind == SheetKind::Contacts && *name == "이메일" && v.contains('@') && !v.contains(char::is_whitespace) {
                ws.write_url_with_format(rr, cc, Url::new(format!("mailto:{v}")).set_text(v), &link).map_err(xerr)?;
            } else {
                ws.write_string_with_format(rr, cc, v, if *is_left { &left } else { &center }).map_err(xerr)?;
            }
        }
        // 1행 제목만 50, 나머지 모든 행은 30 고정(2026-10-17 사용자 — 여러 줄이어도 늘리지 않아요).
        // 업무일지만 내용 줄 수만큼 늘려요(2026-10-19 사용자 2안 — 말 줄이 여러 줄이라 잘려 보여요).
        let h = if kind == SheetKind::Journal { journal_row_height(row, cols) } else { 30.0 };
        ws.set_row_height(rr, h).map_err(xerr)?;
    }
    let last_row = (rows.len() + 2) as u32;

    // 목록 칸(민원대장 접수유형·상태) — 자료 행까지만, 안내 메시지 끔, 틀린 값도 막지 않음
    if kind == SheetKind::Complaints && !rows.is_empty() {
        for (col, list) in [(1u16, &data.intake), (11u16, &data.status)] {
            let list: Vec<&str> = list.iter().map(String::as_str).filter(|s| !s.is_empty()).collect();
            if list.is_empty() {
                continue;
            }
            if let Ok(dv) = DataValidation::new().allow_list_strings(&list) {
                let dv = dv.show_input_message(false).show_error_message(false);
                ws.add_data_validation(3, col, last_row, col, &dv).map_err(xerr)?;
            }
        }
    }

    // 보기: 틀 고정 3행 아래, 페이지 나누기 미리 보기, 100%
    ws.set_freeze_panes(3, 0).map_err(xerr)?;
    ws.set_view_page_break_preview();
    ws.set_zoom(100);
    // 인쇄: A4 가로, 여백 1.5cm, 머리글·바닥글 없음, 가로 가운데, 너비 1쪽, 제목 1~3행 반복, 인쇄 영역은 마지막 자료 행까지
    ws.set_paper_size(9);
    ws.set_landscape();
    ws.set_margins(MARGIN_IN, MARGIN_IN, MARGIN_IN, MARGIN_IN, 0.3, 0.3);
    ws.set_print_center_horizontally(true);
    ws.set_print_fit_to_pages(1, 0);
    ws.set_repeat_rows(0, 2).map_err(xerr)?;
    ws.set_print_area(0, 0, last_row, last_col).map_err(xerr)?;
    Ok(())
}

/// 칸 폭(엑셀 글자 폭 단위)에 글자가 몇 줄로 보일지 어림해요. 한글·전각은 2칸, 나머지 1칸.
fn wrapped_lines(text: &str, width: f64) -> usize {
    let per = (width - 1.0).max(4.0);
    text.split('\n')
        .map(|line| {
            let w: f64 = line.chars().map(|c| if (c as u32) >= 0x1100 { 1.9 } else { 1.0 }).sum();
            ((w / per).ceil() as usize).max(1)
        })
        .sum::<usize>()
        .max(1)
}

/// 업무일지 자료 행 높이: 가장 많이 보이는 칸의 줄 수 × 13.5pt(맑은 고딕 10) + 위아래 여백, 최소 30·최대 409(엑셀 한도).
fn journal_row_height(row: &[String], cols: &[(&str, f64, bool)]) -> f64 {
    let n = cols
        .iter()
        .enumerate()
        .map(|(i, (_, w, _))| row.get(i).map(|v| wrapped_lines(v, *w)).unwrap_or(1))
        .max()
        .unwrap_or(1);
    (n as f64 * 13.5 + 8.0).clamp(30.0, 409.0)
}

fn two(n: u8) -> String {
    format!("{n:02}")
}

/// 칸 하나를 글자로. 날짜는 2026-10-15, 정수는 소수점 없이.
pub(crate) fn text_of(d: &Data) -> String {
    match d {
        Data::Empty => String::new(),
        Data::String(s) => s.replace("\r\n", "\n").replace('\r', "\n"),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                format!("{}", *f as i64)
            } else {
                f.to_string()
            }
        }
        Data::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        Data::DateTime(dt) => {
            if dt.is_datetime() {
                let (y, m, dd, ..) = dt.to_ymd_hms_milli();
                format!("{y}-{}-{}", two(m), two(dd))
            } else {
                dt.as_f64().to_string()
            }
        }
        Data::DateTimeIso(s) => s.chars().take(10).collect(),
        Data::DurationIso(s) => s.clone(),
        Data::Error(_) => String::new(),
    }
}

/// 열 제목 비교용: 띄어쓰기·줄바꿈을 빼요.
pub fn norm_header(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// 가져오기: 시트 이름이 같은 시트(없으면 열 제목이 맞는 첫 시트)에서 열 제목 줄을 찾아 그 아래 줄을 읽어요.
/// 양식이 아니면(열 제목 줄을 못 찾으면) Invalid예요.
pub fn read_xlsx(path: &Path, kind: SheetKind) -> Result<ExcelSheet> {
    let mut wb = open_workbook_auto(path).map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
    let mut sheet = read_kind(&mut wb, kind)?;
    // 업무일지는 둘째 시트 "날짜별"도 함께 읽어요(없으면 그냥 비워요).
    if kind == SheetKind::Journal {
        if let Ok(days) = read_kind(&mut wb, SheetKind::JournalDays) {
            sheet.extra.push(days);
        }
    }
    Ok(sheet)
}

fn read_kind<RS: std::io::Read + std::io::Seek>(wb: &mut calamine::Sheets<RS>, kind: SheetKind) -> Result<ExcelSheet> {
    let mut names = wb.sheet_names();
    // 같은 이름 시트를 먼저 봐요.
    names.sort_by_key(|n| if norm_header(n) == kind.title() { 0 } else { 1 });
    for name in names {
        let Ok(range) = wb.worksheet_range(&name) else { continue };
        let rows: Vec<Vec<String>> = range.rows().map(|r| r.iter().map(text_of).collect()).collect();
        // 열 제목 줄: 처음 10줄 안에서 꼭 있어야 하는 칸이 모두 있는 줄(양식은 3행)
        let Some(hi) = rows.iter().take(10).position(|r| {
            let hs: Vec<String> = r.iter().map(|x| norm_header(x)).collect();
            kind.key_headers().iter().all(|k| hs.iter().any(|h| h == k))
        }) else {
            continue;
        };
        let headers: Vec<String> = rows[hi].iter().map(|x| norm_header(x)).collect();
        let body = rows
            .into_iter()
            .skip(hi + 1)
            .filter(|r| r.iter().any(|x| !x.trim().is_empty()))
            .collect();
        return Ok(ExcelSheet { headers, rows: body, extra: vec![] });
    }
    Err(Error::Invalid(format!("{} 양식이 아니에요", kind.title())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn complaint_row(no: &str, body: &str) -> Vec<String> {
        [no, "전화", "2026-10-15", "포트홀", "조리읍", "봉일천리 113 일원", "홍길동", "010-1234-5678", body, "□ 현장 확인\n  ○ 보수 완료", "2026-10-20", "처리중", ""]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn complaints_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("민원대장_2026-10-17.xlsx");
        let rows = vec![complaint_row("1", "○ 도로 파손\n  - 깊이 5cm\n\n○ 야간 위험"), complaint_row("2", "○ 한 줄")];
        let data = ExcelExport { rows: rows.clone(), intake: vec!["전화".into(), "방문".into()], status: vec!["접수".into(), "완료".into()], ..Default::default() };
        write_xlsx(&path, SheetKind::Complaints, &data).unwrap();
        let back = read_xlsx(&path, SheetKind::Complaints).unwrap();
        assert_eq!(back.headers[0], "연번");
        assert_eq!(back.headers[12], "메모");
        assert_eq!(back.rows.len(), 2);
        // 빈 칸은 calamine이 줄 끝에서 자를 수 있어 앞 12칸만 비교해요.
        assert_eq!(back.rows[0][..12], rows[0][..12]);
        assert_eq!(back.rows[1][8], "○ 한 줄");
    }

    #[test]
    fn contacts_roundtrip_and_empty_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.xlsx");
        let row = |n: &str, name: &str| -> Vec<String> {
            [n, name, "A시공사", "현장대리인", "010-0000-0034", "031-940-0000", "hong@example.com", "시도15호선, 실정보고", "○ 메모"]
                .iter()
                .map(|s| s.to_string())
                .collect()
        };
        let data = ExcelExport { rows: vec![row("1", "홍길동"), row("2", "김영희")], ..Default::default() };
        write_xlsx(&path, SheetKind::Contacts, &data).unwrap();
        let back = read_xlsx(&path, SheetKind::Contacts).unwrap();
        assert_eq!(back.rows.len(), 2);
        assert_eq!(back.rows[0], row("1", "홍길동"));
        assert_eq!(back.rows[1][6], "hong@example.com");
        // 민원대장 양식이 아니면 알려 줘요.
        assert!(matches!(read_xlsx(&path, SheetKind::Complaints), Err(Error::Invalid(_))));
    }

    #[test]
    fn journal_roundtrip_with_days_sheet() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("업무일지_2026-10-19.xlsx");
        let row = |n: &str, t: &str| -> Vec<String> {
            [n, "2026-10-19", t, "유선수신", "이○○", "010-0000-0102", "국도32호선 정비", "이○○: 교통통제 일정 문의\n나: 10/20 회신하겠다고 답함"]
                .iter()
                .map(|s| s.to_string())
                .collect()
        };
        let day: Vec<String> = ["2026-10-19", "08:40", "자가용", "맑음", "오후 현장"].iter().map(|s| s.to_string()).collect();
        let data = ExcelExport { rows: vec![row("1", "09:10"), row("2", "14:00")], days: vec![day.clone()], ..Default::default() };
        write_xlsx(&path, SheetKind::Journal, &data).unwrap();
        let back = read_xlsx(&path, SheetKind::Journal).unwrap();
        assert_eq!(back.headers[7], "내용");
        assert_eq!(back.rows.len(), 2);
        assert_eq!(back.rows[0], row("1", "09:10"));
        assert_eq!(back.extra.len(), 1);
        assert_eq!(back.extra[0].rows, vec![day]);
        // 업무일지 행 높이는 줄 수만큼(한 줄이면 30, 두 줄 말이어도 30, 다섯 줄이면 늘어나요).
        let cols = SheetKind::Journal.columns();
        assert_eq!(journal_row_height(&row("1", "09:10"), cols), 35.0);
        let five: Vec<String> = ["1", "2026-10-19", "09:10", "회의", "팀장", "", "", "팀장: 가\n나: 나\n팀장: 다\n나: 라\n팀장: 마"].iter().map(|s| s.to_string()).collect();
        assert_eq!(journal_row_height(&five, cols), 75.5);
        assert_eq!(journal_row_height(&["1".to_string()], cols), 30.0);
        // 둘째 시트 "날짜별"이 없어도 첫 시트는 읽혀요.
        let p2 = dir.path().join("one.xlsx");
        let mut wb = Workbook::new();
        write_sheet(&mut wb, SheetKind::Journal, &data.rows, &data).unwrap();
        wb.save(&p2).unwrap();
        let b2 = read_xlsx(&p2, SheetKind::Journal).unwrap();
        assert_eq!(b2.rows.len(), 2);
        assert!(b2.extra.is_empty());
    }

    #[test]
    fn empty_export_still_has_headers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("e.xlsx");
        write_xlsx(&path, SheetKind::Complaints, &ExcelExport::default()).unwrap();
        let back = read_xlsx(&path, SheetKind::Complaints).unwrap();
        assert!(back.rows.is_empty());
    }

    /// 화면에서 확인할 때 쓰는 보기 파일(GILOG_XLSX_OUT=폴더 일 때만 써요).
    #[test]
    fn sample_files() {
        let Ok(out) = std::env::var("GILOG_XLSX_OUT") else { return };
        let out = Path::new(&out);
        let rows: Vec<Vec<String>> = (1..=40).map(|i| complaint_row(&i.to_string(), "○ 도로 파손\n  - 깊이 5cm\n\n○ 야간 위험")).collect();
        let data = ExcelExport { rows, intake: vec!["전화".into(), "방문".into(), "국민신문고".into()], status: vec!["접수".into(), "처리중".into(), "완료".into(), "보류".into()], ..Default::default() };
        write_xlsx(&out.join("민원대장_2026-10-17.xlsx"), SheetKind::Complaints, &data).unwrap();
        let c: Vec<Vec<String>> = (1..=5)
            .map(|i| [i.to_string().as_str(), "홍길동", "A시공사", "현장대리인", "010-0000-0034", "031-940-0000", "hong@example.com", "시도15호선, 실정보고", "□ 하루 전 연락\n  ○ 정문 방문증"].iter().map(|s| s.to_string()).collect())
            .collect();
        write_xlsx(&out.join("업무연락처_2026-10-17.xlsx"), SheetKind::Contacts, &ExcelExport { rows: c, ..Default::default() }).unwrap();
        let j: Vec<Vec<String>> = [
            ["2026-10-19", "09:10", "유선수신", "이○○ 현장대리인 · ○○건설(주)", "010-0000-0102", "국도32호선 정비", "이○○: 국도32호선 교통통제 일정을 문의\n나: 10/20 경찰서 협의 후 회신하겠다고 답함\n이○○: 10/21 오전까지는 알려 달라고 함"],
            ["2026-10-19", "10:30", "출장", "조리읍 봉일천리 113 일원", "", "", "나: 포트홀 4개소 현장 확인\n나: 긴급보수(상온 아스콘) 지시"],
            ["2026-10-19", "11:00", "메모", "", "", "", "현장 확인 결과\n○ 봉일천리 113 일원 포트홀 4개소\n○ 배수구 막힘 2개소 — 긴급보수 요청"],
            ["2026-10-19", "14:00", "회의", "팀장, 서무", "", "", "팀장: 하반기 차선도색 물량을 이번 주 안에 취합하라고 지시\n나: 10/21까지 제출하겠다고 답함"],
        ]
        .iter()
        .enumerate()
        .map(|(i, r)| std::iter::once((i + 1).to_string()).chain(r.iter().map(|s| s.to_string())).collect())
        .collect();
        let days = vec![["2026-10-19", "08:40", "자가용", "맑음", ""].iter().map(|s| s.to_string()).collect()];
        write_xlsx(&out.join("업무일지_2026-10-19.xlsx"), SheetKind::Journal, &ExcelExport { rows: j, days, ..Default::default() }).unwrap();
        // 다른 프로그램(openpyxl)으로 만든 양식 모양 파일을 읽어 건수를 봐요(GILOG_XLSX_IN=파일:종류).
        if let Ok(inp) = std::env::var("GILOG_XLSX_IN") {
            for one in inp.split(';') {
                let (f, k) = one.split_once(':').unwrap();
                let kind = if k == "contacts" { SheetKind::Contacts } else { SheetKind::Complaints };
                let s = read_xlsx(Path::new(f), kind).unwrap();
                println!("READ {f} {k}: headers={:?} rows={}", s.headers, s.rows.len());
                for r in &s.rows {
                    println!("  {:?}", r);
                }
            }
        }
    }
}
