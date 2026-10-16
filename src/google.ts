// 구글 캘린더 연동(9단계, 사양서 "구글 캘린더 연동").
// - 기Log → 구글 한 방향이에요. 구글에서 고친 것은 다음 내보내기 때 기Log 내용으로 덮어써요.
// - 사용자 구글 계정에 "giLog" 캘린더를 하나 만들어 그 안에만 써요(권한 calendar.app.created — 다른 캘린더는 볼 수도 없어요).
// - 내보내는 것 세 가지(내 일정·민원 마감·할 일 마감)는 설정에서 각각 켜고 꺼요. 끄면 구글에서 지워요.
// - 민원인 이름·연락처·내용·조치내용·메모는 어떤 경우에도 내보내지 않아요(민원 마감은 접수유형·위치까지).
// - 바꿀 때마다 바로 보내고, 실패하면 모아 두었다가(다음 맞추기 때 차이를 다시 계산해요) 10분마다 다시 해요.
//
// 저장(모두 암호화 파일 kv):
//   google.client — 사용자가 고른 앱 정보 파일의 client_id·client_secret (저장소에는 넣지 않아요)
//   google.token  — 로그인 정보(refresh token)
//   google.state  — giLog 캘린더 id, 내보낸 일정 목록(우리 이름 → 구글 id·내용 지문), 마지막 성공·실패
//   google.opts   — 세 가지 켜고 끄기
import { invoke } from "@tauri-apps/api/core";
import { api, CalEvent, CalKind, changeHooks, Complaint, inApp, Repeat, Task } from "./api";
import { linesToText, parseLines } from "./bullets";
import { addDays, kindColor } from "./calendar";
import { DONE_STATUS } from "./settingsStore";
import { complaintTitle } from "./tasks";
import { stamp } from "./reminders";

const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const TZ = "Asia/Seoul";
const CAL_NAME = "giLog";

const K_CLIENT = "google.client";
const K_TOKEN = "google.token";
const K_STATE = "google.state";
const K_OPTS = "google.opts";

export type GClient = { id: string; secret: string };
type GToken = { refresh: string; access: string; exp: number };
type GItem = { id: string; h: string };
export type GState = {
  calendarId: string;
  items: Record<string, GItem>;
  /** 마지막으로 다 맞춘 때 "2026-10-16 09:12" */
  lastOk: string;
  /** 마지막 실패 이유 (성공하면 비워요) */
  lastError: string;
  /** 다음 맞추기는 전체를 다시 맞춰요(처음 연결·지금 내보내기) */
  full: boolean;
};
export type GOpts = { events: boolean; complaints: boolean; tasks: boolean };

export const DEFAULT_OPTS: GOpts = { events: true, complaints: true, tasks: true };
const EMPTY_STATE: GState = { calendarId: "", items: {}, lastOk: "", lastError: "", full: true };

// ---------- 저장 ----------

