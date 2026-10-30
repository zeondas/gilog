// 재기용 미리 보기 빌드: 앱 코드는 그대로 두고 빈 저장 자리(src/previewCore.ts)를 브라우저용 core(WASM)로 바꿔 끼워요
// (tools/preview/plugin.ts – 먼저 `npm run build:wasm`). seed.js가 실제 명령(`window.__previewSeed`)으로 3년치 자료를 채워요
// (2026-10-30 ②-3 3차).
// 탐색기 가짜 폴더(src/filesApi.ts)는 core 밖이라, 이 빌드에서만 모듈 끝에 `window.__filesSeed(addFake, addDir)` 부르기를
// 붙여요 – 재기 도구(files.py)가 파일 0·500·2,000개 폴더를 만들어요(2026-10-30 탐색기 부하). 앱 빌드에는 안 들어가요.
import { defineConfig, mergeConfig, type Plugin } from "vite";
import base from "../../vite.config";
import { previewCore } from "../preview/plugin";

function filesSeedHook(): Plugin {
  return {
    name: "gilog-load-files-seed",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/src/filesApi.ts")) return null;
      // TS를 JS로 바꾼 뒤에 붙으니 타입 없이 써요
      return code + "\n;window.__filesSeed?.(addFake, addDir);\n";
    },
  };
}

export default mergeConfig(
  base,
  defineConfig({
    root: new URL("../..", import.meta.url).pathname,
    plugins: [previewCore(), filesSeedHook()],
  }),
);
