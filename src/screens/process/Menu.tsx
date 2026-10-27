// 민원처리 – 떠 있는 상자(Floating): ⋯·우클릭 메뉴, 묻는 띠, 보낸 증거 카드, 고르기 목록을 화면 기준으로 띄워요(표가 스크롤돼도 잘리지 않게).
import { createPortal } from "react-dom";
import { CSSProperties, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useOutsideClose } from "../../useOutsideClose";

// ---------- 화면 기준으로 띄우는 상자 (표가 스크롤돼도 잘리지 않게) ----------

export function Floating({ rect, align, onClose, menu, children }: { rect: DOMRect; align: "left" | "right"; onClose: () => void; /** 떠 있는 메뉴(✔5): 앱 창 밖으로 가면 닫혀요 */ menu?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const below = rect.bottom + 6 + h <= window.innerHeight - 8;
    const top = below ? rect.bottom + 6 : rect.top - 6 - h;
    const left = align === "left" ? rect.left : rect.right - w;
    setPos({ top: Math.round(top), left: Math.round(Math.max(8, Math.min(left, window.innerWidth - w - 8))) });
  }, [rect, align]);
  // 띄운 그 누르기가 바로 닫지 않게 한 박자 뒤에 들어요.
  // Esc도 닫아요(떠 있는 메뉴 공통 규칙 ✔5 – 열 제목 메뉴는 Esc가 없었어요).
  useOutsideClose(true, [ref], () => onClose(), {
    on: "window",
    defer: true,
    onBlur: menu ? () => onClose() : undefined,
    onEsc: (e) => {
      if (e.isComposing) return;
      e.preventDefault();
      onClose();
    },
  });
  // 화면 맨 위(body)에 띄워요 – 가운데 뜨는 창(.overlay) 안에 두면 창 자리 맞추기(snap.ts)가 이 상자까지 옮겨 화면 밖으로 밀려났어요(2026-10-19 공사 지우기 버그).
  return createPortal(
    <div ref={ref} className="pr-float" style={pos} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}
