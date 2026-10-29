// 탐색기 – 화면 키(창 밖 글자 칸이 아닐 때). 화면 몸통(Screen)이 키를 누를 때마다 지금 값을 묶어 넘겨요.
import { FindForm, FsEntry, VIEWS, nextPane, parentOf, HOME, PC, isSpecial } from "../../files";
import { Conflict, fsApi, fsErrorText } from "../../filesApi";
import { EMPTY_SEL, Pop, RPane, RState, RTab, ROW_H, Row, Sel, revealRow } from "./parts";

/** 글자 칸이나 뜬 창 안에서 누른 키는 탐색기 키가 아니에요. */
function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (!!el.closest("input, textarea, select, [contenteditable='true']") || !!el.closest(".overlay"));
}

type KeyCtx = {
  activeTab: (p: RPane) => RTab;
  ask: { title: string; sub: string; yes: string; resolve: (ok: boolean) => void; } | null;
  askDelete: (pane: number, permanent: boolean) => void;
  askTransfer: (pane: number, op: "copy" | "move") => void;
  askYes: (title: string, sub: string, yes: string) => Promise<boolean>;
  busy: { done: number; total: number; name: string; } | null;
  clipPaste: (pane: number) => Promise<void>;
  clipPut: (pane: number, isCut: boolean) => Promise<void>;
  closeTab: (pane: number, ti: number) => void;
  conflict: { list: Conflict[]; i: number; op: "copy" | "move"; resolve: (d: Record<string, string> | null) => void; dec: Record<string, string>; } | null;
  copyPath: (pane: number) => void;
  curPath: string;
  del: { items: FsEntry[]; permanent: boolean; pane: number; } | null;
  filterRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  filters: string[];
  findNameRef: React.RefObject<HTMLInputElement>;
  findOpen: boolean;
  flash: (t: string) => void;
  focusPane: (pane: number) => void;
  form: FindForm;
  home: string;
  menu: { kind: "view" | "fav" | "tab"; pane: number; tab?: number; x?: number; y?: number; } | null;
  nameAsk: { title: string; value: string; ok: (v: string) => void; } | null;
  newFolder: (pane: number) => Promise<void>;
  newTab: (pane: number, path: string) => void;
  newTabBg: (pane: number, path: string) => void;
  openEntry: (pane: number, e: Row, newTabIfFolder?: boolean) => void;
  paneCount: 4 | 3 | 2;
  pop: Pop | null;
  quickFind: string;
  refresh: () => void;
  refreshAll: () => void;
  renameRows: { pane: number; rows: (FsEntry & { parentName: string; folder: string; })[]; where: string; } | null;
  rowsOf: (pane: number) => Row[];
  selected: (pane: number) => Row[];
  sels: Sel[];
  setEditPath: React.Dispatch<React.SetStateAction<{ pane: number; value: string; } | null>>;
  setFilters: React.Dispatch<React.SetStateAction<string[]>>;
  setFindOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setForm: React.Dispatch<React.SetStateAction<FindForm>>;
  setMenu: React.Dispatch<React.SetStateAction<{ kind: "view" | "fav" | "tab"; pane: number; tab?: number; x?: number; y?: number; } | null>>;
  setPop: React.Dispatch<React.SetStateAction<Pop | null>>;
  setSel: (pane: number, s: Sel) => void;
  setSt: React.Dispatch<React.SetStateAction<RState | null>>;
  shellMenu: (pane: number, e: React.MouseEvent | null, rowsForMenu: Row[]) => Promise<void>;
  st: RState | null;
  startRename: (pane: number) => void | Promise<void>;
  stepHistory: (pane: number, dir: -1 | 1) => void;
  undoRedo: (redo: boolean) => Promise<void>;
  up: (pane: number) => void;
  updPane: (pane: number, f: (p: RPane) => RPane) => void;
  xfer: { pane: number; op: "copy" | "move"; items: Row[]; dest: string; } | null;
  /** F1 = 단축키 상자(머리 줄 ⓘ와 같음 – 2026-10-28 탐색기 ✔2) */
  toggleHelp: () => void;
};

