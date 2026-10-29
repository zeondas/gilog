"""한글 매뉴얼 – 사용자 수정본(탐색기 장) + 원고(나머지 장) → 글이 든 hwpx (그림은 hwpx_pics.py가 채워요).

  python3 tools/manual/hwpx_build.py <사용자 수정본.hwpx> <결과.hwpx> <탐색기 고침.py> <화면.txt ...>

1. 사용자 수정본의 탐색기 장(첫 쪽 ~ 다음 장 제목 앞)은 사용자 문단 모양·글자 모양·줄 바꿈을 그대로 두고,
   탐색기 고침 파일(OPS)의 문단만 글을 바꾸거나 뒤에 문단을 더해요.
2. 나머지 장은 원고 txt(@화면·@부제목·@기획의도·@기능별·@상세)를 사용자 양식으로 이어 붙여요.
3. 모든 문단의 키보드 키(F5·Ctrl+C·Enter·Esc …)를 앱 표기로 바꾸고 굵게 + 연회색 바탕(키 모양)으로 칠해요.
4. 내어쓰기: 줄 머리(○ · 1) · 10) · -) 폭만큼 내어 써서 둘째 줄이 글 시작에 맞아요(맑은 고딕 13pt 기준 잰 값).
5. 옛 그림(BinData)은 빼요 – 틀은 그대로 두고 hwpx_pics.py가 새로 채워요.
"""
import importlib.util
import random
import re
import sys
import zipfile
from xml.sax.saxutils import escape, unescape

# 맑은 고딕 13pt에서 줄 머리 폭(HWPUNIT) – 사용자가 손으로 맞춘 내어쓰기 값에서 구함(띄어쓰기 ≈ 658, ○ ≈ 1310, 숫자 ≈ 715, ")" ≈ 430, "-" ≈ 528)
HANG = {"o": 4600, "1": 5750, "10": 6465, "-": 6450}
KEY_SHADE = "#E8E8E8"

src, out, edits_py, *chapters = sys.argv[1:]
zin = zipfile.ZipFile(src)
sec = zin.read("Contents/section0.xml").decode("utf-8")
header = zin.read("Contents/header.xml").decode("utf-8")
hpf = zin.read("Contents/content.hpf").decode("utf-8")

PARA_RE = r"<hp:p [^>]*>.*?</hp:p>(?=<hp:p |</hs:sec>)"
paras = re.findall(PARA_RE, sec, re.S)
head_end = sec.index(paras[0])
tail = sec[sec.rindex("</hs:sec>"):]


def ptext(p):
    q = re.sub(r"<hp:tbl.*?</hp:tbl>", "", p, flags=re.S)
    return "".join(re.findall(r"<hp:t>(.*?)</hp:t>", q, re.S)).replace("<hp:lineBreak/>", "\n")


# 탐색기 장 = 처음 ~ 두 번째 "화면 이름"(글자 모양 7) 문단 앞
title_cp = re.search(r'<hp:run charPrIDRef="(\d+)"><hp:t>', paras[0]).group(1)
end = next(i for i, p in enumerate(paras) if i > 0 and f'<hp:run charPrIDRef="{title_cp}"><hp:t>' in p)
explorer = paras[:end]
FRAME_SCREEN = next(p for p in explorer if "<hp:tbl" in p)
FRAME_DETAIL = [p for p in explorer if "<hp:tbl" in p][1]

# ---------- 문단 모양: 내어쓰기 ----------
pp_items = {m.group(1): m.group(0) for m in re.finditer(r'<hh:paraPr id="(\d+)".*?</hh:paraPr>', header, re.S)}
next_pp = max(int(k) for k in pp_items) + 1
new_pp = []


def add_hang(base_id, hang):
    global next_pp
    x = pp_items[base_id]
    x = re.sub(r'<hh:paraPr id="\d+"', f'<hh:paraPr id="{next_pp}"', x, count=1)
    parts = x.split("<hp:default>")
    parts[0] = re.sub(r'<hc:intent value="-?\d+"', f'<hc:intent value="-{hang}"', parts[0])
    if len(parts) > 1:
        parts[1] = re.sub(r'<hc:intent value="-?\d+"', f'<hc:intent value="-{hang * 2}"', parts[1])
    new_pp.append("<hp:default>".join(parts))
    next_pp += 1
    return str(next_pp - 1)


