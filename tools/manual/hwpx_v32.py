"""매뉴얼 v32 – 0.63~0.79 변경 반영(2026-11-05 사용자 ①②③ 1안: v31 한글 파일 위에, 바뀐 화면만 0.78.0으로 다시 찍기).

  python3 tools/manual/hwpx_v32.py <v31.hwpx> <v32.hwpx> <그림 폴더(hwpx_v32_pics.py)> <앞 그림 폴더(hwpx_front_v32.py, toc.png 포함)>

- 새 장 "민원지도"(민원대장 다음, section4 – 뒤 장은 하나씩 밀림, 바탕쪽 masterpage11·색인 띠 band_map)
- 민원대장 상태·처리 열·지도에서 보기·대체하기 백업, 캘린더 미니달력·일/주/월·구글 상자·연동 방향,
  설정 민원지도 카드·자료 지우기 자리·자동 백업·키 설정, 집행현황·예산현황·업무일지·업무연락처 가져오기, 개요 모듈 10개·08 알아 두면 좋은 것
- 표지·목차·색인 띠 12장(회색 칸은 투명 – hwpx_rectbg와 같게)
글 틀은 v31 문단을 본떠 만들어요(문단·글자 모양 그대로). 고친·새 문단은 줄 배치 기억을 지워 한글이 다시 셈해요.
"""
import io
import os
import random
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
import hwpx_edit as E  # noqa: E402
import hwpx_pics as hp  # noqa: E402
from hwpx_edit import paras, text, fresh, find, rep, with_text, S, log  # noqa: E402
from PIL import Image  # noqa: E402

src, out, PICS, FRONT = sys.argv[1:5]
z = zipfile.ZipFile(src)
for k in range(0, 12):
    S[k] = z.read(f"Contents/section{k}.xml").decode()
hpf = z.read("Contents/content.hpf").decode()
header = z.read("Contents/header.xml").decode()
MP = {n: z.read(n).decode() for n in z.namelist() if re.match(r"Contents/masterpage\d+\.xml$", n)}
bins = {}          # 새 그림: id → 바이트
replace_bin = {}   # 바꿀 그림: 파일 이름 → 바이트
n0 = max(int(x) for x in re.findall(r'id="image(\d+)"', hpf))


def new_bin(png_bytes):
    global n0
    n0 += 1
    bid = f"image{n0}"
    bins[bid] = png_bytes
    return bid


def rd(name):
    return open(os.path.join(PICS, name + ".png"), "rb").read()


def put(k, h, L, t):
    S[k] = h + "".join(L) + t


def keycp(L):
    for p in L:
        for c, _ in re.findall(r'<hp:run charPrIDRef="(\d+)"><hp:t>(\[[^\[\]<]{1,30}\])</hp:t>', p):
            return c
    raise SystemExit("단추 글자 모양 없음")


def clone(p, s, k=None):
    return with_text(p.replace('pageBreak="1"', 'pageBreak="0"', 1), s, k)


def has_key(s):
    return "[" in s


def W(p, s, key):
    return clone(p, s, key if has_key(s) else None)


def frame_after(L, i):
    """i 다음 첫 그림 틀 문단 번호"""
    for j in range(i + 1, min(i + 4, len(L))):
        if "<hp:tbl" in L[j]:
            return j
    raise SystemExit(f"틀 없음 {text(L[i])[:30]}")


def set_pic(L, j, png_name, scale=None, max_h=None):
    p = L[j]
    tb = re.search(r"<hp:tbl\b.*?</hp:tbl>", p, re.S)
    cpp = re.search(r'<hp:subList [^>]*><hp:p [^>]*paraPrIDRef="(\d+)"', tb.group(0)).group(1)
    path = os.path.join(PICS, png_name + ".png")
    bid = new_bin(open(path, "rb").read())
    newtb = hp.fill(tb.group(0), path, bid, cpp, scale, max_h)
    L[j] = fresh(p[:tb.start()] + newtb + p[tb.end():])
    log.append(f"그림 바꿈 {png_name}")


CROP = dict(scale=hp.PX, max_h=hp.CROP_MAX_H)

# ======================================================================= 1 개요
h, L, t = paras(1)
K1 = None
rep(L, find(L, lambda x: x.strip().startswith("○ 사이드바 순서대로 9개 모듈"), "모듈 구성"), "9개 모듈", "10개 모듈")
i = find(L, lambda x: x.strip().startswith("나. 민원대장 :"), "개요 민원대장")
labels = "다라마바사아자차카"
for j, lab in zip(range(i + 1, i + 9), labels[1:]):
    old = text(L[j]).strip()[:2]
    rep(L, j, f"    {old}", f"    {lab}.")
