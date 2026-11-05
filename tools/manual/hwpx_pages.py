"""한글 쪽 나눔 어림 – 줄 배치 기억(linesegarray)이 없는 문단도 쪽을 셈해요(목차 쪽 번호용).

  python3 tools/manual/hwpx_pages.py <배운 파일(한글로 저장한 것).hwpx> <셀 파일.hwpx> [장 번호 …]

배우기: 한글이 저장한 파일의 줄 배치에서 문단 모양(paraPr)마다 줄 간격·문단 사이·한 줄 폭을 재요.
셈하기: 글 폭(Noto로 재고 배운 비율로 고침)으로 줄 수를 어림하고, 그림 틀은 표 높이, 쪽 나누기·쪽 끝을 따라 쪽을 넘겨요.
글 문단은 줄 단위로 쪽을 넘고(한글처럼), 그림 틀은 통째로 넘어요.
"""
import re
import statistics as st
import sys
import zipfile
import os

sys.path.insert(0, os.path.dirname(__file__))
from hwpx_toplevel import top_paras  # noqa: E402
from PIL import ImageFont  # noqa: E402

BODY = 71433
F = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 1000, index=1)


def segs(p):
    q = re.sub(r"<hp:tbl\b.*?</hp:tbl>", "", p, flags=re.S)
    L = re.findall(r"<hp:linesegarray>(.*?)</hp:linesegarray>", q, re.S)
    if not L:
        return []
    return [tuple(int(x) for x in m) for m in re.findall(
        r'textpos="(\d+)" vertpos="(-?\d+)" vertsize="(\d+)" textheight="\d+" baseline="\d+" spacing="(\d+)" horzpos="(\d+)" horzsize="(\d+)"', L[-1])]


def text(p):
    q = re.sub(r"<hp:tbl\b.*?</hp:tbl>", "", p, flags=re.S)
    q = re.sub(r"<hp:pic .*?</hp:pic>", "", q, flags=re.S).replace("<hp:lineBreak/>", "\n")
    t = "".join(re.findall(r"<hp:t>(.*?)</hp:t>", q, re.S))
    return re.sub(r"<[^>]+>", "", t).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def pp(p):
    return re.match(r'<hp:p [^>]*paraPrIDRef="(\d+)"', p).group(1)


def cp(p):
    m = re.search(r'<hp:run charPrIDRef="(\d+)"><hp:t>', p) or re.search(r'<hp:run charPrIDRef="(\d+)"', p)
    return m.group(1)


def tbl_h(p):
    m = re.search(r"<hp:tbl\b.*?<hp:sz width=\"\d+\" widthRelTo=\"\w+\" height=\"(\d+)\"", p, re.S)
    o = re.search(r'<hp:tbl\b.*?<hp:outMargin left="\d+" right="\d+" top="(\d+)" bottom="(\d+)"', p, re.S)
    return int(m.group(1)) + (int(o.group(1)) + int(o.group(2)) if o else 0) if m else None


def learn(path):
    z = zipfile.ZipFile(path)
    adv, gap, width, k_scale, size = {}, {}, {}, [], {}
    for k in range(1, 13):
        try:
            s = z.read(f"Contents/section{k}.xml").decode()
        except KeyError:
            continue
        P = [s[a:b] for a, b in top_paras(s)]
        for i, p in enumerate(P):
            L = segs(p)
            if not L:
                continue
            key = (pp(p), cp(p))
            size.setdefault(key, []).append(L[0][2])
            for a, b in zip(L, L[1:]):
                if b[1] > a[1]:
                    adv.setdefault(key, []).append(b[1] - a[1])
            width.setdefault(key, []).append(L[-1][5] if len(L) == 1 else L[1][5])
            t = text(p)
            for j in range(len(L) - 1):           # 꽉 찬 줄로 글 폭 비율을 배워요
                seg = t[L[j][0]:L[j + 1][0]].replace("\n", "")
                if len(seg) > 15 and "\n" not in t[L[j][0]:L[j + 1][0]]:
                    k_scale.append(L[j][5] / F.getlength(seg) / (L[j][2] / 1000))
            if i + 1 < len(P):
                N = segs(P[i + 1])
                if N and N[0][1] > L[-1][1] and "<hp:tbl" not in p:
                    gap.setdefault(key, []).append(N[0][1] - L[-1][1])
    med = lambda d: {k: st.median(v) for k, v in d.items() if v}  # noqa: E731
    return dict(adv=med(adv), gap=med(gap), width=med(width), size=med(size), scale=st.median(k_scale))


def lines_of(t, w, sz, scale):
    n = 0
    for part in t.split("\n"):
        px = F.getlength(part) * (sz / 1000) * scale
        n += max(1, -(-int(px) // int(w)))
    return n


def paginate(s, M):
    P = [s[a:b] for a, b in top_paras(s)]
    pages, y, starts = 1, 0, []
    dflt_adv = st.median(M["adv"].values())
    for i, p in enumerate(P):
        key = (pp(p), cp(p))
        if i and 'pageBreak="1"' in p[:300]:
            pages, y = pages + 1, 0
        starts.append(pages)
        th = tbl_h(p) if "<hp:tbl" in p else None
        sz = M["size"].get(key, 1300)
        a = M["adv"].get(key) or M["gap"].get(key) or dflt_adv
        g = M["gap"].get(key, a)
        if th is not None:
            h = th + (g - sz if g > sz else 0)
            if y and y + th > BODY:
                pages, y = pages + 1, 0
                starts[-1] = pages
            y += h
            continue
        n = lines_of(text(p), M["width"].get(key, 48188), sz, M["scale"])
        for j in range(n):
            if y + sz > BODY:
                pages, y = pages + 1, 0
                if j == 0:
                    starts[-1] = pages
            y += a if j < n - 1 else g
    return pages, starts, y


if __name__ == "__main__":
    M = learn(sys.argv[1])
    z = zipfile.ZipFile(sys.argv[2])
    ks = [int(x) for x in sys.argv[3:]] or range(1, 13)
    tot = 0
    for k in ks:
        try:
            s = z.read(f"Contents/section{k}.xml").decode()
        except KeyError:
            continue
        n, _, y = paginate(s, M)
        print(k, "쪽", n, "마지막 쪽 남은 자리", BODY - y, "시작 쪽", tot + 1)
        tot += n
