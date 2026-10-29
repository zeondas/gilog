"""쪽 나눔 손보기 – 사용자가 한글에서 저장한 매뉴얼의 실제 줄 배치를 읽어 고쳐요(2026-10-30 사용자 "페이지 수정").

  python3 tools/manual/hwpx_pagefix.py <한글 저장본.hwpx> <결과.hwpx> <목차 쪽 번호 1,5,…(장 첫 쪽)>

- 쪽 맨 위 빈 줄: 지우고, 다음 쪽 첫 문단에 쪽 나누기(내용이 앞 쪽으로 딸려 올라오지 않게)
- 단계 글(1)·가. 등) 바로 뒤 그림이 다음 쪽으로 떨어진 곳: 그 단계 글에 쪽 나누기를 걸어 그림과 같은 쪽으로.
  다음 쪽에 자리가 모자라면 그 쪽 그림 틀을 모자란 만큼(20%까지) 줄여요.
"""
import re, sys, os, zipfile
sys.path.insert(0, os.path.dirname(__file__))
from hwpx_toplevel import top_paras
BODY = 71433
src, out = sys.argv[1:3]
z = zipfile.ZipFile(src); log = []

def lines(p):
    q = re.sub(r"<hp:tbl\b.*?</hp:tbl>", "", p, flags=re.S)
    L = re.findall(r"<hp:linesegarray>(.*?)</hp:linesegarray>", q, re.S)
    return [(int(a), int(b)) for a, b in re.findall(r'vertpos="(-?\d+)" vertsize="(\d+)"', L[-1])] if L else []

def text(p):
    q = re.sub(r"<hp:tbl\b.*?</hp:tbl>", "", p, flags=re.S); q = re.sub(r"<hp:pic .*?</hp:pic>", "", q, flags=re.S)
    return re.sub(r"<[^>]+>", "", "".join(re.findall(r"<hp:t>(.*?)</hp:t>", q, re.S))).strip()

def kind(p):
    return "T" if "<hp:tbl" in p else ("B" if not text(p) and "<hp:ctrl>" not in p else "X")

def tbl_h(p):
    return int(re.search(r'<hp:tbl .*?<hp:sz width="\d+" widthRelTo="\w+" height="(\d+)"', p, re.S).group(1))

def shrink(p, s):
    t = re.search(r"<hp:tbl\b.*?</hp:tbl>", p, re.S); tb = t.group(0)
    th = tbl_h(p); pic = re.search(r"<hp:pic .*?</hp:pic>", tb, re.S)
    pw, ph = map(int, re.search(r'<hp:sz width="(\d+)" widthRelTo="\w+" height="(\d+)"', pic.group(0)).groups())
    m = re.search(r'<hp:cellMargin left="\d+" right="\d+" top="(\d+)" bottom="(\d+)"', tb)
    room = th - ph - int(m.group(1)) - int(m.group(2)) - 600
    g = pic.group(0)
    if s > room:
        nph = ph - (s - max(room, 0)); npw = round(pw * nph / ph)
        g = re.sub(r'<hp:orgSz width="\d+" height="\d+"/>', f'<hp:orgSz width="{npw}" height="{nph}"/>', g)
        g = re.sub(r'(<hp:sz width=")\d+(" widthRelTo="\w+" height=")\d+', rf"\g<1>{npw}\g<2>{nph}", g)
        g = re.sub(r"<hp:imgRect>.*?</hp:imgRect>", f'<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="{npw}" y="0"/><hc:pt2 x="{npw}" y="{nph}"/><hc:pt3 x="0" y="{nph}"/></hp:imgRect>', g, flags=re.S)
    tb = tb[:pic.start()] + g + tb[pic.end():]
    tb = re.sub(r'(<hp:tbl .*?<hp:sz width="\d+" widthRelTo="\w+" height=")\d+', rf"\g<1>{th - s}", tb, count=1, flags=re.S)
    tb = re.sub(r'(<hp:cellSz width="\d+" height=")\d+', rf"\g<1>{th - s}", tb)
    tb = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", tb, flags=re.S)
    return p[:t.start()] + tb + p[t.end():]

def brk(p):
    return p.replace('pageBreak="0"', 'pageBreak="1"', 1)

