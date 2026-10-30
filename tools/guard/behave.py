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
    # 고치는 카드 안 띠 – 바깥을 누르면 띠가 접히며 고친 것은 저장(카드가 보기로 돌아감)
    assert not await shown(p, ".ccard-edit"), "바깥 눌러도 고치는 카드가 남음"


async def c_settings_band(p):
    await shoot.nav(p, "설정")
    await shoot.s_settings_list_ask(p)
    assert await shown(p, ".list-ask"), "띠 안 열림"
    await press_out(p, (1500, 60))
    assert not await shown(p, ".list-ask"), "바깥 눌러도 띠가 남음"


async def c_complaints_merge(p):
    """분류 관리: 쓰는 민원이 있는 접수유형을 지우면 고르기 전엔 단추가 막히고, 고른 값으로 N건 바꾸고 지워요(2026-10-28 ✔1)."""
    await shoot.nav(p, "민원대장")
    await shoot.s_complaints_cats_merge(p)
    assert await shown(p, ".ask-band.ask-two"), "두 줄 띠 안 열림"
    f = await p.evaluate("() => document.activeElement && document.activeElement.textContent")
    assert f == "취소", f"커서가 취소에 없음({f})"
    yes = p.get_by_role("button", name="합치고 지우기")
    assert await yes.is_disabled(), "고르기 전인데 단추가 눌림"
    await p.locator("input[name=merge-to]").click()
    await p.wait_for_timeout(150)
    await p.keyboard.press("Escape")
    await p.wait_for_timeout(150)
    assert await shown(p, ".ask-band.ask-two"), "목록 Esc에 띠까지 접힘"
    await p.locator("input[name=merge-to]").click()
    await p.locator(".pin-opt", has_text="방문").first.click()
    await p.wait_for_timeout(150)
    assert not await yes.is_disabled(), "고른 뒤에도 단추가 막힘"
    await yes.click()
    await p.wait_for_timeout(400)
    assert not await shown(p, ".ask-band"), "합친 뒤 띠가 남음"
    chips = await p.locator(".mgr-group").first.locator(".chip").all_inner_texts()
    assert "전화" not in [c.strip() for c in chips], f"목록에 전화가 남음 {chips}"
    left = await p.evaluate("() => [...document.querySelectorAll('.cm-view')].map(r => r.querySelectorAll('[role=cell]')[1].getAttribute('title') || r.querySelectorAll('[role=cell]')[1].textContent)")
    assert "전화" not in left and left.count("방문") == 2, f"민원 값이 안 바뀜 {left}"


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


async def c_settings_clear(p):
    # 자료 지우기(2026-10-30 설정 ✔1): 띠는 취소에 커서·Esc·바깥 누르기로 접히고 지우지 않아요.
    await shoot.nav(p, "설정")
    await shoot.s_settings_clear_ask(p)
    band = "[data-clear='budget'] .ask-band"
    assert await shown(p, band), "띠 안 열림"
    assert await p.evaluate("() => document.activeElement?.textContent === '취소'"), "취소에 커서가 없음"
    await p.keyboard.press("Escape")
    await p.wait_for_timeout(250)
    assert not await shown(p, band), "Esc로 띠가 안 접힘"
    await p.locator("[data-clear='budget'] .clr-btn").click()
    await press_out(p, (1500, 60))
    assert not await shown(p, band), "바깥 눌러도 띠가 남음"
    assert "지울 것 없음" not in (await p.locator("[data-clear='budget']").inner_text()), "띠를 접었는데 지워짐"


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


async def c_calendar_notitle_quick(p):
    # 10-28 캘린더 ✔1: 제목을 비우고 빠른 입력으로 등록하면 "제목 없음"
    await shoot.nav(p, "캘린더")
    await shoot.s_calendar_notitle(p)
    assert await p.locator(".cal-ev", has_text="제목 없음").count() > 0, "제목 없이 등록이 안 됨"


async def c_calendar_notitle_outside(p):
    # 10-28 캘린더 ✔1 버그: 새 일정 창에서 제목 없이 장소만 적고 바깥을 누르면 "제목 없음"으로 저장(전엔 버려짐)
    await shoot.nav(p, "캘린더")
    await shoot.s_calendar_new(p)
    await p.locator(".cal-dialog input[aria-label='장소']").first.fill("문산읍 현장")
    await press_out(p, (20, 880))
    assert not await shown(p, ".cal-dialog"), "바깥 눌렀는데 창이 남음"
    assert await p.locator(".cal-ev", has_text="제목 없음").count() > 0, "바깥 눌렀는데 저장 안 됨"


