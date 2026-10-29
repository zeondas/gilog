// 미리 보기 빌드용 Vite 꽂이: 앱 코드는 그대로 두고 src/previewCore.ts(빈 자리)를 tools/preview/core.ts(WASM 저장 모듈)로 바꿔 끼워요.
// 지킴이(tools/guard)·부하 시험(tools/load) 빌드 설정이 써요. 앱 빌드(vite.config.ts)는 쓰지 않아요 – 설치 파일에 안 들어가요.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export function previewCore(): Plugin {
  const real = fileURLToPath(new URL("./core.ts", import.meta.url));
  const pkg = fileURLToPath(new URL("../../src/wasm-pkg/gilog_core_wasm.js", import.meta.url));
  return {
    name: "gilog-preview-core",
    enforce: "pre",
    buildStart() {
      if (!existsSync(pkg)) this.error("미리 보기 저장 모듈이 없어요 – 먼저 `npm run build:wasm` (tools/preview/build-wasm.mjs)");
    },
    async resolveId(source, importer, options) {
      if (!/(^|\/)previewCore(\.ts)?$/.test(source)) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r && r.id.replace(/\\/g, "/").endsWith("/src/previewCore.ts") ? real : null;
    },
  };
}
