// 업무일지 조각끼리 함께 쓰는 것 – 화면 값 묶음(Ctx)·카드 두 단(CardCols·splitCards)·말 배지 색(badgeStyle).
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Contact, Project } from "../../api";
import { Speaker, speakerColor } from "../../journal";
import { Kind } from "../../settingsStore";

/** 화면 전체가 함께 쓰는 값 */
export type Ctx = {
  myName: string;
  kinds: Kind[];
  contacts: Contact[];
  projects: Project[];
  byId: Map<number, Project>;
};

// ---------- 카드 두 단 ----------

/**
 * 카드를 두 단에 나눠요(최근 기록이 맨 앞, 순서는 한 번만 꺾여요 – 왼쪽 단 위→아래, 그다음 오른쪽 단 위→아래).
 * mode "screen"(그날 일지, 2026-10-16 사용자):
 *   기준 높이 = 카드가 시작하는 곳부터 일지 화면 맨 아래(아래 여백만 빼고)까지, 지금 창 크기로 재요.
 *   ① 모두 왼쪽 단에 들어가면 전부 왼쪽. ② 왼쪽 단을 기준 높이까지 채우고 넘치는 것부터 오른쪽 – 오른쪽도 들어가면 끝.
 *   ③ 그래도 넘치면 화면 기준은 버리고 두 단 높이가 가장 비슷해지는 곳에서 나눠요(화면 전체가 스크롤돼요).
 *   카드 한 장이 기준 높이보다 길면 그 카드만 왼쪽 단 맨 위, 다음 카드부터 오른쪽이에요.
 * mode "balance"(검색 결과의 날짜 묶음): ③만 써요.
 * 다시 나누는 때는 relayout 글자가 바뀔 때(날짜를 열 때, 기록을 등록·고치기·지울 때)와 창 크기를 바꿀 때뿐이에요.
 * 글을 쓰는 동안(카드가 커져도)은 다시 나누지 않아 카드가 단 사이를 옮겨 다니지 않아요.
 * 재는 동안은 모든 카드를 왼쪽 단에 보이지 않게 그리고, 화면에 그리기 전에(useLayoutEffect) 자리를 잡아요.
 */
export function CardCols({ mode, relayout, children }: { mode: "screen" | "balance"; relayout: string; children: ReactNode[] }) {
  const items = children;
  const n = items.length;
  const box = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<number | null>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSize((x) => x + 1));
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  // 나눌 때가 되면 재기부터 다시 해요.
  useLayoutEffect(() => setSplit(null), [relayout, size, n]);

  useLayoutEffect(() => {
    if (split !== null) return;
    const el = box.current;
    const col = el?.firstElementChild;
    if (!el || !col) return;
    const hs = [...col.children].map((c) => c.getBoundingClientRect().height + (parseFloat(getComputedStyle(c).marginBottom) || 0));
    const gap = hs.length ? parseFloat(getComputedStyle(col.children[0]).marginBottom) || 0 : 0;
    let avail = Infinity;
    // 기록 목록 상자(.jn-scroll)가 스크롤하는 곳이에요 – 없으면 예전처럼 화면 전체(.main).
    const main = mode === "screen" ? ((el.closest(".jn-scroll") ?? el.closest(".main")) as HTMLElement | null) : null;
    if (main) {
      // 상자를 맨 위로 올렸을 때 보이는 아래 끝(아래 여백만 빼고)까지. 내려 둔 채 다시 나누어도 같게 재요.
      const pb = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      avail = main.clientHeight - pb - top;
    }
    setSplit(splitCards(hs, gap, avail));
  }, [split, mode]);

  const k = split ?? n;
  return (
    <div ref={box} className="jn-cols" style={split === null ? { visibility: "hidden" } : undefined}>
      <div className="jn-col">{items.slice(0, k)}</div>
      <div className="jn-col">{items.slice(k)}</div>
    </div>
  );
}

/** 카드 높이(아래 간격 포함)로 왼쪽 단에 둘 장 수를 정해요. avail이 Infinity면 ③(높이 비슷하게)만 써요. */
export function splitCards(hs: number[], gap: number, avail: number): number {
  const n = hs.length;
  if (n <= 1) return n;
  const sum = (a: number, b: number) => hs.slice(a, b).reduce((x, y) => x + y, 0) - gap;
  if (Number.isFinite(avail)) {
    if (sum(0, n) <= avail) return n; // ①
    if (sum(0, 1) > avail) return 1; // 첫 카드가 기준보다 길면 그 카드만 왼쪽
    let k = 1;
    while (k < n && sum(0, k + 1) <= avail) k++;
    if (sum(k, n) <= avail) return k; // ②
  }
  // ③ 두 단 높이가 가장 비슷해지는 곳(같으면 왼쪽이 긴 쪽)
  let best = 1;
  let diff = Infinity;
  for (let s = 1; s < n; s++) {
    const d = Math.abs(sum(0, s) - sum(s, n));
    if (d < diff - 0.5) {
      diff = d;
      best = s;
    }
  }
  return best;
}

// ---------- 말 배지 ----------

export function badgeStyle(s: Speaker) {
  if (s.me) return undefined;
  const k = speakerColor(s.who);
  return { background: `var(--pj-${k}-bg)`, color: `var(--pj-${k}-fg)`, borderColor: `var(--pj-${k}-bg)` };
}

/** 입력 중의 배지. 누르면 말한 사람이 바뀌어요. */
