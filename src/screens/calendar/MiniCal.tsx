// 캘린더 왼쪽 위 미니달력(✔4 – 11-04 17:35 사용자, 시안 CalendarLayout.dc.html).
// 날짜를 한 번 누르면 그 주가 큰 달력 첫 줄(월 보기 5주), 두 번 누르면 그날 일 보기.
// 오늘은 강조색 채운 동그라미, 고른 날은 옅은 채움, 큰 달력에 보이는 날들은 아주 옅은 띠(18:01 "채움으로" 규칙).
import { addDays, monthGrid, weekday } from "../../calendar";

type Props = {
  /** 보여 줄 달 [해, 0부터 센 달] */
  ym: [number, number];
  onYm: (ym: [number, number]) => void;
  today: string;
  sel: string;
  /** 큰 달력에 보이는 첫날·끝날(미니달력으로 고른 5주·주 보기일 때만 띠, 아니면 "") */
  from: string;
  to: string;
  restDays: Set<string>;
  onPick: (d: string) => void;
  onDouble: (d: string) => void;
};

export function MiniCal({ ym, onYm, today, sel, from, to, restDays, onPick, onDouble }: Props) {
  const g = monthGrid(ym[0], ym[1]);
  const step = (n: number) => {
    const d = new Date(ym[0], ym[1] + n, 1);
    onYm([d.getFullYear(), d.getMonth()]);
  };
  return (
    <div className="cal-mini" aria-label="미니달력">
      <div className="cal-mini-head">
        <span>
          {ym[0]}년 {ym[1] + 1}월
        </span>
        <button type="button" className="cal-mini-nav" aria-label="미니달력 이전 달" onClick={() => step(-1)}>
          <Chevron d="M15 5l-7 7 7 7" />
        </button>
        <button type="button" className="cal-mini-nav" aria-label="미니달력 다음 달" onClick={() => step(1)}>
          <Chevron d="M9 5l7 7-7 7" />
        </button>
      </div>
      <div className="cal-mini-grid">
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
          <span key={w} className="cal-mini-w" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDays(g.start, i);
          const dow = weekday(d);
          const out = Number(d.slice(5, 7)) - 1 !== ym[1];
          const cls = [
            "cal-mini-d",
            out ? "out" : dow === 0 || restDays.has(d) ? "red" : dow === 6 ? "blue" : "",
            d === today ? "today" : d === sel ? "sel" : "",
            from && d >= from && d <= to ? "in" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={d} type="button" className={cls} aria-label={d} aria-current={d === today ? "date" : undefined} onClick={() => onPick(d)} onDoubleClick={() => onDouble(d)}>
              <span>{Number(d.slice(8))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Chevron({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
