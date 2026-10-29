async def s_lock(p):
    # 개요 "처음 화면" – 사이드바 [잠그기]를 눌러 잠금 화면(기록앱을 켜면 처음 보이는 화면)을 띄워요.
    await p.locator(".side-item:has-text(\"잠그기\")").first.click()
    await p.wait_for_timeout(600)

EXTRA = {"overview_lock": ("업무일지", s_lock)}
