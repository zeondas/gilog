// 업무일지 "메모" 기록의 편집기와 보기예요.
// 글자 꾸미기(굵게·기울임·밑줄·취소선), 문단 모양(본문·제목·인용·글머리 목록·번호 목록·들여쓰기), 간단한 표를 써요.
// 키(엔터규칙, keys.ts): Tab 등록(저장) · Esc 취소
//   보통 문단: Enter 다음 문단 · Shift+Enter ● 목록 시작 · Ctrl+Enter 쓰지 않음
//   글머리 목록: 여러 줄 칸 규칙(Enter 같은 위계 · Shift+Enter 아래 · Ctrl+Enter 위 · 왼쪽 Alt+Enter 항목 안 줄 바꿈)
//   표: Enter 다음 칸(줄 끝이면 다음 줄 첫 칸, 마지막 칸이면 줄 추가) · Shift+Enter 아래 칸 · Ctrl+Enter 위 칸 · 왼쪽 Alt+Enter 칸 안 줄 바꿈
//   예전 Tab 기능(표 다음 칸, 목록 들여쓰기)은 없어요. 들여쓰기는 단추로 해요.
import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { BKind, BLine, layout, newLineFor, NewLineMode, tabKind } from "./bullets";
import { keyAction } from "./keys";

// ---------- 정리 ----------

/** 남기는 태그. 나머지는 벗기고 안의 글자만 남겨요. 속성(색, 글꼴 등)은 모두 지워요. */
const KEEP: Record<string, string> = {
  B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", DEL: "s",
  P: "p", DIV: "p", H1: "h3", H2: "h3", H3: "h3", H4: "h3", H5: "h3", H6: "h3",
  UL: "ul", OL: "ol", LI: "li", BLOCKQUOTE: "blockquote", BR: "br",
  TABLE: "table", TBODY: "tbody", THEAD: "tbody", TFOOT: "tbody", TR: "tr", TD: "td", TH: "td",
  COLGROUP: "colgroup", COL: "col",
};
const ALIGNABLE = new Set(["p", "h3", "li", "blockquote", "td"]);
const DROP = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "IMG", "SVG", "IFRAME", "OBJECT"]);

function clean(node: Node, out: Node, doc: Document) {
  node.childNodes.forEach((ch) => {
    if (ch.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(ch.textContent ?? ""));
      return;
    }
    if (ch.nodeType !== Node.ELEMENT_NODE) return;
    const el = ch as Element;
    if (DROP.has(el.tagName)) return;
    const tag = KEEP[el.tagName];
    if (!tag) return clean(el, out, doc);
    const copy = doc.createElement(tag);
    // 정렬만 남겨요(가운데 al-c, 오른쪽 al-r). 속성에 적힌 정렬이 붙은 이름보다 먼저예요.
    if (ALIGNABLE.has(tag)) {
      const st = (el as HTMLElement).style?.textAlign || el.getAttribute("align") || "";
      const a = st ? st : el.classList.contains("al-c") ? "center" : el.classList.contains("al-r") ? "right" : "";
      if (a === "center") copy.className = "al-c";
      else if (a === "right" || a === "end") copy.className = "al-r";
    }
    // 표 칸 폭(사용자가 끌어 정한 것)은 %로만 남겨요. 다른 곳에서 붙여 넣은 표의 폭은 버려요(같은 폭으로 시작).
    if (tag === "col") {
      const w = (el as HTMLElement).style?.width ?? "";
      if (/^\d+(\.\d+)?%$/.test(w)) copy.setAttribute("style", `width: ${w}`);
    }
    // 글머리 목록 줄의 머릿기호 종류(k-sq □, k-da 작대기, nb 지움 — 없으면 ●)와 지운 줄의 단계(lv1·lv2)
    if (tag === "li") {
      const keep = LI_CLASSES.filter((c) => el.classList.contains(c));
      if (keep.length) copy.className = [copy.className, ...keep].filter(Boolean).join(" ");
    }
    out.appendChild(copy);
    if (tag !== "col") clean(el, copy, doc);
  });
  // 폭이 없는 colgroup은 남길 까닭이 없어요.
  out.childNodes.forEach((c) => {
    if (c.nodeName === "COLGROUP" && ![...(c as Element).children].some((x) => x.getAttribute("style"))) c.remove();
  });
}

// ---------- 글머리 목록 = 머릿기호 규칙 (2026-10-17 위계 규칙, CLAUDE.md "머릿기호 규칙") ----------
// 목록은 한 겹(ul > li)이고 줄마다 기호 종류를 이름표로 적어요: 없음 ●(기본), k-sq □, k-da 작대기, nb 기호 지움.
// 들여쓰기는 bullets.ts의 layout(위계 방식)으로 셈해 lv1·lv2를 붙여요. 빈 줄은 묶음을 나눠요.
// 예전 메모(0.6.2까지)는 목록을 겹겹이 넣어 깊이로 기호를 정했어요(1단계 □, 2단계 점, 3단계 작대기).
// 읽을 때 한 겹으로 펴고, 위계는 그대로 두되 기본이 ●가 되게 맞춰요: 깊이 1만 있으면 ●, 2단계까지면 ●·작대기, 3단계면 □·●·작대기.

