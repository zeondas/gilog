#!/usr/bin/env python3
"""주소정보누리집 "도로명주소 한글" 전체자료(경기도, cp949)에서 파주시 줄만 뽑아 data/paju_roadaddr.txt 모양으로 써요.

쓰는 법:  python3 tools/address/extract.py rnaddrkor_gyunggi.txt > data/paju_roadaddr.txt
한 줄 = 도로명|지하|건물본번|건물부번|읍면동|리|산|지번본|지번부|건물명|행정동  (UTF-8, | 구분, 머리 줄 없음)
- 건물명은 시군구건물명 → 건축물대장건물명 순으로 있는 것.
- 행정동 칸(2026-10-18 더함)이 있으면 앱이 지역을 묻지 않고 바로 채워요(금촌동·아동동처럼 행정동 여럿에 걸친 법정동).
"""
import sys

# 원본 칸 순서(0부터): 관리번호|법정동코드|시도|시군구|읍면동|법정리|산|지번본|지번부|도로명코드|도로명|지하|건물본번|건물부번|
#                      행정동코드|행정동명|우편번호|이전도로명주소|효력발생일|공동주택|이동사유|건축물대장건물명|시군구건물명|비고
SIGUNGU, EMD, RI, SAN, JM, JS, ROAD, UNDER, BM, BS, ADM, BLDG_REG, BLDG_SGG = 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 15, 21, 22


def main(path: str) -> None:
    rows = []
    with open(path, encoding="cp949", errors="replace") as f:
        for line in f:
            c = line.rstrip("\r\n").split("|")
            if len(c) < 23 or c[SIGUNGU] != "파주시":
                continue
            bldg = (c[BLDG_SGG] or c[BLDG_REG]).strip()
            row = [c[ROAD], c[UNDER], c[BM], c[BS], c[EMD], c[RI], c[SAN], c[JM], c[JS], bldg.replace("|", " "), c[ADM]]
            rows.append("|".join(x.strip() for x in row) + "\n")
    n = len(rows)
    print(f"파주시 {n:,}줄", file=sys.stderr)
    if n < 40000:
        print("줄 수가 너무 적어요 — 받은 파일이 경기도 전체자료인지 확인해 주세요.", file=sys.stderr)
        sys.exit(1)
    sys.stdout.writelines(rows)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
