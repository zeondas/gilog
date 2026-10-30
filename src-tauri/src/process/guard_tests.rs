//! 실행 파일·작업 폴더 검사(`checked_exe`·`checked_dirs`) 시험.

use super::*;

fn saved() -> SavedProcess {
    parse_saved_process(Some(r#"{"process":{"claude":"C:\\Users\\me\\.local\\bin\\claude.exe","inbox":"D:\\민원처리\\가져오기","downloads":"D:\\","outbox":"D:\\민원처리\\보내기"}}"#))
}

#[test]
fn saved_defaults_when_missing() {
    let s = parse_saved_process(None);
    assert_eq!(s.claude, "claude");
    assert_eq!(s.inbox, DEFAULT_INBOX);
    assert_eq!(parse_saved_process(Some(r#"{"process":{"claude":"  "}}"#)).claude, "claude");
}

#[test]
fn exe_must_match_saved_setting() {
    let s = saved();
    assert!(checked_exe("C:\\Users\\me\\.local\\bin\\claude.exe", &s).is_ok());
    assert!(checked_exe("c:/users/ME/.local/bin/CLAUDE.EXE", &s).is_ok());
    assert_eq!(checked_exe("C:\\Windows\\System32\\cmd.exe", &s).unwrap_err(), crate::guard::DENIED);
    assert_eq!(checked_exe("", &s).unwrap_err(), crate::guard::DENIED);
    // 처음 값 "claude"끼리는 돼요
    assert!(checked_exe("", &parse_saved_process(None)).is_ok());
    assert!(checked_exe("claude", &parse_saved_process(None)).is_ok());
}

#[test]
fn exe_name_must_be_claude() {
    let bad = parse_saved_process(Some(r#"{"process":{"claude":"C:\\x\\evil.exe"}}"#));
    assert_eq!(checked_exe("C:\\x\\evil.exe", &bad).unwrap_err(), crate::guard::DENIED);
    let up = parse_saved_process(Some(r#"{"process":{"claude":"C:\\x\\..\\claude.exe"}}"#));
    assert_eq!(checked_exe("C:\\x\\..\\claude.exe", &up).unwrap_err(), crate::guard::DENIED);
}

#[test]
fn settings_save_cannot_change_exe() {
    let old = r#"{"theme":"a","process":{"claude":"C:\\Users\\me\\.local\\bin\\claude.exe","inbox":"D:\\x"}}"#;
    // 다른 값은 바꿔도 돼요(대소문자·끝 \\ 차이도 같은 자리)
    assert!(settings_keep_exe(Some(old), r#"{"theme":"b","process":{"claude":"c:/users/me/.local/bin/CLAUDE.EXE","inbox":"E:\\y"}}"#));
    // Claude 자리를 바꾸면 막아요
    assert!(!settings_keep_exe(Some(old), r#"{"process":{"claude":"C:\\Windows\\System32\\cmd.exe"}}"#));
    assert!(!settings_keep_exe(Some(old), r#"{"theme":"b"}"#));
    assert!(!settings_keep_exe(Some(old), "깨진 글"));
    // 처음 저장(없음 → 처음 값)은 돼요
    assert!(settings_keep_exe(None, r#"{"process":{"claude":""}}"#));
    assert!(settings_keep_exe(None, r#"{"theme":"a"}"#));
}

#[test]
fn set_process_exe_keeps_other_values() {
    let old = r#"{"theme":"a","process":{"claude":"claude","inbox":"D:\\x"}}"#;
    let next = with_process_exe(Some(old), "C:\\c\\claude.exe").unwrap();
    let s = parse_saved_process(Some(&next));
    assert_eq!(s.claude, "C:\\c\\claude.exe");
    assert_eq!(s.inbox, "D:\\x");
    assert!(next.contains("\"theme\":\"a\""));
    assert_eq!(parse_saved_process(Some(&with_process_exe(None, "C:\\c\\claude.exe").unwrap())).claude, "C:\\c\\claude.exe");
    // 이렇게 바꾼 뒤의 설정 저장은 통과해요
    assert!(settings_keep_exe(Some(&next), &next));
}

#[test]
fn run_dirs_are_the_saved_ones() {
    let s = saved();
    assert!(checked_dirs("D:\\민원처리\\가져오기", "D:\\", &s).is_ok());
    assert!(checked_dirs("D:\\민원처리\\가져오기\\", "d:/", &s).is_ok());
    assert!(checked_dirs("D:\\민원처리\\보내기\\메일", "D:\\", &s).is_ok());
    assert_eq!(checked_dirs("C:\\Windows", "D:\\", &s).unwrap_err(), crate::guard::DENIED);
    assert_eq!(checked_dirs("D:\\민원처리\\가져오기", "C:\\", &s).unwrap_err(), crate::guard::DENIED);
}
