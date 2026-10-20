// 탐색기가 앱(Rust files.rs)을 부르는 곳이에요.
// 앱 밖(브라우저 미리 보기)에서는 시안과 같은 가짜 폴더로 흉내 내요.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { inApp } from "./api";
import { FsDrive, FsEntry, HOME, PC, baseName, bothName, formatSize, joinPath, parentOf, quickMatch } from "./files";

export type Conflict = { src: FsEntry; dst: FsEntry };
export type Summary = { done: number; skipped: number; errors: [string, string][]; pairs?: [string, string][]; overwritten?: number };
/** 되돌리기 한 걸음(Rust files.rs의 Step) */
export type Step =
  | { k: "move"; from: string; to: string }
  | { k: "copy"; from: string; to: string }
  | { k: "trash"; paths: string[] }
  | { k: "restore"; paths: string[]; since: number }
  | { k: "mkdir"; path: string };
export type Found = FsEntry & { folder: string };
export type TreeDir = { name: string; path: string; hasChildren: boolean };
export type FindSpec = {
  name: string;
  text: string;
  roots: string[];
  sub: boolean;
  from: number;
  to: number;
  minSize: number;
  maxSize: number;
  lockedOnly: boolean;
  complaintsOnly: boolean;
  showHidden: boolean;
  /** 설정에서 빠른 찾기를 껐으면 true */
  noFast?: boolean;
};
/** 빠른 찾기 도우미(드라이브 전체 목록) 상태 */
export type FastStatus = {
  /** 도우미가 깔려 있는지 */
  installed: boolean;
  /** 도우미가 돌고 있는지 */
  running: boolean;
  /** 목록을 가진 드라이브(만드는 중이면 ready false) */
  drives: { drive: string; count: number; ready: boolean }[];
};
/** 우클릭 메뉴 결과: "" 안 고름 · "done" 실행함 · "rename" 이름 바꾸기 시작 */
export type MenuResult = "" | "done" | "rename" | "reveal" | "newfolder";

// ---------- 브라우저 흉내 ----------

