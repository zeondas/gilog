//! 자료 지우기(설정 "자료 지우기" 카드, 2026-10-30 설정 ✔1).
//!
//! 화면마다 그 화면의 자료만 지워요. 설정(`kv`)·종류·목록 같은 틀은 남겨요.
//! - 민원대장: 민원 + 민원처리 민원 건(cases)과 빈 지시부 기록(orders). 공사 목록(works)은 남아요.
//! - 업무연락처: 연락처·사업·사업 묶음. 민원처리 공사·업무일지 기록에서는 그 사람·사업 연결만 빠져요(복사해 둔 이름은 남아요).
//! - 업무일지: 기록과 날짜 머리 줄.
//! - 할 일: 항목만(목록은 남아요 – 사용자 ① 1안).
//! - 캘린더: 내 종류 일정만(공휴일·민원·할 일 마감은 저장된 일정이 아니에요). 종류는 남아요.
//! - 집행현황: 한 해 또는 모든 해. 팀 공유의 지움 표시는 화면이 맞추기로 보내요.
//! - 예산현황: 직접 적은 값·설정(`bstatus` 표).
//!
//! 지우기 전에(자료 안전 `export_backup` → `write_atomic`) `backup\gilog_YYYY-MM-DD_before-clear.gilogbak`을 남겨요(같은 날 또 지우면 `-2`, `-3`…, 최근 `BEFORE_CLEAR_KEEP`개).
//! 메모리 저장소(브라우저 미리 보기)는 백업 없이 지워요.

use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;
use serde::Serialize;

use crate::{Error, Result, Store, BACKUP_DIR};

/// 지우기 전 백업은 최근 몇 개까지 둘지
pub const BEFORE_CLEAR_KEEP: usize = 5;

/// 무엇을 지울지(화면 이름)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClearWhat {
    Complaints,
    Contacts,
    Journal,
    Tasks,
    Events,
    /// None = 모든 해
    Budget(Option<i64>),
    BStatus,
    All,
}

impl ClearWhat {
    /// 화면이 보내는 이름 → 무엇. 집행현황은 `year`(None이면 모든 해)를 함께 받아요.
    pub fn parse(what: &str, year: Option<i64>) -> Result<ClearWhat> {
        Ok(match what {
            "complaints" => ClearWhat::Complaints,
            "contacts" => ClearWhat::Contacts,
            "journal" => ClearWhat::Journal,
            "tasks" => ClearWhat::Tasks,
            "events" => ClearWhat::Events,
            "budget" => ClearWhat::Budget(year),
            "bstatus" => ClearWhat::BStatus,
            "all" => ClearWhat::All,
            _ => return Err(Error::Invalid(format!("지울 수 없는 이름: {what}"))),
        })
    }
}

/// 화면마다 지금 몇 건이 있는지(묻는 띠·줄 설명에 써요)
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearCounts {
    pub complaints: usize,
    pub cases: usize,
    pub contacts: usize,
    pub projects: usize,
    pub entries: usize,
    pub days: usize,
    pub tasks: usize,
    pub lists: usize,
    pub events: usize,
    /// 고른 해의 세부사업·공사
    pub budget_year_projects: usize,
    pub budget_year_rows: usize,
    /// 모든 해의 세부사업·공사
    pub budget_projects: usize,
    pub budget_rows: usize,
    pub bstatus: usize,
}

/// 지운 결과: 지운 건수(화면이 띠에 보인 큰 단위의 합)와 백업 경로(메모리 저장소면 None)
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleared {
    pub n: usize,
    pub backup: Option<String>,
}

fn count(c: &Connection, sql: &str) -> Result<usize> {
    let n: i64 = c.query_row(sql, [], |r| r.get(0))?;
    Ok(n as usize)
}

const MY_EVENTS: &str = "kind IN (SELECT id FROM cal_kinds WHERE system = '')";

// 지우는 일 하나하나 – 돌려주는 값은 띠에 보인 큰 단위(민원+민원처리 건, 연락처+사업 …)의 합이에요.

