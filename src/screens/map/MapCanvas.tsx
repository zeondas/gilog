// 민원 지도 – 캔버스(✔3·✔4). 외부 지도 없이 앱에 넣은 배경 네 층을 직접 그려요.
// 휠 = 확대·축소(커서 기준) · 왼쪽 끌기·휠 클릭 끌기 = 이동 · 읍면을 고르면 약 0.5초 동안 부드럽게 확대(바깥 흐림·보라 테두리 함께).
// 오른쪽 위 단추: [+][−] · [가운데로] · [파주시 전체](읍면 보기일 때만). Esc(지도에 초점) = 파주시 전체로.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MapComplaint } from "../../api";
import { statusColor } from "../../settingsStore";
import { cardPlace, layerPaths, tracePath, type Feature, type Field, type Layers } from "./mapData";

export type MapPoint = { c: MapComplaint; x: number; y: number; color: string };
type View = { cx: number; cy: number; s: number };
type Cluster = { sx: number; sy: number; pts: MapPoint[] };

/** 지도 색은 CSS 토큰(map.css `.mp` – 밝게/어둡게 따로, ✔6)에서 읽어요. 칠하는 층은 fillLayers의 color가 토큰 이름이에요. */
type Palette = { get: (name: string) => string; key: string };
const PAL_NAMES = ["--map-road", "--map-plan", "--map-zone", "--map-line", "--map-nat", "--map-loc", "--map-small", "--map-park"];
function paletteOf(el: Element): Palette {
  const css = getComputedStyle(el);
  const m = new Map(PAL_NAMES.map((n) => [n, css.getPropertyValue(n).trim() || "#888"]));
  return { get: (n) => m.get(n) ?? n, key: [...m.values()].join(",") };
}
const ANIM_MS = 500;
const HIT = 9;
const DOUBLE_MS = 450; // 두 번 누르기로 보는 사이

function fit(b: [number, number, number, number], w: number, h: number, pad = 28): View {
  const bw = Math.max(1, b[2] - b[0]);
  const bh = Math.max(1, b[3] - b[1]);
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, s: Math.max(s, 1e-4) };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 칠하는 층은 closePath 없이(칠하기는 저절로 닫혀요) – 고리마다 closePath를 부르면 Chromium이 고리 수의 제곱으로 느려져
 *  48,848고리에서 20초 넘게 멈췄어요(0.68.0 멈춤 ①). 선으로 긋는 경계만 닫아요. */
function pathOf(feats: Feature[], ox: number, oy: number, close = false): Path2D {
  const p = new Path2D();
  tracePath(p, feats, ox, oy, close);
  return p;
}

/** 배경 그림 한 장: 그 그림을 그린 보기(view)와 크기(CSS px). key = 자료 + 분야·꺼 둔 층(bg) */
type Snap = { cv: HTMLCanvasElement; v: View; w: number; h: number; dpr: number; key: Layers; bg: string };
type Paths = { key: Layers; field: Field; ox: number; oy: number; fills: { id: string; color: string; minScale?: number; p: Path2D }[]; emd: Path2D };

/** 전체 보기(확대 배율이 minScale보다 작을 때)에는 도시계획도로를 빼고 그려요 – 그 크기에선 어차피 안 보여요(0.68.0 멈춤 ②). */
function renderBg(ctx: CanvasRenderingContext2D, P: Paths, off: Set<string>, v: View, w: number, h: number, dpr: number, pal: Palette) {
  const { ox, oy } = P;
  const s = v.s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(s * dpr, 0, 0, -s * dpr, (w / 2 - (v.cx - ox) * s) * dpr, (h / 2 + (v.cy - oy) * s) * dpr);
  for (const f of P.fills) {
    if (off.has(f.id) || (f.minScale && s < f.minScale)) continue;
    ctx.fillStyle = pal.get(f.color);
    ctx.fill(f.p);
  }
  ctx.strokeStyle = pal.get("--map-line");
  ctx.lineWidth = 0.9 / s;
  ctx.stroke(P.emd);
}

/** 그려 둔 배경 그림을 지금 보기에 맞춰 늘리고 옮겨 붙여요(움직이는 동안 – 한 장면 몇 ms). */
function blit(ctx: CanvasRenderingContext2D, snap: Snap, v: View, w: number, h: number) {
  const k = v.s / snap.v.s;
  const left = w / 2 - (snap.w / 2) * k + (snap.v.cx - v.cx) * v.s;
  const top = h / 2 - (snap.h / 2) * k + (v.cy - snap.v.cy) * v.s;
  ctx.drawImage(snap.cv, left, top, snap.w * k, snap.h * k);
}

