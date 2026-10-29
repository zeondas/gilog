"""준비 안내서 원고(준비안내서.txt)를 사용자 한글 양식(양식.hwpx – 매뉴얼 탐색기 앞부분)의 문단·글자 모양으로 한글 파일로 만들어요.

  python3 docs/setup/make_hwpx.py            # → docs/setup/기록-준비-안내서.hwpx

원고 줄: @제목 · @부제목 · @큰 1. … · 가. … · @그림(전체 폭 빈 틀) · [그림] 무엇(그림 이름 줄) · @상세 뒤 #가. ○ 1) - <그림>
"""
import random
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).parent
zin = zipfile.ZipFile(HERE / "양식.hwpx")
sec = zin.read("Contents/section0.xml").decode("utf-8")
paras = re.findall(r"<hp:p [^>]*>.*?</hp:p>(?=<hp:p |</hs:sec>)", sec, re.S)
head_end = sec.index(paras[0])
tail = sec[sec.rindex("</hs:sec>"):]
FIRST = paras[0]            # 쪽 설정이 든 첫 문단(화면 이름)
SCREEN_FRAME = paras[9]
DETAIL_FRAME = paras[31]
used = set(re.findall(r'<hp:tbl id="(\d+)"', sec))


def frame(tpl):
    nid = str(random.randint(1_000_000_000, 2_000_000_000))
    while nid in used:
        nid = str(random.randint(1_000_000_000, 2_000_000_000))
    used.add(nid)
    return re.sub(r'(<hp:tbl id=")\d+(")', lambda m: m.group(1) + nid + m.group(2), tpl, count=1)


def P(text, pp, cp, page_break=False):
    run = f'<hp:run charPrIDRef="{cp}"><hp:t>{escape(text)}</hp:t></hp:run>' if text else f'<hp:run charPrIDRef="{cp}"/>'
    return f'<hp:p id="0" paraPrIDRef="{pp}" styleIDRef="0" pageBreak="{"1" if page_break else "0"}" columnBreak="0" merged="0">{run}</hp:p>'


TITLE, H, ITEM, DH, CIRCLE, STEP, DASH = ("0", "7"), ("0", "10"), ("20", "9"), ("0", "8"), ("23", "9"), ("24", "9"), ("25", "9")
BLANK = P("", *DASH)

out, mode, first_title = [], "", True
for ln in (HERE / "준비안내서.txt").read_text(encoding="utf-8").splitlines():
    t = ln.strip()
    if not t:
        continue
    if t.startswith("@제목"):
        name = t[3:].strip()
        if first_title:
            out.append(re.sub(r"<hp:t>[^<]*</hp:t>", lambda m, s=[0]: (s.__setitem__(0, s[0] + 1) or (f"<hp:t>{escape(name)}</hp:t>" if s[0] == 1 else "<hp:t></hp:t>")), FIRST))
            first_title = False
        else:
            out.append(P(name, *TITLE, page_break=True))
        mode = ""
    elif t.startswith("@부제목"):
        out += [P(t[4:].strip(), *H), P("", *H)]
    elif t.startswith("@큰"):
        if out and mode:
            out.append(P("", *ITEM))
        out.append(P(t[2:].strip(), *H))
        mode = "item"
    elif t == "@그림":
        out += [frame(SCREEN_FRAME)]
    elif t == "@상세":
        out += [P("", *ITEM), P("4. 상세설명", *H)]
        mode = "detail"
    elif t.startswith("[그림]"):
        cap = "※ 그림 : " + t[4:].strip()
        out.append(P(("        " if mode == "detail" else "  ") + cap, *(DASH if mode == "detail" else ITEM)))
    elif mode == "detail":
        if t.startswith("#"):
            if out[-1] != BLANK and not out[-1].startswith(P("4. 상세설명", *H)[:60]) and "4. 상세설명" not in out[-1]:
                out.append(BLANK)
            out.append(P("  " + t[1:].strip(), *DH))
        elif t.startswith("○"):
            out.append(P("    ○ " + t[1:].strip(), *CIRCLE))
        elif t.startswith("-"):
            out.append(P("        - " + t[1:].strip(), *DASH))
        elif t.startswith("<그림"):
            out += [frame(DETAIL_FRAME), BLANK]
        else:
            out.append(P("      " + t, *STEP))
    else:
        out.append(P("  " + t, *ITEM))

sec2 = sec[:head_end] + "".join(out) + tail
dst = HERE / "기록-준비-안내서.hwpx"
with zipfile.ZipFile(dst, "w") as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "Contents/section0.xml":
            data = sec2.encode("utf-8")
        elif item.filename == "Preview/PrvText.txt":
            data = re.sub(r"<[^>]+>", "", "\n".join(re.findall(r"<hp:t>(.*?)</hp:t>", sec2)))[:1024].encode("utf-8")
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        zi.compress_type = zipfile.ZIP_STORED if item.filename == "mimetype" else zipfile.ZIP_DEFLATED
        zi.external_attr = item.external_attr
        zout.writestr(zi, data)
print(f"{dst.name}: 문단 {len(out)} · 그림 틀 {sum('<hp:tbl' in p for p in out) - 1}")