const LI_CLASSES = ["k-sq", "k-da", "nb", "lv1", "lv2"];
const KIND_CLASS: Record<BKind, string> = { sq: "k-sq", ci: "", da: "k-da", none: "nb" };

function liKind(li: Element): BKind {
  return li.classList.contains("nb") ? "none" : li.classList.contains("k-sq") ? "sq" : li.classList.contains("k-da") ? "da" : "ci";
}

const liLv = (li: Element) => (li.classList.contains("lv2") ? 2 : li.classList.contains("lv1") ? 1 : 0);

/** 목록 줄의 글자(아래에 든 번호 목록 글자는 빼지 않아요 — 줄의 내용이에요) */
const liText = (li: Element) => (li.textContent ?? "").replace(/\u00a0/g, " ").trim();

/** 목록 줄의 기호 종류를 바꿔요. 지울 때(none)는 지금 단계를 남겨요. */
export function setLiKind(li: Element, k: BKind, lv = 0) {
  li.classList.remove("k-sq", "k-da", "nb", "lv1", "lv2");
  if (KIND_CLASS[k]) li.classList.add(KIND_CLASS[k]);
  if (k === "none" && lv > 0) li.classList.add("lv" + Math.min(2, lv));
  if (!li.getAttribute("class")) li.removeAttribute("class");
}

/** 한 목록의 줄들을 머릿기호 규칙 줄 목록으로 */
function linesOf(ul: Element): BLine[] {
  return [...ul.children].map((li) => {
    const k = liKind(li);
    const l: BLine = { t: liText(li) };
    if (k !== "ci") l.k = k;
    if (k === "none") l.lv = liLv(li);
    return l;
  });
}

/** 목록마다 위계 들여쓰기(lv1·lv2)를 다시 셈해요. 빈 줄에는 blank를 붙여 보기에서 기호를 숨겨요. */
export function relayout(root: Element) {
  root.querySelectorAll("ul").forEach((ul) => {
    const lis = [...ul.children];
    const lv = layout(linesOf(ul));
    lis.forEach((li, i) => {
      li.classList.remove("lv1", "lv2", "blank");
      if (lv[i] > 0) li.classList.add("lv" + lv[i]);
      if (!liText(li) && !li.querySelector("table")) li.classList.add("blank");
      if (!li.getAttribute("class")) li.removeAttribute("class");
    });
  });
}

/** 겹겹이 든 글머리 목록(예전 메모, 붙여 넣은 글)이 있는지 */
const hasNested = (root: Element) => !!root.querySelector("ul ul, ul > li ul");

/**
 * 글머리 목록을 한 겹으로 펴고 붙어 있는 목록을 합쳐요. 바꾼 게 있으면 true예요.
 * legacy: 저장된 것을 읽을 때(예전 메모의 깊이 → 기호). 아니면(편집 중 브라우저가 겹친 것) 겹친 줄은 윗줄 기호의 한 위계 아래예요.
 */
export function flattenLists(root: Element, legacy = true): boolean {
  let changed = false;
  const doc = root.ownerDocument;
  const tops = [...root.querySelectorAll("ul")].filter((ul) => !ul.parentElement?.closest("ul"));
  for (const top of tops) {
    if (!hasNested(top) && !top.querySelector(":scope > :not(li)")) continue;
    changed = true;
    type Item = { li: Element; depth: number; own: boolean };
    const items: Item[] = [];
    const walk = (ul: Element, depth: number) => {
      for (const ch of [...ul.childNodes]) {
        if (ch.nodeType !== Node.ELEMENT_NODE) continue;
        const el = ch as Element;
        if (el.tagName === "UL") walk(el, depth + 1);
        else if (el.tagName === "LI") {
          const li = el.cloneNode(false) as Element;
          const subs: Element[] = [];
          for (const c of [...el.childNodes]) {
            if (c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName === "UL") subs.push(c as Element);
            else li.appendChild(c);
          }
          if (!li.firstChild) li.appendChild(doc.createElement("br"));
          // k-sq·k-da를 적은 줄은 새 모양이에요(그대로). 이름표가 없으면 깊이로 정해요.
          items.push({ li, depth, own: li.classList.contains("k-sq") || li.classList.contains("k-da") });
          subs.forEach((u) => walk(u, depth + 1));
        }
      }
    };
    walk(top, 1);
    const maxDepth = Math.min(3, Math.max(1, ...items.filter((x) => !x.own).map((x) => x.depth)));
    const kinds: BKind[] = (["sq", "ci", "da"] as BKind[]).slice(3 - maxDepth);
    const flat = doc.createElement("ul");
    const byDepth: BKind[] = [];
    const below = (k: BKind | undefined): BKind => (k === "sq" ? "ci" : "da");
    for (const { li, depth, own } of items) {
      if (!legacy) {
        // 편집 중: 맨 바깥 줄은 그대로, 겹친 줄은 이름표가 없으면 윗줄의 한 위계 아래
        if (!own && depth > 1 && !li.classList.contains("nb")) setLiKind(li, below(byDepth[depth - 2]));
        byDepth[depth - 1] = liKind(li) === "none" ? byDepth[depth - 2] ?? "ci" : liKind(li);
        byDepth.length = depth;
      } else if (!own) {
        const k = kinds[Math.min(depth, kinds.length) - 1];
        if (li.classList.contains("nb")) setLiKind(li, "none", Math.min(2, depth - 1));
        else setLiKind(li, k);
      }
      flat.appendChild(li);
    }
    top.replaceWith(flat);
  }
  // 바로 붙어 있는 목록은 하나로(묶음은 빈 줄이 나눠요)
  for (const ul of [...root.querySelectorAll("ul")]) {
    const next = ul.nextElementSibling;
    if (next && next.tagName === "UL" && ul.isConnected) {
      while (next.firstChild) ul.appendChild(next.firstChild);
      next.remove();
      changed = true;
    }
  }
  return changed;
}

