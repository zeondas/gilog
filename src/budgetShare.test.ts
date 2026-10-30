// 집행현황 팀 공유 – 나가기·내보내기·끝내기 시험(2026-10-30 집행현황 공유 세션, 사용자 ①1안 ②2안 ③1안).
// 시트는 미리 보기 흉내(window.__shareFake), 사람마다 앱을 따로 불러와요(자기 kv·자기 모듈 상태).
import { beforeEach, describe, expect, test, vi } from "vitest";

type Kv = Map<string, string>;
let kv: Kv = new Map();

vi.mock("./api", () => ({
  inApp: false,
  api: {
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string) => void kv.set(k, v),
    budgetYears: async () => [],
    budgetData: async () => [],
    budgetShareApply: async () => 0,
    budgetShareClear: async () => null,
  },
}));
vi.mock("./google", () => ({
  connectForShare: async () => {},
  DRIVE_FILE_SCOPE: "drive.file",
  EMAIL_SCOPE: "email",
  SHEETS_SCOPE: "sheets",
  googleCall: async () => ({ status: 200, json: {} }),
  googleErrorCode: () => 0,
  hasGoogleScope: async () => true,
}));

type Share = typeof import("./budgetShare");
type Fake = { mail: string; books: Record<string, Record<string, unknown[][]>>; perms?: number };
const fake = (): Fake => (window as unknown as { __shareFake: Fake }).__shareFake;

/** 한 사람의 앱: 자기 kv와 새로 불러온 모듈 */
async function app(mail: string): Promise<{ kv: Kv; m: Share }> {
  const own: Kv = new Map();
  kv = own;
  fake().mail = mail;
  vi.resetModules();
  const m = await import("./budgetShare");
  await m.loadShare();
  return { kv: own, m };
}
/** 그 사람으로 바꿔 일하기(시트 메일·kv를 그 사람 것으로) */
async function as<T>(who: { kv: Kv; mail: string }, f: () => Promise<T>): Promise<T> {
  kv = who.kv;
  fake().mail = who.mail;
  return f();
}
const conf = (k: Kv) => JSON.parse(k.get("budget.share") ?? "{}");

beforeEach(() => {
  (window as unknown as { __shareFake: Fake }).__shareFake = { mail: "", books: {} };
});

async function team() {
  const h = await app("host@x.com");
  await h.m.setShareOn(true);
  await h.m.createSheet("호스트");
  await h.m.addPerson("팀원", "team@x.com");
  const sheet = conf(h.kv).sheet as string;
  const t = await app("team@x.com");
  await t.m.setShareOn(true);
  await t.m.joinSheet(sheet);
  const H = { ...h, mail: "host@x.com" };
  const T = { ...t, mail: "team@x.com" };
  return { H, T, sheet };
}

describe("팀 공유 나가기·내보내기·끝내기", () => {
  test("내보내기는 호스트만", async () => {
    const { T } = await team();
    await expect(as(T, () => T.m.removePerson(1))).rejects.toThrow("호스트만");
  });

  test("호스트가 내보내면 명단에서 빠지고, 빠진 앱은 새로고침 때 저절로 끊겨요", async () => {
    const { H, T, sheet } = await team();
    await as(H, () => H.m.removePerson(2));
    expect(fake().books[sheet]["사람"][2][4]).toBe(1);
    expect(conf(H.kv).sheet).toBe(sheet);
    await as(T, () => T.m.refreshShare());
    const c = conf(T.kv);
    expect(c.sheet).toBe("");
    expect(c.on).toBe(false);
    expect(c.error).toContain("명단에서 빠져");
    expect(T.kv.get("budget.share.base")).toBe("[]");
  });

  test("팀원이 나가면 명단에 지움 표시, 내 PC는 처음 상태(백업은 그대로)", async () => {
    const { T, sheet } = await team();
    T.kv.set("budget.share.backup", "{\"at\":\"x\",\"years\":[]}");
    const r = await as(T, () => T.m.leaveShare());
    expect(r.marked).toBe(true);
    expect(fake().books[sheet]["사람"][2][4]).toBe(1);
    expect(conf(T.kv).sheet).toBe("");
    expect(T.kv.get("budget.share.backup")).toContain("years");
  });

  test("호스트는 나가지 않고 끝내요 – 팀원 앱은 다음 새로고침 때 끊겨요", async () => {
    const { H, T, sheet } = await team();
    await expect(as(H, () => H.m.leaveShare())).rejects.toThrow("공유 끝내기");
    await as(H, () => H.m.endShare());
    expect(conf(H.kv).sheet).toBe("");
    expect(fake().books[sheet]["정보"][4][0]).toBe("끝냄");
    await as(T, () => T.m.refreshShare());
    expect(conf(T.kv).sheet).toBe("");
    expect(conf(T.kv).error).toContain("끝냈어요");
  });
});