L.insert(i + 1, clone(L[i], "    다. 민원지도 : 민원대장의 민원 위치를 지도에 점으로 표시하여 지역별 민원 현황을 한눈에 보는 도구"))
j = frame_after(L, find(L, lambda x: x.strip().startswith("○ 시작 화면은 왼쪽 사이드바"), "처음 화면"))
start = Image.open(os.path.join(PICS, "ov_start.png")).convert("RGB")
old_tb = re.search(r'<hp:sz width="(\d+)" widthRelTo="\w+" height="(\d+)"', re.search(r"<hp:pic .*?</hp:pic>", L[j], re.S).group(0))
buf = io.BytesIO()
start.save(buf, "PNG")
open(os.path.join(PICS, "ov_start_full.png"), "wb").write(buf.getvalue())
set_pic(L, j, "ov_start_full")
# 08 알아 두면 좋은 것
hd = find(L, lambda x: x.strip() == "07 사람별 할 일", "07")
it = L[find(L, lambda x: x.startswith("  나. 집행현황 호스트"), "07 나")]
blank = L[hd - 1]
assert text(blank) == ""
head8 = fresh(L[hd].replace(">07 <", ">08 <").replace(">사람별 할 일<", ">알아 두면 좋은 것<"))
assert ">08 <" in head8 and "알아 두면" in head8, "08 제목"
L += [blank, head8,
      clone(it, "  가. 날짜 입력 : 구분 기호를 빼고 숫자만 모아 읽음, 1031·261031·20261031·2026.10.31.은 모두 2026-10-31(4자리 = 올해 월일, 6자리 = 연도 두 자리 + 월일, 8자리 = 연도 네 자리 + 월일), 입력란을 벗어나면 2026-10-31로 바뀜"),
      clone(it, "  나. 구글·공유 단추 : 누르면 바로 도는 표시와 \"…하는 중\"이 나타나고, 10초가 넘으면 \"오래 걸려요\" 안내, 끝나면 ✓ 표시(실패는 붉은 글)"),
      clone(it, "  다. 민원인 정보 : 민원인 이름·연락처·내용은 구글·카카오 어디로도 보내지 않음, 민원지도도 위치·유형·상태·날짜만 사용"),
      clone(it, "  라. 자동 백업 : 잠금을 풀 때 하루 1개씩 자동 백업(최근 7개), 자료가 손상되면 잠금 화면에서 백업으로 되살림(설정 04 바.)")]
log.append("개요 모듈 10개·민원지도 줄·08 알아 두면 좋은 것·처음 화면 그림")
put(1, h, L, t)

# ======================================================================= 2 탐색기
E.edit(2, '2) 상위 폴더로 이동 : 맨 위 ".." 행', '맨 위 ".." 행,', '고정된 ".." 행,')

# ======================================================================= 3 민원대장
h, L, t = paras(3)
K3 = keycp(L)
set_pic(L, frame_after(L, find(L, lambda x: x == "02 화면", "02")), "cm_screen")
rep(L, find(L, lambda x: x.strip().startswith("아. 마감일 :"), "03 아"), "아. 마감일 : 법정 답변기한과 남은 근무일 표시", "아. 처리 : 답변 전엔 남은 근무일, 답변 뒤엔 답변완료·걸린 기간 표시")
rep(L, find(L, lambda x: "창이 좁으면 마감일은 D-day만" in x, "좁은 창"), "창이 좁으면 마감일은 D-day만, 접수일은", "창이 좁으면 접수일은")
rep(L, find(L, lambda x: x.strip().startswith('4) "대체하기"'), "대체하기"), "(되돌릴 수 없음)", "(지우기 전에 백업을 저절로 남김)")
rep(L, find(L, lambda x: x.strip().startswith("6) 행 우클릭 메뉴"), "우클릭"), '"고치기"·"위치 복사"', '"고치기"·"지도에서 보기"(Ctrl+M)·"위치 복사"')
set_pic(L, frame_after(L, find(L, lambda x: "민원인 입력란에는 이름·기관·연락처" in x, "메뉴 그림")), "cm_menu", **CROP)
a = find(L, lambda x: x == "  아. 마감일", "상세 아")
rep(L, a, "  아. 마감일", "  아. 처리")
set_pic(L, frame_after(L, a), "cm_아", scale=hp.PX, max_h=8850)
o = find(L, lambda x: x.strip().startswith("○ 법정 답변기한을 입력하고 남은 일수"), "아 ○")
L[o] = clone(L[o], "    ○ 상태 옆 \"처리\" 칸에 남은 날·답변 여부·걸린 기간을 표시, 캘린더·할 일·업무일지 챙길 일과 연계하여 기한 누락 방지")
L[o + 1] = clone(L[o + 1], "      1) 처리 칸에 마감일(답변기한) 입력, 완료한 민원은 조치완료일 입력")
L[o + 2] = clone(L[o + 2], "      2) 답변 전 : \"N일 남음\"·\"오늘 마감\"·\"N일 지남\"(토·일·공휴일 뺀 근무일)")
L[o + 3] = clone(L[o + 3], "      3) 답변 뒤 : \"답변완료\", 완료·불가는 접수부터 걸린 기간(N일·N달·N년 걸림)")
assert text(L[o + 6]).strip().startswith("- 남은 일수는"), text(L[o + 6])
L[o + 6] = clone(L[o + 6], "        - 조치완료일이 접수일보다 앞서면 주황 \"날짜 확인\", 마우스를 올리면 두 날짜 표시")
a = find(L, lambda x: x == "  자. 상태", "상세 자")
set_pic(L, frame_after(L, a), "cm_자", scale=hp.PX, max_h=9080)
rep(L, find(L, lambda x: x.strip().startswith("3) 완료·불가로 변경 시 조치완료일"), "자 3"), "다른 상태로 되돌리면 삭제", "조치완료일을 지우면 완료 전 상태로")
j = find(L, lambda x: x.strip().startswith("4) 조치완료일 열은 기본으로 접혀"), "자 4")
L[j] = clone(L[j], "      4) 고치는 행은 상태 배지 목록에서 골라 저장 때 반영, 신규 행은 \"접수\" 고정")
j = find(L, lambda x: x.strip().startswith("- 조치완료일 뒤에 접수부터 소요 기간"), "자 -")
L[j] = clone(L[j], "        - 처리 칸의 걸린 기간은 처리 소요 기간 통계로 활용")
log.append("민원대장 처리 열·상태·지도에서 보기·대체하기 백업")
put(3, h, L, t)

