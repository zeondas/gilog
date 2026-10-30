//! 브라우저용 명령: 앱 명령 이름 → core 함수 짝 표.
//!
//! 몸통은 앱 명령 층(`src-tauri/src/lib.rs`·`budget.rs`·`bstatus.rs`·`calendar.rs`·`process.rs`)과 같은 모양이에요.
//! 여기서 규칙을 새로 짜지 않아요 – 값 검사·정렬·연번은 모두 core가 해요.
//! 앱 쪽 경로 검사(`guard`)·사진 미리 보기 허용·윈도우 일은 브라우저에 없으니 빠져요.
//! 엑셀 파일은 가짜 드라이브(경로 → 바이트)에 쓰고 읽어요(core의 바이트 쓰기/읽기).

use gilog_core::budget_xlsx::{self, BudgetExport};
use gilog_core::excel::{self, ExcelExport, SheetKind};
use gilog_core::{
    BStatusExport, BudgetImportProject, BudgetLevel, BudgetRowInput, BudgetShareOp, CasePatch, ComplaintImport, ComplaintInput, ContactImport,
    ContactInput, DayInfo, EntryInput, EventInput, Holiday, OrderPatch, Store, TaskEdit, TaskInput, WorkInput,
};
use serde_json::Value;

use crate::{json, out, Args, Session};

/// 브라우저에서 실제 core로 도는 앱 명령(이름은 앱 `generate_handler!`와 같게).
pub const BROWSER: &[&str] = &[
    // 잠금
    "status",
    "create_store",
    "unlock",
    "lock",
    "change_password",
    "get_value",
    "set_value",
    // 업무연락처
    "contacts_data",
    "add_contact",
    "update_contact",
    "set_contact_memo",
    "delete_contact",
    "add_project",
    "rename_project",
    "set_project_names",
    "set_project_color",
    "add_project_group",
    "rename_project_group",
    "delete_project_group",
    "move_project_group",
    "set_project_group",
    "delete_project",
    // 업무일지
    "journal_data",
    "add_journal_entry",
    "update_journal_entry",
    "delete_journal_entry",
    "set_journal_day",
    "delete_journal_day",
    "clear_journal",
    // 자료 지우기(설정)
    "clear_counts",
    "clear_data",
    // 민원대장
    "complaints",
    "add_complaint",
    "update_complaint",
    "replace_complaint_field",
    "set_complaint_status",
    "road_to_jibun",
    "set_complaint_memo",
    "delete_complaint",
    "import_complaints",
    "import_contacts",
    // 엑셀(가짜 드라이브)
    "excel_write",
    "excel_read",
    // 할 일
    "tasks_data",
    "add_task_list",
    "rename_task_list",
    "set_task_list_visible",
    "move_task_list",
    "delete_task_list",
    "add_task",
    "update_task",
    "set_task_done",
    "delete_task",
    // 캘린더 저장
    "calendar_data",
    "add_event",
    "update_event",
    "delete_event",
    "cal_kinds",
    "add_cal_kind",
    "set_cal_kind_color",
    "set_cal_kind_visible",
    "delete_cal_kind",
    "save_holidays",
    // 집행현황
    "budget_data",
    "save_budget_project",
    "save_budget_item",
    "save_budget_row",
    "set_budget_stage",
    "set_budget_memo",
    "set_budget_open",
    "move_budget",
    "move_budget_item",
    "move_budget_row",
    "delete_budget",
    "copy_budget_year",
    "import_budget",
    "budget_excel_write",
    "budget_excel_read",
    "budget_years",
    "set_budget_owner",
    "budget_share_apply",
    "budget_share_clear",
    // 예산현황
    "bstatus_list",
    "bstatus_set",
    "bstatus_excel_write",
    // 민원처리 저장
    "process_data",
    "save_work",
    "delete_work",
    "update_case",
    "delete_case",
    "order_mailed",
];

fn with<T: serde::Serialize>(s: &mut Session, f: impl FnOnce(&mut Store) -> gilog_core::Result<T>) -> Result<Value, String> {
    let store = s.store()?;
    out(f(store))
}

