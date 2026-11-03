// 민원 지도 – 자료 읽기와 규칙(그리기와 무관해 시험할 수 있어요). 2026-11-02 민원 지도 세션, 대기 목록 ✔2~✔5.
// 좌표는 모두 EPSG:5181(중부원점, m). 배경은 앱에 넣은 data/map/paju_layers.bin.gz(tools/map/build.py)를 읽어요 – 밖으로 아무것도 안 보내요.
import type { MapComplaint } from "../../api";
import { PLACES, emdsOf } from "../../paju";

// ---------- 읍면동 20곳 (사용자 순서 16:08) ----------
export const EUPS = ["문산읍", "조리읍", "법원읍", "파주읍", "광탄면", "탄현면", "월롱면", "적성면", "파평면", "장단면"];
export const DONGS = ["교하동", "운정1동", "운정2동", "운정3동", "운정4동", "운정5동", "운정6동", "금촌1동", "금촌2동", "금촌3동"];
export const REGIONS = [...EUPS, ...DONGS];
/** 법정 면 → 지도의 행정면(군내·진동·진서는 장단면에 합쳐 세고 그려요) */
const MERGE: Record<string, string> = { 군내면: "장단면", 진동면: "장단면", 진서면: "장단면" };

/** 민원 한 건이 지도 목록의 어느 읍면동인지: 지역 칸 → 없으면 위치의 리·동(하나로 정해질 때만) */
export function regionOf(c: { area: string; place: string }): string {
  const a = MERGE[c.area.trim()] ?? c.area.trim();
  if (REGIONS.includes(a)) return a;
  for (const w of c.place.split(/\s+/)) {
    const hit = PLACES.find((p) => w.startsWith(p.name));
    if (!hit) continue;
    const emds = emdsOf(hit.name);
    if (emds.length === 1) return MERGE[emds[0]] ?? emds[0];
    return "";
  }
  return "";
}

/** 그 읍면동을 그리는 법정 경계 이름들(행정동은 paju.ts 표의 법정동을 모아요 – 원본에 행정동 경계가 없어서) */
export function legalPartsOf(region: string): string[] {
  if (region === "장단면") return ["장단면", "군내면", "진동면", "진서면"];
  if (EUPS.includes(region)) return [region];
  return PLACES.filter((p) => p.emd === region).map((p) => p.name);
}

// ---------- 색 사다리 (✔4: 건수 많은 유형부터 주황 → 파랑 → 자홍 → 초록 → 보라 → 청록 → 갈색 → 회색) ----------
export const LADDER = ["#EA580C", "#1D6FE8", "#BE185D", "#16A34A", "#7C3AED", "#0E7490", "#B45309", "#6B7280"];

/** 민원유형 → 색. 전체 민원에서 건수가 많은 순(같으면 가나다)으로 사다리를 내려가고, 넘치면 회색이에요. */
export function typeColors(list: { ctype: string }[]): Map<string, string> {
  const n = new Map<string, number>();
  for (const c of list) {
    const t = c.ctype.trim() || "기타";
    n.set(t, (n.get(t) ?? 0) + 1);
  }
  const order = [...n.keys()].sort((a, b) => (n.get(b)! - n.get(a)!) || a.localeCompare(b, "ko"));
  return new Map(order.map((t, i) => [t, LADDER[Math.min(i, LADDER.length - 1)]]));
}
export const typeOf = (c: { ctype: string }) => c.ctype.trim() || "기타";

// ---------- 기간 ----------
export type Period = { from: string; to: string; chip: "year" | "last" | "y1" | "all" | "" };
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 칩 범위: 올해(1-01 ~ 오늘) · 작년(1-01 ~ 12-31) · 최근 1년(1년 전 다음 날 ~ 오늘) · 전체(빈칸) */
export function chipRange(chip: Period["chip"], today: Date): Period {
  const y = today.getFullYear();
  const t = ymd(today);
  if (chip === "year") return { from: `${y}-01-01`, to: t, chip };
  if (chip === "last") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, chip };
  if (chip === "y1") {
    const d = new Date(today);
    d.setFullYear(y - 1);
    d.setDate(d.getDate() + 1);
    return { from: ymd(d), to: t, chip };
  }
  return { from: "", to: "", chip: "all" };
}

/** 친 날짜가 어느 칩 범위와 같으면 그 칩, 아니면 "" (칩이 모두 꺼짐) */
export function chipOf(from: string, to: string, today: Date): Period["chip"] {
  for (const c of ["year", "last", "y1", "all"] as const) {
    const r = chipRange(c, today);
    if (r.from === from && r.to === to) return c;
  }
  return "";
}

