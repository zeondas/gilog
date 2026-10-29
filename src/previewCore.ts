// 브라우저 미리 보기의 저장 쪽 자리예요(품질 보완 ②-3).
// 앱 빌드(`npm run build` → 설치 파일)에서는 이 빈 자리 그대로라 미리 보기 저장 모듈이 들어가지 않아요(앱은 Tauri로 Rust를 불러요).
// 지킴이·부하 시험·매뉴얼 미리 보기 빌드는 tools/preview/plugin.ts가 이 파일을 tools/preview/core.ts(브라우저용 core, WASM)로 바꿔 끼워요.

/** 앱 명령 하나를 미리 보기 저장 모듈로 불러요. 빈 자리는 늘 실패("io")예요. */
export async function previewCall(_cmd: string, _args: Record<string, unknown>): Promise<unknown> {
  throw "io";
}
