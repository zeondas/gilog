// 민원처리 – 표: 열 제목 줄(HeadRow)·위치 칸(PlaceCell)·고려사항 칸(NoteCell)·사진 줄(PhotoStrip)·공사 칩(WorkTag)·진행 게이지(Gauge)·증거 카드 줄(ProofRow). 화면 몸통은 Screen.tsx.
import { createPortal } from "react-dom";
import { CSSProperties, MouseEvent as ReactMouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Case, ContactsData, Work } from "../../api";
import type { ColHead } from "../../ColHead";
import { BLine, linesToText, parseLines, stringifyLines } from "../../bullets";
import { BulletEditor, Mark } from "../../BulletParts";
import { useOutsideClose } from "../../useOutsideClose";
import { PlaceInput } from "../../PlaceInputs";
import { workColor, COLUMNS, COL_GAP, textWidth, DocPlusIcon, MailIcon, PhoneIcon, CheckIcon, Prog, isPath, WarnIcon } from "./parts";

const UNKNOWN = "주소불명";

// ---------- 열 제목 줄 (끌어서 열 너비, 우클릭 열 너비 초기화 – 민원대장과 같아요) ----------

export function HeadRow({ all, onAll, cols }: { all: "none" | "some" | "all"; onAll: () => void; cols: ColHead }) {
  return (
    <div className="pr-row pr-headrow colh-row" role="row" onContextMenu={cols.onContextMenu}>
      {COLUMNS.map((col, i) => (
        <div role="columnheader" key={col.id} className={i === 0 ? "pr-check" : col.center ? "pr-c" : undefined}>
          {i === 0 ? (
            <input
              type="checkbox"
              aria-label="같은 공사 민원 모두 고르기"
              checked={all === "all"}
              ref={(el) => {
                if (el) el.indeterminate = all === "some";
              }}
              disabled={all === "none"}
              title={all === "none" ? "먼저 한 줄을 고르면 같은 공사 민원을 모두 골라요" : all === "all" ? "모두 풀기" : "같은 공사 민원 모두 고르기"}
              onChange={onAll}
            />
          ) : (
            col.label
          )}
          {/* 고정 열(체크·판단 공사·진행)은 손잡이 없음 – 공통 부품이 걸러요 */}
          {cols.grip(col.id, { last: i === COLUMNS.length - 1 })}
        </div>
      ))}
      {cols.menu()}
    </div>
  );
}

// ---------- 위치 칸: 그 자리에서 고쳐요(법정리·동 + 지번, 리·동을 고르면 지역이 채워져요 – 민원대장 위치 칸과 같은 부품) ----------

