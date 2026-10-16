//! 할 일 목록: 목록마다 카드 하나예요(구글 할 일과 같은 구성).
//!
//! - "민원" 목록은 처음부터 있고 지우거나 이름을 바꿀 수 없어요(`builtin`). 민원대장의 민원은 여기 저장하지 않고
//!   화면이 민원을 그대로 읽어요(같은 사실은 한 곳에만). 이 목록에 직접 더한 할 일만 여기 들어가요.
//! - 하위 항목은 한 단계까지만이에요. 위 항목을 완료하면 하위 항목도 함께 완료돼요. 하위 항목을 되돌리면 위 항목도 되돌려요.
//! - 세부정보는 머릿기호 규칙의 줄 목록(JSON)이에요. 민원 내용과 같은 방법으로 정리해요.
//! - 마감일은 비어 있거나 날짜(2026-10-16)예요. 완료한 날은 화면이 PC 날짜로 보내요.

use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::complaints::lines;
use crate::journal::valid_date;
use crate::{Error, Result, Store};

/// 처음부터 있는 목록 이름이에요. 민원대장의 민원이 이 카드에 함께 보여요.
pub const COMPLAINT_LIST: &str = "민원";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    pub id: i64,
    pub name: String,
    /// 체크를 끄면 카드를 숨겨요.
    pub visible: bool,
    /// 처음부터 있는 목록(민원). 지우거나 이름을 바꿀 수 없어요.
    pub builtin: bool,
    /// 보이는 순서 (작은 것이 앞)
    pub ord: i64,
}

/// 할 일을 등록할 때 보내는 값이에요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskInput {
    pub list: i64,
    /// 위 항목. 있으면 하위 항목이에요.
    pub parent: Option<i64>,
    pub title: String,
    /// 세부정보 (머릿기호 줄 목록 JSON)
    pub detail: String,
    /// 마감일. 비어 있으면 마감이 없어요.
    pub due: String,
}

/// 할 일을 고칠 때 보내는 값이에요. 목록과 위 항목은 바꾸지 않아요.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TaskEdit {
    pub title: String,
    pub detail: String,
    pub due: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub list: i64,
    pub parent: Option<i64>,
    pub title: String,
    pub detail: String,
    pub due: String,
    pub done: bool,
    /// 완료한 날. 완료가 아니면 비어 있어요.
    pub done_on: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksData {
    pub lists: Vec<TaskList>,
    pub tasks: Vec<Task>,
}

pub(crate) const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS task_lists (
        id      INTEGER PRIMARY KEY,
        name    TEXT NOT NULL UNIQUE,
        visible INTEGER NOT NULL DEFAULT 1,
        builtin INTEGER NOT NULL DEFAULT 0,
        ord     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tasks (
        id      INTEGER PRIMARY KEY,
        list    INTEGER NOT NULL,
        parent  INTEGER,
        title   TEXT NOT NULL,
        detail  TEXT NOT NULL DEFAULT '',
        due     TEXT NOT NULL DEFAULT '',
        done    INTEGER NOT NULL DEFAULT 0,
        done_on TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS tasks_list ON tasks(list);
";

/// 목록이 하나도 없으면(처음 열 때) "민원"과 "행정업무"를 만들어요. 사용자가 구글 할 일에서 쓰던 두 목록이에요.
/// "민원"이 없으면(어떤 이유로든) 다시 넣어요.
pub(crate) fn seed(conn: &rusqlite::Connection) -> Result<()> {
    let n: i64 = conn.query_row("SELECT count(*) FROM task_lists", [], |r| r.get(0))?;
    if n == 0 {
        conn.execute(
            "INSERT INTO task_lists (name, builtin, ord) VALUES (?1, 1, 0), ('행정업무', 0, 1)",
            params![COMPLAINT_LIST],
        )?;
    }
    let has: bool = conn.prepare("SELECT 1 FROM task_lists WHERE builtin = 1")?.exists([])?;
    if !has {
        // 같은 이름의 목록이 있으면 그것을 처음부터 있는 목록으로 삼아요.
        let n = conn.execute("UPDATE task_lists SET builtin = 1 WHERE name = ?1", params![COMPLAINT_LIST])?;
        if n == 0 {
            conn.execute(
                "INSERT INTO task_lists (name, builtin, ord) VALUES (?1, 1, (SELECT COALESCE(MIN(ord), 0) - 1 FROM task_lists))",
                params![COMPLAINT_LIST],
            )?;
        }
    }
    Ok(())
}

const LIST_COLS: &str = "id, name, visible, builtin, ord";
const TASK_COLS: &str = "id, list, parent, title, detail, due, done, done_on";

fn bad(msg: &str) -> Error {
    Error::Invalid(msg.into())
}

fn list_row(r: &Row) -> rusqlite::Result<TaskList> {
    Ok(TaskList { id: r.get(0)?, name: r.get(1)?, visible: r.get(2)?, builtin: r.get(3)?, ord: r.get(4)? })
}

fn task_row(r: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        list: r.get(1)?,
        parent: r.get(2)?,
        title: r.get(3)?,
        detail: r.get(4)?,
        due: r.get(5)?,
        done: r.get(6)?,
        done_on: r.get(7)?,
    })
}

