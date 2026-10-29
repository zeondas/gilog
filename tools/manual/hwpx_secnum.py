"""절 번호 모양 2안 – "1. 기획 의도" 앞 짙은 막대를 없애고, 번호를 큰 연회색 두 자리 글자(01)로 바꿔요(2026-10-29 22:19 사용자).

  python3 tools/manual/hwpx_secnum.py <한글에서 저장한 매뉴얼.hwpx> <결과.hwpx>

- 번호는 그림이 아니라 글자예요: 새 글자 모양 하나(제목 글자 모양 × 1.5, 색 #B8B8BF, 아래로 OFFSET%)만 더해요.
- 한글 글자는 기준선보다 조금 아래까지 내려와서, 숫자를 그만큼 내려 둘의 아래 끝을 맞춰요(글자 위치 +값 = 아래로).
- 번호 글자가 커도 줄 높이가 늘지 않게, 제목 문단은 줄 간격을 지금 높이 그대로 "고정 값"으로 둬요
  (늘면 사용자가 빈 줄로 맞춘 쪽 나눔이 밀려요).
"""
import os
import re
import sys
import zipfile

SCALE = float(os.environ.get("NUM_SCALE", "1.5"))
OFFSET = int(os.environ.get("NUM_OFFSET", "5"))
COLOR = os.environ.get("NUM_COLOR", "#B8B8BF")

src, out = sys.argv[1:3]
z = zipfile.ZipFile(src)
H = z.read("Contents/header.xml").decode()
secs = sorted([n for n in z.namelist() if re.match(r"Contents/section\d+\.xml$", n)], key=lambda n: int(re.findall(r"\d+", n)[0]))
BAR = re.compile(r'<hp:pic (?:(?!</hp:pic>).)*?<hp:sz width="290" widthRelTo="ABSOLUTE" height="1260".*?</hp:pic>', re.S)


def add(tag, group, xml):
    global H
    ids = [int(x) for x in re.findall(rf'<hh:{tag} id="(\d+)"', H)]
    nid = max(ids) + 1
    H = H.replace(f"</hh:{group}>", re.sub(rf'^<hh:{tag} id="\d+"', f'<hh:{tag} id="{nid}"', xml) + f"</hh:{group}>", 1)
    H = re.sub(rf'(<hh:{group} itemCnt=")(\d+)', lambda m: m.group(1) + str(int(m.group(2)) + 1), H, count=1)
    return str(nid)


num_cp, fixed_pp = {}, {}


def number_cp(cp):
    if cp not in num_cp:
        x = re.search(rf'<hh:charPr id="{cp}".*?</hh:charPr>', H, re.S).group(0)
        h = int(re.search(r'height="(\d+)"', x).group(1))
        x = re.sub(r'height="\d+"', f'height="{round(h * SCALE)}"', x, count=1)
        x = re.sub(r'textColor="[^"]*"', f'textColor="{COLOR}"', x, count=1)
        x = re.sub(r"<hh:offset [^>]*/>", "<hh:offset " + " ".join(f'{k}="{OFFSET}"' for k in ("hangul", "latin", "hanja", "japanese", "other", "symbol", "user")) + "/>", x)
        if "<hh:bold/>" not in x:
            x = x.replace("<hh:underline", "<hh:bold/><hh:underline", 1)
        num_cp[cp] = (add("charPr", "charProperties", x), h)
    return num_cp[cp][0]


def fixed(pp, h):
    """그 문단 모양을 줄 간격 고정(지금 줄 높이 = 글자 높이 × 비율%)으로."""
    if (pp, h) not in fixed_pp:
        x = re.search(rf'<hh:paraPr id="{pp}".*?</hh:paraPr>', H, re.S).group(0)
        m = re.search(r'<hh:lineSpacing type="PERCENT" value="(\d+)"', x)
        assert m, f"문단 모양 {pp}: 줄 간격이 % 가 아니에요"
        line = round(h * int(m.group(1)) / 100)
        x = re.sub(r'<hh:lineSpacing type="PERCENT" value="\d+" unit="HWPUNIT"/>', f'<hh:lineSpacing type="FIXED" value="{line}" unit="HWPUNIT"/>', x)
        fixed_pp[(pp, h)] = add("paraPr", "paraProperties", x)
    return fixed_pp[(pp, h)]


new, done = {}, 0
for n in secs:
    s = z.read(n).decode()

    def one(m):
        global done
        p = m.group(0)
        if not BAR.search(p):
            return p
        p = BAR.sub("", p)
        r = re.search(r'<hp:run charPrIDRef="(\d+)">((?:(?!</hp:run>).)*?)<hp:t>(\d+)\.\s*((?:(?!</hp:t>).)*)</hp:t>', p, re.S)
        assert r, re.sub(r"<[^>]+>", "", p)[:60]
        cp = r.group(1)
        ncp = number_cp(cp)
        rep = (f'<hp:run charPrIDRef="{ncp}">{r.group(2)}<hp:t>{int(r.group(3)):02d} </hp:t></hp:run>'
               f'<hp:run charPrIDRef="{cp}"><hp:t>{r.group(4)}</hp:t>')
        p = p[:r.start()] + rep + p[r.end():]
        pp = re.search(r'paraPrIDRef="(\d+)"', p).group(1)
        p = p.replace(f'paraPrIDRef="{pp}"', f'paraPrIDRef="{fixed(pp, num_cp[cp][1])}"', 1)
        p = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", p, flags=re.S)  # 한글이 다시 배치
        done += 1
        return p
    # 맨 위 문단만(표 안 문단 아님) – 제목 문단은 표가 없어요
    new[n] = re.sub(r'<hp:p (?:(?!<hp:p ).)*?</hp:p>', one, s, flags=re.S)

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
print(f"만듦 {out} · 절 번호 {done}개 · 새 글자 모양 {[v[0] for v in num_cp.values()]} · 고정 줄 간격 문단 모양 {list(fixed_pp.values())}")
