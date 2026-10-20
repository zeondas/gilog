// 집행현황 팀 공유(2026-10-20 사용자 결정 – CLAUDE.md 공통 결정 로그 13:10·15:23, 사양서 "집행현황 (12단계) › 팀 공유")
//
// - 원본은 내 PC 자료 파일이고, 구글 시트 하나를 같이 써요. [새로고침](열 때·5분마다·단추)이 받기와 올리기를 한 번에 해요.
// - 줄마다 uid(core가 만들 때 정함)로 PC 사이 같은 줄을 찾아요. 시트의 줄은 지우지 않고 "지움" 표시만 해요(줄 자리가 바뀌지 않게).
// - 합치기는 칸 단위 세 갈래 비교: 마지막으로 맞춘 값(base, kv budget.share.base) · 내 값 · 시트 값.
//   내 것만 바뀜 = 올리기, 시트만 바뀜 = 받기, 둘 다 다르게 바뀜 = 같은 칸(고르기 전엔 내 값, 올리지 않음).
//   순서·위 줄·해(줄 자리)는 고르지 않고 시트 값을 따라요.
// - 권한: 모두 시트 권한(spreadsheets), 호스트만 공유를 바꾸는 drive.file. 명단(시트 "사람" 탭)은 누구나 고치고
//   실제 권한 주기·거두기는 호스트 앱이 새로고침 때 해요. 호스트 넘기기 = 새 호스트가 새 시트를 만들어 옮기고 옛 시트에 새 주소를 남겨요.
// - 집행현황만 나가요(민원인 정보 없음).
import { api, inApp } from "./api";
import type { BudgetProject } from "./budget";
import { connectForShare, DRIVE_FILE_SCOPE, EMAIL_SCOPE, googleCall, googleErrorCode, hasGoogleScope, SHEETS_SCOPE } from "./google";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";

export const TAB = "집행현황";
export const PEOPLE = "사람";
export const INFO = "정보";
/** 자동 새로고침 간격(사용자 2안 – 열 때 + 5분마다 + 단추) */
export const AUTO_MS = 5 * 60_000;

// ---------- 줄 모양 ----------

export type Level = "project" | "item" | "row";
export const FIELDS = ["year", "parent", "ord", "name", "budget", "carry", "owner", "kind", "co", "cmt", "exp", "act", "stage", "memo"] as const;
export type Field = (typeof FIELDS)[number];
/** 줄 자리 칸: 같은 칸이어도 묻지 않고 시트 값을 따라요. */
const STRUCT = new Set<Field>(["year", "parent", "ord"]);
const NUMERIC = new Set<Field>(["year", "ord", "budget", "owner", "cmt", "exp", "act"]);
export type Rec = { level: Level; uid: string; del: boolean; f: Record<Field, string> };
/** 칸마다 마지막으로 올린 사람 번호·시각 */
export type Meta = Partial<Record<Field, [number, string]>>;
export type SheetRec = Rec & { row: number; meta: Meta };

const LEVEL_KO: Record<Level, string> = { project: "세부사업", item: "부기사업", row: "공사" };
export const HEADERS = ["uid", "겹", "해", "위 줄", "순서", "이름", "예산", "이월", "담당", "구분", "업체", "원인행위", "집행액", "시공량", "단계", "메모", "지움", "고친 기록"];
const DEL_COL = 2 + FIELDS.length; // Q
const META_COL = DEL_COL + 1; // R
const letter = (i: number) => String.fromCharCode(65 + i);
const colOf = (f: Field) => letter(2 + FIELDS.indexOf(f));
const q = (tab: string) => `'${tab}'`;

const str = (v: unknown) => (v == null ? "" : String(v));
function emptyF(): Record<Field, string> {
  return Object.fromEntries(FIELDS.map((k) => [k, ""])) as Record<Field, string>;
}
const rec = (level: Level, uid: string, f: Partial<Record<Field, string>>): Rec => ({ level, uid, del: false, f: { ...emptyF(), ...f } });

/** 내 집행현황(여러 해) → uid별 줄. 펼침(open)은 사람마다라 나가지 않아요. */
export function flatten(years: BudgetProject[][]): Map<string, Rec> {
  const m = new Map<string, Rec>();
  for (const ps of years) {
    ps.forEach((p, i) => {
      const year = str(p.year);
      m.set(p.uid, rec("project", p.uid, { year, ord: str(i), name: p.name, budget: str(p.budget), carry: p.carry ? "1" : "", owner: str(p.owner), memo: p.memo }));
      p.items.forEach((it, j) => {
        m.set(it.uid, rec("item", it.uid, { year, parent: p.uid, ord: str(j), name: it.name, budget: str(it.budget), memo: it.memo }));
        it.rows.forEach((r, k) => {
          m.set(
            r.uid,
            rec("row", r.uid, { year, parent: it.uid, ord: str(k), name: r.name, kind: r.kind, co: r.co, cmt: str(r.cmt), exp: str(r.exp), act: str(r.act), stage: r.stage, memo: r.memo }),
          );
        });
      });
    });
  }
  return m;
}

