import { useId } from "react";

/** 휴지통 그림(2026-10-26 공통 부품 ✔6) – 채운 뚜껑·손잡이 + 몸통 안 × 비움. viewBox로 칸 가운데에 맞춰요. */
function TrashGlyph({ vb }: { vb: string }) {
  const id = "tk" + useId().replace(/:/g, "");
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox={vb}>
      <defs>
        <mask id={id}>
          <rect x="-2" y="-2" width="20" height="20" fill="white" />
          <path d="M5.4 7l3.2 3.2M8.6 7l-3.2 3.2" stroke="black" strokeWidth="1.3" strokeLinecap="square" />
        </mask>
      </defs>
      <path fill="currentColor" d="M5.2 1.5h3.6l.5 1H12.5v1.4h-11V2.5h3.2z" />
      <path fill="currentColor" mask={`url(#${id})`} d="M2.6 4.6h8.8v7.2a1.6 1.6 0 0 1-1.6 1.6H4.2a1.6 1.6 0 0 1-1.6-1.6z" />
    </svg>
  );
}

/** 지우기 표시: 붉은 스퀴클 네모 18 + 휴지통(그림 10px, 위아래 4·좌우 5). 누르는 칸(28)은 단추가 맡고 `del-hit`를 붙여요. */
export function DelMark() {
  return (
    <span className="del-mark" aria-hidden="true">
      <TrashGlyph vb="-1.4 -.9 16.8 16.8" />
    </span>
  );
}

/** 붉은 단추 안 휴지통(그림 12px) – 옆에 테두리 단추·칸이 있을 때 단추 자체를 붉게(`del-btn`). */
export function DelGlyph() {
  return (
    <span className="del-glyph" aria-hidden="true">
      <TrashGlyph vb="0 .5 14 14" />
    </span>
  );
}

/** 닫기 ×(창 닫기·빼기) – 지우기에는 쓰지 않아요. */
export function CloseIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** 사이드바 아이콘 (2026-10-17 확정, 시안 캔버스 SidebarIcons.dc.html) – 선 2px, 24 격자, 각진 모서리. */
const NAV_PATHS = {
  explorer: "M3 5h6l2 3h10v12H3z",
  complaints: "M3 4h18v16H3z M3 9h18 M3 14.5h18 M9 9v11",
  process: "M5 3h9l5 5v13H5z M14 3v5h5 M8.5 14.5l2.5 2.5 4.5-5",
  bstatus: "M9 8L7.5 3.5 10 5l2-1.5L14 5l2.5-1.5L15 8 M9 8h6 M9 8c-3.3 2.3-5 5.2-5 8.5 0 2.7 1.8 4.5 4.5 4.5h7c2.7 0 4.5-1.8 4.5-4.5 0-3.3-1.7-6.2-5-8.5", // 돈주머니 – 각진 귀 + 둥근 몸(예산현황, 2026-10-19 사용자 1안, 시안 BudgetStatusBag)
  budget: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M15 9.3c-.6-.8-1.7-1.3-3-1.3-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.3 0-2.4-.5-3-1.3 M12 6.5v11", // 동전 + $ (2026-10-19 사용자 R4, 시안 BudgetIconRef)
  calendar: "M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4 M7 14h2 M11 14h2 M15 14h2 M7 17.5h2 M11 17.5h2",
  todo: "M20 12v8H4V4h11 M8 11l4 4 9-10",
  journal: "M3 5h12 M3 10h9 M3 15h5 M12 21v-3l7-7 3 3-7 7z",
  contacts: "M12 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8z M4 21v-3l3-3h10l3 3v3",
  settings: "M4 6h16 M4 12h16 M4 18h16 M9 4v4 M15 10v4 M7 16v4",
  lock: "M5 11h14v10H5z M8 11V4h8v7 M12 15v2",
  fold: "M15 6l-6 6 6 6",
  unfold: "M9 6l6 6-6 6",
} as const;

export type NavIconName = keyof typeof NAV_PATHS;

export function NavIcon({ name, size }: { name: NavIconName; size: number }) {
  return (
    <svg className="nav-icon" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter">
      <path d={NAV_PATHS[name]} />
    </svg>
  );
}
