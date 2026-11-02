// 화면 부품 시험: 캘린더 빠른 입력 줄의 Tab – 제목 Tab은 종류 칸으로, 종류 칸 Tab·Enter는 등록, 등록 뒤 커서는 날짜 칸(QC CA-03).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QuickRow } from "./Dialogs";
import { CalKind, EventInput } from "../../api";

afterEach(cleanup);

const kinds: CalKind[] = [
  { id: 1, name: "업무", color: 3, visible: true, system: "", ord: 0 },
  { id: 2, name: "개인", color: 5, visible: true, system: "", ord: 1 },
];

function setup() {
  const added: EventInput[] = [];
  const onAdd = vi.fn(async (i: EventInput) => (added.push(i), true));
  render(<QuickRow sel="2026-11-05" kinds={kinds} onSel={() => {}} onAdd={onAdd} onDetail={() => {}} />);
  const date = screen.getByLabelText("날짜") as HTMLInputElement;
  const title = screen.getByLabelText("일정 제목") as HTMLInputElement;
  const kind = screen.getByRole("button", { name: /캘린더 종류/ }) as HTMLButtonElement;
  return { added, date, title, kind };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 25ms 안에 두 번 들어온 Tab은 keys.ts가 하나로 봐요 – Tab마다 30ms 쉬고 쳐요.
const tab = async (el: Element, shift = false) => {
  await wait(30);
  fireEvent.keyDown(el, { key: "Tab", code: "Tab", shiftKey: shift });
};

describe("QuickRow – 빠른 입력 Tab", () => {
  it("제목에서 Tab은 등록이 아니라 종류 칸으로 가요", async () => {
    const { added, title, kind } = setup();
    fireEvent.change(title, { target: { value: "현장 점검" } });
    await act(() => tab(title));
    expect(document.activeElement).toBe(kind);
    expect(added).toHaveLength(0);
  });

  it("종류 칸에서 Tab이면 등록하고 커서는 날짜 칸으로", async () => {
    const { added, date, title, kind } = setup();
    fireEvent.change(title, { target: { value: "현장 점검" } });
    kind.focus();
    await act(() => tab(kind));
    expect(added).toHaveLength(1);
    expect(added[0].title).toBe("현장 점검");
    expect(added[0].date).toBe("2026-11-05");
    expect(document.activeElement).toBe(date);
    expect(title.value).toBe("");
  });

  it("종류 칸에서 Enter도 등록, Shift+Tab은 제목으로", async () => {
    const { added, title, kind } = setup();
    kind.focus();
    await act(() => tab(kind, true));
    expect(document.activeElement).toBe(title);
    kind.focus();
    await act(async () => void fireEvent.keyDown(kind, { key: "Enter", code: "Enter" }));
    expect(added).toHaveLength(1);
  });

  it("종류 목록이 열려 있으면 Tab은 확정이고 등록은 한 번 더", async () => {
    const { added, kind } = setup();
    kind.focus();
    fireEvent.keyDown(kind, { key: "ArrowDown", code: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    await act(() => tab(kind));
    expect(added).toHaveLength(0);
    expect(screen.queryByRole("listbox")).toBeNull();
    await act(() => tab(kind));
    expect(added).toHaveLength(1);
  });
});