# ======================================================================= 4 민원지도(새 장 – 민원대장 장을 틀로)
h3, T, t3 = paras(3)
title = T[0]
assert "<hp:secPr" in title
title = fresh(title.replace('idRef="masterpage2"', 'idRef="masterpage11"').replace("<hp:t>민원대장</hp:t>", "<hp:t>민원지도</hp:t>"))
sub, rule, H, I1, I2, BL = T[1], T[2], T[3], T[4], T[6], T[8]
SCR, IT3, DH, CR, CIR, NUM, NUMW, DSH, DSHW = T[10], T[13], T[25], T[26], T[27], T[28], T[31], T[33], T[32]
BLANK = T[23]
assert text(DH) == "  가. 상태 칩" and "<hp:tbl" in CR and "<hp:tbl" in SCR


def heading(n, s):
    q = re.sub(r"<hp:t>\d\d </hp:t>", f"<hp:t>{n} </hp:t>", fresh(H), count=1)
    return fresh(re.sub(r"(<hp:run charPrIDRef=\"\d+\"><hp:t>)[^<]+(</hp:t></hp:run></hp:p>)$", lambda m: m.group(1) + s + m.group(2), q))


from PIL import ImageFont  # noqa: E402
F = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 1300, index=1)


def wide(s):
    return F.getlength(s) / 48188 > 0.9


def line(s, key):
    """들여쓰기로 모양을 골라요: ○ / 1) / - (두 줄 넘으면 내어쓰기 모양)"""
    st = s.lstrip()
    if st.startswith("○"):
        return W(CIR, s, key)
    if st.startswith("-"):
        return W(DSHW if wide(s) else DSH, s, key)
    return W(NUMW if wide(s) else NUM, s, key)


def frame(tpl, png, **kw):
    LL = [tpl]
    set_pic(LL, 0, png, **kw)
    return LL[0]