function norm(k: Field | "carry", v: unknown): string {
  const s = str(v);
  if (k === "carry") return s && s !== "0" && s.toLowerCase() !== "false" ? "1" : "";
  if (NUMERIC.has(k as Field)) {
    const t = s.trim().replace(/,/g, "");
    if (!t) return "";
    const n = Number(t);
    return Number.isFinite(n) ? String(Math.round(n)) : t;
  }
  return s;
}

/** 시트 집행현황 탭(2행부터) → uid별 줄. 같은 uid가 또 나오면 앞의 것만 써요. */
export function parseSheet(values: unknown[][]): Map<string, SheetRec> {
  const m = new Map<string, SheetRec>();
  values.forEach((v, i) => {
    const uid = str(v[0]).trim();
    const lv = str(v[1]).trim();
    const level = (Object.keys(LEVEL_KO) as Level[]).find((l) => LEVEL_KO[l] === lv || l === lv);
    if (!uid || !level || m.has(uid)) return;
    const f = emptyF();
    FIELDS.forEach((k, j) => (f[k] = norm(k, v[2 + j])));
    let meta: Meta = {};
    try {
      const j = JSON.parse(str(v[META_COL]) || "{}");
      if (j && typeof j === "object") meta = j as Meta;
    } catch {
      /* 고친 기록이 깨졌으면 비움 */
    }
    m.set(uid, { level, uid, del: norm("carry", v[DEL_COL]) === "1", f, row: i + 2, meta });
  });
  return m;
}

const cellOf = (k: Field, v: string): string | number => (NUMERIC.has(k) && v !== "" && /^-?\d+$/.test(v) ? Number(v) : k === "carry" ? (v ? 1 : "") : v);
export function rowValues(r: Rec, meta: Meta): (string | number)[] {
  return [r.uid, LEVEL_KO[r.level], ...FIELDS.map((k) => cellOf(k, r.f[k])), r.del ? 1 : "", Object.keys(meta).length ? JSON.stringify(meta) : ""];
}

// ---------- 합치기 ----------

export type Conflict = { uid: string; field: Field; mine: string; theirs: string; who: number; at: string };
export type Merged = {
  /** 내 PC에 넣거나 바꾸거나 지울 줄 */
  toLocal: Rec[];
  /** 시트 칸 고치기(행 번호, 칸, 값) */
  updates: { row: number; col: string; value: string | number }[];
  /** 시트 맨 아래에 더할 줄 */
  appends: Rec[];
  conflicts: Conflict[];
  base: Map<string, Rec>;
  /** 받은 칸이 있는 줄(초록 선) */
  received: Set<string>;
  /** 사람 번호 → 받은 칸 수 */
  receivedBy: Map<number, number>;
  receivedCells: number;
  sentCells: number;
};

/**
 * 세 갈래 합치기. local = 내 PC, remote = 시트, base = 지난번 맞춘 값, pending = 아직 고르지 않은 같은 칸.
 * me·now는 올리는 칸의 고친 기록에 들어가요.
 */
export function merge(local: Map<string, Rec>, remote: Map<string, SheetRec>, base: Map<string, Rec>, pending: Conflict[], me: number, now: string): Merged {
  const out: Merged = { toLocal: [], updates: [], appends: [], conflicts: [], base: new Map(), received: new Set(), receivedBy: new Map(), receivedCells: 0, sentCells: 0 };
  const pend = new Map(pending.map((c) => [c.uid + "|" + c.field, c]));
  const got = (who: number, n = 1) => {
    out.receivedCells += n;
    out.receivedBy.set(who, (out.receivedBy.get(who) ?? 0) + n);
  };
  const keys = new Set([...local.keys(), ...remote.keys()]);
  for (const uid of keys) {
    const l = local.get(uid);
    const r = remote.get(uid);
    const b = base.get(uid);
    if (r?.del) {
      if (l) {
        out.toLocal.push({ ...l, del: true });
        got(r.meta.name?.[0] ?? 0);
      }
      out.base.set(uid, { level: r.level, uid, del: true, f: r.f });
      continue;
    }
    if (!r) {
      if (l) {
        // 새로 만든 줄(또는 시트에서 사라진 줄) → 시트 맨 아래에
        out.appends.push(l);
        out.base.set(uid, l);
        out.sentCells++; // 새 줄은 한 칸으로 세요
      }
      continue;
    }
    if (!l) {
      if (b && !b.del) {
        // 내가 지운 줄
        out.updates.push({ row: r.row, col: letter(DEL_COL), value: 1 });
        out.updates.push({ row: r.row, col: letter(META_COL), value: JSON.stringify({ ...r.meta, name: [me, now] }) });
        out.base.set(uid, { level: r.level, uid, del: true, f: r.f });
        out.sentCells++;
      } else {
        // 다른 사람이 더한 줄
        out.toLocal.push({ level: r.level, uid, del: false, f: r.f });
        out.base.set(uid, { level: r.level, uid, del: false, f: r.f });
        out.received.add(uid);
        got(r.meta.name?.[0] ?? 0); // 새 줄은 한 칸으로 세요
      }
      continue;
    }
    // 둘 다 있음: 칸마다
    const mf = { ...l.f };
    const bf = { ...l.f };
    const mine: Meta = {};
    let changed = false;
    for (const k of FIELDS) {
      const lv = l.f[k];
      const rv = r.f[k];
      const bv = b && !b.del ? b.f[k] : lv; // 지난번 값을 모르면 시트를 따라요
      const p = pend.get(uid + "|" + k);
      if (lv === rv) {
        bf[k] = lv;
        continue;
      }
      if (p && !STRUCT.has(k)) {
        out.conflicts.push({ ...p, mine: lv, theirs: rv, who: r.meta[k]?.[0] ?? p.who, at: r.meta[k]?.[1] ?? p.at });
        bf[k] = rv;
        continue;
      }
      if (lv === bv || (STRUCT.has(k) && rv !== bv)) {
        mf[k] = rv;
        bf[k] = rv;
        changed = true;
        if (!STRUCT.has(k)) {
          out.received.add(uid);
          got(r.meta[k]?.[0] ?? 0);
        }
      } else if (rv === bv) {
        bf[k] = lv;
        out.updates.push({ row: r.row, col: colOf(k), value: cellOf(k, lv) });
        mine[k] = [me, now];
        if (!STRUCT.has(k)) out.sentCells++;
      } else {
        out.conflicts.push({ uid, field: k, mine: lv, theirs: rv, who: r.meta[k]?.[0] ?? 0, at: r.meta[k]?.[1] ?? "" });
        bf[k] = rv;
      }
    }
    if (changed) out.toLocal.push({ level: l.level, uid, del: false, f: mf });
    if (Object.keys(mine).length) out.updates.push({ row: r.row, col: letter(META_COL), value: JSON.stringify({ ...r.meta, ...mine }) });
    out.base.set(uid, { level: l.level, uid, del: false, f: bf });
  }
  return out;
}

