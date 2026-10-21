// 민원대장 화면이에요. 시안 Main.dc.html과 사양서의 "민원대장" 절을 따라요.
//
// - 표 맨 윗줄이 신규 입력 줄이에요. 엔터규칙(keys.ts): Tab·Enter 다음 칸, 마지막 칸(상태)에서 등록해요.
// - 내용·조치내용은 여러 줄 칸이에요. Enter 같은 위계로 새 줄, Shift+Enter 아래, Ctrl+Enter 위, 왼쪽 Alt+Enter 항목 안 줄 바꿈.
// - 줄을 누르면 그 자리에서 고치고, 바깥을 누르면 저장해요. 삭제는 "이 민원을 지울까요?"를 물어요.
// - 메모는 창에서 고쳐요. 여러 줄 칸 규칙, Tab 저장하고 닫기, 바깥을 누르면 저장이에요.
import {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DelIcon } from "./Icons";
import { VirtualList, type VirtualHandle } from "./VirtualList";
import { isKey, rowKeys } from "./keys";
import { ExcelMenu } from "./ExcelMenu";
import { complaintImports, complaintRows } from "./excel";
import { REMOTE_CHANGE } from "./google";
import { api, Complaint, ComplaintInput, errorText } from "./api";
import {
  COL_MIN,
  COLUMNS,
  ColKey,
  ColFilters,
  daysLeft,
  daysTaken,
  takenText,
  ddayText,
  defaultWidths,
  expandType,
  FILTER_KEYS,
  fitComplaintCols,
  FilterKey,
  filterValues,
  gridTemplate,
  isUrgent,
  matches,
  maxWidthOf,
  NO_FILTERS,
  passes,
  readStatusFilter,
  readWidths,
} from "./complaints";
import { parseLines, plainOf, stringifyLines } from "./bullets";
import { BulletEditor, BulletView } from "./BulletParts";
import { copyText, Hl, MemoEditor, memoText, parseMemo } from "./ContactsScreen";
import { koIndex, parseDate, todayStr } from "./journal";
import { useJamoGuard } from "./koInput";
import { PhoneInput } from "./PhoneInput";
import { ChoiceInput, PlaceInput } from "./PlaceInputs";
import { lookupMany } from "./addressWeb";
import { areaFor } from "./address";
import { finalizePhone } from "./phone";
import { ListGroup } from "./SettingsScreen";
import { DEFAULT_SETTINGS, isAnswered, isClosed, loadSettings, saveSettings, Settings, STATUS_RENAME, statusColor } from "./settingsStore";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/** 열 너비를 저장하는 곳 (암호화 파일 안) */
const COLS_KEY = "complaints.colWidths";
/** 상태 필터만 마지막 것을 기억해요(2026-10-17 사용자 2안 + 상태 예외). 다른 열 필터는 앱을 끄면 풀려요. */
const STATUS_FILTER_KEY = "complaints.statusFilter";
/** 조치완료일 열 접기(2026-10-19 사용자) – 접으면 걸린 날 "Nd"만 보여요. */
const DONE_FOLD_KEY = "complaints.doneFolded";
const DONE_FOLD_W = 48;

const FILTER_LABEL: Record<FilterKey, string> = { intake: "접수유형", ctype: "민원유형", area: "지역", status: "상태" };

type Lists = Pick<Settings, "status" | "intake" | "ctype">;

// ---------- 화면 ----------