PP = {"o": add_hang("23", HANG["o"]), "1": add_hang("24", HANG["1"]), "10": add_hang("24", HANG["10"]), "-": add_hang("25", HANG["-"])}


def pp_for(t):
    s = t.strip()
    if s.startswith("○"):
        return PP["o"]
    if re.match(r"^\d\d\)", s):
        return PP["10"]
    if s.startswith("-"):
        return PP["-"]
    return PP["1"]


# ---------- 문단 만들기 ----------
used_ids = set(re.findall(r'<hp:tbl id="(\d+)"', sec))


CROP_BASE = 1_900_000_000   # 상세설명 제목 아래 "그 부분" 그림 틀 번호 = CROP_BASE + 장 차례×1000 + 가나다 차례(hwpx_pics.py가 읽어요)
LABELS = "가나다라마바사아자차카타파하"


def frame(tpl, nid=None):
    nid = nid or str(random.randint(1_000_000_000, 1_800_000_000))
    while nid in used_ids:
        nid = str(random.randint(1_000_000_000, 1_800_000_000))
    used_ids.add(nid)
    return re.sub(r'(<hp:tbl id=")\d+(")', lambda m: m.group(1) + nid + m.group(2), tpl, count=1)


def tx(text):
    return "<hp:lineBreak/>".join(escape(x) for x in text.split("\n"))


def P(text, pp, cp, page_break=False):
    pb = "1" if page_break else "0"
    run = f'<hp:run charPrIDRef="{cp}"><hp:t>{tx(text)}</hp:t></hp:run>' if text else f'<hp:run charPrIDRef="{cp}"/>'
    return f'<hp:p id="0" paraPrIDRef="{pp}" styleIDRef="0" pageBreak="{pb}" columnBreak="0" merged="0">{run}</hp:p>'


TITLE, H, DH, BODY = ("0", "7"), ("0", "10"), ("0", "8"), "9"
ITEM_PP = {0: "20", 1: "21", 2: "22"}
BLANK = ("25", "9")


def line(t):
    """○ / 1) / - 줄 → 사용자 앞 공백 규칙(○ 4칸 · 1) 6칸 · - 8칸) + 내어쓰기 문단."""
    s = t.strip()
    if s.startswith("○"):
        txt = "    ○ " + s[1:].strip()
    elif s.startswith("-"):
        txt = "        - " + s[1:].strip()
    else:
        txt = "      " + s
    return P(txt, pp_for(s), BODY)


def detail(lines):
    out = []
    first = True
    for ln in lines:
        t = ln.strip()
        if not t:
            continue
        if t.startswith("#"):
            if not first and out[-1] != P("", *BLANK) and "<hp:tbl" not in out[-1]:
                out.append(P("", *BLANK))
            first = False
            out.append(P("  " + t[1:].strip(), *DH))
        elif t.startswith("<그림"):
            out.append(frame(FRAME_DETAIL))
            out.append(P("", *BLANK))
        else:
            out.append(line(t))
    if out and out[-1] != P("", *BLANK):
        out.append(P("", *BLANK))
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


# ---------- 1) 탐색기 장: 사용자 문단 + 고침 ----------
spec = importlib.util.spec_from_file_location("edits", edits_py)
ed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ed)


def set_text(p, text):
    """문단 모양은 두고 글만 바꿔요(글자 모양은 보통 본문 – 글이 바뀌어 사용자가 줄인 자간은 풀어요)."""
    head = re.match(r"<hp:p [^>]*>", p).group(0)
    return head + f'<hp:run charPrIDRef="{BODY}"><hp:t>{tx(text)}</hp:t></hp:run></hp:p>'


new = list(explorer)
after = {}
for op in ed.OPS:
    kind, i, text = op
    want = ed.EXPECT.get(i)
    if want is not None and not ptext(explorer[i]).strip().startswith(want):
        sys.exit(f"탐색기 문단 {i} 글이 예상과 달라요: {ptext(explorer[i])[:40]!r}")
    if kind == "set":
        new[i] = set_text(explorer[i], text)
    elif kind == "after":
        after.setdefault(i, []).append(line(text))
merged = []
for i, p in enumerate(new):
    merged.append(p)
    merged += after.get(i, [])

