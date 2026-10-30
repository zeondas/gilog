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


async def s_complaints_rowmenu(p):
    await rclick(p, ".cm-view >> nth=1")


async def s_complaints_rowmenu_ask(p):
    await s_complaints_rowmenu(p)
    await p.locator(".cm-rowmenu .dmenu-item.danger").first.click()


async def s_complaints_filter(p):
    await p.locator(".cm-hbtn").first.click()


async def s_complaints_edit(p):
    """줄 전체 고치기 = 우클릭 "고치기"(두 번 누르기와 같음)"""
    await p.locator(".cm-view", has_text="배수불량").first.click(button="right")
    await p.wait_for_timeout(250)
    await p.locator(".cm-rowmenu .dmenu-item", has_text="고치기").first.click()
    await p.wait_for_timeout(300)


async def s_complaints_dbl(p):
    """두 번 누르기 = 줄 전체 고치기(2026-10-25 23:43 사용자 – 칸 하나 고치기 되돌림): 내용 칸을 두 번 누름"""
    await p.locator(".cm-view", has_text="배수불량").first.locator(".cm-multi").first.dblclick()
    await p.wait_for_timeout(300)


async def s_complaints_edit_ask(p):
    await s_complaints_edit(p)
    # 연번은 core가 접수일 순으로 매겨요(0.59.0 – 배수불량은 3번) – 번호와 상관없이 고치는 줄의 지우기 단추
    await p.locator("button.cm-del").first.click()


async def s_complaints_cats_merge(p):
    """분류 관리 창에서 쓰는 민원이 있는 접수유형(전화)의 × – 두 줄 "합칠까요?" 띠(2026-10-28 ✔1)"""
    await p.get_by_role("button", name="분류 관리").first.click()
    await p.wait_for_timeout(300)
    await p.get_by_role("button", name="전화 삭제").first.click()
    await p.wait_for_timeout(250)


async def s_complaints_newrow_baddate(p):
    i = p.locator("input[name=received]").first
    await i.fill("abc")
    await i.press("Tab")


async def s_contacts_card_ask(p):
    # 2026-10-26: 지우기는 고치는 카드 왼쪽 아래 – 연필로 고치는 카드를 연 뒤 휴지통
    await p.get_by_role("button", name="박정호 고치기").click()
    await p.get_by_role("button", name="박정호 지우기").click()


async def s_contacts_pjdialog(p):
    await p.locator("button", has_text="사업 관리").first.click()


async def s_contacts_pjmenu(p):
    await s_contacts_pjdialog(p)
    await p.wait_for_timeout(300)
    await p.locator(".pjm-row", has_text="방호벽 정비").first.click(button="right")


async def s_contacts_pjgroups(p):
    # 2026-10-27: 흉내 자료에 그룹이 없어 그룹 묶음 깨짐을 놓쳤어요 – 그룹 "포장"을 만들고 방호벽 정비를 넣은 모습
    await s_contacts_pjdialog(p)
    await p.wait_for_timeout(300)
    await p.get_by_role("button", name="그룹 추가").click()
    await p.wait_for_timeout(200)
    await p.keyboard.type("포장")
    await p.keyboard.press("Enter")
    await p.wait_for_timeout(400)
    await p.locator(".pjm-row", has_text="방호벽 정비").first.click(button="right")
    await p.wait_for_timeout(200)
    await p.locator(".pjm-menu-sub").first.hover()
    await p.wait_for_timeout(300)
    await p.locator(".pjm-gopt", has_text="포장").first.click()
    await p.wait_for_timeout(400)


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


async def press_layout(p, *names):
    for n in names:
        await p.locator(f".fx-tool[title^=\"{n}\"]").first.click()
        await p.wait_for_timeout(300)


# 칸 모양(2026-10-25 탐색기 세션): 두칸 상하·세칸 왼쪽 긴·세칸 오른쪽 긴·네칸
async def s_files_tb(p):
    await press_layout(p, "두칸보기")


