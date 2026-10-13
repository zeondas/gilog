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
