// 업무연락처 메뉴 – 사업 줄 우클릭(PjMenu)·작은 우클릭 메뉴(CtxMenu). 화면 몸통은 Screen.tsx.
import { PopMenu } from "../../PopMenu";
import { useRef, useState } from "react";
import { useOutsideClose } from "../../useOutsideClose";
import { ProjectGroup } from "../../api";

/** 사업 줄 우클릭 메뉴: 수정 · 그룹 변경 ▸ · 지우기 */
export function PjMenu({
  x,
  y,
  groups,
  current,
  onEdit,
  onGroup,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  groups: ProjectGroup[];
  current: number | null;
  onEdit: () => void;
  onGroup: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const subBtn = useRef<HTMLButtonElement>(null);
  const [sub, setSub] = useState(false);
  // 바깥 누르기·창 밖은 PopMenu가, Esc는 여기서(하위 메뉴가 열려 있으면 하위만 닫아요).
  useOutsideClose(true, [ref], () => onClose(), {
    escCapture: true,
    onEsc: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (sub) {
        setSub(false);
        subBtn.current?.focus();
      } else onClose();
    },
  });
  const pick = (f: () => void) => () => {
    onClose();
    f();
  };
  const opts: { id: number | null; name: string }[] = [...groups.map((g) => ({ id: g.id, name: g.name })), { id: null, name: "그룹 없음" }];
  // 하위 메뉴가 화면 오른쪽에 걸리면 왼쪽으로 열어요.
  const left = sub && (ref.current?.getBoundingClientRect().right ?? 0) + 4 + 200 > window.innerWidth;
  return (
    <PopMenu boxRef={ref} x={x} y={y} onClose={onClose} esc={false} className="dmenu pjm-menu">
      <button type="button" role="menuitem" className="dmenu-item" autoFocus onMouseEnter={() => setSub(false)} onClick={pick(onEdit)}>
        수정
      </button>
      <button
        ref={subBtn}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={sub}
        className={"dmenu-item pjm-menu-sub" + (sub ? " on" : "")}
        onMouseEnter={() => setSub(true)}
        onClick={() => setSub(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "Enter") {
            e.preventDefault();
            setSub(true);
            requestAnimationFrame(() => (ref.current?.querySelector(".pjm-submenu .dmenu-item:not(:disabled)") as HTMLElement | null)?.focus());
          }
        }}
      >
        그룹 변경
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <div className="dmenu-sep" role="separator" />
      <button type="button" role="menuitem" className="dmenu-item danger" onMouseEnter={() => setSub(false)} onClick={pick(onDelete)}>
        지우기
      </button>
      {sub && (
        <div className={"dmenu pjm-submenu" + (left ? " pjm-submenu-l" : "")} role="menu" aria-label="그룹 변경">
          {opts.map((o) => (
            <button
              key={o.id ?? "none"}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === current}
              className={"dmenu-item pjm-gopt" + (o.id === null ? " pjm-gnone" : "")}
              disabled={o.id === current}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  setSub(false);
                  subBtn.current?.focus();
                }
              }}
              onClick={pick(() => onGroup(o.id === null ? "" : o.name))}
            >
              <span className="pjm-gcheck" aria-hidden="true">
                {o.id === current ? "✓" : ""}
              </span>
              {o.name}
            </button>
          ))}
          {groups.length === 0 && <p className="dmenu-note">그룹은 위 그룹 칸에 이름을 적어 만들어요.</p>}
        </div>
      )}
    </PopMenu>
  );
}

/** 작은 우클릭 메뉴(화면 기준 자리). 바깥을 누르거나 Esc면 닫혀요. */
export function CtxMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(true, [ref], () => onClose(), {
    escCapture: true,
    onEsc: (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    },
  });
  return (
    <PopMenu boxRef={ref} x={x} y={y} onClose={onClose} esc={false}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={"dmenu-item" + (it.danger ? " danger" : "")}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.label}
        </button>
      ))}
    </PopMenu>
  );
}
