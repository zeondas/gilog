//! 민원처리(10단계): 공사(works)와 민원 건(cases).
//!
//! - 공사의 현장대리인은 업무연락처 번호(`contact`), 공사명은 같은 이름의 업무연락처 프로젝트(`project`)예요.
//!   이름·번호는 늘 업무연락처에서 읽어요(쌍방향 — 같은 사실은 한 곳에만).
//! - 민원 건은 접수번호로 하나예요. 불러오기에서 이미 있는 접수번호는 건너뛰어요.
//!   ×로 지우면 줄이 없어지니 다음 불러오기 때 다시 와요(사용자 2안).
//! - 지시부(`orders`, 2026-10-19 표준 지시부): 같은 공사 민원 여러 건을 한 지시부(연번 하나)에 묶어요. 항목 번호(`item`)는 접수일 순.
//!   진행(`stage`): made 지시부 만듦 · queued 보낼 폴더에 넣음(Claude가 올리기 전) · sent 전송 완료. 민원 건의 `stage`는 그 지시부와 같게 맞춰 둬요(지시부 전은 new).
//!   지시부에 든 건의 공사를 바꾸거나 지우면 지시부에서 빠지고, 주소·공사내용·고려사항을 고치면 지시부가 `dirty`(다시 만들어야 함)가 돼요.
//!   완료 여부는 민원대장 상태를 읽어요.
//! - 사진·지시부 파일은 자료 파일에 넣지 않고 경로만 둬요.

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::journal::valid_date;
use crate::{Error, Result, Store};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkInput {
    /// 축약 공사명(표의 공사 배지, 지시부 {축약 공사명})
    pub name: String,
    /// 정식 공사명(지시부 {공사명}). 비어 있으면 축약 공사명을 써요.
    pub full: String,
    pub co: String,
    pub contact: Option<i64>,
    pub project: Option<i64>,
    pub scope: String,
    pub next_seq: i64,
    pub tpl: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: i64,
    pub name: String,
    pub full: String,
    pub co: String,
    pub contact: Option<i64>,
    pub project: Option<i64>,
    pub scope: String,
    pub next_seq: i64,
    pub tpl: String,
}

/// 불러오기 결과 파일 한 건(받은편지함의 JSON)과 같은 칸이에요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaseInput {
    pub no: String,
    pub received: String,
    pub due: String,
    pub area: String,
    pub place: String,
    pub summary: String,
    /// 보수내용 짧은 말(파일 이름에 써요, 예: 포트홀)
    pub short: String,
    pub reason: String,
    pub work: Option<i64>,
    /// 사진 파일 경로들
    pub photos: Vec<String>,
    /// 위치도 파일 경로
    pub map: String,
    /// 사진을 옮겨 둔 민원 폴더(앱이 채워요)
    pub folder: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Case {
    pub no: String,
    pub received: String,
    pub due: String,
    pub area: String,
    pub place: String,
    pub summary: String,
    pub short: String,
    pub reason: String,
    pub work: Option<i64>,
    pub note: String,
    pub seq: String,
    pub stage: String,
    pub complaint: Option<i64>,
    pub photos: Vec<String>,
    pub map: String,
    /// 지시부를 둔 민원 폴더
    pub folder: String,
    /// 만든 지시부 파일(pptx·hwpx)과 JPG
    pub order_file: String,
    pub order_jpg: String,
    /// 보낼편지함에 넣은 JPG(Claude가 대화에 올리고 "보냄" 폴더로 옮기면 전송 완료)
    pub outbox_file: String,
    pub sent_at: String,
    /// 신문고 위치가 도로명주소라 지번으로 바꿨으면 바꾸기 전 글(판단 근거 옆 작은 글)
    pub road: String,
    /// 든 지시부 번호와 그 안의 항목 번호(1부터)
    pub order: Option<i64>,
    pub item: i64,
}

/// 지시부 하나(같은 공사 민원 여러 건)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub id: i64,
    pub work: i64,
    pub seq: i64,
    /// 지시일 YYYY-MM-DD
    pub date: String,
    /// 지시부 파일(hwpx)
    pub file: String,
    /// 쪽마다 JPG
    pub jpgs: Vec<String>,
    /// made · queued · sent
    pub stage: String,
    /// 보낼 폴더에 넣은 JPG들
    pub outbox: Vec<String>,
    pub sent_at: String,
    /// 든 민원을 고쳐 다시 만들어야 해요
    pub dirty: bool,
    /// 메일(korea.kr)로 보낸 받는 사람 주소 — 보내지 않았으면 ""(2026-10-20)
    pub mail_to: String,
    /// 메일로 보낸 때 "YYYY-MM-DD HH:MM"
    pub mailed_at: String,
    /// 보낸 메일 제목(보낸 증거 카드, 2026-10-20 진행 막대)
    pub mail_subject: String,
    /// 보낸메일함에서 같은 제목을 찾았는지 – false면 "확인 필요"(예전에 보낸 것은 true)
    pub mail_ok: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OrderPatch {
    pub file: Option<String>,
    pub jpgs: Option<Vec<String>>,
    pub stage: Option<String>,
    pub outbox: Option<Vec<String>>,
    pub sent_at: Option<String>,
    pub dirty: Option<bool>,
    pub mail_to: Option<String>,
    pub mailed_at: Option<String>,
    pub mail_subject: Option<String>,
    pub mail_ok: Option<bool>,
}

