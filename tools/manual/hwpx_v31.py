"""매뉴얼 v31 – 0.61~0.62 변경 반영(2026-10-30 13:51 사용자 "제안대로 작성", 분석·수정안은 같은 날 13:45).

  python3 tools/manual/hwpx_v31.py <v30.hwpx> <v31.hwpx> <자료 지우기 그림.png>

1 민원대장 남은 날 = 근무일 · 2 할 일 마감 배지 근무일 · 3 업무일지 챙길 일 7근무일 · 4 민원처리 답변 민원도 "완료 N건" 아래
5 팀 공유 × = 호스트만 바로 내보내기 · 6 팀 공유 준비 04 라. 공유에서 나가기·공유 끝내기(새 절, 뜨는 글은 마.) · 7 뜨는 글 더함
8 설정 03 자. 자료 지우기 · 9 설정 04 자. 자료 지우기(새 절·그림) · 10 설정 04 4) 집행현황 카드 한 줄
쪽 나눔: 늘어난 줄은 쪽 끝 빈 줄 자리를 쓰고, 넘칠 수 있는 곳은 다음 쪽 첫 문단에 쪽 나누기.
"""
import os
import random
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
import hwpx_edit as E  # noqa: E402
import hwpx_pics as hp  # noqa: E402
from hwpx_edit import paras, text, fresh, find, rep, with_text, S, log  # noqa: E402

src, out, clear_png = sys.argv[1:4]
z = zipfile.ZipFile(src)
for k in range(1, 12):
    S[k] = z.read(f"Contents/section{k}.xml").decode()
hpf = z.read("Contents/content.hpf").decode()
new_bins = []


def put(k, h, L, t):
    S[k] = h + "".join(L) + t


def keycp(L):
    for p in L:
        for c, x in re.findall(r'<hp:run charPrIDRef="(\d+)"><hp:t>(\[[^\[\]<]{1,30}\])</hp:t>', p):
            return c
    raise SystemExit("단추 글자 모양 없음")


def clone(p, s, k=None):
    return with_text(p.replace('pageBreak="1"', 'pageBreak="0"', 1), s, k)


def brk(p):
    return fresh(p.replace('pageBreak="0"', 'pageBreak="1"', 1))


# 1 민원대장
h, L, t = paras(3)
rep(L, find(L, lambda x: x.strip() == "아. 마감일 : 법정 답변기한과 남은 일수 표시", "03 아"), "남은 일수 표시", "남은 근무일 표시")
rep(L, find(L, lambda x: "날짜 바로 뒤에 남은 일수(D-2) 표시" in x, "04 2)"), "남은 일수(D-2) 표시", "남은 근무일(D-2, 토·일·공휴일 제외) 표시")
put(3, h, L, t)

# 4 민원처리
h, L, t = paras(4)
rep(L, find(L, lambda x: "민원대장에서 완료·불가가 되면 표 아래" in x, "진행 -"),
    "민원대장에서 완료·불가가 되면 표 아래 \"완료 N건\" 표시줄 아래로 이동, [보기]로 펼침",
    "답변·완료·불가가 되면 \"완료 N건\" 줄 아래로 이동(흐림은 완료·불가만)")
put(4, h, L, t)

# 2 할 일
h, L, t = paras(8)
rep(L, find(L, lambda x: x.strip() == "2) 임박 기준 이내이거나 경과했으면 빨간색", "배지 2)"), "경과했으면 빨간색", "경과했으면 빨간색(남은 날은 근무일로 셈)")
put(8, h, L, t)

# 3 업무일지
h, L, t = paras(9)
rep(L, find(L, lambda x: "차. 챙길 일 : 마감 7일 이내" in x, "03 차"), "마감 7일 이내", "마감 7근무일 이내")
rep(L, find(L, lambda x: "1) 마감 7일 이내(경과 포함)" in x, "04 차 1)"), "마감 7일 이내", "마감 7근무일 이내")
put(9, h, L, t)

# 5·6·7 팀 공유 준비
h, L, t = paras(5)
rep(L, find(L, lambda x: "명단에서 × 로 빼면 다음 새로고침 때" in x, "×"),
    "명단에서 × 로 빼면 다음 새로고침 때 그 사람의 시트 권한이 해제됨", "명단 ×(내보내기)는 호스트만, 누르면 바로 그 사람의 시트 권한이 해제됨")
