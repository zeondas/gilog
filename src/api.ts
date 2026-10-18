// 화면에서 저장 쪽(Rust)을 부르는 곳이에요.
// 앱 밖(브라우저)에서 화면만 볼 때는 메모리에만 저장하는 흉내를 써요.
import { invoke } from "@tauri-apps/api/core";

export type Status = { exists: boolean; unlocked: boolean; folder: string };

/** 암호 없이도 읽는 앱 설정이에요. */
export type Prefs = {
  dataDir: string;
  theme: "system" | "light" | "dark";
  startScreen: string;
  fontSize: number;
  urgentDays: number;
  askPassword: boolean;
  autoLock: boolean;
  autoLockMin: number;
  /** 사이드바 접힘 */
  sideCollapsed: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  dataDir: "",
  theme: "system",
  startScreen: "journal",
  fontSize: 13,
  urgentDays: 2,
  askPassword: true,
  autoLock: true,
  autoLockMin: 10,
  sideCollapsed: false,
};

/** 저장 쪽이 돌려주는 실패 이름이에요. */
export type ErrorCode =
  | "wrong_password"
  | "already_exists"
  | "not_found"
  | "password_too_short"
  | "locked"
  | "keyring"
  | "io"
  | "db"
  | "meta"
  | "invalid"
  | "offline";

// ---------- 업무연락처 ----------

export type ContactInput = {
  name: string;
  org: string;
  role: string;
  mobile: string;
  tel: string;
  email: string;
  /** 프로젝트 이름들. 없는 이름은 새로 만들어져요. */
  projects: string[];
};

export type Contact = Omit<ContactInput, "projects"> & {
  id: number;
  /** 메모(JSON 글자). 비어 있으면 메모가 없어요. */
  memo: string;
  /** 붙은 프로젝트 번호 */
  projects: number[];
};

/** color가 null이면 자동 색이에요. */
export type Project = { id: number; name: string; color: number | null };

export type ContactsData = { contacts: Contact[]; projects: Project[] };

// ---------- 업무일지 ----------

/** 대화 한 줄. me가 참이면 내가 한 말이에요. */
export type JournalLine = { who: string; me: boolean; text: string };

export type EntryInput = {
  /** 2026-10-15 */
  date: string;
  /** 09:10 */
  time: string;
  kind: string;
  /** 상대 (적은 글자 그대로, 여러 명은 쉼표) */
  who: string;
  /** 연락처 (번호나 메일) */
  contact: string;
  /** 업무연락처의 프로젝트 번호 */
  project: number | null;
  lines: JournalLine[];
  /** 메모 본문(편집기 HTML). 구분이 "메모"인 기록은 말 줄 대신 이것을 써요. */
  body: string;
};

export type Entry = EntryInput & { id: number };

/** 날짜마다 하나 있는 머리 줄 */
export type DayInfo = { date: string; arrive: string; transport: string; weather: string; note: string };

export type JournalData = { days: DayInfo[]; entries: Entry[] };

// ---------- 민원대장 ----------

export type ComplaintInput = {
  /** 접수유형 */
  intake: string;
  /** 접수일 2026-10-15 */
  received: string;
  /** 민원유형 */
  ctype: string;
  /** 지역 */
  area: string;
  /** 위치 */
  place: string;
  /** 민원인 */
  person: string;
  /** 연락처 */
  phone: string;
  /** 내용 (여러 줄, 줄바꿈으로 나눠요) */
  body: string;
  /** 조치내용 (여러 줄) */
  action: string;
  /** 마감일. 비어 있으면 마감이 없어요. */
  due: string;
  status: string;
};

export type Complaint = ComplaintInput & {
  id: number;
  /** 연번 */
  no: number;
  /** 메모(JSON 글자). 비어 있으면 메모가 없어요. */
  memo: string;
};

// ---------- 할 일 목록 ----------

export type TaskList = {
  id: number;
  name: string;
  /** 체크를 끄면 카드를 숨겨요. */
  visible: boolean;
  /** 처음부터 있는 목록(민원). 지우거나 이름을 바꿀 수 없어요. */
  builtin: boolean;
  ord: number;
};

export type TaskInput = {
  list: number;
  /** 위 항목. 있으면 하위 항목이에요(한 단계까지). */
  parent: number | null;
  title: string;
  /** 세부정보 (머릿기호 줄 목록 JSON) */
  detail: string;
  /** 마감일. 비어 있으면 마감이 없어요. */
  due: string;
};

export type TaskEdit = { title: string; detail: string; due: string };

export type Task = TaskInput & {
  id: number;
  done: boolean;
  /** 완료한 날. 완료가 아니면 비어 있어요. */
  doneOn: string;
};

export type TasksData = { lists: TaskList[]; tasks: Task[] };

// ---------- 캘린더 ----------

/** 캘린더 종류. system은 앱이 만든 종류("complaint"·"task"·"holiday")이고 내 종류는 빈 글자예요. */
export type CalKind = {
  id: number;
  name: string;
  /** 구글 24색 가운데 번호(0~23). null이면 자동 색이에요(내 종류만). */
  color: number | null;
  visible: boolean;
  system: "" | "complaint" | "task" | "holiday";
  ord: number;
};

/** 반복 규칙. 빈 글자는 반복 안 함이에요. */
export type Repeat = "" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";

export type EventInput = {
  title: string;
  /** 종류 이름. 없는 이름이면 새 종류가 만들어져요. */
  kind: string;
  date: string;
  /** 끝 날짜 (비어 있으면 시작 날짜) */
  end: string;
  allDay: boolean;
  time: string;
  endTime: string;
  repeat: Repeat;
  /** 반복 종료일 (반복이면 꼭 있어야 해요) */
  until: string;
  place: string;
  /** 설명 (머릿기호 줄 목록 JSON) */
  desc: string;
  /** 알림(분 전): -1 없음, 0 정시, 1440 하루 전, 10080 7일 전, 43200 한 달 전, 그 밖에 직접 설정한 값 */
  remind: number;
  /** 종일 일정의 알림 시각 09:00 (비우면 9시). 시간 일정은 비어 있어요. */
  remindTime: string;
};

export type CalEvent = Omit<EventInput, "kind"> & { id: number; kind: number };

export type Holiday = { date: string; name: string };

export type CalendarData = { kinds: CalKind[]; events: CalEvent[]; holidays: Holiday[]; holidaysAt: string };

/** 알림이 실제로 뜨는지 보는 상태 (시험 단추) */
export type NotifyStatus = { pending: number; nextAt: number; shown: number; lastError: string; via: string };

