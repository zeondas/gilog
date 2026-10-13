// 화면에서 저장 쪽(Rust)을 부르는 곳이에요.
// 앱 밖(브라우저)에서 화면만 볼 때는 메모리에만 저장하는 흉내를 써요.
import { invoke } from "@tauri-apps/api/core";

export type Status = { exists: boolean; unlocked: boolean; folder: string };

/** 저장 쪽이 돌려주는 실패 이름이에요. */
export type ErrorCode =
  | "wrong_password"
  | "already_exists"
  | "not_found"
  | "password_too_short"
  | "locked"
  | "io"
  | "db"
  | "meta";

const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const fake = {
  password: null as string | null,
  unlocked: false,
  values: new Map<string, string>(),
};

function fakeCall(cmd: string, args: Record<string, string>): unknown {
  switch (cmd) {
    case "status":
      return { exists: fake.password !== null, unlocked: fake.unlocked, folder: "문서\\giLog (미리 보기)" };
    case "create_store":
      if (fake.password !== null) throw "already_exists";
      if (args.password.length < 4) throw "password_too_short";
      fake.password = args.password;
      fake.unlocked = true;
      return null;
    case "unlock":
      if (fake.password === null) throw "not_found";
      if (args.password !== fake.password) throw "wrong_password";
      fake.unlocked = true;
      return null;
    case "lock":
      fake.unlocked = false;
      return null;
    case "change_password":
      if (args.oldPassword !== fake.password) throw "wrong_password";
      if (args.newPassword.length < 4) throw "password_too_short";
      fake.password = args.newPassword;
      return null;
    case "get_value":
      if (!fake.unlocked) throw "locked";
      return fake.values.get(args.key) ?? null;
    case "set_value":
      if (!fake.unlocked) throw "locked";
      fake.values.set(args.key, args.value);
      return null;
  }
  throw "io";
}

async function call<T>(cmd: string, args: Record<string, string> = {}): Promise<T> {
  if (inApp) return invoke<T>(cmd, args);
  return fakeCall(cmd, args) as T;
}

export const api = {
  status: () => call<Status>("status"),
  create: (password: string) => call<null>("create_store", { password }),
  unlock: (password: string) => call<null>("unlock", { password }),
  lock: () => call<null>("lock"),
  changePassword: (oldPassword: string, newPassword: string) =>
    call<null>("change_password", { oldPassword, newPassword }),
  get: (key: string) => call<string | null>("get_value", { key }),
  set: (key: string, value: string) => call<null>("set_value", { key, value }),
};

/** 실패 이름을 화면에 보여 줄 문장으로 바꿔요. */
export function errorText(e: unknown): string {
  switch (e as ErrorCode) {
    case "wrong_password":
      return "암호가 맞지 않아요.";
    case "password_too_short":
      return "암호는 4자 이상이어야 해요.";
    case "already_exists":
      return "자료 파일이 이미 있어요. 앱을 다시 켜 주세요.";
    case "not_found":
      return "자료 파일을 찾지 못했어요.";
    case "locked":
      return "잠겨 있어요. 다시 열어 주세요.";
    default:
      return "파일을 읽거나 쓰지 못했어요. 자료 폴더를 확인해 주세요.";
  }
}
