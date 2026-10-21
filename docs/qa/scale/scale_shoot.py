"""화면 배율 검토 미리 보기.
  python3 scale_shoot.py <site> <out>
variant:
  base   : 13px, 1600x900, dsf 1
  fsonly : --fs N 만 바꿈 (지금 방식)
  zoom   : 1안 창 배율 (CSS 뷰포트 1600/z × 900/z, dsf z) → 결과 그림 1600x900
"""
import asyncio, json, os, sys
sys.path.insert(0, "/home/claude/gilog/tools/guard")
import shoot  # noqa
from playwright.async_api import async_playwright

SHOTS = ["민원대장", "민원처리", "할 일", "설정"]
ALL = shoot.SCREENS

OVERFLOW_JS = """() => {
  const W = innerWidth; const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(cs.overflowX) && el.clientWidth > 200)
      out.push((el.className||el.tagName).toString().slice(0,40) + ' ' + el.scrollWidth + '>' + el.clientWidth);
  }
  const doc = document.documentElement;
  return {W, docOver: doc.scrollWidth > W + 1 ? doc.scrollWidth : 0, inner: out.slice(0,6)};
}"""


async def one(br, url, screen, variant, size, out, shot):
    z = size / 13
    if variant == "zoom":
        vp = {"width": round(1600 / z), "height": round(900 / z)}
        dsf = z
    else:
        vp, dsf = {"width": 1600, "height": 900}, 1
    ctx = await br.new_context(viewport=vp, device_scale_factor=dsf, locale="ko-KR", timezone_id="Asia/Seoul")
    ctx.set_default_timeout(5000)
    p = await ctx.new_page()
    await p.clock.set_fixed_time("2026-10-21T10:00:00+09:00")
    await p.add_init_script(path="/home/claude/gilog/tools/guard/seed.js")
    await p.goto(url)
    await p.wait_for_timeout(900)
    await p.add_style_tag(content=shoot.STILL)
    if variant == "fsonly":
        await p.evaluate(f"() => document.documentElement.style.setProperty('--fs', '{size}px')")
    await shoot.nav(p, screen)
    await p.mouse.move(vp["width"] - 1, vp["height"] - 1)
    await p.wait_for_timeout(400)
    await p.evaluate("() => document.fonts.ready")
    info = await p.evaluate(OVERFLOW_JS)
    if shot:
        await p.screenshot(path=os.path.join(out, f"{screen}_{variant}_{size}.png"))
    await ctx.close()
    return info


async def main():
    site, out = sys.argv[1:3]
    os.makedirs(out, exist_ok=True)
    srv, port = shoot.serve(site)
    url = f"http://127.0.0.1:{port}/"
    rep = {}
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for s in SHOTS:
            await one(br, url, s, "base", 13, out, True)
            await one(br, url, s, "fsonly", 15, out, True)
            await one(br, url, s, "zoom", 15, out, True)
        for s in ALL:
            for size in (13, 14, 15, 16, 17):
                v = "base" if size == 13 else "zoom"
                rep[f"{s}@{size}"] = await one(br, url, s, v, size, out, s in SHOTS and size in (16, 17))
        await br.close()
    srv.shutdown()
    with open(os.path.join(out, "overflow.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    for k, v in rep.items():
        print(k, v)


asyncio.run(main())
