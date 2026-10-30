// 집행현황 조각들이 함께 쓰는 열 목록·키 이름·타입·돈 모양·그림.
import type { BudgetLevel, Unit, View } from "../../budget";
import { fmt, okWon, parseWon } from "../../budget";

export type ColId = "name" | "kind" | "co" | "bud" | "cmt" | "exp" | "act" | "bal" | "rate" | "avail" | "stage" | "owner" | "memo";
export const COLS: [ColId, string, number][] = [
  ["name", "세부사업", 336],
  ["kind", "구분", 56],
  ["co", "업체(하도)", 96],
  ["bud", "예산", 112],
  ["cmt", "원인행위", 112],
  ["exp", "집행액", 112],
  ["act", "시공량(사용량)", 112],
  ["bal", "잔액", 118],
  ["rate", "집행률", 90],
  ["avail", "가용액", 118],
  ["stage", "단계", 64],
  // 팀 공유(2026-10-20 사용자): 단계 뒤·메모 앞, 세부사업 줄에만 한 명 – 공유를 켜지 않으면 열이 없어요
  ["owner", "담당", 76],
  ["memo", "메모", 36],
];
export const COLS_SOLO = COLS.filter(([c]) => c !== "owner");
export const FIXED = new Set<ColId>(["kind", "rate", "stage", "owner", "memo"]);
/** 끈 열만 px(헤더 열 조정 통일 2026-10-28) – 같은 이름의 옛 모양 `{w, nameFixed}`는 읽지 않아요(cols.ts readColPx) */
export const COLS_KEY = "budget.cols";
export const UNIT_KEY = "budget.unit";
export const VIEW_KEY = "budget.view";
/** 보기마다 숨는 열(2026-10-28 15:55 사용자): 집행률 보기는 시공량, 시공량 보기는 집행액 */
export const HIDE_OF: Record<View, ColId> = { exp: "act", act: "exp" };

/** 고른 줄: p12(세부사업)·i3(부기사업)·g7(공사) */
export type Sel = string | null;
export const selKey = (level: BudgetLevel, id: number) => (level === "project" ? "p" : level === "item" ? "i" : "g") + id;

/** 숫자 칸 여러 개 고르기(엑셀처럼) – 칸 = "고른 줄:열 번호"(예 g7:5), anchor = Shift 기준 칸 (2026-10-18 사용자) */
export type Cells = { keys: string[]; anchor: string | null };
export const NO_CELLS: Cells = { keys: [], anchor: null };
export const NUM_COLS: ColId[] = ["bud", "cmt", "exp", "act", "bal", "avail"];
export const NUM_IX = NUM_COLS.map((c) => COLS.findIndex(([x]) => x === c));

/** 줄 안 입력(새로 더하기·고치기). 금액은 적은 글자와 원래 값(손대지 않았으면 원래 원 값 그대로) */
export type Money = { text: string; orig: number | null };
export type Form =
  | { level: "project"; id: number | null; after: number | null; name: string; budget: Money }
  | { level: "item"; id: number | null; project: number; name: string; budget: Money }
  | { level: "row"; id: number | null; item: number; name: string; kind: string; co: string; cmt: Money; exp: Money; act: Money; stage: string };

export type Pop =
  | { t: "menu"; x: number; y: number; level: BudgetLevel; id: number }
  | { t: "confirm"; x: number; y: number; level: BudgetLevel; id: number }
  | { t: "stage"; x: number; y: number; id: number | "form"; from: string }
  | { t: "kind"; x: number; y: number; from: string }
  | { t: "memo"; x: number; y: number; level: BudgetLevel; id: number }
  | { t: "excel"; x: number; y: number }
  | { t: "owner"; x: number; y: number; id: number }
  | { t: "cf"; x: number; y: number; uid: string; field: string };

export const ICON = (d: string, s = 14, w = 2) => (
  <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);
export const CD = "M6 9l6 6 6-6",
  CR = "M9 6l6 6-6 6",
  PLUS = "M12 5v14M5 12h14";

export const money = (v: number | null, unit: Unit): Money => ({ text: v == null ? "" : fmt(v, unit).replace("−", "-"), orig: v });
/** 적은 금액 → 원. 원래 글자 그대로면 원래 값. 잘못이면 undefined */
export function moneyOf(m: Money, unit: Unit): number | null | undefined {
  if (m.orig != null && m.text === fmt(m.orig, unit).replace("−", "-")) return m.orig;
  const v = parseWon(m.text, unit);
  return okWon(v) ? v : undefined;
}

export const KIND_CLASS: Record<string, string> = { 공사: "k-gong", 관급: "k-gwan", 용역: "k-yong", 일반: "k-il" };
export const STAGE_CLASS: Record<string, string> = { 준비: "s-jun", 추진: "s-chu", 완료: "s-wan", 중지: "s-jung", 타절: "s-ta" };
