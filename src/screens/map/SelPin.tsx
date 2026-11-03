// 민원 지도 – 고른 닷이 일어서는 핀(11-03 ✔6, 캔버스 판 MapPin3 · MapPinRise 1안).
// 고른 닷이 그 자리에서 1.5배로 커지며 위로 떠오르고 → 머리 밑에서 흰 다리가 내려와 땅에 꽂히고 → 구멍 + 흙 앞 가장자리 + 짧은 흔들림.
// 발밑에 남색 고리가 두 번 퍼진 뒤 옅은 고리 하나가 남아요. 머리는 구멍을 지나지 않아요.
// 지도 그림판과 따로 얹는 작은 그림이라 움직이는 동안 지도를 다시 그리지 않아요(자리는 MapCanvas가 style로만 옮겨요).
import { forwardRef, useEffect, useRef } from "react";

const DARK = "rgba(40,38,52,0.8)";
const SH = "rgba(0,0,0,0.14)";
const NAVY = "#1B2A5E";
const HY = -27; // 끝 → 머리 가운데
const SINK = 4; // 다리 끝이 땅에 박힌 깊이
const DUR = 480;
const ALL = 1450;

const clamp = (t: number) => Math.max(0, Math.min(1, t));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const back = (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

/** 시간 t(0~1, DUR 기준) → 머리 높이·크기, 다리 아래 끝, 구멍 크기, 흔들림(도). 시험이 쓰는 순수 함수. */
export function pose(t: number) {
  const up = easeOut(seg(t, 0, 0.42));
  const hy = HY * up;
  const s = 0.67 + 0.33 * up;
  const sd = easeOut(seg(t, 0.38, 0.62));
  const top = hy + 9 * s;
  const bot = top + (SINK - top) * sd;
  const hole = sd >= 1 ? back(seg(t, 0.58, 0.74)) : 0;
  const w = seg(t, 0.6, 1);
  const rot = t > 0.6 ? Math.sin(w * Math.PI * 3) * (1 - w) * 4 : 0;
  return { hy, s, top, bot, hole, rot };
}

type Props = { color: string; play: number };

/** 바깥 div의 자리(left/top)는 MapCanvas가 정해요(끝 = 땅 자리). 안 보일 땐 visibility hidden. */
const SelPin = forwardRef<HTMLDivElement, Props>(function SelPin({ color, play }, ref) {
  const head = useRef<SVGGElement>(null);
  const stemG = useRef<SVGGElement>(null);
  const stemLines = useRef<SVGLineElement[]>([]);
  const holeB = useRef<SVGGElement>(null);
  const holeF = useRef<SVGPathElement>(null);
  const tilt = useRef<SVGGElement>(null);
  const tilt2 = useRef<SVGGElement>(null);
  const r1 = useRef<SVGEllipseElement>(null);
  const r2 = useRef<SVGEllipseElement>(null);
  const r3 = useRef<SVGEllipseElement>(null);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const ringAt = (el: SVGEllipseElement | null, ms: number, from: number) => {
      if (!el) return;
      const k = clamp((ms - from) / 520);
      if (ms < from) return el.setAttribute("opacity", "0");
      const e = easeOut(k);
      el.setAttribute("rx", String(16 * (0.4 + 1.5 * e)));
      el.setAttribute("ry", String(6.7 * (0.4 + 1.5 * e)));
      el.setAttribute("opacity", String(0.85 * (1 - k)));
    };
    const frame = (now: number) => {
      const ms = now - t0;
      const p = pose(clamp(ms / DUR));
      head.current?.setAttribute("transform", `translate(0 ${p.hy}) scale(${p.s})`);
      const bot = Math.min(p.bot, 0.4);
      for (const l of stemLines.current) {
        l.setAttribute("y1", String(p.top));
        l.setAttribute("y2", String(bot));
      }
      stemG.current?.setAttribute("opacity", bot - p.top > 0.5 ? "1" : "0");
      const hs = Math.max(0, p.hole);
      holeB.current?.setAttribute("transform", `scale(${hs})`);
      holeF.current?.setAttribute("transform", `scale(${hs})`);
      tilt.current?.setAttribute("transform", `rotate(${p.rot})`);
      tilt2.current?.setAttribute("transform", `rotate(${p.rot})`);
      ringAt(r1.current, ms, 240);
      ringAt(r2.current, ms, 700);
      r3.current?.setAttribute("opacity", String(0.5 * clamp((ms - 1150) / 300)));
      if (ms < ALL) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [play]);

  const line = (i: number, stroke: string, w: number, dx = 0) => (
    <line ref={(el) => void (el && (stemLines.current[i] = el))} x1={dx} x2={dx} y1={0} y2={0} stroke={stroke} strokeWidth={w} strokeLinecap="round" />
  );
  return (
    <div ref={ref} className="mp-selpin" aria-hidden="true">
      <svg width="80" height="80" viewBox="-40 -64 80 80">
        <defs>
          <clipPath id="mp-selpin-ground">
            <rect x="-40" y="-70" width="80" height="70.4" />
          </clipPath>
        </defs>
        <ellipse ref={r1} rx="16" ry="6.7" fill="none" stroke={NAVY} strokeWidth="2" opacity="0" />
        <ellipse ref={r2} rx="16" ry="6.7" fill="none" stroke={NAVY} strokeWidth="2" opacity="0" />
        <ellipse ref={r3} rx="16" ry="6.7" fill="none" stroke={NAVY} strokeWidth="2" opacity="0" />
        <g ref={holeB} transform="scale(0)">
          <ellipse rx="9" ry="3.4" cy="0.4" fill="#8A6E50" fillOpacity="0.3" />
          <ellipse rx="4" ry="1.6" cy="0.3" fill="#241A12" fillOpacity="0.9" />
        </g>
        <g ref={tilt}>
          <g ref={stemG} clipPath="url(#mp-selpin-ground)" opacity="0">
            {line(0, SH, 5, 1)}
            {line(1, DARK, 5)}
            {line(2, "#fff", 3)}
          </g>
        </g>
        <path ref={holeF} transform="scale(0)" d="M-4,0.3 A4,1.6 0 0 0 4,0.3 A4,0.72 0 0 1 -4,0.3Z" fill="#7A6048" stroke="rgba(255,255,255,0.85)" strokeWidth="0.7" />
        <g ref={tilt2}>
          <g ref={head} transform="translate(0 0) scale(0.67)">
            <circle cy="1.5" r="13.5" fill={SH} />
            <circle r="13" fill={DARK} />
            <circle r="12" fill="#fff" />
            <circle r="9" fill={color} />
          </g>
        </g>
      </svg>
    </div>
  );
});

export default SelPin;
