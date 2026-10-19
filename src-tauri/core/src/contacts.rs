//! 업무연락처: 사람(연락처)과 프로젝트를 저장해요.
//!
//! - 연락처 한 사람에 프로젝트를 여러 개 붙일 수 있어요. 없는 프로젝트 이름을 적으면 새로 만들어요.
//! - 프로젝트를 지우면 사람은 남고 배지만 빠져요.
//! - 메모는 화면이 정한 모양(줄마다 굵게·취소선·글머리 기호)을 JSON 글자로 그대로 담아요.

use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::{Error, Result, Store};

/// 화면에서 연락처를 등록하거나 고칠 때 보내는 값이에요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContactInput {
    pub name: String,
    pub org: String,
    pub role: String,
    pub mobile: String,
    pub tel: String,
    pub email: String,
    /// 프로젝트 이름들. 없는 이름은 새로 만들어요.
    pub projects: Vec<String>,
}

/// 엑셀에서 가져온 한 줄이에요. 앱이 판단하지 않고 그대로 넣어요(이름이 비어 있어도).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ContactImport {
    #[serde(flatten)]
    pub input: ContactInput,
    /// 메모(JSON 글자)
    pub memo: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: i64,
    pub name: String,
    pub org: String,
    pub role: String,
    pub mobile: String,
    pub tel: String,
    pub email: String,
    /// 메모(JSON 글자). 비어 있으면 메모가 없어요.
    pub memo: String,
    /// 붙은 프로젝트 번호. 적은 순서대로예요.
    pub projects: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    /// 정식 이름(문서용). 줄인 이름만 적었으면 줄인 이름과 같아요. 비어 있지 않아요.
    pub name: String,
    /// 줄인 이름(관리용). 없으면 빈 글자예요. 화면은 줄인 이름 → 정식 이름 순으로 보여요.
    pub alias: String,
    /// 직접 고른 색 번호. 없으면 자동이에요.
    pub color: Option<i64>,
    /// 그룹 번호. 없으면 "그룹 없음"이에요(2026-10-19 사용자).
    pub group: Option<i64>,
}

/// 프로젝트 그룹. 순서(ord)대로 보여요.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGroup {
    pub id: i64,
    pub name: String,
}

/// 업무연락처 화면이 한 번에 받는 자료예요.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactsData {
    pub contacts: Vec<Contact>,
    pub projects: Vec<Project>,
    pub groups: Vec<ProjectGroup>,
}

/// 프로젝트 색은 0~7 여덟 가지예요.
pub const PROJECT_COLORS: i64 = 8;

