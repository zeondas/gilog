"""사용자 수정본(hwpx)에 표지·목차·본문 꾸밈(왼쪽 띠·절 막대·장 밑줄)을 입혀요.
글·간격·쪽 나눔은 건드리지 않고, 그림을 글 뒤(떠 있는 그림)로만 더해요.
쓰기: python3 hwpx_design.py 원본.hwpx 결과.hwpx 그림폴더
그림폴더: cover.png toc.png band_<장>.png bar.png rule.png"""
import os, re, random, sys, zipfile
sys.path.insert(0, os.path.dirname(__file__))
from hwpx_toplevel import top_paras, first_vert
from PIL import Image

PW, PH = 59528, 84186
MM = 283.46
LEFT = round(float(os.environ.get("ML", "20")) * MM)    # 왼쪽 여백
RIGHT = round(float(os.environ.get("MR", "20")) * MM)   # 오른쪽 여백
BAND_W = round(float(os.environ.get("BAND_MM", "17")) * 283.46)   # 색인 띠 폭(종이 끝부터, 바깥 약 5mm는 인쇄에서 잘려도 되게)
CH_KEYS = ["overview", "explorer", "complaints", "process", "budget", "bstatus",
           "calendar", "todo", "journal", "contacts", "settings"]

def fpic(bin_id, png, w, h, x, y, vrel="PAPER", hrel="PAPER", z=1):
    pw, ph = Image.open(png).size
    i = random.randint(1_000_000_000, 2_000_000_000)
    return (f'<hp:pic textWrap="BEHIND_TEXT" textFlow="BOTH_SIDES" reverse="0" id="{i}" zOrder="{z}" numberingType="PICTURE" lock="0" '
            f'dropcapstyle="None" href="" groupLevel="0" instid="{i}"><hp:offset x="0" y="0"/><hp:orgSz width="{w}" height="{h}"/>'
            f'<hp:curSz width="{w}" height="{h}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="{w//2}" '
            f'centerY="{h//2}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            '<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
            f'</hp:renderingInfo><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="{w}" y="0"/><hc:pt2 x="{w}" y="{h}"/><hc:pt3 x="0" y="{h}"/>'
            f'</hp:imgRect><hp:imgClip left="0" right="{pw*75}" top="0" bottom="{ph*75}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>'
            f'<hp:imgDim dimwidth="{pw*75}" dimheight="{ph*75}"/><hc:img binaryItemIDRef="{bin_id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>'
            f'<hp:effects/><hp:sz width="{w}" height="{h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/>'
            f'<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="{0 if vrel=="PAPER" else 1}" allowOverlap="1" holdAnchorAndSO="0" '
            f'vertRelTo="{vrel}" horzRelTo="{hrel}" vertAlign="TOP" horzAlign="LEFT" vertOffset="{y}" horzOffset="{x}"/>'
            '<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment/></hp:pic>')

def put_in_first_run(p, pic):
    m = re.search(r'<hp:run charPrIDRef="(\d+)"\s*/>', p)
    m2 = re.search(r'<hp:run charPrIDRef="\d+">', p)
    if m2 and (not m or m2.start() < m.start()):
        return p[:m2.end()] + pic + p[m2.end():]
    return p[:m.start()] + f'<hp:run charPrIDRef="{m.group(1)}">{pic}</hp:run>' + p[m.end():]

# 예시만 만들 때: SAMPLE="30-66,66-99"(맨 위 문단 번호 범위)
KEEP = [tuple(map(int, r.split("-"))) for r in os.environ.get("SAMPLE", "").split(",") if r]