async function getJson<T>(key: string): Promise<T | null> {
  try {
    const v = await api.get(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
const putJson = (key: string, v: unknown) => api.set(key, v === null ? "" : JSON.stringify(v));

export const loadOpts = async (): Promise<GOpts> => ({ ...DEFAULT_OPTS, ...((await getJson<GOpts>(K_OPTS)) ?? {}) });
const loadState = async (): Promise<GState> => ({ ...EMPTY_STATE, ...((await getJson<GState>(K_STATE)) ?? {}) });

// ---------- 화면에 보여 줄 상태 ----------

export type GStatus = {
  /** 앱 정보 파일을 골랐는지 */
  configured: boolean;
  /** 로그인했는지 */
  connected: boolean;
  busy: boolean;
  lastOk: string;
  lastError: string;
};

let status: GStatus = { configured: false, connected: false, busy: false, lastOk: "", lastError: "" };
const listeners = new Set<(s: GStatus) => void>();

function publish(p: Partial<GStatus>) {
  status = { ...status, ...p };
  for (const f of listeners) f(status);
}

export function onGoogleStatus(f: (s: GStatus) => void): () => void {
  listeners.add(f);
  f(status);
  return () => listeners.delete(f);
}

/** 저장한 것을 읽어 상태를 새로 맞춰요(잠금을 풀 때). */
export async function loadGoogleStatus(): Promise<GStatus> {
  const [c, t, s] = await Promise.all([getJson<GClient>(K_CLIENT), getJson<GToken>(K_TOKEN), loadState()]);
  publish({ configured: !!c?.id, connected: !!t?.refresh, lastOk: s.lastOk, lastError: s.lastError });
  return status;
}

/** "2026-10-16 09:12" → 오늘이면 "오늘 09:12", 아니면 "10/16 09:12" */
export function whenText(st: string): string {
  if (!st) return "";
  const today = new Date();
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return st.slice(0, 10) === d ? "오늘 " + st.slice(11) : st.slice(5, 10).replace("-", "/") + " " + st.slice(11);
}

// ---------- 앱 정보 파일 ----------

/** 구글 콘솔에서 받은 client_secret_….json을 읽어요. 맞지 않으면 이유를 던져요. */
export function parseClientFile(text: string): GClient {
  let j: Record<string, { client_id?: string; client_secret?: string }>;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("구글에서 받은 JSON 파일이 아니에요.");
  }
  const c = j.installed ?? j.web;
  if (!c?.client_id || !c.client_secret || !c.client_id.endsWith(".apps.googleusercontent.com")) {
    throw new Error("클라이언트 정보가 없는 파일이에요. client_secret으로 시작하는 파일을 골라 주세요.");
  }
  return { id: c.client_id, secret: c.client_secret };
}

export async function saveClient(c: GClient): Promise<void> {
  await putJson(K_CLIENT, c);
  publish({ configured: true });
}

// ---------- 인터넷 요청 ----------
// 화면(Edge와 같은 길 — 회사 프록시 자동 설정)으로 먼저 보내고, 막히면 앱이 대신 보내요(공휴일과 같은 순서).

type Reply = { status: number; body: string };
let viaApp = false;

async function http(method: string, url: string, headers: Record<string, string>, body?: string): Promise<Reply> {
  if (!viaApp) {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 30_000);
    try {
      const r = await fetch(url, { method, headers, body, signal: ctl.signal, cache: "no-store" });
      return { status: r.status, body: await r.text() };
    } catch {
      /* 막혔거나(CORS·프록시) 끊겼어요 → 앱으로 */
    } finally {
      window.clearTimeout(t);
    }
  }
  if (!inApp) throw new Error("offline");
  try {
    const r = await invoke<Reply>("google_http", { method, url, headers: Object.entries(headers), body: body ?? null });
    viaApp = true;
    return r;
  } catch (e) {
    viaApp = false;
    throw new Error(e === "offline" ? "offline" : String(e));
  }
}

class GError extends Error {
  constructor(public code: number, msg: string) {
    super(msg);
  }
}

function form(o: Record<string, string>): string {
  return Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function tokenCall(params: Record<string, string>): Promise<Record<string, string | number>> {
  const r = await http("POST", TOKEN_URL, { "Content-Type": "application/x-www-form-urlencoded" }, form(params));
  let j: Record<string, string | number> = {};
  try {
    j = JSON.parse(r.body);
  } catch {
    /* 아래에서 실패로 */
  }
  if (r.status !== 200) throw new GError(r.status, String(j.error ?? r.status));
  return j;
}

/** 쓸 수 있는 접근 열쇠. 만료가 가까우면 새로 받아요. 로그인이 풀렸으면 "relogin"을 던져요. */
async function accessToken(): Promise<string> {
  const t = await getJson<GToken>(K_TOKEN);
  const c = await getJson<GClient>(K_CLIENT);
  if (!t?.refresh || !c) throw new Error("not_connected");
  if (t.access && t.exp - 60_000 > Date.now()) return t.access;
  try {
    const j = await tokenCall({ client_id: c.id, client_secret: c.secret, refresh_token: t.refresh, grant_type: "refresh_token" });
    const next: GToken = { refresh: t.refresh, access: String(j.access_token), exp: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
    await putJson(K_TOKEN, next);
    return next.access;
  } catch (e) {
    if (e instanceof GError && (e.message === "invalid_grant" || e.message === "invalid_client" || e.message === "unauthorized_client")) {
      throw new Error("relogin");
    }
    throw e;
  }
}

/** 캘린더 API 부르기. 404·410은 그대로 돌려줘요(없는 것 지우기 등). */
async function gapi(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const tok = await accessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  const r = await http(method, API + path, headers, body === undefined ? undefined : JSON.stringify(body));
  let json: Record<string, unknown> = {};
  try {
    json = r.body ? JSON.parse(r.body) : {};
  } catch {
    /* 빈 응답 */
  }
  if (r.status >= 400 && r.status !== 404 && r.status !== 410) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? `응답 ${r.status}`;
    throw new GError(r.status, msg);
  }
  return { status: r.status, json };
}

// ---------- 로그인 ----------

function randomText(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"[b % 66]).join("");
}

async function challengeOf(verifier: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 기본 브라우저로 구글 로그인 창을 띄우고, 끝나면 로그인 정보를 저장한 뒤 전체를 내보내요.
 * 실패하면 화면에 보일 글을 던져요.
 */
export async function connectGoogle(): Promise<void> {
  if (!inApp) throw new Error("앱에서만 연결할 수 있어요.");
  const c = await getJson<GClient>(K_CLIENT);
  if (!c) throw new Error("앱 정보 파일을 먼저 골라 주세요.");
  const port = await invoke<number>("google_listen");
  const redirect = `http://127.0.0.1:${port}`;
  const verifier = randomText(64);
  const st = randomText(24);
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    form({
      client_id: c.id,
      redirect_uri: redirect,
      response_type: "code",
      scope: SCOPE,
      code_challenge: await challengeOf(verifier),
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      state: st,
    });
  await invoke("open_google_login", { url });
  let got: { code: string; state: string };
  try {
    got = await invoke<{ code: string; state: string }>("google_wait");
  } catch (e) {
    throw new Error(e === "timeout" ? "5분 안에 로그인을 마치지 않아 멈췄어요. 다시 눌러 주세요." : e === "denied" ? "구글에서 허용하지 않았어요." : `로그인하지 못했어요(${e}).`);
  }
  if (got.state !== st) throw new Error("로그인 응답이 맞지 않아요. 다시 시도해 주세요.");
  let j: Record<string, string | number>;
  try {
    j = await tokenCall({ client_id: c.id, client_secret: c.secret, code: got.code, code_verifier: verifier, redirect_uri: redirect, grant_type: "authorization_code" });
  } catch (e) {
    throw new Error(e instanceof Error && e.message === "offline" ? "구글에 연결하지 못했어요(인터넷 연결을 확인해 주세요)." : `로그인 정보를 받지 못했어요(${e instanceof Error ? e.message : e}).`);
  }
  if (!j.refresh_token) throw new Error("로그인 정보를 받지 못했어요. 다시 시도해 주세요.");
  await putJson(K_TOKEN, { refresh: String(j.refresh_token), access: String(j.access_token ?? ""), exp: Date.now() + Number(j.expires_in ?? 3600) * 1000 });
  const s = await loadState();
  await putJson(K_STATE, { ...s, full: true, lastError: "" });
  publish({ connected: true, lastError: "" });
  await syncGoogle();
}

/**
 * 연결 끊기: 로그인 정보를 지워요. removeEvents면 구글의 giLog 캘린더(내보낸 일정)도 지워요.
 * 일정을 남기면 다음에 다시 연결할 때 같은 캘린더를 다시 맞춰 써요.
 */
export async function disconnectGoogle(removeEvents: boolean): Promise<string> {
  let warn = "";
  const s = await loadState();
  const t = await getJson<GToken>(K_TOKEN);
  if (removeEvents && s.calendarId) {
    try {
      await gapi("DELETE", `/calendars/${encodeURIComponent(s.calendarId)}`);
    } catch {
      warn = "구글의 giLog 캘린더를 지우지 못했어요. 구글 캘린더에서 직접 지워 주세요.";
    }
  }
  if (t?.refresh) {
    await http("POST", "https://oauth2.googleapis.com/revoke", { "Content-Type": "application/x-www-form-urlencoded" }, form({ token: t.refresh })).catch(() => {});
  }
  await putJson(K_TOKEN, null);
  await putJson(K_STATE, removeEvents ? { ...EMPTY_STATE } : { ...s, full: true, lastError: "" });
  publish({ connected: false, lastError: "", lastOk: removeEvents ? "" : s.lastOk });
  return warn;
}

/** 앱 정보 파일까지 지워요(다른 파일로 바꿀 때). 연결되어 있으면 먼저 끊어야 해요. */
export async function forgetClient(): Promise<void> {
  await putJson(K_CLIENT, null);
  publish({ configured: false });
}

// ---------- 구글에 보낼 모양 ----------

/** 기Log 종류 색(구글 24색, tokens.css의 --gc-N 밝게 값)이에요. 구글이 일정에 받는 색 목록에서 가장 가까운 것을 골라요. */
const GC_HEX = [
  "#B55C76", "#CC6175", "#CD887C", "#CD5D3B", "#D77046", "#D37E40", "#D89949", "#E2BB5E", "#D5BE69", "#BEC162", "#8CAB61", "#588E63",
  "#69AD83", "#56978E", "#5A98CE", "#6A8BDC", "#838BBF", "#6D73BF", "#AB9ECB", "#9E7CAE", "#9E61B6", "#917568", "#7C7C7C", "#A3998D",
];
/** 구글 일정 색 목록을 못 받았을 때 쓰는 표(예전 11색) */
const GC_TO_EVENT = ["4", "4", "4", "11", "6", "6", "5", "5", "5", "2", "2", "10", "2", "2", "7", "9", "1", "9", "1", "3", "3", "8", "8", "8"];

/** 구글이 알려 준 일정 색 목록: colorId → 바탕 색 */
let palette: Record<string, string> | null = null;

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** 24색 번호 → 구글 colorId. 구글 목록에 같은 색이 있으면 그 색, 없으면 가장 가까운 색이에요. */
export function eventColorId(n: number, pal: Record<string, string> | null = palette): string {
  const want = GC_HEX[n];
  if (!pal || !want || !Object.keys(pal).length) return GC_TO_EVENT[n] ?? "8";
  const [r, g, b] = rgb(want);
  let best = "";
  let bestD = Infinity;
  for (const [id, hex] of Object.entries(pal)) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) continue;
    const [r2, g2, b2] = rgb(hex);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) [best, bestD] = [id, d];
  }
  return best || (GC_TO_EVENT[n] ?? "8");
}

