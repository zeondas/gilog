// 재기용 미리 보기 빌드: 앱 코드는 그대로 두고, 빌드할 때만 api.ts 끝에 `window.__fake = fake` 한 줄을 붙여요
// (tools/align README의 "잠깐 넣고 되돌리기"를 손대지 않고 하는 방법). seed.js가 그 순간 자료를 채워요.
import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";

export default mergeConfig(
  base,
  defineConfig({
    root: new URL("../..", import.meta.url).pathname,
    plugins: [
      {
        name: "gilog-load-fake",
        enforce: "pre",
        transform(code, id) {
          if (id.replace(/\\/g, "/").endsWith("/src/api.ts")) return code + "\n;window[\"__fake\"] = fake;\n";
        },
      },
    ],
  }),
);
