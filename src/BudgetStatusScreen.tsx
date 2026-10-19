// 예산현황(13단계) 화면 — 집행현황과 같은 표 부품(bd-*)으로, 세부사업 › 연도 › 재원 세 겹.
// 시안: 캔버스 BudgetStatus(요약)·BudgetStatusDetail(자세히), 2026-10-19 사용자 결정(설정 단추는 작은 네모 하나, 숫자는 모두 오른쪽, 추경 열은 빼지 않음, 엑셀 열 비율 참고).
// - 세부사업은 집행현황에서 자동으로 와요(이월 세부사업은 이어 붙이는 쪽). 사업명 옆 ⚙ 단추 → 단년도/다년도(기간)·재원·이월 사업.
// - 재원 줄 두 번 누르기 = 고치는 줄(직접 적는 칸만 열려요), 바깥 누르기 = 저장, Esc = 취소. 규칙은 budgetStatus.ts.
import { KeyboardEvent as RKeyboardEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from "react";
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

type Col = { id: string; label: string; sub?: string; line2?: string; w: number; num?: boolean };
// sub = 묶음 아래 열 이름(머리 두 줄), line2 = 한 칸 안 줄바꿈(예산현액 ①+②, 집행률 %)
/** 자세히 머리 줄 두 줄: 위 줄은 묶음 이름(여러 열에 걸침), 아래 줄은 열 이름. sub가 없는 열은 두 줄을 한 칸으로. */
/** 엑셀 "집행·이월 현황" 열 비율 참고: 숫자 열은 같은 폭, 구분 열은 1.3배쯤 + 설정 단추 자리 */
const SUM_COLS: Col[] = [
  { id: "name", label: "구분", w: 300 },
  { id: "curSum", label: "당해예산", w: 152, num: true },
  { id: "prev", label: "전년도 이월", w: 152, num: true },
  { id: "act", label: "예산현액", w: 152, num: true },
  { id: "ex", label: "집행액", w: 152, num: true },
  { id: "rate", label: "집행률", w: 112, num: true },
  { id: "left", label: "다음연도 이월", w: 152, num: true },
  { id: "un", label: "불용액", w: 152, num: true },
  { id: "memo", label: "메모", w: 48 },
];
const DET_COLS: Col[] = [
  { id: "name", label: "구분", w: 260 },
  { id: "curSum", label: "당해예산", sub: "소계", w: 132, num: true },
  { id: "cur", label: "", sub: "본예산", w: 132, num: true },
  { id: "a1", label: "", sub: "1추", w: 132, num: true },
  { id: "a2", label: "", sub: "2추", w: 132, num: true },
  { id: "a3", label: "", sub: "3추", w: 132, num: true },
  { id: "a4", label: "", sub: "4추", w: 132, num: true },
  { id: "prev", label: "전년도 이월", sub: "소계", w: 132, num: true },
  { id: "pm", label: "", sub: "명시이월", w: 132, num: true },
  { id: "ps", label: "", sub: "사고이월", w: 132, num: true },
  { id: "act", label: "예산현액", line2: "①+②", w: 132, num: true },
  { id: "ex", label: "집행액", sub: "소계", w: 132, num: true },
  { id: "en", label: "", sub: "당해", w: 132, num: true },
  { id: "em", label: "", sub: "명시", w: 132, num: true },
  { id: "es", label: "", sub: "사고", w: 132, num: true },
  { id: "rate", label: "집행률", line2: "%", w: 112, num: true },
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
  }, [load]);

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

  const cols = detail ? DET_COLS : SUM_COLS;
  const tmpl = cols.map((c) => c.w + "px").join(" ");

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
      {ICON("M4 20h4l10-10-4-4L4 16z M13 7l4 4")}
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
              <span className={"bd-tl v1" + (last ? " half2" : "")} />
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
    <div className="bd bs">
      <div className="bd-top">
        <h1 className="title">예산현황</h1>
        <span className="bd-sp" />
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
      <div className="bd-tbl" style={{ ["--bd-cols" as string]: tmpl }}>
        <div className="bd-scroll">
          <div className={"bd-hd" + (detail ? " bs-hd2" : "")} role="row">
            {cols.map((c, i) => {
              const cls = "bd-h" + (c.num ? " bs-hn" : "");
              if (!detail) return <div key={c.id} className={cls} role="columnheader">{c.label}</div>;
              if (!c.sub) {
                return (
                  <div key={c.id} className={cls + " bs-span"} role="columnheader" style={{ gridColumn: `${i + 1}`, gridRow: "1 / span 2" }}>
                    {c.line2 ? <span className="bs-two">{c.label}<br />{c.line2}</span> : c.label}
                  </div>
                );
              }
              // 묶음 머리: 이 열에서 시작해 label 없는 sub 열이 이어지는 만큼 걸쳐요
              let n = 1;
              while (cols[i + n] && cols[i + n].sub && !cols[i + n].label) n++;
              return (
                <Fragment key={c.id}>
                  {c.label && <div className="bd-h bs-grp" role="columnheader" style={{ gridColumn: `${i + 1} / span ${n}`, gridRow: 1 }}>{c.label}</div>}
                  <div className={cls} role="columnheader" style={{ gridColumn: `${i + 1}`, gridRow: 2 }}>{c.sub}</div>
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
      {pop && (
        <div ref={popRef} className="bd-pop" role="dialog" aria-label="사업 설정" style={popPos ?? { left: pop.x, top: pop.y, visibility: "hidden" }} onMouseDown={(e) => e.stopPropagation()}>
          {pop.t === "setup" && setupBody(pop.name)}
        </div>
      )}
    </div>
  );
}
