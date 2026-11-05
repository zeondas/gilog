//! 버그 사냥 2차(엑셀 가져오기) 고침 시험 – 공통 ✔2~✔5·✔8, docs/qa/bughunt-excel.md E-n.

use crate::excel::{read_xlsx, SheetKind};
use crate::{ComplaintImport, ComplaintInput, ContactImport, ContactInput, DayInfo, EntryInput, JournalImportRow, JournalLine, Store};

fn mem() -> Store {
    Store::memory("1234").unwrap()
}

fn cimp(received: &str, place: &str, body: &str) -> ComplaintImport {
    ComplaintImport {
        input: ComplaintInput {
            intake: "전화".into(),
            received: received.into(),
            ctype: "포트홀".into(),
            area: "조리읍".into(),
            place: place.into(),
            body: body.into(),
            ..Default::default()
        },
        memo: String::new(),
    }
}

/// E-1: 같은 날 같은 곳 전화 두 통을 내보낸 파일 그대로 덮어쓰기 – 두 민원이 각자 제 줄로 덮여요.
#[test]
fn e1_same_key_pairs_in_file_order() {
    let mut s = mem();
    s.import_complaints(&[cimp("2026-10-15", "봉일천리 113 일원", "첫 민원"), cimp("2026-10-15", "봉일천리 113 일원", "둘째 민원")], false).unwrap();
    let (u, a) = s
        .import_complaints(&[cimp("2026-10-15", "봉일천리 113 일원", "첫 민원 고침"), cimp("2026-10-15", "봉일천리 113 일원", "둘째 민원 고침")], false)
        .unwrap();
    assert_eq!((u, a), (2, 0));
    let mut all = s.complaints().unwrap();
    all.sort_by_key(|c| c.no);
    assert_eq!(all.len(), 2);
    assert!(all[0].body.contains("첫 민원 고침"), "{}", all[0].body);
    assert!(all[1].body.contains("둘째 민원 고침"), "{}", all[1].body);
}

/// E-2: 파일 안에 같은 열쇠 두 줄(둘 다 새 민원) – 방금 더한 민원을 덮지 않고 둘 다 들어가요.
#[test]
fn e2_added_rows_are_not_match_targets() {
    let mut s = mem();
    let (u, a) = s.import_complaints(&[cimp("2026-10-15", "봉일천리 1", "첫"), cimp("2026-10-15", "봉일천리 1", "둘째")], false).unwrap();
    assert_eq!((u, a), (0, 2));
    assert_eq!(s.complaints().unwrap().len(), 2);
    // 기존 하나 + 파일 셋(같은 열쇠) → 하나는 덮고 둘은 더해요.
    let (u, a) = s
        .import_complaints(&[cimp("2026-10-15", "봉일천리 1", "가"), cimp("2026-10-15", "봉일천리 1", "나"), cimp("2026-10-15", "봉일천리 1", "다")], false)
        .unwrap();
    assert_eq!((u, a), (2, 1));
    assert_eq!(s.complaints().unwrap().len(), 3);
}

/// E-22: 옛 민원(민원인·연락처 칸이 따로)은 "이름 연락처" 한 칸으로 돌아와도 나눈 그대로예요.
#[test]
fn e22_split_person_phone_kept() {
    let mut s = mem();
    let mut old = cimp("2026-10-15", "봉일천리 2", "내용");
    old.input.person = "홍길동".into();
    old.input.phone = "010-1234-5678".into();
    s.import_complaints(&[old], false).unwrap();
    let mut back = cimp("2026-10-15", "봉일천리 2", "내용");
    back.input.person = "홍길동 010-1234-5678".into();
    s.import_complaints(&[back.clone()], false).unwrap();
    let c = &s.complaints().unwrap()[0];
    assert_eq!((c.person.as_str(), c.phone.as_str()), ("홍길동", "010-1234-5678"));
    // 다른 사람이면 파일 값으로 덮어요.
    back.input.person = "김철수".into();
    s.import_complaints(&[back], false).unwrap();
    let c = &s.complaints().unwrap()[0];
    assert_eq!((c.person.as_str(), c.phone.as_str()), ("김철수", ""));
}

