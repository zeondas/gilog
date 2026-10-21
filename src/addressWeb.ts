// 도로명주소 → 법정동 지번: 웹(주소정보누리집 검색 API) 먼저, 안 되면 내장 표 (2026-10-21 사용자 2안).
// 규칙: docs/qa/address-web.md 8절.
// - 보내는 것은 주소 부분만("파주시 통일로 136"). 이름·연락처·민원 내용·뒤 글("앞", "일원")은 보내지 않아요.
// - 길: 화면 fetch → 옛 방식(JSONP) → 앱 대신 보내기(`juso_http`). 3초 안에 답이 없거나 실패하면 내장 표.
// - 한 번 실패하면 10분 동안은 웹을 건너뛰고 내장만 써요.
import { invoke } from "@tauri-apps/api/core";
import { api, inApp } from "./api";
import { looksRoad, RoadHit, RoadLookup } from "./address";
import { emdsOf } from "./paju";

export type Src = "web" | "table";
/** 바꾼 결과 + 출처 */
export type Found = RoadLookup & { src: Src };
export type Path = "fetch" | "jsonp" | "app";

export type WebStatus = {
  /** 마지막 성공 시각(ISO)과 길 */
  okAt?: string;
  okPath?: Path;
  okMs?: number;
  /** 마지막 실패 시각(ISO)과 이유 */
  failAt?: string;
  failWhy?: string;
};

const KEY_KV = "address.web";
const STATUS_KV = "address.webStatus";
const API = "https://business.juso.go.kr/addrlink/addrLinkApi.do";
const JSONP = "https://www.juso.go.kr/addrlink/addrLinkApiJsonp.do";
export const WAIT_MS = 3000;
export const COOLDOWN_MS = 10 * 60 * 1000;

let key: string | null = null;
let status: WebStatus = {};
let loaded: Promise<void> | null = null;
let failedUntil = 0;
/** 지난번에 된 길부터 해 봐요 */
let lastPath: Path | null = null;

function load(): Promise<void> {
  loaded ??= (async () => {
    try {
      const raw = await api.get(KEY_KV);
      key = raw ? ((JSON.parse(raw) as { key?: string }).key ?? "").trim() : "";
      const st = await api.get(STATUS_KV);
      status = st ? (JSON.parse(st) as WebStatus) : {};
      lastPath = status.okPath ?? null;
    } catch {
      key = key ?? "";
    }
  })();
  return loaded;
}

export async function webKey(): Promise<string> {
  await load();
  return key ?? "";
}

export async function setWebKey(k: string): Promise<void> {
  await load();
  key = k.trim();
  failedUntil = 0;
  await api.set(KEY_KV, JSON.stringify({ key }));
}

export async function webStatus(): Promise<WebStatus & { cooling: boolean }> {
  await load();
  return { ...status, cooling: Date.now() < failedUntil };
}

function saveStatus() {
  api.set(STATUS_KV, JSON.stringify(status)).catch(() => {});
}

// ---------- 보낼 글 ----------

