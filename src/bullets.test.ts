// 머릿기호 규칙 시험 – 지금 동작을 고정해요(정리 2차 2026-10-26). 보기 값은 CLAUDE.md "공통 입력 규칙 › 머릿기호 규칙" 그대로.
import { describe, expect, test } from "vitest";
import { BLine, layout, linesToText, newLineFor, parseLines, stringifyLines, tabKind, textToLines } from "./bullets";

const L = (spec: string): BLine[] =>
  spec.split(" / ").map((s) => {
    const m = /^([□●-]) (.*)$/.exec(s);
    if (!m) return { t: s === "∅" ? "" : s, k: "none" as const };
    return m[1] === "□" ? { t: m[2], k: "sq" as const } : m[1] === "-" ? { t: m[2], k: "da" as const } : { t: m[2] };
  });

describe("layout – 들여쓰기는 위계로", () => {
  test.each([
    ["● 가 / - 나 / - 다", [0, 1, 1]],
    ["- 만 있는 줄", [0]],
    ["□ a / ● b / - c", [0, 1, 2]],
    ["□ a / - c", [0, 1]],
    ["● 가 / ● 나", [0, 0]],
    ["□ a / ● b / □ c / - d", [0, 1, 0, 1]],
  ])("%s → %j", (spec, want) => expect(layout(L(spec))).toEqual(want));

  test("빈 줄이 묶음을 나눠요 – 빈 줄 위는 따지지 않음", () => {
    expect(layout([{ t: "가" }, { t: "", k: "none" }, { t: "나", k: "da" }])).toEqual([0, 0, 0]);
  });
  test("기호 없는 줄은 윗줄 단계를 따라가요", () => {
    expect(layout([{ t: "□", k: "sq" }, { t: "가" }, { t: "이어", k: "none" }])).toEqual([0, 1, 1]);
  });
});

describe("저장 모양", () => {
  test("예전 글자만 있는 기록은 줄마다 ●", () => {
    expect(parseLines("가\n나")).toEqual([{ t: "가" }, { t: "나" }]);
  });
  test("k가 없거나 ci면 ●(기본, 적지 않음)", () => {
    expect(parseLines('[{"t":"가"},{"t":"나","k":"ci"},{"t":"다","k":"sq"}]')).toEqual([{ t: "가" }, { t: "나" }, { t: "다", k: "sq" }]);
  });
  test("업무연락처 메모 예전 모양 nb → 기호 없음", () => {
    expect(parseLines('[{"t":"가","nb":true}]')).toEqual([{ t: "가", k: "none" }]);
  });
  test("stringifyLines – 묶음 사이 빈 줄은 하나, 맨 앞·끝 빈 줄은 빼요", () => {
    expect(stringifyLines([{ t: "" }, { t: " 가 " }, { t: "" }, { t: "" }, { t: "나", k: "da" }, { t: "" }])).toBe('[{"t":"가"},{"t":""},{"t":"나","k":"da"}]');
    expect(stringifyLines([{ t: " " }])).toBe("");
  });
});

describe("복사·붙여 넣기", () => {
  test("복사는 □ ○ - 글자와 띄어쓰기 두 칸씩", () => {
    expect(linesToText(L("□ 개요 / ● 위치 / - 봉일천리"))).toBe("□ 개요\n  ○ 위치\n    - 봉일천리");
  });
  test("붙여 넣기는 앞 기호를 알아보고 떼요", () => {
    expect(textToLines("□ 개요\r\n  ○ 위치\n    - 봉일천리\n• 점\n· 가운뎃점\n그냥 글\n\n")).toEqual([
      { t: "개요", k: "sq" },
      { t: "위치" },
      { t: "봉일천리", k: "da" },
      { t: "점" },
      { t: "가운뎃점" },
      { t: "그냥 글" },
    ]);
  });
  test("기호 + 띄어쓰기가 아니면 그대로(-3%, 1))", () => {
    expect(textToLines("-3% 줄임\n1) 첫째")).toEqual([{ t: "-3% 줄임" }, { t: "1) 첫째" }]);
  });
});

describe("메모 편집기 Tab·새 줄", () => {
  test("tabKind – ● 목록에서 Tab → -, □ 목록에서 Tab → ●", () => {
    expect(tabKind([{ t: "가" }, { t: "나" }], 1, false)).toMatchInlineSnapshot(`"da"`);
    expect(tabKind([{ t: "가", k: "sq" }, { t: "나", k: "sq" }], 1, false)).toMatchInlineSnapshot(`"ci"`);
    expect(tabKind([{ t: "가", k: "sq" }, { t: "나" }], 1, true)).toMatchInlineSnapshot(`"sq"`);
  });
  test("newLineFor – Enter 같은 위계 · Shift+Enter 아래 · Ctrl+Enter 위", () => {
    const ls = L("□ a / ● b");
    expect(newLineFor(ls, 1, "same", "", 1)).toMatchInlineSnapshot(`
      {
        "t": "",
      }
    `);
    expect(newLineFor(ls, 1, "down", "", 1)).toMatchInlineSnapshot(`
      {
        "k": "da",
        "t": "",
      }
    `);
    expect(newLineFor(ls, 1, "up", "", 1)).toMatchInlineSnapshot(`
      {
        "k": "sq",
        "t": "",
      }
    `);
    expect(newLineFor(L("- c"), 0, "down", "", 0)).toMatchInlineSnapshot(`
      {
        "k": "da",
        "t": "",
      }
    `);
    expect(newLineFor(L("□ a"), 0, "up", "", 0)).toMatchInlineSnapshot(`
      {
        "k": "sq",
        "t": "",
      }
    `);
  });
});
