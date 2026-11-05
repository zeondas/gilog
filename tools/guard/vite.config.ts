// 지킴이용 미리 보기 빌드: 앱 코드는 그대로 두고, 빈 저장 자리(src/previewCore.ts)를 브라우저용 core(WASM)로 바꿔 끼워요
// (tools/preview/plugin.ts – 먼저 `npm run build:wasm`). seed.js가 실제 명령으로 자료를 채워요(2026-10-30 ②-3 2차, 전엔 api.ts 흉내).
import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";
import { previewCore } from "../preview/plugin";

export default mergeConfig(
  base,
  defineConfig({
    root: new URL("../..", import.meta.url).pathname,
    plugins: [previewCore()],
  }),
);