/** 알림 한 건. at은 울릴 때(밀리초)예요. */
export type Reminder = { at: number; title: string; body: string; event: number; date: string };

// ---------- 민원처리(10단계) — core/process.rs와 같은 모양 ----------

export type WorkInput = {
  name: string;
  /** 시공사 */
  co: string;
  /** 현장대리인 = 업무연락처 번호 */
  contact: number | null;
  /** 업무연락처 프로젝트 번호(공사명과 같은 이름) */
  project: number | null;
  /** 처리 범위(AI의 판단 기준) */
  scope: string;
  nextSeq: number;
  /** 지시부 양식(pptx·hwpx) 경로 */
  tpl: string;
};
export type Work = WorkInput & { id: number };

/** new 지시부 전 · made 지시부 만듦 · queued 보낼 폴더에 넣음(Claude가 올리기 전) · sent 전송 완료 */
export type Stage = "new" | "made" | "queued" | "sent";

export type Case = {
  /** 접수번호 */
  no: string;
  received: string;
  due: string;
  area: string;
  place: string;
  summary: string;
  /** 보수내용 짧은 말(파일 이름) */
  short: string;
  reason: string;
  work: number | null;
  note: string;
  /** 비우면 공사의 다음 연번 */
  seq: string;
  stage: Stage;
  complaint: number | null;
  photos: string[];
  map: string;
  folder: string;
  orderFile: string;
  orderJpg: string;
  /** 보낼 폴더에 넣은 JPG */
  outboxFile: string;
  sentAt: string;
};

export type CasePatch = Partial<Pick<Case, "work" | "area" | "place" | "note" | "seq" | "stage" | "complaint" | "folder" | "orderFile" | "orderJpg" | "outboxFile" | "sentAt">>;
export type ProcessData = { works: Work[]; cases: Case[] };
export type InboxResult = { added: Case[]; skipped: number; failed: string[]; missingFiles: string[] };
export type RunStatus = { state: "idle" | "running" | "done" | "login" | "stopped" | "error"; total: number | null; done: number | null; message: string };
export type OrderResult = { case: Case; seq: number; workName: string; missing: string[] };

export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const fake = {
  password: null as string | null,
  unlocked: false,
  values: new Map<string, string>(),
  prefs: { ...DEFAULT_PREFS },
  contacts: [] as Contact[],
  projects: [] as Project[],
  nextId: 1,
  nextProjectId: 1,
  days: [] as DayInfo[],
  entries: [] as Entry[],
  nextEntryId: 1,
  complaints: [] as Complaint[],
  nextComplaintId: 1,
  works: [] as Work[],
  nextWorkId: 1,
  cases: [] as Case[],
  /** 미리 보기의 가져올 폴더: 다음 "민원 불러오기"가 읽어 갈 건들 */
  inbox: [] as Partial<Case>[],
  /** 미리 보기: Claude가 차례로 놓을 보기 민원과 진행 */
  runQueue: [] as Partial<Case>[],
  run: { state: "idle", total: null, done: null, message: "" } as RunStatus,
  taskLists: [
    { id: 1, name: "민원", visible: true, builtin: true, ord: 0 },
    { id: 2, name: "행정업무", visible: true, builtin: false, ord: 1 },
  ] as TaskList[],
  tasks: [] as Task[],
  nextListId: 3,
  nextTaskId: 1,
  calKinds: [
    { id: 1, name: "업무 일정", color: null, visible: true, system: "", ord: 0 },
    { id: 2, name: "회의 · 협의", color: null, visible: true, system: "", ord: 1 },
    { id: 3, name: "출장", color: null, visible: true, system: "", ord: 2 },
    { id: 4, name: "민원 마감", color: 1, visible: true, system: "complaint", ord: 1000 },
    { id: 5, name: "할 일 마감", color: 12, visible: true, system: "task", ord: 1001 },
    { id: 6, name: "공휴일", color: 3, visible: true, system: "holiday", ord: 1002 },
  ] as CalKind[],
  events: [] as CalEvent[],
  nextKindId: 7,
  nextEventId: 1,
  // 미리 보기용 공휴일 몇 개(앱에서는 저장 쪽이 앱에 넣어 온 목록과 인터넷에서 받은 것을 써요).
  holidays: [
    ["2026-09-24", "추석 전날"], ["2026-09-25", "추석"], ["2026-09-26", "추석 다음 날"], ["2026-10-03", "개천절"],
    ["2026-10-05", "대체공휴일(개천절)"], ["2026-10-09", "한글날"], ["2026-12-25", "기독탄신일"], ["2027-01-01", "1월 1일"],
  ].map(([date, name]) => ({ date, name })) as Holiday[],
  holidaysAt: "",
};