fn clear_complaints(c: &Connection) -> Result<usize> {
    let n = count(c, "SELECT COUNT(*) FROM complaints")? + count(c, "SELECT COUNT(*) FROM cases")?;
    c.execute_batch("DELETE FROM cases; DELETE FROM orders; DELETE FROM complaints;")?;
    Ok(n)
}

fn clear_contacts(c: &Connection) -> Result<usize> {
    let n = count(c, "SELECT COUNT(*) FROM contacts")? + count(c, "SELECT COUNT(*) FROM projects")?;
    c.execute_batch(
        "UPDATE works SET contact = NULL, project = NULL;
         UPDATE journal_entries SET project_id = NULL;
         DELETE FROM contact_projects; DELETE FROM contacts; DELETE FROM projects; DELETE FROM project_groups;",
    )?;
    Ok(n)
}

fn clear_journal(c: &Connection) -> Result<usize> {
    let n = count(c, "SELECT COUNT(*) FROM journal_entries")?;
    let n = if n == 0 { count(c, "SELECT COUNT(*) FROM journal_days")? } else { n };
    c.execute_batch("DELETE FROM journal_entries; DELETE FROM journal_days;")?;
    Ok(n)
}

fn clear_tasks(c: &Connection) -> Result<usize> {
    let n = count(c, "SELECT COUNT(*) FROM tasks")?;
    c.execute("DELETE FROM tasks", [])?;
    Ok(n)
}

fn clear_events(c: &Connection) -> Result<usize> {
    let n = count(c, &format!("SELECT COUNT(*) FROM events WHERE {MY_EVENTS}"))?;
    c.execute(&format!("DELETE FROM events WHERE {MY_EVENTS}"), [])?;
    Ok(n)
}

fn clear_budget(c: &Connection, year: Option<i64>) -> Result<usize> {
    let (pw, w) = match year {
        Some(y) => (format!("WHERE year = {y}"), format!("WHERE project IN (SELECT id FROM budget_projects WHERE year = {y})")),
        None => (String::new(), String::new()),
    };
    let n = count(c, &format!("SELECT COUNT(*) FROM budget_projects {pw}"))?
        + count(c, &format!("SELECT COUNT(*) FROM budget_rows WHERE item IN (SELECT id FROM budget_items {w})"))?;
    c.execute_batch(&format!(
        "DELETE FROM budget_rows WHERE item IN (SELECT id FROM budget_items {w});
         DELETE FROM budget_items {w};
         DELETE FROM budget_projects {pw};"
    ))?;
    Ok(n)
}

fn clear_bstatus(c: &Connection) -> Result<usize> {
    let n = count(c, "SELECT COUNT(*) FROM bstatus")?;
    c.execute("DELETE FROM bstatus", [])?;
    Ok(n)
}

fn clear_one(c: &Connection, what: ClearWhat) -> Result<usize> {
    match what {
        ClearWhat::Complaints => clear_complaints(c),
        ClearWhat::Contacts => clear_contacts(c),
        ClearWhat::Journal => clear_journal(c),
        ClearWhat::Tasks => clear_tasks(c),
        ClearWhat::Events => clear_events(c),
        ClearWhat::Budget(y) => clear_budget(c, y),
        ClearWhat::BStatus => clear_bstatus(c),
        // 전부: 자료만(설정·구글 연결·팀 공유 설정은 둠 – 사용자 ② 1안), 집행현황은 모든 해
        ClearWhat::All => Ok(clear_complaints(c)?
            + clear_contacts(c)?
            + clear_journal(c)?
            + clear_tasks(c)?
            + clear_events(c)?
            + clear_budget(c, None)?
            + clear_bstatus(c)?),
    }
}