/// 짝 표. 모르는 이름이면 None(자리 표시자 쪽으로).
pub(crate) fn browser(s: &mut Session, cmd: &str, a: &Args) -> Option<Result<Value, String>> {
    Some(match cmd {
        // ---------- 잠금 (앱 lib.rs) ----------
        "status" => json(serde_json::json!({ "exists": s.store.is_some(), "unlocked": s.unlocked && s.store.is_some(), "folder": "문서\\giLog (미리 보기)" })),
        "create_store" => (|| {
            let password = a.s("password")?;
            if s.store.is_some() {
                return Err("already_exists".to_string());
            }
            s.store = Some(Store::memory(&password).map_err(|e| e.code().to_string())?);
            s.unlocked = true;
            Ok(Value::Null)
        })(),
        "unlock" => (|| {
            let password = a.s("password")?;
            let store = s.store.as_ref().ok_or_else(|| "not_found".to_string())?;
            store.check_password(&password).map_err(|e| e.code().to_string())?;
            s.unlocked = true;
            Ok(Value::Null)
        })(),
        "lock" => {
            s.unlocked = false;
            Ok(Value::Null)
        }
        "change_password" => (|| {
            let (old, new) = (a.s("oldPassword")?, a.s("newPassword")?);
            with(s, |st| st.change_password(&old, &new))
        })(),
        "get_value" => (|| {
            let key = a.s("key")?;
            with(s, |st| st.get(&key))
        })(),
        "set_value" => (|| {
            let (key, value) = (a.s("key")?, a.s("value")?);
            with(s, |st| st.set(&key, &value))
        })(),

        // ---------- 업무연락처 ----------
        "contacts_data" => with(s, |st| st.contacts_data()),
        "add_contact" => (|| {
            let c: ContactInput = a.get("contact")?;
            with(s, |st| {
                st.add_contact(&c)?;
                st.contacts_data()
            })
        })(),
        "update_contact" => (|| {
            let (id, c): (i64, ContactInput) = (a.id("id")?, a.get("contact")?);
            with(s, |st| {
                st.update_contact(id, &c)?;
                st.contacts_data()
            })
        })(),
        "set_contact_memo" => (|| {
            let (id, memo) = (a.id("id")?, a.s("memo")?);
            with(s, |st| {
                st.set_contact_memo(id, &memo)?;
                st.contacts_data()
            })
        })(),
        "delete_contact" => (|| {
            let id = a.id("id")?;
            with(s, |st| {
                st.delete_contact(id)?;
                st.contacts_data()
            })
        })(),
        "add_project" => (|| {
            let name = a.s("name")?;
            with(s, |st| {
                st.add_project(&name)?;
                st.contacts_data()
            })
        })(),
        "set_project_names" => (|| {
            let (id, name, alias) = (a.id("id")?, a.s("name")?, a.s("alias")?);
            with(s, |st| {
                st.set_project_names(id, &name, &alias)?;
                st.contacts_data()
            })
        })(),
        "rename_project" => (|| {
            let (id, name) = (a.id("id")?, a.s("name")?);
            with(s, |st| {
                st.rename_project(id, &name)?;
                st.contacts_data()
            })
        })(),
        "add_project_group" => (|| {
            let name = a.s("name")?;
            with(s, |st| {
                st.add_group(&name)?;
                st.contacts_data()
            })
        })(),
        "rename_project_group" => (|| {
            let (id, name) = (a.id("id")?, a.s("name")?);
            with(s, |st| {
                st.rename_group(id, &name)?;
                st.contacts_data()
            })
        })(),
        "delete_project_group" => (|| {
            let id = a.id("id")?;
            with(s, |st| {
                st.delete_group(id)?;
                st.contacts_data()
            })
        })(),
        "move_project_group" => (|| {
            let (id, dir) = (a.id("id")?, a.id("dir")?);
            with(s, |st| {
                st.move_group(id, dir)?;
                st.contacts_data()
            })
        })(),
        "set_project_group" => (|| {
            let (id, group) = (a.id("id")?, a.s("group")?);
            with(s, |st| {
                st.set_project_group(id, &group)?;
                st.contacts_data()
            })
        })(),
        "set_project_color" => (|| {
            let (id, color): (i64, Option<i64>) = (a.id("id")?, a.get("color")?);
            with(s, |st| {
                st.set_project_color(id, color)?;
                st.contacts_data()
            })
        })(),
        "delete_project" => (|| {
            let id = a.id("id")?;
            with(s, |st| {
                st.delete_project(id)?;
                st.contacts_data()
            })
        })(),

        // ---------- 업무일지 ----------
        "journal_data" => with(s, |st| st.journal_data()),
        "add_journal_entry" => (|| {
            let e: EntryInput = a.get("entry")?;
            with(s, |st| st.add_entry(&e))
        })(),
        "update_journal_entry" => (|| {
            let (id, e): (i64, EntryInput) = (a.id("id")?, a.get("entry")?);
            with(s, |st| st.update_entry(id, &e))
        })(),
        "delete_journal_entry" => (|| {
            let id = a.id("id")?;
            with(s, |st| st.delete_entry(id))
        })(),
        "delete_journal_day" => (|| {
            let date = a.s("date")?;
            with(s, |st| st.delete_day(&date))
        })(),
        "clear_journal" => with(s, |st| st.clear_journal()),
        "clear_counts" => (|| {
            let year = a.id("year")?;
            with(s, |st| st.clear_counts(year))
        })(),
        "clear_data" => (|| {
            let (what, year): (String, Option<i64>) = (a.s("what")?, a.get("year")?);
            with(s, |st| st.clear(gilog_core::ClearWhat::parse(&what, year)?))
        })(),
        "set_journal_day" => (|| {
            let day: DayInfo = a.get("day")?;
            with(s, |st| st.set_day(&day))
        })(),

        // ---------- 민원대장 ----------
        "complaints" => with(s, |st| st.complaints()),
        "add_complaint" => (|| {
            let c: ComplaintInput = a.get("complaint")?;
            with(s, |st| st.add_complaint(&c))
        })(),
        "update_complaint" => (|| {
            let (id, c): (i64, ComplaintInput) = (a.id("id")?, a.get("complaint")?);
            with(s, |st| st.update_complaint(id, &c))
        })(),
        // 잠금과 상관없이 core에 넣은 표를 읽어요(앱과 같게).
        "road_to_jibun" => a.s("text").and_then(|t| json(gilog_core::road_to_jibun(&t))),
        "set_complaint_status" => (|| {
            let (id, status, done): (i64, String, Option<String>) = (a.id("id")?, a.s("status")?, a.get("done")?);
            with(s, |st| st.set_complaint_status(id, &status, done.as_deref()))
        })(),
        "set_complaint_memo" => (|| {
            let (id, memo) = (a.id("id")?, a.s("memo")?);
            with(s, |st| st.set_complaint_memo(id, &memo))
        })(),
        "replace_complaint_field" => (|| {
            let (field, from, to) = (a.s("field")?, a.s("from")?, a.s("to")?);
            with(s, |st| st.replace_complaint_field(&field, &from, &to))
        })(),
        "delete_complaint" => (|| {
            let id = a.id("id")?;
            with(s, |st| st.delete_complaint(id))
        })(),
        "import_complaints" => (|| {
            let (rows, replace): (Vec<ComplaintImport>, Option<bool>) = (a.get("rows")?, a.get("replace")?);
            with(s, |st| st.import_complaints(&rows, replace.unwrap_or(false)))
        })(),
        "import_contacts" => (|| {
            let (rows, replace): (Vec<ContactImport>, Option<bool>) = (a.get("rows")?, a.get("replace")?);
            with(s, |st| st.import_contacts(&rows, replace.unwrap_or(false)))
        })(),

        // ---------- 엑셀 – 가짜 드라이브(경로 → 바이트) ----------
        "excel_write" => (|| {
            let (path, kind, data): (String, SheetKind, ExcelExport) = (a.s("path")?, a.get("kind")?, a.get("data")?);
            let bytes = excel::xlsx_bytes(kind, &data).map_err(|e| e.code().to_string())?;
            s.drive.insert(path, bytes);
            Ok(Value::Null)
        })(),
        "excel_read" => (|| {
            let (path, kind): (String, SheetKind) = (a.s("path")?, a.get("kind")?);
            let bytes = s.drive.get(&path).ok_or_else(|| "io".to_string())?;
            out(excel::read_xlsx_bytes(bytes, kind))
        })(),

        // ---------- 할 일 ----------
        "tasks_data" => with(s, |st| st.tasks_data()),
        "add_task_list" => (|| {
            let name = a.s("name")?;
            with(s, |st| st.add_task_list(&name))
        })(),
        "rename_task_list" => (|| {
            let (id, name) = (a.id("id")?, a.s("name")?);
            with(s, |st| st.rename_task_list(id, &name))
        })(),
        "set_task_list_visible" => (|| {
            let (id, visible): (i64, bool) = (a.id("id")?, a.get("visible")?);
            with(s, |st| st.set_task_list_visible(id, visible))
        })(),
        "move_task_list" => (|| {
            let (id, dir) = (a.id("id")?, a.id("dir")?);
            with(s, |st| st.move_task_list(id, dir))
        })(),
        "delete_task_list" => (|| {
            let id = a.id("id")?;
            with(s, |st| st.delete_task_list(id))
        })(),
        "add_task" => (|| {
            let t: TaskInput = a.get("task")?;
            with(s, |st| st.add_task(&t))
        })(),
        "update_task" => (|| {
            let (id, t): (i64, TaskEdit) = (a.id("id")?, a.get("task")?);
            with(s, |st| st.update_task(id, &t))
        })(),
        "set_task_done" => (|| {
            let (id, done, today): (i64, bool, String) = (a.id("id")?, a.get("done")?, a.s("today")?);
            with(s, |st| st.set_task_done(id, done, &today))
        })(),
        "delete_task" => (|| {
            let id = a.id("id")?;
            with(s, |st| st.delete_task(id))
        })(),

        // ---------- 캘린더 (앱 calendar.rs) ----------
        "calendar_data" => with(s, |st| st.calendar_data()),
        "add_event" => (|| {
            let e: EventInput = a.get("event")?;
            with(s, |st| st.add_event(&e))
        })(),
        "update_event" => (|| {
            let (id, e): (i64, EventInput) = (a.id("id")?, a.get("event")?);
            with(s, |st| st.update_event(id, &e))
        })(),
        "delete_event" => (|| {
            let id = a.id("id")?;
            with(s, |st| st.delete_event(id))
        })(),
        "cal_kinds" => with(s, |st| st.cal_kinds()),
        "add_cal_kind" => (|| {
            let name = a.s("name")?;
            with(s, |st| st.add_cal_kind(&name))
        })(),
        "set_cal_kind_color" => (|| {
            let (id, color): (i64, Option<i64>) = (a.id("id")?, a.get("color")?);
            with(s, |st| st.set_cal_kind_color(id, color))
        })(),
        "set_cal_kind_visible" => (|| {
            let (id, visible): (i64, bool) = (a.id("id")?, a.get("visible")?);
            with(s, |st| st.set_cal_kind_visible(id, visible))
        })(),
        "delete_cal_kind" => (|| {
            let id = a.id("id")?;
            with(s, |st| st.delete_cal_kind(id))
        })(),
        "save_holidays" => (|| {
            let (list, now): (Vec<Holiday>, String) = (a.get("list")?, a.s("now")?);
            with(s, |st| st.replace_holidays(&list, &now))
        })(),

        // ---------- 집행현황 (앱 budget.rs) ----------
        "budget_data" => (|| {
            let year = a.id("year")?;
            with(s, |st| st.budget_data(year))
        })(),
        "save_budget_project" => (|| {
            let (year, id, after, name, budget): (i64, Option<i64>, Option<i64>, String, Option<i64>) =
                (a.id("year")?, a.get("id")?, a.get("after")?, a.s("name")?, a.get("budget")?);
            with(s, |st| st.save_budget_project(year, id, after, &name, budget))
        })(),
        "save_budget_item" => (|| {
            let (project, id, name, budget): (i64, Option<i64>, String, Option<i64>) = (a.id("project")?, a.get("id")?, a.s("name")?, a.get("budget")?);
            with(s, |st| st.save_budget_item(project, id, &name, budget))
        })(),
        "save_budget_row" => (|| {
            let (item, id, row): (i64, Option<i64>, BudgetRowInput) = (a.id("item")?, a.get("id")?, a.get("row")?);
            with(s, |st| st.save_budget_row(item, id, &row))
        })(),
        "set_budget_stage" => (|| {
            let (id, stage) = (a.id("id")?, a.s("stage")?);
            with(s, |st| st.set_budget_stage(id, &stage))
        })(),
        "set_budget_memo" => (|| {
            let (level, id, memo): (BudgetLevel, i64, String) = (a.get("level")?, a.id("id")?, a.s("memo")?);
            with(s, |st| st.set_budget_memo(level, id, &memo))
        })(),
        "set_budget_open" => (|| {
            let (level, id, open, all): (BudgetLevel, i64, bool, bool) = (a.get("level")?, a.id("id")?, a.get("open")?, a.get("all")?);
            with(s, |st| st.set_budget_open(level, id, open, all))
        })(),
        "move_budget" => (|| {
            let (level, id, dir): (BudgetLevel, i64, i64) = (a.get("level")?, a.id("id")?, a.id("dir")?);
            with(s, |st| st.move_budget(level, id, dir))
        })(),
        "move_budget_item" => (|| {
            let (id, to) = (a.id("id")?, a.id("to")?);
            with(s, |st| st.move_budget_item(id, to))
        })(),
        "move_budget_row" => (|| {
            let (id, to) = (a.id("id")?, a.id("to")?);
            with(s, |st| st.move_budget_row(id, to))
        })(),
        "delete_budget" => (|| {
            let (level, id): (BudgetLevel, i64) = (a.get("level")?, a.id("id")?);
            with(s, |st| st.delete_budget(level, id))
        })(),
        "copy_budget_year" => (|| {
            let (from, to) = (a.id("from")?, a.id("to")?);
            with(s, |st| st.copy_budget_year(from, to))
        })(),
        "import_budget" => (|| {
            let (year, projects, replace): (i64, Vec<BudgetImportProject>, bool) = (a.id("year")?, a.get("projects")?, a.get::<Option<bool>>("replace")?.unwrap_or(false));
            with(s, |st| st.import_budget(year, &projects, replace))
        })(),
        "budget_excel_write" => (|| {
            let (path, data): (String, BudgetExport) = (a.s("path")?, a.get("data")?);
            let bytes = budget_xlsx::budget_xlsx_bytes(&data).map_err(|e| e.code().to_string())?;
            s.drive.insert(path, bytes);
            Ok(Value::Null)
        })(),
        "budget_excel_read" => (|| {
            let path = a.s("path")?;
            let bytes = s.drive.get(&path).ok_or_else(|| "io".to_string())?;
            out(budget_xlsx::read_grid_bytes(bytes))
        })(),
        "budget_years" => with(s, |st| st.budget_years()),
        "set_budget_owner" => (|| {
            let (id, owner): (i64, Option<i64>) = (a.id("id")?, a.get("owner")?);
            with(s, |st| st.set_budget_owner(id, owner))
        })(),
        "budget_share_apply" => (|| {
            let ops: Vec<BudgetShareOp> = a.get("ops")?;
            with(s, |st| st.budget_share_apply(&ops))
        })(),
        "budget_share_clear" => with(s, |st| st.budget_share_clear()),

        // ---------- 예산현황 (앱 bstatus.rs) ----------
        "bstatus_list" => with(s, |st| {
            st.bstatus_sync()?;
            st.bstatus_list()
        }),
        "bstatus_set" => (|| {
            let (name, setup) = (a.s("name")?, a.s("setup")?);
            with(s, |st| st.bstatus_set(&name, &setup))
        })(),
        "bstatus_excel_write" => (|| {
            let (path, data): (String, BStatusExport) = (a.s("path")?, a.get("data")?);
            let bytes = gilog_core::bstatus::bstatus_xlsx_bytes(&data).map_err(|e| e.code().to_string())?;
            s.drive.insert(path, bytes);
            Ok(Value::Null)
        })(),

        // ---------- 민원처리 저장 (앱 process.rs) ----------
        "process_data" => with(s, |st| st.process_data()),
        "save_work" => (|| {
            let (id, work): (Option<i64>, WorkInput) = (a.get("id")?, a.get("work")?);
            with(s, |st| st.save_work(id, &work))
        })(),
        "delete_work" => (|| {
            let id = a.id("id")?;
            with(s, |st| st.delete_work(id))
        })(),
        "update_case" => (|| {
            let (no, patch): (String, CasePatch) = (a.s("no")?, a.get("patch")?);
            with(s, |st| st.update_case(&no, &patch))
        })(),
        "delete_case" => (|| {
            let no = a.s("no")?;
            with(s, |st| st.delete_case(&no))
        })(),
        "order_mailed" => (|| {
            let (id, to, at, subject, ok): (i64, String, String, Option<String>, Option<bool>) = (a.id("id")?, a.s("to")?, a.s("at")?, a.get("subject")?, a.get("ok")?);
            with(s, |st| {
                st.update_order(
                    id,
                    &OrderPatch {
                        mail_to: Some(to.trim().to_string()),
                        mailed_at: Some(at.trim().to_string()),
                        mail_subject: subject.map(|v| v.trim().to_string()),
                        mail_ok: Some(ok.unwrap_or(true)),
                        ..Default::default()
                    },
                )
            })
        })(),

        _ => return None,
    })
}
