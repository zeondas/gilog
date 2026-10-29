// 작은 창 = 본문 가로 스크롤 (2026-10-26 창 크기 세션 – 사용자 ①3안·②2안·③2안·④1안·⑤1안, docs/qa/viewport.md).
// 창이 좁아져도 칸·열을 억지로 줄이지 않아요. 화면마다 아래 "최소 폭"(본문 안 폭, CSS px)이 있고,
// 본문이 그보다 좁으면 본문 영역(.main)만 가로로 스크롤해요. 사이드바는 그대로예요.
//
// 되돌리기: VIEWPORT_SCROLL을 false로 바꾸면 10-21 방식(열·칸이 창 폭을 따라 줄어듦)으로 돌아가요.
// 이 파일과 App.tsx의 `vp` 한 줄, styles/late.css "창 크기" 묶음만 이 기능이에요.

import type { ScreenId } from "./screens";

export const VIEWPORT_SCROLL = true;

/**
 * 화면마다 최소 폭(본문 안 폭). 기준 창 1600·화면 크기 13의 본문 안 폭은 1364예요.
 * 13에서 줄임말·겹침·칸 수 줄어듦이 처음 생기는 폭을 지킴이 흉내 자료로 재서 정했어요(2026-10-26).
 * 민원대장·민원처리는 글 길이에 따라 열 폭이 정해져 기준 폭(1364)을 그대로 써요.
 * 0이면 최소 폭 없음(창 최소 크기 1024에서도 줄임이 생기지 않는 화면).
 * 집행현황·예산현황은 표가 안에서 따로 스크롤하고, 최소 폭은 머리 줄만큼이에요(2026-10-29 집행현황 ✔2 – 검색 칸 120까지 줄인 머리 줄 750,
 * 팀 공유가 켜져 [새로고침]·"올림·받음"이 보이면 budget.css의 :has 줄이 250을 더해요).
 */
export const MIN_W: Record<ScreenId, number> = {
  // 탐색기는 창마다 목록이 가로로 밀려요(2026-10-28 탐색기 ✔1) – 본문 스크롤은 받침: 폴더트리 232 + 창 둘 300씩 + 사이 12×2
  explorer: 856,
  complaints: 1364,
  process: 1364,
  budget: 752,
  bstatus: 752,
  calendar: 1204,
  todo: 0,
  journal: 0,
  contacts: 1124,
  settings: 0,
};

export function minWidthOf(id: ScreenId | null): number {
  return VIEWPORT_SCROLL && id ? MIN_W[id] ?? 0 : 0;
}
