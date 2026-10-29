//! 집행현황 엑셀(12단계, 2026-10-18 사용자 — 시안 목업과 대화로 보낸 견본 그대로)
//!
//! - 내보내기: 시트 한 장. 1행 제목, 2행 기준일·단위, 3행 열 제목, 4행부터 세부사업 → 부기사업 → 공사.
//!   세부사업·부기사업 줄의 합계는 SUBTOTAL·SUMPRODUCT 수식(엑셀에서 고쳐도 다시 계산돼요), 공사 줄 잔액·집행률도 수식.
//!   계산 규칙(2026-10-28 15:55 집행현황 계산 세션, 사용자 – 화면 src/budget.ts와 같음): 화면에서 고른 보기대로 써요.
//!   쓴 돈 = 집행률 보기면 집행액(F), 시공량 보기면 시공량(G) – 다른 쪽 열은 엑셀 열 숨김(지우지 않아요, 다시 가져오기 그대로).
//!   공사 줄 잔액 H = E − 쓴 돈, 공사 줄 비율 I = 쓴 돈 ÷ E, 합계 줄 잔액 = 공사 줄 잔액 합(SUBTOTAL),
//!   합계 줄 비율 = Σ쓴 돈 ÷ 예산(F/D 또는 G/D – 머리 "집행률"·"사용률"), 가용액 = 예산 − Σ(완료·타절이면 집행액, 아니면 원인행위).
//!   (0.49.0은 단계로 골랐고 – 완료 F·진행 G – 그 전엔 가용액이 완료면 max(원인행위, 집행액)였어요.)
//!   엑셀 행 묶기 2단계(세부사업만 / 부기사업까지 / 전부). 고른 단위(원·천원)로 써요 — 천원은 값을 1000으로 나눠 쓰고
//!   "#,##0" 서식이라 반올림한 정수로 보여요(계산은 나눈 값 그대로).
//! - 숨긴 M열 "줄"에 세부사업·부기사업·공사를 적어 둬요(다시 가져올 때 겹을 알아보려고 — 값만으로는 세부사업과 부기사업 합계 줄을 가릴 수 없어요).
//! - 가져오기: 시트마다 칸 글자를 그대로 돌려줘요. 어느 줄이 세부사업·부기사업·공사인지는 화면(src/budgetExcel.ts)이 판단해요.

use std::path::Path;

use calamine::{open_workbook_auto, Reader};
use rust_xlsxwriter::{Color, ConditionalFormatFormula, Format, FormatAlign, FormatBorder, Formula, Workbook, XlsxError};
use serde::{Deserialize, Serialize};

use crate::budget::{BudgetProject, BudgetRow};
use crate::excel::text_of;
use crate::{Error, Result};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BudgetExport {
    pub year: i64,
    /// 1(원) 또는 1000(천원)
    pub unit: i64,
    /// 예전(0.48.0까지) 화면이 보내던 기준 이름 — 받아도 무시해요(지금은 `view`)
    pub basis: String,
    /// 보기 "exp"(집행률, 처음 값) 또는 "act"(시공량) — 2026-10-28 15:55 사용자, 화면 위 단추
    pub view: String,
    /// 기준일 2026-10-18
    pub date: String,
    /// 메모는 화면이 글자(□ ○ - 와 띄어쓰기)로 바꿔 보내요.
    pub projects: Vec<BudgetProject>,
}

/// 가져오기용: 시트 이름과 칸 글자
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridSheet {
    pub name: String,
    pub rows: Vec<Vec<String>>,
}

const FONT: &str = "맑은 고딕";
const LINE: u32 = 0xBFBFBF;
const MARGIN_IN: f64 = 1.5 / 2.54;
const COLS: [(&str, f64); 12] = [
    ("세부사업", 46.0),
    ("구분", 7.0),
    ("업체(하도)", 15.0),
    ("예산", 15.0),
    ("원인행위", 15.0),
    ("집행액", 15.0),
    ("시공량(사용량)", 15.0),
    ("잔액", 15.0),
    ("집행률", 8.0),
    ("가용액", 15.0),
    ("단계", 7.0),
    ("메모", 36.0),
];

