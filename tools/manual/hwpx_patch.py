"""한글 매뉴얼 – 사용자가 고친 파일을 기준으로, 고칠 곳만 바꿔요(사용자가 맞춘 간격·쪽 구성·그림은 그대로).

  python3 tools/manual/hwpx_patch.py <지킴이 빌드> <사용자.hwpx> <결과.hwpx> <짝 json 폴더> <설정.txt>

2026-10-29 14:07 사용자 "제안대로"(①1안 ②1안 ③1안 ④1안):
1. 글 바로잡기(REPLACE) – 글자 모양(자간을 줄인 것 포함)은 바뀐 글자 앞 글자 것을 이어 써요.
2. 버튼 표기 – 대괄호까지 회색 바탕(키와 같은 글자 모양). 남은 "[버튼]"·×·‹ › 도 같게, "[엑셀 ▾]"는 통째로.
   일괄 이름 바꾸기의 [n]·[c]·[ymd]·[p]·[e]는 패턴 글자라 그대로. 따옴표 메뉴 글은 그대로.
3. "1. 기획의도" → "1. 기획 의도"(탐색기에서 고친 대로 모든 장).
4. 설정 장만 새로 – 원고 txt로 다시 쓰고(모듈별 설정은 카드마다 "<카드 N>" 그림), 그 장 그림만 새로 찍어요.
   "2. 화면"은 처음 보이는 화면(1600×900), 상세 그림은 긴 장면(settings_full).
5. {붉은 글자} 칸 – 그 칸에 그림을 넣어요(지금은 탐색기 "라." 칸의 {보기창 버튼 위치} → 보기 버튼 둘레 그림).
"""
import asyncio
import io
import json
import os
import random
import re
import sys
import zipfile
from xml.sax.saxutils import escape, unescape

from PIL import Image
from playwright.async_api import async_playwright

import cap
import hwpx_pics as hp

REPLACE = [
    ("통화·회의·메일 등 업무상 대화를 발언자별로 일일 업무 기록 도구", "통화·회의·메일 등 업무상 대화를 발언자별로 기록하는 일일 업무 도구"),
    ("0319405705 → 031-940-5707", "0319405707 → 031-940-5707"),
    ("민원 내용 등는", "민원 내용 등은"),
    ("집행  - 이월", "집행 - 이월"),
    ("답변기한 도과방지", "답변기한 도과 방지"),
    ("조치 완료일을 직접 입력", "조치완료일을 직접 입력"),
    ("집행 현황에 해당 연도 자료가 없으면", "집행현황에 해당 연도 자료가 없으면"),
    ("당해 예산·집행액은 잠금", "당해예산·집행액은 잠금"),
    ("업무 연락처에 등록된 사람", "업무연락처에 등록된 사람"),
    ("자. 파일목록 :", "자. 파일 목록 :"),
    ("되돌리기는 이 앱에서 한", "되돌리기는 기록앱에서 한"),
    ("(앱 종료 시 기록 삭제)", "(기록앱 종료 시 기록 삭제)"),
    ("- 앱 재실행 시 상태 필터만", "- 기록앱 재실행 시 상태 필터만"),
    ("공휴일은 앱이 생성한 종류", "공휴일은 기록앱이 생성한 종류"),
    ("사. 장부 표 :", "사. 예산현황 표 :"),          # 상세 제목을 "예산현황 표"로 고치신 대로
]
PATTERN_TOKENS = {"[n]", "[c]", "[ymd]", "[p]", "[e]"}
SETTINGS_CHAP = 9          # 설정 = 10번째 장(0부터) – 상세 그림 틀 번호에 써요

site, src, out, mapdir, settings_txt = sys.argv[1:]
hp.load_extra(mapdir)
zin = zipfile.ZipFile(src)
sec = zin.read("Contents/section0.xml").decode("utf-8")
header = zin.read("Contents/header.xml").decode("utf-8")
hpf = zin.read("Contents/content.hpf").decode("utf-8")

PARA_RE = r"<hp:p [^>]*>.*?</hp:p>(?=<hp:p |</hs:sec>)"
paras = re.findall(PARA_RE, sec, re.S)
head_end = sec.index(paras[0])
tail = sec[sec.rindex("</hs:sec>"):]
assert "".join(paras) == sec[head_end:sec.rindex("</hs:sec>")]

# ---------- 글자 모양: 키 모양(굵게 + 연회색 바탕) ----------
cp_items = {m.group(1): m.group(0) for m in re.finditer(r'<hh:charPr id="(\d+)".*?</hh:charPr>', header, re.S)}
next_cp = max(int(k) for k in cp_items) + 1
new_cp, key_cache = [], {}


