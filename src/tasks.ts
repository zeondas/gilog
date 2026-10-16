// 할 일 목록 화면이 쓰는 규칙들이에요. 화면 그리기와 떼어 두어 업무일지 "챙길 일"에서도 같이 써요.
import type { Complaint, Task } from "./api";
import { BLine, parseLines, plainOf } from "./bullets";
import { daysBetween } from "./complaints";
import { DONE_STATUS } from "./settingsStore";

/** 완료한 민원을 "완료됨"에 남겨 두는 기간이에요(마감일 기준). 그보다 오래된 완료 민원은 카드에서 빠져요. */
export const DONE_COMPLAINT_DAYS = 30;

/** 카드에 한 줄로 보이는 항목. 할 일이거나, 민원대장에서 온 민원이에요. */
export type Item = {
  /** "t12"(할 일) 또는 "c5"(민원) */
  key: string;
  task: Task | null;
  complaint: Complaint | null;
  title: string;
  detail: BLine[];
  due: string;
  done: boolean;
  /** 하위 항목 (할 일만, 한 단계) */
  children: Item[];
};

/** 민원 항목의 제목: 접수유형(지역 위치). 접수유형이 없으면 민원유형, 그것도 없으면 연번이에요. */
export function complaintTitle(c: Complaint): string {
  const where = [c.area, c.place].filter(Boolean).join(" ");
  const head = c.intake || c.ctype || `민원 ${c.no}번`;
  return where ? `${head}(${where})` : head;
}

/** 민원 카드에 보일 민원: 마감일이 있는 것. 완료한 것은 마감이 30일 안쪽이거나 이번에 체크한 것만 남겨요. */
export function complaintItems(list: Complaint[], today: string, keep: Set<number>): Item[] {
  return list
    .filter((c) => c.due && (c.status !== DONE_STATUS || keep.has(c.id) || daysBetween(c.due, today) <= DONE_COMPLAINT_DAYS))
    .map((c) => ({
      key: "c" + c.id,
      task: null,
      complaint: c,
      title: complaintTitle(c),
      detail: parseLines(c.body),
      due: c.due,
      done: c.status === DONE_STATUS,
      children: [],
    }));
}

const taskItem = (t: Task, children: Item[] = []): Item => ({
  key: "t" + t.id,
  task: t,
  complaint: null,
  title: t.title,
  detail: parseLines(t.detail),
  due: t.due,
  done: t.done,
  children,
});

/** 마감이 빠른 것이 위, 마감이 없는 것이 아래. 같으면 먼저 적은 것이 위예요. */
export function byDue(a: Item, b: Item): number {
  const da = a.due || "9999-99-99";
  const db = b.due || "9999-99-99";
  if (da !== db) return da < db ? -1 : 1;
  if (!!a.complaint !== !!b.complaint) return a.complaint ? -1 : 1;
  const ia = a.task?.id ?? a.complaint?.no ?? 0;
  const ib = b.task?.id ?? b.complaint?.no ?? 0;
  return ia - ib;
}

/** 한 목록의 할 일을 위 항목 + 하위 항목으로 묶어요. */
export function treeOf(tasks: Task[], listId: number): Item[] {
  const mine = tasks.filter((t) => t.list === listId);
  return mine
    .filter((t) => t.parent === null || !mine.some((p) => p.id === t.parent))
    .map((t) => taskItem(t, mine.filter((c) => c.parent === t.id).map((c) => taskItem(c)).sort(byDue)));
}

/** 검색에 맞는지 (제목, 세부정보, 민원은 연번·내용까지) */
export function itemMatches(it: Item, q: string): boolean {
  if (!q) return true;
  const hay = [it.title, it.detail.map((l) => l.t).join("\n"), it.complaint ? `${it.complaint.no} ${plainOf(it.complaint.action)}` : ""]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * 카드에 놓을 순서로 나눠요.
 * - 남은 일: 완료가 아닌 위 항목. 그 아래에는 완료가 아닌 하위 항목만 보여요.
 * - 완료됨: 완료한 위 항목(하위 항목과 함께), 그리고 남은 위 항목 아래에서 먼저 완료한 하위 항목.
 * 검색 중이면 맞는 항목(또는 맞는 하위 항목이 있는 위 항목)만 남겨요.
 */
export function split(items: Item[], q: string): { open: Item[]; done: Item[] } {
  const open: Item[] = [];
  const done: Item[] = [];
  for (const it of items) {
    const kids = q && !itemMatches(it, q) ? it.children.filter((c) => itemMatches(c, q)) : it.children;
    if (q && !itemMatches(it, q) && !kids.length) continue;
    if (it.done) done.push({ ...it, children: kids });
    else {
      open.push({ ...it, children: kids.filter((c) => !c.done) });
      for (const c of kids) if (c.done) done.push(c);
    }
  }
  open.sort(byDue);
  // 완료됨은 최근에 완료한 것이 위예요(민원은 완료한 날이 없어 마감일로 봐요).
  const when = (it: Item) => it.task?.doneOn || it.due || "";
  done.sort((a, b) => (when(a) !== when(b) ? (when(a) < when(b) ? 1 : -1) : byDue(a, b)));
  return { open, done };
}

/** 남은 일 개수 (하위 항목 포함) */
export const openCount = (items: Item[]) =>
  items.reduce((n, it) => n + (it.done ? 0 : 1 + it.children.filter((c) => !c.done).length), 0);

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 마감 배지: "10/16(금)" + "오늘"·"D-3"·"D+2", 색 단계 (오늘 파랑, 임박 기준 안·지남 빨강, 하루 더 주황) */
export function dueBadge(due: string, today: string, urgentDays: number): { date: string; dday: string; tone: "today" | "urgent" | "soon" | "" } {
  const [y, m, d] = due.split("-").map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  const n = daysBetween(today, due);
  const dday = n === 0 ? "오늘" : n > 0 ? `D-${n}` : `D+${-n}`;
  const tone = n === 0 ? "today" : n <= urgentDays ? "urgent" : n <= urgentDays + 1 ? "soon" : "";
  return { date: `${m}/${d}(${w})`, dday, tone };
}

/** 업무일지 "챙길 일": 마감이 within일 안이거나 지난, 완료가 아닌 할 일 (하위 항목 포함). 마감이 빠른 것이 위예요. */
export function tasksDueSoon(tasks: Task[], today: string, within = 7): Task[] {
  return tasks
    .filter((t) => !t.done && t.due && daysBetween(today, t.due) <= within)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id - b.id));
}
