// 집행현황 엑셀 가져오기(12단계). 시트의 칸 글자를 읽어 세부사업 → 부기사업 → 공사로 나눠요.
// 두 모양을 받아요:
//   1) 기록이 내보낸 파일 — 3행 열 제목(세부사업·구분·업체(하도)·예산…), 숨긴 M열 "줄"이 겹을 알려 줘요. 2행 "단위 천원"이면 천원.
//   2) 예전에 쓰던 집행현황 시트(사용자 "2026" 시트 모양) — 열 제목 "예산세목·공사명/예산액·구분·원인행위…", 금액은 천원(소수 있음).
//      A칸에 세부사업 이름 + B칸 예산 숫자 = 세부사업 줄, A칸 "이름 (예산)" + B칸 공사명 = 부기사업이 시작되는 줄,
//      A칸이 비고 B칸 공사명 = 공사 줄. 부기사업 없이 공사가 오면 세부사업 이름으로 부기사업을 하나 만들어요(예산 없음).
//      추진중 → 추진, 미착수 → 준비. 착공일·준공일은 공사 메모에 적어요. 연락처 칸은 가져오지 않아요(개인정보).
import { KINDS, STAGES, textToMemo } from "./budget";

export type ImportRow = { name: string; kind: string; co: string; cmt: number; exp: number; act: number; stage: string; memo: string };
export type ImportItem = { name: string; budget: number | null; memo: string; rows: ImportRow[] };
export type ImportProject = { name: string; budget: number | null; carry: boolean; memo: string; items: ImportItem[] };
export type GridSheet = { name: string; rows: string[][] };
export type BudgetImport = { sheet: string; unit: 1 | 1000; projects: ImportProject[]; rows: number; checks: string[] };

const norm = (s: string) => (s ?? "").replace(/\s+/g, "");
const line = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();

/** 칸 숫자 → 원(십원 단위로 반올림). 천원이면 1000을 곱해요. 비거나 숫자가 아니면 null. */
export function toWon(cell: string, unit: 1 | 1000): number | null {
  const t = (cell ?? "").replace(/[,\s원]/g, "");
  if (!t || !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t)) return null;
  return Math.round((Number(t) * unit) / 10) * 10;
}

const STAGE_MAP: Record<string, string> = { 추진중: "추진", 진행: "추진", 진행중: "추진", 미착수: "준비", 착수전: "준비", 준공: "완료" };

function stageOf(s: string, checks: string[], where: string): string {
  const t = norm(s);
  if ((STAGES as readonly string[]).includes(t)) return t;
  if (STAGE_MAP[t]) return STAGE_MAP[t];
  if (t) checks.push(`${where}: 단계 "${s.trim()}"를 준비로 넣었어요`);
  return "준비";
}

function kindOf(s: string): string {
  const t = norm(s);
  if ((KINDS as readonly string[]).includes(t)) return t;
  if (t === "물품") return "관급";
  return "일반";
}

const isCarry = (name: string) => /^\(.*이월.*\)/.test(name.trim());

/** 기록 내보내기 모양 */
function fromApp(s: GridSheet, hi: number): BudgetImport | null {
  const head = s.rows[hi].map(norm);
  const col = (h: string) => head.indexOf(h);
  // 열 이름을 바꿔도(2026-10-18 지출액→집행액, 실집행액→시공량(사용량)) 예전 파일을 읽어요
  const col2 = (h: string, old: string) => (col(h) >= 0 ? col(h) : col(old));
  const c = { name: col("세부사업"), kind: col("구분"), co: col("업체(하도)"), bud: col("예산"), cmt: col("원인행위"), exp: col2("집행액", "지출액"), act: col2("시공량(사용량)", "실집행액"), stage: col("단계"), memo: col("메모"), lv: col("줄") };
  if (c.name < 0 || c.cmt < 0) return null;
  const unit: 1 | 1000 = s.rows.slice(0, hi).some((r) => r.some((x) => /단위\s*천원/.test(x ?? ""))) ? 1000 : 1;
  const out: ImportProject[] = [];
  const checks: string[] = [];
  let n = 0;
  let carry = false;
  for (let i = hi + 1; i < s.rows.length; i++) {
    const r = s.rows[i];
    const get = (k: number) => (k >= 0 ? r[k] ?? "" : "");
    const name = line(get(c.name));
    if (!name) continue;
    if (name === "이월 사업" && !r.some((x, j) => j !== c.name && (x ?? "").trim())) {
      carry = true;
      continue;
    }
    const lv = norm(get(c.lv));
    const isRow = lv ? lv === "공사" : (KINDS as readonly string[]).includes(norm(get(c.kind)));
    const memo = textToMemo(get(c.memo));
    if (lv === "세부사업" || (!lv && !isRow && !out.length)) {
      out.push({ name, budget: toWon(get(c.bud), unit), carry: carry || isCarry(name), memo, items: [] });
    } else if (!isRow) {
      if (!out.length) out.push({ name, budget: null, carry, memo: "", items: [] });
      out[out.length - 1].items.push({ name, budget: toWon(get(c.bud), unit), memo, rows: [] });
    } else {
      if (!out.length) out.push({ name: "세부사업", budget: null, carry, memo: "", items: [] });
      const p = out[out.length - 1];
      if (!p.items.length) p.items.push({ name: p.name, budget: null, memo: "", rows: [] });
      p.items[p.items.length - 1].rows.push({
        name,
        kind: kindOf(get(c.kind)),
        co: line(get(c.co)),
        cmt: toWon(get(c.cmt), unit) ?? 0,
        exp: toWon(get(c.exp), unit) ?? 0,
        act: toWon(get(c.act), unit) ?? 0,
        stage: stageOf(get(c.stage), checks, `${i + 1}행`),
        memo,
      });
      n++;
    }
  }
  return { sheet: s.name, unit, projects: out, rows: n, checks };
}

