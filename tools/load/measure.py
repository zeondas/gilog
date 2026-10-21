"""화면 재기(2026-10-21 최적화 세션 — 지워진 wip/loadtest의 화면 쪽을 간단히 다시).

python3 tools/load/measure.py <미리 보기 폴더> 결과.json [--runs 5] [--shots 캡처폴더]

- 미리 보기 폴더 = `npx vite build -c tools/load/vite.config.ts --outDir <폴더>` 결과(앱 화면 그대로, 저장만 메모리 흉내).
- seed.js가 3년치 흉내 자료(민원 1,500 · 연락처 800 · 할 일 6,000 · 업무일지·일정)를 채워요.
- 잰 값: 화면 전환(누른 순간 → 화면이 마지막으로 바뀐 뒤 첫 프레임), 스크롤 fps(프레임마다 40px씩 3초),
  민원대장 "전체"로 거르기 풀기, 검색. 각 항목 --runs번 재서 중간값. 1600×900.
- --shots: 민원대장·업무연락처·할 일을 밝게·어둡게, 100%·125%로 찍어요(고치기 전후 비교용).
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
SEED = (HERE / "seed.js").read_text(encoding="utf-8")

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


def open_page(browser, port, theme="light", scale=1.0, start="calendar"):
    ctx = browser.new_context(viewport={"width": 1600, "height": 900}, device_scale_factor=scale, color_scheme=theme)
    page = ctx.new_page()
    page.add_init_script(f"window.__loadTheme = {json.dumps(theme)}; window.__loadStart = {json.dumps(start)};")
    page.add_init_script(SEED)
    page.add_init_script(HELPERS)
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


def measure(port, runs):
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx, page = open_page(browser, port)
        add = lambda k, v: out.setdefault(k, []).append(round(v, 1))
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
        # 할 일 검색
        for _ in range(runs):
            go(page, "할 일")
            sel = "input[type=search]"
            add("검색 · 할 일 \"보고\"", page.evaluate("(s) => window.__time(() => window.__type(s, '보고'))", sel))
            page.evaluate("(s) => window.__type(s, '')", sel)
            page.wait_for_timeout(600)
        # DOM 크기
        for label in ["민원대장", "업무연락처"]:
            go(page, label)
            out["DOM 요소 · " + label] = [page.evaluate("() => document.querySelectorAll('*').length")]
        out["JS 힙 MB"] = [round(page.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0"), 1)]
        ctx.close()
        browser.close()
    return {k: {"median": statistics.median(v), "runs": v} for k, v in out.items()}


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
    if runs > 0:
        r = measure(port, runs)
        Path(result).write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
        for k, v in r.items():
            print(f"{k}: {v['median']}  {v['runs']}")
