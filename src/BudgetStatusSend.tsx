// 예산현황 설정·보내기 창(2026-10-20 사용자 2안 – 두 단): 집행현황 세부사업 줄 우클릭 "예산현황으로 보내기"와 예산현황 ⚙이 같은 창을 열어요.
// 왼쪽 "사업 설정"(한 번 정하는 것): 단년도/다년도 + 기간 · 재원(국비·도비·시비·기타) · 이월 사업 잇기.
//   (명시이월)/(사고이월) 세부사업은 "기존 사업에 잇기 / 새 사업으로"를 골라요.
// 오른쪽 "재원 나누기"(해마다 적는 것, 재원이 둘 이상일 때만): 해 토글 →
//   ① 재원별 예산 표(재원마다 예산 직접 – rows["해:재원"].cur, 비율, 집행액(자동), 합계가 집행현황 예산과 맞는지)
//   ② 공사별 재원 표(공사 · 계약금액 · 재원마다 금액 칸 · 남은 금액 – split["해:공사 번호"] = { 재원: 금액 }, 집행액은 그 비율대로.
//      빈 칸 두 번 누르기 = 남은 금액 채우기, 안 적은 공사는 첫 재원, 머리 글 왼쪽·숫자 오른쪽, 열 경계 끌기(kv bstatus.sendCols)).
//   맞지 않아도 저장돼요(예산현황 표에 붉게 남아요). 머리 줄에 "맞지 않는 곳 N". 아래에 원인·지출재원 확인 방법 안내(2026-10-20 사용자).
// 창 폭은 재원 수만큼 넓어져요(재원 2 → 1040, 하나 더마다 +124, 화면 폭 −80까지). 보낸 사업만 예산현황에 보여요 – "예산현황에서 빼기"로 되돌려요.
import { DialogX } from "./DialogX";
import { useEffect, useState, type MouseEvent as RMouseEvent } from "react";
import { api } from "./api";
import { BudgetProject, KINDS, typing } from "./budget";
import { defaultSetup, isCarryName, Manual, rowShares, Setup, SOURCES, splitOf } from "./budgetStatus";
import { overlayDown } from "./useOutsideClose";

const X = "M6 6l12 12M18 6L6 18";
const ICON = (d: string, s = 14, w = 2) => (
  <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);
const COLS_KEY = "bstatus.sendCols";
/** 고정 칩(국비·도비·시비) – "기타"는 이름을 직접 적는 재원이라 칩 목록에 없어요(2026-10-20 사용자: "기타"라고 적어도 칩이 생겨야 해요) */
const FIXED = SOURCES.filter((x) => x !== "기타") as readonly string[];
const won = (v: number) => v.toLocaleString("ko-KR");
const fmtWon = (v: number) => (v ? won(v) : "");
const dash = (v: number) => (v ? won(v) : "-");

/** 금액 칸: 숫자만 받아 쉼표로 보여요(원 단위). 두 번 누르면 onFill(남은 금액 채우기) */
function Amt({ value, onChange, label, bad, onFill }: { value: number; onChange: (v: number) => void; label: string; bad?: boolean; onFill?: () => void }) {
  return (
    <input
      className={"fld bd-in n bss2-amt" + (bad ? " bad" : "")}
      aria-label={label}
      inputMode="numeric"
      data-ime="en"
      value={fmtWon(value)}
      placeholder="-"
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
      onFocus={(e) => e.currentTarget.select()}
      onDoubleClick={onFill}
    />
  );
}

export type SendTarget = {
  name: string;
  /** 집행현황에 이 세부사업이 있는 해들 */
  years: number[];
  /** 처음 보여 줄 해 */
  year: number;
  /** 이미 읽어 둔 해의 집행현황(없는 해는 창이 직접 읽어요) */
  byYear: Record<number, BudgetProject[]>;
  /** 잇기 후보: 보낸 사업 이름(이월 세부사업을 보낼 때) */
  parents: { name: string; setup: Setup }[];
  /** 이월 세부사업 이름(보통 사업을 보낼 때 "이월 사업" 고르기) */
  carries: { name: string; years: number[] }[];
};

type Cols = { cmt: number; src: number; rest: number };
const COLS0: Cols = { cmt: 112, src: 124, rest: 96 };

