// 표 머리 줄 열 폭 규칙(헤더 열 조정 통일, 2026-10-28 17:44·17:56·19:44 사용자 – docs/qa/cols.md).
// 화면 7곳(민원대장·민원처리·집행현황·예산현황·탐색기·사업 관리 창·예산현황으로 보내기 창)이 같이 써요.
// - 끌면 끈 왼쪽 열만 바뀌고 총폭이 늘어나요(넘치면 표 안 가로 스크롤, 남는 폭 열 없음 – 창 안 표의 긴 글 열만 예외).
// - 저장은 끈(또는 맞춘) 열만 px로, 화면마다 키 하나 `<화면>.cols`. 옛 키·옛 모양은 읽지 않아요.
// - 가장 좁게 40, 글자 열(text)은 처음 값의 절반. 고정 열은 처음 값 그대로(손잡이 없음, 맞춤·처음 폭에서도 빠짐).

/** 열 하나 – 처음 값(init)은 화면이 정해요(상수·글 폭 계산·창 폭에 맞춤). */
export type ColDef = {
  id: string;
  /** 처음 폭(px) */
  init: number;
  /** 고정 열: 손잡이 없음, 늘 처음 값 */
  fixed?: boolean;
  /** 글자 열(이름·사업명·세부사업·위치·내용 등): 가장 좁게 = 처음 값 절반 */
  text?: boolean;
  /** 가장 좁게를 따로 정할 때(탐색기 날짜 열 = 형식 글자 폭) */
  min?: number;
  /** 가장 넓게(창 안 표에서 창 폭을 따라가는 긴 글 열이 가장 좁게 아래로 안 가게 – 사업 관리 창 축약 열) */
  max?: number;
  /** 열 제목(손잡이 이름표) */
  label?: string;
};

export type ColPx = Record<string, number>;

export const COL_MIN_PX = 40;
/** 저장값으로 받는 가장 넓은 폭(망가진 값 거르기) */
const COL_MAX_PX = 4000;

/** 가장 좁은 폭 */
export function minOf(c: ColDef): number {
  if (c.fixed) return c.init;
  if (c.min != null) return Math.max(1, Math.round(c.min));
  return c.text ? Math.max(COL_MIN_PX, Math.round(c.init / 2)) : COL_MIN_PX;
}

/** 보이는 폭: 고정 열은 처음 값, 끈 열은 저장값(가장 좁게 아래로는 안 감), 나머지는 처음 값 */
export function widthOf(c: ColDef, saved: ColPx): number {
  if (c.fixed) return c.init;
  const v = saved[c.id];
  const w = Math.max(minOf(c), v ?? c.init);
  return c.max != null ? Math.max(minOf(c), Math.min(c.max, w)) : w;
}

/** 내용 폭(칸 여백 포함)으로 맞춘 폭 */
export function fitPx(c: ColDef, content: number): number {
  const w = Math.max(minOf(c), Math.ceil(content));
  return c.max != null ? Math.max(minOf(c), Math.min(c.max, w)) : w;
}

/** 저장값 읽기 – `{열: px}`만 받아요. part가 있으면 그 칸(예산현황 요약·자세히). 모양이 다르면(옛 키·옛 모양) 빈 값. */
export function readColPx(raw: string | null | undefined, part?: string): ColPx {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? "");
  } catch {
    return {};
  }
  if (part != null) v = isObj(v) ? v[part] : undefined;
  if (!isObj(v)) return {};
  const out: ColPx = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === "number" && Number.isFinite(x) && x >= 1 && x <= COL_MAX_PX) out[k] = Math.round(x);
  }
  return out;
}

/** 저장할 글 – part가 있으면 다른 칸은 그대로 두고 그 칸만 바꿔요. */
export function writeColPx(prevRaw: string | null | undefined, px: ColPx, part?: string): string {
  if (part == null) return JSON.stringify(px);
  let v: unknown;
  try {
    v = JSON.parse(prevRaw ?? "");
  } catch {
    v = null;
  }
  const o: Record<string, unknown> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (isObj(x)) o[k] = x;
  o[part] = px;
  return JSON.stringify(o);
}

/** 모든 열 맞춤: 고정 열은 빼고, 잴 수 있는 열만 저장값으로 */
export function fitAllPx(cols: ColDef[], saved: ColPx, measure: (id: string) => number | null | undefined): ColPx {
  const out = { ...saved };
  for (const c of cols) {
    if (c.fixed) continue;
    const m = measure(c.id);
    if (m != null && m > 0) out[c.id] = fitPx(c, m);
  }
  return out;
}

/** 열 폭 합 */
export function totalOf(cols: ColDef[], saved: ColPx): number {
  return cols.reduce((a, c) => a + widthOf(c, saved), 0);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
