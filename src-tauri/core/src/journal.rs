//! 업무일지: 날짜마다 머리 줄(출근·교통·날씨·비고)과 기록(누가 언제 무슨 말을 했는지)을 저장해요.
//!
//! - 기록의 상대와 연락처는 적은 글자 그대로 복사해 둬요. 나중에 업무연락처를 고쳐도 지난 일지는 바뀌지 않아요.
//! - 대화 줄은 순서대로 JSON 글자 하나에 담아요. 줄마다 말한 사람 이름과 "나"인지 여부, 말이 들어가요.
//! - 프로젝트는 업무연락처의 프로젝트 번호예요. 프로젝트를 지우면 기록에서 빠져요.
//! - 구분이 "메모"인 기록은 말 줄 대신 본문(편집기 HTML) 하나를 담아요.

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::{Error, Result, Store};

/// 대화 한 줄이에요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JournalLine {
    /// 말한 사람 이름
    pub who: String,
    /// 내가 한 말인지
    pub me: bool,
    pub text: String,
}

/// 화면에서 기록을 등록하거나 고칠 때 보내는 값이에요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EntryInput {
    /// 2026-10-15
    pub date: String,
    /// 09:10
    pub time: String,
    /// 구분 (유선수신 등). 비어 있으면 "메모"예요.
    pub kind: String,
    /// 상대 (적은 글자 그대로, 여러 명은 쉼표)
    pub who: String,
    /// 연락처 (번호나 메일)
    pub contact: String,
    pub project: Option<i64>,
    pub lines: Vec<JournalLine>,
    /// 메모 본문(편집기 HTML). 메모 기록은 말 줄 대신 이것을 써요.
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub date: String,
    pub time: String,
    pub kind: String,
    pub who: String,
    pub contact: String,
    pub project: Option<i64>,
    pub lines: Vec<JournalLine>,
    pub body: String,
}

/// 날짜마다 하나 있는 머리 줄이에요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DayInfo {
    pub date: String,
    /// 출근 시각
    pub arrive: String,
    /// 교통
    pub transport: String,
    pub weather: String,
    /// 비고
    pub note: String,
}

/// 업무일지 화면이 처음에 한 번 받는 자료예요. 검색이 모든 날짜를 보기 때문에 전부 보내요.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalData {
    pub days: Vec<DayInfo>,
    /// 날짜 내림차순, 같은 날은 시간 내림차순
    pub entries: Vec<Entry>,
}

pub(crate) const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS journal_days (
        date      TEXT PRIMARY KEY,
        arrive    TEXT NOT NULL DEFAULT '',
        transport TEXT NOT NULL DEFAULT '',
        weather   TEXT NOT NULL DEFAULT '',
        note      TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS journal_entries (
        id         INTEGER PRIMARY KEY,
        date       TEXT NOT NULL,
        time       TEXT NOT NULL,
        kind       TEXT NOT NULL DEFAULT '',
        who        TEXT NOT NULL DEFAULT '',
        contact    TEXT NOT NULL DEFAULT '',
        project_id INTEGER,
        lines      TEXT NOT NULL DEFAULT '[]',
        body       TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS journal_entries_date ON journal_entries (date);
";

/// 0.5.0에서 만든 표에는 body 칸이 없어서 더해요.
pub(crate) fn upgrade(conn: &rusqlite::Connection) -> Result<()> {
    let has: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('journal_entries') WHERE name = 'body'")?
        .exists([])?;
    if !has {
        conn.execute_batch("ALTER TABLE journal_entries ADD COLUMN body TEXT NOT NULL DEFAULT '';")?;
    }
    Ok(())
}

/// HTML에서 태그를 빼고 글자가 남는지 봐요.
fn has_text(html: &str) -> bool {
    let mut in_tag = false;
    let mut text = String::new();
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => text.push(c),
            _ => {}
        }
    }
    !text.replace("&nbsp;", " ").trim().is_empty()
}

fn bad(msg: &str) -> Error {
    Error::Invalid(msg.into())
}

/// 2026-10-15 모양인지, 있는 날짜인지 봐요.
pub(crate) fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    if !b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
        return false;
    }
    let num = |r: std::ops::Range<usize>| s.get(r).and_then(|x| x.parse::<u32>().ok());
    let (Some(y), Some(m), Some(d)) = (num(0..4), num(5..7), num(8..10)) else {
        return false;
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1900..=2999).contains(&y) && (1..=days).contains(&d)
}

