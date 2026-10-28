// "지울까요?" 붉은 띠 공통 부품(2026-10-21 공통 부품 세션 ✔2, docs/qa/parts.md 2-2절).
// 모양은 styles/*.css `.ask-band` 그대로 – 자리만 다른 화면 이름표(cm-ask·td-ask·dmenu-ask 등)는 className으로 붙여요.
// 단추 순서는 취소 · 지우기 고정, 열리면 취소에 커서, Esc는 띠만 접어요(감싼 카드·창·메뉴로 넘기지 않음).
// 바깥 누르기는 띠를 품은 쪽이 useOutsideClose로 정해요(띠만 접기 / 고친 것 저장).
import { useEffect, useRef } from "react";
import type { ReactNode, Ref } from "react";

type Props = {
  /** 물음 글 */
  text: ReactNode;
  /** 화면 읽기 프로그램용 이름 – 예: "민원 지우기 확인" */
  label: string;
  /** 지우기 단추 */
  onYes: () => void;
  /** 취소 단추·Esc */
  onNo: () => void;
  /** 지우기 단추 글(처음 값 "지우기") */
  yes?: string;
  /** 자리만 다른 화면 이름표 */
  className?: string;
  bandRef?: Ref<HTMLDivElement>;
  /** 물음 글 아래 줄 왼쪽에 넣을 것(민원대장 분류 합치기의 "합칠 값" 고르기 – 2026-10-28 ✔1). 있으면 띠가 두 줄이에요. */
  extra?: ReactNode;
  /** 지우기 단추를 아직 못 누름(흐리게) */
  yesDisabled?: boolean;
};

export function AskBand({ text, label, onYes, onNo, yes = "지우기", className, bandRef, extra, yesDisabled }: Props) {
  // autoFocus 대신 그린 뒤에 커서를 줘요 – 자리를 잰 뒤 보이는 떠 있는 상자(민원처리 공사 관리 ×)는 처음 그릴 때 숨겨져 있어 autoFocus가 빗나갔어요.
  const noRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = noRef.current;
    el?.focus({ preventScroll: true });
    if (el && document.activeElement === el) return;
    const id = requestAnimationFrame(() => noRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      ref={bandRef}
      className={"ask-band" + (extra ? " ask-two" : "") + (className ? " " + className : "")}
      role="alertdialog"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
        e.preventDefault();
        e.stopPropagation();
        onNo();
      }}
    >
      <span>{text}</span>
      {extra}
      <button ref={noRef} type="button" className="btn btn-xs" onClick={onNo}>
        취소
      </button>
      <button type="button" className="btn btn-xs btn-danger" disabled={yesDisabled} onClick={onYes}>
        {yes}
      </button>
    </div>
  );
}
