# 강조색별 앱 아이콘(작업표시줄·트레이·창 제목) 만들기 — 2026-10-19 색 테마 세션.
# 손으로 맞춘 brand/icons/icon-N.png(보라)의 색만 바꿔요: 픽셀마다 바탕(보라)·ㄱ(흰색)·L(연보라) 세 색의
# 섞인 비율을 풀어 같은 비율로 새 바탕·L 색을 섞어요(가장자리 흐림·손 맞춤 그대로).
#   python3 tools/brand/accent_icons.py   → src-tauri/icons/accent/<색>-<크기>.png + <색>.ico(바로가기용, 모든 크기)
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "brand", "icons")
OUT = os.path.join(ROOT, "src-tauri", "icons", "accent")
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
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
    # 16~32px 손 맞춤 파일은 가장자리 색에 투명도를 곱해 뒀어요(40px부터는 아님) — 파일마다 알아보고,
    # 곱해 둔 파일이면 나눠서 풀고 끝에 다시 곱해 같은 모양으로 둬요.
    alpha = a[..., 3:]
    k = np.where(alpha > 0, alpha / 255, 1) if premultiplied(a) else np.ones_like(alpha)
    c = a[..., :3] / k
    P, W, L = rgb(ACCENTS["purple"][0]), rgb("#FFFFFF"), rgb(ACCENTS["purple"][1])
    # c = P + s*(W-P) + t*(L-P) 를 최소제곱으로 풀어요
    M = np.stack([W - P, L - P], axis=1)  # 3x2
    pinv = np.linalg.pinv(M)  # 2x3
    st = (c - P) @ pinv.T  # ...x2
    st = np.clip(st, 0, 1)
    s, t = st[..., :1], st[..., 1:]
    over = (s + t) > 1
    tot = np.where(over, s + t, 1)
    s, t = s / tot, t / tot
    # 원래 색에 "바탕·L이 바뀐 만큼"만 더해요 — 보라면 그대로, 세 색 밖의 가장자리 색도 흐트러지지 않아요.
    out = (c + (1 - s - t) * (bg - P) + t * (l - L)) * k
    return Image.fromarray(np.concatenate([np.clip(out, 0, 255), alpha], axis=-1).round().astype(np.uint8), "RGBA")


def ico(name):
    """크기별 PNG를 그대로 담은 .ico(윈도우 비스타부터 PNG 칸을 읽어요)."""
    import struct
    datas = [open(os.path.join(OUT, f"{name}-{s}.png"), "rb").read() for s in SIZES]
    head = struct.pack("<HHH", 0, 1, len(SIZES))
    off = 6 + 16 * len(SIZES)
    ents = b""
    for s, d in zip(SIZES, datas):
        ents += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(d), off)
        off += len(d)
    open(os.path.join(OUT, f"{name}.ico"), "wb").write(head + ents + b"".join(datas))


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in SIZES:
        src = Image.open(os.path.join(SRC, f"icon-{size}.png"))
        assert src.size == (size, size), (size, src.size)
        for name, (bg, l) in ACCENTS.items():
            recolor(src, rgb(bg), rgb(l)).save(os.path.join(OUT, f"{name}-{size}.png"), optimize=True)
    for name in ACCENTS:
        ico(name)
    print("ok", OUT)


if __name__ == "__main__":
    main()
