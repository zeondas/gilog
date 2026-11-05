//! 탐색기 파일 일 시험.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use super::*;

/// "a/b/c"를 윈도우 구분자로 이어요 – 문자열로 견주는 경로(결정 키·되돌리기 짝)는 실제 경로와 글자가 같아야 해요.
fn rel(base: &Path, r: &str) -> PathBuf {
    r.split('/').fold(base.to_path_buf(), |p, c| p.join(c))
}

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("gilog-files-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn unique_numbers() {
    let d = tmp("uniq");
    fs::write(d.join("사진1.jpg"), "a").unwrap();
    assert_eq!(unique_path(&d.join("사진1.jpg")), d.join("사진1 (2).jpg"));
    fs::write(d.join("사진1 (2).jpg"), "a").unwrap();
    assert_eq!(unique_path(&d.join("사진1.jpg")), d.join("사진1 (3).jpg"));
    assert_eq!(unique_path(&d.join("사진1 (2).jpg")), d.join("사진1 (3).jpg"));
    assert_eq!(unique_path(&d.join("없음.txt")), d.join("없음.txt"));
    fs::create_dir(d.join("폴더")).unwrap();
    assert_eq!(unique_path(&d.join("폴더")), d.join("폴더 (2)"));
}

#[test]
fn copy_with_decisions_and_merge() {
    let d = tmp("copy");
    let a = d.join("a");
    let b = d.join("b");
    fs::create_dir_all(a.join("사진")).unwrap();
    fs::create_dir_all(b.join("사진")).unwrap();
    fs::write(a.join("사진/1.jpg"), "new1").unwrap();
    fs::write(a.join("사진/2.jpg"), "new2").unwrap();
    fs::write(a.join("사진/3.jpg"), "new3").unwrap();
    fs::write(a.join("x.txt"), "x").unwrap();
    fs::write(b.join("사진/1.jpg"), "old1").unwrap();
    fs::write(b.join("사진/2.jpg"), "old2").unwrap();
    let srcs = vec![a.join("사진"), a.join("x.txt")];
    let cs = conflicts(&srcs, &b);
    assert_eq!(cs.len(), 2);
    let mut dec = HashMap::new();
    dec.insert(rel(&b, "사진/1.jpg").to_string_lossy().into_owned(), "over".to_string());
    dec.insert(rel(&b, "사진/2.jpg").to_string_lossy().into_owned(), "both".to_string());
    let s = transfer(false, &srcs, &b, &dec, &|_, _, _| {}).unwrap();
    assert_eq!(s.done, 4);
    assert_eq!(fs::read_to_string(b.join("사진/1.jpg")).unwrap(), "new1");
    assert_eq!(fs::read_to_string(b.join("사진/2.jpg")).unwrap(), "old2");
    assert_eq!(fs::read_to_string(b.join("사진/2 (2).jpg")).unwrap(), "new2");
    assert_eq!(fs::read_to_string(b.join("사진/3.jpg")).unwrap(), "new3");
    assert!(a.join("x.txt").exists());
}

#[test]
fn copy_into_same_folder_keeps_both() {
    let d = tmp("same");
    fs::write(d.join("f.txt"), "1").unwrap();
    let s = transfer(false, &[d.join("f.txt")], &d, &HashMap::new(), &|_, _, _| {}).unwrap();
    assert_eq!(s.done, 1);
    assert!(d.join("f - 복사본.txt").exists());
    let s = transfer(false, &[d.join("f.txt")], &d, &HashMap::new(), &|_, _, _| {}).unwrap();
    assert_eq!(s.done, 1);
    assert!(d.join("f - 복사본 (2).txt").exists());
    // 폴더도 통째로 "폴더 - 복사본"
    fs::create_dir_all(d.join("사진.2026")).unwrap();
    fs::write(d.join("사진.2026/a.jpg"), "a").unwrap();
    assert!(conflicts(&[d.join("사진.2026")], &d).is_empty());
    transfer(false, &[d.join("사진.2026")], &d, &HashMap::new(), &|_, _, _| {}).unwrap();
    assert!(d.join("사진.2026 - 복사본/a.jpg").exists());
}

