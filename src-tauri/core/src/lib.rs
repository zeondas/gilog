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
/// 자동 백업을 두는 폴더(자료 폴더 안)예요.
pub const BACKUP_DIR: &str = "backup";
/// 자동 백업은 마지막으로 연 날 7개만 남겨요.
pub const BACKUP_KEEP: usize = 7;
/// 이 앱이 아는 자료 형식 버전이에요. 표나 칸을 바꾸면 하나 올리고 `migrate()`에 적어요.
/// 0 = 버전 번호를 두기 전 파일(0.53.0까지).
pub const SCHEMA_VERSION: i32 = 1;

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
    #[error("자료 파일이 손상됐어요")]
    Corrupt,
    #[error("더 새 버전의 기록으로 만든 자료예요")]
    TooNew,
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
            Error::Corrupt => "corrupt",
            Error::TooNew => "too_new",
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
    /// 열쇠 검사 값 – 열쇠에서 한 방향으로 만든 값이라 이것으로 열쇠를 알 수는 없어요.
    /// 비밀번호가 맞는지를 자료 파일과 따로 알 수 있어 "손상"과 "암호 틀림"을 나눠요.
    /// 옛 파일(0.53.0까지)엔 없고, 다음에 열 때 생겨요.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    check: Option<String>,
}

/// 열쇠 검사 값을 만들어요(가벼운 Argon2, 고정 소금).
fn key_check(key: &[u8; 32]) -> String {
    let params = Params::new(8, 1, 1, Some(16)).expect("params");
    let mut out = [0u8; 16];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(key, b"giLog key check v1", &mut out)
        .expect("argon2");
    hex::encode(out)
}

/// 파일을 바로 덮어쓰지 않고 옆 임시 파일에 다 쓴 뒤 한 번에 바꿔치기해요.
/// 쓰다가 꺼져도 옛 파일이나 새 파일 둘 중 하나는 온전히 남아요.
/// 임시 이름은 `<이름>.tmp-<프로세스 번호>`라 두 번째 기록(--profile B)과 겹치지 않아요. 바꿔치기가 잠김(백신·색인)으로
/// 실패하면 짧게 3번 더 해 봐요(②-2 ✔5).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".tmp-{}", std::process::id()));
    let tmp = PathBuf::from(tmp);
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    let r = rename_retry(&tmp, path);
    if r.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    r
}

/// 이름 바꾸기 – 실패하면 50·100·150ms 쉬고 다시(모두 4번)
pub fn rename_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for i in 0..4u64 {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(50 * i));
        }
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("rename")))
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
            check: None,
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
        write_atomic(path, text.as_bytes())?;
        Ok(())
    }
}

/// 폴더에 자료 파일이 있는지 봐요. 되살리기가 중간에 끊긴 흔적(`.old`)이 있으면 먼저 짝을 맞춰요.
pub fn exists(dir: &Path) -> bool {
    recover_swap(dir);
    dir.join(DB_FILE).is_file()
}

const OLD_TAIL: &str = ".old";

fn old_of(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{OLD_TAIL}"))
}

/// 되살리기(`restore_backup`)는 옛 두 파일을 `.old`로 비켜 두고 새 두 파일을 넣은 뒤 `.old`를 지워요(②-2 ✔5).
/// 그 사이에 꺼졌으면: 새 두 파일이 다 있으면 바꿔치기는 끝난 것이라 `.old`만 지우고,
/// 하나라도 없으면 `.old` 짝으로 되돌려요 – 늘 옛 짝이나 새 짝 하나가 온전히 남아요.
pub fn recover_swap(dir: &Path) {
    let names = [DB_FILE, META_FILE];
    if !names.iter().any(|n| old_of(dir, n).is_file()) {
        return;
    }
    if names.iter().all(|n| dir.join(n).is_file()) {
        for n in names {
            let _ = fs::remove_file(old_of(dir, n));
        }
        return;
    }
    for n in names {
        let old = old_of(dir, n);
        if old.is_file() {
            let _ = rename_retry(&old, &dir.join(n));
        }
    }
}