/** core budget_share_apply로 보내는 한 줄 */
export function toOp(r: Rec) {
  const n = (v: string) => (v === "" ? 0 : Number(v) || 0);
  const o = (v: string) => (v === "" ? null : Number(v));
  return {
    level: r.level,
    uid: r.uid,
    del: r.del,
    parent: r.f.parent,
    year: n(r.f.year),
    ord: n(r.f.ord),
    name: r.f.name,
    budget: o(r.f.budget),
    carry: r.f.carry === "1",
    memo: r.f.memo,
    owner: o(r.f.owner),
    kind: r.f.kind,
    co: r.f.co,
    cmt: n(r.f.cmt),
    exp: n(r.f.exp),
    act: n(r.f.act),
    stage: r.f.stage,
  };
}
export type ShareOp = ReturnType<typeof toOp>;

// ---------- 함께 쓰는 사람 ----------

/** 시트 "사람" 탭 한 줄(2행부터, 번호 = 행 − 1 – 지운 사람도 줄은 남겨 번호가 바뀌지 않아요) */
export type Person = { no: number; name: string; mail: string; perm: string; oldPerm: string; gone: boolean; seen: string };
export type PersonStatus = "host" | "wait" | "invited" | "connected";
export const PEOPLE_HEADERS = ["이름", "구글 메일", "권한", "옛 권한", "지움", "마지막 새로고침"];

export function parsePeople(values: unknown[][]): Person[] {
  return values.map((v, i) => ({
    no: i + 1,
    name: str(v[0]).trim(),
    mail: str(v[1]).trim(),
    perm: str(v[2]).trim(),
    oldPerm: str(v[3]).trim(),
    gone: norm("carry", v[4]) === "1",
    seen: str(v[5]).trim(),
  }));
}
export function statusOf(p: Person, host: number): PersonStatus {
  if (p.no === host) return "host";
  if (!p.perm) return "wait";
  return p.seen ? "connected" : "invited";
}
export const STATUS_TEXT: Record<PersonStatus, string> = { host: "호스트", wait: "호스트 반영 기다림", invited: "초대함 · 주소 안 붙임", connected: "연결됨" };
/** 담당 배지 색 = 사람 번호 순서대로 프로젝트 8색 */
export const personColor = (no: number) => (((no - 1) % 8) + 8) % 8;
export const okMail = (m: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.trim());

function parseInfo(values: unknown[][]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const v of values) if (str(v[0]).trim()) o[str(v[0]).trim()] = str(v[1]).trim();
  return o;
}

// ---------- 시트 읽고 쓰기 (구글 · 미리 보기 흉내) ----------

type Read = { data: unknown[][]; people: unknown[][]; info: unknown[][] };
type Cell = { range: string; values: unknown[][] };
type IO = {
  ensure(host: boolean): Promise<void>;
  hasDrive(): Promise<boolean>;
  myMail(): Promise<string>;
  create(title: string, tabs: { tab: string; rows: number; cols: number }[]): Promise<string>;
  read(id: string): Promise<Read>;
  write(id: string, cells: Cell[]): Promise<void>;
  append(id: string, tab: string, rows: unknown[][]): Promise<void>;
  grant(id: string, mail: string): Promise<string>;
  revoke(id: string, perm: string): Promise<void>;
};