/** 단추 글자: "올해 (01-01 ~ 11-02)" · "2026-03-01 ~ 10-31" · "전체" */
export function periodLabel(p: Period): string {
  const md = (s: string) => s.slice(5); // 사용자 11-02 23:30: "1-01"이 아니라 "01-01"
  const name = { year: "올해", last: "작년", y1: "최근 1년", all: "전체", "": "" }[p.chip];
  if (p.chip === "all" || (!p.from && !p.to)) return "전체";
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4);
  const range = `${p.chip ? md(p.from) : p.from || "처음"} ~ ${p.to ? (sameYear ? p.to.slice(5) : p.to) : "오늘"}`;
  return name ? `${name} (${range})` : range;
}

// ---------- 거르기 ----------
export type Filters = { types: Set<string> | null; statuses: Set<string>; period: Period; q: string };
/** 상태 처음 값(✔4·시안): 접수·진행·답변만 켜짐 – 완료와 그 밖(불가·보류·장기)은 꺼짐 */
export const defaultStatuses = (all: string[]) => new Set(all.filter((s) => ["접수", "진행", "답변", "처리중"].includes(s)));

export function passes(c: MapComplaint, f: Filters, skip?: "type" | "status"): boolean {
  if (skip !== "type" && f.types && !f.types.has(typeOf(c))) return false;
  if (skip !== "status" && !f.statuses.has(c.status)) return false;
  const { from, to } = f.period;
  if (from && c.received < from) return false;
  if (to && c.received > to) return false;
  const q = f.q.trim();
  if (q && ![c.place, c.ctype, c.intake, c.area, c.status].some((s) => s.includes(q))) return false;
  return true;
}

/** 민원대장에서 받은 민원이 거르기에 걸리면 그 민원이 보이도록 거르기를 꼭 필요한 만큼만 풀어요(11-03 ✔5).
 *  유형·상태는 그 값을 더하고, 기간 밖이면 전체 기간, 검색 글에 안 맞으면 검색 글을 지워요. */
export function relaxFor(c: MapComplaint, f: Filters): Filters {
  const t = typeOf(c);
  const types = f.types && !f.types.has(t) ? new Set([...f.types, t]) : f.types;
  const statuses = f.statuses.has(c.status) ? f.statuses : new Set([...f.statuses, c.status]);
  const { from, to } = f.period;
  const period = (from && c.received < from) || (to && c.received > to) ? { from: "", to: "", chip: "all" as const } : f.period;
  const q = f.q.trim() && !passes(c, { types: null, statuses: new Set([c.status]), period: { from: "", to: "", chip: "all" }, q: f.q }) ? "" : f.q;
  if (types === f.types && statuses === f.statuses && period === f.period && q === f.q) return f;
  return { types, statuses, period, q };
}

/** 검색 글이 주소 꼴인지(숫자가 있거나 리·동·로·길로 끝남) – 그러면 검색 결과에서 주소 묶음을 위에(11-03 ✔3) */
export function looksAddress(q: string): boolean {
  const t = q.trim();
  if (!t) return false;
  return /\d/.test(t) || /(리|동|로|길)$/.test(t);
}

/** 같은 읍면동 안에서 민원유형별 묶음: 건수 많은 순, 안은 접수일 내림차순 */
export function groupByType(list: MapComplaint[]): { type: string; items: MapComplaint[] }[] {
  const m = new Map<string, MapComplaint[]>();
  for (const c of list) {
    const t = typeOf(c);
    if (!m.has(t)) m.set(t, []);
    m.get(t)!.push(c);
  }
  return [...m.entries()]
    .map(([type, items]) => ({ type, items: items.sort((a, b) => b.received.localeCompare(a.received) || b.id - a.id) }))
    .sort((a, b) => b.items.length - a.items.length || a.type.localeCompare(b.type, "ko"));
}

/** "2026-10-28" → "10.28" */
export const monthDay = (d: string) => (d.length >= 10 ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : d);

// ---------- 점 카드 자리 (16:06: 늘 지도 안 – 기본 점 오른쪽 위, 모자라면 왼쪽·위로 뒤집힘, 테두리 8px 안쪽) ----------
export function cardPlace(px: number, py: number, w: number, h: number, mapW: number, mapH: number, gap = 12, edge = 8) {
  let left = px + gap;
  if (left + w > mapW - edge) left = px - gap - w;
  let top = py - gap;
  if (top + h > mapH - edge) top = py + gap - h;
  left = Math.max(edge, Math.min(left, mapW - edge - w));
  top = Math.max(edge, Math.min(top, mapH - edge - h));
  return { left, top };
}