async def s_files_3l(p):
    await press_layout(p, "세칸보기")


async def s_files_3r(p):
    await press_layout(p, "세칸보기", "세칸보기")


async def s_files_four(p):
    await press_layout(p, "네칸보기")


async def s_files_tabmenu(p):
    await rclick(p, ".fx-tab")


async def s_files_colmenu(p):
    await rclick(p, ".fx-hdr")


async def s_files_delete(p):
    await p.locator("[id^=fx-row-0-]").nth(2).click()
    await p.keyboard.press("Delete")


# 실행할까요?(2026-10-29 명령 경로 검사 ✔1) – 실행 파일을 두 번 누르면 뜨는 창
async def s_files_runask(p):
    await p.locator(".fx-crumbs").first.click(position={"x": 400, "y": 10})
    i = p.locator(".fx-path-in").first
    await i.fill("D:\\공사\\2026 도로포장 연간단가")
    await i.press("Enter")
    await p.wait_for_timeout(500)
    await p.locator("[id^=fx-row-0-]", has_text="단가표 보기.exe").first.dblclick()
    await p.wait_for_timeout(300)


async def s_process_rowmenu(p):
    await p.locator(".pr-more").first.click()


async def s_process_ask(p):
    await s_process_rowmenu(p)
    await p.locator(".dmenu-item.danger, .pr-rowmenu .danger").last.click()


async def s_process_works_ask(p):
    await p.locator("button", has_text="공사 관리").first.click()
    await p.wait_for_timeout(300)
    await p.locator(".dialog.pr-works button[aria-label$=' 지우기']").first.click()


async def s_calendar_quick_baddate(p):
    i = p.locator(".cal-quick input[name=date]").first
    await i.fill("abc")
    await i.press("Shift+Tab")


async def s_calendar_dlg_baddate(p):
    await p.locator(".cal-ev", has_text="방호벽 협의").first.dblclick()
    await p.wait_for_timeout(300)
    i = p.locator("input[aria-label='종료 날짜']").first
    await i.fill("abc")
    await i.press("Shift+Tab")


async def s_files_find_baddate(p):
    await p.keyboard.press("Control+f")
    await p.wait_for_timeout(300)
    i = p.locator("input[aria-label='수정한 날 시작']").first
    await i.fill("abc")
    await i.press("Shift+Tab")


async def s_settings_list_ask(p):
    await p.locator(".chip-x").first.click()


async def s_complaints_import(p):
    # 엑셀 가져오기 – 방식 고르기 창(2026-10-25 공통 ✔5). 미리 보기는 먼저 내보낸 파일만 읽어서 내보내기부터 해요.
    await p.locator(".xl-btn").first.click()
    await p.locator(".xl-item", has_text="내보내기").first.click()
    await p.wait_for_timeout(300)
    await p.locator(".xl-btn").first.click()
    await p.locator(".xl-item", has_text="가져오기").first.click()
    await p.wait_for_timeout(400)


async def s_complaints_import_merge(p):
    await s_complaints_import(p)
    await p.locator(".xl-pk", has_text="덮어쓰기").first.click()


async def s_complaints_import_replace(p):
    await s_complaints_import(p)
    await p.locator(".xl-pk", has_text="대체하기").first.click()


async def s_settings_calendar(p):
    # 설정 "캘린더" 카드 안 구글 연동 묶음(2026-10-25 공통 ✔3)
    await p.locator("section[aria-label='캘린더']").first.scroll_into_view_if_needed()
    await p.wait_for_timeout(200)



async def s_settings_clear(p):
    # 설정 맨 아래 "자료 지우기"(2026-10-30 설정 ✔1) – 스위치를 켠 모습
    card = p.locator("section[aria-label='자료 지우기']").first
    await card.locator("[role=switch]").click()
    await p.wait_for_timeout(300)
    await card.scroll_into_view_if_needed()
    await p.evaluate("() => document.querySelector('.main').scrollTo(0, 99999)")
    await p.wait_for_timeout(200)


