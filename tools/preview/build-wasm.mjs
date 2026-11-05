// 미리 보기용 저장 모듈 빌드(품질 보완 ②-3 ✔4) – `npm run build:wasm`
//
// src-tauri/core-wasm(앱과 같은 core 규칙)을 브라우저용(wasm32)으로 만들고 wasm-bindgen으로 화면이 부를 JS를 붙여
// src/wasm-pkg/에 둬요(.gitignore – 저장소에 넣지 않아요). 지킴이·부하 시험·매뉴얼 미리 보기 빌드만 이것을 써요.
// 앱 빌드(`npm run build`)는 이것 없이 빈 자리(src/previewCore.ts)로 만들어져 설치 파일에 들어가지 않아요.
//
// 필요한 것: rustup 대상 wasm32-unknown-unknown, clang(SQLite C 코드), wasm-bindgen CLI(아래 판 그대로).
//   rustup target add wasm32-unknown-unknown
//   cargo install wasm-bindgen-cli --version 0.2.129 --locked
// 작업 공간에서 static.rust-lang.org가 막혀 있으면 CI(check.yml 지킴이)가 남긴 산출물을 받아 src/wasm-pkg/에 풀어요.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** src-tauri/core-wasm/Cargo.toml의 wasm-bindgen 판과 같아야 해요 */
export const WASM_BINDGEN = "0.2.129";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = join(root, "src-tauri/core-wasm/Cargo.toml");
const target = process.env.CARGO_TARGET_DIR || join(root, "src-tauri/core-wasm/target");
const out = join(root, "src/wasm-pkg");
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: root });

let ver = "";
try {
  ver = execFileSync("wasm-bindgen", ["--version"], { encoding: "utf8" }).trim();
} catch {
  console.error(`wasm-bindgen이 없어요 – cargo install wasm-bindgen-cli --version ${WASM_BINDGEN} --locked`);
  process.exit(1);
}
if (!ver.endsWith(" " + WASM_BINDGEN)) {
  console.error(`wasm-bindgen 판이 달라요(${ver}) – ${WASM_BINDGEN}이 필요해요(cargo install wasm-bindgen-cli --version ${WASM_BINDGEN} --locked --force)`);
  process.exit(1);
}

run("cargo", ["build", "--release", "--lib", "--target", "wasm32-unknown-unknown", "--manifest-path", manifest]);
const wasm = join(target, "wasm32-unknown-unknown/release/gilog_core_wasm.wasm");
if (!existsSync(wasm)) {
  console.error("빌드한 파일이 없어요: " + wasm);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
run("wasm-bindgen", ["--target", "web", "--no-typescript", "--out-dir", out, "--out-name", "gilog_core_wasm", wasm]);
console.log("미리 보기 저장 모듈 → src/wasm-pkg/");