/// 09:10 모양인지 봐요.
fn valid_time(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 5 || b[2] != b':' || ![0, 1, 3, 4].iter().all(|&i| b[i].is_ascii_digit()) {
        return false;
    }
    let n = |i: usize| (b[i] - b'0') as u32 * 10 + (b[i + 1] - b'0') as u32;
    n(0) < 24 && n(3) < 60
}

fn clean(input: &EntryInput) -> Result<EntryInput> {
    let date = input.date.trim().to_string();
    if !valid_date(&date) {
        return Err(bad("날짜가 맞지 않아요"));
    }
    let time = input.time.trim().to_string();
    if !valid_time(&time) {
        return Err(bad("시간이 맞지 않아요"));
    }
    let lines: Vec<JournalLine> = input
        .lines
        .iter()
        .map(|l| JournalLine { who: l.who.trim().to_string(), me: l.me, text: l.text.trim().to_string() })
        .filter(|l| !l.text.is_empty())
        .collect();
    let body = if has_text(&input.body) || input.body.contains("<table") { input.body.trim().to_string() } else { String::new() };
    if lines.is_empty() && body.is_empty() {
        return Err(bad("말이 하나도 없어요"));
    }
    let kind = input.kind.trim();
    Ok(EntryInput {
        date,
        time,
        kind: if kind.is_empty() { "메모".into() } else { kind.into() },
        who: input.who.trim().to_string(),
        contact: input.contact.trim().to_string(),
        project: input.project,
        lines,
        body,
    })
}

fn read_entry(r: &Row) -> rusqlite::Result<Entry> {
    let lines: String = r.get(7)?;
    let body: String = r.get(8)?;
    Ok(Entry {
        id: r.get(0)?,
        date: r.get(1)?,
        time: r.get(2)?,
        kind: r.get(3)?,
        who: r.get(4)?,
        contact: r.get(5)?,
        project: r.get(6)?,
        lines: serde_json::from_str(&lines).unwrap_or_default(),
        body,
    })
}

const ENTRY_COLS: &str = "id, date, time, kind, who, contact, project_id, lines, body";