const T = (s: string) => new Date(s).getTime();
type FakeNode = { dir: boolean; size: number; modified: number; locked?: boolean; hidden?: boolean };
const fakeFs = new Map<string, FakeNode>();
function addFake(path: string, size: number, mod: string, locked = false) {
  fakeFs.set(path, { dir: false, size, modified: T(mod), locked });
  let p = parentOf(path);
  while (p) {
    if (!fakeFs.has(p)) fakeFs.set(p, { dir: true, size: 0, modified: T("2026-10-16T17:40") });
    p = parentOf(p);
  }
}
function addDir(path: string) {
  let p: string | null = path;
  while (p) {
    if (!fakeFs.has(p)) fakeFs.set(p, { dir: true, size: 0, modified: T("2026-10-16T17:40") });
    p = parentOf(p);
  }
}
(() => {
  const M = "D:\\민원처리\\";
  const k = 1024;
  const mb = k * k;
  addFake(M + "261001_답곡리 산 82-9_포트홀.jpg", 405 * k, "2026-10-02T11:10");
  addFake(M + "261001_답곡리 산 82-9_포트홀.pptx", 1.6 * mb, "2026-10-02T11:10");
  addFake(M + "261015_봉일천리 209-10_포트홀.jpg", 412 * k, "2026-10-17T14:21");
  addFake(M + "261015_봉일천리 209-10_포트홀.pptx", 1.8 * mb, "2026-10-17T14:21");
  addFake(M + "261015_봉일천리 209-10_포트홀_사진1.jpg", 2.3 * mb, "2026-10-15T09:02");
  addFake(M + "261015_봉일천리 209-10_포트홀_위치도.png", 680 * k, "2026-10-15T09:03");
  addFake(M + "261015_연풍리 18 삼거리_반사경.jpg", 398 * k, "2026-10-16T10:40");
  addFake(M + "261015_연풍리 18 삼거리_반사경.pptx", 1.7 * mb, "2026-10-16T10:40");
  addFake(M + "261015_연풍리 18 삼거리_반사경_사진1.jpg", 1.9 * mb, "2026-10-15T09:02");
  addFake(M + "261016_법흥리 77 버스정류장 뒤_물고임_사진1.jpg", 2.6 * mb, "2026-10-16T09:30");
  addFake(M + "261017_등원리 230-1_포트홀_사진1.jpg", 2.4 * mb, "2026-10-17T14:02");
  addFake(M + "261017_등원리 230-1_포트홀_사진2.jpg", 2.2 * mb, "2026-10-17T14:02");
  addFake(M + "민원 원문 목록.hwp", 96 * k, "2026-10-15T09:05", true);
  const P = "D:\\증빙사진\\2026 가을철\\포장\\";
  addDir(P + "조리읍");
  addDir(P + "문산읍");
  addFake(P + "01_파주읍_연풍리_전.jpg", 3.1 * mb, "2026-10-16T11:20");
  addFake(P + "01_파주읍_연풍리_후.jpg", 3.0 * mb, "2026-10-16T11:24");
  addFake(P + "02_탄현면_법흥리_전.jpg", 2.9 * mb, "2026-10-16T13:05");
  addFake(P + "02_탄현면_법흥리_후.jpg", 2.8 * mb, "2026-10-16T13:09");
  addFake(P + "03_조리읍_등원리_전.jpg", 2.7 * mb, "2026-10-16T15:11");
  addFake(P + "증빙사진 목록.xlsx", 24 * k, "2026-10-16T17:52", true);
  addDir("D:\\증빙사진\\2026 가을철\\시설물");
  addDir("D:\\증빙사진\\2026 봄철\\포장");
  addDir("D:\\공사\\2026 도로포장 연간단가");
  addDir("D:\\프로젝트\\시도15호선");
  const C = "C:\\사용자\\hunmin\\문서\\공문\\";
  addFake(C + "도로시설물 유지보수 공사 지시 통보(2026-10-14, 조리읍 봉일천리 외 3개소, 연번 12~14).hwp", 82 * k, "2026-10-14T16:30", true);
  addFake(C + "행정사무감사 요구자료.hwp", 1.1 * mb, "2026-10-13T18:02", true);
  addFake(C + "2027 예산 요구서.xlsx", 210 * k, "2026-10-10T11:48");
  addDir("C:\\사용자\\hunmin\\문서\\giLog");
  addDir("C:\\사용자\\hunmin\\바탕 화면");
  fakeFs.set("C:\\사용자\\hunmin\\문서\\desktop.ini", { dir: false, size: 402, modified: T("2026-01-02T09:00"), hidden: true });
})();

function fakeEntry(path: string): FsEntry | null {
  const n = fakeFs.get(path);
  if (!n) return null;
  return { name: baseName(path), path, dir: n.dir, size: Math.round(n.size), modified: n.modified, created: n.modified, hidden: !!n.hidden, locked: !!n.locked };
}

function fakeList(dir: string, hidden: boolean): FsEntry[] {
  if (!fakeFs.has(dir)) throw "not_found";
  const out: FsEntry[] = [];
  for (const p of fakeFs.keys()) {
    if (parentOf(p) === dir) {
      const e = fakeEntry(p)!;
      if (!e.hidden || hidden) out.push(e);
    }
  }
  return out;
}

function fakeMove(from: string, to: string) {
  for (const [p, n] of [...fakeFs]) {
    if (p === from || p.startsWith(from + "\\")) {
      fakeFs.delete(p);
      fakeFs.set(to + p.slice(from.length), n);
    }
  }
}

const changed = new Set<(dir: string) => void>();
function fakeChanged(...dirs: (string | null)[]) {
  for (const d of dirs) if (d) for (const f of changed) f(d);
}

