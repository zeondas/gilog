// 탐색기 규칙 시험 – 지금 동작을 고정해요(정리 2차 2026-10-26): 이름 정렬(윈도우처럼 숫자 순·. 이 _ 앞)·빠른 필터·일괄 이름 바꾸기·경로.
import { describe, expect, test } from "vitest";
import { badName, bothName, compareName, crumbsOf, DEFAULT_RENAME, formatSize, isComplaintName, parentOf, quickMatch, renameOne, sortEntries } from "./files";

describe("compareName – 윈도우처럼", () => {
  const sorted = (a: string[]) => [...a].sort(compareName);
  test("숫자는 크기 순", () => expect(sorted(["파일10.txt", "파일2.txt", "파일1.txt"])).toEqual(["파일1.txt", "파일2.txt", "파일10.txt"]));
  test("앞 0은 무시, 길이가 같으면 그대로", () => expect(sorted(["a010", "a9", "a0011"])).toEqual(["a9", "a010", "a0011"]));
  test(". 이 _ 보다 앞", () => expect(sorted(["a_b", "a.b"])).toEqual(["a.b", "a_b"]));
  test("대소문자 무시", () => expect(compareName("ABC", "abc")).toBe(0));
  test("짧은 것이 앞", () => expect(sorted(["보고서 최종", "보고서"])).toEqual(["보고서", "보고서 최종"]));
});

test("sortEntries – 폴더가 먼저, 내림차순이면 폴더가 아래로", () => {
  const e = (name: string, dir: boolean, size = 0) => ({ name, dir, size, modified: 0, hidden: false }) as Parameters<typeof sortEntries>[0][number];
  const list = [e("b.txt", false, 5), e("가 폴더", true), e("a.txt", false, 9), e("나 폴더", true)];
  expect(sortEntries(list, "name", true).map((x) => x.name)).toEqual(["가 폴더", "나 폴더", "a.txt", "b.txt"]);
  expect(sortEntries(list, "name", false).map((x) => x.name)).toEqual(["b.txt", "a.txt", "나 폴더", "가 폴더"]);
  expect(sortEntries(list, "size", true).map((x) => x.name)).toEqual(["가 폴더", "나 폴더", "b.txt", "a.txt"]);
});

test.each([
  ["", "아무거나", true],
  ["보고", "2026 보고서.hwp", true],
  ["*.hwp", "2026 보고서.hwp", true],
  ["*.HWP;*.pdf", "a.pdf", true],
  ["보?서*", "보고서.hwp", true],
  ["*.xlsx", "보고서.hwp", false],
])("quickMatch %s / %s → %s", (f, n, want) => expect(quickMatch(f, n)).toBe(want));

describe("renameOne – 일괄 이름 바꾸기", () => {
  const mod = new Date(2026, 9, 15, 9, 5, 3).getTime();
  const R = (o: Partial<typeof DEFAULT_RENAME>) => ({ ...DEFAULT_RENAME, ...o });
  test.each([
    [{}, "현장사진.JPG", "현장사진.JPG"],
    [{ tpl: "[p]_[c]" }, "IMG_0001.jpg", "봉일천리_03.jpg"],
    [{ tpl: "[ymd]_[n]" }, "사진.jpg", "2026-10-15_사진.jpg"],
    [{ tpl: "[n] [hms]", timeFmt: "yyyymmdd hhnnss" }, "사진.jpg", "사진 090503.jpg"],
    [{ tpl: "[n1-3]" }, "봉일천리현장.jpg", "봉일천.jpg"],
    [{ tpl: "[n-2-]" }, "봉일천리현장.jpg", "현장.jpg"],
    [{ extTpl: "" }, "사진.jpg", "사진"],
    [{ extTpl: "png" }, "사진.jpg", "사진.png"],
    [{ caseMode: "lower", caseExt: true }, "IMG.JPG", "img.jpg"],
    [{ caseMode: "words" }, "road_photo-one.jpg", "Road_Photo-One.jpg"],
    [{ find: "img", repl: "사진" }, "IMG_img.jpg", "사진_사진.jpg"],
    [{ find: "img", repl: "사진", all: false, matchCase: true }, "IMG_img_img.jpg", "IMG_사진_img.jpg"],
    [{ find: "\\d+", repl: "#", regex: true }, "a12b3.jpg", "a#b#.jpg"],
    [{ find: "jpg", repl: "png", skipExt: false }, "jpg사진.jpg", "png사진.png"],
    [{ tpl: "[c]", start: 10, step: 5, digits: 3 }, "x.jpg", "020.jpg"],
  ])("%j %s → %s", (o, name, want) => expect(renameOne(name, mod, "봉일천리", 2, R(o as Partial<typeof DEFAULT_RENAME>))).toBe(want));
});

test.each([
  ["", true],
  ["a:b", true],
  ["끝 점.", true],
  ["끝 칸 ", true],
  ["..", true],
  ["보고서.hwp", false],
])("badName %j → %s", (n, want) => expect(badName(n)).toBe(want));

test("bothName – 같은 이름이면 (2)", () => {
  expect(bothName("보고서.hwp", (n) => n === "보고서 (2).hwp")).toMatchInlineSnapshot(`"보고서 (3).hwp"`);
});

test("경로", () => {
  expect(parentOf("C:\\Users\\문서\\a.txt")).toBe("C:\\Users\\문서");
  expect(parentOf("C:\\")).toBeNull();
  expect(crumbsOf("D:\\민원\\사진")).toMatchInlineSnapshot(`
    [
      {
        "name": "D:",
        "path": "D:\\",
      },
      {
        "name": "민원",
        "path": "D:\\민원",
      },
      {
        "name": "사진",
        "path": "D:\\민원\\사진",
      },
    ]
  `);
  expect(isComplaintName("261015_봉일천리_소파보수.pptx")).toBe(true);
  expect(isComplaintName("보고서.pptx")).toBe(false);
  expect([formatSize(0), formatSize(1023), formatSize(1536), formatSize(10 * 1024 * 1024)]).toMatchInlineSnapshot(`
    [
      "0B",
      "1023B",
      "2KB",
      "10.0MB",
    ]
  `);
});
