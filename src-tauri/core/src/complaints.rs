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
    /// 조치완료일(2026-10-19 사용자). 비어 있으면 아직이에요. 완료·불가가 되면 화면이 오늘 날짜를 넣고, 고칠 수 있어요.
    pub done: String,
    /// 위치를 도로명주소에서 바꿨으면 바꾸기 전 글(마우스를 올리면 보여요). 직접 친 위치면 비어 있어요.
    pub road: String,
}

/// 엑셀에서 가져온 한 줄이에요. 앱이 판단하지 않고 그대로 넣어요(2026-10-17 사용자 — 비어 있어도, 날짜가 아니어도).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ComplaintImport {
    #[serde(flatten)]
    pub input: ComplaintInput,
    /// 메모(JSON 글자)
    pub memo: String,
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
    /// 조치완료일
    pub done: String,
    /// 메모(JSON 글자). 비어 있으면 메모가 없어요.
    pub memo: String,
    /// 바꾸기 전 도로명주소(위치를 바꾼 민원만)
    pub road: String,
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
        memo     TEXT NOT NULL DEFAULT '',
        road     TEXT NOT NULL DEFAULT ''
    );
";

/// 예전 자료 파일에 도로명주소 칸(road)을 더해요(2026-10-18 주소 변환).
pub(crate) fn upgrade(conn: &rusqlite::Connection) -> Result<()> {
    let has: bool = conn.prepare("SELECT 1 FROM pragma_table_info('complaints') WHERE name = 'road'")?.exists([])?;
    if !has {
        conn.execute_batch("ALTER TABLE complaints ADD COLUMN road TEXT NOT NULL DEFAULT '';")?;
    }
    // 조치완료일 칸(2026-10-19)
    let has: bool = conn.prepare("SELECT 1 FROM pragma_table_info('complaints') WHERE name = 'done'")?.exists([])?;
    if !has {
        conn.execute_batch("ALTER TABLE complaints ADD COLUMN done TEXT NOT NULL DEFAULT '';")?;
    }
    // 민원인·연락처를 "민원인" 한 칸으로(2026-10-21 사용자 ⑦⑧): 예전 민원은 "이름 연락처"로 합쳐 옮겨요. 연락처 칸은 비워 둬요.
    conn.execute_batch(
        "UPDATE complaints SET person = TRIM(TRIM(person) || ' ' || TRIM(phone)), phone = '' WHERE TRIM(phone) <> '';",
    )?;
    // 민원처리가 적은 지시 줄은 기본 머릿기호 ●로(2026-10-21 사용자: 불러온 항목만 □로 보여요).
    // 민원처리가 예전 기본(□)을 그대로 "k":"sq"로 적었어요. 지시 줄 모양("… 지시(…-03 · 2)")인 □ 줄만 기호 종류를 빼요(빼면 ●).
    let mut st = conn.prepare("SELECT id, action FROM complaints WHERE action LIKE '%\"sq\"%' AND action LIKE '% 지시(%'")?;
    let rows: Vec<(i64, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    for (id, action) in rows {
        if let Some(fixed) = order_lines_to_default(&action) {
            conn.execute("UPDATE complaints SET action = ?1 WHERE id = ?2", rusqlite::params![fixed, id])?;
        }
    }
    // 연번은 접수일 순서(2026-10-25 사용자 ①1안) – 예전 자료도 한 번 맞춰요.
    renumber(conn)?;
    Ok(())
}

/// 연번을 다시 매겨요(2026-10-25 사용자 ①1안). 표는 연번이 큰 것이 위라서,
/// 위에서 아래로 "접수일 최근 → 예전, 같은 날은 접수유형 가나다 → 위치 가나다(빈 칸은 뒤)"가 되게
/// 맨 아래(가장 오래된 날의 마지막 줄)부터 1, 2, 3 … 을 줘요. 바뀐 줄만 고쳐 써요.
pub(crate) fn renumber(conn: &rusqlite::Connection) -> Result<()> {
    let mut st = conn.prepare(
        "SELECT id, no FROM complaints
         ORDER BY received ASC, (intake = '') DESC, intake DESC, (place = '') DESC, place DESC, id ASC",
    )?;
    let rows: Vec<(i64, i64)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?;
    let mut up = conn.prepare("UPDATE complaints SET no = ?2 WHERE id = ?1")?;
    for (i, (id, no)) in rows.into_iter().enumerate() {
        let n = i as i64 + 1;
        if no != n {
            up.execute(params![id, n])?;
        }
    }
    Ok(())
}

/// 민원처리 지시 줄인지: "도로시설물 1지구 지시(1지구-03 · 2)" — " 지시(" 뒤가 "…-두 자리 · 숫자)"로 끝나요(process.ts `actionLine`).
fn is_order_line(t: &str) -> bool {
    let Some(at) = t.rfind(" 지시(") else { return false };
    let Some(inner) = t[at + " 지시(".len()..].strip_suffix(')') else { return false };
    let Some((tag, item)) = inner.rsplit_once(" · ") else { return false };
    let Some((_, seq)) = tag.rsplit_once('-') else { return false };
    seq.len() == 2 && seq.chars().all(|c| c.is_ascii_digit()) && !item.is_empty() && item.chars().all(|c| c.is_ascii_digit())
}

/// 조치내용 줄 목록에서 □ 지시 줄의 기호 종류를 빼요(바뀐 것이 없으면 None).
fn order_lines_to_default(action: &str) -> Option<String> {
    let serde_json::Value::Array(mut items) = serde_json::from_str::<serde_json::Value>(action).ok()? else { return None };
    let mut changed = false;
    for v in items.iter_mut() {
        let Some(o) = v.as_object_mut() else { continue };
        let is_sq = o.get("k").and_then(|x| x.as_str()) == Some("sq");
        if is_sq && o.get("t").and_then(|x| x.as_str()).map(is_order_line).unwrap_or(false) {
            o.remove("k");
            changed = true;
        }
    }
    changed.then(|| serde_json::Value::Array(items).to_string())
}

const COLS: &str = "id, no, intake, received, ctype, area, place, person, phone, body, action, due, status, memo, road, done";

fn bad(msg: &str) -> Error {
    Error::Invalid(msg.into())
}

/// 여러 줄 글자를 정리해요. 줄마다 앞뒤 빈칸을 지우고 빈 줄은 빼요.
///
/// 0.6.1부터 화면은 머릿기호 규칙에 따라 줄 목록을 JSON으로 보내요: `[{"t":"글","k":"sq"}, ...]`
/// (k: 머릿기호 종류, lv: 머릿기호 없는 줄의 단계, b·s: 굵게·취소선). 그 모양이면 줄마다 정리해 다시 써요.
/// 예전 모양(줄바꿈으로 나눈 글자)도 그대로 받아요.
pub(crate) fn lines(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.starts_with('[') {
        if let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(trimmed) {
            // 빈 줄은 묶음을 나눠요(머릿기호 위계 규칙, 2026-10-17): 묶음 사이 빈 줄은 하나만 남기고 맨 앞·맨 끝 빈 줄은 빼요.
            let mut kept: Vec<serde_json::Value> = Vec::new();
            for v in items {
                let Some(mut o) = v.as_object().cloned() else { continue };
                let Some(t) = o.get("t").and_then(|x| x.as_str()).map(|x| x.trim().to_string()) else { continue };
                if t.is_empty() {
                    let after_text = kept.last().map(|x| x["t"].as_str() != Some("")).unwrap_or(false);
                    if after_text {
                        kept.push(serde_json::json!({ "t": "" }));
                    }
                    continue;
                }
                o.insert("t".into(), serde_json::Value::String(t));
                o.retain(|k, _| matches!(k.as_str(), "t" | "k" | "lv" | "b" | "s"));
                kept.push(serde_json::Value::Object(o));
            }
            while kept.last().map(|x| x["t"].as_str() == Some("")).unwrap_or(false) {
                kept.pop();
            }
            return if kept.is_empty() { String::new() } else { serde_json::Value::Array(kept).to_string() };
        }
    }
    s.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}

fn clean(input: &ComplaintInput) -> Result<ComplaintInput> {
    let t = |s: &str| s.trim().to_string();
    let body = lines(&input.body);
    // 아무 칸 하나만 적어도 등록해요(2026-10-25 사용자) – 처음부터 채워지는 접수일·상태는 세지 않아요.
    let filled = [&input.intake, &input.ctype, &input.area, &input.place, &input.person, &input.phone, &input.due, &input.done]
        .iter()
        .any(|v| !v.trim().is_empty())
        || !body.is_empty()
        || !lines(&input.action).is_empty();
    if !filled {
        return Err(bad("적은 칸이 없어요"));
    }
    let received = t(&input.received);
    if !valid_date(&received) {
        return Err(bad("접수일이 맞지 않아요"));
    }
    let due = t(&input.due);
    if !due.is_empty() && !valid_date(&due) {
        return Err(bad("마감일이 맞지 않아요"));
    }
    let done = t(&input.done);
    if !done.is_empty() && !valid_date(&done) {
        return Err(bad("조치완료일이 맞지 않아요"));
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
        done,
        // 위치가 비었거나 바꾸기 전 글과 같으면 남길 것이 없어요.
        road: {
            let (p, r) = (t(&input.place), t(&input.road));
            if p.is_empty() || r == p { String::new() } else { r }
        },
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
        road: r.get(14)?,
        done: r.get(15)?,
    })
}

