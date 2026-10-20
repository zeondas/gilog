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

// ---------- 공휴일 받기 (0.8.2) ----------
// 사무실 망은 회사 프록시 자동 설정을 써서, 앱(Rust)이 직접 받으면 막혔어요(사용자: Edge에서는 주소가 열림).
// 그래서 화면 쪽(Edge와 같은 인터넷 길)에서 먼저 받고, 안 되면 다른 곳 → 마지막으로 앱이 직접 받아요.

const HOLIDAY_URL = "https://holidays.hyunbin.page/basic.json";
/** 같은 자료의 공용 배포처(jsDelivr). all.js가 연도별 파일 이름을 알려 줘요. */
const CDN = "https://cdn.jsdelivr.net/npm/@hyunbinseo/holidays-kr@5/dist/";

type HolidayList = { date: string; name: string }[];

function fromMap(m: Record<string, string | string[]>): HolidayList {
  return Object.entries(m).flatMap(([date, v]) => (Array.isArray(v) ? v : [v]).map((name) => ({ date, name })));
}

async function getText(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`응답 ${r.status}`);
    return await r.text();
  } finally {
    window.clearTimeout(t);
  }
}

/** 연도별 파일(예: 2026-CCnV5XUt.js) 안의 "2026-01-01": ["1월 1일"] 줄을 읽어요. */
export function parseYearFile(js: string): HolidayList {
  const out: HolidayList = [];
  for (const m of js.matchAll(/"(\d{4}-\d{2}-\d{2})":\s*\[([^\]]*)\]/g)) {
    for (const n of m[2].matchAll(/"([^"]+)"/g)) out.push({ date: m[1], name: n[1] });
  }
  return out;
}

const why = (e: unknown) => (e instanceof Error ? (e.name === "AbortError" ? "시간 초과" : e.message || e.name) : String(e));

/**
 * 공휴일을 받아 저장해요. 성공하면 "", 실패하면 곳마다 실패 이유를 이어 붙인 글을 돌려줘요.
 * 1) 공휴일 자료 사이트, 2) 공용 배포처(jsDelivr) – 둘 다 화면 쪽에서, 3) 앱이 직접.
 */
export async function updateHolidays(): Promise<string> {
  const fails: string[] = [];
  try {
    const list = fromMap(JSON.parse(await getText(HOLIDAY_URL)));
    if (list.length) {
      await api.saveHolidays(list, stamp());
      return "";
    }
    fails.push("자료 사이트: 비어 있음");
  } catch (e) {
    fails.push("자료 사이트: " + why(e));
  }
  try {
    const all = await getText(CDN + "all.js");
    const files = [...all.matchAll(/from\s*"\.\/(\d{4}-[^"]+\.js)"/g)].map((m) => m[1]);
    const thisYear = new Date().getFullYear();
    const want = files.filter((f) => Number(f.slice(0, 4)) >= thisYear - 1);
    const lists = await Promise.all(want.map(async (f) => parseYearFile(await getText(CDN + f))));
    const list = lists.flat();
    if (list.length) {
      await api.saveHolidays(list, stamp());
      return "";
    }
    fails.push("배포처: 비어 있음");
  } catch (e) {
    fails.push("배포처: " + why(e));
  }
  try {
    await api.refreshHolidays(stamp());
    return "";
  } catch (e) {
    fails.push("앱 직접: " + (e === "offline" ? "연결 안 됨" : String(e)));
  }
  return fails.join(" · ");
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
    return (await updateHolidays()) === "";
  } catch {
    return false;
  }
}
