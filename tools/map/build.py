"""민원 지도 앱 자료 만들기 (2026-11-02 민원 지도 세션).

넣는 것(모두 tools/map/source/):
  paju_parcels_v<날짜>.csv.gz   연속지적도에서 파주시만 뽑은 표(extract.py가 만듦)
  paju_roadparcels_2m.bin.gz    지목 '도' 필지 테두리(roads.py가 만듦, EPSG:5181 정수 m)
  kras_paju_road_<날짜>.dxf.gz  KRAS 연속주제도 DXF(옛 Bessel 중부원점 EPSG:5174)

만드는 것(data/map/, 앱에 들어가요):
  paju_parcels.bin.gz  지번 → 좌표 표(core가 읽음)
  paju_layers.bin.gz   배경 네 층(화면이 읽음)

좌표는 모두 EPSG:5181(중부원점 GRS80, m). DXF만 5174 → 5181로 바꿔요(§7-24, 300m 비낌).

    python3 tools/map/build.py
"""
import csv, glob, gzip, io, math, os, struct, sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "tools", "map", "source")
OUT = os.path.join(ROOT, "data", "map")
CODE_BASE = 4148000000  # 파주시 법정동 코드 앞자리


def newest(pat):
    files = sorted(glob.glob(os.path.join(SRC, pat)))
    if not files:
        sys.exit(f"{pat} 파일이 tools/map/source에 없어요")
    return files[-1]


# ---------- 1. 지번 → 좌표 표 ----------
def build_parcels():
    path = newest("paju_parcels_v*.csv.gz")
    names = {}  # 법정동 코드 → (리·동 이름, 읍면 이름 또는 "")
    recs = []
    for r in csv.DictReader(gzip.open(path, "rt", encoding="utf-8")):
        pnu = r["pnu"]
        code = int(pnu[:10])
        words = r["addr"].split()
        names[code] = (words[-1], words[-2] if len(words) >= 4 else "")
        san = 1 if pnu[10] == "2" else 0
        main, sub = int(pnu[11:15]), int(pnu[15:19])
        recs.append((code - CODE_BASE, san, main, sub, round(float(r["x5181"])), round(float(r["y5181"]))))
    recs.sort()
    buf = io.BytesIO()
    buf.write(b"PJP1")
    buf.write(struct.pack("<H", len(names)))
    for code in sorted(names):
        name, emd = names[code]
        for s in (name, emd):
            b = s.encode()
            buf.write(struct.pack("<B", len(b)) + b)
        buf.write(struct.pack("<I", code - CODE_BASE))
    buf.write(struct.pack("<I", len(recs)))
    for c, san, main, sub, x, y in recs:
        buf.write(struct.pack("<IBHHii", c, san, main, sub, x, y))
    gz = gzip.compress(buf.getvalue(), 9, mtime=0)
    open(os.path.join(OUT, "paju_parcels.bin.gz"), "wb").write(gz)
    print(f"필지 {len(recs):,} · 리·동 {len(names)} · {len(gz)/1e6:.2f}MB ← {os.path.basename(path)}")
    return recs, names


# ---------- 2. 배경 층 ----------
def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        mi, md = -1, tol
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > md:
                md, mi = d, i
        if mi > 0:
            keep[mi] = True
            st.append((a, mi))
            st.append((mi, b))
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(ring, tol):
    # 닫힌 고리는 반으로 나눠 간추려요(한 번에 하면 고리가 무너져요).
    if len(ring) > 3 and ring[0] == ring[-1]:
        h = len(ring) // 2
        return dp(ring[: h + 1], tol)[:-1] + dp(ring[h:], tol)
    return dp(ring, tol)


