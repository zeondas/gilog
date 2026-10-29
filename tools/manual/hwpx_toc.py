"""목차 그림(toc.png) – 쪽 번호만 바꿔 다시 그려요.  python3 tools/manual/hwpx_toc.py 1,5,15,... toc.png"""
import asyncio,sys,re
from playwright.async_api import async_playwright
nums=sys.argv[1].split(','); out=sys.argv[2]
async def m():
    s=open(''+__import__('os').path.join(__import__('os').path.dirname(__file__),'front','cover_toc.html')+'').read()
    it=iter(nums)
    s=re.sub(r'<span class="tp">\d+</span>',lambda _:f'<span class="tp">{next(it)}</span>',s)
    open('/tmp/toc_tmp.html','w').write(s)
    async with async_playwright() as pw:
        br=await pw.chromium.launch(); p=await br.new_page(viewport={'width':1200,'height':1800})
        await p.goto('file:///tmp/toc_tmp.html'); await p.wait_for_timeout(500)
        b=await p.locator('.toc3').bounding_box(); print(b)
        scale=2100/b['width']
        await p.close(); p=await br.new_page(viewport={'width':1200,'height':1800},device_scale_factor=scale)
        await p.goto('file:///tmp/toc_tmp.html'); await p.wait_for_timeout(500)
        await p.locator('.toc3').screenshot(path=out); await br.close()
asyncio.run(m())
