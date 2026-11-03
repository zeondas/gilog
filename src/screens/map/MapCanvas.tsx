// 민원 지도 – 지도 한 장(✔3·✔4, 카카오 배경 2026-11-03 ✔1~✔4·✔6·✔7·✔10).
// 배경: 카카오 지도(키가 있고 불러지면) 위에 우리 그림판 한 장(닷·숫자 동그라미·읍면동 경계·도로구역·도시계획시설·재기)을 겹쳐요.
//   키가 없거나(미리 보기·check·지킴이) 6초 안에 못 불러오거나 8초 안에 지도 그림이 안 오면 연속주제도(앱에 넣은 배경)로 그려요.
// 카카오일 때: 끌기·휠은 카카오가 하고(부드러운 확대 – 움직이는 동안 우리 그림판은 잠깐 숨김), 우리 그림판은 카카오 화면 범위를 따라 다시 그려요.
// 연속주제도일 때: 휠 = 확대·축소(커서 기준) · 왼쪽 끌기·휠 클릭 끌기 = 이동 · 읍면을 고르면 약 0.5초 동안 부드럽게 확대.
// 오른쪽 위 단추: [+][−] · [가운데로] · [파주시 전체] · [층] · [거리][면적][반경] · [로드뷰](카카오일 때만, 지도 | 로드뷰 2분할).
// 11-03 ✔1~✔5(wip/map6): 그림판은 카카오 위(z 1) · 로드뷰 핀(rvPin.ts) · 카카오를 기다리는 동안에도 경계·닷 · 로드뷰를 열면 단추 줄은 로드뷰 × 아래 · 민원대장에서 받은 민원(focus).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type MapComplaint } from "../../api";
import { statusColor } from "../../settingsStore";
import { cardPlace, layerPaths, tracePath, type Feature, type Field, type Layers } from "./mapData";
import { kakaoFailWhy, kakaoKey, loadKakao, tmForward, tmInverse, TILES_MS, type Kakao } from "./kakao";
import { addPoint, finish, insideIds, summary, TOOLS, type Measure, type Pt, type Tool } from "./measure";
import { drawBubble, drawFan, drawHead, easeTo, headPose, leanOf, RV_HINT } from "./rvPin";

export type MapPoint = { c: MapComplaint; x: number; y: number; color: string };
export type Pin = { x: number; y: number; label: string };
type View = { cx: number; cy: number; s: number };
type Cluster = { sx: number; sy: number; pts: MapPoint[] };
type Mode = "wait" | "kakao" | "dxf";

/** [층] 상자(✔7): 겹쳐 보기 켜고 끄기 – 민원 닷·읍면동 경계는 처음 켜짐, 도로구역·도시계획시설은 처음 꺼짐 */
export type Show = { dots: boolean; emd: boolean; zone: boolean; plan: boolean; legend: boolean };
const SHOW0: Show = { dots: true, emd: true, zone: false, plan: false, legend: true };
const KV_SHOW = "map.show";
const SHOW_ROWS: { key: keyof Show; name: string; base?: boolean }[] = [
  { key: "dots", name: "민원 닷" },
  { key: "emd", name: "읍면동 경계" },
  { key: "zone", name: "도로구역", base: true },
  { key: "plan", name: "도시계획시설(도로)", base: true },
  { key: "legend", name: "범례" },
];

/** 지도 색은 CSS 토큰(map.css `.mp` – 밝게/어둡게 따로, ✔6)에서 읽어요. 칠하는 층은 fillLayers의 color가 토큰 이름이에요. */
type Palette = { get: (name: string) => string; key: string };
const PAL_NAMES = ["--map-road", "--map-plan", "--map-zone", "--map-line", "--map-nat", "--map-loc", "--map-small", "--map-park", "--map-measure", "--map-rv"];
function paletteOf(el: Element): Palette {
  const css = getComputedStyle(el);
  const m = new Map(PAL_NAMES.map((n) => [n, css.getPropertyValue(n).trim() || "#888"]));
  return { get: (n) => m.get(n) ?? n, key: [...m.values()].join(",") };
}
const ANIM_MS = 500;
const HIT = 9;
const DOUBLE_MS = 450; // 두 번 누르기로 보는 사이
const RV_RADIUS = 50; // 로드뷰: 이 거리(m) 안 가장 가까운 사진
const RV_MIN = 0.3;
const RV_MAX = 0.7;
const KAKAO_MAX_LEVEL = 10;