impl Store {
    /// 화면마다 지금 건수. `year`는 집행현황 "그 해만"의 해예요.
    pub fn clear_counts(&self, year: i64) -> Result<ClearCounts> {
        let c = &self.conn;
        let rows_of = |w: &str| count(c, &format!("SELECT COUNT(*) FROM budget_rows WHERE item IN (SELECT id FROM budget_items WHERE project IN (SELECT id FROM budget_projects {w}))"));
        let yw = format!("WHERE year = {year}");
        Ok(ClearCounts {
            complaints: count(c, "SELECT COUNT(*) FROM complaints")?,
            cases: count(c, "SELECT COUNT(*) FROM cases")?,
            contacts: count(c, "SELECT COUNT(*) FROM contacts")?,
            projects: count(c, "SELECT COUNT(*) FROM projects")?,
            entries: count(c, "SELECT COUNT(*) FROM journal_entries")?,
            days: count(c, "SELECT COUNT(*) FROM journal_days")?,
            tasks: count(c, "SELECT COUNT(*) FROM tasks")?,
            lists: count(c, "SELECT COUNT(*) FROM task_lists")?,
            events: count(c, &format!("SELECT COUNT(*) FROM events WHERE {MY_EVENTS}"))?,
            budget_year_projects: count(c, &format!("SELECT COUNT(*) FROM budget_projects {yw}"))?,
            budget_year_rows: rows_of(&yw)?,
            budget_projects: count(c, "SELECT COUNT(*) FROM budget_projects")?,
            budget_rows: rows_of("")?,
            bstatus: count(c, "SELECT COUNT(*) FROM bstatus")?,
        })
    }

    /// 지우기 전에 백업을 남기고(파일 저장소만) 한 트랜잭션으로 지워요. 백업을 못 남기면 지우지 않아요.
    pub fn clear(&mut self, what: ClearWhat) -> Result<Cleared> {
        let backup = if self.is_memory() { None } else { Some(self.backup_before_clear()?.to_string_lossy().to_string()) };
        let tx = self.conn.transaction()?;
        let n = clear_one(&tx, what)?;
        tx.commit()?;
        Ok(Cleared { n, backup })
    }

    /// `backup\gilog_YYYY-MM-DD_before-clear.gilogbak`(같은 날이면 `-2`…)을 남기고 오래된 것은 지워요.
    pub fn backup_before_clear(&self) -> Result<PathBuf> {
        self.backup_before_clear_on(&crate::today())
    }

    pub(crate) fn backup_before_clear_on(&self, day: &str) -> Result<PathBuf> {
        let folder = self.dir.join(BACKUP_DIR);
        fs::create_dir_all(&folder)?;
        let mut path = folder.join(format!("gilog_{day}_before-clear.gilogbak"));
        let mut i = 2;
        while path.exists() {
            path = folder.join(format!("gilog_{day}_before-clear-{i}.gilogbak"));
            i += 1;
        }
        self.export_backup(&path)?;
        prune_before_clear(&folder);
        Ok(path)
    }
}