MAP_TEXT = [
    ("가", "검색창", "검색창 : ☰로 민원현황 패널 열고 닫기, 주소·장소·민원유형 검색", [
        "    ○ 지도 왼쪽 위에 떠 있는 검색창 하나로 민원과 주소를 함께 찾도록 구현",
        "      1) ☰ 클릭 시 왼쪽 민원현황 패널 열기·닫기",
        "      2) 검색란에 지번·장소·민원유형 입력 후 Enter, 찾은 자리로 지도가 이동하고 빨간 핀 표시",
        "      3) 위치·민원유형이 맞는 민원은 목록에 함께 표시, 클릭 시 해당 민원 점으로 이동",
        "        - 주소 찾기는 파주시 안만 가능, 기록앱 안의 필지 표로 찾아 위치를 밖으로 보내지 않음",
        "        - 검색란 끝의 × 또는 Esc로 입력 내용 삭제"]),
    ("나", "거르기 배지", "거르기 배지 : 민원유형·상태·기간으로 지도에 보일 민원 선택", [
        "    ○ 검색창 옆 배지로 필요한 민원만 골라 지도에 표시",
        "      1) 민원유형 : 유형별로 체크, 초성으로 유형 찾기 가능",
        "      2) 상태 : 접수·진행·답변 등 표시할 상태 선택(처음 값 접수·진행·답변)",
        "      3) 기간 : 올해·작년·최근 1년·전체 또는 시작일~끝일 입력 후 [적용]",
        "        - 배지에 지금 고른 값 표시, 거르기는 패널 건수와 지도 점에 함께 적용"]),
    ("다", "민원현황 패널", "민원현황 패널 : 읍면동별 민원 건수, 더블클릭 시 그 지역으로 확대", [
        "    ○ 읍면동별 민원 건수를 목록으로 보여 지역별 현황을 즉시 확인",
        "      1) 맨 위 \"파주시 전체\"와 읍면동별 건수 표시",
        "      2) 읍면동 더블클릭 시 그 지역으로 확대, ›로 펼치면 민원유형 › 민원 순으로 표시",
        "      3) 민원 행 더블클릭 시 민원대장의 해당 행으로 이동",
        "      4) [표시 설정]에서 목록과 지도에 보일 읍면동 선택",
        "        - 패널 가장자리 손잡이로 닫기, 경계를 끌어 폭 조정",
        "        - 설정 → 민원지도 카드 → 분야를 \"하천\"으로 바꾸면 하천 등급별 목록으로 표시"]),
    ("라", "민원 점", "민원 점 : 클릭 시 민원 카드, 더블클릭 시 민원대장의 해당 행으로 이동", [
        "    ○ 민원 위치를 점으로 표시하고, 점을 눌러 민원 내용을 바로 확인",
        "      1) 점 색은 민원유형별, 같은 자리 여러 건은 숫자 원으로 표시(지도 아래 범례)",
        "      2) 점 클릭 시 민원 카드(위치·상태·민원유형·접수유형·접수일) 표시",
        "      3) 점이나 카드 행 더블클릭 시 민원대장의 해당 행으로 이동",
        "      4) 민원대장 행 우클릭 \"지도에서 보기\"(Ctrl+M)로 해당 민원 점으로 바로 이동",
        "        - 위치에서 좌표를 찾지 못한 민원은 지도에 그리지 않고 패널 목록에만 표시",
        "        - 범례는 지도 아래, ⌄로 접기 가능"]),
    ("마", "로드뷰", "로드뷰 : 지도 오른쪽 절반에 현장 로드뷰 사진 표시", [
        "    ○ 현장에 가지 않고도 주변 모습을 확인하도록 지도 오른쪽 절반에 로드뷰 표시",
        "      1) 민원 카드의 [로드뷰 보기] 또는 오른쪽 단추 줄의 [로드뷰] 클릭",
        "      2) 50m 안 가장 가까운 로드뷰 사진 표시, 지도의 파란 선 위를 클릭하면 그 자리로 이동",
        "      3) 로드뷰 × 또는 Esc로 닫기, 가운데 경계를 끌어 폭 조정",
        "        - 카카오지도 배경일 때만 사용 가능, 사진이 없으면 \"이 근처엔 로드뷰가 없어요\" 표시"]),
    ("바", "층", "층 : 민원 점·읍면동 경계·도로구역 등 겹쳐 보기 선택", [
        "    ○ 필요한 배경 정보만 겹쳐 보도록 층을 켜고 끄는 기능",
        "      1) 오른쪽 단추 줄의 [층] 클릭 시 \"겹쳐 보기\" 목록 표시",
        "      2) 민원 닷·읍면동 경계·도로구역·도시계획시설(도로)·범례 중 체크한 것만 표시",
        "        - 도로구역·도시계획시설 같은 분야 층은 처음에 꺼져 있음",
        "        - 설정 → 민원지도 카드 → 분야(도로·하천·공원)에 따라 목록이 바뀜"]),
    ("사", "재기", "재기 : 거리·면적·반경 측정", [
        "    ○ 공사 연장·면적을 지도에서 바로 재도록 거리·면적·반경 측정 제공",
        "      1) 오른쪽 단추 줄에서 거리·면적·반경 중 선택",
        "      2) 지도를 클릭하여 점을 찍고 더블클릭으로 끝, 반경은 가운데와 끝 두 번 클릭",
        "      3) 결과 상자에 총거리·면적과 걸어서 걸리는 시간 표시, ×로 지우기",
        "        - Esc로 재기 취소"]),
    ("아", "캡처", "캡처 : 지금 지도 화면을 그림으로 복사", [
        "    ○ 보고 자료에 바로 붙이도록 지금 지도 화면을 그림으로 복사",
        "      1) 오른쪽 단추 줄의 [캡처] 클릭",
        "      2) 한글·카카오톡 등에서 Ctrl+V로 붙여 넣기",
        "        - 검색창·패널·단추·카드는 빼고 지도만 복사",
        "        - 로드뷰가 열려 있으면 왼쪽 지도와 오른쪽 로드뷰 사진을 나란히 한 장으로 복사"]),
    ("자", "확대·파주시 보기", "확대·파주시 보기 : 확대·축소, 가운데로, 파주시 전체 보기", [
        "    ○ 보고 싶은 범위로 빠르게 이동하도록 오른쪽 아래 단추 제공",
        "      1) +·− 또는 마우스 휠로 확대·축소, 지도를 끌어 이동",
        "      2) [가운데로] : 보고 있는 읍면 또는 파주시를 화면 가운데로",
        "      3) [파주시 전체] : 읍면을 보고 있을 때 파주시 전체 보기로 복귀",
        "        - Esc는 로드뷰 닫기 → 재기 취소 → 카드 닫기 → 파주시 전체 순서로 작동",
        "        - 인터넷이 막혀 카카오지도를 읽지 못하면 한 번 더 받아 본 뒤 연속주제도 배경으로 저절로 바뀜"]),
]
NEW = [title, clone(sub, "민원대장의 민원 위치를 지도에 점으로 표시하여 지역별 민원 현황을 한눈에 보는 도구"), rule,
       heading("01", "기획 의도"),
       clone(I1, "  가. 민원대장에 기록한 위치(리·동 + 지번)를 지도에 점으로 표시하여 민원이 몰리는 지역·유형을 한눈에 파악"),
       clone(I2, "  나. 지번은 기록앱에 들어 있는 필지 표로 좌표를 찾아 위치를 밖으로 보내지 않음, 밖으로 나가는 것은 지도 그림 요청뿐"),
       clone(I2, "  다. 민원인 이름·연락처·내용은 지도가 읽지도 않음, 위치·유형·상태·날짜만 사용"),
       clone(I2, "  라. 카카오지도 위에 읍면동 경계·도로구역·하천 등을 겹쳐 현장 확인과 보고 자료 작성에 활용(설치하면 바로 표시)"),
       BL, heading("02", "화면"), frame(SCR, "map_screen"),
       clone(I2, "  ※ 그림은 인터넷 없이 찍어 연속주제도 배경으로 보이며, 실제 화면은 카카오지도 위에 표시"),
       BLANK, heading("03", "기능별 설명")]
