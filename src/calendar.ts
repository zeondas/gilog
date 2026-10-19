// 캘린더 화면이 쓰는 규칙들이에요. 화면 그리기와 떼어 두어 알림(reminders.ts)에서도 같이 써요.
import type { CalEvent, CalKind, Complaint, Holiday, Repeat, Task } from "./api";
import { normTime, todayStr } from "./journal";
import { complaintTitle } from "./tasks";
import { isAnswered } from "./settingsStore";

// ---------- 색 ----------

/** 구글 캘린더 24색 이름(시안 순서). 색 값은 tokens.css의 --gc-N(바탕)·--gc-N-fg(글자)예요. */
export const COLOR_NAMES = [
  "자주", "분홍", "살구", "다홍", "주황", "귤색", "호박색", "노랑", "연노랑", "연두", "풀색", "초록",
  "민트", "청록", "하늘", "파랑", "연보라", "남보라", "연한 보라", "자주보라", "보라", "갈색", "회색", "회갈색",
];

/** 자동 색 순서(시안): 하늘, 보라, 주황, 풀색, 노랑, 연보라, … 내 종류의 순서대로 붙어요. */
const AUTO = [14, 20, 4, 11, 7, 17, 21, 13, 0, 22];

/** 종류의 색 번호. 직접 고른 색이 없으면 내 종류 가운데 몇 번째인지로 정해요. */
export function kindColor(k: CalKind, kinds: CalKind[]): number {
  if (k.color !== null) return k.color;
  const i = kinds.filter((x) => !x.system).findIndex((x) => x.id === k.id);
  return AUTO[Math.max(0, i) % AUTO.length];
}

export const colorBg = (n: number) => `var(--gc-${n})`;
export const colorFg = (n: number) => `var(--gc-${n}-fg)`;

// ---------- 날짜 ----------

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** 날짜에 n일을 더해요. */
export function addDays(s: string, n: number): string {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/** 두 날짜 사이 날 수 (b - a) */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
}

export const weekday = (s: string) => toDate(s).getDay();

/** "10/16(금)" */
export function shortDay(s: string): string {
  const d = toDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEK[d.getDay()]})`;
}

/** "10월 16일(금)" */
export function longDay(s: string): string {
  const d = toDate(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEK[d.getDay()]})`;
}

/** 시각 칸: "1400" "930" "9:30" "14"(정각) → "14:00". 읽을 수 없으면 null이에요. */
export function parseTime(v: string): string | null {
  const s = v.trim();
  if (/^\d{1,2}$/.test(s) && Number(s) < 24) return s.padStart(2, "0") + ":00";
  return normTime(s);
}

