"""화면 재기(2026-10-21 최적화 세션 — 지워진 wip/loadtest의 화면 쪽을 간단히 다시).

python3 tools/load/measure.py <미리 보기 폴더> 결과.json [--runs 5] [--shots 캡처폴더]

- 미리 보기 폴더 = `npm run build:wasm` → `npx vite build -c tools/load/vite.config.ts --outDir <폴더>` 결과(앱 화면 그대로,
  저장은 앱과 같은 Rust core를 브라우저용(WASM)으로 – 메모리 저장소).
- seed.js가 실제 앱 명령으로 3년치 시험 자료(민원 1,500 · 연락처 800 · 할 일 6,000 · 업무일지·일정)를 채워요.
- 잰 값: 화면 전환(누른 순간 → 화면이 마지막으로 바뀐 뒤 첫 프레임), 스크롤 fps(프레임마다 40px씩 3초),
  민원대장 "전체"로 거르기 풀기, 검색. 각 항목 --runs번 재서 중간값. 1600×900.
- --shots: 민원대장·업무연락처·할 일을 밝게·어둡게, 100%·125%로 찍어요(고치기 전후 비교용).
- 2026-11-07(결정 로그 11-07 07:41): 민원지도(첫 열기·두 번째 열기·끌기/휠 fps·거르기 배지·검색·점 카드·로드뷰),
  캘린더(전환·월 넘기기·미니달력 한 번/두 번·확인할 것 창·구글 바뀐 것 계산), 첫 화면(JS 받기·읽고 실행·업무일지까지)을 더했어요.
  민원 위치는 places.json(필지 표에 있는 실제 파주 지번 960곳)이라 지도에서 좌표가 찾아져요.
  `--only map,calendar,first`로 그 묶음만 잴 수 있어요.
"""
import http.server
import json
import statistics
import sys
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PLACES = json.loads((HERE / "places.json").read_text(encoding="utf-8"))
# 시드 앞에 지번 목록, 뒤에 시드 시간 재기(첫 화면에서 빼려고)를 붙여요.
SEED = (
    f"window.__loadPlaces = {json.dumps(PLACES, ensure_ascii=False)};\n"
    + (HERE / "seed.js").read_text(encoding="utf-8")
    + "\n;(() => { const f = window.__previewSeed; window.__previewSeed = async (c) => { performance.mark('gilog-seed-start'); try { return await f(c); } finally { performance.mark('gilog-seed-end'); } }; })();\n"
)

HELPERS = r"""
window.__time = (fn) => new Promise((res) => {
  let changed = false, lastChange = 0, paint = null;
  const mo = new MutationObserver(() => { changed = true; lastChange = performance.now(); });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const t0 = performance.now();
  fn();
  const tick = () => {
    const now = performance.now();
    if (changed) { paint = now; changed = false; }
    if ((paint !== null && now - Math.max(lastChange, paint) > 500) || now - t0 > 20000) { mo.disconnect(); res((paint ?? t0) - t0); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
window.__side = (label) => [...document.querySelectorAll("nav .side-item")].find((b) => b.textContent.trim().startsWith(label));
window.__scrollFps = (ms) => new Promise((res) => {
  const el = document.querySelector(".main");
  el.scrollTop = 0;
  let n = 0, t0 = null, gaps = [], prev = null;
  const step = (t) => {
    if (t0 === null) t0 = t;
    if (prev !== null) gaps.push(t - prev);
    prev = t; n++;
    el.scrollTop += 40;
    if (t - t0 < ms && el.scrollTop + el.clientHeight < el.scrollHeight - 1) requestAnimationFrame(step);
    else { gaps.sort((a, b) => a - b); res({ fps: ((n - 1) * 1000) / (t - t0), worst: gaps[gaps.length - 1] || 0 }); }
  };
  requestAnimationFrame(step);
});
// 누른 뒤 cond()가 참이 될 때까지(프레임마다 봐요) – 지도가 날아가는 움직임과 따로, 카드가 보일 때를 재요
window.__until = (fn, cond) => new Promise((res) => {
  const t0 = performance.now();
  fn();
  const tick = () => { if (cond()) return res(performance.now() - t0); if (performance.now() - t0 > 20000) return res(20000); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
// 프레임 기록: __recStart() → (끌기·휠) → __recStop() = { fps, worst }
window.__recStart = () => { const r = { gaps: [], prev: null, on: true, t0: null, t1: null }; window.__rec = r;
  const step = (t) => { if (!r.on) return; if (r.t0 === null) r.t0 = t; if (r.prev !== null) r.gaps.push(t - r.prev); r.prev = t; r.t1 = t; requestAnimationFrame(step); };
  requestAnimationFrame(step); };
window.__recStop = () => { const r = window.__rec; r.on = false; const g = r.gaps.slice().sort((a, b) => a - b);
  return { fps: g.length ? (g.length * 1000) / (r.t1 - r.t0) : 0, worst: g[g.length - 1] || 0 }; };
window.__type = (sel, text) => {
  const el = document.querySelector(sel);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
"""


