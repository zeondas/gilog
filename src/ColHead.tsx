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
  /** 끄는 동안 body에 붙일 클래스(커서 고정 – 열은 `col-dragging`, 창 가장자리는 `ew-dragging`) */
  bodyClass?: string;
  /** 끄는 동안 `.drag`를 붙일 손잡이 */
  grip?: HTMLElement;
  /** 끄는 동안 body 커서(클래스 대신 직접 – 예산현황으로 보내기 창 가장자리·모서리) */
  cursor?: string;
  /** 마우스를 어디서 들을지 */
  on?: "document" | "window";
  /** 움직일 때마다 새 폭(정수) */
  onMove: (px: number) => void;
  /** 움직일 때마다 처음 자리에서 움직인 거리(가로·세로) – 두 방향을 같이 쓰는 창 크기 끌기 */
  onDelta?: (dx: number, dy: number) => void;
  /** 뗄 때 – 한 번도 움직이지 않았으면 null */
  onEnd?: (px: number | null) => void;
};

/** 폭 끌기를 시작해요(손잡이의 onMouseDown에서 불러요). */
export function startColDrag(e: { clientX: number; preventDefault: () => void }, o: ColDrag): void {
  e.preventDefault();
  const x0 = e.clientX;
  const y0 = (e as { clientY?: number }).clientY ?? 0;
  const { base, min = -Infinity, max = Infinity, scale = 1 } = o;
  const t: Document | Window = o.on === "document" ? document : window;
  let last: number | null = null;
  const move = (ev: Event) => {
    const m = ev as MouseEvent;
    const raw = base + (m.clientX - x0) * scale;
    last = Math.min(max, Math.max(min, Math.round(raw)));
    o.onMove(last);
    o.onDelta?.(m.clientX - x0, m.clientY - y0);
  };
  const up = () => {
    o.grip?.classList.remove("drag");
    t.removeEventListener("mousemove", move);
    t.removeEventListener("mouseup", up);
    if (o.bodyClass) document.body.classList.remove(o.bodyClass);
    if (o.cursor) document.body.style.cursor = "";
    o.onEnd?.(last);
  };
  o.grip?.classList.add("drag");
  if (o.bodyClass) document.body.classList.add(o.bodyClass);
  if (o.cursor) document.body.style.cursor = o.cursor;
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

/** 여러 칸(머리 칸 + 보이는 칸) 가운데 가장 넓은 내용 폭(칸 여백 포함) – 없으면 null. 맞춤 여유는 cols.ts fitPx가 더해요. */
export function widestOf(els: Iterable<HTMLElement>): number | null {
  let w = 0;
  for (const el of els) w = Math.max(w, contentWidth(el));
  return w > 0 ? w : null;
}

let canvasCtx: CanvasRenderingContext2D | null | undefined;
/** 글자 폭(캔버스 하나를 같이 써요) – font는 CSS font 글(예 `600 13px Pretendard`) */
export function textPx(text: string, font: string): number {
  if (!text) return 0;
  if (canvasCtx === undefined) canvasCtx = document.createElement("canvas").getContext("2d");
  if (!canvasCtx) return 0;
  canvasCtx.font = font;
  return canvasCtx.measureText(text).width;
}

/** 칸 좌우 여백 + 테두리 – 글자 폭만 잰 열(캔버스)을 칸 폭으로 바꿀 때 */
export function padX(el: Element | null | undefined): number {
  if (!el) return 0;
  const cs = getComputedStyle(el);
  return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
}

// ---------- 손잡이 ----------

/** 열 오른쪽 경계 손잡이 – 머리 칸 안에 두어요(머리 칸은 position: relative). 마지막 열이면 last(안쪽 끝에 붙어요). */
export function ColGrip({
  label,
  width,
  min,
  max,
  last,
  onMove,
  onEnd,
  onFit,
  canStart,
}: {
  label?: string;
  width: number;
  min: number;
  max?: number;
  last?: boolean;
  onMove: (px: number) => void;
  onEnd: (px: number | null) => void;
  onFit: () => void;
  /** 끌기를 시작해도 되는지(저장값을 다 읽기 전에는 안 돼요 – cols 최적화 5) */
  canStart?: () => boolean;
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
        if (canStart && !canStart()) {
          e.preventDefault();
          return;
        }
        startColDrag(e, { base: width, min, max, bodyClass: "col-dragging", grip: e.currentTarget, on: "document", onMove, onEnd });
      }}
      // 머리 칸이 누르기로 다른 일(탐색기 열 순서 끌기)을 하면 손잡이에서 시작한 누르기는 거기로 안 가게
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (canStart && !canStart()) return;
        onFit();
      }}
    />
  );
}

// ---------- 머리 줄 우클릭 메뉴 ----------

export function ColHeadMenu({ x, y, onClose, onFit, onReset }: { x: number; y: number; onClose: () => void; onFit: () => void; onReset: () => void }) {
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
    </PopMenu>
  );
}

// ---------- 화면이 쓰는 묶음 ----------