NEW += [clone(IT3, f"  {lab}. {short}") for lab, _, short, _ in MAP_TEXT]
NEW += [BLANK, heading("04", "상세설명")]
KEYM = K3
for n, (lab, name, _, lines) in enumerate(MAP_TEXT):
    dh = fresh(DH.replace("<hp:t>  가. 상태 칩</hp:t>", f"<hp:t>  {lab}. {name}</hp:t>"))
    kw = dict(scale=hp.PX, max_h=36000) if lab == "다" else CROP
    NEW += [dh, frame(CR, f"map_{lab}", **kw)] + [line(s, KEYM) for s in lines] + ([BLANK] if n < len(MAP_TEXT) - 1 else [])
MAPSEC = h3 + "".join(NEW) + t3
log.append(f"민원지도 장 새로 – 문단 {len(NEW)}")

# ======================================================================= 5 집행현황
E.edit(5, "같은 연도에 다시 가져오면 같은 이름은 덮어쓰고", "같은 연도에 다시 가져오면 같은 이름은 덮어쓰고 없는 것만 추가, 건수 사전 확인",
       "가져올 때 덮어쓰기(같은 이름은 갱신, 없는 것만 추가) 또는 대체하기(보는 연도를 비우고 파일대로, 지우기 전 백업) 선택")

# ======================================================================= 6 예산현황
E.edit(6, "가. 조회 연도 : ‹ ›로 장부 조회 연도 선택", "‹ ›로 장부 조회 연도 선택", "‹ › 또는 연도 숫자 입력으로 조회 연도 선택")
E.edit(6, "1) 제목 옆 ‹  › 클릭으로 이전·다음 연도로 이동", "클릭으로 이전·다음 연도로 이동", "클릭, 또는 \"2026년\"을 눌러 연도 입력(27·2027) 후 Enter")
E.edit(6, "같은 양식 시트에서 직접 입력 칸만 가져옴", "건수 확인 후 입력", "덮어쓰기·대체하기 중 선택")
E.edit(6, "- 집행현황에서 연계되는 칸은 가져오지 않음", "- 집행현황에서 연계되는 칸은 가져오지 않음", "- 대체하기는 직접 입력 값을 모두 비우고 파일대로(지우기 전 백업), 집행현황에서 연계되는 칸은 가져오지 않음")