// 브라우저 미리 보기용 캘린더 흉내예요. 저장 쪽(core/calendar.rs)과 같은 규칙을 따라요.
function fakeCalendar(cmd: string, a: Record<string, unknown>): unknown {
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(d + "T00:00:00").getTime());
  const isTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const squash = (x: string) => x.split(/\s+/).filter(Boolean).join(" ");
  const kinds = () =>
    [...fake.calKinds].sort((x, y) => Number(x.system !== "") - Number(y.system !== "") || x.ord - y.ord || x.id - y.id).map((k) => ({ ...k }));
  const kindFor = (name: string) => {
    const n = squash(name);
    if (!n) return kinds().find((k) => !k.system)!.id;
    const k = fake.calKinds.find((x) => x.name === n);
    if (k?.system) throw "invalid";
    if (k) return k.id;
    const nk: CalKind = { id: fake.nextKindId++, name: n, color: null, visible: true, system: "", ord: Math.max(0, ...fake.calKinds.filter((x) => !x.system).map((x) => x.ord)) + 1 };
    fake.calKinds.push(nk);
    return nk.id;
  };
  const clean = (i: EventInput): Omit<CalEvent, "id"> => {
    const title = squash(i.title);
    const end = i.end.trim() || i.date;
    if (!title || !isDate(i.date) || !isDate(end) || end < i.date) throw "invalid";
    let time = "";
    let endTime = "";
    if (!i.allDay) {
      if (!isTime(i.time) || (i.endTime && !isTime(i.endTime))) throw "invalid";
      time = i.time;
      if (i.endTime) endTime = i.endTime;
      else {
        const m = Math.min(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + 60, 23 * 60 + 59);
        endTime = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
      }
      if (end === i.date && endTime < time) throw "invalid";
    }
    if (i.repeat && (!isDate(i.until) || i.until < i.date)) throw "invalid";
    if (i.remind !== -1 && (i.remind < 0 || i.remind > 62 * 24 * 60)) throw "invalid";
    const rt = i.allDay && i.remind >= 0 ? i.remindTime.trim() : "";
    if (rt && !isTime(rt)) throw "invalid";
    return { ...i, title, kind: kindFor(i.kind), end, time, endTime, until: i.repeat ? i.until : "", place: i.place.trim(), desc: i.desc, remindTime: rt };
  };
  const ev = (id: unknown) => {
    const e = fake.events.find((x) => x.id === id);
    if (!e) throw "not_found";
    return e;
  };
  switch (cmd) {
    case "calendar_data":
      return { kinds: kinds(), events: structuredClone(fake.events), holidays: structuredClone(fake.holidays), holidaysAt: fake.holidaysAt };
    case "cal_kinds":
      return kinds();
    case "add_event": {
      const e = { id: fake.nextEventId++, ...clean(a.event as EventInput) };
      fake.events.push(e);
      return { ...e };
    }
    case "update_event": {
      const e = ev(a.id);
      Object.assign(e, clean(a.event as EventInput));
      return { ...e };
    }
    case "delete_event":
      ev(a.id);
      fake.events = fake.events.filter((x) => x.id !== a.id);
      return null;
    case "add_cal_kind": {
      const n = squash(String(a.name));
      if (!n || fake.calKinds.some((k) => k.name === n)) throw "invalid";
      kindFor(n);
      return kinds();
    }
    case "set_cal_kind_color": {
      const k = fake.calKinds.find((x) => x.id === a.id);
      if (!k) throw "not_found";
      const c = a.color as number | null;
      k.color = c === null && k.system ? ({ complaint: 1, task: 12, holiday: 3 } as const)[k.system] : c;
      return kinds();
    }
    case "set_cal_kind_visible": {
      const k = fake.calKinds.find((x) => x.id === a.id);
      if (!k) throw "not_found";
      k.visible = !!a.visible;
      return kinds();
    }
    case "delete_cal_kind": {
      const k = fake.calKinds.find((x) => x.id === a.id);
      if (!k) throw "not_found";
      if (k.system || fake.calKinds.filter((x) => !x.system).length <= 1) throw "invalid";
      const n = fake.events.filter((e) => e.kind === k.id).length;
      fake.events = fake.events.filter((e) => e.kind !== k.id);
      fake.calKinds = fake.calKinds.filter((x) => x.id !== k.id);
      return n;
    }
    case "refresh_holidays":
      throw "offline";
    case "save_holidays": {
      const list = (a.list as Holiday[]).filter((h) => isDate(h.date) && h.name.trim());
      if (!list.length) throw "invalid";
      const years = new Set(list.map((h) => h.date.slice(0, 4)));
      fake.holidays = [...fake.holidays.filter((h) => !years.has(h.date.slice(0, 4))), ...list].sort((x, y) => (x.date < y.date ? -1 : 1));
      fake.holidaysAt = String(a.now);
      return structuredClone(fake.holidays);
    }
    case "set_reminders":
    case "set_notify_mode":
      return null;
    case "notify_status":
    case "test_notification":
      return { pending: 0, nextAt: 0, shown: 0, lastError: "", via: "미리 보기" };
  }
  return undefined;
}

// 브라우저 미리 보기용 할 일 흉내예요. 저장 쪽(core/tasks.rs)과 같은 규칙을 따라요.
function fakeTasks(cmd: string, a: Record<string, unknown>): unknown {
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(d + "T00:00:00").getTime());
  const squash = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");
  const lists = () => [...fake.taskLists].sort((x, y) => x.ord - y.ord || x.id - y.id).map((l) => ({ ...l }));
  const list = (id: unknown) => {
    const l = fake.taskLists.find((x) => x.id === id);
    if (!l) throw "not_found";
    return l;
  };
  const task = (id: unknown) => {
    const t = fake.tasks.find((x) => x.id === id);
    if (!t) throw "not_found";
    return t;
  };
  const clean = (e: TaskEdit): TaskEdit => {
    const title = squash(e.title);
    const due = e.due.trim();
    if (!title || (due && !isDate(due))) throw "invalid";
    const kept = (() => {
      try {
        const v = JSON.parse(e.detail || "[]");
        if (!Array.isArray(v)) return e.detail.trim();
        // 저장 쪽 lines()와 같아요: 묶음 사이 빈 줄은 하나만, 맨 앞·맨 끝 빈 줄은 빼요.
        const k: { t: string }[] = [];
        for (const x of v) {
          if (!x || typeof x.t !== "string") continue;
          if (!x.t.trim()) {
            if (k.length && k[k.length - 1].t !== "") k.push({ t: "" });
          } else k.push({ ...x, t: x.t.trim() });
        }
        while (k.length && k[k.length - 1].t === "") k.pop();
        return k.length ? JSON.stringify(k) : "";
      } catch {
        return e.detail.trim();
      }
    })();
    return { title, detail: kept, due };
  };
  const listName = (n: string) => {
    const name = squash(n);
    if (!name) throw "invalid";
    return name;
  };
  switch (cmd) {
    case "tasks_data":
      return { lists: lists(), tasks: structuredClone(fake.tasks) };
    case "add_task_list": {
      const name = listName(a.name as string);
      if (fake.taskLists.some((l) => l.name === name)) throw "invalid";
      const l = { id: fake.nextListId++, name, visible: true, builtin: false, ord: Math.max(0, ...fake.taskLists.map((x) => x.ord)) + 1 };
      fake.taskLists.push(l);
      return { ...l };
    }
    case "rename_task_list": {
      const l = list(a.id);
      if (l.builtin) throw "invalid";
      const name = listName(a.name as string);
      if (fake.taskLists.some((x) => x.name === name && x.id !== l.id)) throw "invalid";
      l.name = name;
      return { ...l };
    }
    case "set_task_list_visible": {
      const l = list(a.id);
      l.visible = a.visible as boolean;
      return { ...l };
    }
    case "move_task_list": {
      const all = lists();
      const i = all.findIndex((l) => l.id === a.id);
      if (i < 0) throw "not_found";
      const j = i + Math.sign(a.dir as number);
      if (j >= 0 && j < all.length && j !== i) [all[i], all[j]] = [all[j], all[i]];
      all.forEach((l, k) => (list(l.id).ord = k));
      return lists();
    }
    case "delete_task_list": {
      const l = list(a.id);
      if (l.builtin) throw "invalid";
      const n = fake.tasks.filter((t) => t.list === l.id).length;
      fake.tasks = fake.tasks.filter((t) => t.list !== l.id);
      fake.taskLists = fake.taskLists.filter((x) => x.id !== l.id);
      return n;
    }
    case "add_task": {
      const i = a.task as TaskInput;
      const c = clean(i);
      list(i.list);
      if (i.parent !== null) {
        const p = fake.tasks.find((t) => t.id === i.parent);
        if (!p || p.list !== i.list || p.parent !== null) throw "invalid";
      }
      const t: Task = { id: fake.nextTaskId++, list: i.list, parent: i.parent, ...c, done: false, doneOn: "" };
      fake.tasks.push(t);
      return structuredClone(t);
    }
    case "update_task": {
      const t = task(a.id);
      Object.assign(t, clean(a.task as TaskEdit));
      return structuredClone(t);
    }
    case "set_task_done": {
      const t = task(a.id);
      const done = a.done as boolean;
      const today = a.today as string;
      if (done && !isDate(today)) throw "invalid";
      const kids = fake.tasks.filter((x) => x.parent === t.id);
      const touched = [t, ...kids];
      if (done) touched.forEach((x) => !x.done && Object.assign(x, { done: true, doneOn: today }));
      else {
        touched.forEach((x) => Object.assign(x, { done: false, doneOn: "" }));
        const p = fake.tasks.find((x) => x.id === t.parent);
        if (p) {
          Object.assign(p, { done: false, doneOn: "" });
          touched.push(p);
        }
      }
      return structuredClone(touched);
    }
    case "delete_task": {
      const before = fake.tasks.length;
      fake.tasks = fake.tasks.filter((t) => t.id !== a.id && t.parent !== a.id);
      return before - fake.tasks.length;
    }
  }
  return undefined;
}

