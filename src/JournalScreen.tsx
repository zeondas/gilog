// 업무일지 화면이에요. 시안 Journal.dc.html과 사양서의 "업무일지" 절을 따라요.
// 누가 언제 무슨 말을 했는지 남기는 곳이라, 손을 키보드에서 떼지 않고 한 건을 끝낼 수 있게 만들었어요.
import { PopMenu } from "./PopMenu";
import { KeyboardEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DelGlyph } from "./Icons";
import { useOutsideClose } from "./useOutsideClose";
import { api, changeHooks, Complaint, Contact, ContactsData, DayInfo, Entry, EntryInput, errorText, JournalData, Project, Task, TaskList, TasksData } from "./api";
import { firstLineOf } from "./bullets";
import { daysBetween, daysLeft, ddayText, dueSoon, isUrgent } from "./complaints";
import { tasksDueSoon } from "./tasks";
import { copyText, Hl, pjFull, pjLabel, projectColor } from "./ContactsScreen";
import { PhoneInput } from "./PhoneInput";
import { finalizePhone } from "./phone";
import {
  contactFor,
  contactLabel,
  dayTitle,
  DraftLine,
  expandKind,
  findContact,
  firstContact,
  initials,
  isChosung,
  isMemo,
  koIndex,
  matchEntry,
  normTime,
  nowHM,
  resolveDraft,
  splitJamo,
  sameSpeaker,
  sortEntries,
  Speaker,
  speakerColor,
  speakers,
  splitWho,
  WHO_SEP,
  todayStr,
} from "./journal";
import { useJamoGuard } from "./koInput";
import { isKey, keyAction, moveField, rowKeys } from "./keys";
import { isEmptyMemo, MemoEditor, MemoView, sanitize } from "./RichMemo";
import { PrintDialog } from "./JournalPrint";
import { ExcelMenu } from "./ExcelMenu";
import { journalDayRows, journalImports, journalRows } from "./excel";
import { DEFAULT_SETTINGS, Kind, loadSettings } from "./settingsStore";
import { AskBand } from "./AskBand";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/**
 * 말 줄의 키 (엔터규칙 "업무일지 말 줄", keys.ts). Enter 다음 말(사람 교대) · Shift+Enter 같은 사람이 이어서
 * · 왼쪽 Alt+Enter 한 말 안 줄 바꿈 · Tab 등록 · Shift+Tab 앞 칸 · Esc 취소. Ctrl+Enter는 쓰지 않아요.
 * 한글 조합 중 Tab·두 번 들어온 Tab은 keyAction이 다뤄요.
 */
function talkAction(e: KeyboardEvent): "next" | "same" | "br" | "submit" | "prev" | "cancel" | null {
  switch (keyAction(e, "talk")) {
    case "talk.next":
      return "next";
    case "talk.same":
      return "same";
    case "talk.br":
      return "br";
    case "common.next":
      return "submit";
    case "common.prev":
      return "prev";
    case "common.cancel":
      return "cancel";
    default:
      return null;
  }
}

/** 말 줄 안 줄 바꿈: 커서 자리에 줄바꿈 글자를 넣어요(되돌리기도 돼요). */
function insertBreak(el: HTMLTextAreaElement) {
  if (!document.execCommand("insertText", false, "\n")) el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end");
}

/** 위·아래 화살표로 말 줄을 옮길지 (여러 줄인 말은 맨 윗줄·맨 아랫줄에서만) */
function lineEdge(el: HTMLTextAreaElement, up: boolean) {
  const v = el.value;
  return up ? !v.slice(0, el.selectionStart).includes("\n") : !v.slice(el.selectionEnd).includes("\n");
}

/** 화면 전체가 함께 쓰는 값 */
type Ctx = {
  myName: string;
  kinds: Kind[];
  contacts: Contact[];
  projects: Project[];
  byId: Map<number, Project>;
};

// ---------- 화면 ----------

