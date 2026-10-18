// 도로명주소 → 법정동 지번 (2026-10-18 사용자, 주소 변환 세션).
// 바꾸는 일은 앱(core `address.rs`)이 해요. 여기는 화면이 쓰는 모양·지역 고르기와, 브라우저 미리 보기용 흉내예요.
import { emdsOf } from "./paju";

/** 바꾼 결과 하나 (core RoadHit) */
export type RoadHit = {
  /** 위치 칸 글 "봉일천리 5-31" */
  place: string;
  /** 리·동 이름 */
  name: string;
  /** 지역 칸 후보(하나면 바로, 여럿이면 고르기) */
  areas: string[];
  bldg: string;
  /** 표의 도로명주소 "금정로 20" */
  road: string;
};

export type RoadLookup =
  | { kind: "none" }
  | { kind: "exact"; hit: RoadHit; original: string }
  | { kind: "cands"; list: RoadHit[]; original: string };

/** 도로명주소처럼 보이는지(○○로/○○길 + 번호). 맞을 때만 앱에 물어요. */
export const looksRoad = (s: string) => /[가-힣0-9](로|길)\s*(지하\s*)?\d/.test(s);

/** 지역 칸: 후보가 하나면 그것, 지금 지역이 후보 안에 있으면 그대로, 아니면 비워요(화면이 고르게 해요). */
export function areaFor(hit: RoadHit, now: string): string {
  if (hit.areas.length === 1) return hit.areas[0];
  return hit.areas.includes(now) ? now : "";
}

// ---------- 브라우저 미리 보기용 흉내 (보기 값 6개 근처만) ----------

const SAMPLE = `금정로|0|14|0|금촌동||0|774|12|
금정로|0|14|1|금촌동||0|774|13|
금정로|0|16|0|금촌동||0|774|20|
금정로|0|18|0|금촌동||0|774|22|일산슈퍼
금정로|0|19|0|금촌동||0|950|1|삼한
금정로|0|20|0|금촌동||0|774|21|정원빌딩
금정로|0|22|0|금촌동||0|774|14|미다듬헤어솝
금정로|0|22|1|금촌동||0|774|17|
금정로|0|24|0|금촌동||0|774|19|(주)신현대렌트카
금정로|0|25|0|금촌동||0|949|15|
금정로|0|26|0|금촌동||0|774|1|
금정로|0|26|2|금촌동||0|774|2|
시청로|0|50|0|아동동||0|215|1|파주시청
경의로|0|1246|0|와동동||0|1454|1|
문향로|0|59|0|문산읍|문산리|0|10|6|벽창호파주문산대리점
문향로|0|59|1|문산읍|문산리|0|10|119|GS25편의점
문향로|0|60|0|문산읍|문산리|0|10|208|리틀뱅뱅
문향로|0|60|1|문산읍|문산리|0|10|209|CONUS
문향로|0|61|0|문산읍|문산리|0|10|108|
문향로|0|61|1|문산읍|문산리|0|8|4|
문향로|0|62|0|문산읍|문산리|0|10|210|
문향로|0|62|1|문산읍|문산리|0|10|211|리틀브렌
문향로|0|63|0|문산읍|문산리|0|61|54|삼미정육점
통일로|0|132|0|조리읍|봉일천리|0|15|6|클릭모텔
통일로|0|136|0|조리읍|봉일천리|0|5|31|
통일로|0|137|0|조리읍|봉일천리|0|20|6|봉일천가전가구재활용센터
통일로|0|140|0|조리읍|봉일천리|0|5|8|(주)통인안전보관
필승로|0|500|0|탄현면|성동리|0|663|3|`;

type Row = { road: string; main: number; sub: number; emd: string; ri: string; san: boolean; jm: string; js: string; bldg: string };
let rows: Row[] | null = null;

// 위치 글은 지번(숫자)으로 끝나요 — 주소 뒤 글은 붙이지 않아요(2026-10-18 사용자).
function hitOf(r: Row, _rest: string): RoadHit {
  const name = r.ri || r.emd;
  const place = `${name} ${r.san ? "산 " : ""}${r.jm}${r.js && r.js !== "0" ? "-" + r.js : ""}`;
  return { place, name, areas: r.ri ? [r.emd] : emdsOf(r.emd), bldg: r.bldg, road: `${r.road} ${r.main}${r.sub ? "-" + r.sub : ""}` };
}

/** core `road_to_jibun`과 같은 규칙(간단히) */
export function fakeRoadToJibun(text: string): RoadLookup {
  rows ??= SAMPLE.split("\n").map((l) => {
    const c = l.split("|");
    return { road: c[0], main: +c[2], sub: +c[3], emd: c[4], ri: c[5], san: c[6] === "1", jm: c[7], js: c[8], bldg: c[9] };
  });
  const original = text.split(/\s+/).filter(Boolean).join(" ");
  const m = /(\S+(?:로|길))\s*(?:지하\s*)?(\d+)(?:-(\d+))?\s*(.*)$/.exec(original);
  if (!m) return { kind: "none" };
  if (/(^|\s)(?!파주시)\S+(시|군)\s/.test(original.slice(0, m.index))) return { kind: "none" };
  const [, road, a, b, rest] = m;
  const main = +a;
  const sub = b ? +b : 0;
  const list = rows.filter((r) => r.road === road);
  if (!list.length) return { kind: "none" };
  const hit = list.find((r) => r.main === main && r.sub === sub);
  if (hit) return { kind: "exact", hit: hitOf(hit, rest), original };
  const key = (r: Row) => [+(r.main !== main), +(r.main % 2 !== main % 2), Math.abs(r.main - main), r.main, r.main === main ? Math.abs(r.sub - sub) : r.sub];
  const cmp = (x: Row, y: Row) => {
    const p = key(x), q = key(y);
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i];
    return 0;
  };
  return { kind: "cands", list: [...list].sort(cmp).slice(0, 3).map((r) => hitOf(r, rest)), original };
}
