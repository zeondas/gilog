# 강조색별 앱 아이콘 만들기 — 2026-10-19 색 테마 세션(사용자 결정).
#   python3 tools/brand/accent_icons.py   → src-tauri/icons/accent/
#
# 두 벌을 만들어요.
# - small(창 제목줄·트레이, 16·20·24·32px): 손으로 맞춘 brand/icons/icon-N.png(보라)의 색만 바꿔요.
#   픽셀마다 바탕(보라)·ㄱ(흰색)·L(연보라)이 섞인 비율을 풀어, 원래 색에 "바탕·L이 바뀐 만큼"만 더해요(보라면 그대로).
# - big(작업표시줄·바로가기, 24px부터): 사이드바 접힌 심볼(src/Logo.tsx AppIcon)과 같은 비율 — 글자 0.667배 —
#   으로 그리고, 크기마다 획 굵기·끝을 픽셀에 맞춰 흐리지 않게 해요.
# - <색>.ico(바로가기): 16·20은 small, 24부터는 big.
import os
import struct

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "brand", "icons")
OUT = os.path.join(ROOT, "src-tauri", "icons", "accent")
SMALL = [16, 20, 24, 32]
BIG = [24, 30, 32, 36, 40, 48, 64, 96, 128, 256]
ICO = [16, 20, 24, 30, 32, 36, 40, 48, 64, 96, 128, 256]
# 바탕 = 밝게 강조색, L = 어둡게 강조색(tokens.css --icon-bg·--icon-l과 같아요)
ACCENTS = {
    "purple": ("#4B37C4", "#B6AAFF"),
    "noctua": ("#531705", "#E7CEB5"),
    "blue": ("#2457C5", "#9DBBFF"),
    "ink": ("#3F3E4A", "#C9C7D4"),
}


def rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) for i in (0, 2, 4)], dtype=float)


# ---------- small: 손 맞춤 아이콘 색 바꾸기 ----------


def premultiplied(a):
    edge = (a[..., 3] > 20) & (a[..., 3] < 200)
    if not edge.any():
        return False
    P = rgb(ACCENTS["purple"][0])
    straight = np.abs(a[edge][:, :3] - P).mean()
    pre = np.abs(a[edge][:, :3] - P * (a[edge][:, 3:] / 255)).mean()
    return pre < straight


def recolor(img, bg, l):
    a = np.asarray(img.convert("RGBA"), dtype=float)
    # 16~32px 손 맞춤 파일은 가장자리 색에 투명도를 곱해 뒀어요 — 나눠서 풀고 끝에 다시 곱해요.
    alpha = a[..., 3:]
    k = np.where(alpha > 0, alpha / 255, 1) if premultiplied(a) else np.ones_like(alpha)
    c = a[..., :3] / k
    P, W, L = rgb(ACCENTS["purple"][0]), rgb("#FFFFFF"), rgb(ACCENTS["purple"][1])
    M = np.stack([W - P, L - P], axis=1)
    st = np.clip((c - P) @ np.linalg.pinv(M).T, 0, 1)
    s, t = st[..., :1], st[..., 1:]
    tot = np.where((s + t) > 1, s + t, 1)
    s, t = s / tot, t / tot
    out = (c + (1 - s - t) * (bg - P) + t * (l - L)) * k
    return Image.fromarray(np.concatenate([np.clip(out, 0, 255), alpha], axis=-1).round().astype(np.uint8), "RGBA")


# ---------- big: 사이드바 비율 + 픽셀 맞춤 ----------

# 앱 아이콘 바탕(brand/app-icon.svg와 같은 스퀴클, 100×100 좌표)
SQUIRCLE = [
    ((50, 0), (97.7, 0), (100, 2.3), (100, 50)),
    ((100, 50), (100, 97.7), (97.7, 100), (50, 100)),
    ((50, 100), (2.3, 100), (0, 97.7), (0, 50)),
    ((0, 50), (0, 2.3), (2.3, 0), (50, 0)),
]


def squircle(size, color):
    """16배로 크게 그린 뒤 줄여 가장자리를 부드럽게 해요."""
    ss = 16
    n = size * ss
    pts = []
    for p0, p1, p2, p3 in SQUIRCLE:
        for i in range(64):
            u = i / 64
            x = (1 - u) ** 3 * p0[0] + 3 * (1 - u) ** 2 * u * p1[0] + 3 * (1 - u) * u**2 * p2[0] + u**3 * p3[0]
            y = (1 - u) ** 3 * p0[1] + 3 * (1 - u) ** 2 * u * p1[1] + 3 * (1 - u) * u**2 * p2[1] + u**3 * p3[1]
            pts.append((x * n / 100, y * n / 100))
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    mask = mask.resize((size, size), Image.BOX)
    im = Image.new("RGBA", (size, size), tuple(int(v) for v in color) + (0,))
    im.putalpha(mask)
    return im


def big(size, bg, l):
    im = squircle(size, bg)
    k = size / 100.0
    # Logo.tsx: translate(50 50) scale(0.667) translate(-50 -50) — ㄱ M17 17H83V58H69V31H17Z, L M17 42H31V69H83V83H17Z
    t = max(1, round(14 * 0.667 * k))  # 획 굵기
    lo = round((50 - 33 * 0.667) * k)  # 글자 왼쪽·위 끝
    hi = size - lo  # 오른쪽·아래 끝(대칭)
    mid_hi = round((50 + 8 * 0.667) * k)  # ㄱ 세로획 아래 끝
    mid_lo = size - mid_hi  # L 세로획 위 끝(대칭)
    d = ImageDraw.Draw(im)
    W = (255, 255, 255, 255)
    L = tuple(int(v) for v in l) + (255,)
    d.rectangle([lo, lo, hi - 1, lo + t - 1], fill=W)
    d.rectangle([hi - t, lo, hi - 1, mid_hi - 1], fill=W)
    d.rectangle([lo, mid_lo, lo + t - 1, hi - 1], fill=L)
    d.rectangle([lo, hi - t, hi - 1, hi - 1], fill=L)
    return im


def ico(name):
    """크기별 PNG를 그대로 담은 .ico(윈도우 비스타부터 PNG 칸을 읽어요)."""
    files = [os.path.join(OUT, f"{name}-small-{s}.png") if s in (16, 20) else os.path.join(OUT, f"{name}-big-{s}.png") for s in ICO]
    datas = [open(f, "rb").read() for f in files]
    head = struct.pack("<HHH", 0, 1, len(ICO))
    off = 6 + 16 * len(ICO)
    ents = b""
    for s, d in zip(ICO, datas):
        ents += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(d), off)
        off += len(d)
    open(os.path.join(OUT, f"{name}.ico"), "wb").write(head + ents + b"".join(datas))


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith((".png", ".ico")):
            os.remove(os.path.join(OUT, f))
    for name, (bg, l) in ACCENTS.items():
        for s in SMALL:
            src = Image.open(os.path.join(SRC, f"icon-{s}.png"))
            assert src.size == (s, s), (s, src.size)
            recolor(src, rgb(bg), rgb(l)).save(os.path.join(OUT, f"{name}-small-{s}.png"), optimize=True)
        for s in BIG:
            big(s, rgb(bg), rgb(l)).save(os.path.join(OUT, f"{name}-big-{s}.png"), optimize=True)
        ico(name)
    print("ok", OUT)


if __name__ == "__main__":
    main()