/** 붙여 넣거나 저장할 HTML을 정해진 모양만 남겨 정리해요. */
export function sanitize(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const box = doc.createElement("div");
  clean(doc.body, box, doc);
  flattenLists(box);
  relayout(box);
  // 빈 문단은 끝에서만 지워요.
  while (box.lastChild && box.lastChild.nodeName === "P" && !(box.lastChild.textContent ?? "").trim() && box.childNodes.length > 1) {
    box.removeChild(box.lastChild);
  }
  return box.innerHTML;
}

/** 글자가 하나도 없고 표도 없으면 빈 메모예요. */
export function isEmptyMemo(html: string): boolean {
  const s = sanitize(html);
  return !s.includes("<table") && !s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

/** 보기에서 검색어를 형광으로 칠해요. */
function highlight(html: string, q: string): string {
  if (!q) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    const v = t.data;
    const lower = v.toLowerCase();
    let at = lower.indexOf(q);
    if (at < 0) continue;
    const frag = doc.createDocumentFragment();
    let i = 0;
    while (at >= 0) {
      if (at > i) frag.append(v.slice(i, at));
      const m = doc.createElement("mark");
      m.textContent = v.slice(at, at + q.length);
      frag.append(m);
      i = at + q.length;
      at = lower.indexOf(q, i);
    }
    if (i < v.length) frag.append(v.slice(i));
    t.replaceWith(frag);
  }
  return doc.body.firstElementChild?.innerHTML ?? html;
}

export function MemoView({ html, q = "" }: { html: string; q?: string }) {
  return <div className="rte-view" dangerouslySetInnerHTML={{ __html: highlight(sanitize(html), q) }} />;
}

// ---------- 편집기 ----------

// 편집하는 동안은 문단을 div로 써요(브라우저의 목록 명령이 p 안에 목록을 넣는 문제를 피해요). 저장할 때 p로 바꿔요.
const EMPTY = "<div><br></div>";
const BLOCKS = new Set(["DIV", "P", "H3", "UL", "OL", "BLOCKQUOTE", "TABLE"]);

/** 저장된 HTML을 편집기 모양으로 바꿔요. */
function toEditing(html: string): string {
  const s = sanitize(html);
  return s ? s.replace(/<p([\s>])/g, "<div$1").replace(/<\/p>/g, "</div>") : EMPTY;
}

/**
 * 문단 안에 다른 문단·목록·표가 들어간 잘못된 모양을 풀어요. 커서 자리는 지켜요.
 * (브라우저 명령이 가끔 이렇게 만들어요.)
 */
function normalize(root: HTMLElement) {
  const bad = [...root.querySelectorAll("div, p")].filter((el) => [...el.children].some((c) => BLOCKS.has(c.tagName)));
  if (!bad.length) return;
  const sel = document.getSelection();
  const keep = sel && sel.rangeCount ? { node: sel.anchorNode, offset: sel.anchorOffset } : null;
  for (const el of bad.reverse()) {
    // 블록이 아닌 글자 덩어리는 div로 감싸 남겨요.
    const parts: Node[] = [];
    let loose: HTMLElement | null = null;
    [...el.childNodes].forEach((ch) => {
      if (ch.nodeType === Node.ELEMENT_NODE && BLOCKS.has((ch as Element).tagName)) {
        loose = null;
        parts.push(ch);
      } else {
        if (ch.nodeType === Node.TEXT_NODE && !(ch.textContent ?? "").trim() && !loose) return;
        if (!loose) {
          loose = document.createElement("div");
          parts.push(loose);
        }
        loose.appendChild(ch);
      }
    });
    el.replaceWith(...parts);
  }
  if (keep?.node && keep.node.isConnected) {
    try {
      sel!.collapse(keep.node, Math.min(keep.offset, keep.node.nodeType === Node.TEXT_NODE ? (keep.node as Text).length : keep.node.childNodes.length));
    } catch {
      /* 커서를 못 돌리면 그대로 둬요 */
    }
  }
}

// ---------- 표 칸 폭 ----------
// 표 폭은 카드 폭에 고정이고(글이 많으면 칸 안에서 줄을 바꿔요), 칸 폭은 사용자가 경계선을 끌어 정해요(0.6.2, 사용자가 정함).
// 칸 폭은 <colgroup><col style="width: N%">로 기록과 함께 저장해요. 폭이 없는 표는 같은 폭으로 나눠 보여요.

