// 캘린더 (8단계). 시안: Calendar.dc.html, 사양서 "캘린더".
// - 월 달력 하나가 화면을 채워요(주·일 보기는 없어요). 그 달의 주 수에 맞춰 칸 높이를 나누고, 칸에 다 못 그리면 "+N개".
// - 달력 위 빠른 입력 줄: 날짜 → 시작 → 종료 → 일정 → 종류. 아무 칸에서 Enter, 종류 칸에서 Tab이면 등록. 시작을 비우면 종일.
// - "상세 입력"이나 달력의 내 일정을 누르면 상세 창: 제목, 일시·종일, 반복(종료일 필수), 장소, 설명(머릿기호), 종류, 알림.
// - 민원 마감·할 일 마감은 저장하지 않고 민원대장·할 일 목록을 읽어 그려요. 누르면 원래 화면의 그 항목으로 가요.
// - 공휴일은 칸 위쪽에 빨간 글자로 보여요(앱이 인터넷에서 받아 저장해 둔 것).
// - 왼쪽: 종류 체크(보이기·숨기기), "관리"(색 24가지·새 종류·지우기), "앞으로 7일"(옆 칸 일정 목록).
import { CSSProperties, KeyboardEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DelGlyph, DelMark } from "./Icons";
import { DialogX } from "./DialogX";
import { overlayDown, useOutsideClose } from "./useOutsideClose";
import { isKey, keyAction, rowKeys } from "./keys";
import { api, CalEvent, CalKind, CalendarData, Complaint, errorText, EventInput, NotifyStatus, Repeat, Task } from "./api";
import { BLine, parseLines, stringifyLines } from "./bullets";
import { BulletEditor } from "./BulletParts";
import {
  addDays, colorBg, colorFg, COLOR_NAMES, diffDays, expand, hourLater, kindColor, layoutWeek, longDay, monthGrid, Occ, occMatches, Placed,
  parseTime, REMIND_LABELS, REMIND_MAX, REMIND_UNITS, REPEAT_LABELS, shortDay, Source, splitRemind, weekday,
} from "./calendar";
import { Hl } from "./ContactsScreen";
import { parseDate, todayStr } from "./journal";
import { DateInput } from "./DateInput";
import { ANSWER_STATUS, DEFAULT_SETTINGS, isAnswered, loadSettings } from "./settingsStore";
import { exportNow, GStatus, onGoogleStatus, REMOTE_CHANGE, whenText } from "./google";
import { loadNotifyMode, refreshHolidaysDaily, saveNotifyMode, stamp, syncReminders, updateHolidays } from "./reminders";
import { AskBand } from "./AskBand";

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
  /** 종일 일정의 알림 시각 (비우면 9시) */
  remindTime: string;
};

type Bad = Partial<Record<"title" | "date" | "end" | "time" | "endTime" | "until" | "remind" | "remindTime", true>>;

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
  if (d.remind !== -1 && !(d.remind >= 0 && d.remind <= REMIND_MAX && Number.isInteger(d.remind))) bad.remind = true;
  const remindTime = d.allDay && d.remind >= 0 && d.remindTime.trim() ? parseTime(d.remindTime) : "";
  if (remindTime === null) bad.remindTime = true;
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
      remindTime: remindTime || "",
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
    remindTime: e.remindTime,
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

function blankDraft(date: string, kinds: CalKind[]): Draft {
  return { id: null, title: "", kind: firstKind(kinds), date, end: "", allDay: true, time: "", endTime: "", repeat: "", until: "", place: "", desc: [], remind: -1, remindTime: "" };
}

// ---------- 달력의 일정 하나 ----------

type ChipActs = {
  /** 한 번 누르기: 고르기 */
  onPick: () => void;
  /** 두 번 누르기(또는 골라 둔 채 Enter): 고치기·원래 화면으로 */
  onOpen: () => void;
  /** 할 일의 동그라미: 완료·되돌리기 */
  onToggle: () => void;
};

