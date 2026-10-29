"""한글 매뉴얼 앞부분 – 표지 · 목차 · Ⅰ. 프로그램 개요(개요·제원·제작 기술·코드 분량·처음 화면·모듈 구성)를 맨 앞에 더해요.

  python3 tools/manual/hwpx_front.py <지킴이 빌드> <사용자.hwpx> <결과.hwpx> <짝 json 폴더> <front.txt>

- 사용자 파일의 장(탐색기~설정)은 그대로 두고, 첫 문단의 쪽 설정(secPr)만 표지 첫 문단으로 옮겨요(한글은 쪽 설정이 문서 첫 문단에 있어야 해요).
- 목차는 장 제목(글자 모양 7)과 바로 아래 부제목을 읽어 만들어요. 쪽 번호는 한글에서 쪽이 정해진 뒤 사용자가 적어요.
- 그림 두 장: 잠금 화면(가운데 카드), 시작 화면(가·나·다 번호 – map_overview.json).
2026-10-29 14:52 사용자 요청.
"""
import asyncio
import json
import os
import random
import re
import sys
import zipfile
from xml.sax.saxutils import escape

from PIL import Image
from playwright.async_api import async_playwright

import cap
import hwpx_pics as hp

site, src, out, mapdir, front_txt = sys.argv[1:]
hp.load_extra(mapdir)
zin = zipfile.ZipFile(src)
sec = zin.read("Contents/section0.xml").decode("utf-8")
header = zin.read("Contents/header.xml").decode("utf-8")
hpf = zin.read("Contents/content.hpf").decode("utf-8")
paras = re.findall(r"<hp:p [^>]*>.*?</hp:p>(?=<hp:p |</hs:sec>)", sec, re.S)
head_end = sec.index(paras[0])
tail = sec[sec.rindex("</hs:sec>"):]


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
            b[cur].append(ln.strip())
    return b


F = blocks(front_txt)

# ---------- 글자·문단 모양 ----------
cp_items = {m.group(1): m.group(0) for m in re.finditer(r'<hh:charPr id="(\d+)".*?</hh:charPr>', header, re.S)}
next_cp = max(int(k) for k in cp_items) + 1
new_cp = []


def clone_cp(base, height):
    global next_cp
    x = re.sub(r'<hh:charPr id="\d+"', f'<hh:charPr id="{next_cp}"', cp_items[base], count=1)
    x = re.sub(r'height="\d+"', f'height="{height}"', x, count=1)
    new_cp.append(x)
    next_cp += 1
    return str(next_cp - 1)


COVER_TITLE = clone_cp("7", 3600)      # 36pt 굵게
COVER_SUB = clone_cp("9", 1500)        # 15pt
KEY = next(k for k, v in cp_items.items() if 'shadeColor="#E8E8E8"' in v and 'hangul="0" latin="0"' in re.search(r"<hh:spacing [^>]*>", v).group(0))
header = header.replace("</hh:charProperties>", "".join(new_cp) + "</hh:charProperties>", 1)
header = re.sub(r'(<hh:charProperties itemCnt=")\d+', lambda m: m.group(1) + str(next_cp), header, count=1)
header, CENTER = hp.add_center_para(header)
pp_items = {m.group(1): m.group(0) for m in re.finditer(r'<hh:paraPr id="(\d+)".*?</hh:paraPr>', header, re.S)}
HANG_O = next((k for k, x in pp_items.items() if '<hc:intent value="-4600"' in x), "23")


def tx(text):
    """글 → 글자 묶음(키 Ctrl+L 등은 키 모양)."""
    return text


def runs(text, cp):
    out, last = [], 0
    for m in re.finditer(r"(?<![A-Za-z])(?:Ctrl|Shift|Alt)\+[A-Z0-9]\b", text):
        if m.start() > last:
            out.append((cp, text[last:m.start()]))
        out.append((KEY, m.group(0)))
        last = m.end()
    if last < len(text):
        out.append((cp, text[last:]))
    return "".join(f'<hp:run charPrIDRef="{c}"><hp:t>{escape(t)}</hp:t></hp:run>' for c, t in out)


