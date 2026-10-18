// 집행현황(12단계) 규칙 함수. 계산은 저장하지 않고 여기서 해요(엑셀은 같은 규칙을 수식으로 — core budget_xlsx.rs).
// 정한 것(2026-10-18 사용자):
//   완료·타절 = 끝난 공사(FINAL), 준비·추진·중지 = 진행 중
//   잔액 = 원인행위 − (끝났으면 지출액, 아니면 실집행액)
//   집행률 = Σ(끝났으면 지출액, 아니면 실집행액) ÷ 예산
//   가용액 = 예산 − Σ(끝났으면 max(원인행위, 지출액), 아니면 원인행위) — 예산의 10% 아래면 붉게
//   공사 줄 집행률은 원인행위 대비(회색 막대), 공사 줄 가용액은 빈칸
//   금액은 원 단위 정수(십원 단위부터). 화면 단위 원/천원 — 천원은 반올림한 정수만 보여요.
import { BKind, linesToText, BLine } from "./bullets";
import { sanitize } from "./RichMemo";

export const KINDS = ["공사", "관급", "용역", "일반"] as const;
export const STAGES = ["준비", "추진", "완료", "중지", "타절"] as const;
export type Kind = (typeof KINDS)[number];
export type Stage = (typeof STAGES)[number];

export type BudgetRow = { id: number; name: string; kind: string; co: string; cmt: number; exp: number; act: number; stage: string; memo: string };
export type BudgetItem = { id: number; name: string; budget: number | null; open: boolean; memo: string; rows: BudgetRow[] };
export type BudgetProject = { id: number; year: number; name: string; budget: number | null; carry: boolean; open: boolean; memo: string; items: BudgetItem[] };
export type BudgetRowInput = { name: string; kind: string; co: string; cmt: number; exp: number; act: number; stage: string };
export type BudgetLevel = "project" | "item" | "row";

export const FINAL = (st: string) => st === "완료" || st === "타절";
export const spent = (r: BudgetRow) => (FINAL(r.stage) ? r.exp : r.act);
export const balance = (r: BudgetRow) => r.cmt - spent(r);
export const tied = (r: BudgetRow) => (FINAL(r.stage) ? Math.max(r.cmt, r.exp) : r.cmt);
/** 공사 줄 집행률(원인행위 대비). 원인행위가 0이면 없음. */
export const rowRate = (r: BudgetRow) => (r.cmt ? (spent(r) / r.cmt) * 100 : null);

export type Sums = { cmt: number; exp: number; act: number; bal: number; rate: number | null; avail: number | null; low: boolean; done: number; n: number };

export function sums(budget: number | null, rows: BudgetRow[]): Sums {
  let cmt = 0, exp = 0, act = 0, bal = 0, sp = 0, t = 0, done = 0;
  for (const r of rows) {
    cmt += r.cmt;
    exp += r.exp;
    act += r.act;
    bal += balance(r);
    sp += spent(r);
    t += tied(r);
    if (FINAL(r.stage)) done++;
  }
  const avail = budget == null ? null : budget - t;
  return { cmt, exp, act, bal, rate: budget ? (sp / budget) * 100 : null, avail, low: budget ? (avail as number) < budget * 0.1 : false, done, n: rows.length };
}

export const allRows = (p: BudgetProject) => p.items.flatMap((i) => i.rows);
/** 진행 중인 공사 먼저, 완료·타절은 아래 */
export const sortRows = (rows: BudgetRow[]) => [...rows.filter((r) => !FINAL(r.stage)), ...rows.filter((r) => FINAL(r.stage))];
export const matchRow = (r: BudgetRow, q: string) => !q || (r.name + " " + r.co).toLowerCase().includes(q.toLowerCase());

// ---------- 금액 ----------
export type Unit = 1 | 1000;

/** 보이는 글자: 원은 그대로, 천원은 반올림한 정수(2026-10-18 사용자). 음수는 −. */
export function fmt(v: number | null | undefined, unit: Unit): string {
  if (v == null) return "";
  const n = unit === 1 ? Math.abs(Math.round(v)) : Math.round(Math.abs(v) / 1000);
  return (v < 0 && n !== 0 ? "−" : "") + n.toLocaleString("ko-KR");
}

/** 적은 글자 → 원. 비면 null. 고른 단위의 정수만 받아요. */
export function parseWon(s: string, unit: Unit): number | null {
  const neg = /^\s*[-−]/.test(s);
  const t = s.replace(/[^\d]/g, "");
  if (!t) return null;
  const n = Number(t) * unit;
  return neg ? -n : n;
}

/** 치는 동안 천 단위 쉼표 */
export function typing(raw: string): string {
  const neg = /^\s*[-−]/.test(raw);
  const t = raw.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
  return (neg ? "-" : "") + (t ? Number(t).toLocaleString("ko-KR") : "");
}

export const okWon = (v: number | null) => v == null || v % 10 === 0;

// ---------- 메모 ----------

/** 메모 HTML → 글자(엑셀·풍선). 머릿기호는 □ ○ - 글자와 띄어쓰기 두 칸(복사 규칙과 같아요). */
export function memoToText(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(`<div>${sanitize(html)}</div>`, "text/html");
  const out: string[] = [];
  const kindOfLi = (li: Element): BKind =>
    li.classList.contains("nb") ? "none" : li.classList.contains("k-sq") ? "sq" : li.classList.contains("k-da") ? "da" : "ci";
  for (const el of [...doc.body.firstElementChild!.children]) {
    if (el.tagName === "UL") {
      const lines: BLine[] = [...el.children].map((li) => {
        const k = kindOfLi(li);
        const l: BLine = { t: (li.textContent ?? "").replace(/ /g, " ").trim() };
        if (k !== "ci") l.k = k;
        return l;
      });
      out.push(linesToText(lines));
    } else if (el.tagName === "OL") {
      [...el.children].forEach((li, i) => out.push(`${i + 1}. ${(li.textContent ?? "").trim()}`));
    } else {
      out.push((el.textContent ?? "").replace(/ /g, " ").trimEnd());
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** 글자 → 메모 HTML(엑셀 가져오기). □ ○ - 로 시작하는 줄은 머릿기호 목록. */
export function textToMemo(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let ul: string[] = [];
  const flush = () => {
    if (ul.length) html.push(`<ul>${ul.join("")}</ul>`);
    ul = [];
  };
  for (const raw of lines) {
    const m = /^[ \t　]*([□■○●•·\-])\s+(.*)$/.exec(raw);
    if (m) {
      const cls = "□■".includes(m[1]) ? ' class="k-sq"' : m[1] === "-" ? ' class="k-da"' : "";
      ul.push(`<li${cls}>${escHtml(m[2].trim())}</li>`);
    } else {
      flush();
      if (raw.trim()) html.push(`<p>${escHtml(raw.trim())}</p>`);
    }
  }
  flush();
  return html.join("");
}
