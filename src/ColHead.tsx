// 표 머리 줄 열 폭 공통 부품(헤더 열 조정 통일, 2026-10-28 사용자 – docs/qa/cols.md, 규칙은 cols.ts).
// 화면 7곳(민원대장·민원처리·집행현황·예산현황·탐색기·사업 관리 창·예산현황으로 보내기 창)이 같이 써요.
// 이 부품이 맡는 것: 경계 손잡이(10px, 올리면 보라 2px), 끌기(끈 왼쪽 열만, 끄는 동안 커서 고정), 두 번 누르기 = 그 열 내용에 맞춤,
// 머리 줄 우클릭 메뉴("내용에 맞춤(모든 열)"·"처음 폭으로" + 화면 고유 줄), 끈 열만 px로 저장·읽기.
// 화면이 주는 것: 열 목록(처음 폭·고정·글자 열), 저장 이름, 내용 폭 재기, 고유 메뉴 줄. 머리 누르기(정렬·열 강조)는 화면이 맡아요.
// (정리 ⑥의 ColGrip.tsx를 합쳤어요 – startColDrag·contentWidth는 창 가장자리 끌기도 써요.)
import { MouseEvent as ReactMouseEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { PopMenu } from "./PopMenu";
import { ColDef, ColPx, fitAllPx, fitPx, minOf, readColPx, widthOf, writeColPx } from "./cols";

// ---------- 끌기 ----------

export type ColDrag = {
  /** 끌기 시작할 때의 폭 */
  base: number;
  /** 가장 좁게(없으면 제한 없음) */
  min?: number;
  /** 가장 넓게(없으면 제한 없음) */
  max?: number;
  /** 마우스가 움직인 만큼에 곱하는 값 – 창 왼쪽 가장자리는 -1 */
  scale?: number;
  /** 폭을 정수로 맞출지 */
  round?: boolean;
  /** 끄는 동안 body에 붙일 클래스(커서 고정 – 열은 `col-dragging`, 창 가장자리는 `ew-dragging`) */
  bodyClass?: string;
  /** 끄는 동안 `.drag`를 붙일 손잡이 */
  grip?: HTMLElement;
  /** 마우스를 어디서 들을지 */
  on?: "document" | "window";
  /** 움직일 때마다 새 폭 */
  onMove: (px: number) => void;
  /** 뗄 때 – 한 번도 움직이지 않았으면 null */
  onEnd?: (px: number | null) => void;
};

/** 폭 끌기를 시작해요(손잡이의 onMouseDown에서 불러요). */
export function startColDrag(e: { clientX: number; preventDefault: () => void }, o: ColDrag): void {
  e.preventDefault();
  const x0 = e.clientX;
  const { base, min = -Infinity, max = Infinity, scale = 1, round = true } = o;
  const t: Document | Window = o.on === "document" ? document : window;
  let last: number | null = null;
  const move = (ev: Event) => {
    const raw = base + ((ev as MouseEvent).clientX - x0) * scale;
    last = Math.min(max, Math.max(min, round ? Math.round(raw) : raw));
    o.onMove(last);
  };
  const up = () => {
    o.grip?.classList.remove("drag");
    t.removeEventListener("mousemove", move);
    t.removeEventListener("mouseup", up);
    if (o.bodyClass) document.body.classList.remove(o.bodyClass);
    o.onEnd?.(last);
  };
  o.grip?.classList.add("drag");
  if (o.bodyClass) document.body.classList.add(o.bodyClass);
  t.addEventListener("mousemove", move);
  t.addEventListener("mouseup", up);
}

/** 칸을 복사해 폭 제한 없이 놓고 잰 내용 폭(칸 여백 포함, 손잡이는 빼고) */
export function contentWidth(el: HTMLElement, grip = ".colh-grip"): number {
  const c = el.cloneNode(true) as HTMLElement;
  c.style.cssText += ";position:absolute;left:0;top:0;visibility:hidden;width:max-content;min-width:0;max-width:none;flex:none";
  c.querySelectorAll(grip).forEach((g) => g.remove());
  el.before(c);
  const w = c.getBoundingClientRect().width;
  c.remove();
  return Math.ceil(w);
}

/** 여러 칸(머리 칸 + 보이는 칸) 가운데 가장 넓은 내용 폭 + 여유 2 – 없으면 null */
export function widestOf(els: Iterable<HTMLElement>): number | null {
  let w = 0;
  for (const el of els) w = Math.max(w, contentWidth(el));
  return w > 0 ? w + 2 : null;
}

// ---------- 손잡이 ----------

/** 열 오른쪽 경계 손잡이 – 머리 칸 안에 두어요(머리 칸은 position: relative). 마지막 열이면 last(안쪽 끝에 붙어요). */
export function ColGrip({
  label,
  width,
  min,
  last,
  onMove,
  onEnd,
  onFit,
}: {
  label?: string;
  width: number;
  min: number;
  last?: boolean;
  onMove: (px: number) => void;
  onEnd: (px: number | null) => void;
  onFit: () => void;
}) {
  return (
    <span
      className={"colh-grip" + (last ? " last" : "")}
      role="separator"
      aria-orientation="vertical"
      aria-label={(label ? label + " " : "") + "열 폭"}
      title="끌어서 열 폭 · 두 번 누르면 내용에 맞춤"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        startColDrag(e, { base: width, min, bodyClass: "col-dragging", grip: e.currentTarget, on: "document", onMove, onEnd });
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onFit();
      }}
    />
  );
}

