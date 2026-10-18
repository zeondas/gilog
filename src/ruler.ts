// 기준선 자 — 주소 끝에 ?ruler 를 붙이면 켜지는 숨은 검사 모드(2026-10-18 UI 통일, 공통 결정 로그 21:42).
// 입력칸·자리글·머릿기호 칸·배지마다 글자 상자(잉크가 아니라 글꼴의 위·아래 — 입력칸은 커서 상자)를 재서
//   d = 글자 상자 가운데 y − 칸 가운데 y (CSS px), 기준선 y 를 빨간 선으로 덧그리고 콘솔에 표를 찍어요.
//   devFrac = 기준선이 물리 픽셀에서 걸린 소수 자리(0이 아니면 그 배율에서 반올림이 갈릴 수 있어요).
// 같은 줄(가운데 y가 8px 안)에 놓인 칸끼리 기준선이 0.5px 이상 다르면 노랑으로 칠해요(100%에서 0.5px은 1px로 보여요).
// tools/align/ruler.py 가 window.__ruler() 결과를 화면마다 모아 저장해요.

export interface RulerRow {
  name: string;
  kind: "field" | "multi" | "badge";
  x: number;
  y: number;
  w: number;
  h: number;
  lh: number;
  d: number;
  baseline: number;
  devFrac: number;
  row: number;
  spread: number;
  bad: boolean;
}

const FIELD =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]), select';
const MULTI = 'textarea, [contenteditable="true"]';
const BADGE =
  ".pbadge, .cm-status, .chip, .kind, .td-due, .td-src, .td-link-badge, .kind-key, .jproj-badge, .pr-d, .pr-work, .cal-kbadge, .bd-chip, .mod-tag, .kb-cap, .fx-target, .fx-new, .fx-lock, .jsp, .cm-fpill, .pchip";

const metricCache = new Map<string, { asc: number; desc: number }>();
let ctx: CanvasRenderingContext2D | null = null;

function metrics(cs: CSSStyleDeclaration) {
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  let m = metricCache.get(font);
  if (!m) {
    ctx ??= document.createElement("canvas").getContext("2d");
    if (!ctx) return { asc: parseFloat(cs.fontSize) * 0.95, desc: parseFloat(cs.fontSize) * 0.24 };
    ctx.font = font;
    const t = ctx.measureText("가Ag");
    m = { asc: t.fontBoundingBoxAscent, desc: t.fontBoundingBoxDescent };
    metricCache.set(font, m);
  }
  return m;
}

function px(v: string) {
  return parseFloat(v) || 0;
}

function lineHeightOf(cs: CSSStyleDeclaration, asc: number, desc: number) {
  return cs.lineHeight === "normal" ? asc + desc : px(cs.lineHeight);
}

