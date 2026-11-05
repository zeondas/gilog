"""탐색기 재기(2026-10-30 탐색기 부하 세션 – docs/loadtest.md "0.62.0 탐색기").

python3 tools/load/files.py <미리 보기 폴더> 결과.json [--runs 5]

- 미리 보기 폴더는 measure.py와 같은 빌드(tools/load/vite.config.ts – 가짜 폴더에 `window.__filesSeed` 자리가 붙어요).
- 장면: 왼쪽 창에 파일 0·500·2,000개 폴더(오른쪽 창은 D:\\민원처리 17개), 그리고 두 창 모두 2,000개 폴더.
- 잰 값: 캘린더 → 탐색기 전환(measure.switch_ms), 빠른 필터 "포트홀"(약 1/5이 걸림) 치기·지우기, 탐색기 DOM 요소 수.
  각 항목 --runs번 재서 중간값. 1600×900. 나머지 3년치 자료(seed.js)도 measure.py와 같이 채워요.
"""
import json
import statistics
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
import measure  # noqa: E402

FILES_SEED = r"""
window.__filesSeed = (addFake, addDir) => {
  const n = window.__filesN || 0;
  const dir = "D:\\부하\\파일" + n;
  addDir(dir);
  const ext = ["jpg", "jpg", "pptx", "hwp", "xlsx", "pdf", "png", "hwpx", "txt", "zip"];
  const what = ["포트홀", "배수구", "차선", "보도블록", "가로수", "침하", "맨홀", "방호벽", "제설", "가드레일"];
  const ri = ["봉일천리", "등원리", "문산리", "법원리", "연풍리", "법흥리", "위전리", "마지리"];
  let s = 20261030;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < n; i++) {
    const d = new Date(2024, 0, 1 + Math.floor(rnd() * 1030), 8 + Math.floor(rnd() * 10), Math.floor(rnd() * 60));
    const y = String(d.getFullYear()).slice(2), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
    const name = `${y}${m}${dd}_${ri[i % ri.length]} ${100 + (i % 900)}_${what[(i * 7) % what.length]}_${i + 1}.${ext[i % ext.length]}`;
    const iso = d.toISOString().slice(0, 16);
    addFake(dir + "\\" + name, 20000 + Math.floor(rnd() * 4000000), iso);
  }
};
const _seed = window.__previewSeed;
window.__previewSeed = async (call) => {
  await _seed(call);
  const dir = "D:\\부하\\파일" + (window.__filesN || 0);
  const right = window.__filesBoth ? dir : "D:\\민원처리";
  const pane = (p) => ({ tabs: [{ path: p, pinned: false }], active: 0, view: "detail", sort: "name", asc: true });
  call("set_value", { key: "files.state", value: JSON.stringify({ layout: "lr", split: 0.5, active: 0, panes: [pane(dir), pane(right), pane(dir), pane(dir)] }) });
};
"""


def scene(browser, port, n, both, runs):
    extra = f"window.__filesN = {n}; window.__filesBoth = {json.dumps(both)};\n" + FILES_SEED
    ctx, page = measure.open_page(browser, port, extra=extra)
    out = {}
    add = lambda k, v: out.setdefault(k, []).append(round(v, 1))
    # 처음 한 번 열어 상태·아이콘 자리를 데워요(앱도 두 번째부터가 보통이에요)
    measure.go(page, "탐색기")
    page.wait_for_timeout(800)
    rows = page.evaluate("() => [...document.querySelectorAll('.fx-status .fx-st-l')].map((e) => e.textContent)")
    for _ in range(runs):
        add("전환", measure.switch_ms(page, "탐색기"))
    out["DOM 요소"] = [page.evaluate("() => document.querySelectorAll('*').length")]
    sel = "input[aria-label='빠른 필터']"
    for _ in range(runs):
        page.wait_for_timeout(300)
        add("빠른 필터 치기", page.evaluate("(s) => window.__time(() => window.__type(s, '포트홀'))", sel))
        add("빠른 필터 지우기", page.evaluate("(s) => window.__time(() => window.__type(s, ''))", sel))
    ctx.close()
    return {k: {"median": statistics.median(v), "runs": v} for k, v in out.items()}, rows


if __name__ == "__main__":
    site, result = sys.argv[1], sys.argv[2]
    runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 5
    port = measure.serve(site)
    res = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for n, both in [(0, False), (500, False), (2000, False), (2000, True)]:
            tag = f"{n}개" + (" · 두 창" if both else "")
            r, rows = scene(browser, port, n, both, runs)
            res[tag] = r
            print(tag, rows)
            for k, v in r.items():
                print(f"  {k}: {v['median']}  {v['runs']}")
        browser.close()
    Path(result).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
