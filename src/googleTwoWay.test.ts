// 구글 양방향(대기 캘린더 ✔2): 구글 일정 → 기록 일정 바꾸기, 보낸 것을 받았을 때 그대로인지, 로그인 7일(✔1).
import { describe, expect, test } from "vitest";
import type { CalEvent, CalKind } from "./api";
import { eventBody, loginPhase, LOGIN_DAYS } from "./google";
import { diffText, GEvent, inputOf, kst, norm, remoteIsLater, remoteToInput, repeatOf, sameInput, untilDate } from "./googleTwoWay";

const kinds: CalKind[] = [
  { id: 1, name: "업무", color: 15, visible: true, system: "", ord: 0 },
  { id: 2, name: "회의", color: 9, visible: true, system: "", ord: 1 },
  { id: 9, name: "민원", color: null, visible: true, system: "complaint", ord: 9 },
];

const ev = (o: Partial<CalEvent>): CalEvent => ({
  id: 7,
  title: "현장 점검",
  kind: 1,
  date: "2026-11-05",
  end: "",
  allDay: false,
  time: "09:30",
  endTime: "11:00",
  repeat: "",
  until: "",
  place: "",
  desc: "",
  remind: 10,
  remindTime: "",
  ...o,
});

/** 구글이 돌려줄 때 모양: 시간대 없는 시각에 +09:00을 붙여요(우리 표시·색은 그대로 와요). */
function asGoogle(b: GEvent): GEvent {
  const fix = (x?: GEvent["start"]) => (x?.dateTime ? { dateTime: x.dateTime + "+09:00", timeZone: x.timeZone } : x);
  return { ...b, id: "g1", updated: "2026-11-04T07:00:00.000Z", start: fix(b.start), end: fix(b.end) };
}

describe("시각·반복 끝 바꾸기", () => {
  test("kst – 시간대가 있으면 한국 시각으로, 없으면 그대로", () => {
    expect(kst("2026-11-05T00:30:00Z")).toEqual({ date: "2026-11-05", time: "09:30" });
    expect(kst("2026-11-04T16:00:00Z")).toEqual({ date: "2026-11-05", time: "01:00" });
    expect(kst("2026-11-05T09:30:00+09:00")).toEqual({ date: "2026-11-05", time: "09:30" });
    expect(kst("2026-11-05T09:30:00")).toEqual({ date: "2026-11-05", time: "09:30" });
  });
  test("untilDate – 날짜만 · UTC 시각(23:59:59 한국 = 14:59:59Z)", () => {
    expect(untilDate("20261231")).toBe("2026-12-31");
    expect(untilDate("20261231T145959Z")).toBe("2026-12-31");
    expect(untilDate("")).toBe("");
  });
});

describe("repeatOf – 기록이 담을 수 있는 반복만", () => {
  const d = "2026-11-05"; // 목요일
  test("기록 반복 여섯 가지", () => {
    expect(repeatOf(undefined, d)).toEqual({ repeat: "", until: "" });
    expect(repeatOf(["RRULE:FREQ=DAILY;UNTIL=20261130"], d)).toEqual({ repeat: "daily", until: "2026-11-30" });
    expect(repeatOf(["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261130T145959Z"], d)?.repeat).toBe("weekdays");
    expect(repeatOf(["RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231"], d)?.repeat).toBe("weekly");
    expect(repeatOf(["RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261231"], d)?.repeat).toBe("weekly");
    expect(repeatOf(["RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231"], d)?.repeat).toBe("biweekly");
    expect(repeatOf(["RRULE:FREQ=MONTHLY;BYMONTHDAY=5;UNTIL=20271231"], d)?.repeat).toBe("monthly");
    expect(repeatOf(["RRULE:FREQ=YEARLY;UNTIL=20301231"], d)?.repeat).toBe("yearly");
  });
  test("담을 수 없으면 null – 끝나는 날 없음·횟수·여러 요일·N번째 요일·한 번 빼기", () => {
    expect(repeatOf(["RRULE:FREQ=WEEKLY;BYDAY=TH"], d)).toBeNull();
    expect(repeatOf(["RRULE:FREQ=DAILY;COUNT=5"], d)).toBeNull();
    expect(repeatOf(["RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231"], d)).toBeNull();
    expect(repeatOf(["RRULE:FREQ=MONTHLY;BYDAY=1TH;UNTIL=20271231"], d)).toBeNull();
    expect(repeatOf(["RRULE:FREQ=WEEKLY;INTERVAL=3;UNTIL=20261231"], d)).toBeNull();
    expect(repeatOf(["EXDATE:20261112", "RRULE:FREQ=WEEKLY;UNTIL=20261231"], d)).toBeNull();
  });
});

describe("보낸 일정을 그대로 받으면 바뀌는 게 없어요(메아리)", () => {
  const cases: Partial<CalEvent>[] = [
    {},
    { allDay: true, time: "", endTime: "", remind: 0, remindTime: "" }, // 종일 정시(그날 9시) – 구글엔 0분 전
    { allDay: true, time: "", endTime: "", date: "2026-11-05", end: "2026-11-07", remind: 1440, remindTime: "08:00" },
    { repeat: "weekly", until: "2026-12-31", remind: -1 },
    { repeat: "weekdays", until: "2026-12-31", allDay: true, time: "", endTime: "", remind: -1 },
    { desc: JSON.stringify([{ t: "도로 파손", k: "sq" }, { t: "사진 찍기" }, { t: "보고", k: "da" }]), place: "문산읍 선유리 100" },
    { end: "2026-11-06", time: "22:00", endTime: "01:00" },
  ];
  test.each(cases.map((c, i) => [i, c] as const))("경우 %i", (_i, c) => {
    const e = ev(c);
    const g = asGoogle(eventBody(e, kinds) as GEvent);
    expect(norm(g)).toBe(norm(eventBody(e, kinds) as GEvent));
    const back = remoteToInput(g, e, kinds, "");
    expect(back).not.toBeNull();
    expect(sameInput(back!, inputOf(e, kinds))).toBe(true);
  });
});

