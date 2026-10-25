// "엑셀 ▾" 단추 하나(가져오기·내보내기) – 민원대장·업무연락처·업무일지가 같이 써요(2026-10-17 사용자, 시안 ExcelImport.dc.html).
// 경로는 윈도우 열기·다른 이름으로 저장 창에서 정해요. 창은 마지막에 쓴 폴더에서 열려요(처음엔 문서).
// 가져오기(2026-10-25 사용자 ②3안, 공통 ✔5, 그림 docs/qa/common/excel_import2.png): 파일을 고르면 "어떻게 가져올까요?" 창에서
// 덮어쓰기(같은 것은 파일 내용으로 덮고 새 것은 더함 – 파일에 없는 것은 그대로) / 대체하기(지금 자료를 모두 지우고 파일 내용만)를 고르고,
// 다음 창에서 건수를 보고 한 번 더 눌러요. 대체하기는 붉은 띠 + 붉은 단추. "같은 것"의 기준은 화면마다 preview가 정해요.
import { useEffect, useRef, useState } from "react";
import { api, errorText, inApp } from "./api";
import { ExcelExport, ExcelSheet, SHEET_TITLE, SheetKind, defaultName } from "./excel";
import { todayStr } from "./journal";
import { overlayDown, useOutsideClose } from "./useOutsideClose";

export const DIR_KEY = "excel.lastDir";

export type ImportMode = "merge" | "replace";

/** 받침이 있으면 a, 없으면 b(을/를, 은/는) */
const josa = (w: string, a: string, b: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return w + (c >= 0 && c <= 11171 && c % 28 ? a : b);
};