#[test]
fn transfer_pairs_undo_and_redo() {
    let d = tmp("undo");
    let (a, b) = (d.join("a"), d.join("b"));
    fs::create_dir_all(a.join("현장/사진")).unwrap();
    fs::write(a.join("현장/사진/1.jpg"), "1").unwrap();
    fs::write(a.join("메모.txt"), "m").unwrap();
    fs::create_dir_all(b.join("현장")).unwrap(); // 대상에 같은 이름 폴더가 이미 있음 → 합치기
    fs::write(b.join("현장/있던.txt"), "x").unwrap();
    fs::write(b.join("메모.txt"), "old").unwrap();
    let mut dec = HashMap::new();
    dec.insert(b.join("메모.txt").to_string_lossy().into_owned(), "both".to_string());
    // 복사: 새로 생긴 것만 짝으로(합친 폴더는 파일 단위, "메모 (2).txt")
    let s = transfer(false, &[a.join("현장"), a.join("메모.txt")], &b, &dec, &|_, _, _| {}).unwrap();
    let got: HashSet<String> = s.pairs.iter().map(|(_, t)| t.clone()).collect();
    assert!(got.contains(&rel(&b, "현장/사진/1.jpg").to_string_lossy().into_owned()), "{got:?}");
    assert!(got.contains(&b.join("메모 (2).txt").to_string_lossy().into_owned()), "{got:?}");
    assert!(!got.contains(&b.join("현장").to_string_lossy().into_owned()));
    // 덮어쓰기는 짝에서 빠져요
    let mut over = HashMap::new();
    over.insert(b.join("메모.txt").to_string_lossy().into_owned(), "over".to_string());
    let s2 = transfer(false, &[a.join("메모.txt")], &b, &over, &|_, _, _| {}).unwrap();
    assert_eq!((s2.overwritten, s2.pairs.len()), (1, 0));
    // 새 폴더로 통째로 옮기기 → 짝은 폴더 하나, 되돌리면 제자리, 다시 하면 또 옮김
    let c = d.join("c");
    fs::create_dir_all(&c).unwrap();
    let s3 = transfer(true, &[a.join("현장")], &c, &HashMap::new(), &|_, _, _| {}).unwrap();
    assert_eq!(s3.pairs, vec![(a.join("현장").to_string_lossy().into_owned(), c.join("현장").to_string_lossy().into_owned())]);
    let back: Vec<Step> = s3.pairs.iter().rev().map(|(f, t)| Step::Move { from: t.clone(), to: f.clone() }).collect();
    assert_eq!(run_steps(&back).errors.len(), 0);
    assert!(a.join("현장/사진/1.jpg").exists() && !c.join("현장").exists());
    let again: Vec<Step> = s3.pairs.iter().map(|(f, t)| Step::Move { from: f.clone(), to: t.clone() }).collect();
    assert_eq!(run_steps(&again).done, 1);
    assert!(c.join("현장/사진/1.jpg").exists());
    // 되돌리는 자리에 같은 이름이 생겼으면 건너뛰고 알려요
    fs::write(a.join("새것.txt"), "n").unwrap();
    fs::write(c.join("새것.txt"), "c").unwrap();
    let r = run_steps(&[Step::Move { from: c.join("새것.txt").to_string_lossy().into_owned(), to: a.join("새것.txt").to_string_lossy().into_owned() }]);
    assert_eq!(r.errors[0].1, "exists");
    // 복사 다시 하기·새 폴더
    let r = run_steps(&[
        Step::Copy { from: c.join("현장").to_string_lossy().into_owned(), to: rel(&d, "e/현장").to_string_lossy().into_owned() },
        Step::Mkdir { path: d.join("새 폴더").to_string_lossy().into_owned() },
    ]);
    assert_eq!(r.done, 2);
    assert!(d.join("e/현장/사진/1.jpg").exists() && d.join("새 폴더").is_dir());
}

#[test]
fn merge_folders_by_rename() {
    let d = tmp("merge");
    fs::create_dir_all(d.join("가/속")).unwrap();
    fs::write(d.join("가/속/1.txt"), "1").unwrap();
    fs::write(d.join("가/겹침.txt"), "new").unwrap();
    fs::create_dir_all(d.join("나/속")).unwrap();
    fs::write(d.join("나/겹침.txt"), "old").unwrap();
    let r = run_steps(&[Step::Move { from: d.join("가").to_string_lossy().into_owned(), to: d.join("나").to_string_lossy().into_owned() }]);
    assert_eq!(r.errors.len(), 1); // 겹친 파일만 남아요
    assert!(d.join("나/속/1.txt").exists());
    assert_eq!(fs::read_to_string(d.join("나/겹침.txt")).unwrap(), "old");
    assert!(d.join("가/겹침.txt").exists() && !d.join("가/속").exists());
}

