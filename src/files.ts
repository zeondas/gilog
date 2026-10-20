// 탐색기(11단계) 규칙 함수. 화면(FilesScreen)과 시험이 함께 써요.
// 사양서 "탐색기 (11단계)" 절과 시안 캔버스 Files·FilesRename·FilesConflict 판이 기준이에요.

/** 목록 한 줄 (Rust files.rs의 Entry) */
export type FsEntry = {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  /** 밀리초 */
  modified: number;
  created: number;
  hidden: boolean;
  locked: boolean;
  /** 내 PC·홈 목록에서만: 크기 열에 대신 쓰는 글(남은 공간), 형식 열 글, 홈 묶음("fav"·"recent") */
  note?: string;
  kind?: string;
  group?: string;
};

/** 폴더가 아닌 자리: 내 PC(드라이브 목록)·즐겨찾기(★로 지정한 폴더만 – 2026-10-19 사용자 1안, 예전 "홈" 자리) */
export const PC = "::pc";
export const HOME = "::home";
/** 트리의 내 PC 묶음을 접었는지(tree.open에 들어 있으면 접힘) */
export const PC_FOLD = "::pc:fold";
export const isSpecial = (path: string) => path.startsWith("::");
export const specialName = (path: string) => (path === PC ? "내 PC" : path === HOME ? "즐겨찾기" : path);

export type FsDrive = { name: string; path: string; label: string; kind: string; free: number; total: number };

export type ViewMode = "detail" | "brief" | "icons" | "thumb";
export type SortKey = "name" | "size" | "modified" | "folder" | "type";

export const VIEWS: { id: ViewMode; name: string; key: string }[] = [
  { id: "detail", name: "자세히", key: "Ctrl+Shift+1" },
  { id: "brief", name: "간단히", key: "Ctrl+Shift+2" },
  { id: "icons", name: "큰 아이콘", key: "Ctrl+Shift+3" },
  { id: "thumb", name: "썸네일", key: "Ctrl+Shift+4" },
];

/** 설정 "탐색기" 카드의 날짜 형식(FreeCommander처럼 고르기 목록, 연-월-일 순서만 – 2026-10-18 사용자). */
export const DATE_FORMATS = ["yyyy-mm-dd hh:nn:ss", "yyyy-mm-dd hh:nn", "yy-mm-dd hh:nn", "yyyymmdd_hhnnss", "yyyy-mm-dd", "yyyymmdd", "yymmdd"];
export const DEFAULT_DATE_FORMAT = "yy-mm-dd hh:nn";
// 예전 저장값(번호: 0 10-16 17:40 · 1 2026-10-16 17:40 · 2 2026. 10. 16. · 3 상대 · 4 26-10-16 17:40)을 새 형식으로.
const OLD_FORMATS = ["yy-mm-dd hh:nn", "yyyy-mm-dd hh:nn", "yyyy-mm-dd", "yy-mm-dd hh:nn", "yy-mm-dd hh:nn"];
export function dateFormatOf(v: unknown): string {
  if (typeof v === "number") return OLD_FORMATS[v] ?? DEFAULT_DATE_FORMAT;
  return typeof v === "string" && DATE_FORMATS.includes(v) ? v : DEFAULT_DATE_FORMAT;
}

const p2 = (n: number) => String(n).padStart(2, "0");

export function formatDate(ms: number, fmt: string): string {
  if (!ms) return "";
  const d = new Date(ms);
  const y = String(d.getFullYear());
  const v: Record<string, string> = { yyyy: y, yy: y.slice(2), mm: p2(d.getMonth() + 1), dd: p2(d.getDate()), hh: p2(d.getHours()), nn: p2(d.getMinutes()), ss: p2(d.getSeconds()) };
  return fmt.replace(/yyyy|yy|mm|dd|hh|nn|ss/g, (t) => v[t]);
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
}

/** 확장자(소문자, 점 없이) */
export const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
};

export const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp"]);

/** 이름 비교: 윈도우 탐색기처럼 숫자는 숫자 크기로(사진2 < 사진10), 나머지는 글자 순서(대소문자 무시).
 *  그래서 "포트홀.jpg"가 "포트홀_사진1.jpg"보다 앞이에요(. < _). 한글 음절은 글자 순서가 곧 가나다 순서예요. */
