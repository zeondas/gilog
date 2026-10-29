// 화면 부품 시험(품질 보완 ③ ✔4): 잠금 화면 – 손상 띠(2026-10-29 자료 안전 ✔3 1안)와 비밀번호 틀림 띠.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({
  unlock: vi.fn(),
  create: vi.fn(),
  pinStatus: vi.fn(),
  pinUnlock: vi.fn(),
  backupInfo: vi.fn(),
  restoreAndOpen: vi.fn(),
}));
vi.mock("./api", () => ({
  api,
  inApp: false,
  errorText: (e: unknown) => (e === "wrong_password" ? "비밀번호가 맞지 않아요." : String(e)),
}));

import Gate from "./Gate";

const onOpen = vi.fn();
const pw = () => screen.getByLabelText("비밀번호") as HTMLInputElement;
async function unlockWith(p: string) {
  fireEvent.change(pw(), { target: { value: p } });
  await act(async () => void fireEvent.click(screen.getByRole("button", { name: "열기" })));
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  onOpen.mockReset();
  api.pinStatus.mockResolvedValue({ on: false });
});
afterEach(cleanup);

describe("Gate 손상 띠", () => {
  it("손상이면 최근 백업으로 되살리기 단추 – 방금 친 비밀번호로 열어요", async () => {
    api.unlock.mockRejectedValue("corrupt");
    api.backupInfo.mockResolvedValue({ latest: "2026-10-28", latestPath: "/b/gilog_2026-10-28.gilogbak", folder: "/b" });
    api.restoreAndOpen.mockResolvedValue(undefined);
    await act(async () => void render(<Gate mode="unlock" folder="문서" onOpen={onOpen} />));
    await unlockWith("abcd1234");
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("자료 파일이 손상됐어요.");
    expect(alert.textContent).not.toContain("비밀번호가 맞지 않아요");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "10월 28일 백업으로 되살리기" })));
    expect(api.restoreAndOpen).toHaveBeenCalledWith("/b/gilog_2026-10-28.gilogbak", "abcd1234");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("비밀번호를 지웠으면 넣으라고 띠 안에 적어요", async () => {
    api.unlock.mockRejectedValue("corrupt");
    api.backupInfo.mockResolvedValue({ latest: "2026-10-28", latestPath: "/b/x.gilogbak", folder: "/b" });
    await act(async () => void render(<Gate mode="unlock" folder="문서" onOpen={onOpen} />));
    await unlockWith("abcd1234");
    fireEvent.change(pw(), { target: { value: "" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "10월 28일 백업으로 되살리기" })));
    expect(api.restoreAndOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("비밀번호를 넣고 눌러 주세요.");
  });

  it("백업이 다른 비밀번호면 그때 비밀번호를 넣으라고 해요", async () => {
    api.unlock.mockRejectedValue("corrupt");
    api.backupInfo.mockResolvedValue({ latest: "2026-10-28", latestPath: "/b/x.gilogbak", folder: "/b" });
    api.restoreAndOpen.mockRejectedValue("wrong_password");
    await act(async () => void render(<Gate mode="unlock" folder="문서" onOpen={onOpen} />));
    await unlockWith("abcd1234");
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "10월 28일 백업으로 되살리기" })));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("이 백업은 다른 비밀번호로 잠겨 있어요.");
  });

  it("백업이 없으면 파일 고르기 단추만", async () => {
    api.unlock.mockRejectedValue("corrupt");
    api.backupInfo.mockResolvedValue({ latest: null, latestPath: null, folder: "/b" });
    await act(async () => void render(<Gate mode="unlock" folder="문서" onOpen={onOpen} />));
    await unlockWith("abcd1234");
    expect(screen.getByRole("alert").textContent).toContain("백업 파일이 있으면 골라 되살려 주세요.");
    expect(screen.getByRole("button", { name: "백업 파일 고르기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /백업으로 되살리기/ })).toBeNull();
  });

  it("비밀번호 틀림은 손상 띠가 아니라 보통 띠, 칸은 비워요", async () => {
    api.unlock.mockRejectedValue("wrong_password");
    await act(async () => void render(<Gate mode="unlock" folder="문서" onOpen={onOpen} />));
    await unlockWith("틀린암호");
    expect(screen.getByRole("alert").textContent).toBe("비밀번호가 맞지 않아요.");
    expect(api.backupInfo).not.toHaveBeenCalled();
    expect(pw().value).toBe("");
    expect(pw().className).toContain("bad");
  });

  it("다시 열기를 누르면 손상 띠는 걷혀요", async () => {
    api.unlock.mockRejectedValueOnce("corrupt").mockResolvedValueOnce(undefined);
    api.backupInfo.mockResolvedValue({ latest: null, latestPath: null, folder: "/b" });
    await act(async () => void render(<Gate mode="unlock" folder="문서" onOpen={onOpen} />));
    await unlockWith("abcd1234");
    expect(screen.getByRole("alert")).toBeTruthy();
    await unlockWith("abcd1234");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