#[test]
fn zip_as_folder() {
    let d = tmp("zipdir");
    let zp = d.join("자료.zip");
    {
        let f = fs::File::create(&zp).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let o = zip::write::SimpleFileOptions::default();
        z.start_file("공문.hwp", o).unwrap();
        std::io::Write::write_all(&mut z, b"hwp").unwrap();
        z.add_directory("사진/", o).unwrap();
        z.start_file("사진/1.jpg", o).unwrap();
        std::io::Write::write_all(&mut z, b"jpg1").unwrap();
        z.start_file("사진/깊이/2.jpg", o).unwrap();
        std::io::Write::write_all(&mut z, b"jpg2").unwrap();
        z.finish().unwrap();
    }
    let top = list(&zp, false).unwrap();
    let mut names: Vec<(String, bool)> = top.iter().map(|e| (e.name.clone(), e.dir)).collect();
    names.sort();
    assert_eq!(names, vec![("공문.hwp".into(), false), ("사진".into(), true)]);
    let pics = list(&zp.join("사진"), false).unwrap();
    assert_eq!(pics.len(), 2);
    assert!(fs_is_dir(zp.join("사진").to_string_lossy().into_owned()));
    assert!(!fs_is_dir(zp.join("공문.hwp").to_string_lossy().into_owned()));
    assert_eq!(fs_resolve(zp.join("공문.hwp").to_string_lossy().into_owned()).map(|x| x.1), Some(false));
    let out = zip_extract(&[zp.join("사진").to_string_lossy().into_owned(), zp.join("공문.hwp").to_string_lossy().into_owned()], &d.join("tmp")).unwrap();
    assert_eq!(fs::read(Path::new(&out[0]).join("깊이").join("2.jpg")).unwrap(), b"jpg2");
    assert_eq!(fs::read(&out[1]).unwrap(), b"hwp");
    assert!(zip_ms(Some(zip::DateTime::from_date_and_time(2026, 10, 20, 9, 30, 0).unwrap())) == 1_792_488_600_000);
}

#[test]
fn zip_entries_cannot_leave_tmp() {
    let d = tmp("zipesc");
    let zp = d.join("나쁜.zip");
    {
        let f = fs::File::create(&zp).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let o = zip::write::SimpleFileOptions::default();
        for (n, body) in [("폴더/ok.txt", "ok"), ("폴더/C:/evil.txt", "x"), ("폴더/c:evil2.txt", "x"), ("폴더//abs.txt", "x"), ("폴더/a/../../up.txt", "x"), ("폴더/\\srv\\s.txt", "x")] {
            z.start_file(n, o).unwrap();
            std::io::Write::write_all(&mut z, body.as_bytes()).unwrap();
        }
        z.finish().unwrap();
    }
    let out = zip_extract(&[zp.join("폴더").to_string_lossy().into_owned()], &d.join("tmp")).unwrap();
    let mut got: Vec<String> = fs::read_dir(&out[0]).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    got.sort();
    assert_eq!(got, vec!["ok.txt".to_string()]);
    assert!(!d.join("up.txt").exists());
}

#[test]
fn reserved_and_env() {
    assert!(reserved_name("CON") && reserved_name("nul.txt") && reserved_name("com3.hwp") && reserved_name("LPT9"));
    assert!(!reserved_name("CONTACT") && !reserved_name("COM10") && !reserved_name("공문.hwp") && !reserved_name("com0"));
    assert_eq!(check_name("aux.txt").unwrap_err(), "reserved_name");
    std::env::set_var("GILOG_T", "C:\\Users\\hun");
    assert_eq!(expand_env("%GILOG_T%\\Downloads"), "C:\\Users\\hun\\Downloads");
    assert_eq!(expand_env("100% 끝 %없는이름%"), "100% 끝 %없는이름%");
}

/// 실제 휴지통을 써요 – `cargo test -- --ignored trash_and_restore`로만
#[test]
#[ignore]
fn trash_and_restore() {
    let d = tmp("trash");
    fs::write(d.join("공문.hwp"), "x").unwrap();
    fs::create_dir_all(d.join("사진")).unwrap();
    let ps = vec![d.join("공문.hwp").to_string_lossy().into_owned(), d.join("사진").to_string_lossy().into_owned()];
    let since = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    assert_eq!(run_steps(&[Step::Trash { paths: ps.clone() }]).done, 2);
    assert!(!d.join("공문.hwp").exists());
    let r = run_steps(&[Step::Restore { paths: ps, since }]);
    assert_eq!((r.done, r.errors.len()), (2, 0), "{:?}", r.errors);
    assert!(d.join("공문.hwp").exists() && d.join("사진").is_dir());
}

