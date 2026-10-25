// 엔터규칙 (2026-10-17 사용자 – CLAUDE.md "엔터규칙", 시안 KeySettings.dc.html)
//
// 모든 화면이 같은 키 규칙을 써요. 화면은 keyAction(e, 쓰는 곳)이 돌려주는 동작 이름만 보고 움직여요.
// 키는 설정 "키 설정"에서 동작마다 바꿀 수 있어요(암호화 파일 settings의 keys). 고를 수 있는 키는
// Enter·Tab·Esc와 Shift·Ctrl·왼쪽 Alt 조합뿐이에요. 오른쪽 Alt는 한/영 키라 쓰지 않아요.
//
// 쓰는 곳(묶음)
//   common 공통 – 다음 칸(마지막 칸이면 저장·등록) · 앞 칸 · 취소
//   multi  여러 줄 칸 – 민원 내용·조치내용, 메모 창, 할 일 세부정보, 일정 설명, 메모 편집기 글머리 목록
//   talk   업무일지 말 줄
//   single 한 줄 칸
//   table  메모 편집기 표
//   para   메모 편집기 보통 문단
// 같은 키가 "그 묶음 + 공통" 안에서 두 동작에 걸리면 겹침이에요(저장하지 않아요).

import type { KeyboardEvent as RKeyboardEvent } from "react";

export type Scope = "common" | "multi" | "talk" | "single" | "table" | "para";

export type Action =
  | "common.next"
  | "common.prev"
  | "common.cancel"
  | "multi.same"
  | "multi.down"
  | "multi.up"
  | "multi.br"
  | "talk.next"
  | "talk.same"
  | "talk.br"
  | "single.next"
  | "table.next"
  | "table.down"
  | "table.up"
  | "table.br"
  | "para.next"
  | "para.list";

export type KeyMap = Record<Action, string>;

/** 설정 카드에 보이는 순서·이름과 처음 키 */
export const KEY_GROUPS: { scope: Scope; title: string; rows: [Action, string, string][] }[] = [
  {
    scope: "common",
    title: "공통",
    rows: [
      ["common.next", "다음 칸 · 마지막 칸이면 저장", "Tab"],
      ["common.prev", "앞 칸", "Shift+Tab"],
      ["common.cancel", "취소", "Esc"],
    ],
  },
  {
    scope: "multi",
    title: "여러 줄 칸",
    rows: [
      ["multi.same", "같은 위계로 다음 줄", "Enter"],
      ["multi.down", "한 위계 아래로 새 줄", "Shift+Enter"],
      ["multi.up", "한 위계 위로 새 줄", "Ctrl+Enter"],
      ["multi.br", "항목 안 줄 바꿈", "Alt+Enter"],
    ],
  },
  {
    scope: "talk",
    title: "업무일지 말 줄",
    rows: [
      ["talk.next", "다음 말 (사람 바꾸기)", "Enter"],
      ["talk.same", "같은 사람이 이어서", "Shift+Enter"],
      ["talk.br", "한 말 안 줄 바꿈", "Alt+Enter"],
    ],
  },
  { scope: "single", title: "한 줄 칸", rows: [["single.next", "다음 칸 · 마지막 칸이면 등록", "Enter"]] },
  {
    scope: "table",
    title: "메모 편집기 표",
    rows: [
      ["table.next", "다음 칸", "Enter"],
      ["table.down", "아래 칸", "Shift+Enter"],
      ["table.up", "위 칸", "Ctrl+Enter"],
      ["table.br", "칸 안 줄 바꿈", "Alt+Enter"],
    ],
  },
  {
    scope: "para",
    title: "메모 편집기 보통 문단",
    rows: [
      ["para.next", "다음 문단", "Enter"],
      ["para.list", "● 목록 시작", "Shift+Enter"],
    ],
  },
];

export const DEFAULT_KEYS: KeyMap = Object.fromEntries(KEY_GROUPS.flatMap((g) => g.rows.map(([a, , k]) => [a, k]))) as KeyMap;

const scopeOfAction = (a: Action) => a.split(".")[0] as Scope;

/** 저장된 키(일부만 있어도 돼요)를 처음 키와 합쳐요. 모르는 동작·모양이 아닌 키는 버려요. */
export function mergeKeys(saved?: Partial<Record<string, string>> | null): KeyMap {
  const m = { ...DEFAULT_KEYS };
  if (saved && typeof saved === "object") {
    for (const a of Object.keys(m) as Action[]) {
      const v = saved[a];
      if (typeof v === "string" && (v === "" || parseKey(v))) m[a] = v;
    }
  }
  return m;
}

