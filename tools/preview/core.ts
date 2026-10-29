// 미리 보기 빌드에서 src/previewCore.ts 자리에 들어가는 진짜 저장 모듈이에요(tools/preview/plugin.ts가 바꿔 끼워요).
// src-tauri/core-wasm(앱과 같은 core 규칙, 메모리 저장소)을 불러요 – 먼저 `npm run build:wasm`으로 src/wasm-pkg/를 만들어요.
//
// 시험 자료: 페이지가 `window.__previewSeed = async (call) => { … }`를 미리 두면(지킴이 seed.js 등) 저장 모듈이 준비된 뒤
// 화면이 처음 부르기 전에 한 번 불러요. call은 앱 명령 이름 그대로예요(`call("add_complaint", { complaint })`).
import init, { call, drive_get, drive_put } from "../../src/wasm-pkg/gilog_core_wasm.js";

type Call = (cmd: string, args?: Record<string, unknown>) => unknown;
type Win = { __previewSeed?: (call: Call) => unknown; __preview?: unknown };

/** 실패는 앱처럼 실패 이름 글자로 던져요("locked"·"invalid"…). */
const raw: Call = (cmd, args = {}) => JSON.parse(call(cmd, JSON.stringify(args ?? {})));

let ready: Promise<void> | null = null;

function boot(): Promise<void> {
  ready ??= (async () => {
    await init();
    const w = window as unknown as Win;
    // 시험 도구가 엑셀 파일을 넣고 꺼낼 때(가짜 드라이브: 경로 → 바이트)
    w.__preview = { call: raw, drivePut: (path: string, bytes: Uint8Array) => drive_put(path, bytes), driveGet: (path: string) => drive_get(path) };
    if (w.__previewSeed) await w.__previewSeed(raw);
  })();
  return ready;
}

export async function previewCall(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  await boot();
  return raw(cmd, args);
}