def main():
    src, out, img = sys.argv[1:4]
    zin = zipfile.ZipFile(src)
    sec = zin.read("Contents/section0.xml").decode("utf-8")
    hpf = zin.read("Contents/content.hpf").decode("utf-8")
    n0 = max(int(x) for x in re.findall(r'id="image(\d+)"', hpf))
    items = []
    def b(name):
        bid = f"image{n0 + 1 + len(items)}"
        items.append((bid, os.path.join(img, name)))
        return bid
    P = top_paras(sec)
    paras = [sec[a:c] for a, c in P]
    head, tail = sec[:P[0][0]], sec[P[-1][1]:]
    titles = [i for i, p in enumerate(paras) if re.search(r'<hp:run charPrIDRef="7">', p) and 'pageBreak="1"' in p[:200]
              and re.search(r'<hp:t>([^<]+)', p)]
    toc_i = next(i for i, p in enumerate(paras) if "<hp:pageHiding" in p)
    assert len(titles) == len(CH_KEYS) and titles[0] > toc_i, (titles, toc_i)
    starts = {i for i, p in enumerate(paras) if (first_vert(p) or [1])[0] == 0 and i >= titles[0]}
    subrule = {t + 2 for t in titles}
    bands = {k: b(f"band_{k}.png") for k in CH_KEYS}
    bar, rule = b("bar.png"), b("rule.png")
    paras[0] = re.sub(r'(<hp:margin [^>]*?)left="\d+" right="\d+"', lambda m: f'{m.group(1)}left="{LEFT}" right="{RIGHT}"', paras[0], count=1)
    newp = []
    # 표지: 첫 문단(구역 설정)에 쪽 전체 그림
    newp.append(put_in_first_run(paras[0], fpic(b("cover.png"), os.path.join(img, "cover.png"), PW, PH, 0, 0)))
    # 목차: 새 쪽, 쪽 번호 감추기 + 쪽 전체 그림
    hid = re.search(r'<hp:ctrl><hp:pageHiding[^>]*/></hp:ctrl>', paras[toc_i]).group(0)
    newp.append('<hp:p id="0" paraPrIDRef="27" styleIDRef="0" pageBreak="1" columnBreak="0" merged="0"><hp:run charPrIDRef="9">'
                + hid + fpic(b("toc.png"), os.path.join(img, "toc.png"), PW, PH, 0, 0) + '<hp:t/></hp:run></hp:p>')
    nbar = nrule = 0
    for i in range(titles[0], len(paras)):
        p = paras[i]
        ch = CH_KEYS[max(k for k, t in enumerate(titles) if t <= i)]
        heading = re.search(r'<hp:run charPrIDRef="10"><hp:t>\d+\. ', p)
        if i in starts:
            p = put_in_first_run(p, fpic(bands[ch], os.path.join(img, f"band_{ch}.png"), BAND_W, PH, 0, 0))
        if heading:
            # 15pt 줄: 기준선 1275, 숫자 높이 약 0.72em → 0.84em 막대를 숫자 가운데(+0.05em)에
            p = put_in_first_run(p, fpic(bar, os.path.join(img, "bar.png"), 290, 1260, LEFT - 290 - 580, 180, "PARA", "PAPER", 2))
            nbar += 1
        if i in subrule:
            assert not re.search(r'<hp:t>[^<]', p), i
            p = put_in_first_run(p, fpic(rule, os.path.join(img, "rule.png"), PW - LEFT - RIGHT, 57, LEFT, 700, "PARA", "PAPER", 2))
            nrule += 1
        if KEEP and not any(a <= i < c for a, c in KEEP):
            continue
        newp.append(p)
    sec2 = head + "".join(newp) + tail
    header = zin.read("Contents/header.xml").decode("utf-8")
    if os.environ.get("FRAME_LINE", "none") == "none":
        # 그림 틀(그림이 든 표) 테두리를 보이지 않는 선(선 없음)으로 – 테두리 자체는 남아요
        refs = {r for t in re.findall(r"<hp:tbl\b.*?</hp:tbl>", sec2, re.S) if "<hp:pic" in t
                for r in re.findall(r'borderFillIDRef="(\d+)"', t)}
        nid = max(int(x) for x in re.findall(r'<hh:borderFill id="(\d+)"', header)) + 1
        remap = {}
        for r in sorted(refs):
            m = re.search(rf'<hh:borderFill id="{r}".*?</hh:borderFill>', header, re.S).group(0)
            new = re.sub(r'(<hh:(?:left|right|top|bottom)Border) type="\w+"', r'\1 type="NONE"', m.replace(f'id="{r}"', f'id="{nid}"', 1))
            header = header.replace("</hh:borderFills>", new + "</hh:borderFills>", 1)
            remap[r] = str(nid); nid += 1
        header = re.sub(r'<hh:borderFills itemCnt="(\d+)"', lambda x: f'<hh:borderFills itemCnt="{int(x.group(1)) + len(remap)}"', header, count=1)
        sec2 = re.sub(r"<hp:tbl\b.*?</hp:tbl>", lambda t: re.sub(r'borderFillIDRef="(\d+)"', lambda q: f'borderFillIDRef="{remap.get(q.group(1), q.group(1))}"', t.group(0)) if "<hp:pic" in t.group(0) else t.group(0), sec2, flags=re.S)
    hpf = hpf.replace("</opf:manifest>", "".join(f'<opf:item id="{x}" href="BinData/{x}.png" media-type="image/png" isEmbeded="1"/>'
                                                 for x, _ in items) + "</opf:manifest>", 1)
    with zipfile.ZipFile(out, "w") as zout:
        for it in zin.infolist():
            data = zin.read(it.filename)
            if it.filename == "Contents/section0.xml": data = sec2.encode("utf-8")
            elif it.filename == "Contents/content.hpf": data = hpf.encode("utf-8")
            elif it.filename == "Contents/header.xml": data = header.encode("utf-8")
            zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
            zi.compress_type = zipfile.ZIP_STORED if it.filename == "mimetype" or it.filename.startswith("BinData/") else zipfile.ZIP_DEFLATED
            zi.external_attr = it.external_attr
            zout.writestr(zi, data)
        for x, png in items:
            zout.write(png, f"BinData/{x}.png", compress_type=zipfile.ZIP_STORED)
    print(f"만듦 {out} ({os.path.getsize(out)//1024}KB) · 띠 {len(starts)}쪽 · 절 막대 {nbar} · 장 밑줄 {nrule}")

main()
