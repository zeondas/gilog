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
};

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
