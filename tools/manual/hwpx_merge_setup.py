"""준비 안내서(사용자 수정본)를 매뉴얼 원본(사용자 수정본, 꾸밈 전)에 합쳐요 – 2026-10-29 21:41 사용자 "제안대로, 합본".

  python3 tools/manual/hwpx_merge_setup.py <매뉴얼 원본.hwpx> <안내서.hwpx> <결과(꾸밈 전).hwpx> <띠 범위.txt>

- 안내서 첫 장(준비가 필요한 기능·용어 풀이·사람별 할 일) → "프로그램 개요" 끝에 7.~9.
- 민원처리 준비 → 민원처리 장 끝, 구글 캘린더 연동 준비 → 캘린더 장 끝, 집행현황 팀 공유 준비 → 집행현황 장 끝.
  새 쪽에서 "○○ 준비" 큰 제목(장 제목과 같은 모양, 다른 글자 모양 번호 – 장으로 세지 않게) + 5.~8.
  사용자가 맞춘 쪽 나눔(빈 줄)을 그대로 두려고 안내서 문단은 글자 그대로 옮기고, 절 번호·서로 가리키는 곳만 고쳐요.
- 글자·문단·테두리 모양 번호는 내용이 같으면 매뉴얼 것을 쓰고, 없으면 매뉴얼 머리에 더해요.
- 띠 범위.txt: 옮겨 온 문단(맨 위 문단 번호 범위) – hwpx_design.py가 이 문단마다 색인 띠를 달아요(쪽 시작을 미리 모르니).
"""
import re
import sys
import zipfile
import random

sys.path.insert(0, __import__("os").path.dirname(__file__))
from hwpx_toplevel import top_paras  # noqa: E402

src_m, src_s, out, band_out = sys.argv[1:5]
ZM, ZS = zipfile.ZipFile(src_m), zipfile.ZipFile(src_s)
HM = ZM.read("Contents/header.xml").decode()
HS = ZS.read("Contents/header.xml").decode()
SM = ZM.read("Contents/section0.xml").decode()
SS = ZS.read("Contents/section0.xml").decode()
PM, PS = ZM.read("Contents/content.hpf").decode(), ZS.read("Contents/content.hpf").decode()


def items(h, tag):
    return {m.group(1): m.group(0) for m in re.finditer(rf'<hh:{tag} id="(\d+)".*?</hh:{tag}>', h, re.S)}


def norm(x):
    # 새 한글은 문단 모양에 textDir="LTR"을 붙여 저장해요(뜻은 같음)
    return re.sub(r'^(<hh:\w+) id="\d+"', r"\1", x).replace(' textDir="LTR"', "")


def merge(tag, group, fix=lambda x: x):
    """안내서 머리의 tag 항목을 매뉴얼 머리에 맞춰 {안내서 번호: 매뉴얼 번호}로."""
    global HM
    have = items(HM, tag)
    by = {norm(v): k for k, v in have.items()}
    nid = max(int(k) for k in have) + 1
    mp, add = {}, []
    for k, v in items(HS, tag).items():
        v = fix(v)
        if norm(v) in by:
            mp[k] = by[norm(v)]
        else:
            nv = re.sub(r'^(<hh:\w+) id="\d+"', rf'\1 id="{nid}"', v)
            add.append(nv)
            by[norm(v)] = str(nid)
            mp[k] = str(nid)
            nid += 1
    if add:
        HM = HM.replace(f"</hh:{group}>", "".join(add) + f"</hh:{group}>", 1)
        HM = re.sub(rf'(<hh:{group} itemCnt=")(\d+)', lambda m: m.group(1) + str(int(m.group(2)) + len(add)), HM, count=1)
    return mp, len(add)


def sub_ref(x, attr, mp):
    return re.sub(rf'{attr}="(\d+)"', lambda m: f'{attr}="{mp.get(m.group(1), m.group(1))}"', x)


BF, nbf = merge("borderFill", "borderFills")
TB, ntb = merge("tabPr", "tabProperties")
CP, ncp = merge("charPr", "charProperties", lambda v: sub_ref(v, "borderFillIDRef", BF))
PP, npp = merge("paraPr", "paraProperties", lambda v: sub_ref(sub_ref(v, "tabPrIDRef", TB), "borderFillIDRef", BF))
# 준비 편 큰 제목: 장 제목(7)과 같은 모양, 다른 번호
cps = items(HM, "charPr")
TITLE = str(max(int(k) for k in cps) + 1)
HM = HM.replace("</hh:charProperties>", re.sub(r'id="7"', f'id="{TITLE}"', cps["7"], count=1) + "</hh:charProperties>", 1)
HM = re.sub(r'(<hh:charProperties itemCnt=")(\d+)', lambda m: m.group(1) + str(int(m.group(2)) + 1), HM, count=1)
print(f"머리 더함: 테두리 {nbf} · 탭 {ntb} · 글자 {ncp} · 문단 {npp} · 준비 제목 글자 {TITLE}")

