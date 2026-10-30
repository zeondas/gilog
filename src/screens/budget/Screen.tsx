// 집행현황(12단계) 화면 – 시안 목업(https://claude.ai/artifact/85GKw4XvZBnK3GA67R87RG, 2026-10-18 사용자 "통과") 그대로.
// 세부사업 → 부기사업 → 공사 트리 표. 계산 규칙은 budget.ts, 저장은 core budget.rs.
// - 한 번 누르기 = 고르기, 두 번 = 그 줄 고치기(줄 안 입력 칸), 바깥 누르기 = 저장, Esc = 취소. 뜨는 창으로 더하지 않아요(사용자: 팝업 싫음).
// - 우클릭 메뉴: 맨 위 늘 세부사업 추가(아래에)·부기사업 추가·공사(용역·물품) 추가(세부사업 줄에서는 흐리게) → 겹마다 수정·메모·옮기기·지우기(묻고 지움).
// - 단계 배지 ▾ = 목록(바깥 누르기 시작·같은 배지 다시 누르기·창 떠나기로 닫힘). 보라는 강조·고른 줄에만, 공사 배지는 파랑.
// - 열 제목: 누르면 그 열 칠하기(다시 누르면 풀기), 끝선 끌기 = 너비, 끝선 두 번 = 내용에 맞춤, 우클릭 = 처음 너비.
//   구분·집행률·단계·메모는 고정 폭. 모든 줄이 같은 px 틀을 써요(세부사업 열을 1fr로 두면 긴 이름 줄만 넓어져 열이 밀려요).
// - 금액 단위 원/천원(천원은 반올림한 정수만 보여요, 저장은 늘 원). 손대지 않은 금액 칸은 원래 원 값 그대로 저장해요.
import { DialogX } from "../../DialogX";
import { MouseEvent as RMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ContactsData, errorText } from "../../api";
import {
  BudgetLevel,
  BudgetProject,
  fmt,
  View,
  VIEW_LABEL,
  Unit,
} from "../../budget";
import { BudgetImport } from "../../budgetExcel";
import { BudgetStatusSend, SendTarget } from "../../BudgetStatusSend";
import { Setup } from "../../budgetStatus";
import { todayStr } from "../../journal";
import { overlayDown, useOutsideClose } from "../../useOutsideClose";
import { SearchBox } from "../../SearchBox";
import { YearNav } from "../../YearNav";
import { useColHead, widestOf } from "../../ColHead";
import type { ColDef } from "../../cols";
import {
  AUTO_MS,
  onShare,
  refreshShare,
  SHARE_CHANGE,
  shareActive,
  ShareState,
  shortTime,
} from "../../budgetShare";
import { BudgetGot, Suggest } from "./Dialogs";
import { ColId, COLS, COLS_SOLO, FIXED, COLS_KEY, UNIT_KEY, VIEW_KEY, HIDE_OF, Sel, selKey, Cells, NO_CELLS, Money, Form, Pop, ICON, CD, money, moneyOf } from "./parts";
import { useBudgetExcel } from "./excel";
import { useBudgetCells, useBudgetRows, useBudgetHead } from "./Table";
import { useBudgetPick } from "./pick";
import { useBudgetShareView } from "./share";
import { useBudgetMenu } from "./Menu";
import { useBudgetPop } from "./Dialogs";

