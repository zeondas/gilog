"""절 번호(대구분) 모양 – 2026-10-29 사용자 22:19(2안) · 22:26(글꼴·간격).

  python3 tools/manual/hwpx_secnum.py <한글에서 저장한 매뉴얼.hwpx> <결과.hwpx>

- "1. 기획 의도" 앞 짙은 막대를 없애고 "01 기획 의도"로: 번호는 큰 연회색 글자(제목 × 1.5, #B8B8BF), 제목은 그대로 15pt.
  번호·제목 모두 Noto Sans KR Black(굵게 끔 – 글꼴 자체가 가장 굵은 굵기).
- 번호와 한글의 아래 끝 맞춤: Noto Sans KR Black 한글은 기준선 아래 0.097em, 숫자는 0.014em → 번호를 그 차이만큼 내려요(글자 위치 +%).
- 대구분 문단 아래 간격 10pt(1000). 줄 간격은 지금 줄 높이 그대로 고정(번호가 커도 줄이 안 높아지게).
- 간격을 더해 쪽에 넘치면, 쪽 나눔은 사용자 것 그대로 두고 그 쪽에서 맞춰요:
  쪽 끝의 빈 줄(다음 것을 다음 쪽으로 미는 줄)은 지우고 다음 쪽 첫 문단에 쪽 나누기를 걸어요,
  그래도 넘치면 그 쪽 그림 틀을 살짝(틀의 빈 자리 먼저, 그다음 그림을 비율 그대로) 줄여요.
- 한글이 저장한 줄 배치(linesegarray)로 쪽을 읽어요. 바뀐 구역의 줄 배치 기억은 지워 한글이 다시 배치하게 해요.
"""
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from hwpx_toplevel import top_paras  # noqa: E402

FONT = os.environ.get("NUM_FONT", "Noto Sans KR Black")
SCALE = 1.5
COLOR = "#B8B8BF"
DESC_HANGUL, DESC_DIGIT = 0.097, 0.014          # Noto Sans CJK KR Black 실측(em)
OFFSET = round((DESC_HANGUL * 1 - DESC_DIGIT * SCALE) / SCALE * 100)   # 번호 글자 크기의 %
SPACE_AFTER = 1000                              # 10pt
BODY = 71433                                    # 본문 높이(A4 − 위 15 − 아래 10 − 머리말·꼬리말 10씩, 실측 최대 71425)
MAX_SHRINK = 0.2                                # 그림은 20%까지만 줄여요

src, out = sys.argv[1:3]
z = zipfile.ZipFile(src)
H = z.read("Contents/header.xml").decode()
secs = sorted([n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n)], key=lambda n: int(re.findall(r"\d+", n)[0]))
BAR = re.compile(r'<hp:pic (?:(?!</hp:pic>).)*?<hp:sz width="290" widthRelTo="ABSOLUTE" height="1260".*?</hp:pic>', re.S)
LANGS = ("hangul", "latin", "hanja", "japanese", "other", "symbol", "user")


def add(tag, group, xml):
    global H
    nid = max(int(x) for x in re.findall(rf'<hh:{tag} id="(\d+)"', H)) + 1
    H = H.replace(f"</hh:{group}>", re.sub(rf'^<hh:{tag} id="\d+"', f'<hh:{tag} id="{nid}"', xml) + f"</hh:{group}>", 1)
    H = re.sub(rf'(<hh:{group} itemCnt=")(\d+)', lambda m: m.group(1) + str(int(m.group(2)) + 1), H, count=1)
    return str(nid)


# 글꼴 더하기(언어마다)
def add_font(h):
    def one(m):
        body = m.group(0)
        ids = [int(x) for x in re.findall(r'<hh:font id="(\d+)"', body)]
        f = re.search(rf'<hh:font id="(\d+)" face="{re.escape(FONT)}"', body)
        if f:
            return body
        nid = max(ids) + 1
        font = (f'<hh:font id="{nid}" face="{FONT}" type="TTF" isEmbedded="0"><hh:typeInfo familyType="FCAT_GOTHIC" weight="9" proportion="3" '
                'contrast="2" strokeVariation="0" armStyle="0" letterform="2" midline="0" xHeight="4"/></hh:font>')
        body = body.replace("</hh:fontface>", font + "</hh:fontface>")
        return re.sub(r'fontCnt="\d+"', f'fontCnt="{len(ids) + 1}"', body, count=1)
    return re.sub(r"<hh:fontface lang=.*?</hh:fontface>", one, h, flags=re.S)


H = add_font(H)
FID = {m.group(1).lower(): re.search(rf'<hh:font id="(\d+)" face="{re.escape(FONT)}"', m.group(0)).group(1)
       for m in re.finditer(r'<hh:fontface lang="(\w+)".*?</hh:fontface>', H, re.S)}
cps = {}