// 브라우저 미리 보기용 민원대장 흉내예요. 저장 쪽(core/complaints.rs)과 같은 규칙을 따라요.
function fakeComplaints(cmd: string, a: Record<string, unknown>): unknown {
  const isDate = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const [y, m, dd] = d.split("-").map(Number);
    const t = new Date(y, m - 1, dd);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === dd;
  };
  // 저장 쪽 lines()와 같아요: 줄 목록(JSON)이면 줄마다 정리, 아니면 줄바꿈 글자.
  const lines = (s: string) => {
    const t = s.trim();
    if (t.startsWith("[")) {
      try {
        const v = JSON.parse(t);
        if (Array.isArray(v)) {
          // 묶음 사이 빈 줄은 하나만 남기고 맨 앞·맨 끝 빈 줄은 빼요.
          const kept: Record<string, unknown>[] = [];
          for (const x of v) {
            if (!x || typeof x.t !== "string") continue;
            if (!x.t.trim()) {
              if (kept.length && kept[kept.length - 1].t !== "") kept.push({ t: "" });
              continue;
            }
            const o: Record<string, unknown> = { t: x.t.trim() };
            for (const k of ["k", "lv", "b", "s"]) if (x[k] !== undefined) o[k] = x[k];
            kept.push(o);
          }
          while (kept.length && kept[kept.length - 1].t === "") kept.pop();
          return kept.length ? JSON.stringify(kept) : "";
        }
      } catch {
        /* 글자로 받아요 */
      }
    }
    return s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  };
  const clean = (c: ComplaintInput): ComplaintInput => {
    const body = lines(c.body);
    const received = c.received.trim();
    const due = c.due.trim();
    if (!body || !isDate(received) || (due && !isDate(due))) throw "invalid";
    const t = (s: string) => s.trim();
    return {
      intake: t(c.intake), received, ctype: t(c.ctype), area: t(c.area), place: t(c.place),
      person: t(c.person), phone: t(c.phone), body, action: lines(c.action), due, status: t(c.status) || "접수",
    };
  };
  const find = () => {
    const c = fake.complaints.find((x) => x.id === a.id);
    if (!c) throw "not_found";
    return c;
  };
  switch (cmd) {
    case "complaints":
      return structuredClone([...fake.complaints].sort((x, y) => y.no - x.no || y.id - x.id));
    case "add_complaint": {
      const no = fake.complaints.reduce((m, x) => Math.max(m, x.no), 0) + 1;
      const c = { id: fake.nextComplaintId++, no, memo: "", ...clean(a.complaint as ComplaintInput) };
      fake.complaints.push(c);
      return structuredClone(c);
    }
    case "update_complaint": {
      const c = find();
      Object.assign(c, clean(a.complaint as ComplaintInput));
      return structuredClone(c);
    }
    case "set_complaint_status": {
      const c = find();
      c.status = (a.status as string).trim() || "접수";
      return structuredClone(c);
    }
    case "set_complaint_memo": {
      const c = find();
      c.memo = a.memo as string;
      return structuredClone(c);
    }
    case "delete_complaint":
      fake.complaints = fake.complaints.filter((x) => x.id !== a.id);
      return null;
    case "import_complaints": {
      // 엑셀 가져오기: 판단하지 않고 그대로 넣어요(core import_complaints와 같게).
      const rows = a.rows as (ComplaintInput & { memo: string })[];
      let no = fake.complaints.reduce((m, x) => Math.max(m, x.no), 0);
      for (const r of rows) {
        const t = (s: string) => (s ?? "").trim();
        fake.complaints.push({
          id: fake.nextComplaintId++, no: ++no, intake: t(r.intake), received: t(r.received), ctype: t(r.ctype), area: t(r.area),
          place: t(r.place), person: t(r.person), phone: t(r.phone), body: lines(r.body), action: lines(r.action), due: t(r.due),
          status: t(r.status) || "접수", memo: t(r.memo),
        });
      }
      return rows.length;
    }
  }
  return undefined;
}

