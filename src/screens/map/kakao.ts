// 민원 지도 – 카카오 지도 잇기(2026-11-03 민원 지도 세션 ✔1~✔5, 결정 로그 11-03 09:04·09:47·10:03).
// - 키: 설정 › 민원 지도 "카카오 JavaScript 키"(map.kakaoKey) → 없으면 설치 파일에 넣어 둔 키(VITE_KAKAO_JS_KEY, 빌드 때 깃허브 비밀).
//   둘 다 없으면(미리 보기·check·지킴이 빌드) 카카오를 부르지 않고 연속주제도로 그려요.
// - 카카오로 나가는 것: 보는 화면 범위(지도 그림 요청)·로드뷰 사진 요청·주소 검색 글자뿐. 민원 정보는 보내지 않아요.
// - 지도 그림은 저장하지 않아요(카카오 운영정책 – 타일 저장 금지).
// - 좌표: 우리 자료는 EPSG:5181(m). 카카오와는 위경도로 주고받아요 – tmForward/tmInverse(GRS80 횡메르카토르, 시험으로 고정).
import { api } from "../../api";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Kakao = any;

export const KV_KAKAO_KEY = "map.kakaoKey";
/** SDK를 부르고 기다리는 시간 · 첫 지도 그림을 기다리는 시간 – 넘으면 연속주제도로 */
export const LOAD_MS = 6000;
export const TILES_MS = 8000;

// ---------- EPSG:5181 ↔ 위경도 ----------
const A = 6378137;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const EP2 = E2 / (1 - E2);
const LAT0 = (38 * Math.PI) / 180;
const LON0 = (127 * Math.PI) / 180;
const FE = 200000;
const FN = 500000;
const E4 = E2 * E2;
const E6 = E4 * E2;
const M1 = 1 - E2 / 4 - (3 * E4) / 64 - (5 * E6) / 256;
const meridian = (p: number) =>
  A * (M1 * p - ((3 * E2) / 8 + (3 * E4) / 32 + (45 * E6) / 1024) * Math.sin(2 * p) + ((15 * E4) / 256 + (45 * E6) / 1024) * Math.sin(4 * p) - ((35 * E6) / 3072) * Math.sin(6 * p));
const M0 = meridian(LAT0);

/** 위경도(도) → EPSG:5181 [x, y] m */
export function tmForward(lat: number, lon: number): [number, number] {
  const p = (lat * Math.PI) / 180;
  const l = (lon * Math.PI) / 180;
  const s = Math.sin(p);
  const c = Math.cos(p);
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = Math.tan(p) ** 2;
  const C = EP2 * c * c;
  const a = (l - LON0) * c;
  const x = FE + N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120);
  const y = FN + (meridian(p) - M0 + N * Math.tan(p) * (a ** 2 / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720));
  return [x, y];
}

/** EPSG:5181 m → 위경도(도) [lat, lon] */
export function tmInverse(x: number, y: number): [number, number] {
  const M = M0 + (y - FN);
  const mu = M / (A * M1);
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1);
  const c = Math.cos(p1);
  const C1 = EP2 * c * c;
  const T1 = Math.tan(p1) ** 2;
  const N1 = A / Math.sqrt(1 - E2 * s * s);
  const R1 = (A * (1 - E2)) / Math.pow(1 - E2 * s * s, 1.5);
  const D = (x - FE) / N1;
  const lat = p1 - ((N1 * Math.tan(p1)) / R1) * (D ** 2 / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = LON0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [(lat * 180) / Math.PI, (lon * 180) / Math.PI];
}

// ---------- 키 ----------
/** 설정 칸 값 → 없으면 넣어 둔 키 → 없으면 "" */
export function pickKey(setting: string | null | undefined, built: string | undefined): string {
  const s = (setting ?? "").trim();
  if (s) return s;
  return (built ?? "").trim();
}
export const builtKey = () => (import.meta.env.VITE_KAKAO_JS_KEY as string | undefined) ?? "";
export async function kakaoKey(): Promise<string> {
  let s: string | null = null;
  try {
    s = await api.get(KV_KAKAO_KEY);
  } catch {
    /* 잠금 전 등 – 넣어 둔 키 */
  }
  return pickKey(s, builtKey());
}

// ---------- SDK 부르기(한 번만) ----------
let loading: Promise<Kakao | null> | null = null;
let loadedKey = "";
let ready: Kakao | null = null;
let failWhy = "";

/** 불러 둔 카카오(주소 검색이 씀) – 아직이거나 실패면 null */
export const kakaoReady = (): Kakao | null => ready;
/** 마지막으로 못 불러온 까닭(안내 글에 붙여요, 11-03 ✔1) */
export const kakaoFailWhy = () => failWhy;

const sdkUrl = (key: string) => `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services`;
/** 키처럼 보이는 글(32자 16진수)은 가려요 – 화면에 키가 남지 않게 */
export const maskKey = (t: string) => t.replace(/[0-9a-f]{32}/gi, "(키)");

/** 카카오가 돌려준 거절 글을 읽어 봐요(읽을 수 있을 때만 – 못 읽으면 빈 글) */
async function serverSays(key: string): Promise<string> {
  try {
    const r = await fetch(sdkUrl(key), { cache: "no-store" });
    const t = await r.text();
    const m = t.match(/"message"\s*:\s*"([^"]{1,200})"/);
    return m ? maskKey(m[1]) : "";
  } catch {
    return "";
  }
}

