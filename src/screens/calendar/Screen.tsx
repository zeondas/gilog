// 캘린더 (8단계). 시안: Calendar.dc.html, 사양서 "캘린더".
// - 월 달력 하나가 화면을 채워요(주·일 보기는 없어요). 그 달의 주 수에 맞춰 칸 높이를 나누고, 칸에 다 못 그리면 "+N개".
// - 달력 위 빠른 입력 줄: 날짜 → 시작 → 종료 → 일정 → 종류. 아무 칸에서 Enter, 종류 칸에서 Tab이면 등록. 시작을 비우면 종일.
// - "상세 입력"이나 달력의 내 일정을 누르면 상세 창: 제목, 일시·종일, 반복(종료일 필수), 장소, 설명(머릿기호), 종류, 알림.
// - 민원 마감·할 일 마감은 저장하지 않고 민원대장·할 일 목록을 읽어 그려요. 누르면 원래 화면의 그 항목으로 가요.
// - 공휴일은 칸 위쪽에 빨간 글자로 보여요(앱이 인터넷에서 받아 저장해 둔 것).
// - 왼쪽: 종류 체크(보이기·숨기기), "관리"(색 24가지·새 종류·지우기), "앞으로 7일"(옆 칸 일정 목록).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogX } from "../../DialogX";
import { overlayDown } from "../../useOutsideClose";
import { api, CalendarData, Complaint, errorText, EventInput, Task } from "../../api";
import {
  addDays, colorBg, colorFg, expand, hourLater, kindColor, longDay, monthGrid, Occ, occMatches, shortDay, Source, weekday,
} from "../../calendar";
import { todayStr } from "../../journal";
import { ANSWER_STATUS, DEFAULT_SETTINGS, isAnswered, loadSettings } from "../../settingsStore";
import { REMOTE_CHANGE } from "../../google";
import { refreshHolidaysDaily, syncReminders, updateHolidays } from "../../reminders";
import { SearchBox } from "../../SearchBox";
import { ChipActs, EventChip, WeekView, weekLayout } from "./Table";
import { Draft, draftOf, blankDraft, QuickRow, EventDialog, KindsDialog, GoogleBox, NotifyDialog } from "./Dialogs";

/** 알림을 누르거나 다른 화면에서 이 일정을 열 때 */
export type EventFocus = { event: number; date: string };

