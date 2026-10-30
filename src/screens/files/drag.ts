// 탐색기 끌어다 놓기 – 창 사이·트리로, 범위 고르기 상자, 윈도우(탐색기·바탕 화면)에서 끌어온 파일 놓기.
import { useEffect, useRef, useState } from "react";
import { inApp } from "../../api";
import { driveOf, parentOf, isSpecial, inZip, zipOrIn } from "../../files";
import { fsApi, fsErrorText } from "../../filesApi";
import { ZIP_RO } from "./parts";
import { Row } from "./parts";
import type { useFilesKeyHandler } from "./keys";

export function useFilesDrag(c: ReturnType<typeof useFilesKeyHandler>) {
  const { setDrives, band, setBand, rowsOf, setSel, sels, refreshRef, st, activeTab, transfer, flash, record, refreshAll, setPop } = c;

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
  return { ...c, dragSrc, bandRef, nativeDrag, keepPick, rightUntil, noCtxUntil, rdrag, setRdrag, dropTo, extHover, setExtHover, extRef, dropAtRef, dragScroll, hitAt };
}