/// 열려 있는 자료 파일이에요. 이 값을 버리면(drop) 잠겨요.
pub struct Store {
    conn: Connection,
    dir: PathBuf,
    key: [u8; 32],
}

/// 열쇠로 자료 파일을 열어요. `check`는 믿을 수 있는 열쇠 검사 값(없으면 옛 방식).
/// - 검사 값이 다르면 암호 틀림
/// - 검사 값이 맞는데 못 읽거나 손상 검사에 걸리면 손상
/// - 검사 값이 없으면(옛 파일) 첫 읽기 실패는 암호 틀림, 그 뒤 손상 검사에 걸리면 손상
fn open_with_key(dir: &Path, key: &[u8; 32], check: Option<&str>) -> Result<Connection> {
    let known = match check {
        Some(c) if c != key_check(key) => return Err(Error::WrongPassword),
        Some(_) => true,
        None => false,
    };
    let conn = Connection::open(dir.join(DB_FILE)).map_err(|_| if known { Error::Corrupt } else { Error::WrongPassword })?;
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex::encode(key)))?;
    // 열쇠가 틀리면(또는 첫 장이 깨지면) 첫 읽기에서 실패해요.
    if conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err() {
        return Err(if known { Error::Corrupt } else { Error::WrongPassword });
    }
    // 열쇠는 맞아요. 이제 파일이 온전한지 빠르게 봐요(모든 장을 한 번 읽어요).
    match conn.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0)) {
        Ok(ok) if ok == "ok" => Ok(conn),
        _ => Err(Error::Corrupt),
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
        let mut meta = Meta::fresh();
        let key = meta.derive(password)?;
        meta.check = Some(key_check(&key));
        meta.write(&dir.join(META_FILE))?;
        let conn = open_with_key(dir, &key, None)?;
        let store = Store { conn, dir: dir.to_path_buf(), key };
        store.migrate(false)?;
        Ok(store)
    }

    /// 암호로 자료 파일을 열어요.
    pub fn open(dir: &Path, password: &str) -> Result<Store> {
        if !exists(dir) {
            return Err(Error::NotFound);
        }
        // 암호를 바꾸던 중에 꺼졌다면 새 열쇠 정보가 남아 있을 수 있어서 둘 다 시도해요.
        // 그때는 어느 열쇠 정보가 자료 파일과 맞는지 모르니 열쇠 검사 값을 믿지 않아요(옛 방식).
        let interrupted = dir.join(META_NEW_FILE).is_file();
        let mut last = Error::NotFound;
        for (name, is_new) in [(META_FILE, false), (META_NEW_FILE, true)] {
            let path = dir.join(name);
            if !path.is_file() {
                continue;
            }
            let mut meta = Meta::read(&path)?;
            let key = meta.derive(password)?;
            let check = if interrupted { None } else { meta.check.as_deref() };
            match open_with_key(dir, &key, check) {
                Ok(conn) => {
                    if meta.check.as_deref() != Some(key_check(&key).as_str()) {
                        // 옛 파일이면 이번에 열쇠 검사 값을 적어 둬요.
                        meta.check = Some(key_check(&key));
                        meta.write(&path)?;
                    }
                    if is_new {
                        fs::rename(&path, dir.join(META_FILE))?;
                    } else {
                        let _ = fs::remove_file(dir.join(META_NEW_FILE));
                    }
                    let store = Store { conn, dir: dir.to_path_buf(), key };
                    store.migrate(true)?;
                    return Ok(store);
                }
                // 비밀번호는 맞는데 파일이 상했어요 – 다른 열쇠 정보로 더 해 볼 까닭이 없어요.
                Err(Error::Corrupt) => return Err(Error::Corrupt),
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    /// 자료 형식 버전을 보고 표를 맞춰요. 앱보다 새 버전이면 아무것도 안 바꾸고 멈춰요.
    /// `snapshot`이면 버전을 올리기 전에 백업을 하나 남겨요(새로 만든 파일은 안 남김).
    fn migrate(&self, snapshot: bool) -> Result<()> {
        let version: i32 = self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(Error::TooNew);
        }
        if version < SCHEMA_VERSION && snapshot {
            let name = format!("gilog_{}_before-v{}.gilogbak", today(), SCHEMA_VERSION);
            let folder = self.dir.join(BACKUP_DIR);
            fs::create_dir_all(&folder)?;
            let path = folder.join(name);
            if !path.exists() {
                self.export_backup(&path)?;
            }
            prune_before_v(&self.dir);
        }
        self.migrate_tables()?;
        if version < SCHEMA_VERSION {
            self.conn.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))?;
        }
        Ok(())
    }

    /// 표 만들기·칸 더하기. 몇 번 돌아도 같아요(IF NOT EXISTS·칸 있는지 보고 더함).
    fn migrate_tables(&self) -> Result<()> {
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
        let mut meta = Meta::fresh();
        let key = meta.derive(new)?;
        meta.check = Some(key_check(&key));
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
        let check = if dir.join(META_NEW_FILE).is_file() {
            None
        } else {
            Meta::read(&dir.join(META_FILE)).ok().and_then(|m| m.check)
        };
        let conn = open_with_key(dir, &key, check.as_deref())?;
        let store = Store { conn, dir: dir.to_path_buf(), key };
        store.migrate(true)?;
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
        write_atomic(to, &out)?;
        Ok(())
    }

    /// 오늘 자동 백업을 해요(그날 처음 한 번). 만들었으면 그 경로, 이미 있으면 None.
    pub fn auto_backup(&self) -> Result<Option<PathBuf>> {
        self.auto_backup_on(&today())
    }

    /// `auto_backup`의 날짜를 정해 부르는 쪽(시험용). `day`는 YYYY-MM-DD.
    pub fn auto_backup_on(&self, day: &str) -> Result<Option<PathBuf>> {
        let folder = self.dir.join(BACKUP_DIR);
        fs::create_dir_all(&folder)?;
        let path = folder.join(format!("gilog_{day}.gilogbak"));
        if path.exists() {
            return Ok(None);
        }
        self.export_backup(&path)?;
        let mut daily = daily_backups(&self.dir);
        while daily.len() > BACKUP_KEEP {
            let (_, old) = daily.remove(0);
            let _ = fs::remove_file(old);
        }
        Ok(Some(path))
    }
}