/** 건수 앞에 붙는 이름 */
const NOUN: Record<SheetKind, string> = { complaints: "민원", contacts: "연락처", journal: "기록" };

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
  importHint = "덮어쓰기·대체하기 중에서 골라요",
  note,
  count = (rows) => rows.length,
  preview,
}: {
  kind: SheetKind;
  /** 내보낼 건수(메뉴 설명 줄) */
  total: number;
  /** 내보낼 자료를 만들어요(늘 전체) */
  build: () => ExcelExport;
  /** 읽은 시트 → 넣을 줄 */
  parse: (s: ExcelSheet) => T[];
  /** 넣고 넣은 수를 돌려줘요 */
  /** 가져온 수(또는 수 + 덧붙일 말, 예: "웹 3 · 내장 2"). mode: merge 덮어쓰기 · replace 대체하기 */
  onImport: (rows: T[], mode: ImportMode) => Promise<number | { n: number; note: string }>;
  /** 메뉴 "가져오기" 설명 줄(업무일지는 겹친 기록을 건너뛰어요) */
  importHint?: string;
  /** 묻는 창 제목 아래 한 줄(건너뛰는 줄 수 등). 읽은 시트를 받아요. */
  note?: (s: ExcelSheet) => string;
  /** 넣을 건수(업무일지는 묶음 하나에 기록 여러 건) */
  count?: (rows: T[]) => number;
  /** 덮어쓰기 미리 세기: same = 파일 줄 중 이미 있는 것과 같은 수, total = 지금 자료 수 */
  preview?: (rows: T[]) => { same: number; total: number };
}) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<{ path: string; rows: T[]; note: string; step: "pick" | ImportMode } | null>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const title = SHEET_TITLE[kind];

  useOutsideClose(open, [wrap], () => setOpen(false), { onEsc: () => setOpen(false) });

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
      setAsk({ path, rows: parse(sheet), note: note ? note(sheet) : "", step: "pick" });
    } catch (e) {
      setToast(e === "invalid" ? `${title} 양식이 아니에요` : e === "io" ? "파일을 열지 못했어요." : errorText(e));
    }
  }

  async function doImport() {
    if (!ask || busy || ask.step === "pick") return;
    setBusy(true);
    try {
      const r = await onImport(ask.rows, ask.step);
      const n = typeof r === "number" ? r : r.n;
      const extra = typeof r === "number" ? "" : r.note;
      setToast(`${n}건을 ${ask.step === "replace" ? "대체해 " : ""}가져왔어요${extra ? ` · ${extra}` : ""}`);
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
        <div className="overlay" onMouseDown={overlayDown(() => setAsk(null))}>
          <div className="dialog xl-ask" role="dialog" aria-modal="true" aria-label="엑셀 가져오기">
            <ImportSteps
              title={title}
              noun={NOUN[kind]}
              n={count(ask.rows)}
              path={ask.path}
              note={ask.note}
              step={ask.step}
              stats={preview ? preview(ask.rows) : null}
              busy={busy}
              onStep={(step) => setAsk({ ...ask, step })}
              onCancel={() => setAsk(null)}
              onGo={doImport}
            />
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

/** 가져오기 창 안쪽: ① 방식 고르기 → ② 덮어쓰기 확인 / 대체하기 확인(붉은 띠) */
function ImportSteps({
  title,
  noun,
  n,
  path,
  note,
  step,
  stats,
  busy,
  onStep,
  onCancel,
  onGo,
}: {
  title: string;
  noun: string;
  n: number;
  path: string;
  note: string;
  step: "pick" | ImportMode;
  stats: { same: number; total: number } | null;
  busy: boolean;
  onStep: (s: "pick" | ImportMode) => void;
  onCancel: () => void;
  onGo: () => void;
}) {
  const pickRef = useRef<HTMLDivElement>(null);
  const won = (x: number) => x.toLocaleString();
  if (!n) {
    return (
      <>
        <div className="xl-ask-body">
          <h2 className="xl-ask-title">가져올 줄이 없어요</h2>
          {note && <div className="xl-ask-note">{note}</div>}
          <div className="xl-ask-path">{path}</div>
        </div>
        <div className="xl-ask-foot">
          <button type="button" className="btn btn-ctrl btn-text" autoFocus onClick={onCancel}>
            취소
          </button>
        </div>
      </>
    );
  }
  if (step === "pick") {
    // ←→로 두 단추 사이를 옮겨요(Enter·Space는 단추가 받아요).
    const arrows = (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const bs = [...(pickRef.current?.querySelectorAll<HTMLButtonElement>(".xl-pk") ?? [])];
      const i = bs.indexOf(document.activeElement as HTMLButtonElement);
      bs[(i + (e.key === "ArrowRight" ? 1 : bs.length - 1)) % bs.length]?.focus();
      e.preventDefault();
    };
    return (
      <>
        <div className="xl-ask-body">
          <h2 className="xl-ask-title">
            {title} {won(n)}건을 어떻게 가져올까요?
          </h2>
          {note && <div className="xl-ask-note">{note}</div>}
          <div className="xl-pick" ref={pickRef} onKeyDown={arrows}>
            <button type="button" className="xl-pk" autoFocus onClick={() => onStep("merge")}>
              <span className="xl-pk-ic" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="xl-pk-t">덮어쓰기</span>
              <span className="xl-pk-s">같은 {josa(noun, "은", "는")} 파일 내용으로 덮고, 새 {josa(noun, "은", "는")} 더해요. 파일에 없는 {josa(noun, "은", "는")} 그대로예요.</span>
            </button>
            <button type="button" className="xl-pk xl-pk-red" onClick={() => onStep("replace")}>
              <span className="xl-pk-ic" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
              </span>
              <span className="xl-pk-t">대체하기</span>
              <span className="xl-pk-s">지금 {josa(title, "을", "를")} 모두 지우고 파일 내용만 남겨요.</span>
            </button>
          </div>
          <div className="xl-ask-path">{path}</div>
        </div>
        <div className="xl-ask-foot">
          <button type="button" className="btn btn-ctrl btn-text" onClick={onCancel}>
            취소
          </button>
        </div>
      </>
    );
  }
  const back = (
    <button type="button" className="btn btn-ctrl btn-text xl-back" onClick={() => onStep("pick")}>
      뒤로
    </button>
  );
  if (step === "merge") {
    const same = Math.min(stats?.same ?? 0, n);
    return (
      <>
        <div className="xl-ask-body">
          <h2 className="xl-ask-title">덮어쓰기로 가져올까요?</h2>
          <div className="xl-sum">
            {stats ? (
              <>
                {same > 0 && (
                  <span>
                    같은 {noun} <b>{won(same)}건</b>은 파일 내용으로 덮어요
                  </span>
                )}
                {n - same > 0 && (
                  <span>
                    새 {noun} <b>{won(n - same)}건</b>은 더해요
                  </span>
                )}
                {stats.total - same > 0 && <span className="muted">파일에 없는 {noun} {won(stats.total - same)}건은 그대로예요</span>}
              </>
            ) : (
              <span>
                파일의 {noun} <b>{won(n)}건</b>을 넣어요
              </span>
            )}
          </div>
          <div className="xl-ask-path">{path}</div>
        </div>
        <div className="xl-ask-foot">
          {back}
          <button type="button" className="btn btn-ctrl btn-text" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn-primary btn-ctrl" autoFocus disabled={busy} onClick={onGo}>
            가져오기
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="xl-ask-body">
        <h2 className="xl-ask-title">대체하기로 가져올까요?</h2>
        <div className="xl-sum">
          <span>
            파일의 {noun} <b>{won(n)}건</b>만 남아요
          </span>
        </div>
        {(stats?.total ?? 1) > 0 && (
          <div className="ask-band xl-band" role="alert">
            <span>{stats ? `지금 ${noun} ${won(stats.total)}건이 모두 지워져요.` : `지금 ${josa(title, "이", "가")} 모두 지워져요.`} 되돌릴 수 없어요.</span>
          </div>
        )}
        <div className="xl-ask-path">{path}</div>
      </div>
      <div className="xl-ask-foot">
        {back}
        <button type="button" className="btn btn-ctrl btn-text" autoFocus onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn btn-ctrl btn-text btn-danger" disabled={busy} onClick={onGo}>
          지우고 대체하기
        </button>
      </div>
    </>
  );
}