/** 한 시간 뒤 (23:59를 넘지 않아요) */
export function hourLater(t: string): string {
  const m = Math.min(Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + 60, 23 * 60 + 59);
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

/** 달력에 그릴 주의 첫날(일요일)과 주 수(5주·6주, 2월은 4주도). */
export function monthGrid(y: number, m: number): { start: string; weeks: number } {
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  return { start: todayStr(new Date(y, m, 1 - first.getDay())), weeks: Math.ceil((first.getDay() + days) / 7) };
}

// ---------- 반복 ----------

export const REPEAT_LABELS: [Repeat, string][] = [
  ["", "반복 안 함"],
  ["daily", "매일"],
  ["weekdays", "주중 매일(월~금)"],
  ["weekly", "매주"],
  ["biweekly", "격주"],
  ["monthly", "매월"],
  ["yearly", "매년"],
];

/** 알림 고르기 목록(분 전). 이 밖의 값은 "직접 설정"이에요. */
export const REMIND_LABELS: [number, string][] = [
  [-1, "알림 없음"],
  [0, "정시"],
  [10, "10분 전"],
  [30, "30분 전"],
  [60, "1시간 전"],
  [1440, "1일 전"],
  [10080, "7일 전"],
  [43200, "한 달 전"],
];

/** 직접 설정의 단위 (분) */
export const REMIND_UNITS: [number, string][] = [
  [1, "분 전"],
  [60, "시간 전"],
  [1440, "일 전"],
  [10080, "주 전"],
];

/** 알림 값(분)을 [수, 단위]로 나눠요(가장 큰 맞는 단위). */
export function splitRemind(m: number): [number, number] {
  for (const [u] of [...REMIND_UNITS].reverse()) if (m > 0 && m % u === 0) return [m / u, u];
  return [m, 1];
}

/** "10분 전", "2시간 전", "3일 전", "한 달 전" */
export function remindText(m: number): string {
  const p = REMIND_LABELS.find(([v]) => v === m);
  if (p) return p[1];
  const [n, u] = splitRemind(m);
  return n + (REMIND_UNITS.find(([v]) => v === u)?.[1] ?? "분 전");
}

/** 가장 긴 알림 (62일) */
export const REMIND_MAX = 62 * 24 * 60;

/** 이 날이 반복 일정의 한 회차가 시작하는 날인지 (반복 없음이면 시작 날짜만) */
export function startsOn(e: Pick<CalEvent, "date" | "repeat" | "until">, key: string): boolean {
  if (key < e.date) return false;
  if (!e.repeat) return key === e.date;
  if (e.until && key > e.until) return false;
  const n = diffDays(e.date, key);
  const a = toDate(e.date);
  const d = toDate(key);
  switch (e.repeat) {
    case "daily":
      return true;
    case "weekdays":
      return d.getDay() >= 1 && d.getDay() <= 5;
    case "weekly":
      return n % 7 === 0;
    case "biweekly":
      return n % 14 === 0;
    case "monthly":
      return d.getDate() === a.getDate();
    case "yearly":
      return d.getDate() === a.getDate() && d.getMonth() === a.getMonth();
  }
  return false;
}

// ---------- 달력에 그릴 일정 ----------

/** 달력 한 칸에 그릴 일정. 내 일정이거나, 민원·할 일 마감이거나, 공휴일이에요. */
export type Occ = {
  /** 그리기용 고유 이름: "e12@2026-10-16", "c5", "t3", "h2026-10-03" */
  key: string;
  title: string;
  /** 이 회차의 시작·끝 날짜 */
  start: string;
  end: string;
  allDay: boolean;
  time: string;
  endTime: string;
  kind: CalKind;
  color: number;
  /** 반복 일정의 회차예요(↻) */
  repeat: boolean;
  /** 완료한 민원·할 일 (흐리게, 가운데 줄) */
  done: boolean;
  place: string;
  event: CalEvent | null;
  complaint: Complaint | null;
  task: Task | null;
};

export type Source = {
  kinds: CalKind[];
  events: CalEvent[];
  holidays: Holiday[];
  complaints: Complaint[];
  tasks: Task[];
};

/** from~to(포함) 사이에 걸치는 모든 일정을 펼쳐요. 숨긴 종류도 함께예요(거르는 것은 화면이 해요). */
export function expand(src: Source, from: string, to: string): Occ[] {
  const out: Occ[] = [];
  const byId = new Map(src.kinds.map((k) => [k.id, k]));
  const sys = (s: CalKind["system"]) => src.kinds.find((k) => k.system === s);
  const col = (k: CalKind) => kindColor(k, src.kinds);
  for (const e of src.events) {
    const k = byId.get(e.kind);
    if (!k) continue;
    const span = Math.max(0, diffDays(e.date, e.end));
    if (!e.repeat) {
      if (e.end < from || e.date > to) continue;
      out.push(occOf(e, k, col(k), e.date, e.end));
      continue;
    }
    // 회차 시작일이 (from - span) ~ to 안에 있으면 걸쳐요.
    const last = e.until && e.until < to ? e.until : to;
    for (let d = from > e.date ? addDays(from, -span) : e.date; d <= last; d = addDays(d, 1)) {
      if (d < e.date) continue;
      if (startsOn(e, d)) out.push(occOf(e, k, col(k), d, addDays(d, span)));
    }
  }
  const ck = sys("complaint");
  if (ck) {
    for (const c of src.complaints) {
      if (!c.due || c.due < from || c.due > to) continue;
      out.push(derived("c" + c.id, complaintTitle(c), c.due, ck, col(ck), isAnswered(c.status), c.place, { complaint: c }));
    }
  }
  const tk = sys("task");
  if (tk) {
    for (const t of src.tasks) {
      if (!t.due || t.due < from || t.due > to) continue;
      out.push(derived("t" + t.id, t.title, t.due, tk, col(tk), t.done, "", { task: t }));
    }
  }
  const hk = sys("holiday");
  if (hk) {
    for (const h of src.holidays) {
      if (h.date < from || h.date > to) continue;
      out.push(derived("h" + h.date + h.name, h.name, h.date, hk, col(hk), false, "", {}));
    }
  }
  return out;
}

function occOf(e: CalEvent, k: CalKind, color: number, start: string, end: string): Occ {
  return {
    key: `e${e.id}@${start}`,
    title: e.title,
    start,
    end,
    allDay: e.allDay,
    time: e.time,
    endTime: e.endTime,
    kind: k,
    color,
    repeat: !!e.repeat,
    done: false,
    place: e.place,
    event: e,
    complaint: null,
    task: null,
  };
}

function derived(key: string, title: string, date: string, k: CalKind, color: number, done: boolean, place: string, x: { complaint?: Complaint; task?: Task }): Occ {
  return { key, title, start: date, end: date, allDay: true, time: "", endTime: "", kind: k, color, repeat: false, done, place, event: null, complaint: x.complaint ?? null, task: x.task ?? null };
}

/** 한 칸 안의 순서: 여러 날 → 종일 → 시간순. 마감은 내 일정 뒤예요. */
export function byOrder(a: Occ, b: Occ): number {
  const multi = (o: Occ) => (o.start !== o.end ? 0 : 1);
  if (multi(a) !== multi(b)) return multi(a) - multi(b);
  if (multi(a) === 0 && a.start !== b.start) return a.start < b.start ? -1 : 1;
  if (multi(a) === 0 && a.end !== b.end) return a.end > b.end ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (!a.allDay && a.time !== b.time) return a.time < b.time ? -1 : 1;
  const linked = (o: Occ) => (o.event ? 0 : 1);
  if (linked(a) !== linked(b)) return linked(a) - linked(b);
  return a.title.localeCompare(b.title, "ko");
}

/** 일정 검색: 제목·장소·설명·종류 */
export function occMatches(o: Occ, q: string): boolean {
  if (!q) return true;
  const hay = [o.title, o.place, o.kind.name, o.event?.desc ?? ""].join("\n").toLowerCase();
  return hay.includes(q);
}

// ---------- 주 한 줄 배치 ----------

/** 한 주에 놓은 일정: 몇 번째 칸(0~6)부터 몇 칸, 몇 번째 줄 */
export type Placed = { occ: Occ; col: number; span: number; lane: number; cutStart: boolean; cutEnd: boolean };

/**
 * 한 주(시작일 weekStart, 7일)의 일정을 줄에 나눠 놓아요. 여러 날 일정은 이어진 막대예요.
 * maxLanes 줄까지 놓고, 못 놓은 것은 날마다 "+N개"로 세요.
 */
export function layoutWeek(occs: Occ[], weekStart: string, maxLanes: number): { placed: Placed[]; more: number[] } {
  const weekEnd = addDays(weekStart, 6);
  const items = occs.filter((o) => o.end >= weekStart && o.start <= weekEnd && o.kind.system !== "holiday").sort(byOrder);
  // 먼저 줄 수에 상관없이 빈 줄에 차례로 놓아요.
  const used: boolean[][] = [];
  const all: Placed[] = [];
  for (const o of items) {
    const s = o.start < weekStart ? weekStart : o.start;
    const e = o.end > weekEnd ? weekEnd : o.end;
    const col = diffDays(weekStart, s);
    const span = diffDays(s, e) + 1;
    let lane = 0;
    while (used[lane]?.slice(col, col + span).some(Boolean)) lane++;
    used[lane] = used[lane] ?? Array(7).fill(false);
    for (let c = col; c < col + span; c++) used[lane][c] = true;
    all.push({ occ: o, col, span, lane, cutStart: o.start < weekStart, cutEnd: o.end > weekEnd });
  }
  const more = [0, 0, 0, 0, 0, 0, 0];
  if (used.length <= maxLanes) return { placed: all, more };
  // 넘치면 마지막 줄을 "+N개" 자리로 비워요. 그 줄부터 아래의 일정을 날마다 세요.
  const keep = Math.max(0, maxLanes - 1);
  for (const p of all) if (p.lane >= keep) for (let c = p.col; c < p.col + p.span; c++) more[c]++;
  return { placed: all.filter((p) => p.lane < keep), more };
}

// ---------- 알림 ----------

/** 종일 일정의 알림 기준 시각이에요(정시 = 그날 오전 9시, 1일 전 = 전날 오전 9시). */
export const ALL_DAY_AT = "09:00";

/** from 시각부터 days일 안에 울릴 알림. at은 밀리초(PC 시각)예요. 종일 일정은 알림 시각(없으면 9시) 기준이에요. */
export function reminders(events: CalEvent[], kinds: CalKind[], now: Date, days: number): { at: number; title: string; body: string; event: number; date: string }[] {
  const from = todayStr(now);
  const to = todayStr(new Date(now.getTime() + days * 86_400_000));
  const out: { at: number; title: string; body: string; event: number; date: string }[] = [];
  const withRemind = events.filter((e) => e.remind >= 0);
  const src: Source = { kinds, events: withRemind, holidays: [], complaints: [], tasks: [] };
  // 한 달 전 알림처럼 멀리 앞선 알림도 잡으려고, 가장 긴 알림만큼 더 앞까지 펼쳐요.
  const lead = Math.max(0, ...withRemind.map((e) => e.remind));
  for (const o of expand(src, from, addDays(to, Math.ceil(lead / 1440) + 1))) {
    const e = o.event!;
    // 이미 시작한 여러 날 일정의 회차는 시작일 기준이라 지났어요.
    if (o.start < from) continue;
    const at = toDate(o.start);
    const [h, m] = (o.allDay ? e.remindTime || ALL_DAY_AT : o.time).split(":").map(Number);
    at.setHours(h, m, 0, 0);
    const ms = at.getTime() - e.remind * 60_000;
    if (ms < now.getTime() - 10 * 60_000 || ms > now.getTime() + days * 86_400_000) continue;
    const when = o.allDay ? "종일" : `${o.time}–${o.endTime}`;
    const leadText = e.remind === 0 ? "지금" : remindText(e.remind).replace(/ 전$/, " 뒤").replace("1일 뒤", "내일");
    const body = [`${leadText} · ${longDay(o.start)} ${when}`, e.place].filter(Boolean).join(" · ");
    out.push({ at: ms, title: e.title, body, event: e.id, date: o.start });
  }
  return out.sort((a, b) => a.at - b.at);
}
