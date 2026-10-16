// 일정 알림과 공휴일 받기를 앱 전체에서 챙겨요(캘린더 화면을 열지 않아도).
// - 알림: 앞으로 7일 동안 울릴 알림을 계산해 앱(Rust)에 보내요. 실제로 윈도우 알림을 띄우는 것은 앱이에요.
//   일정을 바꿀 때마다, 그리고 30분마다 다시 보내요(반복 일정의 다음 회차가 들어오게).
// - 공휴일: 앱을 열 때와 하루에 한 번 인터넷에서 새로 받아요(사양서). 못 받으면 저장해 둔 것을 그대로 써요.
import { api, inApp } from "./api";
import { reminders } from "./calendar";
import { todayStr } from "./journal";

export async function syncReminders(): Promise<void> {
  if (!inApp) return;
  try {
    const d = await api.calendarData();
    await api.setReminders(reminders(d.events, d.kinds, new Date(), 7));
  } catch {
    /* 잠겨 있으면 다음에 다시 보내요. 이미 보낸 목록은 앱이 들고 있어요. */
  }
}

const MODE_KEY = "calendar.notifyPowershell";

/** 알림을 PowerShell 이름으로 띄우는지 (알림 확인 창에서 고른 것) */
export async function loadNotifyMode(): Promise<boolean> {
  try {
    return (await api.get(MODE_KEY)) === "1";
  } catch {
    return false;
  }
}

/** 고른 이름을 저장하고 앱에 알려요. */
export async function saveNotifyMode(powershell: boolean): Promise<void> {
  try {
    await api.set(MODE_KEY, powershell ? "1" : "0");
  } catch {
    /* 잠겨 있으면 이번만 */
  }
  await api.setNotifyMode(powershell).catch(() => {});
}

/** 잠금을 풀 때 저장해 둔 이름을 앱에 알려요. */
export async function applyNotifyMode(): Promise<void> {
  if (!inApp) return;
  await api.setNotifyMode(await loadNotifyMode()).catch(() => {});
}

/** "2026-10-16 09:12" */
export function stamp(d = new Date()): string {
  return `${todayStr(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

let lastTry = 0;

/**
 * 오늘 받은 적이 없으면 공휴일을 받아요. 받았으면 true예요.
 * 실패해도 한 시간 동안은 다시 시도하지 않아요(인터넷이 막힌 곳에서 계속 두드리지 않게).
 */
export async function refreshHolidaysDaily(force = false): Promise<boolean> {
  if (!inApp) return false;
  if (!force && Date.now() - lastTry < 3_600_000) return false;
  try {
    const d = await api.calendarData();
    if (!force && d.holidaysAt.slice(0, 10) === todayStr()) return false;
    lastTry = Date.now();
    await api.refreshHolidays(stamp());
    return true;
  } catch {
    return false;
  }
}
