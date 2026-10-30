// 탐색기 – 조각끼리 함께 쓰는 타입·값(창·탭·고르기 모양, 빈 고르기, 날짜·시각 사이).
import { baseName, bothName, FilesState, FindForm, formatDate, FsEntry, FsPane, FsTab, parentOf, SortKey, ViewMode } from "../../files";
import { Found, fsApi } from "../../filesApi";
import { textPx } from "../../ColHead";
import { createRef } from "react";
import type { VirtualHandle } from "../../VirtualList";

type PopItem = { id: string; label: string; checked?: boolean; bold?: boolean; disabled?: boolean } | "-";
export type Pop = { x: number; y: number; items: PopItem[]; onPick: (id: string) => void; scroll?: boolean };

export type FindRun = {
  form: FindForm;
  results: Found[];
  running: boolean;
  /** 펼쳐보기(하위 폴더 파일까지 한 목록) */
  flat?: boolean;
  /** 빠른 찾기 칸에 치는 대로 바뀌는 탭(치는 동안 새 탭을 만들지 않고 이 탭을 고쳐요) */
  live?: boolean;
  /** 모든 드라이브(빠른 찾기 목록)에서 찾음 */
  all?: boolean;
  /** 걸린 시간(밀리초) */
  ms?: number;
};
/** back·fwd: 이 탭에서 다녀온 폴더(뒤로·앞으로 – 마우스 옆 단추·Alt+←/→). 저장하지 않아요. */
export type RTab = FsTab & { find?: FindRun; id: number; back?: string[]; fwd?: string[] };
export type RPane = Omit<FsPane, "tabs"> & { tabs: RTab[] };
export type RState = Omit<FilesState, "panes"> & { panes: RPane[] };

export type Listing = { path: string; entries: FsEntry[]; error: string; loading: boolean };
export type Sel = { paths: Set<string>; cursor: string | null; anchor: string | null };
export type Row = FsEntry & { folder?: string };

export const EMPTY_SEL: Sel = { paths: new Set(), cursor: null, anchor: null };

/** 날짜와 시각 사이를 띄어쓰기보다 넓게(2026-10-18 사용자: 붙어 보여 읽기 힘듦) */
export const DATE_TIME_GAP = 3;

/** 자세히 보기 한 줄 높이(이름 한 줄 "…" – 탐색기 ✔3) */
export const ROW_H = 28;
/** 창마다 줄 부모(.fx-rows) – VirtualList가 재고 찾는 자리(창은 넷까지) */
export const rowsRefs = [0, 1, 2, 3].map(() => createRef<HTMLDivElement>());
/** 창마다 보이는 만큼만 그리는 목록(탐색기 ✔4) – 키로 화면 밖 줄에 갈 때 써요 */
export const vlists: (VirtualHandle | null)[] = [];
/** 그 줄을 보이게: 그려져 있으면 그 자리로, 아니면 목록이 그 줄까지 내려가요 */
export function revealRow(pane: number, i: number) {
  const el = document.getElementById(`fx-row-${pane}-${i}`);
  if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  else vlists[pane]?.scrollToIndex(i, { align: "nearest" });
}

export const STATE_KEY = "files.state";
export const ZIP_RO = "zip 파일 안은 읽기만 돼요 – 꺼내려면 다른 폴더로 복사해 주세요";
/** Ctrl+휠로 바꾸는 보기 차례(작은 것 → 큰 것, 호환 B) */
export const VIEW_SIZES: ViewMode[] = ["detail", "brief", "icons", "thumb"];
export const SORT_NAME: Record<SortKey, string> = { name: "이름", modified: "수정한 날짜", type: "유형", size: "크기", folder: "폴더" };

let tabSeq = 1;
/** 탭마다 붙이는 화면용 번호 – 여러 조각이 새 탭을 만들어 한 곳에서 세요 */
export const nextTabId = () => tabSeq++;
export const withIds = (p: FsPane): RPane => ({ ...p, tabs: p.tabs.map((t) => ({ ...t, id: nextTabId() })) });

/** 저장할 때는 찾기 탭과 화면용 번호를 빼요. */
export function toSaved(s: RState): FilesState {
  return {
    ...s,
    panes: s.panes.map((p) => {
      const tabs = p.tabs.filter((t) => !t.find).map(({ path, pinned }) => ({ path, pinned }));
      const activeTab = p.tabs[p.active];
      const active = activeTab?.find ? 0 : Math.max(0, tabs.findIndex((t) => t.path === activeTab?.path && !activeTab.find));
      return { ...p, tabs: tabs.length ? tabs : [{ path: p.tabs[0]?.path ?? "", pinned: false }], active };
    }),
  };
}

export const dateMinCache = new Map<string, number>();
/** 날짜 형식 글자 폭(+여백 20px). 2026-12-28 23:58:58처럼 넓은 숫자로 재요. */
export function dateColMin(fmt: string): number {
  const fs = getComputedStyle(document.body).fontSize;
  const key = fmt + "|" + fs;
  const hit = dateMinCache.get(key);
  if (hit) return hit;
  // 12시간 모양은 12시가 가장 넓어요 – 둘 다 재서 큰 값(글자 재는 캔버스는 공통 부품 하나)
  const wide = Math.max(...[23, 12].map((h) => textPx(formatDate(new Date(2026, 11, 28, h, 58, 58).getTime(), fmt), `${fs} Pretendard, sans-serif`)));
  const w = Math.ceil(wide) + 20 + (fmt.includes(" ") ? DATE_TIME_GAP : 0);
  dateMinCache.set(key, w);
  return w;
}

export const NEW_DIR = "새 폴더";
/** 새 폴더를 비는 이름으로 만들어요(2026-10-25 사용자: 같은 이름이 있으면 "새 폴더 (2)"·"(3)"…, 윈도우와 같은 꼴).
    목록에 안 보이는 숨김·시스템 폴더나 아직 안 읽힌 이름과 겹쳐도 앱이 "있어요"라고 하면 다음 번호로 다시 해요. */
export async function mkdirFree(dir: string, names: string[]): Promise<string> {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  let name = taken.has(NEW_DIR) ? bothName(NEW_DIR, (n) => taken.has(n.toLowerCase())) : NEW_DIR;
  for (let i = 0; i < 200; i++) {
    try {
      return await fsApi.mkdir(dir, name);
    } catch (e) {
      if (String(e) !== "exists") throw e;
      taken.add(name.toLowerCase());
      name = bothName(NEW_DIR, (n) => taken.has(n.toLowerCase()));
    }
  }
  throw "exists";
}

/** 즐겨찾기 보기: ★로 지정한 폴더를 목록 줄로(수정한 날은 위 폴더를 읽어 채워요, 없어진 폴더는 흐린 이름으로 남겨요) */
export async function favEntries(favs: string[]): Promise<FsEntry[]> {
  const byParent = new Map<string, FsEntry[]>();
  const out: FsEntry[] = [];
  for (const f of favs) {
    const par = parentOf(f);
    let found: FsEntry | undefined;
    if (par) {
      if (!byParent.has(par)) byParent.set(par, await fsApi.list(par, true).catch(() => []));
      found = byParent.get(par)!.find((e) => e.path === f);
    }
    out.push(found ?? { name: baseName(f) || f, path: f, dir: true, size: 0, modified: 0, created: 0, hidden: false, locked: false, kind: par ? undefined : "드라이브" });
  }
  return out;
}
