// 도로명주소 → 법정동 지번 (2026-10-18 사용자, 주소 변환 세션).
// 바꾸는 일은 core `address.rs`가 해요(브라우저 미리 보기도 같은 core – 2026-10-30 ②-3 2차). 여기는 화면이 쓰는 모양·지역 고르기예요.

/** 바꾼 결과 하나 (core RoadHit) */
export type RoadHit = {
  /** 위치 칸 글 "봉일천리 5-31" */
  place: string;
  /** 리·동 이름 */
  name: string;
  /** 지역 칸 후보(하나면 바로, 여럿이면 고르기) */
  areas: string[];
  bldg: string;
  /** 표의 도로명주소 "금정로 20" */
  road: string;
};

export type RoadLookup =
  | { kind: "none" }
  | { kind: "exact"; hit: RoadHit; original: string }
  | { kind: "cands"; list: RoadHit[]; original: string };

/** 도로명주소처럼 보이는지(○○로/○○길 + 번호). 맞을 때만 앱에 물어요. */
export const looksRoad = (s: string) => /[가-힣0-9](로|길)\s*(지하\s*)?\d/.test(s);

/** 지역 칸: 후보가 하나면 그것, 지금 지역이 후보 안에 있으면 그대로, 아니면 비워요(화면이 고르게 해요). */
export function areaFor(hit: RoadHit, now: string): string {
  if (hit.areas.length === 1) return hit.areas[0];
  return hit.areas.includes(now) ? now : "";
}
