# 기준선 자 모으기 (2026-10-18 UI 통일) — 앱의 ?ruler 모드(src/ruler.ts)를 모든 화면에서 돌려 표를 저장해요.
#   python3 ruler.py <결과.json> [1|1.25] [light|dark] [--shots 폴더]
# 미리 보기 띄우기는 README "census.py" 절과 같아요(5175). 주소에 ?ruler 를 붙여 열어요.
# 결과: 화면마다 칸 목록(name·kind·d·h·lh·baseline·devFrac·row·spread·bad). 끝에 요약을 찍어요.
import asyncio, json, os, sys
from playwright.async_api import async_playwright

OUT = sys.argv[1]
SCALE = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
THEME = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else "light"
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else None
URL = os.environ.get("ALIGN_URL", "http://localhost:5175/") + "?ruler"
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = open(os.path.join(HERE, "seed.js")).read().replace('theme: "light"', f'theme: "{THEME}"')


async def main():
    res = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
        pg = await b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=SCALE)
        await pg.add_init_script(SEED)
        await pg.goto(URL)
        await pg.wait_for_timeout(1500)
        await pg.evaluate("document.fonts.ready.then(()=>1)")
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)

        async def grab(name):
            await pg.wait_for_timeout(500)
            await pg.evaluate("document.activeElement&&document.activeElement.blur&&document.activeElement.blur()")
            await pg.wait_for_timeout(350)
            res[name] = await pg.evaluate("window.__ruler()")
            if SHOTS:
                await pg.screenshot(path=os.path.join(SHOTS, f"{len(res):02d}_{name}.png"))

        async def close_overlay():
            for _ in range(3):
                if not await pg.locator(".overlay").count():
                    return
                await pg.keyboard.press("Escape")
                await pg.wait_for_timeout(150)
                if await pg.locator(".overlay").count():
                    await pg.mouse.click(1595, 5)
                    await pg.wait_for_timeout(150)

        async def go(n):
            await close_overlay()
            await pg.locator(".side-item", has_text=n).first.click(timeout=5000)
            await pg.wait_for_timeout(700)

        async def tryclick(sel):
            l = pg.locator(sel).first
            if await l.count() == 0:
                return False
            try:
                await l.click(timeout=1500)
                return True
            except Exception:
                return False

        names = await pg.evaluate(
            "[...document.querySelectorAll('.side-list .side-item, .side-bottom .side-item')].map(e=>e.innerText.trim()).filter(t=>t&&!/잠그기|접기/.test(t))"
        )
        for n in names:
            await go(n)
            await grab(n)
        steps = [
            ("민원대장", 'button:has-text("분류 관리")', "분류 관리"),
            ("업무연락처", 'button:has-text("프로젝트 관리")', "프로젝트 관리"),
            ("캘린더", ".cal-manage", "종류 관리"),
            ("캘린더", ".cal-detail-btn", "일정 상세"),
            ("민원처리", 'button:has-text("공사 관리")', "공사 관리"),
            ("민원대장", '[aria-label="메모 편집"]', "민원 메모"),
            ("할 일", ".td-add-title", "할 일 신규"),
        ]
        for scr, sel, name in steps:
            if scr not in names:
                continue
            await go(scr)
            if await tryclick(sel):
                if name == "할 일 신규":
                    await pg.wait_for_timeout(300)
                    res[name] = await pg.evaluate("window.__ruler()")
                    if SHOTS:
                        await pg.screenshot(path=os.path.join(SHOTS, f"{len(res):02d}_{name}.png"))
                else:
                    await grab(name)
        if "설정" in names:
            await go("설정")
            for i, y in enumerate([900, 1800, 2700, 3600]):
                await pg.evaluate(
                    "y=>{for(const e of document.querySelectorAll('*')){if(e.scrollHeight>e.clientHeight+20&&['auto','scroll'].includes(getComputedStyle(e).overflowY))e.scrollTop=y}}",
                    y,
                )
                await grab(f"설정{i + 2}")
        await b.close()
    json.dump(res, open(OUT, "w"), ensure_ascii=False, indent=1)
    fields = [r for v in res.values() for r in v if r["kind"] != "badge"]
    bad_rows = {(s, r["row"]) for s, v in res.items() for r in v if r["bad"]}
    ds = sorted({r["d"] for r in fields if r["kind"] == "field" and 26 <= r["h"] <= 30})
    print(f"x{SCALE} {THEME}: 칸 {len(fields)}개 · 기준선이 0.5px 이상 벌어진 줄 {len(bad_rows)}개 · 28칸 d 값 {ds}")
    for s, row in sorted(bad_rows):
        rs = [r for r in res[s] if r["row"] == row and r["kind"] != "badge"]
        print(f"  [{s}] 줄 {row}: " + ", ".join(f"{r['name'][:28]}={r['baseline']:.2f}" for r in rs))


asyncio.run(main())