# ---------- 2) 나머지 장 ----------
for path in chapters:
    b = blocks(path)
    merged.append(P(b["화면"][0].strip(), *TITLE, page_break=True))
    merged.append(P(b["부제목"][0].strip(), *H))
    merged.append(P("", *H))
    merged.append(P("1. 기획의도", *H))
    for i, x in enumerate(b["기획의도"]):
        merged.append(P("  " + x.strip(), ITEM_PP.get(i, "22"), BODY))
    merged.append(P("", "22", BODY))
    merged.append(P("2. 화면", *H))
    merged.append(frame(FRAME_SCREEN))
    merged.append(P("", *H))
    merged.append(P("3. 기능별 설명", *H))
    for x in b["기능별"]:
        merged.append(P("  " + x.strip(), "20", BODY))
    merged.append(P("", "20", BODY))
    merged.append(P("4. 상세설명", *H))
    merged += detail(b["상세"])

# ---------- 2-1) 상세설명 제목마다 "그 부분" 그림 틀(2026-10-29 12:33 사용자 – 앞장 화면을 다시 보지 않게) ----------
withcrop, chap = [], -1
for p in merged:
    withcrop.append(p)
    if f'<hp:run charPrIDRef="{title_cp}"><hp:t>' in p:
        chap += 1
        continue
    m = re.match(r'<hp:p [^>]*><hp:run charPrIDRef="8"><hp:t>\s*([가-하])\.', p)
    if m and m.group(1) in LABELS:
        withcrop.append(frame(FRAME_DETAIL, str(CROP_BASE + chap * 1000 + LABELS.index(m.group(1)))))
merged = withcrop

# ---------- 3) 키 표기 ----------
MOD = r"(?:ctrl|shift|alt)"
BASE = r"(?:f1[0-2]|f[1-9]|enter|esc|tab|space|backspace|delete|home|end|pageup|pagedown|[a-z]|\d(?:~\d)?|[↑↓←→])"
SOLO = r"(?:f1[0-2]|f[1-9]|enter|esc|tab|space|backspace|delete)"
TOKEN = re.compile(rf"(?<![A-Za-z0-9])(?:{MOD}(?:\+{MOD})*(?:\+{BASE})?|{SOLO})(?![A-Za-z0-9])|[↑↓]", re.I)
CONT = re.compile(r"·([a-z])(?![A-Za-z0-9])", re.I)
NAMES = {"ctrl": "Ctrl", "shift": "Shift", "alt": "Alt", "enter": "Enter", "esc": "Esc", "tab": "Tab", "space": "Space",
         "backspace": "Backspace", "delete": "Delete", "home": "Home", "end": "End", "pageup": "PageUp", "pagedown": "PageDown"}
found = {}


def canon(tok):
    out = []
    for part in tok.split("+"):
        low = part.lower()
        if low in NAMES:
            out.append(NAMES[low])
        elif re.fullmatch(r"f\d+", low):
            out.append(low.upper())
        else:
            out.append(part.upper() if len(part) == 1 else part)
    return "+".join(out)


def split_keys(text):
    """보통 글 → [(is_key, 글)]."""
    res, last, pos = [], 0, 0
    while True:
        m = TOKEN.search(text, pos)
        if not m:
            break
        res.append((False, text[last:m.start()]))
        tok = canon(m.group(0))
        res.append((True, tok))
        found[tok] = found.get(tok, 0) + 1
        pos = last = m.end()
        if re.search(r"\+[A-Za-z]$", m.group(0)):   # Ctrl+C·X·V
            while True:
                c = CONT.match(text, pos)
                if not c:
                    break
                res.append((False, "·"))
                res.append((True, c.group(1).upper()))
                pos = last = c.end()
    res.append((False, text[last:]))
    return [(k, t) for k, t in res if t]


cp_items = {m.group(1): m.group(0) for m in re.finditer(r'<hh:charPr id="(\d+)".*?</hh:charPr>', header, re.S)}
next_cp = max(int(k) for k in cp_items) + 1
key_cp, new_cp = {}, []


def key_charpr(base):
    global next_cp
    if base not in key_cp:
        x = re.sub(r'<hh:charPr id="\d+"', f'<hh:charPr id="{next_cp}"', cp_items[base], count=1)
        x = re.sub(r'shadeColor="[^"]*"', f'shadeColor="{KEY_SHADE}"', x, count=1)
        if "<hh:bold/>" not in x:
            x = x.replace("<hh:underline", "<hh:bold/><hh:underline", 1)
        new_cp.append(x)
        key_cp[base] = str(next_cp)
        next_cp += 1
    return key_cp[base]


