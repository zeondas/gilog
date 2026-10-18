// 화면 목록. 순서는 사이드바 순서예요(2026-10-17 사이드바 아이콘 확정).
// group: 같은 숫자끼리 묶고 묶음 사이에 희미한 선을 그어요. "bottom"은 아래쪽(설정 위)에 둬요.
export const SCREENS = [
  { id: "explorer", name: "탐색기", side: "탐색기", step: 11, group: 0 },
  { id: "complaints", name: "민원대장", side: "민원대장", step: 6, group: 1 },
  { id: "process", name: "민원처리", side: "민원처리", step: 10, group: 1 },
  // 예산 묶음(2026-10-18 사용자): 집행현황, 다음에 이월사업
  { id: "budget", name: "집행현황", side: "집행현황", step: 12, group: 4 },
  { id: "calendar", name: "캘린더", side: "캘린더", step: 8, group: 2 },
  { id: "todo", name: "할 일 목록", side: "할 일", step: 7, group: 2 },
  { id: "journal", name: "업무일지", side: "업무일지", step: 5, group: 3 },
  { id: "contacts", name: "업무연락처", side: "업무연락처", step: 4, group: "bottom" },
] as const;

export const SETTINGS = { id: "settings", name: "설정", side: "설정", step: 3 } as const;

export type ScreenId = (typeof SCREENS)[number]["id"] | typeof SETTINGS.id;

// ---------- 모듈 켜고 끄기 (2026-10-18 설정 세션, 사용자 확정 — 시안 Settings) ----------
// 끄기는 "메뉴 숨기기"예요(사용자 1안): 사이드바에서 빠지고 설정의 그 모듈 카드가 접힐 뿐, 자료와 다른 모듈의 연동은 그대로예요.

export type ModuleId = (typeof SCREENS)[number]["id"];
/** 암호화 파일 settings의 modules. false인 모듈만 꺼져 있어요(없는 모듈은 켜짐). */
export type Modules = Partial<Record<string, boolean>>;

export const isOn = (m: Modules, id: string) => m[id] !== false;

/** 켜 둔 화면만, 사이드바 순서로 */
export const onScreens = (m: Modules) => SCREENS.filter((s) => isOn(m, s.id));

/** 첫 켜진 화면. 하나는 늘 켜져 있지만, 혹시 모두 꺼졌으면 업무일지예요. */
export const firstOn = (m: Modules): ModuleId => onScreens(m)[0]?.id ?? "journal";

/** 모듈 카드의 한 줄 설명 */
export const MODULE_DESC: Record<ModuleId, string> = {
  explorer: "2창·4창 파일 관리, 일괄 이름 바꾸기",
  complaints: "민원 접수·처리 기록",
  process: "신문고 민원 → 지시부 → 폰으로 보내기",
  calendar: "일정·공휴일·알림",
  todo: "목록별 할 일·마감",
  journal: "누가 언제 무슨 말을 했는지",
  contacts: "사람·프로젝트 연락처",
};
