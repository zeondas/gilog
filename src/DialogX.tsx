// 창 닫기 × 공통 부품(2026-10-26 공통 부품 ✔7, 시안 캔버스 DialogClose·PjmHead).
// 모든 가운데 창의 위 오른쪽: 28×28 단추·그림 14·창 오른쪽 끝 12px·세로는 제목 줄 가운데.
// 창(.dialog 등) 바로 아래에 두면 머리 줄 오른쪽 52px를 비워요(app.css `.dlg-x`).
// 누르면 하는 일은 창이 정해요 – 묻는 창은 취소, 고친 것이 있는 창은 저장하고 닫기.
import { useLayoutEffect, useRef } from "react";
import { CloseIcon } from "./Icons";

export function DialogX({ onClick, label = "닫기", title, autoFocus }: { onClick: () => void; label?: string; title?: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const b = ref.current;
    const d = b?.parentElement;
    if (!b || !d) return;
    const place = () => {
      const t = d.querySelector<HTMLElement>(".dialog-title, [data-dialog-title], .xl-ask-title");
      if (!t) return;
      const dr = d.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      b.style.top = Math.round(tr.top + tr.height / 2 - dr.top - d.clientTop - 14) + "px";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(d);
    return () => ro.disconnect();
  }, []);
  return (
    <button ref={ref} type="button" className="dlg-x" aria-label={label} title={title ?? label} autoFocus={autoFocus} onClick={onClick}>
      <CloseIcon />
    </button>
  );
}
