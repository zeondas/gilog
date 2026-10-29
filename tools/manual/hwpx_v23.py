"""매뉴얼 v23 – 우두머리 v22 검토(2026-10-29 22:5x) 반영. 사용자 v22(한글 저장본)에 글만 고쳐요.

  python3 tools/manual/hwpx_v23.py <v22.hwpx> <v23.hwpx>

① 참조 번호·절 제목: "8. 가."→"04 가.", "6. 화면"→"02 화면", 준비 절 제목 "○○ 준비"로 통일(개요 07·팀 공유 04 가. 참조 포함)
② 개요 04·05 빈 번호 당기기(06~09 → 04~07), 구글 캘린더 준비 04에 "나." 넣기, 민원처리 준비 03을 04와 같은 가~바로
③ 0.53~0.57 변경 4건: 집행현황 연도 입력 칸·시공량 보기 "계약금액"·자동 백업 7개와 손상 되살리기·실행 파일 "실행할까요?"
④ 오타: 개요 01·02·03, 탐색기 04 사.(+03 사.), 민원대장 04 바., 민원처리 준비 04 가. 1)
글 길이·쪽 나눔은 그대로: 줄 수가 같게 고르고, 더하는 줄은 쪽 끝 빈 줄 자리나 그 장 마지막 쪽 빈 자리에만 넣어요.
고친 문단은 줄 배치 기억을 지워 한글이 다시 배치하게 해요.
"""
import re
import sys
import zipfile

sys.path.insert(0, __import__("os").path.dirname(__file__))
from hwpx_toplevel import top_paras  # noqa: E402

src, out = sys.argv[1:3]
z = zipfile.ZipFile(src)
S = {k: z.read(f"Contents/section{k}.xml").decode() for k in range(1, 12)}
log = []


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


# ---------- 개요 ----------
h, L, t = paras(1)
for a, b in (("06", "04"), ("07", "05"), ("08", "06"), ("09", "07")):
    i = find(L, lambda x, a=a: x.startswith(a + " "), a)
    rep(L, i, f"<hp:t>{a} </hp:t>", f"<hp:t>{b} </hp:t>")
i = find(L, lambda x: "떠나는 여정이" in x, "01")
rep(L, i, "어디다 저장했는지", "어디에 저장했는지")
rep(L, i, "매일 같이", "매일같이")
rep(L, find(L, lambda x: "줄이기 위해 기획하였음." in x, "01b"), "기획하였음.", "기획")
i = find(L, lambda x: "모든 기록인 PC" in x, "02")
rep(L, i, "모든 기록인 PC", "모든 기록은 PC")
rep(L, i, "<hp:t> 되어 있어,", "<hp:t>되어 있어,")   # 앞 run(강조)이 "암호화"로 끝나요
rep(L, i, "볼 수 없음.", "볼 수 없음")
rep(L, find(L, lambda x: "최초 암호 설정 입력 화면에 암호 입력" in x, "03"), "최초 암호 설정 입력 화면에 암호 입력", "처음 비밀번호 정하기 화면에서 비밀번호 입력")
i = find(L, lambda x: x.startswith("  가. 기록앱을 쓰는 담당자"), "07 가")
rep(L, i, "” 8. 가., ", "” 04 가., ")
rep(L, i, "<hp:t> 8. 가.·다.</hp:t>", "<hp:t> 04 가.·다.</hp:t>")
rep(L, find(L, lambda x: x.startswith("  나. 집행현황 호스트"), "07 나"), "” 8. 나.", "” 04 나.")
S[1] = h + "".join(L) + t

# ---------- 탐색기 ----------
edit(2, "자주쓰는 단축키", "자주쓰는", "자주 쓰는")
edit(2, "실행 전 \"복사할까요?\" 한 번 확인", "\"복사할까요?\" 한 번 확인", "\"복사할까요?\"·\"옮길까요?\" 확인")
edit(2, "1) 더블클릭 또는 Enter로 열기", "더블클릭 또는 Enter로 열기, 파일은 윈도우 기본 프로그램으로 실행", "더블클릭·Enter로 열기, 실행 파일은 \"실행할까요?\" 확인 뒤 실행")

# ---------- 민원대장 ----------
edit(3, "이름·기관·연락처를 한 입력란에 입력, 클릭하면 복사", "클릭하면 복사", "우클릭으로 복사")

