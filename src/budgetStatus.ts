// 예산현황(13단계) 규칙 함수 — 집행현황의 모든 세부사업에 대한 연도×재원 장부(엑셀 "집행·이월 현황" 시트 규칙 그대로).
// 정한 것(2026-10-19 사용자):
//   - 세부사업은 집행현황에서 자동으로 와요(여러 해에 같은 이름이면 하나). 기간·재원·이월 사업은 사업명 옆 설정 단추로 적어요.
//   - 집행현황에 그 해 자료가 있으면 당해예산(본예산)·집행액(당해)은 거기서 와요. 이월 사업을 이으면 그 예산은 전년도 이월(명시), 집행액은 집행(명시).
//   - 없는 해는 직접 적어요. 불용액은 늘 직접 적어요. 재원이 둘 이상이면 재원 줄은 직접 적고 합계 줄은 집행현황 값 — 다르면 붉게.
//   - 단년도 사업(처음 값)은 집행현황에 있는 해마다 따로(해 사이 이월 없음). 다년도 사업은 기간(시작~끝 해)을 적고, 남은 돈이 다음 해 전년도 이월로 이어져요(결산 표시는 없어요 — 2026-10-19 사용자).
//   - 예산현액 = 당해예산 + 전년도 이월 · 집행률 = 집행액 ÷ 예산현액 · 다음연도 이월 = 현액 − 집행 − 불용
//   - 다음 해 전년도 이월 ≠ 이 해 다음연도 이월이면 붉게(십원 단위까지 맞춰 보는 장부라서).
// 저장(목업): kv "bstatus.<세부사업 이름>" JSON — 설정(기간·재원·이월 사업)과 직접 적은 값. 실제 기능에서는 core 표로 옮겨요.
import type { BudgetProject } from "./budget";

export const SOURCES = ["국비", "도비", "시비", "기타"] as const;
export const ADDS = ["a1", "a2", "a3", "a4"] as const;

/** 손으로 적는 칸(재원 줄 하나) — 비어 있으면 0 */
export type Manual = {
  cur?: number; // 본예산
  a1?: number; a2?: number; a3?: number; a4?: number; // 1추~4추
  pm?: number; ps?: number; // 전년도 이월 명시·사고(첫해만 — 그 뒤는 앞 해에서 자동)
  en?: number; em?: number; es?: number; // 집행 당해·명시·사고
  un?: number; // 불용액
};

export type Setup = {
  multi: boolean; // 다년도 사업이면 true — 기간(from~to)을 쓰고 해 사이 이월이 이어져요. 단년도면 집행현황에 있는 해마다 따로
  from: number;
  to: number;
  sources: string[]; // 재원 이름(기타는 적은 이름, 예 "특조")
  carry: string; // 이어 붙인 집행현황 이월 세부사업 이름("(명시이월) …"), 없으면 ""
  carrySrc: string; // 이월 사업 값이 들어갈 재원(재원이 둘 이상일 때), 없으면 첫 재원
  rows: Record<string, Manual>; // "2025:시비" → 직접 적은 값
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

/** 한 줄(연도×재원 또는 합계)의 계산 결과 */
export type Line = {
  cur: number; a1: number; a2: number; a3: number; a4: number; curSum: number;
  pm: number; ps: number; prev: number;
  act: number;
  en: number; em: number; es: number; ex: number;
  rate: number | null;
  left: number; nm: number; ns: number; // 다음연도 이월(소계·명시·사고 — 사고는 적는 칸이 없어 0)
  un: number;
  mismatch?: boolean; // 전년도 이월이 앞 해 다음연도 이월과 다름
  diffSum?: boolean; // 재원 줄 합이 집행현황 값과 다름(합계 줄)
};

export type YearBlock = { year: number; linked: boolean; total: Line; bySrc: Record<string, Line> };
export type Book = { years: YearBlock[]; total: Line };

const z = (v: number | undefined) => v ?? 0;

/** @param present 집행현황에 이 세부사업이 있는 해(단년도 사업은 이 해들만) */
export function compute(name: string, setup: Setup, byYear: Record<number, BudgetProject[]>, present: number[] = []): Book {
  const years: number[] = [];
  if (setup.multi) for (let y = setup.from; y <= setup.to; y++) years.push(y);
  else years.push(...(present.length ? present : [setup.from]));
  const blocks: YearBlock[] = [];
  const prevLeft: Record<string, { nm: number; ns: number } | null> = {};
  for (const y of years) {
    const projs = byYear[y] ?? [];
    const main = linkedOf(projs, name);
    const carry = setup.carry ? linkedOf(projs, setup.carry) : null;
    const linked = main != null || carry != null;
    const one = setup.sources.length === 1;
    const bySrc: Record<string, Line> = {};
    for (const s of setup.sources) {
      const m = setup.rows[`${y}:${s}`] ?? {};
      // 재원이 하나면 집행현황 값이 곧 그 줄, 둘 이상이면 직접 적은 값
      const cur = one && main ? main.budget : z(m.cur);
      const en = one && main ? main.exp : z(m.en);
      const pl = prevLeft[s];
      const mine = carry != null && (one || s === (setup.carrySrc || setup.sources[0]));
      const pm = mine ? carry!.budget : pl ? pl.nm : z(m.pm);
      const ps = pl ? pl.ns : z(m.ps);
      const em = mine ? carry!.exp : z(m.em);
      const es = z(m.es);
      const a = [z(m.a1), z(m.a2), z(m.a3), z(m.a4)];
      const curSum = cur + a[0] + a[1] + a[2] + a[3];
      const prev = pm + ps;
      const act = curSum + prev;
      const ex = en + em + es;
      const un = z(m.un);
      const left = act - ex - un;
      // 다음연도 이월 = 남은 돈(명시로, 사고는 적는 칸이 없어 0). 다년도 사업이면 다음 해 전년도 이월로 이어져요
      const line: Line = { cur, a1: a[0], a2: a[1], a3: a[2], a4: a[3], curSum, pm, ps, prev, act, en, em, es, ex, rate: act ? (ex / act) * 100 : null, left, nm: left, ns: 0, un };
      bySrc[s] = line;
      prevLeft[s] = setup.multi ? { nm: left, ns: 0 } : null;
    }
    const total = sumLines(Object.values(bySrc));
    if (!one && main && (total.curSum !== main.budget || total.en !== main.exp)) {
      // 재원 줄 합이 집행현황과 다르면 합계 줄은 집행현황 값으로 보여 주고 붉게
      total.diffSum = true;
    }
    blocks.push({ year: y, linked, total, bySrc });
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
    all.left = l.left; all.nm = l.nm; all.ns = l.ns;
    all.rate = all.act ? (all.ex / all.act) * 100 : null;
  }
  return { years: blocks, total: all };
}

function sumLines(lines: Line[]): Line {
  const t: Line = { cur: 0, a1: 0, a2: 0, a3: 0, a4: 0, curSum: 0, pm: 0, ps: 0, prev: 0, act: 0, en: 0, em: 0, es: 0, ex: 0, rate: null, left: 0, nm: 0, ns: 0, un: 0 };
  for (const l of lines) {
    t.cur += l.cur; t.a1 += l.a1; t.a2 += l.a2; t.a3 += l.a3; t.a4 += l.a4; t.curSum += l.curSum;
    t.pm += l.pm; t.ps += l.ps; t.prev += l.prev; t.act += l.act;
    t.en += l.en; t.em += l.em; t.es += l.es; t.ex += l.ex; t.un += l.un; t.left += l.left; t.nm += l.nm; t.ns += l.ns;
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