function fakeCall(cmd: string, a: Record<string, unknown>): unknown {
  switch (cmd) {
    case "fs_quick":
      return [
        ["바탕 화면", "C:\\사용자\\hunmin\\바탕 화면"],
        ["문서", "C:\\사용자\\hunmin\\문서"],
        ["민원처리", "D:\\민원처리"],
        ["증빙사진", "D:\\증빙사진"],
      ]
        .map(([name, path]) => ({ name, path, dir: true, size: 0, modified: Date.now() - 864e5, created: 0, hidden: false, locked: false, group: "fav" }))
        .concat([{ name: "261015_봉일천리 209-10_포트홀.pptx", path: "D:\\민원처리\\261015_봉일천리 209-10_포트홀.pptx", dir: false, size: 1.8e6, modified: Date.now() - 36e5, created: 0, hidden: false, locked: false, group: "recent" }]);
    case "fs_drives":
      return [
        { name: "C:", path: "C:\\", label: "윈도우", kind: "fixed", free: 112e9, total: 256e9 },
        { name: "D:", path: "D:\\", label: "자료", kind: "fixed", free: 612e9, total: 1e12 },
        { name: "F:", path: "F:\\", label: "USB", kind: "removable", free: 28e9, total: 32e9 },
      ];
    case "fs_home":
      return "D:\\민원처리";
    case "fs_is_dir":
      return fakeFs.get(a.path as string)?.dir === true || a.path === "F:\\";
    case "fs_list":
      if (a.path === "F:\\") return [];
      return fakeList(a.path as string, a.showHidden as boolean);
    case "fs_subdirs":
      if (a.path === "F:\\") return [];
      return fakeList(a.path as string, a.showHidden as boolean)
        .filter((e) => e.dir)
        .map((e) => ({ name: e.name, path: e.path, hasChildren: fakeList(e.path, false).some((c) => c.dir) }));
    case "fs_mkdir": {
      const p = joinPath(a.dir as string, (a.name as string).trim());
      if (fakeFs.has(p)) throw "exists";
      fakeFs.set(p, { dir: true, size: 0, modified: Date.now() });
      fakeChanged(a.dir as string);
      return p;
    }
    case "fs_rename": {
      const from = a.path as string;
      const to = joinPath(parentOf(from)!, a.name as string);
      if (fakeFs.has(to) && to.toLowerCase() !== from.toLowerCase()) throw "exists";
      fakeMove(from, to);
      fakeChanged(parentOf(from));
      return to;
    }
    case "fs_rename_many": {
      const items = a.items as { path: string; name: string }[];
      const back = items.map((it) => {
        const to = joinPath(parentOf(it.path)!, it.name);
        fakeMove(it.path, to);
        return { path: to, name: baseName(it.path) };
      });
      fakeChanged(...items.map((i) => parentOf(i.path)));
      return back;
    }
    case "fs_conflicts": {
      const out: Conflict[] = [];
      for (const s of a.sources as string[]) {
        const d = joinPath(a.dest as string, baseName(s));
        if (d === s) continue; // 같은 폴더에 붙여 넣기는 "- 복사본"이라 안 겹쳐요
        const se = fakeEntry(s);
        const de = fakeEntry(d);
        if (se && de && !se.dir && !de.dir) out.push({ src: se, dst: de });
      }
      return out;
    }
    case "fs_clip_set":
      fakeClip = { paths: [...(a.paths as string[])], cut: !!a.cut };
      return null;
    case "fs_clip_get":
      return { paths: fakeClip.paths.filter((p) => fakeFs.has(p)), cut: fakeClip.cut };
    case "fs_transfer": {
      const dec = a.decisions as Record<string, string>;
      const sum: Summary = { done: 0, skipped: 0, errors: [], pairs: [], overwritten: 0 };
      for (const s of a.sources as string[]) {
        let d = joinPath(a.dest as string, baseName(s));
        // 같은 폴더에 붙여 넣기 → "이름 - 복사본"(앱과 같게)
        if (a.op === "move" && d === s) {
          sum.skipped++;
          continue;
        }
        if (a.op === "copy" && d === s) d = joinPath(a.dest as string, copyName(baseName(s), (n) => fakeFs.has(joinPath(a.dest as string, n))));
        if (fakeFs.has(d) || d === s) {
          const k = dec[d] ?? (d === s ? "both" : "skip");
          if (k === "skip") {
            sum.skipped++;
            continue;
          }
          if (k === "both") d = joinPath(a.dest as string, bothName(baseName(s), (n) => fakeFs.has(joinPath(a.dest as string, n))));
        }
        const node = fakeFs.get(s)!;
        const over = fakeFs.has(d);
        if (a.op === "move") fakeMove(s, d);
        else fakeCopy(s, d);
        sum.done++;
        if (over) sum.overwritten!++;
        else sum.pairs!.push([s, d]);
        void node;
      }
      fakeChanged(a.dest as string, ...(a.sources as string[]).map(parentOf));
      return sum;
    }
    case "fs_delete":
      for (const p of a.paths as string[]) {
        for (const k of [...fakeFs.keys()])
          if (k === p || k.startsWith(p + "\\")) {
            if (!a.permanent) fakeTrash.set(k, fakeFs.get(k)!);
            fakeFs.delete(k);
          }
      }
      fakeChanged(...(a.paths as string[]).map(parentOf));
      return null;
    case "fs_find": {
      const s = a.spec as FindSpec;
      const out: Found[] = [];
      for (const p of fakeFs.keys()) {
        const e = fakeEntry(p)!;
        if (e.dir && s.roots.length) continue;
        const inRoot = !s.roots.length || s.roots.some((r) => (s.sub ? p.startsWith(r.endsWith("\\") ? r : r + "\\") : parentOf(p) === r));
        if (!inRoot || !quickMatch(s.name, e.name)) continue;
        if (s.from && e.modified < s.from) continue;
        if (s.to && e.modified > s.to) continue;
        if (s.lockedOnly && !e.locked) continue;
        if (s.complaintsOnly && !/^\d{6}_.+_.+/.test(e.name)) continue;
        // 모든 드라이브에서 찾으면 폴더 칸은 전체 경로(어느 드라이브인지 보이게)
        out.push({ ...e, folder: s.roots.length ? baseName(parentOf(p)!) : parentOf(p)! });
      }
      return out;
    }
    case "fs_undo": {
      const sum: Summary = { done: 0, skipped: 0, errors: [] };
      const dirs: (string | null)[] = [];
      for (const st of a.steps as Step[]) {
        const fail = (p: string, why: string) => void sum.errors.push([p, why]);
        if (st.k === "move" || st.k === "copy") {
          if (!fakeFs.has(st.from)) fail(st.from, "not_found");
          else if (fakeFs.has(st.to) && st.to.toLowerCase() !== st.from.toLowerCase()) fail(st.from, "exists");
          else (st.k === "move" ? fakeMove(st.from, st.to) : fakeCopy(st.from, st.to), sum.done++);
          dirs.push(parentOf(st.from), parentOf(st.to));
        } else if (st.k === "mkdir") {
          fakeFs.set(st.path, { dir: true, size: 0, modified: Date.now() });
          sum.done++;
          dirs.push(parentOf(st.path));
        } else if (st.k === "trash") {
          for (const p of st.paths) {
            if (!fakeFs.has(p)) continue;
            for (const k of [...fakeFs.keys()]) if (k === p || k.startsWith(p + "\\")) (fakeTrash.set(k, fakeFs.get(k)!), fakeFs.delete(k));
            sum.done++;
            dirs.push(parentOf(p));
          }
        } else {
          for (const p of st.paths) {
            if (!fakeTrash.has(p)) fail(p, "not_in_trash");
            else if (fakeFs.has(p)) fail(p, "exists");
            else {
              for (const [k, n] of [...fakeTrash]) if (k === p || k.startsWith(p + "\\")) (fakeFs.set(k, n), fakeTrash.delete(k));
              sum.done++;
            }
            dirs.push(parentOf(p));
          }
        }
      }
      fakeChanged(...dirs);
      return sum;
    }
    case "fs_fast_setup":
      return null;
    case "fs_fast_status":
      // 미리 보기 시험: window.__fxNoFast = true면 "깔리지 않음"
      if ((window as unknown as { __fxNoFast?: boolean }).__fxNoFast) return { installed: false, running: false, drives: [] } as FastStatus;
      return { installed: true, running: true, drives: [{ drive: "C:", count: 412330, ready: true }, { drive: "D:", count: 88120, ready: true }] } as FastStatus;
    case "fs_icons":
      return {};
    case "fs_context_menu":
      return "";
    default:
      return null;
  }
}

