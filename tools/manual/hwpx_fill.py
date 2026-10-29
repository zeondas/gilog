"""사용자 한글 원고(앞부분)를 그대로 두고, 같은 문단 양식으로 나머지를 이어 붙여요.

  python3 assemble.py <사용자.hwpx> <결과.hwpx> <탐색기 나머지.txt> <화면.txt ...>
"""
import random
import re
import sys
import zipfile
from xml.sax.saxutils import escape

src, out, rest, *chapters = sys.argv[1:]
zin = zipfile.ZipFile(src)
sec = zin.read("Contents/section0.xml").decode("utf-8")

paras = re.findall(r"<hp:p [^>]*>.*?</hp:p>(?=<hp:p |</hs:sec>)", sec, re.S)
head_end = sec.index(paras[0])
tail = sec[sec.rindex("</hs:sec>"):]
assert "".join(paras) == sec[head_end:sec.rindex("</hs:sec>")], "문단 나누기가 원문과 달라요"

SCREEN_FRAME = paras[9]     # "2. 화면" 아래 빈 틀(전체 폭)
DETAIL_FRAME = paras[31]    # 상세설명 그림 틀(오른쪽 맞춤)
used_ids = set(re.findall(r'<hp:tbl id="(\d+)"', sec))


def frame(tpl):
    """사용자가 만든 빈 그림 틀을 그대로 복사하고 표 번호만 새로."""
    nid = str(random.randint(1_000_000_000, 2_000_000_000))
    while nid in used_ids:
        nid = str(random.randint(1_000_000_000, 2_000_000_000))
    used_ids.add(nid)
    return re.sub(r'(<hp:tbl id=")\d+(")', lambda m: m.group(1) + nid + m.group(2), tpl, count=1)


def P(text, pp, cp, page_break=False):
    pb = "1" if page_break else "0"
    run = f'<hp:run charPrIDRef="{cp}"><hp:t>{escape(text)}</hp:t></hp:run>' if text else f'<hp:run charPrIDRef="{cp}"/>'
    return f'<hp:p id="0" paraPrIDRef="{pp}" styleIDRef="0" pageBreak="{pb}" columnBreak="0" merged="0">{run}</hp:p>'


# 사용자 양식(문단 모양 번호 · 글자 모양 번호 · 앞 공백)
TITLE = ("0", "7")          # 화면 이름 25pt 굵게
H = ("0", "10")             # 부제목·1. 기획의도 등 15pt 굵게
ITEM_PP = {0: "20", 1: "21", 2: "22"}   # 기획의도 가. 나. 다. (내어쓰기)
FEAT = ("20", "9")          # 기능별 설명 줄
DH = ("0", "8")             # 상세설명 가. 제목 13pt 굵게
CIRCLE = ("23", "9")        # ○
STEP = ("24", "9")          # 1)
DASH = ("25", "9")          # -
BLANK_AFTER_FRAME = ("25", "9")


def detail(lines):
    """#가. / ○ / 1) / - / <그림> 줄 → 문단들."""
    out = []
    first = True
    for ln in lines:
        t = ln.strip()
        if not t:
            continue
        if t.startswith("#"):
            if not first and not out[-1].startswith(P("", *BLANK_AFTER_FRAME)):
                out.append(P("", *BLANK_AFTER_FRAME))
            first = False
            out.append(P("  " + t[1:].strip(), *DH))
        elif t.startswith("○"):
            out.append(P("    ○ " + t[1:].strip(), *CIRCLE))
        elif re.match(r"^\d+\)", t):
            out.append(P("      " + t, *STEP))
        elif t.startswith("-"):
            out.append(P("        - " + t[1:].strip(), *DASH))
        elif t.startswith("<그림"):
            out.append(frame(DETAIL_FRAME))
            out.append(P("", *BLANK_AFTER_FRAME))
        else:
            out.append(P("      " + t, *STEP))
    if out and out[-1] != P("", *BLANK_AFTER_FRAME):
        out.append(P("", *BLANK_AFTER_FRAME))
    return out


def blocks(path):
    cur, b = None, {}
    for ln in open(path, encoding="utf-8"):
        ln = ln.rstrip("\n")
        m = re.match(r"^@(\S+)\s*(.*)$", ln)
        if m:
            cur = m.group(1)
            b[cur] = [m.group(2)] if m.group(2) else []
            continue
        if cur and ln.strip():
            b[cur].append(ln)
    return b


# 1) 탐색기: 기능별 설명 끝(빈 줄 문단 20 앞)에 더할 줄, 상세설명 끝에 이어 붙일 문단
r = blocks(rest)
feat_add = [P("  " + x.strip(), *FEAT) for x in r.get("기능별추가", [])]
new = paras[:20] + feat_add + paras[20:]
new += detail(r["상세"])

# 2) 나머지 화면
for path in chapters:
    b = blocks(path)
    new.append(P(b["화면"][0].strip(), *TITLE, page_break=True))
    new.append(P(b["부제목"][0].strip(), *H))
    new.append(P("", *H))
    new.append(P("1. 기획의도", *H))
    items = [x.strip() for x in b["기획의도"]]
    for i, x in enumerate(items):
        new.append(P("  " + x, ITEM_PP.get(i, "22"), "9"))
    new.append(P("", "22", "9"))
    new.append(P("2. 화면", *H))
    new.append(frame(SCREEN_FRAME))
    new.append(P("", *H))
    new.append(P("3. 기능별 설명", *H))
    for x in b["기능별"]:
        new.append(P("  " + x.strip(), *FEAT))
    new.append(P("", *FEAT))
    new.append(P("4. 상세설명", *H))
    new += detail(b["상세"])

sec2 = sec[:head_end] + "".join(new) + tail

with zipfile.ZipFile(out, "w") as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "Contents/section0.xml":
            data = sec2.encode("utf-8")
        elif item.filename == "Preview/PrvText.txt":
            txt = re.sub(r"<[^>]+>", "", "\n".join(re.findall(r"<hp:t>(.*?)</hp:t>", sec2)))
            data = txt[:1024].encode("utf-8")
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        zi.compress_type = zipfile.ZIP_STORED if item.filename == "mimetype" else zipfile.ZIP_DEFLATED
        zi.external_attr = item.external_attr
        zout.writestr(zi, data)
print(f"문단 {len(paras)} → {len(new)}")
