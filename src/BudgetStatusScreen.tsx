// 예산현황(13단계) 화면 — 집행현황과 같은 표 부품(bd-*)으로, 세부사업 › 연도 › 재원 세 겹.
// 시안: 캔버스 BudgetStatus(요약)·BudgetStatusDetail(자세히), 2026-10-19 사용자 결정(설정 단추는 작은 네모 하나, 숫자는 모두 오른쪽, 추경 열은 빼지 않음, 엑셀 열 비율 참고).
// - 세부사업은 집행현황에서 자동으로 와요(이월 세부사업은 이어 붙이는 쪽). 사업명 옆 ⚙ 단추 → 단년도/다년도(기간)·재원·이월 사업.
// - 재원 줄 두 번 누르기 = 고치는 줄(직접 적는 칸만 열려요), 바깥 누르기 = 저장, Esc = 취소. 규칙은 budgetStatus.ts.
import React, { KeyboardEvent as RKeyboardEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import { api, errorText, inApp } from "./api";
import { BudgetProject, fmt, okWon, parseWon, typing, Unit } from "./budget";
import { BStatusLine, compute, defaultSetup, Line, lineOf, linkedOf, Manual, parseBStatusSheet, projectNames, Setup, SOURCES } from "./budgetStatus";
import { dirOf, DIR_KEY, joinPath, lastDir } from "./ExcelMenu";
import { isEmptyMemo, MemoEditor, sanitize } from "./RichMemo";
import { memoToText } from "./budget";
import { todayStr } from "./journal";
import { keyAction } from "./keys";

const ICON = (d: string, s = 14, w = 2) => (
  <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);
const CD = "M6 9l6 6 6-6", CR = "M9 6l6 6-6 6", GEAR = "M4 6h16 M4 12h16 M4 18h16 M9 4v4 M15 10v4 M7 16v4", X = "M6 6l12 12M18 6L6 18";
const UNIT_KEY = "bstatus.unit", VIEW_KEY = "bstatus.view", YEAR_KEY = "bstatus.year", ORDER_KEY = "bstatus.order";

type Col = { id: string; label: string; sub?: string; w: number; num?: boolean };
// sub = 묶음 아래 열 이름(머리 두 줄). 고정 폭(끌 수 없음): 구분은 남는 폭, 집행률·메모
const FIXED = new Set(["rate", "memo"]);
const COLS_KEY = "bstatus.cols";
/** 자세히 머리 줄 두 줄: 위 줄은 묶음 이름(여러 열에 걸침), 아래 줄은 열 이름. sub가 없는 열은 두 줄을 한 칸으로. */
/** 엑셀 "집행·이월 현황" 열 비율 참고: 숫자 열은 같은 폭, 구분 열은 1.3배쯤 + 설정 단추 자리 */
const SUM_COLS: Col[] = [
  { id: "yrs", label: "사업기간", w: 136 },
  { id: "name", label: "사업명", w: 240 },
  { id: "curSum", label: "당해예산 ①", w: 152, num: true },
  { id: "prev", label: "전년도 이월 ②", w: 152, num: true },
  { id: "act", label: "예산현액 ①+②", w: 152, num: true },
  { id: "ex", label: "집행액", w: 152, num: true },
  { id: "rate", label: "집행률", w: 112, num: true },
  { id: "left", label: "다음연도 이월", w: 152, num: true },
  { id: "un", label: "불용액", w: 152, num: true },
  { id: "memo", label: "메모", w: 48 },
];
const DET_COLS: Col[] = [
  { id: "yrs", label: "사업기간", w: 136 },
  { id: "name", label: "사업명", w: 240 },
  { id: "curSum", label: "당해예산 ①", sub: "소계", w: 132, num: true },
  { id: "cur", label: "", sub: "본예산", w: 132, num: true },
  { id: "a1", label: "", sub: "1추", w: 132, num: true },
  { id: "a2", label: "", sub: "2추", w: 132, num: true },
  { id: "a3", label: "", sub: "3추", w: 132, num: true },
  { id: "a4", label: "", sub: "4추", w: 132, num: true },
  { id: "prev", label: "전년도 이월 ②", sub: "소계", w: 132, num: true },
  { id: "pm", label: "", sub: "명시이월", w: 132, num: true },
  { id: "ps", label: "", sub: "사고이월", w: 132, num: true },
  { id: "act", label: "예산현액 ①+②", w: 152, num: true },
  { id: "ex", label: "집행액", sub: "소계", w: 132, num: true },
  { id: "en", label: "", sub: "당해", w: 132, num: true },
  { id: "em", label: "", sub: "명시", w: 132, num: true },
  { id: "es", label: "", sub: "사고", w: 132, num: true },
  { id: "rate", label: "집행률", w: 112, num: true },
  { id: "left", label: "다음연도 이월", sub: "소계", w: 132, num: true },
  { id: "nm", label: "", sub: "명시이월", w: 132, num: true },
  { id: "ns", label: "", sub: "사고이월", w: 132, num: true },
  { id: "un", label: "불용액", w: 132, num: true },
  { id: "memo", label: "메모", w: 48 },
];
/** 직접 적을 수 있는 칸(재원 줄) */
const EDIT_FIELDS: (keyof Manual)[] = ["cur", "a1", "a2", "a3", "a4", "pm", "ps", "en", "em", "es", "un"];

type Pop = { t: "setup"; name: string; x: number; y: number } | { t: "src"; name: string; x: number; y: number } | { t: "menu"; name: string; x: number; y: number } | { t: "memo"; name: string; x: number; y: number } | { t: "excel"; x: number; y: number };
type Ask = { path: string; cells: { name: string; year: number; src: string; m: Manual }[]; skipped: number };
type Form = { name: string; year: number; src: string; text: Record<string, string> };

export default function BudgetStatusScreen() {
  const [byYear, setByYear] = useState<Record<number, BudgetProject[]>>({});
  const [setups, setSetups] = useState<Record<string, Setup>>({});
  const [unit, setUnit] = useState<Unit>(1);
  const [detail, setDetail] = useState(false);
  // 보는 해(집행현황처럼 ◀ 2026년 ▶): 단년도 사업은 이 해 것만 한 줄, 다년도 사업은 기간에 이 해가 들면 모든 해를 펼쳐요(2026-10-19 사용자)
  const [year, setYear] = useState(Number(todayStr().slice(0, 4)));
  // 줄 순서(우클릭 위로·아래로): 세부사업 이름 목록, kv bstatus.order — 목록에 없는 것은 집행현황 순서대로 뒤에
  const [order, setOrder] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openY, setOpenY] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [newSrc, setNewSrc] = useState("");
  const formRow = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  // 열 폭(집행현황과 같은 배치최적화·끌기·두 번 누르기·우클릭 처음대로) — 요약·자세히 따로, kv bstatus.cols
  const [W, setW] = useState<Record<string, Record<string, number>>>({});
  const [boxW, setBoxW] = useState(0);
  const [sbw, setSbw] = useState(0);
  const [toast, setToast] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const memoHtml = useRef("");
  const scroller = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ---------- 읽기: 집행현황 여러 해 + 설정 ----------
  const thisYear = Number(todayStr().slice(0, 4));
  const load = useCallback(async () => {
    const out: Record<number, BudgetProject[]> = {};
    for (let y = thisYear - 3; y <= thisYear + 2; y++) {
      try {
        const d = await api.budgetData(y);
        if (d.length) out[y] = d;
      } catch {
        /* 그 해 없음 */
      }
    }
    setByYear(out);
    const names = projectNames(out).filter((p) => !p.carry);
    const st: Record<string, Setup> = {};
    const saved = new Map<string, string>();
    try {
      for (const r of await api.bstatusList()) saved.set(r.name, r.setup);
    } catch {
      /* 없으면 처음 값 */
    }
    for (const p of names) {
      const v = saved.get(p.name);
      try {
        st[p.name] = v ? { ...defaultSetup(p.years), ...(JSON.parse(v) as Partial<Setup>) } : defaultSetup(p.years);
      } catch {
        st[p.name] = defaultSetup(p.years);
      }
    }
    setSetups(st);
  }, [thisYear]);
  useEffect(() => {
    void load();
    api.get(UNIT_KEY).then((v) => setUnit(v === "1000" ? 1000 : 1), () => {});
    api.get(VIEW_KEY).then((v) => setDetail(v === "detail"), () => {});
    api.get(ORDER_KEY).then((v) => { if (v) setOrder(JSON.parse(v) as string[]); }, () => {});
    api.get(YEAR_KEY).then((v) => { if (v && /^\d{4}$/.test(v)) setYear(Number(v)); }, () => {});
    api.get(COLS_KEY).then((v) => {
      if (!v) return;
      const o = JSON.parse(v) as { w?: Record<string, Record<string, number>> };
      if (o.w) setW(o.w);
    }, () => {});
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);
  // 표 폭(남는 폭이 있으면 왼쪽으로 모을 때 씀)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      setSbw(el.offsetWidth - el.clientWidth);
      if (rootRef.current) setBoxW(rootRef.current.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const names = useMemo(() => {
    const all = projectNames(byYear).filter((p) => !p.carry);
    const pos = new Map(order.map((n, i) => [n, i]));
    return [...all].sort((a, b) => (pos.get(a.name) ?? 1e9) - (pos.get(b.name) ?? 1e9));
  }, [byYear, order]);
  const carryNames = useMemo(() => projectNames(byYear).filter((p) => p.carry), [byYear]);
  const shown = names.filter((p) => {
    if (q && !p.name.includes(q)) return false;
    const s = setups[p.name];
    if (!s) return false;
    return s.multi ? s.from <= year && year <= s.to : p.years.includes(year);
  });
  /** 우클릭 메뉴 위로·아래로: 지금 보이는 순서에서 한 칸 옮겨 전체 순서로 저장 */
  const moveRow = (name: string, dir: -1 | 1) => {
    const list = names.map((p) => p.name);
    const i = list.indexOf(name), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder(list);
    api.set(ORDER_KEY, JSON.stringify(list)).catch(() => {});
    setPop(null);
  };
  const changeYear = (y: number) => {
    setForm(null);
    setPop(null);
    setYear(y);
    api.set(YEAR_KEY, String(y)).catch(() => {});
  };

  /** 예산현황의 예산현액을 집행현황 세부사업 예산 칸에 써 줘요(2026-10-19 사용자: 자동 입력 + 집행현황에서 손으로 고칠 수 있음) */
  const pushAct = async (name: string, s: Setup, present: number[]) => {
    const book = compute(name, s, byYear, s.multi ? present : present);
    const changed: Record<number, BudgetProject[]> = {};
    for (const b of book.years) {
      const p = (byYear[b.year] ?? []).find((x) => x.name === name);
      if (!p) continue;
      const act = Math.round(b.total.act);
      if ((p.budget ?? 0) === act) continue;
      try {
        changed[b.year] = await api.saveBudgetProject(b.year, p.id, null, name, act);
      } catch {
        /* 집행현황 쪽 오류는 넘어가요 */
      }
    }
    if (Object.keys(changed).length) setByYear((o) => ({ ...o, ...changed }));
  };
  const saveSetup = (name: string, s: Setup) => {
    setSetups((o) => ({ ...o, [name]: s }));
    api.bstatusSet(name, JSON.stringify(s)).catch(() => {});
    const p = names.find((x) => x.name === name);
    void pushAct(name, s, p?.years ?? []);
  };

  // ---------- 고치는 줄 ----------
  const startEdit = (name: string, year: number, src: string) => {
    const m = setups[name]?.rows[`${year}:${src}`] ?? {};
    const text: Record<string, string> = {};
    for (const f of EDIT_FIELDS) text[f] = m[f] != null ? fmt(m[f], unit).replace("−", "-") : "";
    setForm({ name, year, src, text });
    setBad(null);
  };
  const cancel = () => {
    setForm(null);
    setBad(null);
  };
  const save = useCallback(() => {
    const f = form;
    if (!f) return;
    const m: Manual = {};
    for (const k of EDIT_FIELDS) {
      const t = f.text[k];
      if (!t) continue;
      const v = parseWon(t, unit);
      if (!okWon(v) || v == null) {
        setBad(k);
        return;
      }
      m[k] = v;
    }
    const s = setups[f.name];
    saveSetup(f.name, { ...s, rows: { ...s.rows, [`${f.year}:${f.src}`]: m } });
    setForm(null);
  }, [form, setups, unit]);
  useEffect(() => {
    if (!form) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Element;
      if (formRow.current?.contains(t) || t.closest?.(".bd-pop")) return;
      save();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [form, save]);

  // ---------- 뜨는 상자 ----------
  useLayoutEffect(() => {
    if (!pop || !popRef.current) {
      setPopPos(null);
      return;
    }
    const r = popRef.current.getBoundingClientRect();
    setPopPos({ left: Math.max(8, Math.min(pop.x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(pop.y, innerHeight - r.height - 8)) });
  }, [pop]);
  useEffect(() => {
    if (!pop) return;
    const h = (e: MouseEvent) => {
      if ((e.target as Element).closest?.(".bd-pop")) return;
      setPop(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [pop]);

  const view = detail ? "detail" : "summary";
  const base = detail ? DET_COLS : SUM_COLS;
  const wv = W[view] ?? {};
  const widthOf = (c: Col) => (FIXED.has(c.id) ? c.w : wv[c.id] ?? c.w);
  // 구분 열도 다른 열과 같은 규칙(2026-10-19 사용자 — 집행현황의 "남는 폭 채우기"는 여기선 안 써요)
  const cols = base.map((c) => ({ ...c, w: widthOf(c) }));
  const tmpl = cols.map((c) => c.w + "px").join(" ");
  const colSum = cols.reduce((a, c) => a + c.w, 0);
  // 남는 폭이 있으면 왼쪽으로 모아요(집행현황 배치최적화 뒤와 같게): 머리 줄 끝 = 메모 끝
  const packed = boxW > 0 && colSum + 2 + sbw <= boxW;
  const saveCols = (w: Record<string, number>) => {
    const nw = { ...W, [view]: w };
    setW(nw);
    api.set(COLS_KEY, JSON.stringify({ w: nw })).catch(() => {});
  };
  const startDrag = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
    let w: Record<string, number> = { ...wv };
    const grip = e.currentTarget as HTMLElement;
    grip.classList.add("drag");
    const mv = (ev: MouseEvent) => {
      w = { ...w, [id]: Math.max(id === "name" ? 160 : 36, Math.round(w0 + ev.clientX - x0)) };
      setW((o) => ({ ...o, [view]: w }));
    };
    const up = () => {
      grip.classList.remove("drag");
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
      saveCols(w);
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
  };
  /** 칸을 복사해 폭 제한 없이 놓고 잰 내용 폭 */
  const need = (el: HTMLElement) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.style.cssText += ";position:absolute;left:0;top:0;visibility:hidden;width:max-content;min-width:0;max-width:none";
    c.querySelectorAll(".bd-grip").forEach((g) => g.remove());
    el.before(c);
    const w = c.getBoundingClientRect().width;
    c.remove();
    return Math.ceil(w);
  };
  /** 그 열에 보이는 내용(열 제목 포함) 가운데 가장 긴 폭 */
  const fitOf = (ci: number, head: HTMLElement) => {
    const cells = [head, ...document.querySelectorAll<HTMLElement>(`.bs .bd-body .bd-rw > .bd-c:nth-child(${ci + 1})`)];
    const text = cols[ci]?.id === "name" || cols[ci]?.id === "yrs";
    return Math.max(cols[ci]?.id === "name" ? 160 : 36, Math.max(...cells.map(need)) + (text ? 16 : 1)); // 글자 열은 오른쪽 여유 16(2026-10-19 사용자)
  };
  /** 배치최적화: 고정 폭 열 빼고 모든 열을 보이는 내용 폭에 맞춰요 */
  const fitAll = () => {
    const w = { ...wv };
    cols.forEach((c, i) => {
      if (FIXED.has(c.id)) return;
      const head = document.querySelector<HTMLElement>(`.bs .bd-hd > .bd-h[data-ci="${i}"]`);
      if (head) w[c.id] = fitOf(i, head);
    });
    saveCols(w);
    setToast("열 간격을 내용에 맞췄어요 · 열 제목 우클릭으로 처음대로");
  };
  const autoFit = (e: React.MouseEvent, ci: number, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const fit = fitOf(ci, (e.currentTarget as HTMLElement).parentElement as HTMLElement);
    saveCols({ ...wv, [id]: fit });
  };
  const resetCols = (e: React.MouseEvent) => {
    e.preventDefault();
    saveCols({});
    setToast("열 너비를 처음으로 돌렸어요");
  };
  const grip = (c: Col) => {
    if (FIXED.has(c.id)) return null;
    const ci = cols.findIndex((x) => x.id === c.id);
    return <span className="bd-grip" title="끌어서 너비 · 두 번 누르면 내용에 맞춤" onMouseDown={(e) => startDrag(e, c.id)} onDoubleClick={(e) => autoFit(e, ci, c.id)} />;
  };

  const cell = (v: ReactNode, cls = "", title?: string) => (
    <div className={"bd-c" + cls} role="cell" title={title}>
      {v}
    </div>
  );
  // 숫자 글자: 0은 "-"(짧은 하이픈), 음수도 하이픈(2026-10-19 사용자 — 긴 줄표는 쓰지 않아요)
  const fz = (v: number) => (v === 0 ? "-" : fmt(v, unit).replace("−", "-"));
  const num = (v: number | null | undefined, cls = "", title?: string) => cell(v == null ? "" : fz(v), " n" + cls, title);
  const bar = (rate: number | null, sm: boolean, row: boolean) =>
    rate == null ? (
      ""
    ) : (
      <>
        <span className={"bd-bar" + (sm ? " sm" : "") + (row ? " rowbar" : "")}>
          <span style={{ width: Math.min(rate, 100) + "%" }} />
        </span>
        <span className={"bd-pct" + (row ? " rowp" : "")}>{Math.round(rate)}%</span>
      </>
    );

  /** 숫자 칸들(구분·메모 사이) */
  // lock: 집행현황에서 오는 칸(재원 하나 + 그 해 집행현황 있음 → 집행 당해)은 고치는 줄에서도 값만 보여요
  const numCells = (l: Line, kind: "pj" | "it" | "gun", editing: Form | null, year?: number, first = false, lock: string[] = []) => {
    const out: ReactNode[] = [];
    const edit = (k: keyof Manual, label: string) => (
      <div className="bd-c n" role="cell" key={k}>
        <input
          className={"fld bd-in n" + (bad === k ? " bad" : "")}
          aria-label={label}
          value={editing!.text[k]}
          onChange={(e) => {
            const text = typing(e.target.value);
            setForm((f) => (f ? { ...f, text: { ...f.text, [k]: text } } : f));
            if (bad === k) setBad(null);
          }}
        />
      </div>
    );
    for (const c of cols) {
      if (c.id === "name" || c.id === "memo" || c.id === "yrs") continue;
      const id = c.id;
      if (editing && (EDIT_FIELDS as string[]).includes(id) && !lock.includes(id) && !((id === "pm" || id === "ps") && !first)) {
        out.push(edit(id as keyof Manual, c.sub || c.label));
        continue;
      }
      // 요약의 당해예산·전년도 이월·집행액 칸을 고칠 때는 본예산·명시이월·당해로 받아요
      if (editing && !detail) {
        if (id === "curSum" && !lock.includes("cur")) { out.push(edit("cur", "본예산")); continue; }
        if (id === "prev" && first) { out.push(edit("pm", "명시이월")); continue; }
        if (id === "ex" && !lock.includes("en")) { out.push(edit("en", "집행액(당해)")); continue; }
      }
      if (id === "rate") {
        out.push(<div className="bd-c n bs-rate" role="cell" key={id}>{bar(l.rate, kind !== "pj", kind === "gun")}</div>);
        continue;
      }
      if (first && ["prev", "pm", "ps"].includes(id) && !(l as unknown as Record<string, number>)[id]) {
        out.push(cell("", " n"));
        continue;
      }
      if (id === "left") {
        out.push(
          <div className="bd-c n" role="cell" key={id}>
            {fz(l.left)}
          </div>,
        );
        continue;
      }
      if (id === "nm" || id === "ns") {
        out.push(num(id === "nm" ? l.nm : l.ns));
        continue;
      }
      if (id === "prev" || id === "pm") {
        const v = (l as unknown as Record<string, number>)[id];
        out.push(num(v, l.mismatch ? " red" : "", l.mismatch && year ? `${year - 1}년 다음연도 이월과 달라요` : undefined));
        continue;
      }
      if (kind === "it" && l.diffSum && (id === "curSum" || id === "cur" || id === "ex" || id === "en")) {
        out.push(num((l as unknown as Record<string, number>)[id], " red", "재원 줄을 더한 값이 집행현황과 달라요"));
        continue;
      }
      out.push(num((l as unknown as Record<string, number>)[id]));
    }
    return out;
  };

  // 메모는 세부사업마다 하나(사업 줄의 연필). 연도·재원 줄은 빈 칸
  const memoCell = cell("");
  const memoBtn = (name: string) => {
    const memo = setups[name]?.memo ?? "";
    const has = !isEmptyMemo(memo);
    return cell(
      <button
        type="button"
        className={"bd-memo" + (has ? " has" : "")}
        aria-label={has ? "메모 편집" : "메모 쓰기"}
        title={has ? memoToText(memo) : "메모 쓰기"}
        onDoubleClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setPop({ t: "memo", name, x: Math.max(8, r.right - 440), y: r.bottom + 4 });
        }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={has ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </button>,
    );
  };
  const saveMemo = (name: string) => {
    const s = setups[name];
    if (!s) return;
    const html = memoHtml.current;
    const clean = isEmptyMemo(html) ? "" : sanitize(html);
    setPop(null);
    if ((s.memo ?? "") !== clean) saveSetup(name, { ...s, memo: clean });
  };
  // 메모 창: 바깥 누르기 = 저장, Esc = 취소(집행현황과 같게)
  useEffect(() => {
    if (pop?.t !== "memo") return;
    const { name } = pop;
    memoHtml.current = setups[name]?.memo ?? "";
    const t = window.setTimeout(() => popRef.current?.querySelector<HTMLElement>(".rte-area")?.focus(), 0);
    const down = (e: MouseEvent) => {
      if ((e.target as Element).closest?.(".bd-pop")) return;
      saveMemo(name);
    };
    document.addEventListener("mousedown", down, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", down, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop]);

  // ---------- 엑셀 ----------
  /** 보이는 해의 모든 줄(접힌 것도 펼쳐서) */
  const exportLines = (): BStatusLine[] => {
    const out: BStatusLine[] = [];
    for (const p of shown) {
      const s = setups[p.name];
      if (!s) continue;
      const single = !s.multi;
      const book = compute(p.name, s, byYear, single ? [year] : p.years);
      const one = s.sources.length === 1;
      const period = s.multi ? `${s.from}~${s.to}년` : "단년도";
      const memo = memoToText(s.memo ?? "");
      if (single) {
        const yb = book.years[0];
        if (!yb) continue;
        out.push(lineOf("pj", period, p.name, one ? yb.bySrc[s.sources[0]] : yb.total, memo));
        if (!one) for (const src of s.sources) out.push(lineOf("gun", src, "", yb.bySrc[src]));
        continue;
      }
      out.push(lineOf("pj", period, p.name, book.total, memo));
      for (const b of book.years) {
        out.push(lineOf("it", `${b.year}년`, "", one ? b.bySrc[s.sources[0]] : b.total));
        if (!one) for (const src of s.sources) out.push(lineOf("gun", src, "", b.bySrc[src]));
      }
    }
    return out;
  };
  const exportExcel = async () => {
    setPop(null);
    const fname = `예산현황_${year}_${todayStr()}.xlsx`;
    const dir = await lastDir();
    let path: string | null = joinPath(dir, fname);
    if (inApp) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      path = await save({ title: "다른 이름으로 저장", defaultPath: path, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }] });
      if (!path) return;
      if (!/\.xlsx$/i.test(path)) path += ".xlsx";
    }
    try {
      await api.bstatusExcelWrite(path, { year, unit, date: todayStr(), lines: exportLines() });
      const d = dirOf(path);
      if (d) api.set(DIR_KEY, d).catch(() => {});
      setToast(`${year}년 예산현황을 저장했어요 · ${path}`);
    } catch (e) {
      setToast(e === "io" ? "저장하지 못했어요. 엑셀에서 열려 있으면 닫고 다시 해 주세요." : errorText(e));
    }
  };
  const importExcel = async () => {
    setPop(null);
    let path: string | null = null;
    if (inApp) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await lastDir();
      const p = await open({ title: "열기", defaultPath: dir || undefined, multiple: false, directory: false, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx", "xlsm", "xls"] }] });
      path = typeof p === "string" ? p : null;
    } else path = joinPath(await lastDir(), `예산현황_${year}.xlsx`);
    if (!path) return;
    try {
      const sheets = await api.budgetExcelRead(path);
      const d = dirOf(path);
      if (d) api.set(DIR_KEY, d).catch(() => {});
      let cells: ReturnType<typeof parseBStatusSheet> = null;
      for (const sh of sheets) {
        cells = parseBStatusSheet(sh.rows, year, setups);
        if (cells) break;
      }
      if (!cells) {
        setToast("예산현황 모양의 시트를 찾지 못했어요");
        return;
      }
      // 앱에 없는 세부사업·재원·기간 밖의 해는 건너뛰어요
      const ok = cells.filter((c) => {
        const s = setups[c.name];
        if (!s || !s.sources.includes(c.src)) return false;
        return s.multi ? c.year >= s.from && c.year <= s.to : c.year === year;
      });
      setAsk({ path, cells: ok, skipped: cells.length - ok.length });
    } catch (e) {
      setToast(e === "io" ? "파일을 열지 못했어요." : errorText(e));
    }
  };
  const doImport = () => {
    if (!ask) return;
    const next = { ...setups };
    for (const c of ask.cells) {
      const s = next[c.name];
      if (!s) continue;
      const m: Manual = { ...c.m };
      // 집행현황에서 오는 칸(재원 하나 + 그 해 집행현황 있음)은 파일 값을 받지 않아요
      if (s.sources.length === 1 && linkedOf(byYear[c.year] ?? [], c.name)) delete m.en;
      next[c.name] = { ...s, rows: { ...s.rows, [`${c.year}:${c.src}`]: { ...(s.rows[`${c.year}:${c.src}`] ?? {}), ...m } } };
    }
    setSetups(next);
    for (const c of new Set(ask.cells.map((c) => c.name))) {
      api.bstatusSet(c, JSON.stringify(next[c])).catch(() => {});
      void pushAct(c, next[c], names.find((x) => x.name === c)?.years ?? []);
    }
    setToast(`${ask.cells.length}줄을 가져왔어요`);
    setAsk(null);
  };

  // ---------- 설정 상자 ----------
  const setupBody = (name: string) => {
    const s = setups[name];
    if (!s) return null;
    const yr = (k: "from" | "to") => (
      <input
        className="fld bd-in bs-yr"
        aria-label={k === "from" ? "시작 연도" : "끝 연도"}
        value={s[k]}
        onChange={(e) => {
          const v = Number(e.target.value.replace(/\D/g, "").slice(0, 4));
          if (v >= 2000 && v <= 2100) saveSetup(name, { ...s, [k]: v });
        }}
      />
    );
    return (
      <div className="bs-setup" onMouseDown={(e) => e.stopPropagation()}>
        <div className="bs-row">
          <span className="bs-lab">사업</span>
          <span className="bd-unit bs-kind" role="group" aria-label="단년도 · 다년도">
            <button type="button" className={"btn" + (!s.multi ? " on" : "")} aria-pressed={!s.multi} onClick={() => saveSetup(name, { ...s, multi: false })}>단년도</button>
            <button type="button" className={"btn" + (s.multi ? " on" : "")} aria-pressed={s.multi} onClick={() => saveSetup(name, { ...s, multi: true })}>다년도</button>
          </span>
          {s.multi && (
            <>
              <span className="bs-lab bs-lab2">기간</span>
              {yr("from")}
              <span className="bs-tilde">~</span>
              {yr("to")}
            </>
          )}
        </div>
        <div className="bs-row">
          <span className="bs-lab">재원</span>
          <span className="bs-srcs">
            {SOURCES.filter((x) => x !== "기타").map((x) => {
              const on = s.sources.includes(x);
              const last = on && s.sources.length === 1;
              return (
                <button
                  key={x}
                  type="button"
                  className={"bs-src" + (on ? " on" : "")}
                  aria-pressed={on}
                  title={last ? "재원은 하나 이상 있어야 해요" : undefined}
                  onClick={() => { if (last) return; saveSetup(name, { ...s, sources: on ? s.sources.filter((y) => y !== x) : [...s.sources, x] }); }}
                >
                  {x}
                </button>
              );
            })}
            {s.sources.filter((x) => !(SOURCES as readonly string[]).includes(x)).map((x) => (
              <span key={x} className="bs-src on bs-src-x">
                {x}
                <button type="button" className="chip-x" aria-label={x + " 빼기"} disabled={s.sources.length === 1} onClick={() => saveSetup(name, { ...s, sources: s.sources.filter((y) => y !== x) })}>
                  {ICON(X, 11)}
                </button>
              </span>
            ))}
            <input
              className="fld bd-in bs-other"
              placeholder="기타 재원 · Enter"
              aria-label="기타 재원 이름"
              value={newSrc}
              onChange={(e) => setNewSrc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && newSrc.trim()) {
                  if (!s.sources.includes(newSrc.trim())) saveSetup(name, { ...s, sources: [...s.sources, newSrc.trim()] });
                  setNewSrc("");
                }
              }}
            />
          </span>
        </div>
        <div className="bs-row">
          <span className="bs-lab">이월 사업</span>
          <select className="fld bd-in bs-sel" aria-label="이어 붙일 이월 세부사업" value={s.carry} onChange={(e) => saveSetup(name, { ...s, carry: e.target.value })}>
            <option value="">없음</option>
            {carryNames.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} · {c.years.join("·")}
              </option>
            ))}
          </select>
          {s.carry && s.sources.length > 1 && (
            <select className="fld bd-in bs-sel2" aria-label="이월 사업 값이 들어갈 재원" value={s.carrySrc || s.sources[0]} onChange={(e) => saveSetup(name, { ...s, carrySrc: e.target.value })}>
              {s.sources.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="bs-hint">단년도는 집행현황에 있는 해마다 따로, 다년도는 남은 돈이 다음 해 전년도 이월로 이어져요. 이월 세부사업을 이으면 예산은 전년도 이월, 집행액은 집행(명시)로.</div>
      </div>
    );
  };

  const mi = (t: string, onClick: (() => void) | null) => (
    <div className={"bd-mi bs-mi" + (!onClick ? " off" : "")} role="menuitem" aria-disabled={!onClick} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      <span className="bd-mi-t">{t}</span>
    </div>
  );
  const menuBody = (name: string) => {
    const list = names.map((p) => p.name);
    const i = list.indexOf(name);
    return (
      <>
        {mi("설정", () => { const r = document.querySelector<HTMLElement>(`.bs .bd-rw.pj.sel .bs-gear`)?.getBoundingClientRect(); setPop(r ? { t: "setup", name, x: r.left, y: r.bottom + 4 } : null); })}
        <div className="bd-mdiv" />
        {mi("위로 옮기기", i > 0 ? () => moveRow(name, -1) : null)}
        {mi("아래로 옮기기", i >= 0 && i < list.length - 1 ? () => moveRow(name, 1) : null)}
      </>
    );
  };

  const formKeys = (e: RKeyboardEvent) => {
    const a = keyAction(e, "common");
    if (e.nativeEvent.isComposing) return;
    if (a === "common.cancel") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  // ---------- 그리기 ----------
  const rows: ReactNode[] = [];
  for (const p of shown) {
    const s = setups[p.name];
    if (!s) continue;
    const single = !s.multi;
    const book = compute(p.name, s, byYear, single ? [year] : p.years);
    const one = s.sources.length === 1;
    const oneSrc = s.sources[0];
    const yb = single ? book.years[0] : null;
    const isOpen = single ? !one && openY[p.name + ":" + year] !== false : !!open[p.name];
    const srcLabel = s.multi ? `${s.from}~${s.to}년` : "단년도"; // 사업기간 열(2026-10-19 사용자): 단년도 "단년도", 다년도 "2025~2027년"
    const pjEditing = single && one && form && form.name === p.name && form.year === year && form.src === oneSrc ? form : null;
    rows.push(
      <div
        key={p.name}
        ref={pjEditing ? formRow : undefined}
        className={"bd-rw pj" + (sel === p.name ? " sel" : "") + (pjEditing ? " edit" : "")}
        role="row"
        onClick={() => setSel(p.name)}
        onContextMenu={(e) => { e.preventDefault(); setSel(p.name); setPop({ t: "menu", name: p.name, x: e.clientX, y: e.clientY }); }}
        onDoubleClick={single && one ? () => !pjEditing && startEdit(p.name, year, oneSrc) : undefined}
        onKeyDown={pjEditing ? formKeys : undefined}
      >
        <div className="bd-c bs-yrs" role="cell">
          <span className="bs-years" title={`${s.multi ? `다년도 ${s.from}~${s.to}` : "단년도"} · 재원 ${s.sources.join("·")}`}>{srcLabel}</span>
          <button
            type="button"
            className={"bs-gear" + (pop?.t === "setup" && pop.name === p.name ? " on" : "")}
            aria-label="사업 기간·재원·이월 사업 설정"
            title="단년도/다년도 · 재원 · 이월 사업"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setPop(pop?.t === "setup" && pop.name === p.name ? null : { t: "setup", name: p.name, x: r.left, y: r.bottom + 4 });
            }}
          >
            {ICON(GEAR, 12)}
          </button>
        </div>
        <div className="bd-c" role="cell">
          {isOpen && <span className="bd-tl v1 dn1" />}
          {single && one ? (
            <span className="bd-cr bs-noexp" aria-hidden="true" />
          ) : (
            <button type="button" className="bd-cr" aria-label={isOpen ? "접기" : "펼치기"} onClick={(e) => { e.stopPropagation(); single ? setOpenY((o) => ({ ...o, [p.name + ":" + year]: !isOpen })) : setOpen((o) => ({ ...o, [p.name]: !isOpen })); }}>
              {ICON(isOpen ? CD : CR, 14, 2.2)}
            </button>
          )}
          <span className="bd-nm" title={p.name}>{p.name}</span>
        </div>
        {single && one && yb ? numCells(yb.bySrc[oneSrc], "pj", pjEditing, year, true, yb.hasMain ? ["en"] : []) : numCells(book.total, "pj", null)}
        {memoBtn(p.name)}
      </div>,
    );
    if (!isOpen) continue;
    if (single && yb) {
      // 단년도 + 재원 여럿: 연도 줄 없이 재원 줄만
      s.sources.forEach((src, si) => {
        const l = yb.bySrc[src];
        const last = si === s.sources.length - 1;
        const editing = form && form.name === p.name && form.year === year && form.src === src ? form : null;
        rows.push(
          <div
            key={p.name + ":" + src}
            ref={editing ? formRow : undefined}
            className={"bd-rw gun" + (si % 2 ? " alt" : "") + (editing ? " edit" : "")}
            role="row"
            onDoubleClick={() => !editing && startEdit(p.name, year, src)}
            onKeyDown={editing ? formKeys : undefined}
          >
            <div className="bd-c bs-yrs" role="cell" />
            <div className="bd-c" role="cell">
              <span className={"bd-tl v1" + (last ? " half" : "")} />
              <span className="bd-tl h1" />
              <span className="bd-cr ind1 bs-noexp" aria-hidden="true" />
              <span className="bd-nm">{src}</span>
            </div>
            {numCells(l, "gun", editing, year, true)}
            {memoCell}
          </div>,
        );
      });
      continue;
    }
    book.years.forEach((b, yi) => {
      const lastY = yi === book.years.length - 1;
      const yk = p.name + ":" + b.year;
      const yOpen = openY[yk] !== false;
      const first = yi === 0;
      // 재원이 하나면 재원 줄은 연도 줄과 값이 같아 그리지 않아요(2026-10-19 사용자) — 연도 줄을 두 번 누르면 바로 고쳐요
      const one = s.sources.length === 1;
      const oneSrc = s.sources[0];
      const yEditing = one && form && form.name === p.name && form.year === b.year && form.src === oneSrc ? form : null;
      rows.push(
        <div
          key={yk}
          ref={yEditing ? formRow : undefined}
          className={"bd-rw it" + (yEditing ? " edit" : "")}
          role="row"
          onDoubleClick={one ? () => !yEditing && startEdit(p.name, b.year, oneSrc) : undefined}
          onKeyDown={yEditing ? formKeys : undefined}
        >
          <div className="bd-c bs-yrs" role="cell" />
          <div className="bd-c" role="cell">
            <span className={"bd-tl v1" + (lastY ? " half" : "")} />
            <span className="bd-tl h1" />
            {!one && yOpen && <span className="bd-tl v2 dn2" />}
            {one ? (
              <span className="bd-cr ind1 bs-noexp" aria-hidden="true" />
            ) : (
              <button type="button" className="bd-cr ind1" aria-label={yOpen ? "접기" : "펼치기"} onClick={() => setOpenY((o) => ({ ...o, [yk]: !yOpen }))}>
                {ICON(yOpen ? CD : CR, 14, 2.2)}
              </button>
            )}
            <span className="bd-nm">{b.year}년</span>
            <span className="bs-note">{b.linked ? "집행현황" : "직접 입력"}</span>
          </div>
          {one ? numCells(b.bySrc[oneSrc], "it", yEditing, b.year, first, b.hasMain ? ["en"] : []) : numCells(b.total, "it", null, b.year, first)}
          {memoCell}
        </div>,
      );
      if (one || !yOpen) return;
      s.sources.forEach((src, si) => {
        const l = b.bySrc[src];
        const last = lastY && si === s.sources.length - 1;
        const editing = form && form.name === p.name && form.year === b.year && form.src === src ? form : null;
        rows.push(
          <div
            key={yk + ":" + src}
            ref={editing ? formRow : undefined}
            className={"bd-rw gun" + (si % 2 ? " alt" : "") + (editing ? " edit" : "")}
            role="row"
            onDoubleClick={() => !editing && startEdit(p.name, b.year, src)}
            onKeyDown={editing ? formKeys : undefined}
          >
            <div className="bd-c bs-yrs" role="cell" />
            <div className="bd-c" role="cell">
              {!lastY && <span className="bd-tl v1" />}{/* 바깥 세로선은 마지막 해 아래로는 안 내려가요 */}
              <span className={"bd-tl v2" + (last ? " half" : "")} />
              <span className="bd-tl h2" />
              <span className="bd-nm bd-gpad">{src}</span>
            </div>
            {numCells(l, "gun", editing, b.year, first)}
            {memoCell}
          </div>,
        );
      });
    });
  }

  const seg = (a: string, b: string, on: 0 | 1, pick: (i: 0 | 1) => void, label: string) => (
    <span className="bd-unit" role="group" aria-label={label}>
      <button type="button" className={on === 0 ? "on" : ""} aria-pressed={on === 0} onClick={() => pick(0)}>{a}</button>
      <button type="button" className={on === 1 ? "on" : ""} aria-pressed={on === 1} onClick={() => pick(1)}>{b}</button>
    </span>
  );

  return (
    <div ref={rootRef} className={"bd bs" + (packed ? " bd-packed" : "")}>
      <div className="bd-top" style={packed ? { width: colSum + 1 } : undefined}>
        <h1 className="title">예산현황</h1>
        <span className="bd-year">
          <button type="button" aria-label="이전 해" onClick={() => changeYear(year - 1)}>
            {ICON("M15 6l-6 6 6 6", 16, 2.2)}
          </button>
          <b>{year}년</b>
          <button type="button" aria-label="다음 해" onClick={() => changeYear(year + 1)}>
            {ICON("M9 6l6 6-6 6", 16, 2.2)}
          </button>
        </span>
        <span className="bd-sp" />
        <button type="button" className="btn btn-ctrl bd-tool" title="열 간격을 보이는 내용 폭에 맞춰요 · 열 제목 우클릭으로 처음대로" onClick={fitAll}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5v14M21 5v14M3 12h6M21 12h-6M6 9l3 3-3 3M18 9l-3 3 3 3" />
          </svg>
          배치최적화
        </button>
        {seg("요약", "자세히", detail ? 1 : 0, (i) => { setDetail(i === 1); api.set(VIEW_KEY, i === 1 ? "detail" : "summary").catch(() => {}); }, "보기")}
        {seg("원", "천원", unit === 1 ? 0 : 1, (i) => { setUnit(i ? 1000 : 1); api.set(UNIT_KEY, i ? "1000" : "1").catch(() => {}); }, "금액 단위")}
        <label className="search bd-search">
          {ICON("M11 4a7 7 0 1 1 0 14a7 7 0 1 1 0-14z M20 20l-3.5-3.5", 16)}
          <input type="text" aria-label="세부사업 검색" placeholder="세부사업 검색" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        <button
          type="button"
          className="btn btn-ctrl btn-text xl-btn"
          aria-haspopup="menu"
          aria-expanded={pop?.t === "excel"}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPop(pop?.t === "excel" ? null : { t: "excel", x: r.right - 200, y: r.bottom + 4 });
          }}
        >
          엑셀{ICON(CD, 13)}
        </button>
      </div>
      <div className="bd-tbl" style={{ ["--bd-cols" as string]: tmpl, ...(packed ? { width: colSum + 2 + sbw } : {}) }}>
        <div ref={scroller} className="bd-scroll">
          <div className={"bd-hd" + (detail ? " bs-hd2" : "")} role="row" onContextMenu={resetCols}>
            {cols.map((c, i) => {
              const cls = "bd-h" + (c.num ? " bs-hn" : "");
              if (!detail) return <div key={c.id} className={cls} role="columnheader" data-ci={i}>{c.label}{grip(c)}</div>;
              if (!c.sub) {
                return (
                  <div key={c.id} className={cls + " bs-span"} role="columnheader" data-ci={i} style={{ gridColumn: `${i + 1}`, gridRow: "1 / span 2" }}>
                    {c.label}
                    {grip(c)}
                  </div>
                );
              }
              // 묶음 머리: 이 열에서 시작해 label 없는 sub 열이 이어지는 만큼 걸쳐요
              let n = 1;
              while (cols[i + n] && cols[i + n].sub && !cols[i + n].label) n++;
              return (
                <Fragment key={c.id}>
                  {c.label && <div className="bd-h bs-grp" role="columnheader" style={{ gridColumn: `${i + 1} / span ${n}`, gridRow: 1 }}>{c.label}</div>}
                  <div className={cls} role="columnheader" data-ci={i} style={{ gridColumn: `${i + 1}`, gridRow: 2 }}>{c.sub}{grip(c)}</div>
                </Fragment>
              );
            })}
          </div>
          <div className="bd-body" role="rowgroup">
            {rows}
            {!rows.length && <div className="bd-empty"><p className="bd-empty-bs">{year}년에 보여 줄 세부사업이 없어요</p></div>}
          </div>
        </div>
      </div>
      {ask && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setAsk(null)}>
          <div className="dialog xl-ask" role="dialog" aria-modal="true" aria-label="엑셀 가져오기">
            <div className="xl-ask-body">
              <h2 className="xl-ask-title">{ask.cells.length ? `${ask.cells.length}줄의 직접 적는 값을 가져올까요?` : "가져올 줄이 없어요"}</h2>
              <div className="xl-ask-path">
                {ask.path}
                {ask.skipped > 0 && ` · 앱에 없는 세부사업·재원·기간 밖의 해 ${ask.skipped}줄은 건너뛰어요`}
                {" · 집행현황에서 오는 집행액은 파일 값을 받지 않아요"}
              </div>
            </div>
            <div className="xl-ask-foot">
              <button type="button" className="btn btn-ctrl btn-text" onClick={() => setAsk(null)}>취소</button>
              {ask.cells.length > 0 && (
                <button type="button" className="btn-primary btn-ctrl" autoFocus onClick={doImport}>가져오기</button>
              )}
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="bd-toast" role="status">
          {toast}
        </div>
      )}
      {pop && (
        <div ref={popRef} className="bd-pop" role={pop.t === "menu" ? "menu" : "dialog"} aria-label={pop.t === "menu" ? "세부사업 메뉴" : "사업 설정"} style={popPos ?? { left: pop.x, top: pop.y, visibility: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
          {pop.t === "setup" && setupBody(pop.name)}
          {pop.t === "menu" && menuBody(pop.name)}
          {pop.t === "excel" && (
            <div style={{ width: 200 }}>
              {mi("가져오기", () => void importExcel())}
              {mi(`내보내기 · ${unit === 1 ? "원" : "천원"}`, () => void exportExcel())}
            </div>
          )}
          {pop.t === "memo" && (
            <div className="bd-memopop">
              <div className="bd-mh">{pop.name}</div>
              <MemoEditor lite initial={setups[pop.name]?.memo ?? ""} placeholder="사업 메모" onChange={(h) => (memoHtml.current = h)} onSubmit={() => saveMemo(pop.name)} onCancel={() => setPop(null)} />
              <div className="bd-mrow">
                <span className="bd-kh">Enter 같은 위계 · Shift+Enter 아래 · Ctrl+Enter 위 · Tab 저장</span>
                <span className="bd-mbtns">
                  <button type="button" className="btn btn-xs" onClick={() => setPop(null)}>취소</button>
                  <button type="button" className="btn btn-xs bd-p" onClick={() => saveMemo(pop.name)}>저장</button>
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
