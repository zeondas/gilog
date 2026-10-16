// 캘린더 (8단계). 시안: Calendar.dc.html, 사양서 "캘린더".
// - 월 달력 하나가 화면을 채워요(주·일 보기는 없어요). 그 달의 주 수에 맞춰 칸 높이를 나누고, 칸에 다 못 그리면 "+N개".
// - 달력 위 빠른 입력 줄: 날짜 → 시작 → 종료 → 일정 → 종류. 아무 칸에서 Enter, 종류 칸에서 Tab이면 등록. 시작을 비우면 종일.
// - "상세 입력"이나 달력의 내 일정을 누르면 상세 창: 제목, 일시·종일, 반복(종료일 필수), 장소, 설명(머릿기호), 종류, 알림.
// - 민원 마감·할 일 마감은 저장하지 않고 민원대장·할 일 목록을 읽어 그려요. 누르면 원래 화면의 그 항목으로 가요.
// - 공휴일은 칸 위쪽에 빨간 글자로 보여요(앱이 인터넷에서 받아 저장해 둔 것).
// - 왼쪽: 종류 체크(보이기·숨기기), "관리"(색 24가지·새 종류·지우기), "다가오는 7일".
import { KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, CalEvent, CalKind, CalendarData, Complaint, errorText, EventInput, Repeat, Task } from "./api";
import { BLine, parseLines, stringifyLines } from "./bullets";
import { BulletEditor } from "./BulletParts";
import {
  addDays, colorBg, colorFg, COLOR_NAMES, diffDays, expand, hourLater, kindColor, layoutWeek, longDay, monthGrid, Occ, occMatches,
  parseTime, REMIND_LABELS, REPEAT_LABELS, shortDay, Source, weekday,
} from "./calendar";
import { Hl } from "./ContactsScreen";
import { parseDate, todayStr } from "./journal";
import { ChoiceInput } from "./PlaceInputs";
import { refreshHolidaysDaily, stamp, syncReminders } from "./reminders";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;
const plainEnter = (e: KeyboardEvent) => e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

/** 알림을 누르거나 다른 화면에서 이 일정을 열 때 */
export type EventFocus = { event: number; date: string };

type Props = {
  focus?: EventFocus | null;
  onFocused?: () => void;
  onOpenComplaint?: (id: number) => void;
  onOpenTask?: (id: number) => void;
};

/** 상세 창이 고치는 값 (날짜·시각은 친 글자 그대로) */
type Draft = {
  id: number | null;
  title: string;
  kind: string;
  date: string;
  end: string;
  allDay: boolean;
  time: string;
  endTime: string;
  repeat: Repeat;
  until: string;
  place: string;
  desc: BLine[];
  remind: number;
};

type Bad = Partial<Record<"title" | "date" | "end" | "time" | "endTime" | "until", true>>;

/** 상세 창의 값을 저장할 값으로 바꿔요. 틀린 칸이 있으면 그 칸들을 돌려줘요. */
function toInput(d: Draft): { input: EventInput | null; bad: Bad } {
  const bad: Bad = {};
  const date = parseDate(d.date);
  const end = d.end.trim() ? parseDate(d.end) : date;
  const time = d.allDay ? "" : parseTime(d.time);
  const endTime = d.allDay ? "" : d.endTime.trim() ? parseTime(d.endTime) : time ? hourLater(time) : "";
  const until = d.repeat ? parseDate(d.until) : "";
  if (!d.title.trim()) bad.title = true;
  if (!date) bad.date = true;
  if (!end || (date && end < date)) bad.end = true;
  if (!d.allDay && !time) bad.time = true;
  if (!d.allDay && endTime === null) bad.endTime = true;
  if (!d.allDay && time && endTime && date === end && endTime < time) bad.endTime = true;
  if (d.repeat && (!until || (date && until < date))) bad.until = true;
  if (Object.keys(bad).length) return { input: null, bad };
  return {
    input: {
      title: d.title,
      kind: d.kind,
      date: date!,
      end: end!,
      allDay: d.allDay,
      time: time || "",
      endTime: endTime || "",
      repeat: d.repeat,
      until: until || "",
      place: d.place,
      desc: stringifyLines(d.desc),
      remind: d.remind,
    },
    bad,
  };
}

function draftOf(e: CalEvent, kinds: CalKind[]): Draft {
  return {
    id: e.id,
    title: e.title,
    kind: kinds.find((k) => k.id === e.kind)?.name ?? "",
    date: e.date,
    end: e.end,
    allDay: e.allDay,
    time: e.time,
    endTime: e.endTime,
    repeat: e.repeat,
    until: e.until,
    place: e.place,
    desc: parseLines(e.desc),
    remind: e.remind,
  };
}

const firstKind = (kinds: CalKind[]) => kinds.find((k) => !k.system)?.name ?? "";

