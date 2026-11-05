// 업무일지 엑셀 내보내기 → 가져오기 왕복 시험(QC CO-28, 업무일지 ✔2).
// 내보낸 파일이 글을 잃지 않는지(표 뒤 기호 없는 줄·표 칸 안 줄 바꿈·구분을 비운 말 카드), 그 파일을 다시 가져오면
// 덮어쓰기는 같은 기록에 짝지어 늘지 않고(메모는 손대지 않음), 대체하기(빈 자료에 넣기)도 글이 모두 돌아오는지 봐요.
import { describe, expect, test } from "vitest";
import type { Entry, EntryInput } from "./api";
import { CELL_BREAK, JOURNAL_HEADERS, entryContent, journalImports, journalRows, memoText } from "./excel";
import { isMemoEntry } from "./journal";

const entry = (id: number, p: Partial<Entry>): Entry =>
  ({ id, date: "2026-11-03", time: "09:00", kind: "유선수신", who: "", contact: "", project: null, lines: [], body: "", ...p }) as Entry;

// 0.78.0 편집기로 QC와 같은 메모를 만들어 저장된 그대로(□ 줄 + 2×2 표(칸 안 줄 바꿈) + 기호 없는 줄 + □·●·- 위계)
const QC_MEMO =
  '<ul><li class="k-sq">QC 가져오기 시험</li></ul><table><colgroup><col style="width: 50%"><col style="width: 50%"></colgroup>' +
  "<tbody><tr><td>A1</td><td>B1<br>B2X</td></tr><tr><td>D1</td><td>E1</td></tr></tbody></table>" +
  '<p>L1</p><ul><li class="k-sq">위 항목</li><li class="lv1">가운데</li><li class="k-da lv2">아래</li></ul>';

/** 저장 쪽(core)이 하는 정리 – 구분이 비면 "메모" */
const saved = (e: EntryInput, id: number): Entry => ({ ...e, id, kind: e.kind.trim() || "메모" }) as Entry;

/** 글자 낱말(빈칸·기호로 나눔) – 대체하기로 다시 만든 메모도 글이 모두 있는지 */
const words = (s: string) => s.split(/[\s|/□○●\-·]+/).filter(Boolean).sort();
/** HTML의 글자 낱말 – 글자 조각(칸·줄)마다 따로 나눠요 */
const htmlWords = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  while (w.nextNode()) out.push(...words(w.currentNode.textContent ?? ""));
  return out.sort();
};

const ENTRIES: Entry[] = [
  entry(1, { kind: "메모", time: "21:00", body: QC_MEMO }),
  // 상대를 고르고 구분을 비워 등록한 말 카드 – 저장은 구분 "메모" + 말 줄(화면은 말 카드)
  entry(2, { kind: "메모", time: "09:30", who: "김민수 과장 · ○○설계", contact: "010-2222-3333", lines: [{ who: "김민수", me: false, text: "현장 확인 부탁해요" }, { who: "", me: true, text: "오후에 가요" }] }),
  entry(3, { kind: "유선수신", time: "10:00", who: "박주무관", lines: [{ who: "박주무관", me: false, text: "첫 줄\n둘째 줄" }] }),
  // 표 뒤에 문단 없이 바로 친 글(편집기가 문단으로 감싸지 않은 경우)·꾸밈 글자·목록 줄 안의 표
  entry(4, { kind: "메모", time: "11:00", body: '<table><tbody><tr><td>가</td><td>나</td></tr></tbody></table>표 뒤 <b>굵게</b> 글<ul><li>줄<table><tbody><tr><td>안1</td><td>안2</td></tr></tbody></table></li></ul>' }),
];

const sheetOf = (es: Entry[]) => ({ headers: JOURNAL_HEADERS, rows: journalRows(es, []) });