def styled(cp, number):
    key = (cp, number)
    if key not in cps:
        x = re.search(rf'<hh:charPr id="{cp}".*?</hh:charPr>', H, re.S).group(0)
        h = int(re.search(r'height="(\d+)"', x).group(1))
        x = re.sub(r"<hh:fontRef [^>]*/>", "<hh:fontRef " + " ".join(f'{k}="{FID[k]}"' for k in LANGS) + "/>", x)
        x = x.replace("<hh:bold/>", "")
        if number:
            x = re.sub(r'height="\d+"', f'height="{round(h * SCALE)}"', x, count=1)
            x = re.sub(r'textColor="[^"]*"', f'textColor="{COLOR}"', x, count=1)
            x = re.sub(r"<hh:offset [^>]*/>", "<hh:offset " + " ".join(f'{k}="{OFFSET}"' for k in LANGS) + "/>", x)
        cps[key] = (add("charPr", "charProperties", x), h)
    return cps[key][0]


pps = {}


def heading_pp(pp, h):
    if (pp, h) not in pps:
        x = re.search(rf'<hh:paraPr id="{pp}".*?</hh:paraPr>', H, re.S).group(0)
        m = re.search(r'<hh:lineSpacing type="PERCENT" value="(\d+)"', x)
        line = round(h * int(m.group(1)) / 100) if m else None
        if line:
            x = re.sub(r'<hh:lineSpacing type="PERCENT" value="\d+" unit="HWPUNIT"/>', f'<hh:lineSpacing type="FIXED" value="{line}" unit="HWPUNIT"/>', x)
        x = re.sub(r'(<hc:next value=")\d+(" unit="HWPUNIT"/>)', rf"\g<1>{SPACE_AFTER}\g<2>", x)
        pps[(pp, h)] = add("paraPr", "paraProperties", x)
    return pps[(pp, h)]


def lines(p):
    q = re.sub(r"<hp:tbl\b.*?</hp:tbl>", "", p, flags=re.S)
    L = re.findall(r"<hp:linesegarray>(.*?)</hp:linesegarray>", q, re.S)
    return [(int(a), int(b)) for a, b in re.findall(r'vertpos="(-?\d+)" vertsize="(\d+)"', L[-1])] if L else []


def is_blank(p):
    q = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", p, flags=re.S)
    return "<hp:tbl" not in q and "<hp:pic" not in q and not re.search(r"<hp:t>[^<]", q) and "<hp:ctrl>" not in q


def shrink_table(p, s):
    """그림 틀(표 하나·칸 하나·그림 하나)을 s만큼 낮춰요: 틀의 빈 자리 먼저, 모자라면 그림을 비율 그대로."""
    t = re.search(r"<hp:tbl\b.*?</hp:tbl>", p, re.S)
    tb = t.group(0)
    th = int(re.search(r'<hp:tbl .*?<hp:sz width="\d+" widthRelTo="\w+" height="(\d+)"', tb, re.S).group(1))
    pic = re.search(r"<hp:pic .*?</hp:pic>", tb, re.S)
    pw, ph = map(int, re.search(r'<hp:sz width="(\d+)" widthRelTo="\w+" height="(\d+)"', pic.group(0)).groups())
    m = re.search(r'<hp:cellMargin left="\d+" right="\d+" top="(\d+)" bottom="(\d+)"', tb)
    room = th - ph - int(m.group(1)) - int(m.group(2)) - 600
    nth = th - s
    g = pic.group(0)
    if s > room:
        nph = ph - (s - max(room, 0))
        f = nph / ph
        npw = round(pw * f)
        g = re.sub(r'<hp:orgSz width="\d+" height="\d+"/>', f'<hp:orgSz width="{npw}" height="{nph}"/>', g)
        g = re.sub(r'(<hp:sz width=")\d+(" widthRelTo="\w+" height=")\d+', rf"\g<1>{npw}\g<2>{nph}", g)
        g = re.sub(r'<hp:rotationInfo angle="0" centerX="\d+" centerY="\d+"', f'<hp:rotationInfo angle="0" centerX="{npw // 2}" centerY="{nph // 2}"', g)
        g = re.sub(r"<hp:imgRect>.*?</hp:imgRect>", f'<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="{npw}" y="0"/><hc:pt2 x="{npw}" y="{nph}"/><hc:pt3 x="0" y="{nph}"/></hp:imgRect>', g, flags=re.S)
    tb = tb[:pic.start()] + g + tb[pic.end():]
    tb = re.sub(r'(<hp:tbl .*?<hp:sz width="\d+" widthRelTo="\w+" height=")\d+', rf"\g<1>{nth}", tb, count=1, flags=re.S)
    tb = re.sub(r'(<hp:cellSz width="\d+" height=")\d+', rf"\g<1>{nth}", tb)
    tb = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", tb, flags=re.S)
    return p[:t.start()] + tb + p[t.end():]