export function useBudgetCore() {
  const [year, setYear] = useState(() => Number(todayStr().slice(0, 4)));
  const [data, setData] = useState<BudgetProject[] | null>(null);
  const [note, setNote] = useState("");
  const [unit, setUnitState] = useState<Unit>(1);
  const [view, setViewState] = useState<View>("exp");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Sel>(null);
  const [cs, setCs] = useState<Cells>(NO_CELLS);
  const [form, setForm] = useState<Form | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [toast, setToast] = useState("");
  const [flash, setFlash] = useState<number | null>(null);
  const [colHl, setColHl] = useState<number | null>(null);
  // 예산현황으로 보내기(2026-10-20 사용자): 세부사업 우클릭 → 예산현황과 같은 창. 보낸 사업 이름은 표 bstatus(sent)에서 읽어요
  const [bsSetups, setBsSetups] = useState<Record<string, Setup>>({});
  const [bsSend, setBsSend] = useState<string | null>(null);
  const bsSent = useMemo(() => new Set(Object.entries(bsSetups).filter(([, s]) => s.sent).map(([n]) => n)), [bsSetups]);
  const loadBs = async () => {
    try {
      const st: Record<string, Setup> = {};
      for (const r of await api.bstatusList()) st[r.name] = JSON.parse(r.setup) as Setup;
      setBsSetups(st);
      return st;
    } catch {
      return {};
    }
  };
  const openSend = async (name: string) => {
    await loadBs();
    setBsSend(name);
  };
  const saveBs = (name: string, s: Setup) => {
    setBsSetups((o) => ({ ...o, [name]: s }));
    api.bstatusSet(name, JSON.stringify(s)).catch(() => {});
  };
  // ---------- 팀 공유 ----------
  const [share, setShare] = useState<ShareState | null>(null);
  useEffect(() => onShare(setShare), []);
  const shareOn = !!share && shareActive(share.conf);
  const VC = shareOn ? COLS : COLS_SOLO;
  /** 닫은 결과 띠(새로고침 시각) – 다음 새로고침까지 받은 줄 초록 선도 지워요 */
  const [bandOff, setBandOff] = useState("");
  /** 팀원이 바꿔 보낸 칸을 모아 보여 주는 "받은 것" 창이 열려 있는지(✔1, 2026-10-26) */
  const [gotOpen, setGotOpen] = useState(false);
  const [ask, setAsk] = useState<(BudgetImport & { path: string }) | null>(null);
  const formRow = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const qInput = useRef<HTMLInputElement>(null);
  const memoHtml = useRef("");
  const formRef = useRef(form);
  formRef.current = form;

  // ---------- 읽기 ----------
  const load = useCallback(async (y: number) => {
    try {
      setData(await api.budgetData(y));
      setNote("");
    } catch (e) {
      setNote(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load(year);
    void loadBs();
  }, [year, load]);
  // 팀 공유 새로고침(사용자 2안): 화면을 열 때 + 열려 있는 동안 5분마다(고치는 줄이 열려 있으면 그 차례는 건너뛰어요) + [새로고침]
  const shareSheet = shareOn ? share?.conf.sheet : "";
  useEffect(() => {
    if (!shareSheet) return;
    void refreshShare();
    const t = window.setInterval(() => {
      if (!formRef.current) void refreshShare();
    }, AUTO_MS);
    return () => window.clearInterval(t);
  }, [shareSheet]);
  useEffect(() => {
    const f = () => void load(year);
    window.addEventListener(SHARE_CHANGE, f);
    return () => window.removeEventListener(SHARE_CHANGE, f);
  }, [year, load]);
  useEffect(() => {
    api.get(UNIT_KEY).then((v) => setUnitState(v === "1000" ? 1000 : 1), () => {});
    api.get(VIEW_KEY).then((v) => setViewState(v === "act" ? "act" : "exp"), () => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (flash == null) return;
    const t = window.setTimeout(() => setFlash(null), 1300);
    return () => window.clearTimeout(t);
  }, [flash]);

  const list = data ?? [];
  const findP = (id: number) => list.find((p) => p.id === id);
  const findItem = (id: number) => {
    for (const p of list) {
      const it = p.items.find((i) => i.id === id);
      if (it) return { p, it };
    }
    return null;
  };
  const findRow = (id: number) => {
    for (const p of list)
      for (const it of p.items) {
        const r = it.rows.find((x) => x.id === id);
        if (r) return { p, it, r };
      }
    return null;
  };

  const run = async (f: () => Promise<BudgetProject[]>, done?: string) => {
    try {
      setData(await f());
      if (done) setToast(done);
      return true;
    } catch (e) {
      setToast(e === "invalid" ? "넣은 값을 확인해 주세요" : errorText(e));
      return false;
    }
  };

  // ---------- 줄 안 입력 ----------
  /** 저장(또는 빈 새 줄이면 접기). 잘못된 칸이 있으면 false */
  const commit = useCallback(async (): Promise<boolean> => {
    const f = formRef.current;
    if (!f) return true;
    const name = f.name.trim();
    const isNew = f.id == null;
    if (!name) {
      if (isNew) {
        setForm(null);
        return true;
      }
      setBad("name");
      return false;
    }
    const check = (k: string, m: Money) => {
      const v = moneyOf(m, unit);
      if (v === undefined) {
        setBad(k);
        setToast("금액은 십원 단위로 적어 주세요");
      }
      return v;
    };
    try {
      if (f.level === "row") {
        const cmt = check("cmt", f.cmt), exp = check("exp", f.exp), act = check("act", f.act);
        if (cmt === undefined || exp === undefined || act === undefined) return false;
        const [y, id] = await api.saveBudgetRow(f.item, f.id, { name, kind: f.kind, co: f.co, cmt: cmt ?? 0, exp: exp ?? 0, act: act ?? 0, stage: f.stage });
        setData(y);
        setSel(selKey("row", id));
        if (isNew) setFlash(id);
      } else {
        const b = check("budget", f.budget);
        if (b === undefined) return false;
        const y =
          f.level === "project" ? await api.saveBudgetProject(year, f.id, f.after, name, b) : await api.saveBudgetItem(f.project, f.id, name, b);
        setData(y);
        if (f.id != null) setSel(selKey(f.level, f.id));
        else if (f.level === "project") {
          const old = new Set(list.map((p) => p.id));
          const np = y.find((p) => !old.has(p.id));
          if (np) setSel(selKey("project", np.id));
        } else {
          const p = y.find((x) => x.id === f.project);
          if (p?.items[0]) setSel(selKey("item", p.items[0].id));
        }
      }
      setForm(null);
      setBad(null);
      return true;
    } catch (e) {
      setToast(e === "invalid" ? "넣은 값을 확인해 주세요" : errorText(e));
      return false;
    }
  }, [unit, year, list]);

  const cancel = () => {
    setForm(null);
    setBad(null);
  };

  const startEdit = async (level: BudgetLevel, id: number) => {
    if (!(await commit())) return;
    setPop(null);
    if (level === "row") {
      const r = findRow(id)?.r;
      if (!r) return;
      setForm({ level, id, item: findRow(id)!.it.id, name: r.name, kind: r.kind, co: r.co, cmt: money(r.cmt, unit), exp: money(r.exp, unit), act: money(r.act, unit), stage: r.stage });
    } else if (level === "item") {
      const x = findItem(id);
      if (!x) return;
      setForm({ level, id, project: x.p.id, name: x.it.name, budget: money(x.it.budget, unit) });
    } else {
      const p = findP(id);
      if (!p) return;
      setForm({ level, id, after: null, name: p.name, budget: money(p.budget, unit) });
    }
    setBad(null);
    setSel(selKey(level, id));
  };

  const startAdd = async (f: Form) => {
    if (!(await commit())) return;
    setPop(null);
    // 넣을 자리가 접혀 있으면 펼쳐요.
    if (f.level === "item") {
      const p = findP(f.project);
      if (p && !p.open) await run(() => api.setBudgetOpen("project", p.id, true));
    }
    if (f.level === "row") {
      const x = findItem(f.item);
      if (x && !x.p.open) await run(() => api.setBudgetOpen("project", x.p.id, true));
      if (x && !x.it.open) await run(() => api.setBudgetOpen("item", x.it.id, true));
    }
    setForm(f);
    setBad(null);
  };
  const newProject = (after: number | null): Form => ({ level: "project", id: null, after, name: "", budget: { text: "", orig: null } });
  const newItem = (project: number): Form => ({ level: "item", id: null, project, name: "", budget: { text: "", orig: null } });
  const newRow = (item: number): Form => ({
    level: "row",
    id: null,
    item,
    name: "",
    kind: "공사",
    co: "",
    cmt: { text: "", orig: null },
    exp: { text: "", orig: null },
    act: { text: "", orig: null },
    stage: "준비",
  });

  // 입력 줄이 생기면 첫 칸에 커서
  const formKey = form ? `${form.level}:${form.id}` : "";
  useEffect(() => {
    if (!formKey) return;
    const inp = formRow.current?.querySelector<HTMLInputElement>("input");
    if (inp) {
      inp.focus();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  }, [formKey]);

  // 바깥 누르기 = 저장(뜨는 목록 안은 빼요)
  useOutsideClose(!!form, [formRow], () => void commit(), { ignore: ".bd-pop", capture: true });

  const setF = (patch: Partial<Form>) => setForm((f) => (f ? ({ ...f, ...patch } as Form) : f));

  // 공사명·업체 칸의 고르기 후보로 쓰려고 화면을 열 때 업무연락처를 한 번 읽어요 – 글자만 복사하고 연결은 하지 않아요(✔2, 2026-10-26).
  const [cdata, setCdata] = useState<ContactsData | null>(null);
  useEffect(() => {
    api.contactsData().then(setCdata, () => setCdata(null));
  }, []);
  /** 공사명에서 고른 사업의 업체가 여럿이면 업체 칸 후보(그 줄에서만) */
  const [coOpts, setCoOpts] = useState<Suggest[] | null>(null);
  useEffect(() => setCoOpts(null), [formKey]);

  // ---------- 뜨는 것 ----------
  useOutsideClose(!!pop && pop.t !== "memo", [], () => setPop(null), { ignore: ".bd-pop, [data-pick]", capture: true, onBlur: () => setPop(null) });

  // 키: Esc 닫기·취소, Del = 고른 공사 지우기
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        if (pop && pop.t !== "memo") {
          setPop(null);
          return;
        }
        if (ask) {
          setAsk(null);
          return;
        }
        if (!form) setCs((c) => (c.keys.length || c.anchor ? NO_CELLS : c));
      }
      if (e.key === "Delete" && !form && !pop && sel?.startsWith("g")) {
        const t = e.target as HTMLElement;
        if (t.closest?.("input, textarea, [contenteditable='true']")) return;
        const id = Number(sel.slice(1));
        const el = document.querySelector(`.bd-rw[data-sel="${sel}"]`);
        const r = el?.getBoundingClientRect();
        setPop({ t: "confirm", x: (r?.left ?? 300) + 200, y: r?.bottom ?? 300, level: "row", id });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pop, ask, form, sel]);

  const openMenu = async (e: RMouseEvent, level: BudgetLevel, id: number) => {
    e.preventDefault();
    const { clientX, clientY } = e;
    if (!(await commit())) return;
    setSel(selKey(level, id));
    setPop({ t: "menu", x: clientX, y: clientY, level, id });
  };

  const rowClick = async (level: BudgetLevel, id: number) => {
    if (form) {
      if (!(await commit())) return;
    }
    setSel(selKey(level, id));
  };

  const toggle = async (level: BudgetLevel, id: number, open: boolean) => {
    if (!(await commit())) return;
    await run(() => api.setBudgetOpen(level, id, !open));
  };

  const setUnit = async (u: Unit) => {
    if (!(await commit())) return;
    setUnitState(u);
    api.set(UNIT_KEY, String(u)).catch(() => {});
  };

  const setView = async (v: View) => {
    if (!(await commit())) return;
    setViewState(v);
    setCs(NO_CELLS);
    api.set(VIEW_KEY, v).catch(() => {});
  };

  const changeYear = async (y: number) => {
    if (!(await commit())) return;
    setSel(null);
    setPop(null);
    setCs(NO_CELLS);
    setYear(y);
  };

  // ---------- 열 ----------
  // 열 폭: 열마다 정해진 폭으로 시작하고 끈 열만 바뀌어요. 표가 넘치면 표 안에서 가로로 밀려요 – 일곱 표가 같은 규칙(헤더 열 조정 통일, 2026-10-28 ✔1~3).
  // 보이는 열(VC): 팀 공유를 끄면 "담당" 열이 빠져요. 보기에서 숨는 열(집행률 보기 = 시공량, 시공량 보기 = 집행액)은 폭 0이라 표가 그만큼 좁아져요(✔3②).
  const hide = HIDE_OF[view];
  const hideIx = VC.findIndex(([c]) => c === hide);
  /** 그 열에 보이는 내용(열 제목 포함) 가운데 가장 긴 폭(여유는 cols.ts가 더해요) */
  const fitOf = (col: string): number | null => {
    const ci = VC.findIndex(([c]) => c === col);
    if (ci < 0 || col === hide) return null;
    const head = document.querySelectorAll<HTMLElement>(".bd-hd > .bd-h")[ci];
    const cells = [...(head ? [head] : []), ...document.querySelectorAll<HTMLElement>(`.bd-body .bd-rw > .bd-c:nth-child(${ci + 1})`)];
    return widestOf(cells);
  };
  const colDefs: ColDef[] = VC.map(([c, label, w]) => ({ id: c, label, init: w, fixed: FIXED.has(c), text: c === "name" }));
  // 끄는 동안은 화면을 다시 그리지 않고 열 폭 변수만 바꿔요(cols 최적화 3) – 줄이 많아도 끌기가 가벼워요
  const colh = useColHead({
    store: COLS_KEY,
    cols: colDefs,
    measure: fitOf,
    live: (w) => rootRef.current?.style.setProperty("--bd-cols", VC.map(([c]) => (c === hide ? 0 : w(c)) + "px").join(" ")),
  });
  const Wv = Object.fromEntries(VC.map(([c]) => [c, c === hide ? 0 : colh.width(c)])) as Record<ColId, number>;
  const cols = VC.map(([c]) => Wv[c] + "px").join(" ");
  return { year, setYear, data, setData, note, setNote, unit, setUnitState, view, setViewState, q, setQ, sel, setSel, cs, setCs, form, setForm, bad, setBad, pop, setPop, toast, setToast, flash, setFlash, colHl, setColHl, bsSetups, setBsSetups, bsSend, setBsSend, bsSent, loadBs, openSend, saveBs, share, setShare, shareOn, VC, bandOff, setBandOff, gotOpen, setGotOpen, ask, setAsk, formRow, scroller, rootRef, qInput, memoHtml, formRef, load, shareSheet, list, findP, findItem, findRow, run, commit, cancel, startEdit, startAdd, newProject, newItem, newRow, formKey, setF, cdata, setCdata, coOpts, setCoOpts, openMenu, rowClick, toggle, setUnit, setView, changeYear, hide, hideIx, fitOf, colDefs, colh, Wv, cols };
}

export default function BudgetScreen() {
  const c0 = useBudgetCore();
  const c1 = useBudgetExcel(c0);
  const c2 = useBudgetCells(c1);
  const c3 = useBudgetPick(c2);
  const c4 = useBudgetShareView(c3);
  const c5 = useBudgetRows(c4);
  const c6 = useBudgetMenu(c5);
  const c7 = useBudgetPop(c6);
  const c8 = useBudgetHead(c7);
  const { data, note, rootRef, cols, year, changeYear, shareOn, share, doRefresh, setGotOpen, view, setView, unit, setUnit, sel, startAdd, newProject, qInput, q, setQ, pop, setPop, bandShown, cfs, last, setBandOff, shareStyle, colStyle, csStyle, scroller, colh, head, openCf, pickCell, rowsOut, list, form, importExcel, copyPrev, cs, csN, csSum, won, csDiff, setCs, popRef, popPos, popBody, bsSend, bsSetups, saveBs, setBsSend, setToast, setData, ask, setAsk, askPlan, doImport, gotOpen, people, jumpGot, toast } = c8;

  if (!data) {
    return (
      <>
        <h1 className="title">집행현황</h1>
        {note && (
          <p className="note" role="status">
            {note}
          </p>
        )}
      </>
    );
  }

  const searchIcon = (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );

  return (
    <div ref={rootRef} className="bd" style={{ ["--bd-cols" as string]: cols }}>
      <div className="bd-top tb5">
        <h1 className="title">집행현황</h1>
        <YearNav year={year} onChange={(y) => void changeYear(y)} />
        {shareOn && share && (
          <>
            <button
              type="button"
              className={"btn btn-ctrl fx-tool bs-sync" + (share.busy ? " busy" : "")}
              title="새로고침 – 내가 고친 것을 올리고 다른 사람이 고친 것을 받아요"
              disabled={share.busy}
              onClick={() => void doRefresh()}
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                <path d="M20 4v7h-7" />
              </svg>
              <span className="fx-tl">새로고침</span>
            </button>
            <span className={"bs-st" + (share.conf.error ? " bad" : "")} role="status" title={share.conf.error || undefined}>
              {share.busy ? (
                "새로고침 중…"
              ) : share.conf.up || share.conf.down ? (
                <>
                  {`올림 ${shortTime(share.conf.up) || "–"} · `}
                  <button type="button" className="bs-got" title="받은 것 보기 – 최근 7일" onClick={() => setGotOpen(true)}>
                    받음 {shortTime(share.conf.down) || "–"}
                  </button>
                </>
              ) : (
                "아직 새로고침 전"
              )}
            </span>
          </>
        )}
        <span className="bd-sp" />
        <span className="bd-unit tb-seg-l" role="group" aria-label="보기 – 집행률 · 시공량" title="집행률 보기는 시공량 열을, 시공량 보기는 집행액 열을 숨겨요">
          {(["exp", "act"] as View[]).map((v) => (
            <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => void setView(v)}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </span>
        <span className="bd-unit tb-seg-s" role="group" aria-label="금액 단위">
          {([1, 1000] as Unit[]).map((u) => (
            <button key={u} type="button" className={unit === u ? "on" : ""} aria-pressed={unit === u} onClick={() => void setUnit(u)}>
              {u === 1 ? "원" : "천원"}
            </button>
          ))}
        </span>
        <button
          type="button"
          className="btn btn-ctrl btn-text tb-pop"
          onClick={() => {
            const s = sel?.startsWith("p") ? Number(sel.slice(1)) : null;
            void startAdd(newProject(s));
          }}
          title="세부사업 추가"
        >
          사업 추가
        </button>
        <SearchBox className="bd-search" icon={searchIcon} inputRef={qInput} aria-label="공사 검색" placeholder="공사명, 업체 검색" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} />
        <button
          type="button"
          className="btn btn-ctrl btn-text xl-btn"
          data-pick
          aria-haspopup="menu"
          aria-expanded={pop?.t === "excel"}
          onClick={(e) => {
            if (pop?.t === "excel") {
              setPop(null);
              return;
            }
            const r = e.currentTarget.getBoundingClientRect();
            setPop({ t: "excel", x: r.right - 200, y: r.bottom + 4 });
          }}
        >
          엑셀
          {ICON(CD, 16, 2.4)}
        </button>
      </div>

      {shareOn && (bandShown || cfs.length > 0) && last && (
        <div className={"bs-band" + (last.error ? " bad" : cfs.length ? " cf" : "")} role="status">
          {last.error ? (
            <span>
              <b>새로고침하지 못했어요</b> · {last.error}
            </span>
          ) : (
            <span>
              <b>새로고침했어요</b>
              {last.receivedCells > 0 && (
                <>
                  {" · 받은 것 "}
                  {last.receivedCells}칸{last.receivedBy.length > 0 && `(${last.receivedBy.map(([n, k]) => `${n} ${k}`).join(" · ")})`}
                </>
              )}
              {last.sentCells > 0 && ` · 올린 것 ${last.sentCells}칸`}
              {cfs.length > 0 && (
                <>
                  {" · "}
                  <b className="bs-or">같은 칸 {cfs.length}곳</b>은 주황 칸을 눌러 골라 주세요
                </>
              )}
              {last.note && ` · ${last.note}`}
            </span>
          )}
          <span className="sp" />
          {!last.error && last.receivedCells > 0 && (
            <button type="button" className="btn btn-ctrl" onClick={() => setGotOpen(true)}>
              바뀐 것 보기
            </button>
          )}
          {bandShown && (
            <button type="button" className="btn x" aria-label="닫기" title="닫기" onClick={() => setBandOff(last.at)}>
              {ICON("M6 6l12 12M18 6L6 18", 14, 2.4)}
            </button>
          )}
        </div>
      )}
      <div className="bd-tbl">
        <style>{shareStyle}</style>
        <style>{colStyle}</style>
        <style>{csStyle}</style>
        <div className="bd-scroll" ref={scroller}>
          <div className="bd-hd colh-row" role="row" onContextMenu={colh.onContextMenu}>
            {head}
            {colh.menu()}
          </div>
          <div
            className="bd-body"
            role="rowgroup"
            onMouseDownCapture={(e) => {
              // Shift·Ctrl 누르기에 글자가 칠해지지 않게
              if ((e.shiftKey || e.ctrlKey || e.metaKey) && (e.target as Element).closest(".bd-rw[data-sel]:not(.edit) > .bd-c")) e.preventDefault();
            }}
            onClickCapture={(e) => {
              if (!openCf(e)) pickCell(e);
            }}
          >
            {rowsOut}
            {!list.length && !(form?.level === "project") && (
              <div className="bd-empty">
                <b>{year}년 세부사업이 없어요</b>
                <div className="bd-empty-bs">
                  <button type="button" className="btn-primary btn-ctrl" onClick={() => void startAdd(newProject(null))}>
                    세부사업 추가
                  </button>
                  <button type="button" className="btn btn-ctrl btn-text" onClick={() => void importExcel()}>
                    예산서 엑셀 가져오기
                  </button>
                  <button type="button" className="btn btn-ctrl btn-text" onClick={() => void copyPrev()}>
                    {year - 1}년에서 세부사업 복사
                  </button>
                </div>
              </div>
            )}
            {!!list.length && q && !rowsOut.length && <div className="bd-none">"{q}"에 맞는 공사가 없어요</div>}
          </div>
        </div>
        {cs.keys.length >= 2 && (
          <div className="bd-sumbar" role="status">
            <span>
              개수<b>{csN.toLocaleString("ko-KR")}</b>
            </span>
            <span>
              합계<b>{(fmt(csSum, unit) || "0") + won}</b>
            </span>
            {csDiff != null && (
              <span>
                차액<b className={csDiff < 0 ? "neg" : undefined}>{(fmt(csDiff, unit) || "0") + won}</b>
              </span>
            )}
            <button type="button" title="고르기 풀기 · Esc" aria-label="고르기 풀기" onClick={() => setCs(NO_CELLS)}>
              {ICON("M6 6l12 12M18 6L6 18", 14, 2.4)}
            </button>
          </div>
        )}
      </div>

      {pop && (
        <div
          ref={popRef}
          className={"bd-pop" + (pop.t === "stage" || pop.t === "kind" || pop.t === "owner" ? " bd-pop-list" : "") + (pop.t === "cf" ? " bs-pop" : "")}
          role={pop.t === "menu" || pop.t === "excel" ? "menu" : "dialog"}
          style={popPos ?? { left: pop.x, top: pop.y, visibility: "hidden" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {popBody()}
        </div>
      )}

      {bsSend && (() => {
        const target: SendTarget = {
          name: bsSend,
          years: [year],
          year,
          byYear: { [year]: list },
          parents: list.filter((x) => !x.carry && bsSetups[x.name]?.sent && x.name !== bsSend).map((x) => ({ name: x.name, setup: bsSetups[x.name] })),
          carries: list.filter((x) => x.carry && x.name !== bsSend).map((x) => ({ name: x.name, years: [year] })),
        };
        const cur = bsSetups[bsSend];
        return (
          <BudgetStatusSend
            target={target}
            setup={cur?.sent ? cur : null}
            onSave={(ns) => { saveBs(bsSend, ns); setBsSend(null); setToast(cur?.sent ? "예산현황 설정을 저장했어요" : "예산현황으로 보냈어요"); }}
            onAttach={(parent, src) => {
              const ps = bsSetups[parent];
              if (ps) saveBs(parent, { ...ps, carry: bsSend, carrySrc: src });
              if (cur) saveBs(bsSend, { ...cur, sent: false });
              setBsSend(null);
              setToast(`${parent}에 이월로 이었어요`);
            }}
            onRemove={cur?.sent ? () => { saveBs(bsSend, { ...cur, sent: false }); setBsSend(null); setToast("예산현황에서 뺐어요"); } : null}
            onClose={() => setBsSend(null)}
            onYearData={(y, d) => { if (y === year) setData(d); }}
          />
        );
      })()}
      {ask && (
        <div className="overlay" onMouseDown={overlayDown(() => setAsk(null))}>
          <div className="dialog xl-ask" role="dialog" aria-modal="true" aria-label="엑셀 가져오기">
            <DialogX label="닫기(가져오지 않음)" onClick={() => setAsk(null)} />
            <div className="xl-ask-body">
              <h2 className="xl-ask-title">
                {!ask.projects.length
                  ? "가져올 줄이 없어요"
                  : askPlan.upd
                    ? `${year}년에 덮어쓰기 ${askPlan.upd}건 · 새로 더하기 ${askPlan.add}건`
                    : `세부사업 ${ask.projects.length}개 · 공사 ${ask.rows}건을 ${year}년에 가져올까요?`}
              </h2>
              <div className="xl-ask-path">
                {ask.path} · 시트 "{ask.sheet}" · 단위 {ask.unit === 1 ? "원" : "천원"}
                {askPlan.upd > 0 && " · 같은 이름 공사는 파일 값으로 바꾸고, 파일에 없는 공사·메모는 그대로 둬요"}
              </div>
              {ask.checks.length > 0 && (
                <ul className="bd-checks">
                  {ask.checks.slice(0, 6).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                  {ask.checks.length > 6 && <li>그 밖에 {ask.checks.length - 6}건</li>}
                </ul>
              )}
            </div>
            <div className="xl-ask-foot">
              <button type="button" className="btn btn-ctrl btn-text" onClick={() => setAsk(null)}>
                취소
              </button>
              {ask.projects.length > 0 && (
                <button type="button" className="btn-primary btn-ctrl" autoFocus onClick={() => void doImport()}>
                  가져오기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {gotOpen && <BudgetGot people={people} onClose={() => setGotOpen(false)} onJump={(g) => void jumpGot(g)} />}
      {toast && (
        <div className="bd-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
