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

/** 단추 글자: "올해 (1-01 ~ 11-02)" · "2026-03-01 ~ 10-31" · "전체" */
export function periodLabel(p: Period): string {
  const md = (s: string) => s.slice(5).replace(/^0/, "");
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
export type Layers = { road: Feature[]; plan: Feature[]; zone: Feature[]; emd: Feature[]; bounds: [number, number, number, number] };

export function parseLayers(buf: ArrayBuffer): Layers {
  const v = new DataView(buf);
  const dec = new TextDecoder();
  if (dec.decode(new Uint8Array(buf, 0, 4)) !== "PJL1") throw new Error("지도 자료 모양이 달라요");
  let o = 4;
  const n = v.getUint8(o++);
  const out: Layers = { road: [], plan: [], zone: [], emd: [], bounds: [Infinity, Infinity, -Infinity, -Infinity] };
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
