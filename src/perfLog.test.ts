// 재기 기록(공통 ✔1) 시험 – 꺼 두면 아무것도 안 남고, 켜면 숫자만 남아요.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api", () => ({ api: { perfSave: vi.fn(async () => "C:\\load-log.json"), perfMemory: vi.fn(async () => 300 * 1048576) } }));

import { clearPerf, limitOf, median, orderOf, perfLog, perfSwitch, perfTime, record, recentMedian, recordMemory, setPerfOn } from "./perfLog";

beforeEach(() => {
  localStorage.clear();
});

describe("재기 기록", () => {
  test("꺼 두면 아무것도 남기지 않아요", async () => {
    record("전환 · 민원대장", 120);
    expect(await recordMemory("메모리 · 지금")).toBeNull();
    expect(perfLog()).toEqual({});
  });

  test("켜면 값을 남기고 최근 20개만 둬요", () => {
    setPerfOn(true);
    for (let i = 0; i < 25; i++) record("전환 · 할 일", i);
    expect(perfLog()["전환 · 할 일"].length).toBe(20);
    expect(perfLog()["전환 · 할 일"][0]).toBe(5);
    clearPerf();
    expect(perfLog()).toEqual({});
  });

  test("메모리는 MB로", async () => {
    setPerfOn(true);
    expect(await recordMemory("메모리 · 지금")).toBe(300);
    expect(perfLog()["메모리 · 지금"]).toEqual([300]);
  });

  test("가운데 값 · 최근 5번", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(recentMedian([1000, 1000, 1, 2, 3, 4, 5])).toBe(3);
  });

  test("기준(10-18): 첫 화면 1초 · 전환·민원지도 0.2초 · 메모리 250MB", () => {
    expect(limitOf("첫 화면 · 잠금 풀기 → 업무일지")).toEqual({ v: 1000, unit: "ms" });
    expect(limitOf("전환 · 민원대장")).toEqual({ v: 200, unit: "ms" });
    expect(limitOf("민원지도 · 로드뷰 열기")).toEqual({ v: 200, unit: "ms" });
    expect(limitOf("메모리 · 화면을 한 번씩 돈 뒤")).toEqual({ v: 250, unit: "MB" });
    expect(orderOf("첫 화면 · x")).toBeLessThan(orderOf("메모리 · x"));
    expect(orderOf("민원지도 · 첫 열기")).toBeLessThan(orderOf("민원지도 · 두 번째부터 열기"));
    expect(orderOf("민원지도 · 두 번째부터 열기")).toBeLessThan(orderOf("민원지도 · 로드뷰 열기"));
  });

  test("화면 바뀜이 멈출 때까지 재요 · 민원지도는 첫 열기와 그 뒤를 나눠요", async () => {
    setPerfOn(true);
    const done = vi.fn();
    perfSwitch("map", "민원지도", done);
    const el = document.createElement("div");
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));
    el.textContent = "그림";
    await new Promise((r) => setTimeout(r, 700));
    expect(done).toHaveBeenCalledTimes(1);
    expect(perfLog()["민원지도 · 첫 열기"].length).toBe(1);
    perfSwitch("map", "민원지도");
    await new Promise((r) => setTimeout(r, 700));
    expect(perfLog()["민원지도 · 두 번째부터 열기"].length).toBe(1);
  });

  test("until 요소가 나타나기 전에는 끝내지 않아요", async () => {
    setPerfOn(true);
    perfTime("첫 화면 · 잠금 풀기 → 업무일지", { until: ".jcard" });
    await new Promise((r) => setTimeout(r, 600));
    expect(perfLog()["첫 화면 · 잠금 풀기 → 업무일지"]).toBeUndefined();
    const c = document.createElement("div");
    c.className = "jcard";
    document.body.appendChild(c);
    await new Promise((r) => setTimeout(r, 700));
    expect(perfLog()["첫 화면 · 잠금 풀기 → 업무일지"][0]).toBeGreaterThanOrEqual(500);
  });
});
