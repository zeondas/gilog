import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { MapComplaint } from "../../api";
import {
  REGIONS,
  cardPlace,
  chipOf,
  chipRange,
  groupByType,
  legalPartsOf,
  parseLayers,
  layerPaths,
  passes,
  periodLabel,
  regionOf,
  typeColors,
  LADDER,
} from "./mapData";

const mk = (o: Partial<MapComplaint>): MapComplaint => ({
  id: 1, place: "", area: "", ctype: "포트홀", intake: "전화", status: "접수", received: "2026-10-01", x: 1, y: 1, geoSrc: "exact", ...o,
});

describe("민원 지도 규칙", () => {
  it("읍면동 20곳, 사용자 순서", () => {
    expect(REGIONS).toHaveLength(20);
    expect(REGIONS.slice(0, 3)).toEqual(["문산읍", "조리읍", "법원읍"]);
    expect(REGIONS[10]).toBe("교하동");
  });

  it("지역: 지역 칸 → 군내·진동·진서는 장단면 → 없으면 위치의 리", () => {
    expect(regionOf({ area: "조리읍", place: "" })).toBe("조리읍");
    expect(regionOf({ area: "군내면", place: "" })).toBe("장단면");
    expect(regionOf({ area: "", place: "봉일천리 113 일원" })).toBe("조리읍");
    expect(regionOf({ area: "", place: "금릉리 12" })).toBe("장단면"); // 진서면 금릉리
    expect(regionOf({ area: "", place: "동패동 1234" })).toBe(""); // 행정동 여럿 – 못 정함
    expect(regionOf({ area: "운정3동", place: "동패동 1234" })).toBe("운정3동");
  });

  it("그리는 법정 경계", () => {
    expect(legalPartsOf("장단면")).toEqual(["장단면", "군내면", "진동면", "진서면"]);
    expect(legalPartsOf("운정2동")).toEqual(["목동동"]);
  });

  it("색 사다리: 건수 많은 유형부터, 넘치면 회색", () => {
    const list = [..."aaaabbbccd"].map((t) => ({ ctype: t }));
    const c = typeColors(list);
    expect(c.get("a")).toBe(LADDER[0]);
    expect(c.get("b")).toBe(LADDER[1]);
    expect(c.get("d")).toBe(LADDER[3]);
    const many = Array.from({ length: 12 }, (_, i) => ({ ctype: "t" + String(i).padStart(2, "0") }));
    expect(typeColors(many).get("t11")).toBe("#6B7280");
  });

  it("기간 칩: 올해 끝일은 오늘, 작년, 최근 1년, 전체", () => {
    const t = new Date(2026, 10, 2);
    expect(chipRange("year", t)).toEqual({ from: "2026-01-01", to: "2026-11-02", chip: "year" });
    expect(chipRange("last", t)).toEqual({ from: "2025-01-01", to: "2025-12-31", chip: "last" });
    expect(chipRange("y1", t)).toEqual({ from: "2025-11-03", to: "2026-11-02", chip: "y1" });
    expect(chipOf("2026-01-01", "2026-11-02", t)).toBe("year");
    expect(chipOf("2026-03-01", "2026-10-31", t)).toBe("");
    expect(periodLabel(chipRange("year", t))).toBe("올해 (1-01 ~ 11-02)");
    expect(periodLabel({ from: "2026-03-01", to: "2026-10-31", chip: "" })).toBe("2026-03-01 ~ 10-31");
    expect(periodLabel(chipRange("all", t))).toBe("전체");
  });

  it("거르기", () => {
    const f = { types: new Set(["포트홀"]), statuses: new Set(["접수"]), period: { from: "2026-01-01", to: "2026-12-31", chip: "" as const }, q: "" };
    expect(passes(mk({}), f)).toBe(true);
    expect(passes(mk({ ctype: "제초" }), f)).toBe(false);
    expect(passes(mk({ ctype: "제초" }), f, "type")).toBe(true);
    expect(passes(mk({ status: "완료" }), f)).toBe(false);
    expect(passes(mk({ received: "2025-12-31" }), f)).toBe(false);
    expect(passes(mk({ place: "봉일천리 113" }), { ...f, q: "봉일" })).toBe(true);
    expect(passes(mk({ place: "봉일천리 113" }), { ...f, q: "문산" })).toBe(false);
  });

  it("묶음: 건수 많은 순, 안은 접수일 내림차순", () => {
    const g = groupByType([mk({ id: 1, ctype: "제초", received: "2026-01-01" }), mk({ id: 2, received: "2026-01-02" }), mk({ id: 3, received: "2026-03-01" })]);
    expect(g.map((x) => x.type)).toEqual(["포트홀", "제초"]);
    expect(g[0].items.map((c) => c.id)).toEqual([3, 2]);
  });

  it("점 카드는 늘 지도 안", () => {
    expect(cardPlace(100, 100, 200, 80, 800, 600)).toEqual({ left: 112, top: 88 });
    expect(cardPlace(750, 100, 200, 80, 800, 600).left).toBe(750 - 12 - 200); // 오른쪽 모자람 → 왼쪽
    expect(cardPlace(100, 550, 200, 80, 800, 600).top).toBe(550 + 12 - 80); // 아래 모자람 → 위로
    const c = cardPlace(5, 5, 200, 80, 800, 600);
    expect(c.left).toBeGreaterThanOrEqual(8);
    expect(c.top).toBeGreaterThanOrEqual(8);
  });

  it("앱에 넣은 배경 자료를 읽어요(네 층, 경계 35곳)", () => {
    const raw = gunzipSync(readFileSync("data/map/paju_layers.bin.gz"));
    const l = parseLayers(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    expect(l.emd).toHaveLength(35);
    expect(l.road.length).toBeGreaterThan(40000);
    expect(l.zone.length).toBe(700);
    const names = new Set(l.emd.map((e) => e.name));
    for (const r of REGIONS) for (const p of legalPartsOf(r)) expect(names.has(p), `${r} → ${p}`).toBe(true);
    // 파주시 범위(5181 m)
    expect(l.bounds[0]).toBeGreaterThan(150000);
    expect(l.bounds[3]).toBeLessThan(520000);
  });

  it("배경 모양 만들기: 칠하는 층은 closePath 0번, 전체 자료 1초 안(0.68.0 멈춤 재발 방지)", () => {
    // 고리마다 closePath를 부르면 Chromium(WebView2)이 고리 수의 제곱으로 느려져 48,848고리에서 20초 넘게 멈췄어요.
    const raw = gunzipSync(readFileSync("data/map/paju_layers.bin.gz"));
    const l = parseLayers(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const make = () => ({ moves: 0, lines: 0, closes: 0, moveTo() { this.moves++; }, lineTo() { this.lines++; }, closePath() { this.closes++; } });
    const t = performance.now();
    const P = layerPaths(l, make);
    const ms = performance.now() - t;
    expect(P.road.closes).toBe(0);
    expect(P.plan.closes).toBe(0);
    expect(P.zone.closes).toBe(0);
    expect(P.emd.closes).toBe(35); // 선으로 긋는 경계만
    expect(P.road.moves).toBeGreaterThan(40000);
    expect(ms).toBeLessThan(1000);
  });
});
