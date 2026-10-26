// 예산현황 · 계약현황 양식(v3) 가져오기 — 2026-10-26 집행·예산 연동 세션(사용자 결정 ④지출 기준·⑤계약현황 구조·⑥오래된 예산 먼저).
// 양식: [계약] 시트(계약 한 줄 — 예산연도×재원 원인행위·수수료·연도별 지급액) + [연도·재원] 시트(본예산·추경·다음연도 이월·불용).
// 하는 일: ① 시트를 읽고 ② 지급액을 그 계약의 오래된 예산(이월분)부터 배분해(당해/명시/사고 자동) ③ 해마다
// 집행현황 세부사업(본사업·"(명시이월) …"·"(사고이월) …")과 공사 줄을 만들고 ④ 예산현황 설정(재원별 예산·이월·불용·공사별 재원)을 써요.
// 집행현황에 이미 자료가 있는 해는 건너뛰어요(①1안 — 앱 자료가 기준).
import { BudgetProject } from "./budget";
import { GridSheet, ImportProject } from "./budgetExcel";
import { Manual, Setup } from "./budgetStatus";

export type V3Contract = {
  kind: string; // 공사·물품·용역(화면 종류로 바꿔요)
  name: string;
  done: boolean;
  /** 예산연도 → 재원별 원인행위(합계금액 기준) */
  pots: Record<number, Record<string, number>>;
  /** 지급한 해 → 지급액 */
  pays: Record<number, number>;
};

export type V3Parsed = {
  name: string;
  from: number;
  to: number;
  sources: string[];
  contracts: V3Contract[];
  /** "해:재원" → 직접 적는 값(본예산·1~4추·다음연도 이월·불용) */
  manual: Record<string, Manual>;
};

const num = (t: string | undefined): number => {
  const v = Number((t ?? "").replace(/[,\s원]/g, "").replace("−", "-"));
  return Number.isFinite(v) ? Math.round(v) : 0;
};
const txt = (t: string | undefined) => (t ?? "").trim();

