async def s_files_rename(p):
    rows = p.locator(".fx-frow")
    await rows.nth(2).click()
    await rows.nth(5).click(modifiers=["Shift"])
    await p.wait_for_timeout(200)
    await p.locator('.fx-tool:has(.fx-tl:text-is("이름변경"))').first.click()
    await p.wait_for_timeout(500)

EXTRA = {"files_rename": ("탐색기", s_files_rename)}