// 브라우저 미리 보기용 업무일지 흉내예요. 저장 쪽(core/journal.rs)과 같은 규칙을 따라요.
function fakeJournal(cmd: string, a: Record<string, unknown>): unknown {
  const clean = (e: EntryInput): EntryInput => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time.trim())) throw "invalid";
    const lines = e.lines.map((l) => ({ who: l.who.trim(), me: l.me, text: l.text.trim() })).filter((l) => l.text);
    const text = (e.body ?? "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
    const body = text || (e.body ?? "").includes("<table") ? (e.body ?? "").trim() : "";
    if (!lines.length && !body) throw "invalid";
    const project = e.project !== null && fake.projects.some((p) => p.id === e.project) ? e.project : null;
    return { ...e, time: e.time.trim(), kind: e.kind.trim() || "메모", who: e.who.trim(), contact: e.contact.trim(), project, lines, body };
  };
  switch (cmd) {
    case "journal_data": {
      const entries = [...fake.entries].sort((x, y) =>
        x.date !== y.date ? (x.date < y.date ? 1 : -1) : x.time !== y.time ? (x.time < y.time ? 1 : -1) : y.id - x.id,
      );
      return { days: fake.days.map((d) => ({ ...d })), entries: structuredClone(entries) };
    }
    case "add_journal_entry": {
      const e = { id: fake.nextEntryId++, ...clean(a.entry as EntryInput) };
      fake.entries.push(e);
      return structuredClone(e);
    }
    case "update_journal_entry": {
      const i = fake.entries.findIndex((x) => x.id === a.id);
      if (i < 0) throw "not_found";
      fake.entries[i] = { id: a.id as number, ...clean(a.entry as EntryInput) };
      return structuredClone(fake.entries[i]);
    }
    case "delete_journal_entry":
      fake.entries = fake.entries.filter((x) => x.id !== a.id);
      return null;
    case "delete_journal_day": {
      const date = a.date as string;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw "invalid";
      const n = fake.entries.filter((x) => x.date === date).length;
      fake.entries = fake.entries.filter((x) => x.date !== date);
      fake.days = fake.days.filter((x) => x.date !== date);
      return n;
    }
    case "set_journal_day": {
      const d = a.day as DayInfo;
      const t: DayInfo = { date: d.date, arrive: d.arrive.trim(), transport: d.transport.trim(), weather: d.weather.trim(), note: d.note.trim() };
      fake.days = fake.days.filter((x) => x.date !== t.date);
      if (t.arrive || t.transport || t.weather || t.note) fake.days.push(t);
      return t;
    }
  }
  return undefined;
}

// 브라우저 미리 보기용 연락처 흉내예요. 저장 쪽(core/contacts.rs)과 같은 규칙을 따라요.
function fakeContacts(cmd: string, a: Record<string, unknown>): ContactsData | null {
  const data = (): ContactsData => ({
    contacts: [...fake.contacts].sort((x, y) => y.id - x.id).map((c) => ({ ...c, projects: [...c.projects] })),
    projects: fake.projects.map((p) => ({ ...p })),
  });
  const projectId = (name: string) => {
    const found = fake.projects.find((p) => p.name === name);
    if (found) return found.id;
    const p = { id: fake.nextProjectId++, name, color: null };
    fake.projects.push(p);
    return p.id;
  };
  const clean = (c: ContactInput) => {
    const name = c.name.trim();
    if (!name) throw "invalid";
    const names = [...new Set(c.projects.map((p) => p.trim()).filter(Boolean))];
    return {
      name,
      org: c.org.trim(),
      role: c.role.trim(),
      mobile: c.mobile.trim(),
      tel: c.tel.trim(),
      email: c.email.trim(),
      projects: names.map(projectId),
    };
  };
  switch (cmd) {
    case "contacts_data":
      return data();
    case "import_contacts": {
      const rows = a.rows as (ContactInput & { memo: string })[];
      for (const r of rows) {
        const t = (s: string) => (s ?? "").trim();
        const names = [...new Set(r.projects.map((p) => p.trim()).filter(Boolean))];
        fake.contacts.push({
          id: fake.nextId++, name: t(r.name), org: t(r.org), role: t(r.role), mobile: t(r.mobile), tel: t(r.tel), email: t(r.email),
          memo: t(r.memo), projects: names.map(projectId),
        });
      }
      return rows.length as unknown as ContactsData;
    }
    case "add_contact":
      fake.contacts.push({ id: fake.nextId++, memo: "", ...clean(a.contact as ContactInput) });
      return data();
    case "update_contact": {
      const c = fake.contacts.find((x) => x.id === a.id);
      if (!c) throw "not_found";
      Object.assign(c, clean(a.contact as ContactInput));
      return data();
    }
    case "set_contact_memo": {
      const c = fake.contacts.find((x) => x.id === a.id);
      if (!c) throw "not_found";
      c.memo = a.memo as string;
      return data();
    }
    case "delete_contact":
      fake.contacts = fake.contacts.filter((x) => x.id !== a.id);
      return data();
    case "add_project": {
      const name = (a.name as string).trim();
      if (!name) throw "invalid";
      projectId(name);
      return data();
    }
    case "rename_project": {
      const name = (a.name as string).trim();
      const p = fake.projects.find((x) => x.id === a.id);
      if (!p) throw "not_found";
      if (!name || fake.projects.some((x) => x.id !== a.id && x.name === name)) throw "invalid";
      p.name = name;
      return data();
    }
    case "set_project_color": {
      const p = fake.projects.find((x) => x.id === a.id);
      if (!p) throw "not_found";
      p.color = a.color as number | null;
      return data();
    }
    case "delete_project":
      fake.projects = fake.projects.filter((x) => x.id !== a.id);
      fake.entries.forEach((e) => e.project === a.id && (e.project = null));
      fake.contacts.forEach((c) => (c.projects = c.projects.filter((id) => id !== a.id)));
      return data();
  }
  return null;
}

/** 미리 보기의 엑셀 파일 흉내 (경로 → 내용) */
export const fakeExcel = new Map<string, unknown>();

