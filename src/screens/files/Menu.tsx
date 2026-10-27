// 탐색기 – 작은 고르기 메뉴(보기·정렬 등)와 탭 우클릭 메뉴.
import { useRef } from "react";
import { useMenuPlace } from "../../PopMenu";
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