describe("내보내기가 글을 잃지 않아요(QC CO-28)", () => {
  test("QC 메모 – 표 줄은 한 줄, 칸 안 줄 바꿈은 ' / ', 표 뒤 기호 없는 줄·위계가 그대로", () => {
    expect(memoText(QC_MEMO).split("\n")).toEqual(["□ QC 가져오기 시험", `A1 | B1${CELL_BREAK}B2X`, "D1 | E1", "L1", "□ 위 항목", "  ○ 가운데", "    - 아래"]);
  });
  test("문단 밖 글·꾸밈 글자·목록 줄 안의 표도 빠지지 않아요", () => {
    expect(memoText(ENTRIES[3].body).split("\n")).toEqual(["가 | 나", "표 뒤 굵게 글", "○ 줄", "  안1 | 안2"]);
  });
  test("모든 메모의 글자가 내용 칸에 다 있어요", () => {
    for (const e of ENTRIES.filter(isMemoEntry)) expect(words(entryContent(e))).toEqual(htmlWords(e.body));
  });
  test("구분을 비운 말 카드 – 구분 칸은 비우고 내용은 말 줄, 상대는 그대로", () => {
    const row = sheetOf(ENTRIES).rows.find((r) => r[2] === "09:30")!;
    expect(row[3]).toBe("");
    expect(row[4]).toBe("김민수 과장 · ○○설계");
    expect(row[7]).toBe("김민수: 현장 확인 부탁해요\n나: 오후에 가요");
  });
});

describe("내보내기 → 가져오기 왕복", () => {
  test("덮어쓰기: 모두 같은 기록에 짝지어 늘지 않고, 메모는 손대지 않아요", () => {
    const r = journalImports(sheetOf(ENTRIES), ENTRIES, [], "전훈민");
    expect(r.bad).toBe(0);
    expect(r.dup).toBe(0);
    const byTime = new Map(ENTRIES.map((e) => [e.time, e.id]));
    expect(r.same).toEqual(r.entries.map((e) => byTime.get(e.time)));
    expect(r.keep).toEqual(r.entries.map((e) => isMemoEntry(saved(e, 0)) ));
  });
  test("대체하기(빈 자료): 말 카드는 같은 말·상대로, 메모는 글이 모두 돌아와요", () => {
    const r = journalImports(sheetOf(ENTRIES), [], [], "전훈민");
    expect(r.bad).toBe(0);
    expect(r.entries.length).toBe(ENTRIES.length);
    for (const [i, input] of r.entries.entries()) {
      const back = saved(input, 0);
      const orig = ENTRIES.find((e) => e.time === back.time)!;
      expect(isMemoEntry(back)).toBe(isMemoEntry(orig));
      if (isMemoEntry(orig)) {
        expect(htmlWords(back.body)).toEqual(htmlWords(orig.body));
      } else {
        expect(back.kind).toBe(orig.kind);
        expect(back.who).toBe(orig.who);
        expect(back.contact).toBe(orig.contact);
        expect(back.lines).toEqual(orig.lines);
      }
      expect(r.same[i]).toBeNull();
    }
  });
  test("다시 내보낸 파일은 처음 파일과 같은 글이에요(대체하기 뒤 한 번 더 왕복 – 메모는 문단으로 다시 만들어 줄 앞 들여쓰기만 빠져요)", () => {
    const flat = (rows: string[][]) => rows.map((r) => [...r.slice(1, 7), r[7].split("\n").map((x) => x.trim()).join("\n")]);
    const first = journalImports(sheetOf(ENTRIES), [], [], "전훈민").entries.map((e, i) => saved(e, i + 1));
    expect(flat(sheetOf(first).rows)).toEqual(flat(sheetOf(ENTRIES).rows));
  });
  test("예전 파일: 구분·상대가 모두 빈 줄은 지금처럼 메모예요", () => {
    const r = journalImports({ headers: JOURNAL_HEADERS, rows: [["", "2026-11-03", "08:00", "", "", "", "", "손으로 적은 메모"]] }, [], [], "");
    expect(r.entries[0].kind).toBe("메모");
    expect(r.entries[0].lines).toEqual([]);
  });
});

describe("연락처 칸 앞 0(QC CO-29 사용자 1안)", () => {
  test.each([
    ["1012345678", "010-1234-5678"],
    ["319401234", "031-940-1234"],
    ["010-2222-3333", "010-2222-3333"],
    ["4321", "4321"],
    ["kim@korea.kr", "kim@korea.kr"],
  ])("%s → %s", (v, want) => {
    const r = journalImports({ headers: JOURNAL_HEADERS, rows: [["", "2026-11-03", "09:00", "유선수신", "김", v, "", "김: 가"]] }, [], [], "");
    expect(r.entries[0].contact).toBe(want);
  });
});
