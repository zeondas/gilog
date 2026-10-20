// 머릿기호 규칙 (2026-10-16 사용자가 정함, 2026-10-17 위계 규칙으로 바꿈 – CLAUDE.md "공통 입력 규칙", 시안 BulletRule.dc.html)
//
// 여러 줄 칸은 줄마다 머릿기호가 있어요. 기본은 ●(채운 점)예요(2026-10-17 사용자: □는 가독성이 떨어져요).
//   sq 네모 □ · ci 점 ●(기본) · da 작대기 - · none 머릿기호 없음(줄 맨 앞 Backspace로 지운 줄)
// 위계 순서는 □ → ● → - 이고 절대 바꾸지 않아요(공무원 문서 규정).
// 줄 맨 앞에서 "] " → □, ") " → ●, "- " → 작대기 (기호 + 스페이스일 때만)
//
// 들여쓰기는 기호 모양이 아니라 위계로 정해요(layout): 위로 거슬러 올라가며 자기보다 높은 위계 기호가 있을 때만
// 그만큼 들여써요. 빈 줄은 묶음을 나눠요(빈 줄 위는 따지지 않아요). 기호 없는 줄은 lv가 있으면 그 단계, 없으면 바로 윗줄 단계.
//
// 저장 모양: [{"t":"글","k":"sq"}, ...] (k가 없으면 ●, none이면 lv에 단계). 메모는 b(굵게)·s(취소선)도 써요.
// 예전에 글자만 저장한 것과 0.6.x의 기본 줄(k 없음 – 그때는 □)은 모두 ●로 읽어요(사용자 1안).

export type BKind = "sq" | "ci" | "da" | "none";

export type BLine = {
  t: string;
  /** 머릿기호 종류. 없으면 ●(기본)예요. */
  k?: BKind;
  /** 머릿기호 없는 줄의 단계(0~2) */
  lv?: number;
  /** 굵게 (메모) */
  b?: boolean;
  /** 취소선 (메모) */
  s?: boolean;
};

/** 줄 맨 앞에서 이 글자 + 스페이스를 치면 바뀌는 머릿기호 */
export const TRIGGERS: Record<string, BKind> = { "]": "sq", ")": "ci", "-": "da" };

/** 메모 창 머릿기호 단추를 누를 때마다 바뀌는 순서 (위계 순서 그대로 □ → ● → 작대기 → 없음) */
export const CYCLE: BKind[] = ["sq", "ci", "da", "none"];

export const kindOf = (l: BLine): BKind => l.k ?? "ci";

/** 빈 줄(묶음 나누기) */
export const isBlank = (l: BLine) => l.t.trim() === "";

/** 위계 높낮이: □ 0, ● 1, 작대기 2 */
const rank = (k: BKind) => (k === "sq" ? 0 : k === "ci" ? 1 : 2);

/**
 * 줄마다 들여쓰기 단계(띄어쓰기 두 칸 단위)를 셈해요(시안 BulletRule.dc.html의 layout).
 * 개요 방식: 자기보다 높은 위계 기호가 위에 있을 때만 들여쓰고, 같은 위계 이상이 나오면 거기서 멈춰요.
 * 빈 줄은 묶음을 나눠요. 빈 줄이라도 기호가 있으면(적는 중) 자기 단계에 그려요 – 글을 치는 순간 기호가 옮겨 가지 않게.
 */
export function layout(lines: BLine[]): number[] {
  let stack: BKind[] = [];
  let prev = 0;
  return lines.map((l) => {
    const k = kindOf(l);
    if (isBlank(l)) {
      let lv = 0;
      if (k === "none") lv = l.lv ?? prev;
      else {
        const s = stack.slice();
        while (s.length && rank(s[s.length - 1]) >= rank(k)) s.pop();
        lv = s.length;
      }
      stack = [];
      prev = 0;
      return Math.max(0, Math.min(2, lv));
    }
    if (k === "none") {
      const lv = Math.max(0, Math.min(2, l.lv ?? prev));
      prev = lv;
      return lv;
    }
    while (stack.length && rank(stack[stack.length - 1]) >= rank(k)) stack.pop();
    const lv = stack.length;
    stack.push(k);
    prev = lv;
    return lv;
  });
}

/** 머릿기호를 바꿔요. 지울 때(none)는 지금 단계(lv)를 남겨 글 시작 위치를 지켜요. */
export function withKind(l: BLine, k: BKind, lv = 0): BLine {
  const n: BLine = { ...l };
  if (k === "none") {
    n.k = "none";
    n.lv = Math.max(0, Math.min(2, lv));
  } else {
    delete n.lv;
    if (k === "ci") delete n.k;
    else n.k = k;
  }
  return n;
}

/** 새 줄은 윗줄과 같은 머릿기호로 시작해요. 기호 없는 줄이면 윗줄 단계(lv)를 이어요. */
export function nextLine(l: BLine, t = "", lv = 0): BLine {
  const n: BLine = { t };
  if (l.k) n.k = l.k;
  if (l.k === "none") n.lv = lv;
  return n;
}

