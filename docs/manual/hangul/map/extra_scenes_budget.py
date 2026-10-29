async def s_settings_budgetshare(p):
    card = p.locator('section.mod-card:has(.mod-head:text-is("집행현황"))').first
    await card.scroll_into_view_if_needed()
    await card.locator("button.row-btn", has_text="팀 공유").first.click()
    await p.wait_for_timeout(800)
    await card.scroll_into_view_if_needed()
    await p.wait_for_timeout(300)

EXTRA = {"settings_budgetshare": ("설정", s_settings_budgetshare)}

