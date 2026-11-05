// 탐색기 찾기 – 찾기 탭 돌리기·다시 찾기, 결과 받기.
import { useEffect, useRef } from "react";
import { EMPTY_FIND, FindForm, cleanPath, parseSize } from "../../files";
import { fsApi, fsErrorText } from "../../filesApi";
import { parseDate } from "../../journal";
import { nextTabId } from "./parts";
import { EMPTY_SEL, FindRun } from "./parts";
import type { useFilesShell } from "./shell";

export function useFilesFind(c: ReturnType<typeof useFilesShell>) {
  const { st, activeTab, fastReady, updPane, setFindOpen, setSel, cfg, flash, quickFind, closeTab } = c;

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
    const id = reuse ?? nextTabId();
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
  return { ...c, runFind, findSeq, rerunFind };
}
