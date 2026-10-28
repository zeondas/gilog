// 표 열 폭 끌기 공통 부품(정리 ⑥, 2026-10-28 사용자 1안).
// 여섯 곳(민원대장·민원처리·집행현황·예산현황 표, 업무연락처 사업 관리 창, 예산현황으로 보내기 창)이
// 똑같이 하던 "마우스 누름 → 움직임 → 뗌" 처리와 "칸을 복사해 내용 폭 재기"만 여기에 둬요.
// 저장 키·저장 모양·최소/최대 폭·두 번 누르기·배치최적화·고정 열은 화면마다 다르니 그 화면에 남겨요.

export type ColDrag = {
  /** 끌기 시작할 때의 폭 */
  base: number;
  /** 가장 좁게(없으면 제한 없음) */
  min?: number;
  /** 가장 넓게(없으면 제한 없음) */
  max?: number;
  /** 마우스가 움직인 만큼에 곱하는 값 – 가운데 놓인 창은 2(양쪽이 함께 늘어요), 왼쪽 가장자리는 -2 */
  scale?: number;
  /** 폭을 정수로 맞출지(처음 값 맞춤) */
  round?: boolean;
  /** 끄는 동안 body에 붙일 클래스(커서 모양 – 민원대장·민원처리 `col-dragging`, 사업 관리 창 `ew-dragging`) */
  bodyClass?: string;
  /** 끄는 동안 `.drag`를 붙일 손잡이(집행현황·예산현황·보내기 창) */
  grip?: HTMLElement;
  /** 마우스를 어디서 들을지 – 민원대장·민원처리는 document, 나머지는 window(처음 동작 그대로) */
  on?: "document" | "window";
  /** 움직일 때마다 새 폭 */
  onMove: (px: number) => void;
  /** 뗄 때 – 한 번도 움직이지 않았으면 null */
  onEnd?: (px: number | null) => void;
};

/** 열 폭 끌기를 시작해요(손잡이의 onMouseDown에서 불러요). */
export function startColDrag(e: { clientX: number; preventDefault: () => void }, o: ColDrag): void {
  e.preventDefault();
  const x0 = e.clientX;
  const { base, min = -Infinity, max = Infinity, scale = 1, round = true } = o;
  const t: Document | Window = o.on === "document" ? document : window;
  let last: number | null = null;
  const move = (ev: Event) => {
    const raw = base + ((ev as MouseEvent).clientX - x0) * scale;
    last = Math.min(max, Math.max(min, round ? Math.round(raw) : raw));
    o.onMove(last);
  };
  const up = () => {
    o.grip?.classList.remove("drag");
    t.removeEventListener("mousemove", move);
    t.removeEventListener("mouseup", up);
    if (o.bodyClass) document.body.classList.remove(o.bodyClass);
    o.onEnd?.(last);
  };
  o.grip?.classList.add("drag");
  if (o.bodyClass) document.body.classList.add(o.bodyClass);
  t.addEventListener("mousemove", move);
  t.addEventListener("mouseup", up);
}

/** 칸을 복사해 폭 제한 없이 놓고 잰 내용 폭(손잡이는 빼고) – 집행현황·예산현황의 두 번 누르기·배치최적화 */
export function contentWidth(el: HTMLElement, grip = ".bd-grip"): number {
  const c = el.cloneNode(true) as HTMLElement;
  c.style.cssText += ";position:absolute;left:0;top:0;visibility:hidden;width:max-content;min-width:0;max-width:none";
  c.querySelectorAll(grip).forEach((g) => g.remove());
  el.before(c);
  const w = c.getBoundingClientRect().width;
  c.remove();
  return Math.ceil(w);
}
