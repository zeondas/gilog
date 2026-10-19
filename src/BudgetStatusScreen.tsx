// 예산현황(13단계) 화면 — 집행현황과 같은 표 부품(bd-*)으로, 세부사업 › 연도 › 재원 세 겹.
// 시안: 캔버스 BudgetStatus(요약)·BudgetStatusDetail(자세히), 2026-10-19 사용자 결정(설정 단추는 작은 네모 하나, 숫자는 모두 오른쪽, 추경 열은 빼지 않음, 엑셀 열 비율 참고).
// - 세부사업은 집행현황에서 자동으로 와요(이월 세부사업은 이어 붙이는 쪽). 사업명 옆 ⚙ 단추 → 단년도/다년도(기간)·재원·이월 사업.
// - 재원 줄 두 번 누르기 = 고치는 줄(직접 적는 칸만 열려요), 바깥 누르기 = 저장, Esc = 취소. 규칙은 budgetStatus.ts.
import React, { KeyboardEvent as RKeyboardEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
import { api } from "./api";
import { BudgetProject, fmt, okWon, parseWon, typing, Unit } from "./budget";
import { compute, defaultSetup, Line, Manual, projectNames, Setup, SOURCES } from "./budgetStatus";
import { todayStr } from "./journal";
import { keyAction } from "./keys";

const ICON = (d: string, s = 14, w = 2) => (
  <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);
const CD = "M6 9l6 6 6-6", CR = "M9 6l6 6-6 6", GEAR = "M4 6h16 M4 12h16 M4 18h16 M9 4v4 M15 10v4 M7 16v4", X = "M6 6l12 12M18 6L6 18";
const KEY = (name: string) => "bstatus." + name;
const UNIT_KEY = "bstatus.unit", VIEW_KEY = "bstatus.view";

type Col = { id: string; label: string; sub?: string; w: number; num?: boolean };
// sub = 묶음 아래 열 이름(머리 두 줄). 고정 폭(끌 수 없음): 구분은 남는 폭, 집행률·메모
const FIXED = new Set(["rate", "memo"]);
const COLS_KEY = "bstatus.cols";
/** 자세히 머리 줄 두 줄: 위 줄은 묶음 이름(여러 열에 걸침), 아래 줄은 열 이름. sub가 없는 열은 두 줄을 한 칸으로. */
/** 엑셀 "집행·이월 현황" 열 비율 참고: 숫자 열은 같은 폭, 구분 열은 1.3배쯤 + 설정 단추 자리 */
const SUM_COLS: Col[] = [
  { id: "name", label: "구분", w: 300 },
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
  { id: "name", label: "구분", w: 260 },
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

type Pop = { t: "setup"; name: string; x: number; y: number } | { t: "src"; name: string; x: number; y: number };
type Form = { name: string; year: number; src: string; text: Record<string, string> };

export default function BudgetStatusScreen() {
  const [byYear, setByYear] = useState<Record<number, BudgetProject[]>>({});
  const [setups, setSetups] = useState<Record<string, Setup>>({});
  const [unit, setUnit] = useState<Unit>(1);
  const [detail, setDetail] = useState(false);
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
  const [nameFixed, setNameFixed] = useState<Record<string, boolean>>({});
  const [avail, setAvail] = useState(1200);
  const [boxW, setBoxW] = useState(0);
  const [sbw, setSbw] = useState(0);
  const [toast, setToast] = useState("");
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
    for (const p of names) {
      try {
        const v = await api.get(KEY(p.name));
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
    api.get(COLS_KEY).then((v) => {
      if (!v) return;
      const o = JSON.parse(v) as { w?: Record<string, Record<string, number>>; fixed?: Record<string, boolean> };
      if (o.w) setW(o.w);
      if (o.fixed) setNameFixed(o.fixed);
    }, () => {});
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);
  // 표 폭(구분 열이 남는 폭을 채울 때·배치최적화 뒤 왼쪽으로 모을 때 씀)
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      setAvail(el.clientWidth);
      setSbw(el.offsetWidth - el.clientWidth);
      if (rootRef.current) setBoxW(rootRef.current.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const names = useMemo(() => projectNames(byYear).filter((p) => !p.carry), [byYear]);
  const carryNames = useMemo(() => projectNames(byYear).filter((p) => p.carry), [byYear]);
  const shown = names.filter((p) => !q || p.name.includes(q));

  const saveSetup = (name: string, s: Setup) => {
    setSetups((o) => ({ ...o, [name]: s }));
    api.set(KEY(name), JSON.stringify(s)).catch(() => {});
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
  const fixedName = !!nameFixed[view];
  const widthOf = (c: Col) => (FIXED.has(c.id) ? c.w : wv[c.id] ?? c.w);
  const rest = base.reduce((a, c) => a + (c.id === "name" ? 0 : widthOf(c)), 0);
  const nameW = fixedName ? widthOf(base[0]) : Math.max(base[0].w, Math.floor(avail - 6 - rest)); // 구분 열은 남는 폭(최소 처음 폭)
  const cols = base.map((c) => ({ ...c, w: c.id === "name" ? nameW : widthOf(c) }));
  const tmpl = cols.map((c) => c.w + "px").join(" ");
  const colSum = cols.reduce((a, c) => a + c.w, 0);
  // 배치최적화(또는 구분 열을 직접 맞춘) 뒤 남는 폭이 있으면 왼쪽으로 모아요(집행현황과 같게)
  const packed = fixedName && boxW > 0 && colSum + 2 + sbw <= boxW;
  const saveCols = (w: Record<string, number>, fixed: boolean) => {
    const nw = { ...W, [view]: w }, nf = { ...nameFixed, [view]: fixed };
    setW(nw);
    setNameFixed(nf);
    api.set(COLS_KEY, JSON.stringify({ w: nw, fixed: nf })).catch(() => {});
  };
  const startDrag = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
    let w: Record<string, number> = { ...wv, name: id === "name" ? Math.round(w0) : nameW };
    const fixed = fixedName || id === "name";
    const grip = e.currentTarget as HTMLElement;
    grip.classList.add("drag");
    const mv = (ev: MouseEvent) => {
      w = { ...w, [id]: Math.max(id === "name" ? 160 : 36, Math.round(w0 + ev.clientX - x0)) };
      setW((o) => ({ ...o, [view]: w }));
      if (fixed) setNameFixed((o) => ({ ...o, [view]: true }));
    };
    const up = () => {
      grip.classList.remove("drag");
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
      saveCols(w, fixed);
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
    return Math.max(ci === 0 ? 160 : 36, Math.max(...cells.map(need)) + 1);
  };
  /** 배치최적화: 고정 폭 열 빼고 모든 열을 보이는 내용 폭에 맞춰요 */
  const fitAll = () => {
    const w = { ...wv };
    cols.forEach((c, i) => {
      if (FIXED.has(c.id)) return;
      const head = document.querySelector<HTMLElement>(`.bs .bd-hd > .bd-h[data-ci="${i}"]`);
      if (head) w[c.id] = fitOf(i, head);
    });
    saveCols(w, true);
    setToast("열 간격을 내용에 맞췄어요 · 열 제목 우클릭으로 처음대로");
  };
  const autoFit = (e: React.MouseEvent, ci: number, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const fit = fitOf(ci, (e.currentTarget as HTMLElement).parentElement as HTMLElement);
    saveCols({ ...wv, name: nameW, [id]: fit }, fixedName || id === "name");
  };
  const resetCols = (e: React.MouseEvent) => {
    e.preventDefault();
    saveCols({}, false);
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
  const numCells = (l: Line, kind: "pj" | "it" | "gun", editing: Form | null, year?: number, first = false) => {
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
      if (c.id === "name" || c.id === "memo") continue;
      const id = c.id;
      if (editing && (EDIT_FIELDS as string[]).includes(id) && !((id === "pm" || id === "ps") && !first)) {
        out.push(edit(id as keyof Manual, c.sub || c.label));
        continue;
      }
      // 요약의 당해예산·전년도 이월·집행액 칸을 고칠 때는 본예산·명시이월·당해로 받아요
      if (editing && !detail) {
        if (id === "curSum") { out.push(edit("cur", "본예산")); continue; }
        if (id === "prev" && first) { out.push(edit("pm", "명시이월")); continue; }
        if (id === "ex") { out.push(edit("en", "집행액(당해)")); continue; }
      }
      if (id === "rate") {
        out.push(<div className="bd-c n" role="cell" key={id}>{bar(l.rate, kind !== "pj", kind === "gun")}</div>);
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

  const memoCell = cell(
    <button type="button" className="bd-memo" aria-label="메모 쓰기" title="메모 쓰기">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>,
  );

  // ---------- 설정 상자 ----------
  const setupBody = (name: string) => {
    const s = setups[name];
    if (!s) return null;
    const yr = (k: "from" | "to") => (
      <input
        className="fld bd-in n bs-yr"
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
              <span className="muted">~</span>
              {yr("to")}
            </>
          )}
        </div>
        <div className="bs-row">
          <span className="bs-lab">재원</span>
          <span className="chips">
            {s.sources.map((x) => (
              <span key={x} className="chip bs-chip">
                {x}
                {s.sources.length > 1 && (
                  <button type="button" className="chip-x" aria-label={x + " 빼기"} onClick={() => saveSetup(name, { ...s, sources: s.sources.filter((y) => y !== x) })}>
                    {ICON(X, 11)}
                  </button>
                )}
              </span>
            ))}
            {SOURCES.filter((x) => x !== "기타" && !s.sources.includes(x)).map((x) => (
              <button key={x} type="button" className="btn bs-addsrc" onClick={() => saveSetup(name, { ...s, sources: [...s.sources, x] })}>
                + {x}
              </button>
            ))}
            <input
              className="fld bd-in bs-other"
              placeholder="기타(예 특조)"
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
    const book = compute(p.name, s, byYear, p.years);
    const isOpen = !!open[p.name];
    const srcLabel = s.multi ? `${String(s.from).slice(2)}~${String(s.to).slice(2)}` : "단년도"; // 연도만(재원은 설정 상자에서 — 2026-10-19 사용자: 자리가 빠듯)
    rows.push(
      <div key={p.name} className={"bd-rw pj" + (sel === p.name ? " sel" : "")} role="row" onClick={() => setSel(p.name)}>
        <div className="bd-c" role="cell">
          {isOpen && <span className="bd-tl v1 dn1" />}
          <button type="button" className="bd-cr" aria-label={isOpen ? "접기" : "펼치기"} onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [p.name]: !isOpen })); }}>
            {ICON(isOpen ? CD : CR, 14, 2.2)}
          </button>
          <span className="bd-nm" title={p.name}>{p.name}</span>
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
        {numCells(book.total, "pj", null)}
        {memoCell}
      </div>,
    );
    if (!isOpen) continue;
    book.years.forEach((b, yi) => {
      const lastY = yi === book.years.length - 1;
      const yk = p.name + ":" + b.year;
      const yOpen = openY[yk] !== false;
      const first = yi === 0;
      rows.push(
        <div key={yk} className="bd-rw it" role="row">
          <div className="bd-c" role="cell">
            <span className={"bd-tl v1" + (lastY ? " half" : "")} />
            <span className="bd-tl h1" />
            {yOpen && <span className="bd-tl v2 dn2" />}
            <button type="button" className="bd-cr ind1" aria-label={yOpen ? "접기" : "펼치기"} onClick={() => setOpenY((o) => ({ ...o, [yk]: !yOpen }))}>
              {ICON(yOpen ? CD : CR, 14, 2.2)}
            </button>
            <span className="bd-nm">{b.year}년</span>
            <span className="bs-note">{b.linked ? "집행현황" : "직접 입력"}</span>
          </div>
          {numCells(b.total, "it", null, b.year, first)}
          {memoCell}
        </div>,
      );
      if (!yOpen) return;
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
        <button type="button" className="btn btn-ctrl btn-text xl-btn" aria-haspopup="menu">
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
            {!rows.length && <div className="bd-empty"><p className="bd-empty-bs">집행현황에 세부사업이 없어요</p></div>}
          </div>
        </div>
      </div>
      {toast && (
        <div className="bd-toast" role="status">
          {toast}
        </div>
      )}
      {pop && (
        <div ref={popRef} className="bd-pop" role="dialog" aria-label="사업 설정" style={popPos ?? { left: pop.x, top: pop.y, visibility: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
          {pop.t === "setup" && setupBody(pop.name)}
        </div>
      )}
    </div>
  );
}
