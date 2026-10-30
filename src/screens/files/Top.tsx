// 탐색기 머리 줄 – 새로 고침·칸 모양·숨김·열 켜기·경로 제안·펼쳐 보기·창 바꾸기, 트리 폭·도구 단추 폭 맞추기.
import { useEffect, useRef, useState } from "react";
import { EMPTY_FIND, Layout, TREE_W, PANE_MIN, parentOf, isSpecial } from "../../files";
import { TreeDir, fsApi } from "../../filesApi";
import { loadSettings, saveSettings } from "../../settingsStore";
import { EMPTY_SEL } from "./parts";
import type { useFilesTree } from "./Tree";
import type { useFilesTreeRows } from "./Tree";

export function useFilesTop(c: ReturnType<typeof useFilesTree>) {
  const { st, refreshAll, paneCount, activeTab, rerunFind, setSt, cfg, setCfg, flash, setPop, go, setSugg, closeTab, runFind, targetOf, setSel, curPath, loadTree, treeDrives, drives } = c;

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
  return { ...c, refresh, refreshAllRef, resetLayout, toggleHidden, toggleCol, crumbList, suggTimer, suggSeq, suggest, flatOn, toggleFlat, sameFolder, swapPanes };
}

export function useFilesLayout(c: ReturnType<typeof useFilesTreeRows>) {
  const { st } = c;

  // 트리 폭 끌기
  const dragW = useRef<{ x: number; w: number } | null>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  // 트리 폭 한계(2026-10-28 탐색기 ✔7): 가장 좁게 150, 가장 넓게는 오른쪽 창들이 300씩 남을 때까지(창 크기에 따라)
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyW, setBodyW] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!st]);
  const treeMax = (layout: Layout) => {
    if (!bodyW) return TREE_W.max;
    const cols = layout === "tb" ? 1 : 2;
    return Math.max(TREE_W.min, bodyW - 12 - cols * PANE_MIN - (cols - 1) * 12);
  };
  // 경로 줄이 창보다 길면 끝(지금 폴더)이 보이게 앞쪽을 가려요(2026-10-28 탐색기 ✔1)
  const crumbsToEnd = () => document.querySelectorAll<HTMLElement>(".fx-crumbs").forEach((el) => (el.scrollLeft = el.scrollWidth));
  useEffect(crumbsToEnd);
  useEffect(() => {
    const el = panesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(crumbsToEnd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!st]);
  /** 머리 줄 단추(2026-10-19 사용자 1안): 기준 크기(1600×900)에 맞춘 90px 고정 – 넓어져도 늘리지 않고 남는 폭은 오른쪽 빈 곳.
      90px 단추가 다 안 들어가면 글자를 빼고 34×34 정사각형(고정)으로, 앞에서부터 차례로. 마우스를 올리면 이름이 떠요. */
  const toolsRef = useRef<HTMLDivElement>(null);
  const TOOL_W = 90;
  const TOOL_SQ = 34;
  /** 글자를 둔 채 줄일 수 있는 가장 좁은 폭 – 아이콘 + 글자 4자 = 67px(2026-10-28 잼). ⓘ가 더해져 1600에서 77px이라 80 → 76(탐색기 ✔2) */
  const TOOL_MIN = 76;
  const [toolFit, setToolFit] = useState({ w: 90, compact: false, last: 0 });
  useEffect(() => {
    const el = toolsRef.current;
    if (!el) return;
    const fit = () => {
      const kids = [...el.children] as HTMLElement[];
      const btns = kids.filter((k) => k.classList.contains("fx-tool"));
      const other = kids.filter((k) => !k.classList.contains("fx-tool")).reduce((n, k) => n + k.offsetWidth + (k.classList.contains("fx-vsep") ? 4 : 0), 0); // 구분선 1 + 좌우 2, ⓘ는 34 그대로
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
  return { ...c, dragW, panesRef, bodyRef, bodyW, setBodyW, treeMax, crumbsToEnd, toolsRef, TOOL_W, TOOL_SQ, TOOL_MIN, toolFit, setToolFit };
}