// ---------- 배경 자료 ----------
export type Ring = Int32Array; // [x0, y0, x1, y1, …] (m)
export type Feature = { name: string; rings: Ring[] };
export type Layers = {
  road: Feature[];
  plan: Feature[];
  zone: Feature[];
  emd: Feature[];
  /** 하천(✔3, KRAS 하천구역 – 국가·지방은 build.py가 조각 폭으로 나눔) · 소하천구역 · 공원(공간시설 – 공원·녹지 한 층) */
  nat: Feature[];
  loc: Feature[];
  small: Feature[];
  park: Feature[];
  bounds: [number, number, number, number];
};

export function parseLayers(buf: ArrayBuffer): Layers {
  const v = new DataView(buf);
  const dec = new TextDecoder();
  if (dec.decode(new Uint8Array(buf, 0, 4)) !== "PJL1") throw new Error("지도 자료 모양이 달라요");
  let o = 4;
  const n = v.getUint8(o++);
  const out: Layers = { road: [], plan: [], zone: [], emd: [], nat: [], loc: [], small: [], park: [], bounds: [Infinity, Infinity, -Infinity, -Infinity] };
  const b = out.bounds;
  for (let li = 0; li < n; li++) {
    const id = v.getUint8(o);
    const nf = v.getUint32(o + 1, true);
    o += 5;
    const feats: Feature[] = [];
    for (let fi = 0; fi < nf; fi++) {
      const nl = v.getUint8(o++);
      const name = dec.decode(new Uint8Array(buf, o, nl));
      o += nl;
      const nr = v.getUint16(o, true);
      o += 2;
      const rings: Ring[] = [];
      for (let ri = 0; ri < nr; ri++) {
        const np = v.getUint32(o, true);
        let x = v.getInt32(o + 4, true);
        let y = v.getInt32(o + 8, true);
        o += 12;
        const r = new Int32Array(np * 2);
        r[0] = x;
        r[1] = y;
        for (let k = 1; k < np; k++) {
          x += v.getInt16(o, true);
          y += v.getInt16(o + 2, true);
          o += 4;
          r[k * 2] = x;
          r[k * 2 + 1] = y;
        }
        if (id === 4) {
          for (let k = 0; k < r.length; k += 2) {
            if (r[k] < b[0]) b[0] = r[k];
            if (r[k + 1] < b[1]) b[1] = r[k + 1];
            if (r[k] > b[2]) b[2] = r[k];
            if (r[k + 1] > b[3]) b[3] = r[k + 1];
          }
        }
        rings.push(r);
      }
      feats.push({ name, rings });
    }
    if (id === 1) out.road = feats;
    else if (id === 2) out.plan = feats;
    else if (id === 3) out.zone = feats;
    else if (id === 4) out.emd = feats;
    else if (id === 5) out.nat = feats;
    else if (id === 6) out.loc = feats;
    else if (id === 7) out.small = feats;
    else if (id === 8) out.park = feats;
  }
  return out;
}

/** gzip이면 풀어요(서버가 이미 풀어 보냈으면 그대로). */
export async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u = new Uint8Array(buf, 0, 2);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return buf;
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(s).arrayBuffer();
}

let cache: Promise<Layers> | null = null;
export function loadLayers(url: string): Promise<Layers> {
  cache ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    })
    .then(gunzip)
    .then(parseLayers)
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

/** 테두리를 그리기 대상에 옮겨 적어요. `close`는 선으로 긋는 층(읍면동 경계)만 – 칠하는 층에서 고리마다 closePath를 부르면
 *  Chromium이 고리 수의 제곱으로 느려져요(48,848고리 20초 넘게, 0.68.0 멈춤). 칠하기는 닫지 않아도 저절로 닫혀요. */
export function tracePath(
  p: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void },
  feats: Feature[],
  ox: number,
  oy: number,
  close: boolean,
) {
  for (const f of feats)
    for (const r of f.rings) {
      if (r.length < 4) continue;
      p.moveTo(r[0] - ox, r[1] - oy);
      for (let k = 2; k < r.length; k += 2) p.lineTo(r[k] - ox, r[k + 1] - oy);
      if (close) p.closePath();
    }
}

type Tracer = { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void };

// ---------- 분야(✔3, 사용자 11-02 22:19 – 설정에서 고름) ----------
export type Field = "road" | "river" | "park";
export const FIELDS: { key: Field; name: string }[] = [
  { key: "road", name: "도로" },
  { key: "river", name: "하천" },
  { key: "park", name: "공원" },
];
export const fieldOf = (v: string | null | undefined): Field => (v === "river" || v === "park" ? v : "road");

