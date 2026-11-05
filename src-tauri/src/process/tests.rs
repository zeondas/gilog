//! 파일 이름·받은 민원·지시부 규칙 시험.

use std::fs;
use std::path::Path;

use super::*;

#[test]
fn names() {
    assert_eq!(safe_name("봉일천리  209-10 / 앞?"), "봉일천리 209-10 앞");
    assert_eq!(case_stem("2026-10-15", "봉일천리 209-10", "포트홀"), "261015_봉일천리 209-10_포트홀");
    assert_eq!(case_stem("2026-10-15", "주소불명", ""), "261015_주소불명");
    assert_eq!(case_stem("2026-10-15", "선유리_455", "균열"), "261015_선유리455_균열");
}

#[test]
fn order_names_step_aside() {
    let d = std::env::temp_dir().join(format!("gilog_order_{}", std::process::id()));
    fs::create_dir_all(&d).unwrap();
    let a = order_path(&d, "261015_봉일천리 209-10_포트홀", "pptx");
    assert!(a.ends_with("261015_봉일천리 209-10_포트홀.pptx"));
    fs::write(d.join("261015_봉일천리 209-10_포트홀.jpg"), b"x").unwrap();
    assert!(order_path(&d, "261015_봉일천리 209-10_포트홀", "pptx").ends_with("261015_봉일천리 209-10_포트홀 (2).pptx"));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn finds_chrome_renamed_download() {
    assert!(same_download("사진.jpg", "사진.jpg"));
    assert!(same_download("사진 (2).jpg", "사진.jpg"));
    assert!(same_download("img(12).jpeg", "img.jpeg"));
    assert!(!same_download("사진2.jpg", "사진.jpg"));
    assert!(!same_download("사진 (a).jpg", "사진.jpg"));
    let d = std::env::temp_dir().join(format!("gilog_ff_{}", std::process::id()));
    let _ = fs::create_dir_all(&d);
    fs::write(d.join("Photo (1).JPG"), b"x").unwrap();
    assert_eq!(find_file("photo.jpg", &[d.as_path()]), Some(d.join("Photo (1).JPG")));
    assert_eq!(find_file("C:/없는/photo.jpg", &[d.as_path()]), Some(d.join("Photo (1).JPG")));
    assert_eq!(find_file("other.jpg", &[d.as_path()]), None);
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn log_shows_script_and_click_target() {
    let v = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"mcp__claude-in-chrome__browser_batch","input":{"actions":[
        {"name":"javascript_tool","input":{"action":"javascript_exec","tabId":1,"text":"(()=>{const a=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='목록');a.click();return 'ok'})()"}},
        {"name":"computer","input":{"action":"left_click","coordinate":[854,390],"tabId":1,"action_summary":"Clicks 첨부파일일괄다운로드"}}]}}]}});
    let l = log_line(&v, "", &mut Default::default());
    assert!(l.contains("js=(()=>{const a="), "{l}");
    assert!(l.contains("coordinate=[854,390]") && l.contains("(Clicks 첨부파일일괄다운로드)"), "{l}");
}

#[test]
fn photo_pick_prompt_and_answer() {
    let items = vec![
        PickItem { no: "1AA-1".into(), summary: "포트홀".into(), photos: vec!["D:/a1.jpg".into(), "D:/a2.jpg".into()] },
        PickItem { no: "1AA-2".into(), summary: "".into(), photos: vec!["D:/b1.jpg".into(), "D:/b2.jpg".into(), "D:/b3.jpg".into()] },
    ];
    let p = pick_prompt(&items);
    assert!(p.contains("## 1AA-1\n민원: 포트홀\n1. D:/a1.jpg\n2. D:/a2.jpg"), "{p}");
    let r = parse_picks("골랐어요.\n[{\"no\":\"1AA-1\",\"pick\":2,\"reason\":\"파임이 크게 보임\"},{\"no\":\"1AA-2\",\"pick\":\"3\",\"reason\":\"\"},{\"no\":\"1AA-9\",\"pick\":1},{\"no\":\"1AA-2\",\"pick\":9}]", &items);
    assert_eq!(r, vec![
        PickResult { no: "1AA-1".into(), pick: "D:/a2.jpg".into(), reason: "파임이 크게 보임".into() },
        PickResult { no: "1AA-2".into(), pick: "D:/b3.jpg".into(), reason: "".into() },
    ]);
    assert!(parse_picks("모르겠어요", &items).is_empty());
}

