"""모양 지킴이 – 검사(check.yml)에서 한 갈래를 돌려요(2026-10-29 검사 자동화 ✔1).

  python3 tools/guard/ci.py <기준 빌드> <내 빌드> <결과 폴더> --shard 0/4 [--base-tree 폴더] [--base-ref 커밋]

장면(shoot.SCENES)과 동작 시험(behave.CASES)을 갈래 수로 나눠 그 몫만 돌려요(갈래 i = i, i+n, i+2n … 번째).
1) 사진: 기준·내 빌드를 동시에 찍어 compare.py로 견줘요(흔들림 장면은 compare.TOLERANCE 점수까지).
2) 계산 모양: styles.py – 기준에도 있는 장면만.
3) 동작: behave.py – 내 빌드만.

통과로 보는 것:
- 기준(main과 갈라진 곳)의 shoot.py에 없는 장면 = 새로 더한 장면 → 사진·계산 모양 비교는 건너뛰어요(내 빌드에서 찍히기만 하면 돼요).
- 가지의 커밋 메시지에 `guard-allow: 장면 장면 …` 줄이 있으면 그 장면은 바뀌기로 한 장면(사진·계산 모양 차이 통과).
  예: 화면을 일부러 바꾼 커밋에 "guard-allow: screen_03 complaints_menu".
결과 폴더에 report.md(요약)·다른 장면 그림이 남고, GITHUB_STEP_SUMMARY가 있으면 거기에도 적어요. 통과 못 하면 끝 값 1.
"""
import asyncio
import importlib.util
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import behave  # noqa: E402
import shoot  # noqa: E402


def scenes_of(tree):
    """기준 작업 폴더의 shoot.py에 있는 장면 이름 – 없으면 빈 집합"""
    path = os.path.join(tree, "tools", "guard", "shoot.py") if tree else ""
    if not path or not os.path.exists(path):
        return set()
    spec = importlib.util.spec_from_file_location("shoot_base", path)
    mod = importlib.util.module_from_spec(spec)
    old = sys.path[:]
    sys.path.insert(0, os.path.dirname(path))
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.path[:] = old
    return set(mod.SCENES)


def allowed(base_ref):
    """가지 커밋 메시지의 guard-allow: 줄"""
    if not base_ref:
        return set()
    try:
        log = subprocess.run(["git", "log", "--format=%B", f"{base_ref}..HEAD"], capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return set()
    out = set()
    for line in log.splitlines():
        if line.strip().lower().startswith("guard-allow:"):
            out.update(line.split(":", 1)[1].split())
    return out


async def run(*cmd, log):
    t = time.time()
    p = await asyncio.create_subprocess_exec(sys.executable, *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    out, _ = await p.communicate()
    text = out.decode("utf-8", "replace")
    with open(log, "w", encoding="utf-8") as f:
        f.write(text)
    return p.returncode, text, time.time() - t


def tail(text, n=40):
    return "\n".join(text.strip().splitlines()[-n:])


async def main():
    a = sys.argv[1:]

    def opt(name, default=None):
        if name in a:
            i = a.index(name)
            v = a[i + 1]
            del a[i : i + 2]
            return v
        return default

    shard = opt("--shard", "0/1")
    base_tree = opt("--base-tree")
    base_ref = opt("--base-ref")
    base, cur, out = a
    i, n = (int(x) for x in shard.split("/"))
    os.makedirs(out, exist_ok=True)

    names = list(shoot.SCENES)[i::n]
    cases = list(behave.CASES)[i::n]
    in_base = scenes_of(base_tree) if base_tree else set(shoot.SCENES)
    new = [s for s in names if s not in in_base]
    allow = allowed(base_ref)
    same = [s for s in names if s in in_base]
    styled = [s for s in same if s not in allow]

    py = lambda f: os.path.join(HERE, f)  # noqa: E731
    sb, sc = os.path.join(out, "shots_base"), os.path.join(out, "shots_cur")
    t0 = time.time()

    # 1) 사진 – 기준은 기준에 있는 장면만, 내 빌드는 몫 전부(새 장면도 찍히는지 봐요)
    jobs = [run(py("shoot.py"), cur, sc, *names, log=os.path.join(out, "shoot_cur.log"))]
    if same:
        jobs.append(run(py("shoot.py"), base, sb, *same, log=os.path.join(out, "shoot_base.log")))
    shots = await asyncio.gather(*jobs)
    t_shoot = max(s[2] for s in shots)
    cur_fail = [s for s in names if os.path.exists(os.path.join(sc, s + ".fail.txt"))]
    if same:
        cmp = await run(py("compare.py"), sb, sc, os.path.join(out, "diff"), "--allow", *sorted(allow | set(new)), log=os.path.join(out, "compare.log"))
        # 새 장면은 compare.py가 "기준에 없음"으로 보지만 --allow로 넘겨요
        cmp_ok = cmp[0] == 0
    else:
        cmp = (0, "비교할 장면 없음", 0.0)
        cmp_ok = True

    # 2) 계산 모양 · 3) 동작 – 동시에
    jobs = []
    if styled:
        jobs.append(run(py("styles.py"), base, cur, *styled, log=os.path.join(out, "styles.log")))
    if cases:
        jobs.append(run(py("behave.py"), cur, *cases, log=os.path.join(out, "behave.log")))
    res = await asyncio.gather(*jobs)
    sty = res.pop(0) if styled else (0, "건너뜀", 0.0)
    beh = res.pop(0) if cases else (0, "건너뜀", 0.0)
    total = time.time() - t0

    ok = cmp_ok and not cur_fail and sty[0] == 0 and beh[0] == 0
    mark = lambda good: "✅" if good else "❌"  # noqa: E731
    lines = [
        f"### 모양 지킴이 {i + 1}/{n}갈래 {mark(ok)}",
        "",
        f"- 사진 {len(names)}장면(기준과 비교 {len(same)} · 새 장면 {len(new)}) {mark(cmp_ok and not cur_fail)} · {t_shoot:.0f}초",
        f"- 계산 모양 {len(styled)}장면 {mark(sty[0] == 0)} · {sty[2]:.0f}초",
        f"- 동작 {len(cases)}개 {mark(beh[0] == 0)} · {beh[2]:.0f}초",
        f"- 모두 {total:.0f}초",
    ]
    if allow:
        lines.append(f"- 바뀌기로 한 장면(guard-allow): {' '.join(sorted(allow))}")
    if new:
        lines.append(f"- 새 장면(기준에 없음 – 찍히는지만): {' '.join(new)}")
    if cur_fail:
        lines.append(f"- 내 빌드에서 못 찍은 장면: {' '.join(cur_fail)}")
    rep = os.path.join(out, "diff", "report.md")
    if not cmp_ok and os.path.exists(rep):
        bad_rows = [r for r in open(rep, encoding="utf-8").read().splitlines() if r.startswith("| ") and not r.startswith("| ---") and "| 0 |" not in r and "흔들림" not in r and "장면 |" not in r]
        lines += ["", "**사진이 다른 장면**", "", "| 장면 | 다른 점 | 메모 |", "| --- | --- | --- |", *bad_rows]
    if sty[0] != 0:
        lines += ["", "**계산 모양이 다른 장면**", "", "```", tail(sty[1], 60), "```"]
    if beh[0] != 0:
        lines += ["", "**동작 시험**", "", "```", "\n".join(l for l in beh[1].splitlines() if l.startswith("✗")) or tail(beh[1]), "```"]
    text = "\n".join(lines) + "\n"
    with open(os.path.join(out, "report.md"), "w", encoding="utf-8") as f:
        f.write(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(text)
    print(text)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    asyncio.run(main())