// ---------- 머리 줄 우클릭 메뉴 ----------

export function ColHeadMenu({ x, y, onClose, onFit, onReset, extra }: { x: number; y: number; onClose: () => void; onFit: () => void; onReset: () => void; extra?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(".dmenu-item")?.focus();
  }, []);
  return (
    <PopMenu boxRef={box} x={x} y={y} onClose={onClose} label="열 제목 메뉴">
      <button
        type="button"
        role="menuitem"
        className="dmenu-item"
        onClick={() => {
          onClose();
          onFit();
        }}
      >
        내용에 맞춤(모든 열)
      </button>
      <button
        type="button"
        role="menuitem"
        className="dmenu-item"
        onClick={() => {
          onClose();
          onReset();
        }}
      >
        처음 폭으로
      </button>
      {extra && (
        <>
          <div className="dmenu-sep" role="separator" />
          {extra}
        </>
      )}
    </PopMenu>
  );
}

// ---------- 화면이 쓰는 묶음 ----------

export type ColHead = {
  /** 저장값을 읽었는지 */
  loaded: boolean;
  /** 저장값(끈·맞춘 열만) */
  saved: ColPx;
  /** 열 하나의 보이는 폭 */
  width: (id: string) => number;
  /** 열 오른쪽 경계 손잡이(고정 열·모르는 열은 null) */
  grip: (id: string, opt?: { last?: boolean }) => ReactNode;
  fitOne: (id: string) => void;
  fitAll: () => void;
  reset: () => void;
  /** 머리 줄 onContextMenu */
  onContextMenu: (e: ReactMouseEvent) => void;
  /** 우클릭 메뉴(열려 있을 때만) – extra는 화면 고유 줄 */
  menu: (extra?: ReactNode) => ReactNode;
  closeMenu: () => void;
};

/**
 * 머리 줄 열 폭 – store는 저장 이름(`<화면>.cols`), part는 그 안의 칸(예산현황 요약·자세히).
 * measure(id)는 그 열의 내용 폭(칸 여백 포함, 머리 글자도) – 잴 수 없으면(숨은 열 등) null.
 */
export function useColHead(o: { store: string; part?: string; cols: ColDef[]; measure?: (id: string) => number | null | undefined }): ColHead {
  const { store, part } = o;
  const [saved, setSaved] = useState<ColPx>({});
  const [loaded, setLoaded] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const raw = useRef<string | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const colsRef = useRef(o.cols);
  colsRef.current = o.cols;
  const measureRef = useRef(o.measure);
  measureRef.current = o.measure;

  useEffect(() => {
    let live = true;
    setLoaded(false);
    api.get(store).then(
      (v) => {
        if (!live) return;
        raw.current = v;
        setSaved(readColPx(v, part));
        setLoaded(true);
      },
      () => live && setLoaded(true),
    );
    return () => {
      live = false;
    };
  }, [store, part]);

  const save = useCallback(
    (px: ColPx) => {
      setSaved(px);
      const s = writeColPx(raw.current, px, part);
      raw.current = s;
      api.set(store, s).catch(() => {});
    },
    [store, part],
  );

  const def = (id: string) => colsRef.current.find((c) => c.id === id);
  const width = (id: string) => {
    const c = def(id);
    return c ? widthOf(c, saved) : 0;
  };
  const fitOne = (id: string) => {
    const c = def(id);
    const m = measureRef.current?.(id);
    if (!c || c.fixed || m == null || !(m > 0)) return;
    save({ ...savedRef.current, [id]: fitPx(c, m) });
  };
  const fitAll = () => save(fitAllPx(colsRef.current, savedRef.current, (id) => measureRef.current?.(id)));
  const reset = () => save({});

  const grip = (id: string, opt?: { last?: boolean }) => {
    const c = def(id);
    if (!c || c.fixed) return null;
    return (
      <ColGrip
        key={"g-" + id}
        label={c.label}
        width={widthOf(c, saved)}
        min={minOf(c)}
        last={opt?.last}
        onMove={(px) => setSaved((s) => ({ ...s, [id]: px }))}
        onEnd={(px) => px !== null && save({ ...savedRef.current, [id]: px })}
        onFit={() => fitOne(id)}
      />
    );
  };

  return {
    loaded,
    saved,
    width,
    grip,
    fitOne,
    fitAll,
    reset,
    onContextMenu: (e) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    },
    menu: (extra) => (menu ? <ColHeadMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} onFit={fitAll} onReset={reset} extra={extra} /> : null),
    closeMenu: () => setMenu(null),
  };
}