/** 구글의 일정 색 목록을 읽어요(구글이 색을 늘리면 그대로 따라가요). 못 읽으면 예전 표를 써요. */
async function loadPalette(): Promise<void> {
  if (palette) return;
  try {
    const r = await gapi("GET", "/colors");
    const ev = (r.json.event ?? {}) as Record<string, { background?: string }>;
    const p: Record<string, string> = {};
    for (const [id, v] of Object.entries(ev)) if (v.background) p[id] = v.background;
    if (Object.keys(p).length) palette = p;
  } catch {
    /* 다음에 다시 */
  }
}

const RRULE: Record<Exclude<Repeat, "">, string> = {
  daily: "FREQ=DAILY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "FREQ=WEEKLY",
  biweekly: "FREQ=WEEKLY;INTERVAL=2",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

/** 구글 일정 알림은 4주(40320분)까지예요. 종일 일정은 그날 0시 기준이라 알림 시각만큼 빼요. */
function reminderMinutes(e: CalEvent): number | null {
  if (e.remind < 0) return null;
  let m = e.remind;
  if (e.allDay) {
    const [h, mi] = (e.remindTime || "09:00").split(":").map(Number);
    m = e.remind - (h * 60 + mi);
  }
  return Math.min(40320, Math.max(0, m));
}

type GBody = Record<string, unknown>;

const marker = (key: string) => ({ private: { gilog: key } });

export function eventBody(e: CalEvent, kinds: CalKind[]): GBody {
  const end = e.end || e.date;
  const k = kinds.find((x) => x.id === e.kind);
  const b: GBody = {
    summary: e.title,
    location: e.place || undefined,
    description: linesToText(parseLines(e.desc)).trim() || undefined,
    extendedProperties: marker("e" + e.id),
  };
  if (e.allDay) {
    b.start = { date: e.date };
    b.end = { date: addDays(end, 1) };
  } else {
    const s = `${e.date}T${e.time}:00`;
    let f = `${end}T${e.endTime || e.time}:00`;
    if (f < s) f = s;
    b.start = { dateTime: s, timeZone: TZ };
    b.end = { dateTime: f, timeZone: TZ };
  }
  if (e.repeat) {
    const u = e.until.replace(/-/g, "");
    // 시간 일정의 종료는 UTC 시각으로 적어야 해요(그날 23:59:59 한국 시각 = 14:59:59Z).
    b.recurrence = [`RRULE:${RRULE[e.repeat]}${u ? ";UNTIL=" + (e.allDay ? u : u + "T145959Z") : ""}`];
  }
  const rm = reminderMinutes(e);
  b.reminders = rm === null ? { useDefault: false } : { useDefault: false, overrides: [{ method: "popup", minutes: rm }] };
  if (k) b.colorId = eventColorId(kindColor(k, kinds));
  return b;
}

function allDayBody(key: string, title: string, date: string, color: string): GBody {
  return {
    summary: title,
    start: { date },
    end: { date: addDays(date, 1) },
    colorId: color,
    reminders: { useDefault: false },
    transparency: "transparent",
    extendedProperties: marker(key),
  };
}

/** 민원 마감 제목은 기Log 캘린더와 같은 "접수유형(지역 위치)"이에요(사용자 2026-10-17). 민원인 이름·연락처·내용은 넣지 않아요. */
export const complaintGoogleTitle = (c: Complaint): string => complaintTitle(c);

/** 지금 구글에 있어야 할 일정: 우리 이름 → 보낼 내용 */
export function desired(src: { kinds: CalKind[]; events: CalEvent[]; complaints: Complaint[]; tasks: Task[] }, opts: GOpts): Map<string, GBody> {
  const out = new Map<string, GBody>();
  const sys = (s: CalKind["system"]) => src.kinds.find((k) => k.system === s);
  if (opts.events) {
    for (const e of src.events) {
      const k = src.kinds.find((x) => x.id === e.kind);
      if (!k || k.system) continue;
      out.set("e" + e.id, eventBody(e, src.kinds));
    }
  }
  const ck = sys("complaint");
  if (opts.complaints && ck) {
    const color = eventColorId(kindColor(ck, src.kinds));
    for (const c of src.complaints) {
      if (!c.due || c.status === DONE_STATUS) continue;
      out.set("c" + c.id, allDayBody("c" + c.id, complaintGoogleTitle(c), c.due, color));
    }
  }
  const tk = sys("task");
  if (opts.tasks && tk) {
    const color = eventColorId(kindColor(tk, src.kinds));
    for (const t of src.tasks) {
      if (!t.due || t.done) continue;
      out.set("t" + t.id, allDayBody("t" + t.id, t.title, t.due, color));
    }
  }
  return out;
}

/** 내용 지문 (같으면 다시 보내지 않아요) */
export function fingerprint(b: GBody): string {
  const s = JSON.stringify(b);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16) + ":" + s.length;
}

