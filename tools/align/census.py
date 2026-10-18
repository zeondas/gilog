# 글자 가운데 맞춤 전수 재기 (UI 통일 세션, 2026-10-18)
# 쓰는 법은 README "census.py" 절. 1600×900, 배율 1 또는 1.25, 밝게/어둡게, 빈 칸 채우기.
#   python3 census.py <결과.json> [light|dark] [1|1.25] [filled]
import asyncio, io, json, sys, os
from collections import Counter
from PIL import Image
from playwright.async_api import async_playwright

OUT = sys.argv[1]
THEME = sys.argv[2] if len(sys.argv) > 2 else "light"
SCALE = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
FILLED = len(sys.argv) > 4 and sys.argv[4] == "filled"
URL = os.environ.get("ALIGN_URL", "http://localhost:5175/")
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = open(os.path.join(HERE, "seed.js")).read().replace('theme: "light"', f'theme: "{THEME}"')

# 빈 글 칸에 한글을 넣어요(React가 다시 그리지 않게 값만 바꿔요). 날짜·숫자 칸(data-ime="en")은 숫자.
FILL = r'''()=>{for(const el of document.querySelectorAll('input:not([type]),input[type=text],input[type=search],input[type=password],textarea')){
 if(el.value) continue; const r=el.getBoundingClientRect(); if(!r.width) continue;
 el.value = el.dataset.ime==='en'||el.inputMode==='numeric'?'2026-10-18':'가나다 한글'; }}'''

COLLECT = r'''(scope)=>{const out=[];const seen=new Set();
const ov=document.querySelector('.overlay'); const root=ov||document;
for(const el of root.querySelectorAll('button,input,select,textarea,span,a,label,div')){
 const r=el.getBoundingClientRect(); if(r.width<12||r.height<14||r.height>44||r.width>700) continue;
 const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity<0.5) continue;
 const boxy=(cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent')||parseFloat(cs.borderTopWidth)>0;
 if(!boxy) continue; if(el.matches('.jcal-day,.fx-status,.td-done,.fx-tree-head')) continue;
 if(el.tagName==='TEXTAREA'&&r.height>32) continue;
 let text=(el.tagName==='INPUT'||el.tagName==='TEXTAREA')?(el.value||el.placeholder):el.tagName==='SELECT'?(el.options[el.selectedIndex]||{}).text:el.innerText;
 text=(text||'').trim(); if(!text||text.includes('\n')) continue;
 if(el.tagName!=='INPUT'&&el.tagName!=='SELECT'&&el.tagName!=='TEXTAREA'&&[...el.children].some(c=>{const q=c.getBoundingClientRect();return q.height>=14&&getComputedStyle(c).backgroundColor!=='rgba(0, 0, 0, 0)'})) continue;
 if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth) continue;
 const k=Math.round(r.x)+','+Math.round(r.y)+','+Math.round(r.width); if(seen.has(k)) continue; seen.add(k);
 const cls=typeof el.className==='string'?el.className.split(' ').filter(Boolean):[];
 out.push({tag:el.tagName,cls:cls.slice(0,3).join('.'),text:text.slice(0,24),x:r.x,y:r.y,w:r.width,h:r.height,
  bt:parseFloat(cs.borderTopWidth),bb:parseFloat(cs.borderBottomWidth),rad:parseFloat(cs.borderTopLeftRadius)||0,
  ph:(el.tagName==='INPUT'||el.tagName==='TEXTAREA')&&!el.value});}
return out;}'''

def analyze(img, e):
    s = SCALE
    m = max(3, int(min(e["rad"], e["h"] / 2) * s) + 2)
    x0 = int(e["x"] * s + 0.5) + m
    x1 = int((e["x"] + e["w"]) * s) - m
    top = int(round(e["y"] * s + e["bt"] * s))
    bot = int(round((e["y"] + e["h"]) * s - e["bb"] * s))
    if x1 - x0 < 4 or bot - top < 6:
        return None
    crop = img.crop((x0, top, x1, bot)).convert("RGB")
    W, H = crop.size
    px = crop.load()
    c = Counter(px[i, j] for i in range(0, W, 2) for j in range(H))
    bg = c.most_common(1)[0][0]
    thr = 60 if e["ph"] else 90
    ink = [j for j in range(H) if any(sum(abs(a - b) for a, b in zip(px[i, j], bg)) > thr for i in range(W))]
    if not ink:
        return None
    return ink[0], H - 1 - ink[-1]

async def main():
    res = []
    async with async_playwright() as p:
        b = await p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
        pg = await b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=SCALE)
        await pg.add_init_script(SEED)
        extra = os.environ.get("ALIGN_CSS")
        if extra:
            css = json.dumps(open(extra).read())
            await pg.add_init_script("addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=%s;document.head.appendChild(s)})" % css)
        await pg.goto(URL)
        await pg.wait_for_timeout(1500)
        await pg.evaluate("document.fonts.ready.then(()=>1)")

        async def grab(name):
            await pg.wait_for_timeout(450)
            await pg.evaluate("document.activeElement&&document.activeElement.blur&&document.activeElement.blur()")
            if FILLED:
                await pg.evaluate(FILL)
            await pg.wait_for_timeout(60)
            img = Image.open(io.BytesIO(await pg.screenshot()))
            for e in await pg.evaluate(COLLECT):
                a = analyze(img, e)
                if a:
                    res.append({"screen": name, "tag": e["tag"], "cls": e["cls"], "text": e["text"],
                                "top": a[0], "bot": a[1], "d": a[0] - a[1], "h": e["h"], "ph": e["ph"]})

        async def go(n):
            for _ in range(3):
                if not await pg.locator(".overlay").count():
                    break
                await pg.keyboard.press("Escape")
                await pg.wait_for_timeout(150)
                if await pg.locator(".overlay").count():
                    await pg.mouse.click(1595, 5)
                    await pg.wait_for_timeout(150)
            await pg.locator(".side-item", has_text=n).first.click(timeout=5000)
            await pg.wait_for_timeout(700)

        async def tryclick(sel, dbl=False):
            l = pg.locator(sel).first
            if await l.count() == 0:
                return False
            try:
                await (l.dblclick(timeout=1500) if dbl else l.click(timeout=1500))
                return True
            except Exception:
                return False

        names = await pg.evaluate("[...document.querySelectorAll('.side-list .side-item, .side-bottom .side-item')].map(e=>e.innerText.trim()).filter(t=>t&&!/잠그기|접기/.test(t))")
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
        ]
        for scr, sel, name in steps:
            if scr not in names:
                continue
            await go(scr)
            if await tryclick(sel):
                await grab(name)
        if "설정" in names:
            await go("설정")
            for i, y in enumerate([900, 1800, 2700, 3600]):
                await pg.evaluate("y=>{for(const e of document.querySelectorAll('*')){if(e.scrollHeight>e.clientHeight+20&&['auto','scroll'].includes(getComputedStyle(e).overflowY))e.scrollTop=y}}", y)
                await grab(f"설정{i+2}")
        await b.close()
    json.dump(res, open(OUT, "w"), ensure_ascii=False)
    ok = sum(1 for r in res if r["d"] in (0, -1))
    print(f"{THEME} x{SCALE}{' filled' if FILLED else ''}: {ok}/{len(res)} = {100*ok/max(1,len(res)):.1f}%")

asyncio.run(main())
