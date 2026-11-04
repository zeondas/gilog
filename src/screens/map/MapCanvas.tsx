// 민원 지도 – 지도 한 장(✔3·✔4, 카카오 배경 2026-11-03 ✔1~✔4·✔6·✔7·✔10).
// 배경: 카카오 지도(키가 있고 불러지면) 위에 우리 그림판 한 장(닷·숫자 동그라미·읍면동 경계·도로구역·도시계획시설·재기)을 겹쳐요.
//   키가 없거나(미리 보기·check·지킴이) 6초 안에 못 불러오거나 8초 안에 지도 그림이 안 오면 연속주제도(앱에 넣은 배경)로 그려요.
// 카카오일 때: 끌기·휠은 카카오가 하고(부드러운 확대 – 움직이는 동안 우리 그림판은 잠깐 숨김), 우리 그림판은 카카오 화면 범위를 따라 다시 그려요.
// 연속주제도일 때: 휠 = 확대·축소(커서 기준) · 왼쪽 끌기·휠 클릭 끌기 = 이동 · 읍면을 고르면 약 0.5초 동안 부드럽게 확대.
// 오른쪽 단추 줄: [로드뷰·층] · [거리·면적·반경] · [+ −] · [가운데로·파주시 전체] (11-03 2판).
// 11-03 저녁 ✔1~✔12(wip/map7): 카카오 위 덧그림은 테마와 상관없이 한 벌 색(✔7, map.css .mp-map-kakao) · 파주 바깥 경계 굵게 + 파주 밖 흐림·범위 묶기(✔3·✔4)
//   · 확대하면 화면 안 도형만(✔5) · 고른 민원 = 화면 쪽 selectedId 하나(✔10) → 일어서는 핀(SelPin.tsx, ✔6) · 닷 네 겹(✔9) · 로드뷰 핀 네이버식(✔11).
// 11-03 ✔1~✔5(wip/map6): 그림판은 카카오 위(z 1) · 로드뷰 핀(rvPin.ts) · 카카오를 기다리는 동안에도 경계·닷 · 로드뷰를 열면 단추 줄은 로드뷰 × 아래 · 민원대장에서 받은 민원(focus).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type MapComplaint } from "../../api";
import { statusColor } from "../../settingsStore";
import { cardPlace, fillLayers, GRADES, layerPaths, layerPathsIn, outlined, tracePath, type Feature, type Field, type Layers } from "./mapData";
import { closerFits, kakaoFailWhy, kakaoKey, loadKakao, tmForward, tmInverse, TILES_MS, type Kakao } from "./kakao";
import { addPoint, finish, insideIds, summary, TOOLS, type Measure, type Pt, type Tool } from "./measure";
import { drawBubble, drawDisc, drawRvHead, easeTo, leanOf, lookPan, RV_HINT, RV_SCALE } from "./rvPin";
import SelPin from "./SelPin";

export type MapPoint = { c: MapComplaint; x: number; y: number; color: string };
export type Pin = { x: number; y: number; label: string };
type View = { cx: number; cy: number; s: number };
type Cluster = { sx: number; sy: number; pts: MapPoint[] };
type Mode = "wait" | "kakao" | "dxf";