export function BudgetStatusSend({
  target,
  setup,
  onSave,
  onAttach,
  onRemove,
  onClose,
  onYearData,
}: {
  target: SendTarget;
  /** 이미 보낸 설정(없으면 처음 값) */
  setup: Setup | null;
  onSave: (s: Setup) => void;
  /** 이월 세부사업을 기존 사업에 잇기: 부모 이름·재원(지금은 "" — 집행이 공사별 재원대로 나뉘어요) */
  onAttach: (parent: string, src: string) => void;
  onRemove: (() => void) | null;
  onClose: () => void;
  /** [공사 추가]로 집행현황이 바뀌면 부모 화면에 알려요(그 해 전체 자료) */
  onYearData?: (year: number, data: BudgetProject[]) => void;
}) {
  const carry = isCarryName(target.name);
  const [s, setS] = useState<Setup>(() => setup ?? defaultSetup(target.years.length ? target.years : [new Date().getFullYear()]));
  const [mode, setMode] = useState<"new" | "attach">(carry && !setup ? "attach" : "new");
  const [parent, setParent] = useState(target.parents[0]?.name ?? "");
  const [other, setOther] = useState("");
  const multi = s.sources.length > 1;
  const attaching = carry && mode === "attach";

  // ---------- 해·집행현황 ----------
  const [year, setYear] = useState(target.year);
  const years = s.multi ? Array.from({ length: Math.max(0, s.to - s.from + 1) }, (_, i) => s.from + i) : [...new Set([...target.years, target.year])].sort();
  const [extra, setExtra] = useState<Record<number, BudgetProject[]>>({});
  const projs = extra[year] ?? target.byYear[year];
  useEffect(() => {
    if (projs) return;
    let on = true;
    api
      .budgetData(year)
      .then((d) => on && setExtra((o) => ({ ...o, [year]: d })))
      .catch(() => on && setExtra((o) => ({ ...o, [year]: [] })));
    return () => {
      on = false;
    };
  }, [year, projs]);
  const project = projs?.find((p) => p.name === target.name) ?? null;
  // (시안 프로토타입 2026-10-25) 그 해에 사업이 이월 세부사업("(명시이월) …")으로만 있으면 그 공사들로 재원을 나눠요
  const carryPj = !project && s.carry ? projs?.find((p) => p.name === s.carry) ?? null : null;
  const eff = project ?? carryPj;
  const rows = eff ? eff.items.flatMap((it) => it.rows.map((r) => ({ ...r, item: it.name }))) : [];
  const mainBudget = eff?.budget ?? 0;
  const mainExp = rows.reduce((a, r) => a + r.exp, 0);

  // ---------- 열 폭(공사별 재원 표) ----------
  const [cols, setCols] = useState<Cols>(COLS0);
  useEffect(() => {
    api
      .get(COLS_KEY)
      .then((v) => {
        if (v) setCols({ ...COLS0, ...(JSON.parse(v) as Partial<Cols>) });
      })
      .catch(() => {});
  }, []);
  const startDrag = (e: RMouseEvent, k: keyof Cols) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = cols[k];
    const grip = e.currentTarget as HTMLElement;
    grip.classList.add("drag");
    let w = cols;
    const mv = (ev: MouseEvent) => {
      w = { ...w, [k]: Math.max(72, Math.round(w0 + ev.clientX - x0)) };
      setCols(w);
    };
    const up = () => {
      grip.classList.remove("drag");
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
      api.set(COLS_KEY, JSON.stringify(w)).catch(() => {});
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
  };
  const grid = `minmax(140px, 1fr) ${cols.cmt}px repeat(${s.sources.length}, ${cols.src}px) ${cols.rest}px`;
  
  // ---------- 값 ----------
  const curOf = (src: string) => s.rows[`${year}:${src}`]?.cur ?? 0;
  const setCur = (src: string, v: number) => {
    const k = `${year}:${src}`;
    const m: Manual = { ...(s.rows[k] ?? {}), cur: v };
    setS({ ...s, rows: { ...s.rows, [k]: m } });
  };
  const curSum = s.sources.reduce((a, x) => a + curOf(x), 0);
  const curDiff = project ? curSum - mainBudget : 0;
  // 공사별 재원은 공사 uid로 저장해요(공사 번호는 PC마다 달라요 — 옛 숫자 키는 읽기 예비, 2026-10-26 연동 세션)
  const specOf = (r: { id: number; uid?: string }, cmt: number): Record<string, number> | null => {
    const v = splitOf(s, year, r);
    if (v == null) return null;
    if (typeof v === "string") return { [v]: cmt };
    return v;
  };
  const setCell = (r: { id: number; uid?: string }, cmt: number, src: string, v: number) => {
    const spec = { ...(specOf(r, cmt) ?? {}), [src]: v };
    const next = { ...(s.split ?? {}) };
    if (r.uid) delete next[`${year}:${r.id}`];
    next[`${year}:${r.uid || r.id}`] = spec;
    setS({ ...s, split: next });
  };
  const sumOf = (spec: Record<string, number> | null) => s.sources.reduce((a, x) => a + (spec?.[x] ?? 0), 0);
  const expBySrc: Record<string, number> = {};
  for (const x of s.sources) expBySrc[x] = 0;
  for (const r of rows) {
    const sh = rowShares(r, s, year);
    for (const x of s.sources) expBySrc[x] += sh[x] ?? 0;
  }
  const cmtBySrc: Record<string, number> = {};
  for (const x of s.sources) cmtBySrc[x] = rows.reduce((a, r) => a + (specOf(r, r.cmt)?.[x] ?? 0), 0);
  const cmtSum = rows.reduce((a, r) => a + r.cmt, 0);
  const restSum = rows.reduce((a, r) => {
    const sp = specOf(r, r.cmt);
    return a + (sp ? r.cmt - sumOf(sp) : 0);
  }, 0);
  const badRows = rows.filter((r) => {
    const sp = specOf(r, r.cmt);
    return sp != null && sumOf(sp) !== r.cmt;
  }).length;
  const badCount = (project && curDiff !== 0 ? 1 : 0) + badRows;
  const unsplit = rows.filter((r) => specOf(r, r.cmt) == null).length;

  // 연도 칸: 치는 동안은 글자 그대로 두고(지우다 세 자리가 되면 바로 막혀 "안 고쳐지는" 문제 – 2026-10-20 사용자), 떠날 때 네 자리면 반영
  const [yrText, setYrText] = useState<{ from: string; to: string }>({ from: String(s.from), to: String(s.to) });
  const yr = (k: "from" | "to") => {
    const commit = () => {
      const v = Number(yrText[k]);
      if (/^\d{4}$/.test(yrText[k]) && v >= 2000 && v <= 2100) {
        const ns = { ...s, [k]: v };
        if (ns.from > ns.to) (k === "from" ? (ns.to = v) : (ns.from = v));
        setS(ns);
        setYrText({ from: String(ns.from), to: String(ns.to) });
        if (year < ns.from) setYear(ns.from);
        if (year > ns.to) setYear(ns.to);
      } else setYrText((t) => ({ ...t, [k]: String(s[k]) }));
    };
    return (
      <input
        className={"fld bd-in bs-yr" + (/^\d{4}$/.test(yrText[k]) ? "" : " bad")}
        aria-label={k === "from" ? "시작 연도" : "끝 연도"}
        inputMode="numeric"
        data-ime="en"
        value={yrText[k]}
        onChange={(e) => setYrText((t) => ({ ...t, [k]: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  };
  const addOther = () => {
    const v = other.trim();
    if (!v) return;
    if (!s.sources.includes(v)) setS({ ...s, sources: [...s.sources, v] });
    setOther("");
  };
  const toggleSrc = (x: string) => {
    const on = s.sources.includes(x);
    if (on && s.sources.length === 1) return;
    setS({ ...s, sources: on ? s.sources.filter((y) => y !== x) : [...s.sources, x] });
  };
  const save = () => {
    if (attaching) {
      if (!parent) return;
      onAttach(parent, "");
      return;
    }
    // 이 사업의 집행현황 줄 uid를 함께 저장해요 — 이름이 바뀌어도 설정이 따라가게(2026-10-26 연동 세션)
    const uids = new Set(s.uids ?? []);
    for (const y of years) {
      const p = (extra[y] ?? target.byYear[y])?.find((x) => x.name === target.name);
      if (p) uids.add(p.uid);
    }
    onSave({ ...s, uids: [...uids], sent: true });
  };

  // ---------- [공사 추가] — 과거 해 등 집행현황에 없는 공사를 여기서 바로 등록해요(2026-10-26 사용자 2.) ----------
  const [adding, setAdding] = useState(false);
  const [addF, setAddF] = useState({ name: "", kind: "공사", cmt: "", exp: "" });
  const [busy, setBusy] = useState(false);
  const addRow = async () => {
    const nm = addF.name.trim();
    const won10 = (t: string) => Math.round((Number(t.replace(/\D/g, "")) || 0) / 10) * 10;
    if (!nm || busy) return;
    setBusy(true);
    try {
      let data = projs ?? (await api.budgetData(year));
      // 본사업이 있으면 거기, 이월분 해면 이어 붙인 이월 사업에, 둘 다 없으면 본사업을 새로 만들어요(집행현황에 진짜로 등록 — 사용자 1안)
      let pj = data.find((p) => p.name === target.name) ?? (s.carry ? data.find((p) => p.name === s.carry) : undefined) ?? null;
      if (!pj) {
        data = await api.saveBudgetProject(year, null, null, target.name, null);
        pj = data.find((p) => p.name === target.name) ?? null;
      }
      if (!pj) return;
      let item = pj.items[0];
      if (!item) {
        data = await api.saveBudgetItem(pj.id, null, "공사", null);
        const again = data.find((x) => x.id === pj.id);
        item = again?.items[0] ?? item;
      }
      if (!item) return;
      const [after] = await api.saveBudgetRow(item.id, null, { name: nm, kind: addF.kind, co: "", cmt: won10(addF.cmt), exp: won10(addF.exp), act: 0, stage: "완료" });
      setExtra((o) => ({ ...o, [year]: after }));
      onYearData?.(year, after);
      setAddF({ name: "", kind: "공사", cmt: "", exp: "" });
      setAdding(false);
    } catch {
      /* 저장 실패 — 칸은 그대로 남아요 */
    } finally {
      setBusy(false);
    }
  };

  // 창 폭: 재원 수만큼(화면 폭 −80까지)
  const wide = multi && !attaching;
  const width = wide ? Math.min(1040 + 124 * Math.max(0, s.sources.length - 2), (typeof window !== "undefined" ? window.innerWidth : 1600) - 80) : 560;

  // ---------- 왼쪽: 사업 설정 ----------
  const left = attaching ? (
    <>
      <div className="bss2-fl">
        <span className="bss2-lab">이월 사업</span>
        <span className="bd-unit">
          <button type="button" className="on" aria-pressed="true" onClick={() => setMode("attach")}>기존 사업에 잇기</button>
          <button type="button" aria-pressed="false" onClick={() => setMode("new")}>새 사업으로</button>
        </span>
      </div>
      <div className="bss2-fl">
        <span className="bss2-lab">잇는 사업</span>
        <select className="fld bd-in" aria-label="이을 사업" value={parent} onChange={(e) => setParent(e.target.value)}>
          {!target.parents.length && <option value="">보낸 사업이 없어요 – 먼저 원래 사업을 보내 주세요</option>}
          {target.parents.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="bss2-hint">이 세부사업의 집행액은 그 사업의 집행({/^\(사고/.test(target.name) ? "사고" : "명시"}) 칸으로 들어가요. 그 사업의 재원이 둘 이상이면 공사별 재원대로 나뉘어요.</div>
    </>
  ) : (
    <>
      {carry && (
        <div className="bss2-fl">
          <span className="bss2-lab">이월 사업</span>
          <span className="bd-unit">
            <button type="button" aria-pressed="false" onClick={() => setMode("attach")}>기존 사업에 잇기</button>
            <button type="button" className="on" aria-pressed="true" onClick={() => setMode("new")}>새 사업으로</button>
          </span>
        </div>
      )}
      <div className="bss2-fl">
        <span className="bss2-lab">기간</span>
        <div className="bss2-row">
          <span className="bd-unit" role="group" aria-label="단년도 · 다년도">
            <button type="button" className={!s.multi ? "on" : ""} aria-pressed={!s.multi} onClick={() => setS({ ...s, multi: false })}>단년도</button>
            <button type="button" className={s.multi ? "on" : ""} aria-pressed={s.multi} onClick={() => setS({ ...s, multi: true })}>다년도</button>
          </span>
          {s.multi && (
            <>
              {yr("from")}
              <span className="bs-tilde">~</span>
              {yr("to")}
            </>
          )}
        </div>
      </div>
      <div className="bss2-fl">
        <span className="bss2-lab">재원</span>
        <span className="bs-srcs">
          {FIXED.map((x) => {
            const on = s.sources.includes(x);
            return (
              <button key={x} type="button" className={"bs-src" + (on ? " on" : "")} aria-pressed={on} onClick={() => toggleSrc(x)}>
                {x}
              </button>
            );
          })}
          {s.sources.filter((x) => !FIXED.includes(x)).map((x) => (
            <span key={x} className="bs-src on bs-src-x">
              {x}
              <button type="button" className="chip-x" aria-label={x + " 빼기"} disabled={s.sources.length === 1} onClick={() => toggleSrc(x)}>
                {ICON(X, 11)}
              </button>
            </span>
          ))}
        </span>
        <div className="bss2-row">
          <input
            className="fld bd-in bss2-other"
            placeholder="기타 재원 이름"
            aria-label="기타 재원 이름"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            onBlur={addOther}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.nativeEvent.keyCode !== 229) {
                e.preventDefault();
                addOther();
              }
            }}
          />
          <button type="button" className="btn btn-ctrl btn-text bss2-add" onClick={addOther} disabled={!other.trim()}>추가</button>
        </div>
      </div>
      {!carry && (
        <div className="bss2-fl">
          <span className="bss2-lab">이월 사업 잇기</span>
          <select className="fld bd-in" aria-label="이어 붙일 이월 세부사업" value={s.carry} onChange={(e) => setS({ ...s, carry: e.target.value })}>
            <option value="">없음</option>
            {target.carries.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} · {c.years.join("·")}
              </option>
            ))}
          </select>
          {s.carry && multi && <div className="bss2-hint">이월분 집행도 공사별 재원대로 나뉘어요 – 전년도 이월은 앞 해의 다음연도 이월(재원별)에서 이어져요.</div>}
        </div>
      )}
      {!multi && <div className="bss2-hint">재원이 하나라 집행현황의 예산·집행액이 그대로 {s.sources[0]} 줄에 들어가요. 재원을 둘 이상 고르면 오른쪽에 나누는 표가 생겨요.</div>}
    </>
  );

  // ---------- 오른쪽: 재원 나누기 ----------
  const right = wide && (
    <div className="bss2-r">
      <div className="bss2-ttl">
        <span>재원 나누기</span>
        <span className="bd-unit bss2-years" role="group" aria-label="해">
          {years.map((y) => (
            <button key={y} type="button" className={y === year ? "on" : ""} aria-pressed={y === year} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </span>
        <span className="bss2-sum">
          {badCount > 0 ? <span className="bss2-badtag">맞지 않는 곳 {badCount}</span> : project && curSum > 0 && rows.length > 0 ? <span className="bss2-oktag">모두 맞아요</span> : null}
          {!project && (projs ? (carryPj ? <>{year}년은 이월분이에요 – 예산은 앞 해 다음연도 이월에서 오고, 공사는 "(명시이월)" 사업에서 와요</> : <>{year}년 집행현황에 없는 사업 – 재원별 예산만 적어요</>) : <>읽는 중…</>)}
        </span>
      </div>

      {/* 재원별 예산 – 공사별 재원 표와 같은 열 틀(재원이 열): 항목 · 합계 · 재원… · 차이 */}
      <div className="bss2-tb" role="table" aria-label="재원별 예산">
        <div className="bss2-tr h" style={{ gridTemplateColumns: grid }}>
          <span>재원별 예산</span>
          <span className="bss2-th">
            합계
            <span className="bd-grip" title="끌어서 너비" onMouseDown={(e) => startDrag(e, "cmt")} />
          </span>
          {s.sources.map((x) => (
            <span key={x} className="bss2-th">
              {x}
              <span className="bd-grip" title="끌어서 너비" onMouseDown={(e) => startDrag(e, "src")} />
            </span>
          ))}
          <span className="bss2-th">
            차이
            <span className="bd-grip" title="끌어서 너비" onMouseDown={(e) => startDrag(e, "rest")} />
          </span>
        </div>
        <div className="bss2-tr" style={{ gridTemplateColumns: grid }}>
          <span className="nm">예산<span className="bss2-kind">직접</span></span>
          <span className={"n" + (curDiff ? " bad" : " m")} title="집행현황 예산">{project ? won(mainBudget) : dash(curSum)}</span>
          {s.sources.map((x) => (
            <span key={x} className="n">
              <Amt value={curOf(x)} onChange={(v) => setCur(x, v)} label={x + " 예산"} bad={project != null && curDiff !== 0 && curOf(x) !== 0} />
            </span>
          ))}
          <span className={"n" + (curDiff ? " bad" : " m")}>{!project ? "-" : curDiff === 0 ? (curSum > 0 ? <span className="bss2-ok">✓</span> : "-") : (curDiff < 0 ? "−" : "+") + won(Math.abs(curDiff))}</span>
        </div>
        <div className="bss2-tr exp" style={{ gridTemplateColumns: grid }}>
          <span className="m">비율</span>
          <span className="n m">{curSum ? "100%" : "-"}</span>
          {s.sources.map((x) => (
            <span key={x} className="n m">{curSum ? Math.round((curOf(x) / curSum) * 100) + "%" : "-"}</span>
          ))}
          <span />
        </div>
        <div className="bss2-tr exp" style={{ gridTemplateColumns: grid }}>
          <span className="m">집행액(공사별 재원대로)</span>
          <span className="n m">{project ? dash(mainExp) : "-"}</span>
          {s.sources.map((x) => (
            <span key={x} className="n m">{project ? dash(expBySrc[x]) : "-"}</span>
          ))}
          <span />
        </div>
      </div>

      <div className="bss2-tb" role="table" aria-label="공사별 재원">
        <div className="bss2-tr h" style={{ gridTemplateColumns: grid }}>
          <span>공사(용역·물품)</span>
          <span className="bss2-th">
            계약금액
            <span className="bd-grip" title="끌어서 너비" onMouseDown={(e) => startDrag(e, "cmt")} />
          </span>
          {s.sources.map((x) => (
            <span key={x} className="bss2-th">
              {x}
              <span className="bd-grip" title="끌어서 너비" onMouseDown={(e) => startDrag(e, "src")} />
            </span>
          ))}
          <span className="bss2-th">
            남은 금액
            <span className="bd-grip" title="끌어서 너비" onMouseDown={(e) => startDrag(e, "rest")} />
          </span>
        </div>
        {!rows.length ? (
          <div className="bss2-tr" style={{ gridTemplateColumns: "1fr" }}>
            <span className="m">{project ? "공사가 없어요" : `${year}년 집행현황에 이 사업이 없어요 – 공사를 넣은 뒤 여기서 재원을 나눠요`}</span>
          </div>
        ) : (
          rows.map((r) => {
            const spec = specOf(r, r.cmt);
            const sum = sumOf(spec);
            const rest = r.cmt - sum;
            const bad = spec != null && rest !== 0;
            return (
              <div key={r.id} className="bss2-tr" style={{ gridTemplateColumns: grid }}>
                <span className="nm" title={(project && project.items.length > 1 ? r.item + " · " : "") + r.name}>
                  {r.name}
                  <span className="bss2-kind">{r.kind}</span>
                </span>
                <span className="n m">{won(r.cmt)}</span>
                {s.sources.map((x) => (
                  <span key={x} className="n">
                    <Amt
                      value={spec?.[x] ?? 0}
                      onChange={(v) => setCell(r, r.cmt, x, v)}
                      label={`${r.name} ${x} 금액`}
                      bad={bad && (spec?.[x] ?? 0) !== 0}
                      onFill={() => {
                        if ((spec?.[x] ?? 0) === 0 && rest > 0) setCell(r, r.cmt, x, rest);
                      }}
                    />
                  </span>
                ))}
                <span className={"n" + (bad ? " bad" : " m")}>{spec == null ? <span className="bss2-def">→ {s.sources[0]}</span> : rest === 0 ? "-" : (rest < 0 ? "−" : "") + won(Math.abs(rest))}</span>
              </div>
            );
          })
        )}
        {rows.length > 0 && (
          <>
            <div className="bss2-tr sum" style={{ gridTemplateColumns: grid }}>
              <span>합계</span>
              <span className="n">{won(cmtSum)}</span>
              {s.sources.map((x) => (
                <span key={x} className="n">{dash(cmtBySrc[x])}</span>
              ))}
              <span className={"n" + (badRows ? " bad" : " m")}>{restSum === 0 ? "-" : (restSum < 0 ? "−" : "") + won(Math.abs(restSum))}</span>
            </div>
          </>
        )}
        <div className="bss2-tr bss2-addrow">
          {adding ? (
            <>
              <input className="fld bd-in bss2-addname" placeholder="공사(용역·물품) 이름" aria-label="공사 이름" value={addF.name} onChange={(e) => setAddF((o) => ({ ...o, name: e.target.value }))} autoFocus />
              <select className="fld bd-in" aria-label="종류" value={addF.kind} onChange={(e) => setAddF((o) => ({ ...o, kind: e.target.value }))}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <input className="fld bd-in n bss2-amt" placeholder="계약금액" aria-label="계약금액" inputMode="numeric" data-ime="en" value={addF.cmt} onChange={(e) => setAddF((o) => ({ ...o, cmt: typing(e.target.value) }))} />
              <input className="fld bd-in n bss2-amt" placeholder="집행액" aria-label="집행액" inputMode="numeric" data-ime="en" value={addF.exp} onChange={(e) => setAddF((o) => ({ ...o, exp: typing(e.target.value) }))} />
              <button type="button" className="btn btn-primary btn-ctrl" disabled={!addF.name.trim() || busy} onClick={() => void addRow()}>추가</button>
              <button type="button" className="btn btn-ctrl btn-text" onClick={() => setAdding(false)}>취소</button>
            </>
          ) : (
            <button type="button" className="btn btn-ctrl btn-text" onClick={() => setAdding(true)}>+ 공사 추가</button>
          )}
        </div>
      </div>
      <div className="bss2-help">
        <b>적는 방법</b>
        <span>계약금액을 재원 칸에 나눠 적어요 – 한 재원이면 그 칸에 전부. 빈 칸을 두 번 누르면 남은 금액이 채워져요. 집행액은 적은 금액 비율대로 나뉘고, 안 적은 공사{unsplit > 0 ? ` ${unsplit}건` : ""}는 첫 재원({s.sources[0]})으로 들어가요.</span>
      </div>
      <div className="bss2-help">
        <b>원인·지출 재원 확인 방법</b>
        <span>지출재원변경요청(21109) → 상단에서 사업 검색(적요) → "▶대상목록"에서 선택 → 스크롤을 내리면 "▶재원정보" 항목에서 금액 확인</span>
      </div>
    </div>
  );

  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div
        className="dialog bss2"
        role="dialog"
        aria-modal="true"
        aria-label="예산현황 설정"
        style={{ width }}
        onKeyDown={(e) => {
          // Esc = 취소(✔7) – 안쪽 칸·목록이 먼저 받았으면 그대로 둬요
          if (e.key === "Escape" && !e.defaultPrevented && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="dialog-head bss2-head">
          <span className="dialog-title">{setup ? "예산현황 설정" : "예산현황으로 보내기"}</span>
          <span className="bss-sub">
            <b>{target.name}</b>
            {!wide && ` · ${target.year}년`}
          </span>
        </div>
        <DialogX label="닫기(저장하지 않음)" onClick={onClose} />
        <div className={"dialog-body bss2-body" + (wide ? " wide" : "")}>
          <div className="bss2-l">
            {wide && <div className="bss2-ttl">사업 설정</div>}
            {left}
          </div>
          {right}
        </div>
        <div className="dialog-foot bss-foot">
          {onRemove ? (
            <button type="button" className="btn btn-ctrl btn-text bss-remove" onClick={onRemove}>예산현황에서 빼기</button>
          ) : (
            <span />
          )}
          <span className="bss-btns">
            {wide && badCount > 0 && <span className="bss2-foot-note">맞지 않아도 저장돼요 – 예산현황 표에 붉게 남아요</span>}
            <button type="button" className="btn btn-ctrl btn-text" onClick={onClose}>취소</button>
            <button type="button" className="btn-primary btn-ctrl" disabled={attaching && !parent} onClick={save}>
              {setup ? "저장" : "보내기"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