def is_key(cp):
    return 'shadeColor="#E8E8E8"' in cp_items.get(cp, "")


def norm(x):
    return re.sub(r'<hh:charPr id="\d+"', "", x)


def key_charpr(base):
    """base 글자 모양(자간 포함)에 굵게 + 연회색 바탕 – 같은 모양이 이미 있으면 그것을 써요."""
    global next_cp
    if is_key(base):
        return base
    if base in key_cache:
        return key_cache[base]
    x = re.sub(r'shadeColor="[^"]*"', 'shadeColor="#E8E8E8"', cp_items[base], count=1)
    if "<hh:bold/>" not in x:
        x = x.replace("<hh:underline", "<hh:bold/><hh:underline", 1)
    for k, v in cp_items.items():
        if norm(v) == norm(x):
            key_cache[base] = k
            return k
    x = re.sub(r'<hh:charPr id="\d+"', f'<hh:charPr id="{next_cp}"', x, count=1)
    cp_items[str(next_cp)] = x
    new_cp.append(x)
    key_cache[base] = str(next_cp)
    next_cp += 1
    return key_cache[base]


# ---------- 문단 글 다루기(글자마다 글자 모양) ----------
RUN = re.compile(r'<hp:run charPrIDRef="(\d+)"><hp:t>((?:(?!</hp:t>).)*)</hp:t></hp:run>', re.S)
RUNS = re.compile(r'(?:<hp:run charPrIDRef="\d+"><hp:t>(?:(?!</hp:t>).)*</hp:t></hp:run>)+', re.S)
SKIP_CP = {"7", "8", "10"}   # 화면 이름·구분 제목·상세 제목


def to_chars(runs_xml):
    chars = []
    for r in RUN.finditer(runs_xml):
        cp = r.group(1)
        for pc in re.split(r"(<hp:lineBreak/>|<hp:tab[^>]*/>)", r.group(2)):
            if pc.startswith("<hp:"):
                chars.append([pc, cp])
            else:
                chars += [[c, cp] for c in unescape(pc)]
    return chars


def from_chars(chars):
    out, cur, buf = [], None, ""
    for c, cp in chars:
        piece = c if c.startswith("<") else escape(c)
        if cur is not None and cp != cur:
            out.append((cur, buf))
            buf = ""
        cur = cp
        buf += piece
    if cur is not None:
        out.append((cur, buf))
    return "".join(f'<hp:run charPrIDRef="{k}"><hp:t>{t}</hp:t></hp:run>' for k, t in out)


def text_of(chars):
    return "".join(c if not c.startswith("<") else "\x00" for c, _ in chars)


MOD = r"(?:ctrl|shift|alt)"
KBASE = r"(?:f1[0-2]|f[1-9]|enter|esc|tab|space|backspace|delete|home|end|pageup|pagedown|[a-z]|\d(?:~\d)?|[↑↓←→])"
SOLO = r"(?:f1[0-2]|f[1-9]|enter|esc|tab|space|backspace|delete)"
TOKEN = re.compile(rf"(?<![A-Za-z0-9])(?:{MOD}(?:\+{MOD})*(?:\+{KBASE})?|{SOLO})(?![A-Za-z0-9])|[↑↓]", re.I)
CONT = re.compile(r"·([a-z])(?![A-Za-z0-9])", re.I)
NAMES = {"ctrl": "Ctrl", "shift": "Shift", "alt": "Alt", "enter": "Enter", "esc": "Esc", "tab": "Tab", "space": "Space",
         "backspace": "Backspace", "delete": "Delete", "home": "Home", "end": "End", "pageup": "PageUp", "pagedown": "PageDown"}


def canon(tok):
    out = []
    for part in tok.split("+"):
        low = part.lower()
        out.append(NAMES.get(low) or (low.upper() if re.fullmatch(r"f\d+", low) else (part.upper() if len(part) == 1 else part)))
    return "+".join(out)


def split_keys(text):
    """보통 글 → [(키인가, 글)] – 길이가 원문과 같게(대소문자만 바꿔요)."""
    res, last, pos = [], 0, 0
    while True:
        m = TOKEN.search(text, pos)
        if not m:
            break
        res.append((False, text[last:m.start()]))
        res.append((True, canon(m.group(0))))
        pos = last = m.end()
        if re.search(r"\+[A-Za-z]$", m.group(0)):
            while (c := CONT.match(text, pos)):
                res.append((False, "·"))
                res.append((True, c.group(1).upper()))
                pos = last = c.end()
    res.append((False, text[last:]))
    return [(k, x) for k, x in res if x]


