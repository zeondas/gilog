// 캘린더 규칙 시험 – 지금 동작을 고정해요(정리 2차 2026-10-26): 시각 칸·반복 펼치기 expand·주 배치 layoutWeek·알림 reminders.
import { describe, expect, test } from "vitest";
import type { CalEvent, CalKind, Complaint, Task } from "./api";
import { addDays, expand, hourLater, layoutWeek, monthGrid, parseTime, remindText, reminders, shortDay, splitRemind, startsOn } from "./calendar";

const K = (o: Partial<CalKind>): CalKind => ({ id: 1, name: "업무", color: null, visible: true, system: "", ord: 0, ...o });
const KINDS = [K({ id: 1 }), K({ id: 2, name: "민원", system: "complaint", color: 1 }), K({ id: 3, name: "할 일", system: "task", color: 12 }), K({ id: 4, name: "공휴일", system: "holiday", color: 3 })];
const E = (o: Partial<CalEvent>): CalEvent => ({
  id: 1, kind: 1, title: "일정", date: "2026-10-21", end: "2026-10-21", allDay: false, time: "14:00", endTime: "15:00",
  repeat: "", until: "", place: "", desc: "", remind: -1, remindTime: "", ...o,
});
const SRC = (events: CalEvent[], extra: Partial<{ complaints: Complaint[]; tasks: Task[] }> = {}) => ({ kinds: KINDS, events, holidays: [], complaints: [], tasks: [], ...extra });

describe("시각 칸 parseTime", () => {
  test.each([
    ["14", "14:00"],
    ["9", "09:00"],
    ["930", "09:30"],
    ["1400", "14:00"],
    ["9:30", "09:30"],
  ])("%s → %s", (v, want) => expect(parseTime(v)).toBe(want));
  test.each(["24", "2460", "abc"])("못 읽으면 null: %s", (v) => expect(parseTime(v)).toBeNull());
  test("hourLater는 23:59를 넘지 않아요", () => {
    expect(hourLater("14:30")).toBe("15:30");
    expect(hourLater("23:30")).toBe("23:59");
  });
});

test("날짜", () => {
  expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  expect(shortDay("2026-10-16")).toBe("10/16(금)");
  expect(monthGrid(2026, 9)).toEqual({ start: "2026-09-27", weeks: 5 });
  expect(monthGrid(2026, 7)).toEqual({ start: "2026-07-26", weeks: 6 });
  expect(monthGrid(2026, 1)).toEqual({ start: "2026-02-01", weeks: 4 });
});

test("알림 글자", () => {
  expect(remindText(10)).toMatchInlineSnapshot(`"10분 전"`);
  expect(remindText(1440)).toMatchInlineSnapshot(`"1일 전"`);
  expect(remindText(43200)).toMatchInlineSnapshot(`"한 달 전"`);
  expect(splitRemind(2880)).toEqual([2, 1440]);
});

describe("반복 startsOn·expand", () => {
  test.each([
    ["weekly", "2026-10-28", true],
    ["weekly", "2026-10-27", false],
    ["biweekly", "2026-11-04", true],
    ["biweekly", "2026-10-28", false],
    ["weekdays", "2026-10-24", false], // 토요일
    ["weekdays", "2026-10-26", true],
    ["monthly", "2026-11-21", true],
        ["daily", "2026-10-20", false], // 시작 전
    ["daily", "2026-12-01", false], // 종료일 뒤
  ])("%s %s → %s", (repeat, key, want) => expect(startsOn({ date: "2026-10-21", repeat: repeat as CalEvent["repeat"], until: "2026-11-30" }, key)).toBe(want));

  test("매년 반복", () => {
    const e = { date: "2026-10-21", repeat: "yearly" as const, until: "2028-12-31" };
    expect([startsOn(e, "2027-10-21"), startsOn(e, "2027-11-21"), startsOn(e, "2029-10-21")]).toEqual([true, false, false]);
  });
  test("매주 반복은 종료일까지 회차마다 한 줄", () => {
    const occ = expand(SRC([E({ repeat: "weekly", until: "2026-11-11" })]), "2026-10-01", "2026-11-30");
    expect(occ.map((o) => o.key)).toEqual(["e1@2026-10-21", "e1@2026-10-28", "e1@2026-11-04", "e1@2026-11-11"]);
    expect(occ.every((o) => o.repeat)).toBe(true);
  });
  test("여러 날 일정은 앞에서 걸치는 회차도 잡아요", () => {
    const occ = expand(SRC([E({ end: "2026-10-23", allDay: true, repeat: "weekly", until: "2026-11-30" })]), "2026-10-29", "2026-10-29");
    expect(occ.map((o) => [o.start, o.end])).toEqual([["2026-10-28", "2026-10-30"]]);
  });
  test("민원·할 일 마감은 종일, 답변 끝난 민원은 흐리게(done)", () => {
    const c = { id: 5, no: 5, intake: "유선", received: "", ctype: "", area: "조리읍", place: "봉일천리", person: "", phone: "", body: "", action: "", due: "2026-10-22", status: "진행", memo: "" } as Complaint;
    const t = { id: 3, list: 1, parent: null, title: "보고", detail: "", due: "2026-10-23", done: false, doneOn: "" } as Task;
    const occ = expand(SRC([], { complaints: [c], tasks: [t] }), "2026-10-01", "2026-10-31");
    expect(occ.map((o) => [o.key, o.title, o.allDay, o.done, o.color])).toEqual([
      ["c5", "유선(조리읍 봉일천리)", true, true, 1],
      ["t3", "보고", true, false, 12],
    ]);
  });
});