/// 오늘 날짜(이 PC 시각) YYYY-MM-DD
fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// 자동 백업(하루 하나짜리)을 오래된 것부터: (날짜, 경로). 버전 올리기 전 백업은 빼요.
pub fn daily_backups(dir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(read) = fs::read_dir(dir.join(BACKUP_DIR)) else {
        return out;
    };
    for e in read.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(day) = name.strip_prefix("gilog_").and_then(|n| n.strip_suffix(".gilogbak")) else {
            continue;
        };
        let b = day.as_bytes();
        let ok = b.len() == 10
            && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() });
        if ok {
            out.push((day.to_string(), e.path()));
        }
    }
    out.sort();
    out
}

/// 손상된 자료 파일을 지우지 않고 옆에 `gilog_손상_YYYY-MM-DD.db`로 복사해 둬요(되살리기 전에).
pub fn keep_corrupt(dir: &Path) -> Result<PathBuf> {
    let to = dir.join(format!("gilog_손상_{}.db", today()));
    fs::copy(dir.join(DB_FILE), &to)?;
    Ok(to)
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
    // 맞으면 지금 파일을 바꿔요. 옛 파일의 쓰다 만 기록(-journal·-wal·-shm)이 새 파일에 덧씌워지지 않게 먼저 치워요.
    let _ = fs::remove_file(dir.join(META_NEW_FILE));
    for tail in ["-journal", "-wal", "-shm"] {
        let _ = fs::remove_file(dir.join(format!("{DB_FILE}{tail}")));
    }
    swap_in(dir, &tmp, None)?;
    let _ = fs::remove_dir_all(&tmp);
    Ok(())
}

