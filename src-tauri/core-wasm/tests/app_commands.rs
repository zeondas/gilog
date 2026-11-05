//! 맞춤 시험: 앱 명령 목록(`src-tauri/src/lib.rs`의 `generate_handler!`) = 브라우저용 + 자리 표시자.
//! 앱에 명령을 더했는데 여기 목록에 안 적으면 실패해요 – 미리 보기가 그 명령을 모르는 채로 남지 않게.
//! 브라우저용인지 자리 표시자인지는 그 명령이 core만 쓰는지(브라우저용), 파일·윈도우·인터넷·실행이 드는지(자리 표시자)로 정해요.

use std::collections::BTreeSet;

use gilog_core_wasm::{BROWSER, PLACEHOLDER, PREVIEW_ONLY};

fn app_commands() -> BTreeSet<String> {
    let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib.rs")).expect("src-tauri/src/lib.rs");
    let start = src.find("generate_handler![").expect("generate_handler!") + "generate_handler![".len();
    let end = start + src[start..].find(']').expect("]");
    src[start..end]
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        // `files::fs_list`처럼 모듈 이름이 붙은 것은 끝 이름만(Tauri가 부르는 이름)
        .map(|s| s.rsplit("::").next().unwrap().to_string())
        .collect()
}

#[test]
fn app_list_equals_browser_plus_placeholder() {
    let app = app_commands();
    assert!(app.len() > 100, "앱 명령을 읽지 못했어요: {}", app.len());
    let browser: BTreeSet<String> = BROWSER.iter().map(|s| s.to_string()).collect();
    let ph: BTreeSet<String> = PLACEHOLDER.iter().map(|s| s.to_string()).collect();
    assert_eq!(browser.len(), BROWSER.len(), "브라우저용 목록에 같은 이름이 두 번 있어요");
    assert_eq!(ph.len(), PLACEHOLDER.len(), "자리 표시자 목록에 같은 이름이 두 번 있어요");
    let both: Vec<_> = browser.intersection(&ph).collect();
    assert!(both.is_empty(), "두 목록에 함께 있는 명령: {both:?}");
    let ours: BTreeSet<String> = browser.union(&ph).cloned().collect();
    let missing: Vec<_> = app.difference(&ours).collect();
    assert!(missing.is_empty(), "앱에 있는데 미리 보기 목록에 없는 명령(브라우저용이나 자리 표시자에 더해요): {missing:?}");
    let extra: Vec<_> = ours.difference(&app).collect();
    assert!(extra.is_empty(), "앱에 없는데 미리 보기 목록에 있는 명령: {extra:?}");
    for n in PREVIEW_ONLY {
        assert!(n.starts_with("preview_") && !app.contains(*n), "미리 보기 전용 명령은 preview_로 시작하고 앱에 없어야 해요: {n}");
    }
}
