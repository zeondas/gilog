// 머리 줄 열 폭 공통 부품(useColHead) 시험 – cols 최적화(2026-10-29):
// 3. 끄는 동안 live가 있으면 화면을 다시 그리지 않고, 손을 떼면 한 번 저장·다시 그려요.
// 5. 저장값을 다 읽기 전에는 끌기·두 번 누르기가 시작되지 않아요(늦게 온 저장값이 끈 값을 덮지 않게).
import { createElement, act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("./api", () => ({ api: store }));

import { ColHead, useColHead } from "./ColHead";
import type { ColDef } from "./cols";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLS: ColDef[] = [
  { id: "a", init: 100 },
  { id: "b", init: 120 },
];

let box: HTMLDivElement;
let root: Root;
let renders = 0;
let head: ColHead;
let liveCalls: number[] = [];

function View({ live }: { live: boolean }) {
  renders++;
  head = useColHead({
    store: "t.cols",
    cols: COLS,
    measure: () => 55,
    live: live ? (w) => liveCalls.push(w("a")) : undefined,
  });
  return createElement("div", { className: "colh-row" }, createElement("div", { className: "h" }, head.grip("a")));
}

async function mount(live: boolean) {
  await act(async () => {
    root.render(createElement(View, { live }));
  });
}

const grip = () => box.querySelector<HTMLElement>(".colh-grip")!;
const mouse = (t: EventTarget, type: string, x: number) => t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 }));
/** 다음 화면 그리기까지 */
const frame = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));

beforeEach(() => {
  box = document.createElement("div");
  document.body.appendChild(box);
  root = createRoot(box);
  renders = 0;
  liveCalls = [];
  store.get.mockReset();
  store.set.mockReset();
  store.set.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

describe("끄는 동안(cols 최적화 3)", () => {
  it("live가 있으면 움직여도 다시 그리지 않고, 손을 떼면 한 번 저장", async () => {
    store.get.mockResolvedValue(JSON.stringify({ b: 150 }));
    await mount(true);
    expect(head.loaded).toBe(true);
    const before = renders;
    await act(async () => {
      mouse(grip(), "mousedown", 0);
    });
    for (const x of [10, 20, 30]) {
      await act(async () => {
        mouse(document, "mousemove", x);
      });
      await frame();
    }
    expect(renders).toBe(before);
    expect(liveCalls.at(-1)).toBe(130);
    expect(head.committed).toEqual({ b: 150 });
    await act(async () => {
      mouse(document, "mouseup", 30);
    });
    expect(head.committed).toEqual({ a: 130, b: 150 });
    expect(head.width("a")).toBe(130);
    expect(store.set).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.set.mock.calls[0][1])).toEqual({ a: 130, b: 150 });
  });

  it("live가 없으면 끄는 폭이 보이지만 저장값(committed)은 손을 뗄 때만 바뀌어요", async () => {
    store.get.mockResolvedValue("{}");
    await mount(false);
    await act(async () => {
      mouse(grip(), "mousedown", 0);
      mouse(document, "mousemove", -20);
    });
    await frame();
    expect(head.width("a")).toBe(80);
    expect(head.committed).toEqual({});
    expect(store.set).not.toHaveBeenCalled();
    await act(async () => {
      mouse(document, "mouseup", -20);
    });
    expect(head.committed).toEqual({ a: 80 });
  });
});

describe("저장값 읽기 전(cols 최적화 5)", () => {
  it("읽기 전 끌기·두 번 누르기는 무시하고, 늦게 온 저장값이 그대로 보여요", async () => {
    let done!: (v: string) => void;
    store.get.mockReturnValue(new Promise<string>((r) => (done = r)));
    await mount(true);
    expect(head.loaded).toBe(false);
    await act(async () => {
      mouse(grip(), "mousedown", 0);
      mouse(document, "mousemove", 50);
      mouse(document, "mouseup", 50);
      grip().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    await frame();
    expect(liveCalls).toEqual([]);
    expect(store.set).not.toHaveBeenCalled();
    head.fitAll();
    head.reset();
    expect(store.set).not.toHaveBeenCalled();
    await act(async () => {
      done(JSON.stringify({ a: 210 }));
    });
    expect(head.loaded).toBe(true);
    expect(head.width("a")).toBe(210);
    // 읽은 뒤에는 돼요 – 맞춤 = 내용 55 + 여유 4
    await act(async () => {
      grip().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });
    expect(head.committed).toEqual({ a: 59 });
  });
});