/** 처음 키와 다른 것만 (저장용) */
export function diffKeys(m: KeyMap): Partial<KeyMap> {
  const out: Partial<KeyMap> = {};
  for (const a of Object.keys(DEFAULT_KEYS) as Action[]) if (m[a] !== DEFAULT_KEYS[a]) out[a] = m[a];
  return out;
}

/** 겹치는 동작들 – 같은 묶음 + 공통 안에서 같은 키 */
export function conflicts(m: KeyMap): Set<Action> {
  const bad = new Set<Action>();
  const common = KEY_GROUPS[0].rows.map((r) => r[0]);
  for (const g of KEY_GROUPS) {
    const scope = g.scope === "common" ? common : [...common, ...g.rows.map((r) => r[0])];
    for (const a of scope)
      for (const b of scope) if (a !== b && m[a] && m[a] === m[b]) (bad.add(a), bad.add(b));
  }
  return bad;
}

// ---------- 지금 쓰는 키 ----------

let current: KeyMap = { ...DEFAULT_KEYS };
/** key 이름 → 동작들 (묶음마다 하나) */
let index = new Map<string, Action[]>();
rebuild();

function rebuild() {
  index = new Map();
  for (const [a, k] of Object.entries(current) as [Action, string][]) {
    if (!k) continue;
    index.set(k, [...(index.get(k) ?? []), a]);
  }
}

/** 설정을 읽거나 바꿨을 때 불러요. 겹치는 키는 쓰지 않아요(그 전 키 그대로). */
export function setKeyMap(saved?: Partial<Record<string, string>> | null) {
  const m = mergeKeys(saved);
  if (conflicts(m).size) return;
  current = m;
  rebuild();
}

export const keyMap = () => current;

// ---------- 키 이름 ----------

const MAIN: Record<string, string> = { Enter: "Enter", NumpadEnter: "Enter", Tab: "Tab", Escape: "Esc", Esc: "Esc" };

/** "Ctrl+Shift+Alt+Enter" 꼴을 나눠요. 모양이 아니면 null */
export function parseKey(k: string): { ctrl: boolean; shift: boolean; alt: boolean; main: string } | null {
  const parts = k.split("+");
  const main = parts.pop() ?? "";
  if (!["Enter", "Tab", "Esc"].includes(main)) return null;
  const mods = new Set(parts);
  for (const p of mods) if (!["Ctrl", "Shift", "Alt"].includes(p)) return null;
  return { ctrl: mods.has("Ctrl"), shift: mods.has("Shift"), alt: mods.has("Alt"), main };
}

// 오른쪽 Alt를 누르고 있는지 (윈도우 한글 자판에서는 한/영 키예요)
let rightAlt = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    // 한/영 키(HangulMode)로 들어오면 Alt가 아니라서 셈하지 않아요. 떼는 소식을 놓쳐도 Alt 없이 누른 키가 오면 풀어요.
    if ((e.code === "AltRight" && e.key === "Alt") || e.key === "AltGraph") rightAlt = true;
    else if (!e.altKey) rightAlt = false;
  }, true);
  window.addEventListener("keyup", (e) => {
    if (e.code === "AltRight" || e.key === "AltGraph") rightAlt = false;
  }, true);
  window.addEventListener("blur", () => (rightAlt = false));
}

type AnyKey = KeyboardEvent | RKeyboardEvent;
const native = (e: AnyKey): KeyboardEvent => ("nativeEvent" in e ? e.nativeEvent : e);

/** 오른쪽 Alt(한/영 키)인지 */
export function isRightAlt(e: AnyKey) {
  const n = native(e);
  return n.code === "AltRight" || n.key === "AltGraph" || n.key === "HangulMode" || n.key === "Hangul" || (n.altKey && rightAlt);
}

/**
 * 누른 키의 이름("Shift+Enter"). Enter·Tab·Esc가 아니거나 오른쪽 Alt와 함께면 null.
 * 한글 조합 중에는 브라우저가 키를 "Process"로 줄 때가 있어 실제 키 자리(code)도 봐요.
 */
export function keyName(e: AnyKey): string | null {
  const n = native(e);
  const main = MAIN[n.key] ?? (n.key === "Process" || n.key === "Unidentified" ? MAIN[n.code] : undefined);
  if (!main) return null;
  if (n.altKey && rightAlt) return null;
  return (n.ctrlKey || n.metaKey ? "Ctrl+" : "") + (n.shiftKey ? "Shift+" : "") + (n.altKey ? "Alt+" : "") + main;
}

const composing = (n: KeyboardEvent) => n.isComposing || n.keyCode === 229;

