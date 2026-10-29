"""한글 매뉴얼의 빈 그림 틀에 앱 화면 그림을 채워요.

  python3 tools/manual/hwpx_pics.py <지킴이 빌드 폴더> <글이 든.hwpx> <결과.hwpx> <짝 json 폴더> <키 ...>

- 짝 json(map_<키>.json): {"scene": 화면 장면, "feats": [{label 가·나·다, name, sel, side 위/아래, hint}], "figs": [{head, scene, sel}]}
- 장(화면)마다 틀 차례 = "2. 화면" 틀 1개 + 상세설명 틀(figs 차례). 틀 개수가 안 맞으면 멈춰요.
- "2. 화면" 그림: 화면을 찍고 기능별 설명과 같은 글자(가·나·다)를 그림 밖 원 + 지시선으로 얹어요(build.py와 같은 모양).
- 상세설명 그림: 그 장면의 메뉴·창만 잘라요. 모두 3배로 찍어 틀 안쪽 폭에 맞춰 넣고, 틀 높이를 그림에 맞춰요.
- 같은 폴더의 extra_scenes_*.py(EXTRA = {이름: (화면, 함수)})가 있으면 장면으로 더해요.
"""
import asyncio
import base64
import glob
import importlib.util
import io
import json
import os
import random
import re
import sys
import zipfile

from PIL import Image
from playwright.async_api import async_playwright

import build
import cap

cap.DPR = 3
FONT = build.FONT
PX = 55          # 상세설명 그림: 화면 1px = 55 HWPUNIT (틀 안쪽 폭을 넘으면 줄여요)


def load_extra(folder):
    for f in glob.glob(os.path.join(folder, "extra_scenes_*.py")):
        spec = importlib.util.spec_from_file_location(os.path.basename(f)[:-3], f)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        cap.SCENES.update(m.EXTRA)


LABEL_HTML = """<!doctype html><meta charset=utf-8><style>
@font-face{font-family:P;src:url(%(font)s) format('woff2');font-weight:100 900}
body{margin:0;background:#fff;font-family:P}
.shot{position:relative;width:%(w)dpx;height:%(th).1fpx}
.frame{position:absolute;left:0;top:%(band)dpx;width:%(w)dpx;height:%(h).1fpx;border:1px solid #D6D4DE;border-radius:4px;overflow:hidden;box-sizing:border-box}
.frame img{display:block;width:100%%;height:100%%}
svg{position:absolute;left:0;top:0;overflow:visible}
.ring{position:absolute;width:22px;height:22px;border-radius:50%%;border:1.5px solid #1C1B22;background:#fff;color:#1C1B22;
 font-size:11.5px;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;box-sizing:border-box}
</style><div class=shot id=s><div class=frame><img src="%(img)s"></div><svg width=%(w)d height=%(th).1f>%(svg)s</svg>%(rings)s</div>"""


async def screen_png(br, url, mp, out):
    """화면 그림 + 가·나·다 표식 → PNG(3배)."""
    ch = {"scene": mp["scene"], "crop": mp.get("crop", ""), "title": mp["scene"], "detail": [],
          "marks": [{"name": f["label"], "sel": f["sel"], "text": "", "hint": f"{f.get('side', '')} {f.get('hint', '')}"}
                    for f in mp["feats"]]}
    missing = []
    sh = await build.shoot_chapter(br, url, ch, missing)
    W, BAND, R = build.IMG_W, build.BAND, 22
    total = BAND * 2 + sh["h"]
    svg, rings = [], []
    for m in sh["marks"]:
        if not m["box"]:
            continue
        cy = R / 2 if m["side"] == "top" else total - R / 2
        y_from = cy + R / 2 if m["side"] == "top" else cy - R / 2
        svg.append(f'<line x1="{m["cx"]:.1f}" y1="{y_from:.1f}" x2="{m["tx"]:.1f}" y2="{m["ty"]:.1f}" stroke="#1C1B22" stroke-width="1"/>'
                   f'<circle cx="{m["tx"]:.1f}" cy="{m["ty"]:.1f}" r="3" fill="#1C1B22" stroke="#fff" stroke-width="1.5"/>')
        rings.append(f'<div class="ring" style="left:{m["cx"] - R / 2:.1f}px;top:{cy - R / 2:.1f}px">{m["name"]}</div>')
    font = "data:font/woff2;base64," + base64.b64encode(open(FONT, "rb").read()).decode()
    html = LABEL_HTML % {"font": font, "w": W, "th": total, "band": BAND, "h": sh["h"], "img": sh["img"], "svg": "".join(svg), "rings": "".join(rings)}
    ctx = await br.new_context(viewport={"width": W + 20, "height": int(total) + 20}, device_scale_factor=3)
    p = await ctx.new_page()
    await p.set_content(html)
    await p.evaluate("() => document.fonts.ready")
    await p.locator("#s").screenshot(path=out)
    await ctx.close()
    return missing


