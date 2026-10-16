//! 캘린더: 내 일정과 캘린더 종류, 받아 둔 공휴일이에요.
//!
//! - 민원 마감·할 일 마감은 여기 저장하지 않아요. 화면이 민원대장·할 일 목록을 그대로 읽어 그려요(같은 사실은 한 곳에만).
//!   그래서 이 두 종류와 공휴일은 "앱이 만든 종류"(`system`)로만 있고, 색과 보이기만 바꿔요.
//! - 종류 색은 구글 캘린더의 24색 가운데 번호(0~23)예요. 비어 있으면 자동 색이에요(화면이 순서로 정해요).
//! - 일정의 종류는 이름으로 받아요. 없는 이름이면 새 종류를 만들어요(사양서). 앱이 만든 종류 이름은 쓸 수 없어요.
//! - 반복 일정은 종료일이 꼭 있어야 해요(사양서). 반복을 펼쳐 그리는 것은 화면이 해요.
//! - 공휴일은 인터넷에서 받은 것을 저장해 두어요. 처음에는 앱에 넣어 온 목록(`BUILTIN_HOLIDAYS`)으로 채워요.

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::complaints::lines;
use crate::journal::valid_date;
use crate::{Error, Result, Store};

/// 앱이 만든 종류: 민원 마감, 할 일 마감, 공휴일. 지울 수 없고 이름도 바꾸지 않아요.
pub const SYSTEM_KINDS: [(&str, &str, i64); 3] = [("complaint", "민원 마감", 1), ("task", "할 일 마감", 12), ("holiday", "공휴일", 3)];

/// 처음 열 때 만드는 내 종류예요(시안).
const FIRST_KINDS: [&str; 3] = ["업무 일정", "회의 · 협의", "출장"];

/// 구글 캘린더 색 개수
pub const KIND_COLORS: i64 = 24;