ra = find(L, lambda x: x.strip() == "라. 준비가 덜 되었을 때 뜨는 글", "라.")
head, circ = L[ra], L[ra + 1]
K5 = keycp(L)
one = L[find(L, lambda x: x.startswith("      1) \"함께 쓰는 사람 명단에"), "1)")]
dash = L[find(L, lambda x: "지금은 한 번 연결한 공유 시트를 끊는 기능이 없음" in x, "끊는 기능 없음")]
blank = L[ra - 1]
assert text(blank) == ""
sec_new = [
    fresh(re.sub(r"<hp:t>  라\. 준비가 덜 되었을 때 뜨는 글</hp:t>", "<hp:t>  라. 공유에서 나가기·공유 끝내기</hp:t>", head)),
    clone(circ, "    ○ 팀 공유를 그만둘 때 쓰는 줄, 어느 쪽이든 내 집행현황은 그대로 남음"),
    clone(one, "      1) 팀원 : 설정 → 집행현황 카드 → 공유에서 나가기의 [나가기] → [나가기], 명단에서 내가 빠지고 이 PC의 연결이 끊김", K5),
    clone(one, "      2) 호스트 : 같은 자리의 [공유 끝내기] → [끝내기], 팀원 모두의 시트 권한을 거두고 공유를 끝냄(시트 파일은 드라이브에 남음)", K5),
    clone(dash, "        - 팀이 계속 쓸 때는 끝내지 말고 [호스트 넘기기]", K5),
    clone(dash, "        - 호스트가 내보냈거나 공유를 끝내면 팀원 앱은 다음 새로고침 때 저절로 연결을 끊고 한 번 알려 줌"),
    clone(dash, "        - 나간 뒤에도 구글 로그인과 연결할 때 남긴 백업은 그대로"),
    blank,
]
L[ra:ra] = sec_new
ra2 = find(L, lambda x: x.strip() == "라. 준비가 덜 되었을 때 뜨는 글", "옛 라.")
rep(L, ra2, "<hp:t>  라. 준비가 덜 되었을 때 뜨는 글</hp:t>", "<hp:t>  마. 준비가 덜 되었을 때 뜨는 글</hp:t>")
d = find(L, lambda x: "지금은 한 번 연결한 공유 시트를 끊는 기능이 없음" in x, "끊는 기능 없음")
five = find(L, lambda x: x.startswith("      5) \"인터넷에 연결하지 못했어요\""), "5)")
L[d:d + 1] = []
L[five + 1:five + 1] = [
    clone(one, "      6) \"내 시트를 열 수 없어요\" 또는 \"구글 시트 권한이 없어요\"(호스트) : [다시 로그인]을 눌러 시트를 만든 구글 계정으로 다시 로그인", K5),
    clone(one, "      7) \"명단에서 빠져 공유 연결을 끊었어요\" 또는 \"호스트가 공유를 끝냈어요\" : 호스트에게 확인, 다시 쓰려면 받은 주소로 [연결] (라.)", K5),
]
log.append("팀 공유 준비 04 라. 공유에서 나가기·공유 끝내기 새 절, 뜨는 글 마. 6)·7), '끊는 기능 없음' 줄 지움")
put(5, h, L, t)

# 8·9·10 설정
h, L, t = paras(11)
key = keycp(L)


def W(p, s, k=False):
    return clone(p, s, key if k else None)


a = find(L, lambda x: x.strip().startswith("아. 모듈별 설정 :"), "03 아")
L.insert(a + 1, W(L[a], "  자. 자료 지우기 : 화면별·전부 자료 지우기, 지우기 전 백업을 저절로 남김"))
b36 = find(L, lambda x: "비밀번호, 저장 위치, 구글 연결, 저장된 자료는 그대로 유지" in x, "나. 끝")
assert text(L[b36 + 1]) == ""
L[b36 + 1] = fresh(L[b36 + 1])           # 그 쪽 끝 빈 줄 – 다음 쪽 맨 위 제목에 쪽 나누기를 걸어 두 줄이 넘쳐도 그대로
L[b36 + 2] = brk(L[b36 + 2])
c = find(L, lambda x: x.strip() == "- 팀 공유 사용 시 공유 시트·함께 쓰는 사람 입력란 표시", "집행현황 카드")
L.insert(c + 1, W(L[c], "        - 공유 끝내기·나가기 : 공유를 끝내거나 이 PC의 연결을 끊음"))
cal = find(L, lambda x: x.strip() == "5) 캘린더 카드", "캘린더 카드")
L[cal] = brk(L[cal])
if text(L[cal - 1]) == "" and text(L[cal - 2]) == "":
    del L[cal - 1]                       # 쪽 끝 밀기용 빈 줄 하나 – 더한 줄 자리
