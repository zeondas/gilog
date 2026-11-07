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

// 2026-11-07 민원지도·캘린더·첫 화면 재기(결정 로그 11-07 07:41) – 이 빌드에서만:
// · google.ts 끝에 `window.__loadGoogleFns = { desired, desiredTasks, fingerprint }` – 구글 "바뀐 것 찾기" 계산을 네트워크 없이 재요.
// · 들어가는 JS 덩어리 맨 앞·맨 끝에 performance.mark("gilog-js-start"/"gilog-js-end") – 받은 뒤 읽기·실행 시간을 Performance API로 재요.
// · 모듈마다 크기를 `load-modules.json`으로 – 민원지도·구글 코드를 나눠 읽으면 얼마나 줄지 어림하는 데 써요.
function googleHook(): Plugin {
  return {
    name: "gilog-load-google",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/src/google.ts")) return null;
      return code + "\n;window.__loadGoogleFns = { desired, desiredTasks, fingerprint };\n";
    },
  };
}

function moduleSizes(): Plugin {
  return {
    name: "gilog-load-module-sizes",
    generateBundle(_, bundle) {
      const out: Record<string, Record<string, number>> = {};
      for (const c of Object.values(bundle)) {
        if (c.type !== "chunk") continue;
        out[c.fileName] = Object.fromEntries(Object.entries(c.modules).map(([id, m]) => [id.replace(/\\/g, "/").replace(/^.*?\/(src|node_modules)\//, "$1/"), m.renderedLength]));
      }
      this.emitFile({ type: "asset", fileName: "load-modules.json", source: JSON.stringify(out) });
    },
  };
}

export default mergeConfig(
  base,
  defineConfig({
    root: new URL("../..", import.meta.url).pathname,
    plugins: [previewCore(), filesSeedHook(), googleHook(), moduleSizes()],
    build: {
      rollupOptions: {
        output: {
          banner: (c) => (c.isEntry ? 'performance.mark("gilog-js-start");' : ""),
          footer: (c) => (c.isEntry ? 'performance.mark("gilog-js-end");' : ""),
        },
      },
    },
  }),
);
