// 탐색기 – 작은 고르기 메뉴(보기·정렬 등)와 탭 우클릭 메뉴.
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { PopMenu, useMenuPlace } from "../../PopMenu";
import { Pop, RTab } from "./parts";

/** 작은 고르기 메뉴 – 자리는 공통 메뉴 규칙(useMenuPlace: 화면 안 8px, 아래가 모자라면 위로) */
export function PickMenu({ pop, onClose }: { pop: Pop; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useMenuPlace(ref, pop.x, pop.y);
  const checks = pop.items.some((it) => it !== "-" && it.checked !== undefined);
  return (
    <div ref={ref} className={pop.scroll ? "fx-menu fx-tabmenu fx-pop fx-pop-scroll" : "fx-menu fx-tabmenu fx-pop"} role="menu" style={pos}>
      {pop.items.map((it, i) =>
        it === "-" ? (
          <div key={i} className="fx-sep" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="fx-mi"
            data-b={it.bold ? "1" : "0"}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              pop.onPick(it.id);
            }}
          >
            {checks && <span className="fx-check">{it.checked ? "✓" : ""}</span>}
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

export function TabMenu({ x, y, tab, canClose, onAction }: { x: number; y: number; tab: RTab; canClose: boolean; onAction: (a: "pin" | "dup" | "other" | "close" | "others") => void }) {
  // 탭 메뉴 잘림 막기(✔5): 공통 메뉴 자리 규칙
  const ref = useRef<HTMLDivElement>(null);
  const pos = useMenuPlace(ref, x, y);
  return (
    <div ref={ref} className="fx-menu fx-tabmenu" role="menu" style={pos}>
      {!tab.find && (
        <button type="button" className="fx-mi" onClick={() => onAction("pin")}>
          {tab.pinned ? "고정 풀기" : "고정"}
        </button>
      )}
      <button type="button" className="fx-mi" onClick={() => onAction("dup")}>
        복제
      </button>
      <button type="button" className="fx-mi" onClick={() => onAction("other")}>
        반대 창에 열기
      </button>
      <div className="fx-sep" />
      {!tab.pinned && canClose && (
        <button type="button" className="fx-mi" onClick={() => onAction("close")}>
          닫기<span className="fx-k">Ctrl+W</span>
        </button>
      )}
      <button type="button" className="fx-mi" onClick={() => onAction("others")}>
        다른 탭 모두 닫기
      </button>
    </div>
  );
}

/** 단축키 상자(2026-10-28 탐색기 ✔2 – 아래 단축키 줄 대신 머리 줄 ⓘ). 떠 있는 메뉴와 같은 모양, ⓘ 오른쪽 끝에 맞춰 아래로 열려요. */
export const KEY_HELP: [string, string][] = [
  ["F2", "이름 바꾸기"],
  ["F3", "열기"],
  ["F5", "복사 → 대상"],
  ["F6", "옮기기 → 대상"],
  ["F7", "새 폴더"],
  ["F8", "지우기"],
  ["Ctrl+C·X·V", "복사·잘라내기·붙이기"],
  ["Space", "고르기"],
  ["Tab", "반대 창 (세칸·네칸은 다음 창)"],
  ["Ctrl+1~4", "창 고르기 (세칸·네칸)"],
  ["Ctrl+E", "윈도우 탐색기로"],
  ["Backspace", "위 폴더"],
  ["글자 키", "빠른 필터"],
  ["F1", "이 상자 열기·닫기"],
];
export function KeyHelp({ anchor, onClose, onEnter, onLeave }: { anchor: RefObject<HTMLButtonElement>; onClose: () => void; onEnter: () => void; onLeave: () => void }) {
  const r = anchor.current?.getBoundingClientRect();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => setW(box.current?.offsetWidth ?? 0), []);
  return (
    <PopMenu x={r ? r.right - w : 0} y={r ? r.bottom + 6 : 0} onClose={onClose} label="단축키" className="dmenu fx-keyhelp" inside={[anchor]} boxRef={box}>
      <div className="fx-kh" onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <div className="fx-kh-title">단축키</div>
        {KEY_HELP.map(([k, v]) => (
          <div key={k} className="fx-kh-row">
            <b>{k}</b>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </PopMenu>
  );
}