/// E-7: 민원대장 대체하기는 민원처리 건의 민원 잇기를 끊어요(새 민원을 가리키지 않게).
#[test]
fn e7_replace_unlinks_cases() {
    let mut s = mem();
    s.import_complaints(&[cimp("2026-10-15", "봉일천리 3", "A"), cimp("2026-10-16", "봉일천리 4", "B")], false).unwrap();
    let b = s.complaints().unwrap().into_iter().find(|c| c.body.contains('B')).unwrap().id;
    s.conn.execute("INSERT INTO cases (no, complaint) VALUES ('2026-1', ?1)", [b]).unwrap();
    s.import_complaints(&[cimp("2026-10-20", "봉일천리 5", "X"), cimp("2026-10-21", "봉일천리 6", "Y")], true).unwrap();
    let link: Option<i64> = s.conn.query_row("SELECT complaint FROM cases WHERE no = '2026-1'", [], |r| r.get(0)).unwrap();
    assert_eq!(link, None);
    // 덮어쓰기는 그대로 둬요.
    let y = s.complaints().unwrap()[0].id;
    s.conn.execute("UPDATE cases SET complaint = ?1", [y]).unwrap();
    s.import_complaints(&[cimp("2026-10-20", "봉일천리 5", "X2")], false).unwrap();
    let link: Option<i64> = s.conn.query_row("SELECT complaint FROM cases WHERE no = '2026-1'", [], |r| r.get(0)).unwrap();
    assert_eq!(link, Some(y));
}

