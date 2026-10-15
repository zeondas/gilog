// 머릿기호 규칙 (2026-10-16 사용자가 정함, CLAUDE.md "공통 입력 규칙")
//
// 여러 줄 칸은 줄마다 머릿기호가 있어요. 0.6.2부터 기본은 네모예요(사용자가 정함: 기본 점과 ") " 점이 같은 모양인데 단계가 달라 헷갈렸어요).
//   sq 네모 □(1단계·기본, 들여쓰기 없음) · ci 동그라미(2단계, 띄어쓰기 두 칸, 모양은 채운 점)
//   da 작대기(3단계, 띄어쓰기 네 칸) · none 머릿기호 없음(줄 맨 앞 Backspace로 지운 줄, 단계는 그대로)
// 줄 맨 앞에서 "] " → 네모, ") " → 동그라미, "- " → 작대기 (기호 + 스페이스일 때만)
//
// 저장 모양: [{"t":"글","k":"sq"}, ...] (k가 없으면 네모, none이면 lv에 단계). 메모는 b(굵게)·s(취소선)도 써요.
// 예전에 글자만 저장한 것과 0.6.1의 기본 점 줄(k 없음)은 네모로 읽어요.

export type BKind = "sq" | "ci" | "da" | "none";

export type BLine = {
  t: string;
  /** 머릿기호 종류. 없으면 네모(기본)예요. */
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

/** 메모 창 머릿기호 단추를 누를 때마다 바뀌는 순서 */
export const CYCLE: BKind[] = ["sq", "ci", "da", "none"];

export const kindOf = (l: BLine): BKind => l.k ?? "sq";

/** 들여쓰기 단계 (띄어쓰기 두 칸 단위) */
export function levelOf(l: BLine): number {
  switch (kindOf(l)) {
    case "ci":
      return 1;
    case "da":
      return 2;
    case "none":
      return Math.max(0, Math.min(2, l.lv ?? 0));
    default:
      return 0;
  }
}

/** 머릿기호를 바꿔요. 지울 때(none)는 지금 단계를 남겨 글 시작 위치를 지켜요. */
export function withKind(l: BLine, k: BKind): BLine {
  const n: BLine = { ...l };
  if (k === "none") {
    const lv = levelOf(l);
    n.k = "none";
    if (lv) n.lv = lv;
    else delete n.lv;
  } else {
    delete n.lv;
    if (k === "sq") delete n.k;
    else n.k = k;
  }
  return n;
}

/** 새 줄은 윗줄과 같은 머릿기호·단계로 시작해요. */
export function nextLine(l: BLine, t = ""): BLine {
  const n: BLine = { t };
  if (l.k) n.k = l.k;
  if (l.lv) n.lv = l.lv;
  return n;
}

function clean(l: Partial<BLine>): BLine | null {
  if (!l || typeof l.t !== "string") return null;
  const n: BLine = { t: l.t };
  // 기본(네모)은 적지 않아요. 0.6.1의 "dot"(기본 점)도 기본으로 읽어요.
  if (l.k && l.k !== "sq" && (CYCLE as string[]).includes(l.k)) n.k = l.k;
  if (n.k === "none" && typeof l.lv === "number" && l.lv > 0) n.lv = Math.min(2, Math.round(l.lv));
  if (l.b) n.b = true;
  if (l.s) n.s = true;
  return n;
}

/** 저장된 글자를 줄 목록으로 읽어요. JSON이 아니면(예전 모양) 줄마다 점이에요. */
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

/** 줄 목록을 저장할 글자로 바꿔요. 빈 줄은 빼고, 남는 것이 없으면 빈 글자예요. */
export function stringifyLines(ls: BLine[]): string {
  const kept = ls.map((l) => ({ ...l, t: l.t.trim() })).filter((l) => l.t);
  if (!kept.length) return "";
  return JSON.stringify(kept.map((l) => clean(l)));
}

/** 검색·요약용 글자만 (줄바꿈으로 이어요) */
export const plainOf = (raw: string) => parseLines(raw).map((l) => l.t).join("\n");

/** 첫 줄 글자 (요약용) */
export const firstLineOf = (raw: string) => parseLines(raw).find((l) => l.t.trim())?.t ?? "";

// ---------- 복사·붙여 넣기 ----------

const SYMBOL: Record<BKind, string> = { sq: "□", ci: "○", da: "-", none: "" };

/** 복사할 때의 한 줄: 들여쓰기는 띄어쓰기 두 칸씩, 기호는 문서에서 쓰는 글자 */
export function lineToText(l: BLine): string {
  const pad = "  ".repeat(levelOf(l));
  const sym = SYMBOL[kindOf(l)];
  return pad + (sym ? sym + " " : "") + l.t;
}

export const linesToText = (ls: BLine[]) => ls.map(lineToText).join("\n");

/** 붙여 넣은 글을 줄 목록으로. 앞의 □ ○ ● • · - ※ 등은 단계로 알아보고 떼어 내요(겹치지 않게). */
export function textToLines(text: string): BLine[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((x) => x.trim())
    .map((raw) => {
      const m = /^([ \t　]*)([□■◻▪○◦●•·∙\-–ㆍ])\s+(.*)$/.exec(raw);
      if (!m) return { t: raw.trim() };
      const sym = m[2];
      const t = m[3].trim();
      if ("□■◻▪".includes(sym)) return { t, k: "sq" as BKind };
      if ("○◦".includes(sym)) return { t, k: "ci" as BKind };
      if ("-–".includes(sym)) return { t, k: "da" as BKind };
      // • · ● 등은 기본 점. 앞 공백이 두 칸 이상이면 동그라미 단계로 봐요.
      const sp = m[1].replace(/\t/g, "    ").replace(/　/g, "  ").length;
      return sp >= 2 ? { t, k: "ci" as BKind } : { t };
    });
}

// ---------- 크기 재기 ----------

/**
 * 머릿기호를 한글 글자 높이의 정중앙에 두고, 들여쓰기를 띄어쓰기 두 칸 폭으로 맞추려고
 * 그 PC의 글꼴로 재서 CSS 변수로 둬요. 글자 크기 설정이 바뀌면 다시 불러요.
 *   --bl-indent: 띄어쓰기 두 칸 폭
 *   --bl-shift: 줄 높이(글자 크기 × 1.5)의 가운데에서 한글 글자 가운데까지 내릴 거리
 */
export function measureBullets(fontPx: number) {
  const root = document.documentElement;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return;
  c.font = `${fontPx}px ${family}`;
  const space = c.measureText(" ").width;
  const m = c.measureText("봉일천리야간사고우려임시조치");
  const lh = fontPx * 1.5;
  let shift = 0;
  if (m.fontBoundingBoxAscent && m.actualBoundingBoxAscent) {
    const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const inkCenter = base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    shift = inkCenter - lh / 2;
  }
  root.style.setProperty("--bl-indent", (space * 2).toFixed(2) + "px");
  root.style.setProperty("--bl-shift", shift.toFixed(2) + "px");
}
