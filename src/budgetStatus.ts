// 예산현황(13단계) 규칙 함수 – 집행현황의 모든 세부사업에 대한 연도×재원 장부(엑셀 "집행·이월 현황" 시트 규칙 그대로).
// 정한 것(2026-10-19 사용자):
//   - 세부사업은 집행현황에서 자동으로 와요(여러 해에 같은 이름이면 하나). 기간·재원·이월 사업은 사업명 옆 설정 단추로 적어요.
//   - 집행현황에 그 해 자료가 있으면 당해예산(본예산)·집행액(당해)은 거기서 와요. 이월 사업을 이으면 그 예산은 전년도 이월(명시), 집행액은 집행(명시).
//   - 없는 해는 직접 적어요. 불용액은 늘 직접 적어요. 재원이 둘 이상이면(2026-10-20 사용자 1안 – 집행현황은 전체 금액만, 재원은 보내기 창에서 나눠요):
//     재원별 예산은 보내기 창(또는 재원 줄)에서 직접 적고(합이 집행현황 예산과 다르면 붉게), 집행액은 공사마다 고른 재원(한 재원 또는 "나눔" 금액 비율)대로 저절로 나뉘어요.
//     합계 줄(연도·사업)은 집행현황 값 그대로예요.
//   - 단년도 사업(처음 값)은 집행현황에 있는 해마다 따로(해 사이 이월 없음). 다년도 사업은 기간(시작~끝 해)을 적고, 남은 돈이 다음 해 전년도 이월로 이어져요(결산 표시는 없어요 – 2026-10-19 사용자).
//   - 다음연도 이월(명시·사고)과 불용액은 늘 직접 적어요(2026-10-19 23:14 사용자 – 계산하지 않아요). 남은 돈(현액 − 집행 − 이월 − 불용)은 참고 값.
//   - 집행현황의 "(명시이월)/(사고이월) …" 세부사업은 ⚙에서 어느 사업에 이으면 그 사업의 전년도 이월·집행(명시/사고)로 들어가고,
//     잇지 않은 것은 그대로 한 줄로 보여요(예산 → 전년도 이월 명시/사고, 집행액 → 집행 명시/사고) – 집행현황의 모든 세부사업이 빠짐없이.
//   - 예산현액 = 당해예산 + 전년도 이월 · 집행률 = 집행액 ÷ 예산현액
//   - 다음 해 전년도 이월 ≠ 이 해 다음연도 이월이면 붉게(십원 단위까지 맞춰 보는 장부라서).
// 저장: core 표 bstatus(세부사업 이름 → 이 Setup JSON). 계산은 화면이 해요.
import type { BudgetProject } from "./budget";

export const SOURCES = ["국비", "도비", "시비", "기타"] as const;
export const ADDS = ["a1", "a2", "a3", "a4"] as const;

/** 손으로 적는 칸(재원 줄 하나) – 비어 있으면 0 */
export type Manual = {
  cur?: number; // 본예산
  a1?: number; a2?: number; a3?: number; a4?: number; // 1추~4추
  pm?: number; ps?: number; // 전년도 이월 명시·사고(첫해만 – 그 뒤는 앞 해에서 자동)
  en?: number; em?: number; es?: number; // 집행 당해·명시·사고
  nm?: number; ns?: number; // 다음연도 이월 명시·사고
  un?: number; // 불용액
};

export type Setup = {
  multi: boolean; // 다년도 사업이면 true – 기간(from~to)을 쓰고 해 사이 이월이 이어져요. 단년도면 집행현황에 있는 해마다 따로
  from: number;
  to: number;
  sources: string[]; // 재원 이름(기타는 적은 이름, 예 "특조")
  carry: string; // 이어 붙인 집행현황 이월 세부사업 이름("(명시이월) …"), 없으면 ""
  carrySrc: string; // 이월 사업 값이 들어갈 재원(재원이 둘 이상일 때), 없으면 첫 재원
  rows: Record<string, Manual>; // "2025:시비" → 직접 적은 값
  memo?: string; // 메모(메모 편집기 HTML)
  sent?: boolean; // 집행현황에서 "예산현황으로 보내기"를 한 사업만 예산현황에 보여요(2026-10-20 사용자 2안)
  /** 공사별 재원(재원이 둘 이상일 때, 2026-10-20 사용자 1안): "해:공사 번호" → 재원 이름(통째로) 또는 { 재원: 금액 }(계약금액을 나눈 것 – 집행액은 그 비율대로).
   *  안 고른 공사는 첫 재원으로 들어가요. */
  split?: Record<string, string | Record<string, number>>;
};

export const defaultSetup = (years: number[]): Setup => ({ multi: false, from: Math.min(...years), to: Math.max(...years), sources: ["시비"], carry: "", carrySrc: "", rows: {} });