/** 계약현황 양식인지 보고 읽어요. 아니면 null */
export function parseV3(sheets: GridSheet[]): V3Parsed | string {
  const con = sheets.find((s) => s.rows.some((r) => r.some((c) => txt(c) === "원인행위 합계")));
  const led = sheets.find((s) => s.rows.some((r) => txt(r[0]) === "연도" && txt(r[1]) === "재원"));
  if (!con || !led) return "계약현황 양식([계약]·[연도·재원] 시트)이 아니에요";
  // ---------- [계약] ----------
  const h1 = con.rows.findIndex((r) => r.some((c) => /^\d{4}년 예산/.test(txt(c))));
  if (h1 < 0 || h1 + 1 >= con.rows.length) return "[계약] 시트의 머리 줄을 찾지 못했어요";
  const r1 = con.rows[h1], r2 = con.rows[h1 + 1];
  const col = (label: string) => r1.findIndex((c) => txt(c) === label);
  const cKind = col("계약종류"), cName = col("계약명"), cSum = col("합계금액"), cDone = col("완료여부");
  if (cKind < 0 || cName < 0 || cSum < 0) return "[계약] 시트에 계약종류·계약명·합계금액 열이 없어요";
  // 예산연도 블록(블록 머리 다음 칸부터 재원 이름들)
  const blocks: { year: number; c0: number; funds: string[] }[] = [];
  r1.forEach((c, i) => {
    const m = /^(\d{4})년 예산/.exec(txt(c));
    if (!m) return;
    const funds: string[] = [];
    for (let j = i + 1; j < r2.length && txt(r2[j]) && txt(r2[j]) !== "소계"; j++) {
      if (/^\d+$/.test(txt(r2[j]))) break;
      funds.push(txt(r2[j]));
    }
    if (funds.length) blocks.push({ year: Number(m[1]), c0: i + 1, funds });
  });
  if (!blocks.length) return "[계약] 시트에 예산연도 블록이 없어요";
  const payC0 = r1.findIndex((c) => /^지급액/.test(txt(c)));
  if (payC0 < 0) return "[계약] 시트에 지급액 열이 없어요";
  const asYear = (t: string | undefined) => {
    const v = num(t);
    return v >= 1990 && v <= 2100 && /^[\d,]+$/.test(txt(t)) ? v : 0;
  };
  const payYears: { year: number; c: number }[] = [];
  for (let j = payC0; j < r2.length; j++) {
    const yv = asYear(r2[j]);
    if (yv) payYears.push({ year: yv, c: j });
  }
  if (!payYears.length) return "[계약] 시트 지급액 아래에 해(연도) 줄이 없어요";
  const contracts: V3Contract[] = [];
  for (let i = h1 + 2; i < con.rows.length; i++) {
    const r = con.rows[i];
    const name = txt(r[cName]);
    if (!name) continue;
    const pots: Record<number, Record<string, number>> = {};
    for (const b of blocks) {
      const fv: Record<string, number> = {};
      let any = false;
      b.funds.forEach((f, k) => {
        const v = num(r[b.c0 + k]);
        if (v) {
          fv[f] = v;
          any = true;
        }
      });
      if (any) pots[b.year] = fv;
    }
    const pays: Record<number, number> = {};
    for (const p of payYears) {
      const v = num(r[p.c]);
      if (v) pays[p.year] = v;
    }
    if (!Object.keys(pots).length && !Object.keys(pays).length) continue;
    contracts.push({ kind: txt(r[cKind]) || "공사", name, done: txt(cDone >= 0 ? r[cDone] : "") === "완료", pots, pays });
  }
  if (!contracts.length) return "[계약] 시트에 계약 줄이 없어요";
  // ---------- [연도·재원] ----------
  const lh = led.rows.findIndex((r) => txt(r[0]) === "연도" && txt(r[1]) === "재원");
  const lhr = led.rows[lh];
  const lcol = (label: string) => lhr.findIndex((c) => txt(c) === label);
  const cCur = lcol("본예산"), cNm = lcol("다음연도 이월(명시)"), cNs = lcol("다음연도 이월(사고)"), cUn = lcol("불용액");
  const cAdds = ["1추", "2추", "3추", "4추"].map(lcol);
  if (cCur < 0 || cNm < 0) return "[연도·재원] 시트의 열(본예산·다음연도 이월)을 찾지 못했어요";
  const manual: Record<string, Manual> = {};
  const sourcesSeen = new Set<string>();
  let y = 0;
  for (let i = lh + 1; i < led.rows.length; i++) {
    const r = led.rows[i];
    const f = txt(r[1]);
    const yv = num(r[0]);
    if (yv >= 1990 && yv <= 2100) y = yv;
    if (!f || f === "소계" || !y) continue;
    const m: Manual = {};
    const cur = num(r[cCur]);
    if (cur) m.cur = cur;
    cAdds.forEach((c, k) => {
      const v = c >= 0 ? num(r[c]) : 0;
      if (v) (m as Record<string, number>)[`a${k + 1}`] = v;
    });
    const nm = num(r[cNm]), ns = cNs >= 0 ? num(r[cNs]) : 0, un = cUn >= 0 ? num(r[cUn]) : 0;
    if (nm) m.nm = nm;
    if (ns) m.ns = ns;
    if (un) m.un = un;
    if (Object.keys(m).length) {
      manual[`${y}:${f}`] = m;
      sourcesSeen.add(f);
    }
  }
  // 재원 순서는 [계약] 블록 순서, 장부에만 있는 재원은 뒤에
  const sources = blocks[0].funds.filter((f) => sourcesSeen.has(f) || contracts.some((c) => Object.values(c.pots).some((p) => p[f])));
  for (const f of sourcesSeen) if (!sources.includes(f)) sources.push(f);
  if (!sources.length) return "재원이 하나도 없어요";
  const sheetName = txt(led.rows.find((r) => txt(r[0]) === "사업명")?.[1]) || txt(con.rows[0]?.[0]) || "";
  const years = [...new Set([...blocks.map((b) => b.year), ...payYears.map((p) => p.year)])].sort();
  const period = led.rows.flat().map(txt).find((c) => /^\d{4}~\d{4}$/.test(c));
  const from = period ? Number(period.slice(0, 4)) : years[0];
  const to = period ? Number(period.slice(5, 9)) : years[years.length - 1];
  if (!sheetName) return "[연도·재원] 시트의 사업명이 비어 있어요";
  return { name: sheetName, from, to, sources, contracts, manual };
}

/** 한 계약의 지급액을 오래된 예산(pot)부터 배분해요(⑥1안). pot 안 재원은 금액 비율(십원 반올림·마지막 재원 나머지). */
export function allocate(c: V3Contract, sources: string[]): { payYear: number; potYear: number; funds: Record<string, number>; amount: number }[] | string {
  const rem: Record<number, Record<string, number>> = {};
  for (const by of Object.keys(c.pots).map(Number)) rem[by] = { ...c.pots[by] };
  const out: { payYear: number; potYear: number; funds: Record<string, number>; amount: number }[] = [];
  for (const y of Object.keys(c.pays).map(Number).sort()) {
    let p = c.pays[y];
    for (const by of Object.keys(rem).map(Number).sort()) {
      const cap = Object.values(rem[by]).reduce((a, v) => a + v, 0);
      if (cap <= 0 || p <= 0) continue;
      const take = Math.min(p, cap);
      if (y - by < 0 || y - by > 2) return `"${c.name}" — ${y}년 지급이 ${by}년 예산보다 ${y - by}년 뒤예요(이월은 2회까지)`;
      const fs = sources.filter((f) => (rem[by][f] ?? 0) > 0);
      const funds: Record<string, number> = {};
      let rest = take;
      fs.forEach((f, i) => {
        const v = i === fs.length - 1 ? rest : Math.min(rem[by][f], Math.round((take * rem[by][f]) / cap / 10) * 10);
        funds[f] = v;
        rest -= v;
      });
      for (const f of fs) rem[by][f] -= funds[f] ?? 0;
      out.push({ payYear: y, potYear: by, funds, amount: take });
      p -= take;
    }
    if (p > 0) return `"${c.name}" — ${y}년 지급 ${p.toLocaleString("ko-KR")}원이 원인행위(예산 배정)보다 많아요`;
  }
  return out;
}

