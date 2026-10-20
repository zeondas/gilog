// 민원대장 화면이 쓰는 규칙들이에요. 화면 그리기와 떼어 두어 업무일지 "챙길 일"에서도 같이 써요.
import type { Complaint } from "./api";
import { plainOf } from "./bullets";
import { parseMemo } from "./ContactsScreen";
import { initials, isChosung, koIndex, splitJamo } from "./journal";
import { isAnswered } from "./settingsStore";

/** 2026-10-15 두 날짜 사이의 날 수 (to - from) */
export function daysBetween(from: string, to: string): number {
  const d = (s: string) => {
    const [y, m, dd] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((d(to) - d(from)) / 86_400_000);
}

/** 남은 날. 마감이 없거나 완료면 null이에요. */
export function daysLeft(c: Pick<Complaint, "due" | "status">, today: string): number | null {
  if (!c.due || isAnswered(c.status)) return null;
  return daysBetween(today, c.due);
}

/** 접수일부터 조치완료일까지 걸린 날(조치완료일 − 접수일). 둘 중 하나라도 없거나 거꾸로면 null이에요. */
export function daysTaken(c: Pick<Complaint, "received" | "done">): number | null {
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!ok(c.received) || !ok(c.done)) return null;
  const n = daysBetween(c.received, c.done!);
  return n < 0 ? null : n;
}

/**
 * 걸린 날 글자(2026-10-19 사용자): 30일까지는 "12d", 넘으면 달 "3m", 1년부터는 해 "2y".
 * 달·해는 달력으로 센 만큼(다 채우지 못한 달은 버림). 정확한 날 수는 마우스를 올리면 보여요.
 */
export function takenText(c: Pick<Complaint, "received" | "done">, n: number): string {
  if (n <= 30) return `${n}d`;
  const [y1, m1, d1] = c.received.split("-").map(Number);
  const [y2, m2, d2] = c.done!.split("-").map(Number);
  const months = Math.max(1, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
  return months < 12 ? `${months}m` : `${Math.floor(months / 12)}y`;
}

/** 3 → "D-3", 0 → "D-day", -2 → "D+2" */
export function ddayText(n: number): string {
  return n > 0 ? `D-${n}` : n === 0 ? "D-day" : `D+${-n}`;
}

/** 임박(설정의 기준 안이거나 지났음)인지 */
export const isUrgent = (n: number, urgentDays: number) => n <= urgentDays;

/** 업무일지 "챙길 일": 마감이 within일 안이거나 지난, 아직 답변하지 않은(접수·진행 등) 민원. 마감이 빠른 것이 위예요. */
export function dueSoon(list: Complaint[], today: string, within = 7): Complaint[] {
  return list
    .filter((c) => {
      const n = daysLeft(c, today);
      return n !== null && n <= within;
    })
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.no - b.no));
}


/** 검색에 맞는지. 모든 칸과 메모를 보고, 민원인은 초성으로도, 번호는 줄표 없이도 찾아요. */
export function matches(c: Complaint, q: string): boolean {
  if (!q) return true;
  const memo = parseMemo(c.memo).map((l) => l.t).join(" ");
  const hay = [String(c.no), c.intake, c.received, c.ctype, c.area, c.place, c.person, c.phone, plainOf(c.body), plainOf(c.action), c.due, c.status, c.done ?? "", memo]
    .join("\n")
    .toLowerCase();
  if (hay.includes(q)) return true;
  if (/[ㄱ-ㅎ]/.test(q) && c.person && koIndex(c.person, q) >= 0) return true;
  const digits = q.replace(/[^0-9]/g, "");
  return digits.length >= 3 && digits === q.replace(/[-\s]/g, "") && c.phone.replace(/[^0-9]/g, "").includes(digits);
}

/** 민원유형 칸에 초성만 적고 떠났을 때, 초성이 똑같은 유형이 하나뿐이면 그것으로 바꿔요(ㅍㅌㅎ → 포트홀). */
export function expandType(v: string, options: string[]): string {
  const s = splitJamo(v.trim());
  if (!s || !isChosung(s)) return v;
  const hit = options.filter((o) => initials(o.replace(/\s/g, "")) === s);
  if (hit.length === 1) return hit[0];
  const pre = options.filter((o) => initials(o.replace(/\s/g, "")).startsWith(s));
  return pre.length === 1 ? pre[0] : v;
}

