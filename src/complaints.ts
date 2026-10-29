// 민원대장 화면이 쓰는 규칙들이에요. 화면 그리기와 떼어 두어 업무일지 "챙길 일"에서도 같이 써요.
import type { Complaint } from "./api";
import { plainOf } from "./bullets";
import { parseMemo } from "./screens/contacts/parts";
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
  // 번호는 민원인 칸에 함께 적어요(2026-10-21 민원인 한 칸) – 민원인·예전 연락처 칸 숫자에서 찾아요.
  return digits.length >= 3 && digits === q.replace(/[-\s]/g, "") && (c.person + " " + c.phone).replace(/[^0-9]/g, "").includes(digits);
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
  | "no" | "intake" | "received" | "ctype" | "place" | "person"
  | "body" | "action" | "due" | "status" | "done" | "memo";

/**
 * 사양서 순서 12열(2026-10-21 사용자 – 지역은 위치 칸에 합치고, 민원인·연락처는 "민원인" 한 칸).
 * 처음 폭은 `layoutCols`가 글 폭·창 폭으로 정해요(w는 예전 값 – 쓰지 않아요).
 */
export const COLUMNS: { key: ColKey; label: string; w: number | null; fixed?: boolean }[] = [
  { key: "no", label: "연번", w: 52 },
  { key: "intake", label: "접수유형", w: 92 },
  { key: "received", label: "접수일", w: 96 },
  { key: "ctype", label: "민원유형", w: 84 },
  { key: "place", label: "위치", w: 140 },
  { key: "person", label: "민원인", w: 120 },
  { key: "body", label: "내용", w: null },
  { key: "action", label: "조치내용", w: null },
  { key: "due", label: "마감일", w: 130 },
  { key: "status", label: "상태", w: 80 },
  { key: "done", label: "조치완료일", w: 130 },
  { key: "memo", label: "메모", w: 48 },
];

/** 표 폭을 아직 모를 때 내용·조치내용 처음 폭 */
export const FLEX_MIN = 140;

// ---------- 민원대장 열 폭(2026-10-21 사용자 결정 – 시안 ComplaintCols.dc.html 시안 4·5·최대화) ----------

/** 열마다 들어갈 것의 폭(칸 여백 빼고). short = 줄인 모양, more = 넓은 창에서 더 받을 수 있는 폭(민원인). */
export type ColNeed = { full: number; short?: number; more?: number };

/** 기본 창에서 열마다 같은 여유(칸 여백 좌우 10 포함, 2026-10-21 15:35 사용자) */
export const COL_SLACK = 28;
/** 내용·조치내용이 이만큼(표 폭 비율) 못 받으면 하나씩 줄여요 */
export const CONTENT_SHARE = 0.45;
/** 칸 좌우 여백 합(styles/*.css .cm-c padding 0 10px) */
const CELL_PAD = 20;
/** 다 줄여도 이보다 적으면 다른 열의 여유를 줄여요 */
export const CONTENT_FLOOR = 0.4;
/** 줄이는 순서(2026-10-21 사용자): 마감일 날짜 → 접수일 26-10-16 → 접수유형 두 글자 → 위치 읍면. 넓히면 거꾸로 풀려요. */
export const SHORT_ORDER: ColKey[] = ["due", "received", "intake", "place"];
/** 내용·조치내용 가장 좁은 폭 */
export const CONTENT_MIN = 80;

export type ColLayout = {
  /** 열마다 처음 폭(COLUMNS 순서 키) – 내용·조치내용은 창(표) 폭에 맞춘 값 */
  init: Record<ColKey, number>;
  /** 줄인 모양으로 보이는 열 */
  short: Set<ColKey>;
};

/** 긴 글 열(내용·조치내용) – 처음 값만 창 폭에 맞춰요(헤더 열 조정 통일 ✔3①) */
export const FLEXED: ColKey[] = ["body", "action"];