new = {}
for k in range(1, 12):
    n = f"Contents/section{k}.xml"; s = z.read(n).decode(); P = top_paras(s); L = [s[a:b] for a, b in P]
    pg = 0; pages = []
    for i, p in enumerate(L):
        ln = lines(p)
        if i == 0 or (ln and ln[0][0] == 0): pg += 1; pages.append([])
        pages[-1].append(i)
        pg_extra = sum(1 for v, _ in ln[1:] if v == 0)
        for _ in range(pg_extra): pages.append([])
    pages = [x for x in pages if x]
    bottom = lambda idx: max((v + h) for i in idx for v, h in lines(L[i])[:1] + ([(0, tbl_h(L[i]))] if False else []) ) if idx else 0
    def page_bottom(idx):
        b = 0
        for i in idx:
            ln = lines(L[i])
            if not ln: continue
            cut = next((j for j in range(1, len(ln)) if ln[j][0] == 0), len(ln))
            b = max(b, max(v + h for v, h in ln[:cut]))
        return b
    drop, brks, shr = set(), set(), {}
    def step_out(n_):
        """n_쪽 끝 단계 글이 다음 쪽 첫 그림과 떨어졌으면 그 글 번호와 높이."""
        idx = pages[n_]; real = [i for i in idx if kind(L[i]) != "B"]
        if not real or n_ + 1 >= len(pages): return None
        last = real[-1]; t = text(L[last]); nxt = pages[n_ + 1]
        if kind(L[last]) == "X" and re.match(r"^(\d+\) |[가-하]\. )", t) and kind(L[nxt[0]]) == "T":
            ln = lines(L[last]); return last, ln[-1][0] + ln[-1][1] - ln[0][0] + 780, t
        return None
    moves = {n_: step_out(n_) for n_ in range(len(pages))}
    for n_, idx in enumerate(pages):
        if kind(L[idx[0]]) == "B" and n_ > 0:
            drop.add(idx[0])
            if n_ + 1 < len(pages): brks.add(pages[n_ + 1][0])
            log.append(f"{k}장 {n_+1}쪽: 맨 위 빈 줄 지움")
        mv = moves[n_]
        if not mv: continue
        last, h, t = mv
        brks.add(last)
        tgt = pages[n_ + 1]
        real = [i for i in tgt if kind(L[i]) != "B"]
        out_h = moves[n_ + 1][1] if moves.get(n_ + 1) else 0
        room = BODY - page_bottom(real) + out_h
        trail = [i for i in tgt[::-1] if kind(L[i]) == "B"]
        trail = tgt[len(real) and tgt.index(real[-1]) + 1:]
        if trail:                       # 다음 쪽 끝 빈 줄(밀기용)은 지우고 그다음 쪽에 쪽 나누기
            drop.update(trail)
            if n_ + 2 < len(pages): brks.add(pages[n_ + 2][0])
        need = h - room
        if need > 0:
            fr = [i for i in tgt if kind(L[i]) == "T"]; tot = sum(tbl_h(L[i]) for i in fr)
            for i in fr: shr[i] = min(round(tbl_h(L[i]) * 0.2), -(-need * tbl_h(L[i]) // tot))
        log.append(f"{k}장 {n_+1}쪽 끝 \"{t[:24]}\" → 다음 쪽 그림과 같이" + (f" (그림 {sum(shr.get(i,0) for i in tgt)} 줄임)" if need > 0 else "") + (f" (빈 줄 {len(trail)} 지움)" if trail else ""))
    out_p = []
    for i, p in enumerate(L):
        if i in drop: continue
        if i in shr: p = shrink(p, shr[i])
        if i in brks: p = brk(p)
        out_p.append(re.sub(r"<hp:linesegarray>(?:(?!</hp:linesegarray>).)*</hp:linesegarray>(?=</hp:p>$)", "", p, flags=re.S))   # 바뀐 장은 한글이 다시 배치
    if drop or brks or shr:
        new[n] = s[:P[0][0]] + "".join(out_p) + s[P[-1][1]:]
with zipfile.ZipFile(out, "w") as zo:
    for it in z.infolist():
        d = new[it.filename].encode() if it.filename in new else z.read(it.filename)
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time); zi.compress_type, zi.external_attr = it.compress_type, it.external_attr
        zo.writestr(zi, d)
print("\n".join(log)); print("만듦", out)
