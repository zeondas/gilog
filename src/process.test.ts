// 민원처리 규칙 시험 – 띠 아래로 숨기는 민원대장 상태(✔2 1안, 2026-10-30).
import { describe, expect, test } from "vitest";
import { isClaudeName, isHiddenStatus } from "./process";

describe("숨기는 상태", () => {
  test("답변·완료·불가는 숨겨요", () => {
    for (const s of ["답변", "완료", "불가"]) expect(isHiddenStatus(s)).toBe(true);
  });
  test("접수·진행·보류·장기는 표에 남아요", () => {
    for (const s of ["접수", "진행", "보류", "장기", ""]) expect(isHiddenStatus(s)).toBe(false);
  });
});

describe("Claude 실행 파일 이름(QC ST-19)", () => {
  test("claude·claude.exe만", () => {
    expect(isClaudeName("")).toBe(true);
    expect(isClaudeName("claude")).toBe(true);
    expect(isClaudeName("C:\\Users\\me\\.local\\bin\\CLAUDE.EXE")).toBe(true);
    expect(isClaudeName(" d:/tools/claude.exe ")).toBe(true);
    expect(isClaudeName("D:\\gilog_test\\qc\\notclaude.exe")).toBe(false);
    expect(isClaudeName("C:\\Windows\\System32\\cmd.exe")).toBe(false);
    expect(isClaudeName("C:\\x\\claude.exe.bat")).toBe(false);
  });
});