# ---------- 민원처리 준비 ----------
h, L, t = paras(4)
i = find(L, lambda x: x.startswith("민원처리 자동화 위한 사전 작업"), "제목")
rep(L, i, re.search(r"<hp:t>민원처리 자동화 위한 사전 작업\s*</hp:t>", L[i]).group(0), "<hp:t>민원처리 준비</hp:t>")
i = find(L, lambda x: "사전작업이 필요한 이유" in x, "01")
rep(L, i, "사전작업이 필요한 이유", "준비가 필요한 이유")
rep(L, find(L, lambda x: "(6. 화면의 폴더 칸)" in x, "6. 화면"), "(6. 화면의 폴더 칸)", "(02 화면의 폴더 칸)")
rep(L, find(L, lambda x: "압축을 풀면\nclaude.exe 파일 1개" in x, "04 가 1)"), "claude.exe 파일 1개", "claude.exe 파일 1개가 나옴")
# 03 준비 항목을 04 상세설명(가~바)과 같은 차례로
a = find(L, lambda x: x.startswith("  가. Claude 계정 : "), "03 가")
items = L[a:a + 6]
assert [text(x)[2:4] for x in items] == ["가.", "나.", "다.", "라.", "마.", "바."], [text(x)[:6] for x in items]
new = [with_text(items[1], "  가. Claude Code 넣기 : claude.exe를 정해진 폴더에 넣고 Claude 유료 계정(사람마다 1개)으로 1회 로그인 (컴퓨터마다 1회)")]
for x, (o, n) in zip(items[2:], (("다.", "나."), ("라.", "다."), ("마.", "라."), ("바.", "마."))):
    new.append(fresh(x.replace(f"<hp:t>  {o} ", f"<hp:t>  {n} ", 1)))
    assert f"  {n} " in text(new[-1]), text(x)[:20]
new.append(with_text(items[0], "  바. 준비가 덜 되었을 때 : 화면에 뜨는 글과 조치 방법 확인"))
L[a:a + 6] = new
log.append("민원처리 준비 03 – 가 Claude Code 넣기(계정 포함)·나 크롬·다 엣지·라 신문고·마 폴더·바 뜨는 글")
S[4] = h + "".join(L) + t

# ---------- 집행현황 ----------
edit(5, "가. 연도 선택 : ‹ ›로 조회 연도 변경", "‹ ›로 조회 연도 변경", "‹ › 또는 연도 숫자 입력으로 조회 연도 변경")
h, L, t = paras(5)
i = find(L, lambda x: x.startswith("      1) 제목 옆 ‹"), "연도 1)")
L[i] = with_text(L[i], "      1) ‹ › 클릭, 또는 \"2026년\"을 눌러 연도 입력(27·2027) 후 Enter")
log.append("집행현황 04 가. 1) 연도 입력 칸")
S[5] = h + "".join(L) + t
edit(5, "가용액은 보기와 관계없이 같은 값", "- 가용액은 보기와 관계없이 같은 값", "- 시공량 보기는 원인행위 열을 \"계약금액\"으로 표시, 가용액은 같은 값")
edit(5, "공사 행 잔액 = 원인행위", "(시공량 보기는 시공량)", "(시공량 보기는 계약금액 − 시공량)")
h, L, t = paras(5)
i = find(L, lambda x: x.startswith("집행현황 팀 공유 사전 작업"), "제목")
rep(L, i, re.search(r"<hp:t>집행현황 팀 공유 사전 작업\s*</hp:t>", L[i]).group(0), "<hp:t>집행현황 팀 공유 준비</hp:t>")
rep(L, find(L, lambda x: "서로의 집행 현황을" in x, "집행 현황1"), "서로의 집행 현황을", "서로의 집행현황을")
rep(L, find(L, lambda x: "집행 현황만 주고받고" in x, "집행 현황2"), "집행 현황만", "집행현황만")
rep(L, find(L, lambda x: "호스트의 집행 현황이" in x, "집행 현황3"), "호스트의 집행 현황이", "호스트의 집행현황이")
rep(L, find(L, lambda x: "캘린더 장 8. 가. 3)~4)" in x, "04 가 참조"), "캘린더 장 8. 가. 3)~4)", "캘린더 장 04 가. 3)~4)")
rep(L, find(L, lambda x: "(6. 화면)" in x, "6. 화면"), "(6. 화면)", "(02 화면)")
rep(L, find(L, lambda x: "(나. 8)," in x, "나. 8"), "(나. 8),", "(나. 8)),")
S[5] = h + "".join(L) + t

