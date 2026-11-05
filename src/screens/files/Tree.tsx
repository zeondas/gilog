// 탐색기 폴더 트리 – 하위 폴더 읽기, 펼치기·접기, 보이는 줄 만들기.
import { useCallback, useMemo } from "react";
import { baseName, parentOf, HOME, PC, PC_FOLD, isSpecial } from "../../files";
import { fsApi } from "../../filesApi";
import type { useFilesKeys } from "./keys";
import type { useFilesTop } from "./Top";

export function useFilesTree(c: ReturnType<typeof useFilesKeys>) {
  const { tree, cfg, setTree, drives, st, activeTab } = c;

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
  return { ...c, loadTree, visibleDrives, treeHidden, treeDrives, curPath };
}

export function useFilesTreeRows(c: ReturnType<typeof useFilesTop>) {
  const { st, setSt, loadTree, treeHidden, tree, treeDrives, curPath } = c;

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
  return { ...c, toggleOpen, toggleTreeRow, showHome, showPc, homeOpen, pcFolded, toggleGroup, treeRows, onPath };
}
