// 집행현황(12단계) 화면 – 시안 목업(https://claude.ai/artifact/85GKw4XvZBnK3GA67R87RG, 2026-10-18 사용자 "통과") 그대로.
// 세부사업 → 부기사업 → 공사 트리 표. 계산 규칙은 budget.ts, 저장은 core budget.rs.
// - 한 번 누르기 = 고르기, 두 번 = 그 줄 고치기(줄 안 입력 칸), 바깥 누르기 = 저장, Esc = 취소. 뜨는 창으로 더하지 않아요(사용자: 팝업 싫음).
// - 우클릭 메뉴: 맨 위 늘 세부사업 추가(아래에)·부기사업 추가·공사(용역·물품) 추가(세부사업 줄에서는 흐리게) → 겹마다 수정·메모·옮기기·지우기(묻고 지움).
// - 단계 배지 ▾ = 목록(바깥 누르기 시작·같은 배지 다시 누르기·창 떠나기로 닫힘). 보라는 강조·고른 줄에만, 공사 배지는 파랑.
// - 열 제목: 누르면 그 열 칠하기(다시 누르면 풀기), 끝선 끌기 = 너비, 끝선 두 번 = 내용에 맞춤, 우클릭 = 처음 너비.
//   구분·집행률·단계·메모는 고정 폭. 모든 줄이 같은 px 틀을 써요(세부사업 열을 1fr로 두면 긴 이름 줄만 넓어져 열이 밀려요).
// - 금액 단위 원/천원(천원은 반올림한 정수만 보여요, 저장은 늘 원). 손대지 않은 금액 칸은 원래 원 값 그대로 저장해요.
import { AskBand } from "./AskBand";
import { orgsOf, projectHits, projectSub, Suggest, SuggestInput } from "./BudgetSuggest";
import { Fragment, KeyboardEvent as RKeyboardEvent, MouseEvent as RMouseEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ContactsData, errorText, inApp } from "./api";
import {
  allRows,
  balance,
  Basis,
  BudgetLevel,
  BudgetProject,
  BudgetRow,
  FINAL,
  fmt,
  KINDS,
  matchRow,
  memoToText,
  okWon,
  parseWon,
  rowRate,
  sortRows,
  STAGES,
  sums,
  typing,
  Unit,
} from "./budget";
import { BudgetImport, parseBudgetBook, planImport } from "./budgetExcel";
import { dirOf, DIR_KEY, joinPath, lastDir } from "./ExcelMenu";
import { BudgetStatusSend, SendTarget } from "./BudgetStatusSend";
import { Setup } from "./budgetStatus";
import { todayStr } from "./journal";
import { keyAction, rowKeys } from "./keys";
import { overlayDown, useOutsideClose } from "./useOutsideClose";
import { isEmptyMemo, MemoEditor, sanitize } from "./RichMemo";
import {
  AUTO_MS,
  Conflict,
  Field,
  keepMine,
  onShare,
  personColor,
  refreshShare,
  SHARE_CHANGE,
  shareActive,
  ShareState,
  shortTime,
  takeTheirs,
} from "./budgetShare";

type ColId = "name" | "kind" | "co" | "bud" | "cmt" | "exp" | "act" | "bal" | "rate" | "avail" | "stage" | "owner" | "memo";
const COLS: [ColId, string, number][] = [
  ["name", "세부사업", 336],
  ["kind", "구분", 56],
  ["co", "업체(하도)", 96],
  ["bud", "예산", 112],
  ["cmt", "원인행위", 112],
  ["exp", "집행액", 112],
  ["act", "시공량(사용량)", 112],
  ["bal", "잔액", 118],
  ["rate", "집행률", 90],
  ["avail", "가용액", 118],
  ["stage", "단계", 64],
  // 팀 공유(2026-10-20 사용자): 단계 뒤·메모 앞, 세부사업 줄에만 한 명 – 공유를 켜지 않으면 열이 없어요
  ["owner", "담당", 76],
  ["memo", "메모", 36],
];
const COLS_SOLO = COLS.filter(([c]) => c !== "owner");
const FIXED = new Set<ColId>(["kind", "rate", "stage", "owner", "memo"]);
const START_W = Object.fromEntries(COLS.map(([c, , w]) => [c, w])) as Record<ColId, number>;
const COLS_KEY = "budget.cols";
const UNIT_KEY = "budget.unit";
const BASIS_KEY = "budget.basis";

/** 고른 줄: p12(세부사업)·i3(부기사업)·g7(공사) */
type Sel = string | null;
const selKey = (level: BudgetLevel, id: number) => (level === "project" ? "p" : level === "item" ? "i" : "g") + id;

/** 숫자 칸 여러 개 고르기(엑셀처럼) – 칸 = "고른 줄:열 번호"(예 g7:5), anchor = Shift 기준 칸 (2026-10-18 사용자) */
type Cells = { keys: string[]; anchor: string | null };
const NO_CELLS: Cells = { keys: [], anchor: null };
const NUM_COLS: ColId[] = ["bud", "cmt", "exp", "act", "bal", "avail"];
const NUM_IX = NUM_COLS.map((c) => COLS.findIndex(([x]) => x === c));

/** 줄 안 입력(새로 더하기·고치기). 금액은 적은 글자와 원래 값(손대지 않았으면 원래 원 값 그대로) */
type Money = { text: string; orig: number | null };
type Form =
  | { level: "project"; id: number | null; after: number | null; name: string; budget: Money }
  | { level: "item"; id: number | null; project: number; name: string; budget: Money }
  | { level: "row"; id: number | null; item: number; name: string; kind: string; co: string; cmt: Money; exp: Money; act: Money; stage: string };

type Pop =
  | { t: "menu"; x: number; y: number; level: BudgetLevel; id: number }
  | { t: "confirm"; x: number; y: number; level: BudgetLevel; id: number }
  | { t: "stage"; x: number; y: number; id: number | "form"; from: string }
  | { t: "kind"; x: number; y: number; from: string }
  | { t: "memo"; x: number; y: number; level: BudgetLevel; id: number }
  | { t: "excel"; x: number; y: number }
  | { t: "owner"; x: number; y: number; id: number }
  | { t: "cf"; x: number; y: number; uid: string; field: string };

const ICON = (d: string, s = 14, w = 2) => (
  <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);
const CD = "M6 9l6 6 6-6",
  CR = "M9 6l6 6-6 6",
  PLUS = "M12 5v14M5 12h14";

const money = (v: number | null, unit: Unit): Money => ({ text: v == null ? "" : fmt(v, unit).replace("−", "-"), orig: v });
/** 적은 금액 → 원. 원래 글자 그대로면 원래 값. 잘못이면 undefined */
function moneyOf(m: Money, unit: Unit): number | null | undefined {
  if (m.orig != null && m.text === fmt(m.orig, unit).replace("−", "-")) return m.orig;
  const v = parseWon(m.text, unit);
  return okWon(v) ? v : undefined;
}

const KIND_CLASS: Record<string, string> = { 공사: "k-gong", 관급: "k-gwan", 용역: "k-yong", 일반: "k-il" };
const STAGE_CLASS: Record<string, string> = { 준비: "s-jun", 추진: "s-chu", 완료: "s-wan", 중지: "s-jung", 타절: "s-ta" };

