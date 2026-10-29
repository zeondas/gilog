// 업무일지 규칙 시험 – 지금 동작을 고정해요(정리 2차 2026-10-26). 보기 값은 CLAUDE.md "공통 입력 규칙 › 날짜 칸"·"사용자가 정한 규칙" 그대로.
import { describe, expect, test } from "vitest";
import { badgeName, dayLabel, dayTitle, initials, koIndex, normTime, parseDate, resolveDraft, speakers, splitJamo, splitWho, whoNames } from "./journal";

describe("parseDate – 날짜 칸", () => {
  test.each([
    ["261015", "2026-10-15"],
    ["26-10-15", "2026-10-15"],
    ["26.10.15", "2026-10-15"],
    ["26/10/15", "2026-10-15"],
    ["1015", "2026-10-15"],
    ["10/15", "2026-10-15"],
    ["10.15", "2026-10-15"],
    ["2026-10-15", "2026-10-15"],
    ["2026.10.15", "2026-10-15"],
    ["20261015", "2026-10-15"],
    ["261012", "2026-10-12"],
    ["1012", "2026-10-12"],
    ["26.10.12", "2026-10-12"],
  ])("%s → %s", (v, want) => expect(parseDate(v, 2026)).toBe(want));

  test("두 자리 연도는 2000년대", () => expect(parseDate("991231", 2026)).toBe("2099-12-31"));
  test("올해 기준은 인자로", () => expect(parseDate("0101", 2027)).toBe("2027-01-01"));
  test.each(["", "abc", "1332", "2026-02-30", "26-13-01", "201210x", "12345"])("읽을 수 없으면 null: %s", (v) => expect(parseDate(v, 2026)).toBeNull());
  test("앞뒤 띄어쓰기는 무시", () => expect(parseDate("  261015 ", 2026)).toBe("2026-10-15"));
});

describe("normTime – 시각", () => {
  test.each([
    ["940", "09:40"],
    ["0940", "09:40"],
    ["9:40", "09:40"],
    ["09:40", "09:40"],
    ["9.40", "09:40"],
    ["1400", "14:00"],
  ])("%s → %s", (v, want) => expect(normTime(v)).toBe(want));
  test.each(["2400", "960", "14", "abc", ""])("읽을 수 없으면 null: %s", (v) => expect(normTime(v)).toBeNull());
});

test("dayTitle·dayLabel", () => {
  expect(dayTitle("2026-10-15")).toBe("2026년 10월 15일 목요일");
  expect(dayLabel("2026-10-15")).toBe("15일(목)");
});

describe("koIndex – 초성 찾기", () => {
  test.each([
    ["박지훈", "ㅂㅈㅎ", 0],
    ["박지훈", "박ㅈ", 0],
    ["박지훈", "ㅂ지", 0],
    ["박지훈", "ㅈㅎ", 1],
    ["박지훈", "지훈", 1],
    ["박지훈", "ㄱ", -1],
    ["박지훈", "", 0],
    ["Kim 민수", "kim", 0],
  ])("%s / %s → %i", (text, q, want) => expect(koIndex(text, q)).toBe(want));
  test("겹자음은 풀어서 봐요(ㅄ → ㅂㅅ)", () => {
    expect(splitJamo("ㅄ")).toBe("ㅂㅅ");
    expect(koIndex("박수진", "ㅄ")).toBe(0);
  });
  test("initials", () => expect(initials("박지훈")).toBe("ㅂㅈㅎ"));
});

describe("badgeName – 말 배지 글자", () => {
  test.each([
    ["김민", "김민"],
    ["박지훈", "박지훈"],
    ["남궁민수", "남궁민"],
    ["", ""],
  ])("%s → %s", (v, want) => expect(badgeName(v)).toBe(want));
});

describe("상대 칸", () => {
  test("splitWho – 한 사람 이름·나머지", () => {
    expect(splitWho("박○○ 책임기술인 · (주)○○엔지니어링")).toEqual({ name: "박○○", rest: "책임기술인 · (주)○○엔지니어링" });
    expect(splitWho("김 / 이")).toEqual({ name: "김 / 이", rest: "" });
    expect(splitWho("팀장")).toEqual({ name: "팀장", rest: "" });
  });
  test("whoNames – 여러 명은 / 로, 예전 쉼표는 뗌", () => {
    expect(whoNames("김○○ 주무관 · 경기도청 / 팀장")).toEqual(["김○○", "팀장"]);
    expect(whoNames("팀장, 서무")).toEqual(["팀장"]);
  });
  test("speakers – 발신은 내가 먼저, 출장·메모 혼자", () => {
    expect(speakers("김 / 이", "유선 수신", "나")).toEqual({ list: [{ who: "김", me: false }, { who: "이", me: false }, { who: "나", me: true }], first: 0 });
    expect(speakers("김", "유선 발신", "나").first).toBe(1);
    expect(speakers("", "메모", "나")).toEqual({ list: [{ who: "나", me: true }], first: 0 });
    expect(speakers("", "유선 수신", "나").list[0]).toEqual({ who: "상대", me: false });
  });
  test("resolveDraft – 자동 줄은 사람을 번갈아", () => {
    expect(resolveDraft([{ sp: null, t: "" }, { sp: null, t: "" }, { sp: null, t: "" }], 2, 0)).toEqual([0, 1, 0]);
    expect(resolveDraft([{ sp: null, t: "" }, { sp: 0, t: "" }, { sp: null, t: "" }], 3, 2)).toEqual([2, 0, 1]);
  });
});