// 같은 Tab이 두 번 들어오는 경우(한글 조합 중)를 한 번만 받아요. 첫 Tab이 칸을 옮기면 두 번째는 새 칸에 들어와서
// 화면 전체에서 하나로 봐요.
let lastTab = { at: -1, ev: null as KeyboardEvent | null };

/** 한글 조합 중 Tab을 받아 둔 칸(조합이 이 칸에 확정되면 다시 보내요 – rowKeys) */
let pendingTab: { from: HTMLElement; cancel: () => void } | null = null;
/** 다시 보내는 Tab을 처리하는 중 */
let replaying = false;

/**
 * 한자·특수문자 목록이 열려 있는지(2026-10-25 사용자 – 자음 + 한자 키로 특수문자 목록을 열고 Tab으로 목록을 옆으로 펼쳐요).
 * 조합 중에 한자 키를 누르면 켜고, 그 조합이 끝나면(글자를 고르면) 꺼요. 켜져 있는 동안 Tab은 입력기에 넘겨요.
 */
let hanjaOpen = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "HanjaMode" || e.code === "Lang2" || e.keyCode === 25) hanjaOpen = true;
    },
    true,
  );
  document.addEventListener("compositionend", () => (hanjaOpen = false), true);
  window.addEventListener("blur", () => (hanjaOpen = false));
}

/** 받아 둔 Tab을 같은 칸에 다시 보내요(칸의 키 처리 – 후보 확정 등 – 와 줄의 다음 칸 옮기기를 평소처럼 거쳐요). */
function replayTab(from: HTMLElement, shift: boolean) {
  if (!from.isConnected || document.activeElement !== from) return;
  replaying = true;
  try {
    from.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", keyCode: 9, shiftKey: shift, bubbles: true, cancelable: true }));
  } finally {
    replaying = false;
  }
}

/**
 * 이 키가 이 쓰는 곳(scope)에서 무슨 동작인지. 그 묶음 동작이 먼저, 없으면 공통 동작이에요.
 * - 한글 조합 중 Enter·Esc는 null(입력기가 글자를 마친 뒤 Enter가 한 번 더 들어와요).
 * - 한글 조합 중 Tab은 받아요. 두 번 들어온 Tab은 두 번째를 막고 null이에요.
 */
export function keyAction(e: AnyKey, scope: Scope): Action | null {
  const n = native(e);
  const name = keyName(e);
  if (!name) return null;
  const isTab = name.endsWith("Tab");
  if (composing(n) && !isTab) return null;
  if (isTab) {
    if (replaying) {
      // 조합을 마친 뒤 다시 보낸 Tab이에요(rowKeys) – 두 번 들어온 Tab으로 막지 않아요.
      lastTab = { at: n.timeStamp, ev: n };
    } else if (lastTab.ev === n) {
      // 같은 키를 다른 칸이 다시 보는 것(위로 올라온 것)이에요.
    } else if (n.timeStamp - lastTab.at < 25) {
      e.preventDefault();
      return null;
    } else lastTab = { at: n.timeStamp, ev: n };
  }
  const acts = index.get(name);
  if (!acts) return null;
  return acts.find((a) => scopeOfAction(a) === scope) ?? acts.find((a) => scopeOfAction(a) === "common") ?? null;
}

/** 이 키가 이 동작인지 (취소 등 하나만 볼 때) */
export function isKey(e: AnyKey, action: Action): boolean {
  return keyAction(e, scopeOfAction(action)) === action;
}

/** 화면 안내 글에 쓰는 지금 키 이름 ("Alt"는 "왼쪽 Alt"로 따로 말하지 않아요) */
export const keyLabel = (a: Action) => current[a] || "없음";

// ---------- 한 줄 칸 이동 ----------

/** 칸이 여러 줄 칸(BulletEditor)이면 "multi", 아니면 "single" */
export function fieldScope(el: EventTarget | null): Scope {
  return el instanceof Element && el.closest(".bl-ed") ? "multi" : "single";
}

/** 줄(row) 안의 칸들. 여러 줄 칸은 첫 줄 하나로 셈해요. 단추·tabIndex -1·숨은 칸은 빼요. */
export function fieldsOf(row: HTMLElement): HTMLElement[] {
  const all = row.querySelectorAll<HTMLElement>("input, textarea, select, [contenteditable='true']");
  const out: HTMLElement[] = [];
  const seen = new Set<Element>();
  for (const el of all) {
    if ((el as HTMLInputElement).disabled || el.tabIndex < 0) continue;
    if (el instanceof HTMLInputElement && ["hidden", "file", "checkbox", "radio", "button"].includes(el.type)) continue;
    if (!el.getClientRects().length) continue;
    const group = el.closest(".bl-ed");
    if (group) {
      if (seen.has(group)) continue;
      seen.add(group);
    }
    out.push(el);
  }
  return out;
}