export function PlaceCell({ c, colW, disabled, onSave }: { c: Case; colW: number; disabled: boolean; onSave: (area: string, place: string, road: string) => void }) {
  const start = c.place === UNKNOWN ? "" : c.place;
  const [place, setPlace] = useState(start);
  const [area, setArea] = useState(c.area);
  const [road, setRoad] = useState(c.road);
  const now = useRef({ place, area, road });
  now.current = { place, area, road };
  useEffect(() => {
    setPlace(c.place === UNKNOWN ? "" : c.place);
    setArea(c.area);
    setRoad(c.road);
  }, [c.place, c.area, c.road]);

  const [editing, setEditing] = useState(false);
  // 한 줄(지역 위치)이 위치 열 끝(PLACE_MAX)을 넘으면 이 줄만 두 줄로 – "…"로 줄이지 않아요(2026-10-21 사용자).
  const viewRef = useRef<HTMLDivElement>(null);
  const [two, setTwo] = useState(false);
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    // 열 폭(처음엔 260까지 글자에 맞춘 폭, 끌어서 넓히면 그 폭)보다 길면 그 줄만 두 줄
    const fit = () => setTwo(textWidth(el) + COL_GAP > colW);
    fit();
    let alive = true;
    document.fonts?.ready.then(() => alive && fit());
    return () => {
      alive = false;
    };
  }, [c.area, c.place, editing, colW]);
  if (disabled || !editing) {
    return (
      <div
        ref={viewRef}
        className={"pr-place" + (two ? " two" : " one")}
        title={[`${c.area} ${c.place}`.trim(), c.road ? `원래 주소 ${c.road}` : "", disabled ? "" : "두 번 누르면 주소를 고쳐요"].filter(Boolean).join("\n")}
        onDoubleClick={(e) => {
          if (disabled) return;
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {c.area && <span className="pr-sub">{c.area}</span>}
        <span className={c.place === UNKNOWN ? "pr-unknown" : undefined}>{c.place}</span>
      </div>
    );
  }

  const revert = () => {
    setPlace(start);
    setArea(c.area);
    setRoad(c.road);
  };

  return (
    <div
      className="pr-place pr-place-edit"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.nativeEvent.isComposing) return;
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "Escape") {
          revert();
          now.current = { place: start, area: c.area, road: c.road };
          setEditing(false);
          (e.target as HTMLElement).blur();
        }
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setEditing(false);
        // 위치 칸이 떠날 때 지역을 맞춘 뒤(같은 순간) 저장해요.
        window.setTimeout(() => {
          const { place: p, area: a, road: r } = now.current;
          const np = p.trim();
          // 지역은 위치를 따라 바뀌어요. 위치를 그대로 두고 떠나면 저장하지 않아요.
          if (np !== start) onSave(a, np, r);
        }, 0);
      }}
    >
      <span className="pr-sub">{area || "\u00a0"}</span>
      <PlaceInput value={place} area={area} road={road} onChange={setPlace} onArea={setArea} onRoad={setRoad} placeholder={UNKNOWN} className={place.trim() ? undefined : "pr-unknown-in"} autoFocus />
    </div>
  );
}

// ---------- 고려사항 칸 (2026-10-21 사용자 – 머릿기호 여러 줄) ----------

const NOTE_HINT = "예: 야간 작업, 교통 통제 협의";

/**
 * 줄에는 첫 줄(기호 + 글)만 보여요. 긴 글은 칸 끝에서 "…", 다음 줄이 있으면 첫 줄 뒤에 "…".
 * 마우스를 올리면 전체 글. 두 번 누르면 칸 아래로 펼쳐 여러 줄로 고쳐요(줄 높이 44는 그대로) –
 * 바깥 누르기·Tab은 저장하고 접기, Esc는 버리고 접기. 키는 민원대장 내용 칸과 같아요.
 */
export function NoteCell({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const cellRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState<{ lines: BLine[]; rect: DOMRect } | null>(null);
  const now = useRef<BLine[]>([]);
  if (edit) now.current = edit.lines;

  const ls = parseLines(value);
  const at = ls.findIndex((l) => l.t.trim());
  const first = at >= 0 ? ls[at] : null;
  const more = at >= 0 && ls.slice(at + 1).some((l) => l.t.trim());

  const close = useCallback(
    (save: boolean) => {
      setEdit(null);
      if (!save) return;
      const v = stringifyLines(now.current);
      if (v !== stringifyLines(parseLines(value))) onSave(v);
    },
    [value, onSave],
  );

  // 바깥을 누르거나 표를 굴리면 저장하고 접어요.
  useOutsideClose(edit !== null, [popRef], () => close(true), { on: "window", capture: true });
  useEffect(() => {
    if (!edit) return;
    const scroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) close(true);
    };
    const resize = () => close(true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [edit !== null, close]);

  return (
    <div
      ref={cellRef}
      className={"pr-nc" + (edit ? " editing" : "")}
      title={first ? linesToText(ls.slice(at)) : disabled ? undefined : "두 번 누르면 고려사항을 적어요"}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (disabled || !cellRef.current) return;
        const l = ls.length ? ls : [{ t: "" }];
        // 줄 높이 가운데에 입력 칸(28)을 두고 글 시작을 보기 글자와 맞춰요(칸 안쪽 여백 10 − 입력 칸 여백 6 − 테두리 1).
        const cell = cellRef.current.getBoundingClientRect();
        const row = cellRef.current.closest(".pr-row")?.getBoundingClientRect() ?? cell;
        setEdit({ lines: l, rect: new DOMRect(cell.left + 3, row.top + (row.height - 28) / 2, cell.width - 6, 28) });
      }}
    >
      {first ? (
        <>
          <Mark line={first} lv={0} />
          <span className="pr-nc-t">{first.t + (more ? " …" : "")}</span>
        </>
      ) : (
        !disabled && <span className="pr-nc-ph">{NOTE_HINT}</span>
      )}
      {edit &&
        createPortal(
          <div
            ref={popRef}
            className="pr-nc-pop"
            style={{ top: Math.round(edit.rect.top), left: Math.round(edit.rect.left), width: Math.round(edit.rect.width) }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Tab") {
                e.preventDefault();
                close(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close(false);
              }
            }}
          >
            <BulletEditor name="note" label="고려사항" placeholder={NOTE_HINT} lines={edit.lines} onChange={(lines) => setEdit((x) => (x ? { ...x, lines } : x))} autoFocusEnd />
          </div>,
          document.body,
        )}
    </div>
  );
}

