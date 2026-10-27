// 탐색기(11단계) 화면. 시안 캔버스 Files·FilesTree·FilesConflict·FilesMenu 판, 사양서 "탐색기 (11단계)" 절이 기준이에요.
// - 왼쪽 폴더 트리(2안: 안내선 + 드라이브 띠 + 지금 경로) + 2창(기본)/4창(2×2).
// - 창마다 탭 줄 → 드라이브 줄(드라이브 · 빠른 필터 · 보기 ▾) → 경로 줄(경로 · 경로 복사 · 윈도우 탐색기로 열기 · ★) → 목록 → 상태 줄.
// - 우클릭(파일·폴더·빈 곳)은 윈도우 우클릭 메뉴 그대로(2안), 탭 우클릭만 기록 메뉴.
// - 상태(탭·열 폭·정렬·보기·트리·즐겨찾기·찾기 조건·일괄 이름 바꾸기 설정)는 암호화 파일 kv "files.state".
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, inApp } from "../../api";
import { FileIcon } from "../../FileIcon";
import {
  EMPTY_FIND,
  FilesState,
  FindForm,
  FsDrive,
  FsEntry,
  FsPane,
  Layout,
  cellOf,
  clearTabs,
  paneCountOf,
  RenameOpts,
  SortKey,
  TREE_W,
  VIEWS,
  ViewMode,
  baseName,
  bothName,
  cleanPath,
  driveOf,
  extOf,
  formatDate,
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
  isLnk,
  isReservedName,
  shownName,
  tidyName,
  inZip,
  isZipFile,
  zipOrIn,
} from "../../files";
import { Conflict, FastStatus, MenuExtra, MenuResult, Step, TreeDir, fsApi, fsErrorText, onFsChanged, onFsProgress } from "../../filesApi";
import { parseDate } from "../../journal";
import { DateInput } from "../../DateInput";
import { useOutsideClose } from "../../useOutsideClose";
import { DEFAULT_FILES_SETTINGS, FilesSettings, loadSettings, saveSettings } from "../../settingsStore";
import { SearchBox } from "../../SearchBox";
import { PickMenu, TabMenu } from "./Menu";
import { PaneCtx, Preview, renderPane } from "./Table";
import { handleKey } from "./keys";
import { AskDialog, ConflictDialog, Decision, DeleteDialog, NameDialog, RenameDialog, TransferAsk } from "./Dialogs";
import { DATE_TIME_GAP, EMPTY_SEL, FindRun, Listing, Pop, RPane, RState, Row, Sel } from "./parts";

const STATE_KEY = "files.state";
const ZIP_RO = "zip 파일 안은 읽기만 돼요 – 꺼내려면 다른 폴더로 복사해 주세요";
/** Ctrl+휠로 바꾸는 보기 차례(작은 것 → 큰 것, 호환 B) */
const VIEW_SIZES: ViewMode[] = ["detail", "brief", "icons", "thumb"];
const SORT_NAME: Record<SortKey, string> = { name: "이름", modified: "수정한 날짜", type: "유형", size: "크기", folder: "폴더" };

let tabSeq = 1;
/** 이번 실행에서 '끌 때 열린 탭 비우기'를 이미 했는지 */
let clearedThisRun = false;
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