const googleIO: IO = {
  async ensure(host) {
    const need = [SHEETS_SCOPE, EMAIL_SCOPE, ...(host ? [DRIVE_FILE_SCOPE] : [])];
    const have = await Promise.all(need.map(hasGoogleScope));
    if (have.every(Boolean)) return;
    await connectForShare(host);
  },
  hasDrive: () => hasGoogleScope(DRIVE_FILE_SCOPE),
  async myMail() {
    const r = await googleCall("GET", USERINFO);
    const m = str(r.json.email);
    if (!m) throw new Error("no_mail");
    return m;
  },
  async create(title, tabs) {
    const r = await googleCall("POST", SHEETS, {
      properties: { title, locale: "ko_KR", timeZone: "Asia/Seoul" },
      sheets: tabs.map((t) => ({ properties: { title: t.tab, gridProperties: { rowCount: t.rows, columnCount: t.cols, frozenRowCount: t.tab === INFO ? 0 : 1 } } })),
    });
    const id = str(r.json.spreadsheetId);
    if (!id) throw new Error("create_failed");
    return id;
  },
  async read(id) {
    const ranges = [`${q(TAB)}!A2:${letter(META_COL)}`, `${q(PEOPLE)}!A2:F`, `${q(INFO)}!A1:B20`].map((x) => "ranges=" + encodeURIComponent(x)).join("&");
    const r = await googleCall("GET", `${SHEETS}/${encodeURIComponent(id)}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
    if (r.status === 404) throw new Error("no_sheet");
    const vr = (r.json.valueRanges as { values?: unknown[][] }[] | undefined) ?? [];
    return { data: vr[0]?.values ?? [], people: vr[1]?.values ?? [], info: vr[2]?.values ?? [] };
  },
  async write(id, cells) {
    for (let i = 0; i < cells.length; i += 2000) {
      await googleCall("POST", `${SHEETS}/${encodeURIComponent(id)}/values:batchUpdate`, { valueInputOption: "RAW", data: cells.slice(i, i + 2000) });
    }
  },
  async append(id, tab, rows) {
    for (let i = 0; i < rows.length; i += 1000) {
      const range = encodeURIComponent(`${q(tab)}!A1:${letter(Math.max(1, (rows[0] as unknown[]).length) - 1)}1`);
      await googleCall("POST", `${SHEETS}/${encodeURIComponent(id)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: rows.slice(i, i + 1000) });
    }
  },
  async grant(id, mail) {
    const msg = "기록 앱 › 설정 › 집행현황 › 공유 시트에 이 시트 주소를 붙여 넣고 [연결]을 눌러 주세요.";
    const r = await googleCall("POST", `${DRIVE}/${encodeURIComponent(id)}/permissions?sendNotificationEmail=true&emailMessage=${encodeURIComponent(msg)}&fields=id`, {
      type: "user",
      role: "writer",
      emailAddress: mail,
    });
    if (r.status === 404) throw new Error("no_sheet");
    return str(r.json.id);
  },
  async revoke(id, perm) {
    await googleCall("DELETE", `${DRIVE}/${encodeURIComponent(id)}/permissions/${encodeURIComponent(perm)}`);
  },
};

/** 브라우저 미리 보기: window.__shareFake에 시트를 흉내 내요(사람이 여럿인 것처럼 mail을 바꿔 가며 시험). */
type FakeBook = Record<string, Record<string, unknown[][]>>;
type Fake = { mail: string; books: FakeBook; drive?: boolean; perms?: number };
const fake = (): Fake | null => (typeof window !== "undefined" ? ((window as unknown as { __shareFake?: Fake }).__shareFake ?? null) : null);
function a1(range: string): { tab: string; c: number; r: number } {
  const m = /^'?(.+?)'?!([A-Z]+)(\d+)/.exec(range);
  if (!m) throw new Error("range " + range);
  return { tab: m[1], c: m[2].charCodeAt(0) - 65, r: Number(m[3]) - 1 };
}
const fakeIO: IO = {
  async ensure() {},
  hasDrive: async () => fake()?.drive !== false,
  myMail: async () => fake()!.mail,
  async create(_title, tabs) {
    const f = fake()!;
    const id = "fake" + Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
    f.books[id] = Object.fromEntries(tabs.map((t) => [t.tab, []]));
    return id;
  },
  async read(id) {
    const b = fake()!.books[id];
    if (!b) throw new Error("no_sheet");
    return { data: (b[TAB] ?? []).slice(1), people: (b[PEOPLE] ?? []).slice(1), info: b[INFO] ?? [] };
  },
  async write(id, cells) {
    const b = fake()!.books[id];
    for (const c of cells) {
      const { tab, c: col, r } = a1(c.range);
      const t = (b[tab] ??= []);
      c.values.forEach((vals, i) => {
        const row = (t[r + i] ??= []);
        vals.forEach((v, j) => (row[col + j] = v));
      });
    }
  },
  async append(id, tab, rows) {
    const t = (fake()!.books[id][tab] ??= []);
    t.push(...rows.map((r) => [...r]));
  },
  async grant() {
    const f = fake()!;
    f.perms = (f.perms ?? 0) + 1;
    return "perm" + f.perms;
  },
  async revoke() {},
};
const io = (): IO => (!inApp && fake() ? fakeIO : googleIO);

// ---------- 내 설정·상태 ----------

