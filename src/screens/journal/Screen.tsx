// 업무일지 화면이에요. 시안 Journal.dc.html과 사양서의 "업무일지" 절을 따라요.
// 누가 언제 무슨 말을 했는지 남기는 곳이라, 손을 키보드에서 떼지 않고 한 건을 끝낼 수 있게 만들었어요.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, changeHooks, Complaint, ContactsData, DayInfo, Entry, EntryInput, errorText, JournalData, Task, TaskList, TasksData } from "../../api";
import { firstLineOf } from "../../bullets";
import { daysBetween, daysLeft, ddayText, dueSoon, isUrgent } from "../../complaints";
import { tasksDueSoon } from "../../tasks";
import { dayTitle, sortEntries, todayStr } from "../../journal";
import { ExcelMenu } from "../../ExcelMenu";
import { journalDayRows, journalImports, journalRows } from "../../excel";
import { DEFAULT_SETTINGS, Kind, loadSettings } from "../../settingsStore";
import { SearchBox } from "../../SearchBox";
import { JournalCalendar, DayHead, ViewCard, SearchResults } from "./Table";
import { NewCard, EditCard, PrintDialog } from "./Dialogs";
import { Ctx, CardCols } from "./parts";

// ---------- 화면 ----------

/** 검색 칸에 치고 이만큼 쉬면 찾아요(ms). */
const SEARCH_WAIT = 150;

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
  // 찾는 말은 치는 동안 0.15초 기다렸다 바꿔요(2026-10-30 속도 ② – 글자마다 전체를 다시 찾지 않게). 지우면 바로.
  const [sq, setSq] = useState("");
  useEffect(() => {
    if (!q.trim()) {
      setSq(q);
      return;
    }
    const t = window.setTimeout(() => setSq(q), SEARCH_WAIT);
    return () => window.clearTimeout(t);
  }, [q]);
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
    setSq("");
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

  const query = sq.trim().toLowerCase();
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
          <SearchBox className="jn-search" aria-label="일지 검색" placeholder="사람, 내용으로 전체 일지 검색" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => { setQ(""); setSq(""); }} />
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
            <SearchResults entries={data.entries} q={query} raw={sq.trim()} onlyHits={onlyHits} ctx={ctx} onToggle={() => setOnlyHits(!onlyHits)} onClose={() => { setQ(""); setSq(""); }} onGo={go} />
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
