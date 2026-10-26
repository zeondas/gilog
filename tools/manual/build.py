"""기록 사용자 매뉴얼 만들기 – 지킴이 장면 캡처 + 번호 + 설명을 A4 한 파일(HTML)로.

  python3 tools/manual/build.py <지킴이 빌드 폴더> [결과 파일]

- 글: docs/manual/<화면>.md (틀은 docs/manual/README.md, 모양은 docs/manual/sample.html)
- 그림: 장면을 2배로 찍고, 번호 자리는 md에 적은 요소 이름(선택자)을 찍는 순간 재서 얹어요.
- 결과: 그림·글꼴·로고를 모두 넣은 HTML 한 파일(기본 docs/manual/기록-매뉴얼.html). 브라우저에서 열고 인쇄하면 A4예요.
- 잴 수 없는 요소가 있으면 끝에 목록을 적고 끝 값 1로 끝나요(그 화면 세션에 "이름표(data-help)" 부탁).
"""
import asyncio
import base64
import datetime
import html
import io
import os
import re
import sys

from PIL import Image
from playwright.async_api import async_playwright

import cap

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DOCS = os.path.join(ROOT, "docs", "manual")
FONT = os.path.join(ROOT, "src", "fonts", "PretendardVariable.woff2")
LOGO = os.path.join(ROOT, "brand", "logo-black.svg")

# 사이드바 순서 – 파일 이름(영문)과 화면 이름
ORDER = [
    ("explorer", "탐색기"), ("complaints", "민원대장"), ("process", "민원처리"), ("budget", "집행현황"),
    ("bstatus", "예산현황"), ("calendar", "캘린더"), ("tasks", "할 일"), ("journal", "업무일지"),
    ("contacts", "업무연락처"), ("settings", "설정"),
]

PAGE_W = 794            # A4 폭(96dpi)
PAD = 48                # 좌우 여백
INDENT = 34             # 구분 번호 뒤 들여쓰기
IMG_W = PAGE_W - PAD * 2 - INDENT   # 화면 그림 폭
BAND = 38               # 그림 위·아래 번호 자리
RING = 20               # 번호 원 지름
GAP = 26                # 번호 원 사이 가장 좁은 간격
OPEN_W = (IMG_W - 24) // 2  # 열린 모습 그림 한 칸 폭(두 칸)
OPEN_SCALE = 1.0   # 열린 모습은 화면 크기 그대로(키우지 않아요)
OPEN_H = 340       # 열린 모습 그림 가장 큰 높이


# ---------- md 읽기 ----------
def parse(path):
    """docs/manual/<화면>.md → dict. 틀은 README "② 글 틀"."""
    d = {"title": "", "def": "", "scene": "", "crop": "", "intent": [], "marks": [], "opens": [], "tips": [], "check": [], "detail": []}
    sec = None
    for raw in open(path, encoding="utf-8"):
        line = raw.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("<!--"):
            continue
        if line.startswith("# "):
            d["title"] = line[2:].strip()
            continue
        if line.startswith("### ") and sec == "상세 설명":
            d["detail"].append({"title": line[4:].strip(), "parts": []})
            continue
        if line.startswith("## "):
            sec = line[3:].strip()
            continue
        if sec == "상세 설명" and d["detail"]:
            t = line.strip()
            m = re.match(r"^그림:\s*(.*)$", t)
            if m:
                f = [x.strip() for x in m.group(1).split("|")] + ["", "", ""]
                d["detail"][-1]["parts"].append(("fig", {"scene": f[0], "sel": f[1], "cap": f[2]}))
            elif re.match(r"^\d+\.\s", t):
                d["detail"][-1]["parts"].append(("step", re.sub(r"^\d+\.\s+", "", t)))
            elif t.startswith("- "):
                d["detail"][-1]["parts"].append(("dot", t[2:].strip()))
            else:
                d["detail"][-1]["parts"].append(("p", t))
            continue
        m = re.match(r"^(정의|장면|자르기):\s*(.*)$", line)
        if m and sec is None:
            d[{"정의": "def", "장면": "scene", "자르기": "crop"}[m.group(1)]] = m.group(2).strip()
            continue
        item = re.sub(r"^\s*(?:[-*]|\d+\.)\s+", "", line).strip()
        if sec == "기획 의도":
            d["intent"].append(item)
        elif sec == "번호":
            parts = [x.strip() for x in item.split("|")]
            while len(parts) < 4:
                parts.append("")
            d["marks"].append({"name": parts[0], "sel": parts[1], "text": parts[2], "hint": parts[3]})
        elif sec == "열린 모습":
            parts = [x.strip() for x in item.split("|")]
            while len(parts) < 4:
                parts.append("")
            d["opens"].append({"scene": parts[0], "sel": parts[1], "title": parts[2], "text": parts[3]})
        elif sec == "알아 두면 좋은 것":
            d["tips"].append(item)
        elif sec == "확인":
            d["check"].append(item)
    return d


