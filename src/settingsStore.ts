// 암호화된 자료 파일 안에 두는 설정이에요. (민원대장 항목, 업무일지 구분 등)
import { api } from "./api";
import type { Modules } from "./screens";
import { dateFormatOf, DEFAULT_DATE_FORMAT } from "./files";

export type Kind = { name: string; key: string };

/** 민원처리(10단계) 설정 — 사양서 "설정 화면 민원처리 카드" */
export type ProcessSettings = {
  /** 지시부의 {지시자}: 이름 */
  signer: string;
  /** 지시자 연락처(지시자 칸에 이름 뒤 줄바꿈으로 붙어요) */
  signerPhone: string;
  /** 민원 폴더: 사진·지시부를 두는 곳 */
  root: string;
  /** AI가 결과 파일(JSON)을 놓는 곳 */
  inbox: string;
  /** 엣지 다운로드 폴더(첨부 사진을 받는 곳) */
  downloads: string;
  /** 폰으로 보낼 JPG를 두는 곳(Claude가 대화에 올려요) */
  outbox: string;
  /** Claude Code 실행 파일(경로를 비우면 "claude") */
  claude: string;
  /** 표준 지시부 양식(hwpx). 비우면 앱에 들어 있는 양식(2026-10-19) */
  tpl: string;
};

export const DEFAULT_PROCESS: ProcessSettings = {
  signer: "도로관리과 전훈민",
  signerPhone: "",
  root: "D:\\민원처리",
  inbox: "D:\\민원처리\\가져오기",
  downloads: "D:\\",
  outbox: "D:\\민원처리\\보내기",
  claude: "claude",
  tpl: "",
};

export type Settings = {
  status: string[];
  intake: string[];
  ctype: string[];
  myName: string;
  kinds: Kind[];
  /** 캘린더 쉬는 날(토·일·공휴일) 붉은 음영 */
  restShade: boolean;
  /** 키 설정 — 처음 키와 다른 것만 (keys.ts, 2026-10-17 엔터규칙) */
  keys: Partial<Record<string, string>>;
  process: ProcessSettings;
  /** 설정 "탐색기" 카드 (11단계, 시안 FilesSettings.dc.html) */
  files: FilesSettings;
  /** 모듈 켜고 끄기 — false인 모듈만 꺼짐(사이드바에서 숨김, 자료는 그대로). 2026-10-18 설정 세션 */
  modules: Modules;
};

export type FilesSettings = {
  /** 날짜 모양 0 10-16 17:40 · 1 2026-10-16 17:40 · 2 2026. 10. 16. · 3 상대 */
  dateFmt: string;
  /** 드라이브 단추 줄에서 숨긴 것 ("E:", 내 PC·홈 포함) */
  hiddenDrives: string[];
  /** 폴더 트리에서 숨긴 것 — 단추 줄과 따로 골라요(2026-10-19 사용자 2안). 예전 자료는 hiddenDrives를 이어받아요 */
  treeHidden: string[];
  showHidden: boolean;
  /** 새 탭이 여는 폴더. 비우면 문서 */
  newTabDir: string;
  /** F8 지울 때 묻기 (Shift+F8 완전 삭제는 늘 물어요) */
  askDelete: boolean;
  /** 자세히 보기에서 보일 열(이름은 늘 보여요) — 2026-10-18 사용자 */
  cols: { size: boolean; modified: boolean; type: boolean };
};

export const DEFAULT_FILES_SETTINGS: FilesSettings = { dateFmt: DEFAULT_DATE_FORMAT, hiddenDrives: [], treeHidden: [], showHidden: false, newTabDir: "", askDelete: true, cols: { size: true, modified: true, type: true } };

export const DEFAULT_SETTINGS: Settings = {
  // 2026-10-19 사용자: 상태는 고정 6개예요(설정·분류 관리에서 바꾸지 않아요) — STATUSES
  status: ["접수", "진행", "답변", "완료", "보류", "장기"],
  intake: ["전화", "방문", "국민신문고", "정보공개청구", "진정민원"],
  // 민원유형은 사용자가 필요할 때 직접 적어요(2026-10-17 사용자) — 미리 넣는 예시는 없어요. 이미 저장된 목록은 그대로예요.
  ctype: [],
  myName: "전훈민",
  kinds: [
    ["유선수신", "ㅇㅅ"], ["유선발신", "ㅇㅂ"], ["무선수신", "ㅁㅅ"], ["무선발신", "ㅁㅂ"],
    ["메일수신", "ㅁㅇㅅ"], ["메일발신", "ㅁㅇㅂ"], ["쪽지수신", "ㅉㅅ"], ["쪽지발신", "ㅉㅂ"],
    ["채팅수신", "ㅊㅅ"], ["채팅발신", "ㅊㅂ"], ["구두수신", "ㄱㅅ"], ["구두발신", "ㄱㅂ"],
    ["회의", "ㅎㅇ"], ["협의", "ㅎㅂ"], ["출장", "ㅊㅈ"], ["메모", "ㅁㅁ"],
  ].map(([name, key]) => ({ name, key })),
  restShade: true,
  keys: {},
  process: { ...DEFAULT_PROCESS },
  files: { ...DEFAULT_FILES_SETTINGS },
  modules: {},
};

