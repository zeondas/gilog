// 검색창 공통 부품(2026-10-26 공통 부품 ✔8, 결정 로그 10-18 13:40 · 시안 캔버스 RuleFix).
// 모양은 집행현황 검색창 그대로: 돋보기 + 칸 + 글자가 있을 때만 끝에 × 20.
// × 를 누르면 한 번에 지우고 커서는 칸에 남아요. Esc도 같아요(글자가 있을 때만 – 비어 있으면 Esc는 화면이 받아요).
// 윈도우 기본 ×(type="search")는 쓰지 않아요.
import type { InputHTMLAttributes, KeyboardEvent, ReactNode, RefObject } from "react";
import { useRef } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "type" | "className"> & {
  value: string;
  /** 지우기(× · Esc) */
  onClear: () => void;
  /** label에 더할 이름표(예 "bd-search") */
  className?: string;
  inputClassName?: string;
  /** 돋보기 크기(처음 값 16, 작은 칸은 14) */
  iconSize?: number;
  inputRef?: RefObject<HTMLInputElement>;
  /** × 뒤에 둘 것(탐색기 "자세히 ▾") */
  tail?: ReactNode;
  /** 돋보기를 바꿔 끼울 때 */
  icon?: ReactNode;
};

export function SearchBox({ value, onClear, className, inputClassName, iconSize = 16, inputRef, tail, icon, onKeyDown, ...rest }: Props) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const clear = () => {
    onClear();
    ref.current?.focus();
  };
  return (
    <label className={"search" + (className ? " " + className : "")}>
      {icon ?? (
        <svg aria-hidden="true" width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      )}
      <input
        {...rest}
        ref={ref}
        type="text"
        className={inputClassName}
        value={value}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Escape" && value && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            onClear();
            return;
          }
          onKeyDown?.(e);
        }}
      />
      {value && (
        <button type="button" className="search-x" aria-label="검색어 지우기" title="지우기" onMouseDown={(e) => e.preventDefault()} onClick={clear}>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
      {tail}
    </label>
  );
}
