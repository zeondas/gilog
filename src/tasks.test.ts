// 할 일 규칙 시험 – 지금 동작을 고정해요(정리 2차 2026-10-26): 묶기·정렬·남은 일/완료됨·마감 배지·챙길 일.
import { describe, expect, test } from "vitest";
import type { Complaint, Task } from "./api";
import { complaintItems, complaintTitle, dueBadge, openCount, split, tasksDueSoon, treeOf } from "./tasks";

const T = (o: Partial<Task>): Task => ({ id: 1, list: 1, parent: null, title: "할 일", detail: "", due: "", done: false, doneOn: "", ...o });
const C = (o: Partial<Complaint>): Complaint => ({
  id: 1, no: 1, intake: "국민신문고", received: "2026-10-10", ctype: "포트홀", area: "조리읍", place: "봉일천리 113",
  person: "", phone: "", body: "", action: "", due: "2026-10-20", status: "접수", memo: "", ...o,
});

test("complaintTitle – 접수유형(지역 위치)", () => {
  expect(complaintTitle(C({}))).toBe("국민신문고(조리읍 봉일천리 113)");
  expect(complaintTitle(C({ intake: "", area: "", place: "" }))).toBe("포트홀");
  expect(complaintTitle(C({ intake: "", ctype: "", area: "", place: "", no: 7 }))).toBe("민원 7번");
});

test("complaintItems – 마감 있는 민원, 답변 끝난 것은 30일 안쪽만 완료됨에", () => {
  const list = [
    C({ id: 1, due: "2026-10-20" }),
    C({ id: 2, due: "" }),
    C({ id: 3, due: "2026-09-01", status: "답변" }), // 50일 지남 – 빠짐
    C({ id: 4, due: "2026-10-01", status: "완료" }), // 30일 안 – 남음
    C({ id: 5, due: "2026-09-01", status: "진행" }), // 빠짐, 이번에 체크했으면 남음
  ];
  const its = complaintItems(list, "2026-10-21", new Set([5]));
  expect(its.map((i) => [i.key, i.done])).toEqual([["c1", false], ["c4", true], ["c5", true]]);
});

test("treeOf – 위 항목 + 하위 한 단계, 하위는 마감순", () => {
  const tasks = [
    T({ id: 1, title: "위" }),
    T({ id: 2, parent: 1, due: "2026-10-30", title: "늦은 하위" }),
    T({ id: 3, parent: 1, due: "2026-10-20", title: "이른 하위" }),
    T({ id: 4, parent: 99, title: "부모 없는 하위는 위 항목으로" }),
    T({ id: 5, list: 2, title: "다른 목록" }),
  ];
  const tree = treeOf(tasks, 1);
  expect(tree.map((i) => i.key)).toEqual(["t1", "t4"]);
  expect(tree[0].children.map((i) => i.key)).toEqual(["t3", "t2"]);
});

describe("split – 남은 일·완료됨", () => {
  const tree = treeOf(
    [
      T({ id: 1, title: "보고서", due: "2026-10-25" }),
      T({ id: 2, parent: 1, title: "표", done: true, doneOn: "2026-10-19" }),
      T({ id: 3, parent: 1, title: "그림" }),
      T({ id: 4, title: "회의", due: "2026-10-22" }),
      T({ id: 5, title: "끝난 일", done: true, doneOn: "2026-10-20" }),
      T({ id: 6, title: "마감 없음" }),
    ],
    1,
  );
  test("마감순 · 먼저 완료한 하위는 완료됨으로 · 완료됨은 최근 것이 위", () => {
    const { open, done } = split(tree, "");
    expect(open.map((i) => [i.key, i.children.map((c) => c.key)])).toEqual([["t4", []], ["t1", ["t3"]], ["t6", []]]);
    expect(done.map((i) => i.key)).toEqual(["t5", "t2"]);
    expect(openCount(tree)).toBe(4);
  });
  test("검색 – 맞는 하위가 있는 위 항목만", () => {
    expect(split(tree, "그림").open.map((i) => [i.key, i.children.map((c) => c.key)])).toEqual([["t1", ["t3"]]]);
  });
  test("hold – 방금 체크한 것은 남은 일 자리에", () => {
    const held = tree.map((i) => (i.key === "t4" ? { ...i, done: true } : i));
    expect(split(held, "", "t4").open.map((i) => i.key)).toContain("t4");
    expect(split(held, "").open.map((i) => i.key)).not.toContain("t4");
  });
});

test.each([
  ["2026-10-21", "2026-10-21", { date: "10/21(수)", dday: "오늘", tone: "today" }],
  // 남은 날은 근무일(토·일·공휴일 빼고 – 2026-10-30 사용자): 주말 마감은 금요일까지 센 날
  ["2026-10-24", "2026-10-21", { date: "10/24(토)", dday: "D-2", tone: "urgent" }],
  ["2026-10-25", "2026-10-21", { date: "10/25(일)", dday: "D-2", tone: "urgent" }],
  ["2026-10-27", "2026-10-21", { date: "10/27(화)", dday: "D-4", tone: "soon" }],
  ["2026-10-30", "2026-10-21", { date: "10/30(금)", dday: "D-7", tone: "" }],
  ["2026-10-19", "2026-10-21", { date: "10/19(월)", dday: "D+2", tone: "urgent" }],
])("dueBadge %s (오늘 %s, 임박 3일)", (due, today, want) => expect(dueBadge(due, today, 3)).toEqual(want));

test("tasksDueSoon – 7일 안·지난 것, 완료 빼고, 마감순 → 번호순", () => {
  const tasks = [T({ id: 3, due: "2026-10-22" }), T({ id: 1, due: "2026-10-22" }), T({ id: 2, due: "2026-11-30" }), T({ id: 4, due: "2026-10-01" }), T({ id: 5, due: "2026-10-22", done: true }), T({ id: 6 })];
  expect(tasksDueSoon(tasks, "2026-10-21").map((t) => t.id)).toEqual([4, 1, 3]);
});