impl Store {
    /// 없는 프로젝트 번호는 빼요.
    fn known_project(&self, project: Option<i64>) -> Result<Option<i64>> {
        let Some(id) = project else { return Ok(None) };
        Ok(self
            .conn
            .query_row("SELECT id FROM projects WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?)
    }

    fn entry(&self, id: i64) -> Result<Entry> {
        let sql = format!("SELECT {ENTRY_COLS} FROM journal_entries WHERE id = ?1");
        self.conn
            .query_row(&sql, params![id], read_entry)
            .optional()?
            .ok_or(Error::NotFound)
    }

    /// 업무일지 자료를 모두 읽어요.
    pub fn journal_data(&self) -> Result<JournalData> {
        let mut stmt = self
            .conn
            .prepare("SELECT date, arrive, transport, weather, note FROM journal_days ORDER BY date DESC")?;
        let days = stmt
            .query_map([], |r| {
                Ok(DayInfo {
                    date: r.get(0)?,
                    arrive: r.get(1)?,
                    transport: r.get(2)?,
                    weather: r.get(3)?,
                    note: r.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let sql = format!("SELECT {ENTRY_COLS} FROM journal_entries ORDER BY date DESC, time DESC, id DESC");
        let mut stmt = self.conn.prepare(&sql)?;
        let entries = stmt.query_map([], read_entry)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(JournalData { days, entries })
    }

    /// 기록을 등록하고 저장된 모양을 돌려줘요. 말이 하나도 없으면 등록하지 않아요.
    pub fn add_entry(&self, input: &EntryInput) -> Result<Entry> {
        let e = clean(input)?;
        let project = self.known_project(e.project)?;
        let lines = serde_json::to_string(&e.lines).map_err(|x| bad(&x.to_string()))?;
        self.conn.execute(
            "INSERT INTO journal_entries (date, time, kind, who, contact, project_id, lines, body)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![e.date, e.time, e.kind, e.who, e.contact, project, lines, e.body],
        )?;
        self.entry(self.conn.last_insert_rowid())
    }

    /// 기록을 고쳐요. 고친 흔적은 남기지 않아요.
    pub fn update_entry(&self, id: i64, input: &EntryInput) -> Result<Entry> {
        let e = clean(input)?;
        let project = self.known_project(e.project)?;
        let lines = serde_json::to_string(&e.lines).map_err(|x| bad(&x.to_string()))?;
        let n = self.conn.execute(
            "UPDATE journal_entries SET date = ?2, time = ?3, kind = ?4, who = ?5, contact = ?6, project_id = ?7, lines = ?8, body = ?9
             WHERE id = ?1",
            params![id, e.date, e.time, e.kind, e.who, e.contact, project, lines, e.body],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.entry(id)
    }

    pub fn delete_entry(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM journal_entries WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// 그 날의 일지를 통째로 지워요: 기록 전부와 머리 줄(출근·교통·날씨·비고). 지운 기록 수를 돌려줘요.
    /// 날짜 목록에서 우클릭 → "이 날 일지 지우기"(사용자가 정함, 날짜만 — 월·연도 묶음 지우기는 없어요).
    pub fn delete_day(&mut self, date: &str) -> Result<usize> {
        let date = date.trim();
        if !valid_date(date) {
            return Err(bad("날짜가 맞지 않아요"));
        }
        let tx = self.conn.transaction()?;
        let n = tx.execute("DELETE FROM journal_entries WHERE date = ?1", params![date])?;
        tx.execute("DELETE FROM journal_days WHERE date = ?1", params![date])?;
        tx.commit()?;
        Ok(n)
    }

    /// 엑셀 가져오기 "대체하기"(2026-10-25 사용자 ②3안, 공통 ✔5): 모든 기록과 날짜 머리 줄을 한 번에 지워요. 지운 기록 수.
    pub fn clear_journal(&mut self) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let n = tx.execute("DELETE FROM journal_entries", [])?;
        tx.execute("DELETE FROM journal_days", [])?;
        tx.commit()?;
        Ok(n)
    }

    /// 날짜의 머리 줄을 저장해요. 모두 비우면 그 줄을 지워요.
    pub fn set_day(&self, day: &DayInfo) -> Result<DayInfo> {
        let t = |s: &str| s.trim().to_string();
        let d = DayInfo {
            date: t(&day.date),
            arrive: t(&day.arrive),
            transport: t(&day.transport),
            weather: t(&day.weather),
            note: t(&day.note),
        };
        if !valid_date(&d.date) {
            return Err(bad("날짜가 맞지 않아요"));
        }
        if d.arrive.is_empty() && d.transport.is_empty() && d.weather.is_empty() && d.note.is_empty() {
            self.conn.execute("DELETE FROM journal_days WHERE date = ?1", params![d.date])?;
        } else {
            self.conn.execute(
                "INSERT INTO journal_days (date, arrive, transport, weather, note) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(date) DO UPDATE SET arrive = excluded.arrive, transport = excluded.transport,
                     weather = excluded.weather, note = excluded.note",
                params![d.date, d.arrive, d.transport, d.weather, d.note],
            )?;
        }
        Ok(d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ContactInput;

    fn line(who: &str, me: bool, text: &str) -> JournalLine {
        JournalLine { who: who.into(), me, text: text.into() }
    }

    fn input(date: &str, time: &str) -> EntryInput {
        EntryInput {
            date: date.into(),
            time: time.into(),
            kind: "유선수신".into(),
            who: "이○○ 현장대리인 · ○○건설(주)".into(),
            contact: "010-0000-0102".into(),
            project: None,
            body: String::new(),
            lines: vec![line("이○○", false, " 교통통제 일정을 문의 "), line("전훈민", true, "10/20 회신하겠다고 답함"), line("이○○", false, "  ")],
        }
    }

    #[test]
    fn add_cleans_and_sorts_newest_first() {
        let tmp = tempfile::tempdir().unwrap();
        let s = Store::create(tmp.path(), "abcd1234").unwrap();
        let a = s.add_entry(&input("2026-10-14", "09:10")).unwrap();
        // 빈 말은 빠지고 앞뒤 빈칸은 지워요.
        assert_eq!(a.lines.len(), 2);
        assert_eq!(a.lines[0].text, "교통통제 일정을 문의");
        assert!(a.lines[1].me);
        s.add_entry(&input("2026-10-15", "08:50")).unwrap();
        s.add_entry(&input("2026-10-15", "16:40")).unwrap();
        let d = s.journal_data().unwrap();
        let order: Vec<(&str, &str)> = d.entries.iter().map(|e| (e.date.as_str(), e.time.as_str())).collect();
        assert_eq!(order, vec![("2026-10-15", "16:40"), ("2026-10-15", "08:50"), ("2026-10-14", "09:10")]);
    }

    #[test]
    fn rejects_bad_values() {
        let tmp = tempfile::tempdir().unwrap();
        let s = Store::create(tmp.path(), "abcd1234").unwrap();
        for (date, time) in [("2026-02-30", "09:10"), ("20261015", "09:10"), ("2026-10-15", "24:00"), ("2026-10-15", "9:10"), ("2026-10-15", "09:60")] {
            assert_eq!(s.add_entry(&input(date, time)).err().unwrap().code(), "invalid", "{date} {time}");
        }
        let mut no_lines = input("2026-10-15", "09:10");
        no_lines.lines = vec![line("나", true, "   ")];
        assert_eq!(s.add_entry(&no_lines).err().unwrap().code(), "invalid");
        assert!(s.journal_data().unwrap().entries.is_empty());
        // 윤년 2월 29일은 받아요.
        s.add_entry(&input("2028-02-29", "00:00")).unwrap();
    }

    #[test]
    fn empty_kind_becomes_memo_and_update_works() {
        let tmp = tempfile::tempdir().unwrap();
        let s = Store::create(tmp.path(), "abcd1234").unwrap();
        let mut i = input("2026-10-15", "10:30");
        i.kind = " ".into();
        let e = s.add_entry(&i).unwrap();
        assert_eq!(e.kind, "메모");
        i.kind = "출장".into();
        i.lines = vec![line("전훈민", true, "포트홀 4개소 현장 확인")];
        let u = s.update_entry(e.id, &i).unwrap();
        assert_eq!(u.kind, "출장");
        assert_eq!(u.lines, vec![line("전훈민", true, "포트홀 4개소 현장 확인")]);
        assert_eq!(s.update_entry(999, &i).err().unwrap().code(), "not_found");
        s.delete_entry(e.id).unwrap();
        assert!(s.journal_data().unwrap().entries.is_empty());
    }

    #[test]
    fn project_is_dropped_when_unknown_or_deleted() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let pid = s.add_project("국도32호선 정비").unwrap();
        let mut i = input("2026-10-15", "09:10");
        i.project = Some(pid);
        let e = s.add_entry(&i).unwrap();
        assert_eq!(e.project, Some(pid));
        i.project = Some(999);
        assert_eq!(s.add_entry(&i).unwrap().project, None);
        s.delete_project(pid).unwrap();
        assert_eq!(s.journal_data().unwrap().entries.iter().find(|x| x.id == e.id).unwrap().project, None);
    }

    #[test]
    fn contact_edits_do_not_change_old_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let cid = s
            .add_contact(&ContactInput { name: "이○○".into(), mobile: "010-0000-0102".into(), ..Default::default() })
            .unwrap();
        s.add_entry(&input("2026-10-15", "09:10")).unwrap();
        s.update_contact(cid, &ContactInput { name: "이○○".into(), mobile: "010-9999-9999".into(), ..Default::default() })
            .unwrap();
        assert_eq!(s.journal_data().unwrap().entries[0].contact, "010-0000-0102");
    }

    #[test]
    fn memo_keeps_body_without_lines() {
        let tmp = tempfile::tempdir().unwrap();
        let s = Store::create(tmp.path(), "abcd1234").unwrap();
        let mut i = input("2026-10-15", "11:00");
        i.kind = "메모".into();
        i.lines = vec![];
        i.body = "<p><br></p>".into();
        // 글자 없는 본문은 등록하지 않아요.
        assert_eq!(s.add_entry(&i).err().unwrap().code(), "invalid");
        i.body = "<h3>현장 메모</h3><ul><li>포트홀 4개소</li></ul><table><tbody><tr><td></td></tr></tbody></table>".into();
        let e = s.add_entry(&i).unwrap();
        assert!(e.lines.is_empty());
        assert_eq!(e.body, i.body);
        // 빈 표만 있어도 받아요.
        i.body = "<table><tbody><tr><td><br></td></tr></tbody></table>".into();
        s.update_entry(e.id, &i).unwrap();
        assert_eq!(s.journal_data().unwrap().entries[0].body, i.body);
    }

    #[test]
    fn old_table_gets_body_column() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            // 0.5.0 모양의 표로 되돌려요.
            s.conn
                .execute_batch(
                    "DROP TABLE journal_entries;
                     CREATE TABLE journal_entries (id INTEGER PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL,
                        kind TEXT NOT NULL DEFAULT '', who TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
                        project_id INTEGER, lines TEXT NOT NULL DEFAULT '[]');
                     INSERT INTO journal_entries (date, time, kind, lines) VALUES ('2026-10-15', '09:00', '메모', '[{\"who\":\"전훈민\",\"me\":true,\"text\":\"예전 기록\"}]');",
                )
                .unwrap();
        }
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        let d = s.journal_data().unwrap();
        assert_eq!(d.entries[0].lines[0].text, "예전 기록");
        assert_eq!(d.entries[0].body, "");
    }

    #[test]
    fn day_info_upserts_and_clears() {
        let tmp = tempfile::tempdir().unwrap();
        let s = Store::create(tmp.path(), "abcd1234").unwrap();
        let day = DayInfo { date: "2026-10-15".into(), arrive: "08:40".into(), transport: " 자가용 ".into(), ..Default::default() };
        assert_eq!(s.set_day(&day).unwrap().transport, "자가용");
        let day2 = DayInfo { weather: "맑음".into(), ..day.clone() };
        s.set_day(&day2).unwrap();
        let d = s.journal_data().unwrap();
        assert_eq!(d.days.len(), 1);
        assert_eq!(d.days[0].weather, "맑음");
        s.set_day(&DayInfo { date: "2026-10-15".into(), ..Default::default() }).unwrap();
        assert!(s.journal_data().unwrap().days.is_empty());
        assert_eq!(s.set_day(&DayInfo { date: "10/15".into(), ..Default::default() }).err().unwrap().code(), "invalid");
    }

    #[test]
    fn journal_survives_reopen_and_is_encrypted() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            let mut i = input("2026-10-15", "09:10");
            i.lines = vec![line("이○○", false, "JOURNAL-MARKER")];
            s.add_entry(&i).unwrap();
        }
        let bytes = std::fs::read(tmp.path().join("gilog.db")).unwrap();
        assert!(!bytes.windows(14).any(|w| w == b"JOURNAL-MARKER"));
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.journal_data().unwrap().entries[0].lines[0].text, "JOURNAL-MARKER");
    }

    #[test]
    fn delete_day_removes_entries_and_head_only_for_that_date() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let line = |t: &str| JournalLine { who: "나".into(), me: true, text: t.into() };
        let e = |date: &str, t: &str| EntryInput { date: date.into(), time: "09:00".into(), kind: "회의".into(), lines: vec![line(t)], ..Default::default() };
        s.add_entry(&e("2026-10-15", "하나")).unwrap();
        s.add_entry(&e("2026-10-15", "둘")).unwrap();
        s.add_entry(&e("2026-10-16", "다른 날")).unwrap();
        s.set_day(&DayInfo { date: "2026-10-15".into(), weather: "맑음".into(), ..Default::default() }).unwrap();
        s.set_day(&DayInfo { date: "2026-10-16".into(), weather: "비".into(), ..Default::default() }).unwrap();
        assert_eq!(s.delete_day("2026-10-15").unwrap(), 2);
        let d = s.journal_data().unwrap();
        assert_eq!(d.entries.len(), 1);
        assert_eq!(d.entries[0].date, "2026-10-16");
        assert_eq!(d.days.len(), 1);
        assert_eq!(d.days[0].date, "2026-10-16");
        assert_eq!(s.delete_day("1015").err().unwrap().code(), "invalid");
        assert_eq!(s.delete_day("2026-01-01").unwrap(), 0);
    }
}
