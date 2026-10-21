"""보이는 만큼만 그리기 동작 확인(2026-10-21 최적화 세션).

python3 tools/load/check.py <미리 보기 폴더>

민원대장: "챙길 일"에서 깊은 줄로 가기(칠하고 가운데) · End/Home · 줄에 포커스 두고 PageDown(포커스 유지) ·
두 번 눌러 고치는 줄을 멀리 스크롤해도 적던 글이 남는지 · 열 폭 끌기 · 맨 아래 줄 모서리(:last-child).
업무연락처: 맨 아래까지 내렸을 때 카드 수 = 연락처 수, 고치는 카드 유지.
"""
import sys

from measure import open_page, serve, go
from playwright.sync_api import sync_playwright

ok = []


def check(name, cond, detail=""):
    ok.append(bool(cond))
    print(("✅ " if cond else "❌ ") + name + (f" — {detail}" if detail else ""))


def main(site):
    port = serve(site)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx, page = open_page(b, port, start="calendar")
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        main_sel = ".main"

        # 1. 깊은 줄로 가기: 연번 300 민원을 가장 오래 지난 마감으로
        page.evaluate("() => { const c = window.__fake.complaints.find((x) => x.no === 300); c.status = '진행'; c.due = '2020-01-01'; c.done = ''; }")
        go(page, "업무일지")
        page.wait_for_timeout(800)
        page.evaluate("() => document.querySelector('.jn-due-item').click()")
        page.wait_for_timeout(2000)  # 칠하기는 2.4초 동안
        r = page.evaluate("""() => { const el = document.querySelector('[data-cid="300"]'); const sc = document.querySelector('.main');
          if (!el) return null; const a = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
          return { flash: el.classList.contains('flash'), off: Math.round(a.top + a.height / 2 - (s.top + sc.clientHeight / 2)) }; }""")
        check("챙길 일 → 연번 300 줄로 가서 칠함(가운데)", r and r["flash"] and abs(r["off"]) < 40, str(r))

        # 2. End / Home
        page.evaluate("() => document.querySelector('[data-cid=\"300\"]').focus()")
        page.keyboard.press("End")
        page.wait_for_timeout(900)
        r = page.evaluate("""() => { const sc = document.querySelector('.main'); const last = [...document.querySelectorAll('.cm > .cm-row')].pop();
          return { bottom: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight), lastNo: last && last.querySelector('.cm-no').textContent, lastChild: last === last.parentElement.lastElementChild,
                   radius: getComputedStyle(last).borderBottomLeftRadius }; }""")
        check("End → 맨 아래(연번 1 줄, 둥근 아래 모서리)", r["bottom"] <= 1 and r["lastNo"] == "1" and r["lastChild"] and r["radius"] != "0px", str(r))
        page.keyboard.press("Home")
        page.wait_for_timeout(900)
        r = page.evaluate("() => ({ top: document.querySelector('.main').scrollTop, first: document.querySelector('.cm [data-vi=\"0\"] .cm-no')?.textContent })")
        check("Home → 맨 위(연번 1500)", r["top"] == 0 and r["first"] == "1500", str(r))

        # 3. 줄에 포커스 두고 PageDown 여러 번 → 포커스가 줄에 남고 계속 내려가요
        page.evaluate("() => document.querySelector('.cm [data-vi=\"2\"]').focus()")
        for _ in range(12):
            page.keyboard.press("PageDown")
            page.wait_for_timeout(120)
        r = page.evaluate("() => ({ top: Math.round(document.querySelector('.main').scrollTop), focus: document.activeElement?.getAttribute('data-vi') })")
        check("PageDown ×12 → 포커스 그 줄에 남고 스크롤", r["top"] > 5000 and r["focus"] == "2", str(r))
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(200)
        r2 = page.evaluate("() => Math.round(document.querySelector('.main').scrollTop)")
        check("↓ → 더 내려감", r2 > r["top"], f"{r['top']} → {r2}")

        # 4. 고치는 줄: 멀리 갔다 와도 적던 글이 남아요
        page.evaluate("() => { document.querySelector('.main').scrollTop = 0; }")
        page.wait_for_timeout(300)
        page.dblclick(".cm [data-vi='3'] .cm-no")
        page.wait_for_timeout(300)
        page.evaluate("""() => { const t = document.querySelector('.cm-edit textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          t.focus(); }""")
        page.keyboard.type("abc")
        before = page.evaluate("() => document.querySelector('.cm-edit textarea').value")
        for y in range(1000, 20001, 1000):
            page.evaluate("(y) => { document.querySelector('.main').scrollTop = y; }", y)
            page.wait_for_timeout(40)
        page.evaluate("() => { document.querySelector('.main').scrollTop = 0; }")
        page.wait_for_timeout(300)
        after = page.evaluate("() => document.querySelector('.cm-edit textarea')?.value")
        check("고치는 줄 유지(멀리 스크롤 뒤에도 적던 글)", after == before and before, f"{before!r} / {after!r}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # 5. 열 폭 끌기
        grip = page.query_selector_all(".cm-grip")[2].bounding_box()
        x, y = grip["x"] + grip["width"] / 2, grip["y"] + grip["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 60, y, steps=6)
        page.mouse.up()
        page.wait_for_timeout(400)
        r = page.evaluate("() => ({ cols: getComputedStyle(document.querySelector('.cm')).getPropertyValue('--cm-cols').slice(0, 60), rows: document.querySelectorAll('.cm > .cm-view').length })")
        check("열 폭 끌기 → 폭 바뀌고 줄 그대로 그림", r["rows"] > 5, str(r))

        # 6. 신규 입력란은 그대로 맨 위
        r = page.evaluate("() => !!document.querySelector('.cm > .cm-new') && document.querySelector('.cm > .cm-new').nextElementSibling.matches('[data-vi], [data-vs]')")
        check("신규 입력란 자리 그대로(목록 바로 위)", r)

        # 7. 업무연락처: 끝까지 내리면서 그린 카드 이름을 모두 모아 800명
        go(page, "업무연락처")
        seen = page.evaluate("""async () => { const sc = document.querySelector('.main'); const ids = new Set(); sc.scrollTop = 0;
          for (let i = 0; i < 400; i++) { document.querySelectorAll('.ct-grid > [data-vi]').forEach((e) => ids.add(e.dataset.vi));
            if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1) break; sc.scrollTop += 400; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
          document.querySelectorAll('.ct-grid > [data-vi]').forEach((e) => ids.add(e.dataset.vi)); return ids.size; }""")
        check("업무연락처 끝까지 내리면 카드 800장 모두 나옴", seen == 800, str(seen))
        check("페이지 오류 없음", not errors, "; ".join(errors[:3]))
        ctx.close()
        b.close()
    print(f"{sum(ok)}/{len(ok)} 통과")
    return all(ok)


if __name__ == "__main__":
    sys.exit(0 if main(sys.argv[1]) else 1)
