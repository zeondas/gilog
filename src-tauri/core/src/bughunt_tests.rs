//! 버그 사냥 1차(자료 저장·백업·되살리기) 시험 – `docs/qa/bughunt-storage.md`의 표 번호를 이름 앞에 붙였어요.
//! 고치기 전에는 실패하고 고친 뒤 통과하는지 봐요(자료 안전 ✔1~✔5, `wip/bughunt`).

use super::*;
use std::time::{Duration, SystemTime};

const PW: &str = "abcd1234";

fn mk(dir: &Path) -> Store {
    let s = Store::create(dir, PW).unwrap();
    s.set("note", "좋은 자료").unwrap();
    s
}

fn note(dir: &Path, pw: &str) -> Option<String> {
    Store::open(dir, pw).unwrap().get("note").unwrap()
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).map(|r| r.flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()).unwrap_or_default();
    v.sort();
    v
}

fn set_mtime(p: &Path, t: SystemTime) {
    fs::File::options().write(true).open(p).unwrap().set_modified(t).unwrap();
}

fn future() -> SystemTime {
    SystemTime::now() + Duration::from_secs(400 * 86400)
}

/// 다른 자료 폴더 하나(되살리기 받을 곳)
fn other() -> tempfile::TempDir {
    let o = tempfile::tempdir().unwrap();
    drop(Store::create(o.path(), "zzzz9999").unwrap());
    o
}

// ---------- ✔1 방금 만든 백업은 지우지 않기 · 미래 날짜 이름 ----------