/// 줄에서 고치는 칸이에요. None은 그대로 둬요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CasePatch {
    pub work: Option<Option<i64>>,
    /// 주소(지역·위치)를 고치면 지시부 전으로 돌아가요(지시부를 다시 만들어요). 연번은 그대로예요.
    pub area: Option<String>,
    pub place: Option<String>,
    /// 공사내용(지시부 제목 줄, 간결하게)
    pub short: Option<String>,
    /// 바꾸기 전 도로명주소. 위치를 고치면서 이 값을 보내지 않으면 비워요.
    pub road: Option<String>,
    pub note: Option<String>,
    pub seq: Option<String>,
    pub stage: Option<String>,
    pub complaint: Option<Option<i64>>,
    pub folder: Option<String>,
    pub order_file: Option<String>,
    pub order_jpg: Option<String>,
    pub outbox_file: Option<String>,
    pub sent_at: Option<String>,
    /// 현장사진 순서 바꾸기(맨 앞이 지시부에 들어가는 사진 – 2026-10-21 사용자: 지시부엔 1장만).
    /// 지금 사진들과 같은 묶음이어야 해요(더하거나 빼지 않아요).
    pub photos: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessData {
    pub works: Vec<Work>,
    pub cases: Vec<Case>,
    pub orders: Vec<Order>,
}

pub(crate) const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS works (
        id       INTEGER PRIMARY KEY,
        name     TEXT NOT NULL,
        co       TEXT NOT NULL DEFAULT '',
        contact  INTEGER,
        project  INTEGER,
        scope    TEXT NOT NULL DEFAULT '',
        next_seq INTEGER NOT NULL DEFAULT 1,
        tpl      TEXT NOT NULL DEFAULT '',
        full     TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS orders (
        id       INTEGER PRIMARY KEY,
        work     INTEGER NOT NULL,
        seq      INTEGER NOT NULL,
        date     TEXT NOT NULL DEFAULT '',
        file     TEXT NOT NULL DEFAULT '',
        jpgs     TEXT NOT NULL DEFAULT '[]',
        stage    TEXT NOT NULL DEFAULT 'made',
        outbox   TEXT NOT NULL DEFAULT '[]',
        sent_at  TEXT NOT NULL DEFAULT '',
        dirty    INTEGER NOT NULL DEFAULT 0,
        mail_to   TEXT NOT NULL DEFAULT '',
        mailed_at TEXT NOT NULL DEFAULT '',
        mail_subject TEXT NOT NULL DEFAULT '',
        mail_ok   INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS cases (
        no         TEXT PRIMARY KEY,
        received   TEXT NOT NULL DEFAULT '',
        due        TEXT NOT NULL DEFAULT '',
        area       TEXT NOT NULL DEFAULT '',
        place      TEXT NOT NULL DEFAULT '',
        summary    TEXT NOT NULL DEFAULT '',
        short      TEXT NOT NULL DEFAULT '',
        reason     TEXT NOT NULL DEFAULT '',
        work       INTEGER,
        note       TEXT NOT NULL DEFAULT '',
        seq        TEXT NOT NULL DEFAULT '',
        stage      TEXT NOT NULL DEFAULT 'new',
        complaint  INTEGER,
        photos     TEXT NOT NULL DEFAULT '[]',
        map        TEXT NOT NULL DEFAULT '',
        folder     TEXT NOT NULL DEFAULT '',
        order_file TEXT NOT NULL DEFAULT '',
        order_jpg  TEXT NOT NULL DEFAULT '',
        outbox_file TEXT NOT NULL DEFAULT '',
        sent_at    TEXT NOT NULL DEFAULT '',
        added      INTEGER NOT NULL DEFAULT 0,
        road       TEXT NOT NULL DEFAULT '',
        order_id   INTEGER,
        item       INTEGER NOT NULL DEFAULT 0
    );
";

fn has_col(conn: &rusqlite::Connection, table: &str, col: &str) -> Result<bool> {
    Ok(conn.prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))?.exists(params![col])?)
}

/// 예전 자료 파일에 칸을 더해요: 도로명주소(road, 2026-10-18), 정식 공사명·지시부 묶음(2026-10-19).
/// 예전에 한 건씩 만든 지시부는 한 건짜리 지시부로 옮겨요.
pub(crate) fn upgrade(conn: &rusqlite::Connection) -> Result<()> {
    // 지시부 메일 보내기(2026-10-20): 받는 사람·보낸 때
    if has_col(conn, "orders", "id")? && !has_col(conn, "orders", "mail_to")? {
        conn.execute_batch("ALTER TABLE orders ADD COLUMN mail_to TEXT NOT NULL DEFAULT ''; ALTER TABLE orders ADD COLUMN mailed_at TEXT NOT NULL DEFAULT '';")?;
    }
    // 보낸 증거 카드(2026-10-20 진행 막대): 보낸 제목·보낸메일함 확인
    if has_col(conn, "orders", "id")? && !has_col(conn, "orders", "mail_ok")? {
        conn.execute_batch("ALTER TABLE orders ADD COLUMN mail_subject TEXT NOT NULL DEFAULT ''; ALTER TABLE orders ADD COLUMN mail_ok INTEGER NOT NULL DEFAULT 1;")?;
    }
    if !has_col(conn, "cases", "road")? {
        conn.execute_batch("ALTER TABLE cases ADD COLUMN road TEXT NOT NULL DEFAULT '';")?;
    }
    if !has_col(conn, "works", "full")? {
        conn.execute_batch("ALTER TABLE works ADD COLUMN full TEXT NOT NULL DEFAULT '';")?;
    }
    if !has_col(conn, "cases", "order_id")? {
        conn.execute_batch("ALTER TABLE cases ADD COLUMN order_id INTEGER; ALTER TABLE cases ADD COLUMN item INTEGER NOT NULL DEFAULT 0;")?;
        let old: Vec<(String, i64, String, String, String, String, String, String)> = conn
            .prepare("SELECT no, work, seq, stage, order_file, order_jpg, outbox_file, sent_at FROM cases WHERE stage != 'new' AND work IS NOT NULL")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))?
            .collect::<std::result::Result<_, _>>()?;
        for (no, work, seq, stage, file, jpg, outbox, sent) in old {
            let list = |v: &str| serde_json::to_string(&if v.is_empty() { vec![] } else { vec![v.to_string()] }).unwrap_or_else(|_| "[]".into());
            conn.execute(
                "INSERT INTO orders (work, seq, file, jpgs, stage, outbox, sent_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![work, seq.parse::<i64>().unwrap_or(0), file, list(&jpg), stage, list(&outbox), sent],
            )?;
            conn.execute("UPDATE cases SET order_id = ?2, item = 1 WHERE no = ?1", params![no, conn.last_insert_rowid()])?;
        }
    }
    Ok(())
}

