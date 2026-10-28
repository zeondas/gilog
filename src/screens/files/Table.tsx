// 탐색기 – 창 하나 그리기(탭 줄 → 드라이브 줄 → 경로 줄 → 목록 → 상태 줄)와 목록 줄 부품·미리보기 칸. 화면 몸통(Screen)이 지금 값을 묶어 넘겨요.
import { Fragment, useEffect, useState } from "react";
import { inApp } from "../../api";
import { FileIcon } from "../../FileIcon";
import {
  FindForm,
  FsDrive,
  cellOf,
  IMAGE_EXT,
  SortKey,
  VIEWS,
  ViewMode,
  baseName,
  cleanPath,
  crumbsOf,
  driveOf,
  extOf,
  findSummary,
  formatDate,
  formatSize,
  parentOf,
  typeName,
  HOME,
  PC,
  isSpecial,
  isLnk,
  shownName,
} from "../../files";
import { TreeDir, fsApi, fsErrorText } from "../../filesApi";
import { FilesSettings } from "../../settingsStore";
import { VirtualList } from "../../VirtualList";
import { DATE_TIME_GAP, EMPTY_SEL, Listing, NAME_MIN, Pop, ROW_H, RPane, RState, RTab, Row, Sel, revealRow, rowsRefs, vlists } from "./parts";

export type PaneCtx = {
  activeTab: (p: RPane) => RTab;
  cfg: FilesSettings;
  closeTab: (pane: number, ti: number) => void;
  commitInline: (then?: () => void) => Promise<void>;
  copyPath: (pane: number) => void;
  crumbList: (pane: number, path: string, next: string | undefined, el: HTMLElement) => Promise<void>;
  cut: Set<string>;
  dateMin: number;
  dragScroll: (x: number, y: number) => void;
  dragSrc: React.MutableRefObject<{ pane: number; rows: Row[]; } | null>;
  driveMenu: (path: string, e: React.MouseEvent) => Promise<void>;
  dropTo: (pane: number, e: React.DragEvent, dir?: string) => void;
  editPath: { pane: number; value: string; } | null;
  extHover: { pane: number | null; dir: string | null; } | null;
  filterRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  filters: string[];
  flash: (t: string) => void;
  fmt: string;
  focusPane: (pane: number) => void;
  go: (pane: number, path: string, select?: string) => void;
  home: string;
  inline: { pane: number; path: string; value: string; dir?: boolean; } | null;
  keepPick: React.MutableRefObject<{ pane: number; path: string; } | null>;
  lists: Listing[];
  menu: { kind: "view" | "fav" | "tab"; pane: number; tab?: number; x?: number; y?: number; } | null;
  nativeDrag: React.MutableRefObject<{ x: number; y: number; paths: string[]; right?: boolean; } | null>;
  newTab: (pane: number, path: string) => void;
  newTabBg: (pane: number, path: string) => void;
  noCtxUntil: React.MutableRefObject<number>;
  openEntry: (pane: number, e: Row, newTabIfFolder?: boolean) => void;
  paneCount: 4 | 3 | 2;
  rerunFind: (pane: number) => Promise<void>;
  rowsOf: (pane: number) => Row[];
  selected: (pane: number) => Row[];
  sels: Sel[];
  setBand: React.Dispatch<React.SetStateAction<{ pane: number; x0: number; y0: number; x1: number; y1: number; base: Set<string>; } | null>>;
  setEditPath: React.Dispatch<React.SetStateAction<{ pane: number; value: string; } | null>>;
  setFilters: React.Dispatch<React.SetStateAction<string[]>>;
  setFindOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setForm: React.Dispatch<React.SetStateAction<FindForm>>;
  setInline: React.Dispatch<React.SetStateAction<{ pane: number; path: string; value: string; dir?: boolean; } | null>>;
  setMenu: React.Dispatch<React.SetStateAction<{ kind: "view" | "fav" | "tab"; pane: number; tab?: number; x?: number; y?: number; } | null>>;
  setPop: React.Dispatch<React.SetStateAction<Pop | null>>;
  setSel: (pane: number, s: Sel) => void;
  setSt: React.Dispatch<React.SetStateAction<RState | null>>;
  setSugg: React.Dispatch<React.SetStateAction<{ pane: number; items: TreeDir[]; i: number; } | null>>;
  shellMenu: (pane: number, e: React.MouseEvent | null, rowsForMenu: Row[]) => Promise<void>;
  st: RState;
  stepHistory: (pane: number, dir: -1 | 1) => void;
  sugg: { pane: number; items: TreeDir[]; i: number; } | null;
  suggest: (pane: number, v: string) => void;
  targetOf: (pane: number) => number;
  toggleCol: (k: "size" | "modified" | "type") => Promise<void>;
  types: Record<string, string>;
  up: (pane: number) => void;
  updPane: (pane: number, f: (p: RPane) => RPane) => void;
  visibleDrives: FsDrive[];
  /** 진행·알림을 띄울 창(받는 창) – 상태 줄 오른쪽(2026-10-28 탐색기 ✔2 ②1안) */
  note: { pane: number; busy: { done: number; total: number; name: string } | null; toast: string; cancel: () => void };
};

