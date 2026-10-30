// 집행현황 엑셀 – 내보내기·가져오기(바꿀 것 미리 세기)·지난해 복사.
import { api, errorText, inApp } from "../../api";
import { BudgetProject, memoToText } from "../../budget";
import { parseBudgetBook, planImport } from "../../budgetExcel";
import { dirOf, DIR_KEY, ImportMode, joinPath, lastDir } from "../../ExcelMenu";
import { todayStr } from "../../journal";
import type { useBudgetCore } from "./Screen";

export function useBudgetExcel(c: ReturnType<typeof useBudgetCore>) {
  const { setPop, year, list, unit, view, setToast, commit, setAsk, ask, setData, run } = c;

  // ---------- 엑셀 ----------
  const exportExcel = async () => {
    setPop(null);
    const name = `집행현황_${year}_${todayStr()}.xlsx`;
    const dir = await lastDir();
    let path: string | null = joinPath(dir, name);
    if (inApp) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      path = await save({ title: "다른 이름으로 저장", defaultPath: path, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }] });
      if (!path) return;
      if (!/\.xlsx$/i.test(path)) path += ".xlsx";
    }
    try {
      const projects = list.map((p) => ({
        ...p,
        memo: memoToText(p.memo),
        items: p.items.map((i) => ({ ...i, memo: memoToText(i.memo), rows: i.rows.map((r) => ({ ...r, memo: memoToText(r.memo) })) })),
      }));
      await api.budgetExcelWrite(path, { year, unit, view, date: todayStr(), projects });
      const d = dirOf(path);
      if (d) api.set(DIR_KEY, d).catch(() => {});
      setToast(`${year}년 집행현황을 저장했어요 · ${path}`);
    } catch (e) {
      setToast(e === "io" ? "저장하지 못했어요. 엑셀에서 열려 있으면 닫고 다시 해 주세요." : errorText(e));
    }
  };

  const importExcel = async () => {
    setPop(null);
    if (!(await commit())) return;
    let path: string | null = null;
    if (inApp) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await lastDir();
      const p = await open({ title: "열기", defaultPath: dir || undefined, multiple: false, directory: false, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx", "xlsm", "xls"] }] });
      path = typeof p === "string" ? p : null;
    } else path = joinPath(await lastDir(), `집행현황_${year}.xlsx`);
    if (!path) return;
    try {
      const sheets = await api.budgetExcelRead(path);
      const d = dirOf(path);
      if (d) api.set(DIR_KEY, d).catch(() => {});
      const r = parseBudgetBook(sheets, year);
      if (!r) {
        setToast("집행현황 모양의 시트를 찾지 못했어요");
        return;
      }
      setAsk({ ...r, path });
    } catch (e) {
      setToast(e === "io" ? "파일을 열지 못했어요." : errorText(e));
    }
  };

  const askPlan = ask ? planImport(list, ask.projects) : { upd: 0, add: 0 };
  // mode: 덮어쓰기(merge) · 대체하기(replace – 보고 있는 해만 지우고 파일 내용으로, 2026-10-30 ✔1)
  const doImport = async (mode: ImportMode = "merge") => {
    if (!ask) return;
    try {
      const [y, u, n] = await api.importBudget(year, ask.projects, mode === "replace");
      setData(y);
      setToast(
        mode === "replace"
          ? `${year}년을 대체해 세부사업 ${ask.projects.length}개 · 공사 ${n}건을 가져왔어요`
          : u
            ? `공사 ${u}건을 덮어쓰고 ${n}건을 더했어요`
            : `세부사업 ${ask.projects.length}개 · 공사 ${n}건을 가져왔어요`,
      );
    } catch (e) {
      setToast(e === "invalid" ? "가져올 수 없는 줄이 있어요(금액·이름 확인)" : errorText(e));
    }
    setAsk(null);
  };

  const copyPrev = async () => {
    const prev = await api.budgetData(year - 1).catch(() => [] as BudgetProject[]);
    if (!prev.some((p) => !p.carry)) {
      setToast(`${year - 1}년 자료가 없어요`);
      return;
    }
    await run(() => api.copyBudgetYear(year - 1, year), `${year - 1}년 세부사업·부기사업을 복사했어요`);
  };
  return { ...c, exportExcel, importExcel, askPlan, doImport, copyPrev };
}