/// 위치가 파주시 도로명주소이고 표에 꼭 맞으면 (지역, 지번 위치, 바꾸기 전 글)을 돌려줘요. 아니면 받은 그대로예요.
/// 지역은 후보가 하나면 그것, 여럿이면 받은 지역이 그 안에 있을 때만 두고 아니면 비워요.
pub(crate) fn convert(area: &str, place: &str, road: &str) -> (String, String, String) {
    match crate::address::road_to_jibun(place) {
        crate::address::RoadLookup::Exact { hit, original } => {
            let a = if hit.areas.len() == 1 {
                hit.areas[0].clone()
            } else if hit.areas.iter().any(|x| x == area) {
                area.to_string()
            } else {
                String::new()
            };
            (a, hit.place, original)
        }
        _ => (area.to_string(), place.to_string(), road.to_string()),
    }
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
            "INSERT INTO complaints (no, intake, received, ctype, area, place, person, phone, body, action, due, status, road, done)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![no, c.intake, c.received, c.ctype, c.area, c.place, c.person, c.phone, c.body, c.action, c.due, c.status, c.road, c.done],
        )?;
        let id = tx.last_insert_rowid();
        renumber(&tx)?;
        tx.commit()?;
        self.complaint(id)
    }

    /// 민원을 고쳐요. 메모는 그대로, 연번은 접수일 순서로 다시 매겨요.
    pub fn update_complaint(&mut self, id: i64, input: &ComplaintInput) -> Result<Complaint> {
        let c = clean(input)?;
        let tx = self.conn.transaction()?;
        let n = tx.execute(
            "UPDATE complaints SET intake = ?2, received = ?3, ctype = ?4, area = ?5, place = ?6, person = ?7,
                    phone = ?8, body = ?9, action = ?10, due = ?11, status = ?12, road = ?13, done = ?14
             WHERE id = ?1",
            params![id, c.intake, c.received, c.ctype, c.area, c.place, c.person, c.phone, c.body, c.action, c.due, c.status, c.road, c.done],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        renumber(&tx)?;
        tx.commit()?;
        self.complaint(id)
    }

    /// 상태만 바꿔요. 할 일 목록에서 체크할 때 써요.
    /// `done`이 있으면 조치완료일도 함께 바꿔요(민원대장 배지: 완료·불가면 오늘, 다른 상태면 비움). 없으면 그대로예요.
    pub fn set_complaint_status(&self, id: i64, status: &str, done: Option<&str>) -> Result<Complaint> {
        let status = status.trim();
        let status = if status.is_empty() { DEFAULT_STATUS } else { status };
        let n = match done.map(str::trim) {
            Some(d) => {
                if !d.is_empty() && !valid_date(d) {
                    return Err(bad("조치완료일이 맞지 않아요"));
                }
                self.conn.execute("UPDATE complaints SET status = ?2, done = ?3 WHERE id = ?1", params![id, status, d])?
            }
            None => self.conn.execute("UPDATE complaints SET status = ?2 WHERE id = ?1", params![id, status])?,
        };
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

    pub fn delete_complaint(&mut self, id: i64) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM complaints WHERE id = ?1", params![id])?;
        renumber(&tx)?;
        tx.commit()?;
        Ok(())
    }

    /// 엑셀 가져오기: 모든 줄을 한 번에 넣어요(하나라도 실패하면 아무것도 안 들어가요).
    /// 연번은 지금 가장 큰 연번 다음부터 줄 순서대로 매겨요. 글자는 앞뒤 빈칸만 지우고, 상태가 비면 "접수"예요.
    /// 방식(2026-10-25 사용자 ②3안, 공통 ✔5): `replace`면 지금 민원을 모두 지우고 파일 내용만 넣어요.
    /// 아니면(덮어쓰기) 접수일 + 접수유형 + 위치가 같은 민원은 그 민원의 칸을 파일 값으로 덮고(연번 그대로), 나머지는 더해요.
    /// 돌려주는 값은 (덮은 수, 더한 수).
    pub fn import_complaints(&mut self, rows: &[ComplaintImport], replace: bool) -> Result<(usize, usize)> {
        let tx = self.conn.transaction()?;
        if replace {
            tx.execute("DELETE FROM complaints", [])?;
        }
        let mut no: i64 = tx.query_row("SELECT COALESCE(MAX(no), 0) FROM complaints", [], |r| r.get(0))?;
        let (mut updated, mut added) = (0, 0);
        for r in rows {
            let c = &r.input;
            let t = |s: &str| s.trim().to_string();
            let status = t(&c.status);
            let status = if status.is_empty() { DEFAULT_STATUS.to_string() } else { status };
            // 위치가 파주시 도로명주소면 지번으로 바꿔요(표에 꼭 맞을 때만, 후보가 필요하면 그대로).
            let (area, place, road) = convert(&t(&c.area), &t(&c.place), &t(&c.road));
            let (intake, received) = (t(&c.intake), t(&c.received));
            let same: Option<i64> = if replace || (intake.is_empty() && received.is_empty() && place.is_empty()) {
                None
            } else {
                tx.query_row(
                    "SELECT id FROM complaints WHERE received = ?1 AND intake = ?2 AND place = ?3 ORDER BY id LIMIT 1",
                    params![received, intake, place],
                    |r| r.get(0),
                )
                .optional()?
            };
            if let Some(id) = same {
                tx.execute(
                    "UPDATE complaints SET intake = ?2, received = ?3, ctype = ?4, area = ?5, place = ?6, person = ?7, phone = ?8,
                     body = ?9, action = ?10, due = ?11, status = ?12, memo = ?13, road = ?14, done = ?15 WHERE id = ?1",
                    params![
                        id,
                        intake,
                        received,
                        t(&c.ctype),
                        area,
                        place,
                        t(&c.person),
                        t(&c.phone),
                        lines(&c.body),
                        lines(&c.action),
                        t(&c.due),
                        status,
                        r.memo.trim(),
                        road,
                        t(&c.done)
                    ],
                )?;
                updated += 1;
                continue;
            }
            no += 1;
            tx.execute(
                "INSERT INTO complaints (no, intake, received, ctype, area, place, person, phone, body, action, due, status, memo, road, done)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    no,
                    intake,
                    received,
                    t(&c.ctype),
                    area,
                    place,
                    t(&c.person),
                    t(&c.phone),
                    lines(&c.body),
                    lines(&c.action),
                    t(&c.due),
                    status,
                    r.memo.trim(),
                    road,
                    t(&c.done)
                ],
            )?;
            added += 1;
        }
        renumber(&tx)?;
        tx.commit()?;
        Ok((updated, added))
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
            done: String::new(),
            road: String::new(),
        }
    }

    /// 접수일·상태 말고 모든 칸이 빈 민원(등록 안 됨)
    fn empty() -> ComplaintInput {
        ComplaintInput { intake: "".into(), ctype: "".into(), area: "".into(), place: "".into(), person: "".into(), phone: "".into(), body: "".into(), due: "".into(), ..input("") }
    }

    #[test]
    fn numbers_follow_received_then_intake_then_place() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::create(d.path(), "1234").unwrap();
        let mk = |rec: &str, intake: &str, place: &str| ComplaintInput { received: rec.into(), intake: intake.into(), place: place.into(), ..input("가") };
        let a = s.add_complaint(&mk("2026-10-12", "전화", "대원리 1")).unwrap();
        let b = s.add_complaint(&mk("2026-10-10", "방문", "")).unwrap();
        let c = s.add_complaint(&mk("2026-10-12", "방문", "오산리 2")).unwrap();
        let e = s.add_complaint(&mk("2026-10-12", "방문", "대원리 3")).unwrap();
        // 위에서 아래로: 10-12 방문 대원리 → 10-12 방문 오산리 → 10-12 전화 → 10-10 방문
        let order: Vec<i64> = s.complaints().unwrap().iter().map(|x| x.id).collect();
        assert_eq!(order, vec![e.id, c.id, a.id, b.id]);
        assert_eq!(s.complaints().unwrap().iter().map(|x| x.no).collect::<Vec<_>>(), vec![4, 3, 2, 1]);
        // 접수일을 고치면 자리를 옮기고 번호를 다시 매겨요
        s.update_complaint(b.id, &mk("2026-10-13", "방문", "")).unwrap();
        assert_eq!(s.complaints().unwrap()[0].id, b.id);
        assert_eq!(s.complaints().unwrap()[0].no, 4);
        // 지우면 번호가 당겨져요
        s.delete_complaint(e.id).unwrap();
        assert_eq!(s.complaints().unwrap().iter().map(|x| x.no).collect::<Vec<_>>(), vec![3, 2, 1]);
    }

    #[test]
    fn any_one_field_is_enough() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::create(d.path(), "1234").unwrap();
        let only = empty();
        assert!(s.add_complaint(&only).is_err());
        assert!(s.add_complaint(&ComplaintInput { person: "김○○".into(), ..only.clone() }).is_ok());
    }

    #[test]
    fn person_and_phone_merge_into_one_cell() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::create(d.path(), "1234").unwrap();
        let a = s.add_complaint(&ComplaintInput { person: "김영수".into(), phone: "010-4321-8765".into(), ..input("가") }).unwrap();
        let b = s.add_complaint(&ComplaintInput { person: "".into(), phone: "031-940-5521".into(), ..input("나") }).unwrap();
        let c = s.add_complaint(&ComplaintInput { person: "서울지방경찰청".into(), phone: "".into(), ..input("다") }).unwrap();
        upgrade(&s.conn).unwrap();
        upgrade(&s.conn).unwrap(); // 두 번 돌아도 같아요
        let all = s.complaints().unwrap();
        let get = |id: i64| all.iter().find(|x| x.id == id).map(|x| (x.person.clone(), x.phone.clone())).unwrap();
        assert_eq!(get(a.id), ("김영수 010-4321-8765".to_string(), String::new()));
        assert_eq!(get(b.id), ("031-940-5521".to_string(), String::new()));
        assert_eq!(get(c.id), ("서울지방경찰청".to_string(), String::new()));
    }

    #[test]
    fn order_lines_from_process_become_default_bullet() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::create(d.path(), "1234").unwrap();
        let order = r#"[{"t":"2026 동부 시설물(1차) 지시(시설물(1차)-02 · 3)","k":"sq"}]"#;
        let typed = r#"[{"t":"현장 확인 지시(나중에)","k":"sq"},{"t":"도로시설물 1지구 지시(1지구-03 · 2)","k":"sq"}]"#;
        let own = r#"[{"t":"포트홀 보수","k":"sq"}]"#;
        let a = s.add_complaint(&ComplaintInput { action: order.into(), ..input("가") }).unwrap();
        let b = s.add_complaint(&ComplaintInput { action: typed.into(), ..input("나") }).unwrap();
        let c = s.add_complaint(&ComplaintInput { action: own.into(), ..input("다") }).unwrap();
        upgrade(&s.conn).unwrap();
        upgrade(&s.conn).unwrap(); // 두 번 돌아도 같아요
        let all = s.complaints().unwrap();
        let get = |id: i64| all.iter().find(|x| x.id == id).unwrap().action.clone();
        assert_eq!(get(a.id), r#"[{"t":"2026 동부 시설물(1차) 지시(시설물(1차)-02 · 3)"}]"#);
        // 지시 줄 모양이 아닌 □는 그대로(사용자가 일부러 친 □)
        assert_eq!(get(b.id), r#"[{"k":"sq","t":"현장 확인 지시(나중에)"},{"t":"도로시설물 1지구 지시(1지구-03 · 2)"}]"#);
        assert_eq!(get(c.id), r#"[{"k":"sq","t":"포트홀 보수"}]"#);
    }

    #[test]
    fn done_date_is_kept_and_set_with_status() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::create(d.path(), "1234").unwrap();
        let c = s.add_complaint(&ComplaintInput { status: "완료".into(), done: "2026-10-19".into(), ..input("가") }).unwrap();
        assert_eq!(c.done, "2026-10-19");
        assert!(s.add_complaint(&ComplaintInput { done: "1019".into(), ..input("가") }).is_err());
        // 배지: 불가면 날짜를 넣고, 다시 진행이면 비워요. 날짜를 주지 않으면 그대로예요.
        let c = s.set_complaint_status(c.id, "불가", Some("2026-10-20")).unwrap();
        assert_eq!((c.status.as_str(), c.done.as_str()), ("불가", "2026-10-20"));
        assert_eq!(s.set_complaint_status(c.id, "답변", None).unwrap().done, "2026-10-20");
        assert_eq!(s.set_complaint_status(c.id, "진행", Some("")).unwrap().done, "");
        assert!(s.set_complaint_status(c.id, "완료", Some("1020")).is_err());
    }

    #[test]
    fn road_is_kept_and_import_converts() {
        let d = tempfile::tempdir().unwrap();
        let mut s = Store::create(d.path(), "1234").unwrap();
        // 화면이 바꾼 위치: 바꾸기 전 글을 함께 남겨요. 위치를 바꾸기 전 글과 같게 보내면 비워요.
        let c = s
            .add_complaint(&ComplaintInput { place: "봉일천리 5-31".into(), road: "조리읍 통일로 136".into(), ..input("가") })
            .unwrap();
        assert_eq!(c.road, "조리읍 통일로 136");
        let c = s.update_complaint(c.id, &ComplaintInput { place: "봉일천리 7".into(), road: "봉일천리 7".into(), ..input("가") }).unwrap();
        assert_eq!(c.road, "");
        // 엑셀 가져오기: 표에 꼭 맞으면 바꾸고, 후보가 필요하거나 파주시 밖이면 그대로
        let rows: Vec<ComplaintImport> = ["조리읍 통일로 136", "금정로 20-3", "서울특별시 은평구 통일로 136", "경의로 1246"]
            .iter()
            .map(|p| ComplaintImport { input: ComplaintInput { area: String::new(), place: p.to_string(), ..input("나") }, memo: String::new() })
            .collect();
        s.import_complaints(&rows, false).unwrap();
        let all = s.complaints().unwrap();
        let by = |road_or_place: &str| {
            let c = all.iter().find(|c| c.road == road_or_place || c.place == road_or_place).unwrap();
            (c.area.clone(), c.place.clone(), c.road.clone())
        };
        assert_eq!(by("봉일천리 5-31"), ("조리읍".into(), "봉일천리 5-31".into(), "조리읍 통일로 136".into()));
        assert_eq!(by("금정로 20-3"), ("".into(), "금정로 20-3".into(), "".into()));
        assert_eq!(by("서울특별시 은평구 통일로 136").1, "서울특별시 은평구 통일로 136");
        assert_eq!(by("경의로 1246"), ("운정1동".into(), "와동동 1454-1".into(), "경의로 1246".into()));
    }

    #[test]
    fn import_overwrites_same_or_replaces_all() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let a = s.add_complaint(&input("원래")).unwrap();
        s.add_complaint(&ComplaintInput { place: "다른리 1".into(), ..input("다른 것") }).unwrap();
        let row = |place: &str, body: &str| ComplaintImport { input: ComplaintInput { place: place.into(), ..input(body) }, memo: String::new() };
        // 덮어쓰기: 접수일·접수유형·위치가 같은 것은 덮고(연번 그대로) 새 것은 더해요.
        let (u, n) = s.import_complaints(&[row("봉일천리 113 일원", "고친 내용"), row("새리 9", "새 민원")], false).unwrap();
        assert_eq!((u, n), (1, 1));
        let all = s.complaints().unwrap();
        assert_eq!(all.len(), 3);
        let same = all.iter().find(|c| c.id == a.id).unwrap();
        assert_eq!((same.no, same.body.as_str()), (a.no, "고친 내용"));
        // 대체하기: 모두 지우고 파일 내용만
        let (u, n) = s.import_complaints(&[row("새리 9", "하나만")], true).unwrap();
        assert_eq!((u, n), (0, 1));
        let all = s.complaints().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].body, "하나만");
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
        // 연번은 접수일 순서로 다시 매겨요(2026-10-25) – 지우면 당겨지고, 같은 날·같은 칸이면 나중에 넣은 것이 위예요.
        s.delete_complaint(a.id).unwrap();
        let c = s.add_complaint(&input("셋째")).unwrap();
        assert_eq!(c.no, 2);
        let all = s.complaints().unwrap();
        assert_eq!(all.iter().map(|x| x.no).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(all[0].id, c.id);
    }

    #[test]
    fn body_is_required_and_lines_are_cleaned() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.add_complaint(&ComplaintInput { body: "  \n \n".into(), ..empty() }).err().unwrap().code(), "invalid");
        let mut i = input("  포트홀 여러 개 \n\n 야간에 잘 안 보임 ");
        i.action = "\n 10/12 현장 확인 \n\n10/14 긴급보수\n".into();
        let c = s.add_complaint(&i).unwrap();
        assert_eq!(c.body, "포트홀 여러 개\n야간에 잘 안 보임");
        assert_eq!(c.action, "10/12 현장 확인\n10/14 긴급보수");
        assert!(s.complaints().unwrap().len() == 1);
    }

    #[test]
    fn bullet_lines_are_cleaned() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let mut i = input(r#"[{"t":" "},{"t":" 포트홀 ","k":"sq"},{"t":"  "},{"t":"","k":"da"},{"t":"야간","k":"ci","x":1},{"t":"이어 씀","k":"none","lv":1},{"t":""}]"#);
        i.action = r#"[{"t":""}]"#.into();
        let c = s.add_complaint(&i).unwrap();
        // 묶음 사이 빈 줄은 하나만 남고, 맨 앞·맨 끝 빈 줄은 빠져요.
        assert_eq!(c.body, r#"[{"k":"sq","t":"포트홀"},{"t":""},{"k":"ci","t":"야간"},{"k":"none","lv":1,"t":"이어 씀"}]"#);
        assert_eq!(c.action, "");
        // 빈 줄만 있으면 내용이 없는 것이에요(다른 칸이 있으면 등록은 돼요).
        assert_eq!(s.add_complaint(&input(r#"[{"t":" "}]"#)).unwrap().body, "");
        assert_eq!(s.add_complaint(&ComplaintInput { body: r#"[{"t":" "}]"#.into(), ..empty() }).err().unwrap().code(), "invalid");
        // JSON처럼 보여도 줄 목록이 아니면 글자로 받아요.
        assert_eq!(s.add_complaint(&input("[참고] 현장 확인")).unwrap().body, "[참고] 현장 확인");
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
        assert_eq!(s.set_complaint_status(c.id, "처리중", None).unwrap().status, "처리중");
        assert_eq!(s.update_complaint(999, &i).err().unwrap().code(), "not_found");
        assert_eq!(s.set_complaint_memo(999, "").err().unwrap().code(), "not_found");
        assert_eq!(s.set_complaint_status(999, "완료", None).err().unwrap().code(), "not_found");
        // 고치다 실패하면 그대로예요.
        assert_eq!(s.update_complaint(c.id, &empty()).err().unwrap().code(), "invalid");
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
        // 다시 열면 연락처가 민원인 칸으로 합쳐져요(2026-10-21 민원인 한 칸).
        assert_eq!(all[0].person, "PERSON-MARKER 010-9999-PHONE");
        assert_eq!(all[0].phone, "");
        assert_eq!(all[0].no, 1);
    }
}
