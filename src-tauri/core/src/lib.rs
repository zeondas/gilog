//! giLog의 자료 파일을 만들고, 열고, 잠그는 부분이에요.
//!
//! - 자료는 폴더 안의 `gilog.db` 파일 하나에 들어가고, SQLCipher로 통째로 암호화해요.
//! - 열쇠는 잠금 암호에서 Argon2id로 만들어요. 그때 쓴 소금(salt)과 설정은
//!   `gilog.key.json`에 적어 둬요. 이 파일에는 암호도 열쇠도 들어 있지 않아요.

use std::fs;
use std::path::{Path, PathBuf};

use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub mod address;
mod budget;
pub mod budget_xlsx;
pub mod bstatus;
mod calendar;
mod complaints;
mod contacts;
pub mod excel;
mod journal;
mod order;
mod standard;
mod process;
mod tasks;
pub use address::{extract_paju, reset_road_table, road_table_count, road_to_jibun, set_road_table, RoadHit, RoadLookup};
pub use bstatus::{BStatusExport, BStatusLine, BStatusSetup};
pub use budget::{BudgetShareOp, BudgetImportItem, BudgetImportProject, BudgetImportRow, BudgetItem, BudgetLevel, BudgetProject, BudgetRow, BudgetRowInput, BUDGET_KINDS, BUDGET_STAGES};
pub use calendar::{CalKind, CalendarData, Event, EventInput, Holiday, BUILTIN_HOLIDAYS, KIND_COLORS, REMIND_MAX, SYSTEM_KINDS};
pub use complaints::{Complaint, ComplaintImport, ComplaintInput, DEFAULT_STATUS};
pub use contacts::{Contact, ContactImport, ContactInput, ContactsData, Project, ProjectGroup, PROJECT_COLORS};
pub use journal::{DayInfo, Entry, EntryInput, JournalData, JournalLine};
pub use order::{fill_order, image_size, OrderFill, OrderKind, OrderReport};
pub use standard::{fill_standard, korean_date, StdItem, STANDARD_TEMPLATE};
pub use process::{Case, CaseInput, CasePatch, Order, OrderPatch, ProcessData, Work, WorkInput, UNKNOWN_PLACE};
pub use tasks::{Task, TaskEdit, TaskInput, TaskList, TasksData, COMPLAINT_LIST};

const DB_FILE: &str = "gilog.db";
const META_FILE: &str = "gilog.key.json";
const META_NEW_FILE: &str = "gilog.key.new.json";

/// 암호 최소 길이예요.
pub const MIN_PASSWORD_LEN: usize = 4;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("암호가 맞지 않아요")]
    WrongPassword,
    #[error("자료 파일이 이미 있어요")]
    AlreadyExists,
    #[error("자료 파일이 없어요")]
    NotFound,
    #[error("암호가 너무 짧아요")]
    PasswordTooShort,
    #[error("파일을 읽거나 쓰지 못했어요: {0}")]
    Io(#[from] std::io::Error),
    #[error("자료 파일에 문제가 있어요: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("열쇠 정보 파일을 읽지 못했어요: {0}")]
    Meta(String),
    #[error("넣은 값이 맞지 않아요: {0}")]
    Invalid(String),
}

impl Error {
    /// 화면 쪽에서 구분해 쓰는 짧은 이름이에요.
    pub fn code(&self) -> &'static str {
        match self {
            Error::WrongPassword => "wrong_password",
            Error::AlreadyExists => "already_exists",
            Error::NotFound => "not_found",
            Error::PasswordTooShort => "password_too_short",
            Error::Io(_) => "io",
            Error::Db(_) => "db",
            Error::Meta(_) => "meta",
            Error::Invalid(_) => "invalid",
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// 암호에서 열쇠를 만들 때 쓴 값이에요. 비밀이 아니에요.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Meta {
    v: u32,
    salt: String,
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
}

impl Meta {
    fn fresh() -> Meta {
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        Meta {
            v: 1,
            salt: hex::encode(salt),
            // 메모리 64MB, 3회 반복. 한 번 여는 데 1초 안쪽이에요.
            m_cost: 64 * 1024,
            t_cost: 3,
            p_cost: 1,
        }
    }

