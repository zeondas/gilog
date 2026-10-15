//! 민원대장: 민원 한 건이 한 줄이에요.
//!
//! - 연번은 등록할 때 지금 가장 큰 연번 + 1로 붙어요. 지워도 다른 민원의 연번은 바뀌지 않아요.
//! - 내용과 조치내용은 여러 줄 글자예요. 줄마다 앞뒤 빈칸을 지우고 빈 줄은 빼요.
//! - 필수 칸은 내용 하나예요. 접수일은 날짜여야 하고, 마감일은 비어 있거나 날짜여야 해요.
//! - 메모는 업무연락처와 같은 모양(줄마다 굵게·취소선·글머리 기호)을 JSON 글자로 담아요.
//! - 접수유형·민원유형·상태는 적은 글자 그대로 둬요. 설정 목록에서 지워도 기록의 값은 남아요.

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::journal::valid_date;
use crate::{Error, Result, Store};

/// 상태가 비어 있으면 이것으로 둬요.
pub const DEFAULT_STATUS: &str = "접수";

/// 화면에서 민원을 등록하거나 고칠 때 보내는 값이에요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ComplaintInput {
    /// 접수유형 (전화, 방문 …)
    pub intake: String,
    /// 접수일 2026-10-15
    pub received: String,
    /// 민원유형
    pub ctype: String,
    /// 지역 (읍·면·동)
    pub area: String,
    /// 위치
    pub place: String,
    /// 민원인
    pub person: String,
    /// 연락처
    pub phone: String,
    /// 내용 (여러 줄)
    pub body: String,
    /// 조치내용 (여러 줄)
    pub action: String,
    /// 마감일. 비어 있으면 마감이 없어요.
    pub due: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Complaint {
    pub id: i64,
    /// 연번
    pub no: i64,
    pub intake: String,
    pub received: String,
    pub ctype: String,
    pub area: String,
    pub place: String,
    pub person: String,
    pub phone: String,
    pub body: String,
    pub action: String,
    pub due: String,
    pub status: String,
    /// 메모(JSON 글자). 비어 있으면 메모가 없어요.
    pub memo: String,
}

pub(crate) const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS complaints (
        id       INTEGER PRIMARY KEY,
        no       INTEGER NOT NULL,
        intake   TEXT NOT NULL DEFAULT '',
        received TEXT NOT NULL,
        ctype    TEXT NOT NULL DEFAULT '',
        area     TEXT NOT NULL DEFAULT '',
        place    TEXT NOT NULL DEFAULT '',
        person   TEXT NOT NULL DEFAULT '',
        phone    TEXT NOT NULL DEFAULT '',
        body     TEXT NOT NULL DEFAULT '',
        action   TEXT NOT NULL DEFAULT '',
        due      TEXT NOT NULL DEFAULT '',
        status   TEXT NOT NULL DEFAULT '',
        memo     TEXT NOT NULL DEFAULT ''
    );
";

const COLS: &str = "id, no, intake, received, ctype, area, place, person, phone, body, action, due, status, memo";

fn bad(msg: &str) -> Error {
    Error::Invalid(msg.into())
}

/// 여러 줄 글자를 정리해요. 줄마다 앞뒤 빈칸을 지우고 빈 줄은 빼요.
fn lines(s: &str) -> String {
    s.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}

fn clean(input: &ComplaintInput) -> Result<ComplaintInput> {
    let t = |s: &str| s.trim().to_string();
    let body = lines(&input.body);
    if body.is_empty() {
        return Err(bad("내용이 비어 있어요"));
    }
    let received = t(&input.received);
    if !valid_date(&received) {
        return Err(bad("접수일이 맞지 않아요"));
    }
    let due = t(&input.due);
    if !due.is_empty() && !valid_date(&due) {
        return Err(bad("마감일이 맞지 않아요"));
    }
    let status = t(&input.status);
    Ok(ComplaintInput {
        intake: t(&input.intake),
        received,
        ctype: t(&input.ctype),
        area: t(&input.area),
        place: t(&input.place),
        person: t(&input.person),
        phone: t(&input.phone),
        body,
        action: lines(&input.action),
        due,
        status: if status.is_empty() { DEFAULT_STATUS.into() } else { status },
    })
}