export type ColHead = {
  /** 저장값을 읽었는지 – 읽기 전에는 끌기·맞춤·처음 폭이 안 돼요(늦게 온 저장값이 덮지 않게) */
  loaded: boolean;
  /** 지금 보이는 폭의 저장값(끄는 중이면 끄는 값이 들어가요) */
  saved: ColPx;
  /** 손을 뗀 뒤의 저장값 – 끄는 동안은 바뀌지 않아요(무거운 다시 재기의 기준) */
  committed: ColPx;
  /** 열 하나의 보이는 폭 */
  width: (id: string) => number;
  /** 열 오른쪽 경계 손잡이(고정 열·모르는 열은 null) */
  grip: (id: string, opt?: { last?: boolean }) => ReactNode;
  fitOne: (id: string) => void;
  fitAll: () => void;
  reset: () => void;
  /** 머리 줄 onContextMenu */
  onContextMenu: (e: ReactMouseEvent) => void;
  /** 우클릭 메뉴(열려 있을 때만) */
  menu: () => ReactNode;
};

/** 다음 화면 그리기 때 한 번만 – 마우스가 한 장면에 여러 번 움직여도 화면은 한 번만 바뀌어요 */
const nextFrame = (f: () => void): (() => void) => {
  if (typeof requestAnimationFrame !== "function") {
    const t = setTimeout(f, 16);
    return () => clearTimeout(t);
  }
  const id = requestAnimationFrame(f);
  return () => cancelAnimationFrame(id);
};

/**
 * 머리 줄 열 폭 – store는 저장 이름(`<화면>.cols`), part는 그 안의 칸(예산현황 요약·자세히).
 * measure(id)는 그 열의 내용 폭(칸 여백 포함, 머리 글자도, 여유는 빼고) – 잴 수 없으면(숨은 열 등) null.
 * live(w)를 주면 끄는 동안은 화면을 다시 그리지 않고 live가 폭을 직접 칠해요(w(id) = 그 순간 폭) – 손을 떼면 한 번 다시 그려요(cols 최적화 3).
 * live가 없으면 끄는 동안 화면 그리기 한 번에 한 번만 다시 그려요.
 */
export function useColHead(o: { store: string; part?: string; cols: ColDef[]; measure?: (id: string) => number | null | undefined; live?: (w: (id: string) => number) => void }): ColHead {
  const { store, part } = o;
  const [saved, setSaved] = useState<ColPx>({});
  const [loaded, setLoaded] = useState(false);
  /** 끄는 중인 열과 폭(live가 없을 때만 state로) */
  const [drag, setDrag] = useState<{ id: string; px: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const raw = useRef<string | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const colsRef = useRef(o.cols);
  colsRef.current = o.cols;
  const measureRef = useRef(o.measure);
  measureRef.current = o.measure;
  const liveRef = useRef(o.live);
  liveRef.current = o.live;
  /** 아직 칠하지 않은 끄는 값과 그 취소 */
  const pending = useRef<{ id: string; px: number } | null>(null);
  const cancelFrame = useRef<(() => void) | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    loadedRef.current = false;
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

  useEffect(() => () => cancelFrame.current?.(), []);

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
  const shown: ColPx = drag ? { ...saved, [drag.id]: drag.px } : saved;
  const width = (id: string) => {
    const c = def(id);
    return c ? widthOf(c, shown) : 0;
  };
  const ready = () => loadedRef.current;
  const fitOne = (id: string) => {
    const c = def(id);
    if (!c || c.fixed || !ready()) return;
    const m = measureRef.current?.(id);
    if (m == null || !(m > 0)) {
      // 잴 수 없는 열(여러 줄 긴 글 열 등)은 처음 폭(창에 맞춘 폭)으로 돌아가요
      const { [id]: _drop, ...rest } = savedRef.current;
      void _drop;
      save(rest);
      return;
    }
    save({ ...savedRef.current, [id]: fitPx(c, m) });
  };
  const fitAll = () => ready() && save(fitAllPx(colsRef.current, savedRef.current, (id) => measureRef.current?.(id)));
  const reset = () => ready() && save({});

  /** 끄는 값을 칠해요 – live가 있으면 화면을 다시 그리지 않고 직접, 없으면 state로 */
  const paint = () => {
    cancelFrame.current = null;
    const p = pending.current;
    if (!p) return;
    const lv = liveRef.current;
    if (lv) {
      const s = { ...savedRef.current, [p.id]: p.px };
      lv((id) => {
        const c = def(id);
        return c ? widthOf(c, s) : 0;
      });
    } else setDrag(p);
  };
  const move = (id: string, px: number) => {
    pending.current = { id, px };
    if (!cancelFrame.current) cancelFrame.current = nextFrame(paint);
  };
  const end = (id: string, px: number | null) => {
    cancelFrame.current?.();
    cancelFrame.current = null;
    pending.current = null;
    setDrag(null);
    if (px !== null) save({ ...savedRef.current, [id]: px });
  };

  const grip = (id: string, opt?: { last?: boolean }) => {
    const c = def(id);
    if (!c || c.fixed) return null;
    return (
      <ColGrip
        key={"g-" + id}
        label={c.label}
        width={widthOf(c, saved)}
        min={minOf(c)}
        max={c.max}
        last={opt?.last}
        canStart={ready}
        onMove={(px) => move(id, px)}
        onEnd={(px) => end(id, px)}
        onFit={() => fitOne(id)}
      />
    );
  };

  return {
    loaded,
    saved: shown,
    committed: saved,
    width,
    grip,
    fitOne,
    fitAll,
    reset,
    onContextMenu: (e) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    },
    menu: () => (menu ? <ColHeadMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} onFit={fitAll} onReset={reset} /> : null),
  };
}