/** [층] 상자(✔7): 겹쳐 보기 켜고 끄기 – 민원 닷·읍면동 경계는 처음 켜짐, 도로구역·도시계획시설은 처음 꺼짐 */
export type Show = { dots: boolean; emd: boolean; zone: boolean; plan: boolean; river: boolean; park: boolean; legend: boolean };
const SHOW0: Show = { dots: true, emd: true, zone: false, plan: false, river: false, park: false, legend: true };
const KV_SHOW = "map.show";
type ShowRow = { key: keyof Show; name: string; base?: boolean };
/** 바탕 층은 설정 분야 것만(map9 ✔7, 사용자 11-04 "도로 담당이 하천·공원을 볼 까닭은 없어요") */
const BASE_ROWS: Record<Field, ShowRow[]> = {
  road: [
    { key: "zone", name: "도로구역", base: true },
    { key: "plan", name: "도시계획시설(도로)", base: true },
  ],
  river: [{ key: "river", name: "하천", base: true }],
  park: [{ key: "park", name: "공원", base: true }],
};
export const showRows = (field: Field): ShowRow[] => [{ key: "dots", name: "민원 닷" }, { key: "emd", name: "읍면동 경계" }, ...BASE_ROWS[field], { key: "legend", name: "범례" }];
/** 카카오 위에 그릴 바탕 층(켠 것만) – 하천은 등급 셋, 끈 등급은 renderBg의 off가 빼요 */
export function kakaoOnly(field: Field, show: Show): Set<string> {
  if (field === "river") return new Set(show.river ? GRADES.map((g) => g.key) : []);
  if (field === "park") return new Set(show.park ? ["park"] : []);
  return new Set([...(show.zone ? ["zone"] : []), ...(show.plan ? ["plan"] : [])]);
}
/** 카카오 위(·기다리는 동안)에선 바탕 도로 면을 그리지 않아요 → 만들지도 않아요(map9 ✔5 – 2만 8천 고리) */
const KAKAO_SKIP = new Set(["road"]);
/** 그리기 모양은 앱이 켜져 있는 동안 한 번만(map9 ✔6) – 지도 화면을 다시 열어도 그대로 써요. 자료(Layers)도 앞에서 한 번만 읽어요. */
const pathCache = new Map<string, Paths>();

/** 지도 색은 CSS 토큰(map.css `.mp` – 밝게/어둡게 따로, ✔6)에서 읽어요. 칠하는 층은 fillLayers의 color가 토큰 이름이에요. */
type Palette = { get: (name: string) => string; key: string };
const PAL_NAMES = ["--map-road", "--map-plan", "--map-zone", "--map-line", "--map-nat", "--map-loc", "--map-small", "--map-park", "--map-measure", "--map-rv", "--map-outer", "--map-veil", "--map-sel", "--map-accent", "--map-on-accent", "--map-accent-light"];
function paletteOf(el: Element): Palette {
  const css = getComputedStyle(el);
  const m = new Map(PAL_NAMES.map((n) => [n, css.getPropertyValue(n).trim() || "#888"]));
  return { get: (n) => m.get(n) ?? n, key: [...m.values()].join(",") };
}
const ANIM_MS = 500;
/** 파주시 보기 여백(map9 ✔3 – 전엔 28) */
const FIT_PAD = 8;
const HIT = 9;
const DOUBLE_MS = 450; // 두 번 누르기로 보는 사이
const RV_RADIUS = 50; // 로드뷰: 이 거리(m) 안 가장 가까운 사진
const RV_MIN = 0.3;
const RV_MAX = 0.7;
const KAKAO_MAX_LEVEL = 10;
const CULL_W = 9000; // 화면 폭이 이보다 좁게(m) 확대하면 화면 안 도형만 그려요(✔5)

/** left = 왼쪽을 가리는 패널 폭(px) – 그만큼 비켜 가운데 맞춰요(11-03 ✔2) */
function fit(b: [number, number, number, number], w: number, h: number, pad = 28, left = 0): View {
  const bw = Math.max(1, b[2] - b[0]);
  const bh = Math.max(1, b[3] - b[1]);
  const s = Math.max(Math.min((w - left - pad * 2) / bw, (h - pad * 2) / bh), 1e-4);
  return { cx: (b[0] + b[2]) / 2 - left / 2 / s, cy: (b[1] + b[3]) / 2, s };
}