export default function ComplaintsScreen({ urgentDays, focusId, onFocused }: { urgentDays: number; focusId?: number | null; onFocused?: () => void }) {
  const [list, setList] = useState<Complaint[] | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [widths, setWidths] = useState<(number | null)[]>(defaultWidths());
  const [doneFolded, setDoneFolded] = useState(true); // 처음엔 접혀 있어요(2026-10-19 사용자)
  // 표가 쓸 수 있는 폭. 저장된 열 너비가 이보다 넓으면 비율대로 줄여 보여요(가로 스크롤 없음).
  const tableRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [q, setQ] = useState("");
  // 민원인을 초성으로 찾을 때 입력기가 자음을 묶지 않게 해요.
  const qGuard = useJamoGuard(setQ);
  // 열 제목 필터(시안 ComplaintFilter.dc.html). null = 모두, 배열 = 고른 값만. 상태 칩도 같은 status 필터예요.
  const [filters, setFilters] = useState<ColFilters>(NO_FILTERS);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  // 한 번 누른 줄(골라 둔 줄). 두 번 누르거나 Enter를 누르면 고쳐요.
  const [selId, setSelId] = useState<number | null>(null);
  const [memoId, setMemoId] = useState<number | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [today, setToday] = useState(todayStr());
  // 보이는 줄만 그려요(2026-10-21 속도 최적화). 그 줄로 가기는 vlRef.scrollToIndex.
  const vlRef = useRef<VirtualHandle>(null);
  const shownRef = useRef<Complaint[]>([]);

  useEffect(() => {
    api
      .complaints()
      .then(async (cs) => {
        // 예전 상태 이름(처리중)으로 저장된 민원은 새 이름(진행)으로 한 번 바꿔 둬요.
        const old = cs.filter((c) => STATUS_RENAME[c.status]);
        if (!old.length) return cs;
        const fixed = new Map<number, Complaint>();
        for (const c of old) fixed.set(c.id, await api.setComplaintStatus(c.id, STATUS_RENAME[c.status]));
        return cs.map((c) => fixed.get(c.id) ?? c);
      })
      .then(setList, (e) => setNote(errorText(e)));
    loadSettings().then(setSettings, () => {});
    api.get(COLS_KEY).then((raw) => setWidths(readWidths(raw)), () => {});
    api.get(DONE_FOLD_KEY).then((raw) => setDoneFolded(raw !== "false"), () => {});
    api.get(STATUS_FILTER_KEY).then((raw) => setFilters((f) => ({ ...f, status: readStatusFilter(raw) })), () => {});
    // 구글 할 일에서 민원을 체크하면 상태가 바뀌어요 → 다시 읽어요.
    const reload = () => api.complaints().then(setList, () => {});
    window.addEventListener(REMOTE_CHANGE, reload);
    return () => window.removeEventListener(REMOTE_CHANGE, reload);
  }, []);

  // 자정을 넘기면 남은 날을 다시 셈해요.
  useEffect(() => {
    const t = window.setInterval(() => setToday(todayStr()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // 업무일지 "챙길 일"에서 눌러 왔으면 그 줄로 가서 잠깐 빛나게 해요.
  useEffect(() => {
    if (!list || focusId == null) return;
    setFilters(NO_FILTERS);
    setQ("");
    setEditId(null);
    setFlash(focusId);
    onFocused?.();
    window.setTimeout(() => vlRef.current?.scrollToIndex(shownRef.current.findIndex((c) => c.id === focusId), { align: "center", behavior: "smooth" }), 60);
  }, [list, focusId, onFocused]);

  useEffect(() => {
    if (flash === null) return;
    const t = window.setTimeout(() => setFlash(null), 2400);
    return () => window.clearTimeout(t);
  }, [flash]);

  const run = useCallback(async <T,>(p: Promise<T>): Promise<T | null> => {
    try {
      const r = await p;
      setNote("");
      return r;
    } catch (e) {
      setNote(errorText(e));
      return null;
    }
  }, []);

  /** 바뀐 민원 하나를 목록에 넣어요. 연번이 큰 것이 위예요. */
  const put = useCallback((c: Complaint) => {
    setList((old) => [c, ...(old ?? []).filter((x) => x.id !== c.id)].sort((a, b) => b.no - a.no || b.id - a.id));
  }, []);

  async function saveLists(next: Lists) {
    const s = { ...settings, ...next };
    setSettings(s);
    try {
      await saveSettings(s);
    } catch (e) {
      setNote(errorText(e));
    }
  }

  function saveWidths(ws: (number | null)[]) {
    setWidths(ws);
    run(api.set(COLS_KEY, JSON.stringify(ws)));
  }

  const all = list ?? [];

  /**
   * 배치최적화(2026-10-19 사용자): 내용·조치내용과 폭 고정 열을 뺀 열(연번·접수유형·민원유형·지역·위치·민원인)을
   * 민원 전체에서 가장 긴 글이 한 줄에 들어가는 폭 + 여유로 맞추고, 남는 폭은 내용·조치내용이 반씩 가져요.
   * 가장 좁아도 열 제목(+ 거르기 아이콘) 폭. 열 제목 줄 우클릭 "열 너비 초기화"로 처음대로.
   */
  function fitColumns() {
    const table = tableRef.current;
    if (!table) return;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    const family = getComputedStyle(table).fontFamily;
    const textW = (s: string, weight: number, size: number) => {
      ctx.font = `${weight} ${size}px ${family}`;
      return ctx.measureText(s).width;
    };
    const maxW = (xs: string[], weight: number, size: number) => Math.max(0, ...xs.filter(Boolean).map((x) => textW(x, weight, size)));
    const PAD = 20; // 칸 좌우 10px
    const SLACK = 12; // 글 앞뒤 여유 좌우 6px씩(2026-10-19 사용자 1안)
    const SLACK_UI = 8; // 배지·단추만 있는 칸
    const FILTER_EXTRA = 40; // 거르기 단추 여백·테두리·아이콘
    const GAP = 8; // 날짜와 D-day·걸린 날 사이
    const today = todayStr();
    // 열마다 보이는 글 가장 긴 폭(민원 전체)
    const need: Partial<Record<ColKey, () => number>> = {
      no: () => maxW(all.map((c) => String(c.no)), 400, 13),
      intake: () => maxW(all.map((c) => c.intake), 500, 13),
      received: () => maxW(all.map((c) => c.received), 400, 13),
      ctype: () => maxW(all.map((c) => c.ctype), 400, 13),
      area: () => maxW(all.map((c) => c.area), 400, 13),
      place: () => maxW(all.map((c) => c.place), 400, 13),
      person: () => maxW(all.map((c) => c.person), 400, 13),
      phone: () => maxW(all.map((c) => c.phone), 400, 13),
      due: () => {
        const d = maxW(all.map((c) => c.due), 400, 13);
        const n = maxW(all.map((c) => daysLeft(c, today)).filter((x): x is number => x !== null).map(ddayText), 700, 11.5);
        return d + (n ? GAP + n : 0);
      },
      done: () => {
        const d = maxW(all.map((c) => c.done ?? ""), 400, 13);
        const n = maxW(all.map((c) => { const t = daysTaken(c); return t === null ? "" : takenText(c, t); }), 600, 11.5);
        return d + (n ? GAP + n : 0);
      },
    };
    const UI: Partial<Record<ColKey, number>> = { status: 52, memo: 28 }; // 상태 배지 폭 52 · 메모 단추 28
    const next = COLUMNS.map((col) => {
      if (col.w === null) return null; // 내용·조치내용은 남는 폭 반씩
      const filt = (FILTER_KEYS as string[]).includes(col.key);
      const head = textW(col.label, 600, 12) + (filt ? FILTER_EXTRA : PAD) + (col.key === "done" ? 16 : 0); // 조치완료일 머리엔 접기 단추
      const ui = UI[col.key];
      if (ui !== undefined) return Math.max(COL_MIN, Math.ceil(Math.max(ui + PAD, head) + SLACK_UI));
      const body = need[col.key]?.() ?? 0;
      return Math.max(COL_MIN, Math.ceil(Math.max(body + PAD, head) + SLACK));
    });
    saveWidths(next);
  }
  const query = q.trim().toLowerCase();
  const found = all.filter((c) => matches(c, query));
  const shown = found.filter((c) => passes(c, filters));
  shownRef.current = shown;

  // 상태 칩: 설정 목록 + 기록에만 남아 있는 상태
  const statuses = useMemo(() => {
    const extra = [...new Set(all.map((c) => c.status))].filter((s) => !settings.status.includes(s));
    return [...settings.status, ...extra];
  }, [all, settings.status]);

  /** 열마다 고를 수 있는 값 (상태는 상태 목록 순서) */
  const valuesOf = (k: FilterKey) => (k === "status" ? statuses : filterValues(all, k));

  /** 필터를 바꿔요. 모든 값을 고르면 "모두"(null)예요. 상태는 마지막 것을 저장해요. */
  function setFilter(k: FilterKey, v: string[] | null) {
    const all = valuesOf(k);
    const next = v !== null && v.length === all.length && all.every((x) => v.includes(x)) ? null : v;
    setFilters((f) => ({ ...f, [k]: next }));
    if (k === "status") run(api.set(STATUS_FILTER_KEY, JSON.stringify(next)));
  }

  function clearFilters() {
    setFilters(NO_FILTERS);
    if (filters.status !== null) run(api.set(STATUS_FILTER_KEY, "null"));
  }

  // 고른 상태가 목록에서 사라졌으면 빼요.
  useEffect(() => {
    const sf = filters.status;
    if (sf === null || !list) return;
    const kept = sf.filter((s) => statuses.includes(s));
    if (kept.length !== sf.length) setFilter("status", kept.length ? kept : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, statuses, list]);

  const doneIdx = COLUMNS.findIndex((c) => c.key === "done");
  const fitted = fitComplaintCols(doneFolded ? widths.map((w, i) => (i === doneIdx ? DONE_FOLD_W : w)) : widths, avail);
  const shownWidths = fitted.ws;
  const foldDone = (v: boolean) => {
    setDoneFolded(v);
    run(api.set(DONE_FOLD_KEY, v ? "true" : "false"));
  };
  const tableStyle = { "--cm-cols": gridTemplate(shownWidths, fitted.flexMin) } as CSSProperties;
  const memoOf = all.find((c) => c.id === memoId) ?? null;

  // 표 안쪽 폭을 재요(창 크기를 바꾸면 다시).
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const measure = () => setAvail(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list === null]);

  if (!list) {
    return (
      <>
        <h1 className="title">민원대장</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  return (
    <>
      <div className="ct-head cm-top tb5">
        <h1 className="sr-only">민원대장</h1>
        <FilterChips
          statuses={statuses}
          base={found.filter((c) => passes(c, filters, "status"))}
          filters={filters}
          onStatus={(v) => setFilter("status", v)}
          onOpen={setOpenFilter}
          onClear={(k) => setFilter(k, null)}
          onClearAll={clearFilters}
        />
        <button type="button" className="btn btn-ctrl cm-tool tb-fit" title="열 폭을 글 길이에 맞추고 남는 폭은 내용·조치내용에 반씩 · 열 제목 우클릭으로 처음대로" onClick={fitColumns}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5v14M21 5v14M3 12h6M21 12h-6M6 9l3 3-3 3M18 9l-3 3 3 3" />
          </svg>
          배치최적화
        </button>
        <button type="button" className="btn btn-ctrl btn-text tb-pop" onClick={() => setCatsOpen(true)}>
          분류 관리
        </button>
        <label className="search">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            aria-label="민원 검색"
            placeholder="위치, 내용, 민원인 검색"
            value={q}
            onKeyDown={qGuard.onKeyDown}
            onChange={qGuard.onChange}
            onCompositionEnd={qGuard.onCompositionEnd}
          />
        </label>
        <ExcelMenu
          kind="complaints"
          total={all.length}
          build={() => ({ rows: complaintRows(all), intake: settings.intake, status: settings.status })}
          parse={complaintImports}
          onImport={async (rows) => {
            // 위치가 도로명주소면 웹 먼저 바꿔 넣어요(한 번에 4줄, 웹이 안 되면 앱이 내장 표로 바꿔요 – 2026-10-21 사용자 2안).
            const { found, web, table } = await lookupMany(rows.map((r) => r.place));
            const conv = rows.map((r, i) => {
              const f = found[i];
              if (f?.kind !== "exact") return r;
              return { ...r, place: f.hit.place, area: areaFor(f.hit, r.area), road: r.road || f.original };
            });
            const n = await api.importComplaints(conv);
            setList(await api.complaints());
            return web + table ? { n, note: `주소 바꿈 웹 ${web} · 내장 ${table}` } : n;
          }}
        />
      </div>

      {note && <p className="note" role="status">{note}</p>}

      <div className={"cm" + (doneFolded ? " cm-fold-done" : "")} role="table" aria-label="민원 목록" style={tableStyle} ref={tableRef}>
        <HeadRow
          widths={shownWidths}
          avail={avail}
          onResize={setWidths}
          onResized={saveWidths}
          onResetWidths={() => saveWidths(defaultWidths())}
          doneFolded={doneFolded}
          onFoldDone={foldDone}
          filters={filters}
          open={openFilter}
          onToggle={(k) => setOpenFilter(openFilter === k ? null : k)}
          dropdown={
            openFilter && (
              <FilterMenu
                k={openFilter}
                values={valuesOf(openFilter)}
                pool={found.filter((c) => passes(c, filters, openFilter))}
                sel={filters[openFilter]}
                onChange={(v) => setFilter(openFilter, v)}
                onClose={() => setOpenFilter(null)}
              />
            )
          }
        />
        <NewRow lists={settings} onAdd={async (input) => {
          const c = await run(api.addComplaint(input));
          if (c) {
            put(c);
            // 거르는 중이라 새 민원이 안 보이면 거르기를 풀어요.
            if (!passes(c, filters)) clearFilters();
            if (query && !matches(c, query)) setQ("");
          }
          return !!c;
        }} />
        <VirtualList
          ref={vlRef}
          parentRef={tableRef}
          count={shown.length}
          getKey={(i) => shown[i].id}
          estimate={(i) => rowEstimate(shown[i])}
          pinned={[editId, selId, flash].map((id) => (id == null ? null : shown.findIndex((c) => c.id === id)))}
          resetKey={tableStyle["--cm-cols" as keyof CSSProperties] as string}
          render={(i) => {
            const c = shown[i];
            return (
              editId === c.id ? (
                <EditRow
                  vi={i}
                  c={c}
                  lists={settings}
                  onCancel={() => setEditId(null)}
                  onSave={async (input) => {
                    setEditId(null);
                    if (same(c, input)) return;
                    const r = await run(api.updateComplaint(c.id, input));
                    if (r) put(r);
                  }}
                  onRemove={async () => {
                    setEditId(null);
                    // delete_complaint는 성공해도 null을 돌려줘요 → true로 바꿔 실패(null)와 가려요(2026-10-19 사용자: 지우기가 안 먹음)
                    if (await run(api.deleteComplaint(c.id).then(() => true))) setList((old) => (old ?? []).filter((x) => x.id !== c.id));
                  }}
                  onMemo={() => setMemoId(c.id)}
                />
              ) : (
                <ViewRow
                  vi={i}
                  c={c}
                  alt={i % 2 === 1}
                  q={query}
                  today={today}
                  urgentDays={urgentDays}
                  flash={flash === c.id}
                  selected={selId === c.id}
                  statuses={statuses}
                  onSelect={() => setSelId(c.id)}
                  onEdit={() => {
                    setMemoId(null);
                    setSelId(c.id);
                    setEditId(c.id);
                  }}
                  onMemo={() => setMemoId(c.id)}
                  onStatus={async (status) => {
                    if (status === c.status) return;
                    // 완료·불가가 되면 조치완료일에 오늘(이미 있으면 그대로), 다른 상태로 돌리면 비워요(2026-10-19 사용자).
                    const done = isClosed(status) ? c.done || todayStr() : isClosed(c.status) ? "" : undefined;
                    const r = await run(api.setComplaintStatus(c.id, status, done));
                    if (r) put(r);
                  }}
                  onDone={async (done) => {
                    const r = await run(api.setComplaintStatus(c.id, c.status, done));
                    if (r) put(r);
                  }}
                />
              )
            );
          }}
        />
        {all.length === 0 ? (
          <div className="cm-empty muted small">아직 민원이 없어요. 위 줄에 적고 상태 칸에서 Enter를 눌러 등록해요. 필수 칸은 내용 하나예요.</div>
        ) : shown.length === 0 ? (
          <div className="cm-empty muted small">맞는 민원이 없어요.</div>
        ) : null}
      </div>

      {memoOf && (
        <MemoDialog
          c={memoOf}
          onClose={() => setMemoId(null)}
          onSave={async (memo) => {
            setMemoId(null);
            if (memo === memoOf.memo) return;
            const r = await run(api.setComplaintMemo(memoOf.id, memo));
            if (r) put(r);
          }}
        />
      )}

      {catsOpen && <CatsDialog lists={settings} onChange={saveLists} onClose={() => setCatsOpen(false)} />}
    </>
  );
}

/**
 * 아직 재지 않은 줄의 높이 추정(보이는 만큼만 그리기). 내용·조치내용 줄 수로 셈해요 –
 * 칸 위아래 여백 8 + 줄마다 20(13px × 1.5) + 줄 사이 3 + 아래 선 1. 줄바꿈으로 더 높아지면 그릴 때 재서 고쳐요.
 */
function rowEstimate(c: Complaint): number {
  const n = Math.max(1, parseLines(c.body).length, parseLines(c.action).length);
  return Math.max(37, 14 + 23 * n);
}

/** 고친 것이 없으면 저장하지 않아요. */
function same(c: Complaint, i: ComplaintInput) {
  return (Object.keys(i) as (keyof ComplaintInput)[]).every((k) => c[k] === i[k]);
}

// ---------- 열 제목과 너비 끌기 ----------

function HeadRow({
  widths,
  avail,
  onResize,
  onResized,
  onResetWidths,
  filters,
  open,
  onToggle,
  dropdown,
  doneFolded,
  onFoldDone,
}: {
  widths: (number | null)[];
  avail: number;
  onResize: (w: (number | null)[]) => void;
  onResized: (w: (number | null)[]) => void;
  onResetWidths: () => void;
  filters: ColFilters;
  open: FilterKey | null;
  onToggle: (k: FilterKey) => void;
  dropdown: ReactNode;
  doneFolded: boolean;
  onFoldDone: (v: boolean) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // 열 제목 줄 우클릭 메뉴: 열 너비 초기화 (2026-10-17 사용자 2안)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function start(e: ReactMouseEvent, i: number) {
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    // 남는 폭을 나눠 갖는 열도 끌면 지금 보이는 폭에서 시작해요.
    const base = widths.map((w, j) => w ?? (row.children[j] as HTMLElement).getBoundingClientRect().width);
    const startX = e.clientX;
    // 표 폭을 넘게 넓히지 않아요(가로 스크롤이 생기지 않게).
    const max = avail > 0 ? maxWidthOf(widths, i, avail, base) : Infinity;
    let last = widths;
    const move = (ev: MouseEvent) => {
      const next = widths.slice();
      next[i] = Math.min(max, Math.max(COL_MIN, Math.round(base[i] + ev.clientX - startX)));
      last = next;
      onResize(next);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("col-dragging");
      if (last !== widths) onResized(last);
    };
    document.body.classList.add("col-dragging");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  return (
    <div
      role="row"
      className="cm-row cm-head"
      ref={rowRef}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {COLUMNS.map((col, i) => {
        const fk = (FILTER_KEYS as string[]).includes(col.key) ? (col.key as FilterKey) : null;
        const on = fk !== null && filters[fk] !== null;
        return (
          <div role="columnheader" key={col.key} className={"cm-hcell" + (col.key === "no" ? " right" : "") + (fk || col.key === "done" ? " cm-hf" : "")}>
            {col.key === "done" ? (
              <button
                type="button"
                className={"cm-hbtn cm-fold" + (doneFolded ? " folded" : "")}
                aria-expanded={!doneFolded}
                aria-label={doneFolded ? "조치완료일 펼치기" : "조치완료일 접기"}
                title={doneFolded ? "조치완료일 펼치기" : "조치완료일 접기"}
                onClick={() => onFoldDone(!doneFolded)}
              >
                {!doneFolded && <span>{col.label}</span>}
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d={doneFolded ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
                </svg>
              </button>
            ) : fk ? (
              <button
                type="button"
                className={"cm-hbtn" + (on ? " on" : "")}
                aria-haspopup="dialog"
                aria-expanded={open === fk}
                aria-label={col.label + " 거르기" + (on ? " (거르는 중)" : "")}
                onClick={() => onToggle(fk)}
              >
                <span>{col.label}</span>
                {on && <Funnel />}
              </button>
            ) : (
              col.label
            )}
            {open === fk && fk && dropdown}
            {i < COLUMNS.length - 1 && !col.fixed && <span className="cm-grip" aria-hidden="true" title="끌어서 열 너비 바꾸기" onMouseDown={(e) => start(e, i)} />}
          </div>
        );
      })}
      {menu && (
        <HeadMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onReset={() => {
            setMenu(null);
            onResetWidths();
          }}
        />
      )}
    </div>
  );
}

/** 열 제목 줄 우클릭 메뉴 */
function HeadMenu({ x, y, onClose, onReset }: { x: number; y: number; onClose: () => void; onReset: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    box.current?.querySelector<HTMLElement>(".dmenu-item")?.focus();
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const style = { left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 80) };
  return (
    <div ref={box} className="dmenu" role="menu" aria-label="열 제목 메뉴" style={style} onContextMenu={(e) => e.preventDefault()}>
      <button type="button" role="menuitem" className="dmenu-item" onClick={onReset}>
        열 너비 초기화
      </button>
    </div>
  );
}

// ---------- 열 필터 (시안 ComplaintFilter.dc.html) ----------

/** 상태 칩 줄 + 걸린 필터 알약 (건수 글줄은 2026-10-19 사용자가 뺌) */
function FilterChips({
  statuses,
  base,
  filters,
  onStatus,
  onOpen,
  onClear,
  onClearAll,
}: {
  statuses: string[];
  /** 상태 필터만 뺀 나머지 필터·검색을 건 민원 (칩 숫자) */
  base: Complaint[];
  filters: ColFilters;
  onStatus: (v: string[] | null) => void;
  onOpen: (k: FilterKey) => void;
  onClear: (k: FilterKey) => void;
  onClearAll: () => void;
}) {
  const sf = filters.status;
  const pills = (["intake", "ctype", "area"] as FilterKey[]).filter((k) => filters[k] !== null);
  const many = pills.length + (sf !== null ? 1 : 0) > 1;
  const label = (v: string) => (v === "" ? "(빈 칸)" : v);
  return (
    <div className="ct-chips" role="group" aria-label="상태로 거르기">
      <span className="ct-chips-label">상태</span>
      <button type="button" className="pchip" aria-pressed={sf === null} onClick={() => onStatus(null)}>
        <span>전체</span>
        <span className="pchip-n">{base.length}</span>
      </button>
      {statuses.map((s) => {
        const on = sf !== null && sf.includes(s);
        return (
          <button key={s} type="button" className="pchip" aria-pressed={on} onClick={() => {
              // 여러 개를 골라요(2026-10-19 사용자): 누르면 넣고·빼고, 다 빠지거나 전부 고르면 전체예요.
              const next = sf === null ? [s] : on ? sf.filter((x) => x !== s) : [...sf, s];
              onStatus(next.length === 0 || next.length === statuses.length ? null : statuses.filter((x) => next.includes(x)));
            }}>
            <span>{s}</span>
            <span className="pchip-n">{base.filter((c) => c.status === s).length}</span>
          </button>
        );
      })}
      {pills.length > 0 && (
        <>
          <span className="cm-fsep" aria-hidden="true" />
          {pills.map((k) => {
            const v = filters[k]!;
            const text = v.length === 0 ? "없음" : label(v[0]) + (v.length > 1 ? ` 외 ${v.length - 1}` : "");
            return (
              <span key={k} className="cm-fpill">
                <button type="button" className="cm-fpill-open" onClick={() => onOpen(k)}>
                  <span className="cm-fpill-k">{FILTER_LABEL[k]}</span>
                  <span>{text}</span>
                </button>
                <button type="button" className="cm-fpill-x" aria-label={FILTER_LABEL[k] + " 필터 풀기"} onClick={() => onClear(k)}>
                  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            );
          })}
        </>
      )}
      {many && (
        <button type="button" className="cm-fall" onClick={onClearAll}>
          모두 풀기
        </button>
      )}
    </div>
  );
}

/**
 * 열 필터 목록(엑셀 필터처럼): 모두, 값마다 체크 + 다른 필터를 건 뒤의 개수(0은 회색), 찾기 칸(상태는 없음),
 * 바로 적용, "필터 풀기"·"닫기", Esc 닫기, 바깥을 누르기 시작하면 닫기.
 */
function FilterMenu({
  k,
  values,
  pool,
  sel,
  onChange,
  onClose,
}: {
  k: FilterKey;
  values: string[];
  /** 이 열만 뺀 나머지 필터·검색을 건 민원 (개수) */
  pool: Complaint[];
  sel: string[] | null;
  onChange: (v: string[] | null) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fq, setFq] = useState("");
  const guard = useJamoGuard(setFq);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // 같은 열 제목 단추는 그 단추가 여닫아요.
      if (box.current?.contains(t) || t.closest?.(".cm-hbtn[aria-expanded='true']")) return;
      close.current();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        close.current();
      }
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, []);

  const count = (v: string) => pool.filter((c) => c[k] === v).length;
  const vals = k === "status" ? values : values.slice().sort((a, b) => count(b) - count(a) || (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ko")));
  const label = (v: string) => (v === "" ? "(빈 칸)" : v);
  const qq = fq.trim().toLowerCase();
  const opts = vals.filter((v) => !qq || label(v).toLowerCase().includes(qq) || koIndex(label(v), qq) >= 0);
  const isOn = (v: string) => sel === null || sel.includes(v);
  const some = sel === null || sel.length > 0;

  return (
    <div ref={box} className={"cm-fdd" + (k === "status" ? " end" : "")} role="dialog" aria-label={FILTER_LABEL[k] + " 거르기"} onContextMenu={(e) => e.stopPropagation()}>
      <div className="cm-fdd-head">
        <span>{FILTER_LABEL[k]}</span>
        <span className="cm-fdd-sub">{sel === null ? "모두 보는 중" : `${sel.length}개 고름`}</span>
      </div>
      {k !== "status" && (
        <label className="search cm-fdd-search">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            aria-label="값 찾기"
            placeholder={k === "area" ? "읍면동 찾기" : "찾기"}
            value={fq}
            autoFocus
            onKeyDown={guard.onKeyDown}
            onChange={guard.onChange}
            onCompositionEnd={guard.onCompositionEnd}
          />
        </label>
      )}
      <div className="cm-fdd-list" role="group" aria-label="값 목록">
        <button type="button" role="menuitemcheckbox" aria-checked={sel === null} className="cm-fdd-opt all" onClick={() => onChange(sel === null ? [] : null)}>
          <Check on={some} partial={sel !== null && sel.length > 0} />
          <span className="cm-fdd-name">모두</span>
        </button>
        {opts.map((v) => {
          const on = isOn(v);
          const n = count(v);
          return (
            <button
              key={v}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className={"cm-fdd-opt" + (n ? "" : " zero")}
              onClick={() => {
                const cur = sel === null ? values.slice() : sel.slice();
                onChange(on ? cur.filter((x) => x !== v) : [...cur, v]);
              }}
            >
              <Check on={on} />
              <span className="cm-fdd-name">{label(v)}</span>
              <span className="cm-fdd-n">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="cm-fdd-foot">
        <button type="button" className="cm-fdd-clear" onClick={() => onChange(null)}>
          필터 풀기
        </button>
        <button type="button" className="btn btn-xs" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

function Check({ on, partial }: { on: boolean; partial?: boolean }) {
  return (
    <span className={"cm-ck" + (on ? " on" : "")} aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={partial ? "M6 12h12" : "M5 12.5l4.5 4.5L19 7.5"} />
      </svg>
    </span>
  );
}

function Funnel() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />
    </svg>
  );
}

// ---------- 입력 칸들 ----------

type Draft = ComplaintInput;
type DateKey = "received" | "due" | "done";

const emptyDraft = (lists: Lists): Draft => ({
  intake: lists.intake[0] ?? "",
  received: todayStr(),
  ctype: "",
  area: "",
  place: "",
  road: "",
  person: "",
  phone: "",
  body: "",
  action: "",
  due: "",
  status: lists.status[0] ?? "",
  done: "",
});

type Bad = { received?: boolean; due?: boolean; done?: boolean; body?: boolean; intake?: boolean; status?: boolean };

/** 날짜 칸을 떠날 때 "1016" 같은 것을 2026-10-16으로 바꿔요. 읽을 수 없으면 빨간 테두리예요. */
function normDates(d: Draft): { d: Draft; bad: Bad } {
  const bad: Bad = {};
  const r = parseDate(d.received);
  if (!r) bad.received = true;
  const due = d.due.trim() ? parseDate(d.due) : "";
  if (due === null) bad.due = true;
  const done = (d.done ?? "").trim() ? parseDate(d.done ?? "") : "";
  if (done === null) bad.done = true;
  if (!plainOf(d.body).trim()) bad.body = true;
  return { d: { ...d, received: r ?? d.received, due: due ?? d.due, done: done ?? d.done }, bad };
}

/**
 * 민원유형 칸. 적으면서 설정 목록에서 맞는 것을 보여 주고(초성도 돼요), ↑↓로 고르고 Enter로 넣어요.
 * 목록에 없는 값을 적어도 그대로 받아요(실제 목록을 받기 전이라서요).
 */
function TypeInput({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  // 초성을 칠 때 입력기가 자음을 묶지 않게 해요(ㄳ→ㄱㅅ, Shift 없이 친 ㅆ→ㅅㅅ).
  const guard = useJamoGuard((v) => {
    onChange(v);
    setOpen(true);
    setHi(-1);
  });
  guard.follow(value);
  const v = value.trim();
  const found = options.filter((o) => !v || o.toLowerCase().includes(v.toLowerCase()) || koIndex(o, v) >= 0).filter((o) => o !== v).slice(0, 10);
  const show = open && found.length > 0;

  function pick(o: string) {
    guard.sync(o);
    onChange(o);
    setHi(-1);
    setOpen(false);
  }

  return (
    <div className="pin">
      <input
        name="ctype"
        aria-label="민원유형"
        placeholder="유형"
        autoComplete="off"
        className="cell-input"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        value={value}
        onChange={guard.onChange}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setHi(-1);
          const x = expandType(value, options);
          if (x !== value) {
            guard.sync(x);
            onChange(x);
          }
        }}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e) || !show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((hi + 1) % found.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi(hi <= 0 ? found.length - 1 : hi - 1);
          } else if (e.key === "Enter" && hi >= 0) {
            e.preventDefault();
            pick(found[hi]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="pin-list" role="listbox">
          {found.map((o, i) => (
            <div
              key={o}
              role="option"
              aria-selected={i === hi}
              className="pin-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 신규 줄과 고치는 줄이 함께 쓰는 칸 묶음 (사양서 순서, 연번과 메모 칸 빼고) */
function Cells({
  d,
  set,
  bad,
  lists,
  firstRef,
  onDateBlur,
  orig,
}: {
  d: Draft;
  set: (patch: Partial<Draft>) => void;
  bad: Bad;
  lists: Lists;
  firstRef?: React.Ref<HTMLInputElement>;
  onDateBlur: (k: DateKey) => void;
  /** 고치는 줄이면 고치기 전 값. 지금 목록에서 빠진 접수유형·상태도 그대로 받아 줘요. */
  orig?: Draft;
}) {
  return (
    <>
      <div role="cell" className="cm-c">
        <ChoiceInput
          inputRef={firstRef}
          name="intake"
          label="접수유형"
          value={d.intake}
          options={lists.intake}
          allow={orig?.intake}
          invalid={bad.intake}
          onChange={(intake) => set({ intake })}
        />
      </div>
      <div role="cell" className="cm-c">
        <input
          name="received"
          aria-label="접수일"
          aria-invalid={bad.received || undefined}
          className={"cell-input num" + (bad.received ? " invalid" : "")}
          inputMode="numeric"
          value={d.received}
          onChange={(e) => set({ received: e.target.value })}
          onBlur={() => onDateBlur("received")}
        />
      </div>
      <div role="cell" className="cm-c">
        <TypeInput value={d.ctype} options={lists.ctype} onChange={(ctype) => set({ ctype })} />
      </div>
      <div role="cell" className="cm-c cm-area-auto" title="위치에서 자동으로 채워져요">
        {d.area}
      </div>
      <div role="cell" className="cm-c">
        <PlaceInput value={d.place} area={d.area} road={d.road} onChange={(place) => set({ place })} onArea={(area) => set({ area })} onRoad={(road) => set({ road })} />
      </div>
      <div role="cell" className="cm-c">
        <input name="person" aria-label="민원인" placeholder="민원인" className="cell-input" value={d.person} onChange={(e) => set({ person: e.target.value })} />
      </div>
      <div role="cell" className="cm-c">
        <PhoneInput name="phone" aria-label="연락처" placeholder="연락처" className="cell-input num" value={d.phone} onChange={(phone) => set({ phone })} />
      </div>
      <div role="cell" className="cm-c">
        <BulletEditor
          name="body"
          label="내용"
          invalid={bad.body}
          placeholder="민원 내용"
          lines={parseLines(d.body)}
          onChange={(ls) => set({ body: JSON.stringify(ls) })}
        />
      </div>
      <div role="cell" className="cm-c">
        <BulletEditor name="action" label="조치내용" placeholder="조치내용" lines={parseLines(d.action)} onChange={(ls) => set({ action: JSON.stringify(ls) })} />
      </div>
      <div role="cell" className="cm-c">
        <input
          name="due"
          aria-label="마감일"
          aria-invalid={bad.due || undefined}
          className={"cell-input num" + (bad.due ? " invalid" : "")}
          placeholder="연-월-일"
          inputMode="numeric"
          value={d.due}
          onChange={(e) => set({ due: e.target.value })}
          onBlur={() => onDateBlur("due")}
        />
      </div>
      <div role="cell" className="cm-c">
        <ChoiceInput
          name="status"
          label="상태"
          value={d.status}
          options={lists.status}
          allow={orig?.status}
          invalid={bad.status}
          stayOnTab
          onChange={(status) =>
            // 완료·불가를 고르면 비어 있는 조치완료일에 오늘, 다른 상태로 돌리면 비워요(배지와 같게).
            set({ status, ...(isClosed(status) ? (d.done ? {} : { done: todayStr() }) : isClosed(d.status) ? { done: "" } : {}) })
          }
        />
      </div>
      <div role="cell" className="cm-c cm-done-in">
        <input
          name="done"
          aria-label="조치완료일"
          aria-invalid={bad.done || undefined}
          className={"cell-input num" + (bad.done ? " invalid" : "")}
          placeholder="연-월-일"
          inputMode="numeric"
          value={d.done ?? ""}
          onChange={(e) => set({ done: e.target.value })}
          onBlur={() => onDateBlur("done")}
        />
      </div>
    </>
  );
}

/** 칸 이름으로 그 칸에 커서를 둬요. */
function focusField(row: HTMLElement | null, name: string) {
  row?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
}

/** 칸 묶음이 함께 쓰는 입력 상태. 날짜를 떠날 때 바꾸고, 저장할 때 검사해요. */
function useDraft(init: () => Draft) {
  const [d, setD] = useState<Draft>(init);
  const [bad, setBad] = useState<Bad>({});
  const set = (patch: Partial<Draft>) => {
    setD((old) => ({ ...old, ...patch }));
    setBad((b) => {
      const n = { ...b };
      for (const k of Object.keys(patch)) delete n[k as keyof Bad];
      return n;
    });
  };
  const onDateBlur = (k: DateKey) => {
    const v = (d[k] ?? "").trim();
    if (!v && k !== "received") return;
    const p = parseDate(v);
    if (p) set({ [k]: p });
    else setBad((b) => ({ ...b, [k]: true }));
  };
  /** 등록·저장할 값. 틀린 칸이 있으면 null이고 그 칸 이름을 돌려줘요. */
  const check = (lists: Lists, orig?: Draft): { input: Draft | null; first?: string } => {
    const { d: n, bad: b } = normDates(d);
    // 접수유형·상태는 목록에 있는 값만 받아요(고치는 줄은 고치기 전 값도). 접수유형은 비워도 돼요.
    const ok = (v: string, list: string[], was?: string) => list.includes(v.trim()) || (!!was && v.trim() === was);
    n.intake = n.intake.trim();
    n.status = n.status.trim();
    if (n.intake && !ok(n.intake, lists.intake, orig?.intake)) b.intake = true;
    if (!ok(n.status, lists.status, orig?.status)) b.status = true;
    setD(n);
    setBad(b);
    const first = (["intake", "received", "body", "due", "status", "done"] as const).find((k) => b[k]);
    if (first) return { input: null, first };
    return { input: { ...n, phone: finalizePhone(n.phone), body: stringifyLines(parseLines(n.body)), action: stringifyLines(parseLines(n.action)) } };
  };
  return { d, setD, bad, setBad, set, onDateBlur, check };
}

// ---------- 신규 입력 줄 ----------

function NewRow({ lists, onAdd }: { lists: Lists; onAdd: (c: ComplaintInput) => Promise<boolean> }) {
  const f = useDraft(() => emptyDraft(lists));
  const rowRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  // 화면을 열면 첫 칸에 커서가 가 있어요.
  useEffect(() => firstRef.current?.focus(), []);

  // 설정 목록이 늦게 들어오면 비어 있는 고르기 칸을 채워요.
  useEffect(() => {
    f.setD((old) => ({
      ...old,
      intake: old.intake || lists.intake[0] || "",
      status: old.status || lists.status[0] || "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists.intake, lists.status]);

  async function submit() {
    const { input, first } = f.check(lists);
    if (!input) return focusField(rowRef.current, first!);
    if (await onAdd(input)) {
      // 접수일은 그대로 두어 같은 날 여러 건을 잇달아 적기 쉽게 해요.
      f.setD({ ...emptyDraft(lists), received: input.received });
      firstRef.current?.focus();
    }
  }

  return (
    <div
      role="row"
      className="cm-row cm-new"
      ref={rowRef}
      onKeyDown={(e) => rowKeys(e, rowRef.current, submit)}
    >
      <div role="cell" className="cm-c cm-new-tag">
        신규
      </div>
      <Cells d={f.d} set={f.set} bad={f.bad} lists={lists} firstRef={firstRef} onDateBlur={f.onDateBlur} />
      <div role="cell" className="cm-c cm-center">
        <button type="button" className="btn-icon btn-add" aria-label="민원 등록" title="등록" tabIndex={-1} onClick={submit}>
          <Plus />
        </button>
      </div>
    </div>
  );
}

// ---------- 고치는 줄 ----------

function EditRow({
  vi,
  c,
  lists,
  onCancel,
  onSave,
  onRemove,
  onMemo,
}: {
  vi?: number;
  c: Complaint;
  lists: Lists;
  onCancel: () => void;
  onSave: (input: ComplaintInput) => void;
  onRemove: () => void;
  onMemo: () => void;
}) {
  const f = useDraft(() => ({
    intake: c.intake,
    received: c.received,
    ctype: c.ctype,
    area: c.area,
    place: c.place,
    road: c.road ?? "",
    person: c.person,
    phone: c.phone,
    body: c.body,
    action: c.action,
    due: c.due,
    status: c.status,
    done: c.done ?? "",
  }));
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);

  function save(fromOutside = false) {
    const { input, first } = f.check(lists, { ...c });
    if (!input) {
      // 바깥을 눌렀는데 저장할 수 없으면 고치기 전으로 돌아가요.
      if (fromOutside) return onCancel();
      return focusField(ref.current, first!);
    }
    onSave(input);
  }

  const latest = useRef({ save, asking });
  latest.current = { save, asking };

  // "× 이 민원 지우기"의 × 왼쪽 끝을 연번 숫자 왼쪽 끝에 맞춰요(2026-10-19 사용자 – 숫자 자릿수마다 달라 재서 맞춰요).
  useLayoutEffect(() => {
    const row = ref.current;
    const foot = row?.querySelector<HTMLElement>(".cm-edit-foot");
    const no = row?.querySelector<HTMLElement>(".cm-no");
    const mark = foot?.querySelector<HTMLElement>(".cm-del-x");
    if (!row || !foot || !no || !mark || !no.firstChild) return;
    foot.style.paddingLeft = "";
    const g = document.createRange();
    g.selectNodeContents(no);
    const numLeft = g.getBoundingClientRect().left;
    const delta = numLeft - mark.getBoundingClientRect().left;
    const base = parseFloat(getComputedStyle(foot).paddingLeft) || 0;
    foot.style.paddingLeft = `${Math.max(0, Math.round(base + delta))}px`;
  });

  // 처음에 내용 칸에 커서를 둬요.
  useEffect(() => {
    const all = ref.current?.querySelectorAll<HTMLTextAreaElement>(".bl-ed")[0]?.querySelectorAll("textarea");
    const el = all?.[all.length - 1];
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  // 바깥을 누르면 저장해요. 묻는 띠가 펼쳐져 있으면 줄 안의 다른 곳을 눌렀을 때 띠만 접어요.
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t)) return latest.current.save(true);
      if (latest.current.asking && !askRef.current?.contains(t) && !trashRef.current?.contains(t)) setAsking(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

  const hasMemo = parseMemo(c.memo).length > 0;

  return (
    <div
      ref={ref}
      role="row"
      data-cid={c.id}
      data-vi={vi}
      className="cm-row cm-edit"
      onKeyDown={(e) => {
        if (e.defaultPrevented) return;
        if (isKey(e, "common.cancel")) {
          e.preventDefault();
          if (asking) setAsking(false);
          else onCancel();
        } else rowKeys(e, ref.current, () => save());
      }}
    >
      <div role="cell" className="cm-c cm-no">
        {c.no}
      </div>
      <Cells d={f.d} set={f.set} bad={f.bad} lists={lists} onDateBlur={f.onDateBlur} orig={c} />
      <div role="cell" className="cm-c cm-center">
        <MemoButton has={hasMemo} memo={c.memo} onClick={onMemo} />
      </div>
      <div className="cm-edit-foot">
        {asking ? (
          <div ref={askRef} className="ask-band cm-ask" role="alertdialog" aria-label="민원 지우기 확인">
            <span>{c.no}번 민원을 지울까요? 메모도 함께 지워져요.</span>
            <button type="button" className="btn btn-xs" autoFocus onClick={() => setAsking(false)}>
              취소
            </button>
            <button type="button" className="btn btn-xs btn-danger" onClick={onRemove}>
              지우기
            </button>
          </div>
        ) : (
          <button ref={trashRef} type="button" className="tool-box cm-del" aria-label={`${c.no}번 민원 지우기`} onClick={() => setAsking(true)}>
            <span className="cm-del-x" aria-hidden="true">
              <DelIcon />
            </span>
            <span>이 민원 지우기</span>
          </button>
        )}
        <span className="cm-edit-hint" aria-hidden="true" />
        <button type="button" className="btn btn-xs" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn-primary btn-xs" onClick={() => save()}>
          저장
        </button>
      </div>
    </div>
  );
}

// ---------- 보기 줄 ----------

function Bullets({ text, q }: { text: string; q: string }) {
  return <BulletView className="cm-bullets" lines={parseLines(text)} render={(l) => <Hl text={l.t} q={q} />} />;
}

function ViewRow({
  vi,
  c,
  alt,
  q,
  today,
  urgentDays,
  flash,
  selected,
  statuses,
  onSelect,
  onEdit,
  onMemo,
  onStatus,
  onDone,
}: {
  vi?: number;
  c: Complaint;
  alt: boolean;
  q: string;
  today: string;
  urgentDays: number;
  flash: boolean;
  selected: boolean;
  statuses: string[];
  onSelect: () => void;
  onEdit: () => void;
  onMemo: () => void;
  onStatus: (status: string) => void;
  onDone: (done: string) => void;
}) {
  const n = daysLeft(c, today);
  const taken = daysTaken(c);
  const [bg, fg] = statusColor(c.status);
  const hasMemo = parseMemo(c.memo).length > 0;
  const t = (s: string): ReactNode => <Hl text={s} q={q} />;
  return (
    <div
      role="row"
      tabIndex={0}
      data-cid={c.id}
      data-vi={vi}
      aria-selected={selected}
      className={"cm-row cm-view" + (alt ? " alt" : "") + (flash ? " flash" : "") + (selected ? " sel" : "") + (isClosed(c.status) ? " done" : "")}
      title="두 번 눌러서 고치기 (상태 배지는 바로 바꾸기, 연락처·위치는 복사)"
      onClick={onSelect}
      onDoubleClick={(e) => {
        // 두 번 누를 때 글자가 골라지는 것을 풀어요.
        window.getSelection()?.removeAllRanges();
        e.preventDefault();
        onEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onEdit();
        }
      }}
    >
      <div role="cell" className="cm-c cm-no">
        {t(String(c.no))}
      </div>
      <div role="cell" className="cm-c cm-strong">
        {t(c.intake)}
      </div>
      <div role="cell" className="cm-c cm-num">
        {t(c.received)}
      </div>
      <div role="cell" className="cm-c">
        {t(c.ctype)}
      </div>
      <div role="cell" className="cm-c">
        {t(c.area)}
      </div>
      <div role="cell" className="cm-c">
        {c.place && <CopyCell value={c.place} what="위치" render={t} title={c.road || undefined} />}
      </div>
      <div role="cell" className="cm-c">
        {t(c.person)}
      </div>
      <div role="cell" className="cm-c cm-num">
        {c.phone && <CopyCell value={c.phone} what="연락처" render={t} />}
      </div>
      <div role="cell" className="cm-c cm-multi">
        <Bullets text={c.body} q={q} />
      </div>
      {/* 조치내용도 내용과 같은 글자색(2026-10-21 사용자 1안) */}
      <div role="cell" className="cm-c cm-multi">
        <Bullets text={c.action} q={q} />
      </div>
      <div role="cell" className="cm-c cm-num cm-due">
        <span className={c.due && isAnswered(c.status) ? "cm-due-done" : undefined} title={c.due && isAnswered(c.status) ? "답변 끝남" : undefined}>
          {t(c.due)}
        </span>
        {n !== null && <span className={"cm-dday" + (isUrgent(n, urgentDays) ? " urgent" : "")}>{ddayText(n)}</span>}
      </div>
      <div role="cell" className="cm-c">
        <StatusPick status={c.status} statuses={statuses} bg={bg} fg={fg} render={t} onPick={onStatus} />
      </div>
      <div role="cell" className="cm-c cm-num cm-due cm-done-c">
        <span className="cm-done-d">{t(c.done ?? "")}</span>
        {taken !== null && <TakenPick c={c} taken={taken} onSave={onDone} />}
      </div>
      <div role="cell" className="cm-c cm-center">
        <span onDoubleClick={(e) => e.stopPropagation()}>
          <MemoButton
            has={hasMemo}
            memo={c.memo}
            onClick={(e) => {
              e.stopPropagation();
              onMemo();
            }}
          />
        </span>
      </div>
    </div>
  );
}

function MemoButton({ has, memo, onClick }: { has: boolean; memo: string; onClick: (e: ReactMouseEvent) => void }) {
  const preview = has ? parseMemo(memo).map((l) => "· " + l.t).join("\n") : "메모 추가";
  return (
    <button type="button" className={"cm-memo" + (has ? " has" : "")} aria-label={has ? "메모 편집" : "메모 추가"} title={preview} onClick={onClick}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={has ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
  );
}

/** 연락처·위치 칸: 누르면 그 글자를 복사하고 "복사했어요"를 잠깐 보여요(줄 고르기·고치기로 넘어가지 않아요). */
/** title을 주면 "눌러서 복사" 대신 그 글을 보여요(위치: 바꾸기 전 도로명주소). */
function CopyCell({ value, what, render, title }: { value: string; what: string; render: (s: string) => ReactNode; title?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={"cm-copy" + (copied ? " copied" : "")}
      onDoubleClick={(e) => e.stopPropagation()}
      title={title ?? "눌러서 복사"}
      aria-label={`${what} ${value} 복사`}
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(value);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      <span className="cm-copy-v">{render(value)}</span>
      <span className="cm-copy-note" aria-live="polite">
        {copied ? "복사했어요" : ""}
      </span>
    </button>
  );
}

/**
 * 상태 배지: 누르면 상태 목록이 바로 떠요(줄 고치기로 넘어가지 않아요). 고르면 바로 저장해요.
 * ↑↓로 고르고 Enter, Esc나 바깥을 누르면 닫혀요.
 */
function StatusPick({
  status,
  statuses,
  bg,
  fg,
  render,
  onPick,
}: {
  status: string;
  statuses: string[];
  bg: string;
  fg: string;
  render: (s: string) => ReactNode;
  onPick: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const opts = statuses.includes(status) ? statuses : [...statuses, status];

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [open]);

  function pick(s: string) {
    setOpen(false);
    onPick(s);
  }

  return (
    <span ref={box} className="cm-spick" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="cm-status cm-status-btn"
        style={{ background: bg, color: fg }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="눌러서 상태 바꾸기"
        onClick={() => {
          setHi(Math.max(0, opts.indexOf(status)));
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((hi + 1) % opts.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi(hi <= 0 ? opts.length - 1 : hi - 1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            pick(opts[hi]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        {render(status)}
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <span className="cm-spick-list" role="listbox" aria-label="상태 바꾸기">
          {opts.map((o, i) => {
            const [b, f] = statusColor(o);
            return (
              <span
                key={o}
                role="option"
                aria-selected={o === status}
                className={"cm-spick-opt" + (i === hi ? " hi" : "") + (o === status ? " cur" : "")}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                <span className="cm-status" style={{ background: b, color: f }}>
                  {o}
                </span>
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}

/**
 * 걸린 날 "4d"를 누르면 조치완료일을 고치는 작은 칸(2026-10-19 사용자 – 열을 접어 둔 채로도 고쳐요).
 * Enter·바깥 누르기 저장, Esc 그대로. 날짜 칸 규칙(parseDate)과 같고, 읽을 수 없거나 접수일보다 앞이면 빨간 테두리.
 */
function TakenPick({ c, taken, onSave }: { c: Complaint; taken: number; onSave: (done: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef({ v, c });
  live.current = { v, c };

  // 저장하면 true, 못 읽으면 false(칸은 열어 둬요).
  function commit(): boolean {
    const { v: raw, c: cur } = live.current;
    const d = parseDate(raw);
    if (!d || d < cur.received) {
      setBad(true);
      return false;
    }
    setOpen(false);
    if (d !== cur.done) onSave(d);
    return true;
  }

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
    const down = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      if (!commit()) setOpen(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <span ref={box} className="cm-tpick" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="cm-dday cm-taken cm-taken-btn"
        title={`조치완료일 ${c.done} · 접수부터 ${taken}일 – 눌러서 고치기`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setV(c.done ?? "");
          setBad(false);
          setOpen(!open);
        }}
      >
        {takenText(c, taken)}
      </button>
      {open && (
        <span className="cm-tpick-pop" role="dialog" aria-label="조치완료일 고치기">
          <span className="cm-tpick-label">조치완료일</span>
          <input
            ref={input}
            aria-label="조치완료일"
            aria-invalid={bad || undefined}
            className={"cell-input num" + (bad ? " invalid" : "")}
            inputMode="numeric"
            placeholder="연-월-일"
            value={v}
            onChange={(e) => {
              setV(e.target.value);
              setBad(false);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </span>
      )}
    </span>
  );
}

// ---------- 메모 창 ----------

function MemoDialog({ c, onClose, onSave }: { c: Complaint; onClose: () => void; onSave: (memo: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const who = [`${c.no}번`, [c.area, c.place].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  return (
    <div className="overlay">
      <div ref={box} className="dialog cm-memo-dialog" role="dialog" aria-modal="true" aria-label="메모 편집">
        <div className="dialog-head cm-memo-head">
          <span className="dialog-title">메모</span>
          <span className="muted small">{who}</span>
        </div>
        <div className="dialog-body cm-memo-body">
          <MemoEditor initial={parseMemo(c.memo)} boundary={box} onCancel={onClose} onSave={(lines) => onSave(memoText(lines))} />
        </div>
      </div>
    </div>
  );
}

// ---------- 분류 관리 창 ----------

function CatsDialog({ lists, onChange, onClose }: { lists: Lists; onChange: (l: Lists) => void; onClose: () => void }) {
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const cur = { status: lists.status, intake: lists.intake, ctype: lists.ctype };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog mgr" role="dialog" aria-modal="true" aria-label="분류 관리">
        <div className="dialog-head">
          <span className="dialog-title">분류 관리</span>
        </div>
        <div className="dialog-body">
          <ListGroup title="접수유형" items={cur.intake} stack onChange={(intake) => onChange({ ...cur, intake })} />
          <ListGroup title="민원유형" items={cur.ctype} stack onChange={(ctype) => onChange({ ...cur, ctype })} last />
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-ctrl btn-text" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 아이콘 ----------

function Plus() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