def read_dxf():
    from pyproj import Transformer

    path = newest("kras_paju_road_*.dxf.gz")
    L = gzip.open(path, "rt", encoding="utf-8", errors="replace").read().split("\n")
    i = L.index("ENTITIES") + 1
    ents, cur = [], None
    while i < len(L) - 1:
        c, v = L[i].strip(), L[i + 1].strip()
        i += 2
        if c == "0":
            if cur and cur["pts"]:
                ents.append(cur)
            cur = {"layer": "", "closed": False, "pts": []} if v == "LWPOLYLINE" else None
            if v == "ENDSEC":
                break
            continue
        if cur is None:
            continue
        if c == "8":
            cur["layer"] = v
        elif c == "70":
            cur["closed"] = bool(int(v) & 1)
        elif c == "10":
            cur["pts"].append([float(v), None])
        elif c == "20":
            cur["pts"][-1][1] = float(v)
    tr = Transformer.from_crs("EPSG:5174", "EPSG:5181", always_xy=True)
    for e in ents:
        e["pts"] = [tr.transform(x, y) for x, y in e["pts"]]
        if e["closed"] and e["pts"][0] != e["pts"][-1]:
            e["pts"].append(e["pts"][0])
    print(f"DXF {len(ents):,}줄 ← {os.path.basename(path)} (5174 → 5181)")
    return ents


def read_roadparcels():
    raw = gzip.open(newest("paju_roadparcels_*.bin.gz")).read()
    rings, o = [], 0
    while o < len(raw):
        (n,) = struct.unpack_from("<H", raw, o)
        x, y = struct.unpack_from("<ii", raw, o + 2)
        o += 10
        ring = [(x, y)]
        for _ in range(n - 1):
            dx, dy = struct.unpack_from("<hh", raw, o)
            o += 4
            x, y = x + dx, y + dy
            ring.append((x, y))
        rings.append(ring)
    return rings


def put_ring(buf, ring):
    pts = [(round(x), round(y)) for x, y in ring]
    buf.write(struct.pack("<I", len(pts)))
    x0, y0 = pts[0]
    buf.write(struct.pack("<ii", x0, y0))
    px, py = x0, y0
    for x, y in pts[1:]:
        dx, dy = x - px, y - py
        assert -32768 <= dx <= 32767 and -32768 <= dy <= 32767, "변이 32km를 넘어요"
        buf.write(struct.pack("<hh", dx, dy))
        px, py = x, y


def build_layers(recs, names):
    from shapely.geometry import Point, Polygon
    from shapely.strtree import STRtree

    ents = read_dxf()
    by = lambda name: [e["pts"] for e in ents if e["layer"] == name]
    emd_rings = by("연속도_행정구역_읍면동")
    # 경계마다 이름 – 그 안에 든 필지의 리·동 이름이 가장 많은 것(법정 읍면 13 + 법정동 22).
    polys = [Polygon(r).buffer(0) for r in emd_rings]
    tree = STRtree(polys)
    votes = [Counter() for _ in polys]
    for c, san, main, sub, x, y in recs[::7]:
        for k in tree.query(Point(x, y), predicate="within"):
            votes[k][c] += 1
    feats = []
    for k, ring in enumerate(emd_rings):
        code = votes[k].most_common(1)[0][0] + CODE_BASE
        name, emd = names[code]
        feats.append((emd or name, simplify_ring(ring, 3.0)))
    print("경계", len(feats), "곳:", " ".join(sorted(f[0] for f in feats)))

    layers = [
        (1, "지목 도", [("", [r]) for r in read_roadparcels()]),
        (2, "도시계획도로", [("", [simplify_ring(r, 3.0)]) for r in by("연속주제_국토계획_교통시설")]),
        (3, "도로구역", [("", [simplify_ring(r, 3.0)]) for r in by("연속주제_도로_용도구역")]),
        (4, "읍면동 경계", [(n, [r]) for n, r in feats]),
    ]
    buf = io.BytesIO()
    buf.write(b"PJL1")
    buf.write(struct.pack("<B", len(layers)))
    for lid, _, fs in layers:
        buf.write(struct.pack("<BI", lid, len(fs)))
        for name, rings in fs:
            b = name.encode()
            buf.write(struct.pack("<B", len(b)) + b)
            buf.write(struct.pack("<H", len(rings)))
            for r in rings:
                put_ring(buf, r)
    gz = gzip.compress(buf.getvalue(), 9, mtime=0)
    open(os.path.join(OUT, "paju_layers.bin.gz"), "wb").write(gz)
    print("층:", " · ".join(f"{t} {len(fs):,}" for _, t, fs in layers), f"· {len(gz)/1e6:.2f}MB")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    recs, names = build_parcels()
    build_layers(recs, names)
