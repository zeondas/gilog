// 탐색기에서 윈도우로 이어지는 일 – 경로 복사, 위치 열기, 드라이브·파일 우클릭(윈도우 메뉴 + 기록 메뉴).
import { SortKey, VIEWS, ViewMode, parentOf, isSpecial, isLnk, shownName } from "../../files";
import { MenuExtra, MenuResult, fsApi } from "../../filesApi";
import { SORT_NAME } from "./parts";
import { Row } from "./parts";
import type { useFilesOps } from "./ops";

export function useFilesShell(c: ReturnType<typeof useFilesOps>) {
  const { st, activeTab, selected, flash, go, updPane, refreshAll, undoRedo, setDrives, lists, hist, startRename, newFolder, cfg, load, setSel, setInline } = c;

  const copyPath = (pane: number) => {
    if (!st) return;
    // 폴더 경로만(2026-10-28 탐색기 ✔6 – 파일 경로를 붙여 넣으면 파일이 열려 불편): 찾기·펼쳐보기 탭은 고른 것의 폴더(겹치지 않게)
    const t = activeTab(st.panes[pane]);
    const dirs = t.find ? [...new Set(selected(pane).map((e) => parentOf(e.path)).filter(Boolean))] : [t.path];
    const text = dirs.join("\r\n");
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => flash("폴더 경로를 복사했어요"), () => flash("복사하지 못했어요"));
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
  return { ...c, copyPath, revealRows, openLocation, menuExtra, driveMenu, shellMenu };
}
