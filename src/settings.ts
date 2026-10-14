// 암호화된 자료 파일 안에 두는 설정이에요. (민원대장 항목, 업무일지 구분 등)
import { api } from "./api";

export type Kind = { name: string; key: string };

export type Settings = {
  status: string[];
  intake: string[];
  ctype: string[];
  myName: string;
  kinds: Kind[];
};

export const DEFAULT_SETTINGS: Settings = {
  status: ["접수", "처리중", "완료", "보류"],
  intake: ["전화", "방문", "국민신문고", "정보공개청구", "진정민원"],
  ctype: ["포트홀", "배수불량", "차선도색", "도로시설물", "보도 파손", "소음", "기타"],
  myName: "전훈민",
  kinds: [
    ["유선수신", "ㅇㅅ"], ["유선발신", "ㅇㅂ"], ["무선수신", "ㅁㅅ"], ["무선발신", "ㅁㅂ"],
    ["메일수신", "ㅁㅇㅅ"], ["메일발신", "ㅁㅇㅂ"], ["쪽지수신", "ㅉㅅ"], ["쪽지발신", "ㅉㅂ"],
    ["채팅수신", "ㅊㅅ"], ["채팅발신", "ㅊㅂ"], ["구두수신", "ㄱㅅ"], ["구두발신", "ㄱㅂ"],
    ["회의", "ㅎㅇ"], ["협의", "ㅎㅂ"], ["출장", "ㅊㅈ"], ["메모", "ㅁㅁ"],
  ].map(([name, key]) => ({ name, key })),
};

/** 상태 배지 색이에요. 여기 없는 상태는 연보라예요. */
export const STATUS_COLORS: Record<string, [string, string]> = {
  접수: ["var(--accent-tint)", "var(--accent)"],
  처리중: ["var(--st-work-bg)", "var(--st-work-fg)"],
  완료: ["var(--st-done-bg)", "var(--st-done-fg)"],
  보류: ["var(--st-hold-bg)", "var(--st-hold-fg)"],
};

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const raw = await api.get(KEY);
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  try {
    return { ...structuredClone(DEFAULT_SETTINGS), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): Promise<null> {
  return api.set(KEY, JSON.stringify(s));
}