def fix(chars):
    # 1) 글 바로잡기
    for old, new in REPLACE:
        t = text_of(chars)
        i = t.find(old)
        while i >= 0:
            cp = chars[i][1]
            chars[i:i + len(old)] = [[c, cp] for c in new]
            t = text_of(chars)
            i = t.find(old, i + len(new))
    t = text_of(chars)
    if t.strip() == "1. 기획의도":
        i = t.index("기획의도") + 2
        chars.insert(i, [" ", chars[i][1]])
        t = text_of(chars)
    # 키(F5·Ctrl+C·Enter…) – hwpx_build.py와 같은 규칙, 앱 표기로 바꿔 키 모양
    out, pos = [], 0
    for k, tok in split_keys(t):
        if k and not any(chars[pos + j][1] in SKIP_CP for j in range(len(tok))):
            base = chars[pos][1]
            kc = key_charpr(base)
            for j, ch in enumerate(tok):
                chars[pos + j] = [ch, kc]
        pos += len(tok)
    t = text_of(chars)
    # 2) 버튼 표기 – [ … ] 통째로 키 모양
    for m in re.finditer(r"\[[^\[\]\x00]{1,40}\]", t):
        if m.group(0) in PATTERN_TOKENS or any(chars[j][1] in SKIP_CP for j in range(m.start(), m.end())):
            continue
        base = next((chars[j][1] for j in range(m.start(), m.end()) if not is_key(chars[j][1])), chars[m.start()][1])
        if is_key(base):
            base = chars[m.start()][1]
        kc = key_charpr(base)
        for j in range(m.start(), m.end()):
            chars[j][1] = kc
    # ×(닫기·지우기 단추, 2×2 같은 숫자 사이는 빼요) · ‹ › 단추
    for j, (c, cp) in enumerate(chars):
        if cp in SKIP_CP or is_key(cp):
            continue
        if c == "×" and not ((j and t[j - 1].isdigit()) or (j + 1 < len(t) and t[j + 1].isdigit())):
            chars[j][1] = key_charpr(cp)
        elif c == "‹":
            chars[j][1] = key_charpr(cp)
        elif c == "›":
            # 단추일 때만(‹ › · "› 를 클릭" · "› 버튼") – "세부사업 › 연도 › 재원" 같은 위계 표시는 그대로
            before = t[:j].rstrip()
            after = t[j + 1:].lstrip()
            if before.endswith("‹") or after.startswith(("를", "버튼", "로")) or not after:
                chars[j][1] = key_charpr(cp)
    return chars


def patch_para(p):
    def sub(m):
        chars = to_chars(m.group(0))
        before = [list(x) for x in chars]
        chars = fix(chars)
        return from_chars(chars) if chars != before else m.group(0)
    q = RUNS.sub(sub, p)
    if q != p:
        q = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", q, flags=re.S)
    return q


# ---------- 설정 장 다시 쓰기 ----------
title_idx = [i for i, p in enumerate(paras) if re.search(r'<hp:run charPrIDRef="7"><hp:t>[^<]', p)]
set_start = next(i for i in title_idx if "<hp:t>설정</hp:t>" in paras[i])
settings_old = paras[set_start:]
frames_old = [p for p in settings_old if "<hp:tbl" in p]
FRAME_SCREEN = frames_old[0]
FRAME_DETAIL = next(p for p in paras if re.search(r'<hp:tbl id="19\d{8}"', p))

pp_items = {m.group(1): m.group(0) for m in re.finditer(r'<hh:paraPr id="(\d+)".*?</hh:paraPr>', header, re.S)}


new_pp = []
next_pp = max(int(k) for k in pp_items) + 1


def find_hang(v, like="24"):
    """그 내어쓰기 값의 문단 모양 – 없으면(한글이 안 쓰는 모양을 지움) like를 본떠 새로."""
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


PP = {"o": find_hang(4600, "23"), "1": find_hang(5750), "10": find_hang(6465), "-": find_hang(6450, "25")}
header = header.replace("</hh:paraProperties>", "".join(new_pp) + "</hh:paraProperties>", 1)
header = re.sub(r'(<hh:paraProperties itemCnt=")(\d+)', lambda m: m.group(1) + str(int(m.group(2)) + len(new_pp)), header, count=1)
used_ids = set(re.findall(r'<hp:tbl id="(\d+)"', sec))