const K_CONF = "budget.share";
const K_BASE = "budget.share.base";
const K_CF = "budget.share.conflicts";
const K_PEOPLE = "budget.share.people";
const K_BACKUP = "budget.share.backup";

export type ShareConf = {
  on: boolean;
  sheet: string;
  mail: string;
  me: number;
  host: number;
  /** 넘겨받을 호스트(정보 탭 "넘김") – 내 번호면 [받기]를 보여요 */
  take: number;
  up: string;
  down: string;
  error: string;
};
const EMPTY: ShareConf = { on: false, sheet: "", mail: "", me: 0, host: 0, take: 0, up: "", down: "", error: "" };

export type RefreshResult = { at: string; receivedCells: number; receivedBy: [string, number][]; sentCells: number; conflicts: number; received: string[]; error: string; note: string };
export type ShareState = { conf: ShareConf; people: Person[]; conflicts: Conflict[]; busy: boolean; last: RefreshResult | null };

async function getJson<T>(k: string, d: T): Promise<T> {
  try {
    const v = await api.get(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
const putJson = (k: string, v: unknown) => api.set(k, JSON.stringify(v));

let state: ShareState = { conf: EMPTY, people: [], conflicts: [], busy: false, last: null };
let loaded = false;
const listeners = new Set<(s: ShareState) => void>();
function publish(p: Partial<ShareState>) {
  state = { ...state, ...p };
  for (const f of listeners) f(state);
}
export function onShare(f: (s: ShareState) => void): () => void {
  listeners.add(f);
  f(state);
  if (!loaded) void loadShare();
  return () => listeners.delete(f);
}
export async function loadShare(): Promise<ShareState> {
  loaded = true;
  const [conf, people, conflicts] = await Promise.all([getJson<ShareConf>(K_CONF, EMPTY), getJson<Person[]>(K_PEOPLE, []), getJson<Conflict[]>(K_CF, [])]);
  publish({ conf: { ...EMPTY, ...conf }, people, conflicts });
  return state;
}
async function saveConf(c: ShareConf) {
  await putJson(K_CONF, c);
  publish({ conf: c });
}
/** 공유가 켜져 있고 시트에 묶였는지(담당 열·새로고침 단추를 보일지) */
export const shareActive = (c: ShareConf) => c.on && !!c.sheet;

export const sheetUrl = (id: string) => (id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : "");
/** 붙여 넣은 주소(또는 id만) → 시트 id */
export function parseSheetId(text: string): string {
  const t = text.trim();
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(t);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(t) ? t : "";
}

const pad = (n: number) => String(n).padStart(2, "0");
function stampNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** "2026-10-20 09:12" → 오늘이면 "09:12", 아니면 "10-19 09:12" */
export function shortTime(s: string): string {
  if (!s) return "";
  const today = stampNow().slice(0, 10);
  return s.slice(0, 10) === today ? s.slice(11, 16) : s.slice(5, 16);
}

export function shareErrorText(e: unknown): string {
  const code = googleErrorCode(e);
  const m = e instanceof Error ? e.message : String(e);
  if (m === "not_connected" || m === "relogin") return "구글 로그인이 풀렸어요 – 설정 › 집행현황에서 다시 연결해 주세요";
  if (m === "offline" || m.includes("Failed to fetch")) return "인터넷에 연결하지 못했어요 – 고친 것은 내 PC에 두었다가 다음에 올려요";
  if (code === 403) return "시트를 열 수 없어요 – 호스트에게 함께 쓰는 사람에 더해 달라고 하세요";
  if (code === 401) return "구글 로그인이 풀렸어요 – 설정 › 집행현황에서 다시 연결해 주세요";
  if (m === "no_sheet" || code === 404) return "시트를 찾지 못했어요 – 주소를 확인해 주세요";
  if (m === "not_member") return "함께 쓰는 사람 명단에 내 구글 메일이 없어요 – 명단에 더해 달라고 하세요";
  if (m === "bad_address") return "시트 주소를 읽지 못했어요 – 호스트가 보낸 주소를 그대로 붙여 넣어 주세요";
  if (m === "no_mail") return "구글 메일을 읽지 못했어요 – 다시 연결해 주세요";
  if (m === "busy") return "새로고침 중이에요 – 끝난 뒤 다시 해 주세요";
  if (m.startsWith("앱에서만") || m.includes("로그인") || m.includes("구글")) return m;
  return `새로고침하지 못했어요(${m})`;
}

async function readLocalYears(): Promise<BudgetProject[][]> {
  const years = await api.budgetYears();
  return Promise.all(years.map((y) => api.budgetData(y)));
}

/** 시트 탭 셋을 읽어 옮김(호스트 넘기기)을 따라가요. */
async function readFollow(conf: ShareConf): Promise<Read & { id: string }> {
  let id = conf.sheet;
  for (let i = 0; i < 3; i++) {
    const r = await io().read(id);
    const moved = parseInfo(r.info)["옮김"];
    if (!moved || moved === id) return { ...r, id };
    id = moved;
  }
  return { ...(await io().read(id)), id };
}

// ---------- 새로고침 ----------

let running: Promise<RefreshResult | null> | null = null;
/** 받기 + 올리기. 이미 하는 중이면 그것을 기다려요. */
export function refreshShare(): Promise<RefreshResult | null> {
  if (running) return running;
  running = doRefresh().finally(() => (running = null));
  return running;
}

async function doRefresh(): Promise<RefreshResult | null> {
  if (!loaded) await loadShare();
  const conf = { ...state.conf };
  if (!shareActive(conf)) return null;
  publish({ busy: true });
  const now = stampNow();
  try {
    const got = await readFollow(conf);
    conf.sheet = got.id;
    const info = parseInfo(got.info);
    const people = parsePeople(got.people);
    conf.host = Number(info["호스트"] || 0);
    conf.take = Number(info["넘김"] || 0);
    const meP = people.find((p) => !p.gone && p.mail.toLowerCase() === conf.mail.toLowerCase());
    if (!meP) throw new Error("not_member");
    conf.me = meP.no;
    const remote = parseSheet(got.data);
    const local = flatten(await readLocalYears());
    const base = new Map((await getJson<Rec[]>(K_BASE, [])).map((r) => [r.uid, r]));
    const m = merge(local, remote, base, await getJson<Conflict[]>(K_CF, []), conf.me, now);
    if (m.toLocal.length) await api.budgetShareApply(m.toLocal.map(toOp));
    conf.down = now;
    // 올리기: 칸 고치기 + 내 "마지막 새로고침" 칸, 새 줄은 맨 아래에
    const cells: Cell[] = m.updates.map((u) => ({ range: `${q(TAB)}!${u.col}${u.row}`, values: [[u.value]] }));
    cells.push({ range: `${q(PEOPLE)}!F${meP.no + 1}`, values: [[now]] });
    await io().write(conf.sheet, cells);
    if (m.appends.length) {
      const all = (r: Rec): Meta => Object.fromEntries(FIELDS.filter((k) => !STRUCT.has(k) && r.f[k] !== "").map((k) => [k, [conf.me, now]]));
      await io().append(conf.sheet, TAB, m.appends.map((r) => rowValues(r, all(r))));
    }
    conf.up = now;
    await putJson(K_BASE, [...m.base.values()]);
    await putJson(K_CF, m.conflicts);
    meP.seen = now;
    // 호스트 일: 명단대로 권한 주기·거두기
    let note = "";
    if (conf.host === conf.me) note = await hostDuties(conf.sheet, people);
    conf.error = "";
    await putJson(K_PEOPLE, people);
    await saveConf(conf);
    const name = (no: number) => people.find((p) => p.no === no)?.name || "누군가";
    const res: RefreshResult = {
      at: now,
      receivedCells: m.receivedCells,
      receivedBy: [...m.receivedBy].map(([no, n]) => [name(no), n]),
      sentCells: m.sentCells,
      conflicts: m.conflicts.length,
      received: [...m.received],
      error: "",
      note,
    };
    publish({ busy: false, people, conflicts: m.conflicts, last: res });
    if (m.toLocal.length || m.conflicts.length) window.dispatchEvent(new CustomEvent(SHARE_CHANGE, { detail: res }));
    return res;
  } catch (e) {
    conf.error = shareErrorText(e);
    await saveConf(conf).catch(() => {});
    const res: RefreshResult = { at: now, receivedCells: 0, receivedBy: [], sentCells: 0, conflicts: state.conflicts.length, received: [], error: conf.error, note: "" };
    publish({ busy: false, last: res });
    return res;
  }
}
/** 받은 것이 있으면 집행현황 화면이 다시 읽어요. */
export const SHARE_CHANGE = "gilog-budget-share";

/** 호스트 앱: 명단에 더한 사람은 편집 권한을 주고(구글이 안내 메일을 보내요), 뺀 사람·바뀐 메일은 거둬요. */
async function hostDuties(sheet: string, people: Person[]): Promise<string> {
  const todo = people.filter((p) => p.no !== state.conf.host && (p.gone ? !!(p.perm || p.oldPerm) : !!p.oldPerm || (!p.perm && okMail(p.mail))));
  if (!todo.length) return "";
  if (!(await io().hasDrive())) return "명단 권한을 반영하려면 설정 › 집행현황에서 [권한 받기]를 눌러 주세요";
  const cells: Cell[] = [];
  let fail = 0;
  for (const p of todo) {
    try {
      if (p.gone) {
        for (const id of [p.perm, p.oldPerm]) if (id) await io().revoke(sheet, id);
        p.perm = p.oldPerm = "";
        cells.push({ range: `${q(PEOPLE)}!C${p.no + 1}:D${p.no + 1}`, values: [["", ""]] });
        continue;
      }
      if (p.oldPerm) {
        await io().revoke(sheet, p.oldPerm);
        p.oldPerm = "";
      }
      if (!p.perm) p.perm = await io().grant(sheet, p.mail);
      cells.push({ range: `${q(PEOPLE)}!C${p.no + 1}:D${p.no + 1}`, values: [[p.perm, p.oldPerm]] });
    } catch {
      fail++;
    }
  }
  if (cells.length) await io().write(sheet, cells);
  return fail ? `${fail}명은 권한을 반영하지 못했어요 – 다음 새로고침 때 다시 해요` : "";
}

// ---------- 묶기·만들기·끊기 ----------

/** 호스트: 새 시트를 만들고 내 집행현황(모든 해)을 올려요. */
export async function createSheet(myName: string): Promise<void> {
  if (running) throw new Error("busy");
  await io().ensure(true);
  const mail = await io().myMail();
  const local = flatten(await readLocalYears());
  const now = stampNow();
  const id = await io().create("기록 집행현황 공유", [
    { tab: TAB, rows: Math.max(1000, local.size + 200), cols: HEADERS.length },
    { tab: PEOPLE, rows: 200, cols: PEOPLE_HEADERS.length },
    { tab: INFO, rows: 20, cols: 2 },
  ]);
  await io().write(id, [
    { range: `${q(TAB)}!A1`, values: [HEADERS] },
    { range: `${q(PEOPLE)}!A1`, values: [PEOPLE_HEADERS, [myName || "호스트", mail, "호스트", "", "", now]] },
    { range: `${q(INFO)}!A1`, values: [["호스트", 1], ["옮김", ""], ["넘김", ""], ["판", 1]] },
  ]);
  if (local.size) await io().append(id, TAB, [...local.values()].map((r) => rowValues(r, {})));
  await putJson(K_BASE, [...local.values()]);
  await putJson(K_CF, []);
  await saveConf({ ...state.conf, on: true, sheet: id, mail, me: 1, host: 1, take: 0, up: now, down: now, error: "" });
  await refreshShare();
}

/** 팀원: 붙여 넣은 시트에 묶여요. 내 집행현황은 백업으로 두고 시트 것으로 바꿔요. */
export async function joinSheet(addr: string): Promise<{ backup: number }> {
  if (running) throw new Error("busy");
  const id0 = parseSheetId(addr);
  if (!id0) throw new Error("bad_address");
  await io().ensure(false);
  const mail = await io().myMail();
  const got = await readFollow({ ...state.conf, sheet: id0 });
  const people = parsePeople(got.people);
  const meP = people.find((p) => !p.gone && p.mail.toLowerCase() === mail.toLowerCase());
  if (!meP) throw new Error("not_member");
  const years = await readLocalYears();
  const n = years.reduce((a, ps) => a + ps.length, 0);
  if (n) await api.set(K_BACKUP, JSON.stringify({ at: stampNow(), years }));
  await api.budgetShareClear();
  const recs = [...parseSheet(got.data).values()].filter((r) => !r.del);
  if (recs.length) await api.budgetShareApply(recs.map(toOp));
  await putJson(K_BASE, recs.map(({ level, uid, del, f }) => ({ level, uid, del, f })));
  await putJson(K_CF, []);
  const info = parseInfo(got.info);
  await saveConf({ ...state.conf, on: true, sheet: got.id, mail, me: meP.no, host: Number(info["호스트"] || 0), take: 0, up: "", down: "", error: "" });
  await refreshShare();
  window.dispatchEvent(new CustomEvent(SHARE_CHANGE, { detail: null }));
  return { backup: n };
}

/** 공유 켜기·끄기(끄면 내 PC 자료는 그대로, 시트 주소는 기억해요). */
export async function setShareOn(on: boolean): Promise<void> {
  if (!loaded) await loadShare();
  await saveConf({ ...state.conf, on, error: "" });
}

/** 공유 전 내 집행현황이 백업돼 있는지(묶일 때 남김) */
export async function backupInfo(): Promise<{ at: string; n: number } | null> {
  const b = await getJson<{ at: string; years: BudgetProject[][] } | null>(K_BACKUP, null);
  return b ? { at: b.at, n: b.years.reduce((a, ps) => a + ps.length, 0) } : null;
}
/** 공유를 끈 뒤 백업으로 되돌리기 */
export async function restoreBackup(): Promise<void> {
  const b = await getJson<{ at: string; years: BudgetProject[][] } | null>(K_BACKUP, null);
  if (!b) return;
  await api.budgetShareClear();
  await api.budgetShareApply([...flatten(b.years).values()].map(toOp));
  window.dispatchEvent(new CustomEvent(SHARE_CHANGE, { detail: null }));
}

/** 호스트가 [권한 받기]: drive.file 권한을 더 받아요. */
export async function grantHostScope(): Promise<void> {
  await io().ensure(true);
  await refreshShare();
}

// ---------- 명단 고치기 (누구나 – 권한은 호스트 앱이 반영) ----------

async function freshPeople(): Promise<Person[]> {
  const got = await io().read(state.conf.sheet);
  return parsePeople(got.people);
}

export async function addPerson(name: string, mail: string): Promise<void> {
  const n = name.trim();
  const m = mail.trim();
  if (!n) throw new Error("이름을 적어 주세요");
  if (!okMail(m)) throw new Error("구글 메일을 확인해 주세요");
  const people = await freshPeople();
  if (people.some((p) => !p.gone && p.mail.toLowerCase() === m.toLowerCase())) throw new Error("이미 명단에 있는 메일이에요");
  await io().append(state.conf.sheet, PEOPLE, [[n, m, "", "", "", ""]]);
  await refreshShare();
}

export async function editPerson(no: number, name: string, mail: string): Promise<void> {
  const n = name.trim();
  const m = mail.trim();
  if (!n) throw new Error("이름을 적어 주세요");
  if (!okMail(m)) throw new Error("구글 메일을 확인해 주세요");
  if (no === state.conf.me && m.toLowerCase() !== state.conf.mail.toLowerCase()) throw new Error("내 메일은 여기서 바꾸지 않아요 – 다른 계정으로 쓰려면 다시 연결해 주세요");
  const people = await freshPeople();
  const p = people.find((x) => x.no === no);
  if (!p) return;
  if (people.some((x) => x.no !== no && !x.gone && x.mail.toLowerCase() === m.toLowerCase())) throw new Error("이미 명단에 있는 메일이에요");
  const cells: Cell[] = [{ range: `${q(PEOPLE)}!A${no + 1}:B${no + 1}`, values: [[n, m]] }];
  // 메일을 바꾸면 옛 권한은 거두고 새 메일에 다시 줘요(호스트 앱이). 호스트 자신은 그대로.
  if (m.toLowerCase() !== p.mail.toLowerCase() && no !== state.conf.host && p.perm) cells.push({ range: `${q(PEOPLE)}!C${no + 1}:D${no + 1}`, values: [["", p.perm]] });
  await io().write(state.conf.sheet, cells);
  await refreshShare();
}

export async function removePerson(no: number): Promise<void> {
  if (no === state.conf.host) throw new Error("호스트는 뺄 수 없어요 – 먼저 호스트를 넘겨 주세요");
  if (no === state.conf.me) throw new Error("나는 뺄 수 없어요 – 공유를 끄면 돼요");
  await io().write(state.conf.sheet, [{ range: `${q(PEOPLE)}!E${no + 1}`, values: [[1]] }]);
  await refreshShare();
}

/** 호스트가 넘기기를 고르면 정보 탭에 적어 두고, 받는 사람 앱이 [받기]를 보여요. */
export async function offerHost(no: number): Promise<void> {
  if (state.conf.me !== state.conf.host) throw new Error("호스트만 넘길 수 있어요");
  await io().write(state.conf.sheet, [{ range: `${q(INFO)}!B3`, values: [[no || ""]] }]);
  await refreshShare();
}

/** 넘겨받기: 새 시트를 만들어 집행현황·명단을 옮기고, 옛 시트에 새 주소를 남겨요(모두의 앱이 따라와요). */
export async function takeHost(): Promise<void> {
  if (running) throw new Error("busy");
  const conf = { ...state.conf };
  await io().ensure(true);
  const got = await readFollow(conf);
  const people = parsePeople(got.people);
  // 지운 줄도 옮겨요(아직 새로고침하지 않은 사람이 그 줄을 다시 올리지 않게).
  const rows = got.data.filter((v) => str(v[0]).trim());
  const id = await io().create("기록 집행현황 공유", [
    { tab: TAB, rows: Math.max(1000, rows.length + 200), cols: HEADERS.length },
    { tab: PEOPLE, rows: 200, cols: PEOPLE_HEADERS.length },
    { tab: INFO, rows: 20, cols: 2 },
  ]);
  // 사람 번호를 지키려고 줄 순서 그대로(지운 사람도), 권한은 비워 새 호스트 앱이 다시 줘요.
  const pRows = people.map((p) => [p.name, p.mail, p.no === conf.me ? "호스트" : "", "", p.gone ? 1 : "", p.no === conf.me ? stampNow() : ""]);
  await io().write(id, [
    { range: `${q(TAB)}!A1`, values: [HEADERS] },
    { range: `${q(PEOPLE)}!A1`, values: [PEOPLE_HEADERS, ...pRows] },
    { range: `${q(INFO)}!A1`, values: [["호스트", conf.me], ["옮김", ""], ["넘김", ""], ["판", 1]] },
  ]);
  if (rows.length) await io().append(id, TAB, rows);
  await io().write(got.id, [{ range: `${q(INFO)}!B2:B3`, values: [[id], [""]] }]);
  await saveConf({ ...conf, sheet: id, host: conf.me, take: 0 });
  await refreshShare();
}

// ---------- 같은 칸 고르기 · 담당 ----------

/** 내 값으로: 다음 새로고침 때 내 값을 올려요(바로 새로고침). */
export async function keepMine(c: Conflict): Promise<void> {
  const rest = state.conflicts.filter((x) => !(x.uid === c.uid && x.field === c.field));
  await putJson(K_CF, rest);
  publish({ conflicts: rest });
  await refreshShare();
}

/** 받은 값 그대로: 내 PC를 시트 값으로 바꿔요. */
export async function takeTheirs(c: Conflict): Promise<void> {
  const local = flatten(await readLocalYears()).get(c.uid);
  if (local) await api.budgetShareApply([toOp({ ...local, f: { ...local.f, [c.field]: c.theirs } })]);
  const rest = state.conflicts.filter((x) => !(x.uid === c.uid && x.field === c.field));
  await putJson(K_CF, rest);
  publish({ conflicts: rest });
  window.dispatchEvent(new CustomEvent(SHARE_CHANGE, { detail: null }));
}
