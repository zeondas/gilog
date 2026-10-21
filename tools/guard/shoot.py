"""모양 지킴이 – 장면 찍기.

  python3 tools/guard/shoot.py <빌드한 폴더> <찍을 폴더> [장면 이름 ...]

시계는 2026-10-21 10:00(서울)로 고정, 1600×900·100%·밝게, 움직임(전환·깜빡이는 커서)은 끄고 찍어요.
장면마다 새 창에서 seed.js 자료로 시작해요. 장면이 실패하면 그 이름.fail.txt에 까닭을 남겨요.
"""
import asyncio
import functools
import http.server
import os
import socketserver

http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
import sys
import threading

from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
STILL = "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}"


def serve(root):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
    s = socketserver.TCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, s.server_address[1]


async def nav(p, name):
    await p.get_by_role("button", name=name, exact=True).first.click()
    await p.wait_for_timeout(600)
    # 사이드바 단추에 남은 포커스 테두리가 찍힐 때마다 달라지지 않게 내려놓아요(화면이 스스로 잡은 포커스는 그대로)
    await p.evaluate("() => { const a = document.activeElement; if (a && a.closest('nav, aside, .sidebar')) a.blur(); }")


async def rclick(p, sel):
    await p.locator(sel).first.click(button="right")
    await p.wait_for_timeout(300)


# ---------- 장면 ----------
# 이름: (화면, 할 일) – 할 일은 async 함수(p) 또는 None(화면만)
async def s_tasks_listmenu(p):
    await p.locator(".td-lists button", has_text="행정업무").first.click(button="right")


async def s_tasks_listmenu_ask(p):
    await s_tasks_listmenu(p)
    await p.locator(".dmenu .dmenu-item.danger").first.click()


async def s_tasks_item_ask(p):
    await p.locator(".td-row", has_text="행정사무감사 자료").first.click()
    await p.wait_for_timeout(200)
    await p.locator(".td-row-acts button[aria-label*='지우']").first.click()


async def s_tasks_edit_ask(p):
    await p.locator(".td-row", has_text="행정사무감사 자료").first.click()
    await p.wait_for_timeout(200)
    await p.keyboard.press("Enter")
    await p.wait_for_timeout(300)
    await p.get_by_role("button", name="이 할 일 지우기").last.click()


async def s_tasks_add_baddate(p):
    await p.get_by_placeholder("할 일 추가").first.click()
    await p.keyboard.type("새 일")
    await p.locator("input[name=due]").first.fill("abc")
    await p.locator("input[name=due]").first.press("Shift+Tab")


async def s_tasks_minical(p):
    await p.get_by_placeholder("할 일 추가").first.click()
    await p.locator(".td-cal-btn").first.click()


async def s_journal_daymenu(p):
    await p.locator(".jcal-day", has_text="20").first.click(button="right")


async def s_journal_daymenu_ask(p):
    await s_journal_daymenu(p)
    await p.locator(".dmenu .dmenu-item.danger").first.click()


async def s_journal_edit_ask(p):
    await p.locator(".jcard", has_text="설계 변경").first.dblclick()
    await p.wait_for_timeout(300)
    await p.get_by_role("button", name="이 기록 지우기").first.click()


async def s_journal_print_bad(p):
    await p.locator("button", has_text="인쇄").first.click()
    await p.wait_for_timeout(300)
    i = p.locator(".jp-field-box input").first
    await i.fill("abc")
    await i.press("Shift+Tab")


async def s_complaints_headmenu(p):
    await rclick(p, ".cm-head")


async def s_complaints_filter(p):
    await p.locator(".cm-hbtn").first.click()


async def s_complaints_edit_ask(p):
    await p.locator(".cm-row", has_text="배수불량").first.dblclick()
    await p.wait_for_timeout(300)
    await p.get_by_role("button", name="2번 민원 지우기").first.click()


async def s_complaints_newrow_baddate(p):
    i = p.locator("input[name=received]").first
    await i.fill("abc")
    await i.press("Tab")


async def s_contacts_card_ask(p):
    await p.get_by_role("button", name="박정호 지우기").click()


async def s_contacts_pjdialog(p):
    await p.locator("button", has_text="사업 관리").first.click()


async def s_contacts_pjmenu(p):
    await s_contacts_pjdialog(p)
    await p.wait_for_timeout(300)
    await p.locator(".pjm-row", has_text="방호벽 정비").first.click(button="right")


async def s_calendar_event_ask(p):
    await p.locator(".cal-ev", has_text="방호벽 협의").first.dblclick()
    await p.wait_for_timeout(300)
    await p.locator(".cal-trash").first.click()


async def s_calendar_kinds(p):
    await p.locator("button", has_text="관리").first.click()


async def s_calendar_kindpicker(p):
    await p.locator(".cal-kp, button[aria-haspopup=listbox]").first.click()


async def s_budget_menu(p):
    await rclick(p, ".bd-rw.pj")


async def s_budget_confirm(p):
    await s_budget_menu(p)
    await p.locator(".bd-mi.dg").first.click()


async def s_budgetstatus_menu(p):
    await rclick(p, "[class*=bs-rw], .bd-rw")


