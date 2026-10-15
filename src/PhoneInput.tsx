import { ChangeEvent, InputHTMLAttributes, useLayoutEffect, useRef } from "react";
import { digitsOf, finalizePhone, formatPhone, isAutoShape } from "./phone";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
};

/**
 * 전화번호 칸. 숫자만 치면 하이픈을 자동으로 붙이고,
 * 하이픈이나 다른 글자를 직접 치면 그때부터는 친 그대로 둬요(칸을 비우면 다시 자동).
 */
export function PhoneInput({ value, onChange, onBlur, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  // 직접 적는 중인지. 처음 값이 자동 모양이 아니면 직접 적은 것으로 봐요.
  const manual = useRef(!isAutoShape(value));
  const caret = useRef<number | null>(null);

  if (!value) manual.current = false;

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  });

  function change(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const ie = e.nativeEvent as InputEvent;
    if (!raw) {
      manual.current = false;
      return onChange("");
    }
    // 하이픈·띄어쓰기·괄호 등을 직접 쳤거나, 숫자·하이픈 말고 다른 글자가 있으면 그대로 받아요.
    if (ie.inputType?.startsWith("insert") && ie.data && /[^0-9]/.test(ie.data)) manual.current = true;
    if (/[^0-9-]/.test(raw)) manual.current = true;
    if (manual.current) return onChange(raw);

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