function clean(l: Partial<BLine>): BLine | null {
  if (!l || typeof l.t !== "string") return null;
  const n: BLine = { t: l.t };
  // 기본(●)은 적지 않아요. 0.6.1의 "dot"(기본 점)도 기본으로 읽어요.
  if (l.k && l.k !== "ci" && (CYCLE as string[]).includes(l.k)) n.k = l.k;
  if (n.k === "none" && typeof l.lv === "number" && l.lv >= 0) n.lv = Math.min(2, Math.round(l.lv));
  if (l.b) n.b = true;
  if (l.s) n.s = true;
  return n;
}

/** 저장된 글자를 줄 목록으로 읽어요. JSON이 아니면(예전 모양) 줄마다 ●예요. */
export function parseLines(raw: string): BLine[] {
  if (!raw) return [];
  const s = raw.trim();
  if (s.startsWith("[")) {
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) {
        return v
          .map((x) => {
            // 업무연락처 메모의 예전 모양: nb(글머리 없음)
            if (x && x.nb && !x.k) return clean({ ...x, k: "none" });
            // 0.6.x의 기본 줄(k 없음)과 □(그때 기본이라 k를 적지 않았어요)은 모두 ●예요(사용자 1안).
            return clean(x);
          })
          .filter((x): x is BLine => !!x);
      }
    } catch {
      /* 글자 그대로 읽어요 */
    }
  }
  return raw.split("\n").map((t) => ({ t }));
}

/**
 * 줄 목록을 저장할 글자로 바꿔요. 묶음 사이 빈 줄은 하나만 남기고, 맨 앞·맨 끝 빈 줄은 빼요.
 * 글이 있는 줄이 없으면 빈 글자예요. (저장 쪽 complaints.rs의 lines()와 같은 규칙)
 */
export function stringifyLines(ls: BLine[]): string {
  const kept: BLine[] = [];
  for (const l of ls) {
    const t = l.t.trim();
    if (!t) {
      if (kept.length && !isBlank(kept[kept.length - 1])) kept.push({ t: "" });
      continue;
    }
    kept.push({ ...l, t });
  }
  while (kept.length && isBlank(kept[kept.length - 1])) kept.pop();
  if (!kept.length) return "";
  return JSON.stringify(kept.map((l) => clean(l)));
}

/** 검색·요약용 글자만 (줄바꿈으로 이어요) */
export const plainOf = (raw: string) => parseLines(raw).map((l) => l.t).join("\n");

/** 첫 줄 글자 (요약용) */
export const firstLineOf = (raw: string) => parseLines(raw).find((l) => l.t.trim())?.t ?? "";

// ---------- 복사·붙여 넣기 ----------

const SYMBOL: Record<BKind, string> = { sq: "□", ci: "○", da: "-", none: "" };

/** 복사할 때의 한 줄 앞부분: 들여쓰기는 띄어쓰기 두 칸씩(위계 단계), 기호는 문서에서 쓰는 글자 */
export function linePrefix(l: BLine, lv: number): string {
  if (isBlank(l)) return "";
  const sym = SYMBOL[kindOf(l)];
  return "  ".repeat(lv) + (sym ? sym + " " : "");
}

export function linesToText(ls: BLine[]): string {
  const lv = layout(ls);
  return ls.map((l, i) => linePrefix(l, lv[i]) + l.t).join("\n");
}

/** 붙여 넣은 글을 줄 목록으로. 앞의 □ ○ ● • · - 등은 기호로 알아보고 떼어 내요(겹치지 않게). 단계는 위계가 정해요. */
export function textToLines(text: string): BLine[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((x) => x.trim())
    .map((raw) => {
      const m = /^[ \t　]*([□■◻▪○◦●•·∙\-–ㆍ])\s+(.*)$/.exec(raw);
      if (!m) return { t: raw.trim() };
      const sym = m[1];
      const t = m[2].trim();
      if ("□■◻▪".includes(sym)) return { t, k: "sq" as BKind };
      if ("-–".includes(sym)) return { t, k: "da" as BKind };
      // ○ ● • · 등은 ●(기본)
      return { t };
    });
}

// ---------- 크기 재기 ----------

/**
 * 머릿기호를 한글 글자 높이의 정중앙에 두고, 들여쓰기를 띄어쓰기 두 칸 폭으로 맞추려고
 * 그 PC의 글꼴로 재서 CSS 변수로 둬요. 글자 크기 설정이 바뀌면 다시 불러요.
 *   --bl-indent: 띄어쓰기 두 칸 폭
 *   --bl-shift: 줄 높이(글자 크기 × 1.5를 정수 px로 반올림)의 가운데에서 한글 글자 가운데까지 내릴 거리
 */
