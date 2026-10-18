# census.py 결과를 묶어 보여 줘요: python3 report.py 결과.json [더.json ...]
import json, sys
from collections import defaultdict
for f in sys.argv[1:]:
    R = json.load(open(f))
    g = defaultdict(list)
    for r in R:
        g[(r["tag"], r["cls"].split(".")[0])].append(r["d"])
    ok = sum(1 for r in R if r["d"] in (0, -1))
    print(f"== {f}: {ok}/{len(R)} = {100*ok/max(1,len(R)):.1f}%")
    bad = [(k, v) for k, v in g.items() if any(d not in (0, -1) for d in v)]
    bad.sort(key=lambda kv: -sum(d not in (0, -1) for d in kv[1]))
    for (tag, cls), v in bad[:40]:
        n = sum(d not in (0, -1) for d in v)
        vals = sorted(set(v))
        print(f"  {n:3}/{len(v):<3} {tag:8} .{cls:28} d={vals}")
