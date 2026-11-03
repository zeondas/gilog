// 민원 지도 – 로드뷰 핀(11-03 ✔2, 카카오맵 방식을 우리 그림으로 – 캔버스 판 MapRvPin 2판·MapRvEye 1안).
// ① 로드뷰가 켜져 있으면 손 대신 핀(흰 둥근 머리 + 파란 렌즈 눈 + 가는 다리)이 마우스를 따라와요.
//    움직이는 쪽으로 고개·몸을 기울였다가 멈추면 정면으로 – 제자리에서 계속 돌지 않아요.
// ② 지금 로드뷰 자리에는 같은 머리가 서서 사진이 보는 쪽으로 고개를 돌리고, 발밑 부채꼴(60°, 땅에 누운 모양)도 같이 돌아요.
// 카카오 그림 파일은 쓰지 않아요(운영정책) – 모두 캔버스에 직접 그려요.

/** 고개 방향: pan(도, 0 = 북쪽, 시계 방향) → look(렌즈 가로 치우침 -1..1) · front(1 = 렌즈가 우리 쪽, -1 = 뒤통수) */
export function headPose(pan: number): { look: number; front: number } {
  const p = (pan * Math.PI) / 180;
  return { look: Math.sin(p), front: -Math.cos(p) };
}

/** 마우스가 가로로 움직인 양(px) → 기울기 목표. 조금 움직인 건 무시해요. */
export function leanOf(dx: number): { look: number; lean: number } {
  if (dx > 1.5) return { look: 0.75, lean: 10 };
  if (dx < -1.5) return { look: -0.75, lean: -10 };
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

const R = 10; // 머리 반지름(px)
const NECK = 24; // 발끝 → 머리 가운데
const EDGE = "#9696A5";

/** 머리 하나: (x, y) = 발끝(땅). lean = 기울기(도, + = 오른쪽으로) */
export function drawHead(ctx: CanvasRenderingContext2D, x: number, y: number, look: number, front: number, lean = 0) {
  ctx.save();
  // 그림자(기울어도 땅에 그대로)
  ctx.beginPath();
  ctx.ellipse(x, y, 6, 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fill();
  ctx.translate(x, y);
  ctx.rotate((lean * Math.PI) / 180);
  const cy = -NECK;
  // 다리
  ctx.beginPath();
  ctx.moveTo(0, -1);
  ctx.lineTo(0, cy + R - 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#787887";
  ctx.stroke();
  // 목(작은 세모)
  ctx.beginPath();
  ctx.moveTo(-5, cy + R - 3);
  ctx.lineTo(5, cy + R - 3);
  ctx.lineTo(0, cy + R + 5);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = EDGE;
  ctx.stroke();
  // 머리
  ctx.beginPath();
  ctx.arc(0, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = EDGE;
  ctx.stroke();
  if (front > -0.15) {
    // 렌즈 눈(1안 반짝 눈): 크게 · 위 진한 파랑 → 아래 밝은 파랑 · 진한 파랑 테두리 · 반짝이 둘(빛은 늘 왼쪽 위)
    const k = (0.55 + 0.45 * Math.max(0, Math.min(1, front))) * (1 - 0.3 * Math.abs(look)); // 옆을 보면 좁아져요
    const lr = 6.2;
    const lx = look * R * 0.5;
    const ly = cy - 0.4;
    const g = ctx.createLinearGradient(0, ly - lr, 0, ly + lr);
    g.addColorStop(0, "#235FE1");
    g.addColorStop(1, "#5FA5FF");
    ctx.beginPath();
    ctx.ellipse(lx, ly, lr * k, lr, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "#163CAA";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(lx - lr * k * 0.29, ly - lr * 0.4, lr * k * 0.33, lr * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(lx + lr * k * 0.3, ly + lr * 0.4, lr * k * 0.15, lr * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 뒤통수: 회색 띠 하나
    ctx.beginPath();
    ctx.arc(0, cy + 1, R * 0.6, Math.PI * 1.1, Math.PI * 1.9);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#BEBECA";
    ctx.stroke();
  }
  ctx.restore();
}

/** 보는 방향 부채꼴(60°) – 땅에 누운 것처럼 세로를 반으로 눌러요. pan 0 = 북쪽(화면 위), 시계 방향 */
export function drawFan(ctx: CanvasRenderingContext2D, x: number, y: number, pan: number, color: string) {
  const a = ((pan - 90) * Math.PI) / 180;
  const half = Math.PI / 6;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.5);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 44, a - half, a + half);
  ctx.closePath();
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

/** 마우스 핀 옆 말풍선 */
export function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, w: number) {
  ctx.save();
  ctx.font = "12px Pretendard, sans-serif";
  const tw = ctx.measureText(text).width + 14;
  let bx = x + 14;
  if (bx + tw > w - 8) bx = x - 14 - tw; // 오른쪽 끝이면 왼쪽으로
  const by = y - NECK - R - 26;
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