/** 닷 네 겹(✔9): 그림자 · 진한 테 1px · 흰 띠 2px · 색(r) */
function ring4(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y + 1.5, r + 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(40,38,52,0.8)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
/** 고른 닷 핀 높이(끝 → 머리 위, px) – 카드는 그 위에 */
const PIN_H = 42;

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
type Paths = { key: Layers; field: Field; skip?: Set<string>; ox: number; oy: number; fills: { id: string; color: string; minScale?: number; p: Path2D }[]; lines: { id: string; color: string; minScale?: number; p: Path2D }[]; emd: Path2D; outer: Path2D };
/** 배경 그리기 방식: 연속주제도 = 분야의 층 전부 · 카카오 = 켠 층(도로구역·도시계획시설)만 반투명으로 */
/** kakao = 카카오 위 – 경계에 흰 테두리, 도로구역·도시계획시설 테두리, 파주 밖 흐림(✔3·✔4·✔5) */
type BgOpt = { only: Set<string> | null; alpha: number; emd: boolean; emdW: number; kakao?: boolean };

/** 전체 보기(확대 배율이 minScale보다 작을 때)에는 도시계획도로를 빼고 그려요 – 그 크기에선 어차피 안 보여요(0.68.0 멈춤 ②). */
function renderBg(ctx: CanvasRenderingContext2D, P0: Paths, off: Set<string>, v: View, w: number, h: number, dpr: number, pal: Palette, o: BgOpt) {
  const s = v.s;
  // 크게 확대하면 화면 안 도형만, 화면 가운데를 원점으로(✔5)
  let P = P0;
  if (w / s < CULL_W) {
    const mx = (w / s) * 0.6;
    const my = (h / s) * 0.6;
    const ox = Math.round(v.cx);
    const oy = Math.round(v.cy);
    P = { ...P0, ...layerPathsIn(P0.key, () => new Path2D(), P0.field, [v.cx - mx, v.cy - my, v.cx + mx, v.cy + my], ox, oy, P0.skip) };
  }
  const { ox, oy } = P;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(s * dpr, 0, 0, -s * dpr, (w / 2 - (v.cx - ox) * s) * dpr, (h / 2 + (v.cy - oy) * s) * dpr);
  // 파주 밖 흐림은 뺐어요(map8 ✔1, 사용자 22:52 "지도가 지저분해 보여요" – 경계선만)
  ctx.globalAlpha = o.alpha;
  for (const f of P.fills) {
    if (off.has(f.id) || (o.only && !o.only.has(f.id)) || (f.minScale && s < f.minScale)) continue;
    ctx.fillStyle = pal.get(f.color);
    ctx.fill(f.p);
  }
  ctx.globalAlpha = 1;
  // 층마다 테두리(✔5) – 카카오 위에서 옅은 면만으로는 어디까지인지 안 보여서
  if (o.kakao) {
    for (const f of P.lines) {
      if (off.has(f.id) || (o.only && !o.only.has(f.id))) continue;
      if (f.minScale && s < f.minScale) continue;
      ctx.strokeStyle = pal.get(f.color);
      ctx.lineWidth = 1.2 / s;
      ctx.stroke(f.p);
    }
  }
  if (o.emd) {
    if (o.kakao) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4 / s;
      ctx.stroke(P.emd);
    }
    ctx.strokeStyle = pal.get("--map-line");
    ctx.lineWidth = o.emdW / s;
    ctx.stroke(P.emd);
  }
  // 파주 바깥 경계(✔4): 굵은 선 – 카카오 위는 흰 테두리 + 진한 남색 3px
  if (o.kakao) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 7 / s;
    ctx.lineJoin = "round";
    ctx.stroke(P.outer);
  }
  ctx.strokeStyle = pal.get("--map-outer");
  ctx.lineWidth = (o.kakao ? 3 : 2) / s;
  ctx.stroke(P.outer);
}

/** 그려 둔 배경 그림을 지금 보기에 맞춰 늘리고 옮겨 붙여요(움직이는 동안 – 한 장면 몇 ms). */
function blitRect(snap: Snap, v: View, w: number, h: number) {
  const k = v.s / snap.v.s;
  return { left: w / 2 - (snap.w / 2) * k + (snap.v.cx - v.cx) * v.s, top: h / 2 - (snap.h / 2) * k + (v.cy - snap.v.cy) * v.s, w: snap.w * k, h: snap.h * k };
}
function blit(ctx: CanvasRenderingContext2D, snap: Snap, v: View, w: number, h: number) {
  const r = blitRect(snap, v, w, h);
  ctx.drawImage(snap.cv, r.left, r.top, r.w, r.h);
}

