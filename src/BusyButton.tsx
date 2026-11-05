// 느린 단추(2026-10-30 22:47 결정 로그, 사용자 "제안대로" ①1안 ②① ③2안):
// 외부(구글·공유 시트·웹)와 주고받아 몇 초 걸리는 단추는 누른 순간 글자가 "○○하는 중…" + 도는 아이콘으로 바뀌고 잠겨요.
// 10초가 넘으면 "오래 걸려요 – 조금 더 기다려 주세요" 한 줄(로그인 기다림은 빼요),
// 끝나면 단추 자리 가까이 ✓ 결과를 5초 보여요(실패는 붉은 글로 남아요).
import { ButtonHTMLAttributes, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const LATE_MS = 10_000;
export const FLASH_MS = 5_000;
export const LATE_TEXT = "오래 걸려요 – 조금 더 기다려 주세요";

export type Flash = { key: string; text: string; ok: boolean };

/** 하는 중인 일 하나(key)와 10초 넘김·끝난 결과를 한곳에서 다뤄요. */
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const live = useRef(true);
  const busyRef = useRef<string | null>(null);
  useEffect(() => () => void (live.current = false), []);

  useEffect(() => {
    setLate(false);
    if (!busy) return;
    const t = window.setTimeout(() => setLate(true), LATE_MS);
    return () => window.clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    if (!flash?.ok) return;
    const t = window.setTimeout(() => setFlash((f) => (f === flash ? null : f)), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flash]);

  /**
   * f를 돌려요. 다른 일이 도는 중이면 무시해요(두 번 누르기 막기).
   * done: 끝난 글(빈 글이면 ✓ 없음) – f가 글자를 돌려주면 그 글이 실패(붉은 글)예요.
   */
  const run = useCallback(
    async (key: string, f: () => Promise<unknown>, done = "", errText: (e: unknown) => string = (e) => (e instanceof Error ? e.message : String(e))) => {
      if (busyRef.current) return false;
      busyRef.current = key;
      setBusy(key);
      setFlash(null);
      let ok = true;
      try {
        const r = await f();
        if (!live.current) return true;
        if (typeof r === "string" && r) {
          ok = false;
          setFlash({ key, text: r, ok: false });
        } else if (done) setFlash({ key, text: done, ok: true });
      } catch (e) {
        ok = false;
        if (live.current) setFlash({ key, text: errText(e), ok: false });
      } finally {
        busyRef.current = null;
        if (live.current) setBusy(null);
      }
      return ok;
    },
    [],
  );

  return { busy, late, flash, run, setFlash, is: (k: string) => busy === k };
}

const Spin = ({ size }: { size: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="spin busy-spin">
    <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
  </svg>
);

/** 누르면 "○○하는 중…"으로 바뀌고 잠기는 단추 – 바뀌어도 폭이 줄지 않아요(줄이 밀리지 않게). */
export function BusyButton({
  busy,
  busyText,
  children,
  className = "btn",
  disabled,
  small,
  style,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy: boolean; busyText: string; children: ReactNode; small?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [minW, setMinW] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (busy && ref.current) setMinW(ref.current.getBoundingClientRect().width);
    if (!busy) setMinW(undefined);
  }, [busy]);
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={className + " busy-btn"}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      style={busy && minW ? { ...style, minWidth: minW } : style}
    >
      {busy ? (
        <>
          <Spin size={small ? 12 : 14} />
          {busyText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * 하는 중·끝난 결과 글. line이면 줄 아래 오른쪽 한 줄(칸이 붐비는 줄), 아니면 단추 옆 글.
 * busy일 때 10초가 넘으면 LATE_TEXT(noLate면 안 보임 – 로그인 기다림), 끝나면 ✓ 결과·실패 글.
 */
export function BusyNote({ busy, late, flash, noLate, line }: { busy: boolean; late: boolean; flash: Flash | null | undefined; noLate?: boolean; line?: boolean }) {
  let body: ReactNode = null;
  let cls = "";
  if (busy) {
    if (late && !noLate) {
      body = LATE_TEXT;
      cls = "busy-late";
    }
  } else if (flash) {
    body = flash.ok ? `✓ ${flash.text}` : flash.text;
    cls = flash.ok ? "busy-done" : "busy-fail";
  }
  if (!body) return null;
  return line ? (
    <p className={"busy-line small " + cls} role="status">
      {body}
    </p>
  ) : (
    <span className={"busy-note " + cls} role="status">
      {body}
    </span>
  );
}
