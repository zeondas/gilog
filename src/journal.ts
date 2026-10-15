// 업무일지 화면이 쓰는 규칙들이에요. 화면 그리기와 떼어 두어 따로 시험할 수 있어요.
import type { Contact, Entry, JournalLine } from "./api";
import type { Kind } from "./settingsStore";

const pad = (n: number) => String(n).padStart(2, "0");

/** PC의 오늘 날짜 2026-10-15 */
export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowHM(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "940" "0940" "9:40" "09:40" → "09:40". 읽을 수 없으면 null이에요. */
export function normTime(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (!m && /^\d{3,4}$/.test(s)) m = /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, w: WEEK[new Date(y, m - 1, d).getDay()] };
}

/** "2026년 10월 15일(목)" */
export function dayTitle(date: string): string {
  const p = parts(date);
  return `${p.y}년 ${p.m}월 ${p.d}일(${p.w})`;
}

/** 날짜 목록의 한 칸 "15일(목)" */
export function dayLabel(date: string): string {
  const p = parts(date);
  return `${p.d}일(${p.w})`;
}

/**
 * 날짜 칸에 친 것을 날짜로 바꿔요. "1016"(올해), "10/16", "10.16", "2026-10-16", "2026.10.16", "20261016"을 받아요.
 * 읽을 수 없거나 없는 날이면 null이에요.
 */
export function parseDate(v: string, year = new Date().getFullYear()): string | null {
  const s = v.trim();
  let y = year;
  let m: number;
  let d: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s)) || (r = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) {
    [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  } else if ((r = /^(\d{1,2})[-./](\d{1,2})$/.exec(s)) || (r = /^(\d{2})(\d{2})$/.exec(s))) {
    [m, d] = [Number(r[1]), Number(r[2])];
  } else return null;
  const t = new Date(y, m - 1, d);
  if (t.getFullYear() !== y || t.getMonth() !== m - 1 || t.getDate() !== d) return null;
  return todayStr(t);
}

/**
 * 한글 입력기가 자음 둘을 겹자음으로 묶은 것을 풀어요("ㄳ" → "ㄱㅅ", "ㅄ" → "ㅂㅅ").
 * 초성 단축키(ㄱㅅ 구두수신)와 초성 찾기가 입력기 때문에 어긋나지 않게 해요. 된소리(ㄲ 등)는 그대로예요.
 */
const SPLIT: Record<string, string> = {
  ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ",
};
export const splitJamo = (s: string) => s.replace(/[ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ]/g, (c) => SPLIT[c]);

/** 초성 단축키를 구분 이름으로 바꿔요. 맞는 것이 없으면 적은 그대로예요. */
export function expandKind(v: string, kinds: Kind[]): string {
  const s = splitJamo(v.trim());
  return kinds.find((k) => k.key && splitJamo(k.key) === s)?.name ?? s;
}

// ---------- 초성 ----------

const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

/** 글자의 초성. 한글 음절이 아니면 그 글자 그대로예요. */
function cho(ch: string): string {
  const c = ch.charCodeAt(0) - 0xac00;
  return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
}

export const isChosung = (s: string) => /^[ㄱ-ㅎ]+$/.test(s);
// (겹자음은 splitJamo로 풀어서 봐요)

/** 이름 전체의 초성 ("박지훈" → "ㅂㅈㅎ") */
export const initials = (s: string) => [...s].map(cho).join("");

/**
 * 한글 이름 찾기. 초성으로 쳐도 맞아요("ㅂㅈ", "박ㅈ", "ㅂ지" 모두 "박지훈"에 맞아요).
 * 찾은 자리를 돌려주고, 맞지 않으면 -1이에요.
 */
export function koIndex(text: string, q: string): number {
  const t = [...text];
  const p = [...splitJamo(q)];
  if (!p.length) return 0;
  outer: for (let i = 0; i + p.length <= t.length; i++) {
    for (let j = 0; j < p.length; j++) {
      const a = t[i + j];
      const b = p[j];
      if (a === b || a.toLowerCase() === b.toLowerCase()) continue;
      if (isChosung(b) && cho(a) === b) continue;
      continue outer;
    }
    return i;
  }
  return -1;
}

// ---------- 상대 ----------

/** 상대 칸을 이름과 나머지로 나눠요. 한 사람이고 "이름 직위 · 소속" 모양일 때만 나눠요. */
export function splitWho(who: string): { name: string; rest: string } {
  const w = who.trim();
  if (w.includes(",") || !w.includes(" · ")) return { name: w, rest: "" };
  const name = w.split(/\s+/)[0];
  return { name, rest: w.slice(name.length).trim().replace(/^·\s*/, "") };
}