export default function JournalScreen({
  urgentDays = 2,
  onOpenComplaint,
  onOpenTask,
}: {
  urgentDays?: number;
  onOpenComplaint?: (id: number) => void;
  onOpenTask?: (id: number) => void;
}) {
  const [data, setData] = useState<JournalData | null>(null);
  const [cdata, setCdata] = useState<ContactsData>({ contacts: [], projects: [], groups: [] });
  const [myName, setMyName] = useState(DEFAULT_SETTINGS.myName);
  const [kinds, setKinds] = useState<Kind[]>(DEFAULT_SETTINGS.kinds);
  const [today, setToday] = useState(todayStr());
  const [day, setDay] = useState(today);
  const [q, setQ] = useState("");
  const [onlyHits, setOnlyHits] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  // 한 번 누른 카드(골라 둔 카드). 두 번 누르거나 Enter를 누르면 고쳐요(0.6.2, 모든 화면 같은 규칙).
  const [selId, setSelId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [tasks, setTasks] = useState<TasksData>({ lists: [], tasks: [] });
  /** 기록을 등록·고치기·지울 때마다 하나씩 늘어요 – 카드 두 단을 다시 나누는 신호 */
  const [tick, setTick] = useState(0);
  /** 공휴일(캘린더가 받아 둔 것) – 달력의 빨간 날 */
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  /** 인쇄 기간 창 */
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    api.journalData().then(setData, (e) => setNote(errorText(e)));
    api.complaints().then(setComplaints, () => {});
    api.tasksData().then(setTasks, () => {});
    api.contactsData().then(setCdata, () => {});
    api.calendarData().then((c) => setHolidays(new Set(c.holidays.map((h) => h.date))), () => {});
    loadSettings().then(
      (s) => {
        setMyName(s.myName || DEFAULT_SETTINGS.myName);
        setKinds(s.kinds);
      },
      () => {},
    );
  }, []);

  // 자정을 넘기면 "오늘"을 바꿔요. 오늘을 보고 있었으면 새 날로 넘어가요.
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = todayStr();
      if (now !== today) {
        setDay((d) => (d === today ? now : d));
        setToday(now);
      }
    }, 30_000);
    return () => window.clearInterval(t);
  }, [today]);

  // 업무연락처(사람·사업)가 바뀌면 다시 읽어요 – 사업 고르기 목록이 늘 전체예요(2026-10-25 사용자 ③).
  useEffect(() => {
    const CONTACT_CMDS = /^(add_contact|update_contact|delete_contact|add_project|rename_project|set_project_|delete_project|add_project_group|rename_project_group|delete_project_group|move_project_group|import_contacts)/;
    const hook = (cmd: string) => {
      if (CONTACT_CMDS.test(cmd)) api.contactsData().then(setCdata, () => {});
    };
    changeHooks.add(hook);
    return () => {
      changeHooks.delete(hook);
    };
  }, []);

  const ctx: Ctx = useMemo(
    () => ({
      myName,
      kinds,
      contacts: cdata.contacts,
      projects: cdata.projects,
      byId: new Map(cdata.projects.map((p) => [p.id, p])),
    }),
    [myName, kinds, cdata],
  );

  /** 저장 쪽을 부르고, 실패하면 이유를 보여 줘요. */
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

  const putEntry = useCallback((e: Entry) => {
    setTick((x) => x + 1);
    setData((d) => d && { ...d, entries: sortEntries([e, ...d.entries.filter((x) => x.id !== e.id)]) });
  }, []);

  const add = useCallback(
    async (input: EntryInput) => {
      const e = await run(api.addEntry(input));
      if (e) putEntry(e);
      return !!e;
    },
    [run, putEntry],
  );

  const update = useCallback(
    async (id: number, input: EntryInput) => {
      const e = await run(api.updateEntry(id, input));
      if (e) putEntry(e);
      return !!e;
    },
    [run, putEntry],
  );

  const remove = useCallback(
    async (id: number) => {
      setEditId(null);
      try {
        await api.deleteEntry(id);
        setNote("");
        setData((d) => d && { ...d, entries: d.entries.filter((x) => x.id !== id) });
        setTick((x) => x + 1);
      } catch (e) {
        setNote(errorText(e));
      }
    },
    [],
  );

  const saveDay = useCallback(
    async (info: DayInfo) => {
      const r = await run(api.setDay(info));
      if (r) setData((d) => d && { ...d, days: [...d.days.filter((x) => x.date !== r.date), r].filter((x) => x.arrive || x.transport || x.weather || x.note) });
    },
    [run],
  );

  const go = useCallback((date: string) => {
    setDay(date);
    setQ("");
    setEditId(null);
    setMenuId(null);
  }, []);

  /** 날짜 우클릭 → "이 날 일지 지우기". 지운 날을 보고 있었으면 가장 가까운 날로 가요(오늘이면 오늘에 남아요). */
  const removeDay = useCallback(
    async (date: string) => {
      try {
        await api.deleteDay(date);
        setNote("");
      } catch (e) {
        setNote(errorText(e));
        return;
      }
      setEditId(null);
      setData((d) => {
        if (!d) return d;
        const next = { days: d.days.filter((x) => x.date !== date), entries: d.entries.filter((x) => x.date !== date) };
        setDay((cur) => {
          if (cur !== date || date === today) return cur;
          const left = [...new Set([today, ...next.entries.map((e) => e.date), ...next.days.map((x) => x.date)])];
          const dist = (x: string) => Math.abs(new Date(x).getTime() - new Date(date).getTime());
          return left.sort((a, b) => dist(a) - dist(b))[0] ?? today;
        });
        return next;
      });
    },
    [today],
  );

  if (!data) {
    return (
      <>
        <h1 className="title">업무일지</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  const query = q.trim().toLowerCase();
  const entries = data.entries.filter((e) => e.date === day);
  const info = data.days.find((d) => d.date === day) ?? { date: day, arrive: "", transport: "", weather: "", note: "" };
  const counts = new Map<string, number>();
  for (const e of data.entries) counts.set(e.date, (counts.get(e.date) ?? 0) + 1);

  return (
    <div className="jn">
      <div className="jn-body">
        <div className="jn-head">
          <h1 className="title">{dayTitle(day)}</h1>
          {day !== today && (
            <button type="button" className="btn btn-ctrl" onClick={() => go(today)}>
              오늘
            </button>
          )}
          <label className="search jn-search">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              aria-label="일지 검색"
              placeholder="사람, 내용으로 전체 일지 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && q) {
                  e.preventDefault();
                  setQ("");
                }
              }}
            />
          </label>
          <ExcelMenu
            kind="journal"
            total={data.entries.length}
            build={() => ({ rows: journalRows(data.entries, cdata.projects), days: journalDayRows(data.days), intake: [], status: [] })}
            parse={(sheet) => [journalImports(sheet, data.entries, cdata.projects, myName)]}
            note={(sheet) => {
              const r = journalImports(sheet, data.entries, cdata.projects, myName);
              const parts = [r.dup ? `파일 안에서 겹친 줄 ${r.dup}건` : "", r.bad ? `날짜·시각·내용을 읽지 못한 줄 ${r.bad}건` : ""].filter(Boolean);
              return parts.length ? parts.join(" · ") + "은 건너뛰어요" : "";
            }}
            count={(rows) => rows[0]?.entries.length ?? 0}
            // 덮어쓰기의 "같은 기록" = 날짜 + 시각 + 상대(2026-10-25 사용자 ②3안, 공통 ✔5)
            preview={([r]) => ({ same: r ? r.same.filter((x) => x !== null).length : 0, total: data.entries.length })}
            onImport={async ([r], mode) => {
              // 대체하기: 기록·날짜 머리 줄을 한 번에 모두 지운 뒤 넣어요.
              if (mode === "replace") await api.clearJournal();
              let n = 0;
              for (const [i, e] of r.entries.entries()) {
                const id = mode === "merge" ? r.same[i] : null;
                if (id !== null) await api.updateEntry(id, e);
                else await api.addEntry(e);
                n++;
              }
              // 날짜별 머리 줄: 파일에 적힌 날은 파일 값으로(덮어쓰기·대체하기 모두).
              for (const d of r.days) await api.setDay(d);
              setData(await api.journalData());
              return n;
            }}
          />
          <button type="button" className="btn btn-ctrl btn-text jn-print" onClick={() => setPrintOpen(true)}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 9V3h10v6" />
              <rect x="3" y="9" width="18" height="8" rx="2" />
              <path d="M7 14h10v7H7z" />
            </svg>
            인쇄
          </button>
        </div>
        {printOpen && (
          <PrintDialog
            day={day}
            today={today}
            entries={data.entries}
            days={data.days}
            holidays={holidays}
            myName={myName}
            projects={cdata.projects}
            onClose={() => setPrintOpen(false)}
          />
        )}

        <DayHead key={day} info={info} onSave={saveDay} />

        {note && <p className="note" role="status">{note}</p>}

        {query ? (
          <div className="jn-scroll" key="search">
            <SearchResults entries={data.entries} q={query} raw={q.trim()} onlyHits={onlyHits} ctx={ctx} onToggle={() => setOnlyHits(!onlyHits)} onClose={() => setQ("")} onGo={go} />
          </div>
        ) : (
          <>
            <NewCard key={day} date={day} ctx={ctx} onAdd={add} />
            {/* 위쪽(날짜·개요·신규 카드)은 그대로 두고 기록 목록만 이 상자 안에서 스크롤해요(2026-10-25 사용자 ⑦). */}
            <div className="jn-scroll" key={"day-" + day}>
            {/* 카드 채우는 순서(2026-10-16 사용자): 왼쪽 단을 화면 아래까지 채우고 넘치는 것부터 오른쪽 단.
                날짜를 열 때·기록을 등록·고치기·지울 때·창 크기를 바꿀 때만 다시 나눠요(CardCols). */}
            <CardCols mode="screen" relayout={`${day}|${tick}`}>
              {entries.map((e) =>
                editId === e.id ? (
                  <EditCard
                    key={e.id}
                    entry={e}
                    ctx={ctx}
                    onCancel={() => setEditId((cur) => (cur === e.id ? null : cur))}
                    onSave={(input) => {
                      setEditId((cur) => (cur === e.id ? null : cur));
                      return update(e.id, input);
                    }}
                    onRemove={() => remove(e.id)}
                  />
                ) : (
                  <ViewCard
                    key={e.id}
                    entry={e}
                    ctx={ctx}
                    menuOpen={menuId === e.id}
                    onMenu={(on) => setMenuId(on ? e.id : null)}
                    onProject={(project) => {
                      setMenuId(null);
                      if (project !== e.project) update(e.id, { ...e, project });
                    }}
                    selected={selId === e.id}
                    onSelect={() => setSelId(e.id)}
                    onOpen={() => {
                      setMenuId(null);
                      setSelId(e.id);
                      setEditId(e.id);
                    }}
                  />
                ),
              )}
            </CardCols>
            {entries.length === 0 && (
              <p className="muted small">
                {day === today ? "오늘 기록이 아직 없어요. 위 카드에 적고 Enter를 눌러 등록해요." : "이 날 기록이 없어요."}
              </p>
            )}
            </div>
          </>
        )}
      </div>

      {/* 오른쪽 열(2026-10-19 사용자 – 시안 JournalRight.dc.html 1안, 폭 260): 위 월 달력, 아래 챙길 일 */}
      <div className="jn-left">
        <JournalCalendar
          day={day}
          today={today}
          counts={counts}
          holidays={holidays}
          onPick={go}
          hasHead={(d) => data.days.some((x) => x.date === d)}
          onDelete={removeDay}
        />
        <section className="jn-aside" aria-label="챙길 일">
          <div className="jn-aside-head">
            <span className="jn-aside-title">챙길 일</span>
            <span className="muted small">마감 7일 이내</span>
          </div>
          <DueList
            list={dueSoon(complaints, today)}
            tasks={tasksDueSoon(tasks.tasks, today)}
            lists={tasks.lists}
            today={today}
            urgentDays={urgentDays}
            onOpen={onOpenComplaint}
            onOpenTask={onOpenTask}
          />
        </section>
      </div>
    </div>
  );
}

// ---------- 카드 두 단 ----------

/**
 * 카드를 두 단에 나눠요(최근 기록이 맨 앞, 순서는 한 번만 꺾여요 – 왼쪽 단 위→아래, 그다음 오른쪽 단 위→아래).
 * mode "screen"(그날 일지, 2026-10-16 사용자):
 *   기준 높이 = 카드가 시작하는 곳부터 일지 화면 맨 아래(아래 여백만 빼고)까지, 지금 창 크기로 재요.
 *   ① 모두 왼쪽 단에 들어가면 전부 왼쪽. ② 왼쪽 단을 기준 높이까지 채우고 넘치는 것부터 오른쪽 – 오른쪽도 들어가면 끝.
 *   ③ 그래도 넘치면 화면 기준은 버리고 두 단 높이가 가장 비슷해지는 곳에서 나눠요(화면 전체가 스크롤돼요).
 *   카드 한 장이 기준 높이보다 길면 그 카드만 왼쪽 단 맨 위, 다음 카드부터 오른쪽이에요.
 * mode "balance"(검색 결과의 날짜 묶음): ③만 써요.
 * 다시 나누는 때는 relayout 글자가 바뀔 때(날짜를 열 때, 기록을 등록·고치기·지울 때)와 창 크기를 바꿀 때뿐이에요.
 * 글을 쓰는 동안(카드가 커져도)은 다시 나누지 않아 카드가 단 사이를 옮겨 다니지 않아요.
 * 재는 동안은 모든 카드를 왼쪽 단에 보이지 않게 그리고, 화면에 그리기 전에(useLayoutEffect) 자리를 잡아요.
 */
