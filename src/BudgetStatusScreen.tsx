// 예산현황(13단계) 화면 – 집행현황과 같은 표 부품(bd-*)으로, 세부사업 › 연도 › 재원 세 겹.
// 시안: 캔버스 BudgetStatus(요약)·BudgetStatusDetail(자세히), 2026-10-19 사용자 결정(설정 단추는 작은 네모 하나, 숫자는 모두 오른쪽, 추경 열은 빼지 않음, 엑셀 열 비율 참고).
// - 세부사업은 집행현황에서 자동으로 와요(이월 세부사업은 이어 붙이는 쪽). 사업명 옆 ⚙ 단추 → 단년도/다년도(기간)·재원·이월 사업.
// - 재원 줄 두 번 누르기 = 고치는 줄(직접 적는 칸만 열려요), 바깥 누르기 = 저장, Esc = 취소. 규칙은 budgetStatus.ts.
import { DialogX } from "./DialogX";
import React, { KeyboardEvent as RKeyboardEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import { api, errorText, inApp } from "./api";
import { BudgetProject, fmt, okWon, parseWon, typing, Unit } from "./budget";
import { BStatusLine, compute, defaultSetup, Line, lineOf, linkedOf, Manual, parseBStatusSheet, projectNames, Setup } from "./budgetStatus";
import { BudgetStatusSend, SendTarget } from "./BudgetStatusSend";
import { parseV3, planV3, V3Plan } from "./budgetStatusImport";
import { dirOf, DIR_KEY, joinPath, lastDir } from "./ExcelMenu";
import { isEmptyMemo, MemoEditor, sanitize } from "./RichMemo";
import { memoToText } from "./budget";
import { todayStr } from "./journal";
import { keyAction } from "./keys";
import { overlayDown, useOutsideClose } from "./useOutsideClose";

const ICON = (d: string, s = 14, w = 2) => (
  <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);
const CD = "M6 9l6 6 6-6", CR = "M9 6l6 6-6 6", GEAR = "M4 6h16 M4 12h16 M4 18h16 M9 4v4 M15 10v4 M7 16v4";
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
  { id: "next", label: "다음연도 이월", w: 152, num: true },
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
  { id: "next", label: "다음연도 이월", sub: "소계", w: 132, num: true },
  { id: "nm", label: "", sub: "명시이월", w: 132, num: true },
  { id: "ns", label: "", sub: "사고이월", w: 132, num: true },
  { id: "un", label: "불용액", w: 132, num: true },
  { id: "memo", label: "메모", w: 48 },
];
/** 직접 적을 수 있는 칸(재원 줄) */
const EDIT_FIELDS: (keyof Manual)[] = ["cur", "a1", "a2", "a3", "a4", "pm", "ps", "en", "em", "es", "nm", "ns", "un"];

type Pop = { t: "menu"; name: string; x: number; y: number } | { t: "memo"; name: string; x: number; y: number } | { t: "excel"; x: number; y: number };
type Ask = { path: string; cells: { name: string; year: number; src: string; m: Manual }[]; skipped: number };
type Form = { name: string; year: number; src: string; text: Record<string, string> };