// ---------- 열 ----------

export type ColKey =
  | "no" | "intake" | "received" | "ctype" | "area" | "place" | "person"
  | "phone" | "body" | "action" | "due" | "status" | "done" | "memo";

/**
 * 사양서 순서 14열(2026-10-19 상태 뒤에 조치완료일). w가 null인 열(내용·조치내용)은 남는 폭을 반씩 나눠 가져요.
 * 기본 폭은 1600×900 창 기준(2026-10-17 사용자 1안, 시안 ComplaintCols.dc.html): 열마다 글 폭에 맞춰 줄이고
 * 위치·내용·조치내용의 긴 글은 칸 안에서 다음 줄로 넘겨요. 가로 스크롤이 없어야 해요.
 */
export const COLUMNS: { key: ColKey; label: string; w: number | null; fixed?: boolean }[] = [
  { key: "no", label: "연번", w: 52 },
  { key: "intake", label: "접수유형", w: 92 },
  { key: "received", label: "접수일", w: 96 },
  { key: "ctype", label: "민원유형", w: 84 },
  { key: "area", label: "지역", w: 64 },
  { key: "place", label: "위치", w: 116 },
  { key: "person", label: "민원인", w: 60 },
  { key: "phone", label: "연락처", w: 120 },
  { key: "body", label: "내용", w: null },
  { key: "action", label: "조치내용", w: null },
  { key: "due", label: "마감일", w: 130 },
  { key: "status", label: "상태", w: 72 },
  { key: "done", label: "조치완료일", w: 130 },
  { key: "memo", label: "메모", w: 40 },
];

/** 내용·조치내용의 가장 좁은 폭 */
export const FLEX_MIN = 140;
export const COL_MIN = 40;

export const defaultWidths = () => COLUMNS.map((c) => c.w);

/** 0.6.x~0.9.x의 처음 폭. "열 너비 초기화"로 이 값이 저장돼 있으면 새 처음 폭으로 읽어요. */
const OLD_DEFAULT = [52, 108, 106, 100, 76, 132, 76, 128, null, null, 150, 100, 48];

/** 저장해 둔 열 너비를 읽어요. 모양이 맞지 않거나 예전 처음 폭이면 새 처음 폭이에요. */
export function readWidths(raw: string | null): (number | null)[] {
  try {
    const v = JSON.parse(raw ?? "");
    // 조치완료일이 생기기 전(13열)에 저장한 폭이면 상태 뒤에 처음 폭을 끼워요(예전 처음 폭이면 새 처음 폭).
    if (Array.isArray(v) && v.length === COLUMNS.length - 1) {
      if (v.every((x, i) => x === OLD_DEFAULT[i])) return defaultWidths();
      v.splice(12, 0, 130);
    }
    if (Array.isArray(v) && v.length === COLUMNS.length && v.every((x) => x === null || (typeof x === "number" && x >= COL_MIN))) {
      // 폭 고정 열은 2026-10-19 23:04 사용자가 되돌렸어요(고정이 오히려 불편) – 모든 열을 끌어 바꿀 수 있어요.
      return v;
    }
  } catch {
    /* 처음 폭으로 */
  }
  return defaultWidths();
}

/**
 * 표 폭(avail)에 맞춰 보이는 폭을 정해요. 고정 열 + 내용·조치내용 최소 폭이 표 폭을 넘으면
 * 고정 열을 같은 비율로 줄여요(가장 좁게 COL_MIN). 저장된 값은 그대로 두어 창을 넓히면 다시 원래 폭이에요.
 */
export function fitWidths(ws: (number | null)[], avail: number): (number | null)[] {
  if (!(avail > 0)) return ws;
  const flex = ws.filter((w) => w === null).length * FLEX_MIN;
  const total = ws.reduce<number>((a, w) => a + (w ?? 0), 0);
  if (total + flex <= avail) return ws;
  // 폭이 정해진 열은 줄이지 않고, 나머지 열만 같은 비율로 줄여요.
  const locked = ws.reduce<number>((a, w, i) => a + (COLUMNS[i]?.fixed && w !== null ? w : 0), 0);
  const free = total - locked;
  if (free <= 0) return ws;
  const k = Math.max(0, avail - flex - locked) / free;
  return ws.map((w, i) => (w === null || COLUMNS[i]?.fixed ? w : Math.max(COL_MIN, Math.floor(w * k))));
}

