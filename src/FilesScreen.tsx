// 탐색기(11단계) 화면. 시안 캔버스 Files·FilesTree·FilesConflict·FilesMenu 판, 사양서 "탐색기 (11단계)" 절이 기준이에요.
// - 왼쪽 폴더 트리(2안: 안내선 + 드라이브 띠 + 지금 경로) + 2창(기본)/4창(2×2).
// - 창마다 탭 줄 → 드라이브 줄(드라이브 · 빠른 필터 · 보기 ▾) → 경로 줄(경로 · 경로 복사 · 윈도우 탐색기로 열기 · ★) → 목록 → 상태 줄.
// - 우클릭(파일·폴더·빈 곳)은 윈도우 우클릭 메뉴 그대로(2안), 탭 우클릭만 기록 메뉴.
// - 상태(탭·열 폭·정렬·보기·트리·즐겨찾기·찾기 조건·일괄 이름 바꾸기 설정)는 암호화 파일 kv "files.state".
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, inApp } from "./api";
import { FileIcon } from "./FileIcon";
import { ConflictDialog, Decision, DeleteDialog, NameDialog, RenameDialog } from "./FilesDialogs";
import {
  CLOCKWISE,
  EMPTY_FIND,
  FilesState,
  FindForm,
  FsDrive,
  FsEntry,
  FsPane,
  FsTab,
  IMAGE_EXT,
  RenameOpts,
  SortKey,
  TREE_W,
  VIEWS,
  ViewMode,
  baseName,
  bothName,
  cleanPath,
  crumbsOf,
  driveOf,
  extOf,
  findSummary,
  formatDate,
  formatSize,
  joinPath,
  nextPane,
  parentOf,
  parseSize,
  quickMatch,
  readState,
  sortEntries,
  typeName,
  HOME,
  PC,
  PC_FOLD,
  isSpecial,
} from "./files";
import { Conflict, FastStatus, Found, MenuResult, TreeDir, fsApi, fsErrorText, onFsChanged, onFsProgress } from "./filesApi";
import { parseDate } from "./journal";
import { DEFAULT_FILES_SETTINGS, FilesSettings, loadSettings, saveSettings } from "./settingsStore";

const STATE_KEY = "files.state";

type FindRun = {
  form: FindForm;
  results: Found[];
  running: boolean;
  /** 펼쳐보기(하위 폴더 파일까지 한 목록) */
  flat?: boolean;
  /** 빠른 찾기 칸에 치는 대로 바뀌는 탭(치는 동안 새 탭을 만들지 않고 이 탭을 고쳐요) */
  live?: boolean;
  /** 모든 드라이브(빠른 찾기 목록)에서 찾음 */
  all?: boolean;
  /** 걸린 시간(밀리초) */
  ms?: number;
};
/** back·fwd: 이 탭에서 다녀온 폴더(뒤로·앞으로 — 마우스 옆 단추·Alt+←/→). 저장하지 않아요. */
type RTab = FsTab & { find?: FindRun; id: number; back?: string[]; fwd?: string[] };
type RPane = Omit<FsPane, "tabs"> & { tabs: RTab[] };
type RState = Omit<FilesState, "panes"> & { panes: RPane[] };

type Listing = { path: string; entries: FsEntry[]; error: string; loading: boolean };
type Sel = { paths: Set<string>; cursor: string | null; anchor: string | null };
type Row = FsEntry & { folder?: string };

let tabSeq = 1;
const withIds = (p: FsPane): RPane => ({ ...p, tabs: p.tabs.map((t) => ({ ...t, id: tabSeq++ })) });

/** 저장할 때는 찾기 탭과 화면용 번호를 빼요. */
function toSaved(s: RState): FilesState {
  return {
    ...s,
    panes: s.panes.map((p) => {
      const tabs = p.tabs.filter((t) => !t.find).map(({ path, pinned }) => ({ path, pinned }));
      const activeTab = p.tabs[p.active];
      const active = activeTab?.find ? 0 : Math.max(0, tabs.findIndex((t) => t.path === activeTab?.path && !activeTab.find));
      return { ...p, tabs: tabs.length ? tabs : [{ path: p.tabs[0]?.path ?? "", pinned: false }], active };
    }),
  };
}

const EMPTY_SEL: Sel = { paths: new Set(), cursor: null, anchor: null };

/** 글자 칸이나 뜬 창 안에서 누른 키는 탐색기 키가 아니에요. */
function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (!!el.closest("input, textarea, select, [contenteditable='true']") || !!el.closest(".overlay"));
}

