// 화면 목록. 순서는 사이드바 순서예요(2026-10-17 사이드바 아이콘 확정).
// group: 같은 숫자끼리 묶고 묶음 사이에 희미한 선을 그어요. "bottom"은 아래쪽(설정 위)에 둬요.
export const SCREENS = [
  { id: "explorer", name: "탐색기", side: "탐색기", step: 11, group: 0 },
  { id: "complaints", name: "민원대장", side: "민원대장", step: 6, group: 1 },
  { id: "process", name: "민원처리", side: "민원처리", step: 10, group: 1 },
  { id: "calendar", name: "캘린더", side: "캘린더", step: 8, group: 2 },
  { id: "todo", name: "할 일 목록", side: "할 일", step: 7, group: 2 },
  { id: "journal", name: "업무일지", side: "업무일지", step: 5, group: 3 },
  { id: "contacts", name: "업무연락처", side: "업무연락처", step: 4, group: "bottom" },
] as const;

export const SETTINGS = { id: "settings", name: "설정", side: "설정", step: 3 } as const;

export type ScreenId = (typeof SCREENS)[number]["id"] | typeof SETTINGS.id;