/** 집행현황 한 세부사업(부기사업까지)의 예산·집행액 합 */
export type Linked = { budget: number; exp: number };
export function linkedOf(projects: BudgetProject[], name: string): Linked | null {
  const p = projects.find((x) => x.name === name);
  if (!p) return null;
  const exp = p.items.flatMap((i) => i.rows).reduce((s, r) => s + r.exp, 0);
  return { budget: p.budget ?? 0, exp };
}
/** 공사 한 줄의 집행액을 재원별로 나눠요(재원이 둘 이상일 때). 통째로면 그 재원, 나눔이면 적은 금액 비율(마지막 재원이 나머지 – 합이 십원 단위로 맞게), 안 골랐으면 첫 재원 */
export function rowShares(row: { id: number; exp: number }, setup: Setup, year: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of setup.sources) out[s] = 0;
  const first = setup.sources[0];
  const spec = setup.split?.[`${year}:${row.id}`];
  if (spec == null || typeof spec === "string") {
    out[typeof spec === "string" && spec in out ? spec : first] = row.exp;
    return out;
  }
  const total = setup.sources.reduce((a, s) => a + (spec[s] ?? 0), 0);
  if (!total) {
    out[first] = row.exp;
    return out;
  }
  let rest = row.exp;
  setup.sources.forEach((s, i) => {
    const v = i === setup.sources.length - 1 ? rest : Math.round((row.exp * (spec[s] ?? 0)) / total / 10) * 10;
    out[s] = v;
    rest -= v;
  });
  return out;
}
/** 그 해 집행현황 세부사업의 집행액 중 이 재원 몫(공사별 재원대로). 세부사업이 없으면 null */
export function splitExp(projects: BudgetProject[], name: string, setup: Setup, year: number, src: string): number | null {
  const p = projects.find((x) => x.name === name);
  if (!p) return null;
  let exp = 0;
  for (const it of p.items) for (const r of it.rows) exp += rowShares(r, setup, year)[src] ?? 0;
  return exp;
}
/** 공사별 재원 요약(보내기 창·안내용): 안 고른 공사 수 */
export function unsplitCount(p: BudgetProject | null, setup: Setup, year: number): number {
  if (!p) return 0;
  let n = 0;
  for (const it of p.items) for (const r of it.rows) if (setup.split?.[`${year}:${r.id}`] == null) n++;
  return n;
}

/** 한 줄(연도×재원 또는 합계)의 계산 결과 */
export type Line = {
  cur: number; a1: number; a2: number; a3: number; a4: number; curSum: number;
  pm: number; ps: number; prev: number;
  act: number;
  en: number; em: number; es: number; ex: number;
  rate: number | null;
  left: number; nm: number; ns: number; next: number; // 남은 돈(참고) · 다음연도 이월 명시·사고·소계(직접 적은 값)
  un: number;
  mismatch?: boolean; // 전년도 이월이 앞 해 다음연도 이월과 다름
  diffSum?: boolean; // 재원 줄 합이 집행현황 값과 다름(합계 줄)
};

export type YearBlock = { year: number; linked: boolean; hasMain: boolean; total: Line; bySrc: Record<string, Line> }; // hasMain = 그 해 집행현황에 이 세부사업이 있음
export type Book = { years: YearBlock[]; total: Line };

const z = (v: number | undefined) => v ?? 0;