def serve(folder: str) -> int:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

    h = partial(Quiet, directory=folder)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def open_page(browser, port, theme="light", scale=1.0, start="calendar", extra="", google=False):
    ctx = browser.new_context(viewport={"width": 1600, "height": 900}, device_scale_factor=scale, color_scheme=theme)
    page = ctx.new_page()
    page.add_init_script(f"window.__loadTheme = {json.dumps(theme)}; window.__loadStart = {json.dumps(start)}; window.__loadGoogle = {json.dumps(google)};")
    page.add_init_script(SEED)
    page.add_init_script(HELPERS)
    if extra:
        page.add_init_script(extra)
    page.goto(f"http://127.0.0.1:{port}/")
    page.wait_for_selector("nav .side-item", timeout=30000)
    page.wait_for_timeout(1500)
    return ctx, page


def go(page, label):
    page.evaluate("(l) => window.__side(l).click()", label)
    page.wait_for_timeout(800)


def switch_ms(page, label, back="캘린더"):
    go(page, back)
    return page.evaluate("(l) => window.__time(() => window.__side(l).click())", label)


def measure(port, runs, only=("base", "map", "calendar", "first"), site="."):
    out = {}
    info = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        add = lambda k, v: out.setdefault(k, []).append(round(v, 1))
        if "first" in only:
            info.update(measure_first(browser, port, runs, add, site))
        if "map" in only:
            info.update(measure_map(browser, port, runs, add))
        if "calendar" in only:
            info.update(measure_calendar(browser, port, runs, add))
        if "base" not in only:
            browser.close()
            return pack(out, info)
        ctx, page = open_page(browser, port)
        for _ in range(runs):
            for label in ["민원대장", "업무연락처", "할 일"]:
                add("전환 · " + label, switch_ms(page, label))
        # 민원대장
        for _ in range(runs):
            go(page, "민원대장")
            r = page.evaluate("() => window.__scrollFps(3000)")
            add("스크롤 · 민원대장 fps", r["fps"])
            add("스크롤 · 민원대장 가장 긴 프레임 ms", r["worst"])
            page.evaluate("() => { document.querySelector('.main').scrollTop = 0; }")
            page.evaluate("() => [...document.querySelectorAll('.pchip')].find((b) => b.textContent.startsWith('진행')).click()")
            page.wait_for_timeout(600)
            add("민원대장 · 전체로 거르기 풀기", page.evaluate("() => window.__time(() => [...document.querySelectorAll('.pchip')].find((b) => b.textContent.startsWith('전체')).click())"))
            add("검색 · 민원대장 \"배수\"", page.evaluate("() => window.__time(() => window.__type('input[aria-label=\"민원 검색\"]', '배수'))"))
            page.evaluate("() => window.__type('input[aria-label=\"민원 검색\"]', '')")
            page.wait_for_timeout(600)
        # 업무연락처
        for _ in range(runs):
            go(page, "업무연락처")
            r = page.evaluate("() => window.__scrollFps(3000)")
            add("스크롤 · 업무연락처 fps", r["fps"])
            add("스크롤 · 업무연락처 가장 긴 프레임 ms", r["worst"])
            page.evaluate("() => { document.querySelector('.main').scrollTop = 0; }")
            add("검색 · 업무연락처 \"김\"", page.evaluate("() => window.__time(() => window.__type('input[aria-label=\"연락처 검색\"]', '김'))"))
            page.evaluate("() => window.__type('input[aria-label=\"연락처 검색\"]', '')")
            page.wait_for_timeout(600)
        # 할 일 검색(0.35.0 검색창 통일 뒤 type=search가 없어졌어요 – 이름표로 찾아요, 2026-10-29 검사 자동화)
        for _ in range(runs):
            go(page, "할 일")
            sel = "input[aria-label=\"할 일 검색\"]"
            add("검색 · 할 일 \"보고\"", page.evaluate("(s) => window.__time(() => window.__type(s, '보고'))", sel))
            page.evaluate("(s) => window.__type(s, '')", sel)
            page.wait_for_timeout(600)
        # 업무일지 전체 검색(대기 목록 "업무일지 부하 시험" – 2026-10-29 검사 자동화에서 더함)
        for _ in range(runs):
            go(page, "업무일지")
            sel = "input[aria-label=\"일지 검색\"]"
            add("검색 · 업무일지 \"배수\"", page.evaluate("(s) => window.__time(() => window.__type(s, '배수'))", sel))
            page.evaluate("(s) => window.__type(s, '')", sel)
            page.wait_for_timeout(600)
        # DOM 크기
        for label in ["민원대장", "업무연락처"]:
            go(page, label)
            out["DOM 요소 · " + label] = [page.evaluate("() => document.querySelectorAll('*').length")]
        out["JS 힙 MB"] = [round(page.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0"), 1)]
        ctx.close()
        browser.close()
    return pack(out, info)


def pack(out, info):
    r = {k: {"median": statistics.median(v), "runs": v} for k, v in out.items()}
    if info:
        r["_정보"] = info
    return r


MAP_SEARCH = 'input[aria-label="민원지도 검색"]'
CARD_SHOWN = "() => { const c = document.querySelector('.mp-card'); return !!c && c.style.visibility !== 'hidden' && c.offsetWidth > 0; }"


def map_pill(page, label):
    """거르기 배지(민원유형·상태·기간)를 열어요."""
    page.evaluate("(l) => [...document.querySelectorAll('.mp-pill')].find((b) => b.textContent.trim().startsWith(l)).click()", label)
    page.wait_for_timeout(300)


def measure_map(browser, port, runs, add):
    # (a) 첫 열기 – 창마다 새로(앱을 켜고 처음 여는 것과 같게: 지도 모듈·배경 그림 처음 읽기 + 좌표 표지 없음 → 1,500건 모두 다시 찾기)
    for _ in range(runs):
        ctx, page = open_page(browser, port)
        add("민원지도 · 첫 열기(좌표 1,500건 찾기 + 닷 그리기)", switch_ms(page, "민원지도"))
        ctx.close()
    ctx, page = open_page(browser, port)
    go(page, "민원지도")
    page.wait_for_timeout(1500)
    # core만: 표지를 지우고 지도 자료 읽기(1,500건 모두 다시 찾기) – 미리 보기는 WASM이라 앱(네이티브)보다 느려요
    for _ in range(runs):
        add("민원지도 · core 지도 자료 읽기(1,500건 다시 찾기, WASM)", page.evaluate("() => { window.__preview.call('set_value', { key: 'map.geoMark', value: '' }); const t = performance.now(); window.__preview.call('complaints_map'); return performance.now() - t; }"))
        add("민원지도 · core 지도 자료 읽기(찾을 것 없음, WASM)", page.evaluate("() => { const t = performance.now(); window.__preview.call('complaints_map'); return performance.now() - t; }"))
    # (b) 두 번째 열기
    for _ in range(runs):
        add("전환 · 민원지도(두 번째)", switch_ms(page, "민원지도"))
    page.wait_for_timeout(1000)
    # 기간 "전체"로 1,500건 모두 그리게 한 뒤 나머지를 재요
    map_pill(page, "기간")
    add("민원지도 · 거르기 기간 전체(1,500건)", page.evaluate("() => window.__time(() => [...document.querySelectorAll('.mp-chip')].find((b) => b.textContent.trim() === '전체').click())"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    box = page.locator("canvas").first.bounding_box()
    cx, cy = box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.5
    for _ in range(runs):
        # 비교용: 아무것도 안 할 때 같은 기록 방법의 fps(작업 공간 흔들림을 가늠해요)
        page.evaluate("() => window.__recStart()")
        page.wait_for_timeout(2000)
        add("민원지도 · 가만히 둘 때 fps(비교용 값만)", page.evaluate("() => window.__recStop()")["fps"])
        # (c) 끌기: 2초 동안 600px(프레임마다 사람이 끄는 빠르기)
        page.mouse.move(cx, cy)
        page.evaluate("() => window.__recStart()")
        page.mouse.down()
        for k in range(1, 61):
            page.mouse.move(cx - 5 * k, cy - 2 * k)
            page.wait_for_timeout(16)
        page.mouse.up()
        page.wait_for_timeout(300)
        r = page.evaluate("() => window.__recStop()")
        add("민원지도 · 끌기 fps", r["fps"])
        add("민원지도 · 끌기 가장 긴 프레임 ms", r["worst"])
        # 휠 확대 6번 + 축소 6번
        page.mouse.move(cx, cy)
        page.evaluate("() => window.__recStart()")
        for d in [-240] * 6 + [240] * 6:
            page.mouse.wheel(0, d)
            page.wait_for_timeout(120)
        page.wait_for_timeout(500)
        r = page.evaluate("() => window.__recStop()")
        add("민원지도 · 휠 확대 fps", r["fps"])
        add("민원지도 · 휠 확대 가장 긴 프레임 ms", r["worst"])
        page.evaluate("() => document.querySelector('[aria-label=\"파주시 전체\"]')?.click()")
        page.wait_for_timeout(800)
    # (d) 거르기 배지
    for _ in range(runs):
        map_pill(page, "기간")
        add("민원지도 · 거르기 기간 올해", page.evaluate("() => window.__time(() => [...document.querySelectorAll('.mp-chip')].find((b) => b.textContent.trim() === '올해').click())"))
        add("민원지도 · 거르기 기간 전체", page.evaluate("() => window.__time(() => [...document.querySelectorAll('.mp-chip')].find((b) => b.textContent.trim() === '전체').click())"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        for label, name in [("상태", "상태"), ("민원유형", "유형")]:
            map_pill(page, label)
            add(f"민원지도 · 거르기 {name} 하나 끄기", page.evaluate("() => window.__time(() => document.querySelector('.mp-pop .mp-checks .mp-check input').click())"))
            add(f"민원지도 · 거르기 {name} 다시 켜기", page.evaluate("() => window.__time(() => document.querySelector('.mp-pop .mp-checks .mp-check input').click())"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
    # (e) 검색 · (f) 점 카드
    for _ in range(runs):
        add("검색 · 민원지도 \"배수\"", page.evaluate("(s) => window.__time(() => window.__type(s, '배수'))", MAP_SEARCH))
        page.evaluate("(s) => window.__type(s, '')", MAP_SEARCH)
        page.wait_for_timeout(300)
        page.evaluate("(s) => { document.querySelector(s).focus(); window.__type(s, '포트홀'); }", MAP_SEARCH)
        page.wait_for_timeout(400)
        add("민원지도 · 점 카드 열기(검색에서 고르기 → 카드 보임)", page.evaluate(f"() => window.__until(() => document.querySelector('.mp-sres-cm').click(), {CARD_SHOWN})"))
        page.wait_for_timeout(1500)
        page.keyboard.press("Escape")
        page.evaluate("(s) => window.__type(s, '')", MAP_SEARCH)
        page.keyboard.press("Escape")
        page.evaluate("() => document.querySelector('[aria-label=\"파주시 전체\"]')?.click()")
        page.wait_for_timeout(800)
    # 고른 민원으로 날아가는 움직임까지 다 끝날 때(값만)
    page.evaluate("(s) => { document.querySelector(s).focus(); window.__type(s, '포트홀'); }", MAP_SEARCH)
    page.wait_for_timeout(400)
    add("민원지도 · 고른 민원으로 날아가기 끝(값만)", page.evaluate("() => window.__time(() => document.querySelector('.mp-sres-cm').click())"))
    # (g) 로드뷰 – 카카오 없는 미리 보기는 단추가 꺼져 있어요(연속주제도). 켜져 있을 때만 재요.
    rv_on = page.evaluate("() => { const b = document.querySelector('[aria-label=\"로드뷰\"]'); return !!b && !b.disabled; }")
    out_note = "로드뷰 단추 꺼짐(연속주제도 – 카카오일 때만, 윈도우 시험)" if not rv_on else ""
    if rv_on:
        add("민원지도 · 로드뷰 열기", page.evaluate("() => window.__time(() => document.querySelector('[aria-label=\"로드뷰\"]').click())"))
    meta = page.evaluate("() => ({ bg: document.querySelector('[data-bg]')?.getAttribute('data-bg'), dom: document.querySelectorAll('*').length, geo: window.__preview.call('complaints_map').reduce((a, c) => { a[c.geoSrc] = (a[c.geoSrc] || 0) + 1; return a; }, {}) })")
    add("DOM 요소 · 민원지도", meta["dom"])
    ctx.close()
    return {"민원지도 배경": meta["bg"], "민원지도 좌표 찾음": meta["geo"], "민원지도 로드뷰": out_note or "잼"}


def measure_calendar(browser, port, runs, add):
    ctx, page = open_page(browser, port, start="journal", google=True)
    # 미리 보기는 앱 시작 때 구글 상태를 읽지 않아요(startGoogleSync는 앱에서만) – 설정 화면이 한 번 읽어요.
    go(page, "설정")
    for _ in range(runs):
        add("전환 · 캘린더", switch_ms(page, "캘린더", back="업무일지"))
    go(page, "캘린더")
    page.wait_for_timeout(800)
    for k in range(runs):
        add("캘린더 · 월 넘기기", page.evaluate("(l) => window.__time(() => document.querySelector(`[aria-label=\"${l}\"]`).click())", "다음 달" if k % 2 == 0 else "이전 달"))
    # 오늘 달로
    page.evaluate("() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '오늘')?.click()")
    page.wait_for_timeout(600)
    for _ in range(runs):
        day = page.evaluate("() => { const bs = [...document.querySelectorAll('.cal-mini-grid button[aria-label]')]; return bs[Math.floor(bs.length / 2)].getAttribute('aria-label'); }")
        sel = f'.cal-mini-grid button[aria-label="{day}"]'
        add("캘린더 · 미니달력 한 번(5주)", page.evaluate("(s) => window.__time(() => document.querySelector(s).click())", sel))
        add("캘린더 · 미니달력 두 번(일 보기)", page.evaluate("(s) => window.__time(() => { const b = document.querySelector(s); b.click(); b.click(); b.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })", sel))
        day_on = page.evaluate("() => [...document.querySelectorAll('[aria-label=\"보기 방식\"] button')].find((b) => b.textContent.trim() === '일')?.getAttribute('aria-pressed')")
        if day_on != "true":
            raise RuntimeError("미니달력 두 번 뒤 일 보기가 아니에요")
        add("캘린더 · 월 보기로", page.evaluate("() => window.__time(() => [...document.querySelectorAll('[aria-label=\"보기 방식\"] button')].find((b) => b.textContent.trim() === '월').click())"))
    n_checks = page.evaluate("() => document.querySelector('.g-checks')?.innerText || ''")
    for _ in range(runs):
        if not n_checks:
            break
        add("캘린더 · 확인할 것 창 열기", page.evaluate("() => window.__time(() => document.querySelector('.g-checks').click())"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    # 구글 "바뀐 것 찾기" 계산(네트워크 없이): 보낼 모양(desired) + 지문(fingerprint)을 만들어 구글 쪽 지문(2%가 다름)과 견줘요
    g = page.evaluate("""(runs) => {
      const F = window.__loadGoogleFns; const call = window.__preview.call;
      const cal = call('calendar_data'), tasks = call('tasks_data'), comps = call('complaints');
      const opts = { events: true, complaints: true, tasks: true, gtasks: false, twoWay: true };
      const once = () => {
        const t0 = performance.now();
        const want = F.desired({ kinds: cal.kinds, events: cal.events, complaints: comps, tasks: tasks.tasks }, opts);
        const t1 = performance.now();
        const fp = new Map([...want].map(([k, b]) => [k, F.fingerprint(b)]));
        const remote = new Map([...fp].map(([k, f], i) => [k, i % 50 === 0 ? f + 'x' : f]));
        let changed = 0; for (const [k, f] of fp) if (remote.get(k) !== f) changed++;
        const t2 = performance.now();
        const wt = F.desiredTasks({ complaints: comps, tasks: tasks.tasks, lists: tasks.lists }, opts, '2026-10-17');
        const t3 = performance.now();
        return { desired: t1 - t0, compare: t2 - t1, tasks: t3 - t2, n: want.size, nt: wt.size, changed };
      };
      return Array.from({ length: runs }, once);
    }""", runs)
    for r in g:
        add("캘린더 · 구글 바뀐 것 찾기 계산(보낼 모양 + 견주기)", r["desired"] + r["compare"])
        add("캘린더 · 구글 할 일 보낼 모양(값만)", r["tasks"])
    add("DOM 요소 · 캘린더", page.evaluate("() => document.querySelectorAll('*').length"))
    ctx.close()
    return {"캘린더 구글 일정 수": g[0]["n"], "캘린더 구글 할 일 수": g[0]["nt"], "캘린더 확인할 것": n_checks.replace("\n", " ")}


FIRST = """() => {
  const m = (n) => performance.getEntriesByName(n)[0]?.startTime ?? null;
  const js = performance.getEntriesByType('resource').filter((r) => /\\/assets\\/index-[^/]+\\.js$/.test(r.name)).sort((a, b) => b.transferSize - a.transferSize)[0];
  const css = performance.getEntriesByType('resource').find((r) => /\\.css$/.test(r.name));
  const wasm = performance.getEntriesByType('resource').find((r) => /\\.wasm$/.test(r.name));
  return { jsStart: js?.startTime, jsEnd: js?.responseEnd, jsBytes: js?.decodedBodySize, cssBytes: css?.decodedBodySize,
    wasmEnd: wasm?.responseEnd, start: m('gilog-js-start'), end: m('gilog-js-end'), seed0: m('gilog-seed-start'), seed1: m('gilog-seed-end'), shown: window.__shown };
}"""
SHOWN = """(() => {
  // 업무일지 기록 카드가 처음 보인 때
  const mo = new MutationObserver(() => { if (!window.__shown && document.querySelector('.jcard')) { window.__shown = performance.now(); mo.disconnect(); } });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, childList: true }));
})();"""


def measure_first(browser, port, runs, add, site):
    for _ in range(runs):
        ctx, page = open_page(browser, port, start="journal", extra=SHOWN)
        page.wait_for_function("() => !!window.__shown", timeout=60000)
        f = page.evaluate(FIRST)
        ctx.close()
        add("첫 화면 · JS 받기(로컬 서버)", f["jsEnd"] - f["jsStart"])
        add("첫 화면 · JS 읽고 실행(받은 뒤 → 덩어리 끝)", f["end"] - f["jsEnd"])
        add("첫 화면 · 그중 실행(덩어리 첫 줄 → 끝)", f["end"] - f["start"])
        add("첫 화면 · 업무일지 보일 때까지(시드 빼고)", f["shown"] - (f["seed1"] - f["seed0"]))
        add("첫 화면 · 시드 끝 → 업무일지 보임", f["shown"] - f["seed1"])
        add("첫 화면 · 미리 보기 저장 모듈(WASM 6.7MB) 받기 끝", f["wasmEnd"])
        add("JS 덩어리 KB", round(f["jsBytes"] / 1024))
        add("CSS KB", round((f["cssBytes"] or 0) / 1024))
    # 나눠 읽으면 줄 몫(어림): 덩어리 안 민원지도·구글 코드 크기 비율 × "읽고 실행"
    sizes = json.loads((Path(site) / "load-modules.json").read_text(encoding="utf-8"))
    entry = max(sizes.values(), key=lambda m: sum(m.values()))
    # 미리 보기 전용(브라우저용 core 연결·가짜 폴더)은 앱 덩어리에 없어서 빼요
    entry = {k: v for k, v in entry.items() if "wasm-pkg" not in k and "tools/preview" not in k and "previewCore" not in k}
    total = sum(entry.values())
    grp = lambda f: sum(v for k, v in entry.items() if f(k))
    mp = grp(lambda k: k.startswith("src/screens/map/"))
    gg = grp(lambda k: k.startswith("src/google") or "BudgetShare" in k or k.startswith("src/budgetShare"))
    return {"덩어리 모듈 합 KB": round(total / 1024), "민원지도 코드 KB": round(mp / 1024), "구글 코드 KB": round(gg / 1024),
            "민원지도 몫": round(mp / total, 3), "구글 몫": round(gg / total, 3)}


def shots(port, folder):
    Path(folder).mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ["light", "dark"]:
            for scale in [1.0, 1.25]:
                for label, key in [("민원대장", "complaints"), ("업무연락처", "contacts"), ("할 일", "tasks")]:
                    ctx, page = open_page(browser, port, theme, scale, start="calendar")
                    page.add_style_tag(content="*, *::before, *::after { caret-color: transparent !important; transition: none !important; animation: none !important; }")
                    go(page, label)
                    page.mouse.move(0, 899)
                    page.wait_for_timeout(700)
                    tag = f"{key}_{theme}_{int(scale * 100)}"
                    page.screenshot(path=f"{folder}/{tag}_top.png")
                    if key != "tasks":
                        # 사람이 내리듯 300px씩(그리지 않은 줄은 추정 높이라 한 번에 뛰면 자리가 조금 달라요)
                        for y in range(300, 3001, 300):
                            page.evaluate("(y) => { document.querySelector('.main').scrollTop = y; }", y)
                            page.wait_for_timeout(120)
                        page.wait_for_timeout(600)
                        page.screenshot(path=f"{folder}/{tag}_mid.png")
                    ctx.close()
        browser.close()


if __name__ == "__main__":
    site, result = sys.argv[1], sys.argv[2]
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 5
    port = serve(site)
    if "--shots" in sys.argv:
        shots(port, sys.argv[sys.argv.index("--shots") + 1])
    only = tuple(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else ("base", "map", "calendar", "first")
    if runs > 0:
        r = measure(port, runs, only, site)
        Path(result).write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        for k, v in r.items():
            print(f"{k}: {v['median']}  {v['runs']}" if k != "_정보" else f"정보: {v}")
