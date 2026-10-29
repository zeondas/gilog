// 화면 부품 시험(품질 보완 ③ ✔4): 해 묶음 [◀ 2026년 ▶] – "2026년"을 누르면 입력 칸(2026-10-29 집행현황 ✔2).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { YearNav } from "./YearNav";

afterEach(cleanup);

function setup(year = 2026) {
  const onChange = vi.fn();
  render(<YearNav year={year} onChange={onChange} />);
  return onChange;
}
const field = () => screen.getByLabelText("해") as HTMLInputElement;
const openField = () => fireEvent.click(screen.getByText("2026년"));

describe("YearNav", () => {
  it("◀ ▶는 한 해씩", () => {
    const onChange = setup();
    fireEvent.click(screen.getByLabelText("이전 해"));
    fireEvent.click(screen.getByLabelText("다음 해"));
    expect(onChange.mock.calls).toEqual([[2025], [2027]]);
  });

  it("글자를 누르면 입력 칸, 네 자리 + Enter면 그 해", () => {
    const onChange = setup();
    openField();
    expect(field().value).toBe("2026");
    fireEvent.change(field(), { target: { value: "2028" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(2028);
    expect(screen.queryByLabelText("해")).toBeNull();
  });

  it("두 자리는 2000년대, Tab도 확정", () => {
    const onChange = setup();
    openField();
    fireEvent.change(field(), { target: { value: "24" } });
    fireEvent.keyDown(field(), { key: "Tab" });
    expect(onChange).toHaveBeenCalledWith(2024);
  });

  it("바깥을 누르면(칸을 떠나면) 확정", () => {
    const onChange = setup();
    openField();
    fireEvent.change(field(), { target: { value: "2030" } });
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith(2030);
  });

  it("Esc는 취소", () => {
    const onChange = setup();
    openField();
    fireEvent.change(field(), { target: { value: "2030" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("2026년")).toBeTruthy();
  });

  it("읽을 수 없으면 빨간 테두리로 남아요", () => {
    const onChange = setup();
    openField();
    fireEvent.change(field(), { target: { value: "203" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(field().className).toContain("bad");
  });

  it("숫자 말고 글자는 들어가지 않아요(네 자리까지)", () => {
    setup();
    openField();
    fireEvent.change(field(), { target: { value: "2a0b27x9" } });
    expect(field().value).toBe("2027");
  });

  it("같은 해면 바꾸지 않아요", () => {
    const onChange = setup();
    openField();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
