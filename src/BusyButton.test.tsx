// 느린 단추(10-30 22:47): 누르면 "…하는 중"·잠김, 두 번 눌러도 한 번만, 10초 넘으면 한 줄, 끝나면 ✓ 5초·실패는 남음.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BusyButton, BusyNote, FLASH_MS, LATE_MS, LATE_TEXT, useBusy } from "./BusyButton";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Box({ job, done = "끊었어요" }: { job: () => Promise<unknown>; done?: string }) {
  const b = useBusy();
  return (
    <>
      <BusyButton busy={b.is("cut")} busyText="끊는 중…" onClick={() => void b.run("cut", job, done)}>
        연결 끊기
      </BusyButton>
      <BusyNote busy={b.is("cut")} late={b.late} flash={b.flash} />
    </>
  );
}

describe("BusyButton", () => {
  it("누르는 순간 글자가 바뀌고 잠기며, 두 번 눌러도 한 번만 돌아요", async () => {
    let finish = () => {};
    const job = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<Box job={job} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(btn.textContent).toBe("끊는 중…");
    expect(btn).toHaveProperty("disabled", true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(btn);
    expect(job).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(btn.textContent).toBe("연결 끊기");
    expect(btn).toHaveProperty("disabled", false);
    expect(screen.getByRole("status").textContent).toBe("✓ 끊었어요");
  });

  it("10초가 넘으면 오래 걸린다는 글, 끝나면 5초 뒤 ✓가 사라져요", async () => {
    vi.useFakeTimers();
    let finish = () => {};
    render(<Box job={() => new Promise<void>((r) => (finish = r))} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => void vi.advanceTimersByTime(LATE_MS));
    expect(screen.getByRole("status").textContent).toBe(LATE_TEXT);
    await act(async () => finish());
    expect(screen.getByRole("status").textContent).toBe("✓ 끊었어요");
    act(() => void vi.advanceTimersByTime(FLASH_MS));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("실패 글은 붉게 남아요(글자를 돌려줘도 실패)", async () => {
    vi.useFakeTimers();
    render(<Box job={async () => "구글의 giLog 캘린더를 지우지 못했어요."} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    const st = screen.getByRole("status");
    expect(st.textContent).toBe("구글의 giLog 캘린더를 지우지 못했어요.");
    expect(st.className).toContain("busy-fail");
    act(() => void vi.advanceTimersByTime(FLASH_MS * 2));
    expect(screen.getByRole("status").textContent).toBe("구글의 giLog 캘린더를 지우지 못했어요.");
  });
});
