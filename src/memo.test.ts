// 메모 편집기(집행현황·예산현황·업무일지 메모 – src/RichMemo.tsx sanitize) 정리 시험(2026-10-28 사용자):
// "쓰고 지웠다 저장하면 더미가 딸려와요" – 맨 앞·맨 끝 빈 줄은 지우고 겹친 빈 줄은 하나로(가운데 빈 줄 하나는 묶음 나눔이라 남겨요)
// "메모에 </li></ul> 같은 글자가 적혀 있어요" – 태그째 내보낸 예전 엑셀을 가져온 메모는 태그로 되살려요
import { describe, expect, test } from "vitest";
import { isEmptyMemo, looksLikeMemoHtml, sanitize } from "./RichMemo";
import { memoToText, textToMemo } from "./budget";

const B = '<li class="k-sq blank"><br></li>';

describe("빈 줄 정리", () => {
  test("목록 끝 빈 줄은 지워요", () => {
    expect(sanitize(`<ul><li class="k-sq">면적</li>${B}${B}</ul>`)).toBe('<ul><li class="k-sq">면적</li></ul>');
  });
  test("목록 앞 빈 줄은 지워요", () => {
    expect(sanitize(`<ul>${B}<li class="k-sq">아스콘</li></ul>`)).toBe('<ul><li class="k-sq">아스콘</li></ul>');
  });
  test("가운데 빈 줄은 하나만 남겨요(묶음 나눔)", () => {
    const s = sanitize(`<ul><li>가</li>${B}${B}${B}<li>나</li></ul>`);
    expect((s.match(/<li/g) ?? []).length).toBe(3);
    expect(memoToText(s).split("\n")).toHaveLength(3);
  });
  test("빈 줄만 남은 목록은 빈 메모", () => {
    expect(sanitize(`<ul>${B}</ul>`)).toBe("");
    expect(isEmptyMemo(`<ul>${B}${B}</ul>`)).toBe(true);
  });
  test("문단 앞·뒤 빈 줄도 지워요", () => {
    expect(sanitize("<p><br></p><p>글</p><p><br></p><p><br></p>")).toBe("<p>글</p>");
    expect(sanitize("<div>글</div><div><br></div><div><br></div>")).toBe("<p>글</p>");
  });
  test("표는 글자가 없어도 남겨요", () => {
    expect(sanitize("<table><tbody><tr><td></td></tr></tbody></table>")).toContain("<table");
  });
});

describe("태그가 글자로 들어간 메모", () => {
  const raw = '<ul><li>면적 4,000㎡</li><li data-k="da">아스콘 약 489톤</li></ul>';
  test("글자로 저장된 메모를 태그로 되살려요(예전 data-k 이름표 포함)", () => {
    const escaped = "<p>&lt;ul&gt;&lt;li&gt;면적 4,000㎡&lt;/li&gt;&lt;li data-k=&quot;da&quot;&gt;아스콘 약 489톤&lt;/li&gt;&lt;/ul&gt;</p>";
    const s = sanitize(escaped);
    expect(s).not.toContain("&lt;");
    expect(s).toContain('class="k-da');
    expect(memoToText(escaped)).not.toContain("<");
    expect(memoToText(escaped)).toContain("면적 4,000㎡");
    expect(memoToText(escaped)).toContain("- 아스콘 약 489톤");
  });
  test("엑셀 가져오기도 태그 칸은 메모로 읽어요", () => {
    expect(looksLikeMemoHtml(raw)).toBe(true);
    const m = textToMemo(raw);
    expect(m.startsWith("<ul>")).toBe(true);
    expect(memoToText(m)).not.toContain("</li>");
  });
  test("보통 글은 그대로(꺾쇠가 든 글도)", () => {
    expect(looksLikeMemoHtml("면적 <100㎡")).toBe(false);
    expect(memoToText(textToMemo("a < b, c > d"))).toBe("a < b, c > d");
  });
});
