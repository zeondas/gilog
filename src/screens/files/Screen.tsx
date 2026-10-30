// 탐색기(11단계) 화면. 시안 캔버스 Files·FilesTree·FilesConflict·FilesMenu 판, 사양서 "탐색기 (11단계)" 절이 기준이에요.
// - 왼쪽 폴더 트리(2안: 안내선 + 드라이브 띠 + 지금 경로) + 2창(기본)/4창(2×2).
// - 창마다 탭 줄 → 드라이브 줄(드라이브 · 빠른 필터 · 보기 ▾) → 경로 줄(경로 · 폴더 경로 복사 · 윈도우 탐색기로 열기 · ★) → 목록 → 상태 줄.
// - 우클릭(파일·폴더·빈 곳)은 윈도우 우클릭 메뉴 그대로(2안), 탭 우클릭만 기록 메뉴.
// - 상태(탭·열 폭·정렬·보기·트리·즐겨찾기·찾기 조건·일괄 이름 바꾸기 설정)는 암호화 파일 kv "files.state".
import { Fragment } from "react";
import { FileIcon } from "../../FileIcon";
import {
  EMPTY_FIND,
  Layout,
  cellOf,
  freeSlot,
  togglePin,
  RenameOpts,
  TREE_W,
  baseName,
  parentOf,
  typeName,
  HOME,
  PC_FOLD,
} from "../../files";
import { fsApi } from "../../filesApi";
import { DateInput } from "../../DateInput";
import { SearchBox } from "../../SearchBox";
import { DialogX } from "../../DialogX";
import { KeyHelp, PickMenu, TabMenu } from "./Menu";
import { PaneCtx, Preview, renderPane } from "./Table";
import { AskDialog, ConflictDialog, DeleteDialog, NameDialog, RenameDialog, RunAsk, TransferAsk } from "./Dialogs";
import { nextTabId } from "./parts";
import { useFilesCore } from "./state";
import { useFilesOps } from "./ops";
import { useFilesShell } from "./shell";
import { useFilesFind } from "./find";
import { useFilesKeys, useFilesKeyHandler } from "./keys";
import { useFilesTree, useFilesTreeRows } from "./Tree";
import { useFilesTop, useFilesLayout } from "./Top";
import { useFilesDrag } from "./drag";
import { useFilesCols } from "./columns";