type Props = {
  focus?: EventFocus | null;
  onFocused?: () => void;
  onOpenComplaint?: (id: number) => void;
  onOpenTask?: (id: number) => void;
};

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
  /** 월 보기 · 주 보기 (마지막에 고른 것을 기억해요) */
  const [view, setView] = useState<"month" | "week">("month");
  /** 한 번 눌러 골라 둔 일정 */
  const [pick, setPick] = useState<string | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const wheel = useRef({ acc: 0, at: 0 });
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_SETTINGS.status);
  /** 쉬는 날(토·일·공휴일) 붉은 음영 – 설정 화면에서 켜고 꺼요(처음 값 켜짐). */
  const [restShade, setRestShade] = useState(DEFAULT_SETTINGS.restShade);
  /** 이번에 체크한 민원의 그 전 상태 */
  const prevStatus = useRef(new Map<number, string>());
  useEffect(() => {
    loadSettings().then((x) => (setStatuses(x.status), setRestShade(x.restShade)), () => {});
  }, []);

  useEffect(() => {
    api.get("calendar.view").then((v) => (v === "week" || v === "month") && setView(v), () => {});
  }, []);
  const changeView = (v: "month" | "week") => {
    setView(v);
    api.set("calendar.view", v).catch(() => {});
  };

  const load = useCallback(() => {
    api.calendarData().then(setData, (e) => setNote(errorText(e)));
  }, []);

  useEffect(() => {
    load();
    api.complaints().then(setComplaints, () => {});
    api.tasksData().then((d) => setTasks(d.tasks), () => {});
    // 오늘 받은 적이 없으면 공휴일을 새로 받아 와요.
    refreshHolidaysDaily().then((got) => got && load());
    // 구글 할 일에서 체크한 것이 들어오면 다시 읽어요.
    const reload = () => {
      api.complaints().then(setComplaints, () => {});
      api.tasksData().then((d) => setTasks(d.tasks), () => {});
    };
    window.addEventListener(REMOTE_CHANGE, reload);
    return () => window.removeEventListener(REMOTE_CHANGE, reload);
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

  /** 민원 마감(= 법정 답변기한)의 동그라미: "답변"으로 바꾸고, 풀면 그 전 상태로(이번에 체크한 것만 기억, 모르면 답변 끝남이 아닌 첫 상태). */
  async function toggleComplaint(c: Complaint) {
    const done = isAnswered(c.status);
    const next = done ? prevStatus.current.get(c.id) ?? statuses.find((x) => !isAnswered(x)) ?? "접수" : ANSWER_STATUS;
    const r = await run(api.setComplaintStatus(c.id, next));
    if (!r) return;
    if (done) prevStatus.current.delete(c.id);
    else prevStatus.current.set(c.id, c.status);
    setComplaints((cs) => cs.map((x) => (x.id === r.id ? r : x)));
  }

  async function toggleTask(t: Task) {
    const r = await run(api.setTaskDone(t.id, !t.done, today));
    if (!r) return;
    const by = new Map(r.map((x) => [x.id, x]));
    setTasks((ts) => ts.map((x) => by.get(x.id) ?? x));
  }

  const lq = q.trim().toLowerCase();
  const month = monthGrid(ym[0], ym[1]);
  const wkStart = addDays(sel, -weekday(sel));
  const start = view === "week" ? wkStart : month.start;
  const weeks = view === "week" ? 1 : month.weeks;
  const gridEnd = addDays(start, weeks * 7 - 1);

  // 답변 끝난 민원(답변·완료·보류·장기)은 캘린더에서 빼요(2026-10-19 사용자). 이 화면에서 방금 체크한 것만 되돌릴 수 있게 흐리게 남겨요.
  const shownComplaints = useMemo(() => complaints.filter((c) => !isAnswered(c.status) || prevStatus.current.has(c.id)), [complaints]);
  const src: Source | null = useMemo(
    () => (data ? { kinds: data.kinds, events: data.events, holidays: data.holidays, complaints: shownComplaints, tasks } : null),
    [data, shownComplaints, tasks],
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

  // 달력은 화면 아래 여백까지 내려가요(2026-10-17 사용자). 달력 위치에서 화면(.main) 아래 여백까지를 재서
  // 그 높이를 달력에 주고, 월 보기는 주 수로 나눠요. 왼쪽 구글 상자는 이 아래 끝에 맞춰져요(0.9.2).
  const [vh, setVh] = useState(window.innerHeight);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const gridRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ h: vh - 218, dow: 33 });
  useLayoutEffect(() => {
    const el = gridRef.current;
    const main = el?.closest<HTMLElement>(".main");
    if (!el || !main) return;
    const m = main.getBoundingClientRect();
    const pb = parseFloat(getComputedStyle(main).paddingBottom) || 0;
    const top = el.getBoundingClientRect().top - m.top + main.scrollTop;
    const h = Math.floor(main.clientHeight - pb - top);
    const dow = el.querySelector<HTMLElement>(".cal-dow")?.offsetHeight ?? fit.dow;
    if (h !== fit.h || dow !== fit.dow) setFit({ h, dow });
  });
  /** 달력 테두리 위아래 2px */
  const inner = fit.h - 2;
  // 창이 낮아지면 주 칸을 줄여 달력 전체를 화면에 맞춰요(2026-10-25 사용자 — 맨 아랫줄이 잘리지 않게).
  // 한 주 = 날짜 줄 30 + 일정 줄(24 + 사이 2)마다 + 아래 여백 8 + 사이 2. 일정 줄이 하나만 들어가면 "+N개"를 날짜 줄로 올려요.
  const WEEK_MIN = 66;
  const cellH = Math.max(WEEK_MIN, Math.floor((inner - fit.dow) / weeks));
  const fitLanes = Math.max(1, Math.floor((cellH - 40) / 26));
  const compact = fitLanes === 1;
  const lanes = compact ? 2 : fitLanes;
  /** 창이 너무 낮으면 높이를 정하지 않고 화면이 스크롤돼요. */
  const gridH = view === "week" ? (inner >= 300 ? fit.h : undefined) : cellH * weeks + fit.dow <= inner ? fit.h : undefined;

  if (!data) {
    return (
      <>
        <h1 className="title">캘린더</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  /** 이전·다음: 월 보기는 한 달, 주 보기는 한 주 */
  const move = (n: number) => {
    setPick(null);
    if (view === "week") {
      const d = addDays(sel, n * 7);
      setSel(d);
      setYm([Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1]);
      return;
    }
    const d = new Date(ym[0], ym[1] + n, 1);
    setYm([d.getFullYear(), d.getMonth()]);
  };
  /**
   * 마우스 휠(세로)로 이전·다음 (0.8.2 사용자 1안): 월 보기는 달력 어디서나 달 이동.
   * 주 보기는 날짜 머리 줄·종일 줄 위에서만 주 이동이고, 시간 칸 위의 휠은 시간을 내려요.
   */
  const onWheel = (e: React.WheelEvent) => {
    if (view === "week" && !(e.target as HTMLElement).closest(".cal-wk-head, .cal-wk-allday")) return;
    const dx = e.deltaY;
    if (!dx) return;
    const w = wheel.current;
    const now = Date.now();
    if (now - w.at < 450) return;
    w.acc += dx;
    if (Math.abs(w.acc) >= 40) {
      move(w.acc > 0 ? 1 : -1);
      w.acc = 0;
      w.at = now;
    }
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
  const actsOf = (o: Occ): ChipActs => ({
    onPick: () => setPick(o.key),
    onOpen: () => openOcc(o),
    onToggle: () => (o.task ? toggleTask(o.task) : o.complaint ? toggleComplaint(o.complaint) : undefined),
  });
  const newAt = (d: string, time: string) =>
    setEd(time ? { ...blankDraft(d, data.kinds), allDay: false, time, endTime: hourLater(time), remind: 10 } : blankDraft(d, data.kinds));
  const title =
    view === "week"
      ? (() => {
          const e = addDays(wkStart, 6);
          const [y1, m1, d1] = [Number(wkStart.slice(0, 4)), Number(wkStart.slice(5, 7)), Number(wkStart.slice(8))];
          const [y2, m2, d2] = [Number(e.slice(0, 4)), Number(e.slice(5, 7)), Number(e.slice(8))];
          return y1 !== y2 ? `${y1}년 ${m1}월 ${d1}일 – ${y2}년 ${m2}월 ${d2}일` : m1 !== m2 ? `${y1}년 ${m1}월 ${d1}일 – ${m2}월 ${d2}일` : `${y1}년 ${m1}월 ${d1}일 – ${d2}일`;
        })()
      : `${ym[0]}년 ${ym[1] + 1}월`;

  const holidaysOf = new Map<string, string[]>();
  if (!hidden.has(data.kinds.find((k) => k.system === "holiday")?.id ?? -1)) {
    for (const o of occs) if (o.kind.system === "holiday") holidaysOf.set(o.start, [...(holidaysOf.get(o.start) ?? []), o.title]);
  }
  /** 쉬는 날 음영은 공휴일 종류를 숨겨도 칠해요(공휴일 목록 그대로). */
  const restDays = new Set(data.holidays.map((h) => h.date));
  const holidayLine = data.holidaysAt ? `${data.holidaysAt.slice(5, 10).replace("-", "/")} 받음` : "앱에 넣은 목록";

  return (
    <div className="cal-screen">
      <aside className="cal-side">
        <div className="cal-kinds">
          <div className="cal-side-head">
            <span>캘린더 종류</span>
            <button type="button" className="btn btn-xs cal-manage" onClick={() => setKindsOpen(true)}>
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
            <span>앞으로 7일</span>
          </div>
          {upcoming.length ? (
            upcoming.slice(0, 12).map((o) => (
              <button key={o.key + o.day} type="button" className="cal-up" onClick={() => (goDay(o.day), openOcc(o))}>
                <span className="cal-up-dot" aria-hidden="true" style={{ background: colorBg(o.color) }} />
                <span className="cal-up-text">
                  <span className="cal-up-title" title={o.title}>{o.title}</span>
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
        <GoogleBox />
      </aside>

      <div className="cal-body">
        <div className="cal-head">
          <h1 className="title cal-month">{title}</h1>
          <div className="cal-nav">
            <button type="button" className="btn btn-ctrl cal-navbtn" aria-label={view === "week" ? "이전 주" : "이전 달"} onClick={() => move(-1)}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <button type="button" className="btn btn-ctrl" onClick={() => (goDay(today), setPick(null))}>
              오늘
            </button>
            <button type="button" className="btn btn-ctrl cal-navbtn" aria-label={view === "week" ? "다음 주" : "다음 달"} onClick={() => move(1)}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <div className="cal-views" role="group" aria-label="보기 방식">
            <button type="button" aria-pressed={view === "month"} onClick={() => changeView("month")}>
              월
            </button>
            <button type="button" aria-pressed={view === "week"} onClick={() => changeView("week")}>
              주
            </button>
          </div>
          <SearchBox aria-label="일정 검색" placeholder="일정 검색" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} />
        </div>
        {note && <p className="note" role="status">{note}</p>}

        <QuickRow
          sel={sel}
          kinds={data.kinds}
          onSel={(d) => goDay(d)}
          onAdd={addEvent}
          onDetail={(d) => setEd(d)}
        />

        <div
          ref={gridRef}
          className={"cal-grid" + (restShade ? " shade" : "")}
          role="grid"
          aria-label={title + " 달력"}
          style={{ height: gridH }}
          onWheel={onWheel}
        >
          {view === "week" ? (
            <WeekView
              start={wkStart}
              occs={occs}
              today={today}
              sel={sel}
              pickKey={pick}
              q={lq}
              holidaysOf={holidaysOf}
              restDays={restDays}
              onSel={(d) => (setSel(d), setPick(null))}
              onNew={newAt}
              actsOf={actsOf}
            />
          ) : (
          <>
          <div className="cal-dow" role="row">
            {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
              <div key={w} role="columnheader" className={i === 0 ? "sun" : i === 6 ? "sat" : undefined}>
                {w}
              </div>
            ))}
          </div>
          {Array.from({ length: weeks }, (_, wi) => {
            const ws = addDays(start, wi * 7);
            const { placed, more } = weekLayout(occs, ws, lanes, compact);
            return (
              <div key={ws} className="cal-week" role="row" style={{ minHeight: cellH, gridTemplateRows: `30px repeat(${compact ? 1 : lanes}, 24px) 1fr` }}>
                {Array.from({ length: 7 }, (_, i) => {
                  const d = addDays(ws, i);
                  const inMonth = Number(d.slice(5, 7)) - 1 === ym[1];
                  const hol = holidaysOf.get(d);
                  const dow = weekday(d);
                  const cls = ["cal-day", inMonth ? "" : "out", d === sel ? "sel" : "", d === today ? "today" : "", dow === 0 || hol ? "red" : dow === 6 ? "blue" : "", dow === 0 || dow === 6 || restDays.has(d) ? "rest" : ""]
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
                      onClick={() => (setSel(d), setPick(null))}
                      onDoubleClick={() => newAt(d, "")}
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
                  <EventChip key={p.occ.key + ws} p={p} q={lq} picked={pick === p.occ.key} acts={actsOf(p.occ)} />
                ))}
                {more.map((n, i) =>
                  n ? (
                    <button
                      key={"m" + i}
                      type="button"
                      className={compact ? "cal-more top" : "cal-more"}
                      style={{ gridColumn: i + 1, gridRow: compact ? 1 : lanes + 1 }}
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
          </>
          )}
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
        <div className="overlay" onMouseDown={overlayDown(() => setDayOpen(null))}>
          <div className="dialog cal-daydlg" role="dialog" aria-modal="true" aria-label={longDay(dayOpen) + " 일정"} onKeyDown={(e) => e.key === "Escape" && setDayOpen(null)}>
            <div className="dialog-head">
              <span className="dialog-title">{longDay(dayOpen)}</span>
              {holidaysOf.get(dayOpen) && <span className="cal-hol">{holidaysOf.get(dayOpen)!.join(", ")}</span>}
            </div>
            <DialogX autoFocus onClick={() => setDayOpen(null)} />
            <div className="dialog-body cal-daylist">
              {occs
                .filter((o) => o.kind.system !== "holiday" && o.start <= dayOpen && o.end >= dayOpen)
                .sort((a, b) => (a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
                .map((o, i) => (
                  <EventChip
                    key={o.key}
                    p={{ occ: o, col: 0, span: 1, lane: i, cutStart: false, cutEnd: false }}
                    q={lq}
                    picked={pick === o.key}
                    acts={{
                      ...actsOf(o),
                      onOpen: () => {
                        setDayOpen(null);
                        openOcc(o);
                      },
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
            </div>
          </div>
        </div>
      )}
      {notifyOpen && <NotifyDialog onClose={() => setNotifyOpen(false)} />}
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
          onNotify={() => (setKindsOpen(false), setNotifyOpen(true))}
          onRefreshHolidays={async () => {
            const err = await updateHolidays();
            load();
            return err ? `받지 못했어요(${err}). 저장해 둔 공휴일을 그대로 보여 줘요.` : "";
          }}
          onClose={() => setKindsOpen(false)}
        />
      )}
    </div>
  );
}

function Tick() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