/// 주소가 분명하지 않으면 적는 말(사용자 2026-10-17)
pub const UNKNOWN_PLACE: &str = "주소불명";
/// 판단 공사 "해당 없음"(2026-10-21 사용자) – 공사 번호 자리에 0을 둬요. 지시부로 묶지 않아요.
pub const NA_WORK: i64 = 0;

const WORK_COLS: &str = "id, name, co, contact, project, scope, next_seq, tpl, full";
const ORDER_COLS: &str = "id, work, seq, date, file, jpgs, stage, outbox, sent_at, dirty, mail_to, mailed_at, mail_subject, mail_ok";
const CASE_COLS: &str = "no, received, due, area, place, summary, short, reason, work, note, seq, stage, complaint, photos, map, folder, order_file, order_jpg, outbox_file, sent_at, road, order_id, item";

fn bad(msg: &str) -> Error {
    Error::Invalid(msg.into())
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn work_row(r: &Row) -> rusqlite::Result<Work> {
    Ok(Work {
        id: r.get(0)?,
        name: r.get(1)?,
        co: r.get(2)?,
        contact: r.get(3)?,
        project: r.get(4)?,
        scope: r.get(5)?,
        next_seq: r.get(6)?,
        tpl: r.get(7)?,
        full: r.get(8)?,
    })
}

fn order_row(r: &Row) -> rusqlite::Result<Order> {
    let list = |s: String| serde_json::from_str::<Vec<String>>(&s).unwrap_or_default();
    Ok(Order {
        id: r.get(0)?,
        work: r.get(1)?,
        seq: r.get(2)?,
        date: r.get(3)?,
        file: r.get(4)?,
        jpgs: list(r.get(5)?),
        stage: r.get(6)?,
        outbox: list(r.get(7)?),
        sent_at: r.get(8)?,
        dirty: r.get(9)?,
        mail_to: r.get(10)?,
        mailed_at: r.get(11)?,
        mail_subject: r.get(12)?,
        mail_ok: r.get(13)?,
    })
}

fn case_row(r: &Row) -> rusqlite::Result<Case> {
    let photos: String = r.get(13)?;
    Ok(Case {
        no: r.get(0)?,
        received: r.get(1)?,
        due: r.get(2)?,
        area: r.get(3)?,
        place: r.get(4)?,
        summary: r.get(5)?,
        short: r.get(6)?,
        reason: r.get(7)?,
        work: r.get(8)?,
        note: r.get(9)?,
        seq: r.get(10)?,
        stage: r.get(11)?,
        complaint: r.get(12)?,
        photos: serde_json::from_str(&photos).unwrap_or_default(),
        map: r.get(14)?,
        folder: r.get(15)?,
        order_file: r.get(16)?,
        order_jpg: r.get(17)?,
        outbox_file: r.get(18)?,
        sent_at: r.get(19)?,
        road: r.get(20)?,
        order: r.get(21)?,
        item: r.get(22)?,
    })
}

fn clean_work(w: &WorkInput) -> Result<WorkInput> {
    let name = one_line(&w.name);
    if name.is_empty() {
        return Err(bad("공사명이 비어 있어요"));
    }
    Ok(WorkInput {
        name,
        full: one_line(&w.full),
        co: one_line(&w.co),
        contact: w.contact,
        project: w.project,
        scope: w.scope.trim().to_string(),
        next_seq: w.next_seq.max(1),
        tpl: w.tpl.trim().to_string(),
    })
}

/// 위치는 주소(리·동 + 지번)만이에요. 비어 있으면 "주소불명".
fn clean_place(s: &str) -> String {
    let p = one_line(s);
    if p.is_empty() {
        UNKNOWN_PLACE.to_string()
    } else {
        p
    }
}

fn date_or_empty(s: &str) -> String {
    let d = s.trim();
    if valid_date(d) {
        d.to_string()
    } else {
        String::new()
    }
}

impl Store {
    pub fn process_data(&self) -> Result<ProcessData> {
        let mut s = self.conn.prepare(&format!("SELECT {WORK_COLS} FROM works ORDER BY id"))?;
        let works = s.query_map([], work_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        let mut s = self.conn.prepare(&format!("SELECT {CASE_COLS} FROM cases ORDER BY added, received DESC, no"))?;
        let cases = s.query_map([], case_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        let mut s = self.conn.prepare(&format!("SELECT {ORDER_COLS} FROM orders ORDER BY id"))?;
        let orders = s.query_map([], order_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(ProcessData { works, cases, orders })
    }

    fn works(&self) -> Result<Vec<Work>> {
        Ok(self.process_data()?.works)
    }

    /// 공사를 더하거나(id 없음) 고쳐요. 바뀐 뒤 공사 전체를 돌려줘요.
    pub fn save_work(&self, id: Option<i64>, input: &WorkInput) -> Result<Vec<Work>> {
        let w = clean_work(input)?;
        match id {
            None => {
                self.conn.execute(
                    "INSERT INTO works (name, co, contact, project, scope, next_seq, tpl, full) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![w.name, w.co, w.contact, w.project, w.scope, w.next_seq, w.tpl, w.full],
                )?;
            }
            Some(id) => {
                let n = self.conn.execute(
                    "UPDATE works SET name = ?2, co = ?3, contact = ?4, project = ?5, scope = ?6, next_seq = ?7, tpl = ?8, full = ?9 WHERE id = ?1",
                    params![id, w.name, w.co, w.contact, w.project, w.scope, w.next_seq, w.tpl, w.full],
                )?;
                if n == 0 {
                    return Err(Error::NotFound);
                }
            }
        }
        self.works()
    }

    /// 공사를 지워요. 그 공사로 판단된 민원은 "공사 고르기"로 돌아가요.
    pub fn delete_work(&mut self, id: i64) -> Result<Vec<Work>> {
        let tx = self.conn.transaction()?;
        tx.execute("UPDATE cases SET work = NULL WHERE work = ?1 AND stage = 'new'", params![id])?;
        tx.execute("DELETE FROM works WHERE id = ?1", params![id])?;
        tx.commit()?;
        self.works()
    }

    /// 지시부를 만들 때 쓸 연번이에요: 적어 둔 숫자가 있으면 그것, 없으면 공사의 다음 연번. 쓴 번호 다음으로 올려 둬요.
    pub fn take_seq(&self, work: i64, wanted: &str) -> Result<i64> {
        let next: i64 = self
            .conn
            .query_row("SELECT next_seq FROM works WHERE id = ?1", params![work], |r| r.get(0))
            .optional()?
            .ok_or(Error::NotFound)?;
        let seq = wanted.trim().parse::<i64>().ok().filter(|n| *n > 0).unwrap_or(next);
        self.conn
            .execute("UPDATE works SET next_seq = MAX(next_seq, ?2) WHERE id = ?1", params![work, seq + 1])?;
        Ok(seq)
    }

    /// 불러온 민원을 넣어요. 이미 있는 접수번호는 건너뛰고, 새로 들어간 것만 돌려줘요.
    pub fn add_cases(&mut self, list: &[CaseInput]) -> Result<Vec<Case>> {
        let tx = self.conn.transaction()?;
        let mut added = Vec::new();
        let base: i64 = tx.query_row("SELECT COALESCE(MAX(added), 0) FROM cases", [], |r| r.get(0))?;
        for (i, c) in list.iter().enumerate() {
            let no = one_line(&c.no);
            if no.is_empty() {
                continue;
            }
            let have: bool = tx.prepare("SELECT 1 FROM cases WHERE no = ?1")?.exists(params![no])?;
            if have {
                continue;
            }
            let work = match c.work {
                Some(w) if tx.prepare("SELECT 1 FROM works WHERE id = ?1")?.exists(params![w])? => Some(w),
                _ => None,
            };
            // 위치가 파주시 도로명주소면 받을 때 지번으로 바꾸고 원래 글을 남겨요(2026-10-18 사용자).
            let (area, place, road) = crate::complaints::convert(&one_line(&c.area), &one_line(&c.place), "");
            tx.execute(
                "INSERT INTO cases (no, received, due, area, place, summary, short, reason, work, photos, map, folder, added, road)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    no,
                    date_or_empty(&c.received),
                    date_or_empty(&c.due),
                    area,
                    clean_place(&place),
                    c.summary.trim(),
                    one_line(&c.short),
                    c.reason.trim(),
                    work,
                    serde_json::to_string(&c.photos).unwrap_or_else(|_| "[]".into()),
                    c.map.trim(),
                    c.folder.trim(),
                    base + 1 + i as i64,
                    road
                ],
            )?;
            added.push(no);
        }
        tx.commit()?;
        added.iter().map(|no| self.case(no)).collect()
    }

    /// 표에 이미 있는 접수번호인지
    pub fn has_case(&self, no: &str) -> Result<bool> {
        Ok(self.conn.prepare("SELECT 1 FROM cases WHERE no = ?1")?.exists(params![no.trim()])?)
    }

    pub fn work(&self, id: i64) -> Result<Work> {
        self.conn
            .query_row(&format!("SELECT {WORK_COLS} FROM works WHERE id = ?1"), params![id], work_row)
            .optional()?
            .ok_or(Error::NotFound)
    }

    pub fn case(&self, no: &str) -> Result<Case> {
        self.conn
            .query_row(&format!("SELECT {CASE_COLS} FROM cases WHERE no = ?1"), params![no], case_row)
            .optional()?
            .ok_or(Error::NotFound)
    }

    /// 줄의 칸을 고쳐요.
    /// - 공사를 바꾸면 지시부 전으로 돌아가고, 든 지시부에서 빠져요(남은 항목 번호를 다시 매기고 그 지시부는 다시 만들어야 함).
    /// - 지시부에 든 건의 주소·공사내용·고려사항을 고치면 그 지시부를 다시 만들어야 함(`dirty`)으로 둬요.
    ///   지시부에 들지 않은 건의 주소를 고치면 지시부 전으로(예전 한 건 지시부 규칙).
    pub fn update_case(&mut self, no: &str, p: &CasePatch) -> Result<Case> {
        let mut c = self.case(no)?;
        let mut leave = false;
        if let Some(w) = p.work {
            if w != c.work {
                c.work = w;
                c.stage = "new".into();
                c.seq = String::new();
                leave = c.order.is_some();
            }
        }
        let (area, place) = (p.area.as_ref().map(|v| one_line(v)), p.place.as_ref().map(|v| one_line(v)));
        let place = place.map(|v| if v.is_empty() { UNKNOWN_PLACE.to_string() } else { v });
        let moved = area.as_ref().is_some_and(|v| *v != c.area) || place.as_ref().is_some_and(|v| *v != c.place);
        if let Some(v) = area {
            c.area = v;
        }
        if let Some(v) = place {
            if v != c.place || p.road.is_some() {
                c.road = p.road.as_ref().map(|r| one_line(r)).filter(|r| *r != v).unwrap_or_default();
            }
            c.place = v;
        }
        let mut changed = moved;
        if moved && p.stage.is_none() && c.order.is_none() {
            c.stage = "new".into();
        }
        if let Some(v) = &p.note {
            // 고려사항은 머릿기호 여러 줄(2026-10-21 사용자 – 민원대장 내용 칸과 같은 JSON 줄). 예전 한 줄 글은 그대로.
            let v = if v.trim_start().starts_with('[') { crate::complaints::lines(v) } else { one_line(v) };
            changed |= v != c.note;
            c.note = v;
        }
        if let Some(v) = &p.short {
            let v = one_line(v);
            changed |= v != c.short;
            c.short = v;
        }
        if let Some(v) = &p.seq {
            c.seq = v.chars().filter(|ch| ch.is_ascii_digit()).collect();
        }
        if let Some(v) = &p.stage {
            if !["new", "made", "queued", "sent"].contains(&v.as_str()) {
                return Err(bad("진행 단계가 맞지 않아요"));
            }
            c.stage = v.clone();
        }
        if let Some(v) = p.complaint {
            c.complaint = v;
        }
        if let Some(v) = &p.folder {
            c.folder = v.clone();
        }
        if let Some(v) = &p.order_file {
            c.order_file = v.clone();
        }
        if let Some(v) = &p.order_jpg {
            c.order_jpg = v.clone();
        }
        if let Some(v) = &p.outbox_file {
            c.outbox_file = v.clone();
        }
        if let Some(v) = &p.sent_at {
            c.sent_at = v.clone();
        }
        let mut photos_sql: Option<String> = None;
        if let Some(v) = &p.photos {
            let (mut a, mut b) = (v.clone(), c.photos.clone());
            a.sort();
            b.sort();
            if a != b {
                return Err(bad("사진 묶음이 맞지 않아요"));
            }
            if *v != c.photos {
                changed = true;
                c.photos = v.clone();
                photos_sql = Some(serde_json::to_string(&c.photos).unwrap_or_else(|_| "[]".into()));
            }
        }
        let tx = self.conn.transaction()?;
        if let Some(j) = &photos_sql {
            tx.execute("UPDATE cases SET photos = ?2 WHERE no = ?1", params![no, j])?;
        }
        tx.execute(
            "UPDATE cases SET work = ?2, note = ?3, seq = ?4, stage = ?5, complaint = ?6, folder = ?7, order_file = ?8, order_jpg = ?9, outbox_file = ?10, sent_at = ?11, area = ?12, place = ?13, road = ?14, short = ?15 WHERE no = ?1",
            params![no, c.work, c.note, c.seq, c.stage, c.complaint, c.folder, c.order_file, c.order_jpg, c.outbox_file, c.sent_at, c.area, c.place, c.road, c.short],
        )?;
        if let Some(o) = c.order {
            if leave {
                leave_order(&tx, no, o)?;
            } else if changed {
                tx.execute("UPDATE orders SET dirty = 1 WHERE id = ?1", params![o])?;
            }
        }
        tx.commit()?;
        self.case(no)
    }

    /// 지시부를 만들 건이 아니면 지워요(파일은 그대로 둬요). 지시부에 들어 있었으면 거기서 빠져요.
    pub fn delete_case(&mut self, no: &str) -> Result<()> {
        let tx = self.conn.transaction()?;
        let order: Option<i64> = tx.query_row("SELECT order_id FROM cases WHERE no = ?1", params![no], |r| r.get(0)).optional()?.flatten();
        if let Some(o) = order {
            leave_order(&tx, no, o)?;
        }
        tx.execute("DELETE FROM cases WHERE no = ?1", params![no])?;
        tx.commit()?;
        Ok(())
    }

    pub fn order(&self, id: i64) -> Result<Order> {
        self.conn
            .query_row(&format!("SELECT {ORDER_COLS} FROM orders WHERE id = ?1"), params![id], order_row)
            .optional()?
            .ok_or(Error::NotFound)
    }

    /// 지시부에 든 건들(항목 순서대로)
    pub fn order_cases(&self, id: i64) -> Result<Vec<Case>> {
        let mut s = self.conn.prepare(&format!("SELECT {CASE_COLS} FROM cases WHERE order_id = ?1 ORDER BY item"))?;
        let v = s.query_map(params![id], case_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    /// 새 지시부로 묶을 건들을 살펴 항목 순서(접수일 → 접수번호)로 돌려줘요. 같은 공사, 아직 지시부에 들지 않은 건만 돼요.
    pub fn plan_order(&self, nos: &[String]) -> Result<(Work, Vec<Case>)> {
        let mut list = nos.iter().map(|n| self.case(n.trim())).collect::<Result<Vec<_>>>()?;
        list.dedup_by(|a, b| a.no == b.no);
        let first = list.first().ok_or_else(|| bad("고른 민원이 없어요"))?;
        let work = first.work.ok_or_else(|| bad("공사를 먼저 골라 주세요"))?;
        if work == NA_WORK {
            return Err(bad("해당 없음 민원은 지시부로 묶지 않아요"));
        }
        if list.iter().any(|c| c.work != Some(work)) {
            return Err(bad("같은 공사 민원만 함께 묶을 수 있어요"));
        }
        if list.iter().any(|c| c.order.is_some()) {
            return Err(bad("이미 지시부에 든 민원이 있어요"));
        }
        list.sort_by(|a, b| a.received.cmp(&b.received).then(a.no.cmp(&b.no)));
        Ok((self.work(work)?, list))
    }

    /// 지시부를 적어요: 파일을 쓴 뒤 불러요. 연번은 공사의 다음 연번으로 올라가요.
    pub fn create_order(&mut self, work: i64, seq: i64, date: &str, file: &str, nos: &[String]) -> Result<Order> {
        let tx = self.conn.transaction()?;
        tx.execute("INSERT INTO orders (work, seq, date, file) VALUES (?1, ?2, ?3, ?4)", params![work, seq, date_or_empty(date), file])?;
        let id = tx.last_insert_rowid();
        for (i, no) in nos.iter().enumerate() {
            tx.execute(
                "UPDATE cases SET order_id = ?2, item = ?3, stage = 'made', seq = ?4, order_file = ?5, order_jpg = '', outbox_file = '', sent_at = '' WHERE no = ?1",
                params![no, id, i as i64 + 1, seq.to_string(), file],
            )?;
        }
        tx.execute("UPDATE works SET next_seq = MAX(next_seq, ?2) WHERE id = ?1", params![work, seq + 1])?;
        tx.commit()?;
        self.order(id)
    }

    /// 지시부 칸을 고쳐요. 진행을 바꾸면 든 건들도 같게 맞춰요.
    pub fn update_order(&self, id: i64, p: &OrderPatch) -> Result<Order> {
        let mut o = self.order(id)?;
        if let Some(v) = &p.file {
            o.file = v.clone();
        }
        if let Some(v) = &p.jpgs {
            o.jpgs = v.clone();
        }
        if let Some(v) = &p.stage {
            if !["made", "queued", "sent"].contains(&v.as_str()) {
                return Err(bad("진행 단계가 맞지 않아요"));
            }
            o.stage = v.clone();
        }
        if let Some(v) = &p.outbox {
            o.outbox = v.clone();
        }
        if let Some(v) = &p.sent_at {
            o.sent_at = v.clone();
        }
        if let Some(v) = p.dirty {
            o.dirty = v;
        }
        if let Some(v) = &p.mail_to {
            o.mail_to = v.clone();
        }
        if let Some(v) = &p.mailed_at {
            o.mailed_at = v.clone();
        }
        if let Some(v) = &p.mail_subject {
            o.mail_subject = v.clone();
        }
        if let Some(v) = p.mail_ok {
            o.mail_ok = v;
        }
        let js = |v: &Vec<String>| serde_json::to_string(v).unwrap_or_else(|_| "[]".into());
        self.conn.execute(
            "UPDATE orders SET file = ?2, jpgs = ?3, stage = ?4, outbox = ?5, sent_at = ?6, dirty = ?7, mail_to = ?8, mailed_at = ?9, mail_subject = ?10, mail_ok = ?11 WHERE id = ?1",
            params![id, o.file, js(&o.jpgs), o.stage, js(&o.outbox), o.sent_at, o.dirty, o.mail_to, o.mailed_at, o.mail_subject, o.mail_ok],
        )?;
        self.conn.execute(
            "UPDATE cases SET stage = ?2, order_file = ?3, order_jpg = ?4, sent_at = ?5 WHERE order_id = ?1",
            params![id, o.stage, o.file, o.jpgs.first().cloned().unwrap_or_default(), o.sent_at],
        )?;
        Ok(o)
    }

    /// 든 건이 하나도 없는 지시부 기록을 지워요(파일은 그대로).
    pub fn drop_empty_orders(&self) -> Result<()> {
        self.conn.execute("DELETE FROM orders WHERE id NOT IN (SELECT order_id FROM cases WHERE order_id IS NOT NULL)", [])?;
        Ok(())
    }
}

/// 건 하나를 지시부에서 빼요: 남은 항목 번호를 다시 매기고 다시 만들어야 함으로. 남은 게 없으면 지시부 기록을 지워요.
fn leave_order(tx: &rusqlite::Transaction, no: &str, order: i64) -> Result<()> {
    tx.execute("UPDATE cases SET order_id = NULL, item = 0, stage = 'new', seq = '', order_file = '', order_jpg = '', outbox_file = '', sent_at = '' WHERE no = ?1", params![no])?;
    let rest: Vec<String> = tx
        .prepare("SELECT no FROM cases WHERE order_id = ?1 ORDER BY item")?
        .query_map(params![order], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    if rest.is_empty() {
        tx.execute("DELETE FROM orders WHERE id = ?1", params![order])?;
    } else {
        for (i, n) in rest.iter().enumerate() {
            tx.execute("UPDATE cases SET item = ?2 WHERE no = ?1", params![n, i as i64 + 1])?;
        }
        tx.execute("UPDATE orders SET dirty = 1 WHERE id = ?1", params![order])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let d = tempfile::tempdir().unwrap();
        let s = Store::create(d.path(), "1234").unwrap();
        (d, s)
    }

    #[test]
    fn inbox_road_address_is_converted() {
        let (_d, mut s) = store();
        let added = s
            .add_cases(&[CaseInput { area: "문산읍".into(), place: "경기도 파주시 문산읍 문향로 61".into(), ..input("2AA-1") }, input("2AA-2")])
            .unwrap();
        assert_eq!((added[0].area.as_str(), added[0].place.as_str(), added[0].road.as_str()), ("문산읍", "문산리 10-108", "경기도 파주시 문산읍 문향로 61"));
        assert_eq!((added[1].place.as_str(), added[1].road.as_str()), ("등원리 230-1", ""));
        // 위치를 손으로 고치면 원래 글은 지워져요. 화면이 바꾼 위치면 원래 글을 함께 보내요.
        let c = s.update_case("2AA-1", &CasePatch { place: Some("문산리 11".into()), ..Default::default() }).unwrap();
        assert_eq!(c.road, "");
        let c = s.update_case("2AA-1", &CasePatch { place: Some("봉일천리 5-31".into()), road: Some("통일로 136".into()), ..Default::default() }).unwrap();
        assert_eq!(c.road, "통일로 136");
    }

    fn input(no: &str) -> CaseInput {
        CaseInput { no: no.into(), received: "2026-10-17".into(), due: "2026-10-24".into(), place: "등원리 230-1".into(), ..Default::default() }
    }

    #[test]
    fn works_and_seq() {
        let (_d, s) = store();
        let w = s.save_work(None, &WorkInput { name: " 도로시설물  유지보수 ".into(), next_seq: 15, ..Default::default() }).unwrap();
        assert_eq!(w[0].name, "도로시설물 유지보수");
        let id = w[0].id;
        assert_eq!(s.take_seq(id, "").unwrap(), 15);
        assert_eq!(s.take_seq(id, "").unwrap(), 16);
        // 적어 둔 번호를 쓰면 그 다음으로 올라가요. 작은 번호는 다음 연번을 내리지 않아요.
        assert_eq!(s.take_seq(id, "30").unwrap(), 30);
        assert_eq!(s.take_seq(id, "3").unwrap(), 3);
        assert_eq!(s.take_seq(id, "").unwrap(), 31);
        assert!(s.save_work(None, &WorkInput::default()).is_err());
    }

    #[test]
    fn cases_skip_known_and_come_back_after_delete() {
        let (_d, mut s) = store();
        let a = s.add_cases(&[input("1AA-1"), input("1AA-2"), CaseInput { no: "1AA-3".into(), place: "  ".into(), ..Default::default() }]).unwrap();
        assert_eq!(a.len(), 3);
        assert_eq!(a[2].place, UNKNOWN_PLACE);
        assert!(s.add_cases(&[input("1AA-1")]).unwrap().is_empty());
        s.delete_case("1AA-1").unwrap();
        assert_eq!(s.add_cases(&[input("1AA-1")]).unwrap().len(), 1);
    }

    #[test]
    fn changing_work_resets_stage() {
        let (_d, mut s) = store();
        let w = s.save_work(None, &WorkInput { name: "가".into(), ..Default::default() }).unwrap();
        let w2 = s.save_work(None, &WorkInput { name: "나".into(), ..Default::default() }).unwrap();
        s.add_cases(&[CaseInput { work: Some(w[0].id), ..input("1AA-1") }]).unwrap();
        let c = s.update_case("1AA-1", &CasePatch { stage: Some("made".into()), seq: Some("7번".into()), ..Default::default() }).unwrap();
        assert_eq!((c.stage.as_str(), c.seq.as_str()), ("made", "7"));
        let c = s.update_case("1AA-1", &CasePatch { work: Some(Some(w2[1].id)), ..Default::default() }).unwrap();
        assert_eq!((c.stage.as_str(), c.seq.as_str()), ("new", ""));
        assert!(s.update_case("1AA-1", &CasePatch { stage: Some("done".into()), ..Default::default() }).is_err());
        s.delete_work(w2[1].id).unwrap();
        assert_eq!(s.case("1AA-1").unwrap().work, None);
        let c = s.update_case("1AA-1", &CasePatch { stage: Some("queued".into()), outbox_file: Some("D:/보낼편지함/a.jpg".into()), ..Default::default() }).unwrap();
        assert_eq!((c.stage.as_str(), c.outbox_file.as_str()), ("queued", "D:/보낼편지함/a.jpg"));
        // 주소를 고치면 지시부 전으로(연번은 그대로), 비우면 주소불명
        let c = s.update_case("1AA-1", &CasePatch { seq: Some("3".into()), ..Default::default() }).unwrap();
        assert_eq!(c.seq, "3");
        let c = s.update_case("1AA-1", &CasePatch { area: Some("조리읍".into()), place: Some(" 봉일천리 1 ".into()), ..Default::default() }).unwrap();
        assert_eq!((c.area.as_str(), c.place.as_str(), c.stage.as_str(), c.seq.as_str()), ("조리읍", "봉일천리 1", "new", "3"));
        let c = s.update_case("1AA-1", &CasePatch { place: Some("".into()), ..Default::default() }).unwrap();
        assert_eq!(c.place, UNKNOWN_PLACE);
        assert_eq!(s.case("1AA-1").unwrap().area, "조리읍");
    }

    #[test]
    fn reorders_photos_only_within_same_set() {
        let (_d, mut s) = store();
        s.add_cases(&[CaseInput { photos: vec!["a.jpg".into(), "b.jpg".into(), "c.jpg".into()], ..input("1AA-7") }]).unwrap();
        let c = s.update_case("1AA-7", &CasePatch { photos: Some(vec!["c.jpg".into(), "a.jpg".into(), "b.jpg".into()]), ..Default::default() }).unwrap();
        assert_eq!(c.photos, vec!["c.jpg", "a.jpg", "b.jpg"]);
        assert_eq!(s.case("1AA-7").unwrap().photos[0], "c.jpg");
        // 더하거나 빼는 것은 안 돼요
        assert!(s.update_case("1AA-7", &CasePatch { photos: Some(vec!["c.jpg".into(), "x.jpg".into(), "b.jpg".into()]), ..Default::default() }).is_err());
        assert!(s.update_case("1AA-7", &CasePatch { photos: Some(vec!["c.jpg".into()]), ..Default::default() }).is_err());
    }

    #[test]
    fn orders_group_same_work_by_received() {
        let (_d, mut s) = store();
        let w = s.save_work(None, &WorkInput { name: "동부권 1지구".into(), full: "2026년 정비 공사(1지구)".into(), next_seq: 3, ..Default::default() }).unwrap();
        let w2 = s.save_work(None, &WorkInput { name: "2지구".into(), ..Default::default() }).unwrap();
        let (a, b) = (w[0].id, w2[1].id);
        s.add_cases(&[
            CaseInput { work: Some(a), received: "2026-10-17".into(), ..input("1AA-3") },
            CaseInput { work: Some(a), received: "2026-10-15".into(), ..input("1AA-9") },
            CaseInput { work: Some(b), ..input("1AA-5") },
            CaseInput { work: Some(a), received: "2026-10-17".into(), ..input("1AA-1") },
        ])
        .unwrap();
        assert_eq!(s.work(a).unwrap().full, "2026년 정비 공사(1지구)");
        assert!(s.plan_order(&["1AA-3".into(), "1AA-5".into()]).is_err());
        let (work, list) = s.plan_order(&["1AA-3".into(), "1AA-9".into(), "1AA-1".into()]).unwrap();
        let nos: Vec<String> = list.iter().map(|c| c.no.clone()).collect();
        assert_eq!(nos, ["1AA-9", "1AA-1", "1AA-3"]);
        let o = s.create_order(work.id, work.next_seq, "2026-10-19", "D:/a.hwpx", &nos).unwrap();
        assert_eq!((o.seq, o.stage.as_str(), s.work(a).unwrap().next_seq), (3, "made", 4));
        let c = s.case("1AA-1").unwrap();
        assert_eq!((c.order, c.item, c.stage.as_str()), (Some(o.id), 2, "made"));
        assert!(s.plan_order(&["1AA-1".into()]).is_err());
        // 보내는 중 → 든 건도 함께
        s.update_order(o.id, &OrderPatch { stage: Some("queued".into()), jpgs: Some(vec!["a_1.jpg".into(), "a_2.jpg".into()]), ..Default::default() }).unwrap();
        assert_eq!(s.case("1AA-3").unwrap().stage, "queued");
        // 고려사항을 고치면 다시 만들어야 함
        s.update_case("1AA-3", &CasePatch { note: Some("야간".into()), ..Default::default() }).unwrap();
        assert!(s.order(o.id).unwrap().dirty);
        s.update_order(o.id, &OrderPatch { dirty: Some(false), ..Default::default() }).unwrap();
        // 같은 값이면 그대로
        s.update_case("1AA-3", &CasePatch { note: Some("야간".into()), ..Default::default() }).unwrap();
        assert!(!s.order(o.id).unwrap().dirty);
        // 공사를 바꾸면 빠지고 번호를 다시 매겨요
        let c = s.update_case("1AA-1", &CasePatch { work: Some(Some(b)), ..Default::default() }).unwrap();
        assert_eq!((c.order, c.item, c.stage.as_str()), (None, 0, "new"));
        assert_eq!(s.case("1AA-3").unwrap().item, 2);
        assert!(s.order(o.id).unwrap().dirty);
        // 다 빠지면 지시부 기록도 없어져요
        s.delete_case("1AA-3").unwrap();
        s.delete_case("1AA-9").unwrap();
        assert!(s.order(o.id).is_err());
        assert!(s.process_data().unwrap().orders.is_empty());
    }

    #[test]
    fn old_single_orders_move_into_orders() {
        let (_d, mut s) = store();
        let w = s.save_work(None, &WorkInput { name: "가".into(), ..Default::default() }).unwrap();
        s.add_cases(&[CaseInput { work: Some(w[0].id), ..input("1AA-1") }, input("1AA-2")]).unwrap();
        s.update_case("1AA-1", &CasePatch { stage: Some("sent".into()), seq: Some("6".into()), order_jpg: Some("D:/a.jpg".into()), sent_at: Some("10-18 09:00".into()), ..Default::default() }).unwrap();
        // 예전 자료 파일(지시부 묶음 칸 없음)
        s.conn.execute_batch("DROP TABLE orders; ALTER TABLE cases DROP COLUMN order_id; ALTER TABLE cases DROP COLUMN item;").unwrap();
        s.conn.execute_batch(SCHEMA).unwrap();
        upgrade(&s.conn).unwrap();
        let d = s.process_data().unwrap();
        assert_eq!(d.orders.len(), 1);
        let o = &d.orders[0];
        assert_eq!((o.seq, o.stage.as_str(), o.jpgs.clone(), o.sent_at.as_str()), (6, "sent", vec!["D:/a.jpg".to_string()], "10-18 09:00"));
        let c = s.case("1AA-1").unwrap();
        assert_eq!((c.order, c.item), (Some(o.id), 1));
        assert_eq!(s.case("1AA-2").unwrap().order, None);
    }
}

#[cfg(test)]
mod mail_tests {
    use super::*;

    #[test]
    fn na_work_is_kept_and_not_ordered() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::create(d.path(), "1234").unwrap();
        s.add_cases(&[CaseInput { no: "1AA-1".into(), ..Default::default() }]).unwrap();
        let c = s.update_case("1AA-1", &CasePatch { work: Some(Some(NA_WORK)), ..Default::default() }).unwrap();
        assert_eq!(c.work, Some(NA_WORK));
        assert_eq!(s.case("1AA-1").unwrap().work, Some(NA_WORK));
        assert!(s.plan_order(&["1AA-1".into()]).is_err());
    }

    #[test]
    fn order_mailed_is_saved() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::create(d.path(), "1234").unwrap();
        let w = s.save_work(None, &WorkInput { name: "유지보수".into(), ..Default::default() }).unwrap();
        let wid = w.last().unwrap().id;
        s.conn.execute("INSERT INTO orders (work, seq) VALUES (?1, 1)", params![wid]).unwrap();
        let id = s.conn.last_insert_rowid();
        assert_eq!(s.order(id).unwrap().mail_to, "");
        let o = s.update_order(id, &OrderPatch { mail_to: Some("a@b.kr".into()), mailed_at: Some("2026-10-20 12:31".into()), ..Default::default() }).unwrap();
        assert_eq!(o.mail_to, "a@b.kr");
        assert_eq!(s.order(id).unwrap().mailed_at, "2026-10-20 12:31");
        assert!(o.mail_ok);
        let o = s.update_order(id, &OrderPatch { mail_subject: Some("작업지시 07호".into()), mail_ok: Some(false), ..Default::default() }).unwrap();
        assert_eq!((o.mail_subject.as_str(), o.mail_ok), ("작업지시 07호", false));
        assert!(!s.order(id).unwrap().mail_ok);
    }
}
