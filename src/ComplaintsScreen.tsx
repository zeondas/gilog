// 민원대장 화면이에요. 시안 Main.dc.html과 사양서의 "민원대장" 절을 따라요.
//
// - 표 맨 윗줄이 신규 입력 줄이에요. Tab 다음 칸, 상태 칸에서 Tab이나 Enter로 등록해요.
// - 내용·조치내용은 여러 줄이에요. Enter는 등록·저장, Shift+Enter(또는 Ctrl+Enter)는 새 줄이에요(사용자가 정한 공통 규칙).
// - 줄을 누르면 그 자리에서 고치고, 바깥을 누르면 저장해요. 삭제는 "이 민원을 지울까요?"를 물어요.
// - 메모는 창에서 고쳐요. Enter 저장, Ctrl+Enter 새 줄, 바깥을 누르면 저장이에요.
import {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, Complaint, ComplaintInput, errorText } from "./api";
import {
  COL_MIN,
  COLUMNS,
  daysLeft,
  ddayText,
  defaultWidths,
  expandType,
  gridTemplate,
  isUrgent,
  matches,
  minWidth,
  readWidths,
} from "./complaints";
import { parseLines, plainOf, stringifyLines } from "./bullets";
import { BulletEditor, BulletView } from "./Bullets";
import { Hl, MemoEditor, memoText, parseMemo } from "./ContactsScreen";
import { koIndex, parseDate, todayStr } from "./journal";
import { useJamoGuard } from "./koInput";
import { PhoneInput } from "./PhoneInput";
import { AreaInput, PlaceInput } from "./PlaceInputs";
import { finalizePhone } from "./phone";
import { KEEP_STATUS, ListGroup } from "./SettingsScreen";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings, statusColor } from "./settingsStore";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/** 열 너비를 저장하는 곳 (암호화 파일 안) */
const COLS_KEY = "complaints.colWidths";

type Lists = Pick<Settings, "status" | "intake" | "ctype">;

// ---------- 화면 ----------

