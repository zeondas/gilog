import { describe, expect, it, vi } from "vitest";
import { closerFits, kakaoFailWhy, kakaoHit, loadKakao, LOAD_MS, LOAD_TRIES, pickKey, RETRY_MS, tmForward, tmInverse } from "./kakao";
import { addPoint, finish, fmtArea, fmtLen, insideIds, polyArea, summary, walkTime, type Measure } from "./measure";

// 기준값은 pyproj(EPSG:4326 → EPSG:5181)로 뽑았어요.
const REF: [number, number, number, number][] = [
  [37.76, 126.78, 180614.0426, 473384.1811],
  [37.93, 126.95, 195604.2057, 492231.472],
  [38.0, 127.0, 200000.0, 500000.0],
  [37.7, 126.68, 171779.4637, 466750.1004],
];

describe("EPSG:5181 ↔ 위경도", () => {
  it("앞으로(위경도 → 5181)는 1cm 안", () => {
    for (const [lat, lon, x, y] of REF) {
      const [px, py] = tmForward(lat, lon);
      expect(Math.abs(px - x)).toBeLessThan(0.01);
      expect(Math.abs(py - y)).toBeLessThan(0.01);
    }
  });
  it("거꾸로(5181 → 위경도)도 1cm 안(되돌려 견줌)", () => {
    for (const [lat, lon, x, y] of REF) {
      const [la, lo] = tmInverse(x, y);
      expect(Math.abs(la - lat)).toBeLessThan(1e-7);
      expect(Math.abs(lo - lon)).toBeLessThan(1e-7);
    }
  });
});

describe("카카오 키", () => {
  it("설정 칸이 있으면 그 키, 비면 넣어 둔 키, 둘 다 없으면 빈 글", () => {
    expect(pickKey("abc", "built")).toBe("abc");
    expect(pickKey("  ", "built")).toBe("built");
    expect(pickKey(null, undefined)).toBe("");
  });
});

describe("주소 검색은 파주시만", () => {
  it("파주시 밖 결과는 빼요", () => {
    expect(kakaoHit({ place_name: "파주시청", address_name: "경기 파주시 금촌동 1", x: "126.78", y: "37.76" })).not.toBeNull();
    expect(kakaoHit({ place_name: "고양시청", address_name: "경기 고양시 덕양구 주교동 1", x: "126.83", y: "37.65" })).toBeNull();
    expect(kakaoHit({ place_name: "파주", address_name: "경기도 파주시 조리읍", x: "126.8", y: "37.7" })).not.toBeNull();
  });
  it("좌표는 5181로 바꿔요", () => {
    const h = kakaoHit({ place_name: "가", address_name: "경기 파주시 가", x: "126.78", y: "37.76" })!;
    expect(Math.abs(h.x - 180614.04)).toBeLessThan(0.05);
  });
});

describe("거리·면적·반경 재기", () => {
  it("넓이·글 모양", () => {
    expect(polyArea([[0, 0], [100, 0], [100, 100], [0, 100]])).toBe(10000);
    expect(fmtLen(850)).toBe("850m");
    expect(fmtLen(1234)).toBe("1.23km");
    expect(fmtArea(500)).toBe("500㎡");
    expect(fmtArea(25000)).toBe("25,000㎡ (2.50ha)");
    expect(walkTime(1000)).toBe("도보 15분");
  });
  it("거리는 두 번 누르기로 끝, 겹친 끝 점은 하나로", () => {
    let m: Measure = { tool: "dist", pts: [], done: false };
    m = addPoint(m, [0, 0]);
    m = addPoint(m, [300, 400]);
    m = addPoint(m, [300, 400]);
    m = finish(m);
    expect(m.done).toBe(true);
    expect(m.pts.length).toBe(2);
    expect(summary(m)!.main).toBe("총 거리 500m");
  });
  it("반경은 두 점이면 끝나고, 안에 든 민원을 세요", () => {
    let m: Measure = { tool: "radius", pts: [], done: false };
    m = addPoint(m, [0, 0]);
    m = addPoint(m, [100, 0]);
    expect(m.done).toBe(true);
    const ids = insideIds(m, [
      { id: 1, x: 50, y: 50 },
      { id: 2, x: 90, y: 90 },
    ]);
    expect(ids).toEqual([1]);
  });
  it("면적은 세 점 못 되면 안 끝나요", () => {
    let m: Measure = { tool: "area", pts: [], done: false };
    m = addPoint(m, [0, 0]);
    m = addPoint(m, [10, 0]);
    expect(finish(m).done).toBe(false);
    m = addPoint(m, [10, 10]);
    m = finish(m);
    expect(insideIds(m, [{ id: 3, x: 8, y: 2 }, { id: 4, x: 2, y: 8 }])).toEqual([3]);
  });
});

describe("검색창 하나 – 주소 꼴 알아보기(11-03 ✔3)", () => {
  it("숫자가 있거나 리·동·로·길로 끝나면 주소 꼴", async () => {
    const { looksAddress } = await import("./mapData");
    expect(looksAddress("봉일천리 113")).toBe(true);
    expect(looksAddress("문산로")).toBe(true);
    expect(looksAddress("봉일천리")).toBe(true);
    expect(looksAddress("포트홀")).toBe(false);
    expect(looksAddress("접수")).toBe(false);
    expect(looksAddress("  ")).toBe(false);
  });
});