// ---------- 맞추기 ----------

let running: Promise<void> | null = null;
let again = false;
let fullAgain = false;

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m === "offline") return "인터넷에 연결되지 않았어요. 연결되면 다시 보내요.";
  if (m === "relogin") return "구글 로그인이 풀렸어요. 설정에서 다시 연결해 주세요.";
  if (m === "not_connected") return "";
  if (e instanceof GError && e.code === 403) return `구글이 거절했어요: ${m}`;
  return `내보내지 못했어요: ${m}`;
}

/** giLog 캘린더가 있으면 그 id, 없으면 새로 만들어요. */
async function ensureCalendar(s: GState): Promise<string> {
  if (s.calendarId) {
    const r = await gapi("GET", `/calendars/${encodeURIComponent(s.calendarId)}`);
    if (r.status === 200) return s.calendarId;
    // 사용자가 구글에서 캘린더를 지웠어요 → 새로 만들고 전부 다시 보내요.
    s.items = {};
  }
  const r = await gapi("POST", "/calendars", { summary: CAL_NAME, description: "기Log에서 내보낸 일정이에요. 여기서 고친 내용은 다음 내보내기 때 기Log 내용으로 덮어써요.", timeZone: TZ });
  const id = String(r.json.id ?? "");
  if (!id) throw new Error("캘린더를 만들지 못했어요");
  s.calendarId = id;
  s.full = false;
  return id;
}