export default function FilesScreen() {
  const [st, setSt] = useState<RState | null>(null);
  const stRef = useRef<RState | null>(null);
  stRef.current = st;
  const [home, setHome] = useState("");
  const [cfg, setCfg] = useState<FilesSettings>(DEFAULT_FILES_SETTINGS);
  /** 파일 형식 이름(".xlsx" → "Microsoft Excel 워크시트") – 확장자마다 한 번만 윈도우에 물어요 */
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
  /** 즐겨찾기 목록(load가 읽어요 – 바뀌면 즐겨찾기를 보는 창을 다시 읽어요) */
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
  const [inline, setInline] = useState<{ pane: number; path: string; value: string; dir?: boolean } | null>(null);
  // 예/아니요 묻는 작은 창(확장자 바꾸기·같은 이름·폴더 합치기 등)
  const [ask, setAsk] = useState<{ title: string; sub: string; yes: string; resolve: (ok: boolean) => void } | null>(null);
  const askYes = (title: string, sub: string, yes: string) => new Promise<boolean>((resolve) => setAsk({ title, sub, yes, resolve }));
  const [menu, setMenu] = useState<{ kind: "view" | "fav" | "tab"; pane: number; tab?: number; x?: number; y?: number } | null>(null);
  /** 작은 고르기 메뉴(경로 › 아래 폴더 · 열 머리 · 오른쪽 끌기 놓기 – 호환 B) */
  const [pop, setPop] = useState<Pop | null>(null);
  /** 주소 칸 자동 완성(호환 B) */
  const [sugg, setSugg] = useState<{ pane: number; items: TreeDir[]; i: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [quickFind, setQuickFind] = useState("");
  // 빠른 찾기 도우미(설치할 때 함께 깔림) – 목록이 준비된 드라이브가 있으면 "모든 드라이브"를 바로 찾아요.
  const [fast, setFast] = useState<FastStatus | null>(null);
  const fastReady = cfg.fast && !!fast?.running && fast.drives.some((d) => d.ready);
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
  // 고무줄 고르기(빈 곳에서 끌기)
  const [band, setBand] = useState<{ pane: number; x0: number; y0: number; x1: number; y1: number; base: Set<string> } | null>(null);
  // F5·F6 확인 창
  const [xfer, setXfer] = useState<{ pane: number; op: "copy" | "move"; items: Row[]; dest: string } | null>(null);
  const [renameRows, setRenameRows] = useState<{ pane: number; rows: (FsEntry & { parentName: string; folder: string })[]; where: string } | null>(null);
  const [undo, setUndo] = useState<{ path: string; name: string }[] | null>(null);
  const batchHist = useRef<{ label: string } | null>(null);
  const [nameAsk, setNameAsk] = useState<{ title: string; value: string; ok: (v: string) => void } | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState<{ done: number; total: number; name: string } | null>(null);
  const [tree, setTree] = useState<Map<string, TreeDir[]>>(new Map());
  const quickRef = useRef<HTMLInputElement>(null);
  const findNameRef = useRef<HTMLInputElement>(null);
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
      const read = readState(raw, startDir);
      // 끌 때 열린 탭 비우기: 앱을 켠 뒤 처음 열 때 한 번만(잠금·화면 오가기로는 비우지 않아요)
      const saved = fc.clearOnExit && !clearedThisRun ? clearTabs(read, startDir) : read;
      clearedThisRun = true;
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

  const paneCount = st ? paneCountOf(st.layout) : 2;
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

  /** 대상 창: 두칸은 반대 창, 세칸·네칸은 바로 전에 있던 창 */
  const targetOf = (pane: number) => {
    if (!st || paneCount === 2) return pane === 0 ? 1 : 0;
    return prev !== pane && prev < paneCount ? prev : nextPane(pane, st.layout);
  };

  /** 네칸 → 두칸: 지금 창과 대상 창을 네칸 자리 순서대로 두 칸에 남기고, 나머지는 뒤로(2026-10-18 사용자 1안) */
  const toTwo = () => {
    if (!st) return;
    const L = st.layout;
    // 두칸에서 한 번 더: 좌우 ↔ 상하(같은 두 창, 방향만)
    if (L === "lr" || L === "tb") return setSt({ ...st, layout: L === "lr" ? "tb" : "lr" });
    if (L === "3l" || L === "3r") {
      // 세칸 → 두칸: 1·2창이 남아요. 지금 창이 3창이면 2창 자리와 바꿔 보이게 해요.
      if (st.active === 2) {
        const pm = st.perm ?? [0, 1, 2, 3];
        setPrev(0);
        return setSt({ ...st, layout: "lr", perm: [pm[0], pm[2], pm[1], pm[3]], panes: [st.panes[0], st.panes[2], st.panes[1], st.panes[3]], active: 1 });
      }
      setPrev(st.active === 0 ? 1 : 0);
      return setSt({ ...st, layout: "lr" });
    }
    const a = st.active;
    const t = targetOf(a);
    const keep = [a, t].sort((x, y) => x - y);
    const perm = [...keep, ...[0, 1, 2, 3].filter((i) => !keep.includes(i))];
    setPrev(perm.indexOf(t));
    setSt({ ...st, layout: "lr", perm, panes: perm.map((i) => st.panes[i]), active: perm.indexOf(a) });
  };
  /** 세칸보기(2026-10-25 사용자 1안): 다른 모양에서 누르면 왼쪽 긴 칸, 세칸에서 한 번 더 누르면 왼쪽 ↔ 오른쪽 긴 칸 */
  const toThree = () => {
    if (!st) return;
    const L = st.layout;
    if (L === "3l" || L === "3r") return setSt({ ...st, layout: L === "3l" ? "3r" : "3l" });
    // 두칸 → 세칸: 1·2창은 그대로, 3창이 짧은 칸 아래에 더해져요
    if (L !== "four") return setSt({ ...st, layout: "3l" });
    // 네칸 → 세칸: 왼쪽 위(긴 칸)·오른쪽 위·오른쪽 아래 자리 그대로, 왼쪽 아래 창이 뒤로. 지금 창이 왼쪽 아래면 대상 창이 아닌 자리와 바꿔요.
    const a = st.active;
    const t = targetOf(a);
    const slots = [0, 1, 3];
    if (!slots.includes(a)) slots[[2, 1, 0].find((k) => slots[k] !== t)!] = a;
    const perm = [...slots, ...[0, 1, 2, 3].filter((i) => !slots.includes(i))];
    const ti = perm.indexOf(t);
    setPrev(ti < 3 ? ti : (perm.indexOf(a) + 1) % 3);
    setSt({ ...st, layout: "3l", perm, panes: perm.map((i) => st.panes[i]), active: perm.indexOf(a) });
  };
  /** 두칸 → 네칸: 옮겨 둔 자리를 되돌려 창마다 원래 자리로 */
  const toFour = () => {
    if (!st || st.layout === "four") return;
    const perm = st.perm;
    if (!perm) return setSt({ ...st, layout: "four" });
    const panes = [...st.panes];
    perm.forEach((orig, k) => (panes[orig] = st.panes[k]));
    const other = perm[targetOf(st.active)];
    setPrev(other);
    setSt({ ...st, layout: "four", perm: undefined, panes, active: perm[st.active] });
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
  /** 뒤에 새 탭(가운데 단추로 폴더 누르기·여러 개 열기 – 윈도우처럼 지금 탭은 그대로) */
  const newTabBg = (pane: number, path: string) => updPane(pane, (p) => ({ ...p, tabs: [...p.tabs, { path, pinned: false, id: tabSeq++ }] }));

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
    // zip 파일은 폴더처럼 들어가요 · zip 안 파일은 임시 폴더에 풀어 열어요(호환 B)
    if (isZipFile(e)) {
      if (newTabIfFolder) newTab(pane, e.path);
      else go(pane, e.path);
      return;
    }
    if (!e.dir && inZip(e.path)) {
      void fsApi
        .zipExtract([e.path])
        .then((out) => fsApi.open(out[0]))
        .catch((er) => flash(fsErrorText(er)));
      return;
    }
    if (e.dir) {
      if (newTabIfFolder) newTab(pane, e.path);
      else go(pane, e.path);
      return;
    }
    // 폴더 바로가기(.lnk)는 기록 안에서 그 폴더로(호환 A11)
    if (/\.lnk$/i.test(e.name)) {
      void (async () => {
        const target = await fsApi.lnkTarget(e.path).catch(() => null);
        if (target && (await fsApi.isDir(target).catch(() => false))) {
          if (newTabIfFolder) newTab(pane, target);
          else go(pane, target);
        } else void fsApi.open(e.path).catch((er) => flash(fsErrorText(er)));
      })();
      return;
    }
    void fsApi.open(e.path).catch((er) => flash(fsErrorText(er)));
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

  // ---------- 되돌리기·다시 하기(Ctrl+Z·Y, 호환 A1 – 2026-10-20) ----------
  // 이 앱에서 한 옮기기·복사·이름 바꾸기·휴지통 지우기·새 폴더만(완전 지우기·덮어쓴 파일·윈도우 메뉴로 한 일은 빼요).
  // 앱을 끄면 잊어요. 한 일마다 거꾸로 할 걸음(undo)과 다시 할 걸음(redo)을 함께 둬요.
  type Act = { steps: Step[] } | { renames: { path: string; name: string }[] };
  type Hist = { label: string; undo: Act; redo: Act };
  const hist = useRef<{ undo: Hist[]; redo: Hist[] }>({ undo: [], redo: [] });
  const record = (h: Hist) => {
    const H = hist.current;
    H.undo.push(h);
    if (H.undo.length > 50) H.undo.shift();
    H.redo = [];
    return h;
  };
  const nowSec = () => Math.floor(Date.now() / 1000);
  const undoRedo = async (redo: boolean) => {
    const H = hist.current;
    const h = (redo ? H.redo : H.undo).pop();
    if (!h) return flash(redo ? "다시 할 것이 없어요" : "되돌릴 것이 없어요");
    const act = redo ? h.redo : h.undo;
    const word = redo ? "다시 했어요" : "되돌렸어요";
    try {
      if ("renames" in act) {
        const back = await fsApi.renameMany(act.renames);
        if (redo) h.undo = { renames: back };
        else h.redo = { renames: back };
      } else {
        const t = nowSec();
        const sum = await fsApi.undo(act.steps);
        // 휴지통으로 보낸 걸음이면 꺼낼 때 그 뒤에 지운 것을 찾아요
        const other = redo ? h.undo : h.redo;
        if (act.steps.some((x) => x.k === "trash") && "steps" in other) other.steps.forEach((x) => x.k === "restore" && (x.since = t));
        if (sum.errors.length) {
          // 일부만 됐으면 기록에서 빼요(다시 맞추기 어려워요)
          refreshAll();
          return flash(`${word}: ${h.label} – 못 한 것 ${sum.errors.length}개 – ${fsErrorText(sum.errors[0][1])}`);
        }
      }
      (redo ? H.undo : H.redo).push(h);
      flash(`${word}: ${h.label}`);
    } catch (e) {
      flash(fsErrorText(e));
    }
    refreshAll();
  };
  /** 새 폴더를 만들고 바로 이름을 적은 것은 한 번에 되돌려요(윈도우처럼 "새 폴더" 이름 칸까지 한 일) */
  const newDirRef = useRef<{ path: string; h: Hist } | null>(null);
  const recordRename = (from: string, to: string) => {
    const nd = newDirRef.current;
    newDirRef.current = null;
    const H = hist.current;
    if (nd && nd.path === from && H.undo[H.undo.length - 1] === nd.h) {
      nd.h.label = `새 폴더 '${baseName(to)}'`;
      nd.h.undo = { steps: [{ k: "trash", paths: [to] }] };
      nd.h.redo = { steps: [{ k: "mkdir", path: to }] };
      return;
    }
    record({ label: `이름 바꾸기 '${baseName(from)}' → '${baseName(to)}'`, undo: { steps: [{ k: "move", from: to, to: from }] }, redo: { steps: [{ k: "move", from, to }] } });
  };
  const recordMkdir = (p: string) => record({ label: `새 폴더 '${baseName(p)}'`, undo: { steps: [{ k: "trash", paths: [p] }] }, redo: { steps: [{ k: "mkdir", path: p }] } });

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

  /** F5·F6: 고른 것과 대상 폴더를 보여 주고 확인을 받아요(2026-10-20 사용자 1안) */
  const askTransfer = (pane: number, op: "copy" | "move") => {
    if (!st) return;
    const items = selected(pane);
    if (!items.length) return;
    const t = activeTab(st.panes[targetOf(pane)]);
    if (t.find) return flash("대상 창이 찾기 결과예요. 폴더를 연 창으로 보내 주세요.");
    if (isSpecial(t.path)) return flash("대상 창이 내 PC·즐겨찾기예요. 폴더를 연 창으로 보내 주세요.");
    setXfer({ pane, op, items, dest: t.path });
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
    if (zipOrIn(dest)) return flash(ZIP_RO), false;
    let sources = src.map((e) => e.path);
    try {
      // zip 안의 것은 임시 폴더에 풀어 복사해요(zip은 읽기만 – 옮기기도 복사로)
      if (sources.some((x) => inZip(x))) {
        sources = await fsApi.zipExtract(sources);
        op = "copy";
      }
      const list = await fsApi.conflicts(sources, dest);
      const dec = await askConflicts(list, op);
      if (!dec) return false;
      setBusy({ done: 0, total: sources.length, name: "" });
      const sum = await fsApi.transfer(op, sources, dest, dec);
      setBusy(null);
      const verb = op === "copy" ? "복사" : "옮기기";
      const pairs = sum.pairs ?? [];
      if (pairs.length)
        record({
          label: `${verb} ${pairs.length}개${sum.overwritten ? ` (덮어쓴 ${sum.overwritten}개 빼고)` : ""}`,
          undo: { steps: op === "copy" ? [{ k: "trash", paths: pairs.map(([, t]) => t) }] : [...pairs].reverse().map(([f, t]) => ({ k: "move" as const, from: t, to: f })) },
          redo: { steps: pairs.map(([f, t]) => ({ k: op, from: f, to: t })) },
        });
      flash(sum.errors.length ? `${verb} ${sum.done}개 · 못 한 것 ${sum.errors.length}개 – ${fsErrorText(sum.errors[0][1])}` : `${verb} ${sum.done}개${sum.skipped ? ` · 건너뜀 ${sum.skipped}개` : ""}`);
      refreshAll();
      return !sum.errors.length;
    } catch (e) {
      setBusy(null);
      flash(fsErrorText(e));
    }
    refreshAll();
    return false;
  };

  // ---------- 클립보드(Ctrl+C·X·V) – 윈도우 클립보드와 같이 써요 ----------
  const [cut, setCut] = useState<Set<string>>(new Set());
  const clipPut = async (pane: number, isCut: boolean) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    if (!t.find && t.path === PC) return flash("드라이브는 복사할 수 없어요.");
    const items = selected(pane);
    if (!items.length) return;
    let paths = items.map((r) => r.path);
    try {
      // zip 안의 것은 풀어 둔 것을 복사해요(잘라내기도 복사로)
      if (paths.some((x) => inZip(x))) {
        paths = await fsApi.zipExtract(paths);
        isCut = false;
      }
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
    if (zipOrIn(t.path)) return flash(ZIP_RO);
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

  const refreshRef = useRef<() => void>(() => {});
  const refreshAll = () => listsRef.current.forEach((l, i) => l.path && void load(i, l.path, true));
  refreshRef.current = refreshAll;

  const askDelete = (pane: number, permanent: boolean) => {
    const items = selected(pane);
    if (!items.length) return;
    if (items.some((x) => inZip(x.path))) return flash(ZIP_RO);
    if (!permanent && !cfg.askDelete) return void doDelete(pane, items, false);
    setDel({ items, permanent, pane });
  };

  const doDelete = async (pane: number, items: FsEntry[], permanent: boolean) => {
    setDel(null);
    try {
      const t = nowSec();
      const paths = items.map((i) => i.path);
      await fsApi.remove(paths, permanent);
      if (!permanent) record({ label: `지우기 ${paths.length}개`, undo: { steps: [{ k: "restore", paths, since: t }] }, redo: { steps: [{ k: "trash", paths }] } });
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
    if (items.some((x) => inZip(x.path))) return flash(ZIP_RO);
    if (items.length > 1) return openBatch(pane);
    const e = items[0];
    if (!e) return;
    if (inZip(e.path)) return flash(ZIP_RO);
    setInline({ pane, path: e.path, value: shownName(e), dir: e.dir });
  };

  /** 이름 칸 마치기. then은 이름을 바꾼 뒤(또는 바꿀 것이 없을 때) 이어서 할 일(Tab = 다음 파일 이름 칸) */
  const commitInline = async (then?: () => void) => {
    if (!inline) return;
    const it = inline;
    setInline(null);
    const ent = lists[it.pane]?.entries.find((x) => x.path === it.path);
    const dir = it.dir ?? ent?.dir ?? false;
    const lnk = isLnk({ name: baseName(it.path), dir });
    // 윈도우처럼 앞뒤 칸·끝 점은 저절로 지워요(호환 B)
    let name = tidyName(it.value);
    if (name && lnk) name += ".lnk";
    if (!name || name === baseName(it.path)) {
      newDirRef.current = null;
      return then?.();
    }
    if (isReservedName(name)) {
      flash(fsErrorText("reserved_name"));
      return setInline(it);
    }
    // 확장자를 바꾸면 윈도우처럼 물어요(호환 B)
    if (!dir && !lnk && extOf(name) !== extOf(baseName(it.path)) && !(await askYes("확장자를 바꿀까요?", "확장자를 바꾸면 파일을 못 쓰게 될 수도 있어요.", "바꾸기"))) return setInline(it);
    const parent = parentOf(it.path) ?? "";
    let to: string;
    try {
      to = await fsApi.rename(it.path, name);
    } catch (e) {
      if (String(e) !== "exists") {
        flash(fsErrorText(e));
        // 실패해도 이름 칸을 닫지 않고 고칠 수 있게(호환 A10)
        return setInline(it);
      }
      // 이미 있는 이름(호환 B): 파일은 "이름 (2)"로 바꿀지, 폴더는 합칠지 물어요
      const taken = new Set((lists[it.pane]?.entries ?? []).map((x) => x.name.toLowerCase()));
      if (!dir) {
        const alt = bothName(name, (n) => taken.has(n.toLowerCase()));
        if (!(await askYes(`'${shownName({ name, dir })}'이(가) 이미 있어요`, `'${shownName({ name: alt, dir })}'(으)로 바꿀까요?`, "바꾸기"))) return setInline(it);
        try {
          to = await fsApi.rename(it.path, alt);
        } catch (e2) {
          flash(fsErrorText(e2));
          return setInline(it);
        }
      } else {
        if (!(await askYes("폴더를 합칠까요?", `'${name}' 폴더가 이미 있어요. 안의 것을 그 폴더로 옮겨요(같은 이름 파일은 건너뛰어요).`, "합치기"))) return setInline(it);
        const sum = await fsApi.undo([{ k: "move", from: it.path, to: joinPath(parent, name) }]).catch((e3) => ({ done: 0, skipped: 0, errors: [["", String(e3)]] as [string, string][] }));
        flash(sum.errors.length ? `합쳤어요 · 못 옮긴 것 ${sum.errors.length}개 – ${fsErrorText(sum.errors[0][1])}` : "폴더를 합쳤어요");
        refreshAll();
        return then?.();
      }
    }
    recordRename(it.path, to);
    if (st && activeTab(st.panes[it.pane]).find) {
      updPane(it.pane, (p) => ({
        ...p,
        tabs: p.tabs.map((t, i) => (i === p.active && t.find ? { ...t, find: { ...t.find, results: t.find.results.map((r) => (r.path === it.path ? { ...r, path: to, name: baseName(to) } : r)) } } : t)),
      }));
    } else {
      await load(it.pane, listsRef.current[it.pane].path, true);
    }
    setSel(it.pane, { paths: new Set([to]), cursor: to, anchor: to });
    then?.();
  };

  const newFolder = async (pane: number) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    if (t.find || isSpecial(t.path)) return;
    if (zipOrIn(t.path)) return flash(ZIP_RO);
    try {
      const p = await mkdirFree(t.path, lists[pane].entries.map((e) => e.name));
      const name = baseName(p);
      newDirRef.current = { path: p, h: recordMkdir(p) };
      await load(pane, t.path, true);
      setSel(pane, { paths: new Set([p]), cursor: p, anchor: p });
      setInline({ pane, path: p, value: name, dir: true });
    } catch (e) {
      flash(fsErrorText(e));
    }
  };

  /** 트리 줄 이름 바꾸기(트리에는 이름 칸이 없어 작은 창으로) */
  const treeRename = (path: string) =>
    setNameAsk({
      title: "폴더 이름 바꾸기",
      value: baseName(path),
      ok: async (v) => {
        setNameAsk(null);
        const name = tidyName(v);
        if (!name || name === baseName(path)) return;
        try {
          recordRename(path, await fsApi.rename(path, name));
          refreshAll();
        } catch (e) {
          flash(fsErrorText(e));
        }
      },
    });
  /** 트리 줄 안에 새 폴더(이름을 먼저 물어요) */
  const treeNewFolder = (dir: string) =>
    setNameAsk({
      title: NEW_DIR,
      value: NEW_DIR,
      ok: async (v) => {
        setNameAsk(null);
        const name = tidyName(v);
        if (!name) return;
        try {
          // 처음 값 "새 폴더" 그대로면 같은 이름이 있을 때 "새 폴더 (2)"처럼 비는 번호로
          recordMkdir(name === NEW_DIR ? await mkdirFree(dir, []) : await fsApi.mkdir(dir, name));
          refreshAll();
        } catch (e) {
          flash(fsErrorText(e));
        }
      },
    });

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
      batchHist.current = record({ label: `이름 바꾸기 ${back.length}개`, undo: { renames: back }, redo: { renames: items } });
      refreshAll();
      if (renameRows) {
        const moved = new Map(back.map((b) => [joinPath(parentOf(b.path) ?? "", b.name), b.path]));
        setRenameRows({ ...renameRows, rows: renameRows.rows.map((r) => (moved.has(r.path) ? { ...r, path: moved.get(r.path)!, name: baseName(moved.get(r.path)!) } : r)) });
      }
      if (close) setRenameRows(null);
      return `${back.length}개 이름을 바꿨어요`;
    } catch (e) {
      // 2026-10-26 user 2안: Windows refused (e.g. C:\ root) – say who blocked it, and that nothing changed
      // (rename_many rolls back on failure). Other screens keep the short fsErrorText wording.
      if (String(e) === "denied") return "윈도우가 이 폴더의 파일 이름 바꾸기를 막았어요(관리자 권한이 필요한 폴더예요). 바뀐 파일은 없어요.";
      return fsErrorText(e);
    }
  };

  const undoBatch = async () => {
    if (!undo) return;
    try {
      const back = await fsApi.renameMany(undo);
      // 창 안 [되돌리기]로 한 것은 Ctrl+Z 기록에서도 빼요(두 번 되돌리지 않게)
      const H = hist.current;
      if (batchHist.current && H.undo[H.undo.length - 1] === batchHist.current) H.undo.pop();
      batchHist.current = null;
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

  /** "파일 위치 열기": 바로가기면 가리키는 것의 폴더, 아니면 그 파일의 폴더를 이 창에 열고 골라 둬요(호환 B) */
  const openLocation = async (pane: number, r: Row) => {
    const target = isLnk(r) ? await fsApi.lnkTarget(r.path).catch(() => null) : r.path;
    if (!target) return flash("바로가기가 가리키는 곳을 찾지 못했어요");
    const folder = parentOf(target);
    if (folder) go(pane, folder, target);
  };

  /** 빈 곳 메뉴에서 기록이 더한 줄을 골랐을 때 */
  const menuExtra = (pane: number, id: string) => {
    if (id.startsWith("view:")) updPane(pane, (x) => ({ ...x, view: id.slice(5) as ViewMode }));
    else if (id === "sort:asc" || id === "sort:desc") updPane(pane, (x) => ({ ...x, asc: id === "sort:asc" }));
    else if (id.startsWith("sort:")) updPane(pane, (x) => ({ ...x, sort: id.slice(5) as SortKey }));
    else if (id === "refresh") refreshAll();
    else if (id === "undo") void undoRedo(false);
    else if (id === "redo") void undoRedo(true);
  };
  /** 드라이브 단추·트리 드라이브 줄 우클릭 = 윈도우 드라이브 메뉴(꺼내기·포맷·속성 등, 호환 B) */
  const driveMenu = async (path: string, e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const r = await fsApi.contextMenu("", [path], e.clientX, e.clientY);
      if (r === "rename") flash("드라이브 이름은 윈도우 탐색기에서 바꿔 주세요");
      else if (r === "done") window.setTimeout(() => void fsApi.drives().then(setDrives).catch(() => {}), 500);
    } catch (er) {
      if (String(er) === "windows_only") flash("우클릭 메뉴는 윈도우에서 떠요(미리 보기에서는 안 돼요)");
      else flash("윈도우 메뉴를 띄우지 못했어요");
    }
  };

  const shellMenu = async (pane: number, e: React.MouseEvent | null, rowsForMenu: Row[]) => {
    if (!st) return;
    const t = activeTab(st.panes[pane]);
    let dir = t.find ? "" : t.path;
    let names = rowsForMenu.map((r) => r.name);
    if (rowsForMenu.length) {
      // 여러 폴더에 걸친 찾기 결과·즐겨찾기·드라이브는 전체 경로로 넘겨 한 메뉴로(호환 B) – dir ""이 그 표시
      const parents = new Set(rowsForMenu.map((r) => parentOf(r.path)));
      const par = parentOf(rowsForMenu[0].path);
      if (parents.size > 1 || !par) {
        dir = "";
        names = rowsForMenu.map((r) => r.path);
      } else dir = par;
    } else if (!dir || isSpecial(dir)) return;
    const onDrives = !dir && rowsForMenu.every((r) => /^[A-Za-z]:\\$/.test(r.path));
    // 빈 곳 메뉴의 "새로 만들기"(텍스트 문서 등)로 생긴 것을 찾아 이름 칸을 열려고 지금 목록을 기억해요
    const before = !names.length && !t.find ? new Set(lists[pane].entries.map((x) => x.path)) : null;
    // 빈 곳 메뉴 맨 위: 보기·정렬 기준·새로 고침·실행 취소(윈도우 탐색기와 같은 자리, 호환 B)
    const p = st.panes[pane];
    const H = hist.current;
    const lastU = H.undo[H.undo.length - 1];
    const lastR = H.redo[H.redo.length - 1];
    const extra: MenuExtra[] | undefined = names.length
      ? undefined
      : [
          { id: "view", label: "보기", items: VIEWS.map((v) => ({ id: `view:${v.id}`, label: `${v.name}\t${v.key}`, checked: p.view === v.id })) },
          {
            id: "sort",
            label: "정렬 기준",
            items: [
              ...(["name", "modified", "type", "size"] as SortKey[]).map((k) => ({ id: `sort:${k}`, label: SORT_NAME[k], checked: p.sort === k })),
              { id: "-", label: "-" },
              { id: "sort:asc", label: "오름차순", checked: p.asc },
              { id: "sort:desc", label: "내림차순", checked: !p.asc },
            ],
          },
          { id: "-", label: "-" },
          { id: "refresh", label: "새로 고침\tCtrl+R" },
          ...(lastU ? [{ id: "undo", label: `실행 취소 – ${lastU.label}\tCtrl+Z` }] : []),
          ...(lastR ? [{ id: "redo", label: `다시 실행 – ${lastR.label}\tCtrl+Y` }] : []),
        ];
    try {
      const r: MenuResult = await fsApi.contextMenu(dir, names, e ? e.clientX : -1, e ? e.clientY : -1, extra);
      if (r.startsWith("x:")) return menuExtra(pane, r.slice(2));
      if (onDrives && (r === "rename" || r === "newfolder")) return flash("드라이브 이름은 윈도우 탐색기에서 바꿔 주세요");
      if (onDrives && r === "done") return void window.setTimeout(() => void fsApi.drives().then(setDrives).catch(() => {}), 500);
      if (r === "rename") startRename(pane);
      else if (r === "newfolder") void newFolder(pane);
      else if (r === "reveal") void revealRows(rowsForMenu);
      else if (r === "openlocation" && rowsForMenu[0]) void openLocation(pane, rowsForMenu[0]);
      else if (r === "done" && before) {
        // 새로 생긴 것이 하나면 윈도우 탐색기처럼 바로 이름을 고치게 해요
        window.setTimeout(async () => {
          const now = await fsApi.list(dir, cfg.showHidden).catch(() => null);
          refreshAll();
          const added = now?.filter((x) => !before.has(x.path)) ?? [];
          if (added.length !== 1) return;
          const p = added[0].path;
          await load(pane, dir, true);
          setSel(pane, { paths: new Set([p]), cursor: p, anchor: p });
          setInline({ pane, path: p, value: shownName(added[0]), dir: added[0].dir });
        }, 400);
      } else if (r === "done") window.setTimeout(refreshAll, 300);
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
        noFast: !cfg.fast,
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

  // ---------- 키 ----------
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) =>
    handleKey(e, {
      activeTab, ask, askDelete, askTransfer, askYes, busy, clipPaste, clipPut, closeTab, conflict, copyPath, curPath, del, filterRefs,
      filters, findNameRef, findOpen, flash, focusPane, form, home, menu, nameAsk, newFolder, newTab, newTabBg, openEntry, paneCount, pop,
      quickFind, refresh, refreshAll, renameRows, rowsOf, selected, sels, setEditPath, setFilters, setFindOpen, setForm, setMenu, setPop,
      setSel, setSt, shellMenu, st, startRename, stepHistory, undoRedo, up, updPane, xfer
    });
  useEffect(() => {
    const f = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // 바깥을 누르면 작은 메뉴가 닫혀요.
  useOutsideClose(
    !!(menu || findOpen || pop),
    [],
    (e) => {
      setMenu(null);
      setPop(null);
      if (!(e.target as HTMLElement).closest(".fx-findbox")) setFindOpen(false);
    },
    {
      ignore: ".fx-menu, .fx-menu-btn",
      on: "window",
      // 앱 창 밖으로 가면 메뉴도 닫혀요(✔5)
      onBlur: () => {
        setMenu(null);
        setPop(null);
      },
    },
  );

  // Ctrl+휠: 보기 크기 바꾸기(자세히 ↔ 간단히 ↔ 큰 아이콘 ↔ 썸네일, 호환 B)
  const wheelAt = useRef(0);
  useEffect(() => {
    const f = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".fx-list[data-pane]");
      if (!el) return;
      e.preventDefault();
      const now = performance.now();
      if (!e.deltaY || now - wheelAt.current < 150) return;
      wheelAt.current = now;
      updPane(Number(el.dataset.pane), (x) => {
        const i = Math.max(0, VIEW_SIZES.indexOf(x.view));
        const j = Math.max(0, Math.min(VIEW_SIZES.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
        return j === i ? x : { ...x, view: VIEW_SIZES[j] };
      });
    };
    window.addEventListener("wheel", f, { passive: false });
    return () => window.removeEventListener("wheel", f);
  }, [updPane]);

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
    for (let i = 0; i < paneCount; i++) if (activeTab(st.panes[i]).find) void rerunFind(i);
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
  /** 열 머리 우클릭으로 보일 열 고르기(호환 B) – 설정 "탐색기 › 보일 열"과 같은 값 */
  const toggleCol = async (k: "size" | "modified" | "type") => {
    const next = { ...cfg, cols: { ...cfg.cols, [k]: !cfg.cols[k] } };
    setCfg(next);
    try {
      const s = await loadSettings();
      await saveSettings({ ...s, files: { ...s.files, cols: next.cols } });
    } catch {
      /* 저장 못 해도 이번에는 보여요 */
    }
  };
  /** 경로 › 를 누르면 그 폴더의 아래 폴더 목록(호환 B) */
  const crumbList = async (pane: number, path: string, next: string | undefined, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const subs = await fsApi.subdirs(path, cfg.showHidden).catch(() => [] as TreeDir[]);
    if (!subs.length) return flash("아래 폴더가 없어요");
    setPop({
      x: r.left - 6,
      y: r.bottom + 2,
      scroll: true,
      items: subs.map((d) => ({ id: d.path, label: d.name, bold: !!next && d.path.toLowerCase() === next.toLowerCase() })),
      onPick: (id) => go(pane, id),
    });
  };
  /** 주소 칸 자동 완성: 친 경로의 위 폴더 안에서 이름이 그렇게 시작하는 폴더(호환 B) */
  const suggTimer = useRef(0);
  const suggSeq = useRef(0);
  const suggest = (pane: number, v: string) => {
    window.clearTimeout(suggTimer.current);
    const seq = ++suggSeq.current;
    suggTimer.current = window.setTimeout(async () => {
      const raw = v.trim().replace(/^"/, "");
      const i = raw.lastIndexOf("\\");
      if (i < 0 || !/^([A-Za-z]:|\\\\[^\\]+\\[^\\]+)/.test(raw)) return setSugg(null);
      const base = raw.slice(0, i + 1);
      const pre = raw.slice(i + 1).toLowerCase();
      const dir = /^[A-Za-z]:\\$/.test(base) ? base : base.slice(0, -1);
      const subs = await fsApi.subdirs(dir, cfg.showHidden).catch(() => [] as TreeDir[]);
      if (seq !== suggSeq.current) return;
      const items = subs.filter((d) => d.name.toLowerCase().startsWith(pre)).slice(0, 12);
      setSugg(items.length && !(items.length === 1 && items[0].name.toLowerCase() === pre) ? { pane, items, i: -1 } : null);
    }, 120);
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

  // 트리 맨 위 묶음: 즐겨찾기(★로 지정한 폴더, 처음 접힘 – 예전 "홈" 자리, 2026-10-19 사용자)·내 PC(드라이브, 처음 펼침) – 접기는 tree.open에 HOME·"::pc:fold"
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
  /** 머리 줄 단추(2026-10-19 사용자 1안): 기준 크기(1600×900)에 맞춘 90px 고정 – 넓어져도 늘리지 않고 남는 폭은 오른쪽 빈 곳.
      90px 단추가 다 안 들어가면 글자를 빼고 34×34 정사각형(고정)으로, 앞에서부터 차례로. 마우스를 올리면 이름이 떠요. */
  const toolsRef = useRef<HTMLDivElement>(null);
  const TOOL_W = 90;
  const TOOL_SQ = 34;
  /** 글자를 둔 채 줄일 수 있는 가장 좁은 폭 */
  const TOOL_MIN = 80;
  const [toolFit, setToolFit] = useState({ w: 90, compact: false, last: 0 });
  useEffect(() => {
    const el = toolsRef.current;
    if (!el) return;
    const fit = () => {
      const kids = [...el.children] as HTMLElement[];
      const btns = kids.filter((k) => k.classList.contains("fx-tool"));
      const other = kids.filter((k) => !k.classList.contains("fx-tool")).reduce((n, k) => n + k.offsetWidth + 4, 0); // 구분선 1 + 좌우 2
      const free = el.clientWidth - other - 8 * (kids.length - 1) - 1; // 마지막 단추 오른쪽 1px 착시 보정
      // 90px가 다 안 들어가면 글자를 둔 채 고르게 줄여요(2026-10-25 사용자 1안 – 세칸보기 단추가 늘어 1600에서 81px). 남는 폭은 마지막 단추가 맡아 오른쪽 끝을 창 끝에 맞춰요.
      const n = btns.length;
      const fitW = Math.floor((free + 1) / n);
      const compact = fitW < TOOL_MIN;
      const w = compact ? TOOL_SQ : Math.min(TOOL_W, fitW);
      const last = !compact && w < TOOL_W ? free - w * (n - 1) : 0;
      setToolFit((o) => (o.compact === compact && o.w === w && o.last === last ? o : { w, compact, last }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!st]);

  // ---------- 끌어다 놓기(창 사이, 윈도우 탐색기에서) ----------
  const dragSrc = useRef<{ pane: number; rows: Row[] } | null>(null);
  // USB를 꽂거나 빼면 드라이브 줄에 바로(호환 A12) – 3초마다 드라이브 목록을 다시 읽어 바뀌었을 때만 고쳐요
  useEffect(() => {
    if (!inApp) return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      void fsApi
        .drives()
        .then((dv) => setDrives((old) => (JSON.stringify(old) === JSON.stringify(dv) ? old : dv)))
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(t);
  }, []);

  // 고무줄 고르기: 움직이는 동안 사각형에 닿는 줄을 골라요
  const bandRef = useRef(band);
  bandRef.current = band;
  useEffect(() => {
    if (!band) return;
    const move = (e: MouseEvent) => {
      const b = bandRef.current;
      if (!b) return;
      if (!(e.buttons & 1)) return setBand(null);
      const nb = { ...b, x1: e.clientX, y1: e.clientY };
      setBand(nb);
      const [l, r] = [Math.min(nb.x0, nb.x1), Math.max(nb.x0, nb.x1)];
      const [t, bt] = [Math.min(nb.y0, nb.y1), Math.max(nb.y0, nb.y1)];
      if (r - l < 3 && bt - t < 3) return;
      const rows = rowsOf(nb.pane);
      const paths = new Set(nb.base);
      let last: string | null = null;
      rows.forEach((row, i) => {
        const el = document.getElementById(`fx-row-${nb.pane}-${i}`);
        if (!el) return;
        const rc = el.getBoundingClientRect();
        if (rc.right >= l && rc.left <= r && rc.bottom >= t && rc.top <= bt) {
          paths.add(row.path);
          last = row.path;
        }
      });
      setSel(nb.pane, { paths, cursor: last ?? sels[nb.pane].cursor, anchor: last ?? sels[nb.pane].anchor });
    };
    const up = () => setBand(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!band]);

  // 윈도우 끌기(2026-10-20 사용자: 기록 → 윈도우 탐색기로 끌어 내기): 줄을 누른 채 6px 넘게 움직이면 시작
  // 오른쪽 단추로 끌기(호환 B): 놓으면 "여기에 복사·여기로 이동·바로 가기" 메뉴. 윈도우 탐색기에 놓으면 윈도우가 같은 메뉴를 띄워요.
  const nativeDrag = useRef<{ x: number; y: number; paths: string[]; right?: boolean } | null>(null);
  const keepPick = useRef<{ pane: number; path: string } | null>(null);
  /** 이 시각까지 들어온 놓기는 오른쪽 끌기 · 이 시각까지 우클릭 메뉴를 띄우지 않음 */
  const rightUntil = useRef(0);
  const noCtxUntil = useRef(0);
  /** 미리 보기의 오른쪽 끌기(앱에서는 윈도우 끌기를 써요) */
  const [rdrag, setRdrag] = useState<{ paths: string[]; x: number; y: number } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = nativeDrag.current;
      if (!d) return;
      if (!(e.buttons & (d.right ? 2 : 1))) {
        nativeDrag.current = null;
        return;
      }
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 6) return;
      nativeDrag.current = null;
      keepPick.current = null;
      if (!inApp) {
        if (d.right) setRdrag({ paths: d.paths, x: e.clientX, y: e.clientY });
        return;
      }
      if (d.right) rightUntil.current = noCtxUntil.current = Date.now() + 3_600_000;
      void fsApi
        .startDrag(d.paths)
        .then((r) => r && window.setTimeout(() => refreshRef.current(), 300))
        .catch(() => {})
        .finally(() => {
          if (d.right) rightUntil.current = noCtxUntil.current = Date.now() + 800;
        });
    };
    const up = () => {
      nativeDrag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);
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
  const dropAtRef = useRef<(paths: string[], x: number, y: number, right?: boolean) => void>(() => {});
  useEffect(() => {
    if (!rdrag) return;
    const move = (e: MouseEvent) => setRdrag((o) => (o ? { ...o, x: e.clientX, y: e.clientY } : o));
    const up = (e: MouseEvent) => {
      if (e.button !== 2) return;
      noCtxUntil.current = Date.now() + 500;
      const r = rdrag;
      setRdrag(null);
      dropAtRef.current(r.paths, e.clientX, e.clientY, true);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [!!rdrag]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 끄는 동안 목록 위·아래 끝에 대면 그쪽으로 스크롤(호환 B) */
  const dragScroll = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(".fx-list, .fx-tree-body");
    if (!el) return;
    const rc = el.getBoundingClientRect();
    const edge = 28;
    if (y < rc.top + edge) el.scrollTop -= Math.ceil((rc.top + edge - y) / 2);
    else if (y > rc.bottom - edge) el.scrollTop += Math.ceil((y - (rc.bottom - edge)) / 2);
  };
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
  dropAtRef.current = (paths: string[], x: number, y: number, right = Date.now() < rightUntil.current) => {
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
    const d = dest;
    const linkAt = () => {
      if (zipOrIn(d)) return flash(ZIP_RO);
      void fsApi
        .makeLinks(srcs, d)
        .then((made) => {
          flash(`바로 가기 ${made.length}개를 만들었어요`);
          record({ label: `바로 가기 ${made.length}개`, undo: { steps: [{ k: "trash", paths: made }] }, redo: { steps: [] } });
          refreshAll();
        })
        .catch((er) => flash(fsErrorText(er)));
    };
    if (right) {
      // 오른쪽 끌기로 놓음: 윈도우처럼 고르는 메뉴(굵은 줄 = 왼쪽 끌기였으면 했을 일)
      rightUntil.current = 0;
      const ro = srcs.some((x) => inZip(x));
      const def = ro || driveOf(srcs[0]) !== driveOf(d) ? "copy" : "move";
      setPop({
        x,
        y,
        items: [
          { id: "copy", label: "여기에 복사", bold: def === "copy" },
          { id: "move", label: "여기로 이동", bold: def === "move", disabled: ro },
          { id: "link", label: "여기에 바로 가기 만들기", disabled: ro },
          "-",
          { id: "", label: "취소" },
        ],
        onPick: (id) => {
          if (id === "link") linkAt();
          else if (id === "copy" || id === "move") void transfer(pane, id, srcs.map((path) => ({ path }) as Row), d);
        },
      });
      return;
    }
    // 놓을 때 Ctrl = 복사 · Shift = 옮기기, 아니면 같은 드라이브 옮기기·다른 드라이브 복사(호환 A7, 윈도우와 같게)
    void fsApi.mods().then(([c, sh, alt]) => {
      // Alt(또는 Ctrl+Shift) 누른 채 놓기 = 바로가기 만들기(호환 B)
      if (alt || (c && sh)) return linkAt();
      const op = c ? "copy" : sh ? "move" : driveOf(srcs[0]) === driveOf(d) ? "move" : "copy";
      void transfer(pane, op, srcs.map((path) => ({ path }) as Row), d);
    });
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
            dragScroll(d.position.x / r, d.position.y / r);
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
  const paneCtx: PaneCtx = {
    activeTab, cfg, closeTab, commitInline, copyPath, crumbList, cut, dateMin, dragScroll, dragSrc, driveMenu, dropTo, editPath, extHover,
    filterRefs, filters, flash, fmt, focusPane, go, home, inline, keepPick, lists, menu, nativeDrag, newTab, newTabBg, noCtxUntil,
    openEntry, paneCount, rerunFind, rowsOf, selected, sels, setBand, setEditPath, setFilters, setFindOpen, setForm, setInline, setMenu,
    setPop, setSel, setSt, setSugg, shellMenu, st, stepHistory, sugg, suggest, targetOf, toggleCol, types, up, updPane, visibleDrives
  };

  return (
    <div className="fx-root">
      <div className="fx-top">
        <div className="fx-findbox fx-rel" style={{ width: st.tree.width }}>
          <SearchBox
            className="fx-search"
            inputRef={quickRef}
            aria-label="파일 찾기"
            placeholder={fastReady ? "모든 드라이브에서 찾기" : "파일 찾기"}
            value={quickFind}
            onChange={(e) => setQuickFind(e.target.value)}
            onClear={() => setQuickFind("")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && quickFind.trim()) {
                // 빠른 찾기는 이미 치는 대로 나와 있어요 – Enter는 결과 목록으로 옮겨 가기
                if (!fastReady) void runFind({ ...EMPTY_FIND, name: quickFind.trim(), sub: true });
                e.currentTarget.blur();
              }
              // 글자가 있으면 SearchBox가 지우고 커서를 둬요 – 빈 칸에서 Esc면 칸을 떠나요
              if (e.key === "Escape") e.currentTarget.blur();
            }}
            tail={
              <>
                {quickFind && <span className="fx-vsep fx-find-sep" aria-hidden="true" />}
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
              </>
            }
          />
          {findOpen && (
            <div className="fx-menu fx-findpanel" onKeyDown={(e) => e.key === "Escape" && setFindOpen(false)}>
              <div className="fx-fgrid">
                <span className="fx-dim">이름</span>
                <input ref={findNameRef} className="input" value={form.name} placeholder="*.jpg;*.png 또는 이름 일부" onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
                  <DateInput
                    base="input fx-date"
                    label="수정한 날 시작"
                    placeholder=""
                    fixOnEnter
                    invalid={formBad.from}
                    value={form.from}
                    onChange={(v) => setForm((f) => ({ ...f, from: v }))}
                    onLeave={(d) => setFormBad((b) => ({ ...b, from: d === null }))}
                  />
                  <span>~</span>
                  <DateInput
                    base="input fx-date"
                    label="수정한 날 끝"
                    placeholder="오늘"
                    fixOnEnter
                    invalid={formBad.to}
                    value={form.to}
                    onChange={(v) => setForm((f) => ({ ...f, to: v }))}
                    onLeave={(d) => setFormBad((b) => ({ ...b, to: d === null }))}
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
        <div className="fx-tools" ref={toolsRef} data-compact={toolFit.compact ? "1" : "0"} style={{ ["--tool-w" as string]: toolFit.w + "px", ...(toolFit.last ? { ["--tool-last" as string]: toolFit.last + "px" } : {}) }}>
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
          <button type="button" className="btn btn-ctrl fx-tool" title="두칸보기 · 한 번 더 누르면 좌우 ↔ 상하" aria-pressed={st.layout === "lr" || st.layout === "tb"} onClick={() => toTwo()}>
            <LayoutIcon kind={st.layout === "tb" ? "tb" : "lr"} />
            <span className="fx-tl">두칸보기</span>
          </button>
          <button type="button" className="btn btn-ctrl fx-tool" title="세칸보기 · 한 번 더 누르면 긴 칸 왼쪽 ↔ 오른쪽" aria-pressed={st.layout === "3l" || st.layout === "3r"} onClick={() => toThree()}>
            <LayoutIcon kind={st.layout === "3r" ? "3r" : "3l"} />
            <span className="fx-tl">세칸보기</span>
          </button>
          <button type="button" className="btn btn-ctrl fx-tool" title="네칸보기" aria-pressed={st.layout === "four"} onClick={() => toFour()}>
            <LayoutIcon kind="four" />
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
                          if (!par) return void driveMenu(r.path, e);
                          void (async () => {
                            try {
                              const res = await fsApi.contextMenu(par ?? r.path, par ? [r.name] : [], e.clientX, e.clientY);
                              if (res === "done") window.setTimeout(refreshAll, 300);
                              // 트리에서 고른 이름 바꾸기·새 폴더·보안해제도 하기(호환 A9)
                              else if (res === "rename") treeRename(r.path);
                              else if (res === "newfolder") treeNewFolder(r.path);
                              else if (res === "reveal") void fsApi.reveal(par ?? r.path, par ? [r.name] : []);
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
          className={st.layout === "four" ? "fx-panes fx-four" : "fx-panes"}
          data-layout={st.layout}
          style={{
            gridTemplateColumns: st.layout === "tb" ? "minmax(0, 1fr)" : `minmax(0, ${st.split}fr) minmax(0, ${1 - st.split}fr)`,
            ...(st.layout !== "lr" ? { gridTemplateRows: `minmax(0, ${st.splitV ?? 0.5}fr) minmax(0, ${1 - (st.splitV ?? 0.5)}fr)` } : {}),
          }}
        >
          {Array.from({ length: paneCount }, (_, i) =>
            // 미리보기: FreeCommander처럼 대상 창 자리에 보여요(창들이 좁아지지 않게)
            st.preview && i === targetOf(st.active) ? (
              <section key={i} className="fx-pane fx-preview" aria-label="미리보기" data-on="0" data-target="0" style={cellOf(st.layout, i)}>
                <div className="fx-tabs">
                  <span className="fx-tab fx-pv-title">미리보기</span>
                </div>
                <Preview row={selected(st.active)[0]} fmt={fmt} typeOf={(r) => typeName(r, types)} />
              </section>
            ) : (
              renderPane(i, paneCtx)
            ),
          )}
          {st.layout !== "tb" && (
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
          )}
          {st.layout !== "lr" && (
            <div
              className="fx-psplit fx-psplit-y"
              role="separator"
              aria-label="창 사이 높이"
              title="끌어서 높이 바꾸기 · 두 번 누르면 처음대로"
              style={{ top: `calc((100% - 12px) * ${st.splitV ?? 0.5})`, ...ySplitSide(st.layout, st.split) }}
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
        <span className="fx-fk"><b>Tab</b> {paneCount > 2 ? "다음 창" : "반대 창"}</span>
        {paneCount > 2 && <span className="fx-fk"><b>Ctrl+1~{paneCount}</b> 창 고르기</span>}
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

      {pop && <PickMenu pop={pop} onClose={() => setPop(null)} />}
      {rdrag && (
        <div className="fx-rdrag" style={{ left: rdrag.x + 12, top: rdrag.y + 12 }}>
          {rdrag.paths.length === 1 ? baseName(rdrag.paths[0]) : `${rdrag.paths.length}개`}
        </div>
      )}
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
      {band && (Math.abs(band.x1 - band.x0) > 2 || Math.abs(band.y1 - band.y0) > 2) && (
        <div
          className="fx-band"
          style={{ left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) }}
        />
      )}
      {ask && (
        <AskDialog
          title={ask.title}
          sub={ask.sub}
          yes={ask.yes}
          onYes={() => {
            ask.resolve(true);
            setAsk(null);
          }}
          onNo={() => {
            ask.resolve(false);
            setAsk(null);
          }}
        />
      )}
      {xfer && (
        <TransferAsk
          items={xfer.items}
          op={xfer.op}
          dest={xfer.dest}
          onNo={() => setXfer(null)}
          onYes={() => {
            const x = xfer;
            setXfer(null);
            void transfer(x.pane, x.op, x.items, x.dest);
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


/** 창 사이를 끌 때 창 하나가 줄어들 수 있는 끝(이름 열이 보일 만큼) */
const PANE_MIN_W = 460;

const NEW_DIR = "새 폴더";
/** 새 폴더를 비는 이름으로 만들어요(2026-10-25 사용자: 같은 이름이 있으면 "새 폴더 (2)"·"(3)"…, 윈도우와 같은 꼴).
    목록에 안 보이는 숨김·시스템 폴더나 아직 안 읽힌 이름과 겹쳐도 앱이 "있어요"라고 하면 다음 번호로 다시 해요. */
async function mkdirFree(dir: string, names: string[]): Promise<string> {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  let name = taken.has(NEW_DIR) ? bothName(NEW_DIR, (n) => taken.has(n.toLowerCase())) : NEW_DIR;
  for (let i = 0; i < 200; i++) {
    try {
      return await fsApi.mkdir(dir, name);
    } catch (e) {
      if (String(e) !== "exists") throw e;
      taken.add(name.toLowerCase());
      name = bothName(NEW_DIR, (n) => taken.has(n.toLowerCase()));
    }
  }
  throw "exists";
}

/** 세칸의 위아래 경계선은 짧은 칸 쪽에만 걸쳐요 */
function ySplitSide(l: Layout, split: number): React.CSSProperties {
  if (l === "3l") return { left: `calc((100% - 12px) * ${split} + 12px)`, right: 0 };
  if (l === "3r") return { left: 0, right: `calc((100% - 12px) * ${1 - split} + 12px)` };
  return {};
}

/** 칸 모양 단추 아이콘 – 지금 모양을 따라 바뀌어요(2026-10-25 사용자 1안) */
function LayoutIcon({ kind }: { kind: Layout }) {
  const d = { lr: "M12 4v16", tb: "M3 12h18", "3l": "M10 4v16M10 12h11", "3r": "M14 4v16M3 12h11", four: "M12 4v16M3 12h18" }[kind];
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d={d} />
    </svg>
  );
}
const PANE_MIN_H = 200;

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
