// 화면 목록. 순서는 사양서의 사이드바 순서와 같아요.
export const SCREENS = [
  { id: "journal", name: "업무일지", step: 5 },
  { id: "complaints", name: "민원대장", step: 6 },
  { id: "contacts", name: "업무연락처", step: 4 },
  { id: "calendar", name: "캘린더", step: 8 },
  { id: "todo", name: "할 일 목록", step: 7 },
] as const;

export const SETTINGS = { id: "settings", name: "설정", step: 3 } as const;

export type ScreenId = (typeof SCREENS)[number]["id"] | typeof SETTINGS.id;