def P(text, pp, cp, page_break=False):
    pb = "1" if page_break else "0"
    body = runs(text, cp) if text else f'<hp:run charPrIDRef="{cp}"/>'
    return f'<hp:p id="0" paraPrIDRef="{pp}" styleIDRef="0" pageBreak="{pb}" columnBreak="0" merged="0">{body}</hp:p>'


H = ("0", "10")
ITEM = ("20", "9")

# ---------- 첫 문단 쪽 설정 옮기기 ----------
p0 = paras[0]
m = re.match(r'(<hp:p [^>]*>)(<hp:run charPrIDRef="\d+">(?:(?!</hp:run>).)*?<hp:secPr.*?</hp:run>)', p0, re.S)
sec_run = m.group(2)
p0_rest = p0.replace(sec_run, "", 1)
p0_rest = re.sub(r'pageBreak="\d"', 'pageBreak="1"', p0_rest, count=1)
p0_rest = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", p0_rest, flags=re.S)
# 쪽 번호(사용자가 탐색기 제목에 넣음)는 Ⅰ. 프로그램 개요 첫 쪽으로 옮겨요 – 표지·목차에는 번호 없이
pnum = re.search(r"<hp:ctrl><hp:pageNum [^>]*/></hp:ctrl>", p0_rest)
pnum = pnum.group(0) if pnum else ""
p0_rest = p0_rest.replace(pnum, "", 1)
first = f'<hp:p id="0" paraPrIDRef="{CENTER}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">{sec_run}</hp:p>'

# ---------- 장 목록(목차·모듈 구성) ----------
chapters = []
for i, p in enumerate(paras):
    t = re.search(r'<hp:run charPrIDRef="7">(?:<hp:ctrl>(?:(?!</hp:ctrl>).)*</hp:ctrl>)?<hp:t>([^<]+)</hp:t>', p, re.S)
    if t:
        nxt = "".join(re.findall(r"<hp:t>([^<]*)</hp:t>", paras[i + 1])).strip()
        chapters.append((t.group(1).strip(), nxt))

FRAME_SCREEN = next(p for p in paras if re.search(r'<hp:tbl id="(?!19)\d+"', p) and "paraPrIDRef=\"0\"" in p[:120])
FRAME_DETAIL = next(p for p in paras if re.search(r'<hp:tbl id="19\d{8}"', p))


def frame(tpl, nid):
    t = re.sub(r'(<hp:tbl id=")\d+(")', lambda m: m.group(1) + nid + m.group(2), tpl, count=1)
    return re.sub(r"<hp:pic .*?</hp:pic>", "", t, flags=re.S)


LOCK_ID, SCREEN_ID = "1999000001", "1999000002"
L = "가나다라마바사아자차카타파하"
front = [first]
# 표지
front += [P("", CENTER, "9")] * 9
front += [P(F["표지제목"][0], CENTER, COVER_TITLE), P("", CENTER, "9"), P(F["표지부제"][0], CENTER, COVER_SUB)]
front += [P("", CENTER, "9")] * 12
front += [P(F["표지판"][0], CENTER, "10"), P(F["표지날짜"][0], CENTER, "10"), P(F["표지소속"][0], CENTER, "10")]
# 목차
front.append(P("목    차", CENTER, "7", page_break=True))
front += [P("", "0", "9"), P("Ⅰ. 프로그램 개요", *H)]
front.append(P("  1. 개요 · 2. 프로그램 제원 · 3. 제작 기술 · 4. 코드 분량 · 5. 처음 화면 · 6. 모듈 구성", *ITEM))
front += [P("", "0", "9"), P("Ⅱ. 모듈별 사용법", *H)]
for k, (name, sub) in enumerate(chapters, 1):
    front.append(P(f"  {k}. {name} – {sub}", *ITEM))
