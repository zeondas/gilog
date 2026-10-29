async def s_settings_tall(p):
    # 설정은 카드가 세로로 길어 1600×900 한 화면에 보안·저장·키 설정·모듈별 설정이 안 들어와요.
    # 창 높이만 늘려(앱 모양은 그대로) 공통 설정 4카드 + "모듈별 설정" 머리까지 한 장에 담아요.
    await p.set_viewport_size({"width": 1600, "height": 2520})
    await p.wait_for_timeout(400)

EXTRA = {"settings_tall": ("설정", s_settings_tall)}


async def s_settings_full(p):
    # 상세설명 "아. 모듈별 설정" 카드 그림용 – 모듈별 카드 6장까지 한 화면에 들어오게 창 높이만 늘려요.
    await p.set_viewport_size({"width": 1600, "height": 5400})
    await p.wait_for_timeout(400)

EXTRA["settings_full"] = ("설정", s_settings_full)
