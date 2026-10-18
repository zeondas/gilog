// 탐색기(11단계) 화면. 시안 캔버스 Files·FilesTree·FilesConflict·FilesMenu 판, 사양서 "탐색기 (11단계)" 절이 기준이에요.
// - 왼쪽 폴더 트리(2안: 안내선 + 드라이브 띠 + 지금 경로) + 2창(기본)/4창(2×2).
// - 창마다 탭 줄 → 드라이브 줄(드라이브 · 빠른 필터 · 보기 ▾) → 경로 줄(경로 · 경로 복사 · 윈도우 탐색기로 열기 · ★) → 목록 → 상태 줄.
// - 우클릭(파일·폴더·빈 곳)은 윈도우 우클릭 메뉴 그대로(2안), 탭 우클릭만 기Log 메뉴.
// - 상태(탭·열 폭·정렬·보기·트리·즐겨찾기·찾기 조건·일괄 이름 바꾸기 설정)는 암호화 파일 kv "files.state".
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
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
} from "./files";
import { Conflict, Found, MenuResult, TreeDir, fsApi, fsErrorText, onFsChanged, onFsProgress } from "./filesApi";
import { parseDate } from "./journal";
import { DEFAULT_FILES_SETTINGS, FilesSettings, loadSettings } from "./settingsStore";

const STATE_KEY = "files.state";

