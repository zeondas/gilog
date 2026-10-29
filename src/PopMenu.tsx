// 떠 있는 메뉴 공통 부품(2026-10-26 공통 부품 ✔4·✔5, 결정 로그 10-21 14:58 · 시안 캔버스 MenuUnify).
// 모양: styles/*.css "떠 있는 메뉴 한 모양" – 바탕 --surface-raised · 그림자 --shadow-pop · 테두리 · 안쪽 4 · 모서리 8, 줄 30 · 글자 13 · 좌우 10.
// 동작: 그린 뒤 재서 화면 안 8px로 밀고, 아래가 모자라면 위로 열어요(upFrom이 있으면 그 줄 위로). 바깥 누르기·Esc·앱 창 밖으로 가면 닫혀요.
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useOutsideClose } from "./useOutsideClose";
import type { Inside } from "./useOutsideClose";

type Place = { left: number; top: number; visibility: "hidden" | "visible" };

/**
 * 메뉴 자리 정하기: (x, y)에 열되 화면 안 8px로 밀고, 아래가 모자라면 위로 – upFrom(여는 단추 위 끝)이 있으면 그 위로, 없으면 y 위로.
 * 안의 내용이 바뀌어 크기가 바뀌면(묻는 띠로 바뀔 때 등) 다시 재요.
 */
export function useMenuPlace(ref: RefObject<HTMLElement | null>, x: number, y: number, upFrom?: number): Place {
  const [p, setP] = useState<Place>({ left: x, top: y, visibility: "hidden" });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const left = Math.max(8, Math.min(x, vw - w - 8));
      let top = y;
      if (y + h + 8 > vh) top = (upFrom ?? y) - h;
      top = Math.max(8, Math.min(top, vh - h - 8));
      setP((o) => (o.left === left && o.top === top && o.visibility === "visible" ? o : { left, top, visibility: "visible" }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, x, y, upFrom]);
  return p;
}

/** 하위 메뉴(▸)가 오른쪽에 들어가지 않으면 왼쪽으로 – 부모 줄 기준으로 재요. 돌려주는 값이 true면 왼쪽. */
export function useSubSide(ref: RefObject<HTMLElement | null>, open: boolean): boolean {
  const [left, setLeft] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const host = el.parentElement?.getBoundingClientRect();
    if (!host) return;
    setLeft(host.right + el.offsetWidth + 8 > window.innerWidth);
  }, [ref, open]);
  return left;
}

export type PopMenuProps = {
  x: number;
  y: number;
  /** 아래가 모자랄 때 위로 열 기준(여는 단추 위 끝) */
  upFrom?: number;
  onClose: () => void;
  label?: string;
  /** 바탕 이름표 – 처음 값 "dmenu" */
  className?: string;
  /** 안쪽으로 칠 것(여는 단추 등 – 다시 누르면 화면이 닫기를 맡아요) */
  inside?: Inside[];
  /** 안쪽으로 칠 이름표(`closest`) */
  ignore?: string;
  /** Esc를 화면이 먼저 받아야 할 때 끔(묻는 띠 등은 안에서 받아요) */
  esc?: boolean;
  boxRef?: RefObject<HTMLDivElement>;
  style?: CSSProperties;
  children: ReactNode;
};

/** 떠 있는 메뉴 – 화면 어디서든 `position: fixed`로 (x, y)에 떠요. */
export function PopMenu({ x, y, upFrom, onClose, label, className = "dmenu", inside = [], ignore, esc = true, boxRef, style, children }: PopMenuProps) {
  const own = useRef<HTMLDivElement>(null);
  const ref = boxRef ?? own;
  const pos = useMenuPlace(ref, x, y, upFrom);
  useOutsideClose(true, [ref, ...inside], () => onClose(), {
    ignore,
    onBlur: () => onClose(),
    onEsc: esc
      ? (e) => {
          e.preventDefault();
          onClose();
        }
      : undefined,
  });
  return (
    <div ref={ref} className={className} role="menu" aria-label={label} style={{ position: "fixed", ...style, ...pos }} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

/**
 * CSS로 펼치는 하위 메뉴(마우스를 올리면 보이는 것) 자리 맞추기 – 마우스가 들어올 때 불러요.
 * 오른쪽에 들어가지 않으면 왼쪽으로(`flip`), 아래가 모자라면 그만큼 위로 올려요.
 */
export function fitSub(host: HTMLElement, selector = ":scope > .bd-sub") {
  requestAnimationFrame(() => {
    const sub = host.querySelector<HTMLElement>(selector);
    if (!sub || !sub.offsetWidth) return;
    sub.style.top = "";
    sub.classList.remove("flip");
    const r = host.getBoundingClientRect();
    const s = sub.getBoundingClientRect();
    sub.classList.toggle("flip", r.right + s.width + 12 > window.innerWidth);
    const over = s.bottom + 8 - window.innerHeight;
    if (over > 0) sub.style.top = `${sub.offsetTop - over}px`;
  });
}
