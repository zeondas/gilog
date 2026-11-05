// 남은 날을 근무일로 세요(2026-10-30 사용자 – 국민신문고 "남은 처리기간"과 같게).
// 토·일·공휴일을 빼고, 오늘 다음 날부터 마감일까지 센 날 수예요. 민원·할 일 마감이 모두 이것을 써요.
// 공휴일은 캘린더의 공휴일 목록(앱에 넣어 온 것 + 받은 것)을 App이 잠금 풀 때·새로 받을 때 넣어 줘요.
import { useSyncExternalStore } from "react";

let holidays = new Set<string>();
let version = 0;
const subs = new Set<() => void>();

/** 공휴일 목록을 바꿔요(날짜 YYYY-MM-DD). 바뀌면 남은 날을 쓰는 화면이 다시 그려요. */
export function setHolidays(list: { date: string }[]) {
  const next = new Set(list.map((h) => h.date));
  if (next.size === holidays.size && [...next].every((d) => holidays.has(d))) return;
  holidays = next;
  version++;
  for (const f of subs) f();
}

/** 공휴일 목록이 바뀌면 다시 그리게 해요(값은 쓰지 않아도 돼요). */
export function useHolidays(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
  );
}

const utc = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 토·일·공휴일인지 */
export function isRestDay(date: string): boolean {
  const w = new Date(utc(date)).getUTCDay();
  return w === 0 || w === 6 || holidays.has(date);
}

/**
 * from(오늘)에서 to(마감일)까지 남은 근무일. 같은 날이면 0, 지났으면 음수예요.
 * - 남음: from 다음 날부터 to까지의 근무일 수(10-30 금 → 11-02 월 = 1). 마감이 쉬는 날이라 0이 되면 1(아직 오늘은 아니니까).
 * - 지남: to 다음 날부터 from까지의 근무일 수에 −(11-02 월 마감을 11-03 화에 보면 −1). 0이 되면 −1.
 */
export function workDaysBetween(from: string, to: string): number {
  if (from === to) return 0;
  const a = utc(from);
  const b = utc(to);
  const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
  let n = 0;
  for (let t = lo + 86_400_000; t <= hi; t += 86_400_000) if (!isRestDay(iso(t))) n++;
  return sign * Math.max(1, n);
}