const KIND: Record<string, string> = { 공사: "공사", 물품: "관급", 관급: "관급", 용역: "용역" };

export type V3Plan = {
  parsed: V3Parsed;
  /** 만들 해(오름차순) — 건너뛴 해는 skipped에 */
  years: number[];
  skipped: number[];
  /** 해 → 그 해에 만들 세부사업들(본사업·명시·사고). split은 만들고 나서 공사 uid로 적어요 */
  perYear: Record<number, { list: ImportProject[]; cells: { project: string; row: string; funds: Record<string, number> }[] }>;
  setup: Setup;
};

/** 배분 결과를 집행현황 가져오기 모양으로 정리해요. 집행현황에 이미 자료가 있는 해는 건너뛰어요(①1안). */
export function planV3(parsed: V3Parsed, byYear: Record<number, BudgetProject[]>): V3Plan | string {
  const allocs: { c: V3Contract; a: { payYear: number; potYear: number; funds: Record<string, number>; amount: number }[] }[] = [];
  for (const c of parsed.contracts) {
    const a = allocate(c, parsed.sources);
    if (typeof a === "string") return a;
    allocs.push({ c, a });
  }
  const years = [...new Set(allocs.flatMap((x) => x.a.map((v) => v.payYear)))].sort();
  const skipped = years.filter((y) => (byYear[y] ?? []).some((p) => p.name === parsed.name && p.items.some((it) => it.rows.length)));
  const mk = years.filter((y) => !skipped.includes(y));
  const perYear: V3Plan["perYear"] = {};
  for (const y of mk) {
    const names = { 0: parsed.name, 1: `(명시이월) ${parsed.name}`, 2: `(사고이월) ${parsed.name}` } as Record<number, string>;
    const groups: Record<string, { name: string; carry: boolean; budget: number | null; rows: { row: string; kind: string; cmt: number; exp: number; done: boolean; funds: Record<string, number> }[] }> = {};
    for (const { c, a } of allocs) {
      for (const v of a) {
        if (v.payYear !== y) continue;
        const off = v.payYear - v.potYear;
        const pname = names[off];
        groups[pname] ??= { name: pname, carry: off > 0, budget: null, rows: [] };
        groups[pname].rows.push({ row: c.name, kind: KIND[c.kind] ?? "일반", cmt: v.amount, exp: v.amount, done: c.done, funds: v.funds });
      }
    }
    // 세부사업 예산: 본사업 = 그 해 본예산+추경 합(장부), 이월 사업 = 그 줄들 합(배분된 몫 — 이월 전액은 설정 체인이 보여 줘요)
    const curOf = (f: string) => {
      const m = parsed.manual[`${y}:${f}`] ?? {};
      return (m.cur ?? 0) + (m.a1 ?? 0) + (m.a2 ?? 0) + (m.a3 ?? 0) + (m.a4 ?? 0);
    };
    const list: ImportProject[] = [];
    const cells: V3Plan["perYear"][number]["cells"] = [];
    for (const g of Object.values(groups)) {
      const budget = g.carry ? null : parsed.sources.reduce((s, f) => s + curOf(f), 0) || null;
      list.push({
        name: g.name,
        budget,
        carry: g.carry,
        memo: "",
        items: [{ name: "공사", budget: null, memo: "", rows: g.rows.map((r) => ({ name: r.row, kind: r.kind, co: "", cmt: r.cmt, exp: r.exp, act: 0, stage: r.done ? "완료" : "추진", memo: "" })) }],
      });
      for (const r of g.rows) cells.push({ project: g.name, row: r.row, funds: r.funds });
    }
    // 본사업이 없고 당해 예산만 있는 해(지급 없음)는 만들지 않아요 — 설정 체인이 다뤄요
    if (list.length) perYear[y] = { list, cells };
  }
  const hasCarry = allocs.some((x) => x.a.some((v) => v.payYear !== v.potYear));
  const setup: Setup = {
    multi: parsed.from !== parsed.to,
    from: parsed.from,
    to: parsed.to,
    sources: parsed.sources,
    carry: hasCarry ? `(명시이월) ${parsed.name}` : "",
    carrySrc: "",
    rows: parsed.manual,
    sent: true,
    split: {},
  };
  return { parsed, years: Object.keys(perYear).map(Number).sort(), skipped, perYear, setup };
}