RUN = re.compile(r'<hp:run charPrIDRef="(\d+)"><hp:t>((?:(?!</hp:t>).)*)</hp:t></hp:run>', re.S)
RUNS = re.compile(r'(?:<hp:run charPrIDRef="\d+"><hp:t>(?:(?!</hp:t>).)*</hp:t></hp:run>)+', re.S)
SKIP_CP = {"7", "10", "8"}          # 제목·구분·상세 제목은 그대로


def style_runs(m):
    """붙어 있는 글 묶음(사용자가 자간을 나눠 준 묶음 포함)을 한 글로 보고 키를 찾아, 글자마다 원래 글자 모양을 지켜 다시 나눠요."""
    chars = []                       # (글자 또는 태그, 글자 모양)
    for r in RUN.finditer(m.group(0)):
        cp = r.group(1)
        for pc in re.split(r"(<hp:lineBreak/>|<hp:tab[^>]*/>)", r.group(2)):
            if pc.startswith("<hp:"):
                chars.append((pc, cp))
            else:
                chars += [(c, cp) for c in unescape(pc)]
    text = "".join(c if not c.startswith("<") else "\x00" for c, _ in chars)
    keyed = [False] * len(chars)
    repl = {}
    pos = 0
    for k, t in split_keys(text):
        if k:
            if any(chars[i][1] in SKIP_CP for i in range(pos, pos + len(t))):
                pass
            else:
                for j in range(len(t)):
                    keyed[pos + j] = key_charpr(chars[pos][1])   # 한 키는 첫 글자의 글자 모양 하나로
                    repl[pos + j] = t[j]
        pos += len(t)
    if not any(keyed) and all(repl.get(i, c) == c for i, (c, _) in enumerate(chars)):
        return m.group(0)
    out, cur, buf = [], None, ""
    for i, (c, cp) in enumerate(chars):
        k = keyed[i] or cp
        piece = c if c.startswith("<") else escape(repl.get(i, c))
        if cur is not None and k != cur:
            out.append((cur, buf))
            buf = ""
        cur = k
        buf += piece
    if cur is not None:
        out.append((cur, buf))
    return "".join(f'<hp:run charPrIDRef="{k}"><hp:t>{t}</hp:t></hp:run>' for k, t in out)


styled = []
for p in merged:
    q = RUNS.sub(style_runs, p)
    if q != p:
        q = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", q, flags=re.S)
    styled.append(q)

sec2 = sec[:head_end] + "".join(styled) + tail

header = header.replace("</hh:paraProperties>", "".join(new_pp) + "</hh:paraProperties>", 1)
header = re.sub(r'(<hh:paraProperties itemCnt=")\d+', lambda m: m.group(1) + str(next_pp), header, count=1)
header = header.replace("</hh:charProperties>", "".join(new_cp) + "</hh:charProperties>", 1)
header = re.sub(r'(<hh:charProperties itemCnt=")\d+', lambda m: m.group(1) + str(next_cp), header, count=1)
hpf = re.sub(r'<opf:item [^>]*href="BinData/[^"]*"[^>]*/>', "", hpf)   # 옛 그림(한글이 image1… 로 이름을 바꿔 둔 것까지)

with zipfile.ZipFile(out, "w") as zout:
    for item in zin.infolist():
        if item.filename.startswith("BinData/"):
            continue
        data = zin.read(item.filename)
        if item.filename == "Contents/section0.xml":
            data = sec2.encode("utf-8")
        elif item.filename == "Contents/header.xml":
            data = header.encode("utf-8")
        elif item.filename == "Contents/content.hpf":
            data = hpf.encode("utf-8")
        elif item.filename == "Preview/PrvText.txt":
            data = "\n".join(re.sub(r"<[^>]+>", "", t) for t in re.findall(r"<hp:t>(.*?)</hp:t>", sec2))[:1024].encode("utf-8")
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time)
        zi.compress_type = zipfile.ZIP_STORED if item.filename == "mimetype" else zipfile.ZIP_DEFLATED
        zi.external_attr = item.external_attr
        zout.writestr(zi, data)
print(f"탐색기 문단 {len(explorer)} → {len(new) + sum(len(v) for v in after.values())}, 전체 {len(styled)}, 틀 {sec2.count('<hp:tbl ')}")
print("키:", " ".join(f"{k}×{v}" for k, v in sorted(found.items(), key=lambda x: -x[1])))