function CardCols({ mode, relayout, children }: { mode: "screen" | "balance"; relayout: string; children: ReactNode[] }) {
  const items = children;
  const n = items.length;
  const box = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<number | null>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSize((x) => x + 1));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  // 나눌 때가 되면 재기부터 다시 해요.
  useLayoutEffect(() => setSplit(null), [relayout, size, n]);

  useLayoutEffect(() => {
    if (split !== null) return;
    const el = box.current;
    const col = el?.firstElementChild;
    if (!el || !col) return;
    const hs = [...col.children].map((c) => c.getBoundingClientRect().height + (parseFloat(getComputedStyle(c).marginBottom) || 0));
    const gap = hs.length ? parseFloat(getComputedStyle(col.children[0]).marginBottom) || 0 : 0;
    let avail = Infinity;
    // 기록 목록 상자(.jn-scroll)가 스크롤하는 곳이에요 – 없으면 예전처럼 화면 전체(.main).
    const main = mode === "screen" ? ((el.closest(".jn-scroll") ?? el.closest(".main")) as HTMLElement | null) : null;
    if (main) {
      // 상자를 맨 위로 올렸을 때 보이는 아래 끝(아래 여백만 빼고)까지. 내려 둔 채 다시 나누어도 같게 재요.
      const pb = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      avail = main.clientHeight - pb - top;
    }
    setSplit(splitCards(hs, gap, avail));
  }, [split, mode]);

  const k = split ?? n;
  return (
    <div ref={box} className="jn-cols" style={split === null ? { visibility: "hidden" } : undefined}>
      <div className="jn-col">{items.slice(0, k)}</div>
      <div className="jn-col">{items.slice(k)}</div>
    </div>
  );
}

/** 카드 높이(아래 간격 포함)로 왼쪽 단에 둘 장 수를 정해요. avail이 Infinity면 ③(높이 비슷하게)만 써요. */
export function splitCards(hs: number[], gap: number, avail: number): number {
  const n = hs.length;
  if (n <= 1) return n;
  const sum = (a: number, b: number) => hs.slice(a, b).reduce((x, y) => x + y, 0) - gap;
  if (Number.isFinite(avail)) {
    if (sum(0, n) <= avail) return n; // ①
    if (sum(0, 1) > avail) return 1; // 첫 카드가 기준보다 길면 그 카드만 왼쪽
    let k = 1;
    while (k < n && sum(0, k + 1) <= avail) k++;
    if (sum(k, n) <= avail) return k; // ②
  }
  // ③ 두 단 높이가 가장 비슷해지는 곳(같으면 왼쪽이 긴 쪽)
  let best = 1;
  let diff = Infinity;
  for (let s = 1; s < n; s++) {
    const d = Math.abs(sum(0, s) - sum(s, n));
    if (d < diff - 0.5) {
      diff = d;
      best = s;
    }
  }
  return best;
}

// ---------- 챙길 일 ----------

/**
 * 마감 7일 안(지난 것 포함)이고 완료가 아닌 민원과 할 일. 마감이 빠른 것이 위예요.
 * 민원을 누르면 민원대장의 그 줄로, 할 일을 누르면 할 일 목록의 그 항목으로 가요.
 */