async def s_settings_clear_ask(p):
    # 집행현황 줄의 "정말 지울까요?" 띠
    await s_settings_clear(p)
    await p.locator("[data-clear='budget'] .clr-btn").click()
    await p.evaluate("() => document.querySelector('.main').scrollTo(0, 99999)")
    await p.wait_for_timeout(200)


# ---------- 매뉴얼 장면(2026-10-26 매뉴얼 세션 – 창이 열린 모습) ----------
async def s_process_works(p):
    await p.locator("button", has_text="공사 관리").first.click()
    await p.wait_for_timeout(300)


async def s_budgetstatus_settings(p):
    await p.locator("button.bs-gear").first.click()
    await p.wait_for_timeout(300)


async def s_calendar_new(p):
    # 빈 날(10/27)을 두 번 눌러 새 일정 창 – 머리 "새 일정"·첫 줄 "제목" 칸(10-28 캘린더 ✔1)
    await p.locator("[role=gridcell]").nth(30).dblclick()
    await p.wait_for_timeout(300)


async def s_calendar_notitle(p):
    # 제목 없이 빠른 입력 등록 → "제목 없음" 칩(10-28 캘린더 ✔1)
    t = p.locator(".cal-quick input[name=time]").first
    await t.click()
    await t.fill("14")
    await p.locator(".cal-add").first.click()
    await p.wait_for_timeout(300)


async def s_calendar_event(p):
    await p.locator(".cal-ev", has_text="방호벽 협의").first.dblclick()
    await p.wait_for_timeout(300)


async def s_journal_memo(p):
    i = p.locator("input.cell-input[placeholder='구분']").first
    await i.click()
    await i.fill("메모")
    await i.press("Tab")
    await p.wait_for_timeout(300)



async def s_files_findmore(p):
    await p.locator("button.fx-more").first.click()
    await p.wait_for_timeout(300)


async def s_files_viewmenu(p):
    await p.locator("button.fx-vb").first.click()
    await p.wait_for_timeout(300)


async def s_settings_files(p):
    await p.locator('section.mod-card:has(.mod-head:text-is("탐색기"))').first.scroll_into_view_if_needed()
    await p.wait_for_timeout(300)

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
    "complaints_rowmenu": ("민원대장", s_complaints_rowmenu),
    "complaints_rowmenu_ask": ("민원대장", s_complaints_rowmenu_ask),
    "complaints_dbl": ("민원대장", s_complaints_dbl),
    "complaints_cats_merge": ("민원대장", s_complaints_cats_merge),
    "complaints_edit_ask": ("민원대장", s_complaints_edit_ask),
    "complaints_newrow_baddate": ("민원대장", s_complaints_newrow_baddate),
    "contacts_card_ask": ("업무연락처", s_contacts_card_ask),
    "contacts_pjdialog": ("업무연락처", s_contacts_pjdialog),
    "contacts_pjmenu": ("업무연락처", s_contacts_pjmenu),
    "contacts_pjgroups": ("업무연락처", s_contacts_pjgroups),
    "calendar_event_ask": ("캘린더", s_calendar_event_ask),
    "calendar_kinds": ("캘린더", s_calendar_kinds),
    "calendar_kindpicker": ("캘린더", s_calendar_kindpicker),
    "budget_menu": ("집행현황", s_budget_menu),
    "budget_confirm": ("집행현황", s_budget_confirm),
    "budgetstatus_menu": ("예산현황", s_budgetstatus_menu),
    "files_tabmenu": ("탐색기", s_files_tabmenu),
    "files_tb": ("탐색기", s_files_tb),
    "files_3l": ("탐색기", s_files_3l),
    "files_3r": ("탐색기", s_files_3r),
    "files_four": ("탐색기", s_files_four),
    "files_colmenu": ("탐색기", s_files_colmenu),
    "files_delete": ("탐색기", s_files_delete),
    "files_runask": ("탐색기", s_files_runask),
    "process_rowmenu": ("민원처리", s_process_rowmenu),
    "process_ask": ("민원처리", s_process_ask),
    "process_works_ask": ("민원처리", s_process_works_ask),
    "calendar_quick_baddate": ("캘린더", s_calendar_quick_baddate),
    "calendar_dlg_baddate": ("캘린더", s_calendar_dlg_baddate),
    "files_find_baddate": ("탐색기", s_files_find_baddate),
    "settings_list_ask": ("설정", s_settings_list_ask),
    "complaints_import": ("민원대장", s_complaints_import),
    "complaints_import_merge": ("민원대장", s_complaints_import_merge),
    "complaints_import_replace": ("민원대장", s_complaints_import_replace),
    "process_works": ("민원처리", s_process_works),
    "budgetstatus_settings": ("예산현황", s_budgetstatus_settings),
    "calendar_event": ("캘린더", s_calendar_event),
    "calendar_new": ("캘린더", s_calendar_new),
    "calendar_notitle": ("캘린더", s_calendar_notitle),
    "journal_memo": ("업무일지", s_journal_memo),
    "files_findmore": ("탐색기", s_files_findmore),
    "files_viewmenu": ("탐색기", s_files_viewmenu),
    "settings_files": ("설정", s_settings_files),
    "settings_calendar": ("설정", s_settings_calendar),
    "settings_clear": ("설정", s_settings_clear),
    "settings_clear_ask": ("설정", s_settings_clear_ask),
})