export function compareName(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const dx = x.charCodeAt(i) >= 48 && x.charCodeAt(i) <= 57;
    const dy = y.charCodeAt(j) >= 48 && y.charCodeAt(j) <= 57;
    if (dx && dy) {
      let ei = i;
      while (ei < x.length && x.charCodeAt(ei) >= 48 && x.charCodeAt(ei) <= 57) ei++;
      let ej = j;
      while (ej < y.length && y.charCodeAt(ej) >= 48 && y.charCodeAt(ej) <= 57) ej++;
      const nx = x.slice(i, ei).replace(/^0+/, "");
      const ny = y.slice(j, ej).replace(/^0+/, "");
      if (nx.length !== ny.length) return nx.length - ny.length;
      if (nx !== ny) return nx < ny ? -1 : 1;
      i = ei;
      j = ej;
      continue;
    }
    const cx = x.charCodeAt(i);
    const cy = y.charCodeAt(j);
    if (cx !== cy) return cx - cy;
    i++;
    j++;
  }
  return x.length - i - (y.length - j);
}

/** 정렬: 폴더가 늘 먼저, 그 안에서 고른 열 순서 */
/** 파일 형식 이름: 앱에서는 윈도우가 쓰는 이름("Microsoft Excel 워크시트"), 모르면 "XLSX 파일" */
export function typeName(e: { name: string; dir: boolean }, known: Record<string, string>): string {
  if (e.dir) return known["<dir>"] || "파일 폴더";
  const x = extOf(e.name);
  return known["." + x] || (x ? `${x.toUpperCase()} 파일` : "파일");
}

export function sortEntries<T extends FsEntry & { folder?: string }>(list: T[], key: SortKey, asc: boolean, types: Record<string, string> = {}): T[] {
  const dir = asc ? 1 : -1;
  return [...list].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let c = 0;
    if (key === "size") c = a.size - b.size;
    else if (key === "modified") c = a.modified - b.modified;
    else if (key === "folder") c = compareName(a.folder ?? "", b.folder ?? "");
    else if (key === "type") c = compareName(typeName(a, types), typeName(b, types));
    if (c === 0) c = compareName(a.name, b.name);
    return c * dir;
  });
}