async def fig_png(br, url, fg, out):
    missing = []
    o = await build.shoot_open(br, url, {"scene": fg["scene"], "sel": fg["sel"]}, missing, fg["head"], full=True)
    data = base64.b64decode(o["img"].split(",", 1)[1])
    Image.open(io.BytesIO(data)).convert("RGB").save(out)
    return missing


# ---------- 한글 파일에 넣기 ----------
PIC = ('<hp:pic textWrap="SQUARE" textFlow="BOTH_SIDES" reverse="0" id="{id}" zOrder="{z}" numberingType="PICTURE" lock="0" '
       'dropcapstyle="None" href="" groupLevel="0" instid="{id}"><hp:offset x="0" y="0"/><hp:orgSz width="{w}" height="{h}"/>'
       '<hp:curSz width="{w}" height="{h}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="{cx}" '
       'centerY="{cy}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
       '<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>'
       '</hp:renderingInfo><hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="{w}" y="0"/><hc:pt2 x="{w}" y="{h}"/><hc:pt3 x="0" y="{h}"/>'
       '</hp:imgRect><hp:imgClip left="0" right="{pw}" top="0" bottom="{ph}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>'
       '<hp:imgDim dimwidth="{pw}" dimheight="{ph}"/><hc:img binaryItemIDRef="{bin}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>'
       '<hp:effects/><hp:sz width="{w}" height="{h}" widthRelTo="ABSOLUTE" heightRelTo="ABSOLUTE" protect="0"/>'
       '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" '
       'horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/>'
       '<hp:shapeComment/></hp:pic>')


def fill(tbl, png, bin_id, center_pp, scale_px):
    """빈 틀(1칸 표)에 그림을 넣고 틀 높이를 그림에 맞춰요."""
    tw = int(re.search(r'<hp:sz width="(\d+)"', tbl).group(1))
    ml, mr, mt, mb = (int(x) for x in re.search(r'<hp:cellMargin left="(\d+)" right="(\d+)" top="(\d+)" bottom="(\d+)"', tbl).groups())
    inner = tw - ml - mr
    im = Image.open(png)
    pw, ph = im.size
    w = min(inner, int(pw / 3 * scale_px)) if scale_px else inner
    h = round(w * ph / pw)
    pic = PIC.format(id=random.randint(1_000_000_000, 2_000_000_000), z=random.randint(2, 900), w=w, h=h, cx=w // 2, cy=h // 2,
                     pw=pw * 75, ph=ph * 75, bin=bin_id)
    th = h + mt + mb
    tbl = re.sub(r'(<hp:sz width="\d+" widthRelTo="ABSOLUTE" height=")\d+', lambda m: m.group(1) + str(th), tbl, count=1)
    tbl = re.sub(r'(<hp:cellSz width="\d+" height=")\d+', lambda m: m.group(1) + str(th), tbl, count=1)
    # 칸 안 문단: 가운데 맞춤 + 그림, 옛 줄 배치 정보는 지워 한글이 다시 계산하게
    tbl = re.sub(r'(<hp:subList [^>]*>)<hp:p ([^>]*)paraPrIDRef="\d+"([^>]*)>.*?</hp:p>',
                 lambda m: f'{m.group(1)}<hp:p {m.group(2)}paraPrIDRef="{center_pp}"{m.group(3)}><hp:run charPrIDRef="0">{pic}<hp:t/></hp:run></hp:p>',
                 tbl, count=1, flags=re.S)
    return tbl


