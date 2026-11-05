# 캘린더: 흉내 자료는 구글에 연결돼 있지 않아요 – 앱 저장 칸에 가짜 로그인 값을 넣고 설정을 한 번 거쳐(구글 상태를 읽어요)
# 진짜 구글 상자(.g-box)가 뜨게 해요. 구글로 가는 요청은 모두 막아요(아무것도 밖으로 안 나가요). v32 – 0.78.0 상자 모양.
import json

GOOGLE = {
    "google.client": {"id": "x.apps.googleusercontent.com", "secret": "s"},
    "google.token": {"refresh": "r", "access": "a", "exp": 9999999999999, "at": 1792368000000,   # 2026-10-19 09:00
                     "scope": "https://www.googleapis.com/auth/calendar"},
    "google.state": {"calendarId": "c", "items": {}, "listId": "", "titems": {}, "lastOk": "2026-10-21 09:58", "lastError": "",
                     "full": False, "gone": {"e1": {"title": "현장 출장"}}, "foreign": {}, "notes": []},
    "google.opts": {"events": True, "complaints": True, "tasks": True, "gtasks": False, "twoWay": True},
}


async def _google(p, back):
    await p.route("**/*google*/**", lambda r: r.abort())
    for k, v in GOOGLE.items():
        await p.evaluate("([k, v]) => window.__preview.call('set_value', { key: k, value: v })", [k, json.dumps(v)])
    await p.get_by_role("button", name="설정", exact=True).first.click()
    await p.wait_for_timeout(700)
    if back != "설정":
        await p.get_by_role("button", name=back, exact=True).first.click()
        await p.wait_for_timeout(800)


async def s_calendar_google(p):
    await _google(p, "캘린더")


async def s_settings_google(p):
    await _google(p, "설정")
    await p.locator('section.mod-card:has(.mod-head:text-is("캘린더"))').first.scroll_into_view_if_needed()
    await p.wait_for_timeout(300)


EXTRA = {"calendar_google": ("캘린더", s_calendar_google), "settings_google": ("캘린더", s_settings_google)}
