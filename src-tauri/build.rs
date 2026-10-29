//! 앱 명령 허용 묶음(품질 보완 ② ✔5, 2026-10-29 `wip/guardrails`)
//!
//! `src/lib.rs`의 `generate_handler![…]`에 적은 명령을 읽어 Tauri에 알려 줘요. 그러면 명령마다 `allow-<명령>` 허용이
//! 생기고, 허용 묶음에 없는 명령은 화면이 불러도 막혀요. 묶음은 둘이에요(`permissions/app-sets.toml`, 여기서 만들어요):
//! - `app-commands`: 보통 명령 전부
//! - `app-risky`: 지우기·옮기기·실행·관리자 실행·민원처리 Claude 실행처럼 되돌리기 어려운 명령(경로 검사 `guard.rs`를 거쳐요)
//!
//! 기본 창(main) 하나에만 두 묶음을 허용해요(`capabilities/default.json`). 새 명령을 `generate_handler!`에 더하면
//! 저절로 `app-commands`에 들어가요. 위험한 명령이면 아래 `RISKY`에도 이름을 더해요.

/// 되돌리기 어렵거나 프로그램을 실행하는 명령
const RISKY: &[&str] = &[
    "fs_delete",
    "fs_transfer",
    "fs_rename",
    "fs_rename_many",
    "fs_undo",
    "fs_open",
    "fs_explorer",
    "fs_fast_setup",
    "fs_make_links",
    "fs_zip_extract",
    "open_path",
    "run_claude",
    "pick_photos",
    "move_data",
    "import_backup",
    "restore_and_open",
];

fn commands() -> Vec<String> {
    let src = std::fs::read_to_string("src/lib.rs").expect("src/lib.rs");
    let start = src.find("generate_handler![").expect("generate_handler!") + "generate_handler![".len();
    let end = start + src[start..].find(']').expect("generate_handler 끝");
    src[start..end]
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.rsplit("::").next().unwrap_or(s).to_string())
        .collect()
}

fn main() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    let all = commands();
    for r in RISKY {
        assert!(all.iter().any(|c| c == r), "RISKY의 {r}가 generate_handler!에 없어요");
    }
    let id = |c: &str| format!("\"allow-{}\"", c.replace('_', "-"));
    let normal: Vec<String> = all.iter().filter(|c| !RISKY.contains(&c.as_str())).map(|c| id(c)).collect();
    let risky: Vec<String> = RISKY.iter().map(|c| id(c)).collect();
    let toml = format!(
        "# build.rs가 만들어요 – 손으로 고치지 않아요(명령은 src/lib.rs generate_handler!, 위험 명령은 build.rs RISKY)\n\n\
         [[set]]\nidentifier = \"app-commands\"\ndescription = \"보통 앱 명령\"\npermissions = [{}]\n\n\
         [[set]]\nidentifier = \"app-risky\"\ndescription = \"지우기·옮기기·실행 등 경로 검사를 거치는 명령\"\npermissions = [{}]\n",
        normal.join(", "),
        risky.join(", ")
    );
    std::fs::create_dir_all("permissions").expect("permissions");
    let path = "permissions/app-sets.toml";
    if std::fs::read_to_string(path).ok().as_deref() != Some(toml.as_str()) {
        std::fs::write(path, toml).expect("app-sets.toml");
    }
    let names: &'static [&'static str] = Box::leak(all.into_iter().map(|c| &*Box::leak(c.into_boxed_str())).collect::<Vec<_>>().into_boxed_slice());
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(names))).expect("tauri build");
}