/// E-8: 연락처 대체하기는 공사 현장대리인 잇기를 끊고, 남는 사업 잇기는 그대로 둬요.
#[test]
fn e8_replace_unlinks_work_contact() {
    let mut s = mem();
    let c = |name: &str| ContactImport { input: ContactInput { name: name.into(), projects: vec!["시도15호선".into()], ..Default::default() }, memo: String::new() };
    s.import_contacts(&[c("옛 감리")], false).unwrap();
    let data = s.contacts_data().unwrap();
    let (cid, pid) = (data.contacts[0].id, data.projects[0].id);
    s.conn.execute("INSERT INTO works (name, contact, project) VALUES ('도로정비', ?1, ?2)", [cid, pid]).unwrap();
    s.import_contacts(&[c("새 사람1"), c("새 사람2")], true).unwrap();
    let (ct, pj): (Option<i64>, Option<i64>) = s.conn.query_row("SELECT contact, project FROM works", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(ct, None);
    assert_eq!(pj, Some(pid));
}

/// E-19(✔8): 큰 민원대장 위 덮어쓰기도 줄마다 찾지 않아요 – 2만 건 위 2만 줄이 몇 초 안.
#[test]
fn e19_merge_is_fast() {
    let mut s = mem();
    let rows: Vec<ComplaintImport> = (0..20_000).map(|i| cimp("2026-10-15", &format!("봉일천리 {i}"), "내용")).collect();
    s.import_complaints(&rows, false).unwrap();
    let t = std::time::Instant::now();
    let (u, a) = s.import_complaints(&rows, false).unwrap();
    assert_eq!((u, a), (20_000, 0));
    assert!(t.elapsed().as_secs() < 20, "{:?}", t.elapsed());
}

fn entry(date: &str, time: &str, who: &str, text: &str) -> EntryInput {
    EntryInput {
        date: date.into(),
        time: time.into(),
        kind: "유선수신".into(),
        who: who.into(),
        lines: vec![JournalLine { who: who.into(), me: false, text: text.into() }],
        ..Default::default()
    }
}

fn row(e: EntryInput, same: Option<i64>, keep: bool) -> JournalImportRow {
    JournalImportRow { entry: e, same, keep }
}

/// E-5·E-24(✔3): 대체하기 중 틀린 줄이 있으면 아무것도 바뀌지 않아요(전엔 다 지워지고 앞부분만 들어감).
#[test]
fn e5_journal_import_is_one_transaction() {
    let mut s = mem();
    s.add_entry(&entry("2026-10-01", "09:00", "김주무관", "옛 기록")).unwrap();
    let mut empty = entry("2026-10-02", "10:00", "박팀장", "");
    empty.lines.clear();
    let err = s.import_journal(&[row(entry("2026-10-02", "09:00", "이", "새"), None, false), row(empty, None, false)], &[], true);
    assert!(err.is_err());
    let d = s.journal_data().unwrap();
    assert_eq!(d.entries.len(), 1);
    assert_eq!(d.entries[0].lines[0].text, "옛 기록");
    // 맞는 파일이면 지우고 넣고 날짜 머리 줄까지 한 번에.
    let day = DayInfo { date: "2026-10-02".into(), arrive: "08:40".into(), ..Default::default() };
    let r = s.import_journal(&[row(entry("2026-10-02", "09:00", "이", "새"), None, false)], &[day], true).unwrap();
    assert_eq!(r, (0, 1, 0));
    let d = s.journal_data().unwrap();
    assert_eq!(d.entries.len(), 1);
    assert_eq!(d.days.len(), 1);
}

/// E-3·E-4(✔2): 덮어쓰기 – same 번호는 덮고, keep(같은 메모 글자)은 건드리지 않아요.
#[test]
fn e3_e4_journal_merge_same_and_keep() {
    let mut s = mem();
    let a = s.add_entry(&entry("2026-10-15", "09:00", "김주무관", "원래")).unwrap().id;
    let memo = EntryInput { date: "2026-10-15".into(), time: "10:00".into(), kind: "메모".into(), body: "<p><b>굵게</b></p><table><tr><td>가</td></tr></table>".into(), ..Default::default() };
    let m = s.add_entry(&memo).unwrap().id;
    let plain = EntryInput { body: "<p>굵게</p><p>가</p>".into(), ..memo.clone() };
    let r = s
        .import_journal(
            &[row(entry("2026-10-15", "09:00", "김주무관", "고침"), Some(a), false), row(entry("2026-10-15", "09:00", "김주무관", "둘째"), None, false), row(plain, Some(m), true)],
            &[],
            false,
        )
        .unwrap();
    assert_eq!(r, (1, 1, 1));
    let d = s.journal_data().unwrap();
    assert_eq!(d.entries.len(), 3);
    assert_eq!(d.entries.iter().find(|e| e.id == a).unwrap().lines[0].text, "고침");
    assert!(d.entries.iter().find(|e| e.id == m).unwrap().body.contains("<table>"));
}

// ---------- ✔5 엑셀 읽기 ----------

/// E-12·E-14·E-23: 시간 칸은 "09:30", 날짜+시간은 날짜만, 병합 칸은 위 칸 값, 숨긴 줄은 수를 세요.
#[test]
fn e12_e14_e23_reading() {
    use rust_xlsxwriter::{ExcelDateTime, Format, Workbook};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("손으로.xlsx");
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name("업무일지").unwrap();
    let heads = ["연번", "날짜", "시각", "구분", "상대", "연락처", "사업", "내용"];
    for (c, h) in heads.iter().enumerate() {
        ws.write_string(2, c as u16, *h).unwrap();
    }
    let tf = Format::new().set_num_format("h:mm");
    let df = Format::new().set_num_format("yyyy-mm-dd hh:mm");
    ws.write_datetime_with_format(3, 1, &ExcelDateTime::parse_from_str("2026-10-15 09:30:00").unwrap(), &df).unwrap();
    ws.write_datetime_with_format(3, 2, &ExcelDateTime::from_hms(9, 30, 0).unwrap(), &tf).unwrap();
    ws.write_string(3, 7, "김: 가").unwrap();
    // 날짜 칸 두 줄 병합(4·5행)
    ws.merge_range(4, 1, 5, 1, "2026-10-16", &Format::new()).unwrap();
    ws.write_string(4, 2, "10:00").unwrap();
    ws.write_string(4, 7, "김: 나").unwrap();
    ws.write_string(5, 2, "11:00").unwrap();
    ws.write_string(5, 7, "김: 다").unwrap();
    ws.set_row_hidden(5).unwrap();
    wb.save(&path).unwrap();
    let s = read_xlsx(&path, SheetKind::Journal).unwrap();
    assert_eq!(s.rows.len(), 3);
    assert_eq!((s.rows[0][1].as_str(), s.rows[0][2].as_str()), ("2026-10-15", "09:30"));
    assert_eq!(s.rows[1][1], "2026-10-16");
    assert_eq!(s.rows[2][1], "2026-10-16");
    assert_eq!(s.hidden, 1);
    // 우리 양식으로 내보낸 파일은 숨긴 줄 0건.
    let p2 = dir.path().join("우리.xlsx");
    let data = crate::excel::ExcelExport { rows: vec![vec!["1".into(), "2026-10-19".into(), "09:10".into(), "회의".into(), "팀장".into(), "".into(), "".into(), "팀장: 가".into()]], ..Default::default() };
    crate::excel::write_xlsx(&p2, SheetKind::Journal, &data).unwrap();
    assert_eq!(read_xlsx(&p2, SheetKind::Journal).unwrap().hidden, 0);
}