def frame(tpl, nid=None):
    nid = nid or str(random.randint(1_000_000_000, 1_800_000_000))
    while nid in used_ids and not nid.startswith("19"):
        nid = str(random.randint(1_000_000_000, 1_800_000_000))
    used_ids.add(nid)
    # 옛 그림은 빼고 빈 칸으로(그림은 아래에서 새로 넣어요)
    t = re.sub(r'(<hp:tbl id=")\d+(")', lambda m: m.group(1) + nid + m.group(2), tpl, count=1)
    return re.sub(r"<hp:pic .*?</hp:pic>", "", t, flags=re.S)


def tx(text):
    return "<hp:lineBreak/>".join(escape(x) for x in text.split("\n"))


def P(text, pp, cp, page_break=False):
    pb = "1" if page_break else "0"
    run = f'<hp:run charPrIDRef="{cp}"><hp:t>{tx(text)}</hp:t></hp:run>' if text else f'<hp:run charPrIDRef="{cp}"/>'
    return f'<hp:p id="0" paraPrIDRef="{pp}" styleIDRef="0" pageBreak="{pb}" columnBreak="0" merged="0">{run}</hp:p>'


def line(t):
    s = t.strip()
    if s.startswith("○"):
        return P("    ○ " + s[1:].strip(), PP["o"], "9")
    if s.startswith("-"):
        return P("        - " + s[1:].strip(), PP["-"], "9")
    return P("      " + s, PP["10"] if re.match(r"^\d\d\)", s) else PP["1"], "9")


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


LABELS = hp.LABELS
BASE = hp.CROP_BASE + SETTINGS_CHAP * 1000
b = blocks(settings_txt)
gen = [P(b["화면"][0].strip(), "0", "7", page_break=True), P(b["부제목"][0].strip(), "0", "10"), P("", "0", "10"),
       P("1. 기획 의도", "0", "10")]
for i, x in enumerate(b["기획의도"]):
    gen.append(P("  " + x.strip(), {0: "20", 1: "21"}.get(i, "22"), "9"))
gen += [P("", "22", "9"), P("2. 화면", "0", "10"), frame(FRAME_SCREEN), P("", "0", "10"), P("3. 기능별 설명", "0", "10")]
gen += [P("  " + x.strip(), "20", "9") for x in b["기능별"]]
gen += [P("", "20", "9"), P("4. 상세설명", "0", "10")]
first = True
for ln in b["상세"]:
    t = ln.strip()
    if t.startswith("#"):
        if not first:
            gen.append(P("", "25", "9"))
        first = False
        gen.append(P("  " + t[1:].strip(), "0", "8"))
        gen.append(frame(FRAME_DETAIL, str(BASE + LABELS.index(t[1]))))
    elif m := re.match(r"<카드 (\d+)>", t):
        gen.append(frame(FRAME_DETAIL, str(BASE + 100 + int(m.group(1)))))
    elif t.startswith("<그림"):
        gen.append(frame(FRAME_DETAIL))
    else:
        gen.append(line(t))
gen.append(P("", "25", "9"))

new_paras = [patch_para(p) for p in paras[:set_start] + gen]

# ---------- 그림 ----------
mp = json.load(open(os.path.join(mapdir, "map_settings.json"), encoding="utf-8"))
xmap = json.load(open(os.path.join(mapdir, "map_explorer.json"), encoding="utf-8"))
pngdir = os.path.splitext(out)[0] + "_pics"
os.makedirs(pngdir, exist_ok=True)
crop_labels = [t[1] for t in (x.strip() for x in b["상세"]) if t.startswith("#")]
cards = mp.get("cards", [])


async def shoot():
    srv, port = cap.serve(site)
    url = f"http://127.0.0.1:{port}/"
    miss = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        miss += await hp.screen_png(br, url, mp, os.path.join(pngdir, "settings_00.png"))
        labels = crop_labels + ["@" + s for s in cards]
        outs = [os.path.join(pngdir, f"settings_c{lb}.png") for lb in crop_labels] + \
               [os.path.join(pngdir, f"settings_card{k}.png") for k in range(1, len(cards) + 1)]
        miss += await hp.crop_pngs(br, url, mp, labels, outs)
        # {보기창 버튼 위치}: 탐색기 보기 버튼 둘레(라. 드라이브 번호)
        miss += await hp.crop_pngs(br, url, {"scene": xmap["scene"], "feats": [{"label": "라", "sel": "button.fx-vb"}]},
                                   ["라"], [os.path.join(pngdir, "explorer_viewbtn.png")])
        await br.close()
    srv.shutdown()
    return miss


missing = asyncio.run(shoot())
header, center = hp.add_center_para(header)
items = []
n = [0]