function DueList({
  list,
  tasks,
  lists,
  today,
  urgentDays,
  onOpen,
  onOpenTask,
}: {
  list: Complaint[];
  tasks: Task[];
  lists: TaskList[];
  today: string;
  urgentDays: number;
  onOpen?: (id: number) => void;
  onOpenTask?: (id: number) => void;
}) {
  if (!list.length && !tasks.length) return <p className="jn-aside-empty muted small">마감이 7일 안으로 다가온 민원·할 일이 없어요.</p>;
  const rows = [
    ...list.map((c) => ({ due: c.due, k: 0, id: c.id, c, t: null as Task | null })),
    ...tasks.map((t) => ({ due: t.due, k: 1, id: t.id, c: null as Complaint | null, t })),
  ].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.k - b.k));
  return (
    <div className="jn-due">
      {rows.map(({ c, t }) => {
        if (c) {
          const n = daysLeft(c, today) ?? 0;
          const title = [c.ctype, [c.area, c.place].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || firstLineOf(c.body);
          return (
            <button key={"c" + c.id} type="button" className="jn-due-item" title="민원대장에서 보기" onClick={() => onOpen?.(c.id)}>
              <span className={"jn-due-d" + (isUrgent(n, urgentDays) ? " urgent" : "")}>{ddayText(n)}</span>
              <span className="jn-due-t">
                민원 {c.no}번 · {title}
              </span>
              <span className="jn-due-s">
                {c.due} 마감 · {c.status}
              </span>
            </button>
          );
        }
        const task = t!;
        const n = daysBetween(today, task.due);
        const listName = lists.find((l) => l.id === task.list)?.name ?? "";
        return (
          <button key={"t" + task.id} type="button" className="jn-due-item" title="할 일 목록에서 보기" onClick={() => onOpenTask?.(task.id)}>
            <span className={"jn-due-d" + (isUrgent(n, urgentDays) ? " urgent" : "")}>{ddayText(n)}</span>
            <span className="jn-due-t">할 일 · {task.title}</span>
            <span className="jn-due-s">
              {task.due} 마감{listName ? ` · ${listName}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- 날짜 달력 (시안 JournalCal1.dc.html 1안) ----------

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * 왼쪽 열 위의 월 달력. 칸을 누르면 그날 일지(기록 없는 날도 열리고 그 날로 등록돼요).
 * 머리 "2026년 10월 ▾"를 누르면 12달 고르기(달마다 기록 수, ‹ ›는 해 이동). 날짜 우클릭 = 이 날 열기·이 날 일지 지우기.
 * 기록이 있는 날은 날짜 아래 작은 점이에요(숫자는 날짜와 헷갈려서 빼요 – 2026-10-17 사용자).
 */
function JournalCalendar({
  day,
  today,
  counts,
  holidays,
  onPick,
  hasHead,
  onDelete,
}: {
  day: string;
  today: string;
  counts: Map<string, number>;
  holidays: Set<string>;
  onPick: (d: string) => void;
  hasHead: (d: string) => boolean;
  onDelete: (d: string) => void;
}) {
  const [view, setView] = useState(() => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) }));
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState<{ date: string; x: number; y: number; ask: boolean } | null>(null);
  // 다른 날로 가면(오늘 단추, 검색 결과의 "이 날짜로 이동") 그 달을 보여 줘요.
  useEffect(() => setView({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) }), [day]);

  const step = (dir: number) => {
    if (picker) return setView((v) => ({ y: v.y + dir, m: v.m }));
    setView((v) => {
      const d = new Date(v.y, v.m - 1 + dir, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  };

  const off = new Date(view.y, view.m - 1, 1).getDay();
  const dim = new Date(view.y, view.m, 0).getDate();
  const rows = Math.ceil((off + dim) / 7);
  const cells = Array.from({ length: rows * 7 }, (_, i) => {
    const dt = new Date(view.y, view.m - 1, i - off + 1);
    const key = ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const n = counts.get(key) ?? 0;
    const inMonth = dt.getMonth() + 1 === view.m;
    return { key, d: dt.getDate(), w: dt.getDay(), n, inMonth };
  });

  const monthCount = (m: number) => {
    let t = 0;
    const p = ymd(view.y, m, 1).slice(0, 8);
    for (const [k, n] of counts) if (k.startsWith(p)) t += n;
    return t;
  };

  return (
    <section className="jcal" aria-label="날짜 달력">
      <div className="jcal-head">
        <button type="button" className="jcal-title" aria-expanded={picker} title="눌러서 달 고르기" onClick={() => setPicker(!picker)}>
          {picker ? `${view.y}년` : `${view.y}년 ${view.m}월`}
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d={picker ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
          </svg>
        </button>
        <button type="button" className="jcal-nav" aria-label={picker ? "앞 해" : "앞 달"} onClick={() => step(-1)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          className="jcal-today"
          onClick={() => {
            setPicker(false);
            setView({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
            onPick(today);
          }}
        >
          오늘
        </button>
        <button type="button" className="jcal-nav" aria-label={picker ? "다음 해" : "다음 달"} onClick={() => step(1)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {picker ? (
        <div className="jcal-body">
          <div className="jcal-months">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const t = monthCount(m);
              const cur = m === view.m;
              return (
                <button
                  key={m}
                  type="button"
                  className={"jcal-mon" + (!t && !cur ? " empty" : "")}
                  aria-pressed={cur}
                  onClick={() => {
                    setView({ y: view.y, m });
                    setPicker(false);
                  }}
                >
                  <span>{m}월</span>
                  <span className="jcal-mon-n">{t ? `${t}건` : "기록 없음"}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="jcal-body">
          <div className="jcal-week" aria-hidden="true">
            {WEEK.map((w, i) => (
              <span key={w} className={i === 0 ? "sun" : i === 6 ? "sat" : ""}>
                {w}
              </span>
            ))}
          </div>
          <div className="jcal-grid" role="grid" aria-label={`${view.y}년 ${view.m}월`}>
            {cells.map((c) => {
              const cls = [
                "jcal-day",
                !c.inMonth && "out",
                c.key === today && "today",
                c.n && "has",
                c.w === 0 || holidays.has(c.key) ? "red" : c.w === 6 ? "sat" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={c.key}
                  type="button"
                  className={cls}
                  aria-pressed={c.key === day}
                  aria-haspopup="menu"
                  aria-label={`${Number(c.key.slice(5, 7))}월 ${c.d}일 ${WEEK[c.w]}요일${c.n ? `, 기록 ${c.n}건` : ""}${c.key === today ? ", 오늘" : ""}`}
                  onClick={() => onPick(c.key)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    // 마우스면 누른 자리, 키보드(메뉴 키)면 날짜 칸 오른쪽에 띄워요.
                    setMenu({ date: c.key, x: e.clientX || r.right, y: e.clientY || r.top, ask: false });
                  }}
                >
                  <span>{c.d}</span>
                  <span className="jcal-dot" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {menu && (
        <DayMenu
          {...menu}
          count={counts.get(menu.date) ?? 0}
          head={hasHead(menu.date)}
          onClose={() => setMenu(null)}
          onOpen={() => {
            setMenu(null);
            onPick(menu.date);
          }}
          onAsk={() => setMenu({ ...menu, ask: true })}
          onDelete={() => {
            setMenu(null);
            onDelete(menu.date);
          }}
        />
      )}
    </section>
  );
}

/** 날짜 우클릭 메뉴. 지우기는 한 번 더 물어요(삭제 규칙). Esc나 바깥을 누르면 지우지 않고 닫혀요. */
function DayMenu({
  date,
  x,
  y,
  ask,
  count,
  head,
  onClose,
  onOpen,
  onAsk,
  onDelete,
}: {
  date: string;
  x: number;
  y: number;
  ask: boolean;
  count: number;
  head: boolean;
  onClose: () => void;
  onOpen: () => void;
  onAsk: () => void;
  onDelete: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // 메뉴가 열리면 첫 항목(묻는 중이면 취소)에 커서를 둬요.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(ask ? ".dmenu-ask .btn" : ".dmenu-item")?.focus();
  }, [ask]);

  const [, m, d] = date.split("-").map(Number);
  const what = [count ? `기록 ${count}건` : "", head ? "출근·교통·날씨·비고" : ""].filter(Boolean).join("과 ");
  return (
    <PopMenu boxRef={box} x={x} y={y} onClose={onClose} label={`${m}월 ${d}일 메뉴`}>
      {!ask ? (
        <>
          <button type="button" role="menuitem" className="dmenu-item" onClick={onOpen}>
            이 날 열기
          </button>
          <button type="button" role="menuitem" className="dmenu-item danger" onClick={onAsk} disabled={!count && !head}>
            이 날 일지 지우기
          </button>
        </>
      ) : (
        <AskBand
          className="dmenu-ask"
          label="이 날 일지 지우기 확인"
          text={
            <>
              {m}월 {d}일 {what || "일지"}{head || !what ? "를" : "을"} 모두 지울까요? 되돌릴 수 없어요.
            </>
          }
          onNo={onClose}
          onYes={onDelete}
        />
      )}
    </PopMenu>
  );
}

// ---------- 날짜 머리 줄 (출근 · 교통 · 날씨 · 비고) ----------

function DayHead({ info, onSave }: { info: DayInfo; onSave: (d: DayInfo) => void }) {
  const [v, setV] = useState(info);
  const [bad, setBad] = useState(false);
  const saved = useRef(info);

  function commit(next: DayInfo) {
    let arrive = next.arrive.trim();
    if (arrive) {
      const t = normTime(arrive);
      if (!t) {
        setBad(true);
        return;
      }
      arrive = t;
    }
    setBad(false);
    const fixed = { ...next, arrive };
    setV(fixed);
    const s = saved.current;
    if (fixed.arrive === s.arrive && fixed.transport.trim() === s.transport && fixed.weather.trim() === s.weather && fixed.note.trim() === s.note) return;
    saved.current = { ...fixed, transport: fixed.transport.trim(), weather: fixed.weather.trim(), note: fixed.note.trim() };
    onSave(fixed);
  }

  const field = (key: "arrive" | "transport" | "weather" | "note", label: string, cls: string, ph = "") => (
    <label className={"jday-f " + cls}>
      {label}
      <input
        className={"fld jday-in" + (key === "arrive" && bad ? " invalid" : "")}
        aria-invalid={key === "arrive" && bad ? true : undefined}
        placeholder={ph}
        value={v[key]}
        onChange={(e) => {
          if (key === "arrive") setBad(false);
          setV({ ...v, [key]: e.target.value });
        }}
        onBlur={() => commit(v)}
      />
    </label>
  );

  return (
    <div className="jday" role="group" aria-label="이 날의 머리 줄" onKeyDown={(e) => rowKeys(e, e.currentTarget, () => commit(v))}>
      {field("arrive", "출근", "jday-time", "08:40")}
      {field("transport", "교통", "jday-short")}
      {field("weather", "날씨", "jday-mid")}
      {field("note", "비고", "jday-grow", "비고")}
    </div>
  );
}

// ---------- 상대 칸 (업무연락처에서 찾기) ----------

/**
 * 상대 칸. "/"로 여러 명을 적고(쉼표는 글자 그대로), 마지막으로 적는 이름에 맞는 연락처를 아래에 보여 줘요.
 * ↑↓로 고르고 Enter로 넣어요(고르지 않았으면 Enter는 등록이에요). 이름만 적고 칸을 떠나도 그 사람이 한 명이면 채워요.
 */
function WhoInput({
  value,
  contacts,
  onChange,
  onPick,
  className,
  placeholder,
  inputRef,
}: {
  value: string;
  contacts: Contact[];
  onChange: (v: string) => void;
  onPick: (who: string) => void;
  className: string;
  placeholder: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  // 이름 초성: Shift 없이 같은 자음을 두 번 쳐서 묶인 된소리(ㅆ)는 ㅅㅅ으로 풀어요.
  const guard = useJamoGuard(onChange);
  guard.follow(value);
  const segs = value.split("/");
  const last = segs[segs.length - 1].trim();
  const lastLc = last.toLowerCase();
  // 이름은 초성으로도 찾아요("ㅂㅈㅎ", "박ㅈ"). 소속·직위는 글자 그대로 찾아요. 겹자음(ㅄ)은 풀어서 봐요.
  const nameAt = (c: Contact) => koIndex(c.name, last);
  const lastCho = splitJamo(last);
  const options = lastLc
    ? contacts
        .filter((c) => contactLabel(c) !== last && (nameAt(c) >= 0 || (!isChosung(lastCho) && [c.org, c.role].some((s) => s.toLowerCase().includes(lastLc)))))
        .sort((a, b) => Number(nameAt(b) === 0) - Number(nameAt(a) === 0) || Number(initials(a.name) !== lastCho) - Number(initials(b.name) !== lastCho))
        .slice(0, 8)
    : [];
  const show = open && options.length > 0;

  function pick(c: Contact) {
    const head = segs.slice(0, -1).map((x) => x.trim()).filter(Boolean);
    onPick([...head, contactLabel(c)].join(WHO_SEP));
    setHi(-1);
    setOpen(false);
  }

  /** 이름만 적은 사람들을 "이름 직위 · 소속"으로 채워요. */
  function expand() {
    const next = segs
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const c = findContact(s, contacts);
        return c ? contactLabel(c) : s;
      })
      .join(WHO_SEP);
    if (next !== value.trim()) onPick(next);
  }

  return (
    <div className="pin jwho">
      <input
        ref={inputRef}
        aria-label="상대"
        placeholder={placeholder}
        autoComplete="off"
        className={className}
        value={value}
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        onChange={(e) => {
          guard.onChange(e);
          setOpen(true);
          setHi(-1);
        }}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setHi(-1);
          expand();
        }}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e) || !show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((hi + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi(hi <= 0 ? options.length - 1 : hi - 1);
          } else if (e.key === "Enter" && hi >= 0) {
            e.preventDefault();
            e.stopPropagation();
            pick(options[hi]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="pin-list jwho-list" role="listbox">
          {options.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === hi}
              className="pin-opt jwho-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span className="jwho-name">{c.name}</span>
              <span className="jwho-rest">{[c.role, c.org].filter(Boolean).join(" · ")}</span>
              <span className="jwho-tel">{c.mobile || c.tel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 말 배지 ----------

function badgeStyle(s: Speaker) {
  if (s.me) return undefined;
  const k = speakerColor(s.who);
  return { background: `var(--pj-${k}-bg)`, color: `var(--pj-${k}-fg)`, borderColor: `var(--pj-${k}-bg)` };
}

/** 입력 중의 배지. 누르면 말한 사람이 바뀌어요. */
/** 말 배지 글자: 넉 자 이상 이름은 앞 세 글자만(2026-10-26 사용자 – 집행현황 담당 배지와 같은 규칙). 전체 이름은 title로. */
const badgeName = (who: string) => [...who].slice(0, 3).join("");

function SpeakerButton({ s, onClick }: { s: Speaker; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={"jsp-btn" + (s.me ? " me" : "")}
      style={badgeStyle(s)}
      title={(s.me ? "" : s.who + " – ") + "눌러서 말한 사람 바꾸기"}
      aria-label={`말한 사람: ${s.me ? "나" : s.who} (눌러서 변경)`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {s.me ? "나" : badgeName(s.who)}
    </button>
  );
}

// ---------- 신규 입력 카드 ----------

function NewCard({ date, ctx, onAdd }: { date: string; ctx: Ctx; onAdd: (e: EntryInput) => Promise<boolean> }) {
  const [time, setTime] = useState(nowHM());
  const [timeTouched, setTimeTouched] = useState(false);
  const [badTime, setBadTime] = useState(false);
  const [kind, setKind] = useState("");
  const [who, setWho] = useState("");
  const [tel, setTel] = useState("");
  const [telAuto, setTelAuto] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([{ sp: null, t: "" }]);
  const [focus, setFocus] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [memoKey, setMemoKey] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const kindRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const memo = isMemo(expandKind(kind, ctx.kinds));
  const kindGuard = useJamoGuard(setKind);

  // 구분이 메모로 바뀌는 사이 커서를 잃었으면 편집기로 옮겨요.
  useEffect(() => {
    const a = document.activeElement;
    if (memo && (!a || a === document.body)) editorRef.current?.focus();
  }, [memo]);

  // 화면을 열면 구분 칸에 커서가 가 있어요. (시간은 지금 시각으로 채워져 있어요)
  useEffect(() => kindRef.current?.focus(), []);

  // 시간을 직접 고치지 않았으면 지금 시각을 따라가요.
  useEffect(() => {
    if (timeTouched) return;
    const t = window.setInterval(() => setTime(nowHM()), 15_000);
    return () => window.clearInterval(t);
  }, [timeTouched]);

  // 고르고 있는 말 줄에 커서를 둬요. 말을 나눠 새 줄을 만들었으면 줄 맨 앞이에요.
  const caretStart = useRef(false);
  useEffect(() => {
    if (focus === null) return;
    const el = box.current?.querySelector<HTMLTextAreaElement>(`[data-uline="${focus}"]`);
    const start = caretStart.current;
    caretStart.current = false;
    if (el && document.activeElement !== el) {
      el.focus();
      const at = start ? 0 : el.value.length;
      el.setSelectionRange(at, at);
    }
  }, [focus, lines.length]);

  const S = speakers(who, expandKind(kind, ctx.kinds), ctx.myName);
  const resolved = resolveDraft(lines, S.list.length, S.first);

  /** 상대나 구분이 바뀌면 연락처를 채워요. 직접 적은 연락처는 건드리지 않아요. */
  function fill(nextWho: string, nextKind: string) {
    if (!telAuto && tel) return;
    const c = firstContact(nextWho, ctx.contacts);
    if (!c) return;
    setTel(contactFor(c, expandKind(nextKind, ctx.kinds)));
    setTelAuto(true);
  }

  function reset() {
    setKind("");
    kindGuard.sync("");
    setWho("");
    setTel("");
    setTelAuto(true);
    setLines([{ sp: null, t: "" }]);
    setFocus(null);
    setBody("");
    setMemoKey((n) => n + 1);
    setBadTime(false);
    setTimeTouched(false);
    setTime(nowHM());
    kindRef.current?.focus();
  }

  async function submit() {
    const t = normTime(time);
    if (!t) {
      setBadTime(true);
      timeRef.current?.focus();
      return;
    }
    const k = expandKind(kind, ctx.kinds);
    if (memo) {
      // 메모는 상대·연락처·프로젝트 없이 본문만 저장해요.
      if (isEmptyMemo(body)) return editorRef.current?.focus();
      const ok = await onAdd({ date, time: t, kind: k, who: "", contact: "", project: null, lines: [], body: sanitize(body) });
      if (ok) reset();
      return;
    }
    if (!lines.some((l) => l.t.trim())) {
      setFocus(0);
      box.current?.querySelector<HTMLInputElement>('[data-uline="0"]')?.focus();
      return;
    }
    const c = firstContact(who, ctx.contacts);
    const ok = await onAdd({
      date,
      time: t,
      kind: k,
      who: who.trim(),
      contact: finalizePhone(tel),
      // 프로젝트는 상대 연락처의 첫 프로젝트가 자동으로 붙어요. 등록한 뒤 바꿀 수 있어요.
      project: c?.projects[0] ?? null,
      lines: lines.map((l, i) => ({ ...S.list[resolved[i]], text: l.t })),
      body: "",
    });
    if (ok) reset();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLTextAreaElement;
    const at = target.dataset.uline;
    if (at === undefined) {
      // 머리 칸(시간·구분·상대·연락처): Enter·Tab 다음 칸, Shift+Tab 앞 칸, Esc 취소
      if (isKey(e, "common.cancel")) {
        e.preventDefault();
        reset();
        return;
      }
      rowKeys(e, box.current, () => void submit());
      return;
    }
    const i = Number(at);
    const act = talkAction(e);
    if (act) e.preventDefault();
    if (act === "cancel") return reset();
    if (act === "submit") return void submit();
    if (act === "prev") return void moveField(box.current!, target, -1);
    if (act === "br") return insertBreak(target);
    if (act === "next" || act === "same") {
      const v = target.value;
      if (!v.trim()) return;
      const head = v.slice(0, target.selectionStart);
      const tail = v.slice(target.selectionEnd);
      // 다음 줄이 비어 있으면(앞에서 만들어 둔 줄) 거기로 가요.
      if (!tail && act === "next" && i < lines.length - 1 && !lines[i + 1].t) return setFocus(i + 1);
      const next = lines.map((l) => ({ ...l }));
      next[i].t = tail ? head : v;
      // Enter는 다음 사람(자동), Shift+Enter는 같은 사람이 이어서 말해요.
      next.splice(i + 1, 0, { sp: act === "same" ? resolved[i] : null, t: tail });
      setLines(next);
      setFocus(i + 1);
      caretStart.current = true;
      return;
    }
    if (e.key === "Enter") return e.preventDefault();
    const cur = lines[i];
    if (e.key === "Backspace" && cur.t === "" && lines.length > 1) {
      e.preventDefault();
      setLines(lines.filter((_, j) => j !== i));
      setFocus(Math.max(0, i - 1));
    } else if (e.key === "ArrowUp" && i > 0 && lineEdge(target, true)) {
      e.preventDefault();
      setFocus(i - 1);
    } else if (e.key === "ArrowDown" && i < lines.length - 1 && lineEdge(target, false)) {
      e.preventDefault();
      setFocus(i + 1);
    }
  }

  return (
    <div ref={box} className={"jcard jcard-new" + (memo ? " jcard-memo" : "")} role="group" aria-label="새 기록 입력" onKeyDown={onKeyDown}>
      <div className="jpillar">
        <input
          ref={timeRef}
          aria-label="시간"
          className={"cell-input num strong" + (badTime ? " invalid" : "")}
          aria-invalid={badTime || undefined}
          value={time}
          // 칸에 들어가면 전체를 골라요 – 첫 숫자가 지금 시각을 바꿔요(2026-10-25 사용자).
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setTime(e.target.value);
            setTimeTouched(true);
            setBadTime(false);
          }}
          onBlur={() => {
            const t = normTime(time);
            if (t) setTime(t);
            else if (time.trim()) setBadTime(true);
            else {
              // 비우고 떠나면 다시 지금 시각을 따라가요.
              setTime(nowHM());
              setTimeTouched(false);
            }
          }}
        />
        <input
          ref={kindRef}
          aria-label="구분"
          placeholder="구분"
          autoComplete="off"
          className="cell-input"
          title={"초성 단축키: " + ctx.kinds.slice(0, 4).map((k) => `${k.key} ${k.name}`).join(", ") + " …"}
          value={kind}
          onKeyDown={kindGuard.onKeyDown}
          onChange={kindGuard.onChange}
          onCompositionEnd={kindGuard.onCompositionEnd}
          onBlur={() => {
            const k = expandKind(kind, ctx.kinds);
            if (k !== kind) setKind(k);
            fill(who, k);
          }}
        />
      </div>
      {memo ? (
        <div className="jnew-main">
          <MemoEditor
            key={memoKey}
            initial={body}
            editorRef={editorRef}
            placeholder="메모를 적어요. 위 단추로 제목·목록·표를 넣을 수 있어요."
            onChange={setBody}
            onSubmit={submit}
            onCancel={reset}
          />
          <div className="jmemo-foot">
            <span className="hint">Enter 다음 문단 · Shift+Enter 목록 · Tab 등록 · Esc 취소</span>
            <button type="button" className="btn-primary jbtn-add" onClick={submit}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              등록
            </button>
          </div>
        </div>
      ) : (
      <div className="jnew-main">
        <div className="jnew-top">
          <WhoInput
            className="cell-input"
            placeholder="상대 이름"
            value={who}
            contacts={ctx.contacts}
            onChange={setWho}
            onPick={(v) => {
              setWho(v);
              fill(v, kind);
            }}
          />
          <PhoneInput
            aria-label="연락처"
            placeholder="연락처 자동 입력"
            data-ime={expandKind(kind, ctx.kinds).includes("메일") ? "en" : undefined}
            className="cell-input num jnew-tel"
            value={tel}
            onChange={(v) => {
              setTel(v);
              setTelAuto(!v);
            }}
          />
          <span className="hint jnew-hint" title="Enter 다음 말(말한 사람 자동 교대) · Shift+Enter 같은 사람이 이어서 · Alt+Enter 한 말 안 줄 바꿈 · 배지를 누르면 사람 변경 · Tab 등록 · Esc 취소">
            Enter 다음 말 · Shift+Enter 같은 사람 · Tab 등록
          </span>
        </div>
        <div className="jnew-bottom">
          <div className="jlines-in">
            {lines.map((l, i) => {
              const s = S.list[resolved[i]];
              return (
                <div key={i} className="jline-in">
                  <SpeakerButton
                    s={s}
                    onClick={() => {
                      const next = lines.map((x) => ({ ...x }));
                      next[i].sp = (resolved[i] + 1) % S.list.length;
                      setLines(next);
                      setFocus(i);
                    }}
                  />
                  <textarea
                    data-uline={i}
                    rows={1}
                    aria-label={`${s.me ? "내" : s.who + "의"} 말`}
                    placeholder={s.me ? "내가 한 말" : `${s.who || "상대"} 말`}
                    className="cell-input jtalk"
                    value={l.t}
                    onFocus={() => setFocus(i)}
                    onChange={(e) => {
                      const next = lines.map((x) => ({ ...x }));
                      next[i].t = e.target.value;
                      setLines(next);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <button type="button" className="btn-primary jbtn-add" onClick={submit}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            등록
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

// ---------- 등록된 기록 (시간 기둥형 카드) ----------

function stripe(e: Entry, ctx: Ctx) {
  const p = e.project !== null ? ctx.byId.get(e.project) : undefined;
  // 띠는 테두리 두께를 바꾸지 않고 카드 안쪽 왼쪽에 겹쳐 그려요(app.css의 .jcard[style*="--stripe"]::before).
  // 테두리를 4px로 두꺼우면 그만큼 시간 기둥이 밀려 띠 없는 카드와 기둥 폭이 달라 보였어요(사용자 신고).
  return p ? ({ "--stripe": `var(--pj-${projectColor(p)}-line)` } as React.CSSProperties) : undefined;
}

/** 대화 줄들. q가 있으면 맞은 글자를 칠하고, dim에 든 줄은 흐리게 보여요. */
function Lines({ entry, q = "", show, dim }: { entry: Entry; q?: string; show?: boolean[]; dim?: boolean[] }) {
  return (
    <div className="jlines">
      {entry.lines.map((l, i) =>
        show && !show[i] ? null : (
          <div key={i} className={"jline" + (dim?.[i] ? " dim" : "")}>
            <span className={"jsp" + (l.me ? " me" : "")} style={badgeStyle(l)} title={l.me ? undefined : l.who}>
              {l.me ? "나" : <Hl text={badgeName(l.who)} q={q} />}
            </span>
            <span className="jline-t">
              <Hl text={l.text} q={q} />
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function PillarTel({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const at = value.indexOf("@");
  const parts = at > 0 ? [value.slice(0, at), value.slice(at)] : [value];
  return (
    <button
      type="button"
      className={"jtel" + (copied ? " copied" : "")}
      title={copied ? "복사했어요" : "눌러서 복사"}
      aria-label={`${value} 복사`}
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(value);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
      <span className="jtel-note" aria-live="polite">
        {copied ? "복사했어요" : ""}
      </span>
    </button>
  );
}

/**
 * 사업(프로젝트)을 고르는 작은 목록(2026-10-25 사용자 ③): 맨 위 검색 칸(초성·정식/줄인 이름), 전체 사업 이름 순 + 줄인 이름,
 * 길면 안에서 스크롤. 카드 테두리에 잘리지 않게 화면 위에 띄워요(예전엔 카드 안에 떠서 아래가 잘려 일부만 보였어요).
 */
function ProjectMenu({ ctx, current, onPick, onClose }: { ctx: Ctx; current: number | null; onPick: (id: number | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  // 사업 배지를 다시 누르는 것은 배지가 닫아요. 그 밖을 누르면 여기서 닫아요.
  useOutsideClose(true, [ref, () => anchor.current?.parentElement], () => onClose());
  // 놓을 자리: 배지 아래(모자라면 위), 화면 안 8px.
  useLayoutEffect(() => {
    const wrap = anchor.current?.parentElement;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const W = 260;
    const H = 230;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    const up = r.bottom + 4 + H > window.innerHeight - 8 && r.top - 4 - H > 8;
    setPos({ left, top: up ? r.top - 4 : r.bottom + 4, up });
  }, []);
  // 자리를 잡아 보이게 된 뒤 검색 칸에 커서를 둬요(숨긴 동안에는 커서가 들어가지 않아요).
  useEffect(() => {
    if (pos) inputRef.current?.focus();
  }, [pos]);
  // 목록이 스크롤되거나 창 크기가 바뀌면 자리가 어긋나니 닫아요.
  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const query = q.trim();
  const list = [...ctx.projects]
    .filter((p) => !query || koIndex(p.name, query) >= 0 || (!!p.alias && koIndex(p.alias, query) >= 0))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const opts: (Project | null)[] = query ? list : [null, ...list];
  const at = Math.min(hi, Math.max(0, opts.length - 1));

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    // 카드의 키(등록·취소)로 가지 않게 여기서 끝내요.
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi(Math.min(at + 1, opts.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi(Math.max(at - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (opts.length) onPick(opts[at]?.id ?? null);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  }

  const menu = (
    <div
      ref={ref}
      className={"jmenu jmenu-pop" + (pos?.up ? " up" : "")}
      role="dialog"
      aria-label="사업 고르기"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="cell-input jmenu-q"
        aria-label="사업 검색"
        placeholder="사업 이름으로 검색 (초성도 돼요)"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onKeyDown={onKey}
      />
      <div className="jmenu-list" role="listbox" aria-label="사업">
        {opts.map((p, i) => (
          <button
            key={p?.id ?? 0}
            type="button"
            role="option"
            data-i={i}
            className={"jmenu-opt" + (i === at ? " hi" : "")}
            aria-selected={(p?.id ?? null) === current}
            aria-pressed={(p?.id ?? null) === current}
            onMouseEnter={() => setHi(i)}
            onClick={() => onPick(p?.id ?? null)}
          >
            <span className="jmenu-dot" aria-hidden="true" style={{ background: p ? `var(--pj-${projectColor(p)}-line)` : "var(--line)" }} />
            <span className="pbadge-t jmenu-name" title={p ? pjFull(p) : undefined}>{p ? p.name : "없음"}</span>
            {p?.alias && <span className="jmenu-alias">{p.alias}</span>}
          </button>
        ))}
        {query && opts.length === 0 && <div className="hint jmenu-hint">맞는 사업이 없어요</div>}
      </div>
      {ctx.projects.length === 0 && <div className="hint jmenu-hint">사업은 업무연락처의 "사업 관리"에서 만들어요.</div>}
    </div>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {createPortal(menu, document.body)}
    </>
  );
}

function ViewCard({
  entry: e,
  ctx,
  menuOpen,
  onMenu,
  onProject,
  onOpen,
  selected,
  onSelect,
}: {
  entry: Entry;
  ctx: Ctx;
  menuOpen: boolean;
  onMenu: (on: boolean) => void;
  onProject: (id: number | null) => void;
  onOpen: () => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const { name, rest } = splitWho(e.who);
  const p = e.project !== null ? ctx.byId.get(e.project) : undefined;
  const memo = isMemo(e.kind) && (!!e.body || !e.lines.length);
  return (
    <article
      className={"jcard" + (memo ? " jcard-memo" : "") + (selected ? " sel" : "")}
      style={memo ? undefined : stripe(e, ctx)}
      title="두 번 눌러서 수정"
      tabIndex={0}
      aria-label={`${e.time} ${e.kind} ${e.who}`}
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={(ev) => {
        // 카드 안의 단추(연락처 복사, 프로젝트 고르기)를 두 번 누른 것은 수정이 아니에요.
        if ((ev.target as Element).closest("button") ) return;
        window.getSelection()?.removeAllRanges();
        onOpen();
      }}
      onKeyDown={(ev) => {
        if (ev.target === ev.currentTarget && ev.key === "Enter") {
          ev.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="jpillar">
        <span className="jtime">{e.time}</span>
        <span className="jkind">{e.kind}</span>
        {e.contact && !memo && <PillarTel value={e.contact} />}
      </div>
      {memo ? (
        <div className="jmain jmemo-main">
          <MemoView html={e.body} />
        </div>
      ) : (
      <div className="jmain">
        <div className="jhead">
          <span className="jname">{name || "상대 없음"}</span>
          {rest && <span className="jrest">{rest}</span>}
          <span className="jproj-wrap">
            <button
              type="button"
              className={"jproj" + (p ? "" : " none")}
              title={p ? pjFull(p) : "눌러서 사업 바꾸기"}
              aria-label={`사업: ${p ? pjFull(p) : "없음"}`}
              aria-expanded={menuOpen}
              onClick={(ev) => {
                ev.stopPropagation();
                onMenu(!menuOpen);
              }}
            >
              {p ? <span className="pbadge-t">{pjLabel(p)}</span> : "+ 사업"}
            </button>
            {menuOpen && <ProjectMenu ctx={ctx} current={e.project} onPick={onProject} onClose={() => onMenu(false)} />}
          </span>
        </div>
        <Lines entry={e} />
      </div>
      )}
    </article>
  );
}

/** 예전에 말 줄로 적은 메모를 편집기 본문으로 옮겨요. */
function linesToBody(e: Entry): string {
  if (e.body) return e.body;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return e.lines.map((l) => `<p>${esc(l.me ? l.text : `${l.who}: ${l.text}`).replace(/\n/g, "<br>")}</p>`).join("");
}

// ---------- 고치는 카드 ----------

type EditLine = Speaker & { t: string };

function EditCard({
  entry: e,
  ctx,
  onCancel,
  onSave,
  onRemove,
}: {
  entry: Entry;
  ctx: Ctx;
  onCancel: () => void;
  onSave: (input: EntryInput) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [time, setTime] = useState(e.time);
  const [badTime, setBadTime] = useState(false);
  const [kind, setKind] = useState(e.kind);
  const editKindGuard = useJamoGuard(setKind);
  const [who, setWho] = useState(e.who);
  const [tel, setTel] = useState(e.contact);
  const [project, setProject] = useState(e.project);
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const [lines, setLines] = useState<EditLine[]>(() => {
    if (e.lines.length) return e.lines.map((l) => ({ who: l.who, me: l.me, t: l.text }));
    const S = speakers(e.who, e.kind, ctx.myName);
    return [{ ...S.list[S.first], t: "" }];
  });
  const [focus, setFocus] = useState(Math.max(0, e.lines.length - 1));
  const [body, setBody] = useState(() => (isMemo(e.kind) ? linesToBody(e) : e.body));
  const ref = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const memo = isMemo(expandKind(kind, ctx.kinds));

  // 메모를 열면 본문 끝에 커서를 둬요.
  useEffect(() => {
    const el = editorRef.current;
    if (!memo || !el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo]);

  // 말할 수 있는 사람들: 상대 칸의 사람들, 나, 그리고 이미 적힌 줄의 사람들
  const names: Speaker[] = speakers(who, kind, ctx.myName).list;
  lines.forEach((l) => {
    if (!names.some((n) => sameSpeaker(n, l))) names.splice(names.length - 1, 0, { who: l.who, me: l.me });
  });
  const nextOf = (s: Speaker) => names[(names.findIndex((n) => sameSpeaker(n, s)) + 1) % names.length];

  function build(): EntryInput | null {
    const t = normTime(time);
    if (!t) return null;
    if (memo) {
      if (isEmptyMemo(body)) return null;
      return { date: e.date, time: t, kind: expandKind(kind, ctx.kinds), who: "", contact: "", project: null, lines: [], body: sanitize(body) };
    }
    const kept = lines.filter((l) => l.t.trim());
    if (!kept.length) return null;
    return {
      date: e.date,
      time: t,
      kind: expandKind(kind, ctx.kinds),
      who: who.trim(),
      contact: finalizePhone(tel),
      project,
      lines: kept.map((l) => ({ who: l.me ? ctx.myName : l.who, me: l.me, text: l.t })),
      body: "",
    };
  }

  function save(fromOutside = false) {
    const input = build();
    if (!input) {
      // 바깥을 눌렀는데 저장할 수 없으면 고치기 전으로 돌아가요.
      if (fromOutside) return onCancel();
      if (!normTime(time)) {
        setBadTime(true);
        timeRef.current?.focus();
      } else if (memo) editorRef.current?.focus();
      else setFocus(0);
      return;
    }
    onSave(input);
  }

  const latest = useRef({ save });
  latest.current = { save };

  // 바깥(다른 카드, 빈 곳)을 누르면 저장해요. "지울까요?"가 펼쳐져 있었으면 지우지 않고 접혀요.
  useOutsideClose(true, [ref], () => {
    if (!ref.current) return;
    setAsking(false);
    latest.current.save(true);
  });

  const caretStart = useRef(false);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLTextAreaElement>(`[data-eline="${focus}"]`);
    const start = caretStart.current;
    caretStart.current = false;
    if (el && document.activeElement !== el) {
      el.focus();
      const at = start ? 0 : el.value.length;
      el.setSelectionRange(at, at);
    }
  }, [focus, lines.length]);

  function fill(nextWho: string, nextKind: string) {
    const c = firstContact(nextWho, ctx.contacts);
    if (c) setTel(contactFor(c, expandKind(nextKind, ctx.kinds)));
  }

  function onKeyDown(ev: KeyboardEvent<HTMLDivElement>) {
    if (ev.defaultPrevented || asking) return;
    const target = ev.target as HTMLTextAreaElement;
    const at = target.dataset.eline;
    if (at === undefined) {
      // 머리 칸: Enter·Tab 다음 칸(마지막이면 저장), Shift+Tab 앞 칸, Esc 취소
      if (isKey(ev, "common.cancel")) {
        ev.preventDefault();
        onCancel();
        return;
      }
      rowKeys(ev, ref.current, () => save());
      return;
    }
    const i = Number(at);
    const act = talkAction(ev);
    if (act) ev.preventDefault();
    if (act === "cancel") return onCancel();
    if (act === "submit") return save();
    if (act === "prev") return void moveField(ref.current!, target, -1);
    if (act === "br") return insertBreak(target);
    if (act === "next" || act === "same") {
      const v = target.value;
      if (!v.trim()) return;
      const cur = { ...lines[i], t: v };
      const head = v.slice(0, target.selectionStart);
      const tail = v.slice(target.selectionEnd);
      if (!tail && act === "next" && i < lines.length - 1 && !lines[i + 1].t) return setFocus(i + 1);
      const s = act === "same" ? cur : nextOf(cur);
      const next = lines.map((l) => ({ ...l }));
      next[i] = { ...cur, t: tail ? head : v };
      next.splice(i + 1, 0, { who: s.who, me: s.me, t: tail });
      setLines(next);
      setFocus(i + 1);
      caretStart.current = true;
      return;
    }
    if (ev.key === "Enter") return ev.preventDefault();
    const cur = lines[i];
    if (ev.key === "Backspace" && cur.t === "" && lines.length > 1) {
      ev.preventDefault();
      setLines(lines.filter((_, j) => j !== i));
      setFocus(Math.max(0, i - 1));
    } else if (ev.key === "ArrowUp" && i > 0 && lineEdge(target, true)) {
      ev.preventDefault();
      setFocus(i - 1);
    } else if (ev.key === "ArrowDown" && i < lines.length - 1 && lineEdge(target, false)) {
      ev.preventDefault();
      setFocus(i + 1);
    }
  }

  const p = project !== null ? ctx.byId.get(project) : undefined;

  return (
    <div ref={ref} className={"jcard jcard-edit" + (memo ? " jcard-memo" : "")} role="group" aria-label="기록 고치기" onKeyDown={onKeyDown}>
      <div className="jpillar">
        <input
          ref={timeRef}
          aria-label="시간"
          className={"cell-input num strong" + (badTime ? " invalid" : "")}
          aria-invalid={badTime || undefined}
          value={time}
          onFocus={(ev) => ev.currentTarget.select()}
          onChange={(ev) => {
            setTime(ev.target.value);
            setBadTime(false);
          }}
          onBlur={() => {
            const t = normTime(time);
            if (t) setTime(t);
          }}
        />
        <input
          aria-label="구분"
          autoComplete="off"
          className="cell-input"
          value={kind}
          onKeyDown={editKindGuard.onKeyDown}
          onChange={editKindGuard.onChange}
          onCompositionEnd={editKindGuard.onCompositionEnd}
          onBlur={() => {
            const k = expandKind(kind, ctx.kinds);
            if (k !== kind) setKind(k);
          }}
        />
        {!memo && (
        <span className="jproj-wrap jproj-pillar">
          <button
            type="button"
            className="jproj-badge"
            style={p ? { background: `var(--pj-${projectColor(p)}-bg)`, color: `var(--pj-${projectColor(p)}-fg)`, borderColor: `var(--pj-${projectColor(p)}-line)` } : undefined}
            title={p ? pjFull(p) : "눌러서 사업 바꾸기"}
            aria-label={`사업: ${p ? pjFull(p) : "없음"}`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {p ? <span className="pbadge-t">{pjLabel(p)}</span> : "+ 사업"}
          </button>
          {menu && (
            <ProjectMenu
              ctx={ctx}
              current={project}
              onPick={(id) => {
                setProject(id);
                setMenu(false);
              }}
              onClose={() => setMenu(false)}
            />
          )}
        </span>
        )}
      </div>
      <div className="jnew-main">
        {memo ? (
          <MemoEditor initial={body} editorRef={editorRef} placeholder="메모 내용" onChange={setBody} onSubmit={() => save()} onCancel={onCancel} />
        ) : (
        <>
        <div className="jnew-top">
          <WhoInput
            className="cell-input"
            placeholder="상대"
            value={who}
            contacts={ctx.contacts}
            onChange={setWho}
            onPick={(v) => {
              setWho(v);
              fill(v, kind);
            }}
          />
          <PhoneInput
            aria-label="연락처"
            placeholder="연락처"
            data-ime={expandKind(kind, ctx.kinds).includes("메일") ? "en" : undefined}
            className="cell-input num jedit-tel"
            value={tel}
            onChange={setTel}
          />
        </div>
        <div className="jlines-in">
          {lines.map((l, i) => (
            <div key={i} className="jline-in">
              <SpeakerButton
                s={l}
                onClick={() => {
                  const n = nextOf(l);
                  const next = lines.map((x) => ({ ...x }));
                  next[i] = { ...next[i], who: n.who, me: n.me };
                  setLines(next);
                  setFocus(i);
                }}
              />
              <textarea
                data-eline={i}
                rows={1}
                aria-label={`${l.me ? "내" : l.who + "의"} 말`}
                className="cell-input jtalk"
                value={l.t}
                onFocus={() => setFocus(i)}
                onChange={(ev) => {
                  const next = lines.map((x) => ({ ...x }));
                  next[i].t = ev.target.value;
                  setLines(next);
                }}
              />
            </div>
          ))}
        </div>
        </>
        )}
        {asking ? (
          <AskBand className="jask" label="기록 지우기 확인" text="이 기록을 지울까요?" onNo={() => setAsking(false)} onYes={onRemove} />
        ) : (
          <div className="jedit-foot">
            {/* 지우기는 맨 왼쪽, 취소·저장은 오른쪽 끝(2026-10-26 사용자 – 저장 옆 바깥에 있으면 잘못 누르기 쉬워요) */}
            <button type="button" className="tool-box jtrash del-btn" aria-label="이 기록 지우기" title="이 기록 지우기" onClick={() => setAsking(true)}>
              <DelGlyph />
            </button>
            {memo ? (
              <span className="hint">Tab 저장 · Esc 취소</span>
            ) : (
              <span className="hint" title="Enter 다음 말 · Shift+Enter 같은 사람 · Alt+Enter 한 말 안 줄 바꿈 · Tab 저장 · Esc 취소">
                Enter 다음 말 · Tab 저장 · Esc 취소
              </span>
            )}
            <button type="button" className="btn btn-xs" onClick={onCancel}>
              취소
            </button>
            <button type="button" className="btn-primary btn-xs" onClick={() => save()}>
              저장
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 검색 결과 ----------

function SearchResults({
  entries,
  q,
  raw,
  onlyHits,
  ctx,
  onToggle,
  onClose,
  onGo,
}: {
  entries: Entry[];
  q: string;
  raw: string;
  onlyHits: boolean;
  ctx: Ctx;
  onToggle: () => void;
  onClose: () => void;
  onGo: (date: string) => void;
}) {
  const groups: { date: string; items: { e: Entry; m: boolean[] }[] }[] = [];
  for (const e of entries) {
    const m = matchEntry(e, q);
    if (!m.hit) continue;
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push({ e, m: m.lines });
    else groups.push({ date: e.date, items: [{ e, m: m.lines }] });
  }
  const total = groups.reduce((a, g) => a + g.items.length, 0);

  let body: ReactNode;
  if (!total) body = <p className="muted jsearch-none">일치하는 기록이 없어요.</p>;
  else
    body = groups.map((g) => (
      <section key={g.date} className="jsearch-day" aria-label={dayTitle(g.date)}>
        <div className="jsearch-date">
          <button type="button" className="jsearch-go" title="이 날짜의 일지로 이동" onClick={() => onGo(g.date)}>
            {dayTitle(g.date)}
            <span className="jsearch-arrow">이 날짜로 이동 →</span>
          </button>
          <span className="muted small">{g.items.length}건</span>
        </div>
        <CardCols mode="balance" relayout={`${q}|${onlyHits}`}>
          {g.items.map(({ e, m }) => {
            const { name, rest } = splitWho(e.who);
            const anyLine = m.some(Boolean);
            const memo = isMemo(e.kind) && (!!e.body || !e.lines.length);
            return (
              <article key={e.id} className={"jcard jcard-static" + (memo ? " jcard-memo" : "")} style={memo ? undefined : stripe(e, ctx)}>
                <div className="jpillar">
                  <span className="jtime">{e.time}</span>
                  <span className="jkind">{e.kind}</span>
                </div>
                {memo ? (
                  <div className="jmain jmemo-main">
                    <MemoView html={e.body} q={q} />
                  </div>
                ) : (
                <div className="jmain">
                  <div className="jhead">
                    <span className="jname">
                      <Hl text={name || "상대 없음"} q={q} />
                    </span>
                    {rest && (
                      <span className="jrest">
                        <Hl text={rest} q={q} />
                      </span>
                    )}
                    {e.contact && (
                      <span className="jhead-tel">
                        <Hl text={e.contact} q={q} />
                      </span>
                    )}
                  </div>
                  <Lines entry={e} q={q} show={onlyHits && anyLine ? m : undefined} dim={!onlyHits && anyLine ? m.map((x) => !x) : undefined} />
                </div>
                )}
              </article>
            );
          })}
        </CardCols>
      </section>
    ));

  return (
    <div className="jsearch">
      <div className="jsearch-bar">
        <span className="jsearch-title">"{raw}" 검색 결과</span>
        <span className="muted small">
          {groups.length}일 · 기록 {total}건
        </span>
        <button type="button" className="jonly" aria-pressed={onlyHits} onClick={onToggle}>
          해당하는 말만 보기
        </button>
        <button type="button" className="btn btn-xs" onClick={onClose}>
          검색 닫기
        </button>
      </div>
      {body}
    </div>
  );
}
