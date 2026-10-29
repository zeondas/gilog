"""준비 안내서(민원처리·구글 캘린더·집행현황 팀 공유) – 매뉴얼과 같은 양식의 hwpx로 만들어요.

  python3 tools/manual/hwpx_setup.py <매뉴얼 사용자 수정본.hwpx> <결과.hwpx> <원고 setup.txt> <그림 폴더>

양식(글자 모양·문단 모양·그림 틀·쪽 설정)은 매뉴얼 수정본에서 가져와요.
원고 줄: "= 장 제목" · "~ 부제목" · "# 1. 구분 제목" · "## 가. 상세 제목" · "가. …"(항목) · "○ …" · "1) …" · "- …" · "_"(빈 줄)
       "<그림 파일.png>"(그림 폴더의 그림을 틀에) · "<그림 {설명}>"(빈 틀에 붉은 글자 – 사용자가 캡처해 넣을 곳)
버튼 [ … ]·키(Enter 등)는 매뉴얼처럼 굵게 + 연회색 바탕이에요.
"""
import os
import random
import re
import sys
import zipfile
from xml.sax.saxutils import escape, unescape

sys.path.insert(0, os.path.dirname(__file__))
from hwpx_toplevel import top_paras  # noqa: E402
import hwpx_pics as hp  # noqa: E402

src, out, txt, imgdir = sys.argv[1:5]
zin = zipfile.ZipFile(src)
sec = zin.read("Contents/section0.xml").decode("utf-8")
header = zin.read("Contents/header.xml").decode("utf-8")
hpf = zin.read("Contents/content.hpf").decode("utf-8")
P_ = top_paras(sec)
paras = [sec[a:b] for a, b in P_]
head, tail = sec[:P_[0][0]], sec[P_[-1][1]:]

# ---------- 틀·쪽 설정 ----------
sec_run = re.search(r'<hp:run charPrIDRef="\d+">(<hp:secPr.*?</hp:secPr>(?:<hp:ctrl>.*?</hp:ctrl>)*)', paras[0], re.S).group(1)
pagenum = re.search(r'<hp:ctrl><hp:pageNum [^>]*/></hp:ctrl>', sec).group(0)
FRAME_DETAIL = next(p for p in paras if re.search(r'<hp:tbl id="19\d{8}"', p))
used = set(re.findall(r'<hp:tbl id="(\d+)"', sec))

# ---------- 글자 모양 ----------
cp_items = {m.group(1): m.group(0) for m in re.finditer(r'<hh:charPr id="(\d+)".*?</hh:charPr>', header, re.S)}
next_cp = max(int(k) for k in cp_items) + 1
new_cp, cache = [], {}


def norm(x):
    return re.sub(r'<hh:charPr id="\d+"', "", x)


def derive(base, kind):
    global next_cp
    if (base, kind) in cache:
        return cache[(base, kind)]
    x = cp_items[base]
    if kind == "key":
        x = re.sub(r'shadeColor="[^"]*"', 'shadeColor="#E8E8E8"', x, count=1)
        if "<hh:bold/>" not in x:
            x = x.replace("<hh:underline", "<hh:bold/><hh:underline", 1)
    else:
        x = re.sub(r'textColor="[^"]*"', 'textColor="#FF0000"', x, count=1)
    for k, v in cp_items.items():
        if norm(v) == norm(x):
            cache[(base, kind)] = k
            return k
    x = re.sub(r'<hh:charPr id="\d+"', f'<hh:charPr id="{next_cp}"', x, count=1)
    cp_items[str(next_cp)] = x
    new_cp.append(x)
    cache[(base, kind)] = str(next_cp)
    next_cp += 1
    return cache[(base, kind)]


# ---------- 문단 모양(내어쓰기) ----------
pp_items = {m.group(1): m.group(0) for m in re.finditer(r'<hh:paraPr id="(\d+)".*?</hh:paraPr>', header, re.S)}
next_pp = max(int(k) for k in pp_items) + 1
new_pp = []