const sameView = (a: View, b: View) => a.cx === b.cx && a.cy === b.cy && a.s === b.s;

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
/** 오른쪽 단추 그림(11-03 2판, 캔버스 판 MapRail2): 24칸 · 선 1.8 · 둥근 끝. on = 켜진 단추(보라 바탕) */
/** on은 지금 모양이 같아도 받아 둬요(켜진 단추는 currentColor가 흰색) */
function RailIcon({ k }: { k: Tool | "rv"; on?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {k === "rv" && (
        // 로드뷰(✔11 네이버식): 아래로 뾰족한 물방울 머리 + 띠 – 지도 위 로드뷰 핀과 같은 그림
        <>
          <path d="M12 21c-1.6-2.4-6.6-5.8-6.6-11a6.6 6.6 0 1 1 13.2 0c0 5.2-5 8.6-6.6 11z" />
          <path d="M7.8 12.6q4.2 2.6 8.4 0" strokeWidth="2.2" />
        </>
      )}
      {k === "dist" && (
        // 거리: 자
        <>
          <path d="M3.3 16.3 16.3 3.3a1 1 0 0 1 1.4 0l3 3a1 1 0 0 1 0 1.4L7.7 20.7a1 1 0 0 1-1.4 0l-3-3a1 1 0 0 1 0-1.4z" />
          <path d="M8 11.6l1.8 1.8M10.6 9l1.2 1.2M13.2 6.4l1.8 1.8M5.4 14.2l1.2 1.2" />
        </>
      )}
      {k === "area" && (
        // 면적: 꼭짓점 찍은 다각형 + 옅게 칠한 안쪽
        <>
          <path d="M5 8.5 13.5 4l6 6.5-3 9.5L5 17z" fill="currentColor" fillOpacity={0.14} />
          {[[5, 8.5], [13.5, 4], [19.5, 10.5], [16.5, 20], [5, 17]].map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />
          ))}
        </>
      )}
      {k === "radius" && (
        // 반경: 원 + 가운데 점 + 반지름 선
        <>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
          <path d="M13.6 12h6.9" />
        </>
      )}
    </svg>
  );
}

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
  /** 고른 민원(✔10) – 화면 쪽이 하나만 기억해요. 지도·목록·검색·민원대장 모두 이 값을 바꾸고, 핀·닷카드·목록 줄이 따라가요 */
  selectedId: number | null;
  /** 지도에서 닷을 누르거나 풀 때(null) */
  onSelect: (id: number | null) => void;
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

