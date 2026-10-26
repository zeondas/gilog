// 예산현황 규칙 시험 – 지금 동작을 고정해요(정리 2차 2026-10-26): compute(단년도·다년도 이월·재원 나눔·이월 사업 잇기)·rowShares·lineOf·엑셀 가져오기.
// 자료는 브라우저 미리 보기 흉내(tools/bstatus/seed.js)의 시도57호선 값을 줄여 썼어요.
import { describe, expect, test } from "vitest";
import type { BudgetProject } from "./budget";
import { carryPair, compute, defaultSetup, lineOf, parseBStatusSheet, projectNames, rowShares, Setup, XL_FIELDS } from "./budgetStatus";

let uid = 0;
const P = (year: number, name: string, budget: number | null, rows: [string, number, number][], carry = false): BudgetProject => ({
  id: ++uid, year, name, budget, carry, open: true, memo: "", uid: "p" + uid, owner: null,
  items: [{ id: ++uid, name, budget: null, open: true, memo: "", uid: "i" + uid, rows: rows.map(([n, cmt, exp]) => ({ id: ++uid, uid: "r" + n, name: n, kind: "공사", co: "", cmt, exp, act: exp, stage: "추진", memo: "" })) }],
});

const byYear: Record<number, BudgetProject[]> = {
  2025: [P(2025, "시도57호선 배수개선", 700_000_000, [["배수개선 공사", 293_378_590, 87_900_000], ["실시설계용역", 49_500_000, 49_500_000]])],
  2026: [
    P(2026, "시도57호선 배수개선", 1_000_000_000, [["배수개선 공사", 293_378_590, 154_728_670], ["관급(아스콘)", 133_787_010, 133_787_010]]),
    P(2026, "(명시이월) 시도57호선 배수개선", 555_343_000, [["이월 공사", 155_978_590, 196_790_990]], true),
    P(2026, "(사고이월) 시도57호선 배수개선", 10_000_000, [["사고 공사", 10_000_000, 4_000_000]], true),
    P(2026, "도로포장 유지관리", 1_724_000_000, [["단가계약", 87_239_870, 26_034_750]]),
  ],
};

const pick = (l: { curSum: number; prev: number; act: number; ex: number; next: number; un: number; left: number; rate: number | null; mismatch?: boolean; diffSum?: boolean }) => ({
  curSum: l.curSum, prev: l.prev, act: l.act, ex: l.ex, next: l.next, un: l.un, left: l.left, rate: l.rate == null ? null : +l.rate.toFixed(4), ...(l.mismatch ? { mismatch: true } : {}), ...(l.diffSum ? { diffSum: true } : {}),
});

