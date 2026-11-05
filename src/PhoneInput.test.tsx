// 화면 부품 시험(품질 보완 ③ ✔4): 전화번호 칸 – 치는 동안·떠날 때(2026-10-28 사용자 1안). 규칙 값은 phone.test.ts가 보고, 여기는 칸 동작만.
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PhoneInput } from "./PhoneInput";

afterEach(cleanup);

function Box({ init = "" }: { init?: string }) {
  const [v, setV] = useState(init);
  return <PhoneInput aria-label="번호" value={v} onChange={setV} />;
}

const box = () => screen.getByLabelText("번호") as HTMLInputElement;
const type = (v: string) => fireEvent.change(box(), { target: { value: v } });

describe("PhoneInput", () => {
  it("숫자만 치면 하이픈을 붙여요", () => {
    render(<Box />);
    type("01012345678");
    expect(box().value).toBe("010-1234-5678");
    type("0319401234");
    expect(box().value).toBe("031-940-1234");
  });

  it("하이픈 자리가 틀려도 규칙대로 다시 붙여요", () => {
    render(<Box />);
    type("010-72805715");
    expect(box().value).toBe("010-7280-5715");
  });

  it("괄호·띄어쓰기·글자가 섞이면 친 그대로", () => {
    render(<Box />);
    type("(02) 123 4567");
    expect(box().value).toBe("(02) 123 4567");
    type("내선 1234");
    expect(box().value).toBe("내선 1234");
  });

  it("떠날 때 자리 수가 모자라면 숫자만 남겨요", () => {
    render(<Box />);
    type("0101234");
    fireEvent.blur(box());
    expect(box().value).toBe("0101234");
  });

  it("네 자리 이하(내선)는 그대로", () => {
    render(<Box />);
    type("1234");
    fireEvent.blur(box());
    expect(box().value).toBe("1234");
  });

  it("다 지우면 빈 칸", () => {
    render(<Box init="010-1234-5678" />);
    type("");
    expect(box().value).toBe("");
  });
});
