"""v32 – 민원지도 장을 더하며 표지·목차·색인 띠 그림을 다시 그려요(민원대장 다음에 지도 아이콘).

  python3 tools/manual/hwpx_front_v32.py <그림 폴더>          # cover.png · toc.png(쪽 번호는 hwpx_toc.py로) · band_<장>.png 12장

front/cover_toc.html은 한 번만 고쳐요(지도 아이콘이 이미 있으면 그대로).
띠 원본은 docs/manual/hangul/cover/띠-그림-최적.html(손대지 않고 읽기만).
"""
import asyncio
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FRONT = os.path.join(HERE, "front", "cover_toc.html")
BANDS = os.path.join(HERE, "..", "..", "docs", "manual", "hangul", "cover", "띠-그림-최적.html")
MAP = "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14"   # src/Icons.tsx map
TABLE = "M3 4h18v16H3z M3 9h18 M3 14.5h18 M9 9v11"           # 민원대장
KEYS = ["overview", "explorer", "complaints", "map", "process", "budget", "bstatus",
        "calendar", "todo", "journal", "contacts", "settings"]


def front():
    s = open(FRONT).read()
    if MAP in s:
        return s
    # 표지 왼쪽 띠 아이콘: 민원대장 다음
    m = re.search(r'<svg viewBox="0 0 24 24" class="c3-n"[^>]*><path d="' + re.escape(TABLE) + r'"/></svg>', s)
    s = s[:m.end()] + m.group(0).replace(TABLE, MAP) + s[m.end():]
    # 목차 줄: 민원대장 다음, 쪽 번호는 나중에
    m = re.search(r'<div class="tr"><span class="tic ticd"><svg[^>]*><path d="' + re.escape(TABLE) + r'"/></svg></span><span class="tt">민원대장</span><span class="dots"></span><span class="tp">\d+</span></div>', s)
    row = m.group(0).replace(TABLE, MAP).replace(">민원대장<", ">민원지도<")
    s = s[:m.end()] + row + s[m.end():]
    # 아이콘 가운데 바로잡기는 줄 번호로 걸려 있어 민원대장 뒤 번호를 하나씩 밀어요
    s = re.sub(r"\.rows \.tr:nth-child\((\d+)\)", lambda x: f".rows .tr:nth-child({int(x.group(1)) + (1 if int(x.group(1)) > 3 else 0)})", s)
    s = s.replace(".toc2 .rows,.toc3 .rows{margin-top:26px;gap:10px}", ".toc2 .rows,.toc3 .rows{margin-top:24px;gap:7px}")
    open(FRONT, "w").write(s)
    return s


def bands():
    s = open(BANDS).read()
    item = re.compile(r'<div class="sm( on)?"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#[0-9A-F]{6}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + re.escape(TABLE) + r'"></path></svg></div>')

    def add(m):
        off = m.group(0).replace(' on"', '"').replace("#3A3A40", "#A6A6AE").replace(TABLE, MAP)
        return m.group(0) + off
    s = item.sub(add, s)
    # 민원대장 띠를 본떠 지도 띠를 만들어요(켜진 칸만 옮김)
    m = re.search(r'<div class="band" id="b_complaints">.*?</div></div></div>(?=<div class="band"|</body>)', s, re.S)
    b = m.group(0).replace('id="b_complaints"', 'id="b_map"')
    on_t = re.search(r'<div class="sm on"><svg[^>]*><path d="' + re.escape(TABLE) + r'"></path></svg></div>', b).group(0)
    off_m = re.search(r'<div class="sm"><svg[^>]*><path d="' + re.escape(MAP) + r'"></path></svg></div>', b).group(0)
    b = b.replace(on_t, on_t.replace(' on"', '"').replace("#3A3A40", "#A6A6AE"), 1)
    b = b.replace(off_m, off_m.replace('class="sm"', 'class="sm on"').replace("#A6A6AE", "#3A3A40"), 1)
    s = s[:m.end()] + b + s[m.end():]
    return s


async def shots(out, cover_html, band_html):
    from playwright.async_api import async_playwright
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, "_front.html")
    open(tmp, "w").write(cover_html)
    tmpb = os.path.join(out, "_bands.html")
    open(tmpb, "w").write(band_html)
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        p = await br.new_page(viewport={"width": 1200, "height": 1800})
        await p.goto("file://" + tmp)
        await p.wait_for_timeout(500)
        w = (await p.locator(".page.c3").bounding_box())["width"]
        await p.close()
        p = await br.new_page(viewport={"width": 1200, "height": 1800}, device_scale_factor=2100 / w)
        await p.goto("file://" + tmp)
        await p.wait_for_timeout(500)
        await p.locator(".page.c3").screenshot(path=os.path.join(out, "cover.png"))
        await p.close()
        p = await br.new_page(viewport={"width": 200, "height": 700}, device_scale_factor=5)
        await p.goto("file://" + tmpb)
        await p.wait_for_timeout(500)
        for k in KEYS:
            await p.evaluate("k => document.querySelectorAll('.band').forEach(b => b.classList.toggle('show', b.id === 'b_' + k))", k)
            f = os.path.join(out, f"band_{k}.png")
            await p.locator(f"#b_{k}").screenshot(path=f)
            from PIL import Image
            Image.open(f).crop((0, 0, 195, 2970)).save(f)   # v31 띠와 같은 크기(오른쪽 반 칸은 흰 바탕)
        await br.close()
    os.remove(tmp)
    os.remove(tmpb)


if __name__ == "__main__":
    out = os.path.abspath(sys.argv[1])
    asyncio.run(shots(out, front(), bands()))
    print("만듦", out)