fn xerr(e: XlsxError) -> Error {
    match e {
        XlsxError::IoError(e) => Error::Io(e),
        other => Error::Invalid(other.to_string()),
    }
}

fn is_final(st: &str) -> bool {
    st == "완료" || st == "타절"
}

/// 공사 줄은 진행 중인 것 먼저, 완료·타절은 아래(화면과 같게)
fn sorted(rows: &[BudgetRow]) -> Vec<&BudgetRow> {
    let mut v: Vec<&BudgetRow> = rows.iter().filter(|r| !is_final(&r.stage)).collect();
    v.extend(rows.iter().filter(|r| is_final(&r.stage)));
    v
}

fn fin(k: &str) -> String {
    format!("(({k}=\"완료\")+({k}=\"타절\"))")
}

fn nfin(k: &str) -> String {
    format!("(({k}=\"준비\")+({k}=\"추진\")+({k}=\"중지\"))")
}

struct Fmts {
    base: Format,
    num: Format,
    pct: Format,
    center: Format,
    memo: Format,
}

fn fmts(size: f64, bold: bool, fill: Option<u32>, color: u32, indent: u8) -> Fmts {
    let mut base = Format::new()
        .set_font_name(FONT)
        .set_font_charset(129)
        .set_font_family(2)
        .set_font_size(size)
        .set_font_color(Color::RGB(color))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(LINE))
        .set_align(FormatAlign::VerticalCenter);
    if bold {
        base = base.set_bold();
    }
    if let Some(f) = fill {
        base = base.set_background_color(Color::RGB(f));
    }
    Fmts {
        num: base.clone().set_num_format("#,##0;[Red]-#,##0;0").set_align(FormatAlign::Right),
        pct: base.clone().set_num_format("0%").set_align(FormatAlign::Center),
        center: base.clone().set_align(FormatAlign::Center),
        memo: base.clone().set_text_wrap(),
        base: base.set_indent(indent),
    }
}

