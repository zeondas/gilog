// 구글 양방향 맞추기 흐름(대기 캘린더 ✔1·✔2) – 가짜 구글 서버 + 메모리 기록으로 처음부터 끝까지.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CalEvent, CalKind, EventInput } from "./api";

// ---------- 메모리 기록 ----------
const db = vi.hoisted(() => ({
  kv: new Map<string, string>(),
  events: [] as CalEvent[],
  next: 1,
}));

vi.mock("./api", () => {
  const kinds: CalKind[] = [
    { id: 1, name: "업무", color: 15, visible: true, system: "", ord: 0 },
    { id: 2, name: "회의", color: 9, visible: true, system: "", ord: 1 },
    { id: 9, name: "민원", color: null, visible: true, system: "complaint", ord: 9 },
  ];
  const hooks = new Set<(cmd: string) => void>();
  const fire = (c: string) => hooks.forEach((f) => f(c));
  const toEv = (id: number, i: EventInput): CalEvent => ({ ...i, id, kind: kinds.find((k) => k.name === i.kind)?.id ?? 1, end: i.end || "", until: i.repeat ? i.until : "" });
  return {
    inApp: false,
    changeHooks: hooks,
    api: {
      get: async (k: string) => db.kv.get(k) ?? "",
      set: async (k: string, v: string) => void db.kv.set(k, v),
      calendarData: async () => ({ kinds, events: db.events.map((e) => ({ ...e })), holidays: [], holidaysAt: "" }),
      addEvent: async (i: EventInput) => {
        const e = toEv(db.next++, i);
        db.events.push(e);
        fire("add_event");
        return { ...e };
      },
      updateEvent: async (id: number, i: EventInput) => {
        const e = toEv(id, i);
        db.events = db.events.map((x) => (x.id === id ? e : x));
        fire("update_event");
        return { ...e };
      },
      deleteEvent: async (id: number) => {
        db.events = db.events.filter((x) => x.id !== id);
        fire("delete_event");
        return null;
      },
      complaints: async () => [],
      tasksData: async () => ({ tasks: [], lists: [] }),
    },
  };
});

import { __test, loadGoogleStatus, onGoogleStatus, GStatus, resolveGone } from "./google";

// ---------- 가짜 구글 ----------
type REv = Record<string, unknown> & { id: string; status: string; updated: string; seq: number };
const g = { cal: "cal1", events: new Map<string, REv>(), seq: 0, n: 0, calls: [] as string[], refreshFails: false };
let now = Date.parse("2026-11-04T07:00:00Z");
const tick = (ms = 60_000) => {
  now += ms;
  vi.setSystemTime(now);
};

function reply(status: number, body: unknown) {
  return { status, text: async () => (body === undefined ? "" : JSON.stringify(body)) };
}

async function fakeFetch(url: string, init: { method?: string; body?: string }) {
  const m = init.method ?? "GET";
  const u = new URL(url);
  g.calls.push(`${m} ${u.pathname}`);
  if (u.hostname === "oauth2.googleapis.com") return g.refreshFails ? reply(400, { error: "invalid_grant" }) : reply(200, { access_token: "a2", expires_in: 3600 });
  const path = u.pathname.replace("/calendar/v3", "");
  const ev = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
  if (!ev) return reply(200, { id: g.cal });
  const id = ev[2] ? decodeURIComponent(ev[2]) : "";
  const stamp = () => {
    g.seq++;
    return { seq: g.seq, updated: new Date(now).toISOString() };
  };
  if (m === "GET") {
    const token = u.searchParams.get("syncToken");
    const showDeleted = u.searchParams.get("showDeleted") === "true" || !!token;
    const items = [...g.events.values()].filter((e) => (token ? e.seq > Number(token) : true) && (showDeleted || e.status !== "cancelled"));
    return reply(200, { items: items.map(({ seq: _s, ...x }) => x), nextSyncToken: String(g.seq) });
  }
  if (m === "POST") {
    const e = { ...JSON.parse(init.body!), id: "g" + ++g.n, status: "confirmed", ...stamp() };
    g.events.set(e.id, e);
    return reply(200, e);
  }
  if (m === "PUT") {
    if (!g.events.has(id)) return reply(404, {});
    const e = { ...JSON.parse(init.body!), id, status: "confirmed", ...stamp() };
    g.events.set(id, e);
    return reply(200, e);
  }
  if (m === "DELETE") {
    const e = g.events.get(id);
    if (e) g.events.set(id, { ...e, status: "cancelled", ...stamp() });
    return reply(204, undefined);
  }
  return reply(400, {});
}

