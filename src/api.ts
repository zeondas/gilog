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
  | "invalid";

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
};

// 브라우저 미리 보기용 민원대장 흉내예요. 저장 쪽(core/complaints.rs)과 같은 규칙을 따라요.
function fakeComplaints(cmd: string, a: Record<string, unknown>): unknown {
  const isDate = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const [y, m, dd] = d.split("-").map(Number);
    const t = new Date(y, m - 1, dd);
    return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === dd;
  };
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
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

function fakeCall(cmd: string, args: Record<string, unknown>): unknown {
  const a = args as Record<string, string>;
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

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (inApp) return invoke<T>(cmd, args);
  return fakeCall(cmd, args) as T;
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
  setProjectColor: (id: number, color: number | null) => call<ContactsData>("set_project_color", { id, color }),
  deleteProject: (id: number) => call<ContactsData>("delete_project", { id }),

  journalData: () => call<JournalData>("journal_data"),
  addEntry: (entry: EntryInput) => call<Entry>("add_journal_entry", { entry }),
  updateEntry: (id: number, entry: EntryInput) => call<Entry>("update_journal_entry", { id, entry }),
  deleteEntry: (id: number) => call<null>("delete_journal_entry", { id }),
  setDay: (day: DayInfo) => call<DayInfo>("set_journal_day", { day }),

  complaints: () => call<Complaint[]>("complaints"),
  addComplaint: (complaint: ComplaintInput) => call<Complaint>("add_complaint", { complaint }),
  updateComplaint: (id: number, complaint: ComplaintInput) => call<Complaint>("update_complaint", { id, complaint }),
  setComplaintStatus: (id: number, status: string) => call<Complaint>("set_complaint_status", { id, status }),
  setComplaintMemo: (id: number, memo: string) => call<Complaint>("set_complaint_memo", { id, memo }),
  deleteComplaint: (id: number) => call<null>("delete_complaint", { id }),

  /** 윈도우 입력기를 한글(true) 또는 영문(false) 상태로 바꿔요. 앱 밖에서는 아무 일도 안 해요. */
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
      return "giLog 백업 파일이 아니에요.";
    case "invalid":
      return "넣은 값을 확인해 주세요.";
    default:
      return "파일을 읽거나 쓰지 못했어요. 자료 폴더를 확인해 주세요.";
  }
}
