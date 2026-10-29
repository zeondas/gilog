// 집행현황(12단계) 규칙 함수. 계산은 저장하지 않고 여기서 해요(엑셀은 같은 규칙을 수식으로 – core budget_xlsx.rs).
// 계산 규칙(2026-10-28 15:55 집행현황 계산 세션, 사용자 ①②③④ 1안 – 돈만으로 계산, 화면 위 [집행률 · 시공량] 보기 단추):
//   쓴 돈(spent) = 집행률 보기면 집행액, 시공량 보기면 시공량(사용량) – 끝난 공사도 같아요, 시공량 0은 0 그대로
//   공사 줄 잔액 = 원인행위 − 쓴 돈, 공사 줄 막대 = 쓴 돈 ÷ 원인행위(회색), 공사 줄 가용액은 빈칸
//   합계 줄 잔액 = 공사 줄 잔액 합, 합계 줄 비율 = Σ쓴 돈 ÷ 예산(집행률 보기 "집행률", 시공량 보기 "사용률")
//   가용액 = 예산 − Σ(완료·타절이면 집행액, 아니면 원인행위) – 보기와 상관없어요, 0 아래(초과)면 붉게
//   (0.49.0은 단추 없이 단계로 정했고 – 진행 중 시공량·끝남 집행액 – 그 전엔 가용액이 완료면 max(원인행위, 집행액)였어요)
//   금액은 원 단위 정수(십원 단위부터). 화면 단위 원/천원 – 천원은 반올림한 정수만 보여요.
import { BKind, linesToText, BLine } from "./bullets";
import { looksLikeMemoHtml, sanitize } from "./RichMemo";

export const KINDS = ["공사", "관급", "용역", "일반"] as const;
export const STAGES = ["준비", "추진", "완료", "중지", "타절"] as const;
export type Kind = (typeof KINDS)[number];
export type Stage = (typeof STAGES)[number];

/** uid: 팀 공유에서 PC 사이 같은 줄을 찾는 이름(core가 만들 때 정해요). owner: 세부사업 담당(함께 쓰는 사람 번호). */
export type BudgetRow = { id: number; name: string; kind: string; co: string; cmt: number; exp: number; act: number; stage: string; memo: string; uid: string };
export type BudgetItem = { id: number; name: string; budget: number | null; open: boolean; memo: string; rows: BudgetRow[]; uid: string };
export type BudgetProject = { id: number; year: number; name: string; budget: number | null; carry: boolean; open: boolean; memo: string; items: BudgetItem[]; uid: string; owner: number | null };
export type BudgetRowInput = { name: string; kind: string; co: string; cmt: number; exp: number; act: number; stage: string };
export type BudgetLevel = "project" | "item" | "row";

export const FINAL = (st: string) => st === "완료" || st === "타절";
/** 보기(2026-10-28 15:55 사용자): 집행률(exp) 또는 시공량(act) – 화면 위 단추, 고른 것은 kv budget.view */
export type View = "exp" | "act";
export const VIEW_LABEL: Record<View, string> = { exp: "집행률", act: "시공량" };
/** 합계 줄 비율 열 머리 글자 */
export const RATE_LABEL: Record<View, string> = { exp: "집행률", act: "사용률" };
/** 원인행위 열 이름(2026-10-28 21:58 사용자): 시공량 보기에서는 "계약금액" – 값·계산은 같아요 */
export const CMT_LABEL: Record<View, string> = { exp: "원인행위", act: "계약금액" };
/** 쓴 돈: 집행률 보기면 집행액, 시공량 보기면 시공량(사용량) */
export const spent = (r: BudgetRow, v: View = "exp") => (v === "act" ? r.act : r.exp);
export const balance = (r: BudgetRow, v: View = "exp") => r.cmt - spent(r, v);
/** 가용액에서 빠지는 돈: 끝난 공사는 집행액(확정), 진행 중은 원인행위(앞으로 나갈 돈) – 보기와 상관없어요 */
export const tied = (r: BudgetRow) => (FINAL(r.stage) ? r.exp : r.cmt);
/** 공사 줄 막대 = 쓴 돈 ÷ 원인행위. 원인행위가 0이면 없음. */
export const rowRate = (r: BudgetRow, v: View = "exp") => (r.cmt ? (spent(r, v) / r.cmt) * 100 : null);

export type Sums = { cmt: number; exp: number; act: number; bal: number; rate: number | null; avail: number | null; low: boolean; done: number; n: number };

export function sums(budget: number | null, rows: BudgetRow[], v: View = "exp"): Sums {
  let cmt = 0, exp = 0, act = 0, bal = 0, t = 0, done = 0;
  for (const r of rows) {
    cmt += r.cmt;
    exp += r.exp;
    act += r.act;
    bal += balance(r, v);
    t += tied(r);
    if (FINAL(r.stage)) done++;
  }
  const avail = budget == null ? null : budget - t;
  const used = v === "act" ? act : exp;
  return { cmt, exp, act, bal, rate: budget ? (used / budget) * 100 : null, avail, low: avail != null && avail < 0, done, n: rows.length };
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
  // 예전에 메모를 태그째 내보낸 엑셀("<ul><li>…</li></ul>")은 글자가 아니라 메모로 읽어요(2026-10-28 사용자)
  if (looksLikeMemoHtml(text)) return sanitize(text);
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