export default function FilesScreen() {
  const [st, setSt] = useState<RState | null>(null);
  const stRef = useRef<RState | null>(null);
  stRef.current = st;
  const [home, setHome] = useState("");
  const [cfg, setCfg] = useState<FilesSettings>(DEFAULT_FILES_SETTINGS);
  /** 파일 형식 이름(".xlsx" → "Microsoft Excel 워크시트") — 확장자마다 한 번만 윈도우에 물어요 */
  const [types, setTypes] = useState<Record<string, string>>({});
  const typesAsked = useRef(new Set<string>());
  const [drives, setDrives] = useState<FsDrive[]>([]);
  const [lists, setLists] = useState<Listing[]>([0, 1, 2, 3].map(() => ({ path: "", entries: [], error: "", loading: false })));
  // 보이는 목록의 확장자 가운데 아직 형식 이름을 모르는 것만 모아 한 번에 물어요.
  useEffect(() => {
    if (!cfg.cols.type) return;
    const want = new Set<string>(["<dir>"]);
    const add = (e: { name: string; dir: boolean }) => !e.dir && want.add("." + extOf(e.name));
    lists.forEach((l) => l.entries.forEach(add));
    st?.panes.forEach((p) => p.tabs.forEach((t) => t.find?.results.forEach(add)));
    const keys = [...want].filter((k) => !typesAsked.current.has(k));
    if (!keys.length) return;
    keys.forEach((k) => typesAsked.current.add(k));
    fsApi.types(keys).then((got) => setTypes((T) => ({ ...T, ...got })), () => {});
  }, [lists, st, cfg.cols.type]);
  const listsRef = useRef(lists);
  /** 즐겨찾기 목록(load가 읽어요 — 바뀌면 즐겨찾기를 보는 창을 다시 읽어요) */
  const favRef = useRef<string[]>([]);
  favRef.current = st?.favorites ?? [];
  listsRef.current = lists;
  const [sels, setSels] = useState<Sel[]>([EMPTY_SEL, EMPTY_SEL, EMPTY_SEL, EMPTY_SEL]);
  const selsRef = useRef(sels);
  selsRef.current = sels;
  const [filters, setFilters] = useState(["", "", "", ""]);
  /** 4창의 대상 창(바로 전에 있던 창) */
  const [prev, setPrev] = useState(1);
  const [editPath, setEditPath] = useState<{ pane: number; value: string } | null>(null);
  const [inline, setInline] = useState<{ pane: number; path: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ kind: "view" | "fav" | "tab"; pane: number; tab?: number; x?: number; y?: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [quickFind, setQuickFind] = useState("");
  // 빠른 찾기 도우미(설치할 때 함께 깔림) — 목록이 준비된 드라이브가 있으면 "모든 드라이브"를 바로 찾아요.
  const [fast, setFast] = useState<FastStatus | null>(null);
  const fastReady = !!fast?.running && fast.drives.some((d) => d.ready);
  useEffect(() => {
    let on = true;
    const ask = () => void fsApi.fastStatus().then((f) => on && setFast(f)).catch(() => on && setFast(null));
    ask();
    const t = window.setInterval(ask, 30000);
    return () => {
      on = false;
      window.clearInterval(t);
    };
  }, []);
  const [form, setForm] = useState<FindForm>(EMPTY_FIND);
  const [formBad, setFormBad] = useState({ from: false, to: false });
  const [conflict, setConflict] = useState<{ list: Conflict[]; i: number; op: "copy" | "move"; resolve: (d: Record<string, string> | null) => void; dec: Record<string, string> } | null>(null);
  const [del, setDel] = useState<{ items: FsEntry[]; permanent: boolean; pane: number } | null>(null);
  const [renameRows, setRenameRows] = useState<{ pane: number; rows: (FsEntry & { parentName: string; folder: string })[]; where: string } | null>(null);
  const [undo, setUndo] = useState<{ path: string; name: string }[] | null>(null);
  const [nameAsk, setNameAsk] = useState<{ title: string; value: string; ok: (v: string) => void } | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState<{ done: number; total: number; name: string } | null>(null);
  const [tree, setTree] = useState<Map<string, TreeDir[]>>(new Map());
  const quickRef = useRef<HTMLInputElement>(null);
  const filterRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ---------- 처음 읽기 ----------
  useEffect(() => {
    (async () => {
      const [h, raw, s, dv] = await Promise.all([fsApi.home(), api.get(STATE_KEY).catch(() => null), loadSettings().catch(() => null), fsApi.drives().catch(() => [])]);
      const fc = s?.files ?? DEFAULT_FILES_SETTINGS;
      const startDir = fc.newTabDir || h;
      setHome(startDir);
      setCfg(fc);
      setDrives(dv);
      const saved = readState(raw, startDir);
      setSt({ ...saved, panes: saved.panes.map(withIds) });
      setPrev(saved.active === 0 ? 1 : 0);
    })();
  }, []);

  const flash = useCallback((t: string) => {
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? "" : x)), 3000);
  }, []);

  // 상태 저장(조금 모아서)
  useEffect(() => {
    if (!st) return;
    const t = window.setTimeout(() => void api.set(STATE_KEY, JSON.stringify(toSaved(st))).catch(() => {}), 500);
    return () => window.clearTimeout(t);
  }, [st]);

  const paneCount = st?.four ? 4 : 2;
  const activeTab = (p: RPane) => p.tabs[p.active] ?? p.tabs[0];

  // ---------- 폴더 읽기 ----------
  const load = useCallback(
    async (pane: number, path: string, keepSel = false) => {
      setLists((ls) => ls.map((l, i) => (i === pane ? { ...l, path, loading: true, error: "" } : l)));
      try {
        const entries = path === HOME ? await favEntries(favRef.current) : await fsApi.list(path, cfg.showHidden);
        setLists((ls) => ls.map((l, i) => (i === pane && l.path === path ? { path, entries, error: "", loading: false } : l)));
        if (!keepSel) setSels((ss) => ss.map((s, i) => (i === pane ? EMPTY_SEL : s)));
        else
          setSels((ss) =>
            ss.map((s, i) => {
              if (i !== pane) return s;
              const have = new Set(entries.map((e) => e.path));
              return { ...s, paths: new Set([...s.paths].filter((p) => have.has(p))), cursor: s.cursor && have.has(s.cursor) ? s.cursor : null };
            }),
          );
      } catch (e) {
        setLists((ls) => ls.map((l, i) => (i === pane ? { path, entries: [], error: fsErrorText(e), loading: false } : l)));
      }
    },
    [cfg.showHidden],
  );

  // 즐겨찾기를 더하거나 빼면 즐겨찾기를 보는 창을 다시 읽어요.
  const favKey = (st?.favorites ?? []).join("\u0001");
  useEffect(() => {
    listsRef.current.forEach((l, i) => l.path === HOME && void load(i, HOME, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favKey]);

  // 보이는 창의 폴더가 바뀌면 읽어요.
  const paths = st ? st.panes.slice(0, paneCount).map((p) => (activeTab(p).find ? "" : activeTab(p).path)) : [];
  const pathsKey = paths.join("\u0001");
  useEffect(() => {
    paths.forEach((p, i) => {
      if (p && listsRef.current[i].path !== p) void load(i, p);
    });
    void fsApi.watch(paths.filter((p) => p && !isSpecial(p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey, load]);

  // 숨김 파일 설정이 바뀌면 다시 읽어요.
  useEffect(() => {
    paths.forEach((p, i) => p && void load(i, p, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.showHidden]);

  // 폴더가 바뀌면 저절로 반영
  useEffect(
    () =>
      onFsChanged((dir) => {
        listsRef.current.forEach((l, i) => {
          if (l.path && l.path.toLowerCase() === dir.toLowerCase()) void load(i, l.path, true);
        });
        setTree((t) => {
          if (!t.has(dir)) return t;
          const n = new Map(t);
          n.delete(dir);
          return n;
        });
      }),
    [load],
  );
  useEffect(() => onFsProgress((p) => setBusy(p)), []);

  // ---------- 상태 바꾸기 도우미 ----------
  const updPane = useCallback((pane: number, f: (p: RPane) => RPane) => {
    setSt((s) => (s ? { ...s, panes: s.panes.map((p, i) => (i === pane ? f(p) : p)) } : s));
  }, []);

  const focusPane = useCallback((pane: number) => {
    const s = stRef.current;
    if (!s || s.active === pane) return;
    setPrev(s.active);
    setSt({ ...s, active: pane });
  }, []);

  /** 대상 창: 2창은 반대 창, 4창은 바로 전에 있던 창 */
  const targetOf = (pane: number) => (st?.four ? (prev === pane ? CLOCKWISE[(CLOCKWISE.indexOf(pane) + 1) % 4] : prev) : pane === 0 ? 1 : 0);

  /** 네칸 → 두칸: 지금 창과 대상 창을 네칸 자리 순서대로 두 칸에 남기고, 나머지는 뒤로(2026-10-18 사용자 1안) */
  const toTwo = () => {
    if (!st || !st.four) return;
    const a = st.active;
    const t = targetOf(a);
    const keep = [a, t].sort((x, y) => x - y);
    const perm = [...keep, ...[0, 1, 2, 3].filter((i) => !keep.includes(i))];
    setPrev(perm.indexOf(t));
    setSt({ ...st, four: false, perm, panes: perm.map((i) => st.panes[i]), active: perm.indexOf(a) });
  };
  /** 두칸 → 네칸: 옮겨 둔 자리를 되돌려 창마다 원래 자리로 */
  const toFour = () => {
    if (!st || st.four) return;
    const perm = st.perm;
    if (!perm) return setSt({ ...st, four: true });
    const panes = [...st.panes];
    perm.forEach((orig, k) => (panes[orig] = st.panes[k]));
    const other = perm[st.active === 0 ? 1 : 0];
    setPrev(other);
    setSt({ ...st, four: true, perm: undefined, panes, active: perm[st.active] });
  };

  /** 폴더 열기. 고정 탭이면 새 탭으로 열어요. */
  const go = useCallback(
    (pane: number, path: string, select?: string) => {
      updPane(pane, (p) => {
        const t = p.tabs[p.active];
        if (t && !t.pinned && !t.find) {
          if (t.path === path) return p;
          const back = [...(t.back ?? []), t.path].slice(-50);
          const tabs = p.tabs.map((x, i) => (i === p.active ? { ...x, path, back, fwd: [] } : x));
          return { ...p, tabs };
        }
        const tabs = [...p.tabs];
        tabs.splice(p.active + 1, 0, { path, pinned: false, id: tabSeq++ });
        return { ...p, tabs, active: p.active + 1 };
      });
      if (select) window.setTimeout(() => setSels((ss) => ss.map((s, i) => (i === pane ? { paths: new Set([select]), cursor: select, anchor: select } : s))), 120);
    },
    [updPane],
  );

  /** 뒤로(-1)·앞으로(+1): 이 탭에서 다녀온 폴더로 (고정 탭도 그 탭 안에서 움직여요) */
  const stepHistory = (pane: number, dir: -1 | 1) =>
    updPane(pane, (p) => {
      const t = p.tabs[p.active];
      if (!t || t.find) return p;
      const back = [...(t.back ?? [])];
      const fwd = [...(t.fwd ?? [])];
      const to = dir < 0 ? back.pop() : fwd.pop();
      if (!to) return p;
      if (dir < 0) fwd.push(t.path);
      else back.push(t.path);
      const tabs = p.tabs.map((x, i) => (i === p.active ? { ...x, path: to, back, fwd } : x));
      return { ...p, tabs };
    });

  const newTab = (pane: number, path: string) =>
    updPane(pane, (p) => ({ ...p, tabs: [...p.tabs, { path, pinned: false, id: tabSeq++ }], active: p.tabs.length }));

  const closeTab = (pane: number, ti: number) =>
    updPane(pane, (p) => {
      if (p.tabs.length <= 1 || p.tabs[ti]?.pinned) return p;
      const tabs = p.tabs.filter((_, i) => i !== ti);
      const active = p.active > ti ? p.active - 1 : Math.min(p.active, tabs.length - 1);
      return { ...p, tabs, active };
    });

  // ---------- 보이는 줄 ----------
  const rowsOf = (pane: number): Row[] => {
    if (!st) return [];
    const p = st.panes[pane];
    const t = activeTab(p);
    const f = filters[pane];
    const base: Row[] = t.find ? t.find.results : lists[pane].entries;
    const shown = base.filter((e) => quickMatch(f, e.name));
    // 내 PC·홈은 윈도우가 주는 차례 그대로
    if (!t.find && isSpecial(t.path)) return shown;
    return sortEntries(shown, p.sort, p.asc, types);
  };

  const selected = (pane: number): Row[] => {
    const rows = rowsOf(pane);
    const s = sels[pane];
    const picked = rows.filter((r) => s.paths.has(r.path));
    if (picked.length) return picked;
    const c = rows.find((r) => r.path === s.cursor);
    return c ? [c] : [];
  };

  const setSel = (pane: number, s: Sel) => setSels((ss) => ss.map((x, i) => (i === pane ? s : x)));

  // ---------- 동작 ----------
  const openEntry = (pane: number, e: Row, newTabIfFolder = false) => {
    if (e.dir) {
      if (newTabIfFolder) newTab(pane, e.path);
      else go(pane, e.path);
    } else void fsApi.open(e.path).catch((er) => flash(fsErrorText(er)));
  };

  const up = (pane: number) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    if (t.find || isSpecial(t.path)) return;
    const u = parentOf(t.path);
    if (u) go(pane, u, t.path);
    // 드라이브 맨 위에서 위로 = 내 PC (윈도우와 같게)
    else if (/^[A-Za-z]:\\$/.test(t.path) && !cfg.hiddenDrives.includes(PC)) go(pane, PC, t.path);
  };

  /** 같은 이름을 한 파일씩 물어요. 취소하면 null */
  const askConflicts = (list: Conflict[], op: "copy" | "move") =>
    new Promise<Record<string, string> | null>((resolve) => {
      if (!list.length) return resolve({});
      setConflict({ list, i: 0, op, resolve, dec: {} });
    });

  const pickConflict = (d: Decision, rest: boolean) => {
    if (!conflict) return;
    const dec = { ...conflict.dec };
    const from = conflict.i;
    const to = rest ? conflict.list.length : from + 1;
    for (let k = from; k < to; k++) dec[conflict.list[k].dst.path] = d;
    if (to >= conflict.list.length) {
      conflict.resolve(dec);
      setConflict(null);
    } else setConflict({ ...conflict, i: to, dec });
  };

  const transfer = async (pane: number, op: "copy" | "move", items?: Row[], destDir?: string): Promise<boolean> => {
    if (!st) return false;
    const src = items ?? selected(pane);
    if (!src.length) return false;
    const dest = destDir ?? (() => {
      const tp = st.panes[targetOf(pane)];
      const t = activeTab(tp);
      return t.find ? "" : t.path;
    })();
    if (!dest) return flash("대상 창이 찾기 결과예요. 폴더를 연 창으로 보내 주세요."), false;
    if (isSpecial(dest)) return flash("대상 창이 내 PC·즐겨찾기예요. 폴더를 연 창으로 보내 주세요."), false;
    const sources = src.map((e) => e.path);
    try {
      const list = await fsApi.conflicts(sources, dest);
      const dec = await askConflicts(list, op);
      if (!dec) return false;
      setBusy({ done: 0, total: sources.length, name: "" });
      const sum = await fsApi.transfer(op, sources, dest, dec);
      setBusy(null);
      const verb = op === "copy" ? "복사" : "옮기기";
      flash(sum.errors.length ? `${verb} ${sum.done}개 · 못 한 것 ${sum.errors.length}개 — ${fsErrorText(sum.errors[0][1])}` : `${verb} ${sum.done}개${sum.skipped ? ` · 건너뜀 ${sum.skipped}개` : ""}`);
      refreshAll();
      return !sum.errors.length;
    } catch (e) {
      setBusy(null);
      flash(fsErrorText(e));
    }
    refreshAll();
    return false;
  };

  // ---------- 클립보드(Ctrl+C·X·V) — 윈도우 클립보드와 같이 써요 ----------
  const [cut, setCut] = useState<Set<string>>(new Set());
  const clipPut = async (pane: number, isCut: boolean) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    if (!t.find && t.path === PC) return flash("드라이브는 복사할 수 없어요.");
    const items = selected(pane);
    if (!items.length) return;
    const paths = items.map((r) => r.path);
    try {
      await fsApi.clipSet(paths, isCut);
      setCut(isCut ? new Set(paths) : new Set());
      flash(`${paths.length}개 ${isCut ? "잘라냈어요" : "복사했어요"}`);
    } catch (e) {
      flash(fsErrorText(e));
    }
  };
  const clipPaste = async (pane: number) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    if (t.find || isSpecial(t.path)) return flash("폴더를 연 창에서 붙여 주세요.");
    let c: { paths: string[]; cut: boolean };
    try {
      c = await fsApi.clipGet();
    } catch (e) {
      return flash(fsErrorText(e));
    }
    if (!c.paths.length) return flash("붙여 넣을 파일이 없어요.");
    const ok = await transfer(pane, c.cut ? "move" : "copy", c.paths.map((path) => ({ path }) as Row), t.path);
    // 잘라낸 것을 다 옮겼으면 윈도우처럼 클립보드를 비워요(한 번만 붙여요).
    if (ok && c.cut) {
      setCut(new Set());
      void fsApi.clipSet([], false).catch(() => {});
    }
  };
  // 다른 프로그램에서 복사·잘라내기를 했을 수 있어 창으로 돌아올 때 흐린 표시를 맞춰요.
  useEffect(() => {
    const sync = () =>
      void fsApi
        .clipGet()
        .then((c) => setCut((old) => {
          const next = c.cut ? new Set(c.paths) : new Set<string>();
          return next.size === old.size && [...next].every((p) => old.has(p)) ? old : next;
        }))
        .catch(() => {});
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  const refreshAll = () => listsRef.current.forEach((l, i) => l.path && void load(i, l.path, true));

  const askDelete = (pane: number, permanent: boolean) => {
    const items = selected(pane);
    if (!items.length) return;
    if (!permanent && !cfg.askDelete) return void doDelete(pane, items, false);
    setDel({ items, permanent, pane });
  };

  const doDelete = async (pane: number, items: FsEntry[], permanent: boolean) => {
    setDel(null);
    try {
      await fsApi.remove(items.map((i) => i.path), permanent);
      if (st && activeTab(st.panes[pane]).find) {
        const gone = new Set(items.map((i) => i.path));
        updPane(pane, (p) => ({ ...p, tabs: p.tabs.map((t, i) => (i === p.active && t.find ? { ...t, find: { ...t.find, results: t.find.results.filter((r) => !gone.has(r.path)) } } : t)) }));
      }
      refreshAll();
    } catch (e) {
      flash(fsErrorText(e));
    }
  };

  const startRename = (pane: number) => {
    const items = selected(pane);
    if (items.length > 1) return openBatch(pane);
    const e = items[0];
    if (!e) return;
    setInline({ pane, path: e.path, value: e.name });
  };

  const commitInline = async () => {
    if (!inline) return;
    const it = inline;
    setInline(null);
    if (it.value.trim() === baseName(it.path) || !it.value.trim()) return;
    try {
      const to = await fsApi.rename(it.path, it.value.trim());
      if (st && activeTab(st.panes[it.pane]).find) {
        updPane(it.pane, (p) => ({
          ...p,
          tabs: p.tabs.map((t, i) => (i === p.active && t.find ? { ...t, find: { ...t.find, results: t.find.results.map((r) => (r.path === it.path ? { ...r, path: to, name: baseName(to) } : r)) } } : t)),
        }));
      } else {
        await load(it.pane, listsRef.current[it.pane].path, true);
      }
      setSel(it.pane, { paths: new Set([to]), cursor: to, anchor: to });
    } catch (e) {
      flash(fsErrorText(e));
    }
  };

  const newFolder = async (pane: number) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    if (t.find || isSpecial(t.path)) return;
    const taken = new Set(lists[pane].entries.map((e) => e.name.toLowerCase()));
    const name = taken.has("새 폴더") ? bothName("새 폴더", (n) => taken.has(n.toLowerCase())) : "새 폴더";
    try {
      const p = await fsApi.mkdir(t.path, name);
      await load(pane, t.path, true);
      setSel(pane, { paths: new Set([p]), cursor: p, anchor: p });
      setInline({ pane, path: p, value: name });
    } catch (e) {
      flash(fsErrorText(e));
    }
  };

  const openBatch = async (pane: number) => {
    if (!st) return;
    let items = selected(pane);
    if (!items.length) items = rowsOf(pane).filter((r) => !r.dir);
    if (!items.length) return;
    const t = activeTab(st.panes[pane]);
    let rows = items.map((e) => {
      const parent = parentOf(e.path) ?? "";
      return { ...e, parentName: baseName(parent), folder: parent };
    });
    if (st.rename.sub) {
      // 하위 폴더 포함: 고른 폴더 안의 파일까지
      const more: typeof rows = [];
      for (const r of rows.filter((x) => x.dir)) {
        const found = await fsApi.find({ name: "", text: "", roots: [r.path], sub: true, from: 0, to: 0, minSize: 0, maxSize: 0, lockedOnly: false, complaintsOnly: false, showHidden: cfg.showHidden });
        for (const f of found) {
          const parent = parentOf(f.path) ?? "";
          more.push({ ...f, parentName: baseName(parent), folder: parent });
        }
      }
      rows = [...rows, ...more];
    }
    setRenameRows({ pane, rows, where: t.find ? `찾기: ${t.find.form.name || t.find.form.text}` : t.path });
  };

  const doBatch = async (items: { path: string; name: string }[], close: boolean): Promise<string | null> => {
    try {
      const back = await fsApi.renameMany(items);
      setUndo(back);
      refreshAll();
      if (renameRows) {
        const moved = new Map(back.map((b) => [joinPath(parentOf(b.path) ?? "", b.name), b.path]));
        setRenameRows({ ...renameRows, rows: renameRows.rows.map((r) => (moved.has(r.path) ? { ...r, path: moved.get(r.path)!, name: baseName(moved.get(r.path)!) } : r)) });
      }
      if (close) setRenameRows(null);
      return `${back.length}개 이름을 바꿨어요`;
    } catch (e) {
      return fsErrorText(e);
    }
  };

  const undoBatch = async () => {
    if (!undo) return;
    try {
      const back = await fsApi.renameMany(undo);
      if (renameRows) {
        const moved = new Map(back.map((b) => [joinPath(parentOf(b.path) ?? "", b.name), b.path]));
        setRenameRows({ ...renameRows, rows: renameRows.rows.map((r) => (moved.has(r.path) ? { ...r, path: moved.get(r.path)!, name: baseName(moved.get(r.path)!) } : r)) });
      }
      setUndo(null);
      refreshAll();
    } catch (e) {
      flash(fsErrorText(e));
    }
  };

  const copyPath = (pane: number) => {
    if (!st) return;
    const s = selected(pane);
    const t = activeTab(st.panes[pane]);
    const text = s.length ? s.map((e) => e.path).join("\r\n") : t.find ? "" : t.path;
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => flash("경로를 복사했어요"), () => flash("복사하지 못했어요"));
  };

  // 보안 해제: 회사 보안 프로그램(소프트캠프) 메뉴는 윈도우 탐색기에서만 나와요. 윈도우 탐색기를 고른 파일을 골라 둔 채
  // 새로 열고 그 파일의 우클릭 메뉴를 띄워요(2026-10-18 사용자 1안, 시안 FilesDrm). 여러 폴더면 첫 파일의 폴더만.
  const revealRows = async (rs: Row[]) => {
    if (!rs.length) return;
    const dir = parentOf(rs[0].path);
    if (!dir) return;
    const names = rs.filter((r) => parentOf(r.path) === dir).map((r) => r.name);
    try {
      await fsApi.reveal(dir, names);
    } catch {
      flash("윈도우 탐색기를 열지 못했어요");
    }
  };

  const shellMenu = async (pane: number, e: React.MouseEvent | null, rowsForMenu: Row[]) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    let dir = t.find ? "" : t.path;
    let names = rowsForMenu.map((r) => r.name);
    if (rowsForMenu.length) {
      // 윈도우 메뉴는 한 폴더 것만 받아요(찾기 결과에서 여러 폴더를 골랐으면 누른 줄만).
      const parents = new Set(rowsForMenu.map((r) => parentOf(r.path)));
      const first = rowsForMenu[0];
      if (parents.size > 1) names = [first.name];
      dir = parentOf(first.path) ?? dir;
    }
    if (!dir || isSpecial(dir)) return;
    try {
      const r: MenuResult = await fsApi.contextMenu(dir, names, e ? e.clientX : -1, e ? e.clientY : -1);
      if (r === "rename") startRename(pane);
      else if (r === "reveal") void revealRows(rowsForMenu);
      else if (r === "done") window.setTimeout(refreshAll, 300);
    } catch (er) {
      if (String(er) === "windows_only") flash("우클릭 메뉴는 윈도우에서 떠요(미리 보기에서는 안 돼요)");
      else flash("윈도우 메뉴를 띄우지 못했어요");
    }
  };

  // ---------- 찾기 ----------
  const runFind = async (f: FindForm, flat = false, live = false) => {
    if (!st) return;
    const pane = st.active;
    const cur = activeTab(st.panes[pane]);
    // 어디서가 비면: 빠른 찾기가 있으면 모든 드라이브, 없으면 지금 창 폴더
    const all = !flat && !f.where.trim() && fastReady;
    const where = all ? "" : cleanPath(f.where || (cur.find ? cur.find.form.where : cur.path));
    const day = (s: string, end: boolean) => {
      const d = parseDate(s);
      if (!d) return 0;
      const t = new Date(d + (end ? "T23:59:59.999" : "T00:00:00")).getTime();
      return t;
    };
    const ff = { ...f, where };
    const label = ff.name || (ff.text ? `"${ff.text}"` : "*");
    // 치는 대로 찾기는 지금 탭이 그 탭이면 다시 써요(글자마다 탭이 늘지 않게)
    const reuse = live && cur.find?.live ? cur.id : null;
    const id = reuse ?? tabSeq++;
    const run: FindRun = { form: ff, results: reuse != null ? cur.find!.results : [], running: true, flat, live, all };
    if (reuse != null) updPane(pane, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === id ? { ...t, find: run } : t)) }));
    else updPane(pane, (p) => ({ ...p, tabs: [...p.tabs, { path: where, pinned: false, id, find: run }], active: p.tabs.length }));
    if (!live) setFindOpen(false);
    setSel(pane, EMPTY_SEL);
    const t0 = performance.now();
    findSeq.current += 1;
    const seq = findSeq.current;
    try {
      const results = await fsApi.find({
        name: ff.name,
        text: ff.text,
        roots: all ? [] : [where],
        sub: ff.sub,
        from: day(ff.from, false),
        to: day(ff.to, true),
        minSize: parseSize(ff.minSize),
        maxSize: parseSize(ff.maxSize),
        lockedOnly: ff.lockedOnly,
        complaintsOnly: ff.complaintsOnly,
        showHidden: cfg.showHidden,
      });
      if (live && seq !== findSeq.current) return; // 더 새 글자로 찾는 중
      const ms = Math.round(performance.now() - t0);
      updPane(pane, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === id ? { ...t, find: { ...run, results, running: false, ms } } : t)) }));
    } catch (e) {
      updPane(pane, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === id ? { ...t, find: { ...run, results: [], running: false } } : t)) }));
      flash(fsErrorText(e));
    }
    void label;
  };

  const findSeq = useRef(0);
  // 빠른 찾기 칸: 도우미가 있으면 치는 대로(0.15초 쉬면) 모든 드라이브에서 찾아요.
  useEffect(() => {
    if (!fastReady) return;
    const q = quickFind.trim();
    if (!q) return;
    const t = window.setTimeout(() => void runFind({ ...EMPTY_FIND, name: q, sub: true }, false, true), 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickFind, fastReady]);

  const rerunFind = async (pane: number) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    if (!t.find) return;
    const form = t.find.form;
    const flat = !!t.find.flat;
    closeTab(pane, st.panes[pane].active);
    await runFind(form, flat);
  };

  const fixDate = (k: "from" | "to") => {
    const v = form[k];
    if (!v.trim()) return setFormBad((b) => ({ ...b, [k]: false }));
    const d = parseDate(v);
    if (d) {
      setForm((f) => ({ ...f, [k]: d }));
      setFormBad((b) => ({ ...b, [k]: false }));
    } else setFormBad((b) => ({ ...b, [k]: true }));
  };

  // ---------- 키 ----------
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (!st || conflict || del || renameRows || nameAsk) return;
    if (e.ctrlKey && !e.shiftKey && e.code === "KeyF") {
      e.preventDefault();
      quickRef.current?.focus();
      return;
    }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === "KeyR") {
      e.preventDefault();
      refresh();
      return;
    }
    if (typing(e.target)) return;
    const pane = st.active;
    const rows = rowsOf(pane);
    const s = sels[pane];
    const idx = Math.max(-1, rows.findIndex((r) => r.path === s.cursor));
    const moveTo = (i: number, extend: boolean) => {
      if (!rows.length) return;
      const n = Math.max(0, Math.min(rows.length - 1, i));
      const r = rows[n];
      if (extend) {
        const a = rows.findIndex((x) => x.path === (s.anchor ?? s.cursor ?? r.path));
        const [lo, hi] = a <= n ? [a, n] : [n, a];
        setSel(pane, { paths: new Set(rows.slice(Math.max(0, lo), hi + 1).map((x) => x.path)), cursor: r.path, anchor: s.anchor ?? s.cursor ?? r.path });
      } else setSel(pane, { paths: new Set(), cursor: r.path, anchor: r.path });
      document.getElementById(`fx-row-${pane}-${n}`)?.scrollIntoView({ block: "nearest" });
    };
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const handled = () => e.preventDefault();
    if (k === "F2") return handled(), startRename(pane);
    if (k === "F3" || (k === "Enter" && !ctrl && !e.altKey)) {
      const r = rows[idx];
      if (r) openEntry(pane, r);
      return handled();
    }
    if (k === "Enter" && ctrl) {
      const r = rows[idx];
      if (r) {
        if (activeTab(st.panes[pane]).find) newTab(pane, parentOf(r.path) ?? r.path);
        else if (r.dir) newTab(pane, r.path);
      }
      return handled();
    }
    if (k === "F5") return handled(), void transfer(pane, "copy");
    if (k === "F6") return handled(), void transfer(pane, "move");
    if (k === "F7") return handled(), void newFolder(pane);
    if (k === "F8" || k === "Delete") return handled(), askDelete(pane, e.shiftKey);
    if (k === "Backspace") return handled(), up(pane);
    if (e.altKey && (k === "ArrowLeft" || k === "ArrowRight")) return handled(), stepHistory(pane, k === "ArrowLeft" ? -1 : 1);
    if (k === "Tab" && !ctrl) {
      handled();
      return focusPane(e.shiftKey ? (st.four ? CLOCKWISE[(CLOCKWISE.indexOf(pane) + 3) % 4] : pane === 0 ? 1 : 0) : nextPane(pane, st.four));
    }
    if (ctrl && /^Digit[1-4]$/.test(e.code) && !e.shiftKey) {
      const n = Number(e.code.slice(5)) - 1;
      if (n < paneCount) focusPane(n);
      return handled();
    }
    if (ctrl && e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
      const v = VIEWS[Number(e.code.slice(5)) - 1].id;
      updPane(pane, (p) => ({ ...p, view: v }));
      return handled();
    }
    if (ctrl && e.shiftKey && e.code === "KeyC") return handled(), copyPath(pane);
    if (ctrl && !e.shiftKey && !e.altKey && (e.code === "KeyC" || e.code === "KeyX")) return handled(), void clipPut(pane, e.code === "KeyX");
    if (ctrl && !e.shiftKey && !e.altKey && e.code === "KeyV") return handled(), void clipPaste(pane);
    if (ctrl && !e.shiftKey && e.code === "KeyE") {
      const t = activeTab(st.panes[pane]);
      const r = rows[idx];
      if (r) void fsApi.explorer(r.path, true);
      else if (!t.find) void fsApi.explorer(t.path === PC ? "shell:MyComputerFolder" : t.path === HOME ? "shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}" : t.path, false);
      return handled();
    }
    if (ctrl && e.code === "KeyR") return handled(), refreshAll();
    if (ctrl && e.code === "KeyT") return handled(), newTab(pane, activeTab(st.panes[pane]).find ? home : activeTab(st.panes[pane]).path);
    if (ctrl && e.code === "KeyW") return handled(), closeTab(pane, st.panes[pane].active);
    if (ctrl && e.code === "KeyA") return handled(), setSel(pane, { paths: new Set(rows.map((r) => r.path)), cursor: s.cursor, anchor: s.anchor });
    if (k === " ") {
      handled();
      const at = idx < 0 ? 0 : idx;
      const r = rows[at];
      if (!r) return;
      const ps = new Set(s.paths);
      if (ps.has(r.path)) ps.delete(r.path);
      else ps.add(r.path);
      const nxt = rows[Math.min(rows.length - 1, at + 1)];
      setSel(pane, { paths: ps, cursor: nxt.path, anchor: nxt.path });
      document.getElementById(`fx-row-${pane}-${Math.min(rows.length - 1, at + 1)}`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (k === "ArrowDown") return handled(), moveTo(idx + 1, e.shiftKey);
    if (k === "ArrowUp") return handled(), moveTo(idx < 0 ? 0 : idx - 1, e.shiftKey);
    if (k === "Home") return handled(), moveTo(0, e.shiftKey);
    if (k === "End") return handled(), moveTo(rows.length - 1, e.shiftKey);
    if (k === "PageDown") return handled(), moveTo(idx + 15, e.shiftKey);
    if (k === "PageUp") return handled(), moveTo(idx - 15, e.shiftKey);
    if (k === "Escape") {
      if (menu) return handled(), setMenu(null);
      if (filters[pane]) return handled(), setFilters((f) => f.map((x, i) => (i === pane ? "" : x)));
      return setSel(pane, EMPTY_SEL);
    }
    if (k === "ContextMenu" || (k === "F10" && e.shiftKey)) {
      handled();
      const row = document.getElementById(`fx-row-${pane}-${idx}`);
      const rr = row?.getBoundingClientRect();
      void shellMenu(pane, rr ? ({ clientX: rr.left + 40, clientY: rr.bottom } as React.MouseEvent) : null, selected(pane));
      return;
    }
    // 글자를 치면 빠른 필터로(한글 조합은 필터 칸에서)
    if (k.length === 1 && !ctrl && !e.altKey && /\S/.test(k)) {
      const el = filterRefs.current[pane];
      if (el) {
        el.focus();
      }
    }
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // 바깥을 누르면 작은 메뉴가 닫혀요.
  useEffect(() => {
    if (!menu && !findOpen) return;
    const f = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".fx-menu, .fx-menu-btn")) {
        setMenu(null);
        if (!t.closest(".fx-findbox")) setFindOpen(false);
      }
    };
    window.addEventListener("mousedown", f);
    return () => window.removeEventListener("mousedown", f);
  }, [menu, findOpen]);

  // ---------- 트리 ----------
  const loadTree = useCallback(
    async (path: string) => {
      if (tree.has(path) || isSpecial(path)) return;
      try {
        const kids = await fsApi.subdirs(path, cfg.showHidden);
        setTree((t) => new Map(t).set(path, kids));
      } catch {
        setTree((t) => new Map(t).set(path, []));
      }
    },
    [tree, cfg.showHidden],
  );
  const visibleDrives = drives.filter((d) => !cfg.hiddenDrives.includes(d.name));
  const treeHidden = cfg.treeHidden ?? cfg.hiddenDrives;
  const treeDrives = drives.filter((d) => !treeHidden.includes(d.name));
  const curPath = st ? (activeTab(st.panes[st.active]).find ? "" : activeTab(st.panes[st.active]).path) : "";

  // ---------- 머리 줄 단추 (2026-10-19 확정) ----------
  /** 새로고침: 보이는 창을 모두 다시 읽어요(펼쳐보기·찾기 결과는 다시 찾기) */
  const refresh = () => {
    if (!st) return;
    refreshAll();
    for (let i = 0; i < (st.four ? 4 : 2); i++) if (activeTab(st.panes[i]).find) void rerunFind(i);
  };
  // 다른 프로그램에서 기록 창으로 돌아오면 보고 있던 폴더를 다시 읽어요(다운로드 등 윈도우가 바뀜을 빠뜨릴 때)
  const refreshAllRef = useRef(refreshAll);
  refreshAllRef.current = refreshAll;
  useEffect(() => {
    let last = 0;
    const f = () => {
      const now = Date.now();
      if (now - last < 1500) return;
      last = now;
      refreshAllRef.current();
    };
    window.addEventListener("focus", f);
    return () => window.removeEventListener("focus", f);
  }, []);
  /** 배치복구: 폴더트리 폭·창 사이 크기를 처음대로 */
  const resetLayout = () => st && setSt({ ...st, split: 0.5, splitV: 0.5, tree: { ...st.tree, width: TREE_W.start } });
  /** 숨긴파일: 설정 "숨김 파일 보이기"와 같은 값 */
  const toggleHidden = async () => {
    const next = { ...cfg, showHidden: !cfg.showHidden };
    setCfg(next);
    try {
      const s = await loadSettings();
      await saveSettings({ ...s, files: { ...s.files, showHidden: next.showHidden } });
    } catch {
      /* 저장 못 해도 이번에는 보여요 */
    }
  };
  /** 펼쳐보기: 지금 폴더 아래 모든 파일을 한 목록으로(다시 누르면 닫기) */
  const flatOn = !!(st && activeTab(st.panes[st.active]).find?.flat);
  const toggleFlat = () => {
    if (!st) return;
    const pane = st.active;
    const t = activeTab(st.panes[pane]);
    if (t.find?.flat) return closeTab(pane, st.panes[pane].active);
    if (t.find || isSpecial(t.path)) return flash("폴더를 연 창에서 눌러 주세요");
    void runFind({ ...EMPTY_FIND, name: "", where: t.path, sub: true }, true);
  };
  /** 같은폴더: 대상 창을 지금 창과 같은 폴더로 */
  const sameFolder = () => {
    if (!st) return;
    const t = activeTab(st.panes[st.active]);
    const path = t.find ? t.find.form.where : t.path;
    if (path) go(targetOf(st.active), path);
  };
  /** 창바꾸기: 지금 창과 대상 창의 탭을 서로 바꿔요 */
  const swapPanes = () => {
    if (!st) return;
    const a = st.active;
    const b = targetOf(a);
    const panes = [...st.panes];
    [panes[a], panes[b]] = [panes[b], panes[a]];
    setSt({ ...st, panes });
    setSel(a, EMPTY_SEL);
    setSel(b, EMPTY_SEL);
  };

  // 트리는 활성 창을 따라가요: 지금 폴더까지 위 폴더들을 펼쳐요.
  useEffect(() => {
    if (!st || !curPath || !st.tree.on) return;
    const chain: string[] = [];
    let p: string | null = curPath;
    while (p) {
      chain.unshift(p);
      p = parentOf(p);
    }
    const ups = chain.slice(0, -1);
    ups.forEach((c) => void loadTree(c));
    if (ups.some((c) => !st.tree.open.includes(c))) setSt({ ...st, tree: { ...st.tree, open: [...new Set([...st.tree.open, ...ups])] } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curPath, st?.tree.on]);
  useEffect(() => {
    if (!st?.tree.on) return;
    treeDrives.forEach((d) => st.tree.open.includes(d.path) && void loadTree(d.path));
    st.tree.open.forEach((p) => void loadTree(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.tree.on, drives]);

  const toggleOpen = (path: string) => {
    if (!st) return;
    const open = st.tree.open.includes(path) ? st.tree.open.filter((p) => p !== path && !p.startsWith(path)) : [...st.tree.open, path];
    setSt({ ...st, tree: { ...st.tree, open } });
    void loadTree(path);
  };

  /** 트리 줄: 윈도우 탐색기처럼 한 번 누르면 그 폴더로, 두 번 누르면 펼치기·접기(2026-10-19 사용자) */
  const toggleTreeRow = (r: { path: string; hasKids: boolean; special?: "home" | "pc" }) => {
    if (r.special === "home") toggleGroup(HOME);
    else if (r.special === "pc") toggleGroup(PC_FOLD);
    else if (r.hasKids) toggleOpen(r.path);
  };

  // 트리 맨 위 묶음: 즐겨찾기(★로 지정한 폴더, 처음 접힘 — 예전 "홈" 자리, 2026-10-19 사용자)·내 PC(드라이브, 처음 펼침) — 접기는 tree.open에 HOME·"::pc:fold"
  const showHome = !treeHidden.includes(HOME);
  const showPc = !treeHidden.includes(PC);
  const homeOpen = !!st?.tree.open.includes(HOME);
  const pcFolded = !!st?.tree.open.includes(PC_FOLD);
  const toggleGroup = (key: string) => {
    if (!st) return;
    const open = st.tree.open.includes(key) ? st.tree.open.filter((p) => p !== key) : [...st.tree.open, key];
    setSt({ ...st, tree: { ...st.tree, open } });
  };

  type TreeRow = { name: string; path: string; level: number; hasKids: boolean; drive: boolean; first: boolean; special?: "home" | "pc"; key: string };
  const treeRows: TreeRow[] = useMemo(() => {
    if (!st) return [];
    const out: TreeRow[] = [];
    const walk = (path: string, level: number, pre: string) => {
      for (const k of tree.get(path) ?? []) {
        out.push({ name: k.name, path: k.path, level, hasKids: k.hasChildren, drive: false, first: false, key: pre + k.path });
        if (st.tree.open.includes(k.path)) walk(k.path, level + 1, pre);
      }
    };
    if (showHome) {
      out.push({ name: "즐겨찾기", path: HOME, level: 0, hasKids: st.favorites.length > 0, drive: false, first: true, special: "home", key: HOME });
      if (homeOpen)
        st.favorites.forEach((f) => {
          const d = { name: baseName(f) || f, path: f };
          out.push({ name: d.name, path: d.path, level: 1, hasKids: true, drive: false, first: false, key: "h:" + d.path });
          if (st.tree.open.includes(d.path)) walk(d.path, 2, "h:");
        });
    }
    if (showPc) out.push({ name: "내 PC", path: PC, level: 0, hasKids: true, drive: false, first: !showHome, special: "pc", key: PC });
    if (!showPc || !pcFolded)
      treeDrives.forEach((d, i) => {
        out.push({ name: d.name, path: d.path, level: 0, hasKids: true, drive: true, first: i === 0 && (showPc || !showHome), key: d.path });
        if (st.tree.open.includes(d.path)) walk(d.path, 1, "");
      });
    return out;
  }, [st, tree, treeDrives, showHome, showPc, homeOpen, pcFolded]);

  // 지금 경로의 위 폴더들(굵게·연보라 안내선)
  const onPath = useMemo(() => {
    const set = new Set<string>();
    let p: string | null = curPath ? parentOf(curPath) : null;
    while (p) {
      set.add(p.toLowerCase());
      p = parentOf(p);
    }
    return set;
  }, [curPath]);

  // 트리 폭 끌기
  const dragW = useRef<{ x: number; w: number } | null>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  /** 머리 줄 단추(2026-10-19 사용자 1안): 기준 크기(1600×900)에 맞춘 90px 고정 — 넓어져도 늘리지 않고 남는 폭은 오른쪽 빈 곳.
      90px 단추가 다 안 들어가면 글자를 빼고 34×34 정사각형(고정)으로, 앞에서부터 차례로. 마우스를 올리면 이름이 떠요. */
  const toolsRef = useRef<HTMLDivElement>(null);
  const TOOL_W = 90;
  const TOOL_SQ = 34;
  const [toolFit, setToolFit] = useState({ w: 90, compact: false });
  useEffect(() => {
    const el = toolsRef.current;
    if (!el) return;
    const fit = () => {
      const kids = [...el.children] as HTMLElement[];
      const btns = kids.filter((k) => k.classList.contains("fx-tool"));
      const other = kids.filter((k) => !k.classList.contains("fx-tool")).reduce((n, k) => n + k.offsetWidth + 4, 0); // 구분선 1 + 좌우 2
      const free = el.clientWidth - other - 8 * (kids.length - 1) - 1; // 마지막 단추 오른쪽 1px 착시 보정
      const compact = free < TOOL_W * btns.length;
      const w = compact ? TOOL_SQ : TOOL_W;
      setToolFit((o) => (o.compact === compact ? o : { w, compact }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!st]);

  // ---------- 끌어다 놓기(창 사이, 윈도우 탐색기에서) ----------
  const dragSrc = useRef<{ pane: number; rows: Row[] } | null>(null);
  const dropTo = (pane: number, e: React.DragEvent, dir?: string) => {
    e.preventDefault();
    const src = dragSrc.current;
    dragSrc.current = null;
    if (!st || !src) return;
    const t = activeTab(st.panes[pane]);
    const dest = dir ?? (t.find ? "" : t.path);
    if (!dest || isSpecial(dest)) return;
    if (src.rows.some((r) => r.path === dest || parentOf(r.path) === dest) && !dir) return;
    const same = driveOf(src.rows[0].path) === driveOf(dest);
    const op = e.ctrlKey ? "copy" : e.shiftKey ? "move" : same ? "move" : "copy";
    void transfer(src.pane, op, src.rows, dest);
  };

  // ---------- 윈도우(탐색기·바탕 화면)에서 끌어온 파일 놓기 (2026-10-20 사용자) ----------
  // 앱 틀이 끌어다 놓기를 먼저 받아 파일 위치(paths)와 마우스 자리를 알려 줘요. 놓은 자리가 폴더 줄·트리 줄이면 그 폴더,
  // 아니면 그 창이 연 폴더로. 같은 드라이브면 옮기기·다른 드라이브면 복사(윈도우 탐색기와 같게).
  const [extHover, setExtHover] = useState<{ pane: number | null; dir: string | null } | null>(null);
  const extRef = useRef<{ paths: string[] }>({ paths: [] });
  const dropAtRef = useRef<(paths: string[], x: number, y: number) => void>(() => {});
  const hitAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return { pane: null, dir: null };
    const tree = el.closest<HTMLElement>("[data-tree-dir]");
    if (tree) return { pane: null, dir: tree.dataset.treeDir || null };
    const paneEl = el.closest<HTMLElement>("[data-pane]");
    const pane = paneEl ? Number(paneEl.dataset.pane) : null;
    const row = el.closest<HTMLElement>("[data-dir]");
    return { pane, dir: row?.dataset.dir || null };
  };
  dropAtRef.current = (paths: string[], x: number, y: number) => {
    if (!st || !paths.length) return;
    const hit = hitAt(x, y);
    let dest = hit.dir;
    const pane = hit.pane ?? st.active;
    if (!dest) {
      if (hit.pane === null) return;
      const t = activeTab(st.panes[hit.pane]);
      if (t.find) return flash("찾기 결과에는 놓을 수 없어요. 폴더를 연 창에 놓아 주세요.");
      dest = t.path;
    }
    if (!dest || isSpecial(dest)) return flash("폴더를 연 창에 놓아 주세요.");
    const srcs = paths.filter((p) => p !== dest);
    if (!srcs.length || srcs.every((p) => parentOf(p) === dest)) return;
    const op = driveOf(srcs[0]) === driveOf(dest) ? "move" : "copy";
    void transfer(pane, op, srcs.map((path) => ({ path }) as Row), dest);
  };
  useEffect(() => {
    // 브라우저 미리 보기 시험용: window.__fxExtDrop(경로들, x, y)
    if (!inApp) (window as unknown as { __fxExtDrop?: unknown }).__fxExtDrop = (paths: string[], x: number, y: number) => dropAtRef.current(paths, x, y);
    if (!inApp) return;
    let off: (() => void) | undefined;
    let dead = false;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((ev) => {
          const d = ev.payload;
          const r = window.devicePixelRatio || 1;
          if (d.type === "enter") extRef.current.paths = d.paths;
          if (d.type === "enter" || d.type === "over") {
            const h = hitAt(d.position.x / r, d.position.y / r);
            setExtHover((o) => (o && o.pane === h.pane && o.dir === h.dir ? o : h));
          } else if (d.type === "drop") {
            setExtHover(null);
            dropAtRef.current(d.paths, d.position.x / r, d.position.y / r);
          } else setExtHover(null);
        })
        .then((u) => (dead ? u() : (off = u))),
    );
    return () => {
      dead = true;
      off?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!st) return <div className="fx-root" />;

  const fmt = cfg.dateFmt;
  // 날짜 형식이 길어지면(초까지 등) 수정한 날 열이 그 글자보다 좁아지지 않게 해요.
  const dateMin = dateColMin(fmt);

  // ---------- 그리기 ----------
  const renderPane = (pane: number) => {
    const p = st.panes[pane];
    const t = activeTab(p);
    const on = st.active === pane;
    const isTarget = paneCount > 1 && targetOf(st.active) === pane && !on;
    const listing = lists[pane];
    const rows = rowsOf(pane);
    const s = sels[pane];
    const sel = rows.filter((r) => s.paths.has(r.path));
    const crumbs = t.find ? [] : crumbsOf(t.path);
    const curDrive = t.find ? "" : driveOf(t.path);
    const files = rows.filter((r) => !r.dir);
    const dirs = rows.filter((r) => r.dir);
    const total = files.reduce((a, b) => a + b.size, 0);
    const pick = (r: Row, e: React.MouseEvent) => {
      focusPane(pane);
      if (e.shiftKey) {
        const a = rows.findIndex((x) => x.path === (s.anchor ?? s.cursor ?? r.path));
        const b = rows.indexOf(r);
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSel(pane, { paths: new Set(rows.slice(Math.max(0, lo), hi + 1).map((x) => x.path)), cursor: r.path, anchor: s.anchor ?? r.path });
      } else if (e.ctrlKey || e.metaKey) {
        const ps = new Set(s.paths);
        if (s.cursor && !ps.size) ps.add(s.cursor);
        if (ps.has(r.path)) ps.delete(r.path);
        else ps.add(r.path);
        setSel(pane, { paths: ps, cursor: r.path, anchor: r.path });
      } else setSel(pane, { paths: new Set([r.path]), cursor: r.path, anchor: r.path });
    };
    const rowCtx = (r: Row, e: React.MouseEvent) => {
      e.preventDefault();
      focusPane(pane);
      let items = rows.filter((x) => s.paths.has(x.path));
      if (!items.some((x) => x.path === r.path)) {
        items = [r];
        setSel(pane, { paths: new Set([r.path]), cursor: r.path, anchor: r.path });
      }
      void shellMenu(pane, e, items);
    };
    const sortBy = (k: SortKey) => updPane(pane, (x) => ({ ...x, sort: k, asc: x.sort === k ? !x.asc : true }));
    const arrow = (k: SortKey) => (p.sort === k ? (p.asc ? " ▴" : " ▾") : "");
    const nameCell = (r: Row) =>
      inline && inline.pane === pane && inline.path === r.path ? (
        <input
          className="input fx-inline"
          autoFocus
          value={inline.value}
          onChange={(e) => setInline({ ...inline, value: e.target.value })}
          onFocus={(e) => {
            const dot = r.dir ? -1 : inline.value.lastIndexOf(".");
            e.currentTarget.setSelectionRange(0, dot > 0 ? dot : inline.value.length);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void commitInline();
            if (e.key === "Escape") setInline(null);
          }}
          onBlur={() => void commitInline()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="fx-nm" title={r.name}>
          {r.name}
        </span>
      );
    // 보일 열: 이름은 늘, 크기·수정한 날·파일 형식은 설정에서 켜고 꺼요(2026-10-18 사용자). 찾기 결과는 폴더 열이 이름 다음에.
    const shown = (["size", "modified", "type"] as const).filter((k) => cfg.cols[k]);
    const colStyle = { gridTemplateColumns: ["32px", "minmax(0,1fr)", ...(t.find ? [`${st.cols.folder}px`] : []), ...shown.map((k) => `${k === "modified" ? Math.max(st.cols[k], dateMin) : st.cols[k]}px`)].join(" ") };
    const resizer = (k: "size" | "modified" | "folder" | "type") => (
      <span
        className="fx-col-grip"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const x0 = e.clientX;
          const w0 = st.cols[k];
          const el = e.currentTarget;
          el.setPointerCapture(e.pointerId);
          const move = (ev: PointerEvent) => setSt((S) => (S ? { ...S, cols: { ...S.cols, [k]: Math.max(56, Math.min(400, w0 - (ev.clientX - x0))) } } : S));
          const upf = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", upf);
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", upf);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          // 글꼴로 재서 가장 긴 값에 맞춰요.
          const c = document.createElement("canvas").getContext("2d");
          if (!c) return;
          c.font = `${getComputedStyle(document.body).fontSize} Pretendard, sans-serif`;
          const vals = rows.map((r) => (k === "size" ? (r.dir ? "" : formatSize(r.size)) : k === "modified" ? formatDate(r.modified, fmt) : k === "type" ? typeName(r, types) : r.folder ?? ""));
          const w = Math.ceil(Math.max(40, ...vals.map((v) => c.measureText(v).width))) + 20 + (k === "modified" && fmt.includes(" ") ? DATE_TIME_GAP : 0);
          setSt((S) => (S ? { ...S, cols: { ...S.cols, [k]: Math.min(400, w) } } : S));
        }}
      />
    );
    const viewName = VIEWS.find((v) => v.id === p.view)?.name ?? "자세히";
    const fav = !t.find && st.favorites.includes(t.path);
    return (
      <section
        key={pane}
        className="fx-pane"
        data-pane={pane}
        data-extdrop={extHover && extHover.pane === pane && !extHover.dir ? "1" : "0"}
        data-on={on ? "1" : "0"}
        data-target={isTarget && st.four ? "1" : "0"}
        data-rest={!on && !isTarget ? "1" : "0"}
        aria-label={`창 ${pane + 1}`}
        onMouseDown={(e) => {
          focusPane(pane);
          // 마우스 옆 단추(뒤로 3·앞으로 4): 화면이 통째로 뒤로 가지 않게 막고 이 창의 폴더만 움직여요.
          if (e.button === 3 || e.button === 4) e.preventDefault();
        }}
        onMouseUp={(e) => {
          if (e.button === 3 || e.button === 4) {
            e.preventDefault();
            stepHistory(pane, e.button === 3 ? -1 : 1);
          }
        }}
        onDragOver={(e) => dragSrc.current && e.preventDefault()}
        onDrop={(e) => dropTo(pane, e)}
      >
        <div className="fx-tabs">
          {p.tabs.map((tab, ti) => (
            <button
              key={tab.id}
              type="button"
              className="fx-tab"
              data-on={ti === p.active ? "1" : "0"}
              title={tab.find ? `찾기: ${findSummary(tab.find.form)}` : tab.path}
              onClick={() => updPane(pane, (x) => ({ ...x, active: ti }))}
              onAuxClick={(e) => e.button === 1 && closeTab(pane, ti)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ kind: "tab", pane, tab: ti, x: e.clientX, y: e.clientY });
              }}
            >
              {tab.pinned && (
                <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="fx-pin">
                  <path d="M12 17v5M5 17h14l-2-5V5h1V2H6v3h1v7z" />
                </svg>
              )}
              <span className="fx-tn">{tab.find ? (tab.find.flat ? `펼쳐보기: ${baseName(tab.find.form.where) || tab.find.form.where}` : `찾기: ${tab.find.form.name || (tab.find.form.text ? `"${tab.find.form.text}"` : "*")}`) : baseName(tab.path)}</span>
              {ti === p.active && !tab.pinned && p.tabs.length > 1 && (
                <span
                  className="fx-tx"
                  role="button"
                  aria-label="탭 닫기"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(pane, ti);
                  }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button type="button" className="fx-tab fx-tab-add" title="새 탭 (Ctrl+T)" onClick={() => newTab(pane, t.find ? home : t.path)}>
            ＋
          </button>
        </div>
        <div className="fx-row1">
          {/* 드라이브 줄: [내 PC] C: D: F: [홈] — 모두 같은 정사각형(2026-10-18 사용자, 시안 FilesDrives) */}
          {!cfg.hiddenDrives.includes(PC) && (
            <button type="button" className="fx-drv" data-on={t.path === PC ? "1" : "0"} title="내 PC" aria-label="내 PC" onClick={() => go(pane, PC)}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4h18v12H3zM8 20h8M12 16v4" />
              </svg>
            </button>
          )}
          {visibleDrives.map((d) => (
            <button
              key={d.name}
              type="button"
              className="fx-drv"
              data-on={!isSpecial(t.path) && (curDrive === d.name || (d.name.length > 2 && t.path === d.path)) ? "1" : "0"}
              title={`${d.name} ${d.label}${d.total ? ` · 남은 ${formatSize(d.free)}` : ""}`}
              onClick={() => go(pane, d.path)}
            >

              {d.name}
            </button>
          ))}
          {!cfg.hiddenDrives.includes(HOME) && (
            <button type="button" className="fx-drv" data-on={t.path === HOME ? "1" : "0"} title="즐겨찾기" aria-label="즐겨찾기" onClick={() => go(pane, HOME)}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
              </svg>
            </button>
          )}
          <input
            ref={(el) => {
              filterRefs.current[pane] = el;
            }}
            className="input fx-filter"
            aria-label="빠른 필터"
            placeholder="빠른 필터"
            value={filters[pane]}
            onChange={(e) => setFilters((f) => f.map((x, i) => (i === pane ? e.target.value : x)))}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilters((f) => f.map((x, i) => (i === pane ? "" : x)));
                e.currentTarget.blur();
              }
              if (e.key === "Enter" || e.key === "ArrowDown") {
                e.currentTarget.blur();
                const first = rowsOf(pane)[0];
                if (first) setSel(pane, { paths: new Set(), cursor: first.path, anchor: first.path });
              }
            }}
          />
          <div className="fx-rel">
            <button type="button" className="fx-vb fx-menu-btn" onClick={() => setMenu(menu?.kind === "view" && menu.pane === pane ? null : { kind: "view", pane })}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {viewName} ▾
            </button>
            {menu?.kind === "view" && menu.pane === pane && (
              <div className="fx-menu fx-menu-r" role="menu">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="fx-mi"
                    data-on={p.view === v.id ? "1" : "0"}
                    onClick={() => {
                      updPane(pane, (x) => ({ ...x, view: v.id as ViewMode }));
                      setMenu(null);
                    }}
                  >
                    {v.name}
                    <span className="fx-k">{v.key}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="fx-row2">
          {editPath && editPath.pane === pane ? (
            <input
              className="input fx-path-in"
              aria-label="경로"
              autoFocus
              value={editPath.value}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setEditPath({ pane, value: e.target.value })}
              onKeyDown={async (e) => {
                if (e.key === "Escape") setEditPath(null);
                if (e.key === "Enter") {
                  const v = cleanPath(editPath.value);
                  if (await fsApi.isDir(v)) {
                    setEditPath(null);
                    go(pane, v);
                  } else flash("그 폴더를 찾지 못했어요");
                }
              }}
              onBlur={() => setEditPath(null)}
            />
          ) : (
            <div className="fx-crumbs" role="button" tabIndex={0} title="눌러서 경로 고쳐 적기 · Enter로 이동" onClick={() => !t.find && setEditPath({ pane, value: t.path })}>
              {t.find ? (
                <span className="fx-dim">{t.find.flat ? "펼쳐보기" : "찾기 결과"} · {t.find.form.where}</span>
              ) : (
                crumbs.map((c, i) => (
                  <Fragment key={c.path}>
                    <span className={i === crumbs.length - 1 ? "fx-crumb fx-strong" : "fx-crumb"}>{c.name}</span>
                    {i < crumbs.length - 1 && <span className="fx-crumb-sep">›</span>}
                  </Fragment>
                ))
              )}
            </div>
          )}
          <button type="button" className="fx-ib" aria-label="경로 복사" title="경로 복사 (Ctrl+Shift+C)" onClick={() => copyPath(pane)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
          </button>
          <button
            type="button"
            className="fx-ib"
            aria-label="윈도우 탐색기로 열기"
            title="윈도우 탐색기로 열기 (Ctrl+E)"
            onClick={() => {
              const r = selected(pane)[0];
              if (r) void fsApi.explorer(r.path, true);
              else if (!t.find) void fsApi.explorer(t.path === PC ? "shell:MyComputerFolder" : t.path === HOME ? "shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}" : t.path, false);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6" />
              <path d="M20 4l-9 9" />
              <path d="M18 14v6H4V6h6" />
            </svg>
          </button>
          <button
            type="button"
            className="fx-ib"
            aria-label={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 더하기"}
            title={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 더하기"}
            aria-pressed={fav}
            data-on={fav ? "1" : "0"}
            disabled={!!t.find || isSpecial(t.path)}
            onClick={() => setSt({ ...st, favorites: fav ? st.favorites.filter((f) => f !== t.path) : [...st.favorites, t.path] })}
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
            </svg>
          </button>
        </div>
        {t.find && (
          <div className="fx-findband">
            <span className="fx-strong">{t.find.flat ? "펼쳐보기" : t.find.form.name || (t.find.form.text ? `"${t.find.form.text}"` : "*")}</span>
            <span className="fx-dim fx-ellip">{t.find.flat ? `${t.find.form.where} 아래 모든 파일` : findSummary(t.find.form, t.find.all)}</span>
            <span className="fx-grow" />
            <span className="fx-dim">
              {t.find.running && !t.find.live
                ? "찾는 중…"
                : `${t.find.results.length >= 5000 ? "5,000개 넘음" : `${t.find.results.length.toLocaleString()}개`} · 폴더 ${new Set(t.find.results.map((r) => parentOf(r.path))).size.toLocaleString()}곳${t.find.ms != null && t.find.all ? ` · ${(t.find.ms / 1000).toFixed(2)}초` : ""}`}
            </span>
            {!t.find.flat && (
              <button
                type="button"
                className="fx-fk"
                onClick={() => {
                  setForm(t.find!.form);
                  setFindOpen(true);
                }}
              >
                조건 고치기
              </button>
            )}
            <button type="button" className="fx-fk" onClick={() => void rerunFind(pane)}>
              {t.find.flat ? "다시 읽기" : "다시 찾기"}
            </button>
          </div>
        )}
        {(p.view === "detail" || t.find) && (
          <div className="fx-hdr" style={colStyle}>
            <span />
            <button type="button" className="fx-hcell" onClick={() => sortBy("name")}>
              이름{arrow("name")}
            </button>
            {t.find && (
              <button type="button" className="fx-hcell fx-col" onClick={() => sortBy("folder")}>
                폴더{arrow("folder")}
                {resizer("folder")}
              </button>
            )}
            {cfg.cols.size && (
              <button type="button" className="fx-hcell fx-col" onClick={() => sortBy("size")}>
                크기{arrow("size")}
                {resizer("size")}
              </button>
            )}
            {cfg.cols.modified && (
              <button type="button" className="fx-hcell fx-col" onClick={() => sortBy("modified")}>
                수정한 날{arrow("modified")}
                {resizer("modified")}
              </button>
            )}
            {cfg.cols.type && (
              <button type="button" className="fx-hcell fx-col" onClick={() => sortBy("type")}>
                파일 형식{arrow("type")}
                {resizer("type")}
              </button>
            )}
          </div>
        )}
        <div
          className={p.view === "brief" && !t.find ? "fx-list fx-brief" : p.view === "icons" || p.view === "thumb" ? (t.find ? "fx-list" : "fx-list fx-grid") : "fx-list"}
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) up(pane);
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSel(pane, EMPTY_SEL);
          }}
          onContextMenu={(e) => {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            setSel(pane, EMPTY_SEL);
            void shellMenu(pane, e, []);
          }}
        >
          {!t.find && parentOf(t.path) && (p.view === "detail" || p.view === "brief") && (
            <div className={p.view === "brief" ? "fx-brow" : "fx-frow"} style={p.view === "detail" ? colStyle : undefined} onDoubleClick={() => up(pane)} title="두 번 누르면 위 폴더 (Backspace)">
              {/* FC처럼 보통 폴더 아이콘 + ".." (칩·화살표 없이, 아래 폴더와 같은 크기) */}
              {p.view === "brief" ? (
                <>
                  <FileIcon name=".." path="" dir size={16} />
                  <span className="fx-bn fx-dim fx-strong">..</span>
                </>
              ) : (
                <>
                  <span className="fx-icell">
                    <FileIcon name=".." path="" dir size={16} />
                  </span>
                  <span className="fx-ncell fx-dim fx-strong">..</span>
                </>
              )}
              {p.view === "detail" && (
                <>
                  {shown.map((k) => (
                    <span key={k} className="fx-col" />
                  ))}
                </>
              )}
            </div>
          )}
          {!t.find && parentOf(t.path) && (p.view === "icons" || p.view === "thumb") && (
            <div className="fx-gcell" onDoubleClick={() => up(pane)}>
              {/* FC처럼 보통 폴더 아이콘 + ".." (칩·화살표 없이) */}
              <span className="fx-gicon" style={{ width: p.view === "thumb" ? 88 : 48, height: p.view === "thumb" ? 66 : 48 }}>
                <FileIcon name=".." path="" dir size={p.view === "thumb" ? 64 : 44} />
              </span>
              <span className="fx-dim fx-strong">..</span>
            </div>
          )}
          {/* ".." 줄 다음에 보여요(빈 폴더에서 ".."이 글 아래로 내려가지 않게) */}
          {listing.error && !t.find && <div className="fx-empty fx-err">{listing.error}</div>}
          {!listing.error && !t.find && !listing.loading && !rows.length && <div className="fx-empty">{filters[pane] ? "빠른 필터에 맞는 것이 없어요" : "비어 있어요"}</div>}
          {t.find && !t.find.running && !rows.length && <div className="fx-empty">찾은 것이 없어요</div>}
          {rows.map((r, i) => {
            const isSel = s.paths.has(r.path) || (!s.paths.size && s.cursor === r.path);
            const common = {
              id: `fx-row-${pane}-${i}`,
              "data-sel": isSel ? "1" : "0",
              "data-cur": s.cursor === r.path && on ? "1" : "0",
              "data-hid": r.hidden || cut.has(r.path) ? "1" : "0",
              "data-dir": r.dir ? r.path : undefined,
              "data-extdrop": r.dir && extHover?.dir === r.path ? "1" : "0",
              draggable: !inline,
              onMouseDown: (e: React.MouseEvent) => e.button === 0 && pick(r, e),
              onDoubleClick: () => openEntry(pane, r),
              onContextMenu: (e: React.MouseEvent) => rowCtx(r, e),
              onDragStart: (e: React.DragEvent) => {
                const items = s.paths.has(r.path) ? rows.filter((x) => s.paths.has(x.path)) : [r];
                dragSrc.current = { pane, rows: items };
                e.dataTransfer.effectAllowed = "copyMove";
                e.dataTransfer.setData("text/plain", items.map((x) => x.path).join("\n"));
              },
              onDragOver: (e: React.DragEvent) => {
                if (r.dir && dragSrc.current && !dragSrc.current.rows.includes(r)) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              },
              onDrop: (e: React.DragEvent) => {
                if (!r.dir) return;
                e.stopPropagation();
                dropTo(pane, e, r.path);
              },
            };
            if ((p.view === "icons" || p.view === "thumb") && !t.find) {
              const thumb = p.view === "thumb" && IMAGE_EXT.has(extOf(r.name));
              const big = p.view === "thumb" ? 64 : 44;
              return (
                <div key={r.path} className="fx-gcell" {...common} title={r.name}>
                  <span className="fx-gicon" style={{ width: p.view === "thumb" ? 88 : 48, height: p.view === "thumb" ? 66 : 48 }}>
                    {thumb ? <Thumb path={r.path} /> : <FileIcon name={r.name} path={r.path} dir={r.dir} size={big} rev={r.modified} />}
                    {r.locked && <LockBadge small />}
                  </span>
                  <span className="fx-gname" style={{ fontWeight: r.dir ? 600 : 400 }}>
                    {inline && inline.path === r.path ? nameCell(r) : r.name}
                  </span>
                </div>
              );
            }
            if (p.view === "brief" && !t.find) {
              return (
                <div key={r.path} className="fx-brow" {...common} title={r.name}>
                  <FileIcon name={r.name} path={r.path} dir={r.dir} size={16} rev={r.modified} />
                  <span className="fx-bn" style={{ fontWeight: r.dir ? 600 : 400 }}>
                    {inline && inline.path === r.path ? nameCell(r) : r.name}
                  </span>
                </div>
              );
            }
            const groupHead = "";
            return (
              <Fragment key={r.path}>
              {groupHead && <div className="fx-ghead">{groupHead}</div>}
              <div className="fx-frow" style={colStyle} {...common}>
                <span className="fx-icell">
                  <FileIcon name={r.name} path={r.path} dir={r.dir} size={16} rev={r.modified} />
                </span>
                <span className="fx-ncell" style={{ fontWeight: r.dir ? 600 : 400 }}>
                  {nameCell(r)}
                  {r.locked && <LockBadge />}
                </span>
                {t.find && (
                  <span className="fx-col fx-dim" title={parentOf(r.path) ?? ""}>
                    <span className="fx-ellip">{r.folder}</span>
                  </span>
                )}
                {cfg.cols.size && <span className="fx-col fx-num">{r.note ?? (r.dir ? "" : formatSize(r.size))}</span>}
                {cfg.cols.modified && <span className="fx-col fx-dim fx-tab-num fx-nowrap">{dateParts(formatDate(r.modified, fmt))}</span>}
                {cfg.cols.type && (
                  <span className="fx-col fx-dim" title={r.kind ?? typeName(r, types)}>
                    <span className="fx-ellip">{r.kind ?? typeName(r, types)}</span>
                  </span>
                )}
              </div>
              </Fragment>
            );
          })}
        </div>
        <div className="fx-status">
          <span>
            {t.find
              ? "Enter 열기 · Ctrl+Enter 그 폴더를 새 탭으로"
              : listing.loading
                ? "읽는 중…"
                : `${dirs.length ? `폴더 ${dirs.length}개 · ` : ""}파일 ${files.length}개 · ${formatSize(total)}`}
          </span>
          <span className="fx-grow" />
          {sel.length > 0 && (
            <span>
              고른 것 {sel.length}개 · {formatSize(sel.reduce((a, b) => a + (b.dir ? 0 : b.size), 0))}
            </span>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="fx-root">
      <div className="fx-top">
        <div className="fx-findbox fx-rel" style={{ width: st.tree.width }}>
          <label className="search fx-search">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              ref={quickRef}
              aria-label="파일 찾기"
              placeholder={fastReady ? "모든 드라이브에서 찾기" : "파일 찾기"}
              value={quickFind}
              onChange={(e) => setQuickFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && quickFind.trim()) {
                  // 빠른 찾기는 이미 치는 대로 나와 있어요 — Enter는 결과 목록으로 옮겨 가기
                  if (!fastReady) void runFind({ ...EMPTY_FIND, name: quickFind.trim(), sub: true });
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  setQuickFind("");
                  e.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              className="fx-more fx-menu-btn"
              onClick={() => {
                if (!findOpen) setForm({ ...form, name: form.name || quickFind, where: form.where || curPath });
                setFindOpen(!findOpen);
              }}
            >
              자세히 ▾
            </button>
          </label>
          {findOpen && (
            <div className="fx-menu fx-findpanel" onKeyDown={(e) => e.key === "Escape" && setFindOpen(false)}>
              <div className="fx-fgrid">
                <span className="fx-dim">이름</span>
                <input className="input" value={form.name} placeholder="*.jpg;*.png 또는 이름 일부" onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <span className="fx-dim">안의 글자</span>
                <input className="input" value={form.text} placeholder="한글·오피스·PDF" onChange={(e) => setForm({ ...form, text: e.target.value })} />
                <span className="fx-dim">어디서</span>
                <div className="fx-hrow">
                  <input
                    className="input fx-grow"
                    value={form.where}
                    placeholder={fastReady ? "비우면 모든 드라이브" : ""}
                    onChange={(e) => setForm({ ...form, where: e.target.value })}
                  />
                  {fastReady && (
                    <button type="button" className="btn btn-ctrl" disabled={!form.where} onClick={() => setForm({ ...form, where: "" })}>
                      모든 드라이브
                    </button>
                  )}
                  <label className="fx-ck">
                    <input type="checkbox" checked={form.sub} onChange={(e) => setForm({ ...form, sub: e.target.checked })} /> 하위 폴더
                  </label>
                </div>
                <span className="fx-dim">수정한 날</span>
                <div className="fx-hrow">
                  <input
                    className={formBad.from ? "input fx-date fx-bad-input" : "input fx-date"}
                    aria-label="수정한 날 시작"
                    value={form.from}
                    onChange={(e) => setForm({ ...form, from: e.target.value })}
                    onBlur={() => fixDate("from")}
                    onKeyDown={(e) => e.key === "Enter" && fixDate("from")}
                  />
                  <span>~</span>
                  <input
                    className={formBad.to ? "input fx-date fx-bad-input" : "input fx-date"}
                    aria-label="수정한 날 끝"
                    placeholder="오늘"
                    value={form.to}
                    onChange={(e) => setForm({ ...form, to: e.target.value })}
                    onBlur={() => fixDate("to")}
                    onKeyDown={(e) => e.key === "Enter" && fixDate("to")}
                  />
                </div>
                <span className="fx-dim">크기</span>
                <div className="fx-hrow">
                  <input className="input fx-date" data-ime="en" placeholder="1MB 넘게" value={form.minSize} onChange={(e) => setForm({ ...form, minSize: e.target.value })} />
                  <span>~</span>
                  <input className="input fx-date" data-ime="en" placeholder="크기 제한 없음" value={form.maxSize} onChange={(e) => setForm({ ...form, maxSize: e.target.value })} />
                </div>
                <span />
                <div className="fx-hrow">
                  <label className="fx-ck">
                    <input type="checkbox" checked={form.lockedOnly} onChange={(e) => setForm({ ...form, lockedOnly: e.target.checked })} /> 잠긴 파일만
                  </label>
                  <label className="fx-ck">
                    <input type="checkbox" checked={form.complaintsOnly} onChange={(e) => setForm({ ...form, complaintsOnly: e.target.checked })} /> 민원과 이어진 것만
                  </label>
                </div>
              </div>
              {st.finds.length > 0 && (
                <div className="fx-saved">
                  {st.finds.map((f, i) => (
                    <span key={i} className="fx-chip">
                      <button type="button" onClick={() => setForm(f.spec)}>
                        {f.name}
                      </button>
                      <button type="button" aria-label="저장한 조건 지우기" onClick={() => setSt({ ...st, finds: st.finds.filter((_, k) => k !== i) })}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="fx-ffoot">
                <button
                  type="button"
                  className="btn btn-ctrl"
                  onClick={() =>
                    setNameAsk({
                      title: "찾기 조건 저장",
                      value: form.name || form.text || "조건",
                      ok: (v) => {
                        setSt((S) => (S ? { ...S, finds: [...S.finds.filter((f) => f.name !== v), { name: v, spec: form }] } : S));
                        setNameAsk(null);
                      },
                    })
                  }
                >
                  조건 저장
                </button>
                <span className="fx-grow" />
                <button type="button" className="btn-primary btn-ctrl" disabled={formBad.from || formBad.to} onClick={() => void runFind(form)}>
                  찾기
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="fx-tools" ref={toolsRef} data-compact={toolFit.compact ? "1" : "0"} style={{ ["--tool-w" as string]: toolFit.w + "px" }}>
          <button type="button" className="btn btn-ctrl fx-tool" title="새로 고침 (Ctrl+R)" onClick={refresh}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>
            <span className="fx-tl">새로고침</span>
          </button>
          <button type="button" className="btn btn-ctrl fx-tool" title="폴더트리 폭과 창 사이 크기를 처음대로" onClick={resetLayout}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3" /></svg>
            <span className="fx-tl">배치복구</span>
          </button>
          <span className="fx-vsep" />
          <button type="button" className="btn btn-ctrl fx-tool" title="폴더 트리" aria-pressed={st.tree.on} onClick={() => setSt({ ...st, tree: { ...st.tree, on: !st.tree.on } })}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="5" rx="1" /><rect x="14" y="10" width="7" height="5" rx="1" /><rect x="14" y="17" width="7" height="5" rx="1" /><path d="M6.5 8v11.5H14M6.5 12.5H14" /></svg>
            <span className="fx-tl">트리보기</span>
          </button>
          <button type="button" className="btn btn-ctrl fx-tool" title="2창" aria-pressed={!st.four} onClick={() => toTwo()}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></svg>
            <span className="fx-tl">두칸보기</span>
          </button>
          <button type="button" className="btn btn-ctrl fx-tool" title="4창" aria-pressed={st.four} onClick={() => toFour()}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M3 12h18" /></svg>
            <span className="fx-tl">네칸보기</span>
          </button>
          <span className="fx-vsep" />
          <button type="button" className="btn btn-ctrl fx-tool" title="하위 폴더 파일까지 한 목록으로" aria-pressed={flatOn} onClick={toggleFlat}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h6l2 2h10v4M3 5v14h8M14 14h7M14 18h7M14 22h7" /></svg>
            <span className="fx-tl">펼쳐보기</span>
          </button>
          <button type="button" className="btn btn-ctrl fx-tool" title="미리 보기 칸" aria-pressed={!!st.preview} onClick={() => setSt({ ...st, preview: !st.preview })}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16M16.5 9h2M16.5 12h2" /></svg>
            <span className="fx-tl">미리보기</span>
          </button>
          <button type="button" className="btn btn-ctrl fx-tool" title="숨김 파일 보이기" aria-pressed={cfg.showHidden} onClick={() => void toggleHidden()}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
            <span className="fx-tl">숨긴파일</span>
          </button>
          <span className="fx-vsep" />
          <button type="button" className="btn btn-ctrl fx-tool" title="대상 창을 지금 창과 같은 폴더로" onClick={sameFolder}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9h14M5 15h14" /></svg>
            <span className="fx-tl">같은폴더</span>
          </button>
          <button type="button" className="btn btn-ctrl fx-tool" title="지금 창과 대상 창을 서로 바꾸기" onClick={swapPanes}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7" /></svg>
            <span className="fx-tl">창바꾸기</span>
          </button>
          <span className="fx-vsep" />
          <button type="button" className="btn btn-ctrl fx-tool" title="일괄 이름 바꾸기" onClick={() => void openBatch(st.active)}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h10M4 12h7M4 17h5" /><path d="M14 20v-3l6-6 3 3-6 6z" /></svg>
            <span className="fx-tl">이름변경</span>
          </button>
        </div>
      </div>

      <div className="fx-body">
        {st.tree.on && (
          <>
            <aside className="fx-tree" aria-label="폴더 트리" style={{ width: st.tree.width }}>
              <div className="fx-tree-head">폴더트리</div>
              <div className="fx-tree-list">
                {treeRows.map((r, ri) => {
                  const on = curPath.toLowerCase() === r.path.toLowerCase();
                  const path = onPath.has(r.path.toLowerCase());
                  const open = st.tree.open.includes(r.path);
                  // 안내선: 단계마다. 그 단계의 위 폴더가 지금 경로에 있고 이 줄이 지금 폴더보다 위(앞)면 연보라
                  const curIdx = treeRows.findIndex((x) => x.path.toLowerCase() === curPath.toLowerCase());
                  const guides = Array.from({ length: r.level }, (_, k) => {
                    let anc: string | null = r.path;
                    for (let n = r.level; n > k; n--) anc = anc ? parentOf(anc) : null;
                    return !!anc && onPath.has(anc.toLowerCase()) && curIdx >= 0 && ri <= curIdx;
                  });
                  return (
                    <Fragment key={r.key}>
                      {(r.drive || r.special) && !r.first && <div className="fx-tree-gap" />}
                      <div
                        className={r.drive || r.special ? "fx-tr fx-tr-drive" : "fx-tr"}
                        data-on={on ? "1" : "0"}
                        data-path={path ? "1" : "0"}
                        title={r.path}
                        onMouseDown={(e) => e.detail > 1 && e.preventDefault()}
                        onClick={() => go(st.active, r.path)}
                        onDoubleClick={() => toggleTreeRow(r)}
                        data-tree-dir={r.special ? undefined : r.path}
                        data-extdrop={!r.special && extHover?.dir === r.path ? "1" : "0"}
                        onDragOver={(e) => dragSrc.current && e.preventDefault()}
                        onDrop={(e) => dropTo(st.active, e, r.path)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (r.special) return;
                          const par = parentOf(r.path);
                          void (async () => {
                            try {
                              const res = await fsApi.contextMenu(par ?? r.path, par ? [r.name] : [], e.clientX, e.clientY);
                              if (res === "done") window.setTimeout(refreshAll, 300);
                            } catch (er) {
                              if (String(er) === "windows_only") flash("우클릭 메뉴는 윈도우에서 떠요(미리 보기에서는 안 돼요)");
                            }
                          })();
                        }}
                      >
                        {guides.map((lit, k) => (
                          <span key={k} className="fx-tg">
                            <span data-lit={lit ? "1" : "0"} />
                          </span>
                        ))}
                        <span
                          className="fx-chev"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.special === "home") toggleGroup(HOME);
                            else if (r.special === "pc") toggleGroup(PC_FOLD);
                            else if (r.hasKids) toggleOpen(r.path);
                          }}
                        >
                          {r.hasKids && (
                            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: (r.special === "home" ? homeOpen : r.special === "pc" ? !pcFolded : open) ? "rotate(90deg)" : undefined }}>
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          )}
                        </span>
                        <span className="fx-tico">
                          {r.special === "home" ? (
                            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
                            </svg>
                          ) : r.special === "pc" ? (
                            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 4h18v12H3zM8 20h8M12 16v4" />
                            </svg>
                          ) : r.drive ? (
                            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
                              <rect x="2.5" y="7" width="19" height="10" rx="2" fill="var(--surface-band)" stroke="var(--muted)" strokeWidth="1.3" />
                              <rect x="5" y="13" width="14" height="1.6" rx=".8" fill="#4B9A5B" />
                            </svg>
                          ) : (
                            <FileIcon name={r.name} path={r.path} dir size={16} />
                          )}
                        </span>
                        <span className="fx-ellip">{r.name}</span>
                      </div>
                    </Fragment>
                  );
                })}
              </div>
            </aside>
            <div
              className="fx-split"
              role="separator"
              aria-label="트리 폭"
              title="끌어서 폭 바꾸기 · 두 번 누르면 처음 폭"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                dragW.current = { x: e.clientX, w: st.tree.width };
              }}
              onPointerMove={(e) => {
                const d = dragW.current;
                if (!d) return;
                const w = Math.max(TREE_W.min, Math.min(TREE_W.max, Math.round(d.w + e.clientX - d.x)));
                setSt((S) => (S ? { ...S, tree: { ...S.tree, width: w } } : S));
              }}
              onPointerUp={() => (dragW.current = null)}
              onDoubleClick={() => setSt({ ...st, tree: { ...st.tree, width: TREE_W.start } })}
            />
          </>
        )}
        <div
          ref={panesRef}
          className={st.four ? "fx-panes fx-four" : "fx-panes"}
          style={{
            gridTemplateColumns: `minmax(0, ${st.split}fr) minmax(0, ${1 - st.split}fr)`,
            ...(st.four ? { gridTemplateRows: `minmax(0, ${st.splitV ?? 0.5}fr) minmax(0, ${1 - (st.splitV ?? 0.5)}fr)` } : {}),
          }}
        >
          {Array.from({ length: paneCount }, (_, i) =>
            // 미리보기: FreeCommander처럼 대상 창 자리에 보여요(창들이 좁아지지 않게)
            st.preview && i === targetOf(st.active) ? (
              <section key={i} className="fx-pane fx-preview" aria-label="미리보기" data-on="0" data-target="0">
                <div className="fx-tabs">
                  <span className="fx-tab fx-pv-title">미리보기</span>
                </div>
                <Preview row={selected(st.active)[0]} fmt={fmt} typeOf={(r) => typeName(r, types)} />
              </section>
            ) : (
              renderPane(i)
            ),
          )}
          <div
            className="fx-psplit fx-psplit-x"
            role="separator"
            aria-label="창 사이 폭"
            title="끌어서 폭 바꾸기 · 두 번 누르면 처음대로"
            style={{ left: `calc((100% - 12px) * ${st.split})` }}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panesRef.current) return;
              const r = panesRef.current.getBoundingClientRect();
              const m = Math.min(0.5, PANE_MIN_W / (r.width - 12));
              const v = Math.max(m, Math.min(1 - m, (e.clientX - r.left - 6) / (r.width - 12)));
              setSt((S) => (S ? { ...S, split: Math.round(v * 1000) / 1000 } : S));
            }}
            onDoubleClick={() => setSt({ ...st, split: 0.5 })}
          />
          {st.four && (
            <div
              className="fx-psplit fx-psplit-y"
              role="separator"
              aria-label="창 사이 높이"
              title="끌어서 높이 바꾸기 · 두 번 누르면 처음대로"
              style={{ top: `calc((100% - 12px) * ${st.splitV ?? 0.5})` }}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId) || !panesRef.current) return;
                const r = panesRef.current.getBoundingClientRect();
                const m = Math.min(0.5, PANE_MIN_H / (r.height - 12));
                const v = Math.max(m, Math.min(1 - m, (e.clientY - r.top - 6) / (r.height - 12)));
                setSt((S) => (S ? { ...S, splitV: Math.round(v * 1000) / 1000 } : S));
              }}
              onDoubleClick={() => setSt({ ...st, splitV: 0.5 })}
            />
          )}
        </div>
      </div>

      <div className="fx-keys">
        <span className="fx-fk"><b>F2</b> 이름 바꾸기</span>
        <span className="fx-fk"><b>F3</b> 열기</span>
        <span className="fx-fk"><b>F5</b> 복사 → 대상</span>
        <span className="fx-fk"><b>F6</b> 옮기기 → 대상</span>
        <span className="fx-fk"><b>F7</b> 새 폴더</span>
        <span className="fx-fk"><b>F8</b> 지우기</span>
        <span className="fx-fk"><b>Ctrl+C·X·V</b> 복사·잘라내기·붙이기</span>
        <span className="fx-fk"><b>Space</b> 고르기</span>
        <span className="fx-fk"><b>Tab</b> {st.four ? "다음 창" : "반대 창"}</span>
        {st.four && <span className="fx-fk"><b>Ctrl+1~4</b> 창 고르기</span>}
        <span className="fx-fk"><b>Ctrl+E</b> 윈도우 탐색기로</span>
        {busy && (
          <span className="fx-busy">
            {busy.total ? `${busy.done}/${busy.total}` : ""} {busy.name}
            <button type="button" className="fx-fk" onClick={() => void fsApi.cancel()}>
              멈추기
            </button>
          </span>
        )}
        {toast && <span className="fx-toast">{toast}</span>}
      </div>

      {menu?.kind === "tab" && menu.tab !== undefined && (
        <TabMenu
          x={menu.x ?? 0}
          y={menu.y ?? 0}
          tab={st.panes[menu.pane].tabs[menu.tab]}
          canClose={st.panes[menu.pane].tabs.length > 1}
          onAction={(a) => {
            const pane = menu.pane;
            const ti = menu.tab!;
            const tab = st.panes[pane].tabs[ti];
            setMenu(null);
            if (a === "pin") updPane(pane, (p) => ({ ...p, tabs: p.tabs.map((t, i) => (i === ti ? { ...t, pinned: !t.pinned } : t)) }));
            if (a === "dup") updPane(pane, (p) => ({ ...p, tabs: [...p.tabs.slice(0, ti + 1), { ...tab, pinned: false, id: tabSeq++ }, ...p.tabs.slice(ti + 1)], active: ti + 1 }));
            if (a === "other") {
              const o = targetOf(pane);
              updPane(o, (p) => ({ ...p, tabs: [...p.tabs, { ...tab, pinned: false, id: tabSeq++ }], active: p.tabs.length }));
            }
            if (a === "close") closeTab(pane, ti);
            if (a === "others") updPane(pane, (p) => ({ ...p, tabs: p.tabs.filter((t, i) => i === ti || t.pinned), active: p.tabs.filter((t, i) => i === ti || t.pinned).findIndex((t) => t.id === tab.id) }));
          }}
        />
      )}

      {conflict && (
        <ConflictDialog
          conflict={conflict.list[conflict.i]}
          index={conflict.i}
          total={conflict.list.length}
          op={conflict.op}
          dateFmt={fmt}
          onPick={pickConflict}
          onCancel={() => {
            conflict.resolve(null);
            setConflict(null);
          }}
        />
      )}
      {del && <DeleteDialog items={del.items} permanent={del.permanent} onYes={() => void doDelete(del.pane, del.items, del.permanent)} onNo={() => setDel(null)} />}
      {renameRows && (
        <RenameDialog
          rows={renameRows.rows}
          where={renameRows.where}
          opts={st.rename}
          dateFmt={fmt}
          onOpts={(o: RenameOpts) => setSt((S) => (S ? { ...S, rename: o } : S))}
          onRename={doBatch}
          onClose={() => setRenameRows(null)}
          canUndo={!!undo}
          onUndo={() => void undoBatch()}
        />
      )}
      {nameAsk && <NameDialog title={nameAsk.title} value={nameAsk.value} onOk={nameAsk.ok} onCancel={() => setNameAsk(null)} />}
    </div>
  );
}

function LockBadge({ small }: { small?: boolean }) {
  // 배지 없이 금색 솔리드 자물쇠만(2026-10-19 사용자: 3안 좁은 폭). 색은 tokens.css --lock*.
  const px = small ? 15 : 13;
  return (
    <span className={small ? "fx-lock fx-lock-s" : "fx-lock"} title="회사 보안(DRM)이 걸린 것 같아요">
      <svg aria-hidden="true" width={px} height={px} viewBox="0 0 24 24">
        <path d="M8.6 10V8a3.4 3.4 0 0 1 6.8 0v2" fill="none" stroke="var(--lock-shackle)" strokeWidth="3.4" strokeLinecap="round" />
        <rect x="4.5" y="9.5" width="15" height="12" rx="3" fill="var(--lock)" />
        <circle cx="12" cy="14.6" r="1.6" fill="var(--lock-hole)" />
        <rect x="11.2" y="15.4" width="1.6" height="3" rx="0.8" fill="var(--lock-hole)" />
      </svg>
    </span>
  );
}

/** 썸네일: 앱에서는 파일을 그대로 그림으로 읽어요(asset 주소) */
function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("@tauri-apps/api/core")
      .then(({ convertFileSrc }) => alive && setSrc("__TAURI_INTERNALS__" in window ? convertFileSrc(path) : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  return src ? <img className="fx-thumb" src={src} alt="" loading="lazy" draggable={false} /> : <span className="fx-thumb fx-thumb-ph" />;
}

function TabMenu({ x, y, tab, canClose, onAction }: { x: number; y: number; tab: RTab; canClose: boolean; onAction: (a: "pin" | "dup" | "other" | "close" | "others") => void }) {
  return (
    <div className="fx-menu fx-tabmenu" role="menu" style={{ left: x, top: y }}>
      {!tab.find && (
        <button type="button" className="fx-mi" onClick={() => onAction("pin")}>
          {tab.pinned ? "고정 풀기" : "고정"}
        </button>
      )}
      <button type="button" className="fx-mi" onClick={() => onAction("dup")}>
        복제
      </button>
      <button type="button" className="fx-mi" onClick={() => onAction("other")}>
        반대 창에 열기
      </button>
      <div className="fx-sep" />
      {!tab.pinned && canClose && (
        <button type="button" className="fx-mi" onClick={() => onAction("close")}>
          닫기<span className="fx-k">Ctrl+W</span>
        </button>
      )}
      <button type="button" className="fx-mi" onClick={() => onAction("others")}>
        다른 탭 모두 닫기
      </button>
    </div>
  );
}

const dateMinCache = new Map<string, number>();
/** 날짜 형식 글자 폭(+여백 20px). 2026-12-28 23:58:58처럼 넓은 숫자로 재요. */
function dateColMin(fmt: string): number {
  const fs = getComputedStyle(document.body).fontSize;
  const key = fmt + "|" + fs;
  const hit = dateMinCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return 0;
  c.font = `${fs} Pretendard, sans-serif`;
  const w = Math.ceil(c.measureText(formatDate(new Date(2026, 11, 28, 23, 58, 58).getTime(), fmt)).width) + 20 + (fmt.includes(" ") ? DATE_TIME_GAP : 0);
  dateMinCache.set(key, w);
  return w;
}

/** 날짜와 시각 사이를 띄어쓰기보다 넓게(2026-10-18 사용자: 붙어 보여 읽기 힘듦) */
const DATE_TIME_GAP = 3;
function dateParts(t: string) {
  const i = t.indexOf(" ");
  if (i < 0) return t;
  return (
    <>
      {t.slice(0, i)}
      <span className="fx-dt-time">{t.slice(i + 1)}</span>
    </>
  );
}

/** 창 사이를 끌 때 창 하나가 줄어들 수 있는 끝(이름 열이 보일 만큼) */
const PANE_MIN_W = 460;
const PANE_MIN_H = 200;

/** 미리보기 칸: 사진은 그림으로, 다른 파일은 큰 아이콘과 정보(2026-10-19) */
function Preview({ row, fmt, typeOf }: { row: Row | undefined; fmt: string; typeOf: (r: Row) => string }) {
  if (!row) return <div className="fx-pv-empty">파일을 고르면 여기에 보여요</div>;
  const img = !row.dir && IMAGE_EXT.has(extOf(row.name));
  return (
    <div className="fx-pv">
      <div className="fx-pv-pic">{img ? <PreviewImage path={row.path} /> : <FileIcon name={row.name} path={row.path} dir={row.dir} size={64} rev={row.modified} />}</div>
      <div className="fx-pv-name">{row.name}</div>
      <dl className="fx-pv-info">
        <dt>파일 형식</dt>
        <dd>{typeOf(row)}</dd>
        {!row.dir && (
          <>
            <dt>크기</dt>
            <dd>{formatSize(row.size)}</dd>
          </>
        )}
        <dt>수정한 날</dt>
        <dd>{formatDate(row.modified, fmt)}</dd>
        <dt>위치</dt>
        <dd className="fx-pv-path">{parentOf(row.path) ?? ""}</dd>
      </dl>
    </div>
  );
}

function PreviewImage({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("@tauri-apps/api/core")
      .then(({ convertFileSrc }) => alive && setSrc("__TAURI_INTERNALS__" in window ? convertFileSrc(path) : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);
  return src ? <img className="fx-pv-img" src={src} alt="" draggable={false} /> : <div className="fx-pv-ph">사진은 앱에서 보여요</div>;
}

/** 즐겨찾기 보기: ★로 지정한 폴더를 목록 줄로(수정한 날은 위 폴더를 읽어 채워요, 없어진 폴더는 흐린 이름으로 남겨요) */
async function favEntries(favs: string[]): Promise<FsEntry[]> {
  const byParent = new Map<string, FsEntry[]>();
  const out: FsEntry[] = [];
  for (const f of favs) {
    const par = parentOf(f);
    let found: FsEntry | undefined;
    if (par) {
      if (!byParent.has(par)) byParent.set(par, await fsApi.list(par, true).catch(() => []));
      found = byParent.get(par)!.find((e) => e.path === f);
    }
    out.push(found ?? { name: baseName(f) || f, path: f, dir: true, size: 0, modified: 0, created: 0, hidden: false, locked: false, kind: par ? undefined : "드라이브" });
  }
  return out;
}