/** @param present 집행현황에 이 세부사업이 있는 해(단년도 사업은 이 해들만) */
export function compute(name: string, setup: Setup, byYear: Record<number, BudgetProject[]>, present: number[] = []): Book {
  const years: number[] = [];
  if (setup.multi) for (let y = setup.from; y <= setup.to; y++) years.push(y);
  else years.push(...(present.length ? present : [setup.from]));
  const blocks: YearBlock[] = [];
  const prevLeft: Record<string, { nm: number; ns: number } | null> = {};
  // 이 세부사업 자체가 집행현황의 이월 세부사업이면(잇지 않은 것) 그 예산·집행은 명시/사고 칸으로
  const selfCarry = /^\(명시이월\)/.test(name) ? "m" : /^\(사고이월\)/.test(name) ? "s" : null;
  for (const y of years) {
    const projs = byYear[y] ?? [];
    const main = linkedOf(projs, name);
    const carry = setup.carry ? linkedOf(projs, setup.carry) : null;
    const linked = main != null || carry != null;
    const one = setup.sources.length === 1;
    const bySrc: Record<string, Line> = {};
    for (const s of setup.sources) {
      const m = setup.rows[`${y}:${s}`] ?? {};
      // 재원이 하나면 집행현황 값이 곧 그 줄. 둘 이상이면 본예산은 직접 적은 값(보내기 창 "재원별 예산"), 집행액은 공사별 재원대로 나눈 몫
      const auto = one && main && !selfCarry ? main : null;
      const splitEn = !one && main && !selfCarry ? splitExp(projs, name, setup, y, s) : null;
      const autoM = one && main && selfCarry === "m" ? main : null;
      const autoS = one && main && selfCarry === "s" ? main : null;
      const cur = auto ? auto.budget : z(m.cur);
      const en = auto ? auto.exp : splitEn != null ? splitEn : z(m.en);
      const pl = prevLeft[s];
      const mine = carry != null && (one || s === (setup.carrySrc || setup.sources[0]));
      // 이어 붙인 이월 사업이 "(사고이월)"이면 사고 칸으로, 아니면 명시 칸으로
      const mineM = mine && !/^\(사고이월\)/.test(setup.carry) ? carry : null;
      const mineS = mine && /^\(사고이월\)/.test(setup.carry) ? carry : null;
      const pm = mineM ? mineM.budget : autoM ? autoM.budget : pl ? pl.nm : z(m.pm);
      const ps = mineS ? mineS.budget : autoS ? autoS.budget : pl ? pl.ns : z(m.ps);
      const em = mineM ? mineM.exp : autoM ? autoM.exp : z(m.em);
      const es = mineS ? mineS.exp : autoS ? autoS.exp : z(m.es);
      const a = [z(m.a1), z(m.a2), z(m.a3), z(m.a4)];
      const curSum = cur + a[0] + a[1] + a[2] + a[3];
      const prev = pm + ps;
      const act = curSum + prev;
      const ex = en + em + es;
      const un = z(m.un);
      const nm = z(m.nm), ns = z(m.ns);
      const left = act - ex - nm - ns - un;
      // 다음연도 이월은 직접 적은 값. 다년도 사업이면 다음 해 전년도 이월로 이어져요
      const line: Line = { cur, a1: a[0], a2: a[1], a3: a[2], a4: a[3], curSum, pm, ps, prev, act, en, em, es, ex, rate: act ? (ex / act) * 100 : null, left, nm, ns, next: nm + ns, un };
      bySrc[s] = line;
      prevLeft[s] = setup.multi ? { nm, ns } : null;
    }
    const total = sumLines(Object.values(bySrc));
    if (!one && main && !selfCarry) {
      // 재원이 둘 이상이면 합계 줄(연도·사업 줄)은 집행현황의 예산·집행액을 그대로 보여 주고(2026-10-20 사용자: 재원을 나눠 적기 전에도 예산이 보여야 해요),
      // 재원별 예산 합이 집행현황 예산과 다르면 붉게(집행액은 공사별 재원대로 나뉘어 늘 같아요)
      const sumCur = total.curSum;
      const adds = total.a1 + total.a2 + total.a3 + total.a4;
      total.curSum = main.budget;
      total.cur = main.budget - adds;
      total.en = main.exp;
      total.ex = total.en + total.em + total.es;
      total.act = total.curSum + total.prev;
      total.rate = total.act ? (total.ex / total.act) * 100 : null;
      total.left = total.act - total.ex - total.nm - total.ns - total.un;
      if (sumCur !== main.budget) total.diffSum = true;
    }
    blocks.push({ year: y, linked, hasMain: main != null, total, bySrc });
  }
  // 이월 맞춰 보기: 이어 붙인 이월 사업 예산이 앞 해 다음연도 이월과 다르면
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i], a = blocks[i - 1];
    for (const s of setup.sources) {
      const cur = b.bySrc[s], before = a.bySrc[s];
      if (setup.multi && cur.prev !== 0 && before.nm + before.ns !== cur.prev) cur.mismatch = true;
    }
  }
  // 사업 줄 = 해마다 소계를 더한 값(2026-10-19 사용자 "요약은 소계를 표시"). 다년도는 해 사이 이월이 이어지니 두 번 세지 않게
  // 전년도 이월은 첫 해 것, 다음연도 이월은 마지막 해 것, 예산현액 = 당해예산 합 + 첫 해 전년도 이월.
  const all = sumLines(blocks.map((b) => b.total));
  if (setup.multi && blocks.length) {
    const f = blocks[0].total, l = blocks[blocks.length - 1].total;
    all.pm = f.pm; all.ps = f.ps; all.prev = f.prev;
    all.act = all.curSum + all.prev;
    all.left = l.left; all.nm = l.nm; all.ns = l.ns; all.next = l.next;
    all.rate = all.act ? (all.ex / all.act) * 100 : null;
  }
  return { years: blocks, total: all };
}