/// 제목·세부정보·마감일을 정리해요. 제목은 꼭 있어야 하고, 마감일은 비어 있거나 날짜예요.
fn clean(title: &str, detail: &str, due: &str) -> Result<(String, String, String)> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err(bad("제목이 비어 있어요"));
    }
    let due = due.trim().to_string();
    if !due.is_empty() && !valid_date(&due) {
        return Err(bad("마감일이 맞지 않아요"));
    }
    Ok((title, lines(detail), due))
}

fn list_name(name: &str) -> Result<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(bad("목록 이름이 비어 있어요"));
    }
    Ok(name)
}

impl Store {
    /// 목록과 할 일을 모두 읽어요. 목록은 순서대로, 할 일은 등록한 순서예요(정렬은 화면이 해요).
    pub fn tasks_data(&self) -> Result<TasksData> {
        Ok(TasksData { lists: self.task_lists()?, tasks: self.tasks()? })
    }

    fn task_lists(&self) -> Result<Vec<TaskList>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {LIST_COLS} FROM task_lists ORDER BY ord, id"))?;
        let v = stmt.query_map([], list_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    fn tasks(&self) -> Result<Vec<Task>> {
        let mut stmt = self.conn.prepare(&format!("SELECT {TASK_COLS} FROM tasks ORDER BY id"))?;
        let v = stmt.query_map([], task_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    fn task_list(&self, id: i64) -> Result<TaskList> {
        self.conn
            .query_row(&format!("SELECT {LIST_COLS} FROM task_lists WHERE id = ?1"), params![id], list_row)
            .optional()?
            .ok_or(Error::NotFound)
    }

    fn task(&self, id: i64) -> Result<Task> {
        self.conn
            .query_row(&format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"), params![id], task_row)
            .optional()?
            .ok_or(Error::NotFound)
    }

    fn name_taken(&self, name: &str, except: i64) -> Result<bool> {
        Ok(self.conn.prepare("SELECT 1 FROM task_lists WHERE name = ?1 AND id <> ?2")?.exists(params![name, except])?)
    }

    /// 새 목록을 맨 뒤에 만들어요. 같은 이름이 있으면 만들지 않아요.
    pub fn add_task_list(&self, name: &str) -> Result<TaskList> {
        let name = list_name(name)?;
        if self.name_taken(&name, 0)? {
            return Err(bad("같은 이름의 목록이 있어요"));
        }
        self.conn.execute(
            "INSERT INTO task_lists (name, ord) VALUES (?1, (SELECT COALESCE(MAX(ord), 0) + 1 FROM task_lists))",
            params![name],
        )?;
        self.task_list(self.conn.last_insert_rowid())
    }

    /// 목록 이름을 바꿔요. 처음부터 있는 목록(민원)은 바꾸지 않아요.
    pub fn rename_task_list(&self, id: i64, name: &str) -> Result<TaskList> {
        let l = self.task_list(id)?;
        if l.builtin {
            return Err(bad("민원 목록은 이름을 바꿀 수 없어요"));
        }
        let name = list_name(name)?;
        if self.name_taken(&name, id)? {
            return Err(bad("같은 이름의 목록이 있어요"));
        }
        self.conn.execute("UPDATE task_lists SET name = ?2 WHERE id = ?1", params![id, name])?;
        self.task_list(id)
    }

    pub fn set_task_list_visible(&self, id: i64, visible: bool) -> Result<TaskList> {
        let n = self.conn.execute("UPDATE task_lists SET visible = ?2 WHERE id = ?1", params![id, visible])?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.task_list(id)
    }

    /// 목록을 앞(-1)이나 뒤(+1)로 한 칸 옮기고 모든 목록을 돌려줘요.
    pub fn move_task_list(&mut self, id: i64, dir: i64) -> Result<Vec<TaskList>> {
        let mut all = self.task_lists()?;
        let i = all.iter().position(|l| l.id == id).ok_or(Error::NotFound)?;
        let j = i as i64 + dir.signum();
        if dir != 0 && j >= 0 && (j as usize) < all.len() {
            all.swap(i, j as usize);
            let tx = self.conn.transaction()?;
            for (k, l) in all.iter().enumerate() {
                tx.execute("UPDATE task_lists SET ord = ?2 WHERE id = ?1", params![l.id, k as i64])?;
            }
            tx.commit()?;
        }
        self.task_lists()
    }

    /// 목록과 그 안의 할 일을 모두 지워요. 지운 할 일 수를 돌려줘요. 처음부터 있는 목록(민원)은 지우지 않아요.
    pub fn delete_task_list(&mut self, id: i64) -> Result<usize> {
        let l = self.task_list(id)?;
        if l.builtin {
            return Err(bad("민원 목록은 지울 수 없어요"));
        }
        let tx = self.conn.transaction()?;
        let n = tx.execute("DELETE FROM tasks WHERE list = ?1", params![id])?;
        tx.execute("DELETE FROM task_lists WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(n)
    }

    /// 할 일을 등록해요. 하위 항목은 같은 목록의 맨 위 항목 아래에만 붙어요(한 단계까지).
    pub fn add_task(&self, input: &TaskInput) -> Result<Task> {
        let (title, detail, due) = clean(&input.title, &input.detail, &input.due)?;
        self.task_list(input.list)?;
        if let Some(p) = input.parent {
            let parent = self.task(p).map_err(|_| bad("위 항목이 없어요"))?;
            if parent.list != input.list {
                return Err(bad("위 항목이 다른 목록에 있어요"));
            }
            if parent.parent.is_some() {
                return Err(bad("하위 항목은 한 단계까지만 돼요"));
            }
        }
        self.conn.execute(
            "INSERT INTO tasks (list, parent, title, detail, due) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![input.list, input.parent, title, detail, due],
        )?;
        self.task(self.conn.last_insert_rowid())
    }

    /// 제목·세부정보·마감일을 고쳐요.
    pub fn update_task(&self, id: i64, edit: &TaskEdit) -> Result<Task> {
        let (title, detail, due) = clean(&edit.title, &edit.detail, &edit.due)?;
        let n = self.conn.execute(
            "UPDATE tasks SET title = ?2, detail = ?3, due = ?4 WHERE id = ?1",
            params![id, title, detail, due],
        )?;
        if n == 0 {
            return Err(Error::NotFound);
        }
        self.task(id)
    }

    /// 완료하거나 되돌리고, 함께 바뀐 할 일을 모두 돌려줘요.
    /// - 완료: 하위 항목도 함께 완료해요(이미 완료한 것은 완료한 날을 그대로 둬요).
    /// - 되돌리기: 하위 항목도 함께 되돌리고, 위 항목이 완료였으면 위 항목도 되돌려요.
    pub fn set_task_done(&mut self, id: i64, done: bool, today: &str) -> Result<Vec<Task>> {
        let t = self.task(id)?;
        if done && !valid_date(today) {
            return Err(bad("날짜가 맞지 않아요"));
        }
        let tx = self.conn.transaction()?;
        if done {
            tx.execute(
                "UPDATE tasks SET done = 1, done_on = ?2 WHERE (id = ?1 OR parent = ?1) AND done = 0",
                params![id, today],
            )?;
        } else {
            tx.execute("UPDATE tasks SET done = 0, done_on = '' WHERE id = ?1 OR parent = ?1", params![id])?;
            if let Some(p) = t.parent {
                tx.execute("UPDATE tasks SET done = 0, done_on = '' WHERE id = ?1", params![p])?;
            }
        }
        tx.commit()?;
        let mut stmt = self
            .conn
            .prepare(&format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1 OR parent = ?1 OR id = ?2 ORDER BY id"))?;
        let v = stmt.query_map(params![id, t.parent.unwrap_or(0)], task_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(v)
    }

    /// 할 일을 지워요. 하위 항목도 함께 지워져요. 지운 개수를 돌려줘요.
    pub fn delete_task(&self, id: i64) -> Result<usize> {
        Ok(self.conn.execute("DELETE FROM tasks WHERE id = ?1 OR parent = ?1", params![id])?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(tmp: &tempfile::TempDir) -> Store {
        Store::create(tmp.path(), "abcd1234").unwrap()
    }

    fn input(list: i64, title: &str) -> TaskInput {
        TaskInput { list, parent: None, title: title.into(), detail: String::new(), due: String::new() }
    }

    #[test]
    fn complaint_list_is_there_from_the_start_and_cannot_go() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(&tmp);
        let lists = s.tasks_data().unwrap().lists;
        assert_eq!(lists.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), vec!["민원", "행정업무"]);
        let m = &lists[0];
        assert!(m.builtin && m.visible);
        assert_eq!(s.delete_task_list(m.id).err().unwrap().code(), "invalid");
        assert_eq!(s.rename_task_list(m.id, "다른 이름").err().unwrap().code(), "invalid");
        // 숨기기는 돼요.
        assert!(!s.set_task_list_visible(m.id, false).unwrap().visible);
        // 다시 열어도 하나만 있어요.
        drop(s);
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.tasks_data().unwrap().lists.iter().filter(|l| l.builtin).count(), 1);
    }

    #[test]
    fn lists_are_named_uniquely_ordered_and_deleted_with_their_tasks() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(&tmp);
        let a = s.add_task_list("  국도32호선   정비 ").unwrap();
        assert_eq!(a.name, "국도32호선 정비");
        assert_eq!(s.add_task_list("국도32호선 정비").err().unwrap().code(), "invalid");
        assert_eq!(s.add_task_list("  ").err().unwrap().code(), "invalid");
        let b = s.add_task_list("하천").unwrap();
        assert_eq!(s.rename_task_list(b.id, "국도32호선 정비").err().unwrap().code(), "invalid");
        assert_eq!(s.rename_task_list(b.id, "하천 정비").unwrap().name, "하천 정비");
        // 앞으로 옮기기
        let order = s.move_task_list(b.id, -1).unwrap();
        assert_eq!(order.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(), vec!["민원", "행정업무", "하천 정비", "국도32호선 정비"]);
        // 맨 앞에서 더 앞으로는 그대로예요.
        let first = order[0].id;
        assert_eq!(s.move_task_list(first, -1).unwrap()[0].id, first);
        let t = s.add_task(&input(a.id, "포장 보수 물량 산출")).unwrap();
        s.add_task(&TaskInput { parent: Some(t.id), ..input(a.id, "파손 면적") }).unwrap();
        s.add_task(&input(b.id, "남는 것")).unwrap();
        assert_eq!(s.delete_task_list(a.id).unwrap(), 2);
        let d = s.tasks_data().unwrap();
        assert_eq!(d.tasks.len(), 1);
        assert!(d.lists.iter().all(|l| l.id != a.id));
    }

    #[test]
    fn tasks_are_cleaned_and_checked() {
        let tmp = tempfile::tempdir().unwrap();
        let s = store(&tmp);
        let list = s.tasks_data().unwrap().lists[1].id;
        assert_eq!(s.add_task(&input(list, "  ")).err().unwrap().code(), "invalid");
        assert_eq!(s.add_task(&input(999, "목록 없음")).err().unwrap().code(), "not_found");
        let mut i = input(list, " 주간업무보고   작성 ");
        i.due = "1016".into();
        assert_eq!(s.add_task(&i).err().unwrap().code(), "invalid");
        i.due = "2026-10-16".into();
        i.detail = r#"[{"t":" 팀장 지시 "},{"t":" "},{"t":"읍면동별","k":"ci"}]"#.into();
        let t = s.add_task(&i).unwrap();
        assert_eq!(t.title, "주간업무보고 작성");
        // 묶음을 나누는 빈 줄은 남아요(머릿기호 위계 규칙).
        assert_eq!(t.detail, r#"[{"t":"팀장 지시"},{"t":""},{"k":"ci","t":"읍면동별"}]"#);
        assert_eq!((t.done, t.done_on.as_str(), t.parent), (false, "", None));
        let u = s
            .update_task(t.id, &TaskEdit { title: "주간업무보고".into(), detail: r#"[{"t":""}]"#.into(), due: String::new() })
            .unwrap();
        assert_eq!((u.title.as_str(), u.detail.as_str(), u.due.as_str()), ("주간업무보고", "", ""));
        assert_eq!(s.update_task(t.id, &TaskEdit::default()).err().unwrap().code(), "invalid");
        assert_eq!(s.update_task(999, &TaskEdit { title: "x".into(), ..Default::default() }).err().unwrap().code(), "not_found");
    }

    #[test]
    fn subtasks_are_one_level_and_follow_the_parent() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = store(&tmp);
        let lists = s.tasks_data().unwrap().lists;
        let (l1, l2) = (lists[0].id, lists[1].id);
        let p = s.add_task(&input(l1, "위 항목")).unwrap();
        let c1 = s.add_task(&TaskInput { parent: Some(p.id), ..input(l1, "하위 1") }).unwrap();
        let c2 = s.add_task(&TaskInput { parent: Some(p.id), ..input(l1, "하위 2") }).unwrap();
        // 두 단계는 안 돼요. 다른 목록의 항목 아래도 안 돼요.
        assert_eq!(s.add_task(&TaskInput { parent: Some(c1.id), ..input(l1, "손자") }).err().unwrap().code(), "invalid");
        assert_eq!(s.add_task(&TaskInput { parent: Some(p.id), ..input(l2, "남의 것") }).err().unwrap().code(), "invalid");

        // 하위 하나를 먼저 완료한 뒤 위 항목을 완료하면 나머지도 완료되고, 먼저 완료한 날은 그대로예요.
        s.set_task_done(c1.id, true, "2026-10-15").unwrap();
        assert_eq!(s.set_task_done(p.id, false, "").unwrap().len(), 3);
        s.set_task_done(c1.id, true, "2026-10-15").unwrap();
        let changed = s.set_task_done(p.id, true, "2026-10-16").unwrap();
        assert_eq!(changed.len(), 3);
        let all = s.tasks_data().unwrap().tasks;
        let get = |id: i64| all.iter().find(|t| t.id == id).unwrap().clone();
        assert!(get(p.id).done && get(c2.id).done);
        assert_eq!(get(c1.id).done_on, "2026-10-15");
        assert_eq!(get(c2.id).done_on, "2026-10-16");
        assert_eq!(s.set_task_done(p.id, true, "1016").err().unwrap().code(), "invalid");

        // 하위 항목을 되돌리면 위 항목도 되돌려요(다른 하위 항목은 그대로).
        s.set_task_done(c2.id, false, "").unwrap();
        let all = s.tasks_data().unwrap().tasks;
        let get = |id: i64| all.iter().find(|t| t.id == id).unwrap().clone();
        assert!(!get(p.id).done && !get(c2.id).done && get(c1.id).done);

        // 위 항목을 지우면 하위 항목도 지워져요.
        assert_eq!(s.delete_task(p.id).unwrap(), 3);
        assert!(s.tasks_data().unwrap().tasks.is_empty());
        assert_eq!(s.set_task_done(p.id, true, "2026-10-16").err().unwrap().code(), "not_found");
    }

    #[test]
    fn tasks_survive_reopen_and_are_encrypted() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = store(&tmp);
            let list = s.add_task_list("LIST-MARKER").unwrap().id;
            s.add_task(&TaskInput { detail: "DETAIL-MARKER".into(), ..input(list, "TITLE-MARKER") }).unwrap();
        }
        let bytes = std::fs::read(tmp.path().join("gilog.db")).unwrap();
        for needle in [&b"LIST-MARKER"[..], &b"TITLE-MARKER"[..], &b"DETAIL-MARKER"[..]] {
            assert!(!bytes.windows(needle.len()).any(|w| w == needle));
        }
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        let d = s.tasks_data().unwrap();
        assert_eq!(d.tasks[0].title, "TITLE-MARKER");
        assert_eq!(d.lists.len(), 3);
    }
}