describe("로드뷰 핀(11-03 ✔11 네이버식)", () => {
  it("띠: 남쪽(우리 쪽)을 보면 다 보이고 북쪽이면 숨어요 · 1°씩 돌려도 갑자기 바뀌지 않아요", async () => {
    const { visorSegs } = await import("./rvPin");
    const n = (pan: number) => visorSegs(pan).reduce((a, s) => a + s.length, 0);
    expect(n(180)).toBe(23);
    expect(n(0)).toBe(0);
    // 동쪽을 보면 띠가 오른쪽(+x)에
    const e = visorSegs(90).flat();
    expect(Math.min(...e.map((p) => p[0]))).toBeGreaterThan(-1);
    for (let a = 0; a < 360; a++) expect(Math.abs(n(a + 1) - n(a)), `${a}°`).toBeLessThanOrEqual(2);
  });
  it("마우스 핀: 움직인 쪽으로 기울고 띠도 그쪽, 조금 움직인 건 정면", async () => {
    const { leanOf, easeTo, lookPan } = await import("./rvPin");
    expect(leanOf(5)).toEqual({ look: 1, lean: 8 });
    expect(leanOf(-5).lean).toBe(-8);
    expect(leanOf(1)).toEqual({ look: 0, lean: 0 });
    expect(lookPan(0)).toBe(180);
    expect(lookPan(1)).toBe(90);
    const cur = { look: 0, lean: 0 };
    let k = 0;
    while (!easeTo(cur, { look: 1, lean: 8 }) && k < 50) k++;
    expect(cur).toEqual({ look: 1, lean: 8 });
    expect(k).toBeLessThan(20);
  });
});

describe("파주시 보기 한 단계 가까이(map9 ✔3 · map11 6%)", () => {
  const b: [number, number, number, number] = [0, 0, 1000, 500];
  it("두 배에서 남는 자리 안이면 가까이(위아래는 여백 없이 지도 높이)", () => {
    // 남는 자리 1000-8-8 = 984 × 600, 두 배 = 2000×1000 · s 0.49 → 980×490
    expect(closerFits(b, 0.49, 1000, 600, 8, 8)).toBe(true);
  });
  it("6% 안쪽 넘침은 받아요 · 그보다 많으면 그대로", () => {
    expect(closerFits(b, 0.52, 1000, 600, 8, 8)).toBe(true); // 1040 / 984 = 5.7% 넘침
    expect(closerFits(b, 0.53, 1000, 600, 8, 8)).toBe(false); // 7.7% 넘침
    // 사용자 15:05 화면: 파주 높이가 지도 높이의 3.5% 넘침 → 이제 가까이
    expect(closerFits([0, 0, 100, 543], 1, 2000, 1049, 8, 8)).toBe(true);
  });
  it("왼쪽 패널 폭만큼 남는 자리가 줄어요", () => {
    expect(closerFits(b, 0.49, 1000, 600, 8, 300)).toBe(false);
  });
});

describe("카카오 SDK 다시 받기(map12 ✔1 – QC MP-07)", () => {
  it("처음 못 받으면 한 번 더 받아 보고, 두 번째에 받으면 지도를 열어요", async () => {
    vi.useFakeTimers();
    const w = window as any;
    delete w.kakao;
    const tries: HTMLScriptElement[] = [];
    const removed: HTMLScriptElement[] = [];
    const spy = vi.spyOn(document.head, "appendChild").mockImplementation(((el: Node) => {
      const sc = el as HTMLScriptElement;
      tries.push(sc); // 정말 붙이면 시험 환경이 인터넷으로 받으려 해서 붙이지 않아요
      sc.remove = () => void removed.push(sc);
      if (tries.length === 1) setTimeout(() => sc.onerror?.(new Event("error")), 10);
      else
        setTimeout(() => {
          w.kakao = { maps: { load: (cb: () => void) => cb(), LatLng: function () {} } };
          sc.onload?.(new Event("load"));
        }, 10);
      return sc;
    }) as typeof document.head.appendChild);
    const p = loadKakao("k-retry-1");
    await vi.advanceTimersByTimeAsync(10 + RETRY_MS + 20);
    const k = await p;
    expect(tries).toHaveLength(2);
    expect(k).toBe(w.kakao);
    expect(removed).toEqual([tries[0]]); // 실패한 파일은 치워요
    spy.mockRestore();
    delete w.kakao;
    vi.useRealTimers();
  });
  it("두 번 다 못 받으면 연속주제도로(까닭 안내)", async () => {
    vi.useFakeTimers();
    const w = window as any;
    delete w.kakao;
    let n = 0;
    const spy = vi.spyOn(document.head, "appendChild").mockImplementation(((el: Node) => {
      const sc = el as HTMLScriptElement;
      n++;
      setTimeout(() => sc.onerror?.(new Event("error")), 10);
      return sc;
    }) as typeof document.head.appendChild);
    const f = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("off"));
    const p = loadKakao("k-retry-2");
    await vi.advanceTimersByTimeAsync(10 + RETRY_MS + 20 + LOAD_MS);
    expect(await p).toBeNull();
    expect(n).toBe(LOAD_TRIES);
    expect(kakaoFailWhy()).toContain("두 번");
    spy.mockRestore();
    f.mockRestore();
    vi.useRealTimers();
  });
});