export default function CalendarScreen({ focus, onFocused, onOpenComplaint, onOpenTask }: Props) {
  const [data, setData] = useState<CalendarData | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [today, setToday] = useState(todayStr());
  const [ym, setYm] = useState<[number, number]>(() => [new Date().getFullYear(), new Date().getMonth()]);
  const [sel, setSel] = useState(todayStr());
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [ed, setEd] = useState<Draft | null>(null);
  const [kindsOpen, setKindsOpen] = useState(false);
  /** "+N개"를 눌러 펼친 날 */
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [holidayNote, setHolidayNote] = useState("");

  const load = useCallback(() => {
    api.calendarData().then(setData, (e) => setNote(errorText(e)));
  }, []);

  useEffect(() => {
    load();
    api.complaints().then(setComplaints, () => {});
    api.tasksData().then((d) => setTasks(d.tasks), () => {});
    // 오늘 받은 적이 없으면 공휴일을 새로 받아 와요.
    refreshHolidaysDaily().then((got) => got && load());
  }, [load]);

  // 자정을 넘기면 "오늘"을 바꿔요.
  useEffect(() => {
    const t = window.setInterval(() => setToday(todayStr()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // 알림을 누르면 그 일정이 있는 달로 가서 상세 창을 열어요.
  useEffect(() => {
    if (!focus || !data) return;
    const e = data.events.find((x) => x.id === focus.event);
    setYm([Number(focus.date.slice(0, 4)), Number(focus.date.slice(5, 7)) - 1]);
    setSel(focus.date);
    if (e) setEd(draftOf(e, data.kinds));
    onFocused?.();
  }, [focus, data, onFocused]);

  const run = useCallback(async <T,>(p: Promise<T>, msg?: string): Promise<T | null> => {
    try {
      const r = await p;
      setNote("");
      return r;
    } catch (e) {
      setNote(e === "invalid" && msg ? msg : errorText(e));
      return null;
    }
  }, []);

  /** 일정이 바뀌면 종류(새로 생겼을 수 있어요)를 다시 읽고 알림 목록을 다시 보내요. */
  const afterChange = useCallback(async () => {
    const kinds = await api.calKinds().catch(() => null);
    if (kinds) setData((d) => (d ? { ...d, kinds } : d));
    syncReminders();
  }, []);

  async function addEvent(input: EventInput): Promise<boolean> {
    const e = await run(api.addEvent(input), "넣은 값을 확인해 주세요. (앱이 만드는 종류에는 일정을 적을 수 없어요)");
    if (!e) return false;
    setData((d) => (d ? { ...d, events: [...d.events, e] } : d));
    await afterChange();
    return true;
  }

  async function saveEvent(id: number, input: EventInput): Promise<boolean> {
    const e = await run(api.updateEvent(id, input), "넣은 값을 확인해 주세요. (앱이 만드는 종류에는 일정을 적을 수 없어요)");
    if (!e) return false;
    setData((d) => (d ? { ...d, events: d.events.map((x) => (x.id === id ? e : x)) } : d));
    await afterChange();
    return true;
  }

  async function removeEvent(id: number) {
    // 지우기는 성공해도 null을 돌려주니, 실패는 따로 받아요.
    if ((await run(api.deleteEvent(id).then(() => true))) === null) return;
    setData((d) => (d ? { ...d, events: d.events.filter((x) => x.id !== id) } : d));
    setEd(null);
    syncReminders();
  }

  const lq = q.trim().toLowerCase();
  const { start, weeks } = monthGrid(ym[0], ym[1]);
  const gridEnd = addDays(start, weeks * 7 - 1);

  const src: Source | null = useMemo(
    () => (data ? { kinds: data.kinds, events: data.events, holidays: data.holidays, complaints, tasks } : null),
    [data, complaints, tasks],
  );
  const hidden = useMemo(() => new Set(data?.kinds.filter((k) => !k.visible).map((k) => k.id) ?? []), [data]);
  const occs = useMemo(
    () => (src ? expand(src, start, gridEnd).filter((o) => !hidden.has(o.kind.id) && (o.kind.system === "holiday" || occMatches(o, lq))) : []),
    [src, start, gridEnd, hidden, lq],
  );
  const upcoming = useMemo(() => {
    if (!src) return [];
    const to = addDays(today, 6);
    return expand(src, today, to)
      .filter((o) => !hidden.has(o.kind.id) && o.kind.system !== "holiday" && !o.done)
      .map((o) => ({ ...o, day: o.start < today ? today : o.start }))
      .sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : (a.allDay ? "" : a.time) < (b.allDay ? "" : b.time) ? -1 : 1));
  }, [src, today, hidden]);

  // 칸 높이와 그 안에 놓을 수 있는 줄 수 (창 높이를 주 수로 나눠요)
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const cellH = Math.max(110, Math.floor((vh - 252) / weeks));
  const lanes = Math.max(2, Math.floor((cellH - 34) / 24));

  if (!data) {
    return (
      <>
        <h1 className="title">캘린더</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  const move = (n: number) => {
    const d = new Date(ym[0], ym[1] + n, 1);
    setYm([d.getFullYear(), d.getMonth()]);
  };
  const goDay = (d: string) => {
    setSel(d);
    setYm([Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1]);
  };

  function openOcc(o: Occ) {
    if (o.event) setEd(draftOf(o.event, data!.kinds));
    else if (o.complaint) onOpenComplaint?.(o.complaint.id);
    else if (o.task) onOpenTask?.(o.task.id);
  }

  const holidaysOf = new Map<string, string[]>();
  if (!hidden.has(data.kinds.find((k) => k.system === "holiday")?.id ?? -1)) {
    for (const o of occs) if (o.kind.system === "holiday") holidaysOf.set(o.start, [...(holidaysOf.get(o.start) ?? []), o.title]);
  }
  const shownCount = occs.filter((o) => o.kind.system !== "holiday" && o.end >= `${ym[0]}-${String(ym[1] + 1).padStart(2, "0")}-01` && o.start.slice(0, 7) <= `${ym[0]}-${String(ym[1] + 1).padStart(2, "0")}`).length;
  const holidayLine = data.holidaysAt ? `공휴일은 ${data.holidaysAt.slice(5).replace("-", "/")}에 받았어요` : "공휴일은 앱에 넣어 온 목록(2027년까지)이에요";

  return (
    <div className="cal-screen">
      <aside className="cal-side">
        <div className="cal-kinds">
          <div className="cal-side-head">
            <span>캘린더 종류</span>
            <button type="button" className="btn btn-xs cal-manage" onClick={() => setKindsOpen(true)}>
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
              </svg>
              관리
            </button>
          </div>
          {data.kinds.map((k) => {
            const c = kindColor(k, data.kinds);
            return (
              <button
                key={k.id}
                type="button"
                className="cal-kind"
                aria-pressed={k.visible}
                onClick={() => run(api.setCalKindVisible(k.id, !k.visible)).then((r) => r && setData((d) => (d ? { ...d, kinds: r } : d)))}
              >
                <span className="cal-kind-box" aria-hidden="true" style={{ borderColor: colorBg(c), background: k.visible ? colorBg(c) : undefined, color: colorFg(c) }}>
                  {k.visible && <Tick />}
                </span>
                <span className="cal-kind-name">{k.name}</span>
                {k.system && <span className="cal-kind-note">{k.system === "complaint" ? "민원대장" : k.system === "task" ? "할 일 목록" : "자동"}</span>}
              </button>
            );
          })}
        </div>
        <div className="cal-upcoming">
          <div className="cal-side-head">
            <span>다가오는 7일</span>
          </div>
          {upcoming.length ? (
            upcoming.slice(0, 12).map((o) => (
              <button key={o.key + o.day} type="button" className="cal-up" onClick={() => (goDay(o.day), openOcc(o))}>
                <span className="cal-up-dot" aria-hidden="true" style={{ background: colorBg(o.color) }} />
                <span className="cal-up-text">
                  <span className="cal-up-title">{o.title}</span>
                  <span className="cal-up-when">
                    {shortDay(o.day)}
                    {o.allDay ? "" : " " + o.time} · {o.kind.name}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="cal-up-empty">일주일 안에 일정이 없어요.</p>
          )}
          {upcoming.length > 12 && <p className="cal-up-empty">외 {upcoming.length - 12}건</p>}
        </div>
      </aside>

      <div className="cal-body">
        <div className="cal-head">
          <h1 className="title cal-month">
            {ym[0]}년 {ym[1] + 1}월
          </h1>
          <div className="cal-nav">
            <button type="button" className="btn btn-ctrl cal-navbtn" aria-label="이전 달" onClick={() => move(-1)}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <button type="button" className="btn btn-ctrl" onClick={() => goDay(today)}>
              오늘
            </button>
            <button type="button" className="btn btn-ctrl cal-navbtn" aria-label="다음 달" onClick={() => move(1)}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <label className="search">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input type="search" aria-label="일정 검색" placeholder="일정 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {note && <p className="note" role="status">{note}</p>}

        <QuickRow
          sel={sel}
          kinds={data.kinds}
          onSel={(d) => goDay(d)}
          onAdd={addEvent}
          onDetail={(d) => setEd(d)}
        />

        <div className="cal-grid" role="grid" aria-label={`${ym[0]}년 ${ym[1] + 1}월 달력`}>
          <div className="cal-dow" role="row">
            {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
              <div key={w} role="columnheader" className={i === 0 ? "sun" : i === 6 ? "sat" : undefined}>
                {w}
              </div>
            ))}
          </div>
          {Array.from({ length: weeks }, (_, wi) => {
            const ws = addDays(start, wi * 7);
            const { placed, more } = layoutWeek(occs, ws, lanes);
            return (
              <div key={ws} className="cal-week" role="row" style={{ minHeight: cellH, gridTemplateRows: `30px repeat(${lanes}, 24px) 1fr` }}>
                {Array.from({ length: 7 }, (_, i) => {
                  const d = addDays(ws, i);
                  const inMonth = Number(d.slice(5, 7)) - 1 === ym[1];
                  const hol = holidaysOf.get(d);
                  const dow = weekday(d);
                  const cls = ["cal-day", inMonth ? "" : "out", d === sel ? "sel" : "", d === today ? "today" : "", dow === 0 || hol ? "red" : dow === 6 ? "blue" : ""]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <div
                      key={d}
                      role="gridcell"
                      aria-label={longDay(d) + (hol ? " " + hol.join(", ") : "")}
                      aria-selected={d === sel}
                      className={cls}
                      style={{ gridColumn: i + 1 }}
                      onClick={() => setSel(d)}
                      onDoubleClick={() => setEd(blankDraft(d, data.kinds))}
                    >
                      <div className="cal-dhead">
                        <span className="cal-num">{d.slice(8) === "01" ? `${Number(d.slice(5, 7))}/1` : Number(d.slice(8))}</span>
                        {hol && (
                          <span className="cal-hol" title={hol.join(", ")}>
                            {hol.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {placed.map((p) => (
                  <EventChip key={p.occ.key + ws} p={p} q={lq} onOpen={() => openOcc(p.occ)} />
                ))}
                {more.map((n, i) =>
                  n ? (
                    <button
                      key={"m" + i}
                      type="button"
                      className="cal-more"
                      style={{ gridColumn: i + 1, gridRow: lanes + 1 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSel(addDays(ws, i));
                        setDayOpen(addDays(ws, i));
                      }}
                    >
                      +{n}개
                    </button>
                  ) : null,
                )}
              </div>
            );
          })}
        </div>
        <div className="cal-summary">
          {weeks}주 달력 · 이번 달 일정 {shownCount}건{lq ? " (검색 중)" : ""} · ↻는 반복 일정 · 칸을 두 번 누르면 그 날 일정 상세 입력 · {holidayLine}
          {holidayNote && ` · ${holidayNote}`}
        </div>
      </div>

      {ed && (
        <EventDialog
          draft={ed}
          kinds={data.kinds}
          onChange={setEd}
          onSave={async (input) => (ed.id === null ? addEvent(input) : saveEvent(ed.id, input)).then((ok) => (ok && setEd(null), ok))}
          onDelete={() => ed.id !== null && removeEvent(ed.id)}
          onClose={() => setEd(null)}
        />
      )}
      {dayOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setDayOpen(null)}>
          <div className="dialog cal-daydlg" role="dialog" aria-modal="true" aria-label={longDay(dayOpen) + " 일정"} onKeyDown={(e) => e.key === "Escape" && setDayOpen(null)}>
            <div className="dialog-head">
              <span className="dialog-title">{longDay(dayOpen)}</span>
              {holidaysOf.get(dayOpen) && <span className="cal-hol">{holidaysOf.get(dayOpen)!.join(", ")}</span>}
            </div>
            <div className="dialog-body cal-daylist">
              {occs
                .filter((o) => o.kind.system !== "holiday" && o.start <= dayOpen && o.end >= dayOpen)
                .sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
                .map((o, i) => (
                  <EventChip
                    key={o.key}
                    p={{ occ: o, col: 0, span: 1, lane: i, cutStart: false, cutEnd: false }}
                    q={lq}
                    onOpen={() => {
                      setDayOpen(null);
                      openOcc(o);
                    }}
                  />
                ))}
            </div>
            <div className="dialog-foot">
              <button
                type="button"
                className="btn btn-ctrl cal-cancel"
                onClick={() => {
                  const d = dayOpen;
                  setDayOpen(null);
                  setEd(blankDraft(d, data.kinds));
                }}
              >
                이 날 일정 추가
              </button>
              <button type="button" className="btn-primary btn-ctrl" autoFocus onClick={() => setDayOpen(null)}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
      {kindsOpen && (
        <KindsDialog
          data={data}
          onKinds={(kinds) => setData((d) => (d ? { ...d, kinds } : d))}
          onDeleted={(id) => {
            setData((d) => (d ? { ...d, kinds: d.kinds.filter((k) => k.id !== id), events: d.events.filter((e) => e.kind !== id) } : d));
            syncReminders();
          }}
          run={run}
          holidayLine={holidayLine}
          onRefreshHolidays={async () => {
            setHolidayNote("공휴일을 받는 중…");
            try {
              await api.refreshHolidays(stamp());
              setHolidayNote("");
              load();
            } catch (e) {
              setHolidayNote(errorText(e) + " 저장해 둔 공휴일을 그대로 보여 줘요.");
            }
          }}
          onClose={() => setKindsOpen(false)}
        />
      )}
    </div>
  );
}

function blankDraft(date: string, kinds: CalKind[]): Draft {
  return { id: null, title: "", kind: firstKind(kinds), date, end: "", allDay: true, time: "", endTime: "", repeat: "", until: "", place: "", desc: [], remind: -1 };
}

// ---------- 달력의 일정 하나 ----------

function EventChip({ p, q, onOpen }: { p: ReturnType<typeof layoutWeek>["placed"][number]; q: string; onOpen: () => void }) {
  const o = p.occ;
  const bar = o.allDay;
  const when = o.allDay ? (o.start !== o.end ? `${shortDay(o.start)}~${shortDay(o.end)}` : "종일") : `${o.time}–${o.endTime}`;
  const full = [when, o.title, o.kind.name, o.place].filter(Boolean).join(" · ") + (o.done ? " · 완료" : "") + (o.event ? "" : " · 누르면 원래 화면으로 가요");
  const cls = ["cal-ev", bar ? "bar" : "dot", p.cutStart ? "cut-s" : "", p.cutEnd ? "cut-e" : "", o.done ? "done" : "", o.event ? "" : "linked"].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={cls}
      title={full}
      aria-label={full}
      style={{
        gridColumn: `${p.col + 1} / span ${p.span}`,
        gridRow: p.lane + 2,
        background: bar ? colorBg(o.color) : undefined,
        color: bar ? colorFg(o.color) : undefined,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {!bar && <span className="cal-ev-dot" aria-hidden="true" style={{ background: colorBg(o.color) }} />}
      {!bar && <span className="cal-ev-time">{o.time}</span>}
      <span className="cal-ev-title">
        <Hl text={o.title} q={q} />
      </span>
      {o.repeat && (
        <span className="cal-ev-mark" aria-hidden="true">
          ↻
        </span>
      )}
    </button>
  );
}

// ---------- 빠른 입력 줄 ----------

function QuickRow({
  sel,
  kinds,
  onSel,
  onAdd,
  onDetail,
}: {
  sel: string;
  kinds: CalKind[];
  onSel: (d: string) => void;
  onAdd: (i: EventInput) => Promise<boolean>;
  onDetail: (d: Draft) => void;
}) {
  const [date, setDate] = useState(sel);
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState(firstKind(kinds));
  const [bad, setBad] = useState<"date" | "time" | "endTime" | "title" | "">("");
  const row = useRef<HTMLDivElement>(null);
  const focus = (n: string) => {
    const el = row.current?.querySelector<HTMLInputElement>(`[name="${n}"]`);
    el?.focus();
    el?.select();
  };

  // 달력에서 날을 고르면 날짜 칸이 따라가요.
  useEffect(() => {
    setDate(sel);
    if (bad === "date") setBad("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  // 화면을 열면 첫 칸(날짜)에 커서가 가요.
  useEffect(() => {
    focus("date");
  }, []);

  function draft(): Draft {
    const t = parseTime(time) ?? "";
    return {
      ...blankDraft(parseDate(date) ?? date, kinds),
      title,
      kind: kind.trim() || firstKind(kinds),
      allDay: !t,
      time: t,
      endTime: parseTime(endTime) ?? (t ? hourLater(t) : ""),
      remind: t ? 10 : -1,
    };
  }

  async function submit() {
    const d = parseDate(date);
    if (!d) return setBad("date"), focus("date");
    const t = time.trim() ? parseTime(time) : "";
    if (t === null) return setBad("time"), focus("time");
    const et = endTime.trim() ? parseTime(endTime) : "";
    if (et === null || (t && et && et < t)) return setBad("endTime"), focus("endTime");
    if (!t && et) return setBad("time"), focus("time");
    if (!title.trim()) return setBad("title"), focus("title");
    setBad("");
    const ok = await onAdd({
      title,
      kind: kind.trim() || firstKind(kinds),
      date: d,
      end: d,
      allDay: !t,
      time: t,
      endTime: et || (t ? hourLater(t) : ""),
      repeat: "",
      until: "",
      place: "",
      desc: "",
      remind: t ? 10 : -1,
    });
    if (!ok) return;
    setTime("");
    setEndTime("");
    setTitle("");
    onSel(d);
    focus("date");
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (isComposing(e)) return;
    const name = (e.target as HTMLInputElement).name;
    const lastTab = e.key === "Tab" && !e.shiftKey && name === "kind";
    if (!e.defaultPrevented && (plainEnter(e) || (lastTab && title.trim()))) {
      e.preventDefault();
      submit();
    }
  }

  const fix = (v: string, set: (s: string) => void) => {
    const t = parseTime(v);
    if (t) set(t);
  };

  return (
    <div className="cal-quick" role="row" ref={row} onKeyDown={onKeyDown}>
      <input
        name="date"
        aria-label="날짜"
        className={"cell-input num" + (bad === "date" ? " invalid" : "")}
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          if (bad === "date") setBad("");
        }}
        onBlur={() => {
          const d = parseDate(date);
          if (d) {
            setDate(d);
            if (d !== sel) onSel(d);
          }
        }}
      />
      <input
        name="time"
        aria-label="시작 시간"
        placeholder="시작"
        inputMode="numeric"
        className={"cell-input num" + (bad === "time" ? " invalid" : "")}
        value={time}
        onChange={(e) => {
          setTime(e.target.value);
          if (bad === "time") setBad("");
        }}
        onBlur={() => fix(time, setTime)}
      />
      <input
        name="endTime"
        aria-label="종료 시간"
        placeholder="종료"
        inputMode="numeric"
        className={"cell-input num" + (bad === "endTime" ? " invalid" : "")}
        value={endTime}
        onChange={(e) => {
          setEndTime(e.target.value);
          if (bad === "endTime") setBad("");
        }}
        onBlur={() => fix(endTime, setEndTime)}
      />
      <input
        name="title"
        aria-label="일정"
        placeholder="일정을 입력하고 Enter (시간을 비우면 종일 일정)"
        className={"cell-input" + (bad === "title" ? " invalid" : "")}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (bad === "title") setBad("");
        }}
      />
      <ChoiceInput name="kind" label="종류" value={kind} options={kinds.filter((k) => !k.system).map((k) => k.name)} stayOnTab onChange={setKind} />
      <button
        type="button"
        tabIndex={-1}
        className="btn cal-detail-btn"
        onClick={() => {
          // 적던 것은 상세 창으로 옮겨 가요(날짜·종류는 남겨 둬요).
          onDetail(draft());
          setTime("");
          setEndTime("");
          setTitle("");
          setBad("");
        }}
      >
        상세 입력
      </button>
      <button type="button" className="btn-icon cal-add" aria-label="일정 등록" title="일정 등록" onClick={submit}>
        <Plus />
      </button>
    </div>
  );
}

// ---------- 상세 창 ----------

function EventDialog({
  draft,
  kinds,
  onChange,
  onSave,
  onDelete,
  onClose,
}: {
  draft: Draft;
  kinds: CalKind[];
  onChange: (d: Draft) => void;
  onSave: (i: EventInput) => Promise<boolean>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [bad, setBad] = useState<Bad>({});
  const [asking, setAsking] = useState(false);
  const start = useRef(JSON.stringify(draft));
  const titleRef = useRef<HTMLInputElement>(null);
  /** 마지막으로 맞게 적은 시작 날짜 (끝 날짜를 같이 옮길 때 써요) */
  const prevDate = useRef(parseDate(draft.date));
  const isNew = draft.id === null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    onChange({ ...draft, [k]: v });
    if (k in bad) setBad((b) => ({ ...b, [k]: undefined }));
  };

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function save() {
    const { input, bad } = toInput(draft);
    setBad(bad);
    if (!input) return;
    await onSave(input);
  }

  /** 바깥을 누르면 저장해요(사용자가 정한 규칙). 고친 것이 없으면 그냥 닫아요. */
  function outside() {
    if (JSON.stringify(draft) === start.current || (isNew && !draft.title.trim())) onClose();
    else save();
  }

  const kindObj = kinds.find((k) => k.name === draft.kind.trim());
  const kc = kindObj ? kindColor(kindObj, kinds) : null;
  const userKinds = kinds.filter((k) => !k.system).map((k) => k.name);
  const sysKind = !!kindObj?.system;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (isComposing(e)) return;
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      if (asking) setAsking(false);
      else onClose();
      return;
    }
    const t = e.target as HTMLElement;
    if (plainEnter(e) && !e.defaultPrevented && t.tagName !== "SELECT" && t.tagName !== "BUTTON") {
      e.preventDefault();
      save();
    }
  }

  const dateFix = (k: "date" | "end" | "until") => {
    const d = parseDate(draft[k]);
    if (!d) return;
    if (k !== "date") return set(k, d);
    // 시작 날짜를 옮기면 끝 날짜도 같은 만큼 옮겨요(여러 날 일정의 길이를 지켜요).
    const prev = prevDate.current;
    const end = parseDate(draft.end);
    prevDate.current = d;
    const next = { ...draft, date: d };
    if (end && prev && end >= prev) next.end = addDays(end, diffDays(prev, d));
    else if (end && end < d) next.end = d;
    onChange(next);
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && outside()}>
      <div className="dialog cal-dialog" role="dialog" aria-modal="true" aria-label="일정 상세" onKeyDown={onKeyDown}>
        <div className="cal-dlg-title">
          <input
            ref={titleRef}
            aria-label="제목"
            placeholder="제목 추가"
            className={bad.title ? "invalid" : undefined}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div className="cal-dlg-grid">
          <span className="cal-dlg-label">일시</span>
          <div className="cal-dlg-line">
            <input aria-label="시작 날짜" className={"cell-input num cal-in-date" + (bad.date ? " invalid" : "")} value={draft.date} onChange={(e) => set("date", e.target.value)} onBlur={() => dateFix("date")} />
            {!draft.allDay && (
              <input
                aria-label="시작 시간"
                placeholder="시작"
                className={"cell-input num cal-in-time" + (bad.time ? " invalid" : "")}
                value={draft.time}
                onChange={(e) => set("time", e.target.value)}
                onBlur={() => {
                  const t = parseTime(draft.time);
                  if (t) onChange({ ...draft, time: t, endTime: draft.endTime.trim() ? draft.endTime : hourLater(t) });
                }}
              />
            )}
            <span className="muted" aria-hidden="true">
              –
            </span>
            {!draft.allDay && (
              <input
                aria-label="종료 시간"
                placeholder="종료"
                className={"cell-input num cal-in-time" + (bad.endTime ? " invalid" : "")}
                value={draft.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                onBlur={() => {
                  const t = parseTime(draft.endTime);
                  if (t) set("endTime", t);
                }}
              />
            )}
            <input
              aria-label="종료 날짜"
              placeholder={draft.date}
              className={"cell-input num cal-in-date" + (bad.end ? " invalid" : "")}
              value={draft.end}
              onChange={(e) => set("end", e.target.value)}
              onBlur={() => dateFix("end")}
            />
            <button
              type="button"
              className="btn cal-allday"
              aria-pressed={draft.allDay}
              onClick={() =>
                onChange(
                  draft.allDay
                    ? { ...draft, allDay: false, time: draft.time || "09:00", endTime: draft.endTime || "10:00", remind: draft.remind < 0 ? 10 : draft.remind }
                    : { ...draft, allDay: true },
                )
              }
            >
              종일
            </button>
          </div>

          <span className="cal-dlg-label">반복</span>
          <div className="cal-dlg-line">
            <select aria-label="반복" className="cal-select" value={draft.repeat} onChange={(e) => set("repeat", e.target.value as Repeat)}>
              {REPEAT_LABELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {draft.repeat && (
              <>
                <span className="cal-dlg-sub">종료일</span>
                <input
                  aria-label="반복 종료일"
                  placeholder="날짜 (필수)"
                  className={"cell-input num cal-in-date" + (bad.until || !draft.until.trim() ? " invalid" : "")}
                  value={draft.until}
                  onChange={(e) => set("until", e.target.value)}
                  onBlur={() => dateFix("until")}
                />
                {!draft.until.trim() && <span className="cal-dlg-sub">종료일을 넣어야 저장돼요</span>}
              </>
            )}
          </div>

          <span className="cal-dlg-label">장소</span>
          <input aria-label="장소" placeholder="장소 추가" className="cell-input" value={draft.place} onChange={(e) => set("place", e.target.value)} />

          <span className="cal-dlg-label top">설명</span>
          <div className="cal-desc">
            <BulletEditor lines={draft.desc} onChange={(v) => set("desc", v)} name="desc" label="설명" placeholder="설명 추가 (Shift+Enter로 줄 추가)" />
          </div>

          <span className="cal-dlg-label">캘린더</span>
          <div className="cal-dlg-line">
            <div className="cal-in-kind">
              <ChoiceInput name="kind" label="종류" value={draft.kind} options={userKinds} invalid={sysKind} onChange={(v) => set("kind", v)} />
            </div>
            {kc !== null && <span className="cal-kind-swatch" aria-hidden="true" style={{ background: colorBg(kc) }} />}
            <span className="cal-dlg-sub">{sysKind ? "앱이 만드는 종류에는 적을 수 없어요" : !kindObj && draft.kind.trim() ? "새 종류로 만들어져요" : ""}</span>
          </div>

          <span className="cal-dlg-label">알림</span>
          <div className="cal-dlg-line">
            <select aria-label="알림" className="cal-select" value={draft.remind} onChange={(e) => set("remind", Number(e.target.value))}>
              {REMIND_LABELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {draft.allDay && draft.remind >= 0 && <span className="cal-dlg-sub">종일 일정은 오전 9시 기준이에요</span>}
          </div>
        </div>
        {asking && (
          <div className="ask-band cal-ask" role="alertdialog" aria-label="일정 지우기 확인">
            <span>{draft.repeat ? "반복 일정 전체를 지울까요?" : "이 일정을 지울까요?"}</span>
            <button type="button" className="btn btn-xs" autoFocus onClick={() => setAsking(false)}>
              취소
            </button>
            <button type="button" className="btn btn-danger btn-xs" onClick={onDelete}>
              지우기
            </button>
          </div>
        )}
        <div className="dialog-foot cal-dlg-foot">
          {!isNew && (
            <button type="button" className="tool-box cal-trash" aria-label="일정 삭제" title="일정 삭제" onClick={() => setAsking(true)}>
              <Trash />
            </button>
          )}
          {draft.repeat && !isNew && <span className="cal-dlg-sub">반복 일정은 모든 회차가 함께 바뀌어요</span>}
          <button type="button" className="btn btn-ctrl cal-cancel" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn-primary btn-ctrl" onClick={save}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 종류 관리 창 ----------

function KindsDialog({
  data,
  onKinds,
  onDeleted,
  run,
  holidayLine,
  onRefreshHolidays,
  onClose,
}: {
  data: CalendarData;
  onKinds: (k: CalKind[]) => void;
  onDeleted: (id: number) => void;
  run: <T>(p: Promise<T>, msg?: string) => Promise<T | null>;
  holidayLine: string;
  onRefreshHolidays: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [asking, setAsking] = useState<number | null>(null);
  const mine = data.kinds.filter((k) => !k.system);
  const sys = data.kinds.filter((k) => k.system);
  const count = (id: number) => data.events.filter((e) => e.kind === id).length;

  async function add() {
    if (!name.trim()) return;
    const r = await run(api.addCalKind(name), "종류 이름이 비었거나 같은 이름의 종류가 있어요.");
    if (r) {
      onKinds(r);
      setName("");
    }
  }

  const row = (k: CalKind, extra: ReactNode) => {
    const c = kindColor(k, data.kinds);
    return (
      <div key={k.id} className="prow cal-krow">
        <div className="prow-name cal-krow-name">
          <span className="cal-kbadge" style={{ background: colorBg(c), color: colorFg(c) }}>
            {k.name}
          </span>
          <span className="hint">
            {COLOR_NAMES[c]}
            {k.color === null ? " (자동)" : ""} · {extra}
          </span>
        </div>
        <div className="swatches cal-swatches" role="radiogroup" aria-label={k.name + " 색"}>
          {COLOR_NAMES.map((n, i) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={i === c}
              aria-label={`${k.name} 색: ${n}`}
              title={n}
              className="swatch"
              style={{ background: colorBg(i), color: colorBg(i) }}
              onClick={() => run(api.setCalKindColor(k.id, i)).then((r) => r && onKinds(r))}
            />
          ))}
        </div>
        <button type="button" className="btn btn-xs" aria-pressed={k.color === null} onClick={() => run(api.setCalKindColor(k.id, null)).then((r) => r && onKinds(r))}>
          {k.system ? "처음 색" : "자동"}
        </button>
        {!k.system && (
          <button
            type="button"
            className="tool-box"
            aria-label={k.name + " 삭제"}
            title={mine.length <= 1 ? "종류는 하나 이상 있어야 해요" : k.name + " 삭제"}
            disabled={mine.length <= 1}
            onClick={() => setAsking(k.id)}
          >
            <Trash />
          </button>
        )}
        {asking === k.id && (
          <div className="ask-band ask-wide" role="alertdialog" aria-label="종류 지우기 확인">
            <span>{count(k.id) ? `"${k.name}"과 그 일정 ${count(k.id)}건을 지울까요?` : `"${k.name}"을 지울까요?`}</span>
            <button type="button" className="btn btn-xs" autoFocus onClick={() => setAsking(null)}>
              취소
            </button>
            <button
              type="button"
              className="btn btn-danger btn-xs"
              onClick={async () => {
                const n = await run(api.deleteCalKind(k.id));
                setAsking(null);
                if (n !== null) onDeleted(k.id);
              }}
            >
              지우기
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog cal-kdialog"
        role="dialog"
        aria-modal="true"
        aria-label="캘린더 종류 관리"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !isComposing(e)) {
            e.preventDefault();
            if (asking !== null) setAsking(null);
            else onClose();
          }
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">캘린더 종류 관리</span>
          <span className="hint">색은 구글 캘린더의 24가지 색과 같은 순서예요. 자동으로 정해지고, 바꾸고 싶을 때만 고르면 돼요.</span>
        </div>
        <div className="dialog-body">
          <div className="cal-kgroup">직접 만든 종류</div>
          {mine.map((k) => row(k, count(k.id) ? `일정 ${count(k.id)}건` : "일정 없음"))}
          <div className="padd">
            <input
              aria-label="새 종류 이름"
              placeholder="새 종류 이름을 쓰고 Enter"
              className="cell-input cal-knew"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (plainEnter(e) && !isComposing(e)) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="btn-primary btn-xs" onClick={add}>
              추가
            </button>
          </div>
          <div className="cal-kgroup">자동으로 들어오는 종류 (지울 수 없고 색만 바꿔요)</div>
          {sys.map((k) =>
            row(
              k,
              k.system === "complaint" ? (
                "민원대장의 마감일에서 들어와요"
              ) : k.system === "task" ? (
                "할 일 목록의 마감일에서 들어와요"
              ) : (
                <>
                  {holidayLine}{" "}
                  <button type="button" className="link-btn" onClick={onRefreshHolidays}>
                    지금 다시 받기
                  </button>
                </>
              ),
            ),
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn-primary btn-ctrl" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 아이콘 ----------

function Tick() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Plus() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
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

