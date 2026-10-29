import asyncio,sys,json
sys.path.insert(0,'/home/claude/gilog/tools/manual')
import cap,shoot,hwpx_pics
hwpx_pics.load_extra('/home/claude/gilog/docs/manual/hangul/map')
cap.DPR=3
from playwright.async_api import async_playwright
async def m():
    srv,port=cap.serve('/tmp/claude-0/g_052')
    async with async_playwright() as pw:
        br=await pw.chromium.launch()
        ctx,p=await cap.open_scene(br,f'http://127.0.0.1:{port}/','settings_full')
        vals={"google.client":{"id":"x.apps.googleusercontent.com","secret":"s"},
              "google.token":{"refresh":"r","access":"a","exp":9999999999999,"scope":"https://www.googleapis.com/auth/calendar"},
              "google.state":{"calendarId":"c","items":{},"listId":"","titems":{},"lastOk":"2026-10-21 09:58","lastError":"","full":False}}
        for k,v in vals.items():
            await p.evaluate("([k,v])=>window.__fake.values.set(k,v)",[k,json.dumps(v)])
        await p.route("**/googleapis.com/**", lambda r: r.fulfill(status=200, body="{}"))
        await shoot.nav(p,"캘린더"); await shoot.nav(p,"설정"); await p.wait_for_timeout(1200)
        card=p.locator('section.mod-card').nth(4)
        print(await card.inner_text())
        await p.mouse.move(1599,899); await p.wait_for_timeout(300)
        await card.screenshot(path='/tmp/claude-0/sg/l07_new.png')
        await ctx.close(); await br.close()
    srv.shutdown()
asyncio.run(m())