const sameView = (a: View, b: View) => a.cx === b.cx && a.cy === b.cy && a.s === b.s;

type Props = {
  layers: Layers | null;
  /** 분야(✔3): 도로 = 도로 층 · 하천 = 하천 면 · 공원 = 공원 면 */
  field: Field;
  /** 꺼 둔 배경 층(하천 표시 설정에서 끈 등급) */
  off: Set<string>;
  points: MapPoint[];
  /** 지금 보는 읍면(없으면 파주시 전체) */
  region: string | null;
  /** 그 읍면을 그리는 법정 경계 */
  regionFeats: Feature[];
  /** 그 읍면의 테두리 상자 */
  focusBounds: [number, number, number, number] | null;
  selectedId: number | null;
  legend: { type: string; color: string }[];
  onOpen: (id: number) => void;
  onWhole: () => void;
};

export default function MapCanvas({ layers, field, off, points, region, regionFeats, focusBounds, selectedId, legend, onOpen, onWhole }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const view = useRef<View | null>(null);
  const dim = useRef(0); // 바깥 흐림 0~1
  const anim = useRef<number | null>(null);
  const clusters = useRef<Cluster[]>([]);
  const paths = useRef<Paths | null>(null);
  const bgKey = field + "|" + [...off].sort().join(",");
  const [hover, setHover] = useState<Cluster | null>(null);
  const [pinned, setPinned] = useState<Cluster | null>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const state = useRef({ points, region, regionFeats, selectedId });
  state.current = { points, region, regionFeats, selectedId };

  const viewSnap = useRef<Snap | null>(null);
  const fullSnap = useRef<Snap | null>(null);
  const regionPath = useRef<{ key: Feature[]; p: Path2D } | null>(null);
  const settleT = useRef<number | null>(null);
  const fullT = useRef<number | null>(null);

  const pathsOf = (L: Layers): Paths => {
    let P = paths.current;
    if (!P || P.key !== L || P.field !== field) {
      P = { key: L, field, ...layerPaths(L, () => new Path2D(), field) };
      paths.current = P;
    }
    return P;
  };

  /** 파주시 전체를 두 배 또렷하게 한 장 – 움직이는 동안 화면 밖까지 비지 않게 밑에 깔아요. 쉴 때 한 번 만들어요. */
  const buildFull = useCallback(() => {
    if (!layers) return;
    const { w, h, dpr } = size.current;
    if (!w) return;
    const base = fit(layers.bounds, w, h);
    const s = base.s * 2;
    const bw = (layers.bounds[2] - layers.bounds[0]) * s + 64;
    const bh = (layers.bounds[3] - layers.bounds[1]) * s + 64;
    const k = Math.min(1, 4096 / (Math.max(bw, bh) * dpr)); // 한 변 4096점 안
    const cw = bw * k;
    const ch = bh * k;
    const cv = document.createElement("canvas");
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const v = { cx: base.cx, cy: base.cy, s: s * k };
    const pal = paletteOf(canvasRef.current ?? document.body);
    renderBg(ctx, pathsOf(layers), off, v, cw, ch, dpr, pal);
    fullSnap.current = { cv, v, w: cw, h: ch, dpr, key: layers, bg: bgKey + "|" + pal.key };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, bgKey]);

  /** fast = 움직이는 중(그려 둔 그림을 늘려 붙임) · 아니면 지금 보기로 또렷하게(같은 보기면 그려 둔 것을 그대로) */
  const draw = useCallback((fast = false) => {
    const cv = canvasRef.current;
    const v = view.current;
    if (!cv || !v) return;
    const { w, h, dpr } = size.current;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(cv);
    const accent = css.getPropertyValue("--accent").trim() || "#4F3CC9";
    const onAccent = css.getPropertyValue("--on-accent").trim() || "#fff";
    const bg = css.getPropertyValue("--surface").trim() || "#fff";
    const pal = paletteOf(cv);
    const bk = bgKey + "|" + pal.key; // 테마가 바뀌면 그려 둔 그림을 다시 그려요
    if (layers) {
      const P = pathsOf(layers);
      let snap = viewSnap.current;
      if (!fast && (!snap || snap.key !== layers || snap.bg !== bk || snap.w !== w || snap.h !== h || snap.dpr !== dpr || !sameView(snap.v, v))) {
        const sc = snap && snap.w === w && snap.h === h && snap.dpr === dpr ? snap.cv : document.createElement("canvas");
        sc.width = Math.round(w * dpr);
        sc.height = Math.round(h * dpr);
        const sctx = sc.getContext("2d");
        if (sctx) {
          renderBg(sctx, P, off, v, w, h, dpr, pal);
          snap = { cv: sc, v: { ...v }, w, h, dpr, key: layers, bg: bk };
          viewSnap.current = snap;
        }
        if (!fullSnap.current || fullSnap.current.key !== layers || fullSnap.current.bg !== bk) {
          if (fullT.current) clearTimeout(fullT.current);
          fullT.current = window.setTimeout(buildFull, 120);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const full = fullSnap.current;
      if (snap && snap.bg === bk && sameView(snap.v, v) && snap.w === w && snap.h === h) ctx.drawImage(snap.cv, 0, 0, w, h);
      else {
        if (full && full.key === layers && full.bg === bk) blit(ctx, full, v, w, h);
        if (snap && snap.key === layers && snap.bg === bk) blit(ctx, snap, v, w, h); // 마지막으로 또렷하게 그린 그림을 위에 – 밖으로 남는 곳은 밑의 전체 그림이 채워요
      }
      const { ox, oy } = P;
      const s = v.s;
      const rf = state.current.regionFeats;
      if (rf.length && dim.current > 0) {
        if (regionPath.current?.key !== rf) regionPath.current = { key: rf, p: pathOf(rf, ox, oy, true) };
        const rp = regionPath.current.p;
        ctx.setTransform(s * dpr, 0, 0, -s * dpr, (w / 2 - (v.cx - ox) * s) * dpr, (h / 2 + (v.cy - oy) * s) * dpr);
        // 바깥 흐림: 화면 전체 − 그 읍면
        const outside = new Path2D();
        const [x0, y0] = [v.cx - ox - w / 2 / s, v.cy - oy - h / 2 / s];
        outside.rect(x0, y0, w / s, h / s);
        outside.addPath(rp);
        ctx.globalAlpha = 0.62 * dim.current;
        ctx.fillStyle = bg;
        ctx.fill(outside, "evenodd");
        ctx.globalAlpha = dim.current;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2.2 / s;
        ctx.stroke(rp);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }
    // 점: 화면 자리로 바꿔 같은 자리(9px 안)는 숫자 동그라미로 묶어요.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const out: Cluster[] = [];
    const grid = new Map<string, Cluster[]>();
    for (const p of state.current.points) {
      const sx = (p.x - v.cx) * v.s + w / 2;
      const sy = (v.cy - p.y) * v.s + h / 2;
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      const gx = Math.floor(sx / HIT);
      const gy = Math.floor(sy / HIT);
      let hit: Cluster | undefined;
      for (let dx = -1; dx <= 1 && !hit; dx++)
        for (let dy = -1; dy <= 1 && !hit; dy++)
          hit = grid.get(`${gx + dx},${gy + dy}`)?.find((c) => Math.hypot(c.sx - sx, c.sy - sy) < HIT);
      if (hit) hit.pts.push(p);
      else {
        const c = { sx, sy, pts: [p] };
        out.push(c);
        const k = `${gx},${gy}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(c);
      }
    }
    clusters.current = out;
    // 모양 지킴이가 닷을 누를 자리(또렷하게 다시 그릴 때만 적어요 – 움직이는 동안은 안 건드려요)
    if (!fast && wrapRef.current) {
      const one = out.find((c) => c.sx > 20 && c.sy > 20 && c.sx < w - 20 && c.sy < h - 20);
      wrapRef.current.dataset.dot = one ? `${Math.round(one.sx)},${Math.round(one.sy)}` : "";
    }
    const sel = state.current.selectedId;
    for (const c of out) {
      const isSel = sel != null && c.pts.some((p) => p.c.id === sel);
      if (c.pts.length > 1) {
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, 9, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
        ctx.fillStyle = onAccent; // 어둡게는 강조색이 밝아 어두운 글자(✔6)
        ctx.font = "600 11px Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(c.pts.length), c.sx, c.sy + 0.5);
      } else {
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, isSel ? 6.5 : 5, 0, Math.PI * 2);
        ctx.fillStyle = c.pts[0].color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
      if (isSel) {
        ctx.beginPath();
        ctx.arc(c.sx, c.sy, c.pts.length > 1 ? 13 : 10, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = accent;
        ctx.stroke();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, buildFull, bgKey]);

  /** 움직임이 멈추면 조금 뒤 또렷하게 다시 */
  const settle = useCallback(() => {
    if (settleT.current) clearTimeout(settleT.current);
    settleT.current = window.setTimeout(() => {
      settleT.current = null;
      draw();
    }, 140);
  }, [draw]);
  useEffect(() => () => {
    if (settleT.current) clearTimeout(settleT.current);
    if (fullT.current) clearTimeout(fullT.current);
  }, []);

  const animateTo = useCallback(
    (to: View, toDim: number, ms = ANIM_MS) => {
      if (anim.current) cancelAnimationFrame(anim.current);
      const from = view.current ?? to;
      const fromDim = dim.current;
      setHover(null);
      setPinned(null);
      if (ms <= 0 || !view.current) {
        view.current = to;
        dim.current = toDim;
        draw();
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const k = ease(Math.min(1, (t - t0) / ms));
        view.current = {
          cx: from.cx + (to.cx - from.cx) * k,
          cy: from.cy + (to.cy - from.cy) * k,
          s: Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * k),
        };
        dim.current = fromDim + (toDim - fromDim) * k;
        draw(k < 1); // 움직이는 동안은 그려 둔 그림을 늘려 붙이고, 끝 장면만 또렷하게
        anim.current = k < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [draw],
  );

  const home = useCallback(
    (ms = ANIM_MS) => {
      const b = focusBounds ?? layers?.bounds;
      const { w, h } = size.current;
      if (!b || !w) return;
      animateTo(fit(b, w, h), region ? 1 : 0, ms);
    },
    [focusBounds, layers, region, animateTo],
  );

  // 크기
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const cv = canvasRef.current;
    if (!el || !cv) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = !size.current.w;
      size.current = { w: r.width, h: r.height, dpr };
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      if (first || !view.current) home(0);
      else draw();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw, home]);

  // 읍면을 고르거나 풀면 부드럽게(처음 그릴 때는 바로)
  const lastFocus = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!layers) return;
    const key = region;
    const first = lastFocus.current === undefined || !view.current;
    lastFocus.current = key;
    home(first ? 0 : ANIM_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, region, focusBounds]);

  // 점·강조가 바뀌면 다시
  useEffect(() => {
    draw();
  }, [points, selectedId, draw]);

  // 목록에서 고른 점이 화면 밖이면 그쪽으로 옮겨요.
  useEffect(() => {
    const v = view.current;
    if (selectedId == null || !v) return;
    const p = points.find((q) => q.c.id === selectedId);
    if (!p) return;
    const { w, h } = size.current;
    const sx = (p.x - v.cx) * v.s + w / 2;
    const sy = (v.cy - p.y) * v.s + h / 2;
    if (sx < 24 || sy < 24 || sx > w - 24 || sy > h - 24) animateTo({ ...v, cx: p.x, cy: p.y }, dim.current, 300);
  }, [selectedId, points, animateTo]);

  // 휠 = 확대·축소(커서 기준)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = view.current;
      if (!v) return;
      e.preventDefault();
      if (anim.current) {
        cancelAnimationFrame(anim.current);
        anim.current = null;
      }
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const { w, h } = size.current;
      const k = Math.exp(-e.deltaY * 0.0015);
      const base = layers ? fit(layers.bounds, w, h).s : v.s;
      const s = Math.min(Math.max(v.s * k, base * 0.5), 6);
      const wx = v.cx + (mx - w / 2) / v.s;
      const wy = v.cy - (my - h / 2) / v.s;
      view.current = { s, cx: wx - (mx - w / 2) / s, cy: wy + (my - h / 2) / s };
      setHover(null);
      setPinned(null);
      draw(true);
      settle();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [draw, settle, layers]);

  // 끌기 = 이동 · 닷 한 번 누르기 = 닷카드 붙잡기 · 두 번 누르기 = 민원대장 그 줄(여러 건이면 카드 줄을 두 번 눌러요)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; btn: number } | null>(null);
  const lastTap = useRef<{ key: number; t: number } | null>(null);
  const hitAt = (mx: number, my: number) => {
    let best: Cluster | null = null;
    let bd = HIT + 1;
    for (const c of clusters.current) {
      const d = Math.hypot(c.sx - mx, c.sy - my);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".mp-btns, .mp-card, .mp-legend")) return;
    if (e.button !== 0 && e.button !== 1) return;
    const v = view.current;
    if (!v) return;
    if (e.button === 1) e.preventDefault();
    if (anim.current) {
      cancelAnimationFrame(anim.current);
      anim.current = null;
    }
    wrapRef.current?.focus({ preventScroll: true });
    wrapRef.current?.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false, btn: e.button };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const v = view.current;
    if (d && v) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      view.current = { ...v, cx: d.cx - dx / v.s, cy: d.cy + dy / v.s };
      if (hover) setHover(null);
      if (pinned) setPinned(null);
      draw(true);
      settle();
      return;
    }
    if ((e.target as HTMLElement).closest(".mp-btns, .mp-card, .mp-legend")) return;
    const [mx, my] = local(e);
    const c = hitAt(mx, my);
    if (c !== hover) setHover(c);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.btn !== 0) return;
    const [mx, my] = local(e);
    const c = hitAt(mx, my);
    if (!c) {
      setPinned(null);
      return;
    }
    // ✔2(사용자 11-02 22:19): 한 번 누르기 = 닷카드 붙잡기, 두 번 누르기 = 민원대장 그 줄
    const key = c.pts[0].c.id;
    const t = performance.now();
    const twice = lastTap.current && lastTap.current.key === key && t - lastTap.current.t < DOUBLE_MS;
    lastTap.current = twice ? null : { key, t };
    if (twice && c.pts.length === 1) onOpen(key);
    else setPinned(c);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (pinned) setPinned(null);
    else if (region) onWhole();
  };

  // 카드 자리 – 늘 지도 안(16:06)
  const card = pinned ?? hover;
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!card || !el) return setCardPos(null);
    const { w, h } = size.current;
    setCardPos(cardPlace(card.sx, card.sy, el.offsetWidth, el.offsetHeight, w, h));
  }, [card]);

  const zoomBy = (k: number) => {
    const v = view.current;
    if (v) animateTo({ ...v, s: v.s * k }, dim.current, 200);
  };

  return (
    <div className="mp-map" ref={wrapRef} tabIndex={0} aria-label="민원 지도" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => !drag.current && setHover(null)} onKeyDown={onKeyDown} onAuxClick={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className={hover ? "mp-canvas mp-hot" : "mp-canvas"} />
      {!layers && <div className="mp-wait">지도를 읽는 중이에요…</div>}
      <div className="mp-btns">
        <div className="mp-btn-pair">
          <button type="button" className="mp-btn" aria-label="확대" title="확대" onClick={() => zoomBy(1.6)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button type="button" className="mp-btn" aria-label="축소" title="축소" onClick={() => zoomBy(1 / 1.6)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
        </div>
        <button type="button" className="mp-btn mp-btn-one" aria-label="가운데로" title={region ? `가운데로 – ${region}` : "가운데로 – 파주시"} onClick={() => home()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>
        </button>
        <button type="button" className="mp-btn mp-btn-one mp-btn-home" aria-label="파주시 전체" title="파주시 전체" disabled={!region} onClick={onWhole}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" /></svg>
        </button>
      </div>
      {legend.length > 0 && (
        <div className="mp-legend" aria-label="범례">
          {legend.map((l) => (
            <span key={l.type} className="mp-lg">
              <i style={{ background: l.color }} />
              {l.type}
            </span>
          ))}
          <span className="mp-lg-sep" />
          <span className="mp-lg">
            <b className="mp-lg-n">2</b>같은 자리 여러 건
          </span>
        </div>
      )}
      {card && (
        <div ref={cardRef} className={"mp-card" + (pinned ? " mp-card-pin" : "")} style={cardPos ? { left: cardPos.left, top: cardPos.top } : { visibility: "hidden" }} onPointerLeave={() => !pinned && setHover(null)}>
          {card.pts.slice(0, 6).map((p) => {
            const [bg, fg] = statusColor(p.c.status);
            return (
              <button type="button" key={p.c.id} className="mp-card-row" title="두 번 누르면 민원대장 그 줄" onDoubleClick={() => onOpen(p.c.id)}>
                <b className="mp-card-place">{p.c.place || "(위치 없음)"}</b>
                <em className="mp-card-badge" style={{ background: bg, color: fg }}>{p.c.status}</em>
                <span className="mp-card-kind">
                  <i style={{ background: p.color }} />
                  {p.c.ctype || "기타"}
                </span>
                <span className="mp-card-sub">{[p.c.intake, p.c.received].filter(Boolean).join(", ")}</span>
              </button>
            );
          })}
          {card.pts.length > 6 && <span className="mp-card-more">그 밖 {card.pts.length - 6}건 – 확대해 보세요</span>}
        </div>
      )}
    </div>
  );
}