describe("layoutWeek – 주 한 줄 배치", () => {
  const occ = expand(
    SRC([
      E({ id: 1, title: "출장", date: "2026-10-17", end: "2026-10-20", allDay: true }), // 앞 주에서 이어짐
      E({ id: 2, title: "회의", date: "2026-10-19", end: "2026-10-19", time: "10:00" }),
      E({ id: 3, title: "점검", date: "2026-10-19", end: "2026-10-19", time: "14:00" }),
      E({ id: 4, title: "교육", date: "2026-10-19", end: "2026-10-19", time: "16:00" }),
      E({ id: 5, title: "주말 행사", date: "2026-10-24", end: "2026-10-26", allDay: true }), // 다음 주로 이어짐
    ]),
    "2026-10-18",
    "2026-10-24",
  );
  test("넉넉하면 다 놓아요", () => {
    const { placed, more } = layoutWeek(occ, "2026-10-18", 6);
    expect(placed.map((p) => [p.occ.title, p.col, p.span, p.lane, p.cutStart, p.cutEnd])).toEqual([
      ["출장", 0, 3, 0, true, false],
      ["주말 행사", 6, 1, 0, false, true],
      ["회의", 1, 1, 1, false, false],
      ["점검", 1, 1, 2, false, false],
      ["교육", 1, 1, 3, false, false],
    ]);
    expect(more).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
  test("넘치면 마지막 줄을 +N개 자리로", () => {
    const { placed, more } = layoutWeek(occ, "2026-10-18", 3);
    expect(placed.map((p) => p.occ.title)).toEqual(["출장", "주말 행사", "회의"]);
    expect(more).toEqual([0, 2, 0, 0, 0, 0, 0]);
  });
});

describe("알림 reminders", () => {
  const now = new Date(2026, 9, 21, 10, 0, 0);
  const rel = (list: { at: number }[]) => list.map((r) => (r.at - now.getTime()) / 60_000);
  test("시간 일정 10분 전 · 종일 일정은 9시 기준 · 지난 것과 10분 넘게 늦은 것은 뺌", () => {
    const list = reminders(
      [
        E({ id: 1, title: "회의", time: "14:00", remind: 10 }),
        E({ id: 2, title: "현장", date: "2026-10-23", end: "2026-10-23", allDay: true, time: "", endTime: "", remind: 1440 }),
        E({ id: 3, title: "아침", time: "09:00", remind: 0 }), // 60분 늦음 – 뺌(10분까지 늦은 것만 울려요)
        E({ id: 4, title: "방금", time: "10:05", remind: 10 }), // 5분 늦음 – 울림
        E({ id: 5, title: "없음", remind: -1 }),
        E({ id: 6, title: "시각 지정", date: "2026-10-23", end: "2026-10-23", allDay: true, time: "", endTime: "", remind: 0, remindTime: "08:30", place: "조리읍" }),
      ],
      KINDS,
      now,
      7,
    );
    expect(list.map((r) => r.title)).toEqual(["방금", "회의", "현장", "시각 지정"]);
    expect(rel(list)).toEqual([-5, 230, 1380, 2790]);
    expect(list.map((r) => r.body)).toMatchInlineSnapshot(`
      [
        "10분 뒤 · 10월 21일(수) 10:05–15:00",
        "10분 뒤 · 10월 21일(수) 14:00–15:00",
        "내일 · 10월 23일(금) 종일",
        "지금 · 10월 23일(금) 종일 · 조리읍",
      ]
    `);
  });
  test("한 달 전 알림도 앞까지 펼쳐 잡아요", () => {
    const list = reminders([E({ id: 7, title: "결산", date: "2026-11-21", end: "2026-11-21", allDay: true, time: "", endTime: "", remind: 43200 })], KINDS, now, 7);
    expect(list.map((r) => [r.title, r.date])).toEqual([["결산", "2026-11-21"]]);
  });
});
