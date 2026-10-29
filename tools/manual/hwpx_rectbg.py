"""넓게 칠한 회색(#EFEFF2)을 그림 대신 한글 도형(사각형 채우기)으로 – 2026-10-29 23:08 사용자 ② 1안.

  python3 tools/manual/hwpx_rectbg.py <매뉴얼.hwpx> <결과.hwpx>

한글 PDF 변환이 그림의 밝은 회색을 밝고 푸르게 바꿔요((239,239,242) → (246,245,251)) – 띠·표지·목차의 넓은 회색이 보랏빛으로 보였어요.
도형 색은 바뀌지 않아서:
- 바탕쪽 띠·표지 왼쪽 띠·목차 머리의 회색 칸을 사각형(선 없음, #EFEFF2)으로 깔고,
- 그 그림들은 회색 자리를 투명하게 만든 PNG로 바꿔 위에 얹어요(아이콘·글자만 그림으로 남아요).
"""
import io
import random
import re
import sys
import zipfile

from PIL import Image

BG = (239, 239, 242)
HEX = "#EFEFF2"
src, out = sys.argv[1:3]
z = zipfile.ZipFile(src)
hpf = z.read("Contents/content.hpf").decode()
files, done = {}, []


def href(bid):
    return re.search(rf'<opf:item id="{bid}" href="([^"]+)"', hpf).group(1)


def transparent(data):
    im = Image.open(io.BytesIO(data)).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            if abs(r - BG[0]) <= 2 and abs(g - BG[1]) <= 2 and abs(b - BG[2]) <= 2:
                px[x, y] = (r, g, b, 0)
    o = io.BytesIO()
    im.save(o, "PNG", optimize=True)
    return o.getvalue(), im


def rect(x, y, w, h):
    i = random.randint(1_000_000_000, 2_000_000_000)
    return (f'<hp:rect ratio="0" id="{i}" zOrder="0" numberingType="PICTURE" textWrap="BEHIND_TEXT" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" '
            f'href="" groupLevel="0" instid="{i}"><hp:offset x="0" y="0"/><hp:orgSz width="{w}" height="{h}"/><hp:curSz width="0" height="0"/>'
            f'<hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="{w // 2}" centerY="{h // 2}" rotateimage="1"/>'
            '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            '<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>'
            f'<hp:lineShape color="{HEX}" width="0" style="NONE" endCap="FLAT" headStyle="NORMAL" tailStyle="NORMAL" headfill="1" tailfill="1" '
            'headSz="SMALL_SMALL" tailSz="SMALL_SMALL" outlineStyle="NORMAL" alpha="0"/>'
            f'<hc:fillBrush><hc:winBrush faceColor="{HEX}" hatchColor="#FFFFFF" alpha="0"/></hc:fillBrush>'
            '<hp:shadow type="NONE" color="#B2B2B2" offsetX="0" offsetY="0" alpha="0"/>'
            f'<hc:pt0 x="0" y="0"/><hc:pt1 x="{w}" y="0"/><hc:pt2 x="{w}" y="{h}"/><hc:pt3 x="0" y="{h}"/>'
            f'<hp:sz width="{w}" height="{h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/>'
            '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" vertAlign="TOP" '
            f'horzRelTo="PAPER" horzAlign="LEFT" vertOffset="{y}" horzOffset="{x}"/><hp:outMargin left="0" right="0" top="0" bottom="0"/></hp:rect>')


def regions(im, W, H):
    """투명해진(회색) 자리를 덮는 큰 사각형들(그림 크기 W×H HWPUNIT로)."""
    a = im.getchannel("A")
    w, h = im.size
    cols = [x for x in range(w) if sum(1 for y in range(0, h, 7) if a.getpixel((x, y)) == 0) > 0.8 * (h / 7)]
    rows = [y for y in range(h) if sum(1 for x in range(0, w, 7) if a.getpixel((x, y)) == 0) > 0.8 * (w / 7)]
    out = []
    if cols and len(cols) > w * 0.05:   # 세로 띠(왼쪽부터)
        x1 = max(c for c in cols if c < w // 2) + 1
        out.append((0, 0, round(x1 * W / w), H))
    if rows and len(rows) > h * 0.05:   # 가로 머리(위부터)
        y1 = max(r for r in rows if r < h // 2) + 1
        out.append((0, 0, W, round(y1 * H / h)))
    return out


def fix(name, s):
    def one(m):
        p = m.group(0)
        bid = re.search(r'binaryItemIDRef="([^"]+)"', p).group(1)
        w, h = map(int, re.search(r'<hp:sz width="(\d+)" widthRelTo="\w+" height="(\d+)"', p).groups())
        if h != 84186:   # 쪽 높이 그림(띠·표지·목차)만
            return p
        hr = href(bid)
        data, im = transparent(z.read(hr))
        files[hr] = data
        x0 = int(re.search(r'horzOffset="(-?\d+)"', p).group(1))
        y0 = int(re.search(r'vertOffset="(-?\d+)"', p).group(1))
        rs = [(0, 0, w, h)] if w < 20000 else regions(im, w, h)
        done.append(f"{name}: {hr} 회색 → 투명, 사각형 {len(rs)}")
        return "".join(rect(x0 + x, y0 + y, rw, rh) for x, y, rw, rh in rs) + p
    return re.sub(r"<hp:pic .*?</hp:pic>", one, s, flags=re.S)


new = {}
for n in z.namelist():
    if re.match(r"Contents/(masterpage\d+|section0)\.xml$", n):
        new[n] = fix(n, z.read(n).decode())
with zipfile.ZipFile(out, "w") as zo:
    for it in z.infolist():
        d = new.get(it.filename, None)
        d = d.encode() if d is not None else files.get(it.filename, z.read(it.filename))
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
        zi.compress_type, zi.external_attr = it.compress_type, it.external_attr
        zo.writestr(zi, d)
print("\n".join(done))
print(f"만듦 {out}")
