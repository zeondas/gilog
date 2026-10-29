"""모양 지킴이 – 두 번 찍은 장면을 한 점씩 비교해요.

  python3 tools/guard/compare.py <기준 폴더> <고친 뒤 폴더> <결과 폴더> [--allow 장면 ...]

장면마다 다른 점 수를 세고(색이 10 넘게 다른 점만 – 모서리 가장자리 흔들림 1~7은 빼요), 다르면 결과 폴더에 "장면.png"(고친 뒤 그림 위에 다른 곳을 빨갛게, 옆에 기준)를 남겨요.
--allow로 적은 장면(바뀌기로 한 장면)은 달라도 통과, 나머지는 0점이어야 통과예요.
같은 빌드를 두 번 찍어도 흔들리는 장면은 TOLERANCE 점수까지 통과예요(2026-10-29 검사 자동화 ✔1 – 그 장면도
styles.py 계산 모양 비교는 0이어야 해서 진짜 차이는 거기서 잡혀요). --tolerate 장면=점수 로 더하거나 바꿀 수 있어요.
결과 폴더의 report.md에 표로 적고, 통과 못 하면 끝 값 1이에요.
"""
import glob
import os
import sys

from PIL import Image, ImageChops

NOISE = 10
# 같은 빌드를 두 번 찍어도 흔들리는 장면(README "알아 둘 것") – 이 점수까지는 "같음"으로 봐요.
TOLERANCE = {
    "journal_memo": 20,  # 편집기 글자 한두 점(10-29 같은 빌드 두 번: 1점)
    "complaints_newrow_baddate": 2000,  # 빨간 테두리 날짜 칸(main끼리 1,400점)
    "files_find_baddate": 2000,  # 찾기 창 빨간 테두리 날짜 칸
}


def main():
    a = sys.argv[1:]
    allow = set()
    tol = dict(TOLERANCE)
    while "--tolerate" in a:
        i = a.index("--tolerate")
        k, _, v = a[i + 1].partition("=")
        tol[k] = int(v)
        del a[i : i + 2]
    if "--allow" in a:
        i = a.index("--allow")
        allow = set(a[i + 1:])
        a = a[:i]
    base, cur, out = a
    os.makedirs(out, exist_ok=True)
    names = sorted({os.path.basename(p)[:-4] for p in glob.glob(os.path.join(base, "*.png")) + glob.glob(os.path.join(cur, "*.png"))})
    rows, bad = [], []
    for n in names:
        pb, pc = os.path.join(base, n + ".png"), os.path.join(cur, n + ".png")
        if not (os.path.exists(pb) and os.path.exists(pc)):
            why = "기준에 없음" if not os.path.exists(pb) else "고친 뒤에 없음"
            fail = os.path.join(cur if os.path.exists(pb) else base, n + ".fail.txt")
            if os.path.exists(fail):
                why += " – " + open(fail, encoding="utf-8").read().strip()
            rows.append((n, "–", why))
            if n not in allow:
                bad.append(n)
            continue
        ib, ic = Image.open(pb).convert("RGB"), Image.open(pc).convert("RGB")
        if ib.size != ic.size:
            rows.append((n, "크기 다름", f"{ib.size} → {ic.size}"))
            if n not in allow:
                bad.append(n)
            continue
        # 모서리(스퀴클) 가장자리는 찍을 때마다 색이 1~7 흔들려요 – 한 칸이라도 10 넘게 다를 때만 "다름"
        diff = ImageChops.difference(ib, ic)
        d = Image.merge("RGB", [ch.point(lambda v: 255 if v > NOISE else 0) for ch in diff.split()]).convert("L").point(lambda v: 255 if v else 0)
        cnt = d.histogram()[255]
        if cnt and cnt <= tol.get(n, 0):
            rows.append((n, str(cnt), f"흔들림 허용 {tol[n]}점 안"))
        elif cnt:
            box = d.getbbox()
            red = Image.new("RGB", ic.size, (230, 0, 0))
            shown = Image.composite(red, ic, d)
            pair = Image.new("RGB", (ic.width * 2 + 8, ic.height), "white")
            pair.paste(shown, (0, 0))
            pair.paste(ib, (ic.width + 8, 0))
            pair.save(os.path.join(out, n + ".png"))
            ok = n in allow
            rows.append((n, str(cnt), f"다른 곳 x{box[0]}–{box[2]} y{box[1]}–{box[3]}" + (" (바뀌기로 한 장면)" if ok else "")))
            if not ok:
                bad.append(n)
        else:
            rows.append((n, "0", "같음"))
    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
        f.write("| 장면 | 다른 점 | 메모 |\n| --- | --- | --- |\n")
        for r in rows:
            f.write("| " + " | ".join(r) + " |\n")
        f.write(f"\n{'통과' if not bad else '통과 못 함: ' + ', '.join(bad)}\n")
    print(("통과" if not bad else "통과 못 함: " + ", ".join(bad)) + f" ({len(names)}장면)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