describe("compute", () => {
  test("단년도·재원 하나 – 집행현황 값이 곧 그 줄", () => {
    const b = compute("도로포장 유지관리", defaultSetup([2026]), byYear, [2026]);
    expect(b.years.map((y) => [y.year, y.linked, y.hasMain, pick(y.total)])).toEqual([
      [2026, true, true, { curSum: 1_724_000_000, prev: 0, act: 1_724_000_000, ex: 26_034_750, next: 0, un: 0, left: 1_697_965_250, rate: 1.5101 }],
    ]);
  });

  test("다년도·재원 하나 – 이월 사업 잇기(명시·사고 짝) · 다음연도 이월이 다음 해 전년도 이월로", () => {
    const setup: Setup = { ...defaultSetup([2025, 2026]), multi: true, from: 2025, to: 2027, carry: "(명시이월) 시도57호선 배수개선", rows: { "2025:시비": { nm: 555_343_000 }, "2026:시비": { nm: 50_000_000, un: 1_000 } } };
    const b = compute("시도57호선 배수개선", setup, byYear);
    expect(b.years.map((y) => [y.year, pick(y.total)])).toMatchInlineSnapshot(`
      [
        [
          2025,
          {
            "act": 700000000,
            "curSum": 700000000,
            "ex": 137400000,
            "left": 7257000,
            "next": 555343000,
            "prev": 0,
            "rate": 19.6286,
            "un": 0,
          },
        ],
        [
          2026,
          {
            "act": 1565343000,
            "curSum": 1000000000,
            "ex": 489306670,
            "left": 1026035330,
            "next": 50000000,
            "prev": 565343000,
            "rate": 31.2588,
            "un": 1000,
          },
        ],
        [
          2027,
          {
            "act": 50000000,
            "curSum": 0,
            "ex": 0,
            "left": 50000000,
            "next": 0,
            "prev": 50000000,
            "rate": 0,
            "un": 0,
          },
        ],
      ]
    `);
    expect(pick(b.total)).toMatchInlineSnapshot(`
      {
        "act": 1700000000,
        "curSum": 1700000000,
        "ex": 626706670,
        "left": 50000000,
        "next": 0,
        "prev": 0,
        "rate": 36.8651,
        "un": 1000,
      }
    `);
  });

  test("다년도 – 이어 붙인 이월 예산이 앞 해 다음연도 이월과 다르면 붉게(mismatch)", () => {
    const setup: Setup = { ...defaultSetup([2025, 2026]), multi: true, from: 2025, to: 2026, carry: "(명시이월) 시도57호선 배수개선", rows: { "2025:시비": { nm: 500_000_000 } } };
    const b = compute("시도57호선 배수개선", setup, byYear);
    expect(b.years[1].bySrc["시비"].mismatch).toBe(true);
  });

  test("재원 둘 – 공사별 재원대로 집행 나눔, 합계 줄은 집행현황 값, 재원 예산 합이 다르면 diffSum", () => {
    const setup: Setup = {
      ...defaultSetup([2026]),
      sources: ["시비", "특조"],
      rows: { "2026:시비": { cur: 300_000_000 }, "2026:특조": { cur: 600_000_000 } },
      split: { "2026:r배수개선 공사": { 시비: 100_000_000, 특조: 193_378_590 }, "2026:r관급(아스콘)": "시비" },
    };
    const b = compute("시도57호선 배수개선", setup, byYear, [2026]);
    const y = b.years[0];
    expect(Object.fromEntries(Object.entries(y.bySrc).map(([s, l]) => [s, [l.curSum, l.en]]))).toMatchInlineSnapshot(`
      {
        "시비": [
          300000000,
          186527280,
        ],
        "특조": [
          600000000,
          101988400,
        ],
      }
    `);
    expect(y.bySrc["시비"].en + y.bySrc["특조"].en).toBe(154_728_670 + 133_787_010);
    expect(pick(y.total)).toMatchInlineSnapshot(`
      {
        "act": 1000000000,
        "curSum": 1000000000,
        "diffSum": true,
        "ex": 288515680,
        "left": 711484320,
        "next": 0,
        "prev": 0,
        "rate": 28.8516,
        "un": 0,
      }
    `);
  });

  test("잇지 않은 이월 세부사업은 자기 줄 – 예산·집행이 명시 칸으로", () => {
    const b = compute("(명시이월) 시도57호선 배수개선", defaultSetup([2026]), byYear, [2026]);
    const l = b.years[0].total;
    expect([l.cur, l.pm, l.em, l.prev, l.ex]).toEqual([0, 555_343_000, 196_790_990, 555_343_000, 196_790_990]);
  });
});

test("rowShares – 나눔은 금액 비율(십원 반올림), 마지막 재원이 나머지", () => {
  const setup: Setup = { ...defaultSetup([2026]), sources: ["국비", "도비", "시비"], split: { "2026:x": { 국비: 50, 도비: 20, 시비: 30 } } };
  expect(rowShares({ id: 1, uid: "x", exp: 1_234_567 }, setup, 2026)).toEqual({ 국비: 617_280, 도비: 246_910, 시비: 370_377 });
  expect(rowShares({ id: 1, uid: "y", exp: 1000 }, setup, 2026)).toEqual({ 국비: 1000, 도비: 0, 시비: 0 }); // 안 고른 공사 → 첫 재원
  expect(rowShares({ id: 7, exp: 1000 }, { ...setup, split: { "2026:7": "시비" } }, 2026)).toEqual({ 국비: 0, 도비: 0, 시비: 1000 }); // 옛 숫자 키
});