async def c_calendar_blank_close(p):
    # 아무것도 안 적은 새 일정 창은 바깥을 누르면 그냥 닫혀요(일정 안 생김)
    await shoot.nav(p, "캘린더")
    n = await p.locator(".cal-ev").count()
    await shoot.s_calendar_new(p)
    await press_out(p, (20, 880))
    assert not await shown(p, ".cal-dialog"), "바깥 눌렀는데 창이 남음"
    assert await p.locator(".cal-ev").count() == n, "아무것도 안 적었는데 일정이 생김"


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


# ---------- 할 일 체크 움직임 (2026-10-25 할 일 ①~④ 1안) ----------
def _row(p, title):
    return p.locator(".td-row", has_text=title).first


async def _in_open(p, title):
    return await p.locator(".td-items .td-row", has_text=title).count() > 0


async def c_tasks_check(p):
    await shoot.nav(p, "할 일")
    btn = _row(p, "행정사무감사 자료").locator("button.td-check")
    # ① 올리면 연한 체크가 미리 보임
    await btn.hover()
    await p.wait_for_timeout(100)
    op = await btn.locator(".td-tick").evaluate("e => getComputedStyle(e).opacity")
    assert abs(float(op) - 0.4) < 0.01, f"올렸을 때 미리 보기 투명도 {op}"
    # ② 누르면 바로 체크 모양 + 움직임, ③ 움직이는 동안 제자리
    await btn.click()
    await p.wait_for_timeout(120)
    assert await _row(p, "행정사무감사 자료").locator("button.td-check.pop[aria-pressed=true]").count() == 1, "누른 직후 체크·움직임이 없음"
    assert await _in_open(p, "행정사무감사 자료"), "움직이는 동안 제자리에 없음"
    await p.wait_for_timeout(600)
    assert not await _in_open(p, "행정사무감사 자료"), "움직임이 끝났는데 완료됨으로 안 내려감"
    assert await p.locator(".td-check.pop").count() == 0, "움직임 표시가 남음"
    # 저장됐는지: 다른 화면에 갔다 와도 완료
    await shoot.nav(p, "업무일지")
    await shoot.nav(p, "할 일")
    assert not await _in_open(p, "행정사무감사 자료"), "다시 열었더니 완료가 저장 안 됨"
    # ④ 되돌리기는 움직임 없이 바로
    await p.locator(".td-card", has_text="행정업무").locator(".td-done-toggle").click()
    await _row(p, "행정사무감사 자료").locator("button.td-check").click()
    await p.wait_for_timeout(80)
    assert await p.locator(".td-check.pop").count() == 0, "되돌리기에 움직임이 있음"
    assert await _in_open(p, "행정사무감사 자료"), "되돌렸는데 남은 일로 안 돌아옴"


async def c_tasks_check_parent(p):
    await shoot.nav(p, "할 일")
    await _row(p, "예산 요구서 작성").locator("button.td-check").click()
    await p.wait_for_timeout(120)
    kid = _row(p, "증감 내역 정리")
    assert await _in_open(p, "증감 내역 정리"), "위 항목이 움직이는 동안 하위 항목이 먼저 내려감"
    assert await kid.locator("button.td-check[aria-pressed=true]").count() == 1, "하위 항목이 함께 체크 안 됨"
    assert await kid.locator("button.td-check.pop").count() == 0, "하위 항목도 움직임(④ 1안은 직접 누른 것만)"
    await p.wait_for_timeout(600)
    assert not await _in_open(p, "예산 요구서 작성") and not await _in_open(p, "증감 내역 정리"), "위·하위 항목이 함께 안 내려감"


async def c_tasks_check_space(p):
    await shoot.nav(p, "할 일")
    await _row(p, "행정사무감사 자료").locator("button.td-check").focus()
    await p.keyboard.press("Space")
    await p.wait_for_timeout(120)
    assert await p.locator(".td-check.pop").count() == 1, "Space로 체크해도 움직임이 없음"
    await p.wait_for_timeout(600)
    assert not await _in_open(p, "행정사무감사 자료"), "Space 체크 뒤 안 내려감"


async def c_tasks_check_complaint(p):
    await shoot.nav(p, "할 일")
    btn = p.locator(".td-items button.td-check.linked[aria-pressed=false]").first
    title = (await btn.locator("xpath=..").locator(".td-title-t").inner_text()).strip()
    n0 = await p.locator(".td-items .td-row", has_text=title).count()
    await btn.click()
    await p.wait_for_timeout(120)
    assert await p.locator(".td-check.linked.pop").count() == 1, "민원 체크에 움직임이 없음"
    await p.wait_for_timeout(600)
    assert await p.locator(".td-items .td-row", has_text=title).count() == n0 - 1, "민원이 완료됨으로 안 내려감"
    await shoot.nav(p, "민원대장")
    assert await p.locator(".cm-row", has_text="답변").count() > 0, "민원대장 상태가 답변으로 안 바뀜"


