// 민원대장 – 열 제목·보기 줄 우클릭 메뉴(HeadMenu·RowMenu)와 열 거르기 상자(FilterMenu).
import { PopMenu } from "../../PopMenu";
import { useEffect, useRef, useState } from "react";
import { useOutsideClose } from "../../useOutsideClose";
import { Complaint } from "../../api";
import { FilterKey } from "../../complaints";
import { copyText } from "../../ContactsScreen";
import { koIndex } from "../../journal";
import { useJamoGuard } from "../../koInput";
import { SearchBox } from "../../SearchBox";
import { FILTER_LABEL } from "./parts";

/** 열 제목 줄 우클릭 메뉴 */
export function HeadMenu({ x, y, onClose, onReset }: { x: number; y: number; onClose: () => void; onReset: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(".dmenu-item")?.focus();
  }, []);
  return (
    <PopMenu boxRef={box} x={x} y={y} onClose={onClose} label="열 제목 메뉴">
      <button type="button" role="menuitem" className="dmenu-item" onClick={onReset}>
        열 너비 초기화
      </button>
    </PopMenu>
  );
}

/** 보기 줄 우클릭 메뉴(2026-10-21 사용자, 시안 ComplaintMenu.dc.html) – 공통 "떠 있는 메뉴" 모양.
 *  지우기는 메뉴가 그 자리에서 붉은 띠로 바뀌어요(업무일지 날짜 메뉴·민원처리와 같은 방식). */
export function RowMenu({
  no,
  x,
  y,
  ask,
  place,
  person,
  onClose,
  onEdit,
  onAsk,
  onDelete,
}: {
  no: number;
  x: number;
  y: number;
  ask: boolean;
  /** 위치(리·동 지번) – 복사 */
  place: string;
  /** 민원인 – 복사 */
  person: string;
  onClose: () => void;
  onEdit: () => void;
  onAsk: () => void;
  onDelete: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(ask ? ".ask-band .btn" : ".dmenu-item:not(:disabled)")?.focus();
  }, [ask]);
  return (
    <PopMenu boxRef={box} x={x} y={y} onClose={onClose} className="dmenu cm-rowmenu" label={`${no}번 민원`}>
      {!ask ? (
        <>
          <button type="button" role="menuitem" className="dmenu-item" onClick={onEdit}>
            고치기
          </button>
          {/* 위치·민원인 복사는 우클릭으로(2026-10-25 사용자 ⑨1안 – 한 번 누르기 복사는 없앰). 위로·아래로 옮기기는 연번 자동이라 뺌(②1안). */}
          <button type="button" role="menuitem" className="dmenu-item" disabled={!place} onClick={() => (onClose(), void copyText(place))}>
            위치 복사
          </button>
          <button type="button" role="menuitem" className="dmenu-item" disabled={!person} onClick={() => (onClose(), void copyText(person))}>
            민원인 복사
          </button>
          <div className="dmenu-sep" />
          <button type="button" role="menuitem" className="dmenu-item danger" onClick={onAsk}>
            지우기
          </button>
        </>
      ) : (
        <div className="ask-band dmenu-ask" role="alertdialog" aria-label="민원 지우기 확인">
          <span>{no}번 민원을 지울까요? 메모도 함께 지워져요.</span>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-xs btn-danger" onClick={onDelete}>
            지우기
          </button>
        </div>
      )}
    </PopMenu>
  );
}

/**
 * 열 필터 목록(엑셀 필터처럼): 모두, 값마다 체크 + 다른 필터를 건 뒤의 개수(0은 회색), 찾기 칸(상태는 없음),
 * 바로 적용, "필터 풀기"·"닫기", Esc 닫기, 바깥을 누르기 시작하면 닫기.
 */
export function FilterMenu({
  k,
  values,
  pool,
  sel,
  onChange,
  onClose,
}: {
  k: FilterKey;
  values: string[];
  /** 이 열만 뺀 나머지 필터·검색을 건 민원 (개수) */
  pool: Complaint[];
  sel: string[] | null;
  onChange: (v: string[] | null) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fq, setFq] = useState("");
  const guard = useJamoGuard(setFq);
  // 같은 열 제목 단추는 그 단추가 여닫아요.
  useOutsideClose(true, [box], () => onClose(), {
    ignore: ".cm-hbtn[aria-expanded='true']",
    onEsc: (e) => {
      if (e.isComposing) return;
      e.preventDefault();
      onClose();
    },
  });

  const count = (v: string) => pool.filter((c) => c[k] === v).length;
  const vals = k === "status" ? values : values.slice().sort((a, b) => count(b) - count(a) || (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ko")));
  const label = (v: string) => (v === "" ? "(빈 칸)" : v);
  const qq = fq.trim().toLowerCase();
  const opts = vals.filter((v) => !qq || label(v).toLowerCase().includes(qq) || koIndex(label(v), qq) >= 0);
  const isOn = (v: string) => sel === null || sel.includes(v);
  const some = sel === null || sel.length > 0;

  return (
    <div ref={box} className={"cm-fdd" + (k === "status" ? " end" : "")} role="dialog" aria-label={FILTER_LABEL[k] + " 거르기"} onContextMenu={(e) => e.stopPropagation()}>
      <div className="cm-fdd-head">
        <span>{FILTER_LABEL[k]}</span>
        <span className="cm-fdd-sub">{sel === null ? "모두 보는 중" : `${sel.length}개 고름`}</span>
      </div>
      {k !== "status" && (
        <SearchBox
          className="cm-fdd-search"
          iconSize={14}
          aria-label="값 찾기"
          placeholder={k === "area" ? "읍면동 찾기" : "찾기"}
          value={fq}
          autoFocus
          onClear={() => setFq("")}
          onKeyDown={guard.onKeyDown}
          onChange={guard.onChange}
          onCompositionEnd={guard.onCompositionEnd}
        />
      )}
      <div className="cm-fdd-list" role="group" aria-label="값 목록">
        <button type="button" role="menuitemcheckbox" aria-checked={sel === null} className="cm-fdd-opt all" onClick={() => onChange(sel === null ? [] : null)}>
          <Check on={some} partial={sel !== null && sel.length > 0} />
          <span className="cm-fdd-name">모두</span>
        </button>
        {opts.map((v) => {
          const on = isOn(v);
          const n = count(v);
          return (
            <button
              key={v}
              type="button"
              role="menuitemcheckbox"
              aria-checked={on}
              className={"cm-fdd-opt" + (n ? "" : " zero")}
              onClick={() => {
                const cur = sel === null ? values.slice() : sel.slice();
                onChange(on ? cur.filter((x) => x !== v) : [...cur, v]);
              }}
            >
              <Check on={on} />
              <span className="cm-fdd-name">{label(v)}</span>
              <span className="cm-fdd-n">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="cm-fdd-foot">
        <button type="button" className="cm-fdd-clear" onClick={() => onChange(null)}>
          필터 풀기
        </button>
        <button type="button" className="btn btn-xs" onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

function Check({ on, partial }: { on: boolean; partial?: boolean }) {
  return (
    <span className={"cm-ck" + (on ? " on" : "")} aria-hidden="true">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={partial ? "M6 12h12" : "M5 12.5l4.5 4.5L19 7.5"} />
      </svg>
    </span>
  );
}