let fakeClip: { paths: string[]; cut: boolean } = { paths: [], cut: false };
const fakeTrash = new Map<string, FakeNode>();
function fakeCopy(from: string, to: string) {
  for (const [p, n] of [...fakeFs]) if (p === from || p.startsWith(from + "\\")) fakeFs.set(to + p.slice(from.length), { ...n });
}

function copyName(name: string, taken: (n: string) => boolean): string {
  const i = name.lastIndexOf(".");
  const [stem, ext] = i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
  let c = `${stem} - 복사본${ext}`;
  for (let n = 2; taken(c); n++) c = `${stem} - 복사본 (${n})${ext}`;
  return c;
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (inApp) return invoke<T>(cmd, args);
  await new Promise((r) => setTimeout(r, 30));
  return fakeCall(cmd, args) as T;
}

export const fsApi = {
  drives: () => call<FsDrive[]>("fs_drives"),
  home: () => call<string>("fs_home"),
  isDir: (path: string) => call<boolean>("fs_is_dir", { path }),
  list: async (path: string, showHidden: boolean): Promise<FsEntry[]> => {
    if (path === PC) {
      const ds = await call<FsDrive[]>("fs_drives");
      return ds.map((d) => ({
        name: `${d.name} ${d.label}`.trim(),
        path: d.path,
        dir: true,
        size: d.total,
        modified: 0,
        created: 0,
        hidden: false,
        locked: false,
        note: d.total ? `${formatSize(d.free)} 남음` : "",
        kind: (d.kind === "removable" ? "이동식 디스크" : d.kind === "network" ? "네트워크 드라이브" : "로컬 디스크") + (d.total ? ` · ${formatSize(d.total)}` : ""),
      }));
    }
    if (path === HOME) return call<FsEntry[]>("fs_quick");
    return call<FsEntry[]>("fs_list", { path, showHidden });
  },
  subdirs: (path: string, showHidden: boolean) => call<TreeDir[]>("fs_subdirs", { path, showHidden }),
  mkdir: (dir: string, name: string) => call<string>("fs_mkdir", { dir, name }),
  rename: (path: string, name: string) => call<string>("fs_rename", { path, name }),
  renameMany: (items: { path: string; name: string }[]) => call<{ path: string; name: string }[]>("fs_rename_many", { items }),
  conflicts: (sources: string[], dest: string) => call<Conflict[]>("fs_conflicts", { sources, dest }),
  transfer: (op: "copy" | "move", sources: string[], dest: string, decisions: Record<string, string>) =>
    call<Summary>("fs_transfer", { op, sources, dest, decisions }),
  cancel: () => call<null>("fs_cancel"),
  /** Ctrl+Z·Y – 미리 만들어 둔 걸음들을 해요 */
  undo: (steps: Step[]) => call<Summary>("fs_undo", { steps }),
  /** Ctrl+C·X – 윈도우 클립보드에 파일을 넣어요(빈 목록이면 비우기) */
  clipSet: (paths: string[], cut: boolean) => call<null>("fs_clip_set", { paths, cut }),
  /** Ctrl+V – 윈도우 클립보드의 파일 목록 */
  clipGet: () => call<{ paths: string[]; cut: boolean }>("fs_clip_get"),
  remove: (paths: string[], permanent: boolean) => call<null>("fs_delete", { paths, permanent }),
  open: (path: string) => (inApp ? call<null>("fs_open", { path }) : Promise.resolve(null)),
  explorer: (path: string, select: boolean) => (inApp ? call<null>("fs_explorer", { path, select }) : Promise.resolve(null)),
  icons: (keys: string[], size: number) => call<Record<string, string>>("fs_icons", { keys, size }),
  /** 파일 형식 이름(윈도우 것): 키는 ".xlsx"·"<dir>" */
  types: (keys: string[]) => (inApp ? call<Record<string, string>>("fs_types", { keys }) : Promise.resolve({} as Record<string, string>)),
  contextMenu: (dir: string, names: string[], x: number, y: number) => call<MenuResult>("fs_context_menu", { dir, names, x, y }),
  /** 윈도우 끌기 시작(기록 → 윈도우 탐색기·바탕 화면) – 놓을 때까지 기다려요. "" 놓지 않음 · copy · move · link */
  startDrag: (paths: string[]) => call<string>("fs_start_drag", { paths }),
  /** Alt+Enter 속성 창 */
  properties: (paths: string[]) => call<null>("fs_properties", { paths }),
  /** 바로가기(.lnk)가 가리키는 곳 */
  lnkTarget: (path: string) => (inApp ? call<string | null>("fs_lnk_target", { path }) : Promise.resolve(null)),
  /** 지금 누른 Ctrl·Shift */
  mods: () => (inApp ? call<[boolean, boolean]>("fs_mods") : Promise.resolve([false, false] as [boolean, boolean])),
  /** 윈도우 탐색기로 넘기기(보안 해제) – dir을 열어 names를 골라 두고 우클릭 메뉴를 띄워요 */
  reveal: (dir: string, names: string[]) => (inApp ? call<null>("fs_reveal", { dir, names, popup: true }) : Promise.resolve(null)),
  /** roots가 비면 빠른 찾기 목록이 있는 모든 드라이브 */
  find: (spec: FindSpec) => call<Found[]>("fs_find", { spec }),
  fastStatus: () => call<FastStatus>("fs_fast_status"),
  /** 빠른 찾기 도우미 깔기·빼기 – 윈도우가 관리자 허용을 물어요 */
  fastSetup: (op: "install" | "uninstall") => call<null>("fs_fast_setup", { op }),
  watch: (dirs: string[]) => (inApp ? call<null>("fs_watch", { dirs }) : Promise.resolve(null)),
};

