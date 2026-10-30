// 민원대장 화면이에요. 시안 Main.dc.html과 사양서의 "민원대장" 절을 따라요.
//
// - 표 맨 윗줄이 신규 입력 줄이에요. 엔터규칙(keys.ts): Tab·Enter 다음 칸, 마지막 칸(상태)에서 등록해요.
// - 내용·조치내용은 여러 줄 칸이에요. Enter 같은 위계로 새 줄, Shift+Enter 아래, Ctrl+Enter 위, 왼쪽 Alt+Enter 항목 안 줄 바꿈.
// - 줄을 누르면 그 자리에서 고치고, 바깥을 누르면 저장해요. 삭제는 "이 민원을 지울까요?"를 물어요.
// - 메모는 창에서 고쳐요. 여러 줄 칸 규칙, Tab 저장하고 닫기, 바깥을 누르면 저장이에요.
import { CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { VirtualList, type VirtualHandle } from "../../VirtualList";
import { ExcelMenu } from "../../ExcelMenu";
import { complaintImports, complaintRows } from "../../excel";
import { REMOTE_CHANGE } from "../../google";
import { api, Complaint, ComplaintInput, errorText } from "../../api";
import {
  COLUMNS,
  ColKey,
  ColNeed,
  ColFilters,
  daysLeft,
  daysTaken,
  takenText,
  ddayText,
  FilterKey,
  filterValues,
  CELL_PAD,
  FLEXED,
  layoutCols,
  matches,
  NO_FILTERS,
  p90,
  passes,
  readStatusFilter,
  shortIntake,
} from "../../complaints";
import { parseLines } from "../../bullets";
import { todayStr } from "../../journal";
import { useJamoGuard } from "../../koInput";
import { lookupMany } from "../../addressWeb";
import { areaFor } from "../../address";
import { DEFAULT_SETTINGS, DONE_STATUS, isClosed, loadSettings, saveSettings, Settings, STATUS_RENAME } from "../../settingsStore";
import { SearchBox } from "../../SearchBox";
import { textPx, useColHead } from "../../ColHead";
import { widthOf, type ColDef } from "../../cols";
import { HeadRow, FilterChips, NewRow, EditRow, ViewRow } from "./Table";
import { MemoDialog, CatsDialog } from "./Dialogs";
import type { ListMerge } from "../settings/Table";
import { RowMenu, FilterMenu } from "./Menu";
import { Lists, PlaceStyle, placeText } from "./parts";

/**
 * 끌어서 정한 열 폭(끈 열만 px) – 헤더 열 조정 통일(2026-10-28)의 공통 부품 ColHead가 읽고 써요.
 * 옛 비율(`complaints.colRatios`)·옛 px(`complaints.colWidths`)은 읽지 않아요.
 */
const COLS_KEY = "complaints.cols";
/** 상태 필터만 마지막 것을 기억해요(2026-10-17 사용자 2안 + 상태 예외). 다른 열 필터는 앱을 끄면 풀려요. */
const STATUS_FILTER_KEY = "complaints.statusFilter";
/** 조치완료일 열 접기(2026-10-19 사용자) – 접으면 걸린 날 "Nd"만 보여요. */
const DONE_FOLD_KEY = "complaints.doneFolded";

// ---------- 화면 ----------

export default function ComplaintsScreen({ urgentDays, focusId, onFocused }: { urgentDays: number; focusId?: number | null; onFocused?: () => void }) {
  const [list, setList] = useState<Complaint[] | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [doneFolded, setDoneFolded] = useState(true); // 처음엔 접혀 있어요(2026-10-19 사용자)
  // 표가 쓸 수 있는 폭(위쪽 줄 폭 − 표 테두리) – 내용·조치내용 처음 값을 여기에 맞춰요. 넓힌 열이 넘치면 본문이 가로로 밀려요.
  const tableRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [q, setQ] = useState("");
  // 민원인을 초성으로 찾을 때 입력기가 자음을 묶지 않게 해요.
  const qGuard = useJamoGuard(setQ);
  // 열 제목 필터(시안 ComplaintFilter.dc.html). null = 모두, 배열 = 고른 값만. 상태 칩도 같은 status 필터예요.
  const [filters, setFilters] = useState<ColFilters>(NO_FILTERS);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  // 두 번 누른 칸만 고쳐요(2026-10-25 사용자 ⑧1안). null이면 줄 전체(우클릭 "고치기").
  // 한 번 누른 줄(골라 둔 줄). 두 번 누르거나 Enter를 누르면 고쳐요.
  const [selId, setSelId] = useState<number | null>(null);
  // 줄 우클릭 메뉴(2026-10-21 사용자 – 고치기·위로/아래로 옮기기·지우기). ask = 지우기를 눌러 붉은 띠로 바뀐 때.
  const [rowMenu, setRowMenu] = useState<{ id: number; x: number; y: number; ask: boolean } | null>(null);
  const [memoId, setMemoId] = useState<number | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [today, setToday] = useState(todayStr());
  // 보이는 줄만 그려요(2026-10-21 속도 최적화). 그 줄로 가기는 vlRef.scrollToIndex.
  const vlRef = useRef<VirtualHandle>(null);
  const shownRef = useRef<Complaint[]>([]);

  // 열 때 읽기 넷을 모아 한 번에 그려요(2026-10-30 속도 ① – 따로 오면 서너 번 다시 그리고 그때마다 열 폭을 다시 쟀어요).
  // 하나가 실패해도 나머지는 지금처럼: 설정·접힘·상태 거르기는 처음 값, 민원 목록이 실패하면 알림만.
  useEffect(() => {
    let alive = true;
    const listP = api.complaints().then(async (cs) => {
      // 예전 상태 이름(처리중)으로 저장된 민원은 새 이름(진행)으로 한 번 바꿔 둬요.
      const old = cs.filter((c) => STATUS_RENAME[c.status]);
      if (!old.length) return cs;
      const fixed = new Map<number, Complaint>();
      for (const c of old) fixed.set(c.id, await api.setComplaintStatus(c.id, STATUS_RENAME[c.status]));
      return cs.map((c) => fixed.get(c.id) ?? c);
    });
    const ok = <T,>(p: Promise<T>) => p.then((v) => ({ v }), (e: unknown) => ({ e }));
    void Promise.all([ok(listP), ok(loadSettings()), ok(api.get(DONE_FOLD_KEY)), ok(api.get(STATUS_FILTER_KEY))]).then(([l, s, fold, sf]) => {
      if (!alive) return;
      if ("v" in s) setSettings(s.v);
      if ("v" in fold) setDoneFolded(fold.v !== "false");
      if ("v" in sf) setFilters((f) => ({ ...f, status: readStatusFilter(sf.v) }));
      if ("v" in l) setList(l.v);
      else setNote(errorText(l.e));
    });
    // 구글 할 일에서 민원을 체크하면 상태가 바뀌어요 → 다시 읽어요.
    const reload = () => api.complaints().then(setList, () => {});
    window.addEventListener(REMOTE_CHANGE, reload);
    return () => {
      alive = false;
      window.removeEventListener(REMOTE_CHANGE, reload);
    };
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

  /** 연번이 다시 매겨지는 일(등록·고치기·지우기) 뒤에는 전체를 다시 읽어요(2026-10-25 사용자 – 접수일 순서·연번 자동). */
  const reload = useCallback(async () => {
    const cs = await run(api.complaints());
    if (cs) setList(cs);
    return cs;
  }, [run]);

  /** 분류 합치기(2026-10-28 ✔1): 그 값을 쓰는 민원 수, 한 번에 바꾸기(실패하면 띠를 그대로 둬요). */
  const mergeFor = (field: "intake" | "ctype"): ListMerge => ({
    used: (name) => (list ?? []).filter((c) => c[field] === name).length,
    run: async (from, to) => {
      const cs = await run(api.replaceComplaintField(field, from, to));
      if (!cs) throw new Error("merge");
      setList(cs);
    },
  });

  /** 그 민원 자리로 가서 잠깐 빛나게(접수일을 적으면 그 날 자리로 옮겨 가요). */
  const goTo = useCallback((id: number, cs: Complaint[] | null) => {
    if (!cs) return;
    setFlash(id);
    window.setTimeout(() => {
      const i = shownRef.current.findIndex((c) => c.id === id);
      if (i >= 0) vlRef.current?.scrollToIndex(i, { align: "nearest", behavior: "smooth" });
    }, 60);
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

  const all = list ?? [];

  const query = q.trim().toLowerCase();
  const found = all.filter((c) => matches(c, query));
  const shown = found.filter((c) => passes(c, filters));
  shownRef.current = shown;

  // 상태 칩: 설정 목록 + 기록에만 남아 있는 상태
  const statuses = useMemo(() => {
    const extra = [...new Set(all.map((c) => c.status))].filter((s) => !settings.status.includes(s));
    return [...settings.status, ...extra];
  }, [all, settings.status]);

  /** 열마다 고를 수 있는 값 – 상태는 상태 칩과 같은 순서(끝내지 않은 상태 → 완료·불가, 2026-10-21 사용자) */
  const chipOrder = useMemo(() => [...statuses.filter((s) => !isClosed(s)), ...statuses.filter(isClosed)], [statuses]);
  const valuesOf = (k: FilterKey) => (k === "status" ? chipOrder : filterValues(all, k));

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

  // 민원유형 목록이 비어 있으면 지금 대장에 쓰인 민원유형으로 처음 목록을 채워요(2026-10-25 사용자 ④1안 – 이제 목록에서 골라요).
  const filledTypes = useRef(false);
  useEffect(() => {
    if (!list || filledTypes.current || settings === DEFAULT_SETTINGS) return;
    filledTypes.current = true;
    if (settings.ctype.length) return;
    const count = new Map<string, number>();
    for (const c of list) if (c.ctype.trim()) count.set(c.ctype.trim(), (count.get(c.ctype.trim()) ?? 0) + 1);
    const used = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)! || a.localeCompare(b, "ko"));
    if (used.length) void saveLists({ status: settings.status, intake: settings.intake, ctype: used });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, settings]);

  const needs = useColNeeds(list, doneFolded, today, settings.placeStyle);
  // 열 폭(헤더 열 조정 통일 ✔1~3): 처음 값은 layoutCols(글 폭·창 폭), 끈 열은 px 그대로. 상태·메모는 고정, 접힌 조치완료일도 고정.
  const init = layoutCols(needs, avail).init;
  const colDefs: ColDef[] = COLUMNS.map((c) => ({
    id: c.key,
    label: c.label,
    init: init[c.key],
    fixed: c.key === "status" || c.key === "memo" || (c.key === "done" && doneFolded),
    text: c.key === "place" || FLEXED.includes(c.key),
  }));
  const cols = useColHead({
    store: COLS_KEY,
    cols: colDefs,
    // 내용에 맞춤 = 모든 민원의 그 열 글 폭 + 칸 여백(여유는 cols.ts가 더해요 – 줄인 모양이 아니라 전체 글자). 여러 줄인 내용·조치내용은 처음 폭으로.
    measure: (id) => {
      const k = id as ColKey;
      if (FLEXED.includes(k)) return null;
      const n = needs[k];
      return n ? n.full + CELL_PAD : null;
    },
  });
  const layout = layoutCols(needs, avail, cols.saved);
  const shownWidths = COLUMNS.map((c) => cols.width(c.key));
  const total = shownWidths.reduce((a, w) => a + w, 0);
  const foldDone = (v: boolean) => {
    setDoneFolded(v);
    run(api.set(DONE_FOLD_KEY, v ? "true" : "false"));
  };
  // 위쪽 줄 높이(열 제목 줄을 그만큼 내려 붙여요)
  const topRef = useRef<HTMLDivElement>(null);
  const [topH, setTopH] = useState(0);
  const tableStyle = { "--cm-cols": shownWidths.map((w) => w + "px").join(" "), minWidth: total + 2 } as CSSProperties;
  // 긴 목록이 잰 줄 높이를 버리는 기준은 손을 뗀 뒤의 폭 – 끄는 동안 1,500줄 높이를 매번 버리지 않게(cols 최적화 2)
  const committedCols = COLUMNS.map((c) => widthOf(colDefs.find((d) => d.id === c.key)!, cols.committed) + "px").join(" ");
  (tableStyle as Record<string, string>)["--cm-top-h"] = `${topH}px`;
  const memoOf = all.find((c) => c.id === memoId) ?? null;

  // 위쪽 줄(상태 칩·검색·단추)을 고정하고 그 높이만큼 열 제목 줄을 내려 붙여요(2026-10-25 사용자 – 집행현황처럼).
  // 그리기 전에 한 번 재요(2026-10-30 속도 ① – 열 제목 줄이 한 번 더 움직이지 않게).
  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return;
    setTopH(el.offsetHeight);
    const ro = new ResizeObserver(() => setTopH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [list === null]);

  // 표가 쓸 수 있는 폭을 재요(창 크기를 바꾸면 다시) – 표는 넓힌 열만큼 커지니 위쪽 줄 폭에서 표 테두리(2)를 빼요.
  // 그리기 전에 재요(2026-10-30 속도 ① – 폭 0으로 한 번 그리고 다시 그리지 않게).
  useLayoutEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const measure = () => setAvail(Math.max(0, el.offsetWidth - 2));
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
      <div className="ct-head cm-top tb5" ref={topRef}>
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
        <button type="button" className="btn btn-ctrl btn-text tb-pop" onClick={() => setCatsOpen(true)}>
          분류 관리
        </button>
        <SearchBox
          aria-label="민원 검색"
          placeholder="위치, 내용, 민원인 검색"
          value={q}
          onClear={() => setQ("")}
          onKeyDown={qGuard.onKeyDown}
          onChange={qGuard.onChange}
          onCompositionEnd={qGuard.onCompositionEnd}
        />
        <ExcelMenu
          kind="complaints"
          total={all.length}
          build={() => ({ rows: complaintRows(all), intake: settings.intake, status: settings.status })}
          parse={complaintImports}
          // 덮어쓰기의 "같은 민원" = 접수일 + 접수유형 + 위치(2026-10-25 사용자 ②3안, 공통 ✔5 – 연번은 다시 매겨질 수 있어 기준이 아니에요)
          preview={(rows) => {
            const k = (r: { received: string; intake: string; place: string }) => `${r.received.trim()}|${r.intake.trim()}|${r.place.trim()}`;
            const have = new Set(all.map(k));
            return { same: rows.filter((r) => (r.received.trim() || r.intake.trim() || r.place.trim()) && have.has(k(r))).length, total: all.length };
          }}
          onImport={async (rows, mode) => {
            // 위치가 도로명주소면 웹 먼저 바꿔 넣어요(한 번에 4줄, 웹이 안 되면 앱이 내장 표로 바꿔요 – 2026-10-21 사용자 2안).
            const { found, web, table } = await lookupMany(rows.map((r) => r.place));
            const conv = rows.map((r, i) => {
              const f = found[i];
              if (f?.kind !== "exact") return r;
              return { ...r, place: f.hit.place, area: areaFor(f.hit, r.area), road: r.road || f.original };
            });
            const [u, a] = await api.importComplaints(conv, mode === "replace");
            const n = u + a;
            setList(await api.complaints());
            return web + table ? { n, note: `주소 바꿈 웹 ${web} · 내장 ${table}` } : n;
          }}
        />
      </div>

      {note && <p className="note" role="status">{note}</p>}

      <div className={"cm" + (doneFolded ? " cm-fold-done" : "")} role="table" aria-label="민원 목록" style={tableStyle} ref={tableRef}>
        <HeadRow
          cols={cols}
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
        <NewRow lists={settings} short={layout.short} onAdd={async (input) => {
          const c = await run(api.addComplaint(input));
          if (c) {
            // 거르는 중이라 새 민원이 안 보이면 거르기를 풀어요.
            if (!passes(c, filters)) clearFilters();
            if (query && !matches(c, query)) setQ("");
            goTo(c.id, await reload());
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
          resetKey={committedCols}
          render={(i) => {
            const c = shown[i];
            return (
              editId === c.id ? (
                <EditRow
                  vi={i}
                  c={c}
                  lists={settings}
                  short={layout.short}
                  onCancel={() => setEditId(null)}
                  onSave={async (input) => {
                    setEditId(null);
                    if (same(c, input)) return;
                    const r = await run(api.updateComplaint(c.id, input));
                    // 접수일·접수유형·위치가 바뀌면 자리와 연번이 바뀌어요 – 다시 읽고 그 자리로 가요.
                    if (r) goTo(r.id, await reload());
                  }}
                  onRemove={async () => {
                    setEditId(null);
                    // delete_complaint는 성공해도 null을 돌려줘요 → true로 바꿔 실패(null)와 가려요(2026-10-19 사용자: 지우기가 안 먹음)
                    if (await run(api.deleteComplaint(c.id).then(() => true))) await reload();
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
                  short={layout.short}
                  doneFolded={doneFolded}
                  placeStyle={settings.placeStyle}
                  onSelect={() => setSelId(c.id)}
                  onMenu={(x, y) => {
                    setSelId(c.id);
                    setRowMenu({ id: c.id, x, y, ask: false });
                  }}
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
                    // 조치완료일을 적으면 상태는 완료(불가도 – 2026-10-25 사용자).
                    const r = await run(api.setComplaintStatus(c.id, done ? DONE_STATUS : c.status, done));
                    if (r) put(r);
                  }}
                  onDue={async (due) => {
                    const r = await run(api.updateComplaint(c.id, { ...inputOf(c), due }));
                    if (r) put(r);
                  }}
                />
              )
            );
          }}
        />
        {all.length === 0 ? (
          <div className="cm-empty muted small">아직 민원이 없어요. 위 줄에 적고 상태 칸에서 Enter를 눌러 등록해요. 아무 칸 하나만 적어도 돼요.</div>
        ) : shown.length === 0 ? (
          <div className="cm-empty muted small">맞는 민원이 없어요.</div>
        ) : null}
      </div>

      {rowMenu &&
        (() => {
          const i = shown.findIndex((c) => c.id === rowMenu.id);
          if (i < 0) return null;
          const c = shown[i];
          const close = () => setRowMenu(null);
          return (
            <RowMenu
              no={c.no}
              x={rowMenu.x}
              y={rowMenu.y}
              ask={rowMenu.ask}
              place={c.place}
              person={[c.person, c.phone].filter(Boolean).join(" ")}
              onClose={close}
              onEdit={() => {
                close();
                setMemoId(null);
                setEditId(c.id);
              }}
              onAsk={() => setRowMenu({ ...rowMenu, ask: true })}
              onDelete={async () => {
                close();
                if (await run(api.deleteComplaint(c.id).then(() => true))) await reload();
              }}
            />
          );
        })()}

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

      {catsOpen && <CatsDialog lists={settings} mergeFor={mergeFor} onChange={saveLists} onClose={() => setCatsOpen(false)} />}
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

/** 저장된 민원 → 고치기 칸 값(한 칸만 바꿔 저장할 때) */
function inputOf(c: Complaint): ComplaintInput {
  return {
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
  };
}

/** 민원인 칸의 처음 폭 = 휴대폰 번호 폭(2026-10-21 사용자) */
const PHONE_SAMPLE = "010-7280-5715";
const HEAD_FONT = { weight: 600, size: 12 };
/** 상태 배지 폭(styles/*.css .cm-status width) · 메모 단추 · 접힌 조치완료일 단추 */
const STATUS_BADGE = 52;
const MEMO_BTN = 22;
const FOLD_BTN = 14;
/** 날짜와 D-day·걸린 날 사이 */
const DUE_GAP = 8;


/**
 * 열마다 들어갈 것의 폭을 재요(칸 여백 빼고). 글 폭은 화면 글꼴로 캔버스에 재요.
 * 열 제목 글자도 넣어요 – 거르기 아이콘은 마우스를 올릴 때만 여유 자리에 겹쳐 보여 자리를 잡지 않아요(⑨ 1안).
 * 짧은 글 열(접수유형·민원유형)은 90%가 들어가는 폭, 위치는 다 보여야 해서 가장 긴 것.
 */
function useColNeeds(list: Complaint[] | null, doneFolded: boolean, today: string, placeStyle: PlaceStyle): Partial<Record<ColKey, ColNeed>> {
  return useMemo(() => {
    // 목록이 오기 전에는 재지 않아요(2026-10-30 속도 ① – 빈 목록을 한 번 더 재지 않게).
    if (!list) return {};
    const all = list;
    const family = getComputedStyle(document.body).fontFamily;
    // 같은 글자(접수유형·민원유형 등은 거의 같아요)는 한 번만 재요.
    const twCache = new Map<string, number>();
    const twReal = (s: string, weight = 400, size = 13) => {
      const key = `${weight}/${size}/${s}`;
      let v = twCache.get(key);
      if (v === undefined) twCache.set(key, (v = textPx(s, `${weight} ${size}px ${family}`)));
      return v;
    };
    const max = (xs: number[]) => Math.max(0, ...xs);
    // 숫자 칸(연번·날짜·D-day·걸린 날)은 화면에서 고른 폭 숫자(tabular-nums)라 캔버스로는 좁게 재져요 – 숨긴 글자로 재요.
    // 재는 방식은 그대로지만 한 번에 재요(2026-10-30 속도 ①): 먼저 잴 글자를 모으고(①), 숨긴 글자를 한꺼번에 붙여 한 번의 배치로 읽은 뒤(②), 그 값으로 계산해요(③).
    // 전엔 글자마다 붙였다 읽어 1,500줄이면 배치를 1,500번 다시 했어요.
    const numKey = (s: string, weight: number, size: number) => `${weight}/${size}/${s}`;
    const want = new Map<string, [string, number, number]>();
    const numCache = new Map<string, number>();
    const compute = (tw: (s: string, weight?: number, size?: number) => number, nw: (s: string, weight?: number, size?: number) => number) => {
      const head = (k: ColKey) => tw(COLUMNS.find((c) => c.key === k)!.label, HEAD_FONT.weight, HEAD_FONT.size);
      const at = (k: ColKey, n: ColNeed): ColNeed => {
        const h = head(k);
        return { full: Math.max(h, n.full), short: n.short == null ? undefined : Math.max(h, n.short), more: n.more == null ? undefined : Math.max(h, n.more) };
      };
      const dday = max(all.map((c) => daysLeft(c, today)).filter((x): x is number => x !== null).map((n) => nw(ddayText(n), 700, 11.5)));
      const date = nw("2026-10-16");
      const out: Partial<Record<ColKey, ColNeed>> = {
        no: at("no", { full: max(all.map((c) => nw(String(c.no)))) }),
        intake: at("intake", { full: p90(all.map((c) => tw(c.intake, 500))), short: max(all.map((c) => tw(shortIntake(c.intake), 500))) }),
        received: at("received", { full: date, short: nw("26-10-16") }),
        ctype: at("ctype", { full: p90(all.map((c) => tw(c.ctype))) }),
        place: at("place", {
          full: max(all.map((c) => tw(placeText(c.area, c.place, placeStyle)))),
          short: max(all.map((c) => tw(c.place))),
        }),
        person: at("person", { full: tw(PHONE_SAMPLE), more: p90(all.map((c) => tw([c.person, c.phone].filter(Boolean).join(" ")))) }),
        // 줄인 모양에서도 답변 끝난 민원은 D-day 대신 짧은 날짜(26-10-16)를 보여서 그 폭도 넣어요(2026-10-21 화면 배율 – 잘림).
        due: at("due", {
          full: date + (dday ? DUE_GAP + dday : 0),
          short: Math.max(dday, nw("D-day", 700, 11.5), all.some((c) => c.due && daysLeft(c, today) === null) ? nw("26-10-16") : 0),
        }),
        status: at("status", { full: STATUS_BADGE }),
        done: doneFolded
          ? { full: FOLD_BTN }
          : at("done", {
              full:
                date +
                DUE_GAP +
                max(all.map((c) => { const t = daysTaken(c); return t === null ? 0 : nw(takenText(c, t), 600, 11.5); })),
            }),
        memo: { full: MEMO_BTN },
      };
      return out;
    };
    // ① 모으기(글 폭은 캔버스라 이때는 재지 않아요)
    compute(
      () => 0,
      (s, weight = 400, size = 13) => {
        if (s) want.set(numKey(s, weight, size), [s, weight, size]);
        return 0;
      },
    );
    // ② 한꺼번에 재기
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0";
    const spans: [string, HTMLSpanElement][] = [];
    for (const [key, [s, weight, size]] of want) {
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font-variant-numeric:tabular-nums;left:0;top:0";
      probe.style.fontFamily = family;
      probe.style.fontWeight = String(weight);
      probe.style.fontSize = `${size}px`;
      probe.textContent = s;
      box.appendChild(probe);
      spans.push([key, probe]);
    }
    document.body.appendChild(box);
    for (const [key, probe] of spans) numCache.set(key, probe.getBoundingClientRect().width);
    box.remove();
    // ③ 계산
    return compute(twReal, (s, weight = 400, size = 13) => (s ? numCache.get(numKey(s, weight, size)) ?? 0 : 0));
  }, [list, doneFolded, today, placeStyle]);
}

/** 고친 것이 없으면 저장하지 않아요. */
function same(c: Complaint, i: ComplaintInput) {
  return (Object.keys(i) as (keyof ComplaintInput)[]).every((k) => c[k] === i[k]);
}