def find_hang(v, like="24"):
    global next_pp
    for k, x in pp_items.items():
        if f'<hc:intent value="-{v}"' in x:
            return k
    x = re.sub(r'<hh:paraPr id="\d+"', f'<hh:paraPr id="{next_pp}"', pp_items[like], count=1)
    a, _, c = x.partition("<hp:default>")
    a = re.sub(r'<hc:intent value="-?\d+"', f'<hc:intent value="-{v}"', a)
    c = re.sub(r'<hc:intent value="-?\d+"', f'<hc:intent value="-{v * 2}"', c)
    x = a + ("<hp:default>" + c if c else "")
    pp_items[str(next_pp)] = x
    new_pp.append(x)
    next_pp += 1
    return str(next_pp - 1)


PP = {"o": find_hang(4600, "23"), "1": find_hang(5750), "-": find_hang(6450, "25")}
header = header.replace("</hh:paraProperties>", "".join(new_pp) + "</hh:paraProperties>", 1)
header = re.sub(r'(<hh:paraProperties itemCnt=")(\d+)', lambda m: m.group(1) + str(int(m.group(2)) + len(new_pp)), header, count=1)
header, CENTER = hp.add_center_para(header)

# ---------- 버튼·키 칠하기 ----------
KEY = re.compile(r"\[[^\[\]]{1,40}\]|(?<![A-Za-z])(?:Enter|Esc|Tab|Ctrl\+[A-Z])(?![A-Za-z])")


def runs(text, cp):
    if cp in ("7", "8", "10"):
        return f'<hp:run charPrIDRef="{cp}"><hp:t>{escape(text)}</hp:t></hp:run>'
    outp, pos = [], 0
    for m in KEY.finditer(text):
        if m.start() > pos:
            outp.append((cp, text[pos:m.start()]))
        outp.append((derive(cp, "key"), m.group(0)))
        pos = m.end()
    if pos < len(text):
        outp.append((cp, text[pos:]))
    return "".join(f'<hp:run charPrIDRef="{c}"><hp:t>{escape(t)}</hp:t></hp:run>' for c, t in outp)


def P(text, pp, cp, page_break=False, pre=""):
    pb = "1" if page_break else "0"
    body = runs(text, cp) if text else f'<hp:run charPrIDRef="{cp}"/>'
    if pre:
        body = f'<hp:run charPrIDRef="{cp}">{pre}</hp:run>' + body
    return f'<hp:p id="0" paraPrIDRef="{pp}" styleIDRef="0" pageBreak="{pb}" columnBreak="0" merged="0">{body}</hp:p>'


items = []


def frame(spec):
    nid = str(random.randint(1_000_000_000, 1_800_000_000))
    while nid in used:
        nid = str(random.randint(1_000_000_000, 1_800_000_000))
    used.add(nid)
    t = re.sub(r'(<hp:tbl id=")\d+(")', lambda m: m.group(1) + nid + m.group(2), FRAME_DETAIL, count=1)
    t = re.sub(r"<hp:pic .*?</hp:pic>", "", t, flags=re.S)
    t = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", t, flags=re.S)
    tb = re.search(r"<hp:tbl .*?</hp:tbl>", t, re.S)
    if spec.startswith("{"):
        red = derive("9", "red")
        cell = re.sub(r'(<hp:subList [^>]*>)<hp:p ([^>]*)paraPrIDRef="\d+"([^>]*)>.*?</hp:p>',
                      lambda m: f'{m.group(1)}<hp:p {m.group(2)}paraPrIDRef="{CENTER}"{m.group(3)}><hp:run charPrIDRef="{red}"><hp:t>{escape(spec)}</hp:t></hp:run></hp:p>',
                      tb.group(0), count=1, flags=re.S)
        h = 9000
        cell = re.sub(r'(<hp:sz width="\d+" widthRelTo="ABSOLUTE" height=")\d+', lambda m: m.group(1) + str(h), cell, count=1)
        cell = re.sub(r'(<hp:cellSz width="\d+" height=")\d+', lambda m: m.group(1) + str(h), cell, count=1)
        return t[:tb.start()] + cell + t[tb.end():]
    png = os.path.join(imgdir, spec)
    bid = f"setup{len(items) + 1:02d}"
    items.append((bid, png))
    return t[:tb.start()] + hp.fill(tb.group(0), png, bid, CENTER, None) + t[tb.end():]