/** 지울 수 없는 상태예요. 마감 계산(남은 날 숨김)과 할 일 연동이 이것을 기준으로 해요. */
export const DONE_STATUS = "완료";

/** 답변기한에 답변한 상태예요(지울 수 없어요). */
export const ANSWER_STATUS = "답변";

/**
 * 법정 답변기한(마감일)이 끝난 상태: 답변·완료·보류·장기(2026-10-19 사용자 1안 — 보류·장기는 답변하면서 정하는 결과).
 * 이 상태면 마감일에 가운데 줄, 남은 날 배지 없음, 캘린더·업무일지 챙길 일에서 빠져요.
 */
export const ANSWERED_STATUSES = [ANSWER_STATUS, DONE_STATUS, "보류", "장기"];
export const isAnswered = (status: string) => ANSWERED_STATUSES.includes(status);

/**
 * 민원 상태는 고정 6개예요(2026-10-19 사용자 — 설정·분류 관리에서 바꾸지 않아요).
 * 법정 답변기한(마감일)과 실제 해소를 나눠요: 답변·완료·보류·장기는 "답변 끝남".
 */
export const STATUSES = ["접수", "진행", "답변", "완료", "보류", "장기"];

/** 예전 상태 이름 → 새 이름 (0.18.0까지 "처리중") */
export const STATUS_RENAME: Record<string, string> = { 처리중: "진행" };


/**
 * 상태 배지 색 — 신경 쓸 순서로 진하게(2026-10-19 사용자). 모양은 집행현황 단계 배지와 같아요.
 * 접수·진행·답변 = 따뜻한 색 진한 채움(노랑·자홍·주황 — 밝기도 달리) · 보류·장기 = 차가운 색 바탕(회색·하늘) · 완료 = 흐리게(줄 글자도 흐려요).
 */
export const STATUS_COLORS: Record<string, [string, string]> = {
  접수: ["var(--cs-new-bg)", "var(--cs-new-fg)"],
  진행: ["var(--cs-work-bg)", "var(--cs-work-fg)"],
  처리중: ["var(--cs-work-bg)", "var(--cs-work-fg)"],
  답변: ["var(--cs-reply-bg)", "var(--cs-reply-fg)"],
  보류: ["var(--cs-hold-bg)", "var(--cs-hold-fg)"],
  장기: ["var(--cs-long-bg)", "var(--cs-long-fg)"],
  완료: ["var(--cs-done-bg)", "var(--cs-done-fg)"],
};

/** 상태 배지 [바탕, 글자] 색 */
export const statusColor = (name: string): [string, string] => STATUS_COLORS[name] ?? ["var(--st-new-bg)", "var(--st-new-fg)"];

const KEY = "settings";

/** 업무일지의 고정 구분이에요. 지울 수 없고, 고르면 편집기로 적어요. */
export const MEMO_KIND: Kind = { name: "메모", key: "ㅁㅁ" };

/** 메모 구분이 없으면 맨 끝에 다시 넣어요. */
function withMemo(s: Settings): Settings {
  return s.kinds.some((k) => k.name === MEMO_KIND.name) ? s : { ...s, kinds: [...s.kinds, { ...MEMO_KIND }] };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await api.get(KEY);
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  try {
    const saved = JSON.parse(raw) as Partial<Settings>;
    saved.status = [...STATUSES];
    return withMemo({ ...structuredClone(DEFAULT_SETTINGS), ...saved, process: { ...DEFAULT_PROCESS, ...(saved.process ?? {}) }, files: { ...DEFAULT_FILES_SETTINGS, ...saved.files, dateFmt: dateFormatOf(saved.files?.dateFmt), treeHidden: saved.files?.treeHidden ?? saved.files?.hiddenDrives ?? [], cols: { ...DEFAULT_FILES_SETTINGS.cols, ...(saved.files?.cols ?? {}) } }, modules: { ...(saved.modules ?? {}) } });
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): Promise<null> {
  return api.set(KEY, JSON.stringify(s));
}
