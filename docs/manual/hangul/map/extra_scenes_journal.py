async def s_journal_print(p):
    # 인쇄 기간 창(정상 상태)
    await p.locator(".jn-head button", has_text="인쇄").first.click()
    await p.wait_for_timeout(300)
    await p.locator(".jp-chip", has_text="이번 달").first.click()
    await p.wait_for_timeout(300)

EXTRA = {"journal_print": ("업무일지", s_journal_print)}