    fn derive(&self, password: &str) -> Result<[u8; 32]> {
        let salt = hex::decode(&self.salt).map_err(|e| Error::Meta(e.to_string()))?;
        let params = Params::new(self.m_cost, self.t_cost, self.p_cost, Some(32))
            .map_err(|e| Error::Meta(e.to_string()))?;
        let mut key = [0u8; 32];
        Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
            .hash_password_into(password.as_bytes(), &salt, &mut key)
            .map_err(|e| Error::Meta(e.to_string()))?;
        Ok(key)
    }

    fn read(path: &Path) -> Result<Meta> {
        let text = fs::read_to_string(path)?;
        serde_json::from_str(&text).map_err(|e| Error::Meta(e.to_string()))
    }

    fn write(&self, path: &Path) -> Result<()> {
        let text = serde_json::to_string_pretty(self).map_err(|e| Error::Meta(e.to_string()))?;
        fs::write(path, text)?;
        Ok(())
    }
}

/// 폴더에 자료 파일이 있는지 봐요.
pub fn exists(dir: &Path) -> bool {
    dir.join(DB_FILE).is_file()
}

/// 열려 있는 자료 파일이에요. 이 값을 버리면(drop) 잠겨요.
pub struct Store {
    conn: Connection,
    dir: PathBuf,
    key: [u8; 32],
}

fn open_with_key(dir: &Path, key: &[u8; 32]) -> Result<Connection> {
    let conn = Connection::open(dir.join(DB_FILE))?;
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
    // 열쇠가 틀리면 첫 읽기에서 실패해요.
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
        Ok(_) => Ok(conn),
        Err(_) => Err(Error::WrongPassword),
    }
}

fn check_len(password: &str) -> Result<()> {
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(Error::PasswordTooShort);
    }
    Ok(())
}

impl Store {
    /// 새 자료 파일을 만들어요. 이미 있으면 덮어쓰지 않고 실패해요.
    pub fn create(dir: &Path, password: &str) -> Result<Store> {
        check_len(password)?;
        if exists(dir) {
            return Err(Error::AlreadyExists);
        }
        fs::create_dir_all(dir)?;
        let meta = Meta::fresh();
        let key = meta.derive(password)?;
        meta.write(&dir.join(META_FILE))?;
        let conn = open_with_key(dir, &key)?;
        let store = Store { conn, dir: dir.to_path_buf(), key };
        store.migrate()?;
        Ok(store)
    }