def bin_id():
    n[0] += 1
    return f"patch{n[0]:03d}"


def fill_frames(p):
    m = re.search(r'<hp:tbl id="(\d+)"', p)
    if not m:
        return p
    tid = int(m.group(1))
    if p is not None and "<hp:pic " in p:
        return p                                 # 사용자 그림은 그대로
    if tid >= BASE + 100 and tid < BASE + 200:
        png, scale, mh = os.path.join(pngdir, f"settings_card{tid - BASE - 100}.png"), hp.PX, None
    elif BASE <= tid < BASE + 100:
        png, scale, mh = os.path.join(pngdir, f"settings_c{LABELS[tid - BASE]}.png"), hp.PX, hp.CROP_MAX_H
    else:
        png, scale, mh = os.path.join(pngdir, "settings_00.png"), None, None
    bid = bin_id()
    items.append((bid, png))
    t = re.search(r"<hp:tbl .*?</hp:tbl>", p, re.S)
    q = p[:t.start()] + hp.fill(t.group(0), png, bid, center, scale, mh) + p[t.end():]
    return re.sub(r"(</hp:tbl><hp:t/></hp:run>)<hp:linesegarray>.*?</hp:linesegarray>", r"\1", q, flags=re.S)


gen_start = set_start
new_paras = new_paras[:gen_start] + [fill_frames(p) for p in new_paras[gen_start:]]


def red_cell(p):
    """{…} 붉은 글자가 든 표 칸 → 그 칸에 그림(칸 크기 안에 맞춰요)."""
    if "{보기창 버튼 위치}" not in p:
        return p
    m = re.search(r'(<hp:tc [^>]*>)(<hp:subList [^>]*>)(<hp:p [^>]*>).*?\{보기창 버튼 위치\}.*?</hp:p>(</hp:subList>.*?<hp:cellSz width="(\d+)" height="(\d+)"/>)', p, re.S)
    cw, ch = int(m.group(5)), int(m.group(6))
    mg = re.search(r'<hp:inMargin left="(\d+)" right="(\d+)" top="(\d+)" bottom="(\d+)"/>', p)
    ml, mr, mt, mb = (int(x) for x in mg.groups())
    png = os.path.join(pngdir, "explorer_viewbtn.png")
    im = Image.open(png)
    pw, ph = im.size
    w = cw - ml - mr
    h = round(w * ph / pw)
    if h > ch - mt - mb:
        h = ch - mt - mb
        w = round(h * pw / ph)
    bid = bin_id()
    items.append((bid, png))
    pic = hp.PIC.format(id=random.randint(1_000_000_000, 1_800_000_000), z=random.randint(2, 900), w=w, h=h, cx=w // 2, cy=h // 2,
                        pw=pw * 75, ph=ph * 75, bin=bid)
    cellp = re.sub(r'paraPrIDRef="\d+"', f'paraPrIDRef="{center}"', m.group(3), count=1)
    return p[:m.start(3)] + cellp + f'<hp:run charPrIDRef="9">{pic}<hp:t/></hp:run></hp:p>' + p[m.start(4):]


new_paras = [red_cell(p) for p in new_paras]

sec2 = sec[:head_end] + "".join(new_paras) + tail
header = header.replace("</hh:charProperties>", "".join(new_cp) + "</hh:charProperties>", 1)
header = re.sub(r'(<hh:charProperties itemCnt=")\d+', lambda m: m.group(1) + str(next_cp), header, count=1)
refs = set(re.findall(r'binaryItemIDRef="([^"]+)"', sec2))
hpf = re.sub(r'<opf:item [^>]*href="BinData/[^"]*"[^>]*/>',
             lambda m: m.group(0) if re.search(r'id="([^"]+)"', m.group(0)).group(1) in refs else "", hpf)
hpf = hpf.replace("</opf:manifest>", "".join(f'<opf:item id="{b}" href="BinData/{b}.png" media-type="image/png" isEmbeded="1"/>'
                                               for b, _ in items) + "</opf:manifest>", 1)
with zipfile.ZipFile(out, "w") as zout:
    for it in zin.infolist():
        if it.filename.startswith("BinData/") and os.path.splitext(os.path.basename(it.filename))[0] not in refs:
            continue                              # 바꾼 설정 장의 옛 그림
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
print(f"만듦 {out} ({os.path.getsize(out) // 1024}KB) · 설정 문단 {len(settings_old)} → {len(gen)} · 새 그림 {len(items)}")
if missing:
    print("못 찾은 요소:", missing)
