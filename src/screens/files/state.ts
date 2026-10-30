// 탐색기 상태 – 창·탭·목록·고르기·뜨는 것의 상태, 처음 읽기·저장, 폴더 읽기, 창·탭 옮겨 다니기, 보이는 줄, 열기·위로.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { EMPTY_FIND, FindForm, FsDrive, FsEntry, clearTabs, freeSlot, paneCountOf, extOf, nextPane, parentOf, quickMatch, readState, sortEntries, HOME, PC, isSpecial, inZip, isZipFile } from "../../files";
import { Conflict, FastStatus, TreeDir, fsApi, fsErrorText, onFsChanged, onFsProgress, setRunAsker } from "../../filesApi";
import { DEFAULT_FILES_SETTINGS, FilesSettings, loadSettings } from "../../settingsStore";
import { STATE_KEY, nextTabId, withIds, toSaved, favEntries } from "./parts";
import { EMPTY_SEL, Listing, Pop, RPane, RState, Row, Sel } from "./parts";

/** 이번 실행에서 '끌 때 열린 탭 비우기'를 이미 했는지 */
let clearedThisRun = false;

export function useFilesCore() {
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
  // "실행할까요?" 창 – 여는 것이 실행 파일이면 filesApi가 이 창으로 먼저 물어요(품질 보완 ② ✔1)
  const [runAsk, setRunAsk] = useState<{ path: string; done: (yes: boolean) => void } | null>(null);
  useEffect(() => {
    setRunAsker((path) => new Promise<boolean>((done) => setRunAsk({ path, done })));
    return () => setRunAsker(null);
  }, []);
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
  /** 진행·알림을 띄울 창(받는 창, 없으면 지금 창) – 창 상태 줄 오른쪽(2026-10-28 탐색기 ✔2 ②1안) */
  const [notePane, setNotePane] = useState<number | null>(null);
  /** 단축키 상자(머리 줄 ⓘ – 마우스를 올리면 hover, 누르거나 F1이면 pin) */
  const [help, setHelp] = useState<null | "hover" | "pin">(null);
  const helpBtn = useRef<HTMLButtonElement>(null);
  const helpTimer = useRef(0);
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
    window.setTimeout(() => {
      setToast((x) => (x === t ? "" : x));
      setNotePane(null);
    }, 3000);
  }, []);

  // 상태 저장(조금 모아서)
  useEffect(() => {
    if (!st) return;
    const t = window.setTimeout(() => void api.set(STATE_KEY, JSON.stringify(toSaved(st))).catch(() => {}), 500);
    return () => window.clearTimeout(t);
  }, [st]);

  const paneCount: 2 | 3 | 4 = st ? paneCountOf(st.layout) : 2;
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
        const at = freeSlot(tabs, p.active + 1);
        tabs.splice(at, 0, { path, pinned: false, id: nextTabId() });
        return { ...p, tabs, active: at };
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
    updPane(pane, (p) => ({ ...p, tabs: [...p.tabs, { path, pinned: false, id: nextTabId() }], active: p.tabs.length }));
  /** 뒤에 새 탭(가운데 단추로 폴더 누르기·여러 개 열기 – 윈도우처럼 지금 탭은 그대로) */
  const newTabBg = (pane: number, path: string) => updPane(pane, (p) => ({ ...p, tabs: [...p.tabs, { path, pinned: false, id: nextTabId() }] }));

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
  return { st, setSt, stRef, home, setHome, cfg, setCfg, types, setTypes, typesAsked, drives, setDrives, lists, setLists, listsRef, favRef, sels, setSels, selsRef, filters, setFilters, prev, setPrev, editPath, setEditPath, inline, setInline, ask, setAsk, askYes, menu, setMenu, pop, setPop, sugg, setSugg, findOpen, setFindOpen, quickFind, setQuickFind, fast, setFast, fastReady, form, setForm, formBad, setFormBad, conflict, setConflict, del, setDel, runAsk, setRunAsk, band, setBand, xfer, setXfer, renameRows, setRenameRows, undo, setUndo, batchHist, nameAsk, setNameAsk, toast, setToast, busy, setBusy, notePane, setNotePane, help, setHelp, helpBtn, helpTimer, tree, setTree, quickRef, findNameRef, filterRefs, flash, paneCount, activeTab, load, favKey, paths, pathsKey, updPane, focusPane, targetOf, toTwo, toThree, toFour, go, stepHistory, newTab, newTabBg, closeTab, rowsOf, selected, setSel, openEntry, up };
}