#[test]
fn fast_find_filters_and_falls_back() {
    let d = tmp("fast");
    fs::create_dir_all(d.join("공사")).unwrap();
    fs::write(d.join("공사/261015_봉일천리_포트홀.pptx"), vec![0u8; 3000]).unwrap();
    fs::write(d.join("공사/포트홀 메모.txt"), "배수로 포트홀").unwrap();
    let root = d.to_string_lossy().into_owned();
    let hits = vec![
        serde_json::json!({ "p": d.join("공사").to_string_lossy(), "d": true }),
        serde_json::json!({ "p": rel(&d, "공사/261015_봉일천리_포트홀.pptx").to_string_lossy(), "d": false }),
        serde_json::json!({ "p": rel(&d, "공사/포트홀 메모.txt").to_string_lossy(), "d": false }),
        serde_json::json!({ "p": rel(&d, "공사/지워진.txt").to_string_lossy(), "d": false }),
    ];
    let ask = move |q: &serde_json::Value| -> Option<serde_json::Value> {
        match q["op"].as_str()? {
            "status" => Some(serde_json::json!({ "version": "1", "drives": [{ "drive": "C:", "count": 4, "ready": true }] })),
            _ => Some(serde_json::json!({ "hits": hits, "more": false })),
        }
    };
    let base = FindSpec {
        name: "포트홀".into(),
        text: String::new(),
        roots: vec![],
        sub: true,
        from: 0,
        to: 0,
        min_size: 0,
        max_size: 0,
        locked_only: false,
        complaints_only: false,
        show_hidden: false,
        no_fast: false,
    };
    assert!(find_fast(&FindSpec { no_fast: true, ..base.clone() }, &ask, &|_, _| {}).is_none());
    let r = find_fast(&base, &ask, &|_, _| {}).unwrap();
    assert_eq!(r.len(), 3, "지워진 파일은 빠져요");
    assert_eq!(r[0].folder, root, "모든 드라이브면 폴더 칸은 전체 경로");
    // 조건은 여기서 걸러요
    let r = find_fast(&FindSpec { min_size: 2000, ..base.clone() }, &ask, &|_, _| {}).unwrap();
    assert_eq!(r.iter().map(|f| f.entry.name.as_str()).collect::<Vec<_>>(), vec!["261015_봉일천리_포트홀.pptx"]);
    let r = find_fast(&FindSpec { complaints_only: true, ..base.clone() }, &ask, &|_, _| {}).unwrap();
    assert_eq!(r.len(), 1);
    let r = find_fast(&FindSpec { text: "배수로".into(), ..base.clone() }, &ask, &|_, _| {}).unwrap();
    assert_eq!(r.iter().map(|f| f.entry.name.as_str()).collect::<Vec<_>>(), vec!["포트홀 메모.txt"]);
    // 목록 없는 드라이브·도우미 없음·이름 없이 폴더만이면 뒤지는 찾기로
    assert!(find_fast(&FindSpec { roots: vec!["Z:\\x".into()], ..base.clone() }, &ask, &|_, _| {}).is_none());
    assert!(find_fast(&FindSpec { roots: vec!["C:\\Windows".into()], ..base.clone() }, &ask, &|_, _| {}).is_none());
    assert!(find_fast(&FindSpec { roots: vec!["C:\\Users\\a\\AppData\\Local".into()], ..base.clone() }, &ask, &|_, _| {}).is_none());
    assert!(find_fast(&FindSpec { roots: vec!["C:\\x".into()], name: String::new(), ..base.clone() }, &ask, &|_, _| {}).is_none());
    assert!(find_fast(&base, &|_| None, &|_, _| {}).is_none());
    assert!(!fast_status_with(&|_| None).running);
}

#[test]
fn drop_files_round_trip() {
    let ps = vec!["C:\\민원\\a.pptx".to_string(), "D:\\사진 1.jpg".to_string()];
    let b = drop_files_bytes(&ps);
    assert_eq!(&b[0..4], &20u32.to_le_bytes());
    assert_eq!(parse_drop_files(&b), ps);
    assert!(parse_drop_files(&drop_files_bytes(&[])).is_empty());
    assert!(parse_drop_files(&[1, 2]).is_empty());
}

