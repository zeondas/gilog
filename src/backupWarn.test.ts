// 자동 백업 실패 띠(버그 사냥 20)
import { describe, expect, test } from "vitest";
import { backupWarnText, daysBetween } from "./backupWarn";

const info = (latest: string | null, fail: string | null, today = "2026-11-02") => ({ folder: "/b", count: 1, latest, latestPath: null, today, fail });

describe("자동 백업 실패 띠", () => {
  test("날수", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("x", "2026-11-02")).toBeNull();
  });
  test("성공했으면 안 띄워요", () => {
    expect(backupWarnText(info("2026-10-01", null))).toBe("");
    expect(backupWarnText(null)).toBe("");
  });
  test("실패해도 마지막 백업이 2일 안이면 안 띄워요", () => {
    expect(backupWarnText(info("2026-11-01", "io"))).toBe("");
    expect(backupWarnText(info("2026-10-31", "io"))).toBe("");
  });
  test("2일 넘게 실패하면 띄워요", () => {
    expect(backupWarnText(info("2026-10-30", "io"))).toBe("자동 백업이 3일째 안 되고 있어요. 설정 › 자동 백업에서 백업 폴더를 확인해 주세요.");
    expect(backupWarnText(info(null, "io"))).toBe("자동 백업이 안 되고 있어요. 설정 › 자동 백업에서 백업 폴더를 확인해 주세요.");
  });
});