describe("구글에서 고친 것·새로 만든 것", () => {
  test("제목·시각을 고치면 기록에 들어가고 종류는 그대로", () => {
    const e = ev({ kind: 2 });
    const g = { ...asGoogle(eventBody(e, kinds) as GEvent), summary: "현장 점검(변경)", start: { dateTime: "2026-11-05T10:00:00+09:00" }, end: { dateTime: "2026-11-05T12:00:00+09:00" } };
    const i = remoteToInput(g, e, kinds, "")!;
    expect([i.title, i.kind, i.time, i.endTime]).toEqual(["현장 점검(변경)", "회의", "10:00", "12:00"]);
  });
  test("구글에서 알림을 30분 전으로 바꾸면 30, 알림을 없애면 -1", () => {
    const e = ev({});
    const b = asGoogle(eventBody(e, kinds) as GEvent);
    expect(remoteToInput({ ...b, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] } }, e, kinds, "")!.remind).toBe(30);
    expect(remoteToInput({ ...b, reminders: { useDefault: false } }, e, kinds, "")!.remind).toBe(-1);
    // 구글 기본 알림이면 기록 값 그대로
    expect(remoteToInput({ ...b, reminders: { useDefault: true } }, e, kinds, "")!.remind).toBe(10);
  });
  test("새 일정: 종일 사흘 · 시간 일정(UTC로 와도 한국 시각) · 제목 없으면 '제목 없음'", () => {
    const a = remoteToInput({ summary: "출장", start: { date: "2026-11-10" }, end: { date: "2026-11-13" } }, null, kinds, "업무")!;
    expect([a.allDay, a.date, a.end, a.kind, a.remind]).toEqual([true, "2026-11-10", "2026-11-12", "업무", -1]);
    const b = remoteToInput({ start: { dateTime: "2026-11-10T01:00:00Z" }, end: { dateTime: "2026-11-10T02:30:00Z" }, description: "□ 자료\n- 챙기기" }, null, kinds, "업무")!;
    expect([b.title, b.time, b.endTime]).toEqual(["제목 없음", "10:00", "11:30"]);
    expect(JSON.parse(b.desc)).toEqual([{ t: "자료", k: "sq" }, { t: "챙기기", k: "da" }]);
  });
  test("기록이 담을 수 없는 반복이면 null(구글에만 둬요)", () => {
    expect(remoteToInput({ summary: "주간회의", start: { dateTime: "2026-11-09T10:00:00+09:00" }, end: { dateTime: "2026-11-09T11:00:00+09:00" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] }, null, kinds, "업무")).toBeNull();
  });
  test("양쪽에서 고치면 나중 쪽 – 기록 고친 시각을 모르면 구글", () => {
    expect(remoteIsLater("2026-11-04T07:00:00.000Z", "2026-11-04T06:59:00.000Z")).toBe(true);
    expect(remoteIsLater("2026-11-04T07:00:00.000Z", "2026-11-04T07:00:01.000Z")).toBe(false);
    expect(remoteIsLater("2026-11-04T07:00:00.000Z", "")).toBe(true);
  });
});

describe("loginPhase – 테스트 상태 구글 로그인 7일(✔1)", () => {
  const day = 24 * 3600_000;
  const at = Date.parse("2026-11-01T09:00:00+09:00");
  test("6일째부터 '내일 풀려요', 7일이 지나도 붙어 있으면 평소(테스트 상태가 아니에요)", () => {
    expect(loginPhase({ connected: true, lapsed: false, loginAt: at }, at + 5 * day)).toBe("ok");
    expect(loginPhase({ connected: true, lapsed: false, loginAt: at }, at + (LOGIN_DAYS - 1) * day)).toBe("soon");
    expect(loginPhase({ connected: true, lapsed: false, loginAt: at }, at + LOGIN_DAYS * day + 1)).toBe("ok");
    expect(loginPhase({ connected: true, lapsed: false, loginAt: 0 }, at)).toBe("ok");
  });
  test("풀렸으면 'off', 연결을 끊었으면 상자 없음(ok)", () => {
    expect(loginPhase({ connected: false, lapsed: true, loginAt: at })).toBe("off");
    expect(loginPhase({ connected: false, lapsed: false, loginAt: 0 })).toBe("ok");
  });
});

describe("diffText – 확인할 것 창의 바뀐 것 줄(✔3)", () => {
  const base = { title: "주간 회의", kind: "회의", date: "2026-10-21", end: "", allDay: false, time: "10:00", endTime: "11:00", repeat: "" as const, until: "", place: "", desc: "", remind: -1, remindTime: "" };
  test("시각과 제목", () => {
    expect(diffText(base, { ...base, time: "10:30", endTime: "11:30" })).toBe("10/21 10:00–11:00 → 10/21 10:30–11:30");
    expect(diffText(base, { ...base, title: "주간 회의(변경)", place: "3층" })).toBe("제목 주간 회의 → 주간 회의(변경) · 장소 없음 → 3층");
    expect(diffText(base, base)).toBe("");
  });
});
