// 캘린더 – 달력 그리기: 일정 하나(EventChip), 주간 보기(WeekView·slotsOf), 주 한 줄 배치(weekLayout), 마감 동그라미 그림. 화면 몸통은 Screen.tsx.
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { addDays, colorBg, colorFg, layoutWeek, Occ, Placed, shortDay, weekday } from "../../calendar";
import { Hl } from "../../screens/contacts/parts";

// ---------- 달력의 일정 하나 ----------

export type ChipActs = {
  /** 한 번 누르기: 고르기 */
  onPick: () => void;
  /** 두 번 누르기(또는 골라 둔 채 Enter): 고치기·원래 화면으로 */
  onOpen: () => void;
  /** 할 일의 동그라미: 완료·되돌리기 */
  onToggle: () => void;
};

export function EventChip({ p, q, picked, style, acts }: { p: Placed; q: string; picked: boolean; style?: CSSProperties; acts: ChipActs }) {
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

export function WeekView({
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

/** 주 한 줄 배치 — 일정 줄이 하나만 들어갈 때(compact)는 첫 줄만 그리고 나머지는 모두 "+N개"로 세요. */
export function weekLayout(occs: Parameters<typeof layoutWeek>[0], ws: string, lanes: number, compact: boolean) {
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
