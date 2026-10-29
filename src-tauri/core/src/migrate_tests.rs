//! 자료 올리기(마이그레이션) 시험 – 품질 보완 ③(2026-10-29, `wip/ci2`).
//!
//! 옛 형식 파일을 시험이 직접 만들어(저장소에 .db 파일을 넣지 않아요) 지금 앱으로 열고,
//! 버전이 `SCHEMA_VERSION`으로 오르는지·나중에 더한 칸이 생기는지·자료가 그대로인지 봐요.
//!
//! **`SCHEMA_VERSION`을 올릴 때**: 올리기 직전 형식을 만드는 함수를 `OLD_FORMATS` 끝에 하나 더해요
//! (버전 N-1 파일 = 그때 표 구조 그대로, 지금 표를 복사하지 말고 글로 적어 고정). 더하지 않으면
//! `every_version_has_a_fixture`가 실패해요.

use super::*;

/// 버전마다 옛 파일 만들기 – 칸 번호 = 그 파일의 user_version.
const OLD_FORMATS: &[fn(&Connection)] = &[v0_tables];

/// 버전 번호를 두기 전(0.35.0 무렵까지) 파일. `upgrade()`가 더하는 칸 14개가 없는 모양이에요:
/// projects.alias·group_id, journal_entries.body, complaints.road·done, events.remind_time,
/// works.full, cases.road·order_id·item, budget_projects·items·rows.uid, budget_projects.owner.
/// orders·project_groups·bstatus 표도 없어요(열 때 새로 생겨요).
fn v0_tables(c: &Connection) {
    c.execute_batch(
        "
        CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color INTEGER);
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, org TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '',
            mobile TEXT NOT NULL DEFAULT '', tel TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '');
        CREATE TABLE contact_projects (contact_id INTEGER NOT NULL, project_id INTEGER NOT NULL, pos INTEGER NOT NULL,
            PRIMARY KEY (contact_id, project_id));
        CREATE TABLE journal_days (date TEXT PRIMARY KEY, arrive TEXT NOT NULL DEFAULT '', transport TEXT NOT NULL DEFAULT '',
            weather TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '');
        CREATE TABLE journal_entries (id INTEGER PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '',
            who TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', project_id INTEGER, lines TEXT NOT NULL DEFAULT '[]');
        CREATE TABLE complaints (id INTEGER PRIMARY KEY, no INTEGER NOT NULL, intake TEXT NOT NULL DEFAULT '', received TEXT NOT NULL,
            ctype TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '', person TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '');
        CREATE TABLE task_lists (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, visible INTEGER NOT NULL DEFAULT 1,
            builtin INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE tasks (id INTEGER PRIMARY KEY, list INTEGER NOT NULL, parent INTEGER, title TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0, done_on TEXT NOT NULL DEFAULT '');
        CREATE TABLE cal_kinds (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color INTEGER, visible INTEGER NOT NULL DEFAULT 1,
            system TEXT NOT NULL DEFAULT '', ord INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, kind INTEGER NOT NULL, date TEXT NOT NULL, end_date TEXT NOT NULL,
            all_day INTEGER NOT NULL DEFAULT 1, time TEXT NOT NULL DEFAULT '', end_time TEXT NOT NULL DEFAULT '',
            repeat TEXT NOT NULL DEFAULT '', until TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '',
            descr TEXT NOT NULL DEFAULT '', remind INTEGER NOT NULL DEFAULT -1);
        CREATE TABLE holidays (date TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (date, name));
        CREATE TABLE works (id INTEGER PRIMARY KEY, name TEXT NOT NULL, co TEXT NOT NULL DEFAULT '', contact INTEGER, project INTEGER,
            scope TEXT NOT NULL DEFAULT '', next_seq INTEGER NOT NULL DEFAULT 1, tpl TEXT NOT NULL DEFAULT '');
        CREATE TABLE cases (no TEXT PRIMARY KEY, received TEXT NOT NULL DEFAULT '', due TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
            place TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', short TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
            work INTEGER, note TEXT NOT NULL DEFAULT '', seq TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'new', complaint INTEGER,
            photos TEXT NOT NULL DEFAULT '[]', map TEXT NOT NULL DEFAULT '', folder TEXT NOT NULL DEFAULT '', order_file TEXT NOT NULL DEFAULT '',
            order_jpg TEXT NOT NULL DEFAULT '', outbox_file TEXT NOT NULL DEFAULT '', sent_at TEXT NOT NULL DEFAULT '', added INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE budget_projects (id INTEGER PRIMARY KEY, year INTEGER NOT NULL, ord INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL,
            budget INTEGER, carry INTEGER NOT NULL DEFAULT 0, open INTEGER NOT NULL DEFAULT 1, memo TEXT NOT NULL DEFAULT '');
        CREATE TABLE budget_items (id INTEGER PRIMARY KEY, project INTEGER NOT NULL REFERENCES budget_projects(id) ON DELETE CASCADE,
            ord INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, budget INTEGER, open INTEGER NOT NULL DEFAULT 0, memo TEXT NOT NULL DEFAULT '');
        CREATE TABLE budget_rows (id INTEGER PRIMARY KEY, item INTEGER NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
            ord INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT '공사', co TEXT NOT NULL DEFAULT '',
            cmt INTEGER NOT NULL DEFAULT 0, exp INTEGER NOT NULL DEFAULT 0, act INTEGER NOT NULL DEFAULT 0,
            stage TEXT NOT NULL DEFAULT '준비', memo TEXT NOT NULL DEFAULT '');

        INSERT INTO kv VALUES ('note', '옛 자료');
        INSERT INTO projects VALUES (1, '시도15호선 도로정비', 3);
        INSERT INTO contacts (id, name, org, mobile) VALUES (1, '김도로', '파주시', '010-1234-5678');
        INSERT INTO contact_projects VALUES (1, 1, 0);
        INSERT INTO journal_days (date, weather) VALUES ('2025-10-20', '맑음');
        INSERT INTO journal_entries (id, date, time, kind, who, project_id, lines)
            VALUES (1, '2025-10-20', '09:30', '전화', '김도로', 1, '[{\"t\":\"포장 보수 일정 협의\"}]');
        INSERT INTO complaints (id, no, intake, received, ctype, area, place, person, phone, body, due, status)
            VALUES (1, 1, '전화', '2025-10-20', '포트홀', '조리읍', '봉일천리 113 일원', '홍길동', '010-0000-0000', '도로 파임', '2025-10-27', '처리중');
        INSERT INTO task_lists (id, name, builtin, ord) VALUES (1, '민원', 1, 0), (2, '행정업무', 0, 1);
        INSERT INTO tasks (id, list, title, due) VALUES (1, 2, '행정사무감사 자료', '2025-11-01');
        INSERT INTO cal_kinds (id, name, color, system, ord) VALUES (1, '업무', 5, '', 0);
        INSERT INTO events (id, title, kind, date, end_date, remind) VALUES (1, '현장 확인', 1, '2025-10-21', '2025-10-21', 60);
        INSERT INTO works (id, name, co) VALUES (1, '2025 도로 보수', '한빛건설');
        INSERT INTO cases (no, received, place, work, seq, stage, order_file, order_jpg, sent_at)
            VALUES ('1AA-2510-0001234', '2025-10-20', '봉일천리 113', 1, '3', 'sent', 'C:/지시부/3.hwpx', 'C:/지시부/3.jpg', '2025-10-21 10:00');
        INSERT INTO budget_projects (id, year, name, budget) VALUES (1, 2025, '도로 유지보수', 500000000);
        INSERT INTO budget_items (id, project, name, budget) VALUES (1, 1, '포장 보수', 300000000);
        INSERT INTO budget_rows (id, item, name, cmt, exp) VALUES (1, 1, '시도15호선 덧씌우기', 120000000, 80000000);
        ",
    )
    .unwrap();
}

/// 파일을 만들고 표를 모두 지운 뒤 `build`로 옛 모양을 만들어 버전을 `version`으로 둬요.
fn make_old(dir: &Path, version: i32, build: fn(&Connection)) {
    let s = Store::create(dir, "abcd1234").unwrap();
    let names: Vec<String> = s
        .conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    for n in names {
        s.conn.execute_batch(&format!("DROP TABLE \"{n}\";")).unwrap();
    }
    build(&s.conn);
    s.conn.execute_batch(&format!("PRAGMA user_version = {version};")).unwrap();
}

fn has_col(s: &Store, table: &str, col: &str) -> bool {
    s.conn
        .prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))
        .unwrap()
        .exists(params![col])
        .unwrap()
}

