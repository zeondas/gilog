import { describe, expect, it } from "vitest";
import { kakaoHit, pickKey, tmForward, tmInverse } from "./kakao";
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

describe("로드뷰 핀(11-03 ✔2)", () => {
  it("고개 방향: 북쪽 = 뒤통수, 남쪽 = 렌즈 정면, 동쪽 = 오른쪽", async () => {
    const { headPose } = await import("./rvPin");
    expect(headPose(0).front).toBeCloseTo(-1);
    expect(headPose(180).front).toBeCloseTo(1);
    expect(headPose(90).look).toBeCloseTo(1);
    expect(headPose(270).look).toBeCloseTo(-1);
  });
  it("움직인 쪽으로 기울고, 조금 움직인 건 정면", async () => {
    const { leanOf, easeTo } = await import("./rvPin");
    expect(leanOf(5)).toEqual({ look: 0.75, lean: 10 });
    expect(leanOf(-5).lean).toBe(-10);
    expect(leanOf(1)).toEqual({ look: 0, lean: 0 });
    const cur = { look: 0, lean: 0 };
    let n = 0;
    while (!easeTo(cur, { look: 0.75, lean: 10 }) && n < 50) n++;
    expect(cur).toEqual({ look: 0.75, lean: 10 });
    expect(n).toBeLessThan(20);
  });
});
