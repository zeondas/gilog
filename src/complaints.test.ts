// 민원대장 규칙 시험 – 지금 동작을 고정해요(정리 2차 2026-10-26): 남은 날·걸린 날·검색(초성·번호)·유형 초성·필터.
import { describe, expect, test } from "vitest";
import type { Complaint } from "./api";
import { daysBetween, daysLeft, daysTaken, ddayText, dueSoon, expandType, filterValues, isUrgent, matches, NO_FILTERS, passes, readStatusFilter, shortDate, shortIntake, takenText } from "./complaints";

const C = (o: Partial<Complaint>): Complaint => ({
  id: 1, no: 1, intake: "국민신문고", received: "2026-10-10", ctype: "포트홀", area: "조리읍", place: "봉일천리 113 일원",
  person: "홍길동 010-1234-5678", phone: "", body: "", action: "", due: "", status: "접수", memo: "", ...o,
});

describe("남은 날", () => {
  test("daysBetween", () => {
    expect(daysBetween("2026-10-15", "2026-10-18")).toBe(3);
    expect(daysBetween("2026-10-18", "2026-10-15")).toBe(-3);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
  test("daysLeft – 마감이 없거나 답변이 끝났으면 null", () => {
    expect(daysLeft(C({ due: "2026-10-20" }), "2026-10-15")).toBe(5);
    expect(daysLeft(C({ due: "" }), "2026-10-15")).toBeNull();
    // 결정 로그 10-25 20:13: "진행"도 답변이 끝난 상태
    for (const s of ["진행", "답변", "완료", "보류", "장기"]) expect(daysLeft(C({ due: "2026-10-20", status: s }), "2026-10-15")).toBeNull();
  });
  test("ddayText", () => {
    expect(ddayText(3)).toBe("D-3");
    expect(ddayText(0)).toBe("D-day");
    expect(ddayText(-2)).toBe("D+2");
  });
  test("isUrgent – 기준 안이거나 지났음", () => {
    expect(isUrgent(3, 3)).toBe(true);
    expect(isUrgent(4, 3)).toBe(false);
    expect(isUrgent(-1, 3)).toBe(true);
  });
  test("dueSoon – 7일 안·지난 것, 마감순 → 연번순", () => {
    const list = [
      C({ id: 1, no: 1, due: "2026-10-22" }),
      C({ id: 2, no: 2, due: "2026-10-23" }),
      C({ id: 3, no: 3, due: "2026-10-12" }),
      C({ id: 4, no: 4, due: "2026-10-22", status: "답변" }),
      C({ id: 5, no: 0, due: "2026-10-22" }),
    ];
    expect(dueSoon(list, "2026-10-15").map((c) => c.id)).toEqual([3, 5, 1]);
  });
});

describe("걸린 날", () => {
  test("daysTaken", () => {
    expect(daysTaken({ received: "2026-10-01", done: "2026-10-13" })).toBe(12);
    expect(daysTaken({ received: "2026-10-13", done: "2026-10-01" })).toBeNull();
    expect(daysTaken({ received: "2026-10-01", done: "" })).toBeNull();
  });
  test.each([
    ["2026-10-01", "2026-10-13", 12, "12d"],
    ["2026-01-01", "2026-01-31", 30, "30d"],
    ["2026-01-15", "2026-03-14", 58, "1m"],
    ["2026-01-15", "2026-03-15", 59, "2m"],
    ["2025-01-15", "2027-02-01", 747, "2y"],
  ])("takenText %s~%s", (received, done, n, want) => expect(takenText({ received, done }, n)).toBe(want));
});

describe("검색", () => {
  const c = C({ body: '[{"t":"도로 파임"}]', action: "소파보수 지시", memo: '[{"t":"현장 확인"}]' });
  test.each([
    ["", true],
    ["포트홀", true],
    ["도로 파임", true],
    ["소파보수", true],
    ["현장 확인", true],
    ["ㅎㄱㄷ", true], // 민원인 초성
    ["01012345678", true], // 번호는 줄표 없이도
    ["1234-5678", true],
    ["5678", true],
    ["없는말", false],
    ["ㅂㅂㅂ", false],
  ])("%s → %s", (q, want) => expect(matches(c, q)).toBe(want));
});

test("expandType – 유형 초성", () => {
  const opts = ["포트홀", "소파보수", "제초", "준설", "가드레일"];
  expect(expandType("ㅍㅌㅎ", opts)).toBe("포트홀");
  expect(expandType("ㅅㅍ", opts)).toBe("소파보수"); // 앞 초성이 하나뿐이면
  expect(expandType("ㅈ", opts)).toBe("ㅈ"); // 제초·준설 둘 – 그대로
  expect(expandType("포트", opts)).toBe("포트");
});

test("짧은 모양", () => {
  expect(shortIntake("국민신문고")).toBe("국민…");
  expect(shortIntake("유선")).toBe("유선");
  expect(shortDate("2026-10-16")).toBe("26-10-16");
  expect(shortDate("")).toBe("");
});

describe("열 필터", () => {
  const list = [C({ id: 1, intake: "유선", status: "접수" }), C({ id: 2, intake: "국민신문고", status: "완료", area: "" })];
  test("passes – 모든 필터 AND, skip 열은 안 봄", () => {
    expect(list.filter((c) => passes(c, NO_FILTERS)).length).toBe(2);
    const f = { ...NO_FILTERS, intake: ["유선"], status: ["완료"] };
    expect(list.filter((c) => passes(c, f)).length).toBe(0);
    expect(list.filter((c) => passes(c, f, "status")).map((c) => c.id)).toEqual([1]);
    expect(list.filter((c) => passes(c, { ...NO_FILTERS, area: [] })).length).toBe(0);
  });
  test("filterValues – 빈 지역은 \"\"", () => expect(filterValues(list, "area")).toEqual(["조리읍", ""]));
  test("readStatusFilter", () => {
    expect(readStatusFilter('["접수","진행"]')).toEqual(["접수", "진행"]);
    expect(readStatusFilter("null")).toBeNull();
    expect(readStatusFilter("{")).toBeNull();
    expect(readStatusFilter('[1]')).toBeNull();
  });
});
