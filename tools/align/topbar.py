# 머리 줄 전수조사 (상단 정리 세션, 2026-10-19)
#   python3 topbar.py <폴더> [1|1.25] [light|dark]
# 미리 보기 띄우기는 README "쓰는 법" 절과 같아요(WASM 미리 보기 빌드 → 5175).
# 화면마다 머리 줄(y 0~80)을 잘라 <폴더>/<n>.png, 요소 목록을 <폴더>/topbar.json에 적고,
# 모두 세로로 이은 <폴더>/all.png를 만들어요.
import asyncio, io, json, os, sys
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import async_playwright

OUT = sys.argv[1]
SCALE = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
THEME = sys.argv[3] if len(sys.argv) > 3 else "light"
URL = os.environ.get("ALIGN_URL", "http://localhost:5175/")
HERE = os.path.dirname(os.path.abspath(__file__))
SEED = open(os.path.join(HERE, "seed.js")).read().replace('theme: "light"', f'theme: "{THEME}"')
SCREENS = ["탐색기", "민원대장", "민원처리", "캘린더", "할 일", "업무일지", "업무연락처", "집행현황", "예산현황", "설정"]
Y0, Y1 = 8, 76

# 머리 줄 요소: 본문(사이드바 오른쪽)에서 위 80px 안에 있는 제목·검색·단추·토글·고르기 칸
COLLECT = r'''()=>{
const side=document.querySelector('.side'); const sx=side?side.getBoundingClientRect().right:0;
const pick='h1,.search,.seg,.cal-views,.bd-unit,button,select,input,[role=radiogroup],[role=tablist],.chip';
const els=[...document.querySelectorAll(pick)].filter(el=>{const r=el.getBoundingClientRect();
 if(!r.width||!r.height) return false; if(r.left<sx-1||r.top>80||r.bottom<10) return false;
 const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none') return false;
 if(el.classList.contains('sr-only')) return false;
 // 묶음 안 요소는 묶음만
 const grp=el.parentElement&&el.parentElement.closest('.search,.seg,.cal-views,.bd-unit,[role=radiogroup],[role=tablist]');
 if(grp&&grp!==el) return false;
 if(el.tagName==='INPUT'&&el.closest('.search')) return false;
 return true;});
// 큰 묶음(머리 줄 행) 찾기
const out=els.map(el=>{const r=el.getBoundingClientRect(); const cs=getComputedStyle(el);
 const cls=typeof el.className==='string'?el.className:'';
 let kind=el.tagName==='H1'?'제목':el.matches('.search')?'검색':el.matches('.seg,.cal-views,.bd-unit,[role=radiogroup],[role=tablist]')?'토글':el.tagName==='SELECT'?'고르기':el.tagName==='INPUT'?'칸':'단추';
 let text=(el.tagName==='INPUT')?(el.value||el.placeholder):el.innerText;
 if(el.matches('.search')){const i=el.querySelector('input'); text=i?(i.placeholder||''):'';}
 text=(text||'').replace(/\s+/g,' ').trim();
 if(!text) text=el.getAttribute('aria-label')||el.title||'';
 return {kind,cls:cls.split(' ').slice(0,3).join('.'),text:text.slice(0,30),x:+r.left.toFixed(1),y:+r.top.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),
  rad:parseFloat(cs.borderTopLeftRadius)||0,fs:cs.fontSize,fw:cs.fontWeight,bg:cs.backgroundColor,
  x_btn:!!(el.matches('.search')&&el.querySelector('.search-x')),
  inner:el.matches('.seg,.cal-views,.bd-unit,[role=radiogroup],[role=tablist]')?[...el.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();return {t:b.innerText.trim(),h:+q.height.toFixed(1),w:+q.width.toFixed(1),on:b.getAttribute('aria-checked')==='true'||b.getAttribute('aria-pressed')==='true'||b.classList.contains('on')||b.getAttribute('aria-selected')==='true'}}):null};});
out.sort((a,b)=>a.y>60&&b.y<=60?1:a.y<=60&&b.y>60?-1:a.x-b.x);
return {sx,els:out};}'''

async def main():
    os.makedirs(OUT, exist_ok=True)
    data = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
        pg = await b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=SCALE)
        await pg.add_init_script(SEED)
        await pg.goto(URL)
        await pg.wait_for_timeout(1500)
        await pg.evaluate("document.fonts.ready.then(()=>1)")
        names = await pg.evaluate("[...document.querySelectorAll('.side-item')].map(e=>e.innerText.trim())")
        print("sidebar:", names)
        shots = []
        for i, n in enumerate(SCREENS):
            loc = pg.locator(".side-item", has_text=n).first
            if await loc.count() == 0:
                print("없음", n); continue
            await loc.click()
            await pg.wait_for_timeout(900)
            await pg.mouse.move(1599, 899)
            await pg.evaluate("document.activeElement&&document.activeElement.blur&&document.activeElement.blur()")
            await pg.wait_for_timeout(200)
            info = await pg.evaluate(COLLECT)
            data[n] = info
            img = Image.open(io.BytesIO(await pg.screenshot()))
            img.save(os.path.join(OUT, f"full_{i:02d}.png"))
            sx = int(info["sx"] * SCALE)
            crop = img.crop((sx, int(Y0 * SCALE), img.width, int(Y1 * SCALE)))
            crop.save(os.path.join(OUT, f"{i:02d}.png"))
            shots.append((n, crop))
        await b.close()
    json.dump(data, open(os.path.join(OUT, "topbar.json"), "w"), ensure_ascii=False, indent=1)
    # 한 장으로: 왼쪽 이름표 110px + 자른 그림, 24·58 선 표시
    try:
        font = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", int(13 * SCALE))
    except Exception:
        font = ImageFont.load_default()
    lab = int(110 * SCALE)
    W = max(c.width for _, c in shots) + lab
    H = sum(c.height + int(6 * SCALE) for _, c in shots)
    sheet = Image.new("RGB", (W, H), (236, 236, 240))
    d = ImageDraw.Draw(sheet)
    y = 0
    for n, c in shots:
        sheet.paste(c, (lab, y))
        d.text((int(10 * SCALE), y + c.height // 2 - int(9 * SCALE)), n, fill=(40, 40, 50), font=font)
        for g in (24, 58):
            gy = y + int((g - Y0) * SCALE)
            for x in range(lab, W, int(6 * SCALE)):
                d.line([(x, gy), (x + int(2 * SCALE), gy)], fill=(230, 60, 90))
        y += c.height + int(6 * SCALE)
    sheet.save(os.path.join(OUT, "all.png"))
    print("ok", len(shots))

asyncio.run(main())
