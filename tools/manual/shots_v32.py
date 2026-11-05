"""매뉴얼 v32 그림 찍기 – 지킴이 장면을 3배로 통째(1600×900) 찍어 폴더에 남겨요(자르기는 hwpx_v32.py).

  python3 tools/manual/shots_v32.py <지킴이 빌드 폴더> <그림 폴더> [장면 …]
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import cap  # noqa: E402

cap.DPR = 3


async def s_settings_map(p):
    await p.locator('section.mod-card:has(.mod-head:text-is("민원지도"))').first.scroll_into_view_if_needed()
    await p.wait_for_timeout(300)


async def s_settings_keys(p):
    await p.evaluate("() => [...document.querySelectorAll('*')].find(e => e.textContent.trim() === '지도에서 보기')?.scrollIntoView({block:'center'})")
    await p.wait_for_timeout(300)


cap.SCENES["settings_map"] = ("설정", s_settings_map)
cap.SCENES["settings_keys"] = ("설정", s_settings_keys)

DEFAULT = ["map", "map_card", "map_layers", "map_search", "map_period", "map_measure", "map_legend", "map_fold", "map_focus",
           "map_region", "map_typefind", "screen_01", "complaints_rowmenu", "complaints_dbl", "complaints_import",
           "screen_05", "calendar_day", "calendar_roll", "settings_clear", "settings_map", "settings_keys", "screen_09",
           "screen_03", "screen_04", "budgetstatus_import"]


async def main():
    site, out, *names = sys.argv[1:]
    names = names or DEFAULT
    os.makedirs(out, exist_ok=True)
    from playwright.async_api import async_playwright
    srv, port = cap.serve(site)
    url = f"http://127.0.0.1:{port}/"
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for n in names:
            try:
                ctx, p = await cap.open_scene(br, url, n)
                await p.screenshot(path=os.path.join(out, f"{n}.png"))
                await ctx.close()
                print("찍음", n)
            except Exception as e:  # noqa: BLE001
                print("못 찍음", n, str(e)[:120])
        await br.close()




# ---------- 구글 연결된 모습(가짜 로그인 – 구글로는 아무것도 안 나가요: 요청은 모두 빈 답으로 막아요) ----------
GOOGLE = """
(() => {
  const seed = window.__previewSeed;
  window.__previewSeed = async (call) => {
    await seed(call);
    const put = (key, v) => call("set_value", { key, value: JSON.stringify(v) });
    put("google.client", { id: "x.apps.googleusercontent.com", secret: "s" });
    put("google.token", { refresh: "r", access: "a", exp: 9999999999999, at: Date.parse("2026-10-19T09:00:00+09:00"),
      scope: "https://www.googleapis.com/auth/calendar" });
    put("google.state", { calendarId: "c", items: {}, listId: "", titems: {}, lastOk: "2026-10-21 09:58", lastError: "", full: false,
      gone: { e1: { title: "현장 출장" } }, foreign: {}, notes: [] });
    put("google.opts", { events: true, complaints: true, tasks: true, gtasks: false, twoWay: true });
  };
})();
"""


async def open_google(br, url, screen):
    vp = {"width": 1600, "height": 900}
    ctx = await br.new_context(viewport=vp, device_scale_factor=cap.DPR, locale="ko-KR", timezone_id="Asia/Seoul")
    p = await ctx.new_page()
    await p.route("**/*google*/**", lambda r: r.abort())
    await p.clock.set_fixed_time("2026-10-21T10:00:00+09:00")
    await p.add_init_script(path=os.path.join(cap.GUARD, "seed.js"))
    await p.add_init_script(GOOGLE)
    await p.goto(url)
    await p.wait_for_timeout(900)
    await p.add_style_tag(content=cap.shoot.STILL)
    await cap.shoot.nav(p, "설정")          # 구글 상태는 설정 카드가 읽어요
    await p.wait_for_timeout(800)
    if screen != "설정":
        await cap.shoot.nav(p, screen)
    await p.mouse.move(vp["width"] - 1, vp["height"] - 1)
    await p.wait_for_timeout(800)
    return ctx, p


async def google_shots(site, out):
    from playwright.async_api import async_playwright
    srv, port = cap.serve(site)
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctx, p = await open_google(br, f"http://127.0.0.1:{port}/", "캘린더")
        await p.screenshot(path=os.path.join(out, "g_calendar.png"))
        await p.locator(".g-checks").first.click()
        await p.wait_for_timeout(500)
        await p.screenshot(path=os.path.join(out, "g_checks.png"))
        await ctx.close()
        ctx, p = await open_google(br, f"http://127.0.0.1:{port}/", "설정")
        await p.locator('section.mod-card:has(.mod-head:text-is("캘린더"))').first.scroll_into_view_if_needed()
        await p.wait_for_timeout(400)
        await p.screenshot(path=os.path.join(out, "g_settings.png"))
        await ctx.close()
        await br.close()


if __name__ == "__main__":
    if sys.argv[1:2] == ["google"]:
        asyncio.run(google_shots(sys.argv[2], sys.argv[3]))
    else:
        asyncio.run(main())