/** 예전 집행현황 시트 모양("2026" 시트) */
function fromLegacy(s: GridSheet, hi: number): BudgetImport | null {
  const head = s.rows[hi].map(norm);
  const find = (...hs: string[]) => head.findIndex((h) => hs.some((x) => h.startsWith(x)));
  const c = {
    sec: find("예산세목"),
    name: find("공사명/예산액", "공사명"),
    kind: find("구분"),
    cmt: find("원인행위"),
    exp: find("지출액", "집행액"),
    act: find("실집행액", "시공량"),
    start: find("착공일"),
    end: find("준공일"),
    co: find("업체명", "업체"),
    stage: find("추진단계", "단계"),
  };
  if (c.sec < 0 || c.name < 0 || c.cmt < 0) return null;
  const unit = 1000 as const;
  const out: ImportProject[] = [];
  const checks: string[] = [];
  let n = 0;
  const get = (r: string[], k: number) => (k >= 0 ? r[k] ?? "" : "");
  for (let i = hi + 1; i < s.rows.length; i++) {
    const r = s.rows[i];
    const a = (get(r, c.sec) ?? "").trim();
    const b = (get(r, c.name) ?? "").trim();
    if (!a && !b) continue;
    const bNum = toWon(b, unit);
    if (a && bNum !== null) {
      // 세부사업 줄: A 이름, B 예산
      const name = line(a);
      out.push({ name, budget: bNum, carry: isCarry(name), memo: "", items: [] });
      continue;
    }
    if (!out.length) out.push({ name: "세부사업", budget: null, carry: false, memo: "", items: [] });
    const p = out[out.length - 1];
    if (a) {
      // 부기사업 시작: "이름 (예산)" — 한 칸에 괄호 예산이 둘 이상이면 나누지 않고 확인 필요로 남겨요.
      const money = [...a.matchAll(/\(([\d,]+)\)/g)];
      let name = line(a);
      let budget: number | null = null;
      let memo = "";
      if (money.length === 1) {
        name = line(a.replace(/\(([\d,]+)\)\s*$/, "")) || name;
        budget = toWon(money[0][1], unit);
      } else if (money.length > 1) {
        memo = textToMemo("확인 필요: 한 칸에 부기사업이 여럿이에요 — 나눠 주세요\n" + a.replace(/\s*\n\s*/g, " / "));
        checks.push(`${i + 1}행: "${line(a).slice(0, 24)}…" 한 칸에 부기사업이 여럿이라 하나로 넣었어요(메모에 적어 둠)`);
      }
      p.items.push({ name, budget, memo, rows: [] });
    }
    if (!b) continue;
    if (!p.items.length) p.items.push({ name: p.name, budget: null, memo: "", rows: [] });
    const notes = [
      get(r, c.start).trim() && `착공 ${get(r, c.start).trim()}`,
      get(r, c.end).trim() && `준공 ${get(r, c.end).trim()}`,
    ].filter(Boolean) as string[];
    const co = line(get(r, c.co));
    p.items[p.items.length - 1].rows.push({
      name: line(b),
      kind: kindOf(get(r, c.kind)),
      co: co === "-" ? "" : co,
      cmt: toWon(get(r, c.cmt), unit) ?? 0,
      exp: toWon(get(r, c.exp), unit) ?? 0,
      act: toWon(get(r, c.act), unit) ?? 0,
      stage: stageOf(get(r, c.stage), checks, `${i + 1}행`),
      memo: notes.length ? textToMemo(notes.join("\n")) : "",
    });
    n++;
  }
  return { sheet: s.name, unit, projects: out, rows: n, checks };
}

/** 시트들 중 집행현황 모양을 찾아 읽어요. 그 해 이름의 시트를 먼저 봐요. 못 찾으면 null. */
export function parseBudgetBook(sheets: GridSheet[], year: number): BudgetImport | null {
  const order = [...sheets].sort((x, y) => Number(!norm(x.name).startsWith(String(year))) - Number(!norm(y.name).startsWith(String(year))));
  for (const s of order) {
    for (let i = 0; i < Math.min(12, s.rows.length); i++) {
      const h = s.rows[i].map(norm);
      if (h.includes("세부사업") && h.includes("원인행위")) {
        const r = fromApp(s, i);
        if (r) return r;
      }
      if (h.includes("예산세목") && h.some((x) => x.startsWith("공사명")) && h.includes("원인행위")) {
        const r = fromLegacy(s, i);
        if (r) return r;
      }
    }
  }
  return null;
}