async def c_tasks_check_reduced(p):
    await p.emulate_media(reduced_motion="reduce")
    await shoot.nav(p, "할 일")
    await _row(p, "행정사무감사 자료").locator("button.td-check").click()
    await p.wait_for_timeout(80)
    assert await p.locator(".td-check.pop").count() == 0, "움직임 줄이기인데 움직임이 있음"
    assert not await _in_open(p, "행정사무감사 자료"), "움직임 줄이기면 바로 내려가야 함"


async def c_files_side_buttons(p):
    # Mouse side buttons (2026-10-26): WebView2 sends only pointer events + auxclick
    # for buttons 3/4 – no mousedown/mouseup. Back = 3, forward = 4, in the pane under the mouse.
    await shoot.nav(p, "탐색기")
    await p.wait_for_timeout(500)
    pane = "section[aria-label='창 1']"
    tab = f"{pane} .fx-tab[data-on='1']"
    start = await p.get_attribute(tab, "title")
    await p.click(f"{pane} .fx-drv[title^='C:']")
    await p.wait_for_timeout(400)
    moved = await p.get_attribute(tab, "title")
    assert moved != start, f"드라이브 이동 안 됨: {moved}"

    async def side(btn):
        await p.evaluate(
            """([sel, b]) => {
              const el = document.querySelector(sel + ' .fx-tabs');
              const o = { bubbles: true, cancelable: true, button: b, pointerType: 'mouse', isPrimary: true };
              el.dispatchEvent(new PointerEvent('pointerdown', { ...o, buttons: b === 3 ? 8 : 16 }));
              el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
              el.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: b }));
            }""",
            [pane, btn],
        )
        await p.wait_for_timeout(400)

    await side(3)
    back = await p.get_attribute(tab, "title")
    assert back == start, f"뒤로 안 됨: {back} (기대 {start})"
    await side(4)
    fwd = await p.get_attribute(tab, "title")
    assert fwd == moved, f"앞으로 안 됨: {fwd} (기대 {moved})"


async def c_files_rename_ok(p):
    # Batch rename [확인] (2026-10-26): rename + close; no change = just close; red rows = disabled.
    await shoot.nav(p, "탐색기")
    await p.wait_for_timeout(500)
    tool = ".fx-tool[title='일괄 이름 바꾸기']"
    pat = "input[aria-label='파일 이름 패턴']"
    await p.click(tool)
    await p.fill(pat, "같음")
    await p.wait_for_timeout(200)
    assert await p.locator(".fx-rn-ok").is_disabled(), "빨간 줄인데 확인이 눌림"
    await p.fill(pat, "[n]")
    await p.click(".fx-rn-ok")
    await p.wait_for_timeout(300)
    assert await p.locator(".fx-rn").count() == 0, "바뀔 것 없는데 안 닫힘"
    await p.click(tool)
    await p.fill(pat, "[n]_x")
    await p.click(".fx-rn-ok")
    await p.wait_for_timeout(500)
    assert await p.locator(".fx-rn").count() == 0, "바꾼 뒤 안 닫힘"
    text = await p.locator("section[aria-label='창 1']").inner_text()
    assert "_x." in text, "이름이 안 바뀜"


async def c_complaints_save(p):
    await shoot.nav(p, "민원대장")
    await shoot.s_complaints_edit(p)
    i = p.locator(".cm-row input[name=person]").last  # 첫째는 신규 줄
    await i.click()
    await p.keyboard.press("End")
    await p.keyboard.type("철")
    await press_out(p, (1400, 860))
    # 민원인 한 칸(2026-10-21) – 예전 연락처가 민원인 칸 끝에 붙어 있어 "…0000철"로 저장돼요.
    assert await p.locator(".cm-row", has_text="0000철").count() > 0, "바깥 눌렀는데 저장 안 됨"