/// 반복 규칙. 빈 글자는 반복 안 함이에요.
pub const REPEATS: [&str; 7] = ["", "daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];

/// 알림(분 전). -1은 알림 없음, 0은 정시, 1440은 1일 전이에요.
pub const REMINDS: [i64; 6] = [-1, 0, 10, 30, 60, 1440];

/// 앱에 넣어 온 공휴일이에요(우주항공청 월력요항 기준, holidays-kr 자료). 인터넷에서 받으면 그것으로 바꿔요.
pub const BUILTIN_HOLIDAYS: &[(&str, &str)] = &[
    ("2024-01-01", "1월 1일"),
    ("2024-02-09", "설날 전날"),
    ("2024-02-10", "설날"),
    ("2024-02-11", "설날 다음 날"),
    ("2024-02-12", "대체공휴일(설날)"),
    ("2024-03-01", "3ㆍ1절"),
    ("2024-04-10", "제22대국회의원선거"),
    ("2024-05-05", "어린이날"),
    ("2024-05-06", "대체공휴일(어린이날)"),
    ("2024-05-15", "부처님 오신 날"),
    ("2024-06-06", "현충일"),
    ("2024-08-15", "광복절"),
    ("2024-09-16", "추석 전날"),
    ("2024-09-17", "추석"),
    ("2024-09-18", "추석 다음 날"),
    ("2024-10-01", "임시공휴일"),
    ("2024-10-03", "개천절"),
    ("2024-10-09", "한글날"),
    ("2024-12-25", "기독탄신일"),
    ("2025-01-01", "1월 1일"),
    ("2025-01-27", "임시공휴일"),
    ("2025-01-28", "설날 전날"),
    ("2025-01-29", "설날"),
    ("2025-01-30", "설날 다음 날"),
    ("2025-03-01", "3ㆍ1절"),
    ("2025-03-03", "대체공휴일(3ㆍ1절)"),
    ("2025-05-05", "어린이날"),
    ("2025-05-05", "부처님 오신 날"),
    ("2025-05-06", "대체공휴일(부처님 오신 날)"),
    ("2025-06-03", "임시공휴일(대통령선거)"),
    ("2025-06-06", "현충일"),
    ("2025-08-15", "광복절"),
    ("2025-10-03", "개천절"),
    ("2025-10-05", "추석 전날"),
    ("2025-10-06", "추석"),
    ("2025-10-07", "추석 다음 날"),
    ("2025-10-08", "대체공휴일(추석)"),
    ("2025-10-09", "한글날"),
    ("2025-12-25", "기독탄신일"),
    ("2026-01-01", "1월 1일"),
    ("2026-02-16", "설날 전날"),
    ("2026-02-17", "설날"),
    ("2026-02-18", "설날 다음 날"),
    ("2026-03-01", "3ㆍ1절"),
    ("2026-03-02", "대체공휴일(3ㆍ1절)"),
    ("2026-05-01", "노동절"),
    ("2026-05-05", "어린이날"),
    ("2026-05-24", "부처님 오신 날"),
    ("2026-05-25", "대체공휴일(부처님 오신 날)"),
    ("2026-06-03", "전국동시지방선거"),
    ("2026-06-06", "현충일"),
    ("2026-07-17", "제헌절"),
    ("2026-08-15", "광복절"),
    ("2026-08-17", "대체공휴일(광복절)"),
    ("2026-09-24", "추석 전날"),
    ("2026-09-25", "추석"),
    ("2026-09-26", "추석 다음 날"),
    ("2026-10-03", "개천절"),
    ("2026-10-05", "대체공휴일(개천절)"),
    ("2026-10-09", "한글날"),
    ("2026-12-25", "기독탄신일"),
    ("2027-01-01", "1월 1일"),
    ("2027-02-06", "설날 전날"),
    ("2027-02-07", "설날"),
    ("2027-02-08", "설날 다음 날"),
    ("2027-02-09", "대체공휴일(설날)"),
    ("2027-03-01", "3ㆍ1절"),
    ("2027-05-01", "노동절"),
    ("2027-05-03", "대체공휴일(노동절)"),
    ("2027-05-05", "어린이날"),
    ("2027-05-13", "부처님 오신 날"),
    ("2027-06-06", "현충일"),
    ("2027-07-17", "제헌절"),
    ("2027-07-19", "대체공휴일(제헌절)"),
    ("2027-08-15", "광복절"),
    ("2027-08-16", "대체공휴일(광복절)"),
    ("2027-09-14", "추석 전날"),
    ("2027-09-15", "추석"),
    ("2027-09-16", "추석 다음 날"),
    ("2027-10-03", "개천절"),
    ("2027-10-04", "대체공휴일(개천절)"),
    ("2027-10-09", "한글날"),
    ("2027-10-11", "대체공휴일(한글날)"),
    ("2027-12-25", "기독탄신일"),
    ("2027-12-27", "대체공휴일(기독탄신일)"),
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalKind {
    pub id: i64,
    pub name: String,
    /// 구글 24색 가운데 번호. None이면 자동 색이에요.
    pub color: Option<i64>,
    /// 왼쪽 목록의 체크를 끄면 달력에서 숨겨요.
    pub visible: bool,
    /// 앱이 만든 종류: "complaint"·"task"·"holiday". 내가 만든 종류는 빈 글자예요.
    pub system: String,
    pub ord: i64,
}

/// 일정을 등록하거나 고칠 때 보내는 값이에요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EventInput {
    pub title: String,
    /// 종류 이름. 없는 이름이면 새로 만들어요. 비어 있으면 첫 번째 내 종류예요.
    pub kind: String,
    /// 시작 날짜 2026-10-16
    pub date: String,
    /// 끝 날짜. 비어 있으면 시작 날짜와 같아요.
    pub end: String,
    pub all_day: bool,
    /// 시작 시각 09:30 (종일이면 비어 있어요)
    pub time: String,
    /// 끝 시각. 비어 있으면 시작 한 시간 뒤예요.
    pub end_time: String,
    pub repeat: String,
    /// 반복 종료일. 반복이면 꼭 있어야 해요.
    pub until: String,
    pub place: String,
    /// 설명 (머릿기호 줄 목록 JSON)
    pub desc: String,
    pub remind: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: i64,
    pub title: String,
    /// 종류 번호
    pub kind: i64,
    pub date: String,
    pub end: String,
    pub all_day: bool,
    pub time: String,
    pub end_time: String,
    pub repeat: String,
    pub until: String,
    pub place: String,
    pub desc: String,
    pub remind: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Holiday {
    pub date: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarData {
    pub kinds: Vec<CalKind>,
    pub events: Vec<Event>,
    pub holidays: Vec<Holiday>,
    /// 공휴일을 마지막으로 인터넷에서 받은 때 (2026-10-16 09:12). 받은 적이 없으면 비어 있어요.
    pub holidays_at: String,
}

pub(crate) const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS cal_kinds (
        id      INTEGER PRIMARY KEY,
        name    TEXT NOT NULL UNIQUE,
        color   INTEGER,
        visible INTEGER NOT NULL DEFAULT 1,
        system  TEXT NOT NULL DEFAULT '',
        ord     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (
        id       INTEGER PRIMARY KEY,
        title    TEXT NOT NULL,
        kind     INTEGER NOT NULL,
        date     TEXT NOT NULL,
        end_date TEXT NOT NULL,
        all_day  INTEGER NOT NULL DEFAULT 1,
        time     TEXT NOT NULL DEFAULT '',
        end_time TEXT NOT NULL DEFAULT '',
        repeat   TEXT NOT NULL DEFAULT '',
        until    TEXT NOT NULL DEFAULT '',
        place    TEXT NOT NULL DEFAULT '',
        descr    TEXT NOT NULL DEFAULT '',
        remind   INTEGER NOT NULL DEFAULT -1
    );
    CREATE INDEX IF NOT EXISTS events_kind ON events(kind);
    CREATE TABLE IF NOT EXISTS holidays (
        date TEXT NOT NULL,
        name TEXT NOT NULL,
        PRIMARY KEY (date, name)
    );
";

const HOLIDAYS_AT: &str = "holidays.at";

/// 처음 열 때 내 종류 셋과 앱이 만든 종류 셋을 만들어요. 앱이 만든 종류가 빠져 있으면 다시 넣어요.
/// 공휴일이 하나도 없으면 앱에 넣어 온 목록으로 채워요.
pub(crate) fn seed(conn: &rusqlite::Connection) -> Result<()> {
    let n: i64 = conn.query_row("SELECT count(*) FROM cal_kinds", [], |r| r.get(0))?;
    if n == 0 {
        for (i, name) in FIRST_KINDS.iter().enumerate() {
            conn.execute("INSERT INTO cal_kinds (name, ord) VALUES (?1, ?2)", params![name, i as i64])?;
        }
    }
    for (i, (sys, name, color)) in SYSTEM_KINDS.iter().enumerate() {
        let has: bool = conn.prepare("SELECT 1 FROM cal_kinds WHERE system = ?1")?.exists(params![sys])?;
        if has {
            continue;
        }
        // 같은 이름의 내 종류가 있으면 이름을 비켜 줘요(그 종류의 일정은 그대로예요).
        conn.execute("UPDATE cal_kinds SET name = name || ' (내 종류)' WHERE name = ?1", params![name])?;
        conn.execute(
            "INSERT INTO cal_kinds (name, color, system, ord) VALUES (?1, ?2, ?3, ?4)",
            params![name, color, sys, 1000 + i as i64],
        )?;
    }
    let h: i64 = conn.query_row("SELECT count(*) FROM holidays", [], |r| r.get(0))?;
    if h == 0 {
        for (d, name) in BUILTIN_HOLIDAYS {
            conn.execute("INSERT OR IGNORE INTO holidays (date, name) VALUES (?1, ?2)", params![d, name])?;
        }
    }
    Ok(())
}

const KIND_COLS: &str = "id, name, color, visible, system, ord";
const EVENT_COLS: &str = "id, title, kind, date, end_date, all_day, time, end_time, repeat, until, place, descr, remind";

fn bad(msg: &str) -> Error {
    Error::Invalid(msg.into())
}

fn kind_row(r: &Row) -> rusqlite::Result<CalKind> {
    Ok(CalKind { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, visible: r.get(3)?, system: r.get(4)?, ord: r.get(5)? })
}

fn event_row(r: &Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get(0)?,
        title: r.get(1)?,
        kind: r.get(2)?,
        date: r.get(3)?,
        end: r.get(4)?,
        all_day: r.get(5)?,
        time: r.get(6)?,
        end_time: r.get(7)?,
        repeat: r.get(8)?,
        until: r.get(9)?,
        place: r.get(10)?,
        desc: r.get(11)?,
        remind: r.get(12)?,
    })
}

fn squash(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 09:30 꼴이면 분으로 바꿔요.
fn minutes(t: &str) -> Option<u32> {
    let b = t.as_bytes();
    if b.len() != 5 || b[2] != b':' {
        return None;
    }
    let h: u32 = t.get(0..2)?.parse().ok()?;
    let m: u32 = t.get(3..5)?.parse().ok()?;
    (h < 24 && m < 60 && b[..2].iter().chain(&b[3..]).all(|c| c.is_ascii_digit())).then_some(h * 60 + m)
}

fn hhmm(m: u32) -> String {
    format!("{:02}:{:02}", m / 60, m % 60)
}

/// 정리한 일정 값 (종류는 아직 이름이에요)
struct Clean {
    title: String,
    kind: String,
    date: String,
    end: String,
    all_day: bool,
    time: String,
    end_time: String,
    repeat: String,
    until: String,
    place: String,
    desc: String,
    remind: i64,
}

fn clean(i: &EventInput) -> Result<Clean> {
    let title = squash(&i.title);
    if title.is_empty() {
        return Err(bad("일정 제목이 비어 있어요"));
    }
    let date = i.date.trim().to_string();
    if !valid_date(&date) {
        return Err(bad("날짜가 맞지 않아요"));
    }
    let end = match i.end.trim() {
        "" => date.clone(),
        e if valid_date(e) && e >= date.as_str() => e.to_string(),
        _ => return Err(bad("끝 날짜가 맞지 않아요")),
    };
    let (time, end_time) = if i.all_day {
        (String::new(), String::new())
    } else {
        let s = minutes(i.time.trim()).ok_or_else(|| bad("시작 시각이 맞지 않아요"))?;
        let e = match i.end_time.trim() {
            "" => (s + 60).min(23 * 60 + 59),
            t => minutes(t).ok_or_else(|| bad("끝 시각이 맞지 않아요"))?,
        };
        if end == date && e < s {
            return Err(bad("끝 시각이 시작보다 빨라요"));
        }
        (hhmm(s), hhmm(e))
    };
    let repeat = i.repeat.trim().to_string();
    if !REPEATS.contains(&repeat.as_str()) {
        return Err(bad("반복 규칙이 맞지 않아요"));
    }
    let until = if repeat.is_empty() {
        String::new()
    } else {
        let u = i.until.trim();
        if !valid_date(u) || u < date.as_str() {
            return Err(bad("반복 종료일이 맞지 않아요"));
        }
        u.to_string()
    };
    if !REMINDS.contains(&i.remind) {
        return Err(bad("알림이 맞지 않아요"));
    }
    Ok(Clean {
        title,
        kind: squash(&i.kind),
        date,
        end,
        all_day: i.all_day,
        time,
        end_time,
        repeat,
        until,
        place: i.place.trim().to_string(),
        desc: lines(&i.desc),
        remind: i.remind,
    })
}

impl Store {
    pub fn calendar_data(&self) -> Result<CalendarData> {
        Ok(CalendarData {
            kinds: self.cal_kinds()?,
            events: self.events()?,
            holidays: self.holidays()?,
            holidays_at: self.get(HOLIDAYS_AT)?.unwrap_or_default(),
        })
    }

    /// 내 종류가 먼저(순서대로), 앱이 만든 종류가 뒤예요.
    pub fn cal_kinds(&self) -> Result<Vec<CalKind>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {KIND_COLS} FROM cal_kinds ORDER BY system <> '', ord, id"))?;
        let v = stmt.query_map([], kind_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    fn events(&self) -> Result<Vec<Event>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {EVENT_COLS} FROM events ORDER BY date, id"))?;
        let v = stmt.query_map([], event_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    fn holidays(&self) -> Result<Vec<Holiday>> {
        let mut stmt = self.conn.prepare("SELECT date, name FROM holidays ORDER BY date, rowid")?;
        let v = stmt
            .query_map([], |r| Ok(Holiday { date: r.get(0)?, name: r.get(1)? }))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    fn cal_kind(&self, id: i64) -> Result<CalKind> {
        self.conn
            .query_row(&format!("SELECT {KIND_COLS} FROM cal_kinds WHERE id = ?1"), params![id], kind_row)
            .optional()?
            .ok_or(Error::NotFound)
    }

    fn event(&self, id: i64) -> Result<Event> {
        self.conn
            .query_row(&format!("SELECT {EVENT_COLS} FROM events WHERE id = ?1"), params![id], event_row)
            .optional()?
            .ok_or(Error::NotFound)
    }

    /// 이름으로 내 종류를 찾고, 없으면 맨 뒤에 만들어요. 빈 이름이면 첫 번째 내 종류예요.
    fn kind_for(&self, name: &str) -> Result<i64> {
        if name.is_empty() {
            return self
                .conn
                .query_row("SELECT id FROM cal_kinds WHERE system = '' ORDER BY ord, id LIMIT 1", [], |r| r.get(0))
                .optional()?
                .ok_or_else(|| bad("종류가 없어요"));
        }
        let found: Option<(i64, String)> = self
            .conn
            .query_row("SELECT id, system FROM cal_kinds WHERE name = ?1", params![name], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        match found {
            Some((_, sys)) if !sys.is_empty() => Err(bad("앱이 만드는 종류에는 일정을 적을 수 없어요")),
            Some((id, _)) => Ok(id),
            None => Ok(self.add_cal_kind_row(name)?),
        }
    }

    fn add_cal_kind_row(&self, name: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO cal_kinds (name, ord) VALUES (?1, (SELECT COALESCE(MAX(ord), 0) + 1 FROM cal_kinds WHERE system = ''))",
            params![name],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// 일정을 등록해요. 종류 이름이 새것이면 종류도 만들어져요.
    pub fn add_event(&self, input: &EventInput) -> Result<Event> {
        let c = clean(input)?;
        let kind = self.kind_for(&c.kind)?;
        self.conn.execute(
            "INSERT INTO events (title, kind, date, end_date, all_day, time, end_time, repeat, until, place, descr, remind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![c.title, kind, c.date, c.end, c.all_day, c.time, c.end_time, c.repeat, c.until, c.place, c.desc, c.remind],
        )?;
        self.event(self.conn.last_insert_rowid())
    }

    pub fn update_event(&self, id: i64, input: &EventInput) -> Result<Event> {
        self.event(id)?;
        let c = clean(input)?;
        let kind = self.kind_for(&c.kind)?;
        self.conn.execute(
            "UPDATE events SET title = ?2, kind = ?3, date = ?4, end_date = ?5, all_day = ?6, time = ?7, end_time = ?8,
                 repeat = ?9, until = ?10, place = ?11, descr = ?12, remind = ?13 WHERE id = ?1",
            params![id, c.title, kind, c.date, c.end, c.all_day, c.time, c.end_time, c.repeat, c.until, c.place, c.desc, c.remind],
        )?;
        self.event(id)
    }

    pub fn delete_event(&self, id: i64) -> Result<()> {
        if self.conn.execute("DELETE FROM events WHERE id = ?1", params![id])? == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// 새 내 종류를 만들고 모든 종류를 돌려줘요. 같은 이름이 있으면 만들지 않아요.
    pub fn add_cal_kind(&self, name: &str) -> Result<Vec<CalKind>> {
        let name = squash(name);
        if name.is_empty() {
            return Err(bad("종류 이름이 비어 있어요"));
        }
        if self.conn.prepare("SELECT 1 FROM cal_kinds WHERE name = ?1")?.exists(params![name])? {
            return Err(bad("같은 이름의 종류가 있어요"));
        }
        self.add_cal_kind_row(&name)?;
        self.cal_kinds()
    }

    /// 색을 바꿔요(None이면 자동). 앱이 만든 종류도 색은 바꿀 수 있어요(사양서).
    pub fn set_cal_kind_color(&self, id: i64, color: Option<i64>) -> Result<Vec<CalKind>> {
        if let Some(c) = color {
            if !(0..KIND_COLORS).contains(&c) {
                return Err(bad("색 번호가 맞지 않아요"));
            }
        }
        let k = self.cal_kind(id)?;
        // 앱이 만든 종류는 자동 색이 없어요. 자동을 고르면 처음 색으로 돌려요.
        let color = match (color, k.system.as_str()) {
            (None, sys) if !sys.is_empty() => SYSTEM_KINDS.iter().find(|s| s.0 == sys).map(|s| s.2),
            (c, _) => c,
        };
        self.conn.execute("UPDATE cal_kinds SET color = ?2 WHERE id = ?1", params![id, color])?;
        self.cal_kinds()
    }

    pub fn set_cal_kind_visible(&self, id: i64, visible: bool) -> Result<Vec<CalKind>> {
        if self.conn.execute("UPDATE cal_kinds SET visible = ?2 WHERE id = ?1", params![id, visible])? == 0 {
            return Err(Error::NotFound);
        }
        self.cal_kinds()
    }

    /// 내 종류와 그 종류의 일정을 지워요. 지운 일정 수를 돌려줘요.
    /// 앱이 만든 종류와 마지막 하나 남은 내 종류는 지우지 않아요.
    pub fn delete_cal_kind(&mut self, id: i64) -> Result<usize> {
        let k = self.cal_kind(id)?;
        if !k.system.is_empty() {
            return Err(bad("앱이 만든 종류는 지울 수 없어요"));
        }
        let mine: i64 = self.conn.query_row("SELECT count(*) FROM cal_kinds WHERE system = ''", [], |r| r.get(0))?;
        if mine <= 1 {
            return Err(bad("종류는 하나 이상 있어야 해요"));
        }
        let tx = self.conn.transaction()?;
        let n = tx.execute("DELETE FROM events WHERE kind = ?1", params![id])?;
        tx.execute("DELETE FROM cal_kinds WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(n)
    }

    /// 인터넷에서 받은 공휴일로 바꿔요. 받은 자료에 있는 연도만 바꾸고, 없는 연도는 그대로 둬요.
    /// 날짜가 맞지 않는 줄은 버려요. 바꾼 뒤의 공휴일 전체를 돌려줘요.
    pub fn replace_holidays(&mut self, list: &[Holiday], at: &str) -> Result<Vec<Holiday>> {
        let good: Vec<(String, String)> = list
            .iter()
            .filter(|h| valid_date(h.date.trim()) && !h.name.trim().is_empty())
            .map(|h| (h.date.trim().to_string(), squash(&h.name)))
            .collect();
        if good.is_empty() {
            return Err(bad("받은 공휴일이 비어 있어요"));
        }
        let mut years: Vec<&str> = good.iter().map(|(d, _)| &d[..4]).collect();
        years.sort();
        years.dedup();
        let tx = self.conn.transaction()?;
        for y in &years {
            tx.execute("DELETE FROM holidays WHERE substr(date, 1, 4) = ?1", params![y])?;
        }
        for (d, n) in &good {
            tx.execute("INSERT OR IGNORE INTO holidays (date, name) VALUES (?1, ?2)", params![d, n])?;
        }
        tx.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![HOLIDAYS_AT, at],
        )?;
        tx.commit()?;
        self.holidays()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(tmp: &tempfile::TempDir) -> Store {
        Store::create(tmp.path(), "abcd1234").unwrap()
    }

    fn ev(title: &str, date: &str) -> EventInput {
        EventInput { title: title.into(), date: date.into(), all_day: true, remind: -1, ..Default::default() }
    }

    #[test]
    fn kinds_and_holidays_are_there_from_the_start() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(&tmp);
        let d = s.calendar_data().unwrap();
        let names: Vec<_> = d.kinds.iter().map(|k| k.name.as_str()).collect();
        assert_eq!(names, vec!["업무 일정", "회의 · 협의", "출장", "민원 마감", "할 일 마감", "공휴일"]);
        assert_eq!(d.kinds[3].color, Some(1));
        assert!(d.holidays.iter().any(|h| h.date == "2026-10-05" && h.name == "대체공휴일(개천절)"));
        assert_eq!(d.holidays_at, "");
        // 앱이 만든 종류는 지울 수 없고, 거기에 일정을 적을 수도 없어요.
        let sys = d.kinds[3].id;
        assert_eq!(s.delete_cal_kind(sys).err().unwrap().code(), "invalid");
        assert_eq!(s.add_event(&EventInput { kind: "민원 마감".into(), ..ev("x", "2026-10-16") }).err().unwrap().code(), "invalid");
        // 색은 바꿀 수 있고, 자동을 고르면 처음 색으로 돌아가요.
        assert_eq!(s.set_cal_kind_color(sys, Some(5)).unwrap()[3].color, Some(5));
        assert_eq!(s.set_cal_kind_color(sys, None).unwrap()[3].color, Some(1));
        assert_eq!(s.set_cal_kind_color(sys, Some(24)).err().unwrap().code(), "invalid");
        // 다시 열어도 그대로예요.
        drop(s);
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.calendar_data().unwrap().kinds.len(), 6);
    }

    #[test]
    fn events_are_cleaned_and_checked() {
        let tmp = tempfile::tempdir().unwrap();
        let s = store(&tmp);
        assert_eq!(s.add_event(&ev("  ", "2026-10-16")).err().unwrap().code(), "invalid");
        assert_eq!(s.add_event(&ev("x", "1016")).err().unwrap().code(), "invalid");
        // 종일: 시각은 지워지고, 끝 날짜가 비면 시작 날짜예요. 종류가 비면 첫 내 종류예요.
        let e = s.add_event(&EventInput { time: "09:00".into(), ..ev(" 차선도색   물량 제출 ", "2026-10-16") }).unwrap();
        assert_eq!((e.title.as_str(), e.end.as_str(), e.time.as_str()), ("차선도색 물량 제출", "2026-10-16", ""));
        let kinds = s.cal_kinds().unwrap();
        assert_eq!(e.kind, kinds[0].id);
        // 시간 일정: 끝 시각이 비면 한 시간 뒤예요. 틀린 시각·거꾸로 된 시각은 안 돼요.
        let t = EventInput { all_day: false, time: "14:00".into(), remind: 10, ..ev("주간회의", "2026-10-20") };
        let e = s.add_event(&t).unwrap();
        assert_eq!((e.time.as_str(), e.end_time.as_str(), e.remind), ("14:00", "15:00", 10));
        assert_eq!(s.add_event(&EventInput { time: "1400".into(), ..t.clone() }).err().unwrap().code(), "invalid");
        assert_eq!(s.add_event(&EventInput { end_time: "13:00".into(), ..t.clone() }).err().unwrap().code(), "invalid");
        // 여러 날이면 끝 시각이 시작보다 일러도 돼요.
        assert!(s.add_event(&EventInput { end: "2026-10-21".into(), end_time: "13:00".into(), ..t.clone() }).is_ok());
        assert_eq!(s.add_event(&EventInput { end: "2026-10-19".into(), ..t.clone() }).err().unwrap().code(), "invalid");
        assert_eq!(s.add_event(&EventInput { remind: 5, ..t.clone() }).err().unwrap().code(), "invalid");
        // 반복은 종료일이 꼭 있어야 해요.
        let r = EventInput { repeat: "weekly".into(), ..t.clone() };
        assert_eq!(s.add_event(&r).err().unwrap().code(), "invalid");
        assert_eq!(s.add_event(&EventInput { until: "2026-10-01".into(), ..r.clone() }).err().unwrap().code(), "invalid");
        let e = s.add_event(&EventInput { until: "2026-12-29".into(), ..r.clone() }).unwrap();
        assert_eq!((e.repeat.as_str(), e.until.as_str()), ("weekly", "2026-12-29"));
        assert_eq!(s.add_event(&EventInput { repeat: "hourly".into(), ..r }).err().unwrap().code(), "invalid");
        // 반복을 끄면 종료일은 지워져요.
        let u = s.update_event(e.id, &EventInput { until: "2026-12-29".into(), ..t.clone() }).unwrap();
        assert_eq!((u.repeat.as_str(), u.until.as_str()), ("", ""));
        // 설명은 머릿기호 줄로 정리돼요.
        let d = s.add_event(&EventInput { desc: r#"[{"t":" 상온 아스콘 "},{"t":""}]"#.into(), ..ev("긴급보수", "2026-10-14") }).unwrap();
        assert_eq!(d.desc, r#"[{"t":"상온 아스콘"}]"#);
        assert_eq!(s.update_event(999, &ev("x", "2026-10-16")).err().unwrap().code(), "not_found");
        s.delete_event(d.id).unwrap();
        assert_eq!(s.delete_event(d.id).err().unwrap().code(), "not_found");
    }

    #[test]
    fn new_kind_names_make_kinds_and_kinds_go_with_their_events() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(&tmp);
        let e = s.add_event(&EventInput { kind: "  교육 ".into(), ..ev("실무 교육", "2026-10-22") }).unwrap();
        let kinds = s.cal_kinds().unwrap();
        let edu = kinds.iter().find(|k| k.name == "교육").unwrap();
        assert_eq!((e.kind, edu.color, edu.system.as_str()), (edu.id, None, ""));
        // 내 종류는 앱이 만든 종류보다 앞이에요.
        assert_eq!(kinds[3].name, "교육");
        assert_eq!(s.add_cal_kind("교육").err().unwrap().code(), "invalid");
        assert_eq!(s.add_cal_kind("공휴일").err().unwrap().code(), "invalid");
        assert_eq!(s.add_cal_kind("현장 점검").unwrap()[4].name, "현장 점검");
        assert!(!s.set_cal_kind_visible(edu.id, false).unwrap()[3].visible);
        s.add_event(&EventInput { kind: "교육".into(), ..ev("둘째", "2026-10-23") }).unwrap();
        assert_eq!(s.delete_cal_kind(edu.id).unwrap(), 2);
        assert!(s.calendar_data().unwrap().events.is_empty());
        // 마지막 내 종류는 지울 수 없어요.
        for k in s.cal_kinds().unwrap().into_iter().filter(|k| k.system.is_empty()).skip(1) {
            s.delete_cal_kind(k.id).unwrap();
        }
        let last = s.cal_kinds().unwrap()[0].id;
        assert_eq!(s.delete_cal_kind(last).err().unwrap().code(), "invalid");
    }

    #[test]
    fn holidays_are_replaced_by_year() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(&tmp);
        let h = |d: &str, n: &str| Holiday { date: d.into(), name: n.into() };
        let got = s
            .replace_holidays(&[h("2026-10-03", "개천절"), h("2026-10-05", "대체공휴일(개천절)"), h("2026-10-12", "임시공휴일"), h("bad", "x")], "2026-10-16 09:00")
            .unwrap();
        // 2026년은 받은 것으로 바뀌고 다른 해는 그대로예요.
        let y26: Vec<_> = got.iter().filter(|x| x.date.starts_with("2026")).map(|x| x.date.as_str()).collect();
        assert_eq!(y26, vec!["2026-10-03", "2026-10-05", "2026-10-12"]);
        assert!(got.iter().any(|x| x.date == "2027-02-09"));
        assert_eq!(s.calendar_data().unwrap().holidays_at, "2026-10-16 09:00");
        assert_eq!(s.replace_holidays(&[h("x", "y")], "t").err().unwrap().code(), "invalid");
        // 받은 공휴일이 있으면 다시 열어도 앱에 넣어 온 것으로 되돌리지 않아요.
        drop(s);
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        assert!(s.calendar_data().unwrap().holidays.iter().any(|x| x.date == "2026-10-12"));
    }

    #[test]
    fn events_survive_reopen_and_are_encrypted() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = store(&tmp);
            s.add_event(&EventInput { place: "PLACE-MARKER".into(), kind: "KIND-MARKER".into(), ..ev("EVENT-MARKER", "2026-10-16") }).unwrap();
        }
        let bytes = std::fs::read(tmp.path().join("gilog.db")).unwrap();
        for needle in [&b"PLACE-MARKER"[..], &b"KIND-MARKER"[..], &b"EVENT-MARKER"[..]] {
            assert!(!bytes.windows(needle.len()).any(|w| w == needle));
        }
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.calendar_data().unwrap().events[0].place, "PLACE-MARKER");
    }
}
