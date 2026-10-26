"""매뉴얼 글을 쓸 때 쓰는 도우미 – 장면에 보이는 요소의 선택자·글·자리를 적어요.

  python3 tools/manual/probe.py <지킴이 빌드 폴더> <장면 이름> [찾을 글]

`docs/manual/<화면>.md`의 번호 선택자를 고를 때 써요. 그림(장면.png)도 같은 폴더에 남겨요.
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

import cap

JS = r"""(needle) => {
  const out = [];
  const main = document.querySelector('.main') || document.body;
  const all = document.querySelectorAll('button, input, textarea, select, th, [role=button], [class]');
  for (const e of all) {
    const r = e.getBoundingClientRect();
    if (r.width < 6 || r.height < 6 || r.width * r.height > 600000) continue;
    if (e.closest('nav.side')) continue;
    const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    const txt = (e.getAttribute('aria-label') || e.getAttribute('title') || e.placeholder || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    if (needle && !txt.includes(needle) && !cls.join('.').includes(needle)) continue;
    const sel = e.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
    out.push(`${sel.padEnd(42)} ${String(Math.round(r.x)).padStart(5)},${String(Math.round(r.y)).padStart(4)} ${String(Math.round(r.width)).padStart(4)}×${String(Math.round(r.height)).padEnd(4)} ${txt}`);
  }
  return out.slice(0, 400);
}"""


async def main():
    site, name, *rest = sys.argv[1:]
    needle = rest[0] if rest else ""
    srv, port = cap.serve(site)
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctx, p = await cap.open_scene(br, f"http://127.0.0.1:{port}/", name)
        for line in await p.evaluate(JS, needle):
            print(line)
        await p.screenshot(path=os.path.join(site, name + ".probe.png"))
        await ctx.close()
        await br.close()
    srv.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
