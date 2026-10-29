// 할 일 목록 – 목록 우클릭 메뉴(ListMenu).
import { PopMenu } from "../../PopMenu";
import { useEffect, useRef, useState } from "react";
import { TaskList } from "../../api";
import { AskBand } from "../../AskBand";
import { isComposing } from "./parts";

/** 목록 우클릭 메뉴. 지우기는 딸린 할 일 수를 알려 주고 한 번 더 물어요. Esc나 바깥을 누르면 닫혀요. */
export function ListMenu({
  list,
  x,
  y,
  mode,
  count,
  first,
  last,
  onMode,
  onClose,
  onMove,
  onRename,
  onDelete,
  deleteOnly,
}: {
  list: TaskList;
  x: number;
  y: number;
  mode: "menu" | "rename" | "ask";
  count: number;
  first: boolean;
  last: boolean;
  onMode: (m: "menu" | "rename" | "ask") => void;
  onClose: () => void;
  onMove: (dir: number) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** 카드 제목 줄 우클릭: 지우기만 보여요 */
  deleteOnly?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(list.name);
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(mode === "rename" ? "input" : mode === "ask" ? ".dmenu-ask .btn" : ".dmenu-item:not(:disabled)");
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [mode]);

  return (
    <PopMenu boxRef={box} x={x} y={y} onClose={onClose} label={`${list.name} 목록 메뉴`}>
      {mode === "menu" && (
        <>
          {!deleteOnly && (
            <>
              {!list.builtin && (
                <button type="button" role="menuitem" className="dmenu-item" onClick={() => onMode("rename")}>
                  이름 바꾸기
                </button>
              )}
              <button type="button" role="menuitem" className="dmenu-item" disabled={first} onClick={() => onMove(-1)}>
                위로 옮기기
              </button>
              <button type="button" role="menuitem" className="dmenu-item" disabled={last} onClick={() => onMove(1)}>
                아래로 옮기기
              </button>
            </>
          )}
          {list.builtin ? (
            <span className="dmenu-note">{deleteOnly ? "민원 목록은 지울 수 없어요." : "민원 목록은 지우거나 이름을 바꿀 수 없어요."}</span>
          ) : (
            <button type="button" role="menuitem" className="dmenu-item danger" onClick={() => onMode("ask")}>
              목록 지우기
            </button>
          )}
        </>
      )}
      {mode === "rename" && (
        <div className="td-rename">
          <input
            className="cell-input"
            aria-label="목록 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (isComposing(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                onRename(name);
              }
            }}
          />
          <button type="button" className="btn-primary btn-xs" onClick={() => onRename(name)}>
            바꾸기
          </button>
        </div>
      )}
      {mode === "ask" && (
        <AskBand
          className="dmenu-ask"
          label="목록 지우기 확인"
          text={<>{count ? `할 일 ${count}건이 들어 있어요. 목록과 함께 모두 지울까요?` : `"${list.name}" 목록을 지울까요?`} 되돌릴 수 없어요.</>}
          onNo={onClose}
          onYes={onDelete}
        />
      )}
    </PopMenu>
  );
}