export default function BudgetScreen() {
  const [year, setYear] = useState(() => Number(todayStr().slice(0, 4)));
  const [data, setData] = useState<BudgetProject[] | null>(null);
  const [note, setNote] = useState("");
  const [unit, setUnitState] = useState<Unit>(1);
  const [basis, setBasisState] = useState<Basis>("exp");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Sel>(null);
  const [cs, setCs] = useState<Cells>(NO_CELLS);
  const [form, setForm] = useState<Form | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const [toast, setToast] = useState("");
  const [flash, setFlash] = useState<number | null>(null);
  const [colHl, setColHl] = useState<number | null>(null);
  const [W, setW] = useState<Record<ColId, number>>(START_W);
  const [nameFixed, setNameFixed] = useState(false);
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
  const [avail, setAvail] = useState(1200);
  // ---------- 팀 공유 ----------
  const [share, setShare] = useState<ShareState | null>(null);
  useEffect(() => onShare(setShare), []);
  const shareOn = !!share && shareActive(share.conf);
  const VC = shareOn ? COLS : COLS_SOLO;
  /** 닫은 결과 띠(새로고침 시각) – 다음 새로고침까지 받은 줄 초록 선도 지워요 */
  const [bandOff, setBandOff] = useState("");
  const [ask, setAsk] = useState<(BudgetImport & { path: string }) | null>(null);
  const formRow = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** 화면(표가 놓일 자리) 폭과 세로 스크롤 막대 폭 – 배치최적화 뒤 왼쪽으로 모을지 정해요 */
  const [boxW, setBoxW] = useState(0);
  const [sbw, setSbw] = useState(0);
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
    api.get(BASIS_KEY).then((v) => setBasisState(v === "act" ? "act" : "exp"), () => {});
    api.get(COLS_KEY).then(
      (v) => {
        if (!v) return;
        try {
          const o = JSON.parse(v) as { w?: Partial<Record<ColId, number>>; nameFixed?: boolean };
          setW({ ...START_W, ...(o.w ?? {}) });
          setNameFixed(!!o.nameFixed);
        } catch {
          /* 처음 너비 */
        }
      },
      () => {},
    );
  }, []);
  const saveCols = (w: Record<ColId, number>, fixed: boolean) => {
    const keep = Object.fromEntries(COLS.filter(([c]) => !FIXED.has(c)).map(([c]) => [c, w[c]]));
    api.set(COLS_KEY, JSON.stringify({ w: keep, nameFixed: fixed })).catch(() => {});
  };

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

  // 표 폭(세부사업 열이 남는 폭을 채울 때 씀)
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
  }, [data === null]);

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

  // 업무연락처(✔2, 2026-10-26) – 화면을 열 때 한 번 읽어 공사명·업체 후보로만 써요(글자만 복사).
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

  const setBasis = async (b: Basis) => {
    if (!(await commit())) return;
    setBasisState(b);
    api.set(BASIS_KEY, b).catch(() => {});
  };

  const setUnit = async (u: Unit) => {
    if (!(await commit())) return;
    setUnitState(u);
    api.set(UNIT_KEY, String(u)).catch(() => {});
  };

  const changeYear = async (y: number) => {
    if (!(await commit())) return;
    setSel(null);
    setPop(null);
    setCs(NO_CELLS);
    setYear(y);
  };

  // ---------- 열 ----------
  // 세부사업 열도 다른 열처럼 정해진 폭 – "남는 폭 채우기"는 없앴어요(2026-10-20 사용자, 예산현황과 같게). 보이는 열(VC)은 공유를 끄면 "담당" 열이 빠져요
  // 자리가 모자라면(팀 공유의 "담당" 열·세로 스크롤 막대) 세부사업 열만 그만큼 줄여 그려요 – 가장 좁게 160, 저장한 폭은 그대로(2026-10-21 사용자)
  const over = boxW > 0 ? VC.reduce((a, [c]) => a + W[c], 0) + 2 + sbw - boxW : 0;
  const Wv = over > 0 ? { ...W, name: Math.max(160, W.name - over) } : W;
  const cols = VC.map(([c]) => Wv[c] + "px").join(" ");
  // 남는 폭이 있으면 늘 왼쪽으로 모아요: 머리 줄 끝(엑셀) = 메모 끝, 세로 스크롤은 메모 끝 바로 옆(2026-10-19 사용자)
  const colSum = VC.reduce((a, [c]) => a + Wv[c], 0);
  const packed = boxW > 0 && colSum + 2 + sbw <= boxW;

  const startDrag = (e: RMouseEvent, col: ColId) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width;
    let w = { ...W, name: col === "name" ? Math.round(w0) : W.name };
    const fixed = nameFixed || col === "name";
    const grip = e.currentTarget as HTMLElement;
    grip.classList.add("drag");
    const mv = (ev: MouseEvent) => {
      w = { ...w, [col]: Math.max(col === "name" ? 160 : 36, Math.round(w0 + ev.clientX - x0)) };
      setW(w);
      if (fixed) setNameFixed(true);
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
  const fitOf = (col: ColId, head: HTMLElement) => {
    const ci = VC.findIndex(([c]) => c === col);
    const cells = [head, ...document.querySelectorAll<HTMLElement>(`.bd-body .bd-rw > .bd-c:nth-child(${ci + 1})`)];
    return Math.max(col === "name" ? 160 : 36, Math.max(...cells.map(need)) + 1);
  };
  /** 배치최적화(2026-10-19 사용자): 고정 폭 열(구분·집행률·단계·메모) 빼고 모든 열을 보이는 내용 폭에 맞춰요 – 끝선 두 번 누르기를 한 번에 */
  const fitAll = async () => {
    if (!(await commit())) return;
    const heads = [...document.querySelectorAll<HTMLElement>(".bd-hd > *")];
    const w = { ...W };
    VC.forEach(([c], i) => {
      if (!FIXED.has(c) && heads[i]) w[c] = fitOf(c, heads[i]);
    });
    setW(w);
    setNameFixed(true);
    saveCols(w, true);
    setToast("열 간격을 내용에 맞췄어요 · 열 제목 우클릭으로 처음대로");
  };

  /** 끝선 두 번 누르기: 그 열에 보이는 내용 가운데 가장 긴 폭(엑셀처럼). */
  const autoFit = (e: RMouseEvent, col: ColId) => {
    e.preventDefault();
    e.stopPropagation();
    const fit = fitOf(col, (e.currentTarget as HTMLElement).parentElement as HTMLElement);
    const w = { ...W, [col]: fit };
    const fixed = nameFixed || col === "name";
    setW(w);
    setNameFixed(fixed);
    saveCols(w, fixed);
  };

  const resetCols = (e: RMouseEvent) => {
    e.preventDefault();
    setW(START_W);
    setNameFixed(false);
    saveCols(START_W, false);
    setToast("열 너비를 처음으로 돌렸어요");
  };

  // ---------- 엑셀 ----------
  const exportExcel = async () => {
    setPop(null);
    const name = `집행현황_${year}_${todayStr()}.xlsx`;
    const dir = await lastDir();
    let path: string | null = joinPath(dir, name);
    if (inApp) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      path = await save({ title: "다른 이름으로 저장", defaultPath: path, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }] });
      if (!path) return;
      if (!/\.xlsx$/i.test(path)) path += ".xlsx";
    }
    try {
      const projects = list.map((p) => ({
        ...p,
        memo: memoToText(p.memo),
        items: p.items.map((i) => ({ ...i, memo: memoToText(i.memo), rows: i.rows.map((r) => ({ ...r, memo: memoToText(r.memo) })) })),
      }));
      await api.budgetExcelWrite(path, { year, unit, basis, date: todayStr(), projects });
      const d = dirOf(path);
      if (d) api.set(DIR_KEY, d).catch(() => {});
      setToast(`${year}년 집행현황을 저장했어요 · ${path}`);
    } catch (e) {
      setToast(e === "io" ? "저장하지 못했어요. 엑셀에서 열려 있으면 닫고 다시 해 주세요." : errorText(e));
    }
  };

  const importExcel = async () => {
    setPop(null);
    if (!(await commit())) return;
    let path: string | null = null;
    if (inApp) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await lastDir();
      const p = await open({ title: "열기", defaultPath: dir || undefined, multiple: false, directory: false, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx", "xlsm", "xls"] }] });
      path = typeof p === "string" ? p : null;
    } else path = joinPath(await lastDir(), `집행현황_${year}.xlsx`);
    if (!path) return;
    try {
      const sheets = await api.budgetExcelRead(path);
      const d = dirOf(path);
      if (d) api.set(DIR_KEY, d).catch(() => {});
      const r = parseBudgetBook(sheets, year);
      if (!r) {
        setToast("집행현황 모양의 시트를 찾지 못했어요");
        return;
      }
      setAsk({ ...r, path });
    } catch (e) {
      setToast(e === "io" ? "파일을 열지 못했어요." : errorText(e));
    }
  };

  const askPlan = ask ? planImport(list, ask.projects) : { upd: 0, add: 0 };
  const doImport = async () => {
    if (!ask) return;
    try {
      const [y, u, n] = await api.importBudget(year, ask.projects);
      setData(y);
      setToast(u ? `공사 ${u}건을 덮어쓰고 ${n}건을 더했어요` : `세부사업 ${ask.projects.length}개 · 공사 ${n}건을 가져왔어요`);
    } catch (e) {
      setToast(e === "invalid" ? "가져올 수 없는 줄이 있어요(금액·이름 확인)" : errorText(e));
    }
    setAsk(null);
  };

  const copyPrev = async () => {
    const prev = await api.budgetData(year - 1).catch(() => [] as BudgetProject[]);
    if (!prev.some((p) => !p.carry)) {
      setToast(`${year - 1}년 자료가 없어요`);
      return;
    }
    await run(() => api.copyBudgetYear(year - 1, year), `${year - 1}년 세부사업·부기사업을 복사했어요`);
  };

  // ---------- 그리기 ----------
  const cell = (v: ReactNode, cls = "", key?: string | number) => (
    <div className={"bd-c" + cls} role="cell" key={key}>
      {v}
    </div>
  );
  const rateCell = (rate: number | null, sm: boolean) =>
    rate == null
      ? cell("", " n")
      : cell(
          <>
            <span className={"bd-bar" + (sm ? " sm" : "")}>
              <span style={{ width: Math.min(100, Math.max(0, rate)) + "%" }} />
            </span>
            <span className="bd-pct">{Math.round(rate)}%</span>
          </>,
          " n",
        );
  const rowRateCell = (r: BudgetRow) => {
    const sp = rowRate(r, basis);
    return sp == null
      ? cell("", " n")
      : cell(
          <>
            <span className="bd-bar rowbar" title={(basis === "act" ? "시공량" : "집행액") + " ÷ 원인행위"}>
              <span style={{ width: Math.min(100, Math.max(0, sp)) + "%" }} />
            </span>
            <span className="bd-pct rowp">{Math.round(sp)}%</span>
          </>,
          " n",
        );
  };
  const memoBtn = (level: BudgetLevel, id: number, memo: string) => {
    const has = !isEmptyMemo(memo);
    return (
      <button
        type="button"
        className={"bd-memo" + (has ? " has" : "")}
        aria-label={has ? "메모 편집" : "메모 쓰기"}
        title={has ? memoToText(memo) : "메모 쓰기"}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={async (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          if (!(await commit())) return;
          setPop({ t: "memo", x: Math.max(8, r.right - 440), y: r.bottom + 4, level, id });
        }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={has ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </button>
    );
  };
  /** 합계 칸들(구분·업체 빈칸부터 메모까지) */
  const sumCells = (budget: number | null, rows: BudgetRow[], sm: boolean, memo: ReactNode, budgetCell?: ReactNode, owner?: ReactNode) => {
    const s = sums(budget, rows, basis);
    return (
      <>
        {cell("")}
        {cell("")}
        {budgetCell ?? cell(fmt(budget, unit), " n")}
        {cell(fmt(s.cmt, unit), " n")}
        {cell(fmt(s.exp, unit), " n")}
        {cell(fmt(s.act, unit), " n")}
        {cell(fmt(s.bal, unit), " n" + (s.bal < 0 ? " red" : ""))}
        {rateCell(s.rate, sm)}
        {cell(fmt(s.avail, unit), " n" + (s.low ? " red" : ""))}
        {cell(
          <span className="bd-dc">
            {s.done}/{s.n}
          </span>,
        )}
        {shareOn && cell(owner ?? "", " bs-oc")}
        {cell(memo)}
      </>
    );
  };

  const moneyInput = (k: "budget" | "cmt" | "exp" | "act", label: string, m: Money, bold = false) => (
    <input
      className={"fld bd-in n" + (bold ? " b" : "") + (bad === k ? " bad" : "")}
      aria-label={label}
      placeholder={label}
      value={m.text}
      onChange={(e) => {
        const text = typing(e.target.value);
        setF({ [k]: { ...m, text } } as unknown as Partial<Form>);
        setBad(okWon(parseWon(text, unit)) ? null : k);
      }}
    />
  );
  const nameInput = (label: string, bold = false) => (
    <input
      className={"fld bd-in" + (bold ? " b" : "") + (bad === "name" ? " bad" : "")}
      aria-label={label}
      placeholder={label}
      value={form?.name ?? ""}
      onChange={(e) => {
        setF({ name: e.target.value });
        if (bad === "name") setBad(null);
      }}
    />
  );
  const formKeys = (e: RKeyboardEvent) => {
    if (keyAction(e, "common") === "common.cancel" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      cancel();
      return;
    }
    rowKeys(e, formRow.current, () => void commit());
  };
  const stageChip = (st: string, onOpen: (r: DOMRect, from: string) => void, from: string) => (
    <button
      type="button"
      data-pick
      className={"bd-chip bd-stc " + (STAGE_CLASS[st] ?? "")}
      aria-label={`단계 ${st} 바꾸기`}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (pop && "from" in pop && pop.from === from) {
          setPop(null);
          return;
        }
        onOpen(e.currentTarget.getBoundingClientRect(), from);
      }}
    >
      {st}
      {ICON(CD, 10, 2.6)}
    </button>
  );

  // 입력 중에도 바로 계산(2026-10-18 사용자: 자동 계산되는 항목이 없어) – 적고 있는 값으로 그 줄 잔액·집행률과 위 합계를 그려요.
  const live = (m: Money) => {
    const v = moneyOf(m, unit);
    return v == null ? 0 : v;
  };
  const draftRow: BudgetRow | null =
    form?.level === "row"
      ? { id: form.id ?? -1, name: form.name, kind: form.kind, co: form.co, cmt: live(form.cmt), exp: live(form.exp), act: live(form.act), stage: form.stage, memo: "", uid: "" }
      : null;
  const rowsOf = (it: { id: number; rows: BudgetRow[] }) => {
    if (!draftRow || form?.level !== "row") return it.rows;
    if (form.id != null) return it.rows.map((r) => (r.id === form.id ? draftRow : r));
    return form.item === it.id ? [...it.rows, draftRow] : it.rows;
  };
  const budgetOf = (level: "project" | "item", o: { id: number; budget: number | null }) =>
    form && form.level === level && form.id === o.id ? (moneyOf(form.budget, unit) ?? null) : o.budget;
  const pRows = (p: BudgetProject) => p.items.flatMap(rowsOf);

  // ---------- 숫자 칸 여러 개 고르기 ----------
  /** 칸 값(원). 화면에 보이는 계산과 같아요(고치는 중이면 치는 값으로). */
  const cellVal = (k: string, ci: number): number | null => {
    const col = VC[ci]?.[0];
    const id = Number(k.slice(1));
    if (k[0] === "g") {
      const x = findRow(id);
      if (!x) return null;
      const r = x.r;
      const v: Partial<Record<ColId, number>> = { cmt: r.cmt, exp: r.exp, act: r.act, bal: balance(r, basis) };
      return v[col] ?? null;
    }
    let budget: number | null;
    let rows: BudgetRow[];
    if (k[0] === "p") {
      const p = findP(id);
      if (!p) return null;
      budget = budgetOf("project", p);
      rows = pRows(p);
    } else {
      const x = findItem(id);
      if (!x) return null;
      budget = budgetOf("item", x.it);
      rows = rowsOf(x.it);
    }
    const t = sums(budget, rows, basis);
    const v: Partial<Record<ColId, number | null>> = { bud: budget, cmt: t.cmt, exp: t.exp, act: t.act, bal: t.bal, avail: t.avail };
    return v[col] ?? null;
  };
  /** 그냥 누르기 = 그 칸 하나(기준), Ctrl = 하나씩 더하기·빼기, Shift = 기준에서 여기까지 네모(Ctrl+Shift = 더하기) */
  const pickCell = (e: RMouseEvent) => {
    const c = (e.target as Element).closest(".bd-c");
    const rw = c?.parentElement;
    const sk = rw?.getAttribute("data-sel");
    const mod = e.ctrlKey || e.metaKey;
    if (!c || !rw || !sk || rw.classList.contains("edit") || (e.target as Element).closest("button, input, [contenteditable]")) {
      if (!mod && !e.shiftKey && e.detail === 1) setCs(NO_CELLS);
      return;
    }
    if (mod || e.shiftKey) {
      e.stopPropagation(); // 줄 고르기·고치기로 가지 않게
      if (form) return;
    } else if (e.detail !== 1) return;
    const ci = Array.prototype.indexOf.call(rw.children, c) as number;
    if (!NUM_IX.includes(ci)) {
      if (!mod && !e.shiftKey) setCs(NO_CELLS);
      return;
    }
    const key = sk + ":" + ci;
    if (e.shiftKey && cs.anchor) {
      const order = [...document.querySelectorAll(".bd-body .bd-rw[data-sel]:not(.edit)")].map((x) => x.getAttribute("data-sel"));
      const [ak, aci] = cs.anchor.split(":");
      const a = order.indexOf(ak);
      const b = order.indexOf(sk);
      if (a < 0 || b < 0) {
        setCs({ keys: [key], anchor: key });
        return;
      }
      const [r0, r1] = [Math.min(a, b), Math.max(a, b)];
      const [c0, c1] = [Math.min(+aci, ci), Math.max(+aci, ci)];
      const keys = new Set(mod ? cs.keys : [cs.anchor]); // 기준 칸이 먼저(차액 = 먼저 − 나중)
      for (let i = r0; i <= r1; i++) for (const n of NUM_IX) if (n >= c0 && n <= c1) keys.add(order[i] + ":" + n);
      setCs({ keys: [...keys], anchor: cs.anchor });
    } else if (mod) {
      setCs({ keys: cs.keys.includes(key) ? cs.keys.filter((x) => x !== key) : [...cs.keys, key], anchor: key });
    } else setCs({ keys: [key], anchor: key });
  };
  let csN = 0;
  let csSum = 0;
  const csVals: number[] = [];
  for (const k of cs.keys) {
    const [sk, ci] = k.split(":");
    const v = cellVal(sk, Number(ci));
    if (v != null) {
      csN++;
      csSum += v;
      csVals.push(v);
    }
  }
  /** 두 칸만 골랐을 때 차액 = 먼저 누른 칸 − 나중에 누른 칸 */
  const csDiff = csVals.length === 2 ? csVals[0] - csVals[1] : null;
  const won = unit === 1000 ? " 천원" : " 원";
  const csStyle = cs.keys.length
    ? cs.keys
        .map((k) => {
          const [sk, ci] = k.split(":");
          return `.bd-body .bd-rw[data-sel="${sk}"]>.bd-c:nth-child(${Number(ci) + 1})`;
        })
        .join(",") + "{background:var(--accent-tint);box-shadow:inset 0 0 0 1px var(--accent);color:var(--ink)}"
    : "";

  // ---------- 팀 공유 그리기 ----------
  const people = share?.people ?? [];
  const personName = (no: number | null | undefined) => (no == null ? "" : (people.find((x) => x.no === no)?.name ?? ""));
  const ownerBadge = (p: BudgetProject) => {
    const nm = personName(p.owner);
    const c = p.owner != null ? personColor(p.owner) : 0;
    return (
      <button
        type="button"
        data-pick
        className={"bs-own" + (nm ? "" : " none")}
        aria-label={nm ? `담당 ${nm} 바꾸기` : "담당 고르기"}
        title={nm ? `담당 ${nm}` : "담당 고르기"}
        style={nm ? { background: `var(--pj-${c}-bg)`, color: `var(--pj-${c}-fg)`, borderColor: `var(--pj-${c}-line)` } : undefined}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (pop?.t === "owner" && pop.id === p.id) {
            setPop(null);
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          setSel(selKey("project", p.id));
          setPop({ t: "owner", x: r.left, y: r.bottom + 4, id: p.id });
        }}
      >
        {/* 앞 3글자만(2026-10-21 사용자) – 전체 이름은 title */}
        {[...nm].slice(0, 3).join("")}
      </button>
    );
  };
  const setOwner = async (id: number, owner: number | null) => {
    setPop(null);
    await run(() => api.setBudgetOwner(id, owner));
  };
  /** 같은 칸 → 표 열 */
  const CF_COL: Partial<Record<Field, ColId>> = { name: "name", budget: "bud", kind: "kind", co: "co", cmt: "cmt", exp: "exp", act: "act", stage: "stage", owner: "owner", memo: "memo" };
  const cfs: Conflict[] = shareOn ? (share?.conflicts ?? []) : [];
  const cfIx = (c: Conflict) => VC.findIndex(([x]) => x === CF_COL[c.field]);
  const last = share?.last ?? null;
  const bandShown = shareOn && !!last && last.at !== bandOff && (last.receivedCells > 0 || !!last.error || !!last.note);
  const fresh = bandShown && last ? last.received : [];
  const shareStyle =
    cfs
      .filter((c) => cfIx(c) >= 0)
      .map((c) => `.bd-body .bd-rw[data-uid="${c.uid}"]>.bd-c:nth-child(${cfIx(c) + 1})`)
      .join(",") +
    (cfs.length ? "{box-shadow:inset 0 0 0 2px var(--cs-reply-bg);background:color-mix(in srgb,var(--cs-reply-bg) 14%,var(--surface));color:var(--ink);font-weight:600;cursor:pointer}" : "") +
    (fresh.length ? fresh.map((u) => `.bd-body .bd-rw[data-uid="${u}"]>.bd-c:first-child`).join(",") + "{box-shadow:inset 3px 0 0 var(--share-new)}" : "");
  /** 같은 칸을 누르면 고르기 상자 */
  const openCf = (e: RMouseEvent): boolean => {
    if (!cfs.length || e.shiftKey || e.ctrlKey || e.metaKey) return false;
    const c = (e.target as Element).closest(".bd-c");
    const rw = c?.parentElement;
    const uid = rw?.getAttribute("data-uid");
    if (!c || !rw || !uid || rw.classList.contains("edit")) return false;
    const ci = Array.prototype.indexOf.call(rw.children, c) as number;
    const hit = cfs.find((x) => x.uid === uid && cfIx(x) === ci);
    if (!hit) return false;
    e.stopPropagation();
    e.preventDefault();
    const r = c.getBoundingClientRect();
    setPop({ t: "cf", x: r.left + r.width / 2 - 150, y: r.bottom + 6, uid, field: hit.field });
    return true;
  };
  const cfValue = (f: Field, v: string) => {
    if (["budget", "cmt", "exp", "act"].includes(f)) return v === "" ? "(빈칸)" : fmt(Number(v), unit) || "0";
    if (f === "owner") return personName(v === "" ? null : Number(v)) || "(없음)";
    if (f === "memo") return memoToText(v).slice(0, 40) || "(빈칸)";
    return v || "(빈칸)";
  };
  const doRefresh = async () => {
    if (!(await commit())) return;
    await refreshShare();
  };

  const rowsOut: ReactNode[] = [];
  let carryShown = false;
  const lines = (parts: string[]) => parts.map((c) => <span key={c} className={"bd-tl " + c} />);

  const nameRow = (key: string, level: "project" | "item") => {
    const f = form as Extract<Form, { level: "project" | "item" }>;
    return (
      <div key={key} ref={formRow} className="bd-rw new" role="row" onKeyDown={formKeys}>
        {cell(
          <span className="bd-fill" style={{ paddingLeft: level === "item" ? 40 : 0 }}>
            {nameInput(level === "project" ? "세부사업 이름" : "부기사업 이름", level === "project")}
          </span>,
        )}
        {cell("")}
        {cell("")}
        {cell(moneyInput("budget", "예산", f.budget, level === "project"))}
        {cell(<span className="bd-hint">Enter 저장 · Esc 취소</span>)}
        {VC.slice(5).map((_, i) => cell("", "", i))}
      </div>
    );
  };

  const gunForm = (key: string, itemLast: boolean, existing: BudgetRow | null) => {
    const f = form as Extract<Form, { level: "row" }>;
    return (
      <div key={key} ref={formRow} className={"bd-rw gun " + (existing ? "edit" : "new")} role="row" onKeyDown={formKeys}>
        {cell(
          <>
            {lines([...(itemLast ? [] : ["v1"]), "v2", "h2"])}
            <span className="bd-gpad bd-fill">
              <SuggestInput
                className={"fld bd-in" + (bad === "name" ? " bad" : "")}
                label="공사명"
                value={f.name}
                options={projectHits(cdata, f.name).map((p) => ({ key: String(p.id), label: p.alias || p.name, sub: projectSub(cdata, p) }))}
                hint="업무연락처 사업 · ↑↓ 고르기 · Tab 확정 · Esc 친 그대로"
                onChange={(v) => {
                  setF({ name: v });
                  if (bad === "name") setBad(null);
                }}
                onPick={(o) => {
                  const orgs = orgsOf(cdata, Number(o.key));
                  if (orgs.length === 1 && !f.co.trim()) setF({ name: o.label, co: orgs[0].label });
                  else setF({ name: o.label });
                  setCoOpts(orgs.length > 1 ? orgs : null);
                }}
              />
            </span>
          </>,
        )}
        {cell(
          <button
            type="button"
            data-pick
            className="bd-selk"
            aria-label={`구분 ${f.kind} 바꾸기`}
            onClick={(e) => {
              if (pop?.t === "kind") {
                setPop(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              setPop({ t: "kind", x: r.left, y: r.bottom + 4, from: "form-kind" });
            }}
          >
            {f.kind}
            {ICON(CD, 10, 2.6)}
          </button>,
        )}
        {cell(
          <SuggestInput
            className="fld bd-in"
            label="업체"
            value={f.co}
            options={(coOpts ?? []).filter((o) => !f.co.trim() || (o.label.startsWith(f.co.trim()) && o.label !== f.co.trim()))}
            hint="이 사업의 업체 · ↑↓ 고르기 · Tab 확정 · Esc 친 그대로"
            openOnFocus
            onChange={(v) => setF({ co: v })}
            onPick={(o) => setF({ co: o.label })}
          />,
        )}
        {cell("")}
        {cell(moneyInput("cmt", "원인행위", f.cmt))}
        {cell(moneyInput("exp", "집행액", f.exp))}
        {cell(moneyInput("act", "시공량(사용량)", f.act))}
        {draftRow && cell(fmt(balance(draftRow, basis), unit), " n" + (balance(draftRow, basis) < 0 ? " red" : ""))}
        {draftRow && rowRateCell(draftRow)}
        {cell("")}
        {cell(stageChip(f.stage, (r, from) => setPop({ t: "stage", x: r.left, y: r.bottom + 4, id: "form", from }), "form-stage"))}
        {shareOn && cell("")}
        {cell(existing ? memoBtn("row", existing.id, existing.memo) : "")}
      </div>
    );
  };

  const group = (k: string, id: number, kids: ReactNode[]) => (
    <div key={k + id} className={"bd-" + k} role="presentation">
      {kids}
    </div>
  );
  if (form?.level === "project" && form.id == null && form.after == null) rowsOut.push(nameRow("new-top", "project"));
  for (const p of list) {
    if (p.carry && !carryShown) {
      carryShown = true;
      rowsOut.push(
        <div key="carry" className="bd-carry">
          이월 사업
        </div>,
      );
    }
    const rows = allRows(p);
    if (q && !rows.some((r) => matchRow(r, q))) continue;
    const pOpen = p.open || !!q;
    const pEdit = form?.level === "project" && form.id === p.id;
    const pk = selKey("project", p.id);
    // 틀고정(2026-10-21 사용자 1안): 세부사업 묶음·부기사업 묶음을 감싸야 다음 묶음의 줄이 앞 줄을 밀어 올려요
    const pOut: ReactNode[] = [];
    pOut.push(
      <div
        key={pk}
        ref={pEdit ? formRow : undefined}
        data-sel={pk}
        data-uid={p.uid}
        className={"bd-rw pj" + (sel === pk ? " sel" : "") + (pEdit ? " edit" : "")}
        role="row"
        onClick={() => !pEdit && void rowClick("project", p.id)}
        onDoubleClick={() => !pEdit && void startEdit("project", p.id)}
        onContextMenu={(e) => void openMenu(e, "project", p.id)}
        onKeyDown={pEdit ? formKeys : undefined}
      >
        {cell(
          <>
            {pOpen && <span className="bd-tl v1 dn1" />}
            <button
              type="button"
              className="bd-cr"
              aria-label={pOpen ? "접기" : "펼치기"}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void toggle("project", p.id, p.open);
              }}
            >
              {ICON(pOpen ? CD : CR, 14, 2.2)}
            </button>
            {pEdit ? (
              nameInput("세부사업 이름", true)
            ) : (
              <span className="bd-nm" title={p.name}>
                {p.name}
              </span>
            )}
          </>,
        )}
        {sumCells(budgetOf("project", p), pRows(p), false, memoBtn("project", p.id, p.memo), pEdit && form?.level === "project" ? cell(moneyInput("budget", "예산", form.budget, true)) : undefined, ownerBadge(p))}
      </div>,
    );
    if (form?.level === "project" && form.id == null && form.after === p.id) pOut.push(nameRow("new-after-" + p.id, "project"));
    if (!pOpen) {
      rowsOut.push(group("pg", p.id, pOut));
      continue;
    }
    if (form?.level === "item" && form.id == null && form.project === p.id) pOut.push(nameRow("new-item-" + p.id, "item"));
    let n = 0;
    const items = p.items.filter((it) => !q || it.rows.some((r) => matchRow(r, q)));
    items.forEach((it, j) => {
      const last = j === items.length - 1;
      const iOpen = it.open || !!q;
      n++;
      const ik = selKey("item", it.id);
      const iOut: ReactNode[] = [];
      const iEdit = form?.level === "item" && form.id === it.id;
      iOut.push(
        <div
          key={ik}
          ref={iEdit ? formRow : undefined}
          data-sel={ik}
          data-uid={it.uid}
          className={"bd-rw it" + (n % 2 === 0 ? " alt" : "") + (sel === ik ? " sel" : "") + (iEdit ? " edit" : "")}
          role="row"
          onClick={() => !iEdit && void rowClick("item", it.id)}
          onDoubleClick={() => !iEdit && void startEdit("item", it.id)}
          onContextMenu={(e) => void openMenu(e, "item", it.id)}
          onKeyDown={iEdit ? formKeys : undefined}
        >
          {cell(
            <>
              {lines(["v1" + (last ? " half" : ""), "h1", ...(iOpen && it.rows.length ? ["v2 dn2"] : [])])}
              <button
                type="button"
                className="bd-cr ind1"
                aria-label={iOpen ? "접기" : "펼치기"}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggle("item", it.id, it.open);
                }}
              >
                {ICON(iOpen ? CD : CR, 14, 2.2)}
              </button>
              {iEdit ? (
                nameInput("부기사업 이름")
              ) : (
                <span className="bd-nm" title={it.name}>
                  {it.name}
                </span>
              )}
            </>,
          )}
          {sumCells(budgetOf("item", it), rowsOf(it), true, memoBtn("item", it.id, it.memo), iEdit && form?.level === "item" ? cell(moneyInput("budget", "예산", form.budget)) : undefined)}
        </div>,
      );
      if (!iOpen) {
        pOut.push(group("ig", it.id, iOut));
        return;
      }
      if (form?.level === "row" && form.id == null && form.item === it.id) iOut.push(gunForm("new-row-" + it.id, last, null));
      const rs = sortRows(it.rows).filter((r) => matchRow(r, q));
      rs.forEach((r, k) => {
        n++;
        const gk = selKey("row", r.id);
        const rLines = [...(last ? [] : ["v1"]), "v2" + (k === rs.length - 1 ? " half" : ""), "h2"];
        if (form?.level === "row" && form.id === r.id) {
          iOut.push(gunForm(gk, last, r));
          return;
        }
        iOut.push(
          <div
            key={gk}
            data-sel={gk}
            data-uid={r.uid}
            className={"bd-rw gun" + (FINAL(r.stage) ? " done" : "") + (n % 2 === 0 ? " alt" : "") + (sel === gk ? " sel" : "") + (flash === r.id ? " flash" : "")}
            role="row"
            onClick={() => void rowClick("row", r.id)}
            onDoubleClick={() => void startEdit("row", r.id)}
            onContextMenu={(e) => void openMenu(e, "row", r.id)}
          >
            {cell(
              <>
                {lines(rLines)}
                <span className="bd-gpad bd-nm" title={r.name}>
                  {r.name}
                </span>
              </>,
            )}
            {cell(<span className={"bd-chip bd-kchip " + (KIND_CLASS[r.kind] ?? "k-il")}>{r.kind}</span>)}
            {cell(
              <span className="bd-nm" title={r.co}>
                {r.co}
              </span>,
            )}
            {cell("")}
            {cell(fmt(r.cmt, unit), " n")}
            {cell(fmt(r.exp, unit), " n")}
            {cell(fmt(r.act, unit), " n")}
            {cell(fmt(balance(r, basis), unit), " n" + (balance(r, basis) < 0 ? " red" : ""))}
            {rowRateCell(r)}
            {cell("")}
            {cell(
              stageChip(
                r.stage,
                (rect, from) => {
                  setSel(gk);
                  setPop({ t: "stage", x: rect.left - 3, y: rect.bottom + 4, id: r.id, from });
                },
                "stage-" + r.id,
              ),
            )}
            {shareOn && cell("")}
            {cell(memoBtn("row", r.id, r.memo))}
          </div>,
        );
      });
      pOut.push(group("ig", it.id, iOut));
    });
    rowsOut.push(group("pg", p.id, pOut));
  }

  // ---------- 뜨는 것 그리기 ----------
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!pop || !popRef.current) {
      setPopPos(null);
      return;
    }
    const r = popRef.current.getBoundingClientRect();
    setPopPos({ left: Math.max(8, Math.min(pop.x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(pop.y, innerHeight - r.height - 8)) });
  }, [pop]);

  const mi = (t: string, onClick: (() => void) | null, o: { cls?: string; icon?: ReactNode; k?: string; sub?: ReactNode } = {}) => (
    <div
      className={"bd-mi" + (o.cls ? " " + o.cls : "") + (!onClick && !o.sub ? " off" : "")}
      role="menuitem"
      aria-disabled={!onClick && !o.sub}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <span className="bd-mi-ic">{o.icon}</span>
      <span className="bd-mi-t">{t}</span>
      {o.k && <span className="bd-mi-k">{o.k}</span>}
      {o.sub && ICON(CR, 12, 2.2)}
      {o.sub}
    </div>
  );
  const MD = <div className="bd-mdiv" />;

  function menuBody(level: BudgetLevel, id: number): ReactNode {
    const ic = ICON(PLUS);
    const projOf = level === "project" ? findP(id) : level === "item" ? findItem(id)?.p : findRow(id)?.p;
    const itemOf = level === "item" ? findItem(id)?.it : level === "row" ? findRow(id)?.it : null;
    const add = (
      <>
        {mi("세부사업 추가", projOf ? () => void startAdd(newProject(projOf.id)) : null, { cls: "add", icon: ic, k: "아래에" })}
        {mi("부기사업 추가", projOf ? () => void startAdd(newItem(projOf.id)) : null, { cls: "add", icon: ic })}
        {mi("공사(용역·물품) 추가", itemOf ? () => void startAdd(newRow(itemOf.id)) : null, { cls: itemOf ? "add" : "", icon: ic })}
        {MD}
      </>
    );
    const del = () => setPop({ t: "confirm", x: pop!.x, y: pop!.y, level, id });
    const memo = () => setPop({ t: "memo", x: pop!.x, y: pop!.y, level, id });
    const up = () => void run(() => api.moveBudget(level, id, -1)).then(() => setPop(null));
    const down = () => void run(() => api.moveBudget(level, id, 1)).then(() => setPop(null));
    if (level === "project") {
      const p = findP(id);
      if (!p) return null;
      return (
        <>
          {add}
          {mi("수정", () => void startEdit("project", id), { k: "두 번 누르기" })}
          {mi("메모", memo)}
          {mi("부기사업 모두 펼치기", () => void run(() => api.setBudgetOpen("project", id, true, true)).then(() => setPop(null)))}
          {mi("부기사업 모두 접기", () => void run(() => api.setBudgetOpen("project", id, false, true)).then(() => setPop(null)))}
          {MD}
          {mi("위로 옮기기", up)}
          {mi("아래로 옮기기", down)}
          {MD}
          {mi(bsSent.has(p.name) ? "예산현황 설정" : "예산현황으로 보내기", () => { setPop(null); void openSend(p.name); })}
          {MD}
          {mi("세부사업 지우기", del, { cls: "dg", k: `부기사업 ${p.items.length} · 공사 ${allRows(p).length}` })}
        </>
      );
    }
    if (level === "item") {
      const x = findItem(id);
      if (!x) return null;
      const others = list.filter((q2) => q2.id !== x.p.id);
      const sub = (
        <div className="bd-pop bd-sub" style={{ width: 240 }}>
          {others.length ? others.map((q2) => mi(q2.name, () => moveItem(id, q2.id))) : mi("옮길 세부사업이 없어요", null)}
        </div>
      );
      return (
        <>
          {add}
          {mi("수정", () => void startEdit("item", id), { k: "두 번 누르기" })}
          {mi("메모", memo)}
          {mi("다른 세부사업으로 옮기기", null, { sub })}
          {mi("위로 옮기기", up)}
          {mi("아래로 옮기기", down)}
          {MD}
          {mi("부기사업 지우기", del, { cls: "dg", k: `공사 ${x.it.rows.length}` })}
        </>
      );
    }
    const x = findRow(id);
    if (!x) return null;
    const ssub = (
      <div className="bd-pop bd-sub bd-stlist">
        {STAGES.map((s) => (
          <div key={s} className={"bd-mi" + (s === x.r.stage ? " cur" : "")} onClick={() => setStage(id, s)}>
            <span className={"bd-chip " + STAGE_CLASS[s]}>{s}</span>
          </div>
        ))}
      </div>
    );
    const msub = (
      <div className="bd-pop bd-sub" style={{ width: 260, maxHeight: 360, overflow: "auto" }}>
        {list.map((q2) => (
          <Fragment key={q2.id}>
            <div className="bd-grp">{q2.name}</div>
            {q2.items.filter((i) => i.id !== x.it.id).map((i) => (
              <Fragment key={i.id}>{mi(i.name, () => moveRow(id, i.id))}</Fragment>
            ))}
          </Fragment>
        ))}
      </div>
    );
    return (
      <>
        {add}
        {mi("수정", () => void startEdit("row", id), { k: "두 번 누르기" })}
        {mi("단계", null, { sub: ssub })}
        {mi("메모", memo)}
        {mi("다른 부기사업으로 옮기기", null, { sub: msub })}
        {MD}
        {mi("공사 지우기", del, { cls: "dg", k: "Del" })}
      </>
    );
  }

  const moveItem = async (id: number, to: number) => {
    const x = findItem(id), t = findP(to);
    if (x && t?.items.some((i) => i.name === x.it.name)) {
      setToast("같은 이름의 부기사업이 있어요");
      return;
    }
    setPop(null);
    await run(() => api.moveBudgetItem(id, to), `${t?.name ?? ""}(으)로 옮겼어요`);
  };
  const moveRow = async (id: number, to: number) => {
    setPop(null);
    const t = findItem(to);
    if (await run(() => api.moveBudgetRow(id, to), `${t?.it.name ?? ""}(으)로 옮겼어요`)) setFlash(id);
  };
  const setStage = async (id: number, s: string) => {
    setPop(null);
    await run(() => api.setBudgetStage(id, s));
  };
  const doDelete = async (level: BudgetLevel, id: number) => {
    setPop(null);
    if (await run(() => api.deleteBudget(level, id), "지웠어요")) setSel(null);
  };

  function confirmBody(level: BudgetLevel, id: number): ReactNode {
    let msg: ReactNode = null;
    if (level === "project") {
      const p = findP(id);
      if (!p) return null;
      msg = (
        <>
          <b>{p.name}</b>을(를) 지울까요?
          <br />
          부기사업 {p.items.length}개 · 공사 {allRows(p).length}건도 함께 지워져요.
        </>
      );
    } else if (level === "item") {
      const x = findItem(id);
      if (!x) return null;
      msg = (
        <>
          <b>{x.it.name}</b>을(를) 지울까요?
          {x.it.rows.length > 0 && (
            <>
              <br />공사 {x.it.rows.length}건도 함께 지워져요.
            </>
          )}
        </>
      );
    } else {
      const x = findRow(id);
      if (!x) return null;
      msg = (
        <>
          <b>{x.r.name}</b>을(를) 지울까요?
        </>
      );
    }
    return (
      <AskBand className="dmenu-ask bd-ask" label="지우기 확인" text={msg} onNo={() => setPop(null)} onYes={() => void doDelete(level, id)} />
    );
  }

  const memoTarget = (level: BudgetLevel, id: number) =>
    level === "project" ? findP(id) : level === "item" ? findItem(id)?.it : findRow(id)?.r;
  const saveMemo = async (level: BudgetLevel, id: number) => {
    const html = memoHtml.current;
    const clean = isEmptyMemo(html) ? "" : sanitize(html);
    setPop(null);
    await run(() => api.setBudgetMemo(level, id, clean));
  };
  // 메모 창: 바깥 누르기 = 저장(목업과 같게), Esc = 취소
  useOutsideClose(pop?.t === "memo", [], () => {
    if (pop?.t === "memo") void saveMemo(pop.level, pop.id);
  }, { ignore: ".bd-pop", capture: true });

  function popBody(): ReactNode {
    if (!pop) return null;
    if (pop.t === "menu") return <div style={{ width: 250 }}>{menuBody(pop.level, pop.id)}</div>;
    if (pop.t === "confirm") return confirmBody(pop.level, pop.id);
    if (pop.t === "owner") {
      const cur = findP(pop.id)?.owner ?? null;
      const id = pop.id;
      return (
        <div className="bd-stlist bs-olist">
          {people
            .filter((x) => !x.gone)
            .map((x) => (
              <div key={x.no} className={"bd-mi" + (x.no === cur ? " cur" : "")} onClick={() => void setOwner(id, x.no)}>
                <span className="bs-own" style={{ background: `var(--pj-${personColor(x.no)}-bg)`, color: `var(--pj-${personColor(x.no)}-fg)`, borderColor: `var(--pj-${personColor(x.no)}-line)` }}>
                  {x.name}
                </span>
              </div>
            ))}
          {cur != null && (
            <div className="bd-mi" onClick={() => void setOwner(id, null)}>
              <span className="bs-own bs-oclear">비우기</span>
            </div>
          )}
        </div>
      );
    }
    if (pop.t === "cf") {
      const c = cfs.find((x) => x.uid === pop.uid && x.field === pop.field);
      if (!c) return null;
      const who = personName(c.who) || "다른 사람";
      return (
        <div className="bs-cf">
          <div className="bs-pt">
            <b>{who} 님이 먼저 고쳤어요</b>
            <span className="bs-mut">{shortTime(c.at)}</span>
          </div>
          <div className="bs-pr">
            <span className="bs-mut">{who}</span>
            <span className="bs-v">{cfValue(c.field, c.theirs)}</span>
          </div>
          <div className="bs-pr">
            <span className="bs-mut">내 값</span>
            <span className="bs-v">{cfValue(c.field, c.mine)}</span>
          </div>
          <div className="bs-pb">
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => {
                setPop(null);
                void takeTheirs(c);
              }}
            >
              {who} 값 그대로
            </button>
            <button
              type="button"
              className="btn-primary btn-xs"
              onClick={() => {
                setPop(null);
                void keepMine(c);
              }}
            >
              내 값으로
            </button>
          </div>
        </div>
      );
    }
    if (pop.t === "stage") {
      const cur = pop.id === "form" ? (form as Extract<Form, { level: "row" }> | null)?.stage : findRow(pop.id)?.r.stage;
      return (
        <div className="bd-stlist">
          {STAGES.map((s) => (
            <div
              key={s}
              className={"bd-mi" + (s === cur ? " cur" : "")}
              onClick={() => {
                if (pop.id === "form") {
                  setF({ stage: s });
                  setPop(null);
                } else void setStage(pop.id, s);
              }}
            >
              <span className={"bd-chip " + STAGE_CLASS[s]}>{s}</span>
            </div>
          ))}
        </div>
      );
    }
    if (pop.t === "kind") {
      const cur = (form as Extract<Form, { level: "row" }> | null)?.kind;
      return (
        <div className="bd-stlist">
          {KINDS.map((k) => (
            <div
              key={k}
              className={"bd-mi" + (k === cur ? " cur" : "")}
              onClick={() => {
                setF({ kind: k });
                setPop(null);
              }}
            >
              <span className={"bd-chip bd-kchip " + KIND_CLASS[k]}>{k}</span>
            </div>
          ))}
        </div>
      );
    }
    if (pop.t === "excel") {
      return (
        <div style={{ width: 200 }}>
          {mi("가져오기", () => void importExcel())}
          {mi("내보내기", () => void exportExcel(), { k: unit === 1 ? "원" : "천원" })}
        </div>
      );
    }
    const o = memoTarget(pop.level, pop.id);
    if (!o) return null;
    return (
      <div className="bd-memopop">
        <div className="bd-mh">{o.name}</div>
        <MemoEditor
          lite
          initial={o.memo}
          placeholder="면적·아스콘톤·착공일 등"
          onChange={(h) => (memoHtml.current = h)}
          onSubmit={() => void saveMemo(pop.level, pop.id)}
          onCancel={() => setPop(null)}
        />
        <div className="bd-mrow">
          <span className="bd-kh">Enter 같은 위계 · Shift+Enter 아래 · Ctrl+Enter 위 · Tab 저장</span>
          <span className="bd-mbtns">
            <button type="button" className="btn btn-xs" onClick={() => setPop(null)}>
              취소
            </button>
            <button type="button" className="btn btn-xs bd-p" onClick={() => void saveMemo(pop.level, pop.id)}>
              저장
            </button>
          </span>
        </div>
      </div>
    );
  }
  // 메모 창을 열 때마다 새로 담아요.
  const memoOpenKey = pop?.t === "memo" ? `${pop.level}${pop.id}` : "";
  useEffect(() => {
    if (pop?.t === "memo") memoHtml.current = memoTarget(pop.level, pop.id)?.memo ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoOpenKey]);

  // 잔액 기준 세 열(원인행위·고른 기준 열·잔액)은 옅게 칠하고 머리 글자 보라(2026-10-21 사용자 2안) – 열 머리를 눌러 칠한 열과 겹치면 두 겹으로
  const colStyle = (() => {
    const basisCols = new Set((["cmt", basis, "bal"] as ColId[]).map((c) => VC.findIndex(([x]) => x === c)).filter((i) => i >= 0));
    const hl = "linear-gradient(var(--bd-col-hl),var(--bd-col-hl))";
    const out: string[] = [];
    for (let i = 0; i < VC.length; i++) {
      const n = (basisCols.has(i) ? 1 : 0) + (colHl === i ? 1 : 0);
      if (n) out.push(`.bd-body .bd-rw>.bd-c:nth-child(${i + 1}){background-image:${Array(n).fill(hl).join(",")}}`);
      if (basisCols.has(i)) out.push(`.bd-hd>.bd-h:nth-child(${i + 1}):not(.on){background:var(--accent-tint);color:var(--accent);font-weight:700}`);
    }
    return out.join("");
  })();
  const head = useMemo(
    () =>
      VC.map(([c, label], i) => (
        <div
          key={c}
          className={"bd-h" + (colHl === i ? " on" : "")}
          role="columnheader"
          title="누르면 이 열을 칠해요"
          onClick={(e) => {
            if ((e.target as Element).closest(".bd-grip")) return;
            setColHl(colHl === i ? null : i);
          }}
        >
          {label}
          {!FIXED.has(c) && <span className="bd-grip" title="끌어서 너비 · 두 번 누르면 내용에 맞춤" onMouseDown={(e) => startDrag(e, c)} onDoubleClick={(e) => autoFit(e, c)} />}
        </div>
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colHl, W, nameFixed, avail, VC],
  );

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
    <div ref={rootRef} className={"bd" + (packed ? " bd-packed" : "")} style={{ ["--bd-cols" as string]: cols }}>
      <div className="bd-top tb5" style={packed ? { width: colSum + 1 } : undefined}>
        <h1 className="title">집행현황</h1>
        <span className="bd-year">
          <button type="button" aria-label="이전 해" onClick={() => void changeYear(year - 1)}>
            {ICON("M15 6l-6 6 6 6", 16, 2.2)}
          </button>
          <b>{year}년</b>
          <button type="button" aria-label="다음 해" onClick={() => void changeYear(year + 1)}>
            {ICON("M9 6l6 6-6 6", 16, 2.2)}
          </button>
        </span>
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
              {share.busy ? "새로고침 중…" : share.conf.up || share.conf.down ? `올림 ${shortTime(share.conf.up) || "–"} · 받음 ${shortTime(share.conf.down) || "–"}` : "아직 새로고침 전"}
            </span>
          </>
        )}
        <span className="bd-sp" />
        <span className="bd-unit tb-seg-l" role="group" aria-label="잔액·집행률 기준" title="잔액·집행률 기준">
          {(["exp", "act"] as Basis[]).map((b) => (
            <button key={b} type="button" className={basis === b ? "on" : ""} aria-pressed={basis === b} onClick={() => void setBasis(b)}>
              {b === "exp" ? "집행액" : "시공량"}
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
        <button type="button" className="btn btn-ctrl bd-tool tb-fit" title="열 간격을 보이는 내용 폭에 맞춰요 · 열 제목 우클릭으로 처음대로" onClick={() => void fitAll()}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5v14M21 5v14M3 12h6M21 12h-6M6 9l3 3-3 3M18 9l-3 3 3 3" />
          </svg>
          배치최적화
        </button>
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
        <label className="search bd-search">
          {searchIcon}
          <input
            ref={qInput}
            type="text"
            aria-label="공사 검색"
            placeholder="공사명, 업체 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && q) {
                e.preventDefault();
                e.stopPropagation();
                setQ("");
              }
            }}
          />
          {q && (
            <button
              type="button"
              className="search-x"
              aria-label="검색어 지우기"
              title="지우기"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQ("");
                qInput.current?.focus();
              }}
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </label>
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
        <div className={"bs-band" + (last.error ? " bad" : cfs.length ? " cf" : "")} role="status" style={packed ? { width: colSum + 2 + sbw } : undefined}>
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
          {bandShown && (
            <button type="button" className="btn x" aria-label="닫기" title="닫기" onClick={() => setBandOff(last.at)}>
              {ICON("M6 6l12 12M18 6L6 18", 14, 2.4)}
            </button>
          )}
        </div>
      )}
      <div className="bd-tbl" style={packed ? { width: colSum + 2 + sbw } : undefined}>
        <style>{shareStyle}</style>
        <style>{colStyle}</style>
        <style>{csStyle}</style>
        <div className="bd-scroll" ref={scroller}>
          <div className="bd-hd" role="row" onContextMenu={resetCols}>
            {head}
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
          />
        );
      })()}
      {ask && (
        <div className="overlay" onMouseDown={overlayDown(() => setAsk(null))}>
          <div className="dialog xl-ask" role="dialog" aria-modal="true" aria-label="엑셀 가져오기">
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

      {toast && (
        <div className="bd-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
