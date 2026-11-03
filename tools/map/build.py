"""민원 지도 앱 자료 만들기 (2026-11-02 민원 지도 세션).

넣는 것(모두 tools/map/source/):
  paju_parcels_v<날짜>.csv.gz   연속지적도에서 파주시만 뽑은 표(extract.py가 만듦)
  paju_roadparcels_2m.bin.gz    지목 '도' 필지 테두리(roads.py가 만듦, EPSG:5181 정수 m)
  kras_paju_road_<날짜>.dxf.gz  KRAS 연속주제도 DXF – 도로(옛 Bessel 중부원점 EPSG:5174)
  kras_paju_river_<날짜>.dxf.gz KRAS 연속주제도 DXF – 하천구역·소하천구역(5174)
  kras_paju_park_<날짜>.dxf.gz  KRAS 연속주제도 DXF – 공간시설(공원, 5174)

만드는 것(data/map/, 앱에 들어가요):
  paju_parcels.bin.gz  지번 → 좌표 표(core가 읽음)
  paju_layers.bin.gz   배경 아홉 층(화면이 읽음) – 도로 넷 + 국가하천·지방하천·소하천·공원 + 파주 바깥 경계(--outer로 이 층만 다시)

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


def read_dxf(pat="kras_paju_road_*.dxf.gz"):
    from pyproj import Transformer

    path = newest(pat)
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


# 국가하천 고르기(사용자 11-02 23:23·23:28): 한강·임진강 전 구간 + 공릉천 전체 + 문산천 광탄면 경계 아래.
# 자료에 등급 표시가 없어 조각 모양으로 골라요 – 평균 폭(넓이×2 ÷ 둘레)이 이보다 넓은 하천구역 조각이 국가하천이에요.
# 2026-11-02 자료: 국가 조각 중 가장 좁은 것 96m(임진강 적성면 위쪽) · 지방 조각 중 가장 넓은 것 88m(문산천 광탄면 안).
NATIONAL_MIN_WIDTH = 92.0


def river_layers():
    from shapely.geometry import Polygon

    ents = read_dxf("kras_paju_river_*.dxf.gz")
    nat, loc, small = [], [], []
    for e in ents:
        if len(e["pts"]) < 4:
            continue
        if e["layer"] == "연속주제_하천_용도구역":
            poly = Polygon(e["pts"]).buffer(0)
            width = 2 * poly.area / max(poly.length, 1e-9)
            (nat if width > NATIONAL_MIN_WIDTH else loc).append(e["pts"])
        elif e["layer"] == "연속주제_소하천_소하천구역":
            small.append(e["pts"])
    assert 10 <= len(nat) <= 40, f"국가하천 조각 {len(nat)} – 자료가 바뀌었으면 NATIONAL_MIN_WIDTH를 다시 봐요"
    print(f"하천: 국가 {len(nat)} · 지방 {len(loc)} · 소하천 {len(small)}")
    return [[("", [simplify_ring(r, 2.0)]) for r in rs] for rs in (nat, loc, small)]


def park_layer():
    # 공원·녹지는 나누지 않아요(사용자 11-02 23:23) – 공간시설 층 전부(색 3·1·7)를 공원 한 층으로.
    ents = read_dxf("kras_paju_park_*.dxf.gz")
    rs = [e["pts"] for e in ents if e["layer"] == "연속주제_국토계획_공간시설" and len(e["pts"]) >= 4]
    print(f"공원: {len(rs)}")
    return [("", [simplify_ring(r, 2.0)]) for r in rs]


# 도로 세 층 위계(✔5, 사용자 11-02 23:54): 도로구역 > 도시계획도로 > 지목 '도'.
# 위층이 있는 곳은 아래층에서 잘라내요 – 자료끼리 1~3m 어긋나 위층 가장자리 밖으로 아래층이 하얗게 삐져나오던 것(어둡게에서 특히)을 없애요.
# 자르기 전에 모두 1m 격자에 맞춰(앱 자료가 m 정수라) 잘린 가장자리가 위층 가장자리와 꼭 맞아요 – 틈이 안 생겨요.
# 잘린 조각 중 평균 폭(넓이×2 ÷ 둘레) 3m 아래 띠나 40m² 아래 부스러기는 지워요(위층에 거의 덮인 어긋남 띠).
SLIVER_WIDTH = 3.0
SLIVER_AREA = 40.0


def road_hierarchy(zone_rings, plan_rings, road_rings):
    import shapely
    from shapely.geometry import Polygon
    from shapely.geometry.polygon import orient
    from shapely.ops import unary_union
    from shapely.strtree import STRtree

    def poly(ring, tol):
        g = Polygon(simplify_ring(ring, tol) if tol else ring).buffer(0)
        return shapely.set_precision(g, 1.0)

    def parts(g):
        return [x for x in getattr(g, "geoms", [g]) if x.geom_type == "Polygon" and not x.is_empty]

    def keep(x):
        return x.area >= SLIVER_AREA and 2 * x.area / max(x.length, 1e-9) >= SLIVER_WIDTH

    def feat(polys):
        out = []
        for x in polys:
            x = orient(x, 1.0)  # 바깥 고리와 구멍 고리의 방향을 반대로 – 칠하기(nonzero)에서 구멍이 비어요
            rings = [list(x.exterior.coords)] + [list(h.coords) for h in x.interiors]
            out.append(("", rings))
        return out

    def cut(polys, cutters, label):
        tree = STRtree(cutters)
        out, cutn = [], 0
        for p in polys:
            idx = tree.query(p, predicate="intersects")
            if len(idx) == 0:
                out += parts(p)
                continue
            cutn += 1
            rest = shapely.set_precision(p.difference(unary_union([cutters[i] for i in idx])), 1.0)
            out += [x for x in parts(rest) if keep(x)]
        print(f"{label}: 잘린 조각 {cutn:,} · 남은 면 {len(out):,}")
        return out

    zone = [z for r in zone_rings if len(r) >= 4 for z in parts(poly(r, 3.0))]
    plan = [z for r in plan_rings if len(r) >= 4 for z in parts(poly(r, 3.0))]
    road = [z for r in road_rings if len(r) >= 4 for z in parts(poly(r, 0))]
    plan_cut = cut(plan, zone, "도시계획도로 − 도로구역")
    road_cut = cut(road, zone + plan, "지목 도 − (도로구역 ∪ 도시계획도로)")
    # 겹침이 남지 않았는지 재요(1m 격자 맞춤에서 생기는 부스러기만 – 거의 0이어야 해요)
    Z = unary_union(zone)
    left = unary_union(plan_cut).intersection(Z).area + unary_union(road_cut).intersection(unary_union([Z] + plan_cut)).area
    print(f"남은 겹침 {left:,.0f}m²")
    assert left < 2000, "위층 밑에 아래층이 남았어요"
    return feat(zone), feat(plan_cut), feat(road_cut)


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

    zone, plan, road = road_hierarchy(by("연속주제_도로_용도구역"), by("연속주제_국토계획_교통시설"), read_roadparcels())
    layers = [
        (1, "지목 도", road),
        (2, "도시계획도로", plan),
        (3, "도로구역", zone),
        (4, "읍면동 경계", [(n, [r]) for n, r in feats]),
    ]
    nat, loc, small = river_layers()
    layers += [(5, "국가하천", nat), (6, "지방하천", loc), (7, "소하천", small), (8, "공원", park_layer())]
    layers += [(9, "파주 바깥 경계", outer_layer([r for _, r in feats]))]
    write_layers(layers)


def outer_layer(emd_rings):
    """파주 바깥 경계(11-03 ✔4): 읍면동 경계를 합친 바깥 테두리만 – 화면이 굵은 남색 선으로 그려요.
    경계끼리 1m 안팎 틈이 있어 20m 부풀렸다 줄여 메우고, 1km² 넘는 덩어리의 바깥 고리만 남겨요."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    u = unary_union([Polygon(r).buffer(0) for r in emd_rings if len(r) >= 4]).buffer(20).buffer(-20)
    parts = [u] if u.geom_type == "Polygon" else list(u.geoms)
    out = [("파주시", [simplify_ring([(round(x), round(y)) for x, y in g.exterior.coords], 3.0) for g in parts if g.area > 1e6])]
    print("바깥 경계 고리", len(out[0][1]), "개")
    return out