export function handleKey(e: KeyboardEvent, c: KeyCtx) {
  const {
    activeTab, ask, askDelete, askTransfer, askYes, busy, clipPaste, clipPut, closeTab, conflict, copyPath, curPath, del, filterRefs,
    filters, findNameRef, findOpen, flash, focusPane, form, home, menu, nameAsk, newFolder, newTab, newTabBg, openEntry, paneCount, pop,
    quickFind, refresh, refreshAll, renameRows, rowsOf, selected, sels, setEditPath, setFilters, setFindOpen, setForm, setMenu, setPop,
    setSel, setSt, shellMenu, st, startRename, stepHistory, undoRedo, up, updPane, xfer
  } = c;
  if (!st || conflict || del || renameRows || nameAsk || xfer || ask) return;
  if (e.ctrlKey && !e.shiftKey && e.code === "KeyF") {
    // 2026-10-20 사용자: Ctrl+F = 상세 찾기 창(이름 칸에 커서)
    e.preventDefault();
    if (!findOpen) setForm({ ...form, name: form.name || quickFind, where: form.where || curPath });
    setFindOpen(true);
    setTimeout(() => findNameRef.current?.select(), 0);
    return;
  }
  if (e.key === "F1" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    c.toggleHelp();
    return;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === "KeyR") {
    e.preventDefault();
    refresh();
    return;
  }
  if (typing(e.target)) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyZ" || e.code === "KeyY")) {
    e.preventDefault();
    if (!busy) void undoRedo(e.code === "KeyY" || e.shiftKey);
    return;
  }
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
    revealRow(pane, n);
  };
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  const handled = () => e.preventDefault();
  if (k === "F2") return handled(), startRename(pane);
  if (k === "F3" || (k === "Enter" && !ctrl && !e.altKey)) {
    handled();
    // 여러 개를 골랐으면 모두 열어요(호환 B) – 폴더는 뒤에 새 탭으로, 16개 넘으면 물어요
    const many = s.paths.size > 1 ? rows.filter((x) => s.paths.has(x.path)) : [];
    if (many.length > 1) {
      void (async () => {
        if (many.length > 15 && !(await askYes(`${many.length}개를 모두 열까요?`, "파일마다 프로그램이 하나씩 열려요.", "모두 열기"))) return;
        for (const x of many) {
          if (x.dir) newTabBg(pane, x.path);
          else void fsApi.open(x.path).catch((er) => flash(fsErrorText(er)));
        }
      })();
      return;
    }
    const r = rows[idx];
    if (r) openEntry(pane, r);
    return;
  }
  if (k === "Enter" && ctrl) {
    const r = rows[idx];
    if (r) {
      if (activeTab(st.panes[pane]).find) newTab(pane, parentOf(r.path) ?? r.path);
      else if (r.dir) newTab(pane, r.path);
    }
    return handled();
  }
  if (k === "F5") return handled(), askTransfer(pane, "copy");
  if (k === "F6") return handled(), askTransfer(pane, "move");
  if (k === "F7") return handled(), void newFolder(pane);
  // 윈도우 탐색기 키(호환 A2·A3·A4·A5, 2026-10-20 사용자 1안)
  if (e.altKey && k === "ArrowUp") return handled(), up(pane);
  if (e.altKey && k === "Enter") {
    handled();
    const items = selected(pane);
    const t = activeTab(st.panes[pane]);
    const paths = items.length ? items.map((r) => r.path) : t.find || isSpecial(t.path) ? [] : [t.path];
    if (paths.length) void fsApi.properties(paths).catch((er) => flash(String(er) === "windows_only" ? "속성 창은 윈도우에서 떠요" : fsErrorText(er)));
    return;
  }
  if (ctrl && e.shiftKey && e.code === "KeyN") return handled(), void newFolder(pane);
  if ((ctrl && !e.shiftKey && e.code === "KeyL") || (e.altKey && e.code === "KeyD") || k === "F4") {
    handled();
    const t = activeTab(st.panes[pane]);
    if (!t.find) setEditPath({ pane, value: t.path });
    return;
  }
  if (k === "F8" || k === "Delete") return handled(), askDelete(pane, e.shiftKey);
  if (ctrl && !e.shiftKey && !e.altKey && e.code === "KeyD") return handled(), askDelete(pane, false);
  // Alt+P·Alt+Shift+P: 미리 보기 칸(세부 정보도 미리 보기 칸에 함께 나와요)
  if (e.altKey && !ctrl && e.code === "KeyP") return handled(), setSt({ ...st, preview: !st.preview });
  // Ctrl+Tab·Ctrl+Shift+Tab: 이 창의 다음·앞 탭
  if (ctrl && k === "Tab") {
    handled();
    const pp = st.panes[pane];
    const n = pp.tabs.length;
    if (n > 1) updPane(pane, (x) => ({ ...x, active: (x.active + (e.shiftKey ? n - 1 : 1)) % n }));
    return;
  }
  if (k === "Backspace") return handled(), up(pane);
  if (e.altKey && (k === "ArrowLeft" || k === "ArrowRight")) return handled(), stepHistory(pane, k === "ArrowLeft" ? -1 : 1);
  if (k === "Tab" && !ctrl) {
    handled();
    return focusPane(nextPane(pane, st.layout, e.shiftKey));
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
  if (k === " " && ctrl) {
    // Ctrl+Space: 커서 줄만 고르기·풀기(커서는 그대로, 호환 B)
    handled();
    const r = rows[idx < 0 ? 0 : idx];
    if (!r) return;
    const ps = new Set(s.paths.size ? s.paths : s.cursor ? [s.cursor] : []);
    if (ps.has(r.path)) ps.delete(r.path);
    else ps.add(r.path);
    setSel(pane, { paths: ps, cursor: r.path, anchor: r.path });
    return;
  }
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
    revealRow(pane, Math.min(rows.length - 1, at + 1));
    return;
  }
  // Ctrl+화살표·Home·End·PageUp·PageDown: 고른 것은 그대로 두고 커서만(호환 B)
  const step = (i: number) => (ctrl && !e.shiftKey ? cursorTo(i) : moveTo(i, e.shiftKey));
  const cursorTo = (i: number) => {
    if (!rows.length) return;
    const n = Math.max(0, Math.min(rows.length - 1, i));
    const ps = new Set(s.paths.size ? s.paths : s.cursor ? [s.cursor] : []);
    setSel(pane, { paths: ps, cursor: rows[n].path, anchor: s.anchor });
    revealRow(pane, n);
  };
  // 한 화면에 보이는 줄 수만큼(호환 B – 예전엔 15줄 고정)
  const page = () => {
    const list = document.querySelector<HTMLElement>(`[data-pane="${pane}"] .fx-list`);
    // 보이는 만큼만 그려서 0번 줄이 없을 수 있어요 – 그려진 아무 줄로 재요
    const row = list?.querySelector<HTMLElement>(`[id^="fx-row-${pane}-"]`);
    if (!list) return 15;
    const h = row?.offsetHeight || ROW_H;
    const perRow = list.classList.contains("fx-grid") && row ? Math.max(1, Math.floor(list.clientWidth / (row.offsetWidth || 1))) : 1;
    return Math.max(1, (Math.floor(list.clientHeight / h) - 1) * perRow);
  };
  if (k === "ArrowDown") return handled(), step(idx + 1);
  if (k === "ArrowUp") return handled(), step(idx < 0 ? 0 : idx - 1);
  if (k === "Home") return handled(), step(0);
  if (k === "End") return handled(), step(rows.length - 1);
  if (k === "PageDown") return handled(), step((idx < 0 ? 0 : idx) + page());
  if (k === "PageUp") return handled(), step((idx < 0 ? 0 : idx) - page());
  if (k === "Escape") {
    if (pop) return handled(), setPop(null);
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
}