// 브라우저 미리 보기용 민원처리 흉내예요. 저장 쪽(core/process.rs)과 같은 규칙을 따라요.
// 파일 일(양식 채우기·JPG·폴더 열기)은 하지 않고 경로만 지어 둬요.
function fakeProcess(cmd: string, a: Record<string, unknown>): unknown {
  const one = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");
  const stem = (c: Case) => {
    const d = c.received.replace(/\D/g, "");
    const clean = (t: string) => one(t.replace(/[\\/:*?"<>|_]/g, "")).slice(0, 40);
    return [d.length === 8 ? d.slice(2) : d, clean(c.place), clean(c.short)].filter(Boolean).join("_");
  };
  const findCase = (no: unknown) => {
    const c = fake.cases.find((x) => x.no === no);
    if (!c) throw "not_found";
    return c;
  };
  const cleanWork = (w: WorkInput): WorkInput => {
    const name = one(w.name);
    if (!name) throw "invalid";
    return { name, co: one(w.co), contact: w.contact, project: w.project, scope: w.scope.trim(), nextSeq: Math.max(1, Math.floor(w.nextSeq) || 1), tpl: w.tpl.trim() };
  };
  switch (cmd) {
    case "process_data":
      return structuredClone({ works: fake.works, cases: fake.cases });
    case "save_work": {
      const w = cleanWork(a.work as WorkInput);
      if (a.id == null) fake.works.push({ id: fake.nextWorkId++, ...w });
      else {
        const x = fake.works.find((y) => y.id === a.id);
        if (!x) throw "not_found";
        Object.assign(x, w);
      }
      return structuredClone(fake.works);
    }
    case "delete_work":
      fake.cases.forEach((c) => c.work === a.id && c.stage === "new" && (c.work = null));
      fake.works = fake.works.filter((w) => w.id !== a.id);
      return structuredClone(fake.works);
    case "update_case": {
      const c = findCase(a.no);
      const p = a.patch as CasePatch;
      if (p.work !== undefined && p.work !== c.work) Object.assign(c, { work: p.work, stage: "new", seq: "" });
      const area = p.area !== undefined ? one(p.area) : c.area;
      const place = p.place !== undefined ? one(p.place) || "주소불명" : c.place;
      if ((area !== c.area || place !== c.place) && p.stage === undefined) c.stage = "new";
      Object.assign(c, { area, place });
      if (p.note !== undefined) c.note = one(p.note);
      if (p.seq !== undefined) c.seq = p.seq.replace(/\D/g, "");
      for (const k of ["stage", "complaint", "folder", "orderFile", "orderJpg", "outboxFile", "sentAt"] as const) if (p[k] !== undefined) (c as Record<string, unknown>)[k] = p[k];
      return structuredClone(c);
    }
    case "delete_case":
      fake.cases = fake.cases.filter((c) => c.no !== a.no);
      return null;
    case "read_inbox": {
      const added: Case[] = [];
      let skipped = 0;
      for (const i of fake.inbox) {
        if (!i.no || fake.cases.some((c) => c.no === i.no)) {
          skipped++;
          continue;
        }
        const c: Case = {
          no: i.no, received: i.received ?? "", due: i.due ?? "", area: one(i.area ?? ""), place: one(i.place ?? "") || "주소불명",
          summary: (i.summary ?? "").trim(), short: one(i.short ?? ""), reason: (i.reason ?? "").trim(),
          work: i.work != null && fake.works.some((w) => w.id === i.work) ? i.work : null,
          note: "", seq: "", stage: "new", complaint: null, photos: [], map: "", folder: String(a.root ?? ""), orderFile: "", orderJpg: "", outboxFile: "", sentAt: "",
        };
        const s = stem(c);
        c.photos = (i.photos ?? []).map((_, n) => `${c.folder}\\${s}_사진${n + 1}.jpg`);
        c.map = i.map ? `${c.folder}\\${s}_위치도.png` : "";
        fake.cases.push(c);
        added.push(structuredClone(c));
      }
      fake.inbox = [];
      return { added, skipped, failed: [], missingFiles: [] };
    }
    case "make_order": {
      const r = a.req as unknown as { no: string; root: string };
      const c = findCase(r.no);
      const w = fake.works.find((x) => x.id === c.work);
      if (!w) throw "invalid";
      if (!w.tpl) throw "template";
      const seq = Number(c.seq) > 0 ? Number(c.seq) : w.nextSeq;
      w.nextSeq = Math.max(w.nextSeq, seq + 1);
      const ext = w.tpl.toLowerCase().endsWith(".hwpx") ? "hwpx" : "pptx";
      const folder = c.folder || r.root;
      Object.assign(c, { seq: String(seq), stage: "made", folder, orderFile: `${folder}\\${stem(c)}.${ext}`, orderJpg: "" });
      return { case: structuredClone(c), seq, workName: w.name, missing: [] };
    }
    case "order_jpg": {
      const c = findCase(a.no);
      if (!c.orderFile) throw "nofile";
      c.orderJpg = c.orderFile.replace(/\.(pptx|hwpx)$/i, ".jpg");
      return structuredClone(c);
    }
    case "send_order": {
      const c = findCase(a.no);
      if (!c.orderJpg) throw "nojpg";
      Object.assign(c, { stage: "queued", outboxFile: `${a.outbox}\\${c.orderJpg.split("\\").pop()}` });
      return structuredClone(c);
    }
    case "check_sent":
      // 미리 보기에는 Claude가 없어요 — 보내는 중으로 남아요.
      return [];
    case "open_path":
    case "show_in_folder":
    case "open_portal":
      return null;
    case "run_claude":
      // 미리 보기: 보기 민원을 몇 번에 나눠 가져올 폴더에 넣는 것처럼 보여요.
      fake.run = { state: "running", total: fake.runQueue.length, done: 0, message: "" };
      return null;
    case "stop_claude":
      if (fake.run.state === "running") fake.run.state = "stopped";
      fake.runQueue = [];
      return null;
    case "claude_status": {
      if (fake.run.state === "running") {
        const next = fake.runQueue.shift();
        if (next) {
          fake.inbox.push(next);
          fake.run.done = (fake.run.done ?? 0) + 1;
        } else fake.run.state = "done";
      }
      return { ...fake.run };
    }
      return null;
  }
  return undefined;
}

/** 미리 보기 전용: 가져올 폴더에 보기 민원을 넣어요(앱에서는 아무것도 안 해요). */
export function previewInbox(list: Partial<Case>[]) {
  if (!inApp) fake.runQueue = structuredClone(list);
}

function fakeCall(cmd: string, args: Record<string, unknown>): unknown {
  const a = args as Record<string, string>;
  // 엑셀 파일 읽기·쓰기 흉내(미리 보기 시험용): 쓴 것은 fakeExcel에 남기고, 읽기는 그것을 돌려줘요.
  if (cmd === "excel_write") {
    const heads = a.kind === "complaints"
      ? ["연번", "접수유형", "접수일", "민원유형", "지역", "위치", "민원인", "연락처", "내용", "조치내용", "마감일", "상태", "메모"]
      : ["연번", "이름", "소속", "직위", "무선", "유선", "이메일", "프로젝트", "메모"];
    fakeExcel.set(a.path, { headers: heads, rows: (args.data as { rows: string[][] }).rows });
    return null;
  }
  if (cmd === "excel_read") {
    const d = fakeExcel.get(a.path);
    if (!d) throw "invalid";
    return d;
  }
  {
    const r = fakeProcess(cmd, args);
    if (r !== undefined) {
      if (!fake.unlocked) throw "locked";
      return r;
    }
  }
  if (cmd.includes("contact") || cmd.includes("project")) {
    if (!fake.unlocked) throw "locked";
    const r = fakeContacts(cmd, args);
    if (r) return r;
  }
  if (cmd.includes("complaint")) {
    if (!fake.unlocked) throw "locked";
    const r = fakeComplaints(cmd, args);
    if (r !== undefined) return r;
  }
  if (cmd.includes("task")) {
    if (!fake.unlocked) throw "locked";
    const r = fakeTasks(cmd, args);
    if (r !== undefined) return r;
  }
  if (["calendar_data", "cal_kinds", "add_event", "update_event", "delete_event", "add_cal_kind", "set_cal_kind_color", "set_cal_kind_visible", "delete_cal_kind", "refresh_holidays", "save_holidays", "set_reminders", "set_notify_mode", "notify_status", "test_notification"].includes(cmd)) {
    if (!fake.unlocked && !["set_reminders", "set_notify_mode", "notify_status", "test_notification"].includes(cmd)) throw "locked";
    const r = fakeCalendar(cmd, args);
    if (r !== undefined) return r;
  }
  if (cmd.includes("journal")) {
    if (!fake.unlocked) throw "locked";
    const r = fakeJournal(cmd, args);
    if (r !== undefined) return r;
  }
  switch (cmd) {
    case "get_prefs":
      return { ...fake.prefs };
    case "set_prefs":
      fake.prefs = { ...(args.prefs as Prefs), dataDir: fake.prefs.dataDir };
      return null;
    case "status":
      return { exists: fake.password !== null, unlocked: fake.unlocked, folder: "문서\\giLog (미리 보기)" };
    case "auto_unlock":
      if (!fake.prefs.askPassword && fake.password !== null) {
        fake.unlocked = true;
        return true;
      }
      return false;
    case "create_store":
      if (fake.password !== null) throw "already_exists";
      if (a.password.length < 4) throw "password_too_short";
      fake.password = a.password;
      fake.unlocked = true;
      return null;
    case "unlock":
      if (fake.password === null) throw "not_found";
      if (a.password !== fake.password) throw "wrong_password";
      fake.unlocked = true;
      return null;
    case "lock":
      fake.unlocked = false;
      return null;
    case "change_password":
      if (a.oldPassword !== fake.password) throw "wrong_password";
      if (a.newPassword.length < 4) throw "password_too_short";
      fake.password = a.newPassword;
      return null;
    case "get_value":
      if (!fake.unlocked) throw "locked";
      return fake.values.get(a.key) ?? null;
    case "set_value":
      if (!fake.unlocked) throw "locked";
      fake.values.set(a.key, a.value);
      return null;
    case "export_backup":
      return null;
    case "import_backup":
      if (a.password !== fake.password) throw "wrong_password";
      fake.unlocked = false;
      fake.prefs.askPassword = true;
      return null;
    case "move_data":
      fake.unlocked = false;
      return null;
  }
  throw "io";
}

/** 자료를 바꾼 명령이 성공하면 알려 줄 곳(구글 연동이 바뀐 것을 내보내요). */
export const changeHooks = new Set<(cmd: string) => void>();

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = inApp ? await invoke<T>(cmd, args) : (fakeCall(cmd, args) as T);
  for (const f of changeHooks) f(cmd);
  return r;
}

export const api = {
  getPrefs: () => call<Prefs>("get_prefs"),
  setPrefs: (prefs: Prefs) => call<null>("set_prefs", { prefs }),
  status: () => call<Status>("status"),
  autoUnlock: () => call<boolean>("auto_unlock"),
  create: (password: string) => call<null>("create_store", { password }),
  unlock: (password: string) => call<null>("unlock", { password }),
  lock: () => call<null>("lock"),
  changePassword: (oldPassword: string, newPassword: string) =>
    call<null>("change_password", { oldPassword, newPassword }),
  get: (key: string) => call<string | null>("get_value", { key }),
  set: (key: string, value: string) => call<null>("set_value", { key, value }),
  exportBackup: (path: string) => call<null>("export_backup", { path }),
  importBackup: (path: string, password: string) => call<null>("import_backup", { path, password }),
  moveData: (folder: string) => call<null>("move_data", { folder }),

  contactsData: () => call<ContactsData>("contacts_data"),
  addContact: (contact: ContactInput) => call<ContactsData>("add_contact", { contact }),
  updateContact: (id: number, contact: ContactInput) => call<ContactsData>("update_contact", { id, contact }),
  setContactMemo: (id: number, memo: string) => call<ContactsData>("set_contact_memo", { id, memo }),
  deleteContact: (id: number) => call<ContactsData>("delete_contact", { id }),
  addProject: (name: string) => call<ContactsData>("add_project", { name }),
  renameProject: (id: number, name: string) => call<ContactsData>("rename_project", { id, name }),
  setProjectColor: (id: number, color: number | null) => call<ContactsData>("set_project_color", { id, color }),
  deleteProject: (id: number) => call<ContactsData>("delete_project", { id }),

  journalData: () => call<JournalData>("journal_data"),
  addEntry: (entry: EntryInput) => call<Entry>("add_journal_entry", { entry }),
  updateEntry: (id: number, entry: EntryInput) => call<Entry>("update_journal_entry", { id, entry }),
  deleteEntry: (id: number) => call<null>("delete_journal_entry", { id }),
  setDay: (day: DayInfo) => call<DayInfo>("set_journal_day", { day }),
  /** 그 날의 기록과 머리 줄을 모두 지워요. 지운 기록 수를 돌려줘요. */
  deleteDay: (date: string) => call<number>("delete_journal_day", { date }),

  complaints: () => call<Complaint[]>("complaints"),
  addComplaint: (complaint: ComplaintInput) => call<Complaint>("add_complaint", { complaint }),
  updateComplaint: (id: number, complaint: ComplaintInput) => call<Complaint>("update_complaint", { id, complaint }),
  setComplaintStatus: (id: number, status: string) => call<Complaint>("set_complaint_status", { id, status }),
  setComplaintMemo: (id: number, memo: string) => call<Complaint>("set_complaint_memo", { id, memo }),
  deleteComplaint: (id: number) => call<null>("delete_complaint", { id }),
  processData: () => call<ProcessData>("process_data"),
  saveWork: (id: number | null, work: WorkInput) => call<Work[]>("save_work", { id, work }),
  deleteWork: (id: number) => call<Work[]>("delete_work", { id }),
  updateCase: (no: string, patch: CasePatch) => call<Case>("update_case", { no, patch }),
  deleteCase: (no: string) => call<null>("delete_case", { no }),
  readInbox: (inbox: string, downloads: string, root: string) => call<InboxResult>("read_inbox", { inbox, downloads, root }),
  makeOrder: (req: { no: string; root: string; signer: string; date: string }) => call<OrderResult>("make_order", { req }),
  orderJpg: (no: string) => call<Case>("order_jpg", { no }),
  sendOrder: (no: string, outbox: string) => call<Case>("send_order", { no, outbox }),
  checkSent: (now: string) => call<Case[]>("check_sent", { now }),
  openPath: (path: string) => call<null>("open_path", { path }),
  showInFolder: (path: string) => call<null>("show_in_folder", { path }),
  openPortal: (url: string) => call<null>("open_portal", { url }),
  runClaude: (req: { exe: string; inbox: string; downloads: string; guide: string }) => call<null>("run_claude", { req }),
  stopClaude: () => call<null>("stop_claude"),
  claudeStatus: (inbox: string) => call<RunStatus>("claude_status", { inbox }),
  /** 엑셀에서 읽은 줄을 그대로 넣고 넣은 수를 돌려줘요. */
  importComplaints: (rows: (ComplaintInput & { memo: string })[]) => call<number>("import_complaints", { rows }),
  importContacts: (rows: (ContactInput & { memo: string })[]) => call<number>("import_contacts", { rows }),
  /** 엑셀 파일 쓰기·읽기(kind: "complaints" | "contacts") */
  excelWrite: (path: string, kind: string, data: { rows: string[][]; intake: string[]; status: string[] }) => call<null>("excel_write", { path, kind, data }),
  excelRead: (path: string, kind: string) => call<{ headers: string[]; rows: string[][] }>("excel_read", { path, kind }),

  tasksData: () => call<TasksData>("tasks_data"),
  addTaskList: (name: string) => call<TaskList>("add_task_list", { name }),
  renameTaskList: (id: number, name: string) => call<TaskList>("rename_task_list", { id, name }),
  setTaskListVisible: (id: number, visible: boolean) => call<TaskList>("set_task_list_visible", { id, visible }),
  /** 목록을 앞(-1)·뒤(+1)로 옮기고 모든 목록을 돌려줘요. */
  moveTaskList: (id: number, dir: number) => call<TaskList[]>("move_task_list", { id, dir }),
  /** 목록과 그 안의 할 일을 지워요. 지운 할 일 수를 돌려줘요. */
  deleteTaskList: (id: number) => call<number>("delete_task_list", { id }),
  addTask: (task: TaskInput) => call<Task>("add_task", { task }),
  updateTask: (id: number, task: TaskEdit) => call<Task>("update_task", { id, task }),
  /** 완료하거나 되돌리고, 함께 바뀐 할 일(하위·위 항목)을 돌려줘요. */
  setTaskDone: (id: number, done: boolean, today: string) => call<Task[]>("set_task_done", { id, done, today }),
  deleteTask: (id: number) => call<number>("delete_task", { id }),

  calendarData: () => call<CalendarData>("calendar_data"),
  addEvent: (event: EventInput) => call<CalEvent>("add_event", { event }),
  updateEvent: (id: number, event: EventInput) => call<CalEvent>("update_event", { id, event }),
  deleteEvent: (id: number) => call<null>("delete_event", { id }),
  calKinds: () => call<CalKind[]>("cal_kinds"),
  addCalKind: (name: string) => call<CalKind[]>("add_cal_kind", { name }),
  setCalKindColor: (id: number, color: number | null) => call<CalKind[]>("set_cal_kind_color", { id, color }),
  setCalKindVisible: (id: number, visible: boolean) => call<CalKind[]>("set_cal_kind_visible", { id, visible }),
  /** 종류와 그 종류의 일정을 지워요. 지운 일정 수를 돌려줘요. */
  deleteCalKind: (id: number) => call<number>("delete_cal_kind", { id }),
  /** 공휴일을 인터넷에서 받아 저장해요. 받지 못하면 "offline"으로 실패해요. */
  refreshHolidays: (now: string) => call<Holiday[]>("refresh_holidays", { now }),
  /** 화면이 받아 온 공휴일을 저장해요(받은 해만 바꿔요). */
  saveHolidays: (list: Holiday[], now: string) => call<Holiday[]>("save_holidays", { list, now }),
  /** 앞으로 울릴 알림 목록을 보내요(윈도우 알림은 앱이 띄워요). */
  setReminders: (list: Reminder[]) => call<null>("set_reminders", { list }),
  /** 지금 바로 알림 하나를 띄워 봐요. 실패하면 윈도우가 돌려준 이유로 실패해요. */
  testNotification: () => call<NotifyStatus>("test_notification"),
  notifyStatus: () => call<NotifyStatus>("notify_status"),
  /** 알림을 PowerShell 이름으로 띄울지 (기Log 이름으로 안 보이는 PC) */
  setNotifyMode: (powershell: boolean) => call<null>("set_notify_mode", { powershell }),

  /** 윈도우 입력기를 한글(true) 또는 영문(false) 상태로 바꿔요. 앱 밖에서는 아무 일도 안 해요. */
  /** 첫 화면을 그렸다고 알려요. 숨긴 채 만든 창이 이때 보여요(브라우저에서는 아무 일 없음). */
  windowReady: () => (inApp ? invoke<null>("window_ready").catch(() => null) : Promise.resolve(null)),
  setIme: (korean: boolean) => (inApp ? invoke<null>("set_ime", { korean }) : Promise.resolve(null)),
};

/** 실패 이름을 화면에 보여 줄 문장으로 바꿔요. */
export function errorText(e: unknown): string {
  switch (e as ErrorCode) {
    case "wrong_password":
      return "암호가 맞지 않아요.";
    case "password_too_short":
      return "암호는 4자 이상이어야 해요.";
    case "already_exists":
      return "그 폴더에 자료 파일이 이미 있어요.";
    case "not_found":
      return "자료 파일을 찾지 못했어요.";
    case "locked":
      return "잠겨 있어요. 다시 열어 주세요.";
    case "keyring":
      return "윈도우 자격 증명 관리자에 열쇠를 맡기지 못했어요.";
    case "meta":
      return "기Log 백업 파일이 아니에요.";
    case "invalid":
      return "넣은 값을 확인해 주세요.";
    case "offline":
      return "인터넷에 연결하지 못했어요.";
    default:
      return "파일을 읽거나 쓰지 못했어요. 자료 폴더를 확인해 주세요.";
  }
}