/** 빠른 필터: *·? 있으면 와일드카드, 여러 개는 ;, 없으면 들어 있는지(대소문자 무시). 폴더도 걸러요. */
export function quickMatch(filter: string, name: string): boolean {
  const pats = filter.split(";").map((s) => s.trim()).filter(Boolean);
  if (!pats.length) return true;
  const n = name.toLowerCase();
  return pats.some((p) => {
    const q = p.toLowerCase();
    if (!/[*?]/.test(q)) return n.includes(q);
    const re = new RegExp("^" + q.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
    return re.test(n);
  });
}

// ---------- 경로 ----------

/** 윈도우 경로인지(드라이브 글자) */
const isWin = (p: string) => /^[A-Za-z]:/.test(p) || p.includes("\\");
const sepOf = (p: string) => (isWin(p) ? "\\" : "/");

export function joinPath(dir: string, name: string): string {
  const s = sepOf(dir);
  return dir.endsWith(s) ? dir + name : dir + s + name;
}

/** 위 폴더. 드라이브 맨 위(C:\, /)면 null */
export function parentOf(path: string): string | null {
  const s = sepOf(path);
  const t = path.length > 1 && path.endsWith(s) && !/^[A-Za-z]:\\$/.test(path) ? path.slice(0, -1) : path;
  if (/^[A-Za-z]:\\?$/.test(t) || t === "/") return null;
  const i = t.lastIndexOf(s);
  if (i < 0) return null;
  const up = t.slice(0, i);
  if (/^[A-Za-z]:$/.test(up)) return up + "\\";
  return up || "/";
}

/** 경로 조각(경로 줄): [이름, 그 조각까지의 경로] */
export function crumbsOf(path: string): { name: string; path: string }[] {
  if (isSpecial(path)) return [{ name: specialName(path), path }];
  const s = sepOf(path);
  const parts = path.split(s).filter(Boolean);
  const out: { name: string; path: string }[] = [];
  let acc = s === "/" ? "/" : "";
  for (const part of parts) {
    if (s === "\\" && /^[A-Za-z]:$/.test(part)) {
      acc = part + "\\";
      out.push({ name: part, path: acc });
      continue;
    }
    acc = acc.endsWith(s) ? acc + part : acc + s + part;
    out.push({ name: part, path: acc });
  }
  if (s === "/" && !out.length) out.push({ name: "/", path: "/" });
  return out;
}

export const baseName = (path: string) => {
  const c = crumbsOf(path);
  return c.length ? c[c.length - 1].name : path;
};

/** 드라이브 이름(C:) – 드라이브 단추 고르기 */
export const driveOf = (path: string) => (/^[A-Za-z]:/.test(path) ? path.slice(0, 2).toUpperCase() : "/");

/** 경로 칸에 적은 글자를 다듬어요: 따옴표 빼기, C: → C:\, 끝 \ 빼기 */
export function cleanPath(input: string): string {
  let p = input.trim().replace(/^"(.*)"$/, "$1");
  if (/^[A-Za-z]:$/.test(p)) p += "\\";
  if (p.length > 3 && /[\\/]$/.test(p)) p = p.slice(0, -1);
  return p;
}

/** 민원처리 이름 규칙: 접수일6자리_위치_보수내용 */
export const isComplaintName = (name: string) => /^\d{6}_.+_.+/.test(name);

// ---------- 같은 이름 ----------

/** "이름 (2).확장자" – 둘 다 두기 미리 보기용(실제 번호는 Rust가 빈 번호를 찾아요) */
export function bothName(name: string, taken: (n: string) => boolean = () => false): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const m = /^(.*) \((\d+)\)$/.exec(stem);
  const base = m ? m[1] : stem;
  let n = m ? Number(m[2]) + 1 : 2;
  while (taken(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

// ---------- 일괄 이름 바꾸기 (FilesRename 판, FreeCommander 창과 같은 자리 표시) ----------

export type CaseMode = "keep" | "lower" | "upper" | "first" | "words";

export type RenameOpts = {
  /** 이름 패턴: [n] [n1-3] [n-3-] [c] [ymd] [hms] [p] [e] */
  tpl: string;
  /** 확장자 패턴 ([e] = 원래 확장자, 글자면 그 확장자) */
  extTpl: string;
  caseMode: CaseMode;
  caseExt: boolean;
  find: string;
  repl: string;
  matchCase: boolean;
  regex: boolean;
  all: boolean;
  /** 찾기·바꾸기에서 확장자 빼기 */
  skipExt: boolean;
  /** 다음 유형의 파일만 포함 (*.jpg;*.png, 비우면 전부) */
  types: string;
  sub: boolean;
  filesOnly: boolean;
  /** "yyyy-mm-dd hh-nn-ss" 꼴: 앞이 [ymd], 뒤가 [hms] */
  timeFmt: string;
  start: number;
  step: number;
  digits: number;
  perFolder: boolean;
};

export const DEFAULT_RENAME: RenameOpts = {
  tpl: "[n]",
  extTpl: "[e]",
  caseMode: "keep",
  caseExt: false,
  find: "",
  repl: "",
  matchCase: false,
  regex: false,
  all: true,
  skipExt: true,
  types: "",
  sub: false,
  filesOnly: false,
  timeFmt: "yyyy-mm-dd hh-nn-ss",
  start: 1,
  step: 1,
  digits: 2,
  perFolder: false,
};

export const TIME_FORMATS = ["yyyy-mm-dd hh-nn-ss", "yyyymmdd hhnnss", "yy-mm-dd hh-nn", "mm-dd hhnn"];

export const NAME_TOKENS: [string, string][] = [
  ["[n]", "기존 이름"],
  ["[n1-3]", "이름 1~3번째 글자"],
  ["[n-3-]", "이름 끝 3글자"],
  ["[c]", "번호"],
  ["[ymd]", "수정한 날"],
  ["[hms]", "수정한 시각"],
  ["[p]", "상위 폴더 이름"],
  ["[e]", "확장자"],
];

function fmtTime(pat: string, d: Date): string {
  return pat
    .replace(/yyyy/g, String(d.getFullYear()))
    .replace(/yy/g, String(d.getFullYear()).slice(2))
    .replace(/mm/g, p2(d.getMonth() + 1))
    .replace(/dd/g, p2(d.getDate()))
    .replace(/hh/g, p2(d.getHours()))
    .replace(/nn/g, p2(d.getMinutes()))
    .replace(/ss/g, p2(d.getSeconds()));
}

function applyCase(s: string, mode: CaseMode): string {
  switch (mode) {
    case "lower":
      return s.toLowerCase();
    case "upper":
      return s.toUpperCase();
    case "first":
      return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    case "words":
      return s.toLowerCase().replace(/(^|[\s_\-.])(\S)/g, (_m, a, b) => a + b.toUpperCase());
    default:
      return s;
  }
}

/** 이름 한 줄을 바꾼 결과. index는 번호 매길 순서(폴더별이면 그 폴더 안 순서). */
export function renameOne(name: string, modified: number, parentName: string, index: number, o: RenameOpts): string {
  const dot = name.lastIndexOf(".");
  let base = dot > 0 ? name.slice(0, dot) : name;
  let ext = dot > 0 ? name.slice(dot + 1) : "";
  const d = new Date(modified || Date.now());
  const [ymdPat, hmsPat] = [o.timeFmt.split(" ")[0] ?? "yyyy-mm-dd", o.timeFmt.split(" ")[1] ?? "hhnnss"];
  const num = String(o.start + index * o.step).padStart(Math.max(1, o.digits), "0");
  const sub = (s: string) =>
    s
      .replace(/\[n(-?\d+)-(\d*)\]/gi, (_m, a: string, b: string) => {
        const st = parseInt(a, 10);
        if (st < 0) return base.slice(st);
        return base.slice(Math.max(0, st - 1), b ? parseInt(b, 10) : undefined);
      })
      .replace(/\[n\]/gi, base)
      .replace(/\[c\]/gi, num)
      .replace(/\[ymd\]/gi, fmtTime(ymdPat, d))
      .replace(/\[hms\]/gi, fmtTime(hmsPat, d))
      .replace(/\[p\]/gi, parentName)
      .replace(/\[e\]/gi, ext);
  let out = sub(o.tpl || "[n]");
  let newExt = o.extTpl.trim() === "" ? "" : sub(o.extTpl);
  if (o.find) {
    const flags = (o.all ? "g" : "") + (o.matchCase ? "" : "i");
    let re: RegExp | null = null;
    try {
      re = new RegExp(o.regex ? o.find : o.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch {
      re = null;
    }
    if (re) {
      const repl = sub(o.repl);
      if (o.skipExt) out = out.replace(re, () => repl);
      else {
        const whole = (newExt ? `${out}.${newExt}` : out).replace(re, () => repl);
        const i = whole.lastIndexOf(".");
        if (newExt && i > 0) {
          out = whole.slice(0, i);
          newExt = whole.slice(i + 1);
        } else out = whole;
      }
    }
  }
  out = applyCase(out, o.caseMode);
  if (o.caseExt) newExt = applyCase(newExt, o.caseMode);
  ext = newExt;
  return ext ? `${out}.${ext}` : out;
}

/** 쓸 수 없는 이름(윈도우) */
export const badName = (n: string) => !n.trim() || /[\\/:*?"<>|\x00-\x1f]/.test(n) || /[. ]$/.test(n) || n === "." || n === "..";

// ---------- 화면 상태 (암호화 파일 kv "files.state") ----------

export type FsTab = { path: string; pinned: boolean };

export type FsPane = {
  tabs: FsTab[];
  active: number;
  view: ViewMode;
  sort: SortKey;
  asc: boolean;
};

export type SavedFind = { name: string; spec: FindForm };

export type FindForm = {
  name: string;
  text: string;
  where: string;
  sub: boolean;
  from: string;
  to: string;
  minSize: string;
  maxSize: string;
  lockedOnly: boolean;
  complaintsOnly: boolean;
};

export const EMPTY_FIND: FindForm = { name: "", text: "", where: "", sub: true, from: "", to: "", minSize: "", maxSize: "", lockedOnly: false, complaintsOnly: false };

export type FilesState = {
  four: boolean;
  /** 네칸 → 두칸으로 바꿀 때 옮긴 자리(두칸 자리 k에 네칸 자리 perm[k]의 창). 다시 네칸으로 갈 때 되돌려요. */
  perm?: number[];
  /** 2창 나눈 비율(왼쪽 창 몫, 0.2~0.8) */
  split: number;
  /** 4창 위아래 나눈 비율(위 창 몫, 0.2~0.8) */
  splitV?: number;
  /** 미리보기 칸 켜짐 */
  preview?: boolean;
  active: number;
  panes: FsPane[];
  cols: { size: number; modified: number; folder: number; type: number };
  tree: { on: boolean; width: number; open: string[] };
  favorites: string[];
  finds: SavedFind[];
  rename: RenameOpts;
};

export const TREE_W = { min: 180, start: 232, max: 400 };

export function defaultState(home: string): FilesState {
  const pane = (): FsPane => ({ tabs: [{ path: home, pinned: false }], active: 0, view: "detail", sort: "name", asc: true });
  return {
    four: false,
    split: 0.5,
    active: 0,
    panes: [pane(), pane(), pane(), pane()],
    cols: { size: 80, modified: 112, folder: 140, type: 104 },
    tree: { on: true, width: TREE_W.start, open: [] },
    favorites: [],
    finds: [],
    rename: { ...DEFAULT_RENAME },
  };
}

/** 저장된 상태를 읽어요. 모자란 칸은 처음 값으로 채워요. */
export function readState(raw: string | null, home: string): FilesState {
  const d = defaultState(home);
  if (!raw) return d;
  try {
    const s = JSON.parse(raw) as Partial<FilesState>;
    const panes = (s.panes ?? []).slice(0, 4).map((p, i) => ({ ...d.panes[i], ...p, tabs: p.tabs?.length ? p.tabs : d.panes[i].tabs }));
    while (panes.length < 4) panes.push(d.panes[panes.length]);
    for (const p of panes) p.active = Math.min(Math.max(0, p.active), p.tabs.length - 1);
    return {
      ...d,
      ...s,
      panes,
      cols: { ...d.cols, ...s.cols },
      tree: { ...d.tree, ...s.tree, width: Math.min(TREE_W.max, Math.max(TREE_W.min, s.tree?.width ?? TREE_W.start)) },
      rename: { ...DEFAULT_RENAME, ...s.rename },
    };
  } catch {
    return d;
  }
}

/** 4창의 Tab 순서: 시계 방향(왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래) */
export const CLOCKWISE = [0, 1, 3, 2];
export function nextPane(cur: number, four: boolean): number {
  if (!four) return cur === 0 ? 1 : 0;
  const i = CLOCKWISE.indexOf(cur);
  return CLOCKWISE[(i + 1) % 4];
}

/** 찾기 조건 요약(결과 띠) */
export function findSummary(f: FindForm): string {
  const parts: string[] = [];
  if (f.where) parts.push(`${f.where}${f.sub ? " 아래" : ""}`);
  if (f.text) parts.push(`"${f.text}" 들어간`);
  if (f.from || f.to) parts.push(`${f.from || "처음"}~${f.to || "오늘"}`);
  if (f.minSize || f.maxSize) parts.push(`${f.minSize || "0"}~${f.maxSize || "∞"}`);
  if (f.lockedOnly) parts.push("잠긴 것만");
  if (f.complaintsOnly) parts.push("민원 파일만");
  return parts.join(" · ");
}

/** "1MB", "500KB", "2.5mb", "1024" → 바이트 (못 읽으면 0) */
export function parseSize(s: string): number {
  const m = /^\s*([\d.]+)\s*(b|kb|k|mb|m|gb|g)?\s*$/i.exec(s);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const mul: Record<string, number> = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3 };
  return Math.round(v * (mul[(m[2] ?? "b").toLowerCase()] ?? 1));
}
