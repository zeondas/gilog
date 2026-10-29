// 보이는 만큼만 그리기(가상 스크롤) 공통 부품 – 2026-10-21 공통 결정 로그 12:06(속도 최적화 1안).
//
// 줄을 감싸지 않고 부모(표 `.cm`, 카드 칸 `.ct-grid` 등) 안에 그대로 그려요 – 모양이 바뀌지 않게.
// 보이는 줄 + 위아래 여유(overscan px)만 그리고, 그리지 않은 줄 자리는 빈 칸(spacer) 하나가 높이로 채워요.
// - 줄 높이는 그린 줄을 ResizeObserver로 재 두고(키마다 기억, 거르기를 바꿔도 남아요), 아직 못 잰 줄은 estimate로 셈해요.
// - 칸 모양(grid)이면 부모의 열 수를 읽어 한 줄(행)씩 다뤄요. 행 높이 = 그 행 카드 가운데 가장 높은 것.
// - 그리는 줄은 반드시 맨 바깥 요소에 data-vi={i}를 달아요(재기·찾기에 써요).
// - pinned(고치는 줄·고른 줄)와 포커스가 있는 줄은 화면 밖이어도 그대로 그려 둬요(입력·키보드가 끊기지 않게).
// - 스크롤하는 상자는 부모에서 위로 올라가며 처음 만나는 overflow auto/scroll 요소(앱에서는 `.main`)예요.
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Key,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

export type VirtualHandle = {
  /** 그 줄로 스크롤해요(그리지 않은 줄도). 도착한 뒤 실제 높이로 한 번 더 맞춰요. */
  scrollToIndex: (i: number, opt?: { align?: "center" | "nearest" | "start"; behavior?: ScrollBehavior }) => void;
};

type Props = {
  count: number;
  getKey: (i: number) => Key;
  render: (i: number) => ReactNode;
  /** 아직 재지 않은 줄(칸 모양이면 카드)의 높이 추정(px) */
  estimate: (i: number) => number;
  /** 줄이 들어 있는 부모 요소 */
  parentRef: RefObject<HTMLElement>;
  /** 부모가 CSS grid(여러 열 카드)면 true */
  grid?: boolean;
  /** 위아래로 더 그려 둘 높이(px) */
  overscan?: number;
  /** 화면 밖이어도 그려 둘 줄 번호 */
  pinned?: (number | null | undefined)[];
  /** 바뀌면 재 둔 높이를 버려요(열 폭이 바뀌어 줄바꿈이 달라질 때). */
  resetKey?: unknown;
};

const scrollParent = (el: HTMLElement | null): HTMLElement | null => {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
};