test("carryPair·projectNames", () => {
  expect(carryPair("(명시이월) 가")).toEqual({ m: "(명시이월) 가", s: "(사고이월) 가" });
  expect(carryPair("(사고이월) 가")).toEqual({ m: "(명시이월) 가", s: "(사고이월) 가" });
  expect(projectNames(byYear).map((p) => [p.name, p.years, p.carry])).toEqual([
    ["시도57호선 배수개선", [2025, 2026], false],
    ["(명시이월) 시도57호선 배수개선", [2026], true],
    ["(사고이월) 시도57호선 배수개선", [2026], true],
    ["도로포장 유지관리", [2026], false],
  ]);
});

test("lineOf – 엑셀 C~U 19칸 순서", () => {
  const l = compute("도로포장 유지관리", defaultSetup([2026]), byYear, [2026]).years[0].total;
  const x = lineOf("pj", "단년도", "도로포장 유지관리", l, "메모");
  expect(XL_FIELDS.length).toBe(19);
  expect(x.v).toHaveLength(19);
  expect(Object.fromEntries(XL_FIELDS.map((k, i) => [k, x.v[i]]))).toMatchInlineSnapshot(`
    {
      "a1": 0,
      "a2": 0,
      "a3": 0,
      "a4": 0,
      "act": 1724000000,
      "cur": 1724000000,
      "curSum": 1724000000,
      "em": 0,
      "en": 26034750,
      "es": 0,
      "ex": 26034750,
      "next": 0,
      "nm": 0,
      "ns": 0,
      "pm": 0,
      "prev": 0,
      "ps": 0,
      "rate": 1.5101363109048724,
      "un": 0,
    }
  `);
  expect([x.level, x.period, x.name, x.hasRate, x.memo]).toEqual(["pj", "단년도", "도로포장 유지관리", true, "메모"]);
});

test("parseBStatusSheet – 세부사업·연도·재원 줄 알아보기", () => {
  const cells = (vals: Record<string, string>) => XL_FIELDS.map((k) => vals[k] ?? "");
  const rows = [
    ["예산현황"],
    ["사업기간", "사업명"],
    ["", ""],
    ["단년도", "도로포장 유지관리", ...cells({ cur: "1,724,000,000", un: "100" })],
    ["2025~2027년", "시도57호선 배수개선", ...cells({})],
    ["2025년", "", ...cells({})],
    ["시비", "", ...cells({ cur: "700,000,000", nm: "555,343,000" })],
    ["특조", "", ...cells({ cur: "−5" })],
  ];
  const setups = { "도로포장 유지관리": defaultSetup([2026]), "시도57호선 배수개선": { ...defaultSetup([2025]), sources: ["시비", "특조"] } };
  expect(parseBStatusSheet(rows, 2026, setups)).toMatchInlineSnapshot(`
    [
      {
        "m": {
          "a1": 0,
          "a2": 0,
          "a3": 0,
          "a4": 0,
          "cur": 1724000000,
          "em": 0,
          "en": 0,
          "es": 0,
          "nm": 0,
          "ns": 0,
          "pm": 0,
          "ps": 0,
          "un": 100,
        },
        "name": "도로포장 유지관리",
        "src": "시비",
        "year": 2026,
      },
      {
        "m": {
          "a1": 0,
          "a2": 0,
          "a3": 0,
          "a4": 0,
          "cur": 700000000,
          "em": 0,
          "en": 0,
          "es": 0,
          "nm": 555343000,
          "ns": 0,
          "pm": 0,
          "ps": 0,
          "un": 0,
        },
        "name": "시도57호선 배수개선",
        "src": "시비",
        "year": 2025,
      },
      {
        "m": {
          "a1": 0,
          "a2": 0,
          "a3": 0,
          "a4": 0,
          "cur": -5,
          "em": 0,
          "en": 0,
          "es": 0,
          "nm": 0,
          "ns": 0,
          "pm": 0,
          "ps": 0,
          "un": 0,
        },
        "name": "시도57호선 배수개선",
        "src": "특조",
        "year": 2025,
      },
    ]
  `);
  expect(parseBStatusSheet([["다른 표"]], 2026, setups)).toBeNull();
});
