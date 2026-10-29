"""부하 시험 결과(measure.py의 결과.json)를 기준과 견준 표로 적어요(2026-10-29 검사 자동화 ✔2 – load.yml).

  python3 tools/load/report.py 결과.json [요약.md]

기준(docs/loadtest.md, 사용자 1안): 화면 전환 0.2초 · 검색 0.3초 · 거르기 0.2초 · 스크롤 60fps(59 이상이면 통과로 봐요).
기준을 넘어도 실패로 만들지 않아요(끝 값은 늘 0) – 숫자만 적고, 고치는 건 각 화면 세션 몫이에요.
GITHUB_STEP_SUMMARY가 있으면 거기에도 붙여요.
"""
import json
import os
import sys


def limit(name):
    """(기준 값, 단위, 높을수록 좋은지) – 기준 없는 항목은 None"""
    if name.startswith("전환"):
        return 200, "ms", False
    if name.startswith("검색"):
        return 300, "ms", False
    if "거르기" in name:
        return 200, "ms", False
    if name.endswith("fps"):
        return 59, "fps", True
    return None


def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    data = json.load(open(src, encoding="utf-8"))
    rows, over = [], []
    for name, v in data.items():
        m = v["median"]
        lim = limit(name)
        if lim:
            val, unit, high = lim
            ok = m >= val if high else m <= val
            shown = f"{m:.1f}{unit}" if unit == "fps" else f"{m:.0f}ms"
            base = f"{'≥ 60' if high else '≤ ' + str(val)}{unit}"
            rows.append(f"| {name} | {shown} | {base} | {'✅' if ok else '❌'} |")
            if not ok:
                over.append(name)
        else:
            rows.append(f"| {name} | {m:g} | – | 값만 |")
    text = "\n".join(
        [
            "### 부하 시험(3년치 흉내 자료, 5번 중간값, 리눅스 러너)",
            "",
            "| 항목 | 값 | 기준 | 통과 |",
            "| --- | ---: | --- | --- |",
            *rows,
            "",
            ("기준을 넘는 항목: " + ", ".join(over) + " – 실패로 만들지 않아요(각 화면 대기 목록 몫)") if over else "모두 기준 안이에요.",
            "",
        ]
    )
    print(text)
    for path in filter(None, [out, os.environ.get("GITHUB_STEP_SUMMARY")]):
        with open(path, "a", encoding="utf-8") as f:
            f.write(text)


if __name__ == "__main__":
    main()
