// 구글 캘린더 양방향(2026-11-04 16:08 사용자 "제안대로", 대기 캘린더 ✔2) – 구글 일정 ↔ 기록 일정 바꾸기.
// 화면·인터넷 없이 모양만 바꿔요(google.ts가 불러 써요). 시험은 googleTwoWay.test.ts.
// - 기록이 아는 반복(매일·평일·매주·격주·매월·매년 + 끝나는 날)만 받아요. 다른 반복은 null → 구글에만 둬요.
// - 구글에서 안 바꾼 칸은 기록 값을 그대로 둬요(알림·설명처럼 오가며 모양이 조금 바뀌는 칸이 저절로 바뀌지 않게).
import type { CalEvent, CalKind, EventInput, Repeat } from "./api";
import { addDays } from "./calendar";
import { linesToText, parseLines, stringifyLines, textToLines } from "./bullets";

/** 구글 일정(필요한 칸만). 우리가 보내는 모양(eventBody)도 같은 모양이에요. */
export type GEvent = {
  id?: string;
  status?: string;
  updated?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  recurringEventId?: string;
  reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
  colorId?: string;
  extendedProperties?: { private?: { gilog?: string } };
};

export const NO_TITLE = "제목 없음";
export const REMIND_MAX = 62 * 24 * 60;

export const RRULE: Record<Exclude<Repeat, "">, string> = {
  daily: "FREQ=DAILY",
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  weekly: "FREQ=WEEKLY",
  biweekly: "FREQ=WEEKLY;INTERVAL=2",
  monthly: "FREQ=MONTHLY",
  yearly: "FREQ=YEARLY",
};

const hm = (s: string) => {
  const [h, m] = (s || "09:00").split(":").map(Number);
  return h * 60 + m;
};

/** 기록 알림 → 구글 알림(분 전). 구글은 4주(40320분)까지, 종일 일정은 그날 0시 기준이라 알림 시각만큼 빼요. 없으면 null. */
export function remindMinutesOf(remind: number, allDay: boolean, remindTime: string): number | null {
  if (remind < 0) return null;
  const m = allDay ? remind - hm(remindTime) : remind;
  return Math.min(40320, Math.max(0, m));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 구글 시각("2026-11-05T09:30:00+09:00", "…Z", 시간대 없는 "…T09:30:00"은 한국 시각) → 한국 날짜·시각 */
export function kst(dt: string): { date: string; time: string } {
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(dt)) return { date: dt.slice(0, 10), time: dt.slice(11, 16) };
  const d = new Date(Date.parse(dt) + 9 * 3600_000);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}