export function renderPane(pane: number, c: PaneCtx) {
  const {
    activeTab, cfg, closeTab, commitInline, copyPath, crumbList, cut, dateMin, dragScroll, dragSrc, driveMenu, dropTo, editPath, extHover,
    filterRefs, filters, flash, fmt, focusPane, go, home, inline, keepPick, lists, menu, nativeDrag, newTab, newTabBg, noCtxUntil,
    openEntry, paneCount, rerunFind, rowsOf, selected, sels, setBand, setEditPath, setFilters, setFindOpen, setForm, setInline, setMenu,
    setPop, setSel, setSt, setSugg, shellMenu, st, stepHistory, sugg, suggest, targetOf, toggleCol, types, up, updPane, visibleDrives, note
  } = c;
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
      const range = rows.slice(Math.max(0, lo), hi + 1).map((x) => x.path);
      // Ctrl+Shift+클릭: 고른 것에 범위를 더해요(호환 B)
      const paths = e.ctrlKey || e.metaKey ? new Set([...(s.paths.size ? s.paths : s.cursor ? [s.cursor] : []), ...range]) : new Set(range);
      setSel(pane, { paths, cursor: r.path, anchor: s.anchor ?? r.path });
    } else if (s.paths.size > 1 && s.paths.has(r.path)) {
      // 여러 개 고른 줄을 다시 누르면 끌 수 있게 그대로 두고, 끌지 않고 떼면 그 줄 하나만(호환 B)
      keepPick.current = { pane, path: r.path };
      setSel(pane, { ...s, cursor: r.path });
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
    if (Date.now() < noCtxUntil.current) return;
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
        onChange={(e) => {
          // 이름에 못 쓰는 글자는 치는 순간 막아요(호환 A10)
          const v = e.target.value;
          const clean = v.replace(/[\\/:*?"<>|]/g, "");
          if (clean !== v) flash('이름에 \\ / : * ? " < > | 는 쓸 수 없어요');
          setInline({ ...inline, value: clean });
        }}
        onFocus={(e) => {
          const dot = r.dir ? -1 : inline.value.lastIndexOf(".");
          e.currentTarget.setSelectionRange(0, dot > 0 ? dot : inline.value.length);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") void commitInline();
          if (e.key === "Escape") setInline(null);
          if (e.key === "Tab") {
            // Tab·Shift+Tab: 이름을 바꾸고 다음·앞 파일 이름 칸으로(호환 B)
            e.preventDefault();
            const i = rows.findIndex((x) => x.path === r.path);
            const nx = rows[i + (e.shiftKey ? -1 : 1)];
            void commitInline(() => {
              if (!nx) return;
              setSel(pane, { paths: new Set([nx.path]), cursor: nx.path, anchor: nx.path });
              setInline({ pane, path: nx.path, value: shownName(nx), dir: nx.dir });
              revealRow(pane, i + (e.shiftKey ? -1 : 1));
            });
          }
        }}
        onBlur={() => void commitInline()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    ) : (
      <span className="fx-nm" title={r.name}>
        {shownName(r)}
      </span>
    );
  // 보일 열: 이름은 늘, 크기·수정한 날·파일 형식은 설정에서 켜고 꺼요(2026-10-18 사용자). 찾기 결과는 폴더 열이 이름 다음에.
  const shown = (["size", "modified", "type"] as const).filter((k) => cfg.cols[k]);
  const fixedW = [...(t.find ? [st.cols.folder] : []), ...shown.map((k) => (k === "modified" ? Math.max(st.cols[k], dateMin) : st.cols[k]))];
  // 이름 열은 NAME_MIN 아래로 줄지 않고, 창이 그보다 좁으면 그 창 목록만 가로로 밀려요(2026-10-28 탐색기 ✔1 – FC처럼).
  const colStyle = { gridTemplateColumns: ["32px", `minmax(${NAME_MIN}px,1fr)`, ...fixedW.map((w) => `${w}px`)].join(" ") };
  /** 머리 줄·줄의 가장 좁은 폭 = 좌우 안쪽 10 + 아이콘 32 + 이름 최소 + 나머지 열 */
  const rowsMinW = 20 + 32 + NAME_MIN + fixedW.reduce((a, b) => a + b, 0);
  const detailMode = p.view === "detail" || !!t.find;
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
  const rowEl = (r: Row, i: number) => {
    const isSel = s.paths.has(r.path) || (!s.paths.size && s.cursor === r.path);
    const common = {
      id: `fx-row-${pane}-${i}`,
      "data-sel": isSel ? "1" : "0",
      "data-cur": s.cursor === r.path && on ? "1" : "0",
      "data-hid": r.hidden || cut.has(r.path) ? "1" : "0",
      "data-dir": r.dir ? r.path : undefined,
      "data-extdrop": r.dir && extHover?.dir === r.path ? "1" : "0",
      // 앱에서는 윈도우 끌기를 써요(윈도우 탐색기·바탕 화면에 놓을 수 있게) – 화면 안 끌기는 미리 보기에서만
      draggable: !inline && !inApp,
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button === 1) return e.preventDefault(); // 가운데 단추 자동 스크롤 막기
        if (e.button === 2 && !inline) {
          // 오른쪽 단추로 끌기 준비(호환 B) – 고르지 않은 줄이면 그 줄만 골라요(윈도우와 같게)
          const items = s.paths.has(r.path) ? rows.filter((x) => s.paths.has(x.path)) : [r];
          if (!s.paths.has(r.path)) setSel(pane, { paths: new Set([r.path]), cursor: r.path, anchor: r.path });
          nativeDrag.current = { x: e.clientX, y: e.clientY, paths: items.map((x) => x.path), right: true };
          return;
        }
        if (e.button !== 0) return;
        if (inApp && !inline && !e.shiftKey && !e.ctrlKey) {
          const items = s.paths.has(r.path) ? rows.filter((x) => s.paths.has(x.path)) : [r];
          nativeDrag.current = { x: e.clientX, y: e.clientY, paths: items.map((x) => x.path) };
        }
        pick(r, e);
      },
      onMouseUp: (e: React.MouseEvent) => {
        const k = keepPick.current;
        keepPick.current = null;
        if (e.button === 0 && k && k.pane === pane && k.path === r.path) setSel(pane, { paths: new Set([r.path]), cursor: r.path, anchor: r.path });
      },
      // 가운데 단추로 폴더를 누르면 뒤에 새 탭(호환 B)
      onAuxClick: (e: React.MouseEvent) => {
        if (e.button !== 1) return;
        e.preventDefault();
        if (r.dir) newTabBg(pane, r.path);
        else if (isLnk(r)) void fsApi.lnkTarget(r.path).then(async (tg) => tg && (await fsApi.isDir(tg)) && newTabBg(pane, tg)).catch(() => {});
      },
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
            {inline && inline.path === r.path ? nameCell(r) : shownName(r)}
          </span>
        </div>
      );
    }
    if (p.view === "brief" && !t.find) {
      return (
        <div key={r.path} className="fx-brow" {...common} title={r.name}>
          <FileIcon name={r.name} path={r.path} dir={r.dir} size={16} rev={r.modified} />
          <span className="fx-bn" style={{ fontWeight: r.dir ? 600 : 400 }}>
            {inline && inline.path === r.path ? nameCell(r) : shownName(r)}
          </span>
        </div>
      );
    }
    return (
      <div key={r.path} className="fx-frow" style={colStyle} {...common} data-vi={i}>
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
    );
  };
  const hdr = (
    <div
      className="fx-hdr"
      style={colStyle}
      onContextMenu={(e) => {
        // 열 머리 우클릭: 보일 열 고르기(호환 B)
        e.preventDefault();
        setPop({
          x: e.clientX,
          y: e.clientY,
          items: [
            { id: "name", label: "이름", checked: true, disabled: true },
            { id: "size", label: "크기", checked: cfg.cols.size },
            { id: "modified", label: "수정한 날짜", checked: cfg.cols.modified },
            { id: "type", label: "파일 형식", checked: cfg.cols.type },
          ],
          onPick: (id) => void toggleCol(id as "size" | "modified" | "type"),
        });
      }}
    >
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
  );
  const upRow = !t.find && parentOf(t.path) && (p.view === "detail" || p.view === "brief") && (
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
      data-target={isTarget && paneCount > 2 ? "1" : "0"}
      style={cellOf(st.layout, pane)}
      data-rest={!on && !isTarget ? "1" : "0"}
      aria-label={`창 ${pane + 1}`}
      onMouseDown={() => focusPane(pane)}
      // Mouse side buttons (3 back, 4 forward): WebView2 sends only pointer events and
      // auxclick for them (no mousedown/mouseup), so handle them on pointerup only —
      // one place, so a browser that also sends mouse events cannot step twice.
      onPointerDown={(e) => {
        if (e.button === 3 || e.button === 4) {
          e.preventDefault();
          focusPane(pane);
        }
      }}
      onPointerUp={(e) => {
        if (e.button === 3 || e.button === 4) {
          e.preventDefault();
          stepHistory(pane, e.button === 3 ? -1 : 1);
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 3 || e.button === 4) e.preventDefault();
      }}
      onDragOver={(e) => {
        if (!dragSrc.current) return;
        e.preventDefault();
        dragScroll(e.clientX, e.clientY);
      }}
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
        {/* 드라이브 줄: [내 PC] C: D: F: [홈] – 모두 같은 정사각형(2026-10-18 사용자, 시안 FilesDrives) */}
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
            onContextMenu={(e) => void driveMenu(d.path, e)}
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
          <button type="button" className="fx-vb fx-menu-btn" title={`보기: ${viewName}`} onClick={() => setMenu(menu?.kind === "view" && menu.pane === pane ? null : { kind: "view", pane })}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span className="fx-vbt">{viewName} ▾</span>
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
          <>
          <input
            className="input fx-path-in"
            aria-label="경로"
            autoFocus
            value={editPath.value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setEditPath({ pane, value: e.target.value });
              suggest(pane, e.target.value);
            }}
            onKeyDown={async (e) => {
              const sg = sugg && sugg.pane === pane ? sugg : null;
              if (sg && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                const n = sg.items.length;
                return setSugg({ ...sg, i: e.key === "ArrowDown" ? (sg.i + 1) % n : sg.i <= 0 ? n - 1 : sg.i - 1 });
              }
              if (sg && e.key === "Tab" && !e.shiftKey) {
                // Tab: 고른(없으면 첫) 폴더 이름으로 채우고 그 안을 이어서 보여 줘요
                e.preventDefault();
                const v = sg.items[Math.max(0, sg.i)].path + "\\";
                setEditPath({ pane, value: v });
                return suggest(pane, v);
              }
              if (e.key === "Escape") {
                if (sg) return setSugg(null);
                setEditPath(null);
              }
              if (e.key === "Enter" && sg && sg.i >= 0) {
                setSugg(null);
                setEditPath(null);
                return go(pane, sg.items[sg.i].path);
              }
              if (e.key === "Enter") {
                setSugg(null);
                // %USERPROFILE%·shell:downloads 같은 이름도 받고, 파일 경로면 그 파일을 열어요(호환 B)
                const v = cleanPath(editPath.value);
                const hit = await fsApi.resolve(v).catch(() => null);
                if (hit && hit[1]) {
                  setEditPath(null);
                  go(pane, cleanPath(hit[0]));
                } else if (hit) {
                  setEditPath(null);
                  void fsApi.open(hit[0]).catch((er) => flash(fsErrorText(er)));
                } else flash("그 폴더·파일을 찾지 못했어요");
              }
            }}
            onBlur={() => {
              setEditPath(null);
              setSugg(null);
            }}
          />
          {sugg && sugg.pane === pane && (
            <div className="fx-menu fx-sugg" role="listbox" aria-label="폴더 자동 완성">
              {sugg.items.map((d, k) => (
                <button
                  key={d.path}
                  type="button"
                  className="fx-mi"
                  data-on={k === sugg.i ? "1" : "0"}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSugg(null);
                    setEditPath(null);
                    go(pane, d.path);
                  }}
                >
                  <FileIcon name={d.name} path="" dir size={16} />
                  {d.name}
                </button>
              ))}
            </div>
          )}
          </>
        ) : (
          <div className="fx-crumbs" role="button" tabIndex={0} title="눌러서 경로 고쳐 적기 · Enter로 이동" onClick={() => !t.find && setEditPath({ pane, value: t.path })}>
            {t.find ? (
              <span className="fx-dim">{t.find.flat ? "펼쳐보기" : "찾기 결과"} · {t.find.form.where}</span>
            ) : (
              crumbs.map((c, i) => (
                <Fragment key={c.path}>
                  <span
                    className={i === crumbs.length - 1 ? "fx-crumb fx-strong" : "fx-crumb fx-crumb-go"}
                    title={i === crumbs.length - 1 ? undefined : `${c.name}(으)로`}
                    onClick={(ev) => {
                      // 조각을 누르면 그 폴더로(호환 A8) – 빈 곳은 지금처럼 경로 칸
                      if (i === crumbs.length - 1) return;
                      ev.stopPropagation();
                      go(pane, c.path);
                    }}
                  >
                    {c.name}
                  </span>
                  <span
                    className="fx-crumb-sep fx-crumb-list fx-menu-btn"
                    title="아래 폴더"
                    onClick={(ev) => {
                      // › 를 누르면 그 폴더의 아래 폴더 목록(호환 B)
                      ev.stopPropagation();
                      void crumbList(pane, c.path, crumbs[i + 1]?.path, ev.currentTarget);
                    }}
                  >
                    ›
                  </span>
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
      <div
        data-pane={pane}
        className={p.view === "brief" && !t.find ? "fx-list fx-brief" : p.view === "icons" || p.view === "thumb" ? (t.find ? "fx-list" : "fx-list fx-grid") : "fx-list"}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) up(pane);
        }}
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget || e.button !== 0) return;
          // 빈 곳에서 끌면 고무줄로 여러 개 고르기(호환 A6) – Ctrl을 누르고 시작하면 고른 것에 더해요
          const base = e.ctrlKey ? new Set(sels[pane].paths) : new Set<string>();
          if (!e.ctrlKey) setSel(pane, EMPTY_SEL);
          setBand({ pane, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, base });
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          if (Date.now() < noCtxUntil.current) return;
          setSel(pane, EMPTY_SEL);
          void shellMenu(pane, e, []);
        }}
      >
        {detailMode ? (
          <div className="fx-rows" ref={rowsRefs[pane]} style={{ minWidth: rowsMinW }}>
            {hdr}
            {upRow}
            {listing.error && !t.find && <div className="fx-empty fx-err">{listing.error}</div>}
            {!listing.error && !t.find && !listing.loading && !rows.length && <div className="fx-empty">{filters[pane] ? "빠른 필터에 맞는 것이 없어요" : "비어 있어요"}</div>}
            {t.find && !t.find.running && !rows.length && <div className="fx-empty">찾은 것이 없어요</div>}
            <VirtualList
              ref={(h) => {
                vlists[pane] = h;
              }}
              count={rows.length}
              getKey={(i) => rows[i].path}
              render={(i) => rowEl(rows[i], i)}
              estimate={() => ROW_H}
              parentRef={rowsRefs[pane]}
              pinned={[rows.findIndex((r) => r.path === s.cursor), inline && inline.pane === pane ? rows.findIndex((r) => r.path === inline.path) : null]}
              resetKey={fmt}
            />
          </div>
        ) : (
          <>
            {upRow}
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
            {rows.map(rowEl)}
          </>
        )}
      </div>
      <div className="fx-status">
        <span className="fx-st-l">
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
        {note.pane === pane && note.busy && (
          <span className="fx-busy">
            <span>
              {note.busy.total ? `${note.busy.done}/${note.busy.total}` : ""} {note.busy.name}
            </span>
            {note.busy.total > 0 && (
              <span className="fx-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (note.busy.done / note.busy.total) * 100)}%` }} />
              </span>
            )}
            <button type="button" className="btn btn-xs" onClick={note.cancel}>
              멈추기
            </button>
          </span>
        )}
        {note.pane === pane && note.toast && <span className="fx-toast" title={note.toast}>{note.toast}</span>}
      </div>
    </section>
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

/** 미리보기 칸: 사진은 그림으로, 다른 파일은 큰 아이콘과 정보(2026-10-19) */
export function Preview({ row, fmt, typeOf }: { row: Row | undefined; fmt: string; typeOf: (r: Row) => string }) {
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