function fieldIndex(fields: HTMLElement[], el: Element) {
  const group = el.closest(".bl-ed");
  return fields.findIndex((f) => f === el || (group && group.contains(f)));
}

/** 다음(1)·앞(-1) 칸으로 커서를 옮겨요. 더 갈 칸이 없으면 false */
export function moveField(row: HTMLElement, from: Element, dir: 1 | -1): boolean {
  const fields = fieldsOf(row);
  const i = fieldIndex(fields, from);
  const to = fields[i + dir];
  if (i < 0 || !to) return false;
  to.focus();
  if (to instanceof HTMLInputElement || to instanceof HTMLTextAreaElement) {
    try {
      const at = dir === 1 && to.closest(".bl-ed") ? 0 : to.value.length;
      to.setSelectionRange(at, at);
    } catch {
      /* 고를 수 없는 칸 */
    }
  }
  return true;
}

/**
 * 입력 줄(신규·고치는 줄, 창)의 키. 다음 칸(공통 Tab·한 줄 칸 Enter) → 다음 칸, 마지막 칸이면 submit.
 * 앞 칸(Shift+Tab) → 앞 칸. 다룬 키면 true.
 * 칸이 이미 처리한 키(후보 목록 확정 등 – defaultPrevented)는 보지 않아요.
 */
export function rowKeys(e: RKeyboardEvent, row: HTMLElement | null, submit: () => void, move?: (dir: 1 | -1) => boolean): boolean {
  if (!row || e.defaultPrevented) return false;
  // 한자·특수문자 목록이 열려 있으면 Tab은 입력기 것(목록 펼치기)이에요 – 칸을 옮기지 않아요.
  if (hanjaOpen && composing(e.nativeEvent) && keyName(e)?.endsWith("Tab")) return false;
  // 단추 등 칸이 아닌 곳은 브라우저 기본(단추 Enter = 누르기, Tab = 다음 단추)이에요.
  if (!(e.target instanceof Element) || !e.target.matches("input, textarea, select, [contenteditable='true']")) return false;
  const from = e.target as HTMLElement;
  if (pendingTab && pendingTab.from === from && !composing(e.nativeEvent) && keyName(e)?.endsWith("Tab")) {
    // 같은 Tab이 한 번 더 들어왔어요(조합 중 Tab 뒤에 오는 것) – 글자가 이 칸에 확정된 뒤 다시 보내는 Tab이 움직여요.
    e.preventDefault();
    return true;
  }
  const a = keyAction(e, fieldScope(e.target));
  // 한글 조합 중 Tab(2026-10-21 사용자 신고 – 접수유형 "국"을 치고 Tab → 접수일 칸에 "2026-10-21국"):
  // 윈도우는 Tab 키(229)를 화면에 먼저 주고, 그 뒤에 조합하던 글자를 "지금 커서가 있는 칸"에 확정해요.
  // 그 사이에 칸을 옮기면 마지막 글자가 다음 칸으로 따라가요. 그래서 조합 중 Tab은 칸을 바로 옮기지 않고,
  // 글자가 이 칸에 확정된 뒤(compositionend) 같은 Tab을 한 번 더 보내 평소처럼 움직여요(그때는 칸의 최신 값으로).
  if ((a === "common.next" || a === "single.next" || a === "common.prev") && composing(e.nativeEvent)) {
    e.preventDefault();
    if (pendingTab?.from !== from) {
      pendingTab?.cancel();
      const shift = e.shiftKey;
      const done = () => {
        if (pendingTab?.from !== from) return;
        pendingTab.cancel();
        // 확정한 글자가 화면 값에 들어간 다음에 보내요.
        window.setTimeout(() => replayTab(from, shift), 0);
      };
      const timer = window.setTimeout(done, 150);
      from.addEventListener("compositionend", done, { once: true });
      pendingTab = {
        from,
        cancel: () => {
          window.clearTimeout(timer);
          from.removeEventListener("compositionend", done);
          pendingTab = null;
        },
      };
    }
    return true;
  }
  // move: 칸 하나만 고치는 줄처럼 다음 칸을 줄이 직접 여는 곳(민원대장 – 2026-10-25)
  const go = (dir: 1 | -1) => (move ? move(dir) : moveField(row, e.target as Element, dir));
  if (a === "common.next" || a === "single.next") {
    e.preventDefault();
    if (!go(1)) submit();
    return true;
  }
  if (a === "common.prev") {
    e.preventDefault();
    go(-1);
    return true;
  }
  return false;
}