/// 내보내기
pub fn write_budget_xlsx(path: &Path, data: &BudgetExport) -> Result<()> {
    let unit = if data.unit == 1000 { 1000.0 } else { 1.0 };
    let money = |v: i64| v as f64 / unit;
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name(format!("{} 집행현황", data.year)).map_err(xerr)?;
    ws.group_symbols_above(true);
    for (i, (_, w)) in COLS.iter().enumerate() {
        ws.set_column_width(i as u16, *w).map_err(xerr)?;
    }
    ws.set_column_hidden(12).map_err(xerr)?;
    let title = Format::new()
        .set_font_name("HY헤드라인M")
        .set_font_charset(129)
        .set_font_family(1)
        .set_font_size(20)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);
    ws.merge_range(0, 0, 0, 11, &format!("{}년 집행현황", data.year), &title).map_err(xerr)?;
    ws.set_row_height(0, 50).map_err(xerr)?;
    let sub = Format::new().set_font_name(FONT).set_font_charset(129).set_font_size(10).set_font_color(Color::RGB(0x595959));
    let unit_name = if unit == 1.0 { "원" } else { "천원" };
    let act = data.view == "act";
    // 잔액·비율이 볼 열: F(집행액) 또는 G(시공량), 다른 쪽은 숨겨요
    let sc = if act { "G" } else { "F" };
    ws.write_string_with_format(1, 0, format!("기준일 {} · 단위 {unit_name} · 보기 {}", data.date, if act { "시공량" } else { "집행률" }), &sub).map_err(xerr)?;
    ws.set_row_height(1, 24).map_err(xerr)?;
    let head = Format::new()
        .set_font_name(FONT)
        .set_font_charset(129)
        .set_font_family(2)
        .set_font_size(10)
        .set_bold()
        .set_font_color(Color::RGB(0x002060))
        .set_background_color(Color::RGB(0xF2F2F2))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(LINE))
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);
    for (i, (h, _)) in COLS.iter().enumerate() {
        // 비율 열 머리: 집행률 보기 "집행률", 시공량 보기 "사용률"
        // 원인행위 열 머리: 시공량 보기는 "계약금액"(2026-10-28 21:58 사용자)
        let h = if i == 8 && act { "사용률" } else if i == 4 && act { "계약금액" } else { *h };
        ws.write_string_with_format(2, i as u16, h, &head).map_err(xerr)?;
    }
    ws.write_string(2, 12, "줄").map_err(xerr)?;
    // 보기에서 안 쓰는 열은 숨겨요(집행률 보기 = 시공량 G, 시공량 보기 = 집행액 F)
    ws.set_column_hidden(if act { 5 } else { 6 }).map_err(xerr)?;
    ws.set_row_height(2, 28).map_err(xerr)?;

    let pj = fmts(11.0, true, Some(0xE8E5F5), 0x000000, 0);
    let it = fmts(10.0, true, Some(0xF6F6F9), 0x000000, 1);
    let live = fmts(10.0, false, None, 0x000000, 2);
    let done = fmts(10.0, false, None, 0x8C8C8C, 2);
    let carry_f = Format::new().set_font_name(FONT).set_font_charset(129).set_font_size(10).set_bold().set_font_color(Color::RGB(0x595959));

    // 합계 줄(세부사업·부기사업): first..=last 줄이 그 아래 공사들(부기사업 줄이 섞여 있어도 SUBTOTAL은 다른 SUBTOTAL을 세지 않고,
    // SUMPRODUCT는 단계 칸이 준비~타절인 줄만 세요 — 합계 줄의 "4/7"은 어느 쪽에도 안 걸려요).
    let summary = |ws: &mut rust_xlsxwriter::Worksheet, row: u32, first: u32, last: u32, f: &Fmts, name: &str, budget: Option<i64>, memo: &str, level: &str| -> Result<()> {
        let r = row + 1; // 엑셀 줄 번호
        ws.write_string_with_format(row, 0, name, &f.base).map_err(xerr)?;
        ws.write_blank(row, 1, &f.center).map_err(xerr)?;
        ws.write_blank(row, 2, &f.base).map_err(xerr)?;
        match budget {
            Some(b) => ws.write_number_with_format(row, 3, money(b), &f.num).map_err(xerr)?,
            None => ws.write_blank(row, 3, &f.num).map_err(xerr)?,
        };
        if last >= first {
            let rg = |c: &str| format!("{c}{}:{c}{}", first + 1, last + 1);
            for (ci, c) in [(4u16, "E"), (5, "F"), (6, "G"), (7, "H")] {
                ws.write_formula_with_format(row, ci, Formula::new(format!("=SUBTOTAL(9,{})", rg(c))), &f.num).map_err(xerr)?;
            }
            let (k, e, ff) = (rg("K"), rg("E"), rg("F"));
            // 가용액 = 예산 − Σ(완료·타절 × 집행액) − Σ(진행 중 × 원인행위)
            // 비율 = Σ쓴 돈 ÷ 예산(집행률 보기 F, 시공량 보기 G, 단계 무관) — 같은 줄 F·G가 합계(SUBTOTAL)라 그대로 나눠요(부기사업 합계를 두 번 세지 않게)
            ws.write_formula_with_format(row, 8, Formula::new(format!("=IF(N(D{r})=0,\"\",{sc}{r}/D{r})")), &f.pct).map_err(xerr)?;
            ws.write_formula_with_format(
                row,
                9,
                Formula::new(format!(
                    "=IF(D{r}=\"\",\"\",D{r}-SUMPRODUCT({}*{ff})-SUMPRODUCT({}*{e}))",
                    fin(&k),
                    nfin(&k)
                )),
                &f.num,
            )
            .map_err(xerr)?;
            ws.write_formula_with_format(
                row,
                10,
                Formula::new(format!(
                    "=SUMPRODUCT(--({k}=\"완료\"))+SUMPRODUCT(--({k}=\"타절\"))&\"/\"&(SUMPRODUCT(--({k}=\"준비\"))+SUMPRODUCT(--({k}=\"추진\"))+SUMPRODUCT(--({k}=\"완료\"))+SUMPRODUCT(--({k}=\"중지\"))+SUMPRODUCT(--({k}=\"타절\")))"
                )),
                &f.center,
            )
            .map_err(xerr)?;
        } else {
            for c in [4u16, 5, 6, 7, 9] {
                ws.write_blank(row, c, &f.num).map_err(xerr)?;
            }
            ws.write_blank(row, 8, &f.pct).map_err(xerr)?;
            ws.write_blank(row, 10, &f.center).map_err(xerr)?;
        }
        ws.write_string_with_format(row, 11, memo, &f.memo).map_err(xerr)?;
        ws.write_string(row, 12, level).map_err(xerr)?;
        Ok(())
    };

    let mut row: u32 = 3;
    let mut carry_shown = false;
    let mut low_rows: Vec<u32> = Vec::new();
    for p in &data.projects {
        if p.carry && !carry_shown {
            carry_shown = true;
            ws.write_string_with_format(row, 0, "이월 사업", &carry_f).map_err(xerr)?;
            ws.set_row_height(row, 24).map_err(xerr)?;
            row += 1;
        }
        let pr = row;
        row += 1;
        for item in &p.items {
            let ir = row;
            row += 1;
            for g in sorted(&item.rows) {
                let f = if is_final(&g.stage) { &done } else { &live };
                let r = row + 1;
                ws.write_string_with_format(row, 0, &g.name, &f.base).map_err(xerr)?;
                ws.write_string_with_format(row, 1, &g.kind, &f.center).map_err(xerr)?;
                ws.write_string_with_format(row, 2, &g.co, &f.base).map_err(xerr)?;
                ws.write_blank(row, 3, &f.num).map_err(xerr)?;
                ws.write_number_with_format(row, 4, money(g.cmt), &f.num).map_err(xerr)?;
                ws.write_number_with_format(row, 5, money(g.exp), &f.num).map_err(xerr)?;
                ws.write_number_with_format(row, 6, money(g.act), &f.num).map_err(xerr)?;
                // 쓴 돈 = 보기대로 집행액(F) 또는 시공량(G)
                let used = format!("{sc}{r}");
                ws.write_formula_with_format(row, 7, Formula::new(format!("=E{r}-{used}")), &f.num)
                    .map_err(xerr)?;
                ws.write_formula_with_format(
                    row,
                    8,
                    Formula::new(format!("=IF(N(E{r})=0,\"\",{used}/E{r})")),
                    &f.pct,
                )
                .map_err(xerr)?;
                ws.write_blank(row, 9, &f.num).map_err(xerr)?;
                ws.write_string_with_format(row, 10, &g.stage, &f.center).map_err(xerr)?;
                ws.write_string_with_format(row, 11, &g.memo, &f.memo).map_err(xerr)?;
                ws.write_string(row, 12, "공사").map_err(xerr)?;
                let lines = g.memo.lines().count().max(1) as f64;
                ws.set_row_height(row, (17.0 * lines + 6.0).max(22.0)).map_err(xerr)?;
                row += 1;
            }
            summary(ws, ir, ir + 1, row - 1, &it, &item.name, item.budget, &item.memo, "부기사업")?;
            ws.set_row_height(ir, 22).map_err(xerr)?;
            low_rows.push(ir);
            if row - 1 > ir {
                ws.group_rows(ir + 1, row - 1).map_err(xerr)?;
            }
        }
        summary(ws, pr, pr + 1, row - 1, &pj, &p.name, p.budget, &p.memo, "세부사업")?;
        ws.set_row_height(pr, 26).map_err(xerr)?;
        if row - 1 > pr {
            ws.group_rows(pr + 1, row - 1).map_err(xerr)?;
        }
    }
    let last = row.max(4) - 1;
    let _ = low_rows;
    // 가용액이 0 아래(초과)면 붉은 굵은 글자(화면과 같게)
    let red = Format::new().set_font_color(Color::RGB(0xC00000)).set_bold();
    let cf = ConditionalFormatFormula::new().set_rule("=AND(ISNUMBER($J4),ISNUMBER($D4),$J4<0)").set_format(red);
    ws.add_conditional_format(3, 9, last, 9, &cf).map_err(xerr)?;

    ws.set_freeze_panes(3, 1).map_err(xerr)?;
    ws.set_view_page_break_preview();
    ws.set_zoom(85);
    ws.set_paper_size(9);
    ws.set_landscape();
    ws.set_margins(MARGIN_IN, MARGIN_IN, MARGIN_IN, MARGIN_IN, 0.3, 0.3);
    ws.set_print_center_horizontally(true);
    ws.set_print_fit_to_pages(1, 0);
    ws.set_repeat_rows(0, 2).map_err(xerr)?;
    ws.set_print_area(0, 0, last, 11).map_err(xerr)?;
    wb.save(path).map_err(xerr)?;
    Ok(())
}