# ---------- 캘린더 준비 ----------
h, L, t = paras(7)
i = find(L, lambda x: x.startswith("구글 캘린더 연동 사전작업"), "제목")
rep(L, i, re.search(r"<hp:t>구글 캘린더 연동 사전작업\s*</hp:t>", L[i]).group(0), "<hp:t>구글 캘린더 연동 준비</hp:t>")
rep(L, find(L, lambda x: "사전 작업이 필요한 이유" in x, "01"), "사전 작업이 필요한 이유", "준비가 필요한 이유")
rep(L, find(L, lambda x: "(6. 화면)" in x, "6. 화면"), "(6. 화면)", "(02 화면)")
# 04에 나. 넣기 – 가.의 9)와 할 일·끊기 설명을 "나. 보낼 것 고르기·연결 끊기"로(그 장 마지막 쪽 빈 자리에 3줄)
n9 = find(L, lambda x: x.startswith("      9) 보낼 것"), "9)")
n5 = find(L, lambda x: "5분 안에 로그인을 마치지 않으면" in x, "-5분")
nck = find(L, lambda x: "체크 칸을 비운 채" in x, "-체크")
ntk = find(L, lambda x: "구글 할 일로 보내기를 켜면 할 일 권한" in x, "-할 일")
ncut = find(L, lambda x: "일정은 두기" in x, "-끊기")
nda = find(L, lambda x: x.startswith("  다. 준비가 덜 되었을 때"), "다.")
assert [n9, n5, nck, ntk, ncut] == list(range(n9, n9 + 5)) and text(L[ncut + 1]) == "" and nda == ncut + 2
blank, head_da, circ = L[ncut + 1], L[nda], L[nda + 1]
na = fresh(re.sub(r"<hp:t>  다\. [^<]*</hp:t>", "<hp:t>  나. 보낼 것 고르기·연결 끊기</hp:t>", head_da, count=1))
assert "나. 보낼 것" in text(na), text(head_da)
oc = with_text(circ, "    ○ 연결한 뒤 구글로 보낼 것을 고르거나, 연결을 끊는 방법")
one = fresh(L[n9].replace("<hp:t>      9) ", "<hp:t>      1) ", 1))
assert text(one).startswith("      1) 보낼 것"), text(L[n9])[:20]
L[n9:ncut + 1] = [L[n5], L[nck], blank, na, oc, one, L[ntk], L[ncut]]
log.append("캘린더 준비 04 나. 보낼 것 고르기·연결 끊기(가. 9)·할 일·끊기 설명을 옮김)")
S[7] = h + "".join(L) + t

# ---------- 설정 – 자동 백업·손상 되살리기 (바. 보안·저장 쪽 끝 빈 줄 두 칸 자리에) ----------
h, L, t = paras(11)
i = find(L, lambda x: "이 PC에서 PIN 사용이 불가하면" in x, "PIN 줄")
key = re.search(r'<hp:run charPrIDRef="(\d+)"><hp:t>\[비밀번호 바꾸기\]', "".join(L)).group(1)
assert text(L[i + 1]) == "" and text(L[i + 2]) == "", "빈 줄 자리"
L[i + 1] = with_text(L[i], "        - 자동 백업 : 앱을 열 때 하루 한 번, 최근 7개를 backup 폴더에 보관")
L[i + 2] = with_text(L[i], "        - 자료가 손상되면 잠금 화면의 [○월 ○일 백업으로 되살리기]로 복구", key)
log.append("설정 04 바. 자동 백업·손상 되살리기 두 줄(쪽 끝 빈 줄 자리)")
S[11] = h + "".join(L) + t

with zipfile.ZipFile(out, "w") as zo:
    for it in z.infolist():
        d = z.read(it.filename)
        m = re.match(r"Contents/section(\d+)\.xml$", it.filename)
        if m and int(m.group(1)) in S:
            d = S[int(m.group(1))].encode()
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
        zi.compress_type, zi.external_attr = it.compress_type, it.external_attr
        zo.writestr(zi, d)
print("\n".join(log))
print(f"만듦 {out} · 고친 곳 {len(log)}")