# ---------- 글 다듬기 ----------
def inline(s):
    """md 글 → HTML: **굵게**, `키` → 키 모양."""
    s = html.escape(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"`(.+?)`", r"<kbd>\1</kbd>", s)
    return s


def png_uri(img):
    """그림을 256색으로 줄여 PNG data URI로(화면 그림이라 티가 거의 안 나요)."""
    buf = io.BytesIO()
    img.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def trim_bottom(img, bg_tol=6, keep=14):
    """아래쪽 빈 바탕을 잘라요(맨 아래 줄 색과 같은 줄이 이어지는 곳)."""
    g = img.convert("L")
    w, h = g.size
    px = g.load()
    bg = px[w // 2, h - 1]
    y = h - 1
    while y > 0:
        row = [px[x, y] for x in range(0, w, 3)]
        if max(abs(v - bg) for v in row) > bg_tol:
            break
        y -= 1
    return min(h, y + keep * cap.DPR)


# ---------- 번호 원 가운데 맞춤 ----------
FIX_HTML = """<!doctype html><meta charset=utf-8><style>
@font-face{font-family:P;src:url(%s) format('woff2');font-weight:100 900}
body{margin:0;font-family:P;background:#fff}
.n{position:absolute;display:flex;align-items:center;justify-content:center;line-height:1;font-variant-numeric:tabular-nums;font-weight:700;color:#000}
.s{width:24px;height:24px;font-size:13px}
.r{width:%dpx;height:%dpx;font-size:11px}
</style>%s"""


async def measure_fix(br):
    """숫자마다 잉크(실제 획) 가운데가 상자 가운데에서 얼마나 비켜 있는지 재요 → 바로잡을 값."""
    cells, n = [], 0
    for kind in ("s", "r"):
        for d in range(1, 21):
            x, y = 10 + (n % 10) * 40, 10 + (n // 10) * 40
            cells.append((kind, str(d), x, y))
            n += 1
    body = "".join(f'<div class="n {k}" style="left:{x}px;top:{y}px">{t}</div>' for k, t, x, y in cells)
    font = "data:font/woff2;base64," + base64.b64encode(open(FONT, "rb").read()).decode()
    ctx = await br.new_context(viewport={"width": 420, "height": 180}, device_scale_factor=4)
    p = await ctx.new_page()
    await p.set_content(FIX_HTML % (font, RING, RING, body))
    await p.evaluate("() => document.fonts.ready")
    im = Image.open(io.BytesIO(await p.screenshot())).convert("L")
    await ctx.close()
    fix = {}
    for k, t, x, y in cells:
        size = 24 if k == "s" else RING
        c = im.crop((x * 4, y * 4, (x + size) * 4, (y + size) * 4))
        w, h = c.size
        px = c.load()
        pts = [(i, j) for i in range(w) for j in range(h) if px[i, j] < 128]
        if not pts:
            continue
        xs = [a for a, _ in pts]
        ys = [b for _, b in pts]
        dx = ((min(xs) + max(xs)) / 2 - (w - 1) / 2) / 4
        dy = ((min(ys) + max(ys)) / 2 - (h - 1) / 2) / 4
        fix[k + t] = (round(dx, 2), round(dy, 2))
    return fix


def fix_style(fix, key):
    """잉크가 비켜 간 만큼 반대쪽에 안쪽 여백을 더해 숫자를 가운데로 옮겨요."""
    dx, dy = fix.get(key, (0, 0))
    t, r, b, l = max(0, -dy * 2), max(0, dx * 2), max(0, dy * 2), max(0, -dx * 2)
    return f"padding:{t:.2f}px {r:.2f}px {b:.2f}px {l:.2f}px"


# ---------- 번호 자리 정하기 ----------
def place(marks, w):
    """같은 줄(위·아래)의 번호 원이 겹치지 않게 옆으로 밀어요."""
    for side in ("top", "bot"):
        ms = sorted([m for m in marks if m["side"] == side], key=lambda m: m["tx"])
        lo = RING / 2 + 2
        for m in ms:
            m["cx"] = max(m["tx"], lo)
            lo = m["cx"] + GAP
        hi = w - RING / 2 - 2
        for m in reversed(ms):
            if m["cx"] > hi:
                m["cx"] = hi
            hi = m["cx"] - GAP


# ---------- 찍기 ----------
async def shoot_chapter(br, url, ch, missing):
    ctx, p = await cap.open_scene(br, url, ch["scene"])
    main = await cap.box(p, ch["crop"] or ".main")
    marks = []
    for i, m in enumerate(ch["marks"]):
        b = await cap.box(p, m["sel"]) if m["sel"] else None
        if not b:
            missing.append(f'{ch["title"]} {i + 1}. {m["name"]} – `{m["sel"]}`')
        marks.append({**m, "box": b})
    low_v = await p.evaluate("""(sel) => {
      const root = document.querySelector(sel) || document.body; const boxes = [];
      for (const e of root.querySelectorAll('*')) {
        const r = e.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.height > 160 || r.bottom > innerHeight) continue;
        const leaf = e.matches('input, textarea, button, svg, img, select') || [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (leaf) boxes.push([r.top, r.bottom]);
      }
      // 위에서부터 내려가다 빈 곳이 150px 넘게 이어지면 거기서 끊어요(표 아래 안내 줄 같은 외딴 글은 빼요)
      boxes.sort((a, b) => a[0] - b[0]); let b = 0;
      for (const [t, bt] of boxes) { if (b && t - b > 150) break; b = Math.max(b, bt); }
      return b; }""", ch["crop"] or ".main")
    # 글 속 {{선택자}} – 그 요소를 작게 잘라 글 줄 안에 넣어요(머리 줄 단추 모양 등)
    chips = {}
    for sub in ch["detail"]:
        for kind, v in sub["parts"]:
            for sel in re.findall(r"\{\{(.+?)\}\}", v if isinstance(v, str) else v.get("cap", "")):
                if sel not in chips:
                    chips[sel] = await cap.box(p, sel)
                    if not chips[sel]:
                        missing.append(f'{ch["title"]} 글 속 그림 – `{sel}`')
    shot = Image.open(io.BytesIO(await p.screenshot())).convert("RGB")
    await ctx.close()
    D0 = cap.DPR
    ch["chips"] = {}
    for sel, b in chips.items():
        if b:
            im = shot.crop((int(b["x"] * D0), int(b["y"] * D0), int((b["x"] + b["width"]) * D0), int((b["y"] + b["height"]) * D0)))
            h = 22
            ch["chips"][sel] = f'<img class="chip" src="{png_uri(im)}" style="height:{h}px;width:{b["width"] * h / b["height"]:.0f}px" alt="">'

    D = cap.DPR
    x0, y0 = int(main["x"]), int(main["y"])
    x1, y1 = int(main["x"] + main["width"]), int(main["y"] + main["height"])
    # 번호가 가리키는 요소가 다 들어가게 아래를 늘리고, 빈 바탕은 잘라요
    need = max([int(m["box"]["y"] + m["box"]["height"]) + 12 for m in marks if m["box"]] + [y0 + 60])
    region = shot.crop((x0 * D, y0 * D, x1 * D, y1 * D))
    # 내용 아래 끝: 글·칸·단추가 있는 가장 아래 요소(표 테두리처럼 빈 틀은 빼요) – 없으면 그림으로 잘라요
    low = low_v
    cut = max(min(trim_bottom(region) // D, (low - y0 + 16) if low else 10**6), need - y0)
    region = region.crop((0, 0, region.width, min(region.height, cut * D)))
    s = IMG_W / (x1 - x0)
    h = region.height / D * s
    for m in marks:
        b = m["box"]
        if not b:
            continue
        hint = m["hint"]
        cx = b["x"] + b["width"] / 2
        if "왼끝" in hint:
            cx = b["x"] + 6
        elif "오른끝" in hint:
            cx = b["x"] + b["width"] - 6
        mid = b["y"] + b["height"] / 2 - y0
        side = "top" if "위" in hint else "bot" if "아래" in hint else ("top" if mid * s < h / 2 else "bot")
        m["side"] = side
        m["tx"] = (cx - x0) * s
        m["ty"] = BAND + ((b["y"] - y0) if side == "top" else (b["y"] + b["height"] - y0)) * s
        m["ty"] = m["ty"] - 1.5 if side == "top" else m["ty"] + 1.5
    place([m for m in marks if m["box"]], IMG_W)
    # 번호는 그림을 읽는 차례대로 다시 매겨요: 위 줄 왼쪽 → 오른쪽, 다음 아래 줄 왼쪽 → 오른쪽
    marks.sort(key=lambda m: (m["box"] is None, m.get("side") != "top", m.get("cx", 0)))
    ch["marks"] = marks
    return {"img": png_uri(region), "h": h, "marks": marks}


async def shoot_open(br, url, o, missing, title, full=False):
    ctx, p = await cap.open_scene(br, url, o["scene"])
    b = await cap.box(p, o["sel"]) if o["sel"] else None
    if not b:
        missing.append(f'{title} 열린 모습 {o["scene"]} – `{o["sel"]}`')
        b = await cap.box(p, ".main")
    shot = Image.open(io.BytesIO(await p.screenshot())).convert("RGB")
    await ctx.close()
    D = cap.DPR
    m = 6
    x0, y0 = max(0, b["x"] - m), max(0, b["y"] - m)
    x1, y1 = min(1600, b["x"] + b["width"] + m), min(900, b["y"] + b["height"] + m)
    region = shot.crop((int(x0 * D), int(y0 * D), int(x1 * D), int(y1 * D)))
    wide = (x1 - x0) > OPEN_W * 1.4  # 넓은 창은 두 칸을 다 써요(글자가 너무 작아지지 않게)
    room = (IMG_W - 29) if full else (IMG_W if wide else OPEN_W)
    sc = min(OPEN_SCALE, room / (x1 - x0), (560 if full else OPEN_H) / (y1 - y0))
    return {"img": png_uri(region), "w": (x1 - x0) * sc, "h": (y1 - y0) * sc, "wide": wide}


# ---------- HTML ----------
CSS = """
@font-face { font-family: "Pretendard"; src: url("%(font)s") format("woff2"); font-weight: 100 900; }
:root { --ink:#1C1B22; --ink2:#3B3A45; --muted:#6A6876; --line:#D6D4DE; --band:#EDECF1; --soft:#F6F6F8; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html { background: #E9E8EE; }
body { font-family: "Pretendard", sans-serif; color: var(--ink); font-size: 13px; line-height: 1.6; word-break: keep-all; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: %(pw)dpx; min-height: 1123px; margin: 24px auto; background: #fff; position: relative; padding-bottom: 60px; box-shadow: 0 1px 4px rgba(28,27,34,.12); }
@page { size: A4; margin: 0; }
@media print { html { background: #fff; } .page { margin: 0; box-shadow: none; break-after: page; } }
.band { background: var(--band); height: 46px; padding: 0 %(pad)dpx; display: flex; align-items: center; justify-content: space-between; }
.band svg { height: 15px; width: auto; display: block; }
.band span { font-size: 12px; color: var(--ink2); font-weight: 500; }
.body { padding: 22px %(pad)dpx 0; }
.mod { padding: 4px 0 6px; margin-bottom: 20px; border-bottom: 1px solid var(--line); }
.mod h1 { font-size: 32px; font-weight: 800; letter-spacing: -0.6px; line-height: 1.25; }
.mod p { font-size: 16px; font-weight: 500; color: var(--ink2); margin-top: 6px; padding-bottom: 12px; }
.block { margin-bottom: 18px; }
.sec { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; break-after: avoid; }
.sec .no { width: 24px; height: 24px; flex: none; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; background: var(--band); border-radius: 5px; color: var(--ink); }
.sec h2 { font-size: 17px; font-weight: 700; letter-spacing: -0.2px; }
ul.dots { list-style: none; padding-left: %(ind)dpx; }
ul.dots li { position: relative; padding-left: 12px; margin: 2px 0; }
ul.dots li::before { content: ""; position: absolute; left: 0; top: 9px; width: 4px; height: 4px; border-radius: 50%%; background: var(--ink2); }
.shot { position: relative; margin-left: %(ind)dpx; width: %(iw)dpx; break-inside: avoid; }
.shot .frame { position: absolute; left: 0; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; background: #fff; }
.shot .frame img { display: block; width: 100%%; height: 100%%; }
.shot svg { position: absolute; left: 0; top: 0; overflow: visible; }
.ring { width: %(ring)dpx; height: %(ring)dpx; border-radius: 50%%; border: 1.5px solid var(--ink); background: #fff; color: var(--ink); font-size: 11px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; display: flex; align-items: center; justify-content: center; flex: none; }
.shot .ring { position: absolute; }
.feats { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 26px; padding-left: %(ind)dpx; }
.feat { display: flex; gap: 9px; align-items: flex-start; break-inside: avoid; }
.feat .ring { margin-top: 1px; }
.feat p { color: var(--ink2); }
.feat p b { color: var(--ink); margin-right: 4px; }
.opens { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 24px; padding-left: %(ind)dpx; margin-top: 0; }
.opens figure { break-inside: avoid; }
.opens img { display: block; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
.opens figcaption { margin-top: 6px; color: var(--ink2); }
.opens figcaption b { color: var(--ink); margin-right: 4px; }
.tips { margin: 18px 0 0 %(ind)dpx; background: var(--soft); border-left: 3px solid var(--ink); padding: 10px 14px; border-radius: 0 4px 4px 0; break-inside: avoid; }
.tips h3 { font-size: 13px; font-weight: 700; margin-bottom: 3px; }
.tips li { list-style: none; color: var(--ink2); }
kbd { font-family: inherit; font-size: 11px; font-weight: 600; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; background: #fff; color: var(--ink); white-space: nowrap; }
.foot { position: absolute; left: %(pad)dpx; right: %(pad)dpx; bottom: 22px; display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 8px; }
/* 상세 설명 – 번호 절(속 빈 원) > 딸린 절(굵은 글) > 단계(1. 2.)·점 항목, 본문은 모두 같은 왼쪽 선 */
.dpart { padding-left: %(ind)dpx; display: flow-root; }
.dtitle { display: flex; align-items: center; gap: 9px; margin: 14px 0 6px; font-size: 14.5px; font-weight: 700; }
.dtitle.dplain { padding-left: 29px; }
.dsub { margin: 10px 0 4px 29px; font-size: 13.5px; font-weight: 700; }
.dpart > .dp, .dpart > .dstep, .dpart > .ddot, .dpart > .dfig { margin-left: 29px; }
.dp { color: var(--ink2); margin: 3px 0; }
.dstep { display: flex; gap: 6px; align-items: baseline; margin: 4px 0; }
.dstep .dsn { flex: none; min-width: 16px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.dstep p, .ddot p { color: var(--ink2); }
.ddot { position: relative; padding-left: 12px; margin: 3px 0; }
.ddot::before { content: ""; position: absolute; left: 2px; top: 9px; width: 4px; height: 4px; border-radius: 50%%; background: var(--ink2); }
.dfig { margin: 8px 0 8px 29px; }
.dfig img { display: block; border: 1px solid var(--line); border-radius: 4px; background: #fff; }
.dfig figcaption { margin-top: 5px; font-size: 12px; color: var(--muted); }
img.chip { display: inline-block; vertical-align: middle; margin: -3px 4px 0 0; border-radius: 6px; box-shadow: 0 0 0 1px var(--line-soft, #E5E4EC); }
.ddot.dchipline { padding-left: 0; margin: 5px 0; }
.ddot.dchipline::before { display: none; }
.dend { margin-bottom: 6px; }
/* 차례 */
.cover { padding: 120px %(pad)dpx 0; }
.cover .logo svg { height: 40px; width: auto; display: block; }
.cover h1 { font-size: 34px; font-weight: 800; letter-spacing: -0.6px; margin-top: 28px; }
.cover .date { color: var(--muted); margin-top: 6px; }
.toc { margin-top: 56px; border-top: 1px solid var(--line); }
.toc a { display: grid; grid-template-columns: 36px 120px 1fr; align-items: baseline; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.toc .n { color: var(--muted); font-variant-numeric: tabular-nums; }
.toc .t { font-size: 15px; font-weight: 700; }
.toc .d { color: var(--ink2); }
"""


def shot_html(sh, fix):
    h = sh["h"]
    total = BAND * 2 + h
    out = [f'<div class="shot" style="height:{total:.1f}px">',
           f'<div class="frame" style="top:{BAND}px;width:{IMG_W}px;height:{h:.1f}px"><img src="{sh["img"]}" alt=""></div>',
           f'<svg width="{IMG_W}" height="{total:.1f}">']
    rings = []
    for i, m in enumerate(sh["marks"], 1):
        if not m["box"]:
            continue
        cy = RING / 2 if m["side"] == "top" else total - RING / 2
        y_from = cy + RING / 2 if m["side"] == "top" else cy - RING / 2
        out.append(f'<line x1="{m["cx"]:.1f}" y1="{y_from:.1f}" x2="{m["tx"]:.1f}" y2="{m["ty"]:.1f}" stroke="#1C1B22" stroke-width="1"/>')
        out.append(f'<circle cx="{m["tx"]:.1f}" cy="{m["ty"]:.1f}" r="3" fill="#1C1B22" stroke="#fff" stroke-width="1.5"/>')
        rings.append(f'<div class="ring" style="left:{m["cx"] - RING / 2:.1f}px;top:{cy - RING / 2:.1f}px;{fix_style(fix, "r" + str(i))}">{i}</div>')
    out.append("</svg>")
    out += rings
    out.append("</div>")
    return "".join(out)


def ordered_detail(ch):
    """상세 설명 절 차례: 번호 절마다 뒤따르는 번호 없는 절을 묶어 그림 번호 차례로, "설정"으로 시작하는 절은 맨 뒤."""
    names = {m["name"]: i for i, m in enumerate(ch["marks"], 1)}
    groups, tail = [], []
    for sub in ch["detail"]:
        if sub["title"].startswith("설정"):
            tail.append(sub)
        elif sub["title"] in names or not groups:
            groups.append([names.get(sub["title"], 0), [sub]])
        else:
            groups[-1][1].append(sub)
    return [x for _, g in sorted(groups, key=lambda g: g[0]) for x in g] + tail


def chapter_parts(no, ch, sh, opens, fix, figs):
    """첫 쪽(제목·기획 의도·화면·기능별 설명) HTML과, 다음 쪽부터 차례로 채울 덩어리 목록."""
    sec = 0

    def head(title):
        nonlocal sec
        sec += 1
        return f'<div class="sec"><div class="no" style="{fix_style(fix, "s" + str(sec))}">{sec}</div><h2>{title}</h2></div>'

    o = [f'<div class="mod"><h1>{html.escape(ch["title"])}</h1><p>{inline(ch["def"])}</p></div>']
    if ch["intent"]:
        o.append('<div class="block">' + head("기획 의도") + '<ul class="dots">' + "".join(f"<li>{inline(x)}</li>" for x in ch["intent"]) + "</ul></div>")
    o.append('<div class="block">' + head("화면") + shot_html(sh, fix) + "</div>")
    feats = "".join(
        f'<div class="feat"><div class="ring" style="{fix_style(fix, "r" + str(i))}">{i}</div><p><b>{html.escape(m["name"])}</b>{inline(m["text"])}</p></div>'
        for i, m in enumerate(ch["marks"], 1))
    o.append('<div class="block" style="margin-bottom:0">' + head("기능별 설명") + f'<div class="feats">{feats}</div></div>')
    rest = []
    # 4 상세 설명 – 화면 구성요소마다 사용법. 덩어리(문단·단계·그림)마다 따로 재서 쪽을 넘겨요
    names = {m["name"]: i for i, m in enumerate(ch["marks"], 1)}
    ordered = ordered_detail(ch)
    chips = ch.get("chips", {})

    def txt(v):
        return re.sub(r"\{\{(.+?)\}\}", lambda m: chips.get(html.unescape(m.group(1)), ""), inline(v))

    seen_marked = False
    for si, sub in enumerate(ordered):
        top = head("상세 설명") if si == 0 else ""
        no = names.get(sub["title"])
        if no:
            seen_marked = True
            title = (f'<h3 class="dtitle"><div class="ring" style="{fix_style(fix, "r" + str(no))}">{no}</div>'
                     f'<span>{html.escape(sub["title"])}</span></h3>')
        elif seen_marked and not sub["title"].startswith("설정"):
            title = f'<h4 class="dsub">{html.escape(sub["title"])}</h4>'   # 바로 위 번호 절에 딸린 작은 절
        else:
            title = f'<h3 class="dtitle dplain"><span>{html.escape(sub["title"])}</span></h3>'
        step = 0
        for pi, (kind, v) in enumerate(sub["parts"]):
            if kind == "step":
                step += 1
                body = f'<div class="dstep"><span class="dsn">{step}.</span><p>{txt(v)}</p></div>'
            elif kind == "dot":
                cls = "ddot dchipline" if v.startswith("{{") else "ddot"   # 단추 그림으로 시작하는 줄은 점 없이
                body = f'<div class="{cls}"><p>{txt(v)}</p></div>'
            elif kind == "fig":
                img = figs.get((v["scene"], v["sel"]))
                body = (f'<figure class="dfig"><img src="{img["img"]}" style="width:{img["w"]:.0f}px;height:{img["h"]:.0f}px" alt="">'
                        f'<figcaption>{txt(v["cap"])}</figcaption></figure>') if img else ""
            else:
                body = f'<p class="dp">{txt(v)}</p>'
            last = pi == len(sub["parts"]) - 1
            rest.append(f'<div class="dpart{" dend" if last else ""}">{top if pi == 0 else ""}{title if pi == 0 else ""}{body}</div>')
        if not sub["parts"]:
            rest.append(f'<div class="dpart dend">{top}{title}</div>')
    if opens:
        r = ['<div class="block">' + head("메뉴·창 모습") + '<div class="opens">']
        for op, img in zip(ch["opens"], opens):
            span = ' style="grid-column:1/-1"' if img["wide"] else ""
            r.append(f'<figure{span}><img src="{img["img"]}" style="width:{img["w"]:.0f}px;height:{img["h"]:.0f}px" alt="">'
                     f'<figcaption><b>{html.escape(op["title"])}</b>{inline(op["text"])}</figcaption></figure>')
        r.append("</div></div>")
        rest.append("".join(r))
    if ch["tips"]:
        rest.append('<div class="block"><div class="tips" style="margin-left:0"><h3>알아 두면 좋은 것</h3><ul>' + "".join(f"<li>{inline(x)}</li>" for x in ch["tips"]) + "</ul></div></div>")
    return "".join(o), rest


def page_html(no, title, logo, inner):
    return (f'<section class="page"{f" id=ch{no}" if inner.startswith("<div class=\"mod\"") else ""}><div class="band">{logo}<span>사용자 매뉴얼</span></div>'
            f'<div class="body">{inner}</div><div class="foot"><span>기록 사용자 매뉴얼</span><span>{no:02d} · {html.escape(title)}</span></div></section>')


def logo_svg(height):
    s = open(LOGO, encoding="utf-8").read()
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r'\s(width|height)="[^"]*"', "", s, count=2)
    return s.replace("<svg ", f'<svg style="height:{height}px" ', 1)


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    site = args[0]
    out = args[1] if len(args) > 1 else os.path.join(DOCS, "기록-매뉴얼.html")
    chapters = []
    for key, name in ORDER:
        path = os.path.join(DOCS, key + ".md")
        if os.path.exists(path):
            chapters.append(parse(path))
    if not chapters:
        sys.exit("docs/manual/*.md 가 없어요")
    srv, port = cap.serve(site)
    url = f"http://127.0.0.1:{port}/"
    missing = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        fix = await measure_fix(br)
        shots, opens, figs_all = [], [], []
        for ch in chapters:
            shots.append(await shoot_chapter(br, url, ch, missing))
            opens.append([await shoot_open(br, url, o, missing, ch["title"]) for o in ch["opens"]])
            fg = {}
            for sub in ch["detail"]:
                for kind, v in sub["parts"]:
                    if kind == "fig" and (v["scene"], v["sel"]) not in fg:
                        fg[(v["scene"], v["sel"])] = await shoot_open(br, url, {"scene": v["scene"], "sel": v["sel"]}, missing, ch["title"], full=True)
            figs_all.append(fg)
            print(f'찍음 {ch["title"]} · 번호 {len(ch["marks"])} · 열린 모습 {len(ch["opens"])}')
        await br.close()
    srv.shutdown()

    font = "data:font/woff2;base64," + base64.b64encode(open(FONT, "rb").read()).decode()
    css = CSS % {"font": font, "pw": PAGE_W, "pad": PAD, "ind": INDENT, "iw": IMG_W, "ring": RING}
    logo_s, logo_l = logo_svg(15), logo_svg(40)
    today = datetime.date.today().strftime("%Y-%m-%d")
    toc = "".join(f'<a href="#ch{i}"><span class="n">{i:02d}</span><span class="t">{html.escape(c["title"])}</span><span class="d">{inline(c["def"])}</span></a>'
                  for i, c in enumerate(chapters, 1))
    pages = [f'<section class="page"><div class="cover"><div class="logo">{logo_l}</div><h1>사용자 매뉴얼</h1>'
             f'<p class="date">{today} 화면 기준</p><nav class="toc">{toc}</nav></div>'
             '<div class="foot"><span>기록 사용자 매뉴얼</span><span>차례</span></div></section>']
    parts = [chapter_parts(i, ch, sh, op, fix, fg) for i, (ch, sh, op, fg) in enumerate(zip(chapters, shots, opens, figs_all), 1)]
    # 다음 쪽 덩어리 높이를 재서 A4 쪽마다 차례로 채워요
    flat = [(ci, bi, b) for ci, (_, rest) in enumerate(parts) for bi, b in enumerate(rest)]
    probe_doc = (f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{css}</style></head><body>'
                 + "".join(f'<section class="page"><div class="body" id="m{n}">{b}</div></section>' for n, (_, _, b) in enumerate(flat)) + "</body></html>")
    tmp = out + ".measure.html"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(probe_doc)
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        p = await br.new_page(viewport={"width": 900, "height": 1200})
        await p.goto("file://" + os.path.abspath(tmp))
        await p.evaluate("() => document.fonts.ready")
        heights = await p.evaluate("(n) => [...Array(n).keys()].map(i => { const e = document.getElementById('m' + i).firstElementChild; const s = getComputedStyle(e); return e.getBoundingClientRect().height + parseFloat(s.marginTop) + parseFloat(s.marginBottom); })", len(flat))
        await br.close()
    os.remove(tmp)
    ROOM = 1123 - 60 - 46 - 22   # 쪽 높이 − 아래 여백 − 머리 띠 − 위 여백
    for ci, (ch, (first, rest)) in enumerate(zip(chapters, parts)):
        no = ci + 1
        pages.append(page_html(no, ch["title"], logo_s, first))
        cur, used = [], 0
        for (cj, bi, b), hgt in zip(flat, heights):
            if cj != ci:
                continue
            if cur and used + hgt > ROOM:
                pages.append(page_html(no, ch["title"], logo_s, "".join(cur)))
                cur, used = [], 0
            cur.append(b)
            used += hgt
        if cur:
            pages.append(page_html(no, ch["title"], logo_s, "".join(cur)))
    doc = f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>기록 사용자 매뉴얼</title><style>{css}</style></head><body>{"".join(pages)}</body></html>'
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"만듦 {out} ({os.path.getsize(out) // 1024}KB, {len(chapters)}장)")
    # 쪽마다 A4 한 장(1123) 안에 드는지 재요
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        p = await br.new_page(viewport={"width": 900, "height": 1200})
        await p.goto("file://" + os.path.abspath(out))
        await p.evaluate("() => document.fonts.ready")
        over = await p.evaluate("""() => [...document.querySelectorAll('.page')].map((e, i) => {
            const body = e.querySelector('.body, .cover'); const foot = e.querySelector('.foot');
            const bottom = body.getBoundingClientRect().bottom - e.getBoundingClientRect().top;
            return [i, Math.round(bottom), foot ? foot.lastElementChild.textContent : ''];
          }).filter(([i, b]) => b > 1123 - 60)""")
        await br.close()
    if "--word" in sys.argv:
        await export_word(out, chapters, opens, figs_all)
    for i, b, t in over:
        missing.append(f"{t} – {i + 1}쪽 글이 A4 한 장을 넘어요(아래 끝 {b}px, 1063 안이어야 해요 – 설명을 줄여요)")
    if missing:
        print("잴 수 없는 요소 – 선택자를 고치거나 그 화면 세션에 이름표(data-help)를 부탁해요:")
        for m in missing:
            print("  - " + m)
        sys.exit(1)


# ---------- 워드(.docx) ----------
def _save_uri(uri, path):
    with open(path, "wb") as f:
        f.write(base64.b64decode(uri.split(",", 1)[1]))


async def export_word(out, chapters, opens_all, figs_all):
    """HTML과 같은 글·그림으로 워드 파일을 만들어요(tools/manual/word.cjs). 화면 그림은 번호·지시선까지 그린 그대로 찍어 넣어요."""
    import json
    import subprocess
    base = os.path.splitext(out)[0]
    imgdir = base + "_word"
    os.makedirs(imgdir, exist_ok=True)
    model = {"chapters": [], "date": datetime.date.today().strftime("%Y-%m-%d")}
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        p = await br.new_page(viewport={"width": 900, "height": 1200}, device_scale_factor=2)
        await p.goto("file://" + os.path.abspath(out))
        await p.evaluate("() => document.fonts.ready")
        for i, ch in enumerate(chapters, 1):
            el = p.locator(f"#ch{i} .shot").first
            bb = await el.bounding_box()
            shot = os.path.join(imgdir, f"ch{i:02d}_shot.png")
            await el.screenshot(path=shot)
            logo = os.path.join(imgdir, "logo.png")
            if i == 1:
                await p.locator(".band svg").first.screenshot(path=logo)
            c = {"no": i, "title": ch["title"], "def": ch["def"], "intent": ch["intent"],
                 "shot": {"img": shot, "w": bb["width"], "h": bb["height"]},
                 "feats": [{"no": k, "name": m["name"], "text": m["text"]} for k, m in enumerate(ch["marks"], 1)],
                 "detail": [], "opens": [], "tips": ch["tips"], "chips": {}}
            for n, (sel, html_img) in enumerate(ch.get("chips", {}).items()):
                m = re.search(r'src="([^"]+)" style="height:(\d+)px;width:(\d+)px', html_img)
                f = os.path.join(imgdir, f"ch{i:02d}_chip{n}.png")
                _save_uri(m.group(1), f)
                c["chips"][sel] = {"img": f, "h": int(m.group(2)), "w": int(m.group(3))}
            names = {m["name"]: k for k, m in enumerate(ch["marks"], 1)}
            seen = False
            for sub in ordered_detail(ch):
                no = names.get(sub["title"])
                if no:
                    seen = True
                    kind = "title"
                elif seen and not sub["title"].startswith("설정"):
                    kind = "sub"
                else:
                    kind = "plain"
                c["detail"].append({"kind": kind, "no": no, "text": sub["title"]})
                step = 0
                for k, v in sub["parts"]:
                    if k == "step":
                        step += 1
                        c["detail"].append({"kind": "step", "n": step, "text": v})
                    elif k == "fig":
                        img = figs_all[i - 1].get((v["scene"], v["sel"]))
                        if img:
                            f = os.path.join(imgdir, f"ch{i:02d}_fig{len(c['detail'])}.png")
                            _save_uri(img["img"], f)
                            c["detail"].append({"kind": "fig", "img": f, "w": img["w"], "h": img["h"], "text": v["cap"]})
                    else:
                        c["detail"].append({"kind": k, "text": v})
            for op, img in zip(ch["opens"], opens_all[i - 1]):
                f = os.path.join(imgdir, f"ch{i:02d}_open{len(c['opens'])}.png")
                _save_uri(img["img"], f)
                c["opens"].append({"img": f, "w": img["w"], "h": img["h"], "title": op["title"], "text": op["text"]})
            model["chapters"].append(c)
        await br.close()
    mpath = base + ".model.json"
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False)
    docx = base + ".docx"
    subprocess.run(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "word.cjs"), mpath, docx], check=True)
    print(f"만듦 {docx} ({os.path.getsize(docx) // 1024}KB)")


if __name__ == "__main__":
    asyncio.run(main())
