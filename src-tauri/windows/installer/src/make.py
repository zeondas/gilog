"""기록 설치·제거 창 그림 만들기 (2026-10-25 공통 ✔6).

assets.html을 100·125·150·175·200% 배율로 찍어 ../<이름>_<배율>.png로 저장해요(저장소엔 PNG만 – 설치 파일을
만들 때 build.yml이 윈도우에서 같은 이름의 .bmp로 바꿔요. NSIS 그림 읽기(LoadImage)는 BMP만 받아요).
쓰는 법: python3 make.py  (playwright·Pillow 필요, 글꼴은 저장소 src/fonts/PretendardVariable.woff2)
installer.nsi가 화면 DPI에 가장 가까운 배율 그림을 골라 써요.
"""
import asyncio
import os
import shutil

from PIL import Image
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
FONT = os.path.join(HERE, "..", "..", "..", "..", "src", "fonts", "PretendardVariable.woff2")
SCALES = (100, 125, 150, 175, 200)
IDS = ("inst_bg", "inst_done", "un_bg", "un_prog", "un_band", "btn_cancel", "btn_remove", "btn_remove_data")


async def main():
    shutil.copy(FONT, os.path.join(HERE, "PretendardVariable.woff2"))
    try:
        async with async_playwright() as pw:
            br = await pw.chromium.launch()
            for s in SCALES:
                pg = await br.new_page(device_scale_factor=s / 100, viewport={"width": 800, "height": 2400})
                await pg.goto("file://" + os.path.join(HERE, "assets.html"))
                await pg.evaluate("() => document.fonts.ready")
                await pg.wait_for_timeout(200)
                for i in IDS:
                    png = os.path.join(OUT, f"{i}_{s}.png")
                    await pg.locator("#" + i).screenshot(path=png)
                    Image.open(png).convert("RGB").save(png, optimize=True)
                await pg.close()
            await br.close()
    finally:
        os.remove(os.path.join(HERE, "PretendardVariable.woff2"))


asyncio.run(main())