/// 임시 폴더의 새 두 파일로 바꿔요: 옛 둘 → `.old` · 새 둘 → 제자리 · `.old` 지움.
/// `stop_after`는 시험용(그 단계 뒤에 꺼진 것처럼 멈춤): 1 = 옛 하나 비킴, 2 = 옛 둘, 3 = 새 하나, 4 = 새 둘.
fn swap_in(dir: &Path, tmp: &Path, stop_after: Option<u8>) -> Result<()> {
    recover_swap(dir);
    let names = [DB_FILE, META_FILE];
    let mut step = 0u8;
    let stop = |step: u8| stop_after == Some(step);
    for n in names {
        if dir.join(n).is_file() {
            rename_retry(&dir.join(n), &old_of(dir, n))?;
        }
        step += 1;
        if stop(step) {
            return Ok(());
        }
    }
    for n in names {
        if let Err(e) = rename_retry(&tmp.join(n), &dir.join(n)) {
            // 새 파일을 다 못 넣었으면 옛 짝으로 되돌려요
            let _ = fs::remove_file(dir.join(n));
            recover_swap(dir);
            return Err(e.into());
        }
        step += 1;
        if stop(step) {
            return Ok(());
        }
    }
    for n in names {
        let _ = fs::remove_file(old_of(dir, n));
    }
    Ok(())
}

/// 백업 불러오기 전에 지금 자료를 `backup\gilog_YYYY-MM-DD_before-import.gilogbak`으로 남겨요(②-2 ✔5).
/// 자료가 닫혀 있을 때(잠근 뒤) 불러요 – 파일을 그대로 묶어요. 같은 날 두 번이면 `-2`·`-3`…을 붙여요.
pub fn snapshot_before_import(dir: &Path) -> Result<Option<PathBuf>> {
    if !exists(dir) || !dir.join(META_FILE).is_file() {
        return Ok(None);
    }
    let meta = fs::read_to_string(dir.join(META_FILE))?;
    let db = fs::read(dir.join(DB_FILE))?;
    let mut out = Vec::with_capacity(db.len() + meta.len() + 64);
    out.extend_from_slice(BACKUP_MAGIC);
    out.extend_from_slice(meta.replace('\n', "").as_bytes());
    out.push(b'\n');
    out.extend_from_slice(&db);
    let folder = dir.join(BACKUP_DIR);
    fs::create_dir_all(&folder)?;
    let day = today();
    let mut path = folder.join(format!("gilog_{day}_before-import.gilogbak"));
    let mut i = 2;
    while path.exists() {
        path = folder.join(format!("gilog_{day}_before-import-{i}.gilogbak"));
        i += 1;
    }
    write_atomic(&path, &out)?;
    Ok(Some(path))
}

/// 형식 버전 올리기 전 백업(`_before-vN`)은 최근 `BEFORE_V_KEEP`개만 둬요(이름 순 = 날짜 순).
pub const BEFORE_V_KEEP: usize = 3;

pub fn prune_before_v(dir: &Path) {
    let Ok(read) = fs::read_dir(dir.join(BACKUP_DIR)) else {
        return;
    };
    let mut list: Vec<PathBuf> = read
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            n.starts_with("gilog_") && n.contains("_before-v") && n.ends_with(".gilogbak")
        })
        .collect();
    list.sort();
    while list.len() > BEFORE_V_KEEP {
        let _ = fs::remove_file(list.remove(0));
    }
}