fn row(r: &Row) -> rusqlite::Result<Complaint> {
    Ok(Complaint {
        id: r.get(0)?,
        no: r.get(1)?,
        intake: r.get(2)?,
        received: r.get(3)?,
        ctype: r.get(4)?,
        area: r.get(5)?,
        place: r.get(6)?,
        person: r.get(7)?,
        phone: r.get(8)?,
        body: r.get(9)?,
        action: r.get(10)?,
        due: r.get(11)?,
        status: r.get(12)?,
        memo: r.get(13)?,
    })
}

impl Store {
    /// 민원을 모두 읽어요. 연번이 큰 것(최근)이 앞이에요.
    pub fn complaints(&self) -> Result<Vec<Complaint>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {COLS} FROM complaints ORDER BY no DESC, id DESC"))?;
        let v = stmt.query_map([], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    fn complaint(&self, id: i64) -> Result<Complaint> {
        self.conn
            .query_row(&format!("SELECT {COLS} FROM complaints WHERE id = ?1"), params![id], row)
            .optional()?
            .ok_or(Error::NotFound)
    }

    /// 민원을 등록하고 등록된 민원을 돌려줘요. 연번은 지금 가장 큰 연번 + 1이에요.
    pub fn add_complaint(&mut self, input: &ComplaintInput) -> Result<Complaint> {
        let c = clean(input)?;
        let tx = self.conn.transaction()?;
        let no: i64 = tx.query_row("SELECT COALESCE(MAX(no), 0) + 1 FROM complaints", [], |r| r.get(0))?;
        tx.execute(
            "INSERT INTO complaints (no, intake, received, ctype, area, place, person, phone, body, action, due, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![no, c.intake, c.received, c.ctype, c.area, c.place, c.person, c.phone, c.body, c.action, c.due, c.status],
        )?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        self.complaint(id)
    }

    /// 민원을 고쳐요. 연번과 메모는 그대로 둬요.
    pub fn update_complaint(&mut self, id: i64, input: &ComplaintInput) -> Result<Complaint> {
        let c = clean(input)?;
        let n = self.conn.execute(
            "UPDATE complaints SET intake = ?2, received = ?3, ctype = ?4, area = ?5, place = ?6, person = ?7,
                    phone = ?8, body = ?9, action = ?10, due = ?11, status = ?12
             WHERE id = ?1",
            params![id, c.intake, c.received, c.ctype, c.area, c.place, c.person, c.phone, c.body, c.action, c.due, c.status],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.complaint(id)
    }

    /// 상태만 바꿔요. 할 일 목록에서 체크할 때 써요.
    pub fn set_complaint_status(&self, id: i64, status: &str) -> Result<Complaint> {
        let status = status.trim();
        let status = if status.is_empty() { DEFAULT_STATUS } else { status };
        let n = self.conn.execute("UPDATE complaints SET status = ?2 WHERE id = ?1", params![id, status])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.complaint(id)
    }

    pub fn set_complaint_memo(&self, id: i64, memo: &str) -> Result<Complaint> {
        let n = self.conn.execute("UPDATE complaints SET memo = ?2 WHERE id = ?1", params![id, memo])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.complaint(id)
    }

    pub fn delete_complaint(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM complaints WHERE id = ?1", params![id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(body: &str) -> ComplaintInput {
        ComplaintInput {
            intake: "국민신문고".into(),
            received: "2026-10-12".into(),
            ctype: "포트홀".into(),
            area: " 조리읍 ".into(),
            place: "봉일천리 113 일원".into(),
            person: "김○○".into(),
            phone: "010-0000-0001".into(),
            body: body.into(),
            action: String::new(),
            due: "2026-10-21".into(),
            status: "처리중".into(),
        }
    }

    #[test]
    fn numbers_follow_the_largest_and_newest_is_first() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let a = s.add_complaint(&input("첫째")).unwrap();
        let b = s.add_complaint(&input("둘째")).unwrap();
        assert_eq!((a.no, b.no), (1, 2));
        // 앞뒤 빈칸은 지워요.
        assert_eq!(a.area, "조리읍");
        // 지워도 남은 연번은 그대로이고, 다음 연번은 가장 큰 것 + 1이에요.
        s.delete_complaint(a.id).unwrap();
        let c = s.add_complaint(&input("셋째")).unwrap();
        assert_eq!(c.no, 3);
        let all = s.complaints().unwrap();
        assert_eq!(all.iter().map(|x| x.no).collect::<Vec<_>>(), vec![3, 2]);
    }

    #[test]
    fn body_is_required_and_lines_are_cleaned() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.add_complaint(&input("  \n \n")).err().unwrap().code(), "invalid");
        let mut i = input("  포트홀 여러 개 \n\n 야간에 잘 안 보임 ");
        i.action = "\n 10/12 현장 확인 \n\n10/14 긴급보수\n".into();
        let c = s.add_complaint(&i).unwrap();
        assert_eq!(c.body, "포트홀 여러 개\n야간에 잘 안 보임");
        assert_eq!(c.action, "10/12 현장 확인\n10/14 긴급보수");
        assert!(s.complaints().unwrap().len() == 1);
    }

    #[test]
    fn dates_are_checked_and_status_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let mut i = input("내용");
        i.received = "2026-02-30".into();
        assert_eq!(s.add_complaint(&i).err().unwrap().code(), "invalid");
        i.received = "2026-10-12".into();
        i.due = "1016".into();
        assert_eq!(s.add_complaint(&i).err().unwrap().code(), "invalid");
        i.due = "".into();
        i.status = "  ".into();
        let c = s.add_complaint(&i).unwrap();
        assert_eq!(c.due, "");
        assert_eq!(c.status, DEFAULT_STATUS);
    }

    #[test]
    fn update_keeps_number_and_memo() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        s.add_complaint(&input("하나")).unwrap();
        let c = s.add_complaint(&input("둘")).unwrap();
        s.set_complaint_memo(c.id, r#"[{"t":"오후 통화"}]"#).unwrap();
        let mut i = input("둘 (고침)");
        i.status = "완료".into();
        i.action = "보수 완료".into();
        let u = s.update_complaint(c.id, &i).unwrap();
        assert_eq!(u.no, 2);
        assert_eq!(u.body, "둘 (고침)");
        assert_eq!(u.status, "완료");
        assert_eq!(u.memo, r#"[{"t":"오후 통화"}]"#);
        assert_eq!(s.set_complaint_status(c.id, "처리중").unwrap().status, "처리중");
        assert_eq!(s.update_complaint(999, &i).err().unwrap().code(), "not_found");
        assert_eq!(s.set_complaint_memo(999, "").err().unwrap().code(), "not_found");
        assert_eq!(s.set_complaint_status(999, "완료").err().unwrap().code(), "not_found");
        // 고치다 실패하면 그대로예요.
        assert_eq!(s.update_complaint(c.id, &input(" ")).err().unwrap().code(), "invalid");
        assert_eq!(s.complaints().unwrap()[0].body, "둘 (고침)");
    }

    #[test]
    fn complaints_survive_reopen_and_are_encrypted() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
            let mut i = input("BODY-MARKER");
            i.person = "PERSON-MARKER".into();
            i.phone = "010-9999-PHONE".into();
            s.add_complaint(&i).unwrap();
        }
        let bytes = std::fs::read(tmp.path().join("gilog.db")).unwrap();
        for needle in [&b"BODY-MARKER"[..], &b"PERSON-MARKER"[..], &b"9999-PHONE"[..]] {
            assert!(!bytes.windows(needle.len()).any(|w| w == needle));
        }
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        let all = s.complaints().unwrap();
        assert_eq!(all[0].person, "PERSON-MARKER");
        assert_eq!(all[0].no, 1);
    }
}