#[test]
fn splits_map_out_of_zip() {
    let (m, r) = split_map(vec!["d/1AA_20260930_1_ab.jpg".into(), "d/1AA_20260930_cd_MAPIMG.png".into()]);
    assert_eq!((m, r), (vec!["d/1AA_20260930_cd_MAPIMG.png".to_string()], vec!["d/1AA_20260930_1_ab.jpg".to_string()]));
    let (m, r) = split_map(vec!["d/a.jpg".into(), "d/b.jpg".into(), "d/c.png".into()]);
    assert_eq!((m.len(), r.len()), (1, 2));
    let (m, r) = split_map(vec!["d/a.jpg".into(), "d/b.png".into(), "d/c.png".into()]);
    assert_eq!((m.len(), r.len()), (0, 3));
    let (m, r) = split_map(vec!["d/only.png".into()]);
    assert_eq!((m.len(), r.len()), (0, 1));
}

#[test]
fn waits_until_attachments_arrive() {
    let d = std::env::temp_dir().join(format!("gilog_wait_{}", std::process::id()));
    let _ = fs::create_dir_all(&d);
    let dirs = [d.as_path()];
    // 아직 안 내려옴 → 기다림, 빈 이름(위치도 없음)은 셈하지 않음
    assert!(waiting_for_files(&["현장1.jpg", ""], &dirs));
    fs::write(d.join("현장1 (1).jpg"), b"x").unwrap();
    assert!(!waiting_for_files(&["현장1.jpg", ""], &dirs));
    assert!(waiting_for_files(&["현장1.jpg", "MAPIMG.png"], &dirs));
    assert!(!waiting_for_files(&[], &dirs));
    let _ = fs::remove_dir_all(&d);
}

#[test]
fn counts_case_writes_and_timing() {
    let w = |p: &str| serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":p}}]}});
    assert!(writes_case(&w("D:\\민원처리\\가져오기\\1AA-2610-0645798.json")));
    assert!(writes_case(&w("/tmp/1AA-2610-0645798.JSON")));
    assert!(!writes_case(&w("D:\\민원처리\\가져오기\\_진행.json")));
    assert!(!writes_case(&w("D:\\a\\note.txt")));
    assert!(!writes_case(&serde_json::json!({"type":"user"})));
    assert_eq!(timing_line(&[], 12.0), "## 걸린 시간 12초 · 민원 0건");
    assert_eq!(timing_line(&[50.0], 70.0), "## 걸린 시간 70초 · 민원 1건 · 첫 건까지 50초");
    assert_eq!(timing_line(&[50.0, 60.0, 80.0], 90.0), "## 걸린 시간 90초 · 민원 3건 · 첫 건까지 50초 · 건당 평균 15.0초");
}

#[test]
fn final_answer_states() {
    assert_eq!(final_state("LOGIN_REQUIRED", false).0, "login");
    assert_eq!(final_state("새 민원 3건을 가져왔어요", false).0, "done");
    assert_eq!(final_state("오류: 확장 연결 안 됨\n자세히", true).0, "error");
    assert_eq!(final_state("신문고 로그인 화면이 떠서 멈췄어요", false).0, "login");
    assert!(final_state("PAGE_UNREADABLE", false).1.contains("IE 모드"));
    // 지시부 메일(2026-10-20)
    assert_eq!(final_state("MAIL_SENT", false).0, "done");
    assert_eq!(final_state("MAIL_UNCONFIRMED", false), ("done".into(), "unconfirmed".into()));
    assert_eq!(final_state("ATTACH_FAILED 파일 입력란을 못 찾았어요", false), ("error".into(), "첨부를 붙이지 못했어요 – 파일 입력란을 못 찾았어요".into()));
    assert_eq!(final_state("MAIL_FAILED", false).1, "메일을 보내지 못했어요");
}

#[test]
fn explain_reasons() {
    assert!(explain("error: unknown option '--permission-prompts'", "", Some(1)).contains("옵션"));
    assert!(explain("", "Claude in Chrome extension is not connected", Some(1)).contains("확장"));
    assert!(explain("TypeError: fetch failed", "", Some(1)).contains("인터넷"));
    assert!(explain("", "", Some(3)).contains("종료 코드 3"));
}