function sumLines(lines: Line[]): Line {
  const t: Line = { cur: 0, a1: 0, a2: 0, a3: 0, a4: 0, curSum: 0, pm: 0, ps: 0, prev: 0, act: 0, en: 0, em: 0, es: 0, ex: 0, rate: null, left: 0, nm: 0, ns: 0, next: 0, un: 0 };
  for (const l of lines) {
    t.cur += l.cur; t.a1 += l.a1; t.a2 += l.a2; t.a3 += l.a3; t.a4 += l.a4; t.curSum += l.curSum;
    t.pm += l.pm; t.ps += l.ps; t.prev += l.prev; t.act += l.act;
    t.en += l.en; t.em += l.em; t.es += l.es; t.ex += l.ex; t.un += l.un; t.left += l.left; t.nm += l.nm; t.ns += l.ns; t.next += l.next;
  }
  t.rate = t.act ? (t.ex / t.act) * 100 : null;
  return t;
}

/** 집행현황 세부사업 이름 목록(모든 해, 이월 세부사업은 빼고) + 있는 해 */
export function projectNames(byYear: Record<number, BudgetProject[]>): { name: string; years: number[]; carry: boolean }[] {
  const map = new Map<string, number[]>();
  for (const y of Object.keys(byYear).map(Number).sort()) {
    for (const p of byYear[y]) {
      const a = map.get(p.name) ?? [];
      a.push(y);
      map.set(p.name, a);
    }
  }
  return [...map.entries()].map(([name, years]) => ({ name, years, carry: /^\((명시|사고)이월\)/.test(name) }));
}

export const isCarryName = (n: string) => /^\((명시|사고)이월\)/.test(n);

// ---------- 엑셀 ----------
/** 엑셀 C~U 19칸 순서(core bstatus.rs와 같아야 해요) */
export const XL_FIELDS = ["curSum", "cur", "a1", "a2", "a3", "a4", "prev", "pm", "ps", "act", "ex", "en", "em", "es", "rate", "next", "nm", "ns", "un"] as const;
export type BStatusLine = { level: "pj" | "it" | "gun"; period: string; name: string; v: number[]; hasRate: boolean; memo: string };
export type BStatusExport = { year: number; unit: number; date: string; lines: BStatusLine[] };

export const lineOf = (level: BStatusLine["level"], period: string, name: string, l: Line, memo = ""): BStatusLine => ({
  level,
  period,
  name,
  v: XL_FIELDS.map((k) => (k === "rate" ? l.rate ?? 0 : (l as unknown as Record<string, number>)[k] ?? 0)),
  hasRate: l.rate != null,
  memo,
});

/** 가져오기: 시트 칸 글자 → (세부사업, 해, 재원)마다 직접 적는 값. 집행현황에서 오는 칸은 화면이 걸러요.
 *  줄 알아보기: 사업기간 칸이 "단년도"·"NNNN~NNNN년"이면 세부사업 줄, "NNNN년"이면 연도 줄, 그 밖은 재원 줄. */
export type ImportCell = { name: string; year: number; src: string; m: Manual };
const XL_TO_MANUAL: Partial<Record<(typeof XL_FIELDS)[number], keyof Manual>> = { cur: "cur", a1: "a1", a2: "a2", a3: "a3", a4: "a4", pm: "pm", ps: "ps", en: "en", em: "em", es: "es", nm: "nm", ns: "ns", un: "un" };
export function parseBStatusSheet(rows: string[][], year: number, setups: Record<string, Setup>): ImportCell[] | null {
  const hi = rows.findIndex((r) => r[0]?.trim() === "사업기간" && r[1]?.trim() === "사업명");
  if (hi < 0) return null;
  const out: ImportCell[] = [];
  let name = "", y = year, single = true;
  const num = (t: string | undefined) => {
    const v = Number((t ?? "").replace(/[,\s]/g, "").replace("−", "-"));
    return Number.isFinite(v) ? Math.round(v) : 0;
  };
  const push = (r: string[], src: string) => {
    const m: Manual = {};
    XL_FIELDS.forEach((k, i) => {
      const mk = XL_TO_MANUAL[k];
      if (mk) m[mk] = num(r[i + 2]);
    });
    out.push({ name, year: y, src, m });
  };
  for (const r of rows.slice(hi + 2)) {
    const a = (r[0] ?? "").trim();
    if (!a && !(r[1] ?? "").trim()) continue;
    if (a === "단년도" || /^\d{4}~\d{4}년$/.test(a)) {
      name = (r[1] ?? "").trim();
      single = a === "단년도";
      y = year;
      const s = setups[name];
      if (single && s && s.sources.length === 1) push(r, s.sources[0]);
      continue;
    }
    if (/^\d{4}년$/.test(a)) {
      y = Number(a.slice(0, 4));
      const s = setups[name];
      if (s && s.sources.length === 1) push(r, s.sources[0]);
      continue;
    }
    if (name) push(r, a);
  }
  return out;
}