/**
 * 민원대장 열 처음 폭을 정해요(2026-10-21 사용자 ①~⑨, 헤더 열 조정 통일 10-28 ✔3①로 "처음 값 계산"만).
 * - 내용·조치내용을 뺀 열 = 들어갈 것의 폭 + 같은 여유 28.
 * - 내용·조치내용이 표 폭의 45%를 못 받으면 SHORT_ORDER대로 하나씩 줄인 모양으로 바꿔요.
 * - 다 풀린 넓은 창이면 남는 폭(40% 넘는 만큼)을 민원인에 더 줘요(more까지).
 * - 다 줄여도 40%가 안 되면 다른 열의 여유를 22(칸 여백 + 2)까지 줄이고, 그래도 모자라면 내용·조치내용이 80까지 줄어요.
 * - 내용·조치내용 처음 값 = 남는 폭 반씩. 다른 열을 끌어도 처음 값은 그대로예요(총폭이 늘고 가로 스크롤).
 * - user(끈 열 px)는 줄인 모양만 정해요: 그 폭이 들어갈 것 + 12보다 좁으면 줄인 모양(2026-10-28 사용자 1안).
 */
export function layoutCols(needs: Partial<Record<ColKey, ColNeed>>, avail: number, user: Partial<Record<ColKey, number>> = {}): ColLayout {
  const keys = COLUMNS.map((c) => c.key);
  const fixed = keys.filter((k) => !FLEXED.includes(k));
  const need = (k: ColKey): ColNeed => needs[k] ?? { full: 40 };
  const widthAt = (k: ColKey, short: Set<ColKey>) => {
    const n = need(k);
    return Math.ceil((short.has(k) && n.short != null ? n.short : n.full) + COL_SLACK);
  };
  const sumOf = (short: Set<ColKey>) => fixed.reduce((a, k) => a + widthAt(k, short), 0);

  let short = new Set<ColKey>();
  let level = 0;
  if (avail > 0) {
    for (level = 0; level <= SHORT_ORDER.length; level++) {
      short = new Set(SHORT_ORDER.slice(0, level));
      if (avail - sumOf(short) >= CONTENT_SHARE * avail) break;
    }
    if (level > SHORT_ORDER.length) level = SHORT_ORDER.length;
    short = new Set(SHORT_ORDER.slice(0, level));
  }
  const w = {} as Record<ColKey, number>;
  for (const k of fixed) w[k] = widthAt(k, short);

  if (avail > 0) {
    let content = avail - sumOf(short);
    // 다 풀린 넓은 창: 민원인에 조금 더(최대화에서 "김영수 010-4321-8765"가 생략 없이).
    const p = need("person");
    if (level === 0 && p.more && p.more > p.full) {
      const extra = Math.max(0, Math.min(p.more - p.full, content - CONTENT_FLOOR * avail));
      w.person += Math.floor(extra);
      content -= Math.floor(extra);
    }
    // 다 줄여도 모자라요: 여유를 같이 줄여요.
    const deficit = CONTENT_FLOOR * avail - content;
    if (deficit > 0) {
      // 칸 여백(좌우 10)보다 좁히면 열 제목·글자가 잘려요 – 여유는 CELL_PAD + 2까지만(2026-10-21 화면 배율).
      const each = Math.min(COL_SLACK - CELL_PAD - 2, Math.ceil(deficit / Math.max(1, fixed.length)));
      for (const k of fixed) w[k] = w[k] - each;
    }
  }
  const rest = avail > 0 ? avail - fixed.reduce((a, k) => a + w[k], 0) : 2 * FLEX_MIN;
  // 반씩(남는 1px은 조치내용이) – 처음 값의 합이 표 폭과 꼭 같게
  w.body = Math.max(CONTENT_MIN, Math.floor(rest / 2));
  w.action = Math.max(CONTENT_MIN, rest - w.body);
  // 끈 열은 폭만 보고 정해요: 다 들어가면 전체 글자, 모자라면 줄인 모양(2026-10-28 사용자 1안 – 넓혀도 "메신…"으로 남던 것).
  for (const k of fixed) {
    const n = need(k);
    const u = user[k];
    if (u == null || n.short == null) continue;
    if (u < n.full + 12) short.add(k);
    else short.delete(k);
  }
  return { init: w, short };
}

/** 90%가 들어가는 폭(드문 긴 글 때문에 열이 넓어지지 않게) */
export function p90(ws: number[]): number {
  const v = ws.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.max(0, Math.ceil(v.length * 0.9) - 1)];
}

/** 접수유형 줄인 모양: 앞 두 글자 + "…" */
export const shortIntake = (s: string) => ([...s].length > 2 ? [...s].slice(0, 2).join("") + "…" : s);
/** 2026-10-16 → 26-10-16 */
export const shortDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(2) : s);

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