# ---------- 그림 ----------
n0 = max(int(x) for x in re.findall(r'id="image(\d+)"', PM)) + 100
IMG, bins = {}, []
for m in re.finditer(r'<opf:item id="(image\d+)" href="BinData/([^"]+)"[^>]*/>', PS):
    old, fn = m.group(1), m.group(2)
    new = f"image{n0 + len(IMG)}"
    ext = fn.rsplit(".", 1)[1]
    IMG[old] = new
    bins.append((f"BinData/{fn}", f"BinData/{new}.{ext}",
                 m.group(0).replace(f'id="{old}"', f'id="{new}"').replace(f"BinData/{fn}", f"BinData/{new}.{ext}")))

used_ids = set(re.findall(r'\bid="(\d{6,})"', SM)) | set(re.findall(r'instid="(\d+)"', SM))


def remap(p):
    p = sub_ref(p, "charPrIDRef", CP)
    p = sub_ref(p, "paraPrIDRef", PP)
    p = sub_ref(p, "borderFillIDRef", BF)
    p = re.sub(r'binaryItemIDRef="(image\d+)"', lambda m: f'binaryItemIDRef="{IMG[m.group(1)]}"', p)

    def fresh(m):
        v = m.group(2)
        if v in used_ids:
            v = str(random.randint(1_000_000_000, 2_000_000_000))
            while v in used_ids:
                v = str(random.randint(1_000_000_000, 2_000_000_000))
        used_ids.add(v)
        return f'{m.group(1)}="{v}"'
    return re.sub(r'\b(id|instid)="(\d{6,})"', fresh, p)


PSs = top_paras(SS)
U = [SS[a:b] for a, b in PSs]


def text(p):
    q = re.sub(r"<hp:tbl\b.*?</hp:tbl>", "", p, flags=re.S)
    return "".join(re.findall(r"<hp:t>(.*?)</hp:t>", q, re.S))


def find(pred):
    r = [i for i, p in enumerate(U) if pred(p)]
    assert len(r) == 1, r
    return r[0]


def rep(i, old, new):
    assert U[i].count(old) == 1, (i, old, text(U[i])[:80])
    U[i] = U[i].replace(old, new)


titles = [i for i, p in enumerate(U) if 'pageBreak="1"' in p[:200] and 'charPrIDRef="7"' in p]
assert [text(U[i]) for i in titles] == ["민원처리 준비", "구글 캘린더 연동 준비", "집행현황 팀 공유 준비"], [text(U[i]) for i in titles]
T_PROC, T_CAL, T_TEAM = titles

# 절 번호: 1.~4. → 5.~8.
# 글 길이를 바꾸지 않아요 – 줄 수가 늘면 사용자가 빈 줄로 맞춘 쪽 나눔이 밀려요
HEAD = {"1. 준비가 필요한 이유": "5. 준비가 필요한 이유", "2. 화면": "6. 화면", "3. 준비 항목": "7. 준비 항목", "4. 상세설명": "8. 상세설명"}
for i in range(T_PROC, len(U)):
    t = text(U[i])
    if t in HEAD and 'charPrIDRef="10"' in U[i]:
        rep(i, f"<hp:t>{t}</hp:t>", f"<hp:t>{HEAD[t]}</hp:t>")
assert sum(text(U[i]) in HEAD.values() and 'charPrIDRef="10"' in U[i] for i in range(len(U))) == 12

# 서로 가리키는 곳
rep(find(lambda p: "(2. 화면의 폴더 칸)" in p), "(2. 화면의 폴더 칸)", "(6. 화면의 폴더 칸)")
for i in [i for i in range(T_CAL, len(U)) if "(2. 화면)" in U[i]]:
    rep(i, "(2. 화면)", "(6. 화면)")
console = find(lambda p: "가. 구글 콘솔 앱 만들기" in text(p))
rep(find(lambda p: "나. 구글 로그인 : " in text(p)), "나. 구글 로그인 : ", "가. 구글 로그인 : ")
rep(find(lambda p: "(가. 마지막 줄)" in p), "(가. 마지막 줄)", "(콘솔 관리자에게 파일 요청)")
rep(find(lambda p: "(나. 5~6)" in p), "(나. 5~6)", "(가. 5~6)")
rep(find(lambda p: "나.를 다시 진행" in p), "나.를 다시 진행", "가.를 다시 진행")
rep(find(lambda p: "구글 캘린더 연동 준비 나. 3)~4)" in p), "구글 캘린더 연동 준비 나. 3)~4)", "캘린더 장 8. 가. 3)~4)")