/// 복사하고 받은 쪽 크기가 원본과 같은지 확인해요
fn copy_checked(src: &Path, dst: &Path) -> Result<()> {
    fs::copy(src, dst)?;
    if fs::metadata(src)?.len() != fs::metadata(dst)?.len() {
        return Err(Error::Meta("복사한 파일 크기가 달라요".into()));
    }
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
            copy_checked(&src, &to.join(name))?;
        }
    }
    // 자동 백업 폴더도 함께 옮겨요. 모두 복사하고 크기를 확인한 뒤에만 원래 백업 폴더를 지워요(②-2 ✔5).
    let bak = from.join(BACKUP_DIR);
    if bak.is_dir() {
        let dest = to.join(BACKUP_DIR);
        fs::create_dir_all(&dest)?;
        for e in fs::read_dir(&bak)?.flatten() {
            if e.path().is_file() {
                copy_checked(&e.path(), &dest.join(e.file_name()))?;
            }
        }
        let _ = fs::remove_dir_all(&bak);
    }
    for name in [DB_FILE, META_FILE, META_NEW_FILE] {
        let _ = fs::remove_file(from.join(name));
    }
    Ok(())
}

#[cfg(test)]
mod migrate_tests;

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

    /// 쪽이 여러 장이 되게 자료를 채워요.
    fn fill(s: &Store) {
        for i in 0..400 {
            s.set(&format!("k{i}"), &"자료".repeat(40)).unwrap();
        }
    }

    /// 파일의 `at` 자리부터 `len` 바이트를 덮어써요(디스크가 상한 것처럼).
    fn smash(path: &Path, at: usize, len: usize) {
        let mut b = fs::read(path).unwrap();
        assert!(b.len() > at + len, "파일이 너무 작아요: {}", b.len());
        for x in &mut b[at..at + len] {
            *x ^= 0x5A;
        }
        fs::write(path, b).unwrap();
    }

    #[test]
    fn corrupt_middle_is_not_wrong_password() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            fill(&s);
        }
        let db = tmp.path().join(DB_FILE);
        let len = fs::metadata(&db).unwrap().len() as usize;
        smash(&db, len / 2, 512);
        assert_eq!(Store::open(tmp.path(), "abcd1234").err().unwrap().code(), "corrupt");
        // 틀린 비밀번호는 여전히 암호 틀림이에요.
        assert_eq!(Store::open(tmp.path(), "틀린암호").err().unwrap().code(), "wrong_password");
    }

    #[test]
    fn corrupt_first_page_is_corrupt_when_key_is_known() {
        let tmp = tempfile::tempdir().unwrap();
        drop(Store::create(tmp.path(), "abcd1234").unwrap());
        smash(&tmp.path().join(DB_FILE), 100, 200);
        assert_eq!(Store::open(tmp.path(), "abcd1234").err().unwrap().code(), "corrupt");
        assert_eq!(Store::open(tmp.path(), "틀린암호").err().unwrap().code(), "wrong_password");
    }

    #[test]
    fn old_meta_without_check_gets_one() {
        let tmp = tempfile::tempdir().unwrap();
        drop(Store::create(tmp.path(), "abcd1234").unwrap());
        // 0.53.0까지의 열쇠 정보처럼 검사 값을 빼요.
        let path = tmp.path().join(META_FILE);
        let mut m = Meta::read(&path).unwrap();
        m.check = None;
        m.write(&path).unwrap();
        assert!(!fs::read_to_string(&path).unwrap().contains("check"));
        assert_eq!(Store::open(tmp.path(), "틀린암호").err().unwrap().code(), "wrong_password");
        drop(Store::open(tmp.path(), "abcd1234").unwrap());
        assert!(Meta::read(&path).unwrap().check.is_some());
    }

    #[test]
    fn old_file_is_raised_with_snapshot_first() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.set("note", "옛 자료").unwrap();
            // 버전 번호를 두기 전 파일처럼 0으로 돌려요.
            s.conn.execute_batch("PRAGMA user_version = 0;").unwrap();
        }
        let s = Store::open(tmp.path(), "abcd1234").unwrap();
        let v: i32 = s.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        assert_eq!(s.get("note").unwrap().as_deref(), Some("옛 자료"));
        let snaps: Vec<_> = fs::read_dir(tmp.path().join(BACKUP_DIR)).unwrap().flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(&format!("_before-v{SCHEMA_VERSION}.gilogbak")))
            .collect();
        assert_eq!(snaps.len(), 1);
        // 버전 올리기 전 백업은 하루치 자동 백업에 세지 않아요.
        assert!(daily_backups(tmp.path()).is_empty());
        drop(s);
        // 두 번째로 열 때는 다시 남기지 않아요.
        drop(Store::open(tmp.path(), "abcd1234").unwrap());
        assert_eq!(fs::read_dir(tmp.path().join(BACKUP_DIR)).unwrap().count(), 1);
    }

    #[test]
    fn new_file_has_version_and_no_snapshot() {
        let tmp = tempfile::tempdir().unwrap();
        let s = Store::create(tmp.path(), "abcd1234").unwrap();
        let v: i32 = s.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        assert!(!tmp.path().join(BACKUP_DIR).exists());
    }

    #[test]
    fn newer_version_is_refused_and_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.conn.execute_batch(&format!("PRAGMA user_version = {};", SCHEMA_VERSION + 1)).unwrap();
        }
        let before = fs::read(tmp.path().join(DB_FILE)).unwrap();
        assert_eq!(Store::open(tmp.path(), "abcd1234").err().unwrap().code(), "too_new");
        assert_eq!(fs::read(tmp.path().join(DB_FILE)).unwrap(), before);
    }

    #[test]
    fn auto_backup_keeps_seven_and_skips_same_day() {
        let tmp = tempfile::tempdir().unwrap();
        let s = Store::create(tmp.path(), "abcd1234").unwrap();
        s.set("note", "백업").unwrap();
        assert!(s.auto_backup_on("2026-10-01").unwrap().is_some());
        assert!(s.auto_backup_on("2026-10-01").unwrap().is_none());
        for d in 2..=10 {
            s.auto_backup_on(&format!("2026-10-{d:02}")).unwrap();
        }
        // 다른 파일은 건드리지 않아요.
        fs::write(tmp.path().join(BACKUP_DIR).join("메모.txt"), "x").unwrap();
        s.auto_backup_on("2026-10-11").unwrap();
        let days: Vec<String> = daily_backups(tmp.path()).into_iter().map(|(d, _)| d).collect();
        assert_eq!(days, (5..=11).map(|d| format!("2026-10-{d:02}")).collect::<Vec<_>>());
        assert!(tmp.path().join(BACKUP_DIR).join("메모.txt").exists());
        // 자동 백업도 "백업 불러오기"로 되살릴 수 있어요.
        let latest = daily_backups(tmp.path()).pop().unwrap().1;
        drop(s);
        let other = tempfile::tempdir().unwrap();
        drop(Store::create(other.path(), "zzzz9999").unwrap());
        restore_backup(other.path(), &latest, "abcd1234").unwrap();
        assert_eq!(Store::open(other.path(), "abcd1234").unwrap().get("note").unwrap().as_deref(), Some("백업"));
    }

    #[test]
    fn restore_clears_old_journal_and_keeps_corrupt_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let bak = tmp.path().join("b.gilogbak");
        {
            let s = Store::create(tmp.path(), "abcd1234").unwrap();
            s.set("note", "좋은 자료").unwrap();
            s.export_backup(&bak).unwrap();
            fill(&s);
        }
        let db = tmp.path().join(DB_FILE);
        let len = fs::metadata(&db).unwrap().len() as usize;
        smash(&db, len / 2, 512);
        fs::write(tmp.path().join("gilog.db-journal"), b"stale").unwrap();
        assert_eq!(Store::open(tmp.path(), "abcd1234").err().unwrap().code(), "corrupt");
        let kept = keep_corrupt(tmp.path()).unwrap();
        assert!(kept.file_name().unwrap().to_string_lossy().starts_with("gilog_손상_"));
        restore_backup(tmp.path(), &bak, "abcd1234").unwrap();
        assert!(!tmp.path().join("gilog.db-journal").exists());
        assert_eq!(Store::open(tmp.path(), "abcd1234").unwrap().get("note").unwrap().as_deref(), Some("좋은 자료"));
        assert!(kept.exists());
    }

    #[test]
    fn write_atomic_replaces_whole_file_and_leaves_no_temp() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("prefs.json");
        fs::write(&p, "{\"old\": true, \"long\": \"xxxxxxxxxxxxxxxxxxxxxxxx\"}").unwrap();
        write_atomic(&p, b"{}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{}");
        assert!(!tmp.path().join("prefs.json.tmp").exists());
        // 임시 파일이 남아 있어도(지난번에 쓰다 꺼짐) 덮고 지나가요.
        fs::write(tmp.path().join("prefs.json.tmp"), "반쯤").unwrap();
        write_atomic(&p, b"{\"a\":1}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn move_data_takes_backups_along() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        {
            let s = Store::create(&a, "abcd1234").unwrap();
            s.auto_backup_on("2026-10-29").unwrap();
        }
        move_data(&a, &b).unwrap();
        assert_eq!(daily_backups(&b).len(), 1);
        assert!(!a.join(BACKUP_DIR).exists());
    }

    // ---------- ②-2 ✔5 되살리기 원자성 ----------

    /// 자료 "note" 값이 v인 자료 폴더와 그 백업 파일
    fn store_with(dir: &Path, v: &str) -> PathBuf {
        let s = Store::create(dir, "abcd1234").unwrap();
        s.set("note", v).unwrap();
        let bak = dir.join("x.gilogbak");
        s.export_backup(&bak).unwrap();
        bak
    }

    fn note(dir: &Path) -> String {
        Store::open(dir, "abcd1234").unwrap().get("note").unwrap().unwrap()
    }

    /// 새 짝을 임시 폴더에 펼쳐 둬요(restore_backup이 하는 것처럼)
    fn staged(dir: &Path, bak: &Path) -> PathBuf {
        let bytes = fs::read(bak).unwrap();
        let rest = &bytes[BACKUP_MAGIC.len()..];
        let nl = rest.iter().position(|b| *b == b'\n').unwrap();
        let tmp = dir.join(".restore-tmp");
        fs::create_dir_all(&tmp).unwrap();
        fs::write(tmp.join(META_FILE), &rest[..nl]).unwrap();
        fs::write(tmp.join(DB_FILE), &rest[nl + 1..]).unwrap();
        tmp
    }

    #[test]
    fn restore_interrupted_recovers_a_whole_pair() {
        let other = tempfile::tempdir().unwrap();
        let new_bak = store_with(other.path(), "새 자료");
        // 1~3단계에서 꺼지면 옛 짝으로, 4단계(새 둘 다 들어감) 뒤면 새 짝으로
        for (stop, want) in [(1u8, "옛 자료"), (2, "옛 자료"), (3, "옛 자료"), (4, "새 자료")] {
            let tmp = tempfile::tempdir().unwrap();
            store_with(tmp.path(), "옛 자료");
            let st = staged(tmp.path(), &new_bak);
            swap_in(tmp.path(), &st, Some(stop)).unwrap();
            assert!(exists(tmp.path()), "{stop}");
            assert_eq!(note(tmp.path()), want, "{stop}");
            assert!(!old_of(tmp.path(), DB_FILE).exists() && !old_of(tmp.path(), META_FILE).exists(), "{stop}");
        }
    }

    #[test]
    fn restore_leaves_no_old_files() {
        let tmp = tempfile::tempdir().unwrap();
        store_with(tmp.path(), "옛 자료");
        let other = tempfile::tempdir().unwrap();
        let bak = store_with(other.path(), "새 자료");
        restore_backup(tmp.path(), &bak, "abcd1234").unwrap();
        assert_eq!(note(tmp.path()), "새 자료");
        assert!(!old_of(tmp.path(), DB_FILE).exists());
        assert!(!tmp.path().join(".restore-tmp").exists());
    }

    #[test]
    fn snapshot_before_import_keeps_current_data() {
        let tmp = tempfile::tempdir().unwrap();
        store_with(tmp.path(), "지금 자료");
        let a = snapshot_before_import(tmp.path()).unwrap().unwrap();
        let b = snapshot_before_import(tmp.path()).unwrap().unwrap();
        assert_ne!(a, b);
        assert!(a.file_name().unwrap().to_string_lossy().ends_with("_before-import.gilogbak"));
        assert!(b.file_name().unwrap().to_string_lossy().ends_with("_before-import-2.gilogbak"));
        // 하루치 자동 백업에 세지 않아요
        assert!(daily_backups(tmp.path()).is_empty());
        // 그 파일로 되살리면 지금 자료가 돌아와요
        let other = tempfile::tempdir().unwrap();
        store_with(other.path(), "다른 자료");
        restore_backup(other.path(), &a, "abcd1234").unwrap();
        assert_eq!(note(other.path()), "지금 자료");
        // 자료가 없으면 남기지 않아요
        let empty = tempfile::tempdir().unwrap();
        assert!(snapshot_before_import(empty.path()).unwrap().is_none());
    }

    #[test]
    fn before_v_backups_keep_three() {
        let tmp = tempfile::tempdir().unwrap();
        let folder = tmp.path().join(BACKUP_DIR);
        fs::create_dir_all(&folder).unwrap();
        for d in ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"] {
            fs::write(folder.join(format!("gilog_{d}_before-v1.gilogbak")), b"x").unwrap();
        }
        fs::write(folder.join("gilog_2026-01-01.gilogbak"), b"x").unwrap();
        fs::write(folder.join("gilog_2026-01-01_before-import.gilogbak"), b"x").unwrap();
        prune_before_v(tmp.path());
        let mut left: Vec<String> = fs::read_dir(&folder).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        left.sort();
        assert_eq!(
            left,
            [
                "gilog_2026-01-01.gilogbak",
                "gilog_2026-01-01_before-import.gilogbak",
                "gilog_2026-03-01_before-v1.gilogbak",
                "gilog_2026-04-01_before-v1.gilogbak",
                "gilog_2026-05-01_before-v1.gilogbak"
            ]
        );
    }

    #[test]
    fn write_atomic_uses_pid_tmp_and_retries() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("prefs.json");
        write_atomic(&p, b"1").unwrap();
        write_atomic(&p, b"2").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"2");
        assert_eq!(fs::read_dir(tmp.path()).unwrap().count(), 1);
        // 바꿔치기 대상이 폴더라 계속 실패하면 오류를 돌려주고 임시 파일은 남기지 않아요
        let d = tmp.path().join("dir");
        fs::create_dir_all(d.join("in")).unwrap();
        assert!(write_atomic(&d, b"x").is_err());
        assert_eq!(fs::read_dir(tmp.path()).unwrap().count(), 2);
        // 처음엔 없다가 생기는 대상: rename_retry는 다시 해 봐요
        let from = tmp.path().join("a");
        let to = tmp.path().join("later").join("b");
        fs::write(&from, b"y").unwrap();
        let mk = to.parent().unwrap().to_path_buf();
        let h = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(30));
            fs::create_dir_all(mk).unwrap();
        });
        rename_retry(&from, &to).unwrap();
        h.join().unwrap();
        assert_eq!(fs::read(&to).unwrap(), b"y");
    }
}
