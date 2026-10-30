// 탐색기 파일 일 – 되돌리기·다시 하기, 같은 이름 묻기·복사·옮기기, 클립보드, 지우기, 이름 바꾸기(그 자리·일괄), 새 폴더.
import { useEffect, useRef, useState } from "react";
import { FsEntry, baseName, bothName, extOf, joinPath, parentOf, PC, isSpecial, isLnk, isReservedName, shownName, tidyName, inZip, zipOrIn } from "../../files";
import { Conflict, Step, fsApi, fsErrorText } from "../../filesApi";
import { Decision } from "./Dialogs";
import { ZIP_RO, NEW_DIR, mkdirFree } from "./parts";
import { Row } from "./parts";
import type { useFilesCore } from "./state";

export function useFilesOps(c: ReturnType<typeof useFilesCore>) {
  const { flash, setConflict, conflict, st, selected, activeTab, targetOf, setXfer, setNotePane, paneCount, setBusy, listsRef, load, cfg, setDel, updPane, setInline, inline, lists, askYes, setSel, setNameAsk, rowsOf, setRenameRows, setUndo, batchHist, renameRows, undo } = c;

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
      // 진행·알림은 받는 창 상태 줄에(놓은 폴더를 연 창이 없으면 대상 창)
      const shows = st.panes.findIndex((pp) => {
        const tt = activeTab(pp);
        return !tt.find && tt.path.toLowerCase() === dest.toLowerCase();
      });
      const tg = targetOf(pane);
      const tgt = activeTab(st.panes[tg]);
      setNotePane(!tgt.find && tgt.path.toLowerCase() === dest.toLowerCase() ? tg : shows >= 0 && shows < paneCount ? shows : tg);
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
  return { ...c, hist, record, nowSec, undoRedo, newDirRef, recordRename, recordMkdir, askConflicts, pickConflict, askTransfer, transfer, cut, setCut, clipPut, clipPaste, refreshRef, refreshAll, askDelete, doDelete, startRename, commitInline, newFolder, treeRename, treeNewFolder, openBatch, doBatch, undoBatch };
}
