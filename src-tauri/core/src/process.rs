//! 민원처리(10단계): 공사(works)와 민원 건(cases).
//!
//! - 공사의 현장대리인은 업무연락처 번호(`contact`), 공사명은 같은 이름의 업무연락처 프로젝트(`project`)예요.
//!   이름·번호는 늘 업무연락처에서 읽어요(쌍방향 — 같은 사실은 한 곳에만).
//! - 민원 건은 접수번호로 하나예요. 불러오기에서 이미 있는 접수번호는 건너뛰어요.
//!   ×로 지우면 줄이 없어지니 다음 불러오기 때 다시 와요(사용자 2안).
//! - 진행(`stage`): new 지시부 전 · made 지시부 만듦 · queued 보낼편지함에 넣음(Claude가 올리기 전) · sent 전송 완료. 완료 여부는 민원대장 상태를 읽어요.
//! - 사진·지시부 파일은 자료 파일에 넣지 않고 경로만 둬요.

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::journal::valid_date;
use crate::{Error, Result, Store};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkInput {
    pub name: String,
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
}

/// 줄에서 고치는 칸이에요. None은 그대로 둬요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CasePatch {
    pub work: Option<Option<i64>>,
    pub note: Option<String>,
    pub seq: Option<String>,
    pub stage: Option<String>,
    pub complaint: Option<Option<i64>>,
    pub folder: Option<String>,
    pub order_file: Option<String>,
    pub order_jpg: Option<String>,
    pub outbox_file: Option<String>,
    pub sent_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessData {
    pub works: Vec<Work>,
    pub cases: Vec<Case>,
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
        tpl      TEXT NOT NULL DEFAULT ''
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
        added      INTEGER NOT NULL DEFAULT 0
    );
";

/// 주소가 분명하지 않으면 적는 말(사용자 2026-10-17)
pub const UNKNOWN_PLACE: &str = "주소불명";

const WORK_COLS: &str = "id, name, co, contact, project, scope, next_seq, tpl";
const CASE_COLS: &str = "no, received, due, area, place, summary, short, reason, work, note, seq, stage, complaint, photos, map, folder, order_file, order_jpg, outbox_file, sent_at";

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
    })
}

fn clean_work(w: &WorkInput) -> Result<WorkInput> {
    let name = one_line(&w.name);
    if name.is_empty() {
        return Err(bad("공사명이 비어 있어요"));
    }
    Ok(WorkInput {
        name,
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
        Ok(ProcessData { works, cases })
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
                    "INSERT INTO works (name, co, contact, project, scope, next_seq, tpl) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![w.name, w.co, w.contact, w.project, w.scope, w.next_seq, w.tpl],
                )?;
            }
            Some(id) => {
                let n = self.conn.execute(
                    "UPDATE works SET name = ?2, co = ?3, contact = ?4, project = ?5, scope = ?6, next_seq = ?7, tpl = ?8 WHERE id = ?1",
                    params![id, w.name, w.co, w.contact, w.project, w.scope, w.next_seq, w.tpl],
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
            tx.execute(
                "INSERT INTO cases (no, received, due, area, place, summary, short, reason, work, photos, map, folder, added)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    no,
                    date_or_empty(&c.received),
                    date_or_empty(&c.due),
                    one_line(&c.area),
                    clean_place(&c.place),
                    c.summary.trim(),
                    one_line(&c.short),
                    c.reason.trim(),
                    work,
                    serde_json::to_string(&c.photos).unwrap_or_else(|_| "[]".into()),
                    c.map.trim(),
                    c.folder.trim(),
                    base + 1 + i as i64
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

    /// 줄의 칸을 고쳐요. 공사를 바꾸면 지시부 전으로 돌아가요(지시부를 다시 만들어요).
    pub fn update_case(&self, no: &str, p: &CasePatch) -> Result<Case> {
        let mut c = self.case(no)?;
        if let Some(w) = p.work {
            if w != c.work {
                c.work = w;
                c.stage = "new".into();
                c.seq = String::new();
            }
        }
        if let Some(v) = &p.note {
            c.note = one_line(v);
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
        self.conn.execute(
            "UPDATE cases SET work = ?2, note = ?3, seq = ?4, stage = ?5, complaint = ?6, folder = ?7, order_file = ?8, order_jpg = ?9, outbox_file = ?10, sent_at = ?11 WHERE no = ?1",
            params![no, c.work, c.note, c.seq, c.stage, c.complaint, c.folder, c.order_file, c.order_jpg, c.outbox_file, c.sent_at],
        )?;
        self.case(no)
    }

    /// 지시부를 만들 건이 아니면 지워요(파일은 그대로 둬요).
    pub fn delete_case(&self, no: &str) -> Result<()> {
        self.conn.execute("DELETE FROM cases WHERE no = ?1", params![no])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Store) {
        let d = tempfile::tempdir().unwrap();
        let s = Store::create(d.path(), "1234").unwrap();
        (d, s)
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
    }
}
