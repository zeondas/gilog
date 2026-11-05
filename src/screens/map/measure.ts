// 민원 지도 – 거리·면적·반경 재기(✔6, 시안 MapMeasure). 좌표는 EPSG:5181 m 평면 그대로 재요(파주 안에선 오차 0.1% 안).
// 우리 그림판에 그려서 카카오 지도든 연속주제도든 같아요.
export type Tool = "dist" | "area" | "radius";
export type Pt = [number, number];
export type Measure = { tool: Tool; pts: Pt[]; done: boolean };

export const TOOLS: { key: Tool; name: string }[] = [
  { key: "dist", name: "거리" },
  { key: "area", name: "면적" },
  { key: "radius", name: "반경" },
];

/** 걷는 빠르기 – 시간 4km(카카오맵과 같은 어림) */
const WALK_M_PER_MIN = 4000 / 60;

export const segLen = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export function pathLen(pts: Pt[]): number {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += segLen(pts[i - 1], pts[i]);
  return n;
}
/** 다각형 넓이(신발끈 공식, 닫힘은 저절로) */
export function polyArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}
export const circleArea = (r: number) => Math.PI * r * r;

export function fmtLen(m: number): string {
  if (m < 1000) return `${Math.round(m).toLocaleString()}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)}km`;
}
export function fmtArea(m2: number): string {
  if (m2 < 10000) return `${Math.round(m2).toLocaleString()}㎡`;
  return `${Math.round(m2).toLocaleString()}㎡ (${(m2 / 10000).toFixed(m2 < 100000 ? 2 : 1)}ha)`;
}
export function walkTime(m: number): string {
  const min = Math.max(1, Math.round(m / WALK_M_PER_MIN));
  return min < 60 ? `도보 ${min}분` : `도보 ${Math.floor(min / 60)}시간 ${min % 60}분`;
}

/** 점이 다각형 안인지(짝홀 규칙) */
export function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 재기 결과 글 – 거리: 총 거리·도보, 면적: 넓이, 반경: 반지름·넓이 */
export function summary(m: Measure, live?: Pt): { main: string; sub: string } | null {
  const pts = live && !m.done ? [...m.pts, live] : m.pts;
  if (m.tool === "dist") {
    if (pts.length < 2) return null;
    const L = pathLen(pts);
    return { main: `총 거리 ${fmtLen(L)}`, sub: walkTime(L) };
  }
  if (m.tool === "area") {
    if (pts.length < 3) return null;
    return { main: `면적 ${fmtArea(polyArea(pts))}`, sub: `둘레 ${fmtLen(pathLen([...pts, pts[0]]))}` };
  }
  if (pts.length < 2) return null;
  const r = segLen(pts[0], pts[1]);
  return { main: `반경 ${fmtLen(r)}`, sub: `면적 ${fmtArea(circleArea(r))}` };
}

/** 면적·반경 안에 든 점(id) – 거리는 없음 */
export function insideIds<T extends { id: number; x: number; y: number }>(m: Measure, items: T[]): number[] {
  if (!m.done) return [];
  if (m.tool === "area" && m.pts.length >= 3) return items.filter((c) => inPoly([c.x, c.y], m.pts)).map((c) => c.id);
  if (m.tool === "radius" && m.pts.length >= 2) {
    const r = segLen(m.pts[0], m.pts[1]);
    return items.filter((c) => segLen(m.pts[0], [c.x, c.y]) <= r).map((c) => c.id);
  }
  return [];
}

/** 점 하나를 더해요. 반경은 두 점(가운데·끝)이면 끝나요. 끝나면 done. */
export function addPoint(m: Measure, p: Pt): Measure {
  if (m.done) return { tool: m.tool, pts: [p], done: false };
  const pts = [...m.pts, p];
  return { ...m, pts, done: m.tool === "radius" && pts.length >= 2 };
}
/** 두 번 누르기로 끝내요(거리 2점·면적 3점 이상일 때만) */
export function finish(m: Measure): Measure {
  // 두 번 누르기는 같은 자리에 점 두 개를 남기니 끝 점이 겹치면 하나를 빼요.
  const pts = m.pts.slice();
  while (pts.length >= 2 && segLen(pts[pts.length - 1], pts[pts.length - 2]) < 0.01) pts.pop();
  const need = m.tool === "area" ? 3 : 2;
  return pts.length >= need ? { ...m, pts, done: true } : { ...m, pts };
}