# ======================================================================= 7 캘린더
h, L, t = paras(7)
K7 = keycp(L)
set_pic(L, frame_after(L, [i for i, x in enumerate(L) if text(x) == "02 화면"][0]), "cal_screen")
rep(L, find(L, lambda x: x.strip() == "다. 구글캘린더와 연동 가능 (단방향 연동)", "01 다"), "(단방향 연동)", "(한 방향·양방향 선택)")
j = find(L, lambda x: x.strip().startswith("나. 앞으로 7일 :"), "03 나")
L[j] = clone(L[j], "  나. 미니달력 : 클릭한 날의 주부터 5주 표시, 더블클릭 시 그 날 일 보기")
j = find(L, lambda x: x.strip().startswith("다. 구글 연동 상태 :"), "03 다")
L[j] = clone(L[j], "  다. 구글 캘린더 상자 : 로그인 상태·연동 방향·확인할 것 표시")
j = find(L, lambda x: x.strip().startswith("바. 월·주 보기 :"), "03 바")
L[j] = clone(L[j], "  바. 일·주·월 보기 : [일][주][월] 단추로 보기 전환")
# 나. 미니달력
a = find(L, lambda x: x == "  나. 앞으로 7일", "상세 나")
rep(L, a, "  나. 앞으로 7일", "  나. 미니달력")
set_pic(L, frame_after(L, a), "cal_나", **CROP)
o = frame_after(L, a) + 1
assert text(L[o]).strip().startswith("○"), text(L[o])
old = L[o:o + 5]
L[o:o + 5] = [clone(old[0], "    ○ 달력을 넘기지 않고도 원하는 날짜로 바로 이동하도록 왼쪽 위에 작은 달력 제공"),
              clone(old[1], "      1) 날짜 클릭 시 해당 날짜가 있는 주부터 5주를 큰 달력에 표시"),
              clone(old[2], "      2) 날짜 더블클릭 시 해당 날짜의 일 보기(0~24시)로 전환"),
              clone(old[3], "      3) ‹ ›로 미니달력의 달 이동"),
              clone(old[4], "        - 고른 날은 큰 달력에서 2px 테두리로 표시"),
              clone(old[4], "        - 5주 보기에서 ‹ ›와 마우스 휠은 한 주씩 이동")]
# 다. 구글 캘린더 상자
a = find(L, lambda x: x == "  다. 구글 연동 상태", "상세 다")
rep(L, a, "  다. 구글 연동 상태", "  다. 구글 캘린더 상자")
set_pic(L, frame_after(L, a), "cal_다", **CROP)
o = frame_after(L, a) + 1
old = L[o:o + 12]
assert text(old[0]).strip().startswith("○") and text(old[11]).strip().startswith("- 구글에서 직접 만든"), [text(x)[:20] for x in old]
num, dsh = old[1], old[6]
L[o:o + 12] = [
    clone(old[0], "    ○ 구글 캘린더 연동 상태를 즉시 확인하도록 왼쪽 맨 아래에 상자 제공(연결했을 때만 표시)"),
    clone(num, "      1) 설정 → 캘린더 카드 → 구글 연동에서 [구글 로그인]으로 연결하면 상자 표시", K7),
    clone(num, "      2) 로그인 : 로그인한 날과 남은 날 표시, 7일마다 다시 로그인, 풀리면 [다시 로그인] 클릭", K7),
    clone(num, "      3) 연동 : 한 방향·양방향과 마지막으로 보낸(맞춘) 시각 표시, [지금 내보내기]([지금 맞추기])로 바로 보냄", K7),
    clone(num, "      4) 양방향일 때 [확인할 것 N건 보기 ›] 클릭 시 구글에서 지운 일정 등을 [되살리기]·[지우기]로 처리", K7),
    clone(num, "      5) 연동 방향은 설정 → 캘린더 카드 → 연동 방향에서 한 방향(처음 값)·양방향 선택"),
    clone(dsh, "        - 한 방향 : 기록앱에서 고친 것만 구글로 보내고, 구글에서 고친 것은 다음 내보내기 때 기록앱 내용으로 덮어씀"),
    clone(dsh, "        - 양방향 : 구글 giLog 캘린더에서 고치거나 새로 만든 내 일정도 받아 옴, 민원·할 일 마감은 한 방향"),
    clone(dsh, "        - \"구글 할 일로 보내기\" 사용 시 마감은 구글 할 일 목록으로 내보내고 완료 체크 양방향 반영"),
    clone(dsh, "        - 바뀐 일정만 저절로 보내고, 실패하면 사유를 표시하고 10분마다 다시 시도"),
    clone(dsh, "        - 구글 일정 색은 11가지뿐이라 비슷한 색으로 바꿔 내보냄"),
    clone(dsh, "        - 민원인 이름·연락처·민원 내용 등은 어떤 경우에도 내보내지 않음"),
]
# 바. 일·주·월 보기
a = find(L, lambda x: x == "  바. 월·주 보기", "상세 바")
rep(L, a, "  바. 월·주 보기", "  바. 일·주·월 보기")
set_pic(L, frame_after(L, a), "cal_바", **CROP)
o = frame_after(L, a) + 1
old = L[o:o + 7]
assert text(old[0]).strip().startswith("○") and text(old[6]).strip().startswith("- 상단"), [text(x)[:20] for x in old]
L[o:o + 7] = [clone(old[0], "    ○ 월간 흐름과 일간 시간표를 모두 확인하도록 일·주·월 세 가지 보기 제공"),
              old[1], old[2],
              clone(old[3], "      3) 일 보기 : 하루를 0~24시 시간 칸으로 표시, 미니달력 날짜 더블클릭으로도 전환"),
              clone(old[4], "        - 주·일 보기에서 시간이 겹치는 일정은 나란히 표시"),
              old[4], old[5], old[6]]