/** 표의 칸 폭(%)들. 적힌 것이 없거나 칸 수와 다르면 같은 폭이에요. */
function colWidths(table: HTMLTableElement): number[] {
  const n = Math.max(...[...table.rows].map((r) => r.cells.length), 1);
  const cols = [...table.querySelectorAll(":scope > colgroup > col")] as HTMLElement[];
  const ws = cols.map((c) => parseFloat(c.style.width));
  if (ws.length === n && ws.every((w) => w > 0)) return ws;
  return Array(n).fill(100 / n);
}

/** 칸 폭을 적어요(합이 100%가 되게 맞춰요). */
function setColWidths(table: HTMLTableElement, ws: number[]) {
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  let cg = table.querySelector(":scope > colgroup");
  if (!cg) {
    cg = document.createElement("colgroup");
    table.prepend(cg);
  }
  cg.innerHTML = "";
  for (const w of ws) {
    const col = document.createElement("col");
    col.style.width = ((w / sum) * 100).toFixed(2) + "%";
    cg.appendChild(col);
  }
}

type Align = "left" | "center" | "right";
type Fmt = { b: boolean; i: boolean; u: boolean; s: boolean; block: string; ul: boolean; ol: boolean; inTable: boolean; align: Align };
const NO_FMT: Fmt = { b: false, i: false, u: false, s: false, block: "p", ul: false, ol: false, inTable: false, align: "left" };

const cmd = (name: string, value?: string) => document.execCommand(name, false, value);

