// 기록 로고 (docs/brand.md). brand/logo.svg의 그림을 그대로 옮기고 색은 토큰으로 써서 테마를 따라가요.
// 심볼·글자 ㄱ·L = --accent, ㅣ·O·G = --ink. 크기는 height 하나로 정하고 비율을 지켜요.

const SYMBOL = (
  <g transform="translate(0 -716) scale(12.4545) translate(-17 -17)">
    <path d="M17 17H83V58H69V31H17Z" fill="var(--accent)" />
    <path d="M17 42H31V69H83V83H17Z" fill="var(--accent)" />
  </g>
);

const WORD = (
  <g transform="translate(994 106) scale(0.97) translate(0 -106)">
    <path d="M70 -402L540 -402L540 106L420 106L420 -296L70 -296ZM960 -402L1080 -402L1080 0L1430 0L1430 106L960 106Z" fill="var(--accent)" />
    <path
      d="M690 -402L810 -402L810 106L690 106ZM1540 -402L2010 -402L2010 106L1540 106ZM1660 -296L1660 0L1890 0L1890 -296ZM2150 -402L2620 -402L2620 -296L2270 -296L2270 0L2500 0L2500 -75L2394 -75L2394 -181L2620 -181L2620 106L2150 106Z"
      fill="var(--ink)"
      fillRule="evenodd"
    />
  </g>
);

/** 보이는 범위: 기본형(심볼 + 글자), 글자만(ㄱㅣLOG), 심볼만 */
const BOX = {
  full: [0, -716, 3536, 822],
  word: [1062, -387, 2474, 493],
  symbol: [0, -716, 822, 822],
} as const;

export default function Logo({ height, variant = "full" }: { height: number; variant?: keyof typeof BOX }) {
  const [x, y, w, h] = BOX[variant];
  return (
    <svg className="logo" viewBox={`${x} ${y} ${w} ${h}`} height={height} width={(height * w) / h} role="img" aria-label="기록">
      {variant !== "word" && SYMBOL}
      {variant !== "symbol" && WORD}
    </svg>
  );
}

/** 앱 아이콘 — 잠금 화면·접힌 사이드바·설정 정보 카드. 강조색을 따라가요(2026-10-18 색 테마, 사용자).
 *  그림은 brand/app-icon.svg와 같고 색만 토큰이에요(창 아이콘·작업표시줄·설치 파일은 그 파일 그대로 보라):
 *  바탕 --icon-bg(밝게 강조색), ㄱ 흰색, L --icon-l(어둡게 강조색). 두 테마에서 같은 그림이에요. */
export function AppIcon({ size }: { size: number }) {
  return (
    <svg className="app-icon" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path d="M50 0C97.7 0 100 2.3 100 50C100 97.7 97.7 100 50 100C2.3 100 0 97.7 0 50C0 2.3 2.3 0 50 0Z" fill="var(--icon-bg)" />
      <g transform="translate(50 50) scale(0.667) translate(-50 -50)">
        <path d="M17 17H83V58H69V31H17Z" fill="#FFFFFF" />
        <path d="M17 42H31V69H83V83H17Z" fill="var(--icon-l)" />
      </g>
    </svg>
  );
}