# ---------- 원고 → 문단 ----------
gen, first_title = [], True
for raw in open(txt, encoding="utf-8"):
    s = raw.rstrip("\n").strip()
    if not s:
        continue
    if s.startswith("= "):
        if not first_title:
            gen.append(P(s[2:], "0", "7", page_break=True))
        else:
            gen.append(P(s[2:], "0", "7", pre=sec_run + pagenum))
            first_title = False
    elif s.startswith("~ "):
        gen += [P(s[2:], "0", "10"), P("", "0", "10")]
    elif s.startswith("## "):
        if gen and 'charPrIDRef="9"' in gen[-1] or (gen and "<hp:tbl" in gen[-1]):
            gen.append(P("", "25", "9"))
        gen.append(P("  " + s[3:], "0", "8"))
    elif s.startswith("# "):
        gen.append(P(s[2:], "0", "10"))
    elif s == "_":
        gen.append(P("", "20", "9"))
    elif m := re.match(r"<그림 (.+)>$", s):
        gen.append(frame(m.group(1)))
    elif s.startswith("○"):
        gen.append(P("    ○ " + s[1:].strip(), PP["o"], "9"))
    elif s.startswith("- "):
        gen.append(P("        - " + s[2:].strip(), PP["-"], "9"))
    elif re.match(r"^\d+\)", s):
        gen.append(P("      " + s, PP["1"], "9"))
    elif re.match(r"^[가-힣]\. ", s):
        gen.append(P("  " + s, "20", "9"))
    else:
        raise SystemExit(f"모르는 줄: {s}")
gen.append(P("", "25", "9"))

sec2 = head + "".join(gen) + tail
header = header.replace("</hh:charProperties>", "".join(new_cp) + "</hh:charProperties>", 1)
header = re.sub(r'(<hh:charProperties itemCnt=")\d+', lambda m: m.group(1) + str(next_cp), header, count=1)
hpf = re.sub(r'<opf:item [^>]*href="BinData/[^"]*"[^>]*/>', "", hpf)
hpf = hpf.replace("</opf:manifest>", "".join(f'<opf:item id="{b}" href="BinData/{b}.png" media-type="image/png" isEmbeded="1"/>'
                                               for b, _ in items) + "</opf:manifest>", 1)
with zipfile.ZipFile(out, "w") as zout:
    for it in zin.infolist():
        if it.filename.startswith("BinData/") or it.filename == "Preview/PrvImage.png":
            continue
        data = zin.read(it.filename)
        if it.filename == "Preview/PrvText.txt":   # 미리 보기 글 = 원고 글
            data = "\r\n".join(re.sub(r"^[=~#]+ |^_$|^<그림 .*>$", "", x.strip()) for x in open(txt, encoding="utf-8"))[:1000].encode("utf-8")
        if it.filename == "Contents/section0.xml":
            data = sec2.encode("utf-8")
        elif it.filename == "Contents/header.xml":
            data = header.encode("utf-8")
        elif it.filename == "Contents/content.hpf":
            data = hpf.encode("utf-8")
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
        zi.compress_type = zipfile.ZIP_STORED if it.filename == "mimetype" else zipfile.ZIP_DEFLATED
        zi.external_attr = it.external_attr
        zout.writestr(zi, data)
    for b_, png in items:
        zout.write(png, f"BinData/{b_}.png", compress_type=zipfile.ZIP_STORED)
print(f"만듦 {out} ({os.path.getsize(out) // 1024}KB) · 문단 {len(gen)} · 그림 {len(items)} · 붉은 틀 {sum(1 for g in gen if 'textColor' in g or '#FF0000' in g)}")
