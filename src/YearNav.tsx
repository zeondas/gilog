// 해 묶음 [◀ 2026년 ▶] – 집행현황·예산현황 머리 줄이 함께 써요(2026-10-29 집행현황 ✔2, 사용자 ①1안 ②1안).
// "2026년" 글자를 누르면 그 자리가 입력 칸이 돼요: 2027·27(2000년대)을 치고 Enter·Tab·바깥 누르기면 그 해로,
// Esc는 취소, 읽을 수 없으면 빨간 테두리로 남아요. 창이 좁아도 이 묶음은 줄지 않아요(budget.css .bd-year).
import { useEffect, useRef, useState } from "react";

/** 해 읽기: 네 자리(2000~2099) 또는 두 자리(2000년대, 날짜 칸 규칙과 같게). "년"·띄어쓰기는 떼요. */
export function parseYear(s: string): number | null {
  const t = s.replace(/\s|년/g, "");
  if (!/^(\d{2}|\d{4})$/.test(t)) return null;
  const n = t.length === 2 ? 2000 + Number(t) : Number(t);
  return n >= 2000 && n <= 2099 ? n : null;
}

const Arrow = ({ d }: { d: string }) => (
  <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);

export function YearNav({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const editing = text !== null;
  /** 닫힌 뒤 늦게 오는 blur가 한 번 더 옮기지 않게 */
  const done = useRef(true);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const open = () => {
    done.current = false;
    setText(String(year));
  };
  const close = () => {
    done.current = true;
    setText(null);
    setBad(false);
  };
  /** 확정 – 옮겼거나 닫았으면 true, 읽을 수 없어 남았으면 false */
  const commit = (): boolean => {
    if (text === null || done.current) return true;
    if (!text.trim()) {
      close();
      return true;
    }
    const y = parseYear(text);
    if (y === null) {
      setBad(true);
      return false;
    }
    close();
    if (y !== year) onChange(y);
    return true;
  };

  return (
    <span className="bd-year">
      <button type="button" aria-label="이전 해" onClick={() => onChange(year - 1)}>
        <Arrow d="M15 6l-6 6 6 6" />
      </button>
      {editing ? (
        <b className="ed">
          <input
            ref={ref}
            className={"bd-year-in" + (bad ? " bad" : "")}
            aria-label="해"
            inputMode="numeric"
            maxLength={4}
            value={text}
            onChange={(e) => {
              setText(e.target.value.replace(/\D/g, "").slice(0, 4));
              setBad(false);
            }}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close();
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.stopPropagation();
                const ok = commit();
                if (e.key === "Enter" || !ok) e.preventDefault();
              }
            }}
          />
        </b>
      ) : (
        <b title="눌러서 해 입력" onClick={open}>
          {year}년
        </b>
      )}
      <button type="button" aria-label="다음 해" onClick={() => onChange(year + 1)}>
        <Arrow d="M9 6l6 6-6 6" />
      </button>
    </span>
  );
}
