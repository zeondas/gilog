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
  | "meta";

export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const fake = {
  password: null as string | null,
  unlocked: false,
  values: new Map<string, string>(),
  prefs: { ...DEFAULT_PREFS },
};

function fakeCall(cmd: string, args: Record<string, unknown>): unknown {
  const a = args as Record<string, string>;
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
    default:
      return "파일을 읽거나 쓰지 못했어요. 자료 폴더를 확인해 주세요.";
  }
}
