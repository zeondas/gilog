// 엑셀 가져오기 칸 맞추기 규칙 시험 – 버그 사냥 2차 고침(공통 ✔2·✔5·✔6·✔7, docs/qa/bughunt-excel.md E-n).
import { describe, expect, test } from "vitest";
import type { Entry } from "./api";
import { cellOfLines, entryContent, importDate, importNotes, journalImports, linesOfCell, linesOfContent, phoneCell } from "./excel";

const JH = ["연번", "날짜", "시각", "구분", "상대", "연락처", "사업", "내용"];
const jrow = (date: string, time: string, kind: string, who: string, content: string) => ["", date, time, kind, who, "", "", content];
const entry = (id: number, p: Partial<Entry>): Entry => ({ id, date: "2026-10-15", time: "09:00", kind: "유선수신", who: "김주무관", contact: "", project: null, lines: [], body: "", ...p }) as Entry;

describe("가져오기 날짜(✔6, E-13)", () => {
  test.each([
    ["2026. 10. 16.", "2026-10-16"],
    ["2026.10.16.", "2026-10-16"],
    ["2026년 10월 15일", "2026-10-15"],
    ["２０２６-１０-１７", "2026-10-17"],
    ["2026-10-15 09:30", "2026-10-15"],
    ["2026-10-15T09:30:00", "2026-10-15"],
    ["45945", "2025-10-15"],
    ["261015", "2026-10-15"],
    ["2026-10-15", "2026-10-15"],
  ])("%s → %s", (v, want) => expect(importDate(v)).toBe(want));
  test.each(["", "급함", "12345", "2026-13-01"])("%s → 못 읽음", (v) => expect(importDate(v)).toBeNull());
  test("민원대장 못 읽은 날짜 줄 수를 알려요", () => {
    const headers = ["연번", "접수유형", "접수일", "마감일", "조치완료일"];
    const sheet = { headers, rows: [["1", "전화", "2026. 10. 16.", "", ""], ["2", "전화", "급함", "", ""], ["3", "전화", "", "모름", ""]], hidden: 2 };
    expect(importNotes("complaints", sheet)).toEqual(["엑셀에서 숨긴 줄 2건도 넣어요", "날짜로 읽지 못한 줄 2건은 적힌 글자 그대로 넣어요"]);
    expect(importNotes("contacts", { headers, rows: [] })).toEqual([]);
  });
});

describe("전화번호 칸(✔5, E-15)", () => {
  test.each([
    ["1012345678", "010-1234-5678"],
    ["319401234", "031-940-1234"],
    ["010-12345678", "010-1234-5678"],
    ["1234", "1234"],
    ["010 1234 5678", "010 1234 5678"],
    ["", ""],
  ])("%s → %s", (v, want) => expect(phoneCell(v)).toBe(want));
});

describe("업무일지 짝짓기(✔2, E-3·E-4) · 말 없는 줄(✔3, E-5)", () => {
  test("한 기록은 한 번만 짝지어요 – 둘째 같은 열쇠 줄은 새 기록", () => {
    const sheet = { headers: JH, rows: [jrow("2026-10-15", "09:00", "유선수신", "김주무관", "김주무관: 가"), jrow("2026-10-15", "09:00", "회의", "김주무관", "김주무관: 나")] };
    const r = journalImports(sheet, [entry(7, {})], [], "");
    expect(r.same).toEqual([7, null]);
  });
  test("같은 열쇠 기존 기록이 둘이면 번호 순으로 하나씩", () => {
    const sheet = { headers: JH, rows: [jrow("2026-10-15", "09:00", "a", "김주무관", "김주무관: 가"), jrow("2026-10-15", "09:00", "b", "김주무관", "김주무관: 나")] };
    const r = journalImports(sheet, [entry(9, {}), entry(3, {})], [], "");
    expect(r.same).toEqual([3, 9]);
  });
  test("메모 글자가 같으면 건드리지 않아요(서식·표 지킴)", () => {
    const body = "<p><b>굵게</b> 중요</p><ul><li class=\"k-sq\">항목</li></ul><table><tr><td>가</td><td>나</td></tr></table>";
    const old = entry(5, { kind: "메모", who: "", time: "10:00", body });
    const content = entryContent(old);
    const same = journalImports({ headers: JH, rows: [jrow("2026-10-15", "10:00", "메모", "", content)] }, [old], [], "");
    expect(same.same).toEqual([5]);
    expect(same.keep).toEqual([true]);
    const changed = journalImports({ headers: JH, rows: [jrow("2026-10-15", "10:00", "메모", "", content + "\n추가")] }, [old], [], "");
    expect(changed.keep).toEqual([false]);
  });
  test("말이 하나도 없는 줄은 못 읽은 줄로 세요", () => {
    const r = journalImports({ headers: JH, rows: [jrow("2026-10-15", "09:00", "유선수신", "김주무관", "김주무관:"), jrow("2026-10-15", "09:10", "유선수신", "김주무관", "김주무관: 가")] }, [], [], "");
    expect(r.bad).toBe(1);
    expect(r.entries.length).toBe(1);
  });
  test("날짜 칸도 넓힌 읽기를 써요", () => {
    const r = journalImports({ headers: JH, rows: [jrow("2026. 10. 16.", "09:00", "유선수신", "김", "김: 가")] }, [], [], "");
    expect(r.entries[0].date).toBe("2026-10-16");
  });
});

describe("말 줄 왕복(✔7, E-21)", () => {
  test("숫자로 시작하면 말한 사람이 아니에요", () => {
    expect(linesOfContent("09:30 현장 도착", "", "")).toEqual([{ who: "", me: false, text: "09:30 현장 도착" }]);
  });
  test("한 말 안 빈 줄·들여쓰기를 지켜요", () => {
    const lines = [{ who: "김", me: false, text: "첫 줄\n\n  들여 쓴 줄" }, { who: "", me: true, text: "답" }];
    const back = linesOfContent(entryContent({ kind: "유선수신", lines, body: "" }), "김", "");
    expect(back).toEqual(lines);
  });
  test("이름 없는 상대 말은 다시 이름 없음", () => {
    const lines = [{ who: "", me: false, text: "문의" }, { who: "", me: true, text: "답" }];
    expect(linesOfContent(entryContent({ kind: "유선수신", lines, body: "" }), "", "")).toEqual(lines);
  });
});

describe("머릿기호 왕복(✔7, E-20) – 앱에서 만든 줄은 그대로 돌아와요", () => {
  test.each([
    [[{ t: "가" }, { t: "나", k: "sq" }, { t: "다", k: "da" }]],
    [[{ t: "가", k: "none", lv: 0 }, { t: "나", k: "sq" }, { t: "다", k: "da" }]],
    [[{ t: "가" }, { t: "나", k: "none", lv: 1 }, { t: "다", k: "da" }]],
    [[{ t: "가", k: "sq" }, { t: "나" }, { t: "다", k: "da" }, { t: "" }, { t: "라", k: "none", lv: 2 }]],
  ])("%j", (ls) => {
    const raw = JSON.stringify(ls);
    expect(JSON.parse(linesOfCell(cellOfLines(raw)))).toEqual(ls);
  });
});
