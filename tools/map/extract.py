"""연속지적도(경기도 zip) → 파주시 필지 표 CSV. 사용자 컴퓨터에서 돌려요(zip 약 700MB, 1분쯤).

    python extract.py AL_D002_41_20261008.zip
    gzip -9 work/paju_parcels.csv  → tools/map/source/paju_parcels_v20261008.csv.gz
"""
import zipfile, struct, sys, time, os
Z = sys.argv[1]  # 브이월드 연속지적도형정보 경기도 zip, 예 AL_D002_41_20261008.zip
STEM = os.path.basename(Z)[:-4]
PARTS = [STEM] + [f"{STEM}({i})" for i in range(2,7)]
PREFIX = b"41480"
z = zipfile.ZipFile(Z)
os.makedirs("work", exist_ok=True)
out_path = "work/paju_parcels.csv"  # 끝나면 gzip해 tools/map/source/paju_parcels_v<날짜>.csv.gz로
done_path = "work/done_parts.txt"  # 끊겨도 이어서 해요
done = set(open(done_path).read().split()) if os.path.exists(done_path) else set()
mode = "a" if done else "w"
out = open(out_path, mode, encoding="utf-8")
if mode == "w":
    out.write("pnu,bjd,addr,jibun,x5181,y5181,xmin,ymin,xmax,ymax\n")
for part in PARTS:
    if part in done: continue
    t0 = time.time()
    dbf = z.open(part + ".dbf"); shp = z.open(part + ".shp")
    h = dbf.read(32); nrec, hlen, rlen = struct.unpack("<xxxxIHH", h[:12]); dbf.read(hlen - 32)
    shp.read(100)
    hit = 0
    for i in range(nrec):
        r = dbf.read(rlen)
        rh = shp.read(8)
        if len(rh) < 8: break
        clen = struct.unpack(">i", rh[4:8])[0] * 2
        c = shp.read(clen)
        pnu = r[10:29]
        if not pnu.startswith(PREFIX): continue
        st = struct.unpack("<i", c[:4])[0]
        if st in (5, 15, 25) and len(c) >= 36:
            xmin, ymin, xmax, ymax = struct.unpack("<4d", c[4:36])
        elif st in (1, 11, 21):
            x, y = struct.unpack("<2d", c[4:20]); xmin=xmax=x; ymin=ymax=y
        else:
            continue
        bjd = r[29:39].decode("cp949", "replace").strip()
        addr = r[39:293].decode("cp949", "replace").strip()
        jibun = r[303:503].decode("cp949", "replace").strip()
        cx = (xmin + xmax) / 2; cy = (ymin + ymax) / 2 - 100000
        out.write(f"{pnu.decode()},{bjd},{addr},{jibun},{cx:.1f},{cy:.1f},{xmin:.1f},{ymin-100000:.1f},{xmax:.1f},{ymax-100000:.1f}\n")
        hit += 1
    out.flush()
    with open(done_path, "a") as d: d.write(part + "\n")
    print(part, "records", nrec, "paju", hit, f"{time.time()-t0:.0f}s", flush=True)
print("ALL DONE", flush=True)
