// 창 크기 시험 – 지금 값을 고정해요(정리 2차 2026-10-26, 결정 로그 10-26 16:44, docs/qa/viewport.md).
import { expect, test } from "vitest";
import { MIN_W, minWidthOf, VIEWPORT_SCROLL } from "./viewport";

test("화면마다 최소 폭(본문 안 폭, 기준 1364)", () => {
  expect(VIEWPORT_SCROLL).toBe(true);
  expect(MIN_W).toEqual({ explorer: 856, complaints: 1364, process: 1364, budget: 752, bstatus: 752, calendar: 1204, todo: 0, journal: 0, contacts: 1124, settings: 0 });
  expect(minWidthOf("calendar")).toBe(1204);
  expect(minWidthOf(null)).toBe(0);
});
