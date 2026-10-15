// 민원대장 화면이 쓰는 규칙들이에요. 화면 그리기와 떼어 두어 업무일지 "챙길 일"에서도 같이 써요.
import type { Complaint } from "./api";
import { plainOf } from "./bullets";
import { parseMemo } from "./ContactsScreen";
import { initials, isChosung, koIndex, splitJamo } from "./journal";
import { DONE_STATUS } from "./settingsStore";

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
  if (!c.due || c.status === DONE_STATUS) return null;
  return daysBetween(today, c.due);
}

/** 3 → "D-3", 0 → "D-day", -2 → "D+2" */
export function ddayText(n: number): string {
  return n > 0 ? `D-${n}` : n === 0 ? "D-day" : `D+${-n}`;
}

/** 임박(설정의 기준 안이거나 지났음)인지 */
export const isUrgent = (n: number, urgentDays: number) => n <= urgentDays;

/** 업무일지 "챙길 일": 마감이 within일 안이거나 지난, 완료가 아닌 민원. 마감이 빠른 것이 위예요. */
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
  const hay = [String(c.no), c.intake, c.received, c.ctype, c.area, c.place, c.person, c.phone, plainOf(c.body), plainOf(c.action), c.due, c.status, memo]
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
  | "phone" | "body" | "action" | "due" | "status" | "memo";

/** 사양서 순서 13열. w가 null인 열(내용·조치내용)은 남는 폭을 나눠 가져요(최소 220px). */
export const COLUMNS: { key: ColKey; label: string; w: number | null }[] = [
  { key: "no", label: "연번", w: 52 },
  { key: "intake", label: "접수유형", w: 108 },
  { key: "received", label: "접수일", w: 106 },
  { key: "ctype", label: "민원유형", w: 100 },
  { key: "area", label: "지역", w: 76 },
  { key: "place", label: "위치", w: 132 },
  { key: "person", label: "민원인", w: 76 },
  { key: "phone", label: "연락처", w: 128 },
  { key: "body", label: "내용", w: null },
  { key: "action", label: "조치내용", w: null },
  { key: "due", label: "마감일", w: 150 },
  { key: "status", label: "상태", w: 100 },
  { key: "memo", label: "메모", w: 48 },
];

export const FLEX_MIN = 220;
export const COL_MIN = 40;

export const defaultWidths = () => COLUMNS.map((c) => c.w);

/** 저장해 둔 열 너비를 읽어요. 모양이 맞지 않으면 처음 폭이에요. */
export function readWidths(raw: string | null): (number | null)[] {
  try {
    const v = JSON.parse(raw ?? "");
    if (Array.isArray(v) && v.length === COLUMNS.length && v.every((x) => x === null || (typeof x === "number" && x >= COL_MIN))) return v;
  } catch {
    /* 처음 폭으로 */
  }
  return defaultWidths();
}

export function gridTemplate(ws: (number | null)[]): string {
  return ws.map((w) => (w === null ? `minmax(${FLEX_MIN}px, 1fr)` : `${w}px`)).join(" ");
}

export const minWidth = (ws: (number | null)[]) => ws.reduce<number>((a, w) => a + (w ?? FLEX_MIN), 0);
