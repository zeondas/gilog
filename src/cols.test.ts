import { describe, expect, it } from "vitest";
import { COL_MIN_PX, fitAllPx, fitPx, minOf, readColPx, totalOf, widthOf, writeColPx, type ColDef } from "./cols";

const name: ColDef = { id: "name", init: 336, text: true };
const num: ColDef = { id: "bud", init: 112 };
const fixed: ColDef = { id: "rate", init: 90, fixed: true };
const date: ColDef = { id: "modified", init: 112, min: 96 };

describe("가장 좁은 폭", () => {
  it("보통 열은 40, 글자 열은 처음 값 절반, 고정 열은 처음 값", () => {
    expect(minOf(num)).toBe(COL_MIN_PX);
    expect(minOf(name)).toBe(168);
    expect(minOf({ id: "x", init: 60, text: true })).toBe(40);
    expect(minOf(fixed)).toBe(90);
    expect(minOf(date)).toBe(96);
  });
});

describe("보이는 폭", () => {
  it("저장값이 없으면 처음 값, 있으면 저장값(가장 좁게 아래로는 안 감)", () => {
    expect(widthOf(num, {})).toBe(112);
    expect(widthOf(num, { bud: 200 })).toBe(200);
    expect(widthOf(name, { name: 100 })).toBe(168);
    expect(widthOf(date, { modified: 50 })).toBe(96);
  });
  it("고정 열은 저장값이 있어도 처음 값", () => {
    expect(widthOf(fixed, { rate: 300 })).toBe(90);
  });
  it("총폭은 끈 열만큼 늘어요(다른 열은 그대로)", () => {
    expect(totalOf([name, num, fixed], {})).toBe(538);
    expect(totalOf([name, num, fixed], { bud: 212 })).toBe(638);
  });
});

describe("옛 저장값은 버려요", () => {
  it("{열: px}만 받아요", () => {
    expect(readColPx('{"name":300,"bud":120.4}')).toEqual({ name: 300, bud: 120 });
  });
  it("집행현황 옛 모양 {w, nameFixed}는 빈 값", () => {
    expect(readColPx('{"w":{"name":300},"nameFixed":true}')).toEqual({});
  });
  it("민원처리 옛 배열·민원대장 비율·망가진 값은 빈 값이거나 거름", () => {
    expect(readColPx("[36,80,62,105,151,null,164,300,190]")).toEqual({});
    expect(readColPx('{"place":0.12,"person":0.3}')).toEqual({});
    expect(readColPx("not json")).toEqual({});
    expect(readColPx(null)).toEqual({});
    expect(readColPx('{"a":-5,"b":"12","c":99999}')).toEqual({});
  });
  it("칸(part)으로 나눠 담아요 – 예산현황 요약·자세히", () => {
    const s = writeColPx(null, { name: 300 }, "summary");
    const t = writeColPx(s, { ex: 160 }, "detail");
    expect(readColPx(t, "summary")).toEqual({ name: 300 });
    expect(readColPx(t, "detail")).toEqual({ ex: 160 });
    expect(readColPx('{"w":{"summary":{"name":300}}}', "summary")).toEqual({});
  });
});

describe("내용에 맞춤", () => {
  it("한 열: 내용 폭을 올림, 가장 좁게 아래로는 안 감", () => {
    expect(fitPx(num, 87.2)).toBe(88);
    expect(fitPx(num, 12)).toBe(40);
    expect(fitPx(name, 90)).toBe(168);
  });
  it("모든 열: 고정 열·잴 수 없는 열(숨은 열)은 빼요", () => {
    const m: Record<string, number | null> = { name: 250, bud: 95, rate: 200, act: null };
    const act: ColDef = { id: "act", init: 112 };
    expect(fitAllPx([name, num, fixed, act], { act: 150 }, (id) => m[id])).toEqual({ name: 250, bud: 95, act: 150 });
  });
});