pub(crate) const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS projects (
        id    INTEGER PRIMARY KEY,
        name  TEXT NOT NULL UNIQUE,
        color INTEGER,
        alias TEXT NOT NULL DEFAULT '',
        group_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS project_groups (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        ord  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS contacts (
        id      INTEGER PRIMARY KEY,
        name    TEXT NOT NULL,
        org     TEXT NOT NULL DEFAULT '',
        role    TEXT NOT NULL DEFAULT '',
        mobile  TEXT NOT NULL DEFAULT '',
        tel     TEXT NOT NULL DEFAULT '',
        email   TEXT NOT NULL DEFAULT '',
        memo    TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS contact_projects (
        contact_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        pos        INTEGER NOT NULL,
        PRIMARY KEY (contact_id, project_id)
    );
";

/// 예전 파일에 줄인 이름 칸을 더해요.
pub(crate) fn upgrade(conn: &rusqlite::Connection) -> Result<()> {
    let has: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'alias'")?
        .exists([])?;
    if !has {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN alias TEXT NOT NULL DEFAULT '';")?;
    }
    let has_group: bool = conn
        .prepare("SELECT 1 FROM pragma_table_info('projects') WHERE name = 'group_id'")?
        .exists([])?;
    if !has_group {
        conn.execute_batch("ALTER TABLE projects ADD COLUMN group_id INTEGER;")?;
    }
    Ok(())
}

/// 다른 프로젝트의 정식 이름이나 줄인 이름과 겹치는지 봐요.
fn name_taken(conn: &rusqlite::Connection, name: &str, except: i64) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM projects WHERE id <> ?2 AND (name = ?1 OR alias = ?1)",
            params![name, except],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn clean(input: &ContactInput) -> Result<ContactInput> {
    let t = |s: &str| s.trim().to_string();
    let name = t(&input.name);
    if name.is_empty() {
        return Err(Error::Invalid("이름이 비어 있어요".into()));
    }
    let mut projects: Vec<String> = Vec::new();
    for p in &input.projects {
        let p = p.trim();
        if !p.is_empty() && !projects.iter().any(|x| x == p) {
            projects.push(p.to_string());
        }
    }
    Ok(ContactInput {
        name,
        org: t(&input.org),
        role: t(&input.role),
        mobile: t(&input.mobile),
        tel: t(&input.tel),
        email: t(&input.email),
        projects,
    })
}

/// 이름(정식 이름 또는 줄인 이름)으로 프로젝트를 찾고, 없으면 만들어요.
fn project_id(tx: &Transaction, name: &str) -> Result<i64> {
    if let Some(id) = tx
        .query_row(
            "SELECT id FROM projects WHERE name = ?1 OR alias = ?1 ORDER BY name = ?1 DESC, id LIMIT 1",
            params![name],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    tx.execute("INSERT INTO projects (name) VALUES (?1)", params![name])?;
    Ok(tx.last_insert_rowid())
}

fn set_projects(tx: &Transaction, contact: i64, names: &[String]) -> Result<()> {
    tx.execute("DELETE FROM contact_projects WHERE contact_id = ?1", params![contact])?;
    for (pos, name) in names.iter().enumerate() {
        let pid = project_id(tx, name)?;
        tx.execute(
            "INSERT OR IGNORE INTO contact_projects (contact_id, project_id, pos) VALUES (?1, ?2, ?3)",
            params![contact, pid, pos as i64],
        )?;
    }
    Ok(())
}

fn exists(tx: &Transaction, table: &str, id: i64) -> Result<bool> {
    let sql = format!("SELECT 1 FROM {table} WHERE id = ?1");
    Ok(tx.query_row(&sql, params![id], |_| Ok(())).optional()?.is_some())
}

impl Store {
    /// 연락처와 프로젝트를 모두 읽어요. 연락처는 최근에 등록한 것이 앞이에요.
    pub fn contacts_data(&self) -> Result<ContactsData> {
        let mut links = self
            .conn
            .prepare("SELECT contact_id, project_id FROM contact_projects ORDER BY contact_id, pos")?;
        let links: Vec<(i64, i64)> = links
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;

        let mut stmt = self.conn.prepare(
            "SELECT id, name, org, role, mobile, tel, email, memo FROM contacts ORDER BY id DESC",
        )?;
        let contacts = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                Ok(Contact {
                    id,
                    name: r.get(1)?,
                    org: r.get(2)?,
                    role: r.get(3)?,
                    mobile: r.get(4)?,
                    tel: r.get(5)?,
                    email: r.get(6)?,
                    memo: r.get(7)?,
                    projects: links.iter().filter(|(c, _)| *c == id).map(|(_, p)| *p).collect(),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut stmt = self.conn.prepare("SELECT id, name, alias, color, group_id FROM projects ORDER BY id")?;
        let projects = stmt
            .query_map([], |r| Ok(Project { id: r.get(0)?, name: r.get(1)?, alias: r.get(2)?, color: r.get(3)?, group: r.get(4)? }))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut stmt = self.conn.prepare("SELECT id, name FROM project_groups ORDER BY ord, id")?;
        let groups = stmt
            .query_map([], |r| Ok(ProjectGroup { id: r.get(0)?, name: r.get(1)? }))?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(ContactsData { contacts, projects, groups })
    }

    /// 연락처를 등록하고 번호를 돌려줘요. 이름이 비어 있으면 등록하지 않아요.
    pub fn add_contact(&mut self, input: &ContactInput) -> Result<i64> {
        let c = clean(input)?;
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO contacts (name, org, role, mobile, tel, email) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![c.name, c.org, c.role, c.mobile, c.tel, c.email],
        )?;
        let id = tx.last_insert_rowid();
        set_projects(&tx, id, &c.projects)?;
        tx.commit()?;
        Ok(id)
    }

    /// 연락처를 고쳐요. 메모는 그대로 둬요.
    pub fn update_contact(&mut self, id: i64, input: &ContactInput) -> Result<()> {
        let c = clean(input)?;
        let tx = self.conn.transaction()?;
        if !exists(&tx, "contacts", id)? {
            return Err(Error::NotFound);
        }
        tx.execute(
            "UPDATE contacts SET name = ?2, org = ?3, role = ?4, mobile = ?5, tel = ?6, email = ?7 WHERE id = ?1",
            params![id, c.name, c.org, c.role, c.mobile, c.tel, c.email],
        )?;
        set_projects(&tx, id, &c.projects)?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_contact_memo(&self, id: i64, memo: &str) -> Result<()> {
        let n = self.conn.execute("UPDATE contacts SET memo = ?2 WHERE id = ?1", params![id, memo])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// 엑셀 가져오기: 모든 줄을 한 번에 넣어요(하나라도 실패하면 아무것도 안 들어가요). 없는 프로젝트는 만들어요.
    pub fn import_contacts(&mut self, rows: &[ContactImport]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        for r in rows {
            let c = &r.input;
            let t = |s: &str| s.trim().to_string();
            let mut projects: Vec<String> = Vec::new();
            for p in &c.projects {
                let p = p.trim();
                if !p.is_empty() && !projects.iter().any(|x| x == p) {
                    projects.push(p.to_string());
                }
            }
            tx.execute(
                "INSERT INTO contacts (name, org, role, mobile, tel, email, memo) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![t(&c.name), t(&c.org), t(&c.role), t(&c.mobile), t(&c.tel), t(&c.email), r.memo.trim()],
            )?;
            let id = tx.last_insert_rowid();
            set_projects(&tx, id, &projects)?;
        }
        tx.commit()?;
        Ok(rows.len())
    }

    pub fn delete_contact(&mut self, id: i64) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM contact_projects WHERE contact_id = ?1", params![id])?;
        tx.execute("DELETE FROM contacts WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    /// 프로젝트를 만들어요. 같은 이름이 있으면 그 번호를 돌려줘요.
    pub fn add_project(&mut self, name: &str) -> Result<i64> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("프로젝트 이름이 비어 있어요".into()));
        }
        let tx = self.conn.transaction()?;
        let id = project_id(&tx, name)?;
        tx.commit()?;
        Ok(id)
    }

    /// 프로젝트 이름을 바꿔요. 붙어 있는 사람·일지 기록은 번호로 이어져 있어 그대로 따라와요.
    pub fn rename_project(&self, id: i64, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("프로젝트 이름이 비어 있어요".into()));
        }
        if name_taken(&self.conn, name, id)? {
            return Err(Error::Invalid("같은 이름의 프로젝트가 있어요".into()));
        }
        let n = self.conn.execute("UPDATE projects SET name = ?2 WHERE id = ?1", params![id, name])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// 정식 이름(문서용)과 줄인 이름(관리용)을 함께 정해요. 둘 중 하나만 있어도 돼요.
    /// 정식 이름이 비면 줄인 이름을 정식 이름으로도 써요(name = alias).
    /// 줄인 이름이 정식 이름과 같으면 줄인 이름은 없는 것으로 둬요.
    pub fn set_project_names(&self, id: i64, full: &str, short: &str) -> Result<()> {
        let (full, short) = (full.trim(), short.trim());
        if full.is_empty() && short.is_empty() {
            return Err(Error::Invalid("프로젝트 이름이 비어 있어요".into()));
        }
        let name = if full.is_empty() { short } else { full };
        let alias = if !full.is_empty() && short == full { "" } else { short };
        for n in [name, alias] {
            if !n.is_empty() && name_taken(&self.conn, n, id)? {
                return Err(Error::Invalid("같은 이름의 프로젝트가 있어요".into()));
            }
        }
        let n = self
            .conn
            .execute("UPDATE projects SET name = ?2, alias = ?3 WHERE id = ?1", params![id, name, alias])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// 프로젝트 색을 정해요. None이면 자동으로 되돌려요.
    pub fn set_project_color(&self, id: i64, color: Option<i64>) -> Result<()> {
        if let Some(c) = color {
            if !(0..PROJECT_COLORS).contains(&c) {
                return Err(Error::Invalid("없는 색이에요".into()));
            }
        }
        let n = self.conn.execute("UPDATE projects SET color = ?2 WHERE id = ?1", params![id, color])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// 그룹을 만들고 번호를 돌려줘요. 같은 이름이 있으면 그 번호예요.
    pub fn add_group(&self, name: &str) -> Result<i64> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("그룹 이름이 비어 있어요".into()));
        }
        if let Some(id) = self
            .conn
            .query_row("SELECT id FROM project_groups WHERE name = ?1", params![name], |r| r.get::<_, i64>(0))
            .optional()?
        {
            return Ok(id);
        }
        self.conn.execute(
            "INSERT INTO project_groups (name, ord) VALUES (?1, (SELECT COALESCE(MAX(ord), 0) + 1 FROM project_groups))",
            params![name],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn rename_group(&self, id: i64, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Invalid("그룹 이름이 비어 있어요".into()));
        }
        let taken = self
            .conn
            .prepare("SELECT 1 FROM project_groups WHERE name = ?1 AND id <> ?2")?
            .exists(params![name, id])?;
        if taken {
            return Err(Error::Invalid("같은 이름의 그룹이 있어요".into()));
        }
        if self.conn.execute("UPDATE project_groups SET name = ?2 WHERE id = ?1", params![id, name])? == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// 그룹을 지워요. 그 안의 프로젝트는 "그룹 없음"으로 가요.
    pub fn delete_group(&mut self, id: i64) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("UPDATE projects SET group_id = NULL WHERE group_id = ?1", params![id])?;
        tx.execute("DELETE FROM project_groups WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    /// 그룹을 한 칸 위(-1)·아래(+1)로 옮겨요.
    pub fn move_group(&mut self, id: i64, dir: i64) -> Result<()> {
        let ids: Vec<i64> = self
            .conn
            .prepare("SELECT id FROM project_groups ORDER BY ord, id")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        let Some(i) = ids.iter().position(|x| *x == id) else { return Err(Error::NotFound) };
        let j = i as i64 + dir.signum();
        if j < 0 || j as usize >= ids.len() {
            return Ok(());
        }
        let mut ids = ids;
        ids.swap(i, j as usize);
        let tx = self.conn.transaction()?;
        for (n, gid) in ids.iter().enumerate() {
            tx.execute("UPDATE project_groups SET ord = ?2 WHERE id = ?1", params![gid, n as i64 + 1])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// 프로젝트의 그룹을 이름으로 정해요. 빈 이름 = 그룹 없음, 없는 이름이면 그룹을 만들어요.
    pub fn set_project_group(&self, id: i64, group: &str) -> Result<()> {
        let gid = if group.trim().is_empty() { None } else { Some(self.add_group(group)?) };
        if self.conn.execute("UPDATE projects SET group_id = ?2 WHERE id = ?1", params![id, gid])? == 0 {
            return Err(Error::NotFound);
        }
        Ok(())
    }

    /// 프로젝트를 지워요. 붙어 있던 사람과 일지 기록은 남고 배지만 빠져요.
    pub fn delete_project(&mut self, id: i64) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM contact_projects WHERE project_id = ?1", params![id])?;
        // 업무일지 기록에서도 그 프로젝트만 빠져요.
        tx.execute("UPDATE journal_entries SET project_id = NULL WHERE project_id = ?1", params![id])?;
        tx.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, projects: &[&str]) -> ContactInput {
        ContactInput {
            name: name.into(),
            org: " 경기도청 도로정책과 ".into(),
            role: "주무관".into(),
            mobile: "010-0000-0101".into(),
            projects: projects.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    fn names(d: &ContactsData, c: &Contact) -> Vec<String> {
        c.projects
            .iter()
            .map(|id| d.projects.iter().find(|p| p.id == *id).unwrap().name.clone())
            .collect()
    }

    #[test]
    fn add_creates_missing_projects_and_keeps_order() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        s.add_contact(&input("김○○", &["국도32호선 정비", " 일반 ", "국도32호선 정비", ""])).unwrap();
        s.add_contact(&input("이○○", &["일반"])).unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!(d.projects.len(), 2);
        // 최근에 등록한 사람이 앞이에요.
        assert_eq!(d.contacts[0].name, "이○○");
        assert_eq!(names(&d, &d.contacts[1]), vec!["국도32호선 정비", "일반"]);
        // 앞뒤 빈칸은 지워요.
        assert_eq!(d.contacts[1].org, "경기도청 도로정책과");
    }

    #[test]
    fn empty_name_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.add_contact(&input("  ", &["일반"])).err().unwrap().code(), "invalid");
        assert!(s.contacts_data().unwrap().contacts.is_empty());
        // 실패했으면 프로젝트도 만들지 않아요.
        assert!(s.contacts_data().unwrap().projects.is_empty());
        let id = s.add_contact(&input("김○○", &[])).unwrap();
        assert_eq!(s.update_contact(id, &input("", &[])).err().unwrap().code(), "invalid");
    }

    #[test]
    fn update_keeps_memo_and_replaces_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let id = s.add_contact(&input("김○○", &["가", "나"])).unwrap();
        s.set_contact_memo(id, r#"[{"t":"오후 통화"}]"#).unwrap();
        let mut c = input("김△△", &["다"]);
        c.tel = "031-000-0101".into();
        s.update_contact(id, &c).unwrap();
        let d = s.contacts_data().unwrap();
        let got = &d.contacts[0];
        assert_eq!(got.name, "김△△");
        assert_eq!(got.tel, "031-000-0101");
        assert_eq!(got.memo, r#"[{"t":"오후 통화"}]"#);
        assert_eq!(names(&d, got), vec!["다"]);
        // 쓰지 않게 된 프로젝트도 목록에는 남아요.
        assert_eq!(d.projects.len(), 3);
        assert_eq!(s.update_contact(999, &c).err().unwrap().code(), "not_found");
        assert_eq!(s.set_contact_memo(999, "").err().unwrap().code(), "not_found");
    }

    #[test]
    fn delete_project_keeps_people() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        s.add_contact(&input("김○○", &["가", "나"])).unwrap();
        let d = s.contacts_data().unwrap();
        let ga = d.projects.iter().find(|p| p.name == "가").unwrap().id;
        s.delete_project(ga).unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!(d.contacts.len(), 1);
        assert_eq!(names(&d, &d.contacts[0]), vec!["나"]);
        assert_eq!(d.projects.len(), 1);
    }

    #[test]
    fn delete_contact_and_project_colors() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let id = s.add_contact(&input("김○○", &["가"])).unwrap();
        s.delete_contact(id).unwrap();
        let d = s.contacts_data().unwrap();
        assert!(d.contacts.is_empty());
        let pid = d.projects[0].id;
        assert_eq!(s.add_project(" 가 ").unwrap(), pid);
        s.set_project_color(pid, Some(3)).unwrap();
        assert_eq!(s.contacts_data().unwrap().projects[0].color, Some(3));
        s.set_project_color(pid, None).unwrap();
        assert_eq!(s.contacts_data().unwrap().projects[0].color, None);
        assert_eq!(s.set_project_color(pid, Some(8)).err().unwrap().code(), "invalid");
        assert_eq!(s.add_project("  ").err().unwrap().code(), "invalid");
    }

    #[test]
    fn rename_project_keeps_links() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        s.add_contact(&input("가", &["배수로", "포장"])).unwrap();
        let d = s.contacts_data().unwrap();
        let pid = d.projects.iter().find(|p| p.name == "배수로").unwrap().id;
        s.rename_project(pid, " 광탄면 배수로 ").unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!(d.projects.iter().find(|p| p.id == pid).unwrap().name, "광탄면 배수로");
        assert!(d.contacts[0].projects.contains(&pid));
        assert_eq!(s.rename_project(pid, "포장").err().unwrap().code(), "invalid");
        assert_eq!(s.rename_project(pid, " ").err().unwrap().code(), "invalid");
        s.rename_project(pid, "광탄면 배수로").unwrap();
        assert_eq!(s.rename_project(999, "새 이름").err().unwrap().code(), "not_found");
    }

    #[test]
    fn project_alias_full_or_short() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let full = "2026년 동부권 도로시설물 유지보수 연간단가 공사(1지구, 하반기)";
        s.add_contact(&input("가", &[full, "포장"])).unwrap();
        let d = s.contacts_data().unwrap();
        let pid = d.projects.iter().find(|p| p.name == full).unwrap().id;
        assert_eq!(d.projects[0].alias, "");
        // 둘 다 적기
        s.set_project_names(pid, full, " 2026 동부권 도로시설물(1지구, 하반기) ").unwrap();
        let p = s.contacts_data().unwrap().projects.into_iter().find(|p| p.id == pid).unwrap();
        assert_eq!((p.name.as_str(), p.alias.as_str()), (full, "2026 동부권 도로시설물(1지구, 하반기)"));
        // 줄인 이름으로 적어도 같은 프로젝트에 붙어요(새로 만들지 않아요)
        s.add_contact(&input("나", &["2026 동부권 도로시설물(1지구, 하반기)"])).unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!(d.projects.len(), 2);
        assert_eq!(d.contacts[0].projects, vec![pid]);
        // 줄인 이름만: 정식 이름도 줄인 이름으로
        s.set_project_names(pid, "", "동부권 1지구").unwrap();
        let p = s.contacts_data().unwrap().projects.into_iter().find(|p| p.id == pid).unwrap();
        assert_eq!((p.name.as_str(), p.alias.as_str()), ("동부권 1지구", "동부권 1지구"));
        // 정식 이름만 / 같은 글자면 줄인 이름은 없음
        s.set_project_names(pid, full, "").unwrap();
        s.set_project_names(pid, full, full).unwrap();
        let p = s.contacts_data().unwrap().projects.into_iter().find(|p| p.id == pid).unwrap();
        assert_eq!((p.name.as_str(), p.alias.as_str()), (full, ""));
        // 겹치기·비우기·없는 번호
        assert_eq!(s.set_project_names(pid, full, "포장").err().unwrap().code(), "invalid");
        assert_eq!(s.set_project_names(pid, "포장", "").err().unwrap().code(), "invalid");
        assert_eq!(s.set_project_names(pid, " ", " ").err().unwrap().code(), "invalid");
        assert_eq!(s.set_project_names(999, "새", "").err().unwrap().code(), "not_found");
        s.set_project_names(pid, full, "동부권").unwrap();
        let other = s.contacts_data().unwrap().projects.into_iter().find(|p| p.name == "포장").unwrap().id;
        assert_eq!(s.rename_project(other, "동부권").err().unwrap().code(), "invalid");
    }

    #[test]
    fn project_groups() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
        let a = s.add_project("배수로").unwrap();
        let b = s.add_project("도로표지").unwrap();
        s.set_project_group(a, "연간단가").unwrap();
        s.set_project_group(b, "안전시설").unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!(d.groups.iter().map(|g| g.name.as_str()).collect::<Vec<_>>(), ["연간단가", "안전시설"]);
        let g2 = d.groups[1].id;
        s.move_group(g2, -1).unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!(d.groups[0].id, g2);
        s.delete_group(g2).unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!(d.groups.len(), 1);
        assert_eq!(d.projects.iter().find(|p| p.id == b).unwrap().group, None);
        s.set_project_group(a, "").unwrap();
        assert_eq!(s.contacts_data().unwrap().projects.iter().find(|p| p.id == a).unwrap().group, None);
    }

    #[test]
    fn old_file_gets_alias_column() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.add_contact(&input("가", &["배수로"])).unwrap();
            // 예전 파일처럼 칸을 지워요.
            s.conn.execute_batch("ALTER TABLE projects DROP COLUMN alias;").unwrap();
        }
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!((d.projects[0].name.as_str(), d.projects[0].alias.as_str()), ("배수로", ""));
    }

    #[test]
    fn contacts_survive_reopen_and_are_encrypted() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.add_contact(&input("CONTACT-MARKER", &["PROJECT-MARKER"])).unwrap();
        }
        let bytes = std::fs::read(tmp.path().join("gilog.db")).unwrap();
        for needle in [&b"CONTACT-MARKER"[..], &b"PROJECT-MARKER"[..]] {
            assert!(!bytes.windows(needle.len()).any(|w| w == needle));
        }
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        let d = s.contacts_data().unwrap();
        assert_eq!(d.contacts[0].name, "CONTACT-MARKER");
        assert_eq!(d.projects[0].name, "PROJECT-MARKER");
    }
}