async def s_files_tabmenu(p):
    await rclick(p, ".fx-tab")


async def s_files_colmenu(p):
    await rclick(p, ".fx-hdr")


async def s_files_delete(p):
    await p.locator("[id^=fx-row-0-]").nth(2).click()
    await p.keyboard.press("Delete")


async def s_process_rowmenu(p):
    await p.locator(".pr-more").first.click()


async def s_process_ask(p):
    await s_process_rowmenu(p)
    await p.locator(".dmenu-item.danger, .pr-rowmenu .danger").last.click()


async def s_process_works_ask(p):
    await p.locator("button", has_text="공사 관리").first.click()
    await p.wait_for_timeout(300)
    await p.locator(".dialog.pr-works button[aria-label$=' 지우기']").first.click()


async def s_settings_list_ask(p):
    await p.locator(".chip-x").first.click()


SCREENS = ["탐색기", "민원대장", "민원처리", "집행현황", "예산현황", "캘린더", "할 일", "업무일지", "업무연락처", "설정"]
SCENES = {f"screen_{i:02d}": (n, None) for i, n in enumerate(SCREENS)}
SCENES.update({
    "tasks_listmenu": ("할 일", s_tasks_listmenu),
    "tasks_listmenu_ask": ("할 일", s_tasks_listmenu_ask),
    "tasks_item_ask": ("할 일", s_tasks_item_ask),
    "tasks_edit_ask": ("할 일", s_tasks_edit_ask),
    "tasks_add_baddate": ("할 일", s_tasks_add_baddate),
    "tasks_minical": ("할 일", s_tasks_minical),
    "journal_daymenu": ("업무일지", s_journal_daymenu),
    "journal_daymenu_ask": ("업무일지", s_journal_daymenu_ask),
    "journal_edit_ask": ("업무일지", s_journal_edit_ask),
    "journal_print_bad": ("업무일지", s_journal_print_bad),
    "complaints_headmenu": ("민원대장", s_complaints_headmenu),
    "complaints_filter": ("민원대장", s_complaints_filter),
    "complaints_edit_ask": ("민원대장", s_complaints_edit_ask),
    "complaints_newrow_baddate": ("민원대장", s_complaints_newrow_baddate),
    "contacts_card_ask": ("업무연락처", s_contacts_card_ask),
    "contacts_pjdialog": ("업무연락처", s_contacts_pjdialog),
    "contacts_pjmenu": ("업무연락처", s_contacts_pjmenu),
    "calendar_event_ask": ("캘린더", s_calendar_event_ask),
    "calendar_kinds": ("캘린더", s_calendar_kinds),
    "calendar_kindpicker": ("캘린더", s_calendar_kindpicker),
    "budget_menu": ("집행현황", s_budget_menu),
    "budget_confirm": ("집행현황", s_budget_confirm),
    "budgetstatus_menu": ("예산현황", s_budgetstatus_menu),
    "files_tabmenu": ("탐색기", s_files_tabmenu),
    "files_colmenu": ("탐색기", s_files_colmenu),
    "files_delete": ("탐색기", s_files_delete),
    "process_rowmenu": ("민원처리", s_process_rowmenu),
    "process_ask": ("민원처리", s_process_ask),
    "process_works_ask": ("민원처리", s_process_works_ask),
    "settings_list_ask": ("설정", s_settings_list_ask),
})


async def one(br, url, out, name):
    screen, act = SCENES[name]
    ctx = await br.new_context(viewport={"width": 1600, "height": 900}, device_scale_factor=1, locale="ko-KR", timezone_id="Asia/Seoul")
    ctx.set_default_timeout(5000)
    p = await ctx.new_page()
    await p.clock.set_fixed_time("2026-10-21T10:00:00+09:00")
    await p.add_init_script(path=os.path.join(HERE, "seed.js"))
    fail = os.path.join(out, name + ".fail.txt")
    try:
        await p.goto(url)
        await p.wait_for_timeout(900)
        await p.add_style_tag(content=STILL)
        await nav(p, screen)
        if act:
            await act(p)
        await p.mouse.move(1599, 899)
        await p.wait_for_timeout(500)
        await p.evaluate("() => document.fonts.ready")
        await p.screenshot(path=os.path.join(out, name + ".png"))
        if os.path.exists(fail):
            os.remove(fail)
    except Exception as e:  # noqa: BLE001
        with open(fail, "w", encoding="utf-8") as f:
            f.write(str(e).splitlines()[0])
    await ctx.close()


async def main():
    site, out, *only = sys.argv[1:]
    os.makedirs(out, exist_ok=True)
    srv, port = serve(site)
    names = only or list(SCENES)
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for n in names:
            await one(br, f"http://127.0.0.1:{port}/", out, n)
        await br.close()
    srv.shutdown()
    bad = [n for n in names if os.path.exists(os.path.join(out, n + ".fail.txt"))]
    print(f"{len(names) - len(bad)}/{len(names)} 장면 찍음" + (f" · 실패 {', '.join(bad)}" if bad else ""))


if __name__ == "__main__":
    asyncio.run(main())