#[test]
fn t01_before_clear_backup_survives_future_mtimes() {
    let t = tempfile::tempdir().unwrap();
    let mut s = mk(t.path());
    s.conn.execute_batch("INSERT INTO complaints (no, received, intake, place, status) VALUES (1, '2026-10-01', '전화', '금촌동 1', '접수');").unwrap();
    let folder = t.path().join(BACKUP_DIR);
    fs::create_dir_all(&folder).unwrap();
    for i in 1..=5 {
        let p = folder.join(format!("gilog_2027-12-0{i}_before-clear.gilogbak"));
        fs::write(&p, b"x").unwrap();
        set_mtime(&p, future());
    }
    let r = s.clear(ClearWhat::Complaints).unwrap();
    let b = PathBuf::from(r.backup.unwrap());
    assert!(b.is_file(), "지우기 전 백업이 남아야 해요");
    assert_eq!(names(&folder).len(), BEFORE_CLEAR_KEEP);
    drop(s);
    let o = other();
    restore_backup(o.path(), &b, PW).unwrap();
    let n: i64 = Store::open(o.path(), PW).unwrap().conn.query_row("SELECT COUNT(*) FROM complaints", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
}

#[test]
fn t07_daily_backup_kept_when_clock_went_back() {
    let t = tempfile::tempdir().unwrap();
    let s = mk(t.path());
    for d in 1..=7 {
        s.auto_backup_on(&format!("2027-01-{d:02}")).unwrap();
    }
    let p = s.auto_backup_on("2026-11-01").unwrap().unwrap();
    assert!(p.is_file(), "오늘 자동 백업이 남아야 해요");
    // 미래 날짜 이름 7개는 지우지 않고 그대로 둬요(시계가 지금 틀렸을 수도 있어서)
    assert_eq!(daily_backups(t.path()).len(), 8);
    // 그 뒤 날마다 7개를 넘으면 오늘 이전 것 중 오래된 것부터 지워요
    for d in 2..=9 {
        s.auto_backup_on(&format!("2026-11-{d:02}")).unwrap();
    }
    let days: Vec<String> = daily_backups(t.path()).into_iter().map(|x| x.0).filter(|d| d.as_str() < "2027").collect();
    assert_eq!(days, (3..=9).map(|d| format!("2026-11-{d:02}")).collect::<Vec<_>>());
}

#[test]
fn t08_latest_skips_future_names() {
    let t = tempfile::tempdir().unwrap();
    let s = mk(t.path());
    s.auto_backup_on("2099-01-01").unwrap();
    s.set("note", "새 자료").unwrap();
    for d in 20..=31 {
        s.auto_backup_on(&format!("2026-10-{d:02}")).unwrap();
    }
    let (day, path) = latest_backup_on(t.path(), "2026-10-31").unwrap();
    assert_eq!(day, "2026-10-31");
    drop(s);
    let o = other();
    restore_backup(o.path(), &path, PW).unwrap();
    assert_eq!(note(o.path(), PW).as_deref(), Some("새 자료"));
    // 오늘 이전 것이 하나도 없으면(시계가 크게 뒤로 감) 전체에서 가장 늦은 것
    assert_eq!(latest_backup_on(t.path(), "2000-01-01").unwrap().0, "2099-01-01");
}

#[test]
fn t09_before_v_snapshot_kept_when_clock_went_back() {
    let t = tempfile::tempdir().unwrap();
    {
        let s = mk(t.path());
        s.conn.execute_batch("PRAGMA user_version = 0;").unwrap();
    }
    let folder = t.path().join(BACKUP_DIR);
    fs::create_dir_all(&folder).unwrap();
    for m in ["2099-01-01", "2099-02-01", "2099-03-01"] {
        fs::write(folder.join(format!("gilog_{m}_before-v1.gilogbak")), b"x").unwrap();
    }
    drop(Store::open(t.path(), PW).unwrap());
    let snap = folder.join(format!("gilog_{}_before-v{SCHEMA_VERSION}.gilogbak", today()));
    assert!(snap.is_file(), "형식 올리기 전 백업이 남아야 해요: {:?}", names(&folder));
    assert_eq!(names(&folder).len(), BEFORE_V_KEEP);
}

// ---------- ✔2 빈 자료·깨진 열쇠 정보는 손상 ----------

#[test]
fn t02_zero_byte_db_is_corrupt_not_empty() {
    let t = tempfile::tempdir().unwrap();
    drop(mk(t.path()));
    fs::write(t.path().join(DB_FILE), b"").unwrap();
    assert_eq!(Store::open(t.path(), PW).err().map(|e| e.code()), Some("corrupt"));
    assert!(!t.path().join(BACKUP_DIR).exists(), "빈 자료의 백업을 만들면 안 돼요");
    // 열쇠로 바로 열기(자격 증명 관리자)도 같아요
    let t2 = tempfile::tempdir().unwrap();
    let key = mk(t2.path()).key_hex();
    fs::write(t2.path().join(DB_FILE), b"").unwrap();
    assert_eq!(Store::open_with_key_hex(t2.path(), &key).err().map(|e| e.code()), Some("corrupt"));
}

#[test]
fn t03_t15_broken_backup_is_refused_with_bad_backup() {
    for cut in [0usize, 1000] {
        let t = tempfile::tempdir().unwrap();
        let bak = t.path().join("b.gilogbak");
        {
            let s = mk(t.path());
            for i in 0..300 {
                s.set(&format!("k{i}"), &"자료".repeat(40)).unwrap();
            }
            s.export_backup(&bak).unwrap();
        }
        let bytes = fs::read(&bak).unwrap();
        let nl = BACKUP_MAGIC.len() + bytes[BACKUP_MAGIC.len()..].iter().position(|b| *b == b'\n').unwrap();
        fs::write(&bak, &bytes[..nl + 1 + cut]).unwrap();
        let o = tempfile::tempdir().unwrap();
        {
            let s = Store::create(o.path(), PW).unwrap();
            s.set("note", "지금 자료").unwrap();
        }
        assert_eq!(restore_backup(o.path(), &bak, PW).err().map(|e| e.code()), Some("bad_backup"), "cut={cut}");
        assert_eq!(note(o.path(), PW).as_deref(), Some("지금 자료"), "cut={cut}");
    }
}

#[test]
fn t14_key_json_broken_or_missing_is_corrupt() {
    let t = tempfile::tempdir().unwrap();
    drop(mk(t.path()));
    fs::write(t.path().join(META_FILE), b"").unwrap();
    assert_eq!(Store::open(t.path(), PW).err().map(|e| e.code()), Some("corrupt"));
    fs::write(t.path().join(META_FILE), b"{\"v\":1,").unwrap();
    assert_eq!(Store::open(t.path(), PW).err().map(|e| e.code()), Some("corrupt"));
    fs::remove_file(t.path().join(META_FILE)).unwrap();
    assert!(exists(t.path()));
    assert_eq!(Store::open(t.path(), PW).err().map(|e| e.code()), Some("corrupt"));
}

// ---------- ✔3 비밀번호 바꾸기 실패 · key.new.json 옮기기 ----------

#[test]
fn t04_password_change_rolls_back_when_last_rename_fails() {
    let t = tempfile::tempdir().unwrap();
    let mut s = mk(t.path());
    hooks::FAIL_META_RENAME.with(|c| c.set(true));
    let r = s.change_password(PW, "new-pass-1");
    hooks::FAIL_META_RENAME.with(|c| c.set(false));
    assert!(r.is_err(), "실패로 알려야 해요");
    assert!(!t.path().join(META_NEW_FILE).exists());
    // 세션 안에서도, 그 뒤 만든 백업도, 다시 열어도 옛 비밀번호 그대로
    s.check_password(PW).unwrap();
    s.set("note", "바꾸기 실패 뒤").unwrap();
    let bak = t.path().join("after.gilogbak");
    s.export_backup(&bak).unwrap();
    drop(s);
    assert_eq!(note(t.path(), PW).as_deref(), Some("바꾸기 실패 뒤"));
    assert_eq!(Store::open(t.path(), "new-pass-1").err().map(|e| e.code()), Some("wrong_password"));
    let o = other();
    restore_backup(o.path(), &bak, PW).unwrap();
    assert_eq!(note(o.path(), PW).as_deref(), Some("바꾸기 실패 뒤"));
}

#[test]
fn t05_move_data_takes_key_new_along() {
    let t = tempfile::tempdir().unwrap();
    let a = t.path().join("a");
    let b = t.path().join("b");
    {
        let mut s = mk(&a);
        let old_meta = fs::read(a.join(META_FILE)).unwrap();
        s.change_password(PW, "new-pass-1").unwrap();
        // 마지막 이름 바꾸기 직전에 꺼진 것처럼
        fs::rename(a.join(META_FILE), a.join(META_NEW_FILE)).unwrap();
        fs::write(a.join(META_FILE), old_meta).unwrap();
    }
    move_data(&a, &b).unwrap();
    assert_eq!(note(&b, "new-pass-1").as_deref(), Some("좋은 자료"));
}

// ---------- ✔4 옮기기·형식 올리기·임시 파일·손상본 ----------

#[test]
fn t06_move_data_copies_backup_subfolders() {
    let t = tempfile::tempdir().unwrap();
    let a = t.path().join("a");
    let b = t.path().join("b");
    drop(mk(&a));
    let sub = a.join(BACKUP_DIR).join("보관").join("연말");
    fs::create_dir_all(&sub).unwrap();
    fs::write(sub.join("gilog_2025-12-31_연말.gilogbak"), b"precious").unwrap();
    move_data(&a, &b).unwrap();
    let moved = b.join(BACKUP_DIR).join("보관").join("연말").join("gilog_2025-12-31_연말.gilogbak");
    assert_eq!(fs::read(moved).unwrap(), b"precious");
    assert!(!exists(&a));
}

#[test]
fn t13_move_data_failure_cleans_destination() {
    let t = tempfile::tempdir().unwrap();
    let a = t.path().join("a");
    let b = t.path().join("b");
    {
        let s = mk(&a);
        s.auto_backup_on("2026-10-30").unwrap();
    }
    fs::create_dir_all(&b).unwrap();
    fs::write(b.join("사용자 파일.txt"), b"keep").unwrap();
    fs::write(b.join(BACKUP_DIR), b"blocker").unwrap(); // 백업 폴더를 못 만듦(USB 빠짐·자리 없음 대신)
    assert!(move_data(&a, &b).is_err());
    assert!(exists(&a), "옛 자리는 그대로");
    assert_eq!(names(&b), ["backup", "사용자 파일.txt"], "옮길 곳에 만든 것은 치워요");
    fs::remove_file(b.join(BACKUP_DIR)).unwrap();
    move_data(&a, &b).unwrap();
    assert_eq!(note(&b, PW).as_deref(), Some("좋은 자료"));
    assert_eq!(daily_backups(&b).len(), 1);
}

#[test]
fn t11_upgrade_snapshot_failure_still_opens() {
    let t = tempfile::tempdir().unwrap();
    {
        let s = mk(t.path());
        s.conn.execute_batch("PRAGMA user_version = 0;").unwrap();
    }
    fs::write(t.path().join(BACKUP_DIR), b"not a folder").unwrap();
    let s = Store::open(t.path(), PW).unwrap();
    let v: i32 = s.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(v, SCHEMA_VERSION);
    assert_eq!(s.get("note").unwrap().as_deref(), Some("좋은 자료"));
}

#[test]
fn t12_failed_write_leaves_no_temp_file() {
    let t = tempfile::tempdir().unwrap();
    let target = t.path().join("gilog_2026-11-01.gilogbak");
    hooks::FAIL_WRITE.with(|c| c.set(true));
    let r = write_atomic(&target, &[7u8; 4096]);
    hooks::FAIL_WRITE.with(|c| c.set(false));
    assert!(r.is_err());
    assert!(names(t.path()).is_empty(), "반쪽 임시 파일이 남으면 안 돼요: {:?}", names(t.path()));
}

#[test]
fn t10_keep_corrupt_never_overwrites() {
    let t = tempfile::tempdir().unwrap();
    fs::write(t.path().join(DB_FILE), b"first").unwrap();
    let a = keep_corrupt(t.path()).unwrap();
    fs::write(t.path().join(DB_FILE), b"second").unwrap();
    let b = keep_corrupt(t.path()).unwrap();
    assert_ne!(a, b);
    assert_eq!(fs::read(&a).unwrap(), b"first");
    assert_eq!(fs::read(&b).unwrap(), b"second");
    assert!(b.file_name().unwrap().to_string_lossy().ends_with("-2.db"));
}

// ---------- ✔5 의심 다섯 ----------

#[test]
fn s16_copy_keeps_source_until_removed() {
    let t = tempfile::tempdir().unwrap();
    let a = t.path().join("a");
    let b = t.path().join("b");
    {
        let s = mk(&a);
        s.auto_backup_on("2026-10-30").unwrap();
    }
    copy_data(&a, &b).unwrap();
    // 설정에 새 자리를 적기 전(여기서 꺼져도) 옛 자리는 온전해요
    assert_eq!(note(&a, PW).as_deref(), Some("좋은 자료"));
    assert_eq!(daily_backups(&a).len(), 1);
    remove_moved(&a);
    assert!(!exists(&a));
    assert_eq!(note(&b, PW).as_deref(), Some("좋은 자료"));
}

#[test]
fn s18_before_import_keeps_recent_five() {
    let t = tempfile::tempdir().unwrap();
    drop(mk(t.path()));
    let mut last = PathBuf::new();
    for _ in 0..7 {
        last = snapshot_before_import(t.path()).unwrap().unwrap();
    }
    assert!(last.is_file());
    let n = names(&t.path().join(BACKUP_DIR)).iter().filter(|n| n.contains("_before-import")).count();
    assert_eq!(n, BEFORE_IMPORT_KEEP);
}

#[test]
fn s21_interrupted_restore_brings_old_journal_back() {
    let other_dir = tempfile::tempdir().unwrap();
    let new_bak = other_dir.path().join("new.gilogbak");
    mk(other_dir.path()).export_backup(&new_bak).unwrap();
    // 새 자료가 들어가기 직전(3단계: 새 하나 넣음)에 꺼짐 → 옛 짝과 쓰다 만 기록이 함께 돌아와요
    let t = tempfile::tempdir().unwrap();
    drop(mk(t.path()));
    let journal = t.path().join(format!("{DB_FILE}-journal"));
    fs::write(&journal, b"old journal").unwrap();
    let st = stage_backup(t.path(), &new_bak).unwrap();
    swap_in(t.path(), &st, Some(3)).unwrap();
    assert!(exists(t.path()));
    assert_eq!(fs::read(&journal).unwrap(), b"old journal");
    assert!(names(t.path()).iter().all(|n| !n.ends_with(".old")), "{:?}", names(t.path()));
    // 다 들어가면 옛 쓰다 만 기록은 새 자료 옆에 남지 않아요
    let st = stage_backup(t.path(), &new_bak).unwrap();
    swap_in(t.path(), &st, None).unwrap();
    assert!(!journal.exists());
    assert!(names(t.path()).iter().all(|n| !n.ends_with(".old")), "{:?}", names(t.path()));
}

#[test]
fn s22_huge_cost_in_key_info_is_refused_quickly() {
    let t = tempfile::tempdir().unwrap();
    let bak = t.path().join("b.gilogbak");
    mk(t.path()).export_backup(&bak).unwrap();
    let path = t.path().join(META_FILE);
    let mut m = Meta::read(&path).unwrap();
    m.m_cost = 4_000_000_000;
    m.write(&path).unwrap();
    let at = std::time::Instant::now();
    assert_eq!(Store::open(t.path(), PW).err().map(|e| e.code()), Some("corrupt"));
    assert!(at.elapsed() < Duration::from_secs(5));
    // 백업 첫 줄이 그렇게 깨졌으면 "이 백업 파일이 손상됐어요"
    let bytes = fs::read(&bak).unwrap();
    let rest = &bytes[BACKUP_MAGIC.len()..];
    let nl = rest.iter().position(|b| *b == b'\n').unwrap();
    let mut meta: serde_json::Value = serde_json::from_slice(&rest[..nl]).unwrap();
    meta["m_cost"] = serde_json::json!(4_000_000_000u64);
    let mut out = BACKUP_MAGIC.to_vec();
    out.extend_from_slice(meta.to_string().as_bytes());
    out.push(b'\n');
    out.extend_from_slice(&rest[nl + 1..]);
    let broken = t.path().join("bad.gilogbak");
    fs::write(&broken, out).unwrap();
    let o = other();
    assert_eq!(restore_backup(o.path(), &broken, PW).err().map(|e| e.code()), Some("bad_backup"));
}

// ---------- 17 불러오기 전에 먼저 확인(설정 세션 `wip/settings6`) ----------

#[test]
fn t17_check_backup_leaves_open_data_alone() {
    let src = tempfile::tempdir().unwrap();
    let b = src.path().join("b.gilogbak");
    {
        let s = mk(src.path());
        s.set("note", "백업 쪽").unwrap();
        s.export_backup(&b).unwrap();
    }
    let t = tempfile::tempdir().unwrap();
    let s = mk(t.path());
    let before = names(t.path());
    // 비밀번호가 틀리면 그 까닭만 돌려주고, 열린 자료·폴더는 그대로예요
    assert_eq!(check_backup(t.path(), &b, "틀린비번99").err().map(|e| e.code()), Some("wrong_password"));
    assert_eq!(names(t.path()), before, "임시 폴더가 남으면 안 돼요");
    // 백업이 아닌 파일 · 잘린 파일
    let junk = src.path().join("junk.gilogbak");
    fs::write(&junk, b"hello").unwrap();
    assert!(check_backup(t.path(), &junk, PW).is_err());
    let cut = src.path().join("cut.gilogbak");
    let bytes = fs::read(&b).unwrap();
    fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
    assert_eq!(check_backup(t.path(), &cut, PW).err().map(|e| e.code()), Some("bad_backup"));
    assert_eq!(names(t.path()), before);
    // 맞으면 Ok – 지금 자료는 바뀌지 않아요(열린 채로도 돼요)
    check_backup(t.path(), &b, PW).unwrap();
    assert_eq!(names(t.path()), before);
    assert_eq!(s.get("note").unwrap().as_deref(), Some("좋은 자료"));
    drop(s);
    assert_eq!(note(t.path(), PW).as_deref(), Some("좋은 자료"));
}
