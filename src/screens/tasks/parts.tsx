// 할 일 목록 – 조각끼리 함께 쓰는 작은 도우미(한글 조합 확인·체크·+ 그림).
import { KeyboardEvent } from "react";

export const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

// ---------- 아이콘 ----------

/** 체크 표시. 목록 줄의 체크 상자에는 늘 그려 두고, 체크 전엔 감췄다가 마우스를 올리면 연하게 미리 보여요(styles/*.css `.td-tick`). */
export function Tick() {
  return (
    <svg className="td-tick" aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function Plus({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