function nameOf(el: Element) {
  const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join(".") : "";
  const label =
    el.getAttribute("aria-label") || el.getAttribute("placeholder") || ((el as HTMLElement).innerText || "").trim().slice(0, 16);
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${label ? ` "${label}"` : ""}`;
}

function visible(el: Element, r: DOMRect) {
  if (r.width < 8 || r.height < 12) return false;
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

function measureOne(el: Element, kind: RulerRow["kind"]): Omit<RulerRow, "row" | "spread" | "bad"> | null {
  const r = el.getBoundingClientRect();
  if (!visible(el, r)) return null;
  const cs = getComputedStyle(el);
  const { asc, desc } = metrics(cs);
  const lh = lineHeightOf(cs, asc, desc);
  const bt = px(cs.borderTopWidth), bb = px(cs.borderBottomWidth), pt = px(cs.paddingTop), pb = px(cs.paddingBottom);
  let boxCenter = 0;
  // 글자 상자: 입력칸·여러 줄 칸은 caretPositionFromPoint의 커서 상자(브라우저가 실제로 놓은 자리),
  // 배지는 Range의 글줄 상자. 둘 다 높이는 글꼴의 위·아래(잉크 아님)예요.
  let glyph: { top: number; height: number } | null = null;
  const caretAt = (x: number, y: number) => {
    const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; getClientRect?: () => DOMRect | null } | null };
    const cp = doc.caretPositionFromPoint?.(x, y);
    if (!cp || !(cp.offsetNode === el || el.contains(cp.offsetNode))) return null;
    const q = cp.getClientRect?.();
    return q && q.height > 0 ? { top: q.top, height: q.height } : null;
  };
  const pl = px(cs.paddingLeft) + px(cs.borderLeftWidth);
  if (kind === "field") {
    boxCenter = r.top + r.height / 2;
    if (el.tagName !== "SELECT") glyph = caretAt(r.left + Math.min(pl + 3, r.width / 2), r.top + r.height / 2);
    if (!glyph) {
      // 고르기(select) 등 커서가 없는 칸: 안 높이 가운데에 정수 글자 상자
      const inner = r.height - bt - bb - pt - pb;
      const H = Math.round(asc) + Math.round(desc);
      glyph = { top: r.top + bt + pt + (inner - H) / 2, height: H };
    }
  } else if (kind === "multi") {
    // 여러 줄 칸: 첫 줄. 칸 가운데는 한 줄 칸(28)과 같은 띠의 가운데로 봐요.
    const box = el.closest(".bl-ed") ?? el;
    const br = box.getBoundingClientRect();
    boxCenter = br.top + Math.min(br.height, 28) / 2;
    glyph = caretAt(r.left + Math.min(pl + 3, r.width / 2), r.top + bt + pt + Math.min(lh, r.height) / 2);
    if (!glyph) {
      const H = Math.round(asc) + Math.round(desc);
      glyph = { top: r.top + bt + pt + Math.floor((lh - H) / 2), height: H };
    }
  } else {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((q) => q.height > 0 && q.width > 0);
    if (!rects.length) return null;
    glyph = { top: rects[0].top, height: rects[0].height };
    boxCenter = r.top + r.height / 2;
  }
  const baseline = glyph.top + Math.round(asc);
  const d = glyph.top + glyph.height / 2 - boxCenter;
  const dpr = devicePixelRatio || 1;
  return {
    name: nameOf(el),
    kind,
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
    lh,
    d: Math.round(d * 100) / 100,
    baseline: Math.round(baseline * 100) / 100,
    devFrac: Math.round(((baseline * dpr) % 1) * 100) / 100,
  };
}

function scope(): ParentNode {
  return document.querySelector(".overlay") ?? document;
}

export function measureRuler(): RulerRow[] {
  const root = scope();
  const items: Omit<RulerRow, "row" | "spread" | "bad">[] = [];
  const seen = new Set<Element>();
  const add = (sel: string, kind: RulerRow["kind"]) => {
    root.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const m = measureOne(el, kind);
      if (m) items.push(m);
    });
  };
  add(FIELD, "field");
  add(MULTI, "multi");
  add(BADGE, "badge");
  // 같은 줄 묶기: 칸 가운데 y가 8px 안이고 높이가 비슷한 것
  const sorted = items.map((m, i) => ({ m, i, c: m.y + Math.min(m.h, 28) / 2 })).sort((a, b) => a.c - b.c);
  const rowOf = new Array(items.length).fill(0);
  let row = 0, start = -Infinity;
  for (const s of sorted) {
    if (s.c - start > 8) {
      row++;
      start = s.c;
    }
    rowOf[s.i] = row;
  }
  // 같은 줄의 입력칸(한 줄·여러 줄)끼리 기준선이 얼마나 벌어졌는지
  const spreadOf = new Map<number, number>();
  for (let r = 1; r <= row; r++) {
    const bs = items.filter((m, j) => rowOf[j] === r && m.kind !== "badge").map((m) => m.baseline);
    if (bs.length > 1) spreadOf.set(r, Math.max(...bs) - Math.min(...bs));
  }
  return items.map((m, k) => {
    const spread = Math.round((spreadOf.get(rowOf[k]) ?? 0) * 100) / 100;
    return { ...m, row: rowOf[k], spread, bad: m.kind !== "badge" && spread >= 0.5 };
  });
}

let layer: HTMLDivElement | null = null;

function draw(rows: RulerRow[]) {
  if (!layer) {
    layer = document.createElement("div");
    layer.setAttribute("data-ruler", "");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    document.body.appendChild(layer);
  }
  layer.innerHTML = "";
  for (const r of rows) {
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;outline:1px solid rgba(0,120,255,.35);${
      r.bad ? "background:rgba(255,214,0,.28);" : ""
    }`;
    const base = document.createElement("div");
    base.style.cssText = `position:absolute;left:${r.x}px;top:${r.baseline}px;width:${r.w}px;height:0;border-top:1px solid #e00`;
    layer.append(box, base);
  }
}

let timer = 0;

function run(log = false) {
  if (layer) layer.style.display = "none";
  const rows = measureRuler();
  draw(rows);
  if (layer) layer.style.display = "";
  if (log) console.table(rows.map(({ name, kind, d, h, lh, baseline, devFrac, spread, bad }) => ({ name, kind, d, h, lh, baseline, devFrac, spread, bad })));
  return rows;
}

export function installRuler() {
  (window as unknown as { __ruler: () => RulerRow[] }).__ruler = () => run(true);
  const later = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => run(false), 250);
  };
  new MutationObserver((list) => {
    if (list.every((m) => layer && layer.contains(m.target))) return;
    later();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  addEventListener("scroll", later, true);
  addEventListener("resize", later);
  console.info("기준선 자 켜짐 — 콘솔에서 __ruler() 로 표를 찍어요.");
  later();
}