    /// 암호로 자료 파일을 열어요.
    pub fn open(dir: &Path, password: &str) -> Result<Store> {
        if !exists(dir) {
            return Err(Error::NotFound);
        }
        // 암호를 바꾸던 중에 꺼졌다면 새 열쇠 정보가 남아 있을 수 있어서 둘 다 시도해요.
        let mut last = Error::NotFound;
        for (name, is_new) in [(META_FILE, false), (META_NEW_FILE, true)] {
            let path = dir.join(name);
            if !path.is_file() {
                continue;
            }
            let meta = Meta::read(&path)?;
            let key = meta.derive(password)?;
            match open_with_key(dir, &key) {
                Ok(conn) => {
                    if is_new {
                        fs::rename(&path, dir.join(META_FILE))?;
                    } else {
                        let _ = fs::remove_file(dir.join(META_NEW_FILE));
                    }
                    let store = Store { conn, dir: dir.to_path_buf(), key };
                    store.migrate()?;
                    return Ok(store);
                }
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS kv (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;
        self.conn.execute_batch(contacts::SCHEMA)?;
        contacts::upgrade(&self.conn)?;
        self.conn.execute_batch(journal::SCHEMA)?;
        journal::upgrade(&self.conn)?;
        self.conn.execute_batch(complaints::SCHEMA)?;
        complaints::upgrade(&self.conn)?;
        self.conn.execute_batch(tasks::SCHEMA)?;
        tasks::seed(&self.conn)?;
        self.conn.execute_batch(calendar::SCHEMA)?;
        calendar::upgrade(&self.conn)?;
        calendar::seed(&self.conn)?;
        self.conn.execute_batch(process::SCHEMA)?;
        process::upgrade(&self.conn)?;
        self.conn.execute_batch(budget::SCHEMA)?;
        budget::upgrade(&self.conn)?;
        self.conn.execute_batch(bstatus::SCHEMA)?;
        Ok(())
    }

    /// 열려 있는 파일의 비밀번호가 맞는지만 봐요(윈도우 PIN 풀기를 켤 때).
    pub fn check_password(&self, password: &str) -> Result<()> {
        let current = Meta::read(&self.dir.join(META_FILE))?;
        if current.derive(password)? != self.key {
            return Err(Error::WrongPassword);
        }
        Ok(())
    }

    /// 지금 암호가 맞는지 확인하고 새 암호로 바꿔요.
    pub fn change_password(&mut self, old: &str, new: &str) -> Result<()> {
        check_len(new)?;
        let current = Meta::read(&self.dir.join(META_FILE))?;
        if current.derive(old)? != self.key {
            return Err(Error::WrongPassword);
        }
        let meta = Meta::fresh();
        let key = meta.derive(new)?;
        let new_path = self.dir.join(META_NEW_FILE);
        meta.write(&new_path)?;
        self.conn
            .execute_batch(&format!("PRAGMA rekey = \"x'{}'\";", hex::encode(key)))?;
        fs::rename(&new_path, self.dir.join(META_FILE))?;
        self.key = key;
        Ok(())
    }

    pub fn get(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM kv WHERE key = ?1", params![key], |r| r.get(0))
            .optional()?)
    }

    pub fn set(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO kv (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// 열쇠를 16진수 글자로 꺼내요. "앱을 열 때 암호 묻기"를 끌 때 윈도우 자격 증명 관리자에 맡기는 용도예요.
    pub fn key_hex(&self) -> String {
        hex::encode(self.key)
    }

    /// 암호 없이 열쇠로 바로 열어요. 자격 증명 관리자에서 열쇠를 돌려받았을 때 써요.
    pub fn open_with_key_hex(dir: &Path, key_hex: &str) -> Result<Store> {
        if !exists(dir) {
            return Err(Error::NotFound);
        }
        let bytes = hex::decode(key_hex).map_err(|_| Error::WrongPassword)?;
        let key: [u8; 32] = bytes.try_into().map_err(|_| Error::WrongPassword)?;
        let conn = open_with_key(dir, &key)?;
        let store = Store { conn, dir: dir.to_path_buf(), key };
        store.migrate()?;
        Ok(store)
    }

    /// 자료 파일과 열쇠 정보를 파일 하나로 내보내요. 내용은 암호화된 그대로예요.
    pub fn export_backup(&self, to: &Path) -> Result<()> {
        // 쓰다 만 내용이 없게 하고 파일을 복사해요.
        self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        let meta = fs::read_to_string(self.dir.join(META_FILE))?;
        let db = fs::read(self.dir.join(DB_FILE))?;
        let mut out = Vec::with_capacity(db.len() + meta.len() + 64);
        out.extend_from_slice(BACKUP_MAGIC);
        out.extend_from_slice(meta.replace('\n', "").as_bytes());
        out.push(b'\n');
        out.extend_from_slice(&db);
        fs::write(to, out)?;
        Ok(())
    }
}

const BACKUP_MAGIC: &[u8] = b"giLog backup 1\n";

/// 백업 파일을 그 파일의 암호로 열어 보고, 맞으면 지금 자료를 그것으로 바꿔요.
/// 열려 있는 Store가 없을 때 불러야 해요.
pub fn restore_backup(dir: &Path, from: &Path, password: &str) -> Result<()> {
    let bytes = fs::read(from)?;
    if !bytes.starts_with(BACKUP_MAGIC) {
        return Err(Error::Meta("백업 파일이 아니에요".into()));
    }
    let rest = &bytes[BACKUP_MAGIC.len()..];
    let nl = rest
        .iter()
        .position(|b| *b == b'\n')
        .ok_or_else(|| Error::Meta("백업 파일이 깨졌어요".into()))?;
    let meta = &rest[..nl];
    let db = &rest[nl + 1..];

    // 먼저 임시 폴더에 풀어 암호가 맞는지 확인해요.
    let tmp = dir.join(".restore-tmp");
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp)?;
    fs::write(tmp.join(META_FILE), meta)?;
    fs::write(tmp.join(DB_FILE), db)?;
    match Store::open(&tmp, password) {
        Ok(s) => drop(s),
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            return Err(e);
        }
    }
    // 맞으면 지금 파일을 바꿔요.
    let _ = fs::remove_file(dir.join(META_NEW_FILE));
    fs::rename(tmp.join(DB_FILE), dir.join(DB_FILE))?;
    fs::rename(tmp.join(META_FILE), dir.join(META_FILE))?;
    let _ = fs::remove_dir_all(&tmp);
    Ok(())
}

/// 자료 폴더를 통째로 옮겨요. 열려 있는 Store가 없을 때 불러야 해요.
pub fn move_data(from: &Path, to: &Path) -> Result<()> {
    if exists(to) {
        return Err(Error::AlreadyExists);
    }
    fs::create_dir_all(to)?;
    for name in [DB_FILE, META_FILE] {
        let src = from.join(name);
        if src.is_file() {
            fs::copy(&src, to.join(name))?;
        }
    }
    for name in [DB_FILE, META_FILE, META_NEW_FILE] {
        let _ = fs::remove_file(from.join(name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_then_reopen_keeps_data() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.set("note", "봉일천리 113").unwrap();
        }
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.get("note").unwrap().as_deref(), Some("봉일천리 113"));
        assert_eq!(s.get("없는 것").unwrap(), None);
    }

    #[test]
    fn wrong_password_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        drop(Store::create(tmp.path(), "abcd1234").unwrap());
        let err = Store::open(tmp.path(), "abcd1235").err().unwrap();
        assert_eq!(err.code(), "wrong_password");
    }

    #[test]
    fn file_on_disk_is_not_readable_without_key() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.set("note", "PLAINTEXT-MARKER-민원인").unwrap();
        }
        let bytes = fs::read(tmp.path().join(DB_FILE)).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"));
        let needle = "PLAINTEXT-MARKER".as_bytes();
        assert!(!bytes.windows(needle.len()).any(|w| w == needle));
        // 열쇠 정보 파일에도 암호가 없어야 해요.
        let meta = fs::read_to_string(tmp.path().join(META_FILE)).unwrap();
        assert!(!meta.contains("abcd1234"));
    }

    #[test]
    fn create_refuses_to_overwrite() {
        let tmp = tempfile::tempdir().unwrap();
        drop(Store::create(tmp.path(), "abcd1234").unwrap());
        let err = Store::create(tmp.path(), "zzzz9999").err().unwrap();
        assert_eq!(err.code(), "already_exists");
    }

    #[test]
    fn short_password_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let err = Store::create(tmp.path(), "abc").err().unwrap();
        assert_eq!(err.code(), "password_too_short");
        assert!(!exists(tmp.path()));
    }

    #[test]
    fn change_password_works_and_old_one_stops_working() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.set("note", "남아 있어야 해요").unwrap();
            assert_eq!(s.change_password("틀린암호", "new-pass-1").err().unwrap().code(), "wrong_password");
            s.change_password("abcd1234", "new-pass-1").unwrap();
            // 바꾼 직후에도 계속 읽고 쓸 수 있어야 해요.
            s.set("after", "ok").unwrap();
        }
        assert_eq!(Store::open(tmp.path(), "abcd1234").err().unwrap().code(), "wrong_password");
        let s = Store::open(tmp.path(), "new-pass-1").unwrap();
        assert_eq!(s.get("note").unwrap().as_deref(), Some("남아 있어야 해요"));
        assert_eq!(s.get("after").unwrap().as_deref(), Some("ok"));
        assert!(!tmp.path().join(META_NEW_FILE).exists());
    }

    #[test]
    fn check_password_tells_right_from_wrong() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::create(dir.path(), "abcd1234").unwrap();
        s.check_password("abcd1234").unwrap();
        assert_eq!(s.check_password("틀린암호").err().unwrap().code(), "wrong_password");
        s.change_password("abcd1234", "new-pass-1").unwrap();
        assert_eq!(s.check_password("abcd1234").err().unwrap().code(), "wrong_password");
        s.check_password("new-pass-1").unwrap();
    }

    #[test]
    fn key_hex_opens_without_password() {
        let tmp = tempfile::tempdir().unwrap();
        let key = {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.set("a", "b").unwrap();
            s.key_hex()
        };
        let s = Store::open_with_key_hex(tmp.path(), &key).unwrap();
        assert_eq!(s.get("a").unwrap().as_deref(), Some("b"));
        assert_eq!(Store::open_with_key_hex(tmp.path(), "00ff").err().unwrap().code(), "wrong_password");
    }

    #[test]
    fn backup_roundtrip_and_wrong_password() {
        let tmp = tempfile::tempdir().unwrap();
        let bak = tmp.path().join("b.gilogbak");
        {
            let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.set("note", "백업 전").unwrap();
            s.export_backup(&bak).unwrap();
            s.set("note", "백업 뒤에 바뀐 것").unwrap();
            s.change_password("abcd1234", "other-pw").unwrap();
        }
        // 백업 파일에도 글자가 그대로 보이면 안 돼요.
        let bytes = fs::read(&bak).unwrap();
        assert!(!bytes.windows(6).any(|w| w == "백업".as_bytes()));
        assert_eq!(restore_backup(tmp.path(), &bak, "wrong").err().unwrap().code(), "wrong_password");
        // 실패했으면 지금 자료는 그대로예요.
        assert_eq!(Store::open(tmp.path(), "other-pw").unwrap().get("note").unwrap().as_deref(), Some("백업 뒤에 바뀐 것"));
        restore_backup(tmp.path(), &bak, "abcd1234").unwrap();
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        assert_eq!(s.get("note").unwrap().as_deref(), Some("백업 전"));
        assert!(!tmp.path().join(".restore-tmp").exists());
    }

    #[test]
    fn move_data_keeps_everything() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        drop(Store::create(&a, "abcd1234").unwrap());
        move_data(&a, &b).unwrap();
        assert!(!exists(&a));
        Store::open(&b, "abcd1234").unwrap();
    }

    #[test]
    fn open_recovers_when_rename_was_interrupted() {
        // 암호를 바꾸다 열쇠 정보 파일 이름을 바꾸기 직전에 꺼진 상황이에요.
        let tmp = tempfile::tempdir().unwrap();
        {
            let mut s = Store::create(tmp.path(), "abcd1234").unwrap();
            let old_meta = fs::read(tmp.path().join(META_FILE)).unwrap();
            s.change_password("abcd1234", "new-pass-1").unwrap();
            fs::rename(tmp.path().join(META_FILE), tmp.path().join(META_NEW_FILE)).unwrap();
            fs::write(tmp.path().join(META_FILE), old_meta).unwrap();
        }
        let s = Store::open(tmp.path(), "new-pass-1").unwrap();
        s.set("x", "y").unwrap();
        drop(s);
        assert!(!tmp.path().join(META_NEW_FILE).exists());
        Store::open(tmp.path(), "new-pass-1").unwrap();
    }
}