async def c_complaints_dbl(p):
    """칸 어디를 두 번 눌러도 줄 전체가 입력 줄 · 위치·민원인 칸은 한 번 누르면 복사(2026-10-25 23:43 사용자)."""
    await shoot.nav(p, "민원대장")
    row = p.locator(".cm-view", has_text="배수불량").first
    await row.locator(".cm-copy").first.click()
    await p.wait_for_timeout(150)
    assert await p.locator(".cm-copy.copied").count() == 1, "위치를 눌렀는데 복사 표시가 없음"
    await row.locator(".cm-person .cm-copy").click()
    await p.wait_for_timeout(150)
    assert await p.locator(".cm-person .cm-copy.copied").count() == 1, "민원인을 눌렀는데 복사 표시가 없음"
    assert await p.locator(".cm-edit").count() == 0, "한 번 눌렀는데 고치기가 열림"
    await shoot.s_complaints_dbl(p)
    edit = p.locator(".cm-edit")
    assert await edit.count() == 1, "두 번 눌렀는데 고치기 줄이 안 열림"
    for n in ("intake", "place", "person", "due", "status"):
        assert await edit.locator(f"input[name={n}]").count() == 1, f"줄 전체가 아님 – {n} 칸 없음"
    await p.keyboard.press("Escape")
    await p.wait_for_timeout(250)
    assert await p.locator(".cm-edit").count() == 0, "Esc로 안 닫힘"



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


async def c_files_runask(p):
    """실행할까요?(2026-10-29 명령 경로 검사): 실행 파일 두 번 누르기 → 창, [실행]에 커서, Esc·바깥으로 닫힘."""
    await shoot.nav(p, "탐색기")
    await shoot.s_files_runask(p)
    await p.wait_for_timeout(250)
    assert await shown(p, ".dialog"), "실행할까요 창 안 열림"
    f = await p.evaluate("() => document.activeElement && document.activeElement.textContent")
    assert f == "실행", f"커서가 실행에 없음({f})"
    await p.keyboard.press("Escape")
    await p.wait_for_timeout(250)
    assert not await shown(p, ".dialog"), "Esc로 안 닫힘"
    await p.locator("[id^=fx-row-0-]", has_text="단가표 보기.exe").first.dblclick()
    await p.wait_for_timeout(250)
    assert await shown(p, ".dialog"), "다시 열리지 않음"
    await press_out(p, (20, 880))
    assert not await shown(p, ".dialog"), "바탕을 눌렀는데 안 닫힘"


def band_esc(screen, opener, sel, keep=None):
    """지울까요 띠: 열리면 취소에 커서, Esc는 띠만 접고(감싼 창·카드는 남음)."""
    async def run(p):
        await shoot.nav(p, screen)
        await opener(p)
        await p.wait_for_timeout(250)
        assert await shown(p, sel), "띠 안 열림"
        f = await p.evaluate("() => document.activeElement && document.activeElement.textContent")
        assert f == "취소", f"커서가 취소에 없음({f})"
        await p.keyboard.press("Escape")
        await p.wait_for_timeout(250)
        assert not await shown(p, sel), "Esc로 띠가 안 접힘"
        if keep:
            assert await shown(p, keep), "Esc 한 번에 감싼 것까지 닫힘"
    return run


DATE_OK = ["261015", "26-10-15", "26.10.15", "26/10/15", "1015", "10/15", "2026-10-15", "20261015"]


def date_case(screen, opener, sel, box_sel=None):
    """날짜 칸: 보기 값 여덟 개는 떠날 때 2026-10-15로, abc는 그대로 + 빨강(aria-invalid)."""
    async def run(p):
        await shoot.nav(p, screen)
        if opener:
            await opener(p)
            await p.wait_for_timeout(250)
        i = p.locator(sel).first

        async def put(v):
            # 줄여 보이는 칸(민원대장)은 커서가 들어가야 온 값이 보여서, 들어간 뒤 모두 골라 쳐요.
            await i.focus()
            await p.wait_for_timeout(30)
            await p.keyboard.press("Control+a")
            await p.keyboard.type(v)

        for v in DATE_OK:
            await put(v)
            assert await i.input_value() == v, f"치는 도중에 바뀜({v})"
            await i.blur()
            await p.wait_for_timeout(60)
            await i.focus()
            await p.wait_for_timeout(30)
            got = await i.input_value()
            assert got == "2026-10-15", f"{v} → {got}"
        await put("abc")
        await i.blur()
        await p.wait_for_timeout(100)
        assert await i.input_value() == "abc", "읽을 수 없는 글을 지움"
        assert await i.get_attribute("aria-invalid") == "true", "읽을 수 없는데 빨강 아님"
        await put("1015")
        await i.blur()
        await p.wait_for_timeout(100)
        assert await i.get_attribute("aria-invalid") != "true", "고친 뒤에도 빨강"
    return run


async def open_tasks_add(p):
    await p.get_by_placeholder("할 일 추가").first.click()