report, new = [], {}
total = {"head": 0, "blank": 0, "break": 0, "pic": 0}
for n in secs:
    s = z.read(n).decode()
    P = top_paras(s)
    paras = [s[a:b] for a, b in P]
    if not any(BAR.search(p) for p in paras):
        continue
    # 쪽 나누기: 첫 줄 vertpos 0
    page_of, pg = [], 0
    for i, p in enumerate(paras):
        L = lines(p)
        if i == 0 or (L and L[0][0] == 0):
            pg += 1
        page_of.append(pg)
        pg += sum(1 for v, _ in L[1:] if v == 0)     # 쪽을 넘어가는 문단
    drop, brk, shrink = set(), set(), {}
    for page in range(1, pg + 1):
        idx = [i for i in range(len(paras)) if page_of[i] == page]
        heads = [i for i in idx if BAR.search(paras[i])]
        if not heads:
            continue
        # 새 자리: 대구분 뒤 문단은 간격만큼 내려가요
        def bottoms(extra_shrink):
            got, shift = [], 0
            for i in idx:
                L = lines(paras[i])
                if not L:
                    continue
                cut = next((k for k in range(1, len(L)) if L[k][0] == 0), len(L))
                L = L[:cut]                                 # 이 쪽에 있는 줄만
                top = L[0][0] + shift
                ext = max(v + h for v, h in L) - L[0][0] - extra_shrink.get(i, 0)
                got.append((i, top, top + ext))
                shift += (SPACE_AFTER if i in heads else 0) - extra_shrink.get(i, 0)
            return got
        b = bottoms({})
        over = [x for x in b if x[2] > BODY]
        if not over:
            continue
        # 1) 쪽 끝 빈 줄
        trail = []
        for i, _, _ in reversed(b):
            if is_blank(paras[i]):
                trail.append(i)
            else:
                break
        for i, top, bot in b:
            if i in trail and bot > BODY:
                drop.add(i)
        if drop & set(idx):
            nxt = [i for i in range(idx[-1] + 1, len(paras))]
            if nxt:
                brk.add(nxt[0])
        # 2) 빈 줄이 아닌 것이 넘치면 그림 틀을 줄여요
        content = [x for x in b if x[0] not in drop]
        need = max(x[2] for x in content) - BODY
        if need > 0:
            frames = [i for i in idx if "<hp:tbl" in paras[i] and "<hp:pic" in paras[i] and i not in drop]
            hs = {i: int(re.search(r'<hp:tbl .*?<hp:sz width="\d+" widthRelTo="\w+" height="(\d+)"', paras[i], re.S).group(1)) for i in frames}
            cap = sum(round(h * MAX_SHRINK) for h in hs.values())
            if cap < need:
                report.append(f"{n} {page}쪽: {need}만큼 넘치는데 그림으로 {cap}까지만 줄일 수 있어요")
            tot = sum(hs.values()) or 1
            for i in frames:
                shrink[i] = min(round(hs[i] * MAX_SHRINK), -(-need * hs[i] // tot))
            report.append(f"{n} {page}쪽: 그림 {len(frames)}개를 모두 {sum(shrink[i] for i in frames)} 줄임(넘친 {need})")
    res = []
    for i, p in enumerate(paras):
        if i in drop:
            continue
        if BAR.search(p):
            p = BAR.sub("", p)
            r = re.search(r'<hp:run charPrIDRef="(\d+)">((?:(?!</hp:run>).)*?)<hp:t>(\d+)\.\s*((?:(?!</hp:t>).)*)</hp:t>', p, re.S)
            cp = r.group(1)
            p = (p[:r.start()] + f'<hp:run charPrIDRef="{styled(cp, True)}">{r.group(2)}<hp:t>{int(r.group(3)):02d} </hp:t></hp:run>'
                 f'<hp:run charPrIDRef="{styled(cp, False)}"><hp:t>{r.group(4)}</hp:t>' + p[r.end():])
            rest = re.sub(r'<hp:run charPrIDRef="' + cp + '">', f'<hp:run charPrIDRef="{styled(cp, False)}">', p[r.end():])
            p = p[:r.end()] + rest
            pp = re.search(r'paraPrIDRef="(\d+)"', p).group(1)
            p = p.replace(f'paraPrIDRef="{pp}"', f'paraPrIDRef="{heading_pp(pp, cps[(cp, True)][1])}"', 1)
            total["head"] += 1
        if i in shrink:
            p = shrink_table(p, shrink[i])
            total["pic"] += 1
        if i in brk:
            p = p.replace('pageBreak="0"', 'pageBreak="1"', 1)
            total["break"] += 1
        res.append(re.sub(r"<hp:linesegarray>(?:(?!</hp:linesegarray>).)*?</hp:linesegarray>(?=</hp:p>$)", "", p, flags=re.S))
    total["blank"] += len(drop)
    new[n] = s[:P[0][0]] + "".join(res) + s[P[-1][1]:]

with zipfile.ZipFile(out, "w") as zo:
    for it in z.infolist():
        d = z.read(it.filename)
        if it.filename in new:
            d = new[it.filename].encode()
        elif it.filename == "Contents/header.xml":
            d = H.encode()
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
        zi.compress_type, zi.external_attr = it.compress_type, it.external_attr
        zo.writestr(zi, d)
print("\n".join(report))
print(f"만듦 {out} · 대구분 {total['head']} · 지운 빈 줄 {total['blank']} · 쪽 나누기 {total['break']} · 줄인 그림 {total['pic']} · 번호 내림 {OFFSET}%")
