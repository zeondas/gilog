// 설정 "자료 지우기" 카드(2026-10-30 설정 ✔1): 줄 글·토스트 글, 스위치 → 묻는 띠 → 지우기/접힘.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({ clearCounts: vi.fn(), clearData: vi.fn() }));
const share = vi.hoisted(() => ({ on: false, refresh: vi.fn() }));
const google = vi.hoisted(() => ({ schedule: vi.fn() }));
vi.mock("../../api", () => ({ api, errorText: (e: unknown) => String(e) }));
vi.mock("../../budgetShare", () => ({
  loadShare: async () => ({ conf: { on: share.on } }),
  shareActive: (c: { on: boolean }) => c.on,
  refreshShare: share.refresh,
}));
vi.mock("../../google", () => ({ scheduleGoogleSync: google.schedule }));
vi.mock("../../journal", () => ({ todayStr: () => "2026-10-30" }));

import { ClearCard, clearedText, clearLines } from "./Clear";
import type { ClearCounts } from "../../api";

const C: ClearCounts = {
  complaints: 128,
  cases: 34,
  contacts: 86,
  projects: 12,
  entries: 412,
  days: 96,
  tasks: 57,
  lists: 3,
  events: 23,
  budgetYearProjects: 18,
  budgetYearRows: 41,
  budgetProjects: 47,
  budgetRows: 103,
  bstatus: 9,
};

describe("줄 글", () => {
  it("줄 7개 + 전부, 건수는 띠에 보인 큰 단위의 합", () => {
    const l = clearLines(C, 2026, false);
    expect(l.map((x) => x.name)).toEqual(["민원대장", "업무연락처", "업무일지", "할 일", "캘린더 일정", "집행현황", "예산현황", "전부 지우고 처음부터"]);
    expect(l[0].desc).toBe("민원 128건 · 민원처리 건 34건도 함께 지워요");
    expect(l[5].desc).toBe("2026년 세부사업 18개 · 공사 41건");
    expect(clearLines(C, 2026, true)[5].ask).toBe("집행현황 모든 해 세부사업 47개 · 공사 103건");
    expect(l[1].sub).toContain("업무일지 기록에 적힌 상대 이름은 그대로 남아요");
    // 전부는 늘 모든 해: 162 + 98 + 412 + 57 + 23 + 150 + 9
    expect(l[7].n).toBe(911);
  });
  it("토스트는 백업 이름만", () => {
    expect(clearedText(162, "C:\\Users\\a\\Documents\\giLog\\backup\\gilog_2026-10-30_before-clear-2.gilogbak")).toBe(
      "162건 지웠어요 · 백업: backup\\gilog_2026-10-30_before-clear-2.gilogbak",
    );
    expect(clearedText(3, null)).toBe("3건 지웠어요");
  });
});

const setNote = vi.fn();
async function openCard() {
  await act(async () => void render(<ClearCard setNote={setNote} />));
  await act(async () => void fireEvent.click(screen.getByRole("switch", { name: /지우기 단추 보이기/ })));
}
const rowOf = (what: string) => document.querySelector(`[data-clear="${what}"]`) as HTMLElement;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  share.refresh.mockReset();
  share.refresh.mockResolvedValue(null);
  google.schedule.mockReset();
  share.on = false;
  api.clearCounts.mockResolvedValue(C);
});
afterEach(cleanup);

describe("자료 지우기 카드", () => {
  it("스위치가 꺼져 있으면 지우기 단추가 없어요", async () => {
    await act(async () => void render(<ClearCard setNote={setNote} />));
    expect(screen.queryByText("모두 지우기")).toBeNull();
    expect(api.clearCounts).not.toHaveBeenCalled();
  });

  it("묻는 띠는 Esc로 접히고 지우지 않아요", async () => {
    await openCard();
    await act(async () => void fireEvent.click(rowOf("complaints").querySelector("button")!));
    const band = screen.getByRole("alertdialog", { name: "민원대장 지우기 확인" });
    expect(band.textContent).toContain("정말 지울까요? 민원대장 민원 128건");
    await act(async () => void fireEvent.keyDown(band, { key: "Escape" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.clearData).not.toHaveBeenCalled();
  });

  it("바깥을 누르면 접히고 지우지 않아요", async () => {
    await openCard();
    await act(async () => void fireEvent.click(rowOf("tasks").querySelector("button")!));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await act(async () => void fireEvent.mouseDown(document.body));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.clearData).not.toHaveBeenCalled();
  });

  it("집행현황 모든 해 – 지우고 토스트, 팀 공유면 맞추기", async () => {
    share.on = true;
    api.clearData.mockResolvedValue({ n: 150, backup: "/d/backup/gilog_2026-10-30_before-clear.gilogbak" });
    await openCard();
    expect(rowOf("budget").textContent).toContain("공유 시트에도 지움 표시가 가요");
    await act(async () => void fireEvent.click(screen.getByRole("radio", { name: "모든 해" })));
    await act(async () => void fireEvent.click(rowOf("budget").querySelector(".clr-btn")!));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "지우기" })));
    expect(api.clearData).toHaveBeenCalledWith("budget", null);
    expect(share.refresh).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("150건 지웠어요 · 백업: backup\\gilog_2026-10-30_before-clear.gilogbak");
  });

  it("전부 지우기는 구글 맞추기도 불러요, 0건이면 지울 것 없음", async () => {
    api.clearData.mockResolvedValue({ n: 911, backup: null });
    await openCard();
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "전부 지우기" })));
    await act(async () => void fireEvent.click(screen.getAllByRole("button", { name: "전부 지우기" })[1]));
    expect(api.clearData).toHaveBeenCalledWith("all", null);
    expect(google.schedule).toHaveBeenCalled();
    api.clearCounts.mockResolvedValue({ ...C, tasks: 0 });
    cleanup();
    await openCard();
    expect((rowOf("tasks").querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect(rowOf("tasks").textContent).toContain("지울 것 없음");
  });
});
