// 민원대장의 지역·위치 칸이에요(법정동 기준, 사용자가 정함 2026-10-16).
// - 지역 칸: 읍면동. 초성으로 쳐도 돼요(ㅈㄹ → 조리읍).
// - 위치 칸: 맨 앞에 법정리·동, 이어서 지번. 리·동을 고르면 지역에 읍면동이 자동으로 들어가요.
// 겹치면(2안): 첫 후보가 골라진 목록이 떠요. ↑↓로 바꾸고 Tab(또는 Enter)으로 확정해요.
//   지역 칸은 Tab 확정과 함께 다음 칸으로 가고, 위치 칸은 "봉일천리 "까지 채운 뒤 커서가 남아 지번을 이어 써요.
import { KeyboardEvent, Ref, useLayoutEffect, useRef, useState } from "react";
import { useJamoGuard } from "./koInput";
import { EMD, emdsOf, findNames, Place, PLACES, splitPlace } from "./paju";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/** 목록 위·아래 키를 공통으로 처리해요. 처리했으면 true예요. */
function moveKey(e: KeyboardEvent, n: number, hi: number, setHi: (i: number) => void) {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setHi((hi + 1) % n);
    return true;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    setHi(hi <= 0 ? n - 1 : hi - 1);
    return true;
  }
  return false;
}

// ---------- 지역 ----------

export function AreaInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const guard = useJamoGuard((v) => {
    onChange(v);
    setOpen(true);
    setHi(0);
  });
  guard.follow(value);

  const v = value.trim();
  const opts = v && !EMD.includes(v) ? findNames(v, EMD, (x) => x).slice(0, 12) : [];
  const show = open && opts.length > 0;

  function pick(x: string) {
    guard.sync(x);
    onChange(x);
    setOpen(false);
  }

  return (
    <div className="pin">
      <input
        name="area"
        aria-label="지역 (읍면동)"
        placeholder="읍면동"
        className="cell-input"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        value={value}
        onChange={guard.onChange}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={() => {
          setOpen(true);
          setHi(0);
        }}
        onBlur={() => {
          setOpen(false);
          // 하나뿐이면 떠날 때 채워요.
          if (opts.length === 1) pick(opts[0]);
        }}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e) || !show) return;
          if (moveKey(e, opts.length, hi, setHi)) return;
          if (e.key === "Tab" && !e.shiftKey) {
            // 확정하고 다음 칸으로 가요(기본 동작을 막지 않아요).
            pick(opts[hi] ?? opts[0]);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(opts[hi] ?? opts[0]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="pin-list" role="listbox">
          {opts.map((o, i) => (
            <div
              key={o}
              role="option"
              aria-selected={i === hi}
              className="pin-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o}
            </div>
          ))}
          {opts.length > 1 && <div className="pin-hint">↑↓ 고르기 · Tab 확정</div>}
        </div>
      )}
    </div>
  );
}

// ---------- 위치 ----------

/** 위치 후보: 같은 법정동이 여러 행정동에 걸치면 행정동마다 하나씩 보여요. */
function placeOptions(head: string): Place[] {
  if (!head) return [];
  const found = findNames(head, PLACES, (p) => p.name);
  // 이미 다 친 이름이고 읍면동이 하나뿐이면 고를 것이 없어요.
  if (found.length && found.every((p) => p.name === head) && found.length === 1) return [];
  return found.slice(0, 12);
}