/// 지우기 전 백업은 만든 순서로 최근 `BEFORE_CLEAR_KEEP`개만 둬요.
fn prune_before_clear(folder: &std::path::Path) {
    let Ok(read) = fs::read_dir(folder) else {
        return;
    };
    let mut list: Vec<(std::time::SystemTime, PathBuf)> = read
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            n.starts_with("gilog_") && n.contains("_before-clear") && n.ends_with(".gilogbak")
        })
        .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), e.path()))
        .collect();
    list.sort();
    while list.len() > BEFORE_CLEAR_KEEP {
        let _ = fs::remove_file(list.remove(0).1);
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

    /// 화면마다 자료를 조금씩 넣어요.
    fn fill(s: &Store) {
        s.conn
            .execute_batch(
                "INSERT INTO complaints (no, received, intake, place, status) VALUES (1, '2026-10-01', '전화', '금촌동 1', '접수'), (2, '2026-10-02', '전화', '금촌동 2', '접수');
                 INSERT INTO works (name) VALUES ('도로 보수');
                 INSERT INTO orders (work, seq) VALUES (1, 1);
                 INSERT INTO cases (no, work, order_id, item) VALUES ('1AA-2610-0000001', 1, 1, 1);
                 INSERT INTO projects (name) VALUES ('시도15호선');
                 INSERT INTO project_groups (name) VALUES ('묶음');
                 INSERT INTO contacts (name) VALUES ('박주무관'), ('김대리');
                 INSERT INTO contact_projects VALUES (1, 1, 0);
                 UPDATE works SET contact = 1, project = 1;
                 INSERT INTO journal_days (date) VALUES ('2026-10-30');
                 INSERT INTO journal_entries (date, time, who, project_id) VALUES ('2026-10-30', '09:00', '박주무관', 1);
                 INSERT OR IGNORE INTO task_lists (name, builtin) VALUES ('민원', 1), ('행정업무', 0);
                 INSERT INTO tasks (list, title) VALUES (2, '보고서'), (2, '회의');
                 INSERT INTO cal_kinds (name) VALUES ('업무');
                 INSERT OR IGNORE INTO cal_kinds (name, system) VALUES ('공휴일', 'holiday');
                 INSERT INTO events (title, kind, date, end_date) VALUES ('현장 확인', (SELECT id FROM cal_kinds WHERE name = '업무'), '2026-10-30', '2026-10-30');
                 INSERT INTO budget_projects (year, name) VALUES (2025, '도로 유지'), (2026, '도로 유지'), (2026, '포장');
                 INSERT INTO budget_items (project, name) VALUES (1, '부기'), (2, '부기');
                 INSERT INTO budget_rows (item, name) VALUES (1, '공사 가'), (2, '공사 나'), (2, '공사 다');
                 INSERT INTO bstatus (name, setup) VALUES ('도로 유지', '{}');
                 INSERT INTO kv (key, value) VALUES ('settings', '{\"myName\":\"전훈민\"}');",
            )
            .unwrap();
    }

    fn n(s: &Store, t: &str) -> usize {
        count(&s.conn, &format!("SELECT COUNT(*) FROM {t}")).unwrap()
    }

    #[test]
    fn counts_each_screen() {
        let (_d, s) = store();
        fill(&s);
        let c = s.clear_counts(2026).unwrap();
        assert_eq!((c.complaints, c.cases, c.contacts, c.projects), (2, 1, 2, 1));
        assert_eq!((c.entries, c.days, c.tasks, c.events, c.bstatus), (1, 1, 2, 1, 1));
        assert_eq!((c.budget_year_projects, c.budget_year_rows, c.budget_projects, c.budget_rows), (2, 2, 3, 3));
    }

    #[test]
    fn complaints_take_cases_and_orders_but_keep_works() {
        let (_d, mut s) = store();
        fill(&s);
        let r = s.clear(ClearWhat::Complaints).unwrap();
        assert_eq!(r.n, 3);
        assert_eq!((n(&s, "complaints"), n(&s, "cases"), n(&s, "orders"), n(&s, "works")), (0, 0, 0, 1));
        assert_eq!(n(&s, "contacts"), 2);
    }

    #[test]
    fn contacts_leave_links_empty_and_names_in_journal() {
        let (_d, mut s) = store();
        fill(&s);
        assert_eq!(s.clear(ClearWhat::Contacts).unwrap().n, 3);
        assert_eq!((n(&s, "contacts"), n(&s, "projects"), n(&s, "project_groups"), n(&s, "contact_projects")), (0, 0, 0, 0));
        let (who, pid): (String, Option<i64>) = s.conn.query_row("SELECT who, project_id FROM journal_entries", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((who.as_str(), pid), ("박주무관", None));
        let link: (Option<i64>, Option<i64>) = s.conn.query_row("SELECT contact, project FROM works", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(link, (None, None));
    }

    #[test]
    fn tasks_keep_lists_and_events_keep_kinds() {
        let (_d, mut s) = store();
        fill(&s);
        let lists = n(&s, "task_lists");
        assert_eq!(s.clear(ClearWhat::Tasks).unwrap().n, 2);
        assert_eq!((n(&s, "tasks"), n(&s, "task_lists")), (0, lists));
        let kinds = n(&s, "cal_kinds");
        assert_eq!(s.clear(ClearWhat::Events).unwrap().n, 1);
        assert_eq!((n(&s, "events"), n(&s, "cal_kinds")), (0, kinds));
    }

    #[test]
    fn budget_one_year_or_all() {
        let (_d, mut s) = store();
        fill(&s);
        assert_eq!(s.clear(ClearWhat::Budget(Some(2026))).unwrap().n, 4);
        assert_eq!((n(&s, "budget_projects"), n(&s, "budget_items"), n(&s, "budget_rows")), (1, 1, 1));
        assert_eq!(s.clear(ClearWhat::Budget(None)).unwrap().n, 2);
        assert_eq!((n(&s, "budget_projects"), n(&s, "budget_items"), n(&s, "budget_rows")), (0, 0, 0));
        assert_eq!(n(&s, "bstatus"), 1);
    }

    #[test]
    fn journal_and_bstatus() {
        let (_d, mut s) = store();
        fill(&s);
        assert_eq!(s.clear(ClearWhat::Journal).unwrap().n, 1);
        assert_eq!((n(&s, "journal_entries"), n(&s, "journal_days")), (0, 0));
        assert_eq!(s.clear(ClearWhat::BStatus).unwrap().n, 1);
        assert_eq!(n(&s, "bstatus"), 0);
    }

    #[test]
    fn all_clears_data_keeps_settings_and_makes_backup() {
        let (d, mut s) = store();
        fill(&s);
        let r = s.clear(ClearWhat::All).unwrap();
        // 민원 2+건 1 · 연락처 2+사업 1 · 일지 1 · 할 일 2 · 일정 1 · 집행 3+3 · 예산 1
        assert_eq!(r.n, 17);
        for t in ["complaints", "cases", "contacts", "projects", "journal_entries", "tasks", "events", "budget_projects", "budget_rows", "bstatus"] {
            assert_eq!(n(&s, t), 0, "{t}");
        }
        assert_eq!(s.get("settings").unwrap().as_deref(), Some("{\"myName\":\"전훈민\"}"));
        assert!(n(&s, "task_lists") >= 2 && n(&s, "works") == 1);
        let b = PathBuf::from(r.backup.unwrap());
        assert!(b.starts_with(d.path().join(BACKUP_DIR)) && b.is_file());
        assert!(b.file_name().unwrap().to_string_lossy().ends_with("_before-clear.gilogbak"));
    }

    #[test]
    fn backup_names_same_day_and_keeps_recent() {
        let (d, s) = store();
        let a = s.backup_before_clear_on("2026-10-30").unwrap();
        let b = s.backup_before_clear_on("2026-10-30").unwrap();
        assert!(a.to_string_lossy().ends_with("gilog_2026-10-30_before-clear.gilogbak"));
        assert!(b.to_string_lossy().ends_with("gilog_2026-10-30_before-clear-2.gilogbak"));
        for _ in 0..6 {
            s.backup_before_clear_on("2026-10-30").unwrap();
        }
        let left = fs::read_dir(d.path().join(BACKUP_DIR)).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().contains("_before-clear")).count();
        assert_eq!(left, BEFORE_CLEAR_KEEP);
        // 하루 자동 백업 목록에는 섞이지 않아요.
        assert!(crate::daily_backups(d.path()).is_empty());
    }

    #[test]
    fn backup_is_restorable() {
        let (d, mut s) = store();
        fill(&s);
        let r = s.clear(ClearWhat::Complaints).unwrap();
        drop(s);
        let path = PathBuf::from(r.backup.unwrap());
        let other = tempfile::tempdir().unwrap();
        crate::restore_backup(other.path(), &path, "1234").unwrap();
        let back = Store::open(other.path(), "1234").unwrap();
        assert_eq!(n(&back, "complaints"), 2);
        drop(d);
    }

    #[test]
    fn memory_store_clears_without_backup() {
        let mut s = Store::memory("1234").unwrap();
        fill(&s);
        let r = s.clear(ClearWhat::parse("all", None).unwrap()).unwrap();
        assert_eq!((r.n, r.backup), (17, None));
        assert!(ClearWhat::parse("모름", None).is_err());
    }
}
