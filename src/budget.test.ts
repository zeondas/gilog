// 집행현황 계산 규칙 시험(2026-10-28 집행현황 계산 세션, 사용자 11:47·12:05).
// 쓴 돈 = 완료·타절이면 집행액, 진행 중이면 시공량 · 잔액 = 원인행위 − 쓴 돈 · 막대 = 쓴 돈 ÷ 원인행위
// 합계 줄 집행률 = Σ집행액 ÷ 예산 · 가용액 = 예산 − Σ(완료·타절이면 집행액, 아니면 원인행위)
// 숫자는 사용자가 준 2026 집행현황 실무 엑셀에서 가져왔어요(엑셀 손수식과 같은 값이 나와야 해요).
import { describe, expect, test } from "vitest";
import { balance, BudgetRow, rowRate, spent, sums, tied } from "./budget";

let id = 0;
const R = (stage: string, cmt: number, exp: number, act = exp): BudgetRow => ({ id: ++id, uid: "r" + id, name: "공사" + id, kind: "공사", co: "", cmt, exp, act, stage, memo: "" });

describe("쓴 돈 = 단계로 저절로", () => {
  test("진행 중(준비·추진·중지)은 시공량", () => {
    for (const st of ["준비", "추진", "중지"]) {
      const r = R(st, 800, 600, 500);
      expect(spent(r)).toBe(500);
      expect(balance(r)).toBe(300);
      expect(rowRate(r)).toBeCloseTo(62.5);
    }
  });
  test("완료·타절은 집행액", () => {
    for (const st of ["완료", "타절"]) {
      const r = R(st, 800, 600, 500);
      expect(spent(r)).toBe(600);
      expect(balance(r)).toBe(200);
      expect(rowRate(r)).toBe(75);
    }
  });
  test("시공량 0은 0 그대로(집행액으로 대신하지 않음)", () => {
    const r = R("추진", 88_025_000, 61_617_000, 0);
    expect(balance(r)).toBe(88_025_000);
    expect(rowRate(r)).toBe(0);
  });
  test("원인행위 0이면 막대 없음", () => {
    expect(rowRate(R("추진", 0, 0, 0))).toBeNull();
  });
  test("실무 엑셀 도로포장 폐기물(추진): 잔액은 시공량 기준", () => {
    expect(balance(R("추진", 88_025_000, 61_617_000, 40_852_660))).toBe(47_172_340);
  });
});

describe("가용액", () => {
  test("완료는 집행액, 진행 중은 원인행위(전의 큰 값이 아님)", () => {
    expect(tied(R("완료", 89_885_490, 87_512_510))).toBe(87_512_510);
    expect(tied(R("완료", 89_003_500, 104_876_000))).toBe(104_876_000);
    expect(tied(R("추진", 87_239_870, 26_034_750))).toBe(87_239_870);
    expect(tied(R("타절", 50_000_000, 10_000_000))).toBe(10_000_000);
  });
  test("실무 엑셀 시도 및 도시계획도로 = 25,213,050", () => {
    const rows = [
      R("추진", 87_239_870, 26_034_750),
      R("추진", 87_239_870, 26_034_750),
      R("추진", 54_765_000, 0),
      R("완료", 89_003_500, 104_876_000),
      R("완료", 89_885_490, 87_512_510),
      R("완료", 89_885_490, 134_381_180),
      R("완료", 89_059_460, 103_772_520),
    ];
    expect(sums(685_000_000, rows).avail).toBe(25_213_050);
  });
  test("실무 엑셀 시도15호선(모두 완료) = 예산 − 집행액 합 = 17,105,190", () => {
    const rows = [
      R("완료", 49_500_000, 49_500_000),
      R("완료", 216_294_700, 222_887_880),
      R("완료", 34_679_000, 49_846_000),
      R("완료", 792_000, 792_000),
      R("완료", 9_302_370, 6_310_290),
      R("완료", 75_960_070, 13_662_100),
      R("완료", 57_235_610, 57_235_610),
      R("완료", 32_018_590, 32_018_590),
      R("완료", 74_257_090, 74_257_090),
      R("완료", 12_385_250, 12_385_250),
    ];
    const s = sums(536_000_000, rows);
    expect(s.avail).toBe(17_105_190);
    expect(s.low).toBe(false);
  });
  test("사고이월 진행 중 용역은 원인행위 → 0", () => {
    expect(sums(49_050_000, [R("추진", 49_050_000, 34_335_000)]).avail).toBe(0);
  });
  test("예산이 없으면 가용액 없음, 넘으면 low", () => {
    expect(sums(null, [R("추진", 100, 0)]).avail).toBeNull();
    const s = sums(100, [R("추진", 150, 0)]);
    expect(s.avail).toBe(-50);
    expect(s.low).toBe(true);
  });
});

describe("합계 줄", () => {
  test("잔액 = 공사 줄 잔액 합, 집행률 = Σ집행액 ÷ 예산(늘 집행액)", () => {
    const rows = [R("추진", 800, 600, 500), R("완료", 100, 90, 0)];
    const s = sums(1000, rows);
    expect(s.bal).toBe(300 + 10);
    expect(s.rate).toBe(69);
    expect(s.cmt).toBe(900);
    expect(s.exp).toBe(690);
    expect(s.act).toBe(500);
    expect(s.done).toBe(1);
    expect(s.n).toBe(2);
  });
  test("예산 0·없음이면 집행률 없음", () => {
    expect(sums(0, [R("추진", 1, 1)]).rate).toBeNull();
    expect(sums(null, [R("추진", 1, 1)]).rate).toBeNull();
  });
});
