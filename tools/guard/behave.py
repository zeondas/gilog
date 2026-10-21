"""모양 지킴이 – 바깥 누르기·끌기·Esc 동작 시험.

  python3 tools/guard/behave.py <빌드한 폴더>

장면마다 새 창에서: 열기 → 안에서 눌러 바깥에서 떼기(닫히면 안 됨) → Esc 또는 바깥 누르기(닫혀야 함),
고치는 카드는 바깥을 누르면 저장되는지 봐요. 고치기 전·뒤 모두 같은 결과(전부 통과)여야 해요.
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shoot  # noqa: E402


async def drag_out(p, inner, outer_xy):
    b = await p.locator(inner).first.bounding_box()
    await p.mouse.move(b["x"] + 4, b["y"] + 4)
    await p.mouse.down()
    await p.mouse.move(*outer_xy, steps=4)
    await p.mouse.up()
    await p.wait_for_timeout(200)


async def press_out(p, xy):
    await p.mouse.click(*xy)
    await p.wait_for_timeout(250)


async def shown(p, sel):
    return await p.locator(sel).count() > 0 and await p.locator(sel).first.is_visible()


def menu_case(screen, opener, sel, out_xy=(1400, 860), esc=True):
    async def run(p):
        await shoot.nav(p, screen)
        await opener(p)
        await p.wait_for_timeout(250)
        assert await shown(p, sel), "열리지 않음"
        await drag_out(p, sel, out_xy)
        assert await shown(p, sel), "안에서 눌러 바깥에서 뗐는데 닫힘"
        await press_out(p, out_xy)
        assert not await shown(p, sel), "바깥을 눌렀는데 안 닫힘"
        if esc:
            await opener(p)
            await p.wait_for_timeout(250)
            await p.keyboard.press("Escape")
            await p.wait_for_timeout(250)
            assert not await shown(p, sel), "Esc로 안 닫힘"
    return run


async def c_contacts_band(p):
    await shoot.nav(p, "업무연락처")
    await shoot.s_contacts_card_ask(p)
    assert await shown(p, ".ask-band"), "띠 안 열림"
    await press_out(p, (700, 800))
    assert not await shown(p, ".ask-band"), "바깥 눌러도 띠가 남음"


async def c_settings_band(p):
    await shoot.nav(p, "설정")
    await shoot.s_settings_list_ask(p)
    assert await shown(p, ".list-ask"), "띠 안 열림"
    await press_out(p, (1500, 60))
    assert not await shown(p, ".list-ask"), "바깥 눌러도 띠가 남음"


async def c_pjmenu_esc(p):
    await shoot.nav(p, "업무연락처")
    await shoot.s_contacts_pjmenu(p)
    assert await shown(p, ".pjm-menu"), "메뉴 안 열림"
    await p.keyboard.press("Escape")
    await p.wait_for_timeout(250)
    assert not await shown(p, ".pjm-menu"), "Esc로 메뉴가 안 닫힘"
    assert await shown(p, ".dialog.pjm"), "Esc 한 번에 사업 관리 창까지 닫힘"
    await p.locator(".pjm-row", has_text="방호벽 정비").first.click(button="right")
    await p.wait_for_timeout(250)
    await press_out(p, (760, 800))
    assert not await shown(p, ".pjm-menu"), "창 안 다른 곳을 눌렀는데 메뉴가 안 닫힘"
    assert await shown(p, ".dialog.pjm"), "메뉴 바깥을 눌렀는데 창까지 닫힘"


async def c_settings_esc(p):
    await shoot.nav(p, "설정")
    await shoot.s_settings_list_ask(p)
    await p.keyboard.press("Escape")
    await p.wait_for_timeout(250)
    assert not await shown(p, ".list-ask"), "Esc로 띠가 안 접힘"


async def c_dialog(p):
    await shoot.nav(p, "캘린더")
    await shoot.s_calendar_kinds(p)
    await p.wait_for_timeout(250)
    sel = ".dialog.mgr"
    assert await shown(p, sel), "창 안 열림"
    await drag_out(p, sel + " input", (20, 880))
    assert await shown(p, sel), "창 안에서 끌어 바탕에서 뗐는데 닫힘"
    await press_out(p, (20, 880))
    assert not await shown(p, sel), "바탕을 눌렀는데 안 닫힘"


async def c_journal_save(p):
    await shoot.nav(p, "업무일지")
    await p.locator(".jcard", has_text="설계 변경").first.dblclick()
    await p.wait_for_timeout(300)
    box = p.locator(".jcard-edit textarea, .jcard-edit [contenteditable=true], .jcard-edit input").last
    await box.click()
    await p.keyboard.press("End")
    await p.keyboard.type("123")
    await press_out(p, (1400, 860))
    assert not await shown(p, ".jcard-edit"), "바깥 눌러도 고치는 카드가 남음"
    assert await p.locator(".jcard", has_text="123").count() > 0, "바깥 눌렀는데 고친 것이 저장 안 됨"


async def c_tasks_add(p):
    await shoot.nav(p, "할 일")
    await p.get_by_placeholder("할 일 추가").first.click()
    await p.keyboard.type("바깥 저장 시험")
    await press_out(p, (1400, 860))
    assert await p.locator(".td-row", has_text="바깥 저장 시험").count() > 0, "바깥 눌렀는데 등록 안 됨"


async def c_complaints_save(p):
    await shoot.nav(p, "민원대장")
    await p.locator(".cm-row", has_text="배수불량").first.dblclick()
    await p.wait_for_timeout(300)
    i = p.locator(".cm-row input[name=person]").last  # 첫째는 신규 줄
    await i.click()
    await p.keyboard.press("End")
    await p.keyboard.type("철")
    await press_out(p, (1400, 860))
    # 민원인 한 칸(2026-10-21) – 예전 연락처가 민원인 칸 끝에 붙어 있어 "…0000철"로 저장돼요.
    assert await p.locator(".cm-row", has_text="0000철").count() > 0, "바깥 눌렀는데 저장 안 됨"


async def c_complaints_move(p):
    """줄 우클릭 → 아래로 옮기기: 연번이 이웃과 바뀌고 그 민원이 한 줄 아래로 가요."""
    await shoot.nav(p, "민원대장")
    rows = p.locator(".cm-view")
    first = await rows.nth(0).get_attribute("data-cid")
    await rows.nth(0).click(button="right")
    await p.wait_for_timeout(250)
    assert await p.locator(".cm-rowmenu .dmenu-item", has_text="위로 옮기기").first.is_disabled(), "맨 위인데 위로 옮기기가 켜짐"
    await p.locator(".cm-rowmenu .dmenu-item", has_text="아래로 옮기기").first.click()
    await p.wait_for_timeout(300)
    assert await rows.nth(1).get_attribute("data-cid") == first, "아래로 안 옮겨짐"


async def c_no_browser_menu(p):
    """빈 곳 우클릭은 기본 메뉴를 막고, 입력 칸 안은 그대로 둬요."""
    await shoot.nav(p, "민원대장")
    r = await p.evaluate("""() => {
      const fire = (el) => { const e = new MouseEvent('contextmenu', {bubbles: true, cancelable: true}); el.dispatchEvent(e); return e.defaultPrevented; };
      return [fire(document.querySelector('.cm-empty, .cm-head, h1, body')), fire(document.querySelector('input[name=received]'))];
    }""")
    assert r == [True, False], f"막기 결과 {r}"


async def c_files_dialog(p):
    await shoot.nav(p, "탐색기")
    await shoot.s_files_delete(p)
    await p.wait_for_timeout(250)
    assert await shown(p, ".dialog"), "지우기 창 안 열림"
    await press_out(p, (20, 880))
    assert not await shown(p, ".dialog"), "바탕을 눌렀는데 안 닫힘"


CASES = {
    "tasks_listmenu": menu_case("할 일", shoot.s_tasks_listmenu, ".dmenu"),
    "journal_daymenu": menu_case("업무일지", shoot.s_journal_daymenu, ".dmenu"),
    "complaints_headmenu": menu_case("민원대장", shoot.s_complaints_headmenu, ".dmenu"),
    "complaints_filter": menu_case("민원대장", shoot.s_complaints_filter, ".cm-fdd"),
    "complaints_rowmenu": menu_case("민원대장", shoot.s_complaints_rowmenu, ".cm-rowmenu"),
    "complaints_rowmenu_ask": menu_case("민원대장", shoot.s_complaints_rowmenu_ask, ".cm-rowmenu"),
    "complaints_move": c_complaints_move,
    "no_browser_menu": c_no_browser_menu,
    "budget_menu": menu_case("집행현황", shoot.s_budget_menu, ".bd-pop"),
    "budgetstatus_menu": menu_case("예산현황", shoot.s_budgetstatus_menu, ".bd-pop", esc=False),
    "files_tabmenu": menu_case("탐색기", shoot.s_files_tabmenu, ".fx-tabmenu"),
    "process_rowmenu": menu_case("민원처리", shoot.s_process_rowmenu, ".pr-rowmenu"),
    "calendar_kindpicker": menu_case("캘린더", shoot.s_calendar_kindpicker, ".cal-kp-list"),
    "contacts_band": c_contacts_band,
    "contacts_pjmenu_esc": c_pjmenu_esc,
    "settings_esc": c_settings_esc,
    "settings_band": c_settings_band,
    "calendar_dialog": c_dialog,
    "files_dialog": c_files_dialog,
    "journal_save": c_journal_save,
    "tasks_add_save": c_tasks_add,
    "complaints_save": c_complaints_save,
}


async def main():
    site, *only = sys.argv[1:]
    srv, port = shoot.serve(site)
    bad = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for n in only or list(CASES):
            ctx = await br.new_context(viewport={"width": 1600, "height": 900}, locale="ko-KR", timezone_id="Asia/Seoul")
            ctx.set_default_timeout(5000)
            p = await ctx.new_page()
            await p.clock.set_fixed_time("2026-10-21T10:00:00+09:00")
            await p.add_init_script(path=os.path.join(shoot.HERE, "seed.js"))
            await p.goto(f"http://127.0.0.1:{port}/")
            await p.wait_for_timeout(900)
            try:
                await CASES[n](p)
                print(f"✓ {n}")
            except Exception as e:  # noqa: BLE001
                bad.append(n)
                print(f"✗ {n}: {str(e).splitlines()[0]}")
            await ctx.close()
        await br.close()
    srv.shutdown()
    print("통과" if not bad else f"통과 못 함 {len(bad)}개")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    asyncio.run(main())