export default function FilesScreen() {
  const c0 = useFilesCore();
  const c1 = useFilesOps(c0);
  const c2 = useFilesShell(c1);
  const c3 = useFilesFind(c2);
  const c4 = useFilesKeys(c3);
  const c5 = useFilesTree(c4);
  const c6 = useFilesTop(c5);
  const c7 = useFilesTreeRows(c6);
  const c8 = useFilesLayout(c7);
  const c9 = useFilesKeyHandler(c8);
  const c10 = useFilesDrag(c9);
  const c11 = useFilesCols(c10);
  const { st, cfg, treeMax, activeTab, closeTab, commitInline, copyPath, crumbList, cut, dragScroll, dragSrc, driveMenu, dropTo, editPath, extHover, filterRefs, filters, flash, focusPane, go, home, inline, keepPick, lists, menu, nativeDrag, newTab, newTabBg, noCtxUntil, openEntry, paneCount, rerunFind, rowsOf, selected, sels, setBand, setEditPath, setFilters, setFindOpen, setForm, setInline, setMenu, setPop, setSel, setSt, setSugg, shellMenu, stepHistory, sugg, suggest, targetOf, toggleCol, types, up, updPane, visibleDrives, colh, colFit, colLive, notePane, busy, toast, quickRef, fastReady, quickFind, setQuickFind, runFind, findOpen, form, curPath, findNameRef, formBad, setFormBad, setNameAsk, toolsRef, toolFit, refresh, resetLayout, toTwo, toThree, toFour, flatOn, toggleFlat, toggleHidden, sameFolder, swapPanes, openBatch, helpBtn, help, helpTimer, setHelp, bodyRef, treeRows, onPath, toggleTreeRow, refreshAll, treeRename, treeNewFolder, toggleGroup, toggleOpen, homeOpen, pcFolded, dragW, panesRef, pop, rdrag, conflict, pickConflict, setConflict, band, ask, setAsk, xfer, setXfer, transfer, runAsk, setRunAsk, del, doDelete, setDel, renameRows, doBatch, setRenameRows, undo, undoBatch, nameAsk } = c11;

  if (!st) return <div className="fx-root" />;

  const fmt = cfg.dateFmt;
  const treeW = Math.max(TREE_W.min, Math.min(treeMax(st.layout), st.tree.width));

  // ---------- 그리기 ----------
  const paneCtx: PaneCtx = {
    activeTab, cfg, closeTab, commitInline, copyPath, crumbList, cut, dragScroll, dragSrc, driveMenu, dropTo, editPath, extHover,
    filterRefs, filters, flash, fmt, focusPane, go, home, inline, keepPick, lists, menu, nativeDrag, newTab, newTabBg, noCtxUntil,
    openEntry, paneCount, rerunFind, rowsOf, selected, sels, setBand, setEditPath, setFilters, setFindOpen, setForm, setInline, setMenu,
    setPop, setSel, setSt, setSugg, shellMenu, st, stepHistory, sugg, suggest, targetOf, toggleCol, types, up, updPane, visibleDrives, colh, colFit, colLive,
    note: { pane: notePane != null && notePane < paneCount ? notePane : st.active, busy, toast, cancel: () => void fsApi.cancel() },
  };

  return (
    <div className="fx-root">
      <div className="fx-top">
        <div className={treeW < 200 ? "fx-findbox fx-rel fx-narrow" : "fx-findbox fx-rel"} style={{ width: treeW }}>
          <SearchBox
            className="fx-search"
            inputRef={quickRef}
            aria-label="파일 찾기"
            placeholder={treeW < 200 ? "찾기" : fastReady ? "모든 드라이브에서 찾기" : "파일 찾기"}
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
                  title={treeW < 200 ? "자세히 찾기" : undefined}
                  onClick={() => {
                    if (!findOpen) setForm({ ...form, name: form.name || quickFind, where: form.where || curPath });
                    setFindOpen(!findOpen);
                  }}
                >
                  {treeW < 200 ? "▾" : "자세히 ▾"}
                </button>
              </>
            }
          />
          {findOpen && (
            <div className="fx-menu fx-findpanel" onKeyDown={(e) => e.key === "Escape" && setFindOpen(false)}>
              <div className="fx-fhead" data-dialog-title>
                자세히 찾기
              </div>
              <DialogX onClick={() => setFindOpen(false)} />
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
          <span className="fx-vsep" />
          <button
            ref={helpBtn}
            type="button"
            className="btn btn-ctrl fx-info"
            aria-label="단축키"
            aria-pressed={help === "pin"}
            data-help="단축키"
            onMouseEnter={() => {
              window.clearTimeout(helpTimer.current);
              if (!help) setHelp("hover");
            }}
            onMouseLeave={() => {
              if (help === "hover") helpTimer.current = window.setTimeout(() => setHelp((h) => (h === "hover" ? null : h)), 150);
            }}
            onClick={() => setHelp((h) => (h === "pin" ? null : "pin"))}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.5h.01" /></svg>
          </button>
        </div>
        {help && (
          <KeyHelp
            anchor={helpBtn}
            onClose={() => setHelp(null)}
            onEnter={() => window.clearTimeout(helpTimer.current)}
            onLeave={() => {
              if (help === "hover") helpTimer.current = window.setTimeout(() => setHelp((h) => (h === "hover" ? null : h)), 150);
            }}
          />
        )}
      </div>

      <div className="fx-body" ref={bodyRef}>
        {st.tree.on && (
          <>
            <aside className="fx-tree" aria-label="폴더 트리" style={{ width: treeW }}>
              <div className="fx-tree-head">
                폴더트리
                {/* 모두 접기(2026-10-28 탐색기 ✔8 – 펼치기 단추는 없어요) */}
                <button
                  type="button"
                  className="fx-fold"
                  aria-label="모두 접기"
                  title="모두 접기"
                  onClick={() => setSt((S) => (S ? { ...S, tree: { ...S.tree, open: [] } } : S))}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4.5 8.5 8 5l3.5 3.5" />
                    <path d="M4.5 12.5 8 9l3.5 3.5" />
                  </svg>
                </button>
              </div>
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
                dragW.current = { x: e.clientX, w: treeW };
              }}
              onPointerMove={(e) => {
                const d = dragW.current;
                if (!d) return;
                const w = Math.max(TREE_W.min, Math.min(treeMax(st.layout), Math.round(d.w + e.clientX - d.x)));
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
            if (a === "pin") updPane(pane, (p) => ({ ...p, ...togglePin(p.tabs, ti, p.active) }));
            if (a === "dup")
              updPane(pane, (p) => {
                const at = freeSlot(p.tabs, ti + 1);
                return { ...p, tabs: [...p.tabs.slice(0, at), { ...tab, pinned: false, id: nextTabId() }, ...p.tabs.slice(at)], active: at };
              });
            if (a === "other") {
              const o = targetOf(pane);
              updPane(o, (p) => ({ ...p, tabs: [...p.tabs, { ...tab, pinned: false, id: nextTabId() }], active: p.tabs.length }));
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
      {runAsk && (
        <RunAsk
          path={runAsk.path}
          onYes={() => {
            runAsk.done(true);
            setRunAsk(null);
          }}
          onNo={() => {
            runAsk.done(false);
            setRunAsk(null);
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

/** 창 사이를 끌 때 창 하나가 줄어들 수 있는 끝(이름 열이 보일 만큼) */
const PANE_MIN_W = 460;

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