rep(L, find(L, lambda x: x.strip() == "4) 오늘 칸은 연보라 바탕에 상단 띠로 표시", "오늘 칸"), "연보라 바탕에 상단 띠로 표시", "연보라 바탕, 클릭해 고른 날 칸은 2px 테두리로 표시")
# 구글 캘린더 연동 준비
j = find(L, lambda x: x.strip().startswith("1) 보낼 것(내 일정·민원 마감·할 일 마감) 켜기·끄기 선택"), "준비 나 1")
L.insert(j + 1, clone(L[j], "      2) 연동 방향 : 한 방향(처음 값) 또는 양방향 선택(캘린더 04 다.)"))
j = find(L, lambda x: x.strip().startswith('4) "구글 로그인이 풀렸어요.'), "준비 다 4")
L[j] = clone(L[j], "      4) \"풀렸어요\"(구글 상자) 또는 \"구글 로그인이 풀렸어요\" : [다시 로그인] 클릭, 7일마다 한 번 필요", K7)
log.append("캘린더 미니달력·구글 상자·일주월·고른 날·준비 연동 방향")
put(7, h, L, t)

# ======================================================================= 9 업무일지
E.edit(9, "- 가져오기는 덮어쓰기·대체하기 중 선택", "덮어쓰기·대체하기 중 선택", "덮어쓰기·대체하기(지우기 전 백업) 중 선택")
h, L, t = paras(9)
j = find(L, lambda x: x.strip().startswith("- 가져오기는 덮어쓰기·대체하기"), "일지 엑셀")
L.insert(j + 1, clone(L[j], "        - 내보낸 파일을 다시 가져와도 메모 표·칸 안 줄 바꿈·구분 없는 기록까지 그대로, 연락처 앞자리 0도 유지"))
put(9, h, L, t)

# ======================================================================= 10 업무연락처
E.edit(10, "- 대체하기 : 현재 연락처를 모두 삭제하고", "파일 내용만 유지", "파일 내용만 유지(지우기 전 백업)")

# ======================================================================= 11 설정
h, L, t = paras(11)
K11 = keycp(L)
set_pic(L, frame_after(L, find(L, lambda x: x == "02 화면", "02")), "set_screen")
rep(L, find(L, lambda x: x.strip().startswith("아. 모듈별 설정 :"), "03 아"), "탐색기·민원대장·민원처리", "탐색기·민원대장·민원지도·민원처리")
set_pic(L, frame_after(L, find(L, lambda x: x == "  라. 모듈", "라")), "set_라", **CROP)
rep(L, find(L, lambda x: x.strip().startswith("- 자동 백업 : 앱을 열 때"), "자동 백업"), "앱을 열 때 하루 한 번", "잠금을 풀 때 하루 한 번")
j = find(L, lambda x: x.strip().startswith("- 자료가 손상되면 잠금 화면의"), "손상")
L[j] = clone(L[j], "        - 자료가 손상되면 잠금 화면에 비밀번호 틀림과 다른 붉은 띠와 [○월 ○일 백업으로 되살리기] 표시, 다른 백업도 선택 가능", K11)
j = find(L, lambda x: x.strip().startswith("- 오른쪽 Alt는 한/영 키라"), "키 설정 끝")
L.insert(j + 1, clone(L[j], "        - \"지도에서 보기\"(처음 값 Ctrl+M) : 민원대장에서 고른 민원을 민원지도에서 바로 보기"))
# 모듈별 설정: 민원지도 카드 끼우기, 뒤 카드 번호 하나씩
for old_n, new_n, name in [(6, 7, "업무일지"), (5, 6, "캘린더"), (4, 5, "집행현황"), (3, 4, "민원처리")]:
    rep(L, find(L, lambda x, nm=name, n=old_n: x.strip() == f"{n}) {nm} 카드", name), f"{old_n}) {name} 카드", f"{new_n}) {name} 카드")
j = find(L, lambda x: x.strip() == "4) 민원처리 카드", "민원처리 카드")
card_h = L[j]
dsh = L[j + 1]
fr = L[frame_after(L, j + 4)]
L[j:j] = [clone(card_h, "      3) 민원지도 카드"),
          clone(dsh, "        - 분야 : 도로·하천·공원 중 선택, 배경 층과 패널 목록이 분야에 맞춰 바뀜(하천은 등급별 목록)"),
          clone(dsh, "        - 카카오 JavaScript 키 : 비워 두면 설치 파일에 넣어 둔 키 사용, 다른 키로 바꿀 때만 입력"),
          clone(dsh, "        - 지도 자료 : 기록앱에 들어 있는 연속지적도·도로·하천 자료 날짜, 새 자료는 다음 설치 파일로 갱신"),
          frame(fr, "set_map", scale=None, max_h=hp.CROP_MAX_H)]