export function MemoEditor({
  initial,
  onChange,
  onSubmit,
  onCancel,
  placeholder,
  editorRef,
  lite = false,
}: {
  initial: string;
  onChange: (html: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder: string;
  editorRef?: React.MutableRefObject<HTMLDivElement | null>;
  /** 표·제목·인용 단추 없이(집행현황 메모 — 2026-10-18 사용자: 표 빼고) */
  lite?: boolean;
}) {
  const area = useRef<HTMLDivElement | null>(null);
  const [fmt, setFmt] = useState<Fmt>(NO_FMT);
  const [grid, setGrid] = useState(false);
  const [empty, setEmpty] = useState(isEmptyMemo(initial));

  // 처음 내용은 한 번만 넣어요(쓰는 동안 다시 그리면 커서가 튀어요).
  useEffect(() => {
    if (area.current) area.current.innerHTML = toEditing(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 커서 자리의 꾸밈을 단추에 보여 줘요.
  useEffect(() => {
    const update = () => {
      const sel = document.getSelection();
      const node = sel?.anchorNode ?? null;
      if (!area.current || !node || !area.current.contains(node)) return;
      const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as Element;
      // 빈 목록 줄은 커서가 있을 때만 기호를 그려요(묶음 나누는 빈 줄과 적는 중인 줄을 가려요).
      const li = el.closest("li");
      area.current.querySelectorAll("li.caret").forEach((x) => x !== li && x.classList.remove("caret"));
      if (li && !li.classList.contains("caret")) li.classList.add("caret");
      const blockEl = el.closest("h3,blockquote,p,div,li,td");
      setFmt({
        b: document.queryCommandState("bold"),
        i: document.queryCommandState("italic"),
        u: document.queryCommandState("underline"),
        s: document.queryCommandState("strikeThrough"),
        block: blockEl?.closest("blockquote") ? "blockquote" : blockEl?.tagName === "H3" ? "h3" : "p",
        ul: !!el.closest("ul"),
        ol: !!el.closest("ol"),
        inTable: !!el.closest("td"),
        align: ((): Align => {
          const a = getComputedStyle(blockEl ?? el).textAlign;
          return a === "center" ? "center" : a === "right" || a === "end" ? "right" : "left";
        })(),
      });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  const changed = () => {
    if (area.current) {
      normalize(area.current);
      // 브라우저 명령이 목록을 겹겹이 만들면 한 겹으로 펴고, 위계 들여쓰기를 다시 셈해요.
      flattenLists(area.current, false);
      relayout(area.current);
    }
    const html = area.current?.innerHTML ?? "";
    setEmpty(isEmptyMemo(html));
    onChange(html);
  };

  const run = (name: string, value?: string) => {
    area.current?.focus();
    cmd("defaultParagraphSeparator", "div");
    cmd(name, value);
    changed();
  };

  /**
   * 정렬. 표 안이면 커서가 있는 칸(여러 칸을 골랐으면 그 칸들 모두)에 적용해요. 그 밖에는 고른 문단에 적용해요.
   */
  function align(a: Align) {
    const root = area.current;
    if (!root) return;
    const sel = document.getSelection();
    const cells = [...root.querySelectorAll("td")].filter((td) => sel?.containsNode(td, true));
    if (cells.length) {
      root.focus();
      for (const td of cells) {
        // 칸 안 문단에 따로 붙은 정렬은 지우고 칸에 맞춰요.
        td.querySelectorAll<HTMLElement>("[style]").forEach((x) => x.style.removeProperty("text-align"));
        td.querySelectorAll(".al-c, .al-r").forEach((x) => x.classList.remove("al-c", "al-r"));
        td.style.textAlign = a === "left" ? "" : a;
        if (!td.getAttribute("style")) td.removeAttribute("style");
      }
      changed();
      setFmt((f) => ({ ...f, align: a }));
      return;
    }
    run(a === "center" ? "justifyCenter" : a === "right" ? "justifyRight" : "justifyLeft");
  }

  /** 문단 모양: 같은 것을 다시 누르면 본문으로 돌아가요. */
  const block = (tag: "p" | "h3" | "blockquote") => {
    // 목록 안이면 먼저 목록을 풀어요.
    if (fmt.ul) run("insertUnorderedList");
    else if (fmt.ol) run("insertOrderedList");
    run("formatBlock", fmt.block === tag || tag === "p" ? "div" : tag);
  };

  const cell = () => {
    const n = document.getSelection()?.anchorNode;
    const el = n && (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement);
    const td = el?.closest("td") ?? null;
    return td && area.current?.contains(td) ? (td as HTMLTableCellElement) : null;
  };

  const caretTo = (el: Element) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };

  /** 커서가 있는 맨 바깥 문단(편집기 바로 아래 칸) */
  const topBlock = (): Element | null => {
    const root = area.current;
    let n: Node | null = document.getSelection()?.anchorNode ?? null;
    if (!root || !n || !root.contains(n) || n === root) return null;
    while (n && n.parentNode !== root) n = n.parentNode;
    return n as Element | null;
  };

  function insertTable(rows: number, cols: number) {
    setGrid(false);
    const root = area.current;
    if (!root) return;
    root.focus();
    const table = document.createElement("table");
    setColWidths(table, Array(cols).fill(100 / cols));
    const tbody = table.appendChild(document.createElement("tbody"));
    for (let r = 0; r < rows; r++) {
      const tr = tbody.appendChild(document.createElement("tr"));
      for (let c = 0; c < cols; c++) tr.appendChild(document.createElement("td")).innerHTML = "<br>";
    }
    const after = document.createElement("div");
    after.innerHTML = "<br>";
    // 표 안에 표를 넣지 않고, 지금 문단 아래에 넣어요. 지금 문단이 비어 있으면 그 자리에 넣어요.
    const at = topBlock();
    if (at && at.tagName !== "TABLE" && !(at.textContent ?? "").trim() && !at.querySelector("table")) at.replaceWith(table);
    else if (at) at.after(table);
    else root.appendChild(table);
    if (!table.nextElementSibling) table.after(after);
    caretTo(table.querySelector("td")!);
    changed();
  }

  function tableOp(op: "row" | "col" | "delRow" | "delCol" | "delTable") {
    const td = cell();
    if (!td) return;
    const tr = td.parentElement as HTMLTableRowElement;
    const table = td.closest("table")!;
    const idx = td.cellIndex;
    const rows = [...table.querySelectorAll("tr")] as HTMLTableRowElement[];
    let focus: Element | null = td;
    if (op === "row") {
      const n = tr.cloneNode(false) as HTMLTableRowElement;
      for (let i = 0; i < tr.cells.length; i++) n.insertCell().innerHTML = "<br>";
      tr.after(n);
      focus = n.cells[idx];
    } else if (op === "col") {
      // 새 칸은 지금 칸들의 평균 폭으로 들어가고, 나머지는 비율대로 줄어요.
      const ws = colWidths(table);
      ws.splice(idx + 1, 0, 100 / ws.length);
      setColWidths(table, ws);
      rows.forEach((r) => {
        const c = document.createElement("td");
        c.innerHTML = "<br>";
        (r.cells[idx] ?? r.lastElementChild)?.after(c);
      });
      focus = tr.cells[idx + 1];
    } else if (op === "delRow") {
      if (rows.length <= 1) return tableOp("delTable");
      focus = (tr.nextElementSibling ?? tr.previousElementSibling) as HTMLTableRowElement;
      focus = (focus as HTMLTableRowElement).cells[Math.min(idx, (focus as HTMLTableRowElement).cells.length - 1)];
      tr.remove();
    } else if (op === "delCol") {
      if (tr.cells.length <= 1) return tableOp("delTable");
      const ws = colWidths(table);
      ws.splice(idx, 1);
      setColWidths(table, ws);
      rows.forEach((r) => r.cells[idx]?.remove());
      focus = tr.cells[Math.max(0, idx - 1)];
    } else {
      const p = document.createElement("div");
      p.innerHTML = "<br>";
      table.replaceWith(p);
      focus = p;
    }
    if (focus) caretTo(focus);
    area.current?.focus();
    changed();
  }

  /** 표 안 Enter: 다음 칸(줄 끝이면 다음 줄 첫 칸, 마지막 칸이면 줄을 더해 그 첫 칸) */
  function nextCell() {
    const td = cell();
    if (!td) return;
    const cells = [...td.closest("table")!.querySelectorAll("td")];
    const i = cells.indexOf(td);
    if (i < cells.length - 1) return caretTo(cells[i + 1]);
    tableOp("row");
    const tr = cell()?.parentElement as HTMLTableRowElement | undefined;
    if (tr?.cells[0]) caretTo(tr.cells[0]);
  }

  /** 표 안 Shift+Enter 아래 칸(맨 아래면 줄을 더해요) · Ctrl+Enter 위 칸 */
  function vertCell(down: boolean) {
    const td = cell();
    if (!td) return;
    const tr = td.parentElement as HTMLTableRowElement;
    const rows = [...td.closest("table")!.querySelectorAll("tr")] as HTMLTableRowElement[];
    const to = rows[rows.indexOf(tr) + (down ? 1 : -1)];
    if (to) caretTo(to.cells[Math.min(td.cellIndex, to.cells.length - 1)]);
    else if (down) tableOp("row");
  }

  // ---------- 머릿기호 규칙 (글머리 목록) ----------
  // 새 목록은 ●, 줄 맨 앞 "] " □ · ") " ● · "- " 작대기. 들여쓰기는 위계로(relayout).
  // 목록 줄 맨 앞 Backspace는 머릿기호만 지워요(nb). 기호 없는 줄·빈 줄에서 한 번 더 누르면 보통처럼 윗줄과 합쳐요.

  /** 커서가 있는 목록 줄과, 커서 앞 글자(그 줄 안) */
  function caretLine(): { li: HTMLLIElement | null; block: Element | null; before: string } | null {
    const sel = document.getSelection();
    if (!sel || !sel.isCollapsed || !sel.rangeCount || !area.current) return null;
    const r = sel.getRangeAt(0);
    const n = r.startContainer;
    const el = (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement) as Element | null;
    if (!el || !area.current.contains(el) || el.closest("td")) return null;
    const li = el.closest("li") as HTMLLIElement | null;
    const block = li ?? topBlock();
    if (!block) return null;
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(r.startContainer, r.startOffset);
    return { li, block, before: pre.toString() };
  }

  /** 커서가 있는 글머리 목록 줄(번호 목록은 빼요) */
  const bulletLi = (): HTMLLIElement | null => {
    const n = document.getSelection()?.anchorNode;
    const el = n && (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement);
    const li = (el?.closest("li") ?? null) as HTMLLIElement | null;
    return li && area.current?.contains(li) && li.parentElement?.tagName === "UL" && !li.closest("td") ? li : null;
  };

  function bulletTrigger(): boolean {
    const at = caretLine();
    if (!at || at.before.length !== 1 || !"])-".includes(at.before)) return false;
    if (at.li && at.li.parentElement?.tagName !== "UL") return false;
    const want: BKind = at.before === "]" ? "sq" : at.before === ")" ? "ci" : "da";
    cmd("delete");
    if (!at.li) cmd("insertUnorderedList");
    const li = bulletLi();
    if (li) setLiKind(li, want);
    changed();
    return true;
  }

  function bulletBackspace(): boolean {
    const at = caretLine();
    if (!at || !at.li || at.before !== "" || at.li.parentElement?.tagName !== "UL") return false;
    // 기호 없는 줄·빈 줄은 보통처럼(윗줄과 합치기)
    if (at.li.classList.contains("nb") || !liText(at.li)) return false;
    setLiKind(at.li, "none", liLv(at.li));
    changed();
    return true;
  }

  /**
   * 글머리 목록 줄을 한 위계 아래·위로(들여쓰기·내어쓰기 단추 — 엔터규칙 뒤로 Tab 키는 쓰지 않아요). 규칙은 bullets.ts의 tabKind(시안 BulletRule.dc.html).
   * 글머리 목록 줄이 아니면 false예요. 바꿀 수 없는 줄이어도 목록 줄이면 키는 먹어요(커서가 다음 칸으로 나가지 않게).
   */
  function bulletTab(back: boolean): boolean {
    const li = bulletLi();
    if (!li) return false;
    const lis = [...li.parentElement!.children];
    const k = tabKind(linesOf(li.parentElement!), lis.indexOf(li), back);
    if (k) {
      setLiKind(li, k);
      changed();
    }
    return true;
  }

  /** 들여쓰기·내어쓰기 단추: 글머리 목록이면 위계를, 번호 목록·문단이면 보통 들여쓰기를 바꿔요. */
  const indent = (back: boolean) => {
    area.current?.focus();
    if (!bulletTab(back)) run(back ? "outdent" : "indent");
  };

  // ---------- 표 칸 폭 끌기 ----------

  /** 마우스가 표 칸의 오른쪽 경계(4px 안)에 있으면 그 칸 */
  function edgeCell(e: React.MouseEvent): HTMLTableCellElement | null {
    const td = (e.target as Element).closest?.("td") as HTMLTableCellElement | null;
    if (!td || !area.current?.contains(td)) return null;
    const r = td.getBoundingClientRect();
    if (Math.abs(e.clientX - r.right) <= 4 && td.cellIndex < (td.parentElement as HTMLTableRowElement).cells.length - 1) return td;
    return null;
  }

  function startColDrag(e: React.MouseEvent) {
    const td = edgeCell(e);
    if (!td) return;
    e.preventDefault();
    const table = td.closest("table") as HTMLTableElement;
    const i = td.cellIndex;
    const tw = table.getBoundingClientRect().width;
    const start = colWidths(table);
    const x0 = e.clientX;
    const min = Math.max(4, (40 / tw) * 100);
    const move = (ev: MouseEvent) => {
      // 경계 양쪽 두 칸만 바뀌고 표 폭은 그대로예요.
      const dx = ((ev.clientX - x0) / tw) * 100;
      const a = Math.min(Math.max(start[i] + dx, min), start[i] + start[i + 1] - min);
      const ws = start.slice();
      ws[i] = a;
      ws[i + 1] = start[i] + start[i + 1] - a;
      setColWidths(table, ws);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("col-dragging");
      changed();
    };
    document.body.classList.add("col-dragging");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  /**
   * 글머리 목록 줄에서 새 줄(여러 줄 칸 규칙). 브라우저 명령은 빈 목록 줄에서 목록을 빠져나가서 직접 나눠요.
   * same 같은 위계 · down 한 위계 아래 · up 한 위계 위. br(항목 안 줄 바꿈)은 줄 안에 줄바꿈을 넣어요.
   */
  function bulletNewLine(li: HTMLLIElement, mode: NewLineMode) {
    if (mode === "br") return run("insertLineBreak");
    const sel = document.getSelection();
    if (!sel || !sel.rangeCount) return;
    const ul = li.parentElement!;
    const lis = [...ul.children];
    const i = lis.indexOf(li);
    const lines = linesOf(ul);
    const want = newLineFor(lines, i, mode, "", layout(lines)[i]);
    const r = sel.getRangeAt(0);
    r.deleteContents();
    const tail = document.createRange();
    tail.setStart(r.startContainer, r.startOffset);
    tail.setEnd(li, li.childNodes.length);
    const frag = tail.extractContents();
    const n = document.createElement("li");
    n.appendChild(frag);
    if (!(n.textContent ?? "") && !n.querySelector("br")) n.innerHTML = "<br>";
    if (!(li.textContent ?? "") && !li.querySelector("br")) li.innerHTML = "<br>";
    // 남은 줄 끝의 빈 꾸밈 태그(굵게 등)는 지워요.
    li.querySelectorAll("b,i,u,s").forEach((x) => !(x.textContent ?? "") && !x.querySelector("br") && x.remove());
    li.after(n);
    setLiKind(n, want.k ?? "ci", want.lv ?? 0);
    const c = document.createRange();
    c.setStart(n, 0);
    c.collapse(true);
    sel.removeAllRanges();
    sel.addRange(c);
    changed();
  }

  /** 보통 문단 Shift+Enter: 다음 줄을 ● 목록으로 시작해요(지금 문단이 비어 있으면 그 자리에서). */
  function startList() {
    const at = caretLine();
    if (at?.block && (at.block.textContent ?? "").trim()) run("insertParagraph");
    run("insertUnorderedList");
    const li = bulletLi();
    if (li) {
      setLiKind(li, "ci");
      changed();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    const td = cell();
    const li = td ? null : bulletLi();
    const act = keyAction(e, td ? "table" : li ? "multi" : "para");
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (act === "common.next") {
      // Tab = 저장(등록). 다음 칸이 없어요.
      stop();
      onSubmit();
      return;
    }
    if (act === "common.prev") return; // 카드가 앞 칸으로 옮겨요.
    if (composing) return;
    if (e.key === " " && bulletTrigger()) {
      e.preventDefault();
      return;
    }
    if (e.key === "Backspace" && bulletBackspace()) {
      e.preventDefault();
      return;
    }
    switch (act) {
      case "common.cancel":
        stop();
        onCancel();
        return;
      case "table.next":
        stop();
        return nextCell();
      case "table.down":
        stop();
        return vertCell(true);
      case "table.up":
        stop();
        return vertCell(false);
      case "table.br":
        stop();
        return run("insertLineBreak");
      case "multi.same":
      case "multi.down":
      case "multi.up":
      case "multi.br":
        stop();
        return bulletNewLine(li!, act === "multi.same" ? "same" : act === "multi.down" ? "down" : act === "multi.up" ? "up" : "br");
      case "para.next":
        stop();
        return run("insertParagraph");
      case "para.list":
        stop();
        return startList();
    }
    // 정하지 않은 Enter 조합(보통 문단 Ctrl+Enter 등)은 아무것도 하지 않아요.
    if (e.key === "Enter") stop();
  }

  const B = ({ on, label, onClick, children, wide }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode; wide?: boolean }) => (
    <button type="button" className={"tb" + (wide ? " tb-wide" : "")} aria-label={label} title={label} aria-pressed={on} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  );

  return (
    <div className="rte">
      <div className="rte-bar" role="toolbar" aria-label="메모 꾸미기">
        {!lite && (<>
        <B label="본문" wide on={fmt.block === "p" && !fmt.ul && !fmt.ol && !fmt.inTable} onClick={() => block("p")}>
          본문
        </B>
        <B label="제목" wide on={fmt.block === "h3"} onClick={() => block("h3")}>
          제목
        </B>
        <B label="인용" wide on={fmt.block === "blockquote"} onClick={() => block("blockquote")}>
          인용
        </B>
        <span className="rte-sep" />
        </>)}
        <B label="글머리 목록 (줄 맨 앞 ] ) - 와 스페이스로도 돼요)" on={fmt.ul} onClick={() => run("insertUnorderedList")}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="5" cy="7" r="1.4" fill="currentColor" />
            <circle cx="5" cy="17" r="1.4" fill="currentColor" />
            <path d="M10 7h10M10 17h10" />
          </svg>
        </B>
        <B label="번호 목록" on={fmt.ol} onClick={() => run("insertOrderedList")}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 5h2v5M4 10h3M4 15h3l-3 4h3M10 7h10M10 17h10" />
          </svg>
        </B>
        <B label="들여쓰기 (목록에서 Tab)" onClick={() => indent(false)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 6h10M10 12h10M10 18h10M3 9l3 3-3 3" />
          </svg>
        </B>
        <B label="내어쓰기 (목록에서 Shift+Tab)" onClick={() => indent(true)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 6h10M10 12h10M10 18h10M6 9l-3 3 3 3" />
          </svg>
        </B>
        <span className="rte-sep" />
        <B label="왼쪽 정렬" on={fmt.align === "left"} onClick={() => align("left")}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />
          </svg>
        </B>
        <B label="가운데 정렬" on={fmt.align === "center"} onClick={() => align("center")}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />
          </svg>
        </B>
        <B label="오른쪽 정렬" on={fmt.align === "right"} onClick={() => align("right")}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />
          </svg>
        </B>
        <span className="rte-sep" />
        <B label="굵게 (Ctrl+B)" on={fmt.b} onClick={() => run("bold")}>
          <b>가</b>
        </B>
        <B label="기울임 (Ctrl+I)" on={fmt.i} onClick={() => run("italic")}>
          <i>가</i>
        </B>
        <B label="밑줄 (Ctrl+U)" on={fmt.u} onClick={() => run("underline")}>
          <u>가</u>
        </B>
        <B label="취소선" on={fmt.s} onClick={() => run("strikeThrough")}>
          <s>가</s>
        </B>
        {!lite && (<>
        <span className="rte-sep" />
        <span className="rte-grid-wrap">
          <B label="표 넣기" wide on={grid} onClick={() => setGrid(!grid)}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="1.5" />
              <path d="M3 10h18M3 15h18M9 4v16M15 4v16" />
            </svg>
            표
          </B>
          {grid && <GridPicker onPick={insertTable} onClose={() => setGrid(false)} />}
        </span>
        {fmt.inTable && (
          <>
            <B label="아래에 줄 더하기" wide onClick={() => tableOp("row")}>
              줄+
            </B>
            <B label="오른쪽에 칸 더하기" wide onClick={() => tableOp("col")}>
              칸+
            </B>
            <B label="이 줄 지우기" wide onClick={() => tableOp("delRow")}>
              줄−
            </B>
            <B label="이 칸(세로줄) 지우기" wide onClick={() => tableOp("delCol")}>
              칸−
            </B>
            <B label="표 지우기" wide onClick={() => tableOp("delTable")}>
              표 지우기
            </B>
          </>
        )}
        </>)}
      </div>
      <div
        ref={(el) => {
          area.current = el;
          if (editorRef) editorRef.current = el;
        }}
        className={"rte-area" + (empty ? " is-empty" : "")}
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="메모 내용"
        onInput={changed}
        onKeyDown={onKeyDown}
        onMouseMove={(e) => {
          if (!document.body.classList.contains("col-dragging")) (e.currentTarget as HTMLElement).style.cursor = edgeCell(e) ? "col-resize" : "";
        }}
        onMouseDown={startColDrag}
        onFocus={() => cmd("defaultParagraphSeparator", "div")}
        onPaste={(e) => {
          // 붙여 넣는 글은 정해진 모양만 남겨요(엑셀·한글의 표도 표로 들어와요).
          e.preventDefault();
          const html = e.clipboardData.getData("text/html");
          const text = e.clipboardData.getData("text/plain");
          if (html) cmd("insertHTML", toEditing(html));
          else cmd("insertText", text);
          changed();
        }}
      />
    </div>
  );
}

/** 표 크기 고르기 (최대 8×8) */
function GridPicker({ onPick, onClose }: { onPick: (r: number, c: number) => void; onClose: () => void }) {
  const [hover, setHover] = useState<[number, number]>([2, 3]);
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) close.current();
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);
  return (
    <div ref={ref} className="rte-grid" onMouseDown={(e) => e.preventDefault()}>
      <div className="rte-grid-cells">
        {Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 8 }, (_, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              tabIndex={-1}
              className="rte-grid-cell"
              aria-label={`${r + 1}줄 ${c + 1}칸 표`}
              aria-pressed={r < hover[0] && c < hover[1]}
              onMouseEnter={() => setHover([r + 1, c + 1])}
              onClick={() => onPick(r + 1, c + 1)}
            />
          )),
        )}
      </div>
      <div className="hint rte-grid-size">
        {hover[0]}줄 × {hover[1]}칸
      </div>
    </div>
  );
}