/** 폴더가 바뀌면(파일이 생기거나 지워지면) 그 폴더 경로로 불러요. 끊는 함수를 돌려줘요. */
export function onFsChanged(f: (dir: string) => void): () => void {
  if (!inApp) {
    changed.add(f);
    return () => changed.delete(f);
  }
  const off = listen<string>("fs-changed", (e) => f(e.payload));
  return () => void off.then((g) => g());
}

/** 복사·옮기기가 얼마나 됐는지 */
export function onFsProgress(f: (p: { done: number; total: number; name: string }) => void): () => void {
  if (!inApp) return () => {};
  const off = listen<{ done: number; total: number; name: string }>("fs-progress", (e) => f(e.payload));
  return () => void off.then((g) => g());
}

/** 실패 이름을 화면 글로 */
export function fsErrorText(e: unknown): string {
  const s = String(e);
  if (s === "exists") return "같은 이름이 이미 있어요.";
  if (s === "bad_name") return "쓸 수 없는 이름이에요.";
  if (s === "not_found") return "폴더를 찾지 못했어요.";
  if (s === "denied") return "권한이 없어 할 수 없어요.";
  if (s === "into_self") return "폴더를 그 안으로 옮기거나 복사할 수 없어요.";
  if (s === "not_in_trash") return "휴지통에서 찾지 못했어요.";
  if (s.startsWith("trash")) return "휴지통으로 보내지 못했어요.";
  if (s.startsWith("clipboard")) return "다른 프로그램이 클립보드를 쓰고 있어요. 다시 해 주세요.";
  return "하지 못했어요. 파일이 다른 프로그램에서 열려 있는지 확인해 주세요.";
}
