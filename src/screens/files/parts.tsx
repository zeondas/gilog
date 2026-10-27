// 탐색기 – 조각끼리 함께 쓰는 타입·값(창·탭·고르기 모양, 빈 고르기, 날짜·시각 사이).
import { FilesState, FindForm, FsEntry, FsPane, FsTab } from "../../files";
import { Found } from "../../filesApi";

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