# Ⅰ. 프로그램 개요
front.append(P(F["개요제목"][0], "0", "7", page_break=True).replace('<hp:run charPrIDRef="7"><hp:t>', f'<hp:run charPrIDRef="7">{pnum}<hp:t>', 1))
front += [P(F["개요부제"][0], *H), P("", *H)]
for no, (head, key) in enumerate([("개요", "개요"), ("프로그램 제원", "제원"), ("제작 기술", "기술"), ("코드 분량", "분량")], 1):
    front.append(P(f"{no}. {head}", *H))
    front += [P("  " + x, *ITEM) for x in F[key]]
    front.append(P("", *ITEM))
front.append(P("5. 처음 화면", *H))
for x in F["처음화면"]:
    if x == "<잠금>":
        front.append(frame(FRAME_DETAIL, LOCK_ID))
    elif x == "<화면>":
        front.append(frame(FRAME_SCREEN, SCREEN_ID))
    elif x.startswith("○"):
        front.append(P("    ○ " + x[1:].strip(), HANG_O, "9"))
    else:
        front.append(P("  " + x, *ITEM))
front += [P("", *ITEM), P("6. 모듈 구성", *H)]
for x in F["모듈머리"]:
    front.append(P("    ○ " + x[1:].strip(), HANG_O, "9"))
for k, (name, sub) in enumerate(chapters):
    front.append(P(f"  {L[k]}. {name} : {sub}", *ITEM))

# ---------- 그림 ----------
mp = json.load(open(os.path.join(mapdir, "map_overview.json"), encoding="utf-8"))
pngdir = os.path.splitext(out)[0] + "_pics"
os.makedirs(pngdir, exist_ok=True)


async def shoot():
    srv, port = cap.serve(site)
    url = f"http://127.0.0.1:{port}/"
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        miss = await hp.screen_png(br, url, mp, os.path.join(pngdir, "overview_00.png"))
        miss += await hp.crop_pngs(br, url, {"scene": mp["lock"]["scene"], "feats": []}, ["@" + mp["lock"]["sel"]],
                                   [os.path.join(pngdir, "overview_lock.png")])
        await br.close()
    srv.shutdown()
    return miss


missing = asyncio.run(shoot())
items = []


def fill(p, png, scale, mh, bid):
    t = re.search(r"<hp:tbl .*?</hp:tbl>", p, re.S)
    items.append((bid, png))
    return p[:t.start()] + hp.fill(t.group(0), png, bid, CENTER, scale, mh) + p[t.end():]


front = [fill(p, os.path.join(pngdir, "overview_lock.png"), 40, 52000, "front01") if f'<hp:tbl id="{LOCK_ID}"' in p else
         fill(p, os.path.join(pngdir, "overview_00.png"), None, None, "front02") if f'<hp:tbl id="{SCREEN_ID}"' in p else p
         for p in front]

sec2 = sec[:head_end] + "".join(front) + p0_rest + "".join(paras[1:]) + tail
hpf = hpf.replace("</opf:manifest>", "".join(f'<opf:item id="{b}" href="BinData/{b}.png" media-type="image/png" isEmbeded="1"/>'
                                               for b, _ in items) + "</opf:manifest>", 1)
with zipfile.ZipFile(out, "w") as zout:
    for it in zin.infolist():
        data = zin.read(it.filename)
        if it.filename == "Contents/section0.xml":
            data = sec2.encode("utf-8")
        elif it.filename == "Contents/header.xml":
            data = header.encode("utf-8")
        elif it.filename == "Contents/content.hpf":
            data = hpf.encode("utf-8")
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
        zi.compress_type = zipfile.ZIP_STORED if it.filename == "mimetype" or it.filename.startswith("BinData/") else zipfile.ZIP_DEFLATED
        zi.external_attr = it.external_attr
        zout.writestr(zi, data)
    for b_, png in items:
        zout.write(png, f"BinData/{b_}.png", compress_type=zipfile.ZIP_STORED)
print(f"만듦 {out} ({os.path.getsize(out) // 1024}KB) · 앞부분 문단 {len(front)} · 장 {len(chapters)}")
if missing:
    print("못 찾은 요소:", missing)