async def open_print(p):
    await p.locator("button", has_text="인쇄").first.click()


async def open_find(p):
    await p.keyboard.press("Control+f")


async def open_cal_dialog(p):
    await p.locator(".cal-ev", has_text="방호벽 협의").first.dblclick()


CASES = {
    "tasks_listmenu": menu_case("할 일", shoot.s_tasks_listmenu, ".dmenu"),
    "journal_daymenu": menu_case("업무일지", shoot.s_journal_daymenu, ".dmenu"),
    "complaints_headmenu": menu_case("민원대장", shoot.s_complaints_headmenu, ".dmenu"),
    "complaints_filter": menu_case("민원대장", shoot.s_complaints_filter, ".cm-fdd"),
    "complaints_rowmenu": menu_case("민원대장", shoot.s_complaints_rowmenu, ".cm-rowmenu"),
    "complaints_rowmenu_ask": menu_case("민원대장", shoot.s_complaints_rowmenu_ask, ".cm-rowmenu"),
    "complaints_dbl": c_complaints_dbl,
    "complaints_merge": c_complaints_merge,
    "no_browser_menu": c_no_browser_menu,
    "budget_menu": menu_case("집행현황", shoot.s_budget_menu, ".bd-pop"),
    "budgetstatus_menu": menu_case("예산현황", shoot.s_budgetstatus_menu, ".bd-pop", esc=False),
    "files_tabmenu": menu_case("탐색기", shoot.s_files_tabmenu, ".fx-tabmenu"),
    "process_rowmenu": menu_case("민원처리", shoot.s_process_rowmenu, ".pr-rowmenu"),
    "calendar_kindpicker": menu_case("캘린더", shoot.s_calendar_kindpicker, ".cal-kp-list"),
    "band_tasks_item": band_esc("할 일", shoot.s_tasks_item_ask, ".ask-band"),
    "band_tasks_edit": band_esc("할 일", shoot.s_tasks_edit_ask, ".ask-band"),
    "band_journal_edit": band_esc("업무일지", shoot.s_journal_edit_ask, ".ask-band", keep=".jcard-edit"),
    "band_complaints_edit": band_esc("민원대장", shoot.s_complaints_edit_ask, ".ask-band"),
    "band_calendar_event": band_esc("캘린더", shoot.s_calendar_event_ask, ".ask-band"),
    "band_contacts_card": band_esc("업무연락처", shoot.s_contacts_card_ask, ".ask-band", keep=".ccard-edit"),
    "band_process_row": band_esc("민원처리", shoot.s_process_ask, ".ask-band"),
    "band_process_works": band_esc("민원처리", shoot.s_process_works_ask, ".ask-band", keep=".dialog.pr-works"),
    "band_budget": band_esc("집행현황", shoot.s_budget_confirm, ".ask-band"),
    "date_complaints_received": date_case("민원대장", None, "input[name=received]"),
    "date_complaints_due": date_case("민원대장", None, "input[name=due]"),
    "date_calendar_quick": date_case("캘린더", None, ".cal-quick input[name=date]"),
    "date_calendar_end": date_case("캘린더", open_cal_dialog, "input[aria-label='종료 날짜']"),
    "date_tasks_due": date_case("할 일", open_tasks_add, "input[name=due]"),
    "date_journal_print": date_case("업무일지", open_print, "input[aria-label='시작일']"),
    "date_files_find": date_case("탐색기", open_find, "input[aria-label='수정한 날 시작']"),
    "contacts_band": c_contacts_band,
    "contacts_pjmenu_esc": c_pjmenu_esc,
    "settings_esc": c_settings_esc,
    "settings_band": c_settings_band,
    "settings_clear": c_settings_clear,
    "calendar_dialog": c_dialog,
    "calendar_notitle_quick": c_calendar_notitle_quick,
    "calendar_notitle_outside": c_calendar_notitle_outside,
    "calendar_blank_close": c_calendar_blank_close,
    "files_dialog": c_files_dialog,
    "files_runask": c_files_runask,
    "journal_save": c_journal_save,
    "tasks_add_save": c_tasks_add,
    "tasks_check": c_tasks_check,
    "tasks_check_parent": c_tasks_check_parent,
    "tasks_check_space": c_tasks_check_space,
    "tasks_check_complaint": c_tasks_check_complaint,
    "tasks_check_reduced": c_tasks_check_reduced,
    "complaints_save": c_complaints_save,
    "files_side_buttons": c_files_side_buttons,
    "files_rename_ok": c_files_rename_ok,
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