def write_layers(layers):
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


def add_outer_only():
    """원본 DXF 없이 이미 만든 자료에 바깥 경계(층 9)만 더하거나 바꿔요: python tools/map/build.py --outer"""
    raw = gzip.open(os.path.join(OUT, "paju_layers.bin.gz")).read()
    assert raw[:4] == b"PJL1"
    o, n, layers = 5, raw[4], []
    for _ in range(n):
        lid, nf = struct.unpack_from("<BI", raw, o)
        o += 5
        fs = []
        for _ in range(nf):
            nl = raw[o]
            name = raw[o + 1 : o + 1 + nl].decode()
            o += 1 + nl
            (nr,) = struct.unpack_from("<H", raw, o)
            o += 2
            rings = []
            for _ in range(nr):
                np_, x, y = struct.unpack_from("<Iii", raw, o)
                o += 12
                r = [(x, y)]
                for _ in range(np_ - 1):
                    dx, dy = struct.unpack_from("<hh", raw, o)
                    o += 4
                    x, y = x + dx, y + dy
                    r.append((x, y))
                rings.append(r)
            fs.append((name, rings))
        if lid != 9:
            layers.append((lid, "", fs))
    emd = [r for lid, _, fs in layers if lid == 4 for _, rs in fs for r in rs]
    layers.append((9, "파주 바깥 경계", outer_layer(emd)))
    write_layers(layers)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    if "--outer" in sys.argv:
        add_outer_only()
        sys.exit(0)
    recs, names = build_parcels()
    build_layers(recs, names)