log.append("설정 03 자.·04 4) 집행현황 카드 한 줄")
# 04 자. 자료 지우기(새 절) – 앞 절의 모양을 본떠 만들어요
hd = find(L, lambda x: x.strip() == "나. 기본값으로 되돌리기", "절 제목")
frame_i, circ_i = hd + 1, hd + 2
assert "<hp:tbl" in L[frame_i]
one_i = find(L, lambda x: x.strip().startswith("1) 상단 [기본값으로 되돌리기] 클릭"), "1)")
dash_i = find(L, lambda x: "비밀번호, 저장 위치, 구글 연결, 저장된 자료는 그대로 유지" in x, "-")
bid = f"image{9000 + random.randint(0, 899)}"
new_bins.append((bid, clear_png))
fr = L[frame_i]
tb = re.search(r"<hp:tbl\b.*?</hp:tbl>", fr, re.S)
inner_pp = re.search(r'<hp:subList [^>]*><hp:p [^>]*paraPrIDRef="(\d+)"', tb.group(0)).group(1)
newtb = hp.fill(tb.group(0), clear_png, bid, inner_pp, None)
newtb = re.sub(r'(<hp:tbl id=")\d+', lambda m: m.group(1) + str(random.randint(1_000_000_000, 1_800_000_000)), newtb, count=1)
frame = fresh(fr[:tb.start()] + newtb + fr[tb.end():])
blank_s = L[dash_i + 1]
assert text(blank_s) == ""
part = [
    blank_s,
    brk(re.sub(r"<hp:t>  나\. 기본값으로 되돌리기</hp:t>", "<hp:t>  자. 자료 지우기</hp:t>", L[hd])),  # 마지막 쪽 남은 자리(약 3줄)엔 그림이 안 들어가 새 쪽에서
    frame,
    W(L[circ_i], "    ○ 연습으로 넣은 자료나 지난 자료를 화면별로, 또는 한 번에 지우도록 제공"),
    W(L[one_i], "      1) 설정 맨 아래 \"자료 지우기\" 카드의 지우기 단추 보이기를 켬(설정 화면을 나가면 다시 꺼짐)"),
    W(L[one_i], "      2) 지울 화면 줄의 [모두 지우기] 클릭, 집행현황은 \"○○년만\"·\"모든 해\" 중 선택", True),
    W(L[one_i], "      3) \"정말 지울까요?\" 띠에서 [지우기] 클릭(취소·Esc·바깥 클릭은 그대로 둠)", True),
    W(L[one_i], "      4) 모든 화면을 지우려면 맨 아래 \"전부 지우고 처음부터\"의 [전부 지우기]", True),
    W(L[dash_i], "        - 민원대장은 민원처리 건도 함께, 할 일은 목록은 남기고 항목만, 캘린더는 내 종류 일정만 지움"),
    W(L[dash_i], "        - 설정·구글 연결·팀 공유 설정은 지우지 않음"),
    W(L[dash_i], "        - 지우기 전에 자료 폴더 옆 backup 폴더에 백업을 저절로 남김(최근 5개), 바. 보안·저장의 [불러오기]로 되돌림", True),
    W(L[dash_i], "        - 팀 공유 중이면 공유 시트에도 지움 표시가 가서 팀원 앱에서도 지워짐, 구글 캘린더 연동 중이면 구글에서도 빠짐"),
]
assert "<hp:tbl" in L[-1] or text(L[-1]) or True
L += part
log.append("설정 04 자. 자료 지우기 새 절(그림 1장)")
put(11, h, L, t)

# ---------- 쓰기 ----------
hpf = hpf.replace("</opf:manifest>", "".join(f'<opf:item id="{b}" href="BinData/{b}.png" media-type="image/png" isEmbeded="1"/>' for b, _ in new_bins) + "</opf:manifest>", 1)
with zipfile.ZipFile(out, "w") as zo:
    for it in z.infolist():
        d = z.read(it.filename)
        m = re.match(r"Contents/section(\d+)\.xml$", it.filename)
        if m and int(m.group(1)) in S:
            d = S[int(m.group(1))].encode()
        elif it.filename == "Contents/content.hpf":
            d = hpf.encode()
        zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
        zi.compress_type, zi.external_attr = it.compress_type, it.external_attr
        zo.writestr(zi, d)
    for b, png in new_bins:
        zo.write(png, f"BinData/{b}.png", compress_type=zipfile.ZIP_STORED)
print("\n".join(log))
print("만듦", out)