/** 상대 칸에 적힌 사람 이름들 ("김○○ 주무관 · 경기도청, 팀장" → ["김○○", "팀장"]) */
export function whoNames(who: string): string[] {
  return who
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(" · ")[0].trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** 연락처를 상대 칸에 넣을 글자로 만들어요. "박○○ 책임기술인 · (주)○○엔지니어링" */
export function contactLabel(c: Contact): string {
  return c.name + (c.role ? " " + c.role : "") + (c.org ? " · " + c.org : "");
}

/** 적은 글자 하나(쉼표 사이)에 맞는 연락처. 이름만 적었으면 그 이름인 사람이 한 명일 때만이에요. */
export function findContact(segment: string, contacts: Contact[]): Contact | null {
  const s = segment.trim();
  if (!s) return null;
  const byLabel = contacts.find((c) => contactLabel(c) === s);
  if (byLabel) return byLabel;
  const byName = contacts.filter((c) => c.name === s);
  if (byName.length === 1) return byName[0];
  // 초성만 쳤으면 이름 초성이 똑같은 사람이 한 명일 때 그 사람이에요.
  if (isChosung(splitJamo(s))) {
    const byCho = contacts.filter((c) => initials(c.name) === splitJamo(s));
    if (byCho.length === 1) return byCho[0];
  }
  return null;
}

/** 상대 칸의 사람들 가운데 업무연락처에 있는 첫 사람 */
export function firstContact(who: string, contacts: Contact[]): Contact | null {
  for (const seg of who.split(",")) {
    const c = findContact(seg, contacts);
    if (c) return c;
  }
  return null;
}

/** 구분에 맞는 연락처: 메일이면 이메일, 유선이면 유선, 그 밖에는 무선이에요. 없으면 다른 것으로 채워요. */
export function contactFor(c: Contact, kind: string): string {
  if (kind.includes("메일")) return c.email || c.mobile || c.tel;
  if (kind.includes("유선")) return c.tel || c.mobile;
  return c.mobile || c.tel;
}

// ---------- 말한 사람 ----------

export type Speaker = { who: string; me: boolean };

export const sameSpeaker = (a: Speaker, b: Speaker) => a.me === b.me && (a.me || a.who === b.who);

/**
 * 이 기록에서 말할 수 있는 사람들(상대들, 맨 끝이 나)과 첫 말을 한 사람이에요.
 * 발신이면 내가 먼저, 수신이면 상대가 먼저예요. 출장·메모에 상대가 한 명 이하면 나 혼자예요.
 */
export function speakers(who: string, kind: string, myName: string): { list: Speaker[]; first: number } {
  const names = whoNames(who);
  const solo = (kind === "출장" || kind === "메모") && names.length <= 1;
  const others = solo ? [] : names.length ? names : ["상대"];
  const list: Speaker[] = [...others.map((n) => ({ who: n, me: false })), { who: myName, me: true }];
  const meFirst = kind.includes("발신") || others.length === 0;
  return { list, first: meFirst ? list.length - 1 : 0 };
}

/**
 * 신규 입력의 말 줄. sp가 null이면 자동이에요: 첫 줄은 정해진 첫 사람, 다음 줄부터는 앞 줄 다음 사람이에요.
 * 상대나 구분을 나중에 바꿔도 자동인 줄은 따라 바뀌어요.
 */
export type DraftLine = { sp: number | null; t: string };

export function resolveDraft(lines: DraftLine[], n: number, first: number): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    const auto = i === 0 ? first : (out[i - 1] + 1) % n;
    out.push(l.sp === null ? auto : Math.min(l.sp, n - 1));
  });
  return out;
}

// ---------- 색 ----------

const SPEAKER_COLORS = [2, 3, 4, 5, 6, 7, 0];

/** 상대 말 배지의 색 번호(프로젝트 배지와 같은 8색 가운데). 이름마다 늘 같은 색이에요. */
export function speakerColor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length];
}

// ---------- 검색 ----------

// ---------- 메모 ----------

/** "메모" 구분은 말 줄 대신 편집기로 적어요. */
export const isMemo = (kind: string) => kind.trim() === "메모";

/** HTML에서 글자만 꺼내요. */
export function htmlText(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("p,h3,li,blockquote,tr,br").forEach((el) => el.append(" "));
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** 기록이 검색어에 맞는지, 맞은 말 줄은 어느 것인지 */
export function matchEntry(e: Entry, q: string): { hit: boolean; lines: boolean[] } {
  const lc = (s: string) => s.toLowerCase();
  const lines = e.lines.map((l: JournalLine) => lc(l.text).includes(q) || (!l.me && lc(l.who).includes(q)));
  const head = [e.who, e.contact, e.kind, htmlText(e.body)].some((s) => lc(s).includes(q));
  return { hit: head || lines.some(Boolean), lines };
}

/** 같은 날은 시간이 늦은 것이 앞, 날짜는 최근이 앞이에요. */
export function sortEntries(list: Entry[]): Entry[] {
  return [...list].sort((x, y) =>
    x.date !== y.date ? (x.date < y.date ? 1 : -1) : x.time !== y.time ? (x.time < y.time ? 1 : -1) : y.id - x.id,
  );
}