export function PlaceInput({ value, onChange, onArea }: { value: string; onChange: (v: string) => void; onArea: (emd: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const guard = useJamoGuard((v) => {
    onChange(v);
    setOpen(true);
    setHi(0);
  });
  guard.follow(value);

  const { head, rest } = splitPlace(value);
  // 리·동 자리를 치는 동안(아직 띄어쓰기 전)만 목록을 보여요.
  const opts = rest === "" ? placeOptions(head) : [];
  const show = open && opts.length > 0;

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  /** 후보를 확정해요: "봉일천리 " + 이미 적은 지번, 지역에 읍면동 */
  function pick(p: Place, keepCaret = true) {
    const tail = rest.replace(/^\s+/, "");
    const next = p.name + " " + tail;
    guard.sync(next);
    if (keepCaret) caret.current = p.name.length + 1;
    onChange(next);
    onArea(p.emd);
    setOpen(false);
  }

  /** 다 쳐 놓고 고르지 않고 떠났을 때: 하나뿐이면 채우고, 이름이 맞으면 지역을 맞춰요. */
  function settle() {
    if (opts.length === 1) return pick(opts[0], false);
    const emds = emdsOf(head);
    if (emds.length === 1) onArea(emds[0]);
  }

  return (
    <div className="pin">
      <input
        ref={ref}
        name="place"
        aria-label="위치 (법정리·동과 지번)"
        placeholder="리·동 지번"
        className="cell-input"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        value={value}
        onChange={guard.onChange}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={() => {
          setOpen(true);
          setHi(0);
        }}
        onBlur={() => {
          setOpen(false);
          settle();
        }}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e)) return;
          if (!show) {
            // 고르지 않고 지번으로 넘어가려 띄어쓰기를 쳤을 때도 하나뿐이면 채워요.
            return;
          }
          if (moveKey(e, opts.length, hi, setHi)) return;
          if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
            // 확정하고 커서는 이 칸에 남아 지번을 이어 써요.
            e.preventDefault();
            pick(opts[hi] ?? opts[0]);
          } else if (e.key === " " && opts.length === 1) {
            e.preventDefault();
            pick(opts[0]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="pin-list" role="listbox">
          {opts.map((p, i) => (
            <div
              key={p.name + p.emd}
              role="option"
              aria-selected={i === hi}
              className="pin-opt pin-place"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span>{p.name}</span>
              <span className="pin-sub">{p.emd}</span>
            </div>
          ))}
          {opts.length > 1 && <div className="pin-hint">↑↓ 고르기 · Tab 확정</div>}
        </div>
      )}
    </div>
  );
}

// ---------- 목록에서만 고르는 칸 (접수유형, 상태) ----------

/**
 * 적는 칸 + 초성. 설정 목록에 있는 값만 받아요(사용자가 정함: 통계로 셀 값이라 갈라지면 안 돼요).
 * 목록에 없는 값이면 칸에 빨간 테두리가 둘러지고 등록·저장이 안 돼요(allow는 예전 기록의 값처럼 함께 받아 줄 값).
 * 겹치면 첫 후보가 골라진 목록, ↑↓로 바꾸고 Tab(또는 Enter)으로 확정해요.
 * stayOnTab이면 Tab으로 확정한 뒤 그 칸에 머물러요(줄의 마지막 칸이라 Tab이 곧 등록인 곳).
 */
export function ChoiceInput({
  name,
  label,
  value,
  options,
  allow,
  invalid,
  stayOnTab,
  onChange,
  inputRef,
}: {
  name: string;
  label: string;
  value: string;
  options: string[];
  allow?: string;
  invalid?: boolean;
  stayOnTab?: boolean;
  onChange: (v: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const guard = useJamoGuard((v) => {
    onChange(v);
    setOpen(true);
    setHi(0);
  });
  guard.follow(value);

  const all = allow && !options.includes(allow) ? [...options, allow] : options;
  const v = value.trim();
  const opts = v && all.includes(v) ? [] : v ? findNames(v, all, (x) => x).slice(0, 12) : all.slice(0, 12);
  const show = open && opts.length > 0;

  function pick(x: string) {
    guard.sync(x);
    onChange(x);
    setOpen(false);
  }

  return (
    <div className="pin">
      <input
        ref={inputRef}
        name={name}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={label}
        className={"cell-input" + (invalid ? " invalid" : "")}
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        value={value}
        onChange={guard.onChange}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={(e) => {
          e.currentTarget.select();
          setHi(0);
        }}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          // 하나뿐이면 떠날 때 채워요.
          if (v && !all.includes(v) && opts.length === 1) pick(opts[0]);
        }}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e)) return;
          if (!show) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
            return;
          }
          if (moveKey(e, opts.length, hi, setHi)) return;
          if (e.key === "Tab" && !e.shiftKey) {
            if (stayOnTab) e.preventDefault();
            pick(opts[hi] ?? opts[0]);
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(opts[hi] ?? opts[0]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="pin-list" role="listbox">
          {opts.map((o, i) => (
            <div
              key={o}
              role="option"
              aria-selected={i === hi}
              className="pin-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o}
            </div>
          ))}
          {opts.length > 1 && <div className="pin-hint">↑↓ 고르기 · Tab 확정</div>}
        </div>
      )}
    </div>
  );
}