/** 구글 캘린더에 있는 모든 일정 id (전체 맞추기 때 우리가 모르는 것을 지우려고) */
async function listRemote(cal: string): Promise<{ id: string; key: string }[]> {
  const out: { id: string; key: string }[] = [];
  let page = "";
  for (let i = 0; i < 50; i++) {
    const q = `?maxResults=2500&showDeleted=false${page ? "&pageToken=" + encodeURIComponent(page) : ""}`;
    const r = await gapi("GET", `/calendars/${encodeURIComponent(cal)}/events${q}`);
    for (const it of (r.json.items as { id: string; extendedProperties?: { private?: { gilog?: string } } }[]) ?? []) {
      out.push({ id: it.id, key: it.extendedProperties?.private?.gilog ?? "" });
    }
    page = String(r.json.nextPageToken ?? "");
    if (!page) break;
  }
  return out;
}

async function runSync(forceFull: boolean): Promise<void> {
  const [c, t] = await Promise.all([getJson<GClient>(K_CLIENT), getJson<GToken>(K_TOKEN)]);
  if (!c || !t?.refresh) return;
  const s = await loadState();
  const full = forceFull || s.full;
  publish({ busy: true });
  const save = () => putJson(K_STATE, s);
  try {
    await loadPalette();
    const [cal, cd, complaints, td, opts] = await Promise.all([ensureCalendar(s), api.calendarData(), api.complaints(), api.tasksData(), loadOpts()]);
    await save();
    const want = desired({ kinds: cd.kinds, events: cd.events, complaints, tasks: td.tasks }, opts);
    const base = `/calendars/${encodeURIComponent(cal)}/events`;

    if (full) {
      // 구글에서 고치거나 더한 것을 덮어쓰려고, 구글에 있는 것을 다 읽어 우리 목록과 맞춰요.
      const remote = await listRemote(cal);
      const known = new Map(Object.entries(s.items).map(([k, v]) => [v.id, k]));
      for (const r of remote) {
        const k = known.get(r.id) ?? (r.key && want.has(r.key) && !s.items[r.key] ? r.key : "");
        if (k && want.has(k)) {
          s.items[k] = { id: r.id, h: "" }; // 내용은 다시 보내요
        } else {
          await gapi("DELETE", `${base}/${encodeURIComponent(r.id)}`);
          if (k) delete s.items[k];
        }
      }
      for (const k of Object.keys(s.items)) if (!remote.some((r) => r.id === s.items[k].id)) delete s.items[k];
      await save();
    }

    let n = 0;
    for (const [k, body] of want) {
      const h = fingerprint(body);
      const cur = s.items[k];
      if (cur && cur.h === h) continue;
      if (cur) {
        const r = await gapi("PUT", `${base}/${encodeURIComponent(cur.id)}`, body);
        if (r.status === 200) {
          s.items[k] = { id: cur.id, h };
        } else {
          const r2 = await gapi("POST", base, body);
          s.items[k] = { id: String(r2.json.id), h };
        }
      } else {
        const r = await gapi("POST", base, body);
        s.items[k] = { id: String(r.json.id), h };
      }
      if (++n % 10 === 0) await save();
    }
    for (const k of Object.keys(s.items)) {
      if (want.has(k)) continue;
      await gapi("DELETE", `${base}/${encodeURIComponent(s.items[k].id)}`);
      delete s.items[k];
      if (++n % 10 === 0) await save();
    }
    s.full = false;
    s.lastOk = stamp();
    s.lastError = "";
    await save();
    publish({ busy: false, lastOk: s.lastOk, lastError: "" });
  } catch (e) {
    const msg = friendly(e);
    s.lastError = msg;
    if (full) s.full = true;
    await save().catch(() => {});
    publish({ busy: false, lastError: msg });
    if (e instanceof Error && e.message === "relogin") {
      await putJson(K_TOKEN, null).catch(() => {});
      publish({ connected: false });
    }
  }
}