export function measureBullets(fontPx: number) {
  const root = document.documentElement;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return;
  c.font = `${fontPx}px ${family}`;
  const space = c.measureText(" ").width;
  const m = c.measureText("봉일천리야간사고우려임시조치");
  const lh = Math.round(fontPx * 1.5); // 글 줄 높이 round(1.5em, 1px)와 같게(UI 통일 H1)
  let shift = 0;
  if (m.fontBoundingBoxAscent && m.actualBoundingBoxAscent) {
    const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const inkCenter = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    shift = inkCenter - lh / 2;
  }
  root.style.setProperty("--bl-indent", (space * 2).toFixed(2) + "px");
  root.style.setProperty("--bl-shift", shift.toFixed(2) + "px");
}

// ---------- Tab · Shift+Tab (업무일지 메모 편집기 글머리 목록) ----------

/** 이 줄 위에 열려 있는 위계 기호들(같은 묶음 안, 위가 앞). 빈 줄에서 묶음이 끊겨요. */
export function openKinds(lines: BLine[], i: number): BKind[] {
  let stack: BKind[] = [];
  for (const l of lines.slice(0, i)) {
    if (isBlank(l)) {
      stack = [];
      continue;
    }
    const k = kindOf(l);
    if (k === "none") continue;
    while (stack.length && rank(stack[stack.length - 1]) >= rank(k)) stack.pop();
    stack.push(k);
  }
  return stack;
}

/**
 * Tab(한 칸 들이기)·Shift+Tab(한 위계 위로)을 누르면 이 줄이 바뀔 기호. 바뀌지 않으면 null이에요(시안 BulletRule.dc.html onKey).
 * Tab: 바로 위 위계의 다음 기호(□ 아래 ●, ● 아래 -). Shift+Tab: 위에 있는 더 높은 위계 기호.
 * 키를 어디에 붙일지는 엔터규칙 세션이 다시 정해요 – 규칙은 여기 하나예요.
 */
export function tabKind(lines: BLine[], i: number, back: boolean): BKind | null {
  const cur = lines[i];
  // 새 줄을 열자마자(글 없이) Tab을 누르는 일이 많아 빈 줄도 받아요. 기호를 지운 줄은 그대로예요.
  if (!cur || kindOf(cur) === "none") return null;
  const stack = openKinds(lines, i);
  const k = kindOf(cur);
  if (!back) {
    if (i === 0 || isBlank(lines[i - 1]) || !stack.length) return null;
    const above = stack[stack.length - 1];
    const next: BKind | null = above === "sq" ? "ci" : above === "ci" ? "da" : null;
    return next && next !== k ? next : null;
  }
  for (let j = stack.length - 1; j >= 0; j--) if (rank(stack[j]) < rank(k)) return stack[j];
  return null;
}

// ---------- 엔터규칙의 새 줄 (2026-10-17 사용자 – CLAUDE.md "엔터규칙") ----------
// Enter = 같은 위계로 다음 줄 · Shift+Enter = 한 위계 아래(□→●→-, 맨 아래 -는 그대로)
// Ctrl+Enter = 한 위계 위(맨 위 □는 그대로) · 왼쪽 Alt+Enter = 같은 항목 안 줄 바꿈(기호 없이, 글 시작 위치에 맞춤)

/** 한 위계 아래 기호 */
export const downKind = (k: BKind): BKind => (k === "sq" ? "ci" : "da");
/** 한 위계 위 기호 */
export const upKind = (k: BKind): BKind => (k === "da" ? "ci" : "sq");

/**
 * 이 줄이 속한 항목의 기호. 기호 없는 줄(같은 항목 안 줄 바꿈)이면 위로 올라가 처음 만나는 기호예요.
 * 빈 줄이나 맨 위까지 기호가 없으면 null(기호 없는 글)이에요.
 */
export function itemKind(lines: BLine[], i: number): BKind | null {
  for (let j = i; j >= 0; j--) {
    const l = lines[j];
    if (j < i && isBlank(l)) return null;
    const k = kindOf(l);
    if (k !== "none") return k;
  }
  return null;
}

export type NewLineMode = "same" | "down" | "up" | "br";

/**
 * 엔터규칙으로 i번째 줄 아래에 새 줄을 만들 때의 모양(글 t는 커서 뒤 글).
 * lv는 layout(lines)[i] – 기호 없는 줄이 글 시작 위치를 맞출 때 써요.
 */
export function newLineFor(lines: BLine[], i: number, mode: NewLineMode, t: string, lv: number): BLine {
  const cur = lines[i];
  const base = itemKind(lines, i);
  if (mode === "br") return { t, k: "none", lv };
  if (!base) {
    // 기호 없는 글: Enter는 그대로 기호 없는 줄, 위·아래는 ●에서 셈해요.
    if (mode === "same") return { ...nextLine(cur, t, lv) };
    return withKind({ t }, mode === "down" ? "da" : "sq");
  }
  const k = mode === "same" ? base : mode === "down" ? downKind(base) : upKind(base);
  return withKind({ t }, k);
}