type FindRun = { form: FindForm; results: Found[]; running: boolean };
type RTab = FsTab & { find?: FindRun; id: number };
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
        const entries = await fsApi.list(path, cfg.showHidden);
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

  // 보이는 창의 폴더가 바뀌면 읽어요.
  const paths = st ? st.panes.slice(0, paneCount).map((p) => (activeTab(p).find ? "" : activeTab(p).path)) : [];
  const pathsKey = paths.join("\u0001");
  useEffect(() => {
    paths.forEach((p, i) => {
      if (p && listsRef.current[i].path !== p) void load(i, p);
    });
    void fsApi.watch(paths.filter(Boolean));
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

  /** 폴더 열기. 고정 탭이면 새 탭으로 열어요. */
  const go = useCallback(
    (pane: number, path: string, select?: string) => {
      updPane(pane, (p) => {
        const t = p.tabs[p.active];
        if (t && !t.pinned && !t.find) {
          const tabs = p.tabs.map((x, i) => (i === p.active ? { ...x, path } : x));
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
    return sortEntries(base.filter((e) => quickMatch(f, e.name)), p.sort, p.asc, types);
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
    if (t.find) return;
    const u = parentOf(t.path);
    if (u) go(pane, u, t.path);
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

  const transfer = async (pane: number, op: "copy" | "move", items?: Row[], destDir?: string) => {
    if (!st) return;
    const src = items ?? selected(pane);
    if (!src.length) return;
    const dest = destDir ?? (() => {
      const tp = st.panes[targetOf(pane)];
      const t = activeTab(tp);
      return t.find ? "" : t.path;
    })();
    if (!dest) return flash("대상 창이 찾기 결과예요. 폴더를 연 창으로 보내 주세요.");
    const sources = src.map((e) => e.path);
    try {
      const list = await fsApi.conflicts(sources, dest);
      const dec = await askConflicts(list, op);
      if (!dec) return;
      setBusy({ done: 0, total: sources.length, name: "" });
      const sum = await fsApi.transfer(op, sources, dest, dec);
      setBusy(null);
      const verb = op === "copy" ? "복사" : "옮기기";
      flash(sum.errors.length ? `${verb} ${sum.done}개 · 못 한 것 ${sum.errors.length}개 — ${fsErrorText(sum.errors[0][1])}` : `${verb} ${sum.done}개${sum.skipped ? ` · 건너뜀 ${sum.skipped}개` : ""}`);
    } catch (e) {
      setBusy(null);
      flash(fsErrorText(e));
    }
    refreshAll();
  };

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
    if (t.find) return;
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
    if (!dir) return;
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
  const runFind = async (f: FindForm) => {
    if (!st) return;
    const pane = st.active;
    const cur = activeTab(st.panes[pane]);
    const where = cleanPath(f.where || (cur.find ? cur.find.form.where : cur.path));
    const day = (s: string, end: boolean) => {
      const d = parseDate(s);
      if (!d) return 0;
      const t = new Date(d + (end ? "T23:59:59.999" : "T00:00:00")).getTime();
      return t;
    };
    const ff = { ...f, where };
    const label = ff.name || (ff.text ? `"${ff.text}"` : "*");
    const id = tabSeq++;
    updPane(pane, (p) => ({ ...p, tabs: [...p.tabs, { path: where, pinned: false, id, find: { form: ff, results: [], running: true } }], active: p.tabs.length }));
    setFindOpen(false);
    setSel(pane, EMPTY_SEL);
    try {
      const results = await fsApi.find({
        name: ff.name,
        text: ff.text,
        roots: [where],
        sub: ff.sub,
        from: day(ff.from, false),
        to: day(ff.to, true),
        minSize: parseSize(ff.minSize),
        maxSize: parseSize(ff.maxSize),
        lockedOnly: ff.lockedOnly,
        complaintsOnly: ff.complaintsOnly,
        showHidden: cfg.showHidden,
      });
      updPane(pane, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === id ? { ...t, find: { form: ff, results, running: false } } : t)) }));
    } catch (e) {
      updPane(pane, (p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === id ? { ...t, find: { form: ff, results: [], running: false } } : t)) }));
      flash(fsErrorText(e));
    }
    void label;
  };

  const rerunFind = async (pane: number) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    if (!t.find) return;
    const form = t.find.form;
    closeTab(pane, st.panes[pane].active);
    await runFind(form);
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
    if (ctrl && !e.shiftKey && e.code === "KeyE") {
      const t = activeTab(st.panes[pane]);
      const r = rows[idx];
      if (r) void fsApi.explorer(r.path, true);
      else if (!t.find) void fsApi.explorer(t.path, false);
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
      if (tree.has(path)) return;
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
  const curPath = st ? (activeTab(st.panes[st.active]).find ? "" : activeTab(st.panes[st.active]).path) : "";

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
    visibleDrives.forEach((d) => st.tree.open.includes(d.path) && void loadTree(d.path));
    st.tree.open.forEach((p) => void loadTree(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.tree.on, drives]);

  const toggleOpen = (path: string) => {
    if (!st) return;
    const open = st.tree.open.includes(path) ? st.tree.open.filter((p) => p !== path && !p.startsWith(path)) : [...st.tree.open, path];
    setSt({ ...st, tree: { ...st.tree, open } });
    void loadTree(path);
  };

  type TreeRow = { name: string; path: string; level: number; hasKids: boolean; drive: boolean; first: boolean };
  const treeRows: TreeRow[] = useMemo(() => {
    if (!st) return [];
    const out: TreeRow[] = [];
    const walk = (path: string, level: number) => {
      for (const k of tree.get(path) ?? []) {
        out.push({ name: k.name, path: k.path, level, hasKids: k.hasChildren, drive: false, first: false });
        if (st.tree.open.includes(k.path)) walk(k.path, level + 1);
      }
    };
    visibleDrives.forEach((d, i) => {
      out.push({ name: d.name, path: d.path, level: 0, hasKids: true, drive: true, first: i === 0 });
      if (st.tree.open.includes(d.path)) walk(d.path, 1);
    });
    return out;
  }, [st, tree, visibleDrives]);

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

  // ---------- 끌어다 놓기(창 사이, 윈도우 탐색기에서) ----------
  const dragSrc = useRef<{ pane: number; rows: Row[] } | null>(null);
  const dropTo = (pane: number, e: React.DragEvent, dir?: string) => {
    e.preventDefault();
    const src = dragSrc.current;
    dragSrc.current = null;
    if (!st || !src) return;
    const t = activeTab(st.panes[pane]);
    const dest = dir ?? (t.find ? "" : t.path);
    if (!dest) return;
    if (src.rows.some((r) => r.path === dest || parentOf(r.path) === dest) && !dir) return;
    const same = driveOf(src.rows[0].path) === driveOf(dest);
    const op = e.ctrlKey ? "copy" : e.shiftKey ? "move" : same ? "move" : "copy";
    void transfer(src.pane, op, src.rows, dest);
  };

  if (!st) return <div className="fx-root" />;

  const fmt = cfg.dateFmt;

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
    const colStyle = { gridTemplateColumns: ["32px", "minmax(0,1fr)", ...(t.find ? [`${st.cols.folder}px`] : []), ...shown.map((k) => `${st.cols[k]}px`)].join(" ") };
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
          const w = Math.ceil(Math.max(40, ...vals.map((v) => c.measureText(v).width))) + 20;
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
        data-on={on ? "1" : "0"}
        aria-label={`창 ${pane + 1}`}
        onMouseDown={() => focusPane(pane)}
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
              <span className="fx-tn">{tab.find ? `찾기: ${tab.find.form.name || (tab.find.form.text ? `"${tab.find.form.text}"` : "*")}` : baseName(tab.path)}</span>
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
          {isTarget && <span className="fx-target">대상</span>}
        </div>
        <div className="fx-row1">
          {visibleDrives.map((d) => (
            <button
              key={d.name}
              type="button"
              className="fx-drv"
              data-on={curDrive === d.name || (d.name.length > 2 && t.path === d.path) ? "1" : "0"}
              title={`${d.name} ${d.label}${d.total ? ` · 남은 ${formatSize(d.free)}` : ""}`}
              onClick={() => go(pane, d.path)}
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="8" width="18" height="8" rx="2" />
                <path d="M17 12h.01" />
              </svg>
              {d.name}
            </button>
          ))}
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
                <span className="fx-dim">찾기 결과 · {t.find.form.where}</span>
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
              else if (!t.find) void fsApi.explorer(t.path, false);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6" />
              <path d="M20 4l-9 9" />
              <path d="M18 14v6H4V6h6" />
            </svg>
          </button>
          <div className="fx-rel">
            <button type="button" className="fx-ib fx-menu-btn" aria-label="즐겨찾기" data-on={fav ? "1" : "0"} onClick={() => setMenu(menu?.kind === "fav" && menu.pane === pane ? null : { kind: "fav", pane })}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill={fav ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
              </svg>
            </button>
            {menu?.kind === "fav" && menu.pane === pane && (
              <div className="fx-menu fx-menu-r fx-fav" role="menu">
                {!t.find && (
                  <button
                    type="button"
                    className="fx-mi fx-strong"
                    onClick={() => {
                      setSt({ ...st, favorites: fav ? st.favorites.filter((f) => f !== t.path) : [...st.favorites, t.path] });
                      setMenu(null);
                    }}
                  >
                    {fav ? "★ 지금 폴더 빼기" : "☆ 지금 폴더 더하기"}
                  </button>
                )}
                {st.favorites.length > 0 && <div className="fx-sep" />}
                {st.favorites.map((f) => (
                  <button
                    key={f}
                    type="button"
                    className="fx-mi"
                    title={f}
                    onClick={() => {
                      go(pane, f);
                      setMenu(null);
                    }}
                  >
                    <FileIcon name={baseName(f)} path={f} dir size={16} />
                    <span className="fx-ellip">{baseName(f)}</span>
                    <span className="fx-k fx-ellip">{parentOf(f) ?? ""}</span>
                  </button>
                ))}
                {!st.favorites.length && t.find && <span className="fx-mi fx-dim">즐겨찾기가 없어요</span>}
              </div>
            )}
          </div>
        </div>
        {t.find && (
          <div className="fx-findband">
            <span className="fx-strong">{t.find.form.name || (t.find.form.text ? `"${t.find.form.text}"` : "*")}</span>
            <span className="fx-dim fx-ellip">{findSummary(t.find.form)}</span>
            <span className="fx-grow" />
            <span className="fx-dim">{t.find.running ? "찾는 중…" : `${t.find.results.length}개 찾음 · 폴더 ${new Set(t.find.results.map((r) => parentOf(r.path))).size}곳`}</span>
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
            <button type="button" className="fx-fk" onClick={() => void rerunFind(pane)}>
              다시 찾기
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
              <button type="button" className="fx-hcell fx-col fx-r" onClick={() => sortBy("size")}>
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
          {listing.error && !t.find && <div className="fx-empty fx-err">{listing.error}</div>}
          {!listing.error && !t.find && !listing.loading && !rows.length && <div className="fx-empty">{filters[pane] ? "빠른 필터에 맞는 것이 없어요" : "비어 있어요"}</div>}
          {t.find && !t.find.running && !rows.length && <div className="fx-empty">찾은 것이 없어요</div>}
          {!t.find && parentOf(t.path) && (p.view === "detail" || p.view === "brief") && (
            <div className={p.view === "brief" ? "fx-brow" : "fx-frow"} style={p.view === "detail" ? colStyle : undefined} onDoubleClick={() => up(pane)} title="두 번 누르면 위 폴더 (Backspace)">
              <span className="fx-up">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </span>
              <span className="fx-dim fx-strong">..</span>
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
              <span className="fx-up fx-up-big" style={{ width: p.view === "thumb" ? 88 : 48, height: p.view === "thumb" ? 66 : 48 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </span>
              <span className="fx-dim fx-strong">..</span>
            </div>
          )}
          {rows.map((r, i) => {
            const isSel = s.paths.has(r.path) || (!s.paths.size && s.cursor === r.path);
            const common = {
              id: `fx-row-${pane}-${i}`,
              "data-sel": isSel ? "1" : "0",
              "data-cur": s.cursor === r.path && on ? "1" : "0",
              "data-hid": r.hidden ? "1" : "0",
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
                    {thumb ? <Thumb path={r.path} /> : <FileIcon name={r.name} path={r.path} dir={r.dir} size={big} />}
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
                  <FileIcon name={r.name} path={r.path} dir={r.dir} size={16} />
                  <span className="fx-bn" style={{ fontWeight: r.dir ? 600 : 400 }}>
                    {inline && inline.path === r.path ? nameCell(r) : r.name}
                  </span>
                </div>
              );
            }
            return (
              <div key={r.path} className="fx-frow" style={colStyle} {...common}>
                <span className="fx-icell">
                  <FileIcon name={r.name} path={r.path} dir={r.dir} size={16} />
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
                {cfg.cols.size && <span className="fx-col fx-num">{r.dir ? "" : formatSize(r.size)}</span>}
                {cfg.cols.modified && <span className="fx-col fx-dim fx-tab-num">{formatDate(r.modified, fmt)}</span>}
                {cfg.cols.type && (
                  <span className="fx-col fx-dim" title={typeName(r, types)}>
                    <span className="fx-ellip">{typeName(r, types)}</span>
                  </span>
                )}
              </div>
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

  const anySelected = selected(st.active).length > 0;

  return (
    <div className="fx-root">
      <div className="fx-top">
        <h1 className="title fx-title">탐색기</h1>
        <div className="fx-findbox fx-rel">
          <label className="search fx-search">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              ref={quickRef}
              aria-label="파일 찾기"
              placeholder="파일 찾기"
              value={quickFind}
              onChange={(e) => setQuickFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && quickFind.trim()) {
                  void runFind({ ...EMPTY_FIND, name: quickFind.trim(), sub: true });
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
                  <input className="input fx-grow" value={form.where} onChange={(e) => setForm({ ...form, where: e.target.value })} />
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
        <button
          type="button"
          className="btn btn-ctrl"
          title="고른 파일을 윈도우 탐색기에서 열고 우클릭 메뉴를 띄워요(보안 해제는 윈도우 탐색기에서만 돼요)"
          disabled={!anySelected}
          onClick={() => void revealRows(selected(st.active))}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 7.5-2" />
          </svg>
          보안 해제
        </button>
        <button type="button" className="btn btn-ctrl" onClick={() => void openBatch(st.active)}>
          일괄 이름 바꾸기
        </button>
        <span className="fx-vsep" />
        <button type="button" className="btn btn-ctrl fx-sq" aria-label="폴더 트리" title="폴더 트리" aria-pressed={st.tree.on} onClick={() => setSt({ ...st, tree: { ...st.tree, on: !st.tree.on } })}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h6M8 12h8M12 19h8M8 5v14" />
          </svg>
        </button>
        <button type="button" className="btn btn-ctrl fx-sq" aria-label="2창" title="2창" aria-pressed={!st.four} onClick={() => setSt({ ...st, four: false, active: Math.min(st.active, 1) })}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M12 4v16" />
          </svg>
        </button>
        <button type="button" className="btn btn-ctrl fx-sq" aria-label="4창" title="4창" aria-pressed={st.four} onClick={() => setSt({ ...st, four: true })}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M12 4v16M3 12h18" />
          </svg>
        </button>
      </div>

      <div className="fx-body">
        {st.tree.on && (
          <>
            <aside className="fx-tree" aria-label="폴더 트리" style={{ width: st.tree.width }}>
              <div className="fx-tree-head">폴더</div>
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
                    <Fragment key={r.path}>
                      {r.drive && !r.first && <div className="fx-tree-gap" />}
                      <div
                        className={r.drive ? "fx-tr fx-tr-drive" : "fx-tr"}
                        data-on={on ? "1" : "0"}
                        data-path={path ? "1" : "0"}
                        title={r.path}
                        onClick={() => go(st.active, r.path)}
                        onDragOver={(e) => dragSrc.current && e.preventDefault()}
                        onDrop={(e) => dropTo(st.active, e, r.path)}
                        onContextMenu={(e) => {
                          e.preventDefault();
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
                            if (r.hasKids) toggleOpen(r.path);
                          }}
                        >
                          {r.hasKids && (
                            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : undefined }}>
                              <path d="M9 6l6 6-6 6" />
                            </svg>
                          )}
                        </span>
                        <span className="fx-tico">
                          {r.drive ? (
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
        <div className={st.four ? "fx-panes fx-four" : "fx-panes"}>{Array.from({ length: paneCount }, (_, i) => renderPane(i))}</div>
      </div>

      <div className="fx-keys">
        <span className="fx-fk"><b>F2</b> 이름 바꾸기</span>
        <span className="fx-fk"><b>F3</b> 열기</span>
        <span className="fx-fk"><b>F5</b> 복사 → 대상</span>
        <span className="fx-fk"><b>F6</b> 옮기기 → 대상</span>
        <span className="fx-fk"><b>F7</b> 새 폴더</span>
        <span className="fx-fk"><b>F8</b> 지우기</span>
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
  return (
    <span className={small ? "fx-lock fx-lock-s" : "fx-lock"} title="회사 보안(DRM)이 걸린 것 같아요">
      <svg aria-hidden="true" width={small ? 9 : 10} height={small ? 9 : 10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
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
