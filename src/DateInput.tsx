// 날짜 칸 공통 부품(2026-10-21 공통 부품 세션 ✔3, docs/qa/parts.md 2-4절).
// 규칙(CLAUDE.md "공통 입력 규칙 › 날짜 칸"): 읽기는 journal.ts의 parseDate 하나 – 261015·26-10-15·1015·10/15·20261015 모두 받아요.
// 치는 도중에는 바꾸지 않고, 칸을 떠날 때(다른 곳 누르기·Tab·Enter) 2026-10-12 꼴로 바꿔 써요. 읽을 수 없으면 친 그대로 두고 빨간 테두리.
// 빨간 테두리를 켜고 끄는 것(invalid)은 화면이 정해요 – 화면마다 "비어도 되나·접수일보다 앞이면 안 됨" 같은 규칙이 달라서예요.
// Enter·Tab은 막지 않고 화면의 줄 규칙(다음 칸·등록)으로 그대로 넘겨요.
import { useState } from "react";
import type { InputHTMLAttributes, KeyboardEvent, ReactNode, Ref } from "react";
import { parseDate, todayStr } from "./journal";

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className" | "aria-label">;

export type DateInputProps = Base & {
  value: string;
  onChange: (v: string) => void;
  /** 떠날 때 읽은 값: 2026-10-12 꼴, 빈칸이면 "", 읽을 수 없으면 null */
  onLeave?: (d: string | null) => void;
  /** 화면 읽기 이름 */
  label: string;
  invalid?: boolean;
  /** 바탕 이름표(처음 값 "cell-input num") – 할 일 "fld td-due-input", 탐색기 "input fx-date" */
  base?: string;
  className?: string;
  /** 빨간 테두리를 칸에 두지 않을 때(업무일지 인쇄는 감싼 상자가 빨개요) */
  boxInvalid?: boolean;
  /** 커서가 없을 때 줄여 보이기(민원대장 좁은 열) */
  shortOf?: (v: string) => string;
  /** Enter에도 바꿔 쓰기 – 칸을 떠나지 않고 Enter로 찾는 곳(업무일지 인쇄·탐색기 찾기) */
  fixOnEnter?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

/** 떠날 때 읽기: 빈칸 "" · 읽은 날 · 못 읽음 null */
export function readDate(v: string): string | null {
  return v.trim() ? parseDate(v) : "";
}

export function DateInput({
  value,
  onChange,
  onLeave,
  label,
  invalid,
  base = "cell-input num",
  className,
  boxInvalid,
  shortOf,
  fixOnEnter,
  inputRef,
  placeholder = "연-월-일",
  inputMode = "numeric",
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: DateInputProps) {
  const [focus, setFocus] = useState(false);
  const shown = !focus && shortOf ? shortOf(value) : value;
  const fix = (raw: string) => {
    const d = readDate(raw);
    if (d && d !== raw) onChange(d);
    onLeave?.(d);
  };
  const red = invalid && !boxInvalid;
  return (
    <input
      {...rest}
      ref={inputRef}
      aria-label={label}
      aria-invalid={invalid || undefined}
      className={base + (className ? " " + className : "") + (red ? " invalid" : "")}
      placeholder={placeholder}
      inputMode={inputMode}
      title={rest.title ?? (shown !== value ? value : undefined)}
      value={shown}
      onFocus={(e) => {
        setFocus(true);
        onFocus?.(e);
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        setFocus(false);
        fix(e.target.value);
        onBlur?.(e);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (fixOnEnter && e.key === "Enter" && !e.nativeEvent.isComposing) fix(e.currentTarget.value);
        onKeyDown?.(e);
      }}
    />
  );
}

/** 작은 달력(할 일에서 옮겨 옴) – 칸 아래로 펼쳐져요. 고르면 onPick, Esc는 달력만 닫아요. */
export function MiniCal({ value, today, onPick, onClose }: { value: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const base = value || today;
  const [ym, setYm] = useState<[number, number]>([Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1]);
  const first = new Date(ym[0], ym[1], 1);
  const dim = new Date(ym[0], ym[1] + 1, 0).getDate();
  const move = (n: number) => {
    const d = new Date(ym[0], ym[1] + n, 1);
    setYm([d.getFullYear(), d.getMonth()]);
  };
  const cells: ReactNode[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(<span key={"e" + i} />);
  for (let n = 1; n <= dim; n++) {
    const key = todayStr(new Date(ym[0], ym[1], n));
    const dow = (first.getDay() + n - 1) % 7;
    cells.push(
      <button
        key={key}
        type="button"
        tabIndex={-1}
        className={"td-cal-day" + (key === value ? " sel" : "") + (key === today ? " today" : "") + (dow === 0 ? " sun" : dow === 6 ? " sat" : "")}
        aria-label={key}
        aria-pressed={key === value}
        onClick={() => onPick(key)}
      >
        {n}
      </button>,
    );
  }
  return (
    <div className="td-cal" role="dialog" aria-label="날짜 고르기" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <div className="td-cal-head">
        <span className="td-cal-title">
          {ym[0]}년 {ym[1] + 1}월
        </span>
        <button type="button" tabIndex={-1} className="td-cal-nav" aria-label="이전 달" onClick={() => move(-1)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <button type="button" tabIndex={-1} className="td-cal-nav" aria-label="다음 달" onClick={() => move(1)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="td-cal-week">
        <span className="sun">일</span>
        <span>월</span>
        <span>화</span>
        <span>수</span>
        <span>목</span>
        <span>금</span>
        <span className="sat">토</span>
      </div>
      <div className="td-cal-grid">{cells}</div>
    </div>
  );
}
