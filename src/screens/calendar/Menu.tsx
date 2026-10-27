// 캘린더 – 떠 있는 고르기 상자: 종류 고르기(KindPicker), 색 단추(ColorButton).
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useOutsideClose } from "../../useOutsideClose";
import { CalKind } from "../../api";
import { colorBg, colorFg, COLOR_NAMES, kindColor } from "../../calendar";

// ---------- 종류 고르기 ----------

/**
 * 캘린더 종류를 배지로 보여 주고 목록에서만 골라요(0.8.2 – 아무 글자나 치면 종류가 늘어나서).
 * 새 종류는 "관리" 창에서 만들어요. 키: Space·↓ 열기, ↑↓ 고르기, Enter·Tab 확정, Esc 닫기.
 * 닫혀 있을 때의 Enter·Tab은 감싼 줄이 받아요(빠른 입력은 등록, 상세 창은 저장).
 */
export function KindPicker({ kinds, value, onChange }: { kinds: CalKind[]; value: string; onChange: (name: string) => void }) {
  const mine = kinds.filter((k) => !k.system);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  /** 목록 자리(화면 기준). 창 안에서 잘리지 않게 화면에 띄워요. */
  const [at, setAt] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  const cur = mine.find((k) => k.name === value) ?? mine[0];
  useEffect(() => {
    if (cur && cur.name !== value) onChange(cur.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.name, value]);
  useOutsideClose(open, [box], () => setOpen(false));
  const show = () => {
    setHi(Math.max(0, mine.findIndex((k) => k.name === cur?.name)));
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const h = mine.length * 32 + 40;
      setAt(r.bottom + h + 8 > window.innerHeight ? { position: "fixed", left: r.left, minWidth: Math.max(180, r.width), bottom: window.innerHeight - r.top + 4, top: "auto" } : { position: "fixed", left: r.left, minWidth: Math.max(180, r.width), top: r.bottom + 4 });
    }
    setOpen(true);
  };
  const pick = (k: CalKind) => {
    onChange(k.name);
    setOpen(false);
  };
  const c = cur ? kindColor(cur, kinds) : 0;
  return (
    <div className="cal-kp" ref={box}>
      <button
        type="button"
        name="kind"
        className="cal-kp-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={"캘린더 종류: " + (cur?.name ?? "")}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (!open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " ") {
              e.preventDefault();
              show();
            }
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + mine.length) % mine.length);
          } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey) || e.key === " ") {
            e.preventDefault();
            if (mine[hi]) pick(mine[hi]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <span className="cal-kp-dot" aria-hidden="true" style={{ background: colorBg(c) }} />
        <span className="cal-kp-name">{cur?.name ?? "종류 없음"}</span>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="cal-kp-list" role="listbox" aria-label="캘린더 종류" style={at}>
          {mine.map((k, i) => {
            const kc = kindColor(k, kinds);
            return (
              <div
                key={k.id}
                role="option"
                aria-selected={i === hi}
                className="cal-kp-opt"
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(k);
                }}
              >
                <span className="cal-kp-dot" aria-hidden="true" style={{ background: colorBg(kc) }} />
                <span>{k.name}</span>
                {k.name === cur?.name && <span className="cal-kp-tick" aria-hidden="true">✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- 색 단추 ----------

/** 색 단추 하나. 누르면 24색과 "자동"(앱이 만든 종류는 "처음 색")이 펼쳐져요. */
export function ColorButton({ label, value, auto, autoLabel, onPick }: { label: string; value: number; auto: boolean; autoLabel: string; onPick: (i: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<CSSProperties>({});
  const box = useRef<HTMLDivElement>(null);
  useOutsideClose(open, [box], () => setOpen(false));
  const toggle = () => {
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const right = window.innerWidth - r.right;
      setAt(r.bottom + 170 > window.innerHeight ? { position: "fixed", right, bottom: window.innerHeight - r.top + 6, top: "auto" } : { position: "fixed", right, top: r.bottom + 6 });
    }
    setOpen((o) => !o);
  };
  const pick = (i: number | null) => {
    onPick(i);
    setOpen(false);
  };
  return (
    <div
      className="cal-cbtn-wrap"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          e.preventDefault();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="cal-cbtn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${label} 색: ${COLOR_NAMES[value]}${auto ? " (자동)" : ""} – 눌러서 바꾸기`}
        title={`${COLOR_NAMES[value]}${auto ? " (자동)" : ""}`}
        onClick={toggle}
        style={{ background: colorBg(value), color: colorFg(value) }}
      />
      {open && (
        <div className="cal-cpop" role="dialog" aria-label={label + " 색 고르기"} style={at}>
          <div className="cal-cgrid" role="radiogroup">
            {COLOR_NAMES.map((n, i) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={i === value}
                aria-label={n}
                title={n}
                className="swatch"
                style={{ background: colorBg(i), color: colorBg(i) }}
                onClick={() => pick(i)}
              />
            ))}
          </div>
          <button type="button" className="btn btn-xs cal-cauto" aria-pressed={auto} onClick={() => pick(null)}>
            {autoLabel}
          </button>
        </div>
      )}
    </div>
  );
}