function EventChip({ p, q, picked, style, acts }: { p: Placed; q: string; picked: boolean; style?: CSSProperties; acts: ChipActs }) {
  const o = p.occ;
  const bar = o.allDay;
  const when = o.allDay ? (o.start !== o.end ? `${shortDay(o.start)}~${shortDay(o.end)}` : "종일") : `${o.time}–${o.endTime}`;
  const full =
    [when, o.title, o.kind.name, o.place].filter(Boolean).join(" · ") + (o.done ? " · 완료" : "") + (o.event ? " · 두 번 누르면 고쳐요" : " · 두 번 누르면 원래 화면으로 가요");
  const cls = ["cal-ev", bar ? "bar" : "dot", p.cutStart ? "cut-s" : "", p.cutEnd ? "cut-e" : "", o.done ? "done" : "", o.event ? "" : "linked", o.task || o.complaint ? "task" : "", picked ? "picked" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      role="button"
      tabIndex={0}
      className={cls}
      title={full}
      aria-label={full}
      aria-pressed={picked}
      style={{
        gridColumn: `${p.col + 1} / span ${p.span}`,
        gridRow: p.lane + 2,
        background: bar ? colorBg(o.color) : undefined,
        color: bar ? colorFg(o.color) : undefined,
        ...style,
      }}
      onClick={(e) => {
        e.stopPropagation();
        acts.onPick();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        acts.onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          acts.onOpen();
        } else if (e.key === " " && (o.task || o.complaint)) {
          e.preventDefault();
          acts.onToggle();
        }
      }}
    >
      {o.task || o.complaint ? (
        <button
          type="button"
          tabIndex={-1}
          className="cal-ev-check"
          role="checkbox"
          aria-checked={o.done}
          aria-label={o.done ? "완료 되돌리기" : "완료"}
          title={o.done ? "완료 되돌리기" : "완료"}
          onClick={(e) => {
            e.stopPropagation();
            acts.onToggle();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {o.done ? <CheckCircle /> : <Circle />}
        </button>
      ) : (
        !bar && <span className="cal-ev-dot" aria-hidden="true" style={{ background: colorBg(o.color) }} />
      )}
      {!bar && <span className="cal-ev-time">{o.time}</span>}
      <span className="cal-ev-title">
        <Hl text={o.title} q={q} />
      </span>
      {o.repeat && (
        <span className="cal-ev-mark" aria-hidden="true">
          ↻
        </span>
      )}
    </div>
  );
}

// ---------- 주간 보기 ----------

/** 한 시간의 높이(px) */
const HOUR = 44;

type Slot = { occ: Occ; s: number; e: number; col: number; cols: number };

/** 한 날의 시간 일정을 겹치지 않게 칸(열)으로 나눠요. */
function slotsOf(list: Occ[]): Slot[] {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const items = list
    .map((occ) => {
      const s = mins(occ.time);
      return { occ, s, e: Math.max(mins(occ.endTime || occ.time), s + 20), col: 0, cols: 1 };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Slot[] = [];
  let group: Slot[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const g of group) g.cols = ends.length;
    out.push(...group);
    group = [];
    ends = [];
  };
  for (const it of items) {
    if (group.length && it.s >= groupEnd) close();
    let c = ends.findIndex((x) => x <= it.s);
    if (c < 0) c = ends.length;
    ends[c] = it.e;
    it.col = c;
    group.push(it);
    groupEnd = Math.max(groupEnd, it.e);
  }
  close();
  return out;
}

function WeekView({
  start,
  occs,
  today,
  sel,
  pickKey,
  q,
  holidaysOf,
  restDays,
  onSel,
  onNew,
  actsOf,
}: {
  start: string;
  occs: Occ[];
  today: string;
  sel: string;
  pickKey: string | null;
  q: string;
  holidaysOf: Map<string, string[]>;
  restDays: Set<string>;
  onSel: (d: string) => void;
  onNew: (d: string, time: string) => void;
  actsOf: (o: Occ) => ChipActs;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const top = occs.filter((o) => o.allDay || o.start !== o.end);
  const { placed } = layoutWeek(top, start, 99);
  const lanes = placed.reduce((n, p) => Math.max(n, p.lane + 1), 0);
  const scroller = useRef<HTMLDivElement>(null);
  /** 시간 칸 오른쪽 스크롤 막대 폭. 위 두 줄도 이만큼 비워 세로선을 맞춰요(0.8.2). */
  const [bar, setBar] = useState(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = () => setBar(el.offsetWidth - el.clientWidth);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  // 주를 바꾸면 아침(오전 8시, 오늘이 있으면 지금 한 시간 앞 중 이른 때)으로 내려가요.
  useEffect(() => {
    const h = days.includes(today) ? Math.min(8, Math.max(0, now.getHours() - 1)) : 8;
    if (scroller.current) scroller.current.scrollTop = h * HOUR;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  const nowTop = (now.getHours() * 60 + now.getMinutes()) * (HOUR / 60);
  const todayAt = days.indexOf(today);
  /** 쉬는 날(토·일·공휴일)이면 " rest" – 음영은 달력의 .shade가 켜졌을 때만 칠해요. */
  const rest = (d: string) => (weekday(d) === 0 || weekday(d) === 6 || restDays.has(d) ? " rest" : "");
  const dayCls = (d: string) => {
    const dow = weekday(d);
    return ["cal-wday", d === today ? "today" : "", d === sel ? "sel" : "", dow === 0 || holidaysOf.has(d) ? "red" : dow === 6 ? "blue" : ""].filter(Boolean).join(" ") + rest(d);
  };
  return (
    <div className="cal-wk">
      <div className="cal-wk-head" style={{ paddingRight: bar }}>
        <div className="cal-wk-gutter" />
        {days.map((d) => (
          <div key={d} className={dayCls(d)} onClick={() => onSel(d)} onDoubleClick={() => onNew(d, "")}>
            <span className="cal-wday-name">{["일", "월", "화", "수", "목", "금", "토"][weekday(d)]}</span>
            <span className="cal-num">{Number(d.slice(8))}</span>
            {holidaysOf.get(d) && <span className="cal-hol">{holidaysOf.get(d)!.join(", ")}</span>}
          </div>
        ))}
      </div>
      <div className="cal-wk-allday" style={{ gridTemplateRows: `repeat(${Math.max(1, lanes)}, 24px)`, paddingRight: bar }}>
        <div className="cal-wk-gutter cal-wk-alllabel" style={{ gridRow: `1 / span ${Math.max(1, lanes)}` }}>
          종일
        </div>
        {days.map((d, i) => (
          <div
            key={d}
            className={"cal-wk-allcell" + (d === today ? " today" : "") + rest(d)}
            style={{ gridColumn: i + 2, gridRow: `1 / span ${Math.max(1, lanes)}` }}
            onClick={() => onSel(d)}
            onDoubleClick={() => onNew(d, "")}
          />
        ))}
        {placed.map((p) => (
          <EventChip
            key={p.occ.key}
            p={p}
            q={q}
            picked={pickKey === p.occ.key}
            style={{ gridColumn: `${p.col + 2} / span ${p.span}`, gridRow: p.lane + 1 }}
            acts={actsOf(p.occ)}
          />
        ))}
      </div>
      <div className="cal-wk-scroll" ref={scroller}>
        <div className="cal-wk-body" style={{ height: 24 * HOUR }}>
          <div className="cal-wk-hours">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR }}>
                {h === 0 ? "" : `${h < 12 ? "오전" : "오후"} ${h <= 12 ? h : h - 12}시`}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div
              key={d}
              className={"cal-wk-col" + (d === today ? " today" : "") + rest(d)}
              onClick={() => onSel(d)}
              onDoubleClick={(e) => {
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                const h = Math.min(23, Math.max(0, Math.floor(y / HOUR)));
                onNew(d, String(h).padStart(2, "0") + ":00");
              }}
            >
              {slotsOf(occs.filter((o) => !o.allDay && o.start === o.end && o.start === d)).map((sl) => (
                <EventChip
                  key={sl.occ.key}
                  p={{ occ: sl.occ, col: 0, span: 1, lane: 0, cutStart: false, cutEnd: false }}
                  q={q}
                  picked={pickKey === sl.occ.key}
                  style={{
                    position: "absolute",
                    top: (sl.s * HOUR) / 60,
                    height: Math.max(20, ((sl.e - sl.s) * HOUR) / 60 - 2),
                    left: `calc(${(100 / sl.cols) * sl.col}% + 2px)`,
                    width: `calc(${100 / sl.cols}% - 4px)`,
                    margin: 0,
                    background: `color-mix(in srgb, ${colorBg(sl.occ.color)} 22%, var(--surface))`,
                    borderLeft: `3px solid ${colorBg(sl.occ.color)}`,
                  }}
                  acts={actsOf(sl.occ)}
                />
              ))}
              {d === today && <div className="cal-now" style={{ top: nowTop }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
      {todayAt >= 0 && rest(today) && (
        <div
          className="cal-wk-today"
          aria-hidden="true"
          style={{ left: `calc(64px + (100% - 64px - ${bar}px) * ${todayAt} / 7)`, width: `calc((100% - 64px - ${bar}px) / 7 + 1px)` }}
        />
      )}
    </div>
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
      remindTime: "",
    });
    if (!ok) return;
    setTime("");
    setEndTime("");
    setTitle("");
    onSel(d);
    focus("date");
  }

  // 엔터규칙(keys.ts): Enter·Tab 다음 칸, 마지막 칸(종류)이면 등록
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    rowKeys(e, row.current, () => void submit());
  }

  const fix = (v: string, set: (s: string) => void) => {
    const t = parseTime(v);
    if (t) set(t);
  };

  return (
    <div className="cal-quick" role="row" ref={row} onKeyDown={onKeyDown}>
      <DateInput
        name="date"
        label="날짜"
        placeholder=""
        invalid={bad === "date"}
        value={date}
        onChange={(v) => {
          setDate(v);
          if (bad === "date") setBad("");
        }}
        // 칸을 떠나면 2026-10-12 꼴로 바꿔 써요(DateInput). 읽을 수 없으면 친 그대로 두고 빨간 테두리.
        onLeave={(d) => {
          if (d === null) setBad("date");
          else if (d && d !== sel) onSel(d);
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
        placeholder="일정"
        className={"cell-input" + (bad === "title" ? " invalid" : "")}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (bad === "title") setBad("");
        }}
      />
      <KindPicker kinds={kinds} value={kind} onChange={setKind} />
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


  // 엔터규칙(keys.ts): 한 줄 칸 Enter·Tab 다음 칸, 마지막 칸이면 저장. 설명(여러 줄 칸)은 다음 칸이 없는 곳으로 쳐서 Tab = 저장하고 닫기.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    if (isKey(e, "common.cancel")) {
      e.preventDefault();
      if (asking) setAsking(false);
      else onClose();
      return;
    }
    const t = e.target as HTMLElement;
    if (t.closest(".cal-desc") && keyAction(e, "multi") === "common.next") {
      e.preventDefault();
      void save();
      return;
    }
    rowKeys(e, e.currentTarget, () => void save());
  }

  /** 날짜 칸을 떠나면 2026-10-12 꼴로 바꿔 써요. 읽을 수 없으면 친 그대로 두고 빨간 테두리. */
  const dateFix = (k: "date" | "end" | "until") => {
    const d = parseDate(draft[k]);
    if (!d) {
      if (draft[k].trim()) setBad((b) => ({ ...b, [k]: true }));
      return;
    }
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
    <div className="overlay" onMouseDown={overlayDown(outside)}>
      <div className="dialog cal-dialog" role="dialog" aria-modal="true" aria-label="일정 상세" onKeyDown={onKeyDown}>
        {/* × = 바깥 누르기와 같음: 고친 것이 있으면 저장하고 닫기(✔7) */}
        <DialogX label="저장하고 닫기" title="저장하고 닫기 (버리려면 Esc)" onClick={outside} />
        <div className="cal-dlg-title" data-dialog-title>
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
            <DateInput label="시작 날짜" placeholder="" className="cal-in-date" invalid={bad.date} value={draft.date} onChange={(v) => set("date", v)} onBlur={() => dateFix("date")} />
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
            <DateInput
              label="종료 날짜"
              placeholder={draft.date}
              className="cal-in-date"
              invalid={bad.end}
              value={draft.end}
              onChange={(v) => set("end", v)}
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
                <DateInput
                  label="반복 종료일"
                  placeholder="날짜"
                  className="cal-in-date"
                  invalid={bad.until || !draft.until.trim()}
                  value={draft.until}
                  onChange={(v) => set("until", v)}
                  onBlur={() => dateFix("until")}
                />
                
              </>
            )}
          </div>

          <span className="cal-dlg-label">장소</span>
          <input aria-label="장소" placeholder="장소 추가" className="cell-input" value={draft.place} onChange={(e) => set("place", e.target.value)} />

          <span className="cal-dlg-label top">설명</span>
          <div className="cal-desc">
            <BulletEditor lines={draft.desc} onChange={(v) => set("desc", v)} name="desc" label="설명" placeholder="설명 추가" />
          </div>

          <span className="cal-dlg-label">캘린더</span>
          <div className="cal-dlg-line">
            <KindPicker kinds={kinds} value={draft.kind} onChange={(v) => set("kind", v)} />
          </div>

          <span className="cal-dlg-label">알림</span>
          <RemindField
            value={draft.remind}
            allDay={draft.allDay}
            time={draft.remindTime}
            bad={!!bad.remind}
            badTime={!!bad.remindTime}
            onChange={(remind, remindTime) => {
              onChange({ ...draft, remind, remindTime });
              if (bad.remind || bad.remindTime) setBad((b) => ({ ...b, remind: undefined, remindTime: undefined }));
            }}
          />
        </div>
        {asking && (
          <AskBand
            className="cal-ask"
            label="일정 지우기 확인"
            text={draft.repeat ? "반복 일정 전체를 지울까요?" : "이 일정을 지울까요?"}
            onNo={() => setAsking(false)}
            onYes={onDelete}
          />
        )}
        <div className="dialog-foot cal-dlg-foot">
          {!isNew && (
            <button type="button" className="tool-box cal-trash del-btn" aria-label="일정 삭제" title="일정 삭제" onClick={() => setAsking(true)}>
              <DelGlyph />
            </button>
          )}
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

// ---------- 알림 고르기 ----------

/**
 * 알림: 정해 둔 값(정시·10분·30분·1시간·1일·7일·한 달 전) 또는 직접 설정(수 + 분·시간·일·주 전).
 * 종일 일정은 그 날(또는 며칠 전)의 몇 시에 알릴지 시각도 정해요(비우면 오전 9시).
 */
function RemindField({
  value,
  allDay,
  time,
  bad,
  badTime,
  onChange,
}: {
  value: number;
  allDay: boolean;
  time: string;
  bad: boolean;
  badTime: boolean;
  onChange: (remind: number, time: string) => void;
}) {
  const preset = REMIND_LABELS.some(([v]) => v === value);
  const [custom, setCustom] = useState(!preset);
  const [n, u] = splitRemind(value < 0 ? 0 : value);
  const [num, setNum] = useState(String(n));
  const [unit, setUnit] = useState(u);
  const setCustomValue = (nn: string, uu: number) => {
    setNum(nn);
    setUnit(uu);
    const k = Number(nn);
    onChange(Number.isFinite(k) && nn.trim() !== "" ? Math.round(k * uu) : NaN, time);
  };
  return (
    <div className="cal-dlg-line">
      <select
        aria-label="알림"
        className="cal-select"
        value={custom ? "custom" : String(value)}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setCustom(true);
            const base = value > 0 ? value : 60;
            const [cn, cu] = splitRemind(base);
            setCustomValue(String(cn), cu);
          } else {
            setCustom(false);
            onChange(Number(e.target.value), time);
          }
        }}
      >
        {REMIND_LABELS.map(([v, l]) => (
          <option key={v} value={v}>
            {allDay && v === 0 ? "당일" : l}
          </option>
        ))}
        <option value="custom">직접 설정</option>
      </select>
      {custom && (
        <>
          <input
            aria-label="알림 수"
            inputMode="numeric"
            className={"cell-input num cal-in-num" + (bad ? " invalid" : "")}
            value={num}
            onChange={(e) => setCustomValue(e.target.value.replace(/[^0-9]/g, ""), unit)}
          />
          <select aria-label="알림 단위" className="cal-select" value={unit} onChange={(e) => setCustomValue(num, Number(e.target.value))}>
            {REMIND_UNITS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </>
      )}
      {allDay && value >= 0 && (
        <>
          <span className="cal-dlg-sub">알림 시각</span>
          <input
            aria-label="알림 시각"
            placeholder="09:00"
            className={"cell-input num cal-in-time" + (badTime ? " invalid" : "")}
            value={time}
            onChange={(e) => onChange(value, e.target.value)}
            onBlur={() => {
              const t = parseTime(time);
              if (t) onChange(value, t);
            }}
          />
        </>
      )}
      {bad && <span className="cal-dlg-sub">62일 전까지 정할 수 있어요</span>}
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
  onNotify,
  onClose,
}: {
  data: CalendarData;
  onKinds: (k: CalKind[]) => void;
  onDeleted: (id: number) => void;
  run: <T>(p: Promise<T>, msg?: string) => Promise<T | null>;
  holidayLine: string;
  onRefreshHolidays: () => Promise<string>;
  onNotify: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  /** 공휴일 다시 받기: 받는 중·결과 */
  const [hol, setHol] = useState<{ busy: boolean; msg: string; ok: boolean } | null>(null);
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
        <div className="prow-name mgr-name">
          <span className="cal-kbadge" style={{ background: colorBg(c), color: colorFg(c) }}>
            {k.name}
          </span>
          <span className="mgr-info">{extra}</span>
        </div>
        <ColorButton
          label={k.name}
          value={c}
          auto={k.color === null}
          autoLabel={k.system ? "처음 색" : "자동"}
          onPick={(i) => run(api.setCalKindColor(k.id, i)).then((r) => r && onKinds(r))}
        />
        {k.system ? (
          <span className="mgr-gap" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="tool-box del-hit"
            aria-label={k.name + " 삭제"}
            title={mine.length <= 1 ? "종류는 하나 이상 있어야 해요" : k.name + " 삭제"}
            disabled={mine.length <= 1}
            onClick={() => setAsking(k.id)}
          >
            <DelMark />
          </button>
        )}
        {asking === k.id && (
          <AskBand
            className="ask-wide"
            label="종류 지우기 확인"
            text={count(k.id) ? `"${k.name}"과 그 일정 ${count(k.id)}건을 지울까요?` : `"${k.name}"을 지울까요?`}
            onNo={() => setAsking(null)}
            onYes={async () => {
              const n = await run(api.deleteCalKind(k.id));
              setAsking(null);
              if (n !== null) onDeleted(k.id);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div
        className="dialog mgr"
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
        </div>
        <DialogX onClick={onClose} />
        <div className="dialog-body">
          <div className="mgr-label">직접 만든 종류</div>
          {mine.map((k) => row(k, count(k.id) ? `일정 ${count(k.id)}건` : "일정 없음"))}
          <div className="padd">
            <input
              aria-label="새 종류 이름"
              placeholder="새 종류 이름"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (plainEnter(e) && !isComposing(e)) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="btn-primary btn-ctrl mgr-add" onClick={add}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              추가
            </button>
          </div>
          <div className="mgr-label">자동으로 들어오는 종류</div>
          {sys.map((k) =>
            row(
              k,
              k.system === "complaint" ? (
                "민원대장 마감일"
              ) : k.system === "task" ? (
                "할 일 마감일"
              ) : (
                <span className="cal-holrow">
                  <span>{holidayLine}</span>
                  <button
                    type="button"
                    className="btn btn-xs cal-holbtn"
                    aria-disabled={hol?.busy || undefined}
                    aria-busy={hol?.busy || undefined}
                    onClick={async () => {
                      if (hol?.busy) return;
                      setHol({ busy: true, msg: "받는 중…", ok: true });
                      const err = await onRefreshHolidays();
                      setHol({ busy: false, msg: err || `받았어요 (${stamp().slice(11)})`, ok: !err });
                    }}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={hol?.busy ? "spin" : undefined}>
                      <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
                    </svg>
                    {hol?.busy ? "받는 중…" : "다시 받기"}
                  </button>
                  {hol && !hol.busy && (
                    <span className={hol.ok ? "cal-hol-ok" : "cal-hol-fail"} role="status">
                      {hol.ok ? "✓ " : ""}
                      {hol.msg}
                    </span>
                  )}
                </span>
              ),
            ),
          )}
        </div>
        <div className="dialog-foot cal-dlg-foot">
          <button type="button" className="btn btn-ctrl" onClick={onNotify}>
            알림 확인
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 구글 연동 상태 상자 (9단계, 시안: 캘린더 왼쪽 맨 위) ----------

function GoogleBox() {
  const [g, setG] = useState<GStatus | null>(null);
  useEffect(() => onGoogleStatus(setG), []);
  if (!g || !g.connected) return null;
  return (
    <div className="g-box">
      <div className="g-box-head">
        <span className={"g-dot" + (g.lastError ? " bad" : "")} aria-hidden="true" />
        <span>{g.lastError ? "구글 내보내기 실패" : "구글 캘린더 연동됨"}</span>
      </div>
      <span className={"g-box-sub" + (g.lastError ? " g-err" : "")}>
        {g.busy ? "내보내는 중…" : g.lastError || "기록 → 구글 한 방향"}
        {!g.busy && g.lastOk && <span className="g-box-at">마지막 성공 {whenText(g.lastOk)}</span>}
      </span>
      <button type="button" className="btn btn-xs" disabled={g.busy} onClick={() => exportNow()}>
        지금 내보내기
      </button>
    </div>
  );
}

// ---------- 알림 확인 창 ----------

/**
 * 윈도우 알림이 뜨는지 확인해요. 시험 알림을 띄워 보고, 안 보이면 PowerShell 이름으로 다시 띄워 봐요
 * (설치 바로가기의 앱 이름이 윈도우에 안 잡힌 PC가 있어요). 보인 쪽을 저장해 두고 그 이름으로 계속 띄워요.
 */
function NotifyDialog({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<NotifyStatus | null>(null);
  const [ps, setPs] = useState(false);
  const [step, setStep] = useState<"" | "asked" | "done">("");
  const [err, setErr] = useState("");
  const refresh = useCallback(() => api.notifyStatus().then(setSt, () => {}), []);
  useEffect(() => {
    syncReminders().then(refresh);
    loadNotifyMode().then(setPs);
  }, [refresh]);

  async function test(powershell: boolean) {
    setErr("");
    await saveNotifyMode(powershell);
    setPs(powershell);
    try {
      setSt(await api.testNotification());
      setStep("asked");
    } catch (e) {
      setErr(String(e));
    }
  }

  const next = st?.nextAt ? new Date(st.nextAt) : null;
  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div className="dialog cal-notify" role="dialog" aria-modal="true" aria-label="알림 확인" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="dialog-head">
          <span className="dialog-title">알림 확인</span>
        </div>
        <DialogX onClick={onClose} />
        <div className="dialog-body cal-notify-body">
          <p>
            앞으로 7일 동안 울릴 알림 <b>{st?.pending ?? 0}건</b>
            {next && ` · 다음 알림 ${shortDay(todayStr(next))} ${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`}
          </p>
          <p className="hint">
            지금 쓰는 이름: {ps ? "PowerShell" : "기록"}
            {st?.shown ? ` · 켠 뒤 띄운 알림 ${st.shown}건` : ""}
            {st?.lastError ? ` · 마지막 오류: ${st.lastError}` : ""}
          </p>
          {err && <p className="note">윈도우가 알림을 거절했어요: {err}</p>}
          {step === "asked" && (
            <div className="ask-band cal-notify-ask">
              <span>화면 오른쪽 아래에 "기록 알림 시험"이 보였나요?</span>
              <button type="button" className="btn btn-xs" onClick={() => setStep("done")}>
                보였어요
              </button>
              {!ps ? (
                <button type="button" className="btn btn-xs" onClick={() => test(true)}>
                  안 보였어요 (다른 이름으로 다시)
                </button>
              ) : (
                <button type="button" className="btn btn-xs" onClick={() => test(false)}>
                  안 보였어요 (기록 이름으로 다시)
                </button>
              )}
            </div>
          )}
          {step === "done" && <p className="cal-hol-ok">✓ 이 이름({ps ? "PowerShell" : "기록"})으로 알림을 띄워요.</p>}
          <p className="hint">안 보이면 윈도우 설정 → 시스템 → 알림을 확인해 주세요.</p>
        </div>
        <div className="dialog-foot cal-dlg-foot">
          <button type="button" className="btn btn-ctrl cal-cancel" onClick={() => test(ps)}>
            시험 알림 띄우기
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 종류 고르기 ----------

/**
 * 캘린더 종류를 배지로 보여 주고 목록에서만 골라요(0.8.2 – 아무 글자나 치면 종류가 늘어나서).
 * 새 종류는 "관리" 창에서 만들어요. 키: Space·↓ 열기, ↑↓ 고르기, Enter·Tab 확정, Esc 닫기.
 * 닫혀 있을 때의 Enter·Tab은 감싼 줄이 받아요(빠른 입력은 등록, 상세 창은 저장).
 */
function KindPicker({ kinds, value, onChange }: { kinds: CalKind[]; value: string; onChange: (name: string) => void }) {
  const mine = kinds.filter((k) => !k.system);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  /** 목록 자리(화면 기준). 창 안에서 잘리지 않게 화면에 띄워요. */
  const [at, setAt] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  const cur = mine.find((k) => k.name === value) ?? mine[0];
  useEffect(() => {
    if (cur && cur.name !== value) onChange(cur.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.name, value]);
  useOutsideClose(open, [box], () => setOpen(false));
  const show = () => {
    setHi(Math.max(0, mine.findIndex((k) => k.name === cur?.name)));
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const h = mine.length * 32 + 40;
      setAt(r.bottom + h + 8 > window.innerHeight ? { position: "fixed", left: r.left, minWidth: Math.max(180, r.width), bottom: window.innerHeight - r.top + 4, top: "auto" } : { position: "fixed", left: r.left, minWidth: Math.max(180, r.width), top: r.bottom + 4 });
    }
    setOpen(true);
  };
  const pick = (k: CalKind) => {
    onChange(k.name);
    setOpen(false);
  };
  const c = cur ? kindColor(cur, kinds) : 0;
  return (
    <div className="cal-kp" ref={box}>
      <button
        type="button"
        name="kind"
        className="cal-kp-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={"캘린더 종류: " + (cur?.name ?? "")}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ") {
              e.preventDefault();
              show();
            }
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + mine.length) % mine.length);
          } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey) || e.key === " ") {
            e.preventDefault();
            if (mine[hi]) pick(mine[hi]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <span className="cal-kp-dot" aria-hidden="true" style={{ background: colorBg(c) }} />
        <span className="cal-kp-name">{cur?.name ?? "종류 없음"}</span>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="cal-kp-list" role="listbox" aria-label="캘린더 종류" style={at}>
          {mine.map((k, i) => {
            const kc = kindColor(k, kinds);
            return (
              <div
                key={k.id}
                role="option"
                aria-selected={i === hi}
                className="cal-kp-opt"
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(k);
                }}
              >
                <span className="cal-kp-dot" aria-hidden="true" style={{ background: colorBg(kc) }} />
                <span>{k.name}</span>
                {k.name === cur?.name && <span className="cal-kp-tick" aria-hidden="true">✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- 색 단추 ----------

/** 색 단추 하나. 누르면 24색과 "자동"(앱이 만든 종류는 "처음 색")이 펼쳐져요. */
function ColorButton({ label, value, auto, autoLabel, onPick }: { label: string; value: number; auto: boolean; autoLabel: string; onPick: (i: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  useOutsideClose(open, [box], () => setOpen(false));
  const toggle = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const right = window.innerWidth - r.right;
      setAt(r.bottom + 170 > window.innerHeight ? { position: "fixed", right, bottom: window.innerHeight - r.top + 6, top: "auto" } : { position: "fixed", right, top: r.bottom + 6 });
    }
    setOpen((o) => !o);
  };
  const pick = (i: number | null) => {
    onPick(i);
    setOpen(false);
  };
  return (
    <div
      className="cal-cbtn-wrap"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          e.preventDefault();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="cal-cbtn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label} 색: ${COLOR_NAMES[value]}${auto ? " (자동)" : ""} – 눌러서 바꾸기`}
        title={`${COLOR_NAMES[value]}${auto ? " (자동)" : ""}`}
        onClick={toggle}
        style={{ background: colorBg(value), color: colorFg(value) }}
      />
      {open && (
        <div className="cal-cpop" role="dialog" aria-label={label + " 색 고르기"} style={at}>
          <div className="cal-cgrid" role="radiogroup">
            {COLOR_NAMES.map((n, i) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={i === value}
                aria-label={n}
                title={n}
                className="swatch"
                style={{ background: colorBg(i), color: colorBg(i) }}
                onClick={() => pick(i)}
              />
            ))}
          </div>
          <button type="button" className="btn btn-xs cal-cauto" aria-pressed={auto} onClick={() => pick(null)}>
            {autoLabel}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 아이콘 ----------

function Circle() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function CheckCircle() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.8 2.8L16.5 9.5" />
    </svg>
  );
}

function Tick() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Plus() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** 주 한 줄 배치 — 일정 줄이 하나만 들어갈 때(compact)는 첫 줄만 그리고 나머지는 모두 "+N개"로 세요. */
function weekLayout(occs: Parameters<typeof layoutWeek>[0], ws: string, lanes: number, compact: boolean) {
  const r = layoutWeek(occs, ws, lanes);
  if (!compact) return r;
  const more = [...r.more];
  const placed = r.placed.filter((p) => {
    if (p.lane < 1) return true;
    for (let c = p.col; c < p.col + p.span; c++) more[c]++;
    return false;
  });
  return { placed, more };
}