j = find(L, lambda x: x.strip().startswith("- 구글 연동 : [구글 로그인] 후"), "캘린더 카드")
L.insert(j + 1, clone(L[j + 1] if text(L[j + 1]).strip().startswith("-") else L[j], "        - 연동 방향 : 한 방향(처음 값)·양방향 선택, 캘린더 구글 상자에 표시"))
set_pic(L, frame_after(L, find(L, lambda x: x.strip().startswith("- 민원인 이름·연락처는 어떤 경우에도 구글로"), "캘린더 카드 그림")), "set_cal", scale=None, max_h=hp.CROP_MAX_H)
rep(L, find(L, lambda x: x.strip().startswith('1) 설정 맨 아래 "자료 지우기" 카드'), "자료 지우기 1"), '설정 맨 아래 "자료 지우기" 카드', '모듈별 설정 카드 아래(정보 위) "자료 지우기" 카드')
log.append("설정 민원지도 카드·키·자동 백업·손상 띠·연동 방향·자료 지우기 자리")
put(11, h, L, t)

# ======================================================================= 띠·표지·목차


def transparent(path):
    im = Image.open(path).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            if abs(r - 239) <= 2 and abs(g - 239) <= 2 and abs(b - 242) <= 2:
                px[x, y] = (r, g, b, 0)
    o = io.BytesIO()
    im.save(o, "PNG", optimize=True)
    return o.getvalue()


def href(bid):
    return re.search(rf'<opf:item id="{bid}" href="([^"]+)"', hpf).group(1)


ORDER = ["overview", "explorer", "complaints", "process", "budget", "bstatus", "calendar", "todo", "journal", "contacts", "settings"]
for i, key in enumerate(ORDER):
    m = MP[f"Contents/masterpage{i}.xml"]
    bid = re.search(r'binaryItemIDRef="([^"]+)"', m).group(1)
    replace_bin[href(bid)] = transparent(os.path.join(FRONT, f"band_{key}.png"))
mp2 = MP["Contents/masterpage2.xml"]
bid_map = new_bin(transparent(os.path.join(FRONT, "band_map.png")))
mp11 = re.sub(r'binaryItemIDRef="[^"]+"', f'binaryItemIDRef="{bid_map}"', mp2).replace('id="masterpage2"', 'id="masterpage11"')
mp11 = re.sub(r'(<hp:(?:rect|pic) [^>]*?id=")(\d+)', lambda x: x.group(1) + str(random.randint(1_000_000_000, 2_000_000_000)), mp11)
MP["Contents/masterpage11.xml"] = mp11
s0 = S[0]
cov, toc = [re.search(r'binaryItemIDRef="([^"]+)"', m.group(0)).group(1) for m in re.finditer(r"<hp:pic .*?</hp:pic>", s0, re.S)][:2]
replace_bin[href(cov)] = transparent(os.path.join(FRONT, "cover.png"))
replace_bin[href(toc)] = transparent(os.path.join(FRONT, "toc.png"))
log.append("띠 12·표지·목차 그림")

# ======================================================================= 쓰기(민원지도는 section4, 뒤는 하나씩 밀림)
newsec = {f"Contents/section{k}.xml": S[k] for k in range(0, 4)}
newsec["Contents/section4.xml"] = MAPSEC
for k in range(4, 12):
    newsec[f"Contents/section{k + 1}.xml"] = S[k]
hpf = hpf.replace('<opf:item id="section11" href="Contents/section11.xml" media-type="application/xml"/>',
                  '<opf:item id="section11" href="Contents/section11.xml" media-type="application/xml"/>'
                  '<opf:item id="section12" href="Contents/section12.xml" media-type="application/xml"/>'
                  '<opf:item id="masterpage11" href="Contents/masterpage11.xml" media-type="application/xml"/>', 1)
assert "section12" in hpf
hpf = hpf.replace('<opf:itemref idref="section11" linear="yes"/>', '<opf:itemref idref="section11" linear="yes"/><opf:itemref idref="section12" linear="yes"/>', 1)
hpf = hpf.replace("</opf:manifest>", "".join(f'<opf:item id="{b}" href="BinData/{b}.png" media-type="image/png" isEmbeded="1"/>' for b in bins) + "</opf:manifest>", 1)
header = header.replace('secCnt="12"', 'secCnt="13"', 1)
with zipfile.ZipFile(out, "w") as zo:
    done = set()
    for it in z.infolist():
        n = it.filename
        d = z.read(n)
        if n in newsec:
            d = newsec[n].encode()
        elif n in MP:
            d = MP[n].encode()
        elif n == "Contents/content.hpf":
            d = hpf.encode()
        elif n == "Contents/header.xml":
            d = header.encode()
        elif n in replace_bin:
            d = replace_bin[n]
        zi = zipfile.ZipInfo(n, date_time=it.date_time)
        zi.compress_type, zi.external_attr = it.compress_type, it.external_attr
        zo.writestr(zi, d)
        done.add(n)
    for n in ["Contents/section12.xml", "Contents/masterpage11.xml"]:
        zo.writestr(n, (newsec.get(n) or MP[n]).encode(), compress_type=zipfile.ZIP_DEFLATED)
    for b, data in bins.items():
        zo.writestr(f"BinData/{b}.png", data, compress_type=zipfile.ZIP_STORED)
print("\n".join(log))
print("만듦", out)