/** SDK(services 포함)를 불러요. 키가 없거나 실패·시간 넘김이면 null(까닭은 kakaoFailWhy). */
export function loadKakao(key: string): Promise<Kakao | null> {
  if (!key) return Promise.resolve(null);
  if (loading && loadedKey === key) return loading;
  loadedKey = key;
  loading = new Promise<Kakao | null>((resolve) => {
    const w = window as any;
    if (w.kakao?.maps?.LatLng) {
      ready = w.kakao;
      return resolve(w.kakao);
    }
    let done = false;
    const finish = (k: Kakao | null, why = "") => {
      if (done) return;
      done = true;
      clearTimeout(t);
      ready = k;
      failWhy = why;
      if (!k) {
        loading = null; // 다음에 열 때 다시 해 봐요
        // 카카오가 거절 글을 돌려줬으면 그 글을 붙여요(읽히는 경우만)
        void serverSays(key).then((m) => {
          if (m) failWhy = `${why} – 카카오: ${m}`;
        });
      }
      resolve(k);
    };
    const t = window.setTimeout(
      () => finish(null, w.kakao?.maps ? "카카오 지도 파일을 받지 못했어요(보안 허용 목록·인터넷)" : "카카오 응답이 늦어요(6초 넘음)"),
      LOAD_MS,
    );
    const sc = document.createElement("script");
    sc.src = sdkUrl(key);
    sc.async = true;
    sc.onerror = () => finish(null, "카카오 SDK를 받지 못했어요(인터넷·키 거절)");
    sc.onload = () => {
      if (!w.kakao?.maps?.load) return finish(null, "카카오가 키를 받아 주지 않았어요(키·도메인 확인)");
      try {
        w.kakao.maps.load(() => finish(w.kakao));
      } catch {
        finish(null, "카카오 지도를 여는 중 오류가 났어요");
      }
    };
    document.head.appendChild(sc);
  });
  return loading;
}

// ---------- 주소 검색(파주시만, ✔5) ----------
export type Hit = { name: string; addr: string; x: number; y: number; src: "jibun" | "kakao" };
export const PAJU = /^(경기도?|경기)\s*파주시(\s|$)/;

/** 카카오 검색 결과 하나 → 파주시 안이면 Hit(5181), 밖이면 null */
export function kakaoHit(d: { place_name?: string; address_name?: string; road_address_name?: string; x: string; y: string }): Hit | null {
  const addr = d.address_name || d.road_address_name || "";
  if (!PAJU.test(addr) && !PAJU.test(d.road_address_name || "")) return null;
  const lon = Number(d.x);
  const lat = Number(d.y);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const [x, y] = tmForward(lat, lon);
  return { name: d.place_name || d.road_address_name || addr, addr: d.place_name ? addr : d.road_address_name ? addr : "", x, y, src: "kakao" };
}

/** 장소 이름·도로명 검색(카카오) – 결과는 저장하지 않아요. */
export function kakaoSearch(k: Kakao, q: string, bounds: [number, number, number, number]): Promise<Hit[]> {
  const out: Hit[] = [];
  const seen = new Set<string>();
  const push = (h: Hit | null) => {
    if (!h) return;
    const key = `${Math.round(h.x)},${Math.round(h.y)},${h.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(h);
  };
  const [sw0, sw1] = tmInverse(bounds[0], bounds[1]);
  const [ne0, ne1] = tmInverse(bounds[2], bounds[3]);
  const kb = new k.maps.LatLngBounds(new k.maps.LatLng(sw0, sw1), new k.maps.LatLng(ne0, ne1));
  const addr = new Promise<void>((res) => {
    try {
      new k.maps.services.Geocoder().addressSearch(`파주시 ${q}`, (r: any[], st: string) => {
        if (st === k.maps.services.Status.OK) for (const d of r) push(kakaoHit({ ...d, place_name: d.road_address?.address_name || d.address_name }));
        res();
      });
    } catch {
      res();
    }
  });
  const kw = new Promise<void>((res) => {
    try {
      new k.maps.services.Places().keywordSearch(q, (r: any[], st: string) => {
        if (st === k.maps.services.Status.OK) for (const d of r) push(kakaoHit(d));
        res();
      }, { bounds: kb, size: 15 });
    } catch {
      res();
    }
  });
  return Promise.all([addr, kw]).then(() => out);
}

/** 한 단계 가까이(두 배)에서 범위가 남는 자리보다 `slack`(6%) 안쪽으로만 넘치는지 – 시험이 써요.
 *  map11(사용자 11-04 16:04 1안): 위아래는 여백 없이 지도 높이 그대로 재고, 넘쳐도 되는 폭은 2% → 6%
 *  (카카오 배율이 두 배씩이라 2%로는 창 높이에 따라 파주가 절반 크기로 남았어요 – 북·남 끝이 몇 점 가려질 수 있어요). */
export function closerFits(b: [number, number, number, number], s: number, w: number, h: number, pad: number, left: number, slack = 0.06): boolean {
  const bw = (b[2] - b[0]) * s * 2;
  const bh = (b[3] - b[1]) * s * 2;
  const aw = w - pad - left;
  const ah = h;
  return aw > 0 && ah > 0 && bw <= aw * (1 + slack) && bh <= ah * (1 + slack);
}
