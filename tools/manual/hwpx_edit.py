"""한글 저장본 글 고치기 도우미(hwpx_v23.py에서 떼어 냄) – S(장별 section XML)·log를 채워 쓰고, 고친 문단은 줄 배치 기억을 지워요."""
import re
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from hwpx_toplevel import top_paras  # noqa: E402

S, log = {}, []


def paras(k):
    s = S[k]
    P = top_paras(s)
    return s[:P[0][0]], [s[a:b] for a, b in P], s[P[-1][1]:]


def text(p):
    q = re.sub(r"<hp:tbl\b.*?</hp:tbl>", "", p, flags=re.S)
    q = re.sub(r"<hp:pic .*?</hp:pic>", "", q, flags=re.S).replace("<hp:lineBreak/>", "\n")
    return re.sub(r"<[^>]+>", "", "".join(re.findall(r"<hp:t>(.*?)</hp:t>", q, re.S)))


def fresh(p):
    return re.sub(r"<hp:linesegarray>(?:(?!</hp:linesegarray>).)*</hp:linesegarray>(?=</hp:p>$)", "", p, flags=re.S)


def find(L, pred, what):
    r = [i for i, p in enumerate(L) if pred(text(p))]
    assert len(r) == 1, (what, r, [text(L[i])[:40] for i in r])
    return r[0]


def merge_runs(p):
    """같은 글자 모양으로 이어진 run·글 조각을 하나로(한글이 저장하며 글을 잘게 나눠 두기도 해요)."""
    p = p.replace("</hp:t><hp:t>", "")
    while True:
        q = re.sub(r'(<hp:run charPrIDRef="(\d+)"><hp:t>(?:(?!</hp:t>).)*)</hp:t></hp:run><hp:run charPrIDRef="\2"><hp:t>', r"\1", p, count=1, flags=re.S)
        if q == p:
            return p
        p = q


def rep(L, i, old, new):
    if L[i].count(old) != 1:
        L[i] = merge_runs(L[i])
    if L[i].count(old) != 1 and text(L[i]).count(old) == 1:
        L[i] = rebuild(L[i], old, new)
        log.append(f"{old!r} → {new!r} (글 조각 다시 짬)")
        return
    assert L[i].count(old) == 1, (old, text(L[i])[:80])
    L[i] = fresh(L[i].replace(old, new))
    log.append(f"{old!r} → {new!r}")


def edit(k, contains, old, new):
    h, L, t = paras(k)
    rep(L, find(L, lambda x: contains in x, contains), old, new)
    S[k] = h + "".join(L) + t


KEY = re.compile(r"\[[^\[\]]{1,40}\]|(?<![A-Za-z])(?:Enter|Esc|Tab|Ctrl\+[A-Z])(?![A-Za-z])")


def rebuild(p, old, new):
    """글이 여러 run에 걸쳐 있을 때: 글자마다 글자 모양을 기억해 바꾼 부분만 갈아 끼워요
    (사용자가 줄 맞추려고 자간을 줄인 run 등은 그대로). 새 글의 키·단추는 원래 칠한 모양으로."""
    runs = re.findall(r'<hp:run charPrIDRef="(\d+)">((?:(?!</hp:run>).)*)</hp:run>', p, re.S)
    chars = []
    for c, body in runs:
        for x in re.findall(r"<hp:t>((?:(?!</hp:t>).)*)</hp:t>", body, re.S):
            chars += [(ch, c) for ch in re.sub(r"<[^>]+>", "", x)]
    full = "".join(ch for ch, _ in chars)
    a = full.index(old)
    span = chars[a:a + len(old)]
    key = next((c for c, x in runs if KEY.fullmatch(re.sub(r"<[^>]+>", "", x).strip())), None)
    base = span[0][1]
    newc = [(ch, base) for ch in new]
    if key:
        for m in KEY.finditer(new):
            for j in range(m.start(), m.end()):
                newc[j] = (new[j], key)
    chars = chars[:a] + newc + chars[a + len(old):]
    out = []
    for ch, c in chars:
        if out and out[-1][0] == c:
            out[-1][1].append(ch)
        else:
            out.append((c, [ch]))
    head = re.match(r"<hp:p [^>]*>", p).group(0)
    return head + "".join(f'<hp:run charPrIDRef="{c}"><hp:t>{"".join(x)}</hp:t></hp:run>' for c, x in out) + "</hp:p>"


def with_text(p, new, key_cp=None):
    """문단 모양은 두고 글만 바꿔요(첫 run의 글자 모양 하나, [ ]는 key_cp로 칠함)."""
    m = re.search(r'<hp:run charPrIDRef="(\d+)"', p)
    cp = m.group(1)
    parts = re.split(r"(\[[^\[\]]+\])", new) if key_cp else [new]
    runs = "".join(f'<hp:run charPrIDRef="{key_cp if key_cp and x.startswith("[") else cp}"><hp:t>{x}</hp:t></hp:run>' for x in parts if x)
    head = re.match(r"<hp:p [^>]*>", p).group(0)
    return head + runs + "</hp:p>"


