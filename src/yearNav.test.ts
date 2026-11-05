// 해 묶음 – 숫자로 해 옮기기(2026-10-29 집행현황 ✔2, 사용자 ②1안)
import { describe, expect, test } from "vitest";
import { parseYear } from "./YearNav";

describe("해 읽기", () => {
  test("네 자리", () => {
    expect(parseYear("2027")).toBe(2027);
    expect(parseYear("2000")).toBe(2000);
    expect(parseYear("2099")).toBe(2099);
  });
  test("두 자리는 2000년대(날짜 칸 규칙과 같게)", () => {
    expect(parseYear("27")).toBe(2027);
    expect(parseYear("05")).toBe(2005);
  });
  test("'년'·띄어쓰기는 떼요", () => {
    expect(parseYear(" 2026년 ")).toBe(2026);
  });
  test("읽을 수 없으면 null", () => {
    for (const s of ["", "7", "202", "20271", "1999", "2100", "abc", "26.5"]) expect(parseYear(s)).toBeNull();
  });
});
