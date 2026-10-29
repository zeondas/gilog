import asyncio,sys
sys.path.insert(0,'/home/claude/gilog/tools/manual')
import cap,hwpx_pics
cap.DPR=3
from playwright.async_api import async_playwright
hwpx_pics.load_extra('/home/claude/gilog/docs/manual/hangul/map')
OUT='/tmp/claude-0/sg/img/'
import os; os.makedirs(OUT,exist_ok=True)
async def rows_clip(p,card,first,last,pad=10):
    rows=card.locator('.row')
    n=await rows.count(); boxes=[]
    for i in range(n):
        t=(await rows.nth(i).inner_text()).split('\n')[0].strip()
        boxes.append((t,await rows.nth(i).bounding_box()))
    names=[t for t,_ in boxes]
    i0=next(i for i,(t,_) in enumerate(boxes) if t.startswith(first)); i1=next(i for i,(t,_) in enumerate(boxes) if t.startswith(last))
    cb=await card.bounding_box()
    y0=boxes[i0][1]['y']; y1=boxes[i1][1]['y']+boxes[i1][1]['height']
    return names,{"x":cb['x'],"y":y0-pad,"width":cb['width'],"height":y1-y0+2*pad}
async def m():
    srv,port=cap.serve('/tmp/claude-0/g_052')
    async with async_playwright() as pw:
        br=await pw.chromium.launch()
        ctx,p=await cap.open_scene(br,f'http://127.0.0.1:{port}/','settings_full')
        cards=p.locator('section.mod-card')
        # 민원처리: 민원 폴더 ~ Claude 모델
        names,clip=await rows_clip(p,cards.nth(2),'민원 폴더','Claude 모델'); print(names)
        await p.screenshot(path=OUT+'process_card.png',clip=clip)
        # 캘린더: 구글 연동 묶음
        names,clip=await rows_clip(p,cards.nth(4),'앱 정보 파일','구글 할 일로 보내기'); print(names)
        hb=await cards.nth(4).locator('text=구글 연동').first.bounding_box()
        clip['height']+=clip['y']-hb['y']+6; clip['y']=hb['y']-6
        await p.screenshot(path=OUT+'google_card.png',clip=clip)
        # 집행현황 팀 공유
        card=cards.nth(3)
        await p.evaluate("()=>{window.__shareFake={mail:'jeon.hm@gmail.com',books:{}}}")
        await card.locator('button[role=switch], .toggle, input[type=checkbox]').first.click(); await p.wait_for_timeout(600)
        await card.screenshot(path=OUT+'share_member.png')
        await card.locator('button:has-text("새로 만들기")').click(); await p.wait_for_timeout(1200)
        await card.locator('input[aria-label="이름"]').fill('김도로')
        await card.locator('input[aria-label="구글 메일"]').fill('road.kim@gmail.com')
        await card.locator('button:has-text("더하기")').click(); await p.wait_for_timeout(1200)
        print(await card.inner_text())
        await p.mouse.move(1599,1); await p.wait_for_timeout(300)
        await card.screenshot(path=OUT+'share_host.png')
        names,clip=await rows_clip(p,card,'함께 쓰는 사람','함께 쓰는 사람',8); 
        await p.screenshot(path=OUT+'share_people.png',clip=clip)
        await ctx.close()
        ctx,p=await cap.open_scene(br,f'http://127.0.0.1:{port}/','screen_02')
        hb=await p.locator('.ct-head').first.bounding_box()
        bb=await p.locator('.ct-head button:has-text("신문고 열기")').first.bounding_box()
        fb=await p.locator('button.pr-fetch').first.bounding_box()
        x1=max(bb['x']+bb['width'],fb['x']+fb['width'])+90
        clip={"x":max(0,hb['x']-10),"y":hb['y']-8,"width":min(1600,x1)-max(0,hb['x']-10),"height":max(hb['height'],fb['y']+fb['height']-hb['y'])+16}
        print('head clip',clip,bb,fb)
        await p.screenshot(path=OUT+'process_head.png',clip=clip)
        from PIL import Image, ImageDraw
        im=Image.open(OUT+'process_head.png').convert('RGB'); d=ImageDraw.Draw(im); D=3
        r=(bb['x']-clip['x']-3, bb['y']-clip['y']-3, bb['x']+bb['width']-clip['x']+3, bb['y']+bb['height']-clip['y']+3)
        d.rounded_rectangle([v*D for v in r],radius=6*D,outline='#6A4DFF',width=2*D); im.save(OUT+'process_head.png')
        await ctx.close(); await br.close()
    srv.shutdown()
asyncio.run(m())
