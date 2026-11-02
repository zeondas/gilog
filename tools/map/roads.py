"""연속지적도(경기도 zip) → 파주시 지목 '도' 필지 테두리(2m 간추림, EPSG:5181 정수 m). 사용자 컴퓨터에서 돌려요.

    python roads.py AL_D002_41_20261008.zip  → paju_roadparcels_2m.bin.gz (tools/map/source/로)
"""
import zipfile, struct, gzip, io, time, math
import sys, os
Z=sys.argv[1]; z=zipfile.ZipFile(Z); STEM=os.path.basename(Z)[:-4]
# 파주 필지가 든 조각(2026-10-08 자료는 (2)·(3)) – 다른 날짜 자료면 extract.py가 알려 준 조각으로 바꿔요.
PARTS=[f"{STEM}({i})" for i in (2,3)]
def dp(pts, tol):
    if len(pts)<3: return pts
    keep=[False]*len(pts); keep[0]=keep[-1]=True; st=[(0,len(pts)-1)]
    while st:
        a,b=st.pop(); ax,ay=pts[a]; bx,by=pts[b]; dx,dy=bx-ax,by-ay; L=math.hypot(dx,dy) or 1e-9
        mi,md=-1,tol
        for i in range(a+1,b):
            px,py=pts[i]; d=abs(dy*px-dx*py+bx*ay-by*ax)/L
            if d>md: md,mi=d,i
        if mi>0: keep[mi]=True; st.append((a,mi)); st.append((mi,b))
    return [p for p,k in zip(pts,keep) if k]
t0=time.time(); polys=0; v_raw=0; v_s=0; out=io.BytesIO()
for part in PARTS:
    dbf=z.open(part+".dbf"); shp=z.open(part+".shp")
    h=dbf.read(32); nrec,hlen,rlen=struct.unpack("<xxxxIHH",h[:12]); dbf.read(hlen-32); shp.read(100)
    for i in range(nrec):
        r=dbf.read(rlen); rh=shp.read(8)
        if len(rh)<8: break
        clen=struct.unpack(">i",rh[4:8])[0]*2; c=shp.read(clen)
        if not r[10:29].startswith(b"41480"): continue
        jib=r[303:503].decode("cp949","replace").rstrip()
        if not jib.endswith("도"): continue
        st=struct.unpack("<i",c[:4])[0]
        if st not in (5,15,25): continue
        nparts,npts=struct.unpack("<ii",c[36:44]); parts=struct.unpack("<%di"%nparts,c[44:44+4*nparts])
        base=44+4*nparts; pts=struct.unpack("<%dd"%(2*npts),c[base:base+16*npts])
        rings=[]
        for k in range(nparts):
            a=parts[k]; b=parts[k+1] if k+1<nparts else npts
            ring=[(pts[2*j],pts[2*j+1]-100000) for j in range(a,b)]
            v_raw+=len(ring)
            if len(ring)>3 and ring[0]==ring[-1]:
                h=len(ring)//2; s=dp(ring[:h+1],2.0)[:-1]+dp(ring[h:],2.0)
            else: s=dp(ring,2.0)
            v_s+=len(s); rings.append(s)
        polys+=1
        for s in rings:
            out.write(struct.pack("<H",len(s))); px,py=0,0
            x0,y0=int(s[0][0]),int(s[0][1]); out.write(struct.pack("<ii",x0,y0)); px,py=x0,y0
            for x,y in s[1:]:
                x,y=int(x),int(y); out.write(struct.pack("<hh",max(-32768,min(32767,x-px)),max(-32768,min(32767,y-py)))); px,py=x,y
raw=out.getvalue(); gz=gzip.compress(raw,9)
print("도 필지",polys,"꼭짓점",v_raw,"→ 2m",v_s,"이진 MB",round(len(raw)/1e6,2),"gz MB",round(len(gz)/1e6,2),f"{time.time()-t0:.0f}s")
open("paju_roadparcels_2m.bin.gz","wb").write(gz)