#[test]
fn move_whole_and_skip() {
    let d = tmp("move");
    let a = d.join("a");
    let b = d.join("b");
    fs::create_dir_all(a.join("빈폴더")).unwrap();
    fs::create_dir_all(&b).unwrap();
    fs::write(a.join("1.txt"), "1").unwrap();
    fs::write(a.join("2.txt"), "new").unwrap();
    fs::write(b.join("2.txt"), "old").unwrap();
    let s = transfer(true, &[a.join("1.txt"), a.join("2.txt"), a.join("빈폴더")], &b, &HashMap::new(), &|_, _, _| {}).unwrap();
    assert_eq!(s.skipped, 1);
    assert!(b.join("1.txt").exists() && !a.join("1.txt").exists());
    assert!(a.join("2.txt").exists());
    assert_eq!(fs::read_to_string(b.join("2.txt")).unwrap(), "old");
    assert!(b.join("빈폴더").is_dir());
    assert!(transfer(true, &[a.clone()], &a.join("빈폴더"), &HashMap::new(), &|_, _, _| {}).is_err());
}

#[test]
fn rename_many_swap_and_undo_on_clash() {
    let d = tmp("ren");
    fs::write(d.join("a.txt"), "a").unwrap();
    fs::write(d.join("b.txt"), "b").unwrap();
    fs::write(d.join("c.txt"), "c").unwrap();
    let it = |p: &str, n: &str| RenameItem { path: d.join(p).to_string_lossy().into_owned(), name: n.into() };
    let back = rename_many(&[it("a.txt", "b.txt"), it("b.txt", "a.txt")]).unwrap();
    assert_eq!(fs::read_to_string(d.join("a.txt")).unwrap(), "b");
    assert_eq!(back.len(), 2);
    // c.txt로 바꾸려는 것은 이미 있어서 실패하고, 모두 원래대로예요.
    assert!(rename_many(&[it("a.txt", "x.txt"), it("b.txt", "c.txt")]).is_err());
    assert!(d.join("a.txt").exists() && d.join("b.txt").exists() && !d.join("x.txt").exists());
    assert!(rename_many(&[it("a.txt", "bad?.txt")]).is_err());
}

#[test]
fn names_and_find() {
    assert!(name_matches("*.jpg;*.png", "사진1.JPG"));
    assert!(!name_matches("*.jpg", "사진1.jpeg"));
    assert!(name_matches("봉일천리", "261015_봉일천리 209-10_포트홀.pptx"));
    assert!(name_matches("2610??_*", "261015_a_b.jpg"));
    assert!(name_matches("", "아무거나"));
    assert!(is_complaint_name("261015_봉일천리 209-10_포트홀_사진1.jpg"));
    assert!(!is_complaint_name("민원 원문 목록.hwp"));
    let d = tmp("find");
    fs::create_dir_all(d.join("sub")).unwrap();
    fs::write(d.join("261015_봉일천리_포트홀.jpg"), "x").unwrap();
    fs::write(d.join("sub/261016_연풍리_반사경.jpg"), "x").unwrap();
    fs::write(d.join("메모.txt"), "봉일천리 209-10 포트홀").unwrap();
    let spec = FindSpec { name: "*.jpg".into(), roots: vec![d.to_string_lossy().into_owned()], sub: true, ..Default::default() };
    assert_eq!(find(&spec, &|_, _| {}).len(), 2);
    let spec = FindSpec { roots: vec![d.to_string_lossy().into_owned()], sub: false, ..spec };
    assert_eq!(find(&spec, &|_, _| {}).len(), 1);
    let spec = FindSpec { name: String::new(), text: "209-10".into(), roots: vec![d.to_string_lossy().into_owned()], sub: true, ..Default::default() };
    let r = find(&spec, &|_, _| {});
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].entry.name, "메모.txt");
}

#[test]
fn mkdir_and_bad_names() {
    let d = tmp("mk");
    let p = mkdir(d.to_string_lossy().into_owned(), "새 폴더".into()).unwrap();
    assert!(Path::new(&p).is_dir());
    assert_eq!(mkdir(d.to_string_lossy().into_owned(), "새 폴더".into()), Err("exists".into()));
    assert_eq!(mkdir(d.to_string_lossy().into_owned(), "a:b".into()), Err("bad_name".into()));
    let s = subdirs(&d, false).unwrap();
    assert_eq!(s.len(), 1);
    assert!(!s[0].has_children);
}