/// 가져오기: 시트마다 칸 글자(수식 칸은 엑셀이 계산해 둔 값)
pub fn read_grid(path: &Path) -> Result<Vec<GridSheet>> {
    let mut wb = open_workbook_auto(path).map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?;
    let mut out = Vec::new();
    for name in wb.sheet_names() {
        let Ok(range) = wb.worksheet_range(&name) else { continue };
        // 시트가 A1부터 시작하지 않으면 앞을 빈 칸으로 채워 열 위치를 맞춰요.
        let (r0, c0) = range.start().map(|(r, c)| (r as usize, c as usize)).unwrap_or((0, 0));
        let mut rows: Vec<Vec<String>> = vec![Vec::new(); r0];
        for r in range.rows() {
            let mut v = vec![String::new(); c0];
            v.extend(r.iter().map(text_of));
            rows.push(v);
        }
        out.push(GridSheet { name, rows });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::budget::{BudgetItem, BudgetRow};

    fn g(id: i64, name: &str, stage: &str, cmt: i64, exp: i64, act: i64) -> BudgetRow {
        BudgetRow { id, name: name.into(), kind: "공사".into(), co: "대원".into(), cmt, exp, act, stage: stage.into(), memo: String::new(), uid: String::new() }
    }

    #[test]
    fn export_then_read_back() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("집행현황.xlsx");
        let data = BudgetExport {
            year: 2026,
            unit: 1000,
            basis: String::new(),
            view: String::new(),
            date: "2026-10-18".into(),
            projects: vec![BudgetProject {
                id: 1,
                year: 2026,
                name: "도로포장 유지관리".into(),
                budget: Some(1_724_000_000),
                carry: false,
                open: true,
                memo: String::new(),
                items: vec![BudgetItem {
                    id: 2,
                    name: "시도".into(),
                    budget: Some(685_000_000),
                    open: true,
                    memo: "□ 면적\n  ○ 4,000㎡".into(),
                    rows: vec![g(3, "상반기", "완료", 89_003_500, 104_876_000, 104_876_000), g(4, "하반기", "추진", 87_239_870, 26_034_750, 26_034_750)],
                    uid: String::new(),
                }],
                uid: String::new(),
                owner: None,
            }],
        };
        write_budget_xlsx(&path, &data).unwrap();
        let sheets = read_grid(&path).unwrap();
        assert_eq!(sheets[0].name, "2026 집행현황");
        let rows = &sheets[0].rows;
        assert_eq!(rows[2][0], "세부사업");
        assert_eq!(rows[1][0], "기준일 2026-10-18 · 단위 천원 · 보기 집행률");
        assert_eq!(rows[3][0], "도로포장 유지관리");
        assert_eq!(rows[3][3], "1724000");
        assert_eq!(rows[4][0], "시도");
        // 진행 중인 공사가 먼저
        assert_eq!(rows[5][0], "하반기");
        assert_eq!(rows[5][4], "87239.87");
        assert_eq!(rows[6][10], "완료");
        assert_eq!((rows[3][12].as_str(), rows[4][12].as_str(), rows[5][12].as_str()), ("세부사업", "부기사업", "공사"));
    }

    /// 계산 규칙(2026-10-28 15:55 집행현황 계산 세션, 사용자 ①②③④ 1안): 쓴 돈 = 집행률 보기면 집행액(F), 시공량 보기면 시공량(G).
    /// 공사 줄 잔액·비율과 합계 줄 비율이 보기대로, 가용액은 보기와 상관없이 완료 F·진행 중 E, 안 쓰는 열은 숨김.
    fn rule_sheet(basis: &str, view: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("규칙.xlsx");
        let data = BudgetExport {
            year: 2026,
            unit: 1,
            basis: basis.into(),
            view: view.into(),
            date: "2026-10-18".into(),
            projects: vec![BudgetProject {
                id: 1,
                year: 2026,
                name: "도로포장".into(),
                budget: Some(1_000_000_000),
                carry: false,
                open: true,
                memo: String::new(),
                items: vec![BudgetItem {
                    id: 2,
                    name: "시도".into(),
                    budget: Some(600_000_000),
                    open: true,
                    memo: String::new(),
                    rows: vec![g(3, "연간단가", "추진", 300_000_000, 120_000_000, 180_000_000), g(4, "완료", "완료", 100_000_000, 90_000_000, 0)],
                    uid: String::new(),
                }],
                uid: String::new(),
                owner: None,
            }],
        };
        write_budget_xlsx(&path, &data).unwrap();
        (dir, path)
    }

    fn formulas(path: &Path) -> Vec<Vec<String>> {
        let mut wb = open_workbook_auto(path).unwrap();
        let f = wb.worksheet_formula("2026 집행현황").unwrap();
        (0..8u32).map(|r| (0..12u32).map(|c| f.get_value((r, c)).cloned().unwrap_or_default().trim_start_matches('=').to_string()).collect()).collect()
    }

    /// 시트 XML에서 숨긴 열(1부터 센 번호)
    fn hidden_cols(path: &Path) -> Vec<u32> {
        let mut z = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        let mut xml = String::new();
        std::io::Read::read_to_string(&mut z.by_name("xl/worksheets/sheet1.xml").unwrap(), &mut xml).unwrap();
        let mut out = vec![];
        for part in xml.split("<col ").skip(1) {
            let tag = &part[..part.find('>').unwrap()];
            if !tag.contains("hidden=\"1\"") {
                continue;
            }
            let num = |k: &str| tag.split(&format!("{k}=\"")).nth(1).and_then(|x| x.split('"').next()).and_then(|x| x.parse::<u32>().ok());
            if let (Some(a), Some(b)) = (num("min"), num("max")) {
                out.extend(a..=b);
            }
        }
        out
    }

    /// 집행률 보기(처음 값): 공사 줄 잔액·비율 = F, 끝난 공사도 F, 시공량 G 열 숨김
    #[test]
    fn exp_view_uses_f_and_hides_g() {
        let (_d, path) = rule_sheet("", "");
        let at = formulas(&path);
        // 6행 = 진행 중 공사(연간단가), 7행 = 완료 공사 — 0부터 세면 5·6
        assert_eq!(at[5][7], "E6-F6");
        assert_eq!(at[5][8], "IF(N(E6)=0,\"\",F6/E6)");
        assert_eq!(at[6][7], "E7-F7");
        assert_eq!(at[3][8], "IF(N(D4)=0,\"\",F4/D4)");
        assert_eq!(at[4][7], "SUBTOTAL(9,H6:H7)");
        assert!(hidden_cols(&path).contains(&7), "{:?}", hidden_cols(&path));
        assert!(!hidden_cols(&path).contains(&6));
        let grid = read_grid(&path).unwrap();
        assert_eq!(grid[0].rows[1][0], "기준일 2026-10-18 · 단위 원 · 보기 집행률");
        assert_eq!(grid[0].rows[2][8], "집행률");
        assert_eq!(grid[0].rows[2][4], "원인행위");
    }

    /// 시공량 보기: 공사 줄 잔액·비율 = G(끝난 공사도), 합계 줄 비율 G/D·머리 "사용률", 집행액 F 열 숨김
    #[test]
    fn act_view_uses_g_and_hides_f() {
        let (_d, path) = rule_sheet("", "act");
        let at = formulas(&path);
        assert_eq!(at[5][7], "E6-G6");
        assert_eq!(at[5][8], "IF(N(E6)=0,\"\",G6/E6)");
        assert_eq!(at[6][7], "E7-G7");
        assert_eq!(at[3][8], "IF(N(D4)=0,\"\",G4/D4)");
        assert_eq!(at[4][8], "IF(N(D5)=0,\"\",G5/D5)");
        assert!(hidden_cols(&path).contains(&6), "{:?}", hidden_cols(&path));
        assert!(!hidden_cols(&path).contains(&7));
        let grid = read_grid(&path).unwrap();
        assert_eq!(grid[0].rows[1][0], "기준일 2026-10-18 · 단위 원 · 보기 시공량");
        assert_eq!(grid[0].rows[2][8], "사용률");
        assert_eq!(grid[0].rows[2][4], "계약금액");
    }

    /// 가용액 = 예산 − Σ(완료·타절 × 집행액) − Σ(진행 중 × 원인행위) — 보기와 상관없이 같아요(G는 안 들어가요)
    #[test]
    fn available_same_in_both_views() {
        let (_d1, p1) = rule_sheet("", "");
        let (_d2, p2) = rule_sheet("", "act");
        let (a, b) = (formulas(&p1), formulas(&p2));
        assert_eq!(
            a[4][9],
            "IF(D5=\"\",\"\",D5-SUMPRODUCT(((K6:K7=\"완료\")+(K6:K7=\"타절\"))*F6:F7)-SUMPRODUCT(((K6:K7=\"준비\")+(K6:K7=\"추진\")+(K6:K7=\"중지\"))*E6:E7))"
        );
        for r in [3usize, 4] {
            assert_eq!(a[r][9], b[r][9]);
            assert!(!a[r][9].contains('G'));
        }
    }

    /// 예전 화면이 보내던 기준 이름(basis "act")은 무시해요 — 보기는 view로만
    #[test]
    fn old_basis_is_ignored() {
        let (_d1, p1) = rule_sheet("", "");
        let (_d2, p2) = rule_sheet("act", "");
        assert_eq!(formulas(&p1), formulas(&p2));
    }

    /// 보기 파일: GILOG_BUDGET_JSON(화면이 보내는 내보내기 자료 JSON)을 GILOG_XLSX_OUT 폴더에 써요.
    #[test]
    fn sample_file() {
        let (Ok(js), Ok(out)) = (std::env::var("GILOG_BUDGET_JSON"), std::env::var("GILOG_XLSX_OUT")) else { return };
        let data: BudgetExport = serde_json::from_str(&std::fs::read_to_string(js).unwrap()).unwrap();
        let path = Path::new(&out).join(format!("집행현황_{}_{}_{}.xlsx", data.year, data.unit, data.date));
        write_budget_xlsx(&path, &data).unwrap();
        println!("WROTE {}", path.display());
    }
}