# 화면 크기(창 배율) 장면 – 2026-10-21 화면 배율: 설정 "화면 크기" 15·17을 앱(WebView2 확대)과 같은 방식으로 흉내 내요.
# CSS 화면을 1600÷z × 900÷z로 줄이고 점 배율 z로 찍어 그림은 늘 1600×900이에요. 기준(13·100%) 장면과 따로 비교돼요.
ZOOMS = (15, 17)
ZOOM_OF = {}
for _z in ZOOMS:
    for _i, _n in enumerate(SCREENS):
        SCENES[f"zoom{_z}_{_i:02d}"] = (_n, None)
        ZOOM_OF[f"zoom{_z}_{_i:02d}"] = _z


# 작은 창 장면(2026-10-26 창 크기 세션, docs/qa/viewport.md): 창 1200×700·13에서 화면 10개 – 본문 가로 스크롤 자리를 지켜요.
SMALL = set()
for _i, _n in enumerate(SCREENS):
    SCENES[f"small_{_i:02d}"] = (_n, None)
    SMALL.add(f"small_{_i:02d}")


async def one(br, url, out, name):
    screen, act = SCENES[name]
    z = ZOOM_OF.get(name, 13) / 13
    vp = {"width": 1200, "height": 700} if name in SMALL else {"width": round(1600 / z), "height": round(900 / z)}
    ctx = await br.new_context(viewport=vp, device_scale_factor=z, locale="ko-KR", timezone_id="Asia/Seoul")
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
        await p.mouse.move(vp["width"] - 1, vp["height"] - 1)
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
        bars = await pw.chromium.launch(ignore_default_args=["--hide-scrollbars"]) if any(n in SMALL for n in names) else None
        for n in names:
            await one(bars if n in SMALL else br, f"http://127.0.0.1:{port}/", out, n)
        await br.close()
        if bars:
            await bars.close()
    srv.shutdown()
    bad = [n for n in names if os.path.exists(os.path.join(out, n + ".fail.txt"))]
    print(f"{len(names) - len(bad)}/{len(names)} 장면 찍음" + (f" · 실패 {', '.join(bad)}" if bad else ""))


if __name__ == "__main__":
    asyncio.run(main())
