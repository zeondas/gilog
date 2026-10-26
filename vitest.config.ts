// 규칙 함수 시험(정리 2차, 2026-10-26 사용자 ④1안) – `npm test`. 화면 파일을 함께 불러오는 규칙이 있어 브라우저 흉내(happy-dom)에서 돌려요.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    env: { TZ: "Asia/Seoul" },
  },
});