/** left = 왼쪽을 가리는 패널 폭(px) – 그만큼 비켜 가운데 맞춰요(11-03 ✔2) */
function fit(b: [number, number, number, number], w: number, h: number, pad = 28, left = 0): View {
  const bw = Math.max(1, b[2] - b[0]);
  const bh = Math.max(1, b[3] - b[1]);
  const s = Math.max(Math.min((w - left - pad * 2) / bw, (h - pad * 2) / bh), 1e-4);
  return { cx: (b[0] + b[2]) / 2 - left / 2 / s, cy: (b[1] + b[3]) / 2, s };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 칠하는 층은 closePath 없이(칠하기는 저절로 닫혀요) – 고리마다 closePath를 부르면 Chromium이 고리 수의 제곱으로 느려져
 *  48,848고리에서 20초 넘게 멈췄어요(0.68.0 멈춤 ①). 선으로 긋는 경계만 닫아요. */
function pathOf(feats: Feature[], ox: number, oy: number, close = false): Path2D {
  const p = new Path2D();
  tracePath(p, feats, ox, oy, close);
  return p;
}

/** 배경 그림 한 장: 그 그림을 그린 보기(view)와 크기(CSS px). key = 자료 + 분야·꺼 둔 층·배경 방식(bg) */
type Snap = { cv: HTMLCanvasElement; v: View; w: number; h: number; dpr: number; key: Layers; bg: string };
type Paths = { key: Layers; field: Field; ox: number; oy: number; fills: { id: string; color: string; minScale?: number; p: Path2D }[]; emd: Path2D };
/** 배경 그리기 방식: 연속주제도 = 분야의 층 전부 · 카카오 = 켠 층(도로구역·도시계획시설)만 반투명으로 */
type BgOpt = { only: Set<string> | null; alpha: number; emd: boolean; emdW: number };

/** 전체 보기(확대 배율이 minScale보다 작을 때)에는 도시계획도로를 빼고 그려요 – 그 크기에선 어차피 안 보여요(0.68.0 멈춤 ②). */
function renderBg(ctx: CanvasRenderingContext2D, P: Paths, off: Set<string>, v: View, w: number, h: number, dpr: number, pal: Palette, o: BgOpt) {
  const { ox, oy } = P;
  const s = v.s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(s * dpr, 0, 0, -s * dpr, (w / 2 - (v.cx - ox) * s) * dpr, (h / 2 + (v.cy - oy) * s) * dpr);
  ctx.globalAlpha = o.alpha;
  for (const f of P.fills) {
    if (off.has(f.id) || (o.only && !o.only.has(f.id)) || (f.minScale && s < f.minScale)) continue;
    ctx.fillStyle = pal.get(f.color);
    ctx.fill(f.p);
  }
  ctx.globalAlpha = 1;
  if (o.emd) {
    ctx.strokeStyle = pal.get("--map-line");
    ctx.lineWidth = o.emdW / s;
    ctx.stroke(P.emd);
  }
}

/** 그려 둔 배경 그림을 지금 보기에 맞춰 늘리고 옮겨 붙여요(움직이는 동안 – 한 장면 몇 ms). */
function blit(ctx: CanvasRenderingContext2D, snap: Snap, v: View, w: number, h: number) {
  const k = v.s / snap.v.s;
  const left = w / 2 - (snap.w / 2) * k + (snap.v.cx - v.cx) * v.s;
  const top = h / 2 - (snap.h / 2) * k + (v.cy - snap.v.cy) * v.s;
  ctx.drawImage(snap.cv, left, top, snap.w * k, snap.h * k);
}

const sameView = (a: View, b: View) => a.cx === b.cx && a.cy === b.cy && a.s === b.s;

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const TOOL_ICON: Record<Tool, string> = {
  dist: "M4 18L10 9l5 5 5-9 M4 18h.01 M10 9h.01 M15 14h.01 M20 5h.01",
  area: "M5 7l7-3 7 5-2 10H7z",
  radius: "M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0 M12 12h8",
};

type Props = {
  layers: Layers | null;
  /** 분야(✔3): 도로 = 도로 층 · 하천 = 하천 면 · 공원 = 공원 면(연속주제도일 때) */
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
  /** 주소 검색에서 고른 자리(빨간 핀, ✔5) – 바뀌면 그리로 옮겨요 */
  pin: Pin | null;
  onOpen: (id: number) => void;
  onWhole: () => void;
  /** 면적·반경 안 민원만 왼쪽 목록에(✔6) – null = 풀기 */
  onPick: (ids: number[] | null) => void;
  /** 배경 방식이 정해지면(주소 검색이 카카오를 쓸 수 있는지) */
  onMode?: (kakao: boolean) => void;
  /** 지도 위 왼쪽 위에 띄우는 것(검색창·거르기 배지·민원현황 패널 – 11-03 ✔2). 그 안 누르기는 지도가 받지 않아요(.mp-ov). */
  overlay?: ReactNode;
  /** 왼쪽 패널이 열려 있으면 범례·안내를 그만큼 오른쪽으로(px) */
  leftInset?: number;
  /** 민원대장에서 받은 민원(✔5): 그 점으로 옮겨 닷카드를 열어요. n이 바뀔 때마다 */
  focus?: { id: number; x: number; y: number; n: number } | null;
};

export default function MapCanvas({ layers, field, off, points, region, regionFeats, focusBounds, selectedId, legend, pin, onOpen, onWhole, onPick, onMode, overlay, leftInset = 0, focus = null }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const kdivRef = useRef<HTMLDivElement>(null);
  const rvDivRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const measRef = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const view = useRef<View | null>(null);
  const dim = useRef(0); // 바깥 흐림 0~1
  const anim = useRef<number | null>(null);
  const clusters = useRef<Cluster[]>([]);
  const paths = useRef<Paths | null>(null);
  const kk = useRef<Kakao | null>(null);
  const kmap = useRef<Kakao | null>(null);
  const rvObj = useRef<{ rv: Kakao; client: Kakao } | null>(null);
  const rvPos = useRef<Pt | null>(null);
  const live = useRef<Pt | null>(null);
  const inset = useRef(leftInset);
  inset.current = leftInset;
  // 로드뷰 핀(✔2): 마우스 자리·기울기(지금 값 → 목표)·로드뷰가 보는 쪽
  const rvPan = useRef(0);
  const rvMouse = useRef<Pt | null>(null);
  const pose = useRef({ look: 0, lean: 0 });
  const poseTo = useRef({ look: 0, lean: 0 });
  const poseRaf = useRef<number | null>(null);
  const stillT = useRef<number | null>(null);
  const pendingCard = useRef<number | null>(null);

  const [mode, setMode] = useState<Mode>("wait");
  const [failed, setFailed] = useState(""); // 카카오를 못 불러온 까닭(빈 글 = 실패 아님)
  const [measOpen, setMeasOpen] = useState(false);
  const [show, setShow] = useState<Show>(SHOW0);
  const [layerPop, setLayerPop] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [rv, setRv] = useState<{ x: number; y: number; n: number } | null>(null);
  const [rvMsg, setRvMsg] = useState("");
  const [rvRatio, setRvRatio] = useState(0.5);
  const kakao = mode === "kakao";
  const bgField: Field = kakao ? "road" : field;
  const bgKey = [mode, bgField, [...off].sort().join(","), show.emd ? 1 : 0, show.zone ? 1 : 0, show.plan ? 1 : 0].join("|");
  const [hover, setHover] = useState<Cluster | null>(null);
  const [pinned, setPinned] = useState<Cluster | null>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const state = useRef({ points, region, regionFeats, selectedId, show, measure, pin, mode, rvOn: false });
  state.current = { points, region, regionFeats, selectedId, show, measure, pin, mode, rvOn: rv != null };

  const viewSnap = useRef<Snap | null>(null);
  const fullSnap = useRef<Snap | null>(null);
  const regionPath = useRef<{ key: Feature[]; p: Path2D } | null>(null);
  const settleT = useRef<number | null>(null);
  const fullT = useRef<number | null>(null);

  // [층] 저장값
  useEffect(() => {
    api.get(KV_SHOW).then((v) => {
      try {
        const o = v ? (JSON.parse(v) as Partial<Show>) : {};
        setShow({ ...SHOW0, ...Object.fromEntries(Object.entries(o).filter(([k, x]) => k in SHOW0 && typeof x === "boolean")) });
      } catch {
        /* 처음 값 */
      }
    }).catch(() => {});
  }, []);
  const saveShow = (s: Show) => {
    setShow(s);
    api.set(KV_SHOW, JSON.stringify(s)).catch(() => {});
  };

 // 카카오를 기다리는 동안(✔3): 칠하는 층 없이 읍면동 경계만 – 카카오가 오면 그 밑에 깔려요
  const bgOpt = (): BgOpt =>
    mode === "wait"
      ? { only: new Set(), alpha: 1, emd: show.emd, emdW: 1.4 }
      : kakao
      ? { only: new Set([...(show.zone ? ["zone"] : []), ...(show.plan ? ["plan"] : [])]), alpha: 0.5, emd: show.emd, emdW: 1.4 }
      : { only: null, alpha: 1, emd: show.emd, emdW: 0.9 };

  const pathsOf = (L: Layers): Paths => {
    let P = paths.current;
    if (!P || P.key !== L || P.field !== bgField) {
      P = { key: L, field: bgField, ...layerPaths(L, () => new Path2D(), bgField) };
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
    renderBg(ctx, pathsOf(layers), off, v, cw, ch, dpr, pal, bgOpt());
    fullSnap.current = { cv, v, w: cw, h: ch, dpr, key: layers, bg: bgKey + "|" + pal.key };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, bgKey]);

  /** 그림판 좌표 → 화면 자리 */
  const toScreen = (x: number, y: number, v: View, w: number, h: number): Pt => [(x - v.cx) * v.s + w / 2, (v.cy - y) * v.s + h / 2];

  /** fast = 움직이는 중(그려 둔 그림을 늘려 붙임) · 아니면 지금 보기로 또렷하게(같은 보기면 그려 둔 것을 그대로) */
  const draw = useCallback((fast = false) => {
    const cv = canvasRef.current;
    const v = view.current;
    if (!cv || !v) return;
    const { w, h, dpr } = size.current;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const st = state.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
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
          renderBg(sctx, P, off, v, w, h, dpr, pal, bgOpt());
          snap = { cv: sc, v: { ...v }, w, h, dpr, key: layers, bg: bk };
          viewSnap.current = snap;
        }
        if (!fullSnap.current || fullSnap.current.key !== layers || fullSnap.current.bg !== bk) {
          if (fullT.current) clearTimeout(fullT.current);
          fullT.current = window.setTimeout(buildFull, 120);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const full = fullSnap.current;
      if (snap && snap.bg === bk && sameView(snap.v, v) && snap.w === w && snap.h === h) ctx.drawImage(snap.cv, 0, 0, w, h);
      else {
        if (full && full.key === layers && full.bg === bk) blit(ctx, full, v, w, h);
        if (snap && snap.key === layers && snap.bg === bk) blit(ctx, snap, v, w, h); // 마지막으로 또렷하게 그린 그림을 위에 – 밖으로 남는 곳은 밑의 전체 그림이 채워요
      }
      const { ox, oy } = P;
      const s = v.s;
      const rf = st.regionFeats;
      if (rf.length && dim.current > 0) {
        if (regionPath.current?.key !== rf) regionPath.current = { key: rf, p: pathOf(rf, ox, oy, true) };
        const rp = regionPath.current.p;
        ctx.setTransform(s * dpr, 0, 0, -s * dpr, (w / 2 - (v.cx - ox) * s) * dpr, (h / 2 + (v.cy - oy) * s) * dpr);
        // 바깥 흐림: 화면 전체 − 그 읍면
        const outside = new Path2D();
        const [x0, y0] = [v.cx - ox - w / 2 / s, v.cy - oy - h / 2 / s];
        outside.rect(x0, y0, w / s, h / s);
        outside.addPath(rp);
        ctx.globalAlpha = (st.mode === "kakao" ? 0.45 : 0.62) * dim.current;
        ctx.fillStyle = bg;
        ctx.fill(outside, "evenodd");
        ctx.globalAlpha = dim.current;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2.2 / s;
        ctx.stroke(rp);
        ctx.globalAlpha = 1;
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 재기(✔6): 선·다각형·원 – 우리 그림판에(카카오든 연속주제도든 같아요)
    const m = st.measure;
    const mc = pal.get("--map-measure");
    if (m && m.pts.length) {
      const pts = (live.current && !m.done ? [...m.pts, live.current] : m.pts).map(([x, y]) => toScreen(x, y, v, w, h));
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = mc;
      ctx.fillStyle = mc;
      ctx.beginPath();
      if (m.tool === "radius") {
        if (pts.length >= 2) {
          const r = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
          ctx.arc(pts[0][0], pts[0][1], r, 0, Math.PI * 2);
          ctx.globalAlpha = 0.14;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.setLineDash([5, 4]);
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.lineTo(pts[1][0], pts[1][1]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (m.tool === "area" && pts.length >= 3) {
          ctx.closePath();
          ctx.globalAlpha = 0.14;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.stroke();
      }
      for (const [x, y] of pts.slice(0, m.done || !live.current ? undefined : -1)) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = mc;
        ctx.stroke();
      }
      // 결과 상자는 마지막 점 옆에(지도 안)
      const lab = measRef.current;
      if (lab) {
        const last = m.tool === "radius" ? pts[Math.min(1, pts.length - 1)] : toScreen(m.pts[m.pts.length - 1][0], m.pts[m.pts.length - 1][1], v, w, h);
        const p = cardPlace(last[0], last[1], lab.offsetWidth, lab.offsetHeight, w, h, 10);
        lab.style.left = `${p.left}px`;
        lab.style.top = `${p.top}px`;
        lab.style.visibility = "visible";
      }
    }
    // 점: 화면 자리로 바꿔 같은 자리(9px 안)는 숫자 동그라미로 묶어요. [층]에서 끄면 안 그려요(✔7).
    const out: Cluster[] = [];
    const grid = new Map<string, Cluster[]>();
    for (const p of st.show.dots ? st.points : []) {
      const [sx, sy] = toScreen(p.x, p.y, v, w, h);
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
    // 민원대장에서 받은 민원(✔5): 옮긴 뒤 처음 또렷하게 그릴 때 그 닷카드를 붙잡아요
    if (!fast && pendingCard.current != null) {
      const id = pendingCard.current;
      const c = out.find((q) => q.pts.some((p) => p.c.id === id));
      if (c) {
        pendingCard.current = null;
        setPinned(c);
      }
    }
    // 모양 지킴이가 닷을 누를 자리(또렷하게 다시 그릴 때만 적어요 – 움직이는 동안은 안 건드려요)
    if (!fast && wrapRef.current) {
      const one = out.find((c) => c.sx > 20 && c.sy > 20 && c.sx < w - 20 && c.sy < h - 20);
      wrapRef.current.dataset.dot = one ? `${Math.round(one.sx)},${Math.round(one.sy)}` : "";
    }
    const sel = st.selectedId;
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
    // 지금 로드뷰 자리(✔2): 발밑 부채꼴 + 보는 쪽으로 고개를 돌린 머리
    if (rvPos.current) {
      const [x, y] = toScreen(rvPos.current[0], rvPos.current[1], v, w, h);
      drawFan(ctx, x, y, rvPan.current, pal.get("--map-rv"));
      const hp = headPose(rvPan.current);
      drawHead(ctx, x, y, hp.look, hp.front);
    }
    // 주소 검색 핀(✔5): 빨간 핀 – 닷 위에
    if (st.pin) {
      const [x, y] = toScreen(st.pin.x, st.pin.y, v, w, h);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 3, y - 8, x - 9, y - 12, x - 9, y - 19);
      ctx.arc(x, y - 19, 9, Math.PI, 0);
      ctx.bezierCurveTo(x + 9, y - 12, x + 3, y - 8, x, y);
      ctx.fillStyle = "#E5484D";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - 19, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
    // 마우스 핀(✔2): 로드뷰가 켜져 있으면 손 대신 – 맨 위
    const mp = rvMouse.current;
    if (st.rvOn && mp) {
      drawHead(ctx, mp[0], mp[1], pose.current.look, 1, pose.current.lean);
      drawBubble(ctx, mp[0], mp[1], RV_HINT, w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, buildFull, bgKey]);

  /** 기울기를 목표까지 한 장면씩(다 오면 멈춰요) */
  const runPose = useCallback(() => {
    if (poseRaf.current != null) return;
    const step = () => {
      const done = easeTo(pose.current, poseTo.current);
      draw(true);
      poseRaf.current = done ? null : requestAnimationFrame(step);
    };
    poseRaf.current = requestAnimationFrame(step);
  }, [draw]);
  /** 마우스 핀을 옮기거나(p) 숨겨요(null). 움직인 쪽으로 기울고 140ms 멈추면 정면으로. */
  const movePin = useCallback(
    (p: Pt | null) => {
      const el = wrapRef.current;
      const on = state.current.rvOn && p != null;
      el?.classList.toggle("mp-rvpin", on);
      const prev = rvMouse.current;
      if (!on) {
        if (prev) {
          rvMouse.current = null;
          draw(true);
        }
        return;
      }
      if (prev) poseTo.current = leanOf(p[0] - prev[0]);
      else pose.current = { look: 0, lean: 0 };
      rvMouse.current = p;
      if (stillT.current) clearTimeout(stillT.current);
      stillT.current = window.setTimeout(() => {
        poseTo.current = { look: 0, lean: 0 };
        runPose();
      }, 140);
      draw(true);
      runPose();
    },
    [draw, runPose],
  );
  useEffect(() => () => {
    if (poseRaf.current != null) cancelAnimationFrame(poseRaf.current);
    if (stillT.current) clearTimeout(stillT.current);
  }, []);

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

  // ---------- 카카오 ----------
  /** 카카오 화면 범위 → 우리 보기(가운데·배율). 위경도로 받아 5181로 바꿔요 – 카카오 속 좌표계와 상관없이 맞아요. */
  const syncView = useCallback(() => {
    const m = kmap.current;
    const k = kk.current;
    const { w, h } = size.current;
    if (!m || !k || !w) return;
    const c = m.getCenter();
    const [cx, cy] = tmForward(c.getLat(), c.getLng());
    const p2 = m.getProjection().coordsFromContainerPoint(new k.maps.Point(w / 2 + 200, h / 2));
    const [x2] = tmForward(p2.getLat(), p2.getLng());
    const s = 200 / Math.max(1e-6, x2 - cx);
    view.current = { cx, cy, s };
  }, []);
  const latLng = (x: number, y: number) => {
    const [lat, lon] = tmInverse(x, y);
    return new kk.current.maps.LatLng(lat, lon);
  };
  const kakaoFit = (b: [number, number, number, number]) => {
    const m = kmap.current;
    const k = kk.current;
    if (!m || !k) return;
    const lb = new k.maps.LatLngBounds(latLng(b[0], b[1]), latLng(b[2], b[3]));
    m.setBounds(lb, 28, 28, 28, 28 + inset.current);
  };

  /** 카카오 → 연속주제도(못 불러옴) */
  const fallback = useCallback((why: string) => {
    kmap.current = null;
    rvObj.current = null;
    if (kdivRef.current) kdivRef.current.innerHTML = "";
    setRv(null);
    setFailed(why);
    setMode("dxf");
  }, []);

  // 키 → SDK 부르기(✔4: 설정 칸 → 넣어 둔 키 → 없으면 연속주제도)
  useEffect(() => {
    let alive = true;
    (async () => {
      const key = await kakaoKey();
      if (!alive) return;
      if (!key) return setMode("dxf");
      const k = await loadKakao(key);
      if (!alive) return;
      if (!k) {
        setFailed(kakaoFailWhy() || "카카오 지도를 불러오지 못했어요");
        // 카카오가 돌려준 거절 글은 조금 늦게 읽혀요 – 읽히면 안내를 바꿔요
        window.setTimeout(() => alive && setFailed(kakaoFailWhy() || "카카오 지도를 불러오지 못했어요"), 2000);
        return setMode("dxf");
      }
      kk.current = k;
      setMode("kakao");
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => onMode?.(kakao), [kakao, onMode]);

  // 카카오 지도 만들기(배경 자료가 있어야 처음 범위를 알아요)
  useEffect(() => {
    const k = kk.current;
    const div = kdivRef.current;
    if (mode !== "kakao" || !layers || kmap.current || !k || !div) return;
    let m: Kakao;
    try {
      const b = layers.bounds;
      m = new k.maps.Map(div, { center: latLng((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), level: KAKAO_MAX_LEVEL, disableDoubleClickZoom: true });
      m.setMaxLevel(KAKAO_MAX_LEVEL);
      m.setCopyrightPosition(k.maps.CopyrightPosition.BOTTOMRIGHT, true);
    } catch {
      fallback("카카오 지도를 만들지 못했어요");
      return;
    }
    kmap.current = m;
    let tiles = false;
    const ev = k.maps.event;
    ev.addListener(m, "tilesloaded", () => {
      tiles = true;
    });
    const t = window.setTimeout(() => {
      if (!tiles && kmap.current === m) fallback("카카오 지도 그림이 8초 안에 오지 않았어요(보안 허용 목록·인터넷)");
    }, TILES_MS);
    const cv = canvasRef.current;
    ev.addListener(m, "center_changed", () => {
      syncView();
      draw(true);
    });
    // 부드러운 확대(✔3): 움직이는 동안(약 0.3초) 우리 그림판은 잠깐 숨기고, 끝나면 다시 그려요.
    ev.addListener(m, "zoom_start", () => {
      if (cv) cv.style.opacity = "0";
      setHover(null);
      setPinned(null);
    });
    ev.addListener(m, "idle", () => {
      syncView();
      draw();
      if (cv) cv.style.opacity = "";
    });
    const fb = focusBounds ?? layers.bounds;
    kakaoFit(fb);
    syncView();
    draw();
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, layers]);

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
      if (kmap.current) {
        setHover(null);
        setPinned(null);
        dim.current = region ? 1 : 0;
        kakaoFit(b);
        syncView();
        draw();
        return;
      }
      animateTo(fit(b, w, h, 28, inset.current), region ? 1 : 0, ms);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusBounds, layers, region, animateTo, draw, syncView],
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
      if (kmap.current) {
        kmap.current.relayout();
        syncView();
        draw();
      } else if (first || !view.current) home(0);
      else draw();
      rvObj.current?.rv.relayout();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw, home, syncView]);

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

  // 점·강조·방식·층·재기가 바뀌면 다시
  useEffect(() => {
    draw();
  }, [points, selectedId, draw, mode, show, measure, pin]);

  // 목록에서 고른 점이 화면 밖이면 그쪽으로 옮겨요.
  const panTo = useCallback(
    (x: number, y: number, ms = 300) => {
      const v = view.current;
      if (!v) return;
      if (kmap.current) kmap.current.panTo(latLng(x, y));
      else animateTo({ ...v, cx: x, cy: y }, dim.current, ms);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animateTo],
  );
  useEffect(() => {
    const v = view.current;
    if (selectedId == null || !v) return;
    const p = points.find((q) => q.c.id === selectedId);
    if (!p) return;
    const { w, h } = size.current;
    const [sx, sy] = toScreen(p.x, p.y, v, w, h);
    if (sx < 24 || sy < 24 || sx > w - 24 || sy > h - 24) panTo(p.x, p.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, points, panTo]);

  // 주소 검색 핀: 그리로 옮기고 확대(✔5)
  useEffect(() => {
    if (!pin) return;
    const m = kmap.current;
    if (m) {
      m.setLevel(3);
      m.setCenter(latLng(pin.x, pin.y));
    } else {
      const v = view.current;
      if (v) animateTo({ cx: pin.x, cy: pin.y, s: Math.max(v.s, 0.5) }, dim.current, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // 민원대장에서 받은 민원(✔5): 그리로 옮기고 확대 → 그 닷카드
  useEffect(() => {
    if (!focus) return;
    pendingCard.current = focus.id;
    const m = kmap.current;
    if (m) {
      m.setLevel(3);
      m.setCenter(latLng(focus.x, focus.y));
      syncView();
      draw();
    } else {
      const v = view.current;
      if (v) animateTo({ cx: focus.x, cy: focus.y, s: Math.max(v.s, 0.5) }, dim.current, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n, mode]);

  // 휠 = 확대·축소(커서 기준) – 연속주제도일 때만(카카오는 카카오가 해요)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || kakao) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".mp-ov, .mp-layerpop, .mp-card")) return; // 패널 목록 굴리기는 지도가 받지 않아요
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
  }, [draw, settle, layers, kakao]);

  // ---------- 로드뷰(✔1·✔10) ----------
  const openRv = (x: number, y: number) => setRv((o) => ({ x, y, n: (o?.n ?? 0) + 1 }));
  const closeRv = useCallback(() => {
    const m = kmap.current;
    const k = kk.current;
    if (m && k) m.removeOverlayMapTypeId(k.maps.MapTypeId.ROADVIEW);
    rvObj.current = null;
    rvPos.current = null;
    rvMouse.current = null;
    wrapRef.current?.classList.remove("mp-rvpin");
    setRv(null);
    setRvMsg("");
  }, []);
  useEffect(() => {
    const k = kk.current;
    const m = kmap.current;
    const div = rvDivRef.current;
    if (!rv || !k || !m || !div) return;
    if (!rvObj.current) {
      try {
        const r = new k.maps.Roadview(div);
        const client = new k.maps.RoadviewClient();
        rvObj.current = { rv: r, client };
        m.addOverlayMapTypeId(k.maps.MapTypeId.ROADVIEW); // 로드뷰 있는 길(파란 선)
        k.maps.event.addListener(r, "position_changed", () => {
          const p = r.getPosition();
          rvPos.current = tmForward(p.getLat(), p.getLng());
          draw();
        });
        // 로드뷰를 돌리면 지도 위 머리·부채꼴도 같이(✔2)
        k.maps.event.addListener(r, "viewpoint_changed", () => {
          rvPan.current = r.getViewpoint().pan;
          draw(true);
        });
        m.relayout();
      } catch {
        setRvMsg("로드뷰를 열지 못했어요");
        return;
      }
    }
    const pos = latLng(rv.x, rv.y);
    const { rv: r, client } = rvObj.current;
    client.getNearestPanoId(pos, RV_RADIUS, (pano: number | null) => {
      if (pano == null) {
        setRvMsg("이 근처엔 로드뷰가 없어요");
        return;
      }
      setRvMsg("");
      r.setPanoId(pano, pos);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rv]);
  useLayoutEffect(() => {
    // 2분할 폭이 바뀌면 카카오 둘 다 다시 재요
    kmap.current?.relayout();
    rvObj.current?.rv.relayout();
  }, [rvRatio, rv != null]);

  // 2분할 경계 끌기
  const dragRv = useRef<{ x: number; r: number; w: number } | null>(null);
  const onRvGrip = (e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!box) return;
    dragRv.current = { x: e.clientX, r: rvRatio, w: box.getBoundingClientRect().width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onRvGripMove = (e: React.PointerEvent) => {
    const d = dragRv.current;
    if (d) setRvRatio(Math.max(RV_MIN, Math.min(RV_MAX, d.r - (e.clientX - d.x) / d.w)));
  };

  // ---------- 재기(✔6) ----------
  const pickTool = (t: Tool) => {
    live.current = null;
    if (tool === t) {
      setTool(null);
      setMeasure(null);
      onPick(null);
      return;
    }
    setTool(t);
    setMeasure({ tool: t, pts: [], done: false });
    onPick(null);
    setPinned(null);
  };
  const clearMeasure = useCallback(() => {
    live.current = null;
    setTool(null);
    setMeasure(null);
    onPick(null);
  }, [onPick]);
  const inside = useMemo(() => (measure ? insideIds(measure, points.map((p) => ({ id: p.c.id, x: p.x, y: p.y }))) : []), [measure, points]);
  const sum = measure ? summary(measure) : null;

  // Esc: 로드뷰 닫기 → 재기 취소 → 카드 → 파주시 전체
  const escape = useCallback(() => {
    if (rv) closeRv();
    else if (measure || measOpen) {
      clearMeasure();
      setMeasOpen(false);
    }
    else if (pinned) setPinned(null);
    else if (region) onWhole();
    else return false;
    return true;
  }, [rv, measure, measOpen, pinned, region, closeRv, clearMeasure, onWhole]);
  useEffect(() => {
    if (!rv && !measure) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && !wrapRef.current?.contains(t)) return;
      if (escape()) e.preventDefault();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [rv, measure, escape]);

  // ---------- 누르기·끌기 ----------
  // 연속주제도: 끌기 = 이동. 카카오: 끌기는 카카오가 하고, 우리는 "안 움직인 누르기"만 봐요(닷·재기·로드뷰 자리).
  // 카카오가 이벤트를 먹어도 받도록 붙잡는 단계(capture)에서 들어요.
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; btn: number } | null>(null);
  const lastTap = useRef<{ key: number; t: number; x: number; y: number } | null>(null);
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
  const world = (mx: number, my: number): Pt | null => {
    const v = view.current;
    if (!v) return null;
    const { w, h } = size.current;
    return [v.cx + (mx - w / 2) / v.s, v.cy - (my - h / 2) / v.s];
  };
  const OVER = ".mp-btns, .mp-card, .mp-legend, .mp-lgpill, .mp-meas, .mp-layerpop, .mp-note, .mp-ov";
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(OVER)) return;
    if (e.button !== 0 && e.button !== 1) return;
    const v = view.current;
    if (!v) return;
    setLayerPop(false);
    if (anim.current) {
      cancelAnimationFrame(anim.current);
      anim.current = null;
    }
    wrapRef.current?.focus({ preventScroll: true });
    if (!kakao) {
      if (e.button === 1) e.preventDefault();
      wrapRef.current?.setPointerCapture(e.pointerId);
    }
    drag.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false, btn: e.button };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current && e.buttons === 0) drag.current = null; // 지도 밖에서 뗀 누르기
    const d = drag.current;
    const v = view.current;
    if (d && v) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      movePin(null);
      if (hover) setHover(null);
      if (pinned) setPinned(null);
      if (kakao) return; // 카카오가 옮겨요
      view.current = { ...v, cx: d.cx - dx / v.s, cy: d.cy + dy / v.s };
      draw(true);
      settle();
      return;
    }
    if ((e.target as HTMLElement).closest(OVER)) return movePin(null);
    const [mx, my] = local(e);
    if (measure && !measure.done) {
      live.current = world(mx, my);
      movePin(null);
      draw();
      return;
    }
    const c = hitAt(mx, my);
    if (c !== hover) setHover(c);
    movePin(c || tool ? null : [mx, my]); // 닷 위에선 손가락, 그 밖은 로드뷰 핀(✔2)
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.btn !== 0) return;
    const [mx, my] = local(e);
    const t = performance.now();
    const last = lastTap.current;
    const near = last && t - last.t < DOUBLE_MS && Math.hypot(last.x - mx, last.y - my) < 6;
    // 재기: 한 번 = 점 더하기, 두 번 = 끝(같은 자리에 점을 또 찍지 않아요)
    if (tool && measure) {
      const p = world(mx, my);
      if (!p) return;
      if (near && !measure.done) {
        lastTap.current = null;
        live.current = null;
        setMeasure(finish(measure));
        return;
      }
      lastTap.current = { key: -1, t, x: mx, y: my };
      setMeasure(addPoint(measure, p));
      return;
    }
    const c = hitAt(mx, my);
    if (!c) {
      setPinned(null);
      // 로드뷰가 열려 있으면 누른 자리로(파란 선 위)
      if (rv) {
        const p = world(mx, my);
        if (p) openRv(p[0], p[1]);
      }
      return;
    }
    // ✔2(사용자 11-02 22:19): 한 번 누르기 = 닷카드 붙잡기, 두 번 누르기 = 민원대장 그 줄
    const key = c.pts[0].c.id;
    const twice = last && last.key === key && t - last.t < DOUBLE_MS;
    lastTap.current = twice ? null : { key, t, x: mx, y: my };
    if (twice && c.pts.length === 1) onOpen(key);
    else setPinned(c);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (escape()) e.preventDefault();
  };

  // 카드 자리 – 늘 지도 안(16:06)
  const card = pinned ?? hover;
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!card || !el) return setCardPos(null);
    const { w, h } = size.current;
    setCardPos(cardPlace(card.sx, card.sy, el.offsetWidth, el.offsetHeight, w, h));
  }, [card]);
  // 재기 상자 자리는 그릴 때 정해요(내용이 바뀌면 다시)
  useLayoutEffect(() => {
    if (measure && measure.pts.length) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sum?.main, sum?.sub, inside.length]);

  const zoomBy = (k: number) => {
    const m = kmap.current;
    if (m) {
      m.setLevel(m.getLevel() + (k > 1 ? -1 : 1), { animate: true });
      return;
    }
    const v = view.current;
    if (v) animateTo({ ...v, s: v.s * k }, dim.current, 200);
  };
  const toggleRv = () => {
    if (rv) return closeRv();
    const v = view.current;
    if (v) openRv(v.cx, v.cy); // 처음엔 지도 가운데에서 가장 가까운 로드뷰
  };

  // 오른쪽 단추 줄(11-03 ✔5) – 로드뷰를 열면 로드뷰 × 아래 같은 세로줄로 옮겨요(✔4: 캡처할 때 오른쪽 끝만 빼면 "왼쪽 위치도 · 오른쪽 현장 사진")
  const btns = (
    <div className="mp-btns">
      <div className="mp-rgrp">
        <button type="button" className={"mp-btn" + (rv ? " mp-btn-on" : "")} aria-pressed={!!rv} aria-label="로드뷰" title={kakao ? "로드뷰 – 지도 | 로드뷰로 나눠 봐요" : "로드뷰는 카카오 지도일 때만 볼 수 있어요"} disabled={!kakao} onClick={toggleRv}>
          <Icon d="M12 4a2 2 0 1 0 0 .01 M9 21l1-7-2-2 2-4h4l2 4-2 2 1 7" />
        </button>
        <div className="mp-layerwrap">
          <button
            type="button"
            className={"mp-btn" + (tool || measOpen ? " mp-btn-on" : "")}
            aria-label="재기"
            title="거리·면적·반경 재기"
            aria-expanded={measOpen}
            onClick={() => {
              if (tool) {
                clearMeasure();
                setMeasOpen(false);
              } else setMeasOpen(!measOpen);
              setLayerPop(false);
            }}
          >
            <Icon d="M3 17l6-6 4 4 8-8 M14 7h7v7" />
          </button>
          {(measOpen || tool) && (
            <div className="mp-fly" role="group" aria-label="거리·면적·반경">
              {TOOLS.map((t) => (
                <button key={t.key} type="button" className={tool === t.key ? "mp-fly-on" : ""} aria-pressed={tool === t.key} aria-label={t.name} title={`${t.name} 재기`} onClick={() => pickTool(t.key)}>
                  <Icon size={14} d={TOOL_ICON[t.key]} />
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mp-layerwrap">
          <button
            type="button"
            className={"mp-btn" + (layerPop ? " mp-btn-on" : "")}
            aria-label="층"
            title="층 – 겹쳐 보기 켜고 끄기"
            aria-expanded={layerPop}
            onClick={() => {
              setLayerPop(!layerPop);
              if (!tool) setMeasOpen(false);
            }}
          >
            <Icon d="M12 3l9 5-9 5-9-5z M3 13l9 5 9-5" />
          </button>
          {layerPop && (
            <div className="mp-pop mp-layerpop" role="dialog" aria-label="층">
              <span className="mp-layerpop-cap">겹쳐 보기</span>
              {SHOW_ROWS.map((r) => {
                const always = !kakao && r.base; // 연속주제도에선 도로 층이 바탕이라 늘 보여요
                return (
                  <label key={r.key} className="mp-check" title={always ? "연속주제도에선 늘 보여요" : undefined}>
                    <input type="checkbox" checked={always || show[r.key]} disabled={always} onChange={() => saveShow({ ...show, [r.key]: !show[r.key] })} />
                    <span className="mp-check-name">{r.name}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="mp-rgrp">
        <button type="button" className="mp-btn" aria-label="확대" title="확대" onClick={() => zoomBy(1.6)}>
          <Icon size={14} d="M12 5v14M5 12h14" />
        </button>
        <button type="button" className="mp-btn" aria-label="축소" title="축소" onClick={() => zoomBy(1 / 1.6)}>
          <Icon size={14} d="M5 12h14" />
        </button>
      </div>
      <div className="mp-rgrp">
        <button type="button" className="mp-btn" aria-label="가운데로" title={region ? `가운데로 – ${region}` : "가운데로 – 파주시"} onClick={() => home()}>
          <Icon d="M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0 M12 2v4M12 18v4M2 12h4M18 12h4" />
        </button>
        <button type="button" className="mp-btn mp-btn-home" aria-label="파주시 전체" title="파주시 전체" disabled={!region} onClick={onWhole}>
          <Icon d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" />
        </button>
      </div>
    </div>
  );

  const cls = ["mp-map", kakao ? "mp-map-kakao" : "", tool ? "mp-measuring" : "", hover && !tool ? "mp-hot" : ""].filter(Boolean).join(" ");
  return (
    <div className="mp-mapbox" ref={boxRef}>
      <div
        className={cls}
        ref={wrapRef}
        tabIndex={0}
        aria-label="민원 지도"
        data-bg={mode}
        style={rv ? { flex: `0 0 ${(1 - rvRatio) * 100}%` } : undefined}
        onPointerDownCapture={onPointerDown}
        onPointerMoveCapture={onPointerMove}
        onPointerUpCapture={onPointerUp}
        onPointerLeave={() => {
          movePin(null);
          if (!drag.current) setHover(null);
        }}
        onKeyDown={onKeyDown}
        onAuxClick={(e) => e.preventDefault()}
      >
        <div className="mp-kakao" ref={kdivRef} aria-hidden={!kakao} />
        <canvas ref={canvasRef} className="mp-canvas" />
        {!layers && <div className="mp-wait">지도를 읽는 중이에요…</div>}
        {overlay}
        {failed && mode === "dxf" && (
          <div className="mp-note" role="status" style={{ left: leftInset + 12 }}>
            카카오 지도를 불러오지 못해 연속주제도로 보여요 · {failed}
          </div>
        )}
        {!rv && btns}
        {/* 범례(11-03 ✔4): ▾로 접으면 "● 범례" 알약 – [층] 상자의 "범례"와 같은 값(map.show.legend) */}
        {legend.length > 0 && show.dots && show.legend && (
          <div className="mp-legend" aria-label="범례" style={{ left: leftInset + 12, maxWidth: `calc(100% - ${leftInset + 80}px)` }}>
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
            <button type="button" className="mp-lg-fold" aria-label="범례 접기" title="범례 접기" onClick={() => saveShow({ ...show, legend: false })}>
              <Icon size={12} d="M6 9l6 6 6-6" />
            </button>
          </div>
        )}
        {legend.length > 0 && show.dots && !show.legend && (
          <button type="button" className="mp-lgpill" style={{ left: leftInset + 12 }} title="범례 펴기" onClick={() => saveShow({ ...show, legend: true })}>
            <i />
            범례
            <Icon size={12} d="M6 15l6-6 6 6" />
          </button>
        )}
        {measure && measure.pts.length > 0 && (
          <div ref={measRef} className="mp-meas" style={{ visibility: "hidden" }}>
            {sum ? (
              <>
                <b className="mp-meas-main">{sum.main}</b>
                <span className="mp-meas-sub">{sum.sub}</span>
              </>
            ) : (
              <span className="mp-meas-sub">{measure.tool === "radius" ? "끝 자리를 눌러요" : "다음 자리를 눌러요"}</span>
            )}
            {measure.done && measure.tool !== "dist" && (
              <button type="button" className="mp-meas-in" disabled={!inside.length} onClick={() => onPick(inside)} title="이 안 민원만 왼쪽 목록에">
                이 안 민원 {inside.length}건
              </button>
            )}
            {!measure.done && <span className="mp-meas-hint">{measure.tool === "radius" ? "Esc 취소" : "두 번 눌러 끝 · Esc 취소"}</span>}
            <button type="button" className="mp-meas-x" aria-label="재기 지우기" title="지우기" onClick={clearMeasure}>
              <Icon size={12} d="M6 6l12 12M18 6L6 18" />
            </button>
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
            {kakao && (
              <button
                type="button"
                className="btn btn-ctrl btn-xs mp-card-rv"
                onClick={() => {
                  openRv(card.pts[0].x, card.pts[0].y);
                  setPinned(null);
                  setHover(null);
                }}
              >
                로드뷰 보기
              </button>
            )}
          </div>
        )}
      </div>
      {rv && (
        <>
          <div className="mp-grip mp-rvgrip" role="separator" aria-orientation="vertical" aria-label="로드뷰 폭" onPointerDown={onRvGrip} onPointerMove={onRvGripMove} onPointerUp={() => (dragRv.current = null)} />
          <div className="mp-rv">
            <div className="mp-rv-view" ref={rvDivRef} />
            {rvMsg && <div className="mp-rv-msg">{rvMsg}</div>}
            <button type="button" className="mp-btn mp-btn-one mp-rv-x" aria-label="로드뷰 닫기" title="로드뷰 닫기 (Esc)" onClick={closeRv}>
              <Icon size={14} d="M6 6l12 12M18 6L6 18" />
            </button>
            {btns}
          </div>
        </>
      )}
    </div>
  );
}