export const VirtualList = forwardRef<VirtualHandle, Props>(function VirtualList(
  { count, getKey, render, estimate, parentRef, grid = false, overscan = 900, pinned = [], resetKey },
  ref,
) {
  const sizes = useRef(new Map<Key, number>()); // 키 → 잰 높이(줄 또는 카드)
  const [cols, setCols] = useState(grid ? 0 : 1); // 칸 모양은 열 수를 재기 전 0(아무것도 안 그림 – 칠하기 전에 다시 그려요)
  const [gap, setGap] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, -1]); // 그리는 행 [처음, 끝]
  const [, setVer] = useState(0);
  const focusKey = useRef<Key | null>(null);
  const origin = useRef(0); // 스크롤 상자 내용 기준 목록 시작 위치
  // 처음 그릴 때는 부모의 ref가 아직 안 붙어 있어요(자식의 layout effect가 먼저 돌아요) – 빈 표시(probe)로 부모를 찾아요.
  const probe = useRef<HTMLDivElement>(null);
  const [bound, setBound] = useState(false);
  const parentOf = useCallback((): HTMLElement | null => parentRef.current ?? probe.current?.parentElement ?? null, [parentRef]);
  const lastReset = useRef(resetKey);
  // 추정 고치기: 처음 잰 줄들의 (잰 높이 합 ÷ 추정 합)을 아직 못 잰 줄에 곱해요(스크롤 막대가 덜 흔들려요).
  const cal = useRef({ m: 0, e: 0 });
  // 맨 아래에 있던 중에 아래 줄을 재서 길어지면 맨 아래에 그대로 붙어 있어요(End 키).
  const atBottom = useRef(false);
  if (lastReset.current !== resetKey) {
    lastReset.current = resetKey;
    sizes.current.clear();
    cal.current = { m: 0, e: 0 };
  }

  // 행 위치(행 번호 → 위 끝). 행 사이 간격(gap)도 셈해요.
  const rows = cols > 0 ? Math.ceil(count / cols) : 0;
  const factor = cal.current.e > 0 ? Math.min(3, Math.max(0.5, cal.current.m / cal.current.e)) : 1;
  const itemH = (i: number) => sizes.current.get(getKey(i)) ?? estimate(i) * factor;
  const rowH = new Float64Array(rows);
  const top = new Float64Array(rows + 1);
  for (let r = 0; r < rows; r++) {
    let h = 0;
    for (let i = r * cols, e = Math.min(count, i + cols); i < e; i++) h = Math.max(h, itemH(i));
    rowH[r] = h;
    top[r + 1] = top[r] + h + (r < rows - 1 ? gap : 0);
  }
  const total = top[rows];

  const live = useRef({ rows, top, rowH, count, cols, getKey, total, estimate });
  live.current = { rows, top, rowH, count, cols, getKey, total, estimate };
  /** 잰 높이를 적어요. 바뀌었으면 true. */
  const note = (i: number, h: number) => {
    const k = live.current.getKey(i);
    const old = sizes.current.get(k);
    if (old !== undefined && Math.abs(old - h) <= 0.25) return false;
    if (old === undefined) {
      cal.current.m += h;
      cal.current.e += live.current.estimate(i);
    }
    sizes.current.set(k, h);
    return true;
  };

  /** 지금 스크롤 자리에서 그릴 행 범위 */
  const want = useCallback((): [number, number] | null => {
    const parent = parentOf();
    const sc = scrollParent(parent);
    const { rows, top } = live.current;
    if (!parent || rows === 0) return [0, -1];
    const viewTop = (sc ? sc.scrollTop : window.scrollY) - origin.current;
    const viewH = sc ? sc.clientHeight : window.innerHeight;
    const a = viewTop - overscan;
    const b = viewTop + viewH + overscan;
    let lo = 0;
    let hi = rows - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (top[m + 1] <= a) lo = m + 1;
      else hi = m;
    }
    let end = lo;
    while (end < rows - 1 && top[end + 1] < b) end++;
    return [lo, end];
  }, [parentOf, overscan]);

  /** 목록 시작 위치를 다시 재요(머리 줄·신규 입력란 높이가 바뀌어도 맞게). */
  const measureOrigin = useCallback(() => {
    const parent = parentOf();
    if (!parent) return;
    const sc = scrollParent(parent);
    const first = parent.querySelector<HTMLElement>(":scope > [data-vs='top'], :scope > [data-vi]");
    const anchor = first ?? parent;
    const scTop = sc ? sc.getBoundingClientRect().top - sc.scrollTop : -window.scrollY;
    origin.current = anchor.getBoundingClientRect().top - scTop;
  }, [parentOf]);

  const update = useCallback(() => {
    measureOrigin();
    const w = want();
    if (!w) return;
    setRange((old) => (old[0] === w[0] && old[1] === w[1] ? old : w));
  }, [want, measureOrigin]);

  // 열 수·간격(칸 모양)
  useLayoutEffect(() => {
    const parent = parentOf();
    if (!parent) return;
    const read = () => {
      const cs = getComputedStyle(parent);
      if (grid) {
        const n = cs.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
        const g = parseFloat(cs.rowGap) || 0;
        setCols((o) => (o === n ? o : n));
        setGap((o) => (o === g ? o : g));
      }
    };
    read();
    setBound(true);
    const ro = new ResizeObserver(() => {
      read();
      update();
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [parentOf, bound, grid, update]);

  // 스크롤·창 크기
  useEffect(() => {
    const sc = scrollParent(parentOf());
    const target: HTMLElement | Window = sc ?? window;
    const onScroll = () => {
      if (sc) atBottom.current = sc.scrollTop > 0 && sc.scrollHeight - sc.scrollTop - sc.clientHeight <= 1;
      measureOrigin();
      const w = want();
      if (!w) return;
      const [a, b] = live.current.rows ? rangeRef.current : [0, -1];
      if (w[0] === a && w[1] === b) return;
      // 그린 범위가 보이는 곳을 다 못 덮으면 이 프레임에 바로 그려요(빈 칸이 보이지 않게).
      const viewTop = (sc ? sc.scrollTop : window.scrollY) - origin.current;
      const viewH = sc ? sc.clientHeight : window.innerHeight;
      const { top } = live.current;
      const covered = top[a] <= Math.max(0, viewTop) && top[Math.min(b + 1, live.current.rows)] >= Math.min(live.current.total, viewTop + viewH);
      if (covered) setRange(w);
      else flushSync(() => setRange(w));
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [parentOf, bound, want, measureOrigin]);

  const rangeRef = useRef(range);
  rangeRef.current = range;

  // 그린 뒤: 시작 위치·범위를 맞추고(칠하기 전), 그린 줄을 재요.
  // 맨 아래에 붙어 있다가 내용 높이가 바뀌었을 때만 다시 맨 아래로 – 키로 위 줄을 보이게 옮긴 것(높이 그대로)은
  // 스크롤 알림이 오기 전이라 되돌리지 않아요(2026-10-29 탐색기 – End 뒤 ↑가 맨 아래로 튕기던 것).
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    update();
    const sc = scrollParent(parentOf());
    if (!sc) return;
    if (atBottom.current && sc.scrollHeight !== lastHeight.current && sc.scrollHeight - sc.scrollTop - sc.clientHeight > 1) sc.scrollTop = sc.scrollHeight;
    lastHeight.current = sc.scrollHeight;
  });

  useLayoutEffect(() => {
    const parent = parentOf();
    if (!parent) return;
    const els = parent.querySelectorAll<HTMLElement>(":scope > [data-vi]");
    let changed = false;
    const take = (el: HTMLElement) => {
      const i = Number(el.dataset.vi);
      if (!(i < live.current.count)) return;
      if (note(i, el.getBoundingClientRect().height)) changed = true;
    };
    els.forEach(take);
    if (changed) setVer((v) => v + 1);
    const ro = new ResizeObserver((entries) => {
      let c = false;
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (!el.isConnected) continue;
        const i = Number(el.dataset.vi);
        if (!(i < live.current.count)) continue;
        if (note(i, el.getBoundingClientRect().height)) c = true;
      }
      if (c) setVer((v) => v + 1);
    });
    els.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  });

  // 포커스가 있는 줄은 화면 밖으로 나가도 그려 둬요.
  useEffect(() => {
    const parent = parentOf();
    if (!parent) return;
    const onIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-vi]");
      focusKey.current = el && el.parentElement === parent ? live.current.getKey(Number(el.dataset.vi)) : null;
    };
    const onOut = (e: FocusEvent) => {
      if (!e.relatedTarget || !parent.contains(e.relatedTarget as Node)) focusKey.current = null;
    };
    parent.addEventListener("focusin", onIn);
    parent.addEventListener("focusout", onOut);
    return () => {
      parent.removeEventListener("focusin", onIn);
      parent.removeEventListener("focusout", onOut);
    };
  }, [parentOf, bound]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(i, opt = {}) {
        const parent = parentOf();
        const sc = scrollParent(parent);
        if (!parent || !sc || i < 0 || i >= live.current.count) return;
        const align = opt.align ?? "center";
        const behavior = opt.behavior ?? "auto";
        measureOrigin();
        const r = Math.floor(i / live.current.cols);
        const y = origin.current + live.current.top[r];
        const h = live.current.rowH[r];
        // 위에 붙어 있는 머리 줄(scroll-padding-top)만큼은 가려지는 자리라 그 아래로 맞춰요(탐색기 `..` 고정 2026-10-29)
        const pad = parseFloat(getComputedStyle(sc).scrollPaddingTop) || 0;
        const dest =
          align === "center"
            ? y + h / 2 - sc.clientHeight / 2
            : align === "start"
              ? y - pad
              : y < sc.scrollTop + pad
                ? y - pad
                : y + h > sc.scrollTop + sc.clientHeight
                  ? y + h - sc.clientHeight
                  : sc.scrollTop;
        sc.scrollTo({ top: Math.max(0, dest), behavior });
        // 도착하면(추정 높이로 셈한 자리라 조금 어긋날 수 있어요) 실제 줄로 한 번 더 맞춰요.
        // 스크롤이 멈추면(움직이기 시작한 뒤 4프레임 그대로) 줄 실제 자리를 보고 어긋났으면 다시 – 두 번까지.
        let tries = 2;
        const watch = () => {
          let last = sc.scrollTop;
          let still = 0;
          let moved = false;
          const t0 = performance.now();
          const settle = () => {
            if (sc.scrollTop === last) still++;
            else {
              still = 0;
              moved = true;
            }
            last = sc.scrollTop;
            const waited = performance.now() - t0;
            if ((still < 4 || (!moved && waited < 300)) && waited < 4000) {
              requestAnimationFrame(settle);
              return;
            }
            const el = parent.querySelector<HTMLElement>(`:scope > [data-vi="${i}"]`);
            if (!el) return;
            const er = el.getBoundingClientRect();
            const sr = sc.getBoundingClientRect();
            const off = align === "center" ? er.top + er.height / 2 - (sr.top + sc.clientHeight / 2) : 0;
            if (Math.abs(off) > 2 && tries-- > 0) {
              el.scrollIntoView({ block: align === "start" ? "start" : align, behavior });
              watch();
            }
          };
          requestAnimationFrame(settle);
        };
        watch();
      },
    }),
    [parentOf, measureOrigin],
  );

  if (!bound) return <div ref={probe} data-vs="probe" aria-hidden="true" style={grid ? { gridColumn: "1 / -1", height: 0 } : { height: 0 }} />;
  if (rows === 0) return null;

  // 그릴 행: 범위 + 붙들어 둔 줄의 행
  const [a0, b0] = range;
  const a = Math.max(0, Math.min(a0, rows - 1));
  const b = Math.min(rows - 1, Math.max(b0, a));
  const show = new Set<number>();
  for (let r = a; r <= b; r++) show.add(r);
  for (const p of pinned) if (p != null && p >= 0 && p < count) show.add(Math.floor(p / cols));
  if (focusKey.current != null) {
    for (let i = 0; i < count; i++) if (getKey(i) === focusKey.current) { show.add(Math.floor(i / cols)); break; }
  }
  const order = [...show].sort((x, y) => x - y);

  const out: ReactNode[] = [];
  // 그리지 않은 행 from..to-1을 대신하는 빈 칸. 칸 모양이면 한 행 전체를 차지하고, 뒤 행과의 간격 하나는 grid가 더해 줘요.
  const spacer = (from: number, to: number, key: string) => {
    const h = top[to] - top[from] - (grid && to < rows ? gap : 0);
    out.push(<div key={key} data-vs={key} aria-hidden="true" style={grid ? { gridColumn: "1 / -1", height: Math.max(0, h) } : { height: Math.max(0, h) }} />);
  };
  let prev = 0;
  order.forEach((r, n) => {
    if (r > prev) spacer(prev, r, n === 0 ? "top" : "gap" + r);
    for (let i = r * cols, e = Math.min(count, i + cols); i < e; i++) out.push(<Fragment key={getKey(i)}>{render(i)}</Fragment>);
    prev = r + 1;
  });
  if (prev < rows) spacer(prev, rows, "bottom");
  return <>{out}</>;
});
