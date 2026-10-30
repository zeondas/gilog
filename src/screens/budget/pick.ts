// 집행현황 숫자 칸 여러 개 고르기(엑셀처럼) – 고른 칸의 개수·합계·차이.
import { MouseEvent as RMouseEvent } from "react";
import { balance, BudgetRow, sums } from "../../budget";
import { ColId, NO_CELLS, NUM_IX } from "./parts";
import type { useBudgetCells } from "./Table";

export function useBudgetPick(c: ReturnType<typeof useBudgetCells>) {
  const { VC, findRow, view, findP, budgetOf, pRows, findItem, rowsOf, setCs, form, cs, hideIx, unit } = c;

  // ---------- 숫자 칸 여러 개 고르기 ----------
  /** 칸 값(원). 화면에 보이는 계산과 같아요(고치는 중이면 치는 값으로). */
  const cellVal = (k: string, ci: number): number | null => {
    const col = VC[ci]?.[0];
    const id = Number(k.slice(1));
    if (k[0] === "g") {
      const x = findRow(id);
      if (!x) return null;
      const r = x.r;
      const v: Partial<Record<ColId, number>> = { cmt: r.cmt, exp: r.exp, act: r.act, bal: balance(r, view) };
      return v[col] ?? null;
    }
    let budget: number | null;
    let rows: BudgetRow[];
    if (k[0] === "p") {
      const p = findP(id);
      if (!p) return null;
      budget = budgetOf("project", p);
      rows = pRows(p);
    } else {
      const x = findItem(id);
      if (!x) return null;
      budget = budgetOf("item", x.it);
      rows = rowsOf(x.it);
    }
    const t = sums(budget, rows, view);
    const v: Partial<Record<ColId, number | null>> = { bud: budget, cmt: t.cmt, exp: t.exp, act: t.act, bal: t.bal, avail: t.avail };
    return v[col] ?? null;
  };
  /** 그냥 누르기 = 그 칸 하나(기준), Ctrl = 하나씩 더하기·빼기, Shift = 기준에서 여기까지 네모(Ctrl+Shift = 더하기) */
  const pickCell = (e: RMouseEvent) => {
    const c = (e.target as Element).closest(".bd-c");
    const rw = c?.parentElement;
    const sk = rw?.getAttribute("data-sel");
    const mod = e.ctrlKey || e.metaKey;
    if (!c || !rw || !sk || rw.classList.contains("edit") || (e.target as Element).closest("button, input, [contenteditable]")) {
      if (!mod && !e.shiftKey && e.detail === 1) setCs(NO_CELLS);
      return;
    }
    if (mod || e.shiftKey) {
      e.stopPropagation(); // 줄 고르기·고치기로 가지 않게
      if (form) return;
    } else if (e.detail !== 1) return;
    const ci = Array.prototype.indexOf.call(rw.children, c) as number;
    if (!NUM_IX.includes(ci)) {
      if (!mod && !e.shiftKey) setCs(NO_CELLS);
      return;
    }
    const key = sk + ":" + ci;
    if (e.shiftKey && cs.anchor) {
      const order = [...document.querySelectorAll(".bd-body .bd-rw[data-sel]:not(.edit)")].map((x) => x.getAttribute("data-sel"));
      const [ak, aci] = cs.anchor.split(":");
      const a = order.indexOf(ak);
      const b = order.indexOf(sk);
      if (a < 0 || b < 0) {
        setCs({ keys: [key], anchor: key });
        return;
      }
      const [r0, r1] = [Math.min(a, b), Math.max(a, b)];
      const [c0, c1] = [Math.min(+aci, ci), Math.max(+aci, ci)];
      const keys = new Set(mod ? cs.keys : [cs.anchor]); // 기준 칸이 먼저(차액 = 먼저 − 나중)
      for (let i = r0; i <= r1; i++) for (const n of NUM_IX) if (n >= c0 && n <= c1 && n !== hideIx) keys.add(order[i] + ":" + n);
      setCs({ keys: [...keys], anchor: cs.anchor });
    } else if (mod) {
      setCs({ keys: cs.keys.includes(key) ? cs.keys.filter((x) => x !== key) : [...cs.keys, key], anchor: key });
    } else setCs({ keys: [key], anchor: key });
  };
  let csN = 0;
  let csSum = 0;
  const csVals: number[] = [];
  for (const k of cs.keys) {
    const [sk, ci] = k.split(":");
    const v = cellVal(sk, Number(ci));
    if (v != null) {
      csN++;
      csSum += v;
      csVals.push(v);
    }
  }
  /** 두 칸만 골랐을 때 차액 = 먼저 누른 칸 − 나중에 누른 칸 */
  const csDiff = csVals.length === 2 ? csVals[0] - csVals[1] : null;
  const won = unit === 1000 ? " 천원" : " 원";
  const csStyle = cs.keys.length
    ? cs.keys
        .map((k) => {
          const [sk, ci] = k.split(":");
          return `.bd-body .bd-rw[data-sel="${sk}"]>.bd-c:nth-child(${Number(ci) + 1})`;
        })
        .join(",") + "{background:var(--accent-tint);box-shadow:inset 0 0 0 1px var(--accent);color:var(--ink)}"
    : "";
  return { ...c, cellVal, pickCell, csN, csSum, csVals, csDiff, won, csStyle };
}