# 첫 장 → 개요 7.~9.
i_fn = find(lambda p: text(p) == "2. 준비가 필요한 기능")
i_term = find(lambda p: text(p) == "3. 용어 풀이")
i_who = find(lambda p: text(p) == "4. 사람별 할 일")
rep(i_fn, "2. 준비가 필요한 기능", "7. 준비가 필요한 기능")
rep(i_term, "3. 용어 풀이", "8. 용어 풀이")
rep(i_who, "4. 사람별 할 일", "9. 사람별 할 일")
who = [i for i in range(i_who + 1, T_PROC)]
assert [text(U[i])[:4] for i in who] == ["  가.", "  나.", "  다.", "  라."], [text(U[i])[:6] for i in who]
rep(who[0], "민원처리 준비 전부, 구글 캘린더 연동 준비 나, 집행현황 팀 공유 준비 다",
    "민원처리 장 끝 “민원처리 준비” 전부, 캘린더 장 끝 “구글 캘린더 연동 준비” 8. 가., 집행현황 장 끝 “집행현황 팀 공유 준비” 8. 가.·다.")
rep(who[2], "  다. 집행현황 호스트 : 집행현황 팀 공유 준비 나", "  나. 집행현황 호스트 : 집행현황 장 끝 “집행현황 팀 공유 준비” 8. 나.")
rep(who[3], "  라. ", "  다. ")
intro = [i_fn - 1] + list(range(i_fn, who[0] + 1)) + who[2:]   # 앞 빈 줄 + 7.~9. (콘솔 관리자 줄 뺌)
assert text(U[i_fn - 1]) == ""

# 준비 편 큰 제목은 다른 글자 모양
for t in titles:
    U[t] = U[t].replace('charPrIDRef="7"', f'charPrIDRef="{TITLE}"')
# 콘솔 줄(2줄)을 빼면 아래가 2줄 올라가 쪽 나눔이 바뀌니, 같은 높이의 빈 문단(줄 바꿈 하나)을 그 쪽 맨 아래에 둬요
from hwpx_toplevel import first_vert  # noqa: E402
nxt = next(i for i in range(console + 1, T_TEAM) if (first_vert(U[i]) or [1])[0] == 0)
blank = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", U[console], flags=re.S)
blank = re.sub(r"(<hp:run [^>]*>).*?</hp:run>", r"\1<hp:t><hp:lineBreak/></hp:t></hp:run>", blank, count=1, flags=re.S)
blank = re.sub(r"(</hp:run>)(?:<hp:run .*?</hp:run>)+", r"\1", blank, flags=re.S)
U.append(blank)
cal = [i for i in range(T_CAL, T_TEAM) if i != console]
cal.insert(cal.index(nxt), len(U) - 1)
parts = {"민원처리": list(range(T_PROC, T_CAL)),
         "캘린더": cal,
         "집행현황": list(range(T_TEAM, len(U) - 1))}

# ---------- 매뉴얼에 끼우기 ----------
PMs = top_paras(SM)
M = [SM[a:b] for a, b in PMs]
head, tail = SM[:PMs[0][0]], SM[PMs[-1][1]:]
ch = [i for i, p in enumerate(M) if 'pageBreak="1"' in p[:200] and re.search(r'<hp:run charPrIDRef="7">', p) and text(p)]
names = [text(M[i]) for i in ch]
assert names[0] == "프로그램 개요" and len(names) == 11, names
end = {names[k]: (ch[k + 1] if k + 1 < len(ch) else len(M)) for k in range(len(ch))}
ins = {end["프로그램 개요"]: intro, end["민원처리"]: parts["민원처리"], end["캘린더"]: parts["캘린더"], end["집행현황"]: parts["집행현황"]}
outp, bands = [], []
for i, p in enumerate(M + [None]):
    if i in ins:
        a = len(outp)
        outp += [remap(U[j]) for j in ins[i]]
        bands.append(f"{a}-{len(outp)}")
    if p is not None:
        outp.append(p)
sec = head + "".join(outp) + tail

# ---------- 쓰기 ----------
hpf = PM.replace("</opf:manifest>", "".join(x[2] for x in bins) + "</opf:manifest>", 1)
with zipfile.ZipFile(out, "w") as zo:
    for it in ZM.infolist():
        d = ZM.read(it.filename)
        if it.filename == "Contents/section0.xml":
            d = sec.encode()
        elif it.filename == "Contents/header.xml":
            d = HM.encode()
        elif it.filename == "Contents/content.hpf":
            d = hpf.encode()
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
        zi.compress_type = zipfile.ZIP_STORED if it.filename == "mimetype" or it.filename.startswith("BinData/") else zipfile.ZIP_DEFLATED
        zi.external_attr = it.external_attr
        zo.writestr(zi, d)
    for a, b, _ in bins:
        zo.writestr(zipfile.ZipInfo(b, date_time=(2026, 10, 29, 21, 50, 0)), ZS.read(a), compress_type=zipfile.ZIP_DEFLATED if b.lower().endswith(".bmp") else zipfile.ZIP_STORED)
open(band_out, "w").write(",".join(bands))
print(f"만듦 {out} · 문단 {len(M)} → {len(outp)} · 그림 {len(bins)} · 띠 범위 {bands}")