/** 위치 글에서 도로명주소 부분만 골라요. 시·군이 없으면 앞에 "파주시"를 붙여요. 도로명주소가 아니면 null. */
export function addressPart(text: string): { keyword: string; road: string; main: number; sub: number; paju: boolean } | null {
  const t = text.split(/\s+/).filter(Boolean).join(" ");
  // "금정로 12번길 3", "통일로136", "통일로 지하 10", "문향로 61-1"
  const m = /([가-힣0-9]+(?:로|길)(?:\s*\d+(?:번)?길)?)\s*(지하\s*)?(\d+)(?:-(\d+))?/.exec(t);
  if (!m) return null;
  const road = m[1].replace(/\s+/g, "");
  if (!/[가-힣]/.test(road)) return null;
  const main = +m[3];
  const sub = m[4] ? +m[4] : 0;
  // 앞에 적힌 시·도·군·구(파주시가 아닌 곳이면 그 이름을 같이 보내요)
  const before = t.slice(0, m.index).split(" ").map((w) => w.replace(/[(),]/g, ""));
  const region = before.filter((w) => w.length >= 2 && /(특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/.test(w));
  const foreign = region.some((w) => w !== "파주시" && w !== "경기도" && /(시|군)$/.test(w));
  const head = foreign ? region.join(" ") : "파주시";
  const num = `${m[2] ? "지하 " : ""}${main}${sub ? "-" + sub : ""}`;
  return { keyword: `${head} ${road} ${num}`, road, main, sub, paju: !foreign };
}

// ---------- 받은 것 ----------

type Juso = {
  roadAddr?: string;
  jibunAddr?: string;
  siNm?: string;
  sggNm?: string;
  emdNm?: string;
  liNm?: string;
  rn?: string;
  udrtYn?: string;
  buldMnnm?: string;
  buldSlno?: string;
  mtYn?: string;
  lnbrMnnm?: string;
  lnbrSlno?: string;
  bdNm?: string;
};
type Reply = { results?: { common?: { errorCode?: string; errorMessage?: string; totalCount?: string }; juso?: Juso[] | null } };

const num = (s?: string) => (s && s !== "0" ? s : "");

/** 받은 주소 하나 → 위치 칸 모양. 파주시면 "봉일천리 5-31", 밖이면 "고양시 일산동구 장항동 865". */
export function hitOfJuso(j: Juso): RoadHit {
  const paju = (j.sggNm ?? "").startsWith("파주시");
  const name = j.liNm || j.emdNm || "";
  const jibun = `${j.mtYn === "1" ? "산 " : ""}${j.lnbrMnnm ?? ""}${num(j.lnbrSlno) ? "-" + j.lnbrSlno : ""}`;
  const place = paju ? `${name} ${jibun}` : [j.sggNm, j.emdNm, j.liNm, jibun].filter(Boolean).join(" ");
  const areas = !paju ? [] : j.liNm ? [j.emdNm ?? ""] : emdsOf(j.emdNm ?? "");
  const road = `${j.rn ?? ""} ${j.udrtYn === "1" ? "지하 " : ""}${j.buldMnnm ?? ""}${num(j.buldSlno) ? "-" + j.buldSlno : ""}`;
  return { place, name, areas, bldg: j.bdNm ?? "", road: paju ? road : `${j.sggNm ?? ""} ${road}`.trim() };
}

/** 받은 목록 → 결과. 번호까지 같은 것만 골라요. 없으면 null(내장 표로). */
export function pick(list: Juso[], q: { road: string; main: number; sub: number }, original: string): RoadLookup | null {
  const same = list.filter((j) => (j.rn ?? "").replace(/\s+/g, "") === q.road && +(j.buldMnnm ?? -1) === q.main && +(j.buldSlno ?? 0) === q.sub);
  const uniq = same.filter((j, i) => same.findIndex((k) => k.jibunAddr === j.jibunAddr) === i);
  if (!uniq.length) return null;
  // 파주시 밖은 후보로만 보여요(지역 칸이 파주 목록이라 저절로 바꾸지 않아요).
  const inPaju = uniq.every((j) => (j.sggNm ?? "").startsWith("파주시"));
  if (uniq.length === 1 && inPaju) return { kind: "exact", hit: hitOfJuso(uniq[0]), original };
  return { kind: "cands", list: uniq.slice(0, 5).map(hitOfJuso), original };
}

// ---------- 길 ----------

class Fail extends Error {}

function url(base: string, keyword: string, extra = "") {
  const q = new URLSearchParams({ confmKey: key ?? "", keyword, resultType: "json", currentPage: "1", countPerPage: "20" });
  return `${base}?${q.toString()}${extra}`;
}

function parse(text: string): Juso[] {
  const r = JSON.parse(text) as Reply;
  const c = r.results?.common;
  if (!c) throw new Fail("모양이 달라요");
  if (c.errorCode && c.errorCode !== "0") throw new Fail(c.errorMessage || `오류 ${c.errorCode}`);
  return r.results?.juso ?? [];
}

async function viaFetch(keyword: string, ms: number): Promise<Juso[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url(API, keyword), { signal: ctl.signal });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return parse(await res.text());
  } finally {
    clearTimeout(t);
  }
}

let jsonpSeq = 0;
function viaJsonp(keyword: string, ms: number): Promise<Juso[]> {
  return new Promise((resolve, reject) => {
    const name = `__juso${Date.now()}_${jsonpSeq++}`;
    const w = window as unknown as Record<string, unknown>;
    const s = document.createElement("script");
    const done = () => {
      clearTimeout(t);
      delete w[name];
      s.remove();
    };
    const t = setTimeout(() => {
      done();
      reject(new Error("timeout"));
    }, ms);
    w[name] = (data: unknown) => {
      done();
      try {
        resolve(parse(typeof data === "string" ? data : JSON.stringify(data)));
      } catch (e) {
        reject(e);
      }
    };
    s.onerror = () => {
      done();
      reject(new Error("jsonp"));
    };
    s.src = url(JSONP, keyword, `&callback=${name}`);
    document.head.appendChild(s);
  });
}