/** 반복 끝("20261231" 또는 "20261231T145959Z") → 한국 날짜 */
export function untilDate(u: string): string {
  if (/^\d{8}$/.test(u)) return `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(u);
  if (!m) return "";
  return kst(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).date;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const weekdayOf = (date: string) => DAYS[new Date(date + "T00:00:00Z").getUTCDay()];

/**
 * 구글 반복 → 기록 반복. 반복이 없으면 { repeat: "" }, 기록이 담을 수 없으면 null
 * (끝나는 날 없음·횟수로 끝남·한 번 빼기·"둘째 화요일"·매주 여러 요일 등).
 */
export function repeatOf(recurrence: string[] | undefined, date: string): { repeat: Repeat; until: string } | null {
  if (!recurrence?.length) return { repeat: "", until: "" };
  if (recurrence.length !== 1 || !recurrence[0].startsWith("RRULE:")) return null;
  const p = new Map<string, string>();
  for (const kv of recurrence[0].slice(6).split(";")) {
    const [k, v] = kv.split("=");
    if (k && v !== undefined) p.set(k.toUpperCase(), v.toUpperCase());
  }
  p.delete("WKST");
  const until = untilDate(p.get("UNTIL") ?? "");
  if (!until || until < date || p.has("COUNT")) return null;
  const freq = p.get("FREQ");
  const interval = Number(p.get("INTERVAL") ?? "1");
  const byday = p.get("BYDAY");
  const others = [...p.keys()].filter((k) => !["FREQ", "INTERVAL", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH"].includes(k));
  if (others.length) return null;
  const day = Number(date.slice(8, 10));
  const month = Number(date.slice(5, 7));
  const plainDay = (!p.has("BYMONTHDAY") || Number(p.get("BYMONTHDAY")) === day) && !byday;
  let repeat: Repeat | null = null;
  if (freq === "DAILY" && interval === 1 && !byday && !p.has("BYMONTHDAY") && !p.has("BYMONTH")) repeat = "daily";
  else if (freq === "WEEKLY" && !p.has("BYMONTHDAY") && !p.has("BYMONTH")) {
    const set = byday ? byday.split(",").sort().join(",") : "";
    if (interval === 1 && set === ["FR", "MO", "TH", "TU", "WE"].join(",")) repeat = "weekdays";
    else if (!byday || byday === weekdayOf(date)) repeat = interval === 1 ? "weekly" : interval === 2 ? "biweekly" : null;
  } else if (freq === "MONTHLY" && interval === 1 && plainDay && !p.has("BYMONTH")) repeat = "monthly";
  else if (freq === "YEARLY" && interval === 1 && plainDay && (!p.has("BYMONTH") || Number(p.get("BYMONTH")) === month)) repeat = "yearly";
  return repeat ? { repeat, until } : null;
}

/** 구글 일정의 시작·끝(한국 날짜·시각). 종일 일정의 끝 날짜는 구글이 다음 날로 적어요. */
function timesOf(r: GEvent): { date: string; end: string; allDay: boolean; time: string; endTime: string } | null {
  if (r.start?.date) {
    const date = r.start.date;
    let end = r.end?.date ? addDays(r.end.date, -1) : date;
    if (end < date) end = date;
    return { date, end: end === date ? "" : end, allDay: true, time: "", endTime: "" };
  }
  if (!r.start?.dateTime) return null;
  const s = kst(r.start.dateTime);
  const e = r.end?.dateTime ? kst(r.end.dateTime) : s;
  let endTime = e.time;
  if (e.date === s.date && endTime < s.time) endTime = s.time;
  return { date: s.date, end: e.date > s.date ? e.date : "", allDay: false, time: s.time, endTime };
}

/** 구글 알림(분 전) – 첫 팝업. 없으면 null, 구글 기본 알림이면 undefined(모름) */
function remoteMinutes(r: GEvent): number | null | undefined {
  if (r.reminders?.useDefault) return undefined;
  const o = r.reminders?.overrides?.find((x) => (x.method ?? "popup") === "popup") ?? r.reminders?.overrides?.[0];
  return typeof o?.minutes === "number" ? o.minutes : null;
}

/** 견주기용 정리: 두 쪽에서 같으면 같은 글자 (색·표시는 빼요 – 색은 기록 종류가 정해요) */
export function norm(b: GEvent): string {
  const t = timesOf(b);
  return JSON.stringify([
    (b.summary ?? "").trim(),
    (b.location ?? "").trim(),
    (b.description ?? "").replace(/\r\n?/g, "\n").trim(),
    t,
    (b.recurrence ?? []).join("|"),
    remoteMinutes(b) ?? null,
  ]);
}

/** 기록 일정 → 넣는 모양(종류는 이름) */
export function inputOf(e: CalEvent, kinds: CalKind[]): EventInput {
  const k = kinds.find((x) => x.id === e.kind);
  const { id: _id, kind: _kind, ...rest } = e;
  void _id;
  void _kind;
  return { ...rest, kind: k?.name ?? "" };
}

/** 넣는 모양 둘이 같은지(저장 쪽이 정리하는 칸은 정리해서) */
export function sameInput(a: EventInput, b: EventInput): boolean {
  const n = (x: EventInput) =>
    JSON.stringify([x.title.trim(), x.kind, x.date, x.end && x.end !== x.date ? x.end : "", x.allDay, x.allDay ? "" : x.time, x.allDay ? "" : x.endTime, x.repeat, x.repeat ? x.until : "", x.place.trim(), x.desc, x.remind, x.allDay && x.remind >= 0 ? x.remindTime : ""]);
  return n(a) === n(b);
}

/**
 * 구글 일정 → 기록에 넣을 모양. base는 이어진 기록 일정(새 일정이면 null), kindName은 새 일정의 종류 이름.
 * 기록이 담을 수 없는 반복이면 null이에요.
 */
export function remoteToInput(r: GEvent, base: CalEvent | null, kinds: CalKind[], kindName: string): EventInput | null {
  const t = timesOf(r);
  if (!t) return null;
  const rep = repeatOf(r.recurrence, t.date);
  if (!rep) return null;
  const b = base ? inputOf(base, kinds) : null;
  // 설명: 구글 글이 기록 설명을 글로 바꾼 것과 같으면 기록 그대로(머릿기호 모양을 지켜요).
  const text = (r.description ?? "").replace(/\r\n?/g, "\n").trim();
  const desc = b && linesToText(parseLines(b.desc)).trim() === text ? b.desc : stringifyLines(textToLines(text));
  // 알림: 기록 알림을 구글로 보낸 값과 같으면 기록 그대로(종일 일정 알림 시각 등).
  const m = remoteMinutes(r);
  let remind = b?.remind ?? -1;
  let remindTime = b?.remindTime ?? "";
  if (m !== undefined && !(b && b.allDay === t.allDay && remindMinutesOf(b.remind, b.allDay, b.remindTime) === m)) {
    if (m === null) {
      remind = -1;
      remindTime = "";
    } else if (t.allDay) {
      remindTime = b?.allDay && b.remindTime ? b.remindTime : "";
      remind = Math.min(REMIND_MAX, m + hm(remindTime));
    } else {
      remind = Math.min(REMIND_MAX, m);
      remindTime = "";
    }
  }
  return {
    title: (r.summary ?? "").trim() || NO_TITLE,
    kind: b?.kind ?? kindName,
    date: t.date,
    end: t.end,
    allDay: t.allDay,
    time: t.time,
    endTime: t.endTime,
    repeat: rep.repeat,
    until: rep.until,
    place: (r.location ?? "").trim(),
    desc,
    remind,
    remindTime,
  };
}

/** 양쪽에서 고쳤을 때 구글 쪽이 나중인지(같으면 기록 쪽) */
export const remoteIsLater = (remoteUpdated: string | undefined, localAt: string | undefined): boolean =>
  !!remoteUpdated && Date.parse(remoteUpdated) > (localAt ? Date.parse(localAt) : 0);
