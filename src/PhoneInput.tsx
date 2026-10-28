import { ChangeEvent, InputHTMLAttributes, useLayoutEffect, useRef } from "react";
import { digitsOf, finalizePhone, formatPhone, isAutoShape } from "./phone";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
};

/**
 * 전화번호 칸. 숫자와 하이픈만 치면 하이픈 자리와 상관없이 규칙대로 다시 붙이고,
 * 괄호·띄어쓰기·글자 등을 섞어 치면 친 그대로 둬요(2026-10-28 사용자 1안).
 */
export function PhoneInput({ value, onChange, onBlur, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  });

  function change(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const ie = e.nativeEvent as InputEvent;
    if (!raw) return onChange("");
    // 숫자·하이픈 말고 다른 글자가 있으면 그대로 받아요.
    if (!isAutoShape(raw)) return onChange(raw);

    const pos = e.target.selectionStart ?? raw.length;
    let digits = digitsOf(raw);
    let before = digitsOf(raw.slice(0, pos)).length;
    // 자동으로 붙은 하이픈을 Backspace로 지우면 그 앞 숫자를 지워요.
    if (ie.inputType === "deleteContentBackward" && digits === digitsOf(value) && before > 0) {
      digits = digits.slice(0, before - 1) + digits.slice(before);
      before -= 1;
    }
    const next = formatPhone(digits);
    // 커서는 같은 숫자 개수 뒤에 둬요.
    let at = 0;
    for (let n = 0; at < next.length && n < before; at++) if (/[0-9]/.test(next[at])) n++;
    caret.current = at;
    onChange(next);
  }

  return (
    <input
      ref={ref}
      inputMode="tel"
      autoComplete="off"
      {...rest}
      value={value}
      onChange={change}
      onBlur={(e) => {
        const f = finalizePhone(value);
        if (f !== value) onChange(f);
        onBlur?.(e);
      }}
    />
  );
}
