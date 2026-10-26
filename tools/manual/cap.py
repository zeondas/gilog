"""매뉴얼용 장면 열기 – 지킴이(tools/guard/shoot.py)의 장면·흉내 자료·시계를 그대로 쓰고, 그림만 2배로 찍어요.

지킴이 비교에는 영향이 없어요(shoot.py를 읽기만 해요).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GUARD = os.path.join(HERE, "..", "guard")
sys.path.insert(0, GUARD)

import shoot  # noqa: E402  (지킴이 장면 목록 SCENES·nav·STILL·serve)

SCENES = shoot.SCENES
SCREENS = shoot.SCREENS
serve = shoot.serve
DPR = 2  # 인쇄에서도 또렷하게


async def open_scene(br, url, name):
    """장면을 열어 둔 채 (ctx, page)를 돌려줘요. 다 쓰면 ctx.close()."""
    screen, act = SCENES[name]
    vp = {"width": 1600, "height": 900}
    ctx = await br.new_context(viewport=vp, device_scale_factor=DPR, locale="ko-KR", timezone_id="Asia/Seoul")
    ctx.set_default_timeout(5000)
    p = await ctx.new_page()
    await p.clock.set_fixed_time("2026-10-21T10:00:00+09:00")
    await p.add_init_script(path=os.path.join(GUARD, "seed.js"))
    await p.goto(url)
    await p.wait_for_timeout(900)
    await p.add_style_tag(content=shoot.STILL)
    await shoot.nav(p, screen)
    if act:
        await act(p)
    await p.mouse.move(vp["width"] - 1, vp["height"] - 1)
    await p.wait_for_timeout(500)
    await p.evaluate("() => document.fonts.ready")
    return ctx, p


async def box(p, sel):
    """선택자에 맞는 첫 보이는 요소의 자리(CSS px) – 없으면 None."""
    loc = p.locator(sel)
    n = await loc.count()
    for i in range(min(n, 20)):
        b = await loc.nth(i).bounding_box()
        if b and b["width"] > 0 and b["height"] > 0:
            return b
    return None