async function viaApp(keyword: string, ms: number): Promise<Juso[]> {
  const text = await Promise.race([
    invoke<string>("juso_http", { url: url(API, keyword) }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
  return parse(text);
}

const PATHS: Record<Path, (k: string, ms: number) => Promise<Juso[]>> = { fetch: viaFetch, jsonp: viaJsonp, app: viaApp };

/** 웹에 물어요. 성공하면 목록(0건일 수 있음), 실패하면 Fail/오류를 던져요. */
async function ask(keyword: string, budget = WAIT_MS): Promise<{ list: Juso[]; path: Path; ms: number }> {
  const t0 = Date.now();
  const order: Path[] = ["fetch", "jsonp", ...(inApp ? (["app"] as Path[]) : [])];
  if (lastPath && order.includes(lastPath)) order.sort((a, b) => +(b === lastPath) - +(a === lastPath));
  let why = "";
  for (const p of order) {
    const left = budget - (Date.now() - t0);
    if (left <= 50) break;
    try {
      const list = await PATHS[p](keyword, left);
      lastPath = p;
      return { list, path: p, ms: Date.now() - t0 };
    } catch (e) {
      // 승인키·검색어 오류는 길을 바꿔도 같아요.
      if (e instanceof Fail) throw e;
      why = String((e as Error)?.message ?? e);
    }
  }
  throw new Error(why || "timeout");
}

function failed(why: string) {
  failedUntil = Date.now() + COOLDOWN_MS;
  status = { ...status, failAt: new Date().toISOString(), failWhy: why };
  saveStatus();
}

let savedAt = 0;
function succeeded(path: Path, ms: number) {
  const changed = status.okPath !== path || (status.failAt ?? "") > (status.okAt ?? "");
  status = { ...status, okAt: new Date().toISOString(), okPath: path, okMs: ms };
  // 성공은 1분에 한 번만 적어요(찾을 때마다 자료 파일에 쓰지 않게).
  if (changed || Date.now() - savedAt > 60_000) {
    savedAt = Date.now();
    saveStatus();
  }
}

/** 웹 결과(없으면 null – 키 없음·쉬는 중·실패·못 찾음). */
export async function webLookup(text: string): Promise<RoadLookup | null> {
  await load();
  if (!key || !looksRoad(text) || Date.now() < failedUntil) return null;
  const q = addressPart(text);
  if (!q) return null;
  const original = text.split(/\s+/).filter(Boolean).join(" ");
  try {
    const r = await ask(q.keyword);
    succeeded(r.path, r.ms);
    return pick(r.list, q, original);
  } catch (e) {
    failed(String((e as Error)?.message ?? e));
    return null;
  }
}

/** 웹 먼저, 안 되면 내장 표. 결과마다 출처가 붙어요. */
export async function lookupRoad(text: string): Promise<Found> {
  if (!looksRoad(text)) return { kind: "none", src: "table" };
  const web = await webLookup(text);
  if (web) return { ...web, src: "web" };
  const t = await api.roadToJibun(text);
  return { ...t, src: "table" };
}

/** 설정 [시험]: 키로 "파주시 시청로 50"을 물어 어느 길로 됐는지 알려 줘요(쉬는 중이어도 해요). */
export async function testWeb(k?: string): Promise<{ ok: true; path: Path; ms: number; place: string } | { ok: false; why: string }> {
  await load();
  const saved = key;
  if (k != null) key = k.trim();
  try {
    if (!key) return { ok: false, why: "승인키가 없어요" };
    const q = addressPart("시청로 50")!;
    const r = await ask(q.keyword, 6000);
    succeeded(r.path, r.ms);
    failedUntil = 0;
    const got = pick(r.list, q, "시청로 50");
    return { ok: true, path: r.path, ms: r.ms, place: got?.kind === "exact" ? got.hit.place : "" };
  } catch (e) {
    const why = String((e as Error)?.message ?? e);
    failed(why);
    return { ok: false, why };
  } finally {
    if (k != null) key = saved;
  }
}

/** 여러 줄을 한 번에 4개씩 바꿔요(엑셀 가져오기). 웹에서 바꾼 수와 내장으로 바꾼 수를 함께 돌려줘요. */
export async function lookupMany(texts: string[], width = 4): Promise<{ found: (Found | null)[]; web: number; table: number }> {
  const found: (Found | null)[] = texts.map(() => null);
  let next = 0;
  let web = 0;
  let table = 0;
  async function worker() {
    while (next < texts.length) {
      const i = next++;
      if (!looksRoad(texts[i])) continue;
      const f = await lookupRoad(texts[i]).catch(() => null);
      found[i] = f;
      if (f?.kind === "exact") f.src === "web" ? web++ : table++;
    }
  }
  await Promise.all(Array.from({ length: width }, worker));
  return { found, web, table };
}

export const PATH_NAME: Record<Path, string> = { fetch: "화면", jsonp: "옛 방식", app: "앱 대신 보내기" };
