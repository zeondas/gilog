//! 집행현황(12단계): 해마다 세부사업 → 부기사업(산출항목) → 공사(용역·물품) 세 겹이에요.
//!
//! - 금액은 모두 원 단위 정수예요(십원 단위부터 — 1원 자리는 0). 화면의 원/천원은 보기만 바꿔요.
//! - 예산은 세부사업·부기사업에만 있어요(비어 있을 수 있음). 공사는 원인행위·집행액·시공량(사용량).
//! - 잔액·집행률·가용액은 저장하지 않고 화면·엑셀이 계산해요(src/budget.ts).
//! - 바꾸는 명령은 그 해 전체를 돌려줘요(한 해가 수백 줄이라 가벼워요).
//! - 메모는 메모 편집기의 HTML(머릿기호 □●-, 표 없음)이에요. 글자가 없으면 빈 글자로 둬요(화면이 판단).

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::{Error, Result, Store};

/// 공사 구분(사용자 2026-10-18)
pub const BUDGET_KINDS: [&str; 4] = ["공사", "관급", "용역", "일반"];
/// 단계 — 순서도 이대로(사용자 2026-10-18). 타절은 완료처럼, 중지는 추진처럼 계산해요.
pub const BUDGET_STAGES: [&str; 5] = ["준비", "추진", "완료", "중지", "타절"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetRow {
    pub id: i64,
    pub name: String,
    pub kind: String,
    /// 업체(하도)
    pub co: String,
    /// 원인행위
    pub cmt: i64,
    /// 집행액
    pub exp: i64,
    /// 시공량(사용량)
    pub act: i64,
    pub stage: String,
    pub memo: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetItem {
    pub id: i64,
    pub name: String,
    pub budget: Option<i64>,
    pub open: bool,
    pub memo: String,
    pub rows: Vec<BudgetRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetProject {
    pub id: i64,
    pub year: i64,
    pub name: String,
    pub budget: Option<i64>,
    /// 이월 사업(표 아래 "이월 사업" 묶음)
    pub carry: bool,
    pub open: bool,
    pub memo: String,
    pub items: Vec<BudgetItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BudgetRowInput {
    pub name: String,
    pub kind: String,
    pub co: String,
    pub cmt: i64,
    pub exp: i64,
    pub act: i64,
    pub stage: String,
}

/// 엑셀 가져오기 한 세부사업(부기사업·공사까지)
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BudgetImportProject {
    pub name: String,
    pub budget: Option<i64>,
    pub carry: bool,
    pub memo: String,
    pub items: Vec<BudgetImportItem>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BudgetImportItem {
    pub name: String,
    pub budget: Option<i64>,
    pub memo: String,
    pub rows: Vec<BudgetImportRow>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BudgetImportRow {
    #[serde(flatten)]
    pub input: BudgetRowInput,
    pub memo: String,
}

/// 어느 겹인지(우클릭 메뉴의 대상)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BudgetLevel {
    Project,
    Item,
    Row,
}

pub(crate) const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS budget_projects (
        id     INTEGER PRIMARY KEY,
        year   INTEGER NOT NULL,
        ord    INTEGER NOT NULL DEFAULT 0,
        name   TEXT NOT NULL,
        budget INTEGER,
        carry  INTEGER NOT NULL DEFAULT 0,
        open   INTEGER NOT NULL DEFAULT 1,
        memo   TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS budget_projects_year ON budget_projects(year);
    CREATE TABLE IF NOT EXISTS budget_items (
        id      INTEGER PRIMARY KEY,
        project INTEGER NOT NULL REFERENCES budget_projects(id) ON DELETE CASCADE,
        ord     INTEGER NOT NULL DEFAULT 0,
        name    TEXT NOT NULL,
        budget  INTEGER,
        open    INTEGER NOT NULL DEFAULT 0,
        memo    TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS budget_rows (
        id    INTEGER PRIMARY KEY,
        item  INTEGER NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
        ord   INTEGER NOT NULL DEFAULT 0,
        name  TEXT NOT NULL,
        kind  TEXT NOT NULL DEFAULT '공사',
        co    TEXT NOT NULL DEFAULT '',
        cmt   INTEGER NOT NULL DEFAULT 0,
        exp   INTEGER NOT NULL DEFAULT 0,
        act   INTEGER NOT NULL DEFAULT 0,
        stage TEXT NOT NULL DEFAULT '준비',
        memo  TEXT NOT NULL DEFAULT ''
    );
";

fn bad(msg: &str) -> Error {
    Error::Invalid(msg.into())
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn name_of(s: &str) -> Result<String> {
    let n = one_line(s);
    if n.is_empty() {
        return Err(bad("이름이 비어 있어요"));
    }
    Ok(n)
}

/// 금액은 십원 단위부터(1원 자리 0)예요.
fn won(v: i64) -> Result<i64> {
    if v % 10 != 0 {
        return Err(bad("금액은 십원 단위로 적어 주세요"));
    }
    Ok(v)
}

fn won_opt(v: Option<i64>) -> Result<Option<i64>> {
    v.map(won).transpose()
}

fn clean_row(r: &BudgetRowInput) -> Result<BudgetRowInput> {
    let kind = if r.kind.trim().is_empty() { "공사".to_string() } else { r.kind.trim().to_string() };
    if !BUDGET_KINDS.contains(&kind.as_str()) {
        return Err(bad("구분은 공사·관급·용역·일반이에요"));
    }
    let stage = if r.stage.trim().is_empty() { "준비".to_string() } else { r.stage.trim().to_string() };
    if !BUDGET_STAGES.contains(&stage.as_str()) {
        return Err(bad("단계는 준비·추진·완료·중지·타절이에요"));
    }
    Ok(BudgetRowInput {
        name: name_of(&r.name)?,
        kind,
        co: one_line(&r.co),
        cmt: won(r.cmt)?,
        exp: won(r.exp)?,
        act: won(r.act)?,
        stage,
    })
}

fn read_year(conn: &Connection, year: i64) -> Result<Vec<BudgetProject>> {
    let mut ps = conn.prepare("SELECT id, name, budget, carry, open, memo FROM budget_projects WHERE year = ?1 ORDER BY carry, ord, id")?;
    let mut projects = ps
        .query_map(params![year], |r| {
            Ok(BudgetProject {
                id: r.get(0)?,
                year,
                name: r.get(1)?,
                budget: r.get(2)?,
                carry: r.get::<_, i64>(3)? != 0,
                open: r.get::<_, i64>(4)? != 0,
                memo: r.get(5)?,
                items: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut is = conn.prepare("SELECT id, name, budget, open, memo FROM budget_items WHERE project = ?1 ORDER BY ord, id")?;
    let mut rs = conn.prepare("SELECT id, name, kind, co, cmt, exp, act, stage, memo FROM budget_rows WHERE item = ?1 ORDER BY ord, id")?;
    for p in projects.iter_mut() {
        p.items = is
            .query_map(params![p.id], |r| {
                Ok(BudgetItem {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    budget: r.get(2)?,
                    open: r.get::<_, i64>(3)? != 0,
                    memo: r.get(4)?,
                    rows: Vec::new(),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for it in p.items.iter_mut() {
            it.rows = rs
                .query_map(params![it.id], |r| {
                    Ok(BudgetRow {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        kind: r.get(2)?,
                        co: r.get(3)?,
                        cmt: r.get(4)?,
                        exp: r.get(5)?,
                        act: r.get(6)?,
                        stage: r.get(7)?,
                        memo: r.get(8)?,
                    })
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;
        }
    }
    Ok(projects)
}

fn year_of_project(conn: &Connection, id: i64) -> Result<i64> {
    conn.query_row("SELECT year FROM budget_projects WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .ok_or(Error::NotFound)
}

fn project_of_item(conn: &Connection, id: i64) -> Result<i64> {
    conn.query_row("SELECT project FROM budget_items WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .ok_or(Error::NotFound)
}

fn item_of_row(conn: &Connection, id: i64) -> Result<i64> {
    conn.query_row("SELECT item FROM budget_rows WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .ok_or(Error::NotFound)
}

/// 그 대상이 든 해
fn year_of(conn: &Connection, level: BudgetLevel, id: i64) -> Result<i64> {
    match level {
        BudgetLevel::Project => year_of_project(conn, id),
        BudgetLevel::Item => year_of_project(conn, project_of_item(conn, id)?),
        BudgetLevel::Row => year_of_project(conn, project_of_item(conn, item_of_row(conn, id)?)?),
    }
}

/// 순서를 0,1,2…로 다시 매겨요.
fn renumber(tx: &Transaction, table: &str, parent_col: &str, parent: i64, order: &[i64]) -> Result<()> {
    let sql = format!("UPDATE {table} SET ord = ?1 WHERE id = ?2 AND {parent_col} = ?3");
    for (i, id) in order.iter().enumerate() {
        tx.execute(&sql, params![i as i64, id, parent])?;
    }
    Ok(())
}

fn ids(tx: &Transaction, sql: &str, parent: i64) -> Result<Vec<i64>> {
    let mut s = tx.prepare(sql)?;
    let v = s.query_map(params![parent], |r| r.get(0))?.collect::<std::result::Result<Vec<i64>, _>>()?;
    Ok(v)
}

fn insert_row(tx: &Transaction, item: i64, ord: i64, r: &BudgetRowInput, memo: &str) -> Result<i64> {
    tx.execute(
        "INSERT INTO budget_rows (item, ord, name, kind, co, cmt, exp, act, stage, memo) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![item, ord, r.name, r.kind, r.co, r.cmt, r.exp, r.act, r.stage, memo],
    )?;
    Ok(tx.last_insert_rowid())
}

impl Store {
    /// 그 해 집행현황 전체(세부사업 순서 → 부기사업 → 공사)
    pub fn budget_data(&self, year: i64) -> Result<Vec<BudgetProject>> {
        read_year(&self.conn, year)
    }

    /// 세부사업을 더하거나(id 없음, after 다음 자리 — 없으면 맨 위) 이름·예산을 고쳐요.
    pub fn save_budget_project(
        &mut self,
        year: i64,
        id: Option<i64>,
        after: Option<i64>,
        name: &str,
        budget: Option<i64>,
    ) -> Result<Vec<BudgetProject>> {
        let name = name_of(name)?;
        let budget = won_opt(budget)?;
        let tx = self.conn.transaction()?;
        let year = match id {
            Some(id) => {
                let y = year_of_project(&tx, id)?;
                tx.execute("UPDATE budget_projects SET name = ?2, budget = ?3 WHERE id = ?1", params![id, name, budget])?;
                y
            }
            None => {
                let mut order = ids(&tx, "SELECT id FROM budget_projects WHERE year = ?1 ORDER BY carry, ord, id", year)?;
                tx.execute(
                    "INSERT INTO budget_projects (year, ord, name, budget, open) VALUES (?1, 0, ?2, ?3, 1)",
                    params![year, name, budget],
                )?;
                let new = tx.last_insert_rowid();
                let at = after.and_then(|a| order.iter().position(|x| *x == a)).map(|i| i + 1).unwrap_or(0);
                order.insert(at, new);
                renumber(&tx, "budget_projects", "year", year, &order)?;
                year
            }
        };
        tx.commit()?;
        self.budget_data(year)
    }

    /// 부기사업을 더하거나(맨 위에) 고쳐요.
    pub fn save_budget_item(&mut self, project: i64, id: Option<i64>, name: &str, budget: Option<i64>) -> Result<Vec<BudgetProject>> {
        let name = name_of(name)?;
        let budget = won_opt(budget)?;
        let tx = self.conn.transaction()?;
        match id {
            Some(id) => {
                tx.execute("UPDATE budget_items SET name = ?2, budget = ?3 WHERE id = ?1", params![id, name, budget])?;
            }
            None => {
                year_of_project(&tx, project)?;
                let mut order = ids(&tx, "SELECT id FROM budget_items WHERE project = ?1 ORDER BY ord, id", project)?;
                tx.execute(
                    "INSERT INTO budget_items (project, ord, name, budget, open) VALUES (?1, 0, ?2, ?3, 1)",
                    params![project, name, budget],
                )?;
                order.insert(0, tx.last_insert_rowid());
                renumber(&tx, "budget_items", "project", project, &order)?;
                tx.execute("UPDATE budget_projects SET open = 1 WHERE id = ?1", params![project])?;
            }
        }
        let year = match id {
            Some(id) => year_of(&tx, BudgetLevel::Item, id)?,
            None => year_of_project(&tx, project)?,
        };
        tx.commit()?;
        self.budget_data(year)
    }

    /// 공사를 더하거나(그 부기사업 맨 아래) 고쳐요.
    pub fn save_budget_row(&mut self, item: i64, id: Option<i64>, input: &BudgetRowInput) -> Result<(Vec<BudgetProject>, i64)> {
        let r = clean_row(input)?;
        let tx = self.conn.transaction()?;
        let id = match id {
            Some(id) => {
                let n = tx.execute(
                    "UPDATE budget_rows SET name = ?2, kind = ?3, co = ?4, cmt = ?5, exp = ?6, act = ?7, stage = ?8 WHERE id = ?1",
                    params![id, r.name, r.kind, r.co, r.cmt, r.exp, r.act, r.stage],
                )?;
                if n == 0 {
                    return Err(Error::NotFound);
                }
                id
            }
            None => {
                let p = project_of_item(&tx, item)?;
                let ord: i64 = tx.query_row("SELECT COALESCE(MAX(ord), -1) + 1 FROM budget_rows WHERE item = ?1", params![item], |x| x.get(0))?;
                let id = insert_row(&tx, item, ord, &r, "")?;
                tx.execute("UPDATE budget_items SET open = 1 WHERE id = ?1", params![item])?;
                tx.execute("UPDATE budget_projects SET open = 1 WHERE id = ?1", params![p])?;
                id
            }
        };
        let year = year_of(&tx, BudgetLevel::Row, id)?;
        tx.commit()?;
        Ok((self.budget_data(year)?, id))
    }

    pub fn set_budget_stage(&self, id: i64, stage: &str) -> Result<Vec<BudgetProject>> {
        if !BUDGET_STAGES.contains(&stage) {
            return Err(bad("단계는 준비·추진·완료·중지·타절이에요"));
        }
        if self.conn.execute("UPDATE budget_rows SET stage = ?2 WHERE id = ?1", params![id, stage])? == 0 {
            return Err(Error::NotFound);
        }
        self.budget_data(year_of(&self.conn, BudgetLevel::Row, id)?)
    }

    pub fn set_budget_memo(&self, level: BudgetLevel, id: i64, memo: &str) -> Result<Vec<BudgetProject>> {
        let table = match level {
            BudgetLevel::Project => "budget_projects",
            BudgetLevel::Item => "budget_items",
            BudgetLevel::Row => "budget_rows",
        };
        let memo = memo.trim();
        if self.conn.execute(&format!("UPDATE {table} SET memo = ?2 WHERE id = ?1"), params![id, memo])? == 0 {
            return Err(Error::NotFound);
        }
        self.budget_data(year_of(&self.conn, level, id)?)
    }

    /// 접기·펼치기. 세부사업에 all을 주면 딸린 부기사업도 모두 그렇게 해요(세부사업은 펼침).
    pub fn set_budget_open(&self, level: BudgetLevel, id: i64, open: bool, all: bool) -> Result<Vec<BudgetProject>> {
        match level {
            BudgetLevel::Project if all => {
                self.conn.execute("UPDATE budget_items SET open = ?2 WHERE project = ?1", params![id, open as i64])?;
                self.conn.execute("UPDATE budget_projects SET open = 1 WHERE id = ?1", params![id])?;
            }
            BudgetLevel::Project => {
                self.conn.execute("UPDATE budget_projects SET open = ?2 WHERE id = ?1", params![id, open as i64])?;
            }
            BudgetLevel::Item => {
                self.conn.execute("UPDATE budget_items SET open = ?2 WHERE id = ?1", params![id, open as i64])?;
            }
            BudgetLevel::Row => return Err(bad("공사는 접지 않아요")),
        }
        self.budget_data(year_of(&self.conn, level, id)?)
    }

    /// 위로(-1)·아래로(+1) 한 칸. 세부사업은 이월 묶음 안에서만 움직여요.
    pub fn move_budget(&mut self, level: BudgetLevel, id: i64, dir: i64) -> Result<Vec<BudgetProject>> {
        let tx = self.conn.transaction()?;
        let (table, col, parent, mut order) = match level {
            BudgetLevel::Project => {
                let (y, carry): (i64, i64) =
                    tx.query_row("SELECT year, carry FROM budget_projects WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
                        .optional()?
                        .ok_or(Error::NotFound)?;
                let mut s = tx.prepare("SELECT id FROM budget_projects WHERE year = ?1 AND carry = ?2 ORDER BY ord, id")?;
                let o = s.query_map(params![y, carry], |r| r.get(0))?.collect::<std::result::Result<Vec<i64>, _>>()?;
                drop(s);
                ("budget_projects", "year", y, o)
            }
            BudgetLevel::Item => {
                let p = project_of_item(&tx, id)?;
                let o = ids(&tx, "SELECT id FROM budget_items WHERE project = ?1 ORDER BY ord, id", p)?;
                ("budget_items", "project", p, o)
            }
            BudgetLevel::Row => {
                let it = item_of_row(&tx, id)?;
                let o = ids(&tx, "SELECT id FROM budget_rows WHERE item = ?1 ORDER BY ord, id", it)?;
                ("budget_rows", "item", it, o)
            }
        };
        let i = order.iter().position(|x| *x == id).ok_or(Error::NotFound)? as i64;
        let j = i + dir.signum();
        if j >= 0 && (j as usize) < order.len() {
            order.swap(i as usize, j as usize);
            renumber(&tx, table, col, parent, &order)?;
        }
        let year = year_of(&tx, level, id)?;
        tx.commit()?;
        self.budget_data(year)
    }

    /// 부기사업을 다른 세부사업(같은 해) 맨 아래로 옮겨요. 같은 이름이 있으면 안 옮겨요.
    pub fn move_budget_item(&mut self, id: i64, to_project: i64) -> Result<Vec<BudgetProject>> {
        let tx = self.conn.transaction()?;
        let from = project_of_item(&tx, id)?;
        let (fy, ty) = (year_of_project(&tx, from)?, year_of_project(&tx, to_project)?);
        if fy != ty {
            return Err(bad("같은 해의 세부사업으로만 옮겨요"));
        }
        let name: String = tx.query_row("SELECT name FROM budget_items WHERE id = ?1", params![id], |r| r.get(0))?;
        let dup: i64 = tx.query_row(
            "SELECT count(*) FROM budget_items WHERE project = ?1 AND name = ?2 AND id <> ?3",
            params![to_project, name, id],
            |r| r.get(0),
        )?;
        if dup > 0 {
            return Err(bad("같은 이름의 부기사업이 있어요"));
        }
        let ord: i64 = tx.query_row("SELECT COALESCE(MAX(ord), -1) + 1 FROM budget_items WHERE project = ?1", params![to_project], |r| r.get(0))?;
        tx.execute("UPDATE budget_items SET project = ?2, ord = ?3 WHERE id = ?1", params![id, to_project, ord])?;
        tx.execute("UPDATE budget_projects SET open = 1 WHERE id = ?1", params![to_project])?;
        tx.commit()?;
        self.budget_data(fy)
    }

    /// 공사를 다른 부기사업(같은 해) 맨 아래로 옮겨요.
    pub fn move_budget_row(&mut self, id: i64, to_item: i64) -> Result<Vec<BudgetProject>> {
        let tx = self.conn.transaction()?;
        let fy = year_of(&tx, BudgetLevel::Row, id)?;
        let ty = year_of(&tx, BudgetLevel::Item, to_item)?;
        if fy != ty {
            return Err(bad("같은 해의 부기사업으로만 옮겨요"));
        }
        let ord: i64 = tx.query_row("SELECT COALESCE(MAX(ord), -1) + 1 FROM budget_rows WHERE item = ?1", params![to_item], |r| r.get(0))?;
        tx.execute("UPDATE budget_rows SET item = ?2, ord = ?3 WHERE id = ?1", params![id, to_item, ord])?;
        let p = project_of_item(&tx, to_item)?;
        tx.execute("UPDATE budget_items SET open = 1 WHERE id = ?1", params![to_item])?;
        tx.execute("UPDATE budget_projects SET open = 1 WHERE id = ?1", params![p])?;
        tx.commit()?;
        self.budget_data(fy)
    }

    /// 지워요. 세부사업·부기사업은 딸린 것도 함께 지워져요.
    pub fn delete_budget(&mut self, level: BudgetLevel, id: i64) -> Result<Vec<BudgetProject>> {
        let tx = self.conn.transaction()?;
        let year = year_of(&tx, level, id)?;
        match level {
            BudgetLevel::Project => {
                tx.execute("DELETE FROM budget_rows WHERE item IN (SELECT id FROM budget_items WHERE project = ?1)", params![id])?;
                tx.execute("DELETE FROM budget_items WHERE project = ?1", params![id])?;
                tx.execute("DELETE FROM budget_projects WHERE id = ?1", params![id])?;
            }
            BudgetLevel::Item => {
                tx.execute("DELETE FROM budget_rows WHERE item = ?1", params![id])?;
                tx.execute("DELETE FROM budget_items WHERE id = ?1", params![id])?;
            }
            BudgetLevel::Row => {
                tx.execute("DELETE FROM budget_rows WHERE id = ?1", params![id])?;
            }
        }
        tx.commit()?;
        self.budget_data(year)
    }

    /// 전년도에서 세부사업·부기사업(이름·예산)만 복사해요. 이월 사업과 공사는 빼요. 이미 자료가 있는 해에는 하지 않아요.
    pub fn copy_budget_year(&mut self, from: i64, to: i64) -> Result<Vec<BudgetProject>> {
        let src = read_year(&self.conn, from)?;
        if src.iter().all(|p| p.carry) {
            return Err(bad("복사할 세부사업이 없어요"));
        }
        if !read_year(&self.conn, to)?.is_empty() {
            return Err(bad("그 해에는 이미 세부사업이 있어요"));
        }
        let tx = self.conn.transaction()?;
        for (i, p) in src.iter().filter(|p| !p.carry).enumerate() {
            tx.execute(
                "INSERT INTO budget_projects (year, ord, name, budget, open) VALUES (?1, ?2, ?3, ?4, 1)",
                params![to, i as i64, p.name, p.budget],
            )?;
            let pid = tx.last_insert_rowid();
            for (j, it) in p.items.iter().enumerate() {
                tx.execute(
                    "INSERT INTO budget_items (project, ord, name, budget, open) VALUES (?1, ?2, ?3, ?4, 0)",
                    params![pid, j as i64, it.name, it.budget],
                )?;
            }
        }
        tx.commit()?;
        self.budget_data(to)
    }

    /// 엑셀에서 읽은 세부사업을 그 해 맨 아래(이월은 이월 묶음 아래)에 넣어요. 넣은 공사 수를 함께 돌려줘요.
    pub fn import_budget(&mut self, year: i64, list: &[BudgetImportProject]) -> Result<(Vec<BudgetProject>, usize)> {
        let tx = self.conn.transaction()?;
        let mut ord: i64 = tx.query_row("SELECT COALESCE(MAX(ord), -1) + 1 FROM budget_projects WHERE year = ?1", params![year], |r| r.get(0))?;
        let mut n = 0;
        for p in list {
            let pname = name_of(&p.name)?;
            tx.execute(
                "INSERT INTO budget_projects (year, ord, name, budget, carry, open, memo) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
                params![year, ord, pname, won_opt(p.budget)?, p.carry as i64, p.memo.trim()],
            )?;
            ord += 1;
            let pid = tx.last_insert_rowid();
            for (j, it) in p.items.iter().enumerate() {
                tx.execute(
                    "INSERT INTO budget_items (project, ord, name, budget, open, memo) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                    params![pid, j as i64, name_of(&it.name)?, won_opt(it.budget)?, it.memo.trim()],
                )?;
                let iid = tx.last_insert_rowid();
                for (k, r) in it.rows.iter().enumerate() {
                    insert_row(&tx, iid, k as i64, &clean_row(&r.input)?, r.memo.trim())?;
                    n += 1;
                }
            }
        }
        tx.commit()?;
        Ok((self.budget_data(year)?, n))
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

    fn row(name: &str, cmt: i64) -> BudgetRowInput {
        BudgetRowInput { name: name.into(), cmt, ..Default::default() }
    }

    #[test]
    fn three_levels_and_order() {
        let (_d, mut s) = store();
        let y = s.save_budget_project(2026, None, None, " 도로포장  유지관리 ", Some(1_724_000_000)).unwrap();
        assert_eq!((y[0].name.as_str(), y[0].budget), ("도로포장 유지관리", Some(1_724_000_000)));
        let a = y[0].id;
        // 선택한 세부사업 다음 자리에 들어가요. 없으면 맨 위.
        let y = s.save_budget_project(2026, None, Some(a), "나", None).unwrap();
        assert_eq!(y.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["도로포장 유지관리", "나"]);
        let y = s.save_budget_project(2026, None, None, "맨 위", None).unwrap();
        assert_eq!(y[0].name, "맨 위");
        // 부기사업은 맨 위에, 공사는 맨 아래에 들어가요.
        let y = s.save_budget_item(a, None, "사무관리비", Some(3_000_000)).unwrap();
        let y2 = s.save_budget_item(a, None, "시도", Some(685_000_000)).unwrap();
        let _ = y;
        let p = y2.iter().find(|p| p.id == a).unwrap();
        assert_eq!(p.items[0].name, "시도");
        let it = p.items[0].id;
        let (_, r1) = s.save_budget_row(it, None, &row("하반기", 87_239_870)).unwrap();
        let (y, r2) = s.save_budget_row(it, None, &BudgetRowInput { kind: "관급".into(), stage: "추진".into(), ..row("상반기", 10) }).unwrap();
        let rows = &y.iter().find(|p| p.id == a).unwrap().items[0].rows;
        assert_eq!(rows.iter().map(|r| (r.id, r.kind.as_str(), r.stage.as_str())).collect::<Vec<_>>(), [(r1, "공사", "준비"), (r2, "관급", "추진")]);
        // 금액은 십원 단위, 구분·단계는 정해진 것만
        assert!(s.save_budget_row(it, None, &row("x", 15)).is_err());
        assert!(s.save_budget_row(it, None, &BudgetRowInput { kind: "기타".into(), ..row("x", 10) }).is_err());
        assert!(s.set_budget_stage(r1, "추진중").is_err());
        let y = s.set_budget_stage(r1, "타절").unwrap();
        assert_eq!(y.iter().find(|p| p.id == a).unwrap().items[0].rows[0].stage, "타절");
        // 옮기기
        let y = s.move_budget(BudgetLevel::Row, r2, -1).unwrap();
        assert_eq!(y.iter().find(|p| p.id == a).unwrap().items[0].rows[0].id, r2);
        let b = y.iter().find(|p| p.name == "나").unwrap().id;
        let y = s.save_budget_item(b, None, "시도", None).unwrap();
        let other = y.iter().find(|p| p.id == b).unwrap().items[0].id;
        assert!(s.move_budget_item(it, b).is_err(), "같은 이름이 있으면 안 옮겨요");
        let y = s.move_budget_row(r1, other).unwrap();
        assert_eq!(y.iter().find(|p| p.id == b).unwrap().items[0].rows[0].id, r1);
        // 지우기는 딸린 것까지
        let y = s.delete_budget(BudgetLevel::Project, b).unwrap();
        assert!(y.iter().all(|p| p.id != b));
        let n: i64 = s.conn.query_row("SELECT count(*) FROM budget_rows", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn memo_open_copy_import() {
        let (_d, mut s) = store();
        let y = s.save_budget_project(2025, None, None, "가", Some(100_000_000)).unwrap();
        let a = y[0].id;
        let y = s.save_budget_item(a, None, "부기", Some(50_000_000)).unwrap();
        let it = y[0].items[0].id;
        s.save_budget_row(it, None, &row("공사", 1_000)).unwrap();
        let y = s.set_budget_memo(BudgetLevel::Item, it, " <ul><li>메모</li></ul> ").unwrap();
        assert_eq!(y[0].items[0].memo, "<ul><li>메모</li></ul>");
        let y = s.set_budget_open(BudgetLevel::Project, a, false, true).unwrap();
        assert!(y[0].open && !y[0].items[0].open);
        s.import_budget(2025, &[BudgetImportProject { name: "(명시이월) 다".into(), carry: true, ..Default::default() }]).unwrap();
        // 복사: 이월·공사 빼고 이름·예산만
        let y = s.copy_budget_year(2025, 2026).unwrap();
        assert_eq!(y.len(), 1);
        assert_eq!((y[0].name.as_str(), y[0].items[0].budget, y[0].items[0].rows.len()), ("가", Some(50_000_000), 0));
        assert!(s.copy_budget_year(2025, 2026).is_err(), "이미 있는 해에는 안 해요");
        // 가져오기: 맨 아래에 넣고 공사 수를 돌려줘요. 이월은 표 아래 묶음.
        let (y, n) = s
            .import_budget(
                2026,
                &[BudgetImportProject {
                    name: "(사고이월) 라".into(),
                    budget: Some(49_050_000),
                    carry: true,
                    items: vec![BudgetImportItem {
                        name: "라".into(),
                        rows: vec![BudgetImportRow { input: row("설계", 49_050_000), memo: "".into() }],
                        ..Default::default()
                    }],
                    ..Default::default()
                }, BudgetImportProject { name: "마".into(), ..Default::default() }],
            )
            .unwrap();
        assert_eq!(n, 1);
        assert_eq!(y.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["가", "마", "(사고이월) 라"]);
        assert!(s.budget_data(2027).unwrap().is_empty());
    }
}