/** 구글 화면에서 고치기(시간대가 붙어 와요) */
function googleEdit(id: string, patch: Record<string, unknown>) {
  g.seq++;
  g.events.set(id, { ...g.events.get(id)!, ...patch, seq: g.seq, updated: new Date(now).toISOString() });
}
function googleCreate(body: Record<string, unknown>) {
  g.seq++;
  const id = "g" + ++g.n;
  g.events.set(id, { ...body, id, status: "confirmed", seq: g.seq, updated: new Date(now).toISOString() });
  return id;
}
const remoteOf = (title: string) => [...g.events.values()].find((e) => e.summary === title && e.status !== "cancelled");
const local = (title: string) => db.events.find((e) => e.title === title);

const sync = async () => {
  tick(5_000);
  await __test.runSync(false);
};
let st: GStatus;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  db.kv.clear();
  db.events = [];
  db.next = 1;
  Object.assign(g, { events: new Map(), seq: 0, n: 0, calls: [], refreshFails: false });
  vi.stubGlobal("fetch", (url: string, init: { method?: string; body?: string }) => fakeFetch(url, init));
  db.kv.set("google.client", JSON.stringify({ id: "x.apps.googleusercontent.com", secret: "s" }));
  db.kv.set("google.token", JSON.stringify({ refresh: "r", access: "a", exp: now + 3600_000, scope: "https://www.googleapis.com/auth/calendar.app.created", at: now }));
  db.kv.set("google.state", JSON.stringify({ calendarId: g.cal, items: {}, listId: "", titems: {}, lastOk: "", lastError: "", full: false }));
  db.kv.set("google.opts", JSON.stringify({ events: true, complaints: true, tasks: true, gtasks: false, twoWay: true }));
  onGoogleStatus((s) => (st = s));
  await loadGoogleStatus();
  // 기록에 내 일정 하나 → 구글로 보내요
  db.events.push({ id: db.next++, title: "현장 점검", kind: 1, date: "2026-11-05", end: "", allDay: false, time: "09:30", endTime: "11:00", repeat: "", until: "", place: "", desc: "", remind: 10, remindTime: "" });
  await sync();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("양방향 맞추기", () => {
  test("처음 보내고, 다시 맞춰도 아무것도 다시 보내지 않아요(메아리 없음)", async () => {
    expect(remoteOf("현장 점검")).toBeTruthy();
    g.calls = [];
    await sync();
    await sync();
    expect(g.calls.filter((c) => !c.startsWith("GET"))).toEqual([]);
    expect(st.lastError).toBe("");
  });

  test("구글에서 제목·시각을 고치면 기록에 들어오고, 되돌려 보내지 않아요", async () => {
    const r = remoteOf("현장 점검")!;
    tick();
    googleEdit(r.id, { summary: "현장 점검(변경)", start: { dateTime: "2026-11-05T10:00:00+09:00" }, end: { dateTime: "2026-11-05T12:00:00+09:00" } });
    g.calls = [];
    await sync();
    const e = local("현장 점검(변경)")!;
    expect([e.time, e.endTime, e.kind]).toEqual(["10:00", "12:00", 1]);
    expect(g.calls.filter((c) => c.startsWith("PUT") || c.startsWith("POST"))).toEqual([]);
    g.calls = [];
    await sync();
    expect(g.calls.filter((c) => !c.startsWith("GET"))).toEqual([]);
  });

  test("구글에서 새로 만든 일정은 기록에 한 번만 들어와요 · 담을 수 없는 반복은 구글에만", async () => {
    tick();
    googleCreate({ summary: "출장", start: { date: "2026-11-10" }, end: { date: "2026-11-12" } });
    googleCreate({ summary: "주간회의", start: { dateTime: "2026-11-09T10:00:00+09:00" }, end: { dateTime: "2026-11-09T11:00:00+09:00" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] });
    await sync();
    await sync();
    expect(db.events.filter((e) => e.title === "출장")).toHaveLength(1);
    expect(local("출장")!.end).toBe("2026-11-11");
    expect(local("주간회의")).toBeUndefined();
    expect(st.foreign).toBe(1);
    expect([...g.events.values()].filter((e) => e.summary === "출장" && e.status !== "cancelled")).toHaveLength(1);
    // 지금 맞추기(전체)도 구글에만 있는 일정을 지우지 않아요
    await __test.runSync(true);
    expect(remoteOf("주간회의")).toBeTruthy();
  });

  test("구글에서 지우면 기록엔 남기고 묻기 → 되살리기 / 지우기", async () => {
    const r = remoteOf("현장 점검")!;
    tick();
    googleEdit(r.id, { status: "cancelled" });
    await sync();
    await sync();
    expect(local("현장 점검")).toBeTruthy();
    expect(st.gone).toBe(1);
    expect(remoteOf("현장 점검")).toBeUndefined(); // 다시 만들지 않았어요
    await resolveGone(false);
    await sync();
    expect(st.gone).toBe(0);
    expect(remoteOf("현장 점검")).toBeTruthy(); // 되살렸어요
    tick();
    googleEdit(remoteOf("현장 점검")!.id, { status: "cancelled" });
    await sync();
    await resolveGone(true);
    await sync();
    expect(local("현장 점검")).toBeUndefined();
    expect(st.gone).toBe(0);
  });

  test("양쪽에서 고치면 나중 쪽 – 기록이 나중이면 기록, 구글이 나중이면 구글 + 알림", async () => {
    const r = remoteOf("현장 점검")!;
    // 구글 먼저 고치고 → 기록 나중에
    tick();
    googleEdit(r.id, { summary: "구글 제목" });
    tick();
    const e = local("현장 점검")!;
    await (await import("./api")).api.updateEvent(e.id, { ...e, kind: "업무", title: "기록 제목" });
    await __test.trackLocal(); // 앱은 일정 명령 1초 뒤 고친 시각을 적어요(onDataChange)
    await sync();
    expect(local("기록 제목")).toBeTruthy();
    expect(remoteOf("기록 제목")).toBeTruthy();
    expect(st.notes.at(-1)).toContain("기록 쪽");
    // 기록 먼저 → 구글 나중에
    const e2 = local("기록 제목")!;
    await (await import("./api")).api.updateEvent(e2.id, { ...e2, kind: "업무", title: "기록 둘째" });
    await __test.trackLocal();
    tick();
    googleEdit(remoteOf("기록 제목")!.id, { summary: "구글 둘째" });
    await sync();
    expect(local("구글 둘째")).toBeTruthy();
    expect(st.notes.at(-1)).toContain("구글 쪽");
  });

  test("로그인이 풀리면(7일) 상자에 '풀렸어요' 상태로 – 풀린 동안 기록에서 고친 것은 남아요", async () => {
    g.refreshFails = true;
    const tok = JSON.parse(db.kv.get("google.token")!);
    db.kv.set("google.token", JSON.stringify({ ...tok, exp: 0 }));
    await sync();
    expect(st.connected).toBe(false);
    expect(st.lapsed).toBe(true);
    expect(st.lastError).toContain("다시 로그인");
  });
});
