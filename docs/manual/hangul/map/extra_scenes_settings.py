async def s_settings_tall(p):
    # 설정은 카드가 세로로 길어 1600×900 한 화면에 보안·저장·키 설정·모듈별 설정이 안 들어와요.
    # 창 높이만 늘려(앱 모양은 그대로) 공통 설정 4카드 + "모듈별 설정" 머리까지 한 장에 담아요.
    await p.set_viewport_size({"width": 1600, "height": 2520})
    await p.wait_for_timeout(400)

EXTRA = {"settings_tall": ("설정", s_settings_tall)}
