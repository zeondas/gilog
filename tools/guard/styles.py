"""모양 지킴이 – 계산된 모양 값 비교(정리 2차, 2026-10-26 사용자 ③1안).

  python3 tools/guard/styles.py <기준 빌드> <내 빌드> [장면 이름 ...]

shoot.py와 같은 장면(84개)을 두 빌드에서 함께 열고, 화면의 모든 요소(::before·::after 포함)의
계산된 모양 값(getComputedStyle 전부)을 견줘요. 사진 비교가 못 잡는 1px·색 차이까지 잡아요.
다른 요소가 하나라도 있으면 그 장면 이름·요소·속성을 적고 끝 값 1. CSS 파일을 나누거나 옮길 때 써요.
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shoot  # noqa: E402

DUMP = r"""
() => {
  const h = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36); };
  const path = (el) => { const p = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) i++; p.unshift(e.tagName.toLowerCase() + ':' + i); } return p.join('>'); };
  const out = {};
  const all = document.querySelectorAll('*');
  window.__styleEls = all;
  for (const el of all) {
    const k = path(el);
    for (const ps of ['', '::before', '::after']) {
      const cs = getComputedStyle(el, ps || null);
      if (ps && (cs.content === 'none' || cs.content === 'normal')) continue;
      const ns = []; for (let i = 0; i < cs.length; i++) ns.push(cs[i]); ns.sort(); let s = ''; for (const n of ns) s += n + ':' + cs.getPropertyValue(n) + ';';
      out[k + ps] = h(s);
    }
  }
  return out;
}
"""

PROPS = r"""
(keys) => {
  const res = {};
  const path = (el) => { const p = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) i++; p.unshift(e.tagName.toLowerCase() + ':' + i); } return p.join('>'); };
  const idx = {}; for (const el of window.__styleEls) idx[path(el)] = el;
  for (const k of keys) {
    const m = k.match(/^(.*?)(::before|::after)?$/); const el = idx[m[1]]; if (!el) continue;
    const cs = getComputedStyle(el, m[2] || null); const o = {};
    for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
    o.__class = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    res[k] = o;
  }
  return res;
}
"""


async def open_scene(br, url, name):
    screen, act = shoot.SCENES[name]
    z = shoot.ZOOM_OF.get(name, 13) / 13
    vp = {"width": 1200, "height": 700} if name in shoot.SMALL else {"width": round(1600 / z), "height": round(900 / z)}
    ctx = await br.new_context(viewport=vp, device_scale_factor=z, locale="ko-KR", timezone_id="Asia/Seoul")
    ctx.set_default_timeout(5000)
    p = await ctx.new_page()
    await p.clock.set_fixed_time("2026-10-21T10:00:00+09:00")
    await p.add_init_script(path=os.path.join(shoot.HERE, "seed.js"))
    await p.goto(url)
    await p.wait_for_timeout(900)
    await p.add_style_tag(content=shoot.STILL)
    await shoot.nav(p, screen)
    if act:
        await act(p)
    await p.mouse.move(vp["width"] - 1, vp["height"] - 1)
    await p.wait_for_timeout(500)
    await p.evaluate("() => document.fonts.ready")
    return ctx, p


async def main():
    base, cur, *only = sys.argv[1:]
    names = only or list(shoot.SCENES)
    sb, pb = shoot.serve(base)
    sc, pc = shoot.serve(cur)
    bad, failed = {}, []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        for n in names:
            try:
                (cb, b), (cc, c) = await open_scene(br, f"http://127.0.0.1:{pb}/", n), await open_scene(br, f"http://127.0.0.1:{pc}/", n)
            except Exception as e:  # noqa: BLE001 – 기준에서도 실패하는 장면은 shoot.py가 따로 알려요
                failed.append(f"{n}: {str(e).splitlines()[0]}")
                continue
            hb, hc = await b.evaluate(DUMP), await c.evaluate(DUMP)
            diff = sorted(k for k in set(hb) | set(hc) if hb.get(k) != hc.get(k))
            if diff:
                pbv, pcv = await b.evaluate(PROPS, diff[:20]), await c.evaluate(PROPS, diff[:20])
                rows = []
                for k in diff[:20]:
                    x, y = pbv.get(k, {}), pcv.get(k, {})
                    props = [f"{p}: {x.get(p)} → {y.get(p)}" for p in sorted(set(x) | set(y)) if x.get(p) != y.get(p) and p != "__class"]
                    rows.append(f"  {k}  (.{x.get('__class') or y.get('__class')})\n    " + "\n    ".join(props[:8]))
                bad[n] = (len(diff), rows)
            print(f"{n}: {len(hb)}요소 · 다름 {len(diff)}", flush=True)
            await cb.close()
            await cc.close()
        await br.close()
    sb.shutdown()
    sc.shutdown()
    print(f"\n{len(names) - len(failed)}장면 · 다른 장면 {len(bad)}" + (f" · 못 연 장면 {len(failed)}" if failed else ""))
    for f in failed:
        print("  못 염 –", f)
    for n, (k, rows) in bad.items():
        print(f"\n## {n} – {k}요소 다름")
        print("\n".join(rows))
    sys.exit(1 if bad or failed else 0)


if __name__ == "__main__":
    asyncio.run(main())
