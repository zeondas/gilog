// 규칙 함수 시험(정리 2차, 2026-10-26 사용자 ④1안) – `npm test`. 화면 파일을 함께 불러오는 규칙이 있어 브라우저 흉내(happy-dom)에서 돌려요.
// 화면 부품 시험 `*.test.tsx`(품질 보완 ③ ✔4, 2026-10-29): 키·입력 동작만 – @testing-library/react로 띄워요.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "happy-dom",
    env: { TZ: "Asia/Seoul" },
  },
});