/** 하천 등급(✔3 23:28 – 국가 = 한강·임진강 전 구간·공릉천 전체·문산천 광탄면 경계 아래). 등급 색(토큰)은 하천 표시 설정 상자에서만 보여요. */
export type Grade = "nat" | "loc" | "small";
export const GRADES: { key: Grade; name: string; color: string }[] = [
  { key: "nat", name: "국가하천", color: "--map-nat" },
  { key: "loc", name: "지방하천", color: "--map-loc" },
  { key: "small", name: "소하천", color: "--map-small" },
];
export const RIVER_OUT = "하천 밖";
/** 민원 ↔ 하천(✔3 23:09 1안): 위치에서 가장 가까운 하천, 이 거리(m) 안에 없으면 "하천 밖" */
export const RIVER_NEAR_M = 100;
export const PARK_COLOR = "--map-park";

export type FillLayer = { id: string; feats: Feature[]; color: string; minScale?: number };
/** 분야마다 칠하는 층(아래부터). color는 색 토큰 이름(map.css `.mp` – 밝게/어둡게, ✔6). */
export function fillLayers(L: Layers, field: Field): FillLayer[] {
  if (field === "river") return [...GRADES].reverse().map((g) => ({ id: g.key, feats: L[g.key], color: g.color }));
  if (field === "park") return [{ id: "park", feats: L.park, color: PARK_COLOR }];
  return [
    { id: "road", feats: L.road, color: "--map-road" },
    { id: "plan", feats: L.plan, color: "--map-plan", minScale: 0.06 },
    { id: "zone", feats: L.zone, color: "--map-zone" },
  ];
}

/** 그 분야 배경의 그리기 모양 – 칠하는 층은 닫지 않고, 선으로 긋는 읍면동 경계만 닫아요. */
export function layerPaths<T extends Tracer>(L: Layers, make: () => T, field: Field = "road") {
  const [ox, oy] = L.bounds;
  const one = (f: Feature[], close: boolean) => {
    const p = make();
    tracePath(p, f, ox, oy, close);
    return p;
  };
  return { ox, oy, fills: fillLayers(L, field).map((l) => ({ id: l.id, color: l.color, minScale: l.minScale, p: one(l.feats, false) })), emd: one(L.emd, true) };
}

// ---------- 민원 → 가장 가까운 하천 ----------
type RiverRing = { g: Grade; r: Ring; bb: [number, number, number, number] };
const riverIdx = new WeakMap<Layers, RiverRing[]>();
function riverRings(L: Layers): RiverRing[] {
  let a = riverIdx.get(L);
  if (a) return a;
  a = [];
  for (const g of GRADES)
    for (const f of L[g.key])
      for (const r of f.rings) {
        const bb: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let k = 0; k < r.length; k += 2) {
          if (r[k] < bb[0]) bb[0] = r[k];
          if (r[k + 1] < bb[1]) bb[1] = r[k + 1];
          if (r[k] > bb[2]) bb[2] = r[k];
          if (r[k + 1] > bb[3]) bb[3] = r[k + 1];
        }
        a.push({ g: g.key, r, bb });
      }
  riverIdx.set(L, a);
  return a;
}

/** 점에서 고리까지 거리(m) – 안이면 0 */
export function ringDist(r: Ring, x: number, y: number): number {
  let inside = false;
  let best = Infinity;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], yi = r[i * 2 + 1], xj = r[j * 2], yj = r[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi, dy = yj - yi;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / L2)) : 0;
    const d = Math.hypot(x - (xi + t * dx), y - (yi + t * dy));
    if (d < best) best = d;
  }
  return inside ? 0 : best;
}

/** 위치(좌표)에서 RIVER_NEAR_M 안 가장 가까운 하천의 등급, 없으면 null(하천 밖) */
export function riverGradeOf(L: Layers, x: number, y: number, near = RIVER_NEAR_M): Grade | null {
  let best: Grade | null = null;
  let bd = near;
  for (const q of riverRings(L)) {
    if (x < q.bb[0] - bd || x > q.bb[2] + bd || y < q.bb[1] - bd || y > q.bb[3] + bd) continue;
    const d = ringDist(q.r, x, y);
    if (d <= bd) {
      bd = d;
      best = q.g;
      if (d === 0) break;
    }
  }
  return best;
}

/** 경계 모양들의 테두리 상자 */
export function boundsOf(feats: Feature[]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of feats)
    for (const r of f.rings)
      for (let k = 0; k < r.length; k += 2) {
        b[0] = Math.min(b[0], r[k]);
        b[1] = Math.min(b[1], r[k + 1]);
        b[2] = Math.max(b[2], r[k]);
        b[3] = Math.max(b[3], r[k + 1]);
      }
  return b;
}
