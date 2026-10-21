// "엑셀 ▾" 단추 하나(가져오기·내보내기) – 민원대장·업무연락처·업무일지가 같이 써요(2026-10-17 사용자, 시안 ExcelImport.dc.html).
// 경로는 윈도우 열기·다른 이름으로 저장 창에서 정해요. 창은 마지막에 쓴 폴더에서 열려요(처음엔 문서).
// 가져오기는 판단하지 않아요: 파일을 고르면 "○○ N건을 가져올까요?" 한 번 묻고, 끝나면 "N건을 가져왔어요".
import { useEffect, useRef, useState } from "react";
import { api, errorText, inApp } from "./api";
import { ExcelExport, ExcelSheet, SHEET_TITLE, SheetKind, defaultName } from "./excel";
import { todayStr } from "./journal";

export const DIR_KEY = "excel.lastDir";

/** 미리 보기(브라우저)에서는 윈도우 창이 없어 정해진 경로를 써요. */
export const FAKE_DIR = "C:\\Users\\사용자\\Documents";

export function dirOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : "";
}

export const joinPath = (dir: string, name: string) => (dir ? dir.replace(/[\\/]+$/, "") + (dir.includes("/") && !dir.includes("\\") ? "/" : "\\") + name : name);

export async function lastDir(): Promise<string> {
  const saved = await api.get(DIR_KEY).catch(() => "");
  if (saved) return saved;
  if (!inApp) return FAKE_DIR;
  try {
    const { documentDir } = await import("@tauri-apps/api/path");
    return await documentDir();
  } catch {
    return "";
  }
}

async function pickSave(name: string): Promise<string | null> {
  const dir = await lastDir();
  if (!inApp) return joinPath(dir, name);
  const { save } = await import("@tauri-apps/plugin-dialog");
  const p = await save({ title: "다른 이름으로 저장", defaultPath: joinPath(dir, name), filters: [{ name: "Excel 통합 문서", extensions: ["xlsx"] }] });
  if (!p) return null;
  return /\.xlsx$/i.test(p) ? p : p + ".xlsx";
}

async function pickOpen(kind: SheetKind): Promise<string | null> {
  const dir = await lastDir();
  if (!inApp) return joinPath(dir, defaultName(kind, todayStr()));
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ title: "열기", defaultPath: dir || undefined, multiple: false, directory: false, filters: [{ name: "Excel 통합 문서", extensions: ["xlsx", "xlsm", "xls"] }] });
  return typeof p === "string" ? p : null;
}

export function ExcelMenu<T>({
  kind,
  total,
  build,
  parse,
  onImport,
  importHint = "양식 파일의 모든 줄을 그대로 넣어요",
  note,
  count = (rows) => rows.length,
}: {
  kind: SheetKind;
  /** 내보낼 건수(메뉴 설명 줄) */
  total: number;
  /** 내보낼 자료를 만들어요(늘 전체) */
  build: () => ExcelExport;
  /** 읽은 시트 → 넣을 줄 */
  parse: (s: ExcelSheet) => T[];
  /** 넣고 넣은 수를 돌려줘요 */
  /** 가져온 수(또는 수 + 덧붙일 말, 예: "웹 3 · 내장 2") */
  onImport: (rows: T[]) => Promise<number | { n: number; note: string }>;
  /** 메뉴 "가져오기" 설명 줄(업무일지는 겹친 기록을 건너뛰어요) */
  importHint?: string;
  /** 묻는 창 제목 아래 한 줄(건너뛰는 줄 수 등). 읽은 시트를 받아요. */
  note?: (s: ExcelSheet) => string;
  /** 넣을 건수(업무일지는 묶음 하나에 기록 여러 건) */
  count?: (rows: T[]) => number;
}) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<{ path: string; rows: T[]; note: string } | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const title = SHEET_TITLE[kind];

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!ask) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        setAsk(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ask]);

  const remember = (path: string) => {
    const d = dirOf(path);
    if (d) api.set(DIR_KEY, d).catch(() => {});
  };

  async function doExport() {
    setOpen(false);
    const path = await pickSave(defaultName(kind, todayStr()));
    if (!path) return;
    try {
      const data = build();
      await api.excelWrite(path, kind, data);
      remember(path);
      setToast(`${title} ${data.rows.length}건을 저장했어요 · ${path}`);
    } catch (e) {
      setToast(e === "io" ? "저장하지 못했어요. 엑셀에서 열려 있으면 닫고 다시 해 주세요." : errorText(e));
    }
  }

  async function startImport() {
    setOpen(false);
    const path = await pickOpen(kind);
    if (!path) return;
    try {
      const sheet = await api.excelRead(path, kind);
      remember(path);
      setAsk({ path, rows: parse(sheet), note: note ? note(sheet) : "" });
    } catch (e) {
      setToast(e === "invalid" ? `${title} 양식이 아니에요` : e === "io" ? "파일을 열지 못했어요." : errorText(e));
    }
  }

  async function doImport() {
    if (!ask || busy) return;
    setBusy(true);
    try {
      const r = await onImport(ask.rows);
      const n = typeof r === "number" ? r : r.n;
      const extra = typeof r === "number" ? "" : r.note;
      setToast(`${n}건을 가져왔어요${extra ? ` · ${extra}` : ""}`);
      setAsk(null);
    } catch (e) {
      setToast(errorText(e));
      setAsk(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="xl-wrap" ref={wrap}>
      <button type="button" className="btn btn-ctrl btn-text xl-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        엑셀
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="xl-menu" role="menu">
          <button type="button" role="menuitem" className="xl-item" onClick={startImport}>
            <span className="xl-item-t">가져오기</span>
            <span className="xl-item-s">{importHint}</span>
          </button>
          <button type="button" role="menuitem" className="xl-item" onClick={doExport}>
            <span className="xl-item-t">내보내기</span>
            <span className="xl-item-s">전체 {total}건을 양식에 담아 저장해요</span>
          </button>
        </div>
      )}

      {ask && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setAsk(null)}>
          <div className="dialog xl-ask" role="dialog" aria-modal="true" aria-label="엑셀 가져오기">
            <div className="xl-ask-body">
              <h2 className="xl-ask-title">{count(ask.rows) ? `${title} ${count(ask.rows)}건을 가져올까요?` : "가져올 줄이 없어요"}</h2>
              {ask.note && <div className="xl-ask-note">{ask.note}</div>}
              <div className="xl-ask-path">{ask.path}</div>
            </div>
            <div className="xl-ask-foot">
              <button type="button" className="btn btn-ctrl btn-text" onClick={() => setAsk(null)}>
                취소
              </button>
              {count(ask.rows) > 0 && (
                <button type="button" className="btn-primary btn-ctrl" autoFocus disabled={busy} onClick={doImport}>
                  가져오기
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="xl-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