fn one<T: rusqlite::types::FromSql>(s: &Store, sql: &str) -> T {
    s.conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn every_version_has_a_fixture() {
    assert_eq!(
        OLD_FORMATS.len() as i32,
        SCHEMA_VERSION,
        "SCHEMA_VERSION을 올렸으면 migrate_tests.rs의 OLD_FORMATS에 직전 형식을 더해요"
    );
}

#[test]
fn every_old_format_opens_and_rises() {
    for (v, build) in OLD_FORMATS.iter().enumerate() {
        let tmp = tempfile::tempdir().unwrap();
        make_old(tmp.path(), v as i32, *build);
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        assert_eq!(one::<i32>(&s, "PRAGMA user_version"), SCHEMA_VERSION, "v{v} 파일");
        assert_eq!(one::<String>(&s, "PRAGMA quick_check"), "ok", "v{v} 파일");
        // 올리기 전 백업이 하나 남아요.
        let snaps = fs::read_dir(tmp.path().join(BACKUP_DIR)).unwrap().count();
        assert_eq!(snaps, 1, "v{v} 파일");
    }
}

#[test]
fn v0_file_gets_new_columns_and_keeps_data() {
    let tmp = tempfile::tempdir().unwrap();
    make_old(tmp.path(), 0, v0_tables);
    let s = Store::open(tmp.path(), "abcd1234").unwrap();

    // 나중에 더한 칸 14개 + 새로 생긴 orders 표의 칸
    for (t, c) in [
        ("projects", "alias"), ("projects", "group_id"), ("journal_entries", "body"),
        ("complaints", "road"), ("complaints", "done"), ("events", "remind_time"),
        ("works", "full"), ("cases", "road"), ("cases", "order_id"), ("cases", "item"),
        ("budget_projects", "uid"), ("budget_items", "uid"), ("budget_rows", "uid"), ("budget_projects", "owner"),
        ("orders", "mail_to"), ("orders", "mail_ok"),
    ] {
        assert!(has_col(&s, t, c), "{t}.{c} 칸이 없어요");
    }
    // 그 뒤에 생긴 표
    for t in ["orders", "project_groups", "bstatus"] {
        assert_eq!(one::<i64>(&s, &format!("SELECT count(*) FROM sqlite_master WHERE name = '{t}'")), 1, "{t} 표");
    }

    // 자료는 그대로
    assert_eq!(s.get("note").unwrap().as_deref(), Some("옛 자료"));
    assert_eq!(one::<String>(&s, "SELECT name FROM projects WHERE id = 1"), "시도15호선 도로정비");
    assert_eq!(one::<String>(&s, "SELECT alias FROM projects WHERE id = 1"), "");
    assert_eq!(one::<String>(&s, "SELECT mobile FROM contacts WHERE id = 1"), "010-1234-5678");
    assert_eq!(one::<i64>(&s, "SELECT count(*) FROM contact_projects"), 1);
    assert_eq!(one::<String>(&s, "SELECT weather FROM journal_days"), "맑음");
    assert_eq!(one::<String>(&s, "SELECT lines FROM journal_entries WHERE id = 1"), "[{\"t\":\"포장 보수 일정 협의\"}]");
    assert_eq!(one::<String>(&s, "SELECT body FROM journal_entries WHERE id = 1"), "");
    assert_eq!(one::<String>(&s, "SELECT place FROM complaints WHERE id = 1"), "봉일천리 113 일원");
    assert_eq!(one::<String>(&s, "SELECT status FROM complaints WHERE id = 1"), "처리중");
    assert_eq!(one::<i64>(&s, "SELECT no FROM complaints WHERE id = 1"), 1);
    // 민원인·연락처는 한 칸으로 합쳐 옮겨요(2026-10-21 ⑦⑧).
    assert_eq!(one::<String>(&s, "SELECT person FROM complaints WHERE id = 1"), "홍길동 010-0000-0000");
    assert_eq!(one::<String>(&s, "SELECT phone FROM complaints WHERE id = 1"), "");
    assert_eq!(one::<String>(&s, "SELECT title FROM tasks WHERE id = 1"), "행정사무감사 자료");
    assert_eq!(one::<i64>(&s, "SELECT count(*) FROM task_lists WHERE name = '민원' AND builtin = 1"), 1);
    assert_eq!(one::<i64>(&s, "SELECT remind FROM events WHERE id = 1"), 60);
    assert_eq!(one::<String>(&s, "SELECT co FROM works WHERE id = 1"), "한빛건설");
    assert_eq!(one::<i64>(&s, "SELECT exp FROM budget_rows WHERE id = 1"), 80000000);
    assert_eq!(one::<i64>(&s, "SELECT budget FROM budget_projects WHERE id = 1"), 500000000);
    // 팀 공유 이름(uid)은 빈 칸 없이 채워져요.
    for t in ["budget_projects", "budget_items", "budget_rows"] {
        assert_eq!(one::<i64>(&s, &format!("SELECT count(*) FROM {t} WHERE uid = ''")), 0, "{t}.uid");
    }
    // 예전에 한 건씩 보낸 지시부는 한 건짜리 지시부(orders)로 옮겨져요.
    assert_eq!(one::<i64>(&s, "SELECT count(*) FROM orders"), 1);
    assert_eq!(one::<i64>(&s, "SELECT seq FROM orders"), 3);
    assert_eq!(one::<String>(&s, "SELECT file FROM orders"), "C:/지시부/3.hwpx");
    assert_eq!(one::<String>(&s, "SELECT jpgs FROM orders"), "[\"C:/지시부/3.jpg\"]");
    assert_eq!(one::<String>(&s, "SELECT stage FROM orders"), "sent");
    assert_eq!(one::<i64>(&s, "SELECT item FROM cases"), 1);
    assert_eq!(
        one::<i64>(&s, "SELECT order_id FROM cases"),
        one::<i64>(&s, "SELECT id FROM orders")
    );
    drop(s);

    // 두 번째로 열어도 그대로예요(지시부를 또 만들지 않음, 백업도 하나).
    let s = Store::open(tmp.path(), "abcd1234").unwrap();
    assert_eq!(one::<i64>(&s, "SELECT count(*) FROM orders"), 1);
    assert_eq!(one::<String>(&s, "SELECT person FROM complaints WHERE id = 1"), "홍길동 010-0000-0000");
    assert_eq!(fs::read_dir(tmp.path().join(BACKUP_DIR)).unwrap().count(), 1);
}