export default function ComplaintsScreen({ urgentDays, focusId, onFocused }: { urgentDays: number; focusId?: number | null; onFocused?: () => void }) {
  const [list, setList] = useState<Complaint[] | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [widths, setWidths] = useState<(number | null)[]>(defaultWidths());
  const [q, setQ] = useState("");
  // 민원인을 초성으로 찾을 때 입력기가 자음을 묶지 않게 해요.
  const qGuard = useJamoGuard(setQ);
  const [filter, setFilter] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [memoId, setMemoId] = useState<number | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [today, setToday] = useState(todayStr());

  useEffect(() => {
    api.complaints().then(setList, (e) => setNote(errorText(e)));
    loadSettings().then(setSettings, () => {});
    api.get(COLS_KEY).then((raw) => setWidths(readWidths(raw)), () => {});
  }, []);

  // 자정을 넘기면 남은 날을 다시 셈해요.
  useEffect(() => {
    const t = window.setInterval(() => setToday(todayStr()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // 업무일지 "챙길 일"에서 눌러 왔으면 그 줄로 가서 잠깐 빛나게 해요.
  useEffect(() => {
    if (!list || focusId == null) return;
    setFilter(null);
    setQ("");
    setEditId(null);
    setFlash(focusId);
    onFocused?.();
    window.setTimeout(() => document.querySelector(`[data-cid="${focusId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
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
  const query = q.trim().toLowerCase();
  const shown = all.filter((c) => (filter === null || c.status === filter) && matches(c, query));

  // 상태 칩: 설정 목록 + 기록에만 남아 있는 상태
  const statuses = useMemo(() => {
    const extra = [...new Set(all.map((c) => c.status))].filter((s) => !settings.status.includes(s));
    return [...settings.status, ...extra];
  }, [all, settings.status]);

  // 거른 상태가 목록에서 사라졌으면 전체로 돌아가요.
  useEffect(() => {
    if (filter !== null && !statuses.includes(filter)) setFilter(null);
  }, [filter, statuses]);

  const tableStyle = { "--cm-cols": gridTemplate(widths), minWidth: minWidth(widths) + 2 } as CSSProperties;
  const memoOf = all.find((c) => c.id === memoId) ?? null;

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
      <div className="ct-head">
        <h1 className="title">민원대장</h1>
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
        <button type="button" className="btn btn-ctrl" onClick={() => setCatsOpen(true)}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
          </svg>
          분류 관리
        </button>
      </div>

      <div className="ct-chips" role="group" aria-label="상태로 거르기">
        <span className="ct-chips-label">상태</span>
        <button type="button" className="pchip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
          <span>전체</span>
          <span className="pchip-n">{all.length}</span>
        </button>
        {statuses.map((s) => (
          <button key={s} type="button" className="pchip" aria-pressed={filter === s} onClick={() => setFilter(filter === s ? null : s)}>
            <span>{s}</span>
            <span className="pchip-n">{all.filter((c) => c.status === s).length}</span>
          </button>
        ))}
      </div>

      {note && <p className="note" role="status">{note}</p>}

      <div className="cm" role="table" aria-label="민원 목록" style={tableStyle}>
        <HeadRow widths={widths} onResize={setWidths} onResized={saveWidths} />
        <NewRow lists={settings} onAdd={async (input) => {
          const c = await run(api.addComplaint(input));
          if (c) {
            put(c);
            // 거르는 중이라 새 민원이 안 보이면 거르기를 풀어요.
            if (filter !== null && c.status !== filter) setFilter(null);
            if (query && !matches(c, query)) setQ("");
          }
          return !!c;
        }} />
        {shown.map((c, i) =>
          editId === c.id ? (
            <EditRow
              key={c.id}
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
                if ((await run(api.deleteComplaint(c.id))) !== null) setList((old) => (old ?? []).filter((x) => x.id !== c.id));
              }}
              onMemo={() => setMemoId(c.id)}
            />
          ) : (
            <ViewRow
              key={c.id}
              c={c}
              alt={i % 2 === 1}
              q={query}
              today={today}
              urgentDays={urgentDays}
              flash={flash === c.id}
              onEdit={() => {
                setMemoId(null);
                setEditId(c.id);
              }}
              onMemo={() => setMemoId(c.id)}
            />
          ),
        )}
        {all.length === 0 ? (
          <div className="cm-empty muted small">아직 민원이 없어요. 위 줄에 적고 Enter를 눌러 등록해요. 필수 칸은 내용 하나예요.</div>
        ) : shown.length === 0 ? (
          <div className="cm-empty muted small">맞는 민원이 없어요.</div>
        ) : null}
      </div>

      <div className="cm-foot muted small">
        <span className="cm-foot-sum">
          표시 {shown.length}건 / 전체 {all.length}건
        </span>
        <span>열 제목의 경계선을 좌우로 끌면 열 너비가 바뀌어요</span>
        <button type="button" className="btn btn-xs" onClick={() => saveWidths(defaultWidths())}>
          열 너비 초기화
        </button>
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

/** 고친 것이 없으면 저장하지 않아요. */
function same(c: Complaint, i: ComplaintInput) {
  return (Object.keys(i) as (keyof ComplaintInput)[]).every((k) => c[k] === i[k]);
}

// ---------- 열 제목과 너비 끌기 ----------

function HeadRow({
  widths,
  onResize,
  onResized,
}: {
  widths: (number | null)[];
  onResize: (w: (number | null)[]) => void;
  onResized: (w: (number | null)[]) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  function start(e: ReactMouseEvent, i: number) {
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    // 남는 폭을 나눠 갖는 열도 끌면 지금 보이는 폭에서 시작해요.
    const base = widths.map((w, j) => w ?? (row.children[j] as HTMLElement).getBoundingClientRect().width);
    const startX = e.clientX;
    let last = widths;
    const move = (ev: MouseEvent) => {
      const next = widths.slice();
      next[i] = Math.max(COL_MIN, Math.round(base[i] + ev.clientX - startX));
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
    <div role="row" className="cm-row cm-head" ref={rowRef}>
      {COLUMNS.map((col, i) => (
        <div role="columnheader" key={col.key} className={"cm-hcell" + (col.key === "no" ? " right" : "")}>
          {col.label}
          {i < COLUMNS.length - 1 && <span className="cm-grip" aria-hidden="true" title="끌어서 열 너비 바꾸기" onMouseDown={(e) => start(e, i)} />}
        </div>
      ))}
    </div>
  );
}

// ---------- 입력 칸들 ----------

type Draft = ComplaintInput;

const emptyDraft = (lists: Lists): Draft => ({
  intake: lists.intake[0] ?? "",
  received: todayStr(),
  ctype: "",
  area: "",
  place: "",
  person: "",
  phone: "",
  body: "",
  action: "",
  due: "",
  status: lists.status[0] ?? "",
});

type Bad = { received?: boolean; due?: boolean; body?: boolean };

/** 날짜 칸을 떠날 때 "1016" 같은 것을 2026-10-16으로 바꿔요. 읽을 수 없으면 빨간 테두리예요. */
function normDates(d: Draft): { d: Draft; bad: Bad } {
  const bad: Bad = {};
  const r = parseDate(d.received);
  if (!r) bad.received = true;
  const due = d.due.trim() ? parseDate(d.due) : "";
  if (due === null) bad.due = true;
  if (!plainOf(d.body).trim()) bad.body = true;
  return { d: { ...d, received: r ?? d.received, due: due ?? d.due }, bad };
}

/** 고르기 목록. 기록에 지금 목록에 없는 값이 있으면 그것도 보여 줘요. */
function Choose({ name, label, value, options, onChange }: { name: string; label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const opts = value && !options.includes(value) ? [...options, value] : options;
  return (
    <select name={name} aria-label={label} className="cell-input cm-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {!value && <option value="" />}
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
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
}: {
  d: Draft;
  set: (patch: Partial<Draft>) => void;
  bad: Bad;
  lists: Lists;
  firstRef?: React.Ref<HTMLSelectElement>;
  onDateBlur: (k: "received" | "due") => void;
}) {
  const intakeOpts = d.intake && !lists.intake.includes(d.intake) ? [...lists.intake, d.intake] : lists.intake;
  return (
    <>
      <div role="cell" className="cm-c">
        <select ref={firstRef} name="intake" aria-label="접수유형" className="cell-input cm-select" value={d.intake} onChange={(e) => set({ intake: e.target.value })}>
          {!d.intake && <option value="" />}
          {intakeOpts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
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
      <div role="cell" className="cm-c">
        <AreaInput value={d.area} onChange={(area) => set({ area })} />
      </div>
      <div role="cell" className="cm-c">
        <PlaceInput value={d.place} onChange={(place) => set({ place })} onArea={(area) => set({ area })} />
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
          placeholder="민원 내용을 입력하고 Enter"
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
        <Choose name="status" label="상태" value={d.status} options={lists.status} onChange={(status) => set({ status })} />
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
  const onDateBlur = (k: "received" | "due") => {
    const v = d[k].trim();
    if (!v && k === "due") return;
    const p = parseDate(v);
    if (p) set({ [k]: p });
    else setBad((b) => ({ ...b, [k]: true }));
  };
  /** 등록·저장할 값. 틀린 칸이 있으면 null이고 그 칸 이름을 돌려줘요. */
  const check = (): { input: Draft | null; first?: string } => {
    const { d: n, bad: b } = normDates(d);
    setD(n);
    setBad(b);
    const first = (["received", "body", "due"] as const).find((k) => b[k]);
    if (first) return { input: null, first };
    return { input: { ...n, phone: finalizePhone(n.phone), body: stringifyLines(parseLines(n.body)), action: stringifyLines(parseLines(n.action)) } };
  };
  return { d, setD, bad, setBad, set, onDateBlur, check };
}

/** Enter 하나로 등록·저장할 칸인지 (여러 줄 칸에서 Shift+Enter·Ctrl+Enter는 새 줄이에요) */
function isSubmitEnter(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as HTMLElement;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

// ---------- 신규 입력 줄 ----------

function NewRow({ lists, onAdd }: { lists: Lists; onAdd: (c: ComplaintInput) => Promise<boolean> }) {
  const f = useDraft(() => emptyDraft(lists));
  const rowRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLSelectElement>(null);

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
    const { input, first } = f.check();
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
      onKeyDown={(e) => {
        if (isComposing(e) || e.defaultPrevented) return;
        const lastTab = e.key === "Tab" && !e.shiftKey && (e.target as HTMLElement).getAttribute("name") === "status";
        if (isSubmitEnter(e) || lastTab) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div role="cell" className="cm-c cm-new-tag">
        신규
      </div>
      <Cells d={f.d} set={f.set} bad={f.bad} lists={lists} firstRef={firstRef} onDateBlur={f.onDateBlur} />
      <div role="cell" className="cm-c cm-center">
        <button type="button" className="btn-icon btn-add" aria-label="민원 등록" title="등록 (Enter)" tabIndex={-1} onClick={submit}>
          <Plus />
        </button>
      </div>
    </div>
  );
}

// ---------- 고치는 줄 ----------

function EditRow({
  c,
  lists,
  onCancel,
  onSave,
  onRemove,
  onMemo,
}: {
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
    person: c.person,
    phone: c.phone,
    body: c.body,
    action: c.action,
    due: c.due,
    status: c.status,
  }));
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);

  function save(fromOutside = false) {
    const { input, first } = f.check();
    if (!input) {
      // 바깥을 눌렀는데 저장할 수 없으면 고치기 전으로 돌아가요.
      if (fromOutside) return onCancel();
      return focusField(ref.current, first!);
    }
    onSave(input);
  }

  const latest = useRef({ save, asking });
  latest.current = { save, asking };

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
      className="cm-row cm-edit"
      onKeyDown={(e) => {
        if (isComposing(e) || e.defaultPrevented) return;
        if (e.key === "Escape") {
          e.preventDefault();
          if (asking) setAsking(false);
          else onCancel();
        } else if (isSubmitEnter(e)) {
          e.preventDefault();
          save();
        }
      }}
    >
      <div role="cell" className="cm-c cm-no">
        {c.no}
      </div>
      <Cells d={f.d} set={f.set} bad={f.bad} lists={lists} onDateBlur={f.onDateBlur} />
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
          <button ref={trashRef} type="button" className="tool-box" aria-label={`${c.no}번 민원 지우기`} title="이 민원 지우기" onClick={() => setAsking(true)}>
            <Trash />
          </button>
        )}
        <span className="hint cm-edit-hint">Tab 다음 칸 · Enter 저장 · Shift+Enter 새 줄 · 줄 맨 앞 ] ) - 와 스페이스로 머릿기호 · Esc 취소 · 바깥을 누르면 저장</span>
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
  c,
  alt,
  q,
  today,
  urgentDays,
  flash,
  onEdit,
  onMemo,
}: {
  c: Complaint;
  alt: boolean;
  q: string;
  today: string;
  urgentDays: number;
  flash: boolean;
  onEdit: () => void;
  onMemo: () => void;
}) {
  const n = daysLeft(c, today);
  const [bg, fg] = statusColor(c.status);
  const hasMemo = parseMemo(c.memo).length > 0;
  const t = (s: string): ReactNode => <Hl text={s} q={q} />;
  return (
    <div
      role="row"
      tabIndex={0}
      data-cid={c.id}
      className={"cm-row cm-view" + (alt ? " alt" : "") + (flash ? " flash" : "")}
      title="눌러서 고치기"
      onClick={onEdit}
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
        {t(c.place)}
      </div>
      <div role="cell" className="cm-c">
        {t(c.person)}
      </div>
      <div role="cell" className="cm-c cm-num">
        {t(c.phone)}
      </div>
      <div role="cell" className="cm-c cm-multi">
        <Bullets text={c.body} q={q} />
      </div>
      <div role="cell" className="cm-c cm-multi cm-ink2">
        <Bullets text={c.action} q={q} />
      </div>
      <div role="cell" className="cm-c cm-num cm-due">
        <span>{t(c.due)}</span>
        {n !== null && <span className={"cm-dday" + (isUrgent(n, urgentDays) ? " urgent" : "")}>{ddayText(n)}</span>}
      </div>
      <div role="cell" className="cm-c">
        <span className="cm-status" style={{ background: bg, color: fg }}>
          <span className="cm-status-dot" aria-hidden="true" />
          {t(c.status)}
        </span>
      </div>
      <div role="cell" className="cm-c cm-center">
        <MemoButton
          has={hasMemo}
          memo={c.memo}
          onClick={(e) => {
            e.stopPropagation();
            onMemo();
          }}
        />
      </div>
    </div>
  );
}

function MemoButton({ has, memo, onClick }: { has: boolean; memo: string; onClick: (e: ReactMouseEvent) => void }) {
  const preview = has ? parseMemo(memo).map((l) => "· " + l.t).join("\n") : "메모 추가";
  return (
    <button type="button" className={"cm-memo" + (has ? " has" : "")} aria-label={has ? "메모 편집" : "메모 추가"} title={preview} onClick={onClick}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill={has ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
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
      <div className="dialog cm-cats" role="dialog" aria-modal="true" aria-label="분류 관리">
        <div className="dialog-head">
          <span className="dialog-title">분류 관리</span>
          <span className="muted small">입력 줄의 선택 목록에 그대로 나와요. 설정 화면의 "민원대장 항목"과 같은 목록이에요.</span>
        </div>
        <div className="dialog-body">
          <ListGroup title="상태" desc="색은 자동으로 붙어요. 완료는 지울 수 없어요." items={cur.status} keep={KEEP_STATUS} colored onChange={(status) => onChange({ ...cur, status })} />
          <ListGroup title="접수유형" items={cur.intake} onChange={(intake) => onChange({ ...cur, intake })} />
          <ListGroup title="민원유형" items={cur.ctype} onChange={(ctype) => onChange({ ...cur, ctype })} last />
          <div className="hint cm-cats-hint">쓰고 있는 항목을 지워도 이미 적은 민원의 값은 그대로 남아요.</div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn-primary" onClick={onClose}>
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
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Trash() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}