#[test]
fn log_line_hides_bodies() {
    let v: serde_json::Value = serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","content":"홍길동 010-1234-5678","is_error":false}]}});
    let l = log_line(&v, "", &mut Default::default());
    assert!(!l.contains("홍길동") && l.contains("tool_result"));
    let v: serde_json::Value = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write","input":{"file_path":"D:\\a.json","content":"비밀"}},{"type":"text","text":"적었어요"}]}});
    let l = log_line(&v, "", &mut Default::default());
    assert!(l.contains("tool_use Write file_path=D:\\a.json") && !l.contains("비밀") && !l.contains("적었어요"));
}

#[test]
fn log_line_shows_browser_choice() {
    let mut seen = Default::default();
    let v = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"mcp__claude-in-chrome__list_connected_browsers","input":{}}]}});
    assert!(log_line(&v, "", &mut seen).contains("list_connected_browsers"));
    let v = serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"Chrome (hunmin), Edge (hunmin)"}]}});
    assert!(log_line(&v, "", &mut seen).contains("Chrome (hunmin), Edge"));
    let v = serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t2","content":"홍길동"}]}});
    assert!(!log_line(&v, "", &mut seen).contains("홍길동"));
    assert_eq!(final_state("NO_CHROME", false).0, "error");
    let v = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t3","name":"mcp__claude-in-chrome__computer","input":{"action":"left_click","ref":"ref_12"}},{"type":"tool_use","id":"t4","name":"mcp__claude-in-chrome__computer","input":{"action":"type","text":"홍길동"}},{"type":"tool_use","id":"t5","name":"mcp__claude-in-chrome__find","input":{"query":"목록 단추"}}]}});
    let l = log_line(&v, "", &mut seen);
    assert!(l.contains("computer action=left_click ref=ref_12") && l.contains("text=3자") && !l.contains("홍길동") && l.contains("find query=목록 단추"));
}

#[test]
fn unzip_only_images() {
    let dir = std::env::temp_dir().join(format!("gilog-unzip-{}", std::process::id()));
    let _ = fs::create_dir_all(&dir);
    let z = dir.join("첨부.zip");
    {
        let f = fs::File::create(&z).unwrap();
        let mut w = zip::ZipWriter::new(f);
        let o = zip::write::SimpleFileOptions::default();
        for (n, b) in [("b.jpg", b"jpg".as_slice()), ("a.png", b"png".as_slice()), ("memo.txt", b"txt".as_slice()), ("sub/c.JPEG", b"j".as_slice())] {
            w.start_file(n, o).unwrap();
            std::io::Write::write_all(&mut w, b).unwrap();
        }
        w.finish().unwrap();
    }
    let out = unzip_images(&z, &dir).unwrap();
    let names: Vec<String> = out.iter().map(|p| Path::new(p).file_name().unwrap().to_string_lossy().into_owned()).collect();
    assert_eq!(names, vec!["첨부_a.png", "첨부_b.jpg", "첨부_c.JPEG"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn inbox_file_one_or_many() {
    assert_eq!(parse_inbox_file("\u{feff}{\"no\":\"1AA-1\",\"photos\":[\"a.jpg\"]}").unwrap()[0].photos, vec!["a.jpg"]);
    assert_eq!(parse_inbox_file("[{\"no\":\"1\"},{\"no\":\"2\"}]").unwrap().len(), 2);
    assert!(parse_inbox_file("{}").is_none());
    assert!(parse_inbox_file("깨진 파일").is_none());
}

#[test]
fn script_quotes_paths() {
    let s = jpg_script(Path::new("D:/민원/261019_O'Neil-03.hwpx"), Path::new("C:/t/p.jpg"));
    assert!(s.contains("'D:/민원/261019_O''Neil-03.hwpx'"));
    assert!(s.contains("HWPFrame.HwpObject"));
}

#[test]
fn order_names_and_pages() {
    assert_eq!(order_stem("2026-10-19", "동부권 도로시설물 1지구", 3), "261019_동부권 도로시설물 1지구-03");
    assert_eq!(page_names("a", 1), vec!["a.jpg"]);
    assert_eq!(page_names("a", 2), vec!["a_1.jpg", "a_2.jpg"]);
    let mut v: Vec<String> = ["p010.jpg", "p002.jpg", "p.jpg", "p9.jpg"].iter().map(|s| s.to_string()).collect();
    sort_pages(&mut v);
    assert_eq!(v, ["p.jpg", "p002.jpg", "p9.jpg", "p010.jpg"]);
}