/** 줄 ⋯ 메뉴의 현장사진 고르기: 맨 앞 사진이 지시부에 들어가요(2026-10-21 22:59 사용자 – 지시부엔 1장만, AI가 고르고 여기서 바꿈). */
export function PhotoStrip({ c, reason, onPick }: { c: Case; reason: string; onPick: (path: string) => void }) {
  const photos = c.photos.filter(isPath);
  return (
    <div className="pr-photos" role="group" aria-label="지시부에 넣을 현장사진">
      <div className="pr-photos-row">
        {photos.map((p, i) => (
          <button
            key={p}
            type="button"
            className="pr-thumb"
            data-on={i === 0 ? "1" : undefined}
            aria-pressed={i === 0}
            title={i === 0 ? "지시부에 들어가는 사진" : "이 사진을 지시부에 넣어요"}
            onClick={() => i !== 0 && onPick(p)}
          >
            <Thumb path={p} n={i + 1} />
            {i === 0 && <span className="pr-thumb-tag">지시부</span>}
          </button>
        ))}
      </div>
      <p className="pr-photos-why">{reason ? `고른 이유: ${reason}` : "사진을 누르면 지시부에 넣을 사진이 바뀌어요"}</p>
    </div>
  );
}

function Thumb({ path, n }: { path: string; n: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("@tauri-apps/api/core")
      .then(({ convertFileSrc }) => alive && setSrc("__TAURI_INTERNALS__" in window ? convertFileSrc(path) : null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);
  return src ? <img src={src} alt={`현장사진 ${n}`} loading="lazy" /> : <span className="pr-thumb-ph">{n}</span>;
}

/** 위 띠의 공사 이름표 */
export function WorkTag({ w, cd }: { w: Work; cd: ContactsData | null }) {
  const k = workColor(w, cd);
  return (
    <span className="pr-work" style={{ "--wc": `var(--pj-${k}-line)`, "--wf": `var(--pj-${k}-fg)` } as CSSProperties}>
      {w.name}
    </span>
  );
}

export function Gauge({ p, title, onClick }: { p: Prog; title: string; onClick?: (e: ReactMouseEvent<HTMLElement>) => void }) {
  const cls = "pr-gauge" + (p.step >= 4 ? " strong" : "") + (p.warn ? " warn" : "") + (p.hatch ? " hatch" : "") + (onClick ? " go" : "");
  const inner = (
    <>
      <span className="pr-gauge-fill" style={{ width: `${p.pct}%`, background: p.warn ? undefined : `var(--pg-${p.step})` }} />
      <span className="pr-gauge-t">
        {p.icon === "doc" ? <DocPlusIcon size={12} /> : p.icon === "mail" ? <MailIcon size={12} /> : p.icon === "phone" ? <PhoneIcon size={12} /> : p.icon === "warn" ? <WarnIcon size={12} /> : null}
        {p.label}
        {p.check && <CheckIcon size={12} />}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={cls} title={title} aria-label={`진행 ${p.pct}% · ${p.label}`} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <span className={cls} title={title} role="img" aria-label={`진행 ${p.pct}% · ${p.label}`}>
      {inner}
    </span>
  );
}

export function ProofRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="pr-proof-r">
      <span className="pr-proof-k">{k}</span>
      <span className="pr-proof-v" title={v}>
        {v}
      </span>
    </div>
  );
}
