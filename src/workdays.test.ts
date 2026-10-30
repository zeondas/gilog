// 남은 날 근무일 셈(2026-10-30 사용자 – 국민신문고 "남은 처리기간"과 같게)
import { afterEach, describe, expect, test } from "vitest";
import { isRestDay, setHolidays, workDaysBetween } from "./workdays";

afterEach(() => setHolidays([]));

describe("workDaysBetween", () => {
  test("신문고와 같게: 10-30(금) → 마감 11-02(월) = 1", () => {
    expect(workDaysBetween("2026-10-30", "2026-11-02")).toBe(1);
  });
  test("같은 날 0, 평일만이면 달력 날과 같음", () => {
    expect(workDaysBetween("2026-11-02", "2026-11-02")).toBe(0);
    expect(workDaysBetween("2026-11-02", "2026-11-05")).toBe(3);
  });
  test("토·일에 보면 다음 근무일부터 셈", () => {
    expect(workDaysBetween("2026-10-31", "2026-11-02")).toBe(1);
    expect(workDaysBetween("2026-11-01", "2026-11-03")).toBe(2);
  });
  test("공휴일은 빼요", () => {
    setHolidays([{ date: "2026-11-03" }]);
    expect(isRestDay("2026-11-03")).toBe(true);
    expect(workDaysBetween("2026-11-02", "2026-11-04")).toBe(1);
  });
  test("쉬는 날 마감이라 0이 되면 1(아직 오늘은 아님)", () => {
    expect(workDaysBetween("2026-10-30", "2026-11-01")).toBe(1);
  });
  test("지남: 마감 다음 근무일부터 오늘까지 –", () => {
    expect(workDaysBetween("2026-11-03", "2026-11-02")).toBe(-1);
    expect(workDaysBetween("2026-11-02", "2026-10-30")).toBe(-1);
    expect(workDaysBetween("2026-11-04", "2026-10-30")).toBe(-3);
  });
});