/** 구글과 맞춰요. 이미 맞추는 중이면 끝난 뒤 한 번 더 해요. full이면 구글에 있는 것까지 다시 맞춰요(지금 내보내기). */
export function syncGoogle(full = false): Promise<void> {
  if (!inApp) return Promise.resolve();
  if (running) {
    again = true;
    if (full) fullAgain = true;
    return running;
  }
  running = (async () => {
    try {
      await runSync(full);
      while (again) {
        const f = fullAgain;
        again = false;
        fullAgain = false;
        await runSync(f);
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

/** 지금 내보내기: 전체를 다시 맞춰요. */
export async function exportNow(): Promise<void> {
  const s = await loadState();
  await putJson(K_STATE, { ...s, full: true });
  await syncGoogle(true);
}

/** 켜고 끄기를 바꾸면 바로 맞춰요(끈 것은 구글에서 지워요). */
export async function saveOpts(o: GOpts): Promise<void> {
  await putJson(K_OPTS, o);
  void syncGoogle();
}

// ---------- 자동으로 보내기 ----------

let timer = 0;

/** 일정·민원·할 일이 바뀌면 불러요. 잠깐 모아서 한 번에 보내요. */
export function scheduleGoogleSync(): void {
  if (!inApp || !status.connected) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncGoogle(), 2_000);
}

/** 구글로 나가는 것을 바꾸는 명령들이에요(보기·색 칸 숨기기 등은 빼요). */
const CHANGES = /^(add_event|update_event|delete_event|set_cal_kind_color|delete_cal_kind|add_complaint|update_complaint|set_complaint_status|delete_complaint|add_task|update_task|set_task_done|delete_task|delete_task_list)$/;

function onDataChange(cmd: string) {
  if (CHANGES.test(cmd)) scheduleGoogleSync();
}

let retry = 0;

/** 잠금을 풀 때 불러요. 상태를 읽고, 연결되어 있으면 맞추고, 실패한 것은 10분마다 다시 해요. */
export async function startGoogleSync(): Promise<void> {
  if (!inApp) return;
  changeHooks.add(onDataChange);
  await loadGoogleStatus();
  if (status.connected) void syncGoogle();
  window.clearInterval(retry);
  retry = window.setInterval(() => {
    if (status.connected && status.lastError) void syncGoogle();
  }, 10 * 60_000);
}