export default function MapCanvas({ layers, field, off, points, region, regionFeats, focusBounds, selectedId, onSelect, legend, pin, onOpen, onWhole, onPick, onMode, overlay, leftInset = 0, focus = null }: Props) {
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
  // 고른 민원 핀(✔6): 화면 자리(끝 = 땅)·바깥 div – 자리는 그릴 때 style로만 옮겨요
  const selXY = useRef<Pt | null>(null);
  const selPinRef = useRef<HTMLDivElement>(null);
  const placeSelPin = () => {
    const el = selPinRef.current;
    if (!el) return;
    const p = selXY.current;
    el.style.visibility = p ? "" : "hidden";
    if (p) el.style.transform = `translate(${Math.round(p[0])}px, ${Math.round(p[1])}px)`;
  };

  const [mode, setMode] = useState<Mode>("wait");
  const [failed, setFailed] = useState(""); // 카카오를 못 불러온 까닭(빈 글 = 실패 아님)
  const [show, setShow] = useState<Show>(SHOW0);
  const [layerPop, setLayerPop] = useState(false);
  const [tool, setTool] = useState<Tool | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [rv, setRv] = useState<{ x: number; y: number; n: number } | null>(null);
  const [rvMsg, setRvMsg] = useState("");
  const [rvRatio, setRvRatio] = useState(0.5);
  const kakao = mode === "kakao";
  const bgField: Field = field; // map9 ✔7: 카카오 위에서도 설정 분야 층(전엔 늘 도로)
  const bgSkip = mode === "dxf" ? undefined : KAKAO_SKIP;
  const bgKey = [mode, bgField, [...off].sort().join(","), show.emd ? 1 : 0, show.zone ? 1 : 0, show.plan ? 1 : 0, show.river ? 1 : 0, show.park ? 1 : 0].join("|");
  const [hover, setHover] = useState<Cluster | null>(null);
  const [pinned, setPinned] = useState<Cluster | null>(null);
  const pinnedRef = useRef<Cluster | null>(null);
  pinnedRef.current = pinned;
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
      ? { only: kakaoOnly(bgField, show), alpha: 0.35, emd: show.emd, emdW: 1.6, kakao: true }
      : { only: null, alpha: 1, emd: show.emd, emdW: 0.9 };

  const pathsOf = (L: Layers): Paths => {
    const ck = bgField + "|" + (bgSkip ? "k" : "d");
    let P = paths.current;
    if (!P || P.key !== L || P.field !== bgField || P.skip !== bgSkip) {
      const hit = pathCache.get(ck);
      if (hit && hit.key === L) P = hit;
      else {
        P = { key: L, field: bgField, skip: bgSkip, ...layerPaths(L, () => new Path2D(), bgField, bgSkip), lines: [] };
        // 층 테두리(✔5·map9 ✔7): 카카오 위에서만 그어요 – 닫은 선은 그 분야의 바탕 층만(도로 면 빼고)
        if (bgSkip) {
          const [ox, oy] = L.bounds;
          P.lines = fillLayers(L, bgField)
            .filter((l) => outlined(l.id))
            .map((l) => {
              const p = new Path2D();
              tracePath(p, l.feats, ox, oy, true);
              return { id: l.id, color: l.color, minScale: l.minScale, p };
            });
        }
        pathCache.set(ck, P);
      }
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
    // 카카오 위에선 절반(한 배·한 변 2048점) – 움직이는 동안 잠깐 깔리는 그림이라 충분해요(map9 ✔5, 메모리 67MB → 17MB)
    const onK = mode !== "dxf";
    const s = base.s * (onK ? 1 : 2);
    const cap = onK ? 2048 : 4096;
    const bw = (layers.bounds[2] - layers.bounds[0]) * s + 64;
    const bh = (layers.bounds[3] - layers.bounds[1]) * s + 64;
    const k = Math.min(1, cap / (Math.max(bw, bh) * dpr)); // 한 변 cap점 안
    const cw = bw * k;
    const ch = bh * k;
    // 그림판은 새로 만들지 않고 다시 써요(층을 켜고 끌 때마다 큰 그림판이 쌓이지 않게 – map9 ✔5)
    const old = fullSnap.current?.cv;
    const cv = old ?? document.createElement("canvas");
    const pw = Math.round(cw * dpr);
    const ph = Math.round(ch * dpr);
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const v = { cx: base.cx, cy: base.cy, s: s * k };
    const pal = paletteOf(canvasRef.current ?? document.body);
    renderBg(ctx, pathsOf(layers), off, v, cw, ch, dpr, pal, bgOpt());
    fullSnap.current = { cv, v, w: cw, h: ch, dpr, key: layers, bg: bgKey + "|" + pal.key };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, bgKey, mode]);

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
    const bg = css.getPropertyValue("--surface").trim() || "#fff";
    const pal = paletteOf(cv);
    // 카카오 위에선 테마와 상관없이 한 벌(✔7 – map.css .mp-map-kakao): 강조색도 "밝게" 값(--icon-bg)
    const accent = pal.get("--map-accent");
    const onAccent = pal.get("--map-on-accent");
    const onKakao = st.mode === "kakao";
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
        // 마지막으로 또렷하게 그린 그림을 위에, 밑의 전체 그림(작은 배율 – 늘리면 선이 두껍고 흐려요)은 위 그림이 못 덮는 가장자리에만(map8 ✔4).
        // 카카오 위에선 우리 그림이 선만 있는 투명 그림이라, 밑 그림을 다 깔면 두꺼운 선이 비쳐 보였어요.
        const snapOk = !!snap && snap.key === layers && snap.bg === bk;
        if (full && full.key === layers && full.bg === bk) {
          ctx.save();
          if (snapOk && snap) {
            const r = blitRect(snap, v, w, h);
            const clip = new Path2D();
            clip.rect(0, 0, w, h);
            clip.rect(r.left + 1, r.top + 1, r.w - 2, r.h - 2);
            ctx.clip(clip, "evenodd");
          }
          blit(ctx, full, v, w, h);
          ctx.restore();
        }
        if (snapOk && snap) blit(ctx, snap, v, w, h);
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
        // 카카오 위: 진한 회색 45% 고정(✔8 – 밝게 테마의 흰 흐림은 밝은 지도에 묻혀요) + 흰 테두리 위 진한 남색
        ctx.globalAlpha = (onKakao ? 0.45 : 0.62) * dim.current;
        ctx.fillStyle = onKakao ? pal.get("--map-veil") : bg;
        ctx.fill(outside, "evenodd");
        ctx.globalAlpha = dim.current;
        if (onKakao) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 6 / s;
          ctx.stroke(rp);
        }
        ctx.strokeStyle = onKakao ? pal.get("--map-sel") : accent;
        ctx.lineWidth = (onKakao ? 2.4 : 2.2) / s;
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
    // 모양 지킴이가 닷을 누를 자리(또렷하게 다시 그릴 때만 적어요 – 움직이는 동안은 안 건드려요)
    if (!fast && wrapRef.current) {
      const one = out.find((c) => c.sx > 20 && c.sy > 20 && c.sx < w - 20 && c.sy < h - 20);
      wrapRef.current.dataset.dot = one ? `${Math.round(one.sx)},${Math.round(one.sy)}` : "";
    }
    // 고른 민원(✔10): 화면 쪽 selectedId 하나 – 그 닷 자리에 일어선 핀(SelPin), 카드는 핀 위, 다른 닷은 60%(✔6)
    const sel = st.selectedId;
    const sp = sel != null && st.show.dots ? st.points.find((p) => p.c.id === sel) : undefined;
    const spXY = sp ? toScreen(sp.x, sp.y, v, w, h) : null;
    const spOn = !!spXY && spXY[0] > -30 && spXY[1] > -60 && spXY[0] < w + 30 && spXY[1] < h + 30;
    selXY.current = spOn ? spXY : null;
    placeSelPin();
    if (!fast && sp && spOn && spXY) {
      const cur = pinnedRef.current;
      if (!cur || cur.pts.length !== 1 || cur.pts[0].c.id !== sel || Math.abs(cur.sx - spXY[0]) > 0.5 || Math.abs(cur.sy - spXY[1] + PIN_H) > 0.5) setPinned({ sx: spXY[0], sy: spXY[1] - PIN_H, pts: [sp] });
    }
    // 닷(✔9): 유형색 6px · 흰 띠 2px · 바깥 진한 테 1px · 옅은 그림자 – 카카오든 연속주제도든 같아요
    for (const c of out) {
      const hasSel = sel != null && c.pts.some((p) => p.c.id === sel);
      if (hasSel && c.pts.length === 1) continue; // 핀이 그 자리를 대신해요
      ctx.globalAlpha = sel != null && spOn ? 0.6 : 1;
      if (c.pts.length > 1) {
        ring4(ctx, c.sx, c.sy, 9, accent);
        ctx.fillStyle = onAccent; // 어둡게 테마의 연속주제도는 강조색이 밝아 어두운 글자(✔6)
        ctx.font = "600 11px Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(c.pts.length), c.sx, c.sy + 0.5);
      } else ring4(ctx, c.sx, c.sy, 6, c.pts[0].color);
    }
    ctx.globalAlpha = 1;
    // 지금 로드뷰 자리(✔11 네이버식): 원판 + 보는 쪽 부채꼴 + 흰 머리(띠가 보는 쪽을 따라 돌아요)
    const rvFan = pal.get("--map-accent-light");
    if (rvPos.current) {
      const [x, y] = toScreen(rvPos.current[0], rvPos.current[1], v, w, h);
      drawDisc(ctx, x, y, rvPan.current, 24 * RV_SCALE, pal.get("--map-rv"), rvFan);
      drawRvHead(ctx, x, y, rvPan.current, rvFan);
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
      drawDisc(ctx, mp[0], mp[1], 0, 14 * RV_SCALE, pal.get("--map-rv"), null);
      drawRvHead(ctx, mp[0], mp[1], lookPan(pose.current.look), rvFan, pose.current.lean);
      drawBubble(ctx, mp[0], mp[1], RV_HINT, w);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, buildFull, bgKey]);

  // 카카오·로드뷰의 움직임 알림은 지도를 만들 때 한 번만 달아요 – 그 안에서는 늘 "지금" 그리기를 불러요(map8 ✔2).
  // 전엔 단 때의 그리기([층]·분야 값)를 계속 불러, 끈 층이 움직일 때마다 다시 나타나고, 끄는 동안 옛 그리기와 지금 그리기가
  // 번갈아 돌아 흐림·층이 번쩍였어요.
  const drawRef = useRef(draw);
  drawRef.current = draw;

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
    // map9 ✔3(사용자 11-04 "파주에 딱 맞게"): 여백 8px. 카카오 배율은 두 배씩이라, 한 단계 가까이에서
    // 범위가 남는 자리보다 2% 안쪽으로만 넘치면 그 단계로 보여요(가장자리가 여백 몇 px에 걸칠 뿐이에요).
    const pad = FIT_PAD;
    const left = pad + inset.current; // 왼쪽 목록 패널이 지도 위에 떠 있으면 그만큼 더(위·오른쪽·아래·왼쪽 순서)
    m.setBounds(lb, pad, pad, pad, left);
    const { w, h } = size.current;
    if (!w || !h) return;
    const pr = m.getProjection();
    const c0 = pr.coordsFromContainerPoint(new k.maps.Point(w / 2, h / 2));
    const c1 = pr.coordsFromContainerPoint(new k.maps.Point(w / 2 + 200, h / 2));
    const [x0] = tmForward(c0.getLat(), c0.getLng());
    const [x1] = tmForward(c1.getLat(), c1.getLng());
    const s = 200 / Math.max(1e-6, x1 - x0); // 지금 단계의 화면 점 / m
    const level = m.getLevel();
    if (!closerFits(b, s, w, h, pad, left) || level <= 1) return;
    const s2 = s * 2;
    // 왼쪽 여백이 더 크면 범위를 그만큼 오른쪽으로 – 지도 가운데는 범위 가운데보다 (왼쪽 - 오른쪽)/2 점 왼쪽
    const cx = (b[0] + b[2]) / 2 - (left - pad) / 2 / s2;
    const cy = (b[1] + b[3]) / 2;
    m.setLevel(level - 1);
    m.setCenter(latLng(cx, cy));
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
    // 끌기 범위 제한은 없어요(map8 ✔6, 사용자 23:12 – 파주 둘레 3km 제한 폐기)
    ev.addListener(m, "center_changed", () => {
      syncView();
      drawRef.current(true);
    });
    // 부드러운 확대(✔3): 움직이는 동안(약 0.3초) 우리 그림판은 잠깐 숨기고, 끝나면 다시 그려요.
    ev.addListener(m, "zoom_start", () => {
      if (cv) cv.style.opacity = "0";
      if (selPinRef.current) selPinRef.current.style.opacity = "0";
      setHover(null);
      setPinned(null);
    });
    ev.addListener(m, "idle", () => {
      syncView();
      drawRef.current();
      if (cv) cv.style.opacity = "";
      if (selPinRef.current) selPinRef.current.style.opacity = "";
    });
    const fb = focusBounds ?? layers.bounds;
    kakaoFit(fb);
    syncView();
    drawRef.current();
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
  // 새로 고를 때만 그 자리로(map8 ✔2 – 전엔 [층]을 바꿔도 다시 돌아 고른 핀 자리로 끌려갔어요)
  const panRef = useRef(panTo);
  panRef.current = panTo;
  const pointsRef = useRef(points);
  pointsRef.current = points;
  useEffect(() => {
    // 풀면(✔10) 그 닷카드도 닫아요 – 묶음 카드(여러 건)는 그대로
    if (selectedId == null) {
      const c = pinnedRef.current;
      if (c && c.pts.length === 1) setPinned(null);
      return;
    }
    const v = view.current;
    if (!v) return;
    const p = pointsRef.current.find((q) => q.c.id === selectedId);
    if (!p) return;
    const { w, h } = size.current;
    const [sx, sy] = toScreen(p.x, p.y, v, w, h);
    if (sx < 24 || sy < 24 || sx > w - 24 || sy > h - 24) panRef.current(p.x, p.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
          // 로드뷰 자리를 왼쪽 지도 칸 가운데로(map7 ✔2) – 미끄러지지 않고 한 번에(map8 ✔3: 미끄러지는 동안 덧그림이 뚝뚝 끊겨 따라와 어색했어요)
          m.relayout();
          m.setCenter(p);
          syncView();
          drawRef.current();
        });
        // 로드뷰를 돌리면 지도 위 머리·부채꼴도 같이(✔2)
        k.maps.event.addListener(r, "viewpoint_changed", () => {
          rvPan.current = r.getViewpoint().pan;
          drawRef.current(true);
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
    else if (measure) clearMeasure();
    else if (pinned || selectedId != null) {
      setPinned(null);
      onSelect(null);
    } else if (region) onWhole();
    else return false;
    return true;
  }, [rv, measure, pinned, selectedId, region, closeRv, clearMeasure, onWhole, onSelect]);
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
      onSelect(null);
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
    else if (c.pts.length === 1) onSelect(key); // 핀·카드·목록 줄은 고른 값을 따라와요(✔10)
    else {
      onSelect(null); // 묶음은 카드만 – 카드 안 한 건을 누르면 그 건이 골라져요
      setPinned(c);
    }
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
    // 고른 핀의 카드는 핀 머리 위 가운데(✔6), 그 밖은 닷 옆
    if (card === pinned && card.pts.length === 1 && card.pts[0].c.id === selectedId) {
      const ew = el.offsetWidth;
      const eh = el.offsetHeight;
      let left = card.sx - ew / 2;
      let top = card.sy - eh - 6;
      if (top < 8) top = card.sy + PIN_H + 14; // 위에 자리가 없으면 핀 아래
      left = Math.max(8, Math.min(left, w - 8 - ew));
      top = Math.max(8, Math.min(top, h - 8 - eh));
      setCardPos({ left, top });
    } else setCardPos(cardPlace(card.sx, card.sy, el.offsetWidth, el.offsetHeight, w, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <RailIcon k="rv" on={!!rv} />
        </button>
        <div className="mp-layerwrap">
          <button
            type="button"
            className={"mp-btn" + (layerPop ? " mp-btn-on" : "")}
            aria-label="층"
            title="층 – 겹쳐 보기 켜고 끄기"
            aria-expanded={layerPop}
            onClick={() => setLayerPop(!layerPop)}
          >
            <Icon d="M12 3l9 5-9 5-9-5z M3 13l9 5 9-5" />
          </button>
          {layerPop && (
            <div className="mp-pop mp-layerpop" role="dialog" aria-label="층">
              <span className="mp-layerpop-cap">겹쳐 보기</span>
              {showRows(field).map((r) => {
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
      {/* 재기(11-03 2판): 묶음을 풀어 거리·면적·반경 세 단추 – 다시 누르면 꺼져요 */}
      <div className="mp-rgrp" role="group" aria-label="재기">
        {TOOLS.map((t) => (
          <button key={t.key} type="button" className={"mp-btn" + (tool === t.key ? " mp-btn-on" : "")} aria-pressed={tool === t.key} aria-label={`${t.name} 재기`} title={`${t.name} 재기`} onClick={() => {
            pickTool(t.key);
            setLayerPop(false);
          }}>
            <RailIcon k={t.key} on={tool === t.key} />
          </button>
        ))}
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

  const selPoint = selectedId != null && show.dots ? points.find((p) => p.c.id === selectedId) : undefined;
  // 핀이 생긴 뒤 자리를 바로 맞춰요(처음 그릴 때 div가 아직 없을 수 있어요)
  useLayoutEffect(() => {
    placeSelPin();
  });
  const cls = ["mp-map", kakao ? "mp-map-kakao" : "", tool ? "mp-measuring" : "", hover && !tool ? "mp-hot" : ""].filter(Boolean).join(" ");
  return (
    <div className="mp-mapbox" ref={boxRef}>
      <div
        className={cls}
        ref={wrapRef}
        tabIndex={0}
        aria-label="민원지도"
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
        {selPoint && <SelPin ref={selPinRef} color={selPoint.color} play={selectedId ?? 0} />}
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
                <button type="button" key={p.c.id} className="mp-card-row" title="두 번 누르면 민원대장 그 줄" onClick={() => card.pts.length > 1 && onSelect(p.c.id)} onDoubleClick={() => onOpen(p.c.id)}>
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