def add_center_para(header):
    """문단 모양 0을 복사해 가운데 맞춤 문단 모양을 하나 더해요(그림 칸용)."""
    m = re.search(r'<hh:paraPr [^>]*id="0"[^>]*>.*?</hh:paraPr>', header, re.S)
    ids = [int(x) for x in re.findall(r'<hh:paraPr [^>]*\bid="(\d+)"', header)]
    nid = max(ids) + 1
    new = re.sub(r'\bid="0"', f'id="{nid}"', m.group(0), count=1).replace('horizontal="JUSTIFY"', 'horizontal="CENTER"', 1)
    header = header.replace("</hh:paraProperties>", new + "</hh:paraProperties>", 1)
    header = re.sub(r'<hh:paraProperties itemCnt="(\d+)"', lambda x: f'<hh:paraProperties itemCnt="{int(x.group(1)) + 1}"', header, count=1)
    return header, str(nid)


async def main():
    site, src, out, mapdir, *keys = sys.argv[1:]
    load_extra(mapdir)
    maps = [json.load(open(os.path.join(mapdir, f"map_{k}.json"), encoding="utf-8")) for k in keys]
    zin = zipfile.ZipFile(src)
    sec = zin.read("Contents/section0.xml").decode("utf-8")
    tbls = list(re.finditer(r"<hp:tbl .*?</hp:tbl>", sec, re.S))
    need = sum(1 + len(m["figs"]) for m in maps)
    if need != len(tbls):
        sys.exit(f"그림 틀 {len(tbls)}개, 짝 {need}개 – 개수가 달라요")
    pngdir = os.path.splitext(out)[0] + "_pics"
    os.makedirs(pngdir, exist_ok=True)
    jobs, missing = [], []
    srv, port = cap.serve(site)
    url = f"http://127.0.0.1:{port}/"
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for k, mp in zip(keys, maps):
            f = os.path.join(pngdir, f"{k}_00.png")
            missing += [f"{k}: {x}" for x in await screen_png(br, url, mp, f)]
            jobs.append((f, None))
            for i, fg in enumerate(mp["figs"], 1):
                f = os.path.join(pngdir, f"{k}_{i:02d}.png")
                missing += [f"{k}: {x}" for x in await fig_png(br, url, fg, f)]
                jobs.append((f, PX))
            print("찍음", k, 1 + len(mp["figs"]))
        await br.close()
    srv.shutdown()

    header = zin.read("Contents/header.xml").decode("utf-8")
    header, center = add_center_para(header)
    hpf = zin.read("Contents/content.hpf").decode("utf-8")
    items, parts, last = [], [], 0
    for n, (t, (png, scale)) in enumerate(zip(tbls, jobs), 1):
        bin_id = f"manual{n:02d}"
        parts.append(sec[last:t.start()])
        parts.append(fill(t.group(0), png, bin_id, center, scale))
        last = t.end()
        items.append((bin_id, png))
    parts.append(sec[last:])
    sec2 = "".join(parts)
    # 틀이 든 바깥 문단의 옛 줄 배치 정보도 지워요(높이가 바뀌어서)
    sec2 = re.sub(r"(</hp:tbl><hp:t/></hp:run>)<hp:linesegarray>.*?</hp:linesegarray>", r"\1", sec2, flags=re.S)
    man = "".join(f'<opf:item id="{b}" href="BinData/{b}.png" media-type="image/png" isEmbeded="1"/>' for b, _ in items)
    hpf = hpf.replace("</opf:manifest>", man + "</opf:manifest>", 1)
    with zipfile.ZipFile(out, "w") as zout:
        for it in zin.infolist():
            data = zin.read(it.filename)
            if it.filename == "Contents/section0.xml":
                data = sec2.encode("utf-8")
            elif it.filename == "Contents/header.xml":
                data = header.encode("utf-8")
            elif it.filename == "Contents/content.hpf":
                data = hpf.encode("utf-8")
            zi = zipfile.ZipInfo(it.filename, date_time=it.date_time)
            zi.compress_type = zipfile.ZIP_STORED if it.filename == "mimetype" else zipfile.ZIP_DEFLATED
            zi.external_attr = it.external_attr
            zout.writestr(zi, data)
        for b, png in items:
            zout.write(png, f"BinData/{b}.png", compress_type=zipfile.ZIP_STORED)
    print(f"만듦 {out} ({os.path.getsize(out) // 1024}KB, 그림 {len(items)})")
    if missing:
        print("못 찾은 요소:")
        for m in missing:
            print("  - " + m)


if __name__ == "__main__":
    asyncio.run(main())
