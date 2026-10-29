// 화면 부품 시험(품질 보완 ③ ✔4): 여러 줄 칸 BulletEditor의 키 – 엔터규칙(keys.ts "여러 줄 칸")·머릿기호 치기·줄 맨 앞 Backspace.
// 위계·들여쓰기 계산은 bullets.test.ts가 보고, 여기는 키를 눌렀을 때 줄이 어떻게 바뀌는지만.
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BulletEditor } from "./BulletParts";
import { BLine, kindOf } from "./bullets";

afterEach(cleanup);

let now: BLine[] = [];

function Box({ init }: { init: BLine[] }) {
  const [ls, setLs] = useState(init);
  now = ls;
  return (
    <BulletEditor
      lines={ls}
      onChange={(n) => {
        now = n;
        setLs(n);
      }}
      name="body"
      label="내용"
    />
  );
}

/** 줄 글자와 기호 종류 */
const view = () => now.map((l) => [kindOf(l), l.t]);
const line = (i: number) => document.querySelector<HTMLTextAreaElement>(`textarea[data-i="${i}"]`)!;
function key(i: number, k: string, at: number, mods: Partial<KeyboardEventInit> = {}) {
  const el = line(i);
  el.focus();
  el.setSelectionRange(at, at);
  fireEvent.keyDown(el, { key: k, code: k === "Enter" ? "Enter" : undefined, ...mods });
}

describe("BulletEditor", () => {
  it("글을 치면 그 줄에 들어가고 줄바꿈 글자는 띄어쓰기로", () => {
    render(<Box init={[]} />);
    fireEvent.change(line(0), { target: { value: "도로\n파임" } });
    expect(view()).toEqual([["ci", "도로 파임"]]);
  });

  it("Enter는 같은 위계 새 줄 – 커서 뒤 글은 새 줄로", () => {
    render(<Box init={[{ t: "포장보수" }]} />);
    key(0, "Enter", 2);
    expect(view()).toEqual([
      ["ci", "포장"],
      ["ci", "보수"],
    ]);
  });

  it("Shift+Enter는 한 위계 아래(□ → ●)", () => {
    render(<Box init={[{ t: "현장", k: "sq" }]} />);
    key(0, "Enter", 2, { shiftKey: true });
    expect(view()).toEqual([
      ["sq", "현장"],
      ["ci", ""],
    ]);
  });

  it("Ctrl+Enter는 한 위계 위(● → □)", () => {
    render(<Box init={[{ t: "현장", k: "sq" }, { t: "점검" }]} />);
    key(1, "Enter", 2, { ctrlKey: true });
    expect(view()[2]).toEqual(["sq", ""]);
  });

  it("줄 맨 앞 '] ' ') ' '- '는 □·●·작대기", () => {
    render(<Box init={[{ t: "]" }, { t: ")" }, { t: "-" }]} />);
    key(0, " ", 1);
    key(1, " ", 1);
    key(2, " ", 1);
    expect(view()).toEqual([
      ["sq", ""],
      ["ci", ""],
      ["da", ""],
    ]);
  });

  it("줄 가운데의 '- '는 그대로 글자", () => {
    render(<Box init={[{ t: "a-" }]} />);
    key(0, " ", 2);
    expect(view()).toEqual([["ci", "a-"]]);
  });

  it("줄 맨 앞 Backspace: 기호 지우기 → 한 번 더면 윗줄과 합치기", () => {
    render(<Box init={[{ t: "도로" }, { t: "파임" }]} />);
    key(1, "Backspace", 0);
    expect(view()).toEqual([
      ["ci", "도로"],
      ["none", "파임"],
    ]);
    key(1, "Backspace", 0);
    expect(view()).toEqual([["ci", "도로파임"]]);
  });
});
