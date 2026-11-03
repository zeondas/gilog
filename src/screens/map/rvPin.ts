// 민원 지도 – 로드뷰 핀(11-03 ✔11, 네이버지도 방식 – 캔버스 판 MapRvPin5·MapRvPin6).
// ① 지금 로드뷰 자리: 땅에 누운 옅은 파랑 원판 + 보는 쪽 부채꼴 + 아래로 뾰족한 작은 흰 물방울 머리 + 머리 둘레를 도는 띠.
//    띠는 머리 앞쪽(우리 쪽)에 있을 때만 보이고, 뒤로 돌면 가장자리로 서서히 숨어 흰 머리만 남아요 – 뒤통수 그림은 없어요.
//    그래서 360° 어느 쪽이든 끊김 없이 돌아요(옛 눈알 머리는 ±98°에서 렌즈↔뒤통수로 갑자기 바뀌었어요).
// ② 마우스 핀(로드뷰가 켜져 있을 때 손 대신): 같은 머리 + 작은 원판, 움직이는 쪽으로 기울고 띠도 그쪽을 봐요.
// 색: 원판 = 로드뷰 길 파랑(--map-rv) · 부채꼴·띠 = 설정 강조색의 "밝게" 값(--icon-bg, 밝게·어둡게 같음 – ✔7).
// 카카오 그림 파일은 쓰지 않아요(운영정책) – 모두 캔버스에 직접 그려요.

/** 마우스가 가로로 움직인 양(px) → 기울기 목표. look = 띠가 보는 쪽(-1 왼쪽 … 1 오른쪽). 조금 움직인 건 무시해요. */
export function leanOf(dx: number): { look: number; lean: number } {
  if (dx > 1.5) return { look: 1, lean: 8 };
  if (dx < -1.5) return { look: -1, lean: -8 };
  return { look: 0, lean: 0 };
}

/** 지금 값을 목표로 조금씩(한 장면마다) – 다 오면 true */
export function easeTo(cur: { look: number; lean: number }, to: { look: number; lean: number }, k = 0.35): boolean {
  cur.look += (to.look - cur.look) * k;
  cur.lean += (to.lean - cur.lean) * k;
  const done = Math.abs(to.look - cur.look) < 0.02 && Math.abs(to.lean - cur.lean) < 0.3;
  if (done) {
    cur.look = to.look;
    cur.lean = to.lean;
  }
  return done;
}

/** 마우스 핀의 look(-1..1) → 띠가 보는 방향(도, 0 = 북쪽·시계 방향). 가만히 있으면 우리 쪽(남쪽 180°). */
export const lookPan = (look: number) => 180 - look * 90;

const R = 8.2; // 머리 반지름
const CY = -13.5; // 끝(땅) → 머리 가운데
const EDGE = "#B9B8C6";

function dropPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-2.2, -3.2, -R, -6, -R, CY);
  ctx.arc(0, CY, R, Math.PI, 0);
  ctx.bezierCurveTo(R, -6, 2.2, -3.2, 0, 0);
  ctx.closePath();
}

/** 땅 원판 + 보는 쪽 부채꼴(원판 안, 세로를 반으로 눌러 땅에 누운 모양). r = 원판 가로 반지름 */
export function drawDisc(ctx: CanvasRenderingContext2D, x: number, y: number, pan: number, r: number, disc: string, fan: string | null) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.5);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = disc;
  ctx.fill();
  if (fan) {
    const a = ((pan - 90) * Math.PI) / 180;
    const hw = Math.PI / 5.2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a - hw, a + hw);
    ctx.closePath();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = fan;
    ctx.fill();
  }
  ctx.restore();
}

/** 띠가 보이는 조각들(머리 좌표, 끝 = 0,0). 보는 쪽 ±55°를 5°마다 – 앞쪽(우리 쪽 반)에 있는 점만, 이어진 것끼리 한 조각.
 *  각도를 1°씩 돌려도 보이는 점 수가 한 번에 하나씩만 바뀌어요(갑자기 돌지 않음 – 시험으로 고정). */
export function visorSegs(pan: number): [number, number][][] {
  const k = R * 0.42;
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let t = -55; t <= 55; t += 5) {
    const th = ((pan + t) * Math.PI) / 180;
    if (-Math.cos(th) > -0.02) cur.push([Math.sin(th) * R * 0.98, CY + 1.6 - Math.cos(th) * k]);
    else if (cur.length) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out.filter((c) => c.length > 1);
}

/** 흰 물방울 머리 + 도는 띠. (x, y) = 끝(땅). pan = 띠가 보는 방향(도). lean = 기울기(도, + = 오른쪽) */
export function drawRvHead(ctx: CanvasRenderingContext2D, x: number, y: number, pan: number, visor: string, lean = 0) {
  ctx.save();
  // 땅 그림자(기울어도 그대로)
  ctx.beginPath();
  ctx.ellipse(x + 1.2, y + 0.6, 3.4, 1.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();
  ctx.translate(x, y);
  ctx.rotate((lean * Math.PI) / 180);
  // 머리: 은은한 입체(왼쪽 위가 밝아요)
  const g = ctx.createRadialGradient(-2.4, CY - 3, 1, 0, CY, R * 1.6);
  g.addColorStop(0, "#FFFFFF");
  g.addColorStop(0.7, "#F1F1F5");
  g.addColorStop(1, "#D9D9E2");
  dropPath(ctx);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = EDGE;
  ctx.stroke();
  // 띠: 머리 적도(타원)에서 보는 쪽 ±55° – 앞쪽(아래 반)만 보여요
  ctx.save();
  dropPath(ctx);
  ctx.clip();
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.strokeStyle = visor;
  ctx.beginPath();
  for (const seg of visorSegs(pan)) seg.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.stroke();
  ctx.restore();
  // 반짝임
  ctx.beginPath();
  ctx.ellipse(-2.6, CY - 3.4, 2.2, 1.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  ctx.restore();
}

/** 마우스 핀 옆 말풍선 */
export function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, w: number) {
  ctx.save();
  ctx.font = "12px Pretendard, sans-serif";
  const tw = ctx.measureText(text).width + 14;
  let bx = x + 14;
  if (bx + tw > w - 8) bx = x - 14 - tw; // 오른쪽 끝이면 왼쪽으로
  const by = y + CY - R - 26;
  ctx.beginPath();
  ctx.roundRect(bx, by, tw, 22, 6);
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#C8C8D2";
  ctx.stroke();
  ctx.fillStyle = "#2A2A34";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, bx + 7, by + 11.5);
  ctx.restore();
}

export const RV_HINT = "파란 길을 누르면 그 자리 사진";
