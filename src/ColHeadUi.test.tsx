// 화면 부품 시험(품질 보완 ③ ✔4): 머리 줄 열 폭 – 손잡이 끌기·두 번 누르기·우클릭 메뉴(헤더 열 조정 통일 10-28 ①②③④).
// 끄는 동안 다시 그리기·저장값 읽기 전은 ColHead.test.ts가 보고, 여기는 사용자가 하는 동작마다 저장되는 값.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("./api", () => ({ api: store }));

import { useColHead } from "./ColHead";
import { ColDef, fitPx, minOf } from "./cols";

const COLS: ColDef[] = [
  { id: "a", init: 100, label: "제목" },
  { id: "b", init: 120, label: "내용" },
  { id: "c", init: 60, fixed: true },
];

function View() {
  const head = useColHead({ store: "t.cols", cols: COLS, measure: (id) => (id === "a" ? 55 : 200) });
  return (
    <div>
      <div role="row" aria-label="머리 줄" onContextMenu={head.onContextMenu}>
        {COLS.map((c) => (
          <div key={c.id} data-testid={"h-" + c.id} style={{ width: head.width(c.id) }}>
            {c.label}
            {head.grip(c.id)}
          </div>
        ))}
      </div>
      {head.menu()}
    </div>
  );
}

async function mount(saved: string | null = null) {
  store.get.mockResolvedValue(saved);
  await act(async () => void render(<View />));
}
const saved = () => JSON.parse(store.set.mock.calls.at(-1)![1]);
const width = (id: string) => (screen.getByTestId("h-" + id) as HTMLElement).style.width;
const mouse = (t: EventTarget, type: string, x: number) =>
  act(() => void t.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 })));

beforeEach(() => {
  store.get.mockReset();
  store.set.mockReset();
  store.set.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("ColHead 동작", () => {
  it("고정 열은 손잡이가 없어요", async () => {
    await mount();
    expect(screen.getAllByRole("separator").map((g) => g.getAttribute("aria-label"))).toEqual(["제목 열 폭", "내용 열 폭"]);
  });

  it("끌면 그 열만 바뀌고 손을 떼면 그 열만 px로 저장", async () => {
    await mount();
    const g = screen.getByLabelText("제목 열 폭");
    await mouse(g, "mousedown", 0);
    await mouse(document, "mousemove", 40);
    await mouse(document, "mouseup", 40);
    expect(saved()).toEqual({ a: 140 });
    expect(width("a")).toBe("140px");
    expect(width("b")).toBe("120px");
  });

  it("가장 좁게보다 줄지 않아요", async () => {
    await mount();
    const g = screen.getByLabelText("제목 열 폭");
    await mouse(g, "mousedown", 0);
    await mouse(document, "mousemove", -500);
    await mouse(document, "mouseup", -500);
    expect(saved()).toEqual({ a: minOf(COLS[0]) });
  });

  it("손잡이 두 번 누르기 = 그 열을 내용에 맞춤", async () => {
    await mount();
    await act(async () => void fireEvent.doubleClick(screen.getByLabelText("제목 열 폭")));
    expect(saved()).toEqual({ a: fitPx(COLS[0], 55) });
  });

  it("머리 줄 우클릭 메뉴 – 내용에 맞춤(모든 열)", async () => {
    await mount();
    await act(async () => void fireEvent.contextMenu(screen.getByRole("row", { name: "머리 줄" }), { clientX: 10, clientY: 10 }));
    await act(async () => void fireEvent.click(screen.getByRole("menuitem", { name: "내용에 맞춤(모든 열)" })));
    expect(saved()).toEqual({ a: fitPx(COLS[0], 55), b: fitPx(COLS[1], 200) });
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("머리 줄 우클릭 메뉴 – 처음 폭으로", async () => {
    await mount(JSON.stringify({ a: 180, b: 90 }));
    expect(width("a")).toBe("180px");
    await act(async () => void fireEvent.contextMenu(screen.getByRole("row", { name: "머리 줄" }), { clientX: 10, clientY: 10 }));
    await act(async () => void fireEvent.click(screen.getByRole("menuitem", { name: "처음 폭으로" })));
    expect(saved()).toEqual({});
    expect(width("a")).toBe("100px");
  });

  it("메뉴는 Esc로 닫혀요", async () => {
    await mount();
    await act(async () => void fireEvent.contextMenu(screen.getByRole("row", { name: "머리 줄" }), { clientX: 10, clientY: 10 }));
    await act(async () => void fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" }));
    expect(screen.queryByRole("menuitem")).toBeNull();
    expect(store.set).not.toHaveBeenCalled();
  });
});