export default function BudgetStatusScreen() {
  const [byYear, setByYear] = useState<Record<number, BudgetProject[]>>({});
  const [setups, setSetups] = useState<Record<string, Setup>>({});
  const [unit, setUnit] = useState<Unit>(1);
  const [detail, setDetail] = useState(false);
  // 보는 해(집행현황처럼 ◀ 2026년 ▶): 단년도 사업은 이 해 것만 한 줄, 다년도 사업은 기간에 이 해가 들면 모든 해를 펼쳐요(2026-10-19 사용자)
  const [year, setYear] = useState(Number(todayStr().slice(0, 4)));
  // 줄 순서(우클릭 위로·아래로): 세부사업 이름 목록, kv bstatus.order – 목록에 없는 것은 집행현황 순서대로 뒤에
  const [order, setOrder] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openY, setOpenY] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const formRow = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  // 열 폭(집행현황과 같은 배치최적화·끌기·두 번 누르기·우클릭 처음대로) – 요약·자세히 따로, kv bstatus.cols
  const [W, setW] = useState<Record<string, Record<string, number>>>({});
  const [boxW, setBoxW] = useState(0);
  const [sbw, setSbw] = useState(0);
  const [toast, setToast] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askV3, setAskV3] = useState<V3Plan | null>(null);
  /** 보내기/설정 창(집행현황 우클릭과 같은 창) */
  const [send, setSend] = useState<string | null>(null);
  const memoHtml = useRef("");
  const scroller = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ---------- 읽기: 집행현황 여러 해 + 설정 ----------
  const thisYear = Number(todayStr().slice(0, 4));
  const load = useCallback(async () => {
    const out: Record<number, BudgetProject[]> = {};
    const read = async (y: number) => {
      try {
        const d = await api.budgetData(y);
        if (d.length) out[y] = d;
      } catch {
        /* 그 해 없음 */
      }
    };
    for (let y = thisYear - 3; y <= thisYear + 2; y++) await read(y);
    const saved = new Map<string, string>();
    try {
      for (const r of await api.bstatusList()) saved.set(r.name, r.setup);
    } catch {
      /* 없으면 처음 값 */
    }
    // 다년도 사업의 기간이 기본 창(올해 −3~+2해) 밖이면 그 해들도 읽어요 — 과거 자료 가져오기(2026-10-26 연동 세션)
    for (const v of saved.values()) {
      try {
        const s = JSON.parse(v) as Partial<Setup>;
        if (!s.multi || !s.from || !s.to) continue;
        for (let y = Math.max(1990, s.from); y <= Math.min(2100, s.to); y++) if (!(y in out)) await read(y);
      } catch {
        /* 못 읽는 설정은 건너뜀 */
      }
    }
    setByYear(out);
    const names = projectNames(out);
    const st: Record<string, Setup> = {};
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
    // 집행현황에서 "예산현황으로 보내기"를 한 사업만(2026-10-20 사용자 2안). 어느 사업에 이어진 이월 세부사업은 그 사업 안으로
    const linked = new Set(Object.values(setups).map((s) => s.carry).filter(Boolean));
    const all = projectNames(byYear).filter((p) => setups[p.name]?.sent && !linked.has(p.name));
    const pos = new Map(order.map((n, i) => [n, i]));
    return [...all].sort((a, b) => (pos.get(a.name) ?? 1e9) - (pos.get(b.name) ?? 1e9));
  }, [byYear, order, setups]);
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

  const saveSetup = (name: string, s: Setup) => {
    setSetups((o) => ({ ...o, [name]: s }));
    api.bstatusSet(name, JSON.stringify(s)).catch(() => {});
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
  useOutsideClose(!!form, [formRow], () => save(), { ignore: ".bd-pop" });

  // ---------- 뜨는 상자 ----------
  useLayoutEffect(() => {
    if (!pop || !popRef.current) {
      setPopPos(null);
      return;
    }
    const r = popRef.current.getBoundingClientRect();
    setPopPos({ left: Math.max(8, Math.min(pop.x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(pop.y, innerHeight - r.height - 8)) });
  }, [pop]);
  useOutsideClose(!!pop, [], () => setPop(null), { ignore: ".bd-pop" });

  const view = detail ? "detail" : "summary";
  const base = detail ? DET_COLS : SUM_COLS;
  const wv = W[view] ?? {};
  const widthOf = (c: Col) => (FIXED.has(c.id) ? c.w : wv[c.id] ?? c.w);
  // 구분 열도 다른 열과 같은 규칙(2026-10-19 사용자 – 집행현황의 "남는 폭 채우기"는 여기선 안 써요)
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
  // 숫자 글자: 0은 "-"(짧은 하이픈), 음수도 하이픈(2026-10-19 사용자 – 긴 줄표는 쓰지 않아요)
  const fz = (v: number) => (v === 0 ? "-" : fmt(v, unit).replace("−", "-"));
  // 직접 적는 칸(bs-ed)은 입력칸 모양 테두리 상자로 보여요(2026-10-20 사용자 – 살색 바탕 대신)
  const num = (v: number | null | undefined, cls = "", title?: string) => {
    const t = v == null ? "" : fz(v);
    return cls.includes("bs-ed") ? cell(<span className={"bs-fld" + (cls.includes(" red") ? " red" : "")}>{t}</span>, " n" + cls, title) : cell(t, " n" + cls, title);
  };
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
  /** 재원이 둘 이상인 사업: 그 해 집행현황에 있으면 재원 줄 집행액은 공사별 재원대로 와요(본예산은 직접 – 보내기 창 "재원별 예산"과 같은 값) */
  const splitYear = (name: string, y: number) => (byYear[y] ?? []).some((x) => x.name === name);
  /** 집행현황에서 오는 칸: 보통 본예산·집행 당해, 잇지 않은 이월 세부사업은 명시/사고 쪽 */
  const lockOf = (name: string) => (/^\(명시이월\)/.test(name) ? ["pm", "em"] : /^\(사고이월\)/.test(name) ? ["ps", "es"] : ["cur", "en"]);
  // lock: 집행현황에서 오는 칸(재원 하나 + 그 해 집행현황 있음 → 본예산·집행 당해)은 고치는 줄에서도 값만 보여요
  // canEdit: 이 줄을 두 번 눌러 고칠 수 있는 줄(재원 줄, 재원 하나면 연도 줄, 단년도+재원 하나면 사업 줄) – 직접 적는 칸을 살색으로 표시해요(2026-10-20 사용자)
  const numCells = (l: Line, kind: "pj" | "it" | "gun", editing: Form | null, year?: number, first = false, lock: string[] = [], canEdit = false) => {
    const out: ReactNode[] = [];
    /** 이 열이 직접 적는 칸인지(요약은 당해예산→본예산, 전년도 이월→명시(첫 해), 집행액→당해, 다음연도 이월→명시) */
    const manualOf = (id: string): string | null => {
      if (!detail) {
        if (id === "curSum") return "cur";
        if (id === "prev") return first ? "pm" : null;
        if (id === "ex") return "en";
        if (id === "next") return "nm";
      }
      if ((EDIT_FIELDS as string[]).includes(id)) return (id === "pm" || id === "ps") && !first ? null : id;
      return null;
    };
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
      const mf = canEdit ? manualOf(id) : null;
      const ed = mf && !lock.includes(mf) ? " bs-ed" : "";
      if (editing && (EDIT_FIELDS as string[]).includes(id) && !lock.includes(id) && !((id === "pm" || id === "ps") && !first)) {
        out.push(edit(id as keyof Manual, c.sub || c.label));
        continue;
      }
      // 요약의 당해예산·전년도 이월·집행액 칸을 고칠 때는 본예산·명시이월·당해로 받아요
      if (editing && !detail) {
        if (id === "curSum" && !lock.includes("cur")) { out.push(edit("cur", "본예산")); continue; }
        if (id === "prev" && first) { out.push(edit("pm", "명시이월")); continue; }
        if (id === "ex" && !lock.includes("en")) { out.push(edit("en", "집행액(당해)")); continue; }
        if (id === "next") { out.push(edit("nm", "다음연도 이월(명시)")); continue; }
      }
      if (id === "rate") {
        out.push(<div className="bd-c n bs-rate" role="cell" key={id}>{bar(l.rate, kind !== "pj", kind === "gun")}</div>);
        continue;
      }
      if (first && ["prev", "pm", "ps"].includes(id) && !(l as unknown as Record<string, number>)[id]) {
        out.push(ed ? cell(<span className="bs-fld" />, " n" + ed) : cell("", " n"));
        continue;
      }
      if (id === "next") {
        out.push(num(l.next, ed, l.left ? `남은 돈 ${fz(l.left)}(현액 − 집행 − 이월 − 불용)` : undefined));
        continue;
      }
      if (id === "nm" || id === "ns") {
        out.push(num(id === "nm" ? l.nm : l.ns, ed));
        continue;
      }
      if (id === "prev" || id === "pm") {
        const v = (l as unknown as Record<string, number>)[id];
        out.push(num(v, (l.mismatch ? " red" : "") + ed, l.mismatch && year ? `${year - 1}년 다음연도 이월과 달라요` : undefined));
        continue;
      }
      if (kind === "it" && l.diffSum && (id === "curSum" || id === "cur")) {
        out.push(num((l as unknown as Record<string, number>)[id], " red" + ed, "재원별 예산을 더한 값이 집행현황 예산과 달라요 – ⚙ 예산현황 설정에서 재원별 예산을 적어요"));
        continue;
      }
      out.push(num((l as unknown as Record<string, number>)[id], ed));
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
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop]);
  useOutsideClose(pop?.t === "memo", [], () => pop?.t === "memo" && saveMemo(pop.name), { ignore: ".bd-pop", capture: true });

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
  // ---------- 계약현황 양식 가져오기(2026-10-26 연동 세션 — 과거 자료는 엑셀로) ----------
  const importV3 = async () => {
    setPop(null);
    let path: string | null = null;
    if (inApp) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await lastDir();
      const p = await open({ title: "열기", defaultPath: dir || undefined, multiple: false, directory: false, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx", "xlsm", "xls"] }] });
      path = typeof p === "string" ? p : null;
    } else path = joinPath(await lastDir(), "계약현황.xlsx");
    if (!path) return;
    try {
      const sheets = await api.budgetExcelRead(path);
      const d = dirOf(path);
      if (d) api.set(DIR_KEY, d).catch(() => {});
      const parsed = parseV3(sheets);
      if (typeof parsed === "string") {
        setToast(parsed);
        return;
      }
      const plan = planV3(parsed, byYear);
      if (typeof plan === "string") {
        setToast(plan);
        return;
      }
      setAskV3(plan);
    } catch (e) {
      setToast(e === "io" ? "파일을 열지 못했어요." : errorText(e));
    }
  };
  const doImportV3 = async () => {
    if (!askV3) return;
    const { parsed, perYear, setup } = askV3;
    try {
      const split: NonNullable<Setup["split"]> = {};
      const uids = new Set<string>();
      // 집행현황에 등록(사용자 1안) — 해마다 본사업·이월 사업과 공사 줄을 만들고, 만든 줄의 uid로 공사별 재원을 적어요
      for (const y of askV3.years) {
        const { list, cells } = perYear[y];
        const [data] = await api.importBudget(y, list);
        for (const c of cells) {
          const pj = data.find((p) => p.name === c.project);
          const row = pj?.items.flatMap((it) => it.rows).find((r) => r.name === c.row);
          if (row) split[`${y}:${row.uid}`] = c.funds;
        }
        const main = data.find((p) => p.name === parsed.name);
        if (main) uids.add(main.uid);
      }
      for (const y of askV3.skipped) {
        const main = (byYear[y] ?? []).find((p) => p.name === parsed.name);
        if (main) uids.add(main.uid);
      }
      const prev = setups[parsed.name];
      const next: Setup = {
        ...setup,
        rows: { ...(prev?.rows ?? {}), ...setup.rows },
        split: { ...(prev?.split ?? {}), ...split },
        uids: [...new Set([...(prev?.uids ?? []), ...uids])],
        memo: prev?.memo,
      };
      await api.bstatusSet(parsed.name, JSON.stringify(next));
      setAskV3(null);
      setToast(`"${parsed.name}" ${askV3.years.length}개 해를 가져왔어요${askV3.skipped.length ? ` · ${askV3.skipped.join("·")}년은 집행현황 자료가 있어 건너뛰었어요` : ""}`);
      await load();
    } catch (e) {
      setToast(errorText(e));
    }
  };
  const doImport = () => {
    if (!ask) return;
    const next = { ...setups };
    for (const c of ask.cells) {
      const s = next[c.name];
      if (!s) continue;
      const m: Manual = { ...c.m };
      // 집행현황에서 오는 칸은 파일 값을 받지 않아요(재원 하나면 본예산·집행 당해, 둘 이상이면 집행 당해)
      if (linkedOf(byYear[c.year] ?? [], c.name)) for (const k of s.sources.length === 1 ? lockOf(c.name) : ["en"]) delete m[k as keyof Manual];
      next[c.name] = { ...s, rows: { ...s.rows, [`${c.year}:${c.src}`]: { ...(s.rows[`${c.year}:${c.src}`] ?? {}), ...m } } };
    }
    setSetups(next);
    for (const c of new Set(ask.cells.map((c) => c.name))) api.bstatusSet(c, JSON.stringify(next[c])).catch(() => {});
    setToast(`${ask.cells.length}줄을 가져왔어요`);
    setAsk(null);
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
        {mi("예산현황 설정", () => { setPop(null); setSend(name); })}
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
            className={"bs-gear" + (send === p.name ? " on" : "")}
            aria-label="예산현황 설정"
            title="단년도/다년도 · 재원 · 이월 사업 · 재원 매칭"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setSend(p.name);
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
        {single && one && yb ? numCells(yb.bySrc[oneSrc], "pj", pjEditing, year, true, yb.hasMain ? lockOf(p.name) : [], true) : numCells(book.total, "pj", null)}
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
            {numCells(l, "gun", editing, year, true, splitYear(p.name, year) ? ["en"] : [], true)}
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
      // 재원이 하나면 재원 줄은 연도 줄과 값이 같아 그리지 않아요(2026-10-19 사용자) – 연도 줄을 두 번 누르면 바로 고쳐요
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
          {one ? numCells(b.bySrc[oneSrc], "it", yEditing, b.year, first, b.hasMain ? lockOf(p.name) : [], true) : numCells(b.total, "it", null, b.year, first)}
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
            {numCells(l, "gun", editing, b.year, first, splitYear(p.name, b.year) ? ["en"] : [], true)}
            {memoCell}
          </div>,
        );
      });
    });
  }

  const seg = (a: string, b: string, on: 0 | 1, pick: (i: 0 | 1) => void, label: string, cls = "") => (
    <span className={"bd-unit" + cls} role="group" aria-label={label}>
      <button type="button" className={on === 0 ? "on" : ""} aria-pressed={on === 0} onClick={() => pick(0)}>{a}</button>
      <button type="button" className={on === 1 ? "on" : ""} aria-pressed={on === 1} onClick={() => pick(1)}>{b}</button>
    </span>
  );

  return (
    <div ref={rootRef} className={"bd bs" + (packed ? " bd-packed" : "")}>
      <div className="bd-top tb5" style={packed ? { width: colSum + 1 } : undefined}>
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
        {seg("요약", "자세히", detail ? 1 : 0, (i) => { setDetail(i === 1); api.set(VIEW_KEY, i === 1 ? "detail" : "summary").catch(() => {}); }, "보기", " tb-seg-l")}
        {seg("원", "천원", unit === 1 ? 0 : 1, (i) => { setUnit(i ? 1000 : 1); api.set(UNIT_KEY, i ? "1000" : "1").catch(() => {}); }, "금액 단위", " tb-seg-s")}
        <button type="button" className="btn btn-ctrl bd-tool tb-fit" title="열 간격을 보이는 내용 폭에 맞춰요 · 열 제목 우클릭으로 처음대로" onClick={fitAll}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5v14M21 5v14M3 12h6M21 12h-6M6 9l3 3-3 3M18 9l-3 3 3 3" />
          </svg>
          배치최적화
        </button>
        <span className="tb-hole-pop" aria-hidden="true" />
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
          엑셀{ICON(CD, 16, 2.4)}
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
        <div className="bs-guide">
          <span className="bs-guide-sw" aria-hidden="true">-</span> 테두리 칸은 직접 적는 칸 – 줄을 두 번 누르면 고쳐요(불용액·다음연도 이월·추경 등) · 나머지는 집행현황에서 와요
        </div>
      </div>
      {send && (() => {
        const all = projectNames(byYear);
        const me = all.find((x) => x.name === send);
        const ys = me?.years ?? [];
        const yAt = ys.includes(year) ? year : ys[ys.length - 1];
        const target: SendTarget = {
          name: send,
          years: ys,
          year: yAt,
          byYear,
          parents: all.filter((x) => !x.carry && setups[x.name]?.sent && x.name !== send).map((x) => ({ name: x.name, setup: setups[x.name] })),
          carries: all.filter((x) => x.carry && x.name !== send),
        };
        const cur = setups[send];
        return (
          <BudgetStatusSend
            target={target}
            setup={cur?.sent ? cur : null}
            onSave={(ns) => { saveSetup(send, ns); setSend(null); }}
            onAttach={(parent, src) => {
              const ps = setups[parent];
              if (ps) saveSetup(parent, { ...ps, carry: send, carrySrc: src });
              if (cur) saveSetup(send, { ...cur, sent: false });
              setSend(null);
            }}
            onRemove={cur?.sent ? () => { saveSetup(send, { ...cur, sent: false }); setSend(null); } : null}
            onClose={() => setSend(null)}
            onYearData={(y, d) => setByYear((o) => ({ ...o, [y]: d }))}
          />
        );
      })()}
      {ask && (
        <div className="overlay" onMouseDown={overlayDown(() => setAsk(null))}>
          <div
            className="dialog xl-ask"
            role="dialog"
            aria-modal="true"
            aria-label="엑셀 가져오기"
            onKeyDown={(e) => {
              // Esc = 취소(✔7)
              if (e.key === "Escape" && !e.defaultPrevented && !e.nativeEvent.isComposing) {
                e.preventDefault();
                setAsk(null);
              }
            }}
          >
            <DialogX label="닫기(가져오지 않음)" onClick={() => setAsk(null)} />
            <div className="xl-ask-body">
              <h2 className="xl-ask-title">{ask.cells.length ? `${ask.cells.length}줄의 직접 적는 값을 가져올까요?` : "가져올 줄이 없어요"}</h2>
              <div className="xl-ask-path">
                {ask.path}
                {ask.skipped > 0 && ` · 앱에 없는 세부사업·재원·기간 밖의 해 ${ask.skipped}줄은 건너뛰어요`}
                {" · 집행현황에서 오는 당해예산·집행액은 파일 값을 받지 않아요"}
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
      {askV3 && (
        <div className="overlay" onMouseDown={overlayDown(() => setAskV3(null))}>
          <div className="dialog xl-ask" role="dialog" aria-modal="true" aria-label="계약현황 양식 가져오기">
            <div className="xl-ask-body">
              <h2 className="xl-ask-title">"{askV3.parsed.name}"을(를) 가져올까요?</h2>
              <div className="xl-ask-path">
                {askV3.parsed.from === askV3.parsed.to ? `${askV3.parsed.from}년` : `${askV3.parsed.from}~${askV3.parsed.to}년`} · 재원 {askV3.parsed.sources.join("·")} · 계약 {askV3.parsed.contracts.length}건
                {" – "}집행현황에 {askV3.years.join("·")}년의 공사 줄을 만들고 예산현황 설정을 채워요
                {askV3.skipped.length > 0 && ` · ${askV3.skipped.join("·")}년은 집행현황 자료가 있어 건너뛰어요`}
              </div>
            </div>
            <div className="xl-ask-foot">
              <button type="button" className="btn btn-ctrl btn-text" onClick={() => setAskV3(null)}>취소</button>
              {askV3.years.length > 0 && (
                <button type="button" className="btn-primary btn-ctrl" autoFocus onClick={() => void doImportV3()}>가져오기</button>
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
        <div ref={popRef} className="bd-pop" role={pop.t === "menu" ? "menu" : "dialog"} aria-label={pop.t === "menu" ? "세부사업 메뉴" : pop.t === "memo" ? "메모" : "엑셀"} style={popPos ?? { left: pop.x, top: pop.y, visibility: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
          {pop.t === "menu" && menuBody(pop.name)}
          {pop.t === "excel" && (
            <div style={{ width: 200 }}>
              {mi("가져오기", () => void importExcel())}
              {mi("가져오기 · 계약현황 양식", () => void importV3())}
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
