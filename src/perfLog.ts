// 앱 안 재기 기록(공통 ✔1, 2026-11-07 사용자 1안 – 초시계 대신 앱이 스스로 재요).
// 설정 "재기 기록"을 켰을 때만 재요 – 꺼 두면 아무 일도 하지 않아요(처음 꺼짐).
// - 켜짐·값은 이 컴퓨터의 앱 저장소(localStorage)에 둬요: 잠금 풀기 전에도 켜졌는지 알아야 해서(자료 파일은 잠겨 있어요).
// - 값은 숫자만(ms·MB) – 민원 내용·이름·연락처는 없어요. 바뀔 때마다 설정 폴더 `load-log.json`으로도 써요(`perf_save`).
// - 재는 법(docs/loadtest.md, tools/load/measure.py와 같게): 누른 순간 → 화면 바뀜이 멈춘 뒤 첫 그림까지(설정 카드에 최근 5번 가운데 값).
import { api } from "./api";
import { VERSION } from "./version";

const ON = "gilog.perf.on";
const LOG = "gilog.perf.log";
/** 항목마다 남기는 최근 값 수 */
const KEEP = 20;
/** 바뀜이 이만큼 없으면 다 그린 것으로 봐요(ms) */
const QUIET = 400;
/** 이보다 오래 걸리면(계속 바뀌는 화면) 재지 않고 버려요 */
const GIVE_UP = 15000;

export type PerfLog = Record<string, number[]>;

const get = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const put = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* 저장소를 못 쓰면 재지 않아요 */
  }
};

const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** 값이 바뀔 때 알려 줘요(설정 카드) */
export function onPerf(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export const perfOn = (): boolean => get(ON) === "1";

export function setPerfOn(v: boolean): void {
  put(ON, v ? "1" : null);
  emit();
}

export function perfLog(): PerfLog {
  try {
    const v = JSON.parse(get(LOG) || "{}");
    return v && typeof v === "object" ? (v as PerfLog) : {};
  } catch {
    return {};
  }
}

export function clearPerf(): void {
  put(LOG, null);
  emit();
  scheduleSave();
}

export const median = (v: number[]): number => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 최근 5번 중간값(설정 표) */
export const recentMedian = (v: number[]): number => median(v.slice(-5));

/** 기준(10-18 사용자 1안): 첫 화면 1초 · 전환·지도 0.2초 · 메모리 250MB. 기준 없는 항목은 null. */
export function limitOf(name: string): { v: number; unit: "ms" | "MB" } | null {
  if (name.startsWith("메모리")) return { v: 250, unit: "MB" };
  if (name.startsWith("첫 화면")) return { v: 1000, unit: "ms" };
  if (name.startsWith("전환") || name.startsWith("민원지도")) return { v: 200, unit: "ms" };
  return null;
}

/** 표에 놓는 순서: 첫 화면 → 민원지도 → 전환 → 메모리 */
export const orderOf = (name: string): number =>
  name.startsWith("첫 화면")
    ? 0
    : name.startsWith("민원지도")
      ? 1 + (name.includes("첫 열기") ? 0 : name.includes("두 번째") ? 0.1 : 0.2)
      : name.startsWith("전환")
        ? 2
        : name.startsWith("메모리")
          ? 3
          : 4;

export function record(name: string, v: number): void {
  if (!perfOn() || !Number.isFinite(v) || v < 0) return;
  const l = perfLog();
  const arr = (l[name] ??= []);
  arr.push(Math.round(v * 10) / 10);
  if (arr.length > KEEP) l[name] = arr.slice(-KEEP);
  put(LOG, JSON.stringify(l));
  emit();
  scheduleSave();
}

let saveTimer = 0;
let savedPath = "";
export const perfFile = (): string => savedPath;

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const l = perfLog();
    const items = Object.fromEntries(Object.entries(l).map(([k, v]) => [k, { median5: recentMedian(v), n: v.length, runs: v }]));
    const text = JSON.stringify({ app: VERSION, at: new Date().toISOString(), note: "기Log 재기 기록 – 숫자만(ms·MB)", items }, null, 1);
    api
      .perfSave(text)
      .then((p) => {
        if (p) savedPath = p;
        emit();
      })
      .catch(() => {});
  }, 1500);
}

/**
 * from(처음 값: 지금)부터 화면 바뀜이 QUIET ms 동안 멈출 때까지 – 마지막으로 바뀐 뒤 첫 그림까지를 재요.
 * until이 있으면 그 요소가 생긴 뒤부터 멈춤을 봐요(업무일지 기록 카드 등). 끝나면 done(재 값)을 불러요.
 */
export function perfTime(name: string, opt: { from?: number; until?: string; done?: (ms: number) => void } = {}): void {
  if (!perfOn()) return;
  const t0 = opt.from ?? performance.now();
  let last = t0;
  let seen = !opt.until;
  let changed = false;
  const mo = new MutationObserver(() => {
    changed = true;
  });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const tick = () => {
    const now = performance.now();
    if (changed) {
      changed = false;
      last = now;
    }
    if (!seen && opt.until && document.querySelector(opt.until)) {
      seen = true;
      last = now;
    }
    if (now - t0 > GIVE_UP) {
      mo.disconnect();
      return;
    }
    if (seen && now - last > QUIET) {
      mo.disconnect();
      record(name, last - t0);
      opt.done?.(last - t0);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** 기Log + WebView2 프로세스 메모리(MB) – 윈도우 앱에서만 값이 있어요. */
export async function recordMemory(name: string): Promise<number | null> {
  if (!perfOn()) return null;
  const b = await api.perfMemory().catch(() => null);
  if (b === null || b === undefined) return null;
  const mb = b / 1048576;
  record(name, mb);
  return mb;
}

// ---------- 잠금 풀기 · 화면 전환 ----------

let unlockAt: number | null = null;
/** 잠금 화면에서 [열기]·Enter·PIN을 누른 때(잠금 풀기 시작) */
export function perfUnlockStart(): void {
  unlockAt = perfOn() ? performance.now() : null;
}

/** 잠금이 풀려 첫 화면을 그릴 때(App) – 업무일지면 기록 카드가 보이고 멈출 때까지 */
export function perfUnlockShown(label: string, screenId: string): void {
  const t0 = unlockAt;
  unlockAt = null;
  if (t0 === null || !perfOn()) return;
  perfTime(`첫 화면 · 잠금 풀기 → ${label}`, { from: t0, until: screenId === "journal" ? ".jcard" : undefined });
}

let mapOpened = false;
/** 사이드바에서 화면을 누른 때. 민원지도는 앱을 켠 뒤 처음 열 때와 그 뒤를 따로 재요. */
export function perfSwitch(id: string, label: string, done?: () => void): void {
  if (!perfOn()) return;
  let name = `전환 · ${label}`;
  if (id === "map") {
    name = mapOpened ? "민원지도 · 두 번째부터 열기" : "민원지도 · 첫 열기";
    mapOpened = true;
  }
  perfTime(name, { done: () => done?.() });
}

/** 민원지도 [로드뷰]를 누른 때 – 로드뷰 칸이 생기고 바뀜이 멈출 때까지 */
export function perfRoadview(): void {
  perfTime("민원지도 · 로드뷰 열기", { until: ".mp-rv" });
}
