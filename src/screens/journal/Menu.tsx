// 업무일지 메뉴 – 날짜 우클릭(DayMenu)·사업 고르기(ProjectMenu). 화면 몸통은 Screen.tsx.
import { PopMenu } from "../../PopMenu";
import { KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOutsideClose } from "../../useOutsideClose";
import { Project } from "../../api";
import { pjFull, projectColor } from "../../screens/contacts/parts";
import { koIndex } from "../../journal";
import { AskBand } from "../../AskBand";
import { Ctx } from "./parts";

/** 날짜 우클릭 메뉴. 지우기는 한 번 더 물어요(삭제 규칙). Esc나 바깥을 누르면 지우지 않고 닫혀요. */
export function DayMenu({
  date,
  x,
  y,
  ask,
  count,
  head,
  onClose,
  onOpen,
  onAsk,
  onDelete,
}: {
  date: string;
  x: number;
  y: number;
  ask: boolean;
  count: number;
  head: boolean;
  onClose: () => void;
  onOpen: () => void;
  onAsk: () => void;
  onDelete: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // 메뉴가 열리면 첫 항목(묻는 중이면 취소)에 커서를 둬요.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(ask ? ".dmenu-ask .btn" : ".dmenu-item")?.focus();
  }, [ask]);

  const [, m, d] = date.split("-").map(Number);
  const what = [count ? `기록 ${count}건` : "", head ? "출근·교통·날씨·비고" : ""].filter(Boolean).join("과 ");
  return (
    <PopMenu boxRef={box} x={x} y={y} onClose={onClose} label={`${m}월 ${d}일 메뉴`}>
      {!ask ? (
        <>
          <button type="button" role="menuitem" className="dmenu-item" onClick={onOpen}>
            이 날 열기
          </button>
          <button type="button" role="menuitem" className="dmenu-item danger" onClick={onAsk} disabled={!count && !head}>
            이 날 일지 지우기
          </button>
        </>
      ) : (
        <AskBand
          className="dmenu-ask"
          label="이 날 일지 지우기 확인"
          text={
            <>
              {m}월 {d}일 {what || "일지"}{head || !what ? "를" : "을"} 모두 지울까요? 되돌릴 수 없어요.
            </>
          }
          onNo={onClose}
          onYes={onDelete}
        />
      )}
    </PopMenu>
  );
}

/**
 * 사업(프로젝트)을 고르는 작은 목록(2026-10-25 사용자 ③): 맨 위 검색 칸(초성·정식/줄인 이름), 전체 사업 이름 순 + 줄인 이름,
 * 길면 안에서 스크롤. 카드 테두리에 잘리지 않게 화면 위에 띄워요(예전엔 카드 안에 떠서 아래가 잘려 일부만 보였어요).
 */
export function ProjectMenu({ ctx, current, onPick, onClose }: { ctx: Ctx; current: number | null; onPick: (id: number | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  // 사업 배지를 다시 누르는 것은 배지가 닫아요. 그 밖을 누르면 여기서 닫아요.
  useOutsideClose(true, [ref, () => anchor.current?.parentElement], () => onClose());
  // 놓을 자리: 배지 아래(모자라면 위), 화면 안 8px.
  useLayoutEffect(() => {
    const wrap = anchor.current?.parentElement;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const W = 260;
    const H = 230;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    const up = r.bottom + 4 + H > window.innerHeight - 8 && r.top - 4 - H > 8;
    setPos({ left, top: up ? r.top - 4 : r.bottom + 4, up });
  }, []);
  // 자리를 잡아 보이게 된 뒤 검색 칸에 커서를 둬요(숨긴 동안에는 커서가 들어가지 않아요).
  useEffect(() => {
    if (pos) inputRef.current?.focus();
  }, [pos]);
  // 목록이 스크롤되거나 창 크기가 바뀌면 자리가 어긋나니 닫아요.
  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const query = q.trim();
  const list = [...ctx.projects]
    .filter((p) => !query || koIndex(p.name, query) >= 0 || (!!p.alias && koIndex(p.alias, query) >= 0))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const opts: (Project | null)[] = query ? list : [null, ...list];
  const at = Math.min(hi, Math.max(0, opts.length - 1));

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    // 카드의 키(등록·취소)로 가지 않게 여기서 끝내요.
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi(Math.min(at + 1, opts.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi(Math.max(at - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (opts.length) onPick(opts[at]?.id ?? null);
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  }

  const menu = (
    <div
      ref={ref}
      className={"jmenu jmenu-pop" + (pos?.up ? " up" : "")}
      role="dialog"
      aria-label="사업 고르기"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="cell-input jmenu-q"
        aria-label="사업 검색"
        placeholder="사업 이름으로 검색 (초성도 돼요)"
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onKeyDown={onKey}
      />
      <div className="jmenu-list" role="listbox" aria-label="사업">
        {opts.map((p, i) => (
          <button
            key={p?.id ?? 0}
            type="button"
            role="option"
            data-i={i}
            className={"jmenu-opt" + (i === at ? " hi" : "")}
            aria-selected={(p?.id ?? null) === current}
            aria-pressed={(p?.id ?? null) === current}
            onMouseEnter={() => setHi(i)}
            onClick={() => onPick(p?.id ?? null)}
          >
            <span className="jmenu-dot" aria-hidden="true" style={{ background: p ? `var(--pj-${projectColor(p)}-line)` : "var(--line)" }} />
            <span className="pbadge-t jmenu-name" title={p ? pjFull(p) : undefined}>{p ? p.name : "없음"}</span>
            {p?.alias && <span className="jmenu-alias">{p.alias}</span>}
          </button>
        ))}
        {query && opts.length === 0 && <div className="hint jmenu-hint">맞는 사업이 없어요</div>}
      </div>
      {ctx.projects.length === 0 && <div className="hint jmenu-hint">사업은 업무연락처의 "사업 관리"에서 만들어요.</div>}
    </div>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {createPortal(menu, document.body)}
    </>
  );
}