export function gridTemplate(ws: (number | null)[], flexMin = FLEX_MIN): string {
  return ws.map((w) => (w === null ? `minmax(${flexMin}px, 1fr)` : `${w}px`)).join(" ");
}

/** 민원대장 내용·조치내용이 모자랄 때 줄어들 수 있는 가장 좁은 폭(2026-10-19 사용자: 모자라면 내용·조치내용도 줄어야지) */
export const FLEX_SQUEEZE = 80;

/**
 * 민원대장 열 맞추기(2026-10-19 사용자): 표 폭이 모자라면 먼저 내용·조치내용을 140 → 80까지 줄이고,
 * 그래도 모자랄 때만 다른 열(폭 고정 열 빼고)을 같은 비율로 줄여요 – 다른 칸이 두 줄로 넘어가는 일을 가장 늦게.
 */
export function fitComplaintCols(ws: (number | null)[], avail: number): { ws: (number | null)[]; flexMin: number } {
  const nFlex = ws.filter((w) => w === null).length;
  if (!(avail > 0) || nFlex === 0) return { ws, flexMin: FLEX_MIN };
  const total = ws.reduce<number>((a, w) => a + (w ?? 0), 0);
  const each = Math.floor((avail - total) / nFlex);
  if (each >= FLEX_SQUEEZE) return { ws, flexMin: Math.min(FLEX_MIN, each) };
  const locked = ws.reduce<number>((a, w, i) => a + (COLUMNS[i]?.fixed && w !== null ? w : 0), 0);
  const free = total - locked;
  if (free <= 0) return { ws, flexMin: FLEX_SQUEEZE };
  const k = Math.max(0, avail - nFlex * FLEX_SQUEEZE - locked) / free;
  return {
    ws: ws.map((w, i) => (w === null || COLUMNS[i]?.fixed ? w : Math.max(COL_MIN, Math.floor(w * k)))),
    flexMin: FLEX_SQUEEZE,
  };
}

export const minWidth = (ws: (number | null)[]) => ws.reduce<number>((a, w) => a + (w ?? FLEX_MIN), 0);

/** 열 하나를 끌어 넓힐 수 있는 가장 큰 폭(다른 열과 내용·조치내용 최소 폭을 빼고) */
export function maxWidthOf(ws: (number | null)[], i: number, avail: number, base: number[]): number {
  const others = ws.reduce<number>((a, w, j) => a + (j === i ? 0 : w === null ? FLEX_MIN : base[j]), 0);
  return Math.max(COL_MIN, Math.floor(avail - others));
}

// ---------- 열 필터 (2026-10-17 사용자 확정, 시안 ComplaintFilter.dc.html) ----------

/** 거를 수 있는 열. 상태 칩과 상태 열 필터는 같은 필터예요. */
export type FilterKey = "intake" | "ctype" | "area" | "status";
export const FILTER_KEYS: FilterKey[] = ["intake", "ctype", "area", "status"];

/** 열마다 null = 모두, 배열 = 고른 값만(빈 배열이면 아무것도 안 보여요) */
export type ColFilters = Record<FilterKey, string[] | null>;
export const NO_FILTERS: ColFilters = { intake: null, ctype: null, area: null, status: null };

/** 모든 필터를 통과하는지(AND). skip 열은 보지 않아요(그 열 목록의 개수를 셀 때). */
export function passes(c: Complaint, f: ColFilters, skip?: FilterKey): boolean {
  return FILTER_KEYS.every((k) => k === skip || f[k] === null || f[k]!.includes(c[k]));
}

/** 열에 있는 값들 (빈 지역은 ""로 – 목록에서는 "(빈 칸)") */
export function filterValues(list: Complaint[], k: FilterKey): string[] {
  return [...new Set(list.map((c) => c[k]))];
}

/** 저장해 둔 상태 필터를 읽어요. */
export function readStatusFilter(raw: string | null): string[] | null {
  try {
    const v = JSON.parse(raw ?? "null");
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  } catch {
    /* 모두 */
  }
  return null;
}
