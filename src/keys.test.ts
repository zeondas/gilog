// 키 규칙 시험 – 지금 동작을 고정해요(정리 2차 2026-10-26): 키 이름·처음 키·겹침·한 줄 칸 키,
// 한글 조합 중 Tab(결정 로그 10-21 14:20 – 글자가 이 칸에 확정된 뒤 옮김), 한자 목록이 열린 동안 Tab은 입력기 것(10-25 20:13).
import { afterEach, describe, expect, test } from "vitest";
import type { KeyboardEvent as RKeyboardEvent } from "react";
import { conflicts, DEFAULT_KEYS, keyAction, keyName, mergeKeys, parseKey, rowKeys } from "./keys";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** React 키 이벤트 흉내(rowKeys·keyAction이 보는 것만) */
const R = (n: KeyboardEvent, target: EventTarget) =>
  ({ nativeEvent: n, target, get defaultPrevented() { return n.defaultPrevented; }, preventDefault: () => n.preventDefault(), shiftKey: n.shiftKey, key: n.key }) as unknown as RKeyboardEvent;
const key = (k: string, o: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: k, code: k === "Enter" ? "Enter" : k === "Tab" ? "Tab" : k, bubbles: true, cancelable: true, ...o });

describe("키 이름·처음 키", () => {
  test("parseKey", () => {
    expect(parseKey("Shift+Enter")).toEqual({ ctrl: false, shift: true, alt: false, main: "Enter" });
    expect(parseKey("Ctrl+L")).toEqual({ ctrl: true, shift: false, alt: false, main: "L" });
    expect(parseKey("L")).toBeNull(); // 글자 키는 Ctrl·왼쪽 Alt와 함께일 때만
    expect(parseKey("Meta+Enter")).toBeNull();
  });
  test("처음 키 – 엔터규칙", () => {
    expect(DEFAULT_KEYS).toMatchObject({
      "common.next": "Tab", "common.prev": "Shift+Tab", "common.cancel": "Esc",
      "multi.same": "Enter", "multi.down": "Shift+Enter", "multi.up": "Ctrl+Enter", "multi.br": "Alt+Enter",
      "talk.next": "Enter", "talk.same": "Shift+Enter", "talk.br": "Alt+Enter",
      "single.next": "Enter", "para.list": "Shift+Enter", "app.lock": "Ctrl+L",
    });
  });
  test("mergeKeys – 모르는 동작·모양이 아닌 키·글자 키(앱 묶음 밖)는 버려요", () => {
    const m = mergeKeys({ "multi.br": "Ctrl+Shift+Enter", "multi.same": "Ctrl+K", bogus: "Tab", "talk.next": "x" });
    expect([m["multi.br"], m["multi.same"], m["talk.next"]]).toEqual(["Ctrl+Shift+Enter", "Enter", "Enter"]);
    expect(mergeKeys({ "app.lock": "Alt+K" })["app.lock"]).toBe("Alt+K");
  });
  test("conflicts – 같은 묶음 + 공통 안에서 같은 키", () => {
    expect(conflicts(DEFAULT_KEYS).size).toBe(0);
    expect([...conflicts(mergeKeys({ "multi.down": "Tab" }))].sort()).toEqual(["common.next", "multi.down"]);
  });
  test("keyName – 조합 중 Process 키는 자리(code)로", () => {
    const t = document.body;
    expect(keyName(R(key("Enter", { shiftKey: true }), t))).toBe("Shift+Enter");
    expect(keyName(R(key("Process", { code: "Tab" }), t))).toBe("Tab");
    expect(keyName(R(key("a"), t))).toBeNull();
  });
  test("keyAction – 그 묶음 동작이 먼저, 없으면 공통, 조합 중 Enter는 null", async () => {
    const t = document.body;
    expect(keyAction(R(key("Enter"), t), "multi")).toBe("multi.same");
    expect(keyAction(R(key("Enter"), t), "talk")).toBe("talk.next");
    expect(keyAction(R(key("Esc"), t), "multi")).toBe("common.cancel");
    expect(keyAction(R(key("Enter", { isComposing: true }), t), "single")).toBeNull();
    await wait(30);
    expect(keyAction(R(key("Tab"), t), "multi")).toBe("common.next");
  });
});

describe("rowKeys – 입력 줄", () => {
  let row: HTMLElement;
  let a: HTMLInputElement;
  const moves: number[] = [];
  let submitted = 0;
  const setup = () => {
    document.body.innerHTML = "";
    row = document.createElement("div");
    a = document.createElement("input");
    row.append(a, document.createElement("input"));
    document.body.append(row);
    moves.length = 0;
    submitted = 0;
    // 칸의 keydown이 React처럼 rowKeys를 불러요(다시 보내는 Tab도 이 길로 와요).
    a.addEventListener("keydown", (n) => rowKeys(R(n, a), row, () => submitted++, (d) => (moves.push(d), true)));
    a.focus();
  };
  const press = (n: KeyboardEvent) => a.dispatchEvent(n);
  afterEach(() => wait(30));

  test("Tab = 다음 칸, Shift+Tab = 앞 칸, 한 줄 칸 Enter = 다음 칸", async () => {
    setup();
    await wait(30); // 25ms 안에 두 번 들어온 Tab은 하나로 봐요
    press(key("Tab"));
    await wait(30);
    press(key("Tab", { shiftKey: true }));
    await wait(30);
    press(key("Enter"));
    expect(moves).toEqual([1, -1, 1]);
  });

  test("한글 조합 중 Tab은 글자가 확정된 뒤(compositionend) 한 번만 옮겨요", async () => {
    setup();
    await wait(30);
    const n = key("Tab", { isComposing: true, keyCode: 229 } as KeyboardEventInit);
    press(n);
    expect(n.defaultPrevented).toBe(true);
    expect(moves).toEqual([]);
    a.dispatchEvent(new CompositionEvent("compositionend", { data: "국" }));
    await wait(10);
    expect(moves).toEqual([1]);
  });

  test("조합 중 Tab은 확정 소식이 없어도 150ms 뒤에 옮겨요", async () => {
    setup();
    await wait(30);
    press(key("Tab", { isComposing: true }));
    await wait(60);
    expect(moves).toEqual([]);
    await wait(150);
    expect(moves).toEqual([1]);
  });

  test("한자 키로 특수문자 목록이 열린 동안 조합 중 Tab은 입력기 것", async () => {
    setup();
    await wait(30);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "HanjaMode", code: "Lang2" }));
    const n = key("Tab", { isComposing: true });
    press(n);
    expect(n.defaultPrevented).toBe(false);
    await wait(200);
    expect(moves).toEqual([]);
    document.dispatchEvent(new CompositionEvent("compositionend", { data: "※" }));
    await wait(30);
    press(key("Tab"));
    expect(moves).toEqual([1]);
  });

  test("단추 등 칸이 아닌 곳은 건드리지 않아요", () => {
    setup();
    const b = document.createElement("button");
    row.append(b);
    expect(rowKeys(R(key("Enter"), b), row, () => submitted++)).toBe(false);
    expect(submitted).toBe(0);
  });
});
