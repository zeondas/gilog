"""기록 사용자 매뉴얼 – 한글(.hwpx) 글 원고 만들기.

  python3 tools/manual/hwpx_draft.py [매뉴얼 HTML] [결과.hwpx]

매뉴얼 글(docs/manual/<화면>.md)을 사용자가 한글에서 고칠 수 있는 원고로 꺼내요. 그림은 번호 위치를 보는 참고용
화면 그림 하나씩만 넣고, 나머지 그림 자리는 "[그림: …]" 글로 둬요. 고친 원고를 받으면 md에 옮겨 담고
build.py로 그림·번호·디자인을 붙인 PDF·HTML을 다시 만들어요(원고 규칙은 첫 쪽 "작성 안내").
매뉴얼 HTML은 build.py가 먼저 만들어 둔 것을 써요(참고 그림을 거기서 찍어요).
"""
import asyncio
import datetime
import os
import re
import sys
import warnings

from hwpx import HwpxDocument
from playwright.async_api import async_playwright

import build

warnings.filterwarnings("ignore", category=DeprecationWarning)

FONT = "맑은 고딕"
RING = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


class Draft:
    def __init__(self):
        self.d = HwpxDocument.new()
        st = self.d.styles
        self.cs = {
            "body": st.ensure_run(font=FONT, size=10, color="#3B3A45"),
            "bold": st.ensure_run(font=FONT, size=10, bold=True, color="#1C1B22"),
            "key": st.ensure_run(font=FONT, size=9, bold=True, color="#1C1B22", highlight="#E5E4EC"),
            "chapter": st.ensure_run(font=FONT, size=20, bold=True, color="#1C1B22"),
            "sec": st.ensure_run(font=FONT, size=12, bold=True, color="#1C1B22"),
            "title": st.ensure_run(font=FONT, size=11, bold=True, color="#1C1B22"),
            "sub": st.ensure_run(font=FONT, size=10, bold=True, color="#1C1B22"),
            "muted": st.ensure_run(font=FONT, size=9, color="#6A6876"),
            "fig": st.ensure_run(font=FONT, size=10, color="#4B37C4"),
        }
        self.d.set_page_margins(left=5669, right=5669, top=4252, bottom=4252, header=2268, footer=2268)  # 20mm·15mm·8mm
        self.d.set_header_text("기록 사용자 매뉴얼 – 글 원고")
        self.d.set_page_number(format="page", align="RIGHT", position="BOTTOM_RIGHT")
        self.first = True

    def _fmt(self, **kw):
        idx = len(self.d.paragraphs) - 1
        self.d.set_paragraph_format(paragraph_index=idx, **kw)

    def para(self, text="", style="body", indent=0, before=0, after=3, page_break=False, keep=False):
        """한 문단. 글 속 **굵게**·`키`는 글자 모양으로 바꿔요."""
        if self.first:   # 새 문서의 빈 첫 문단을 써요
            p = self.d.paragraphs[0]
            self.first = False
        else:
            p = self.d.add_paragraph("", char_pr_id_ref=self.cs[style], include_run=False)
        for kind, t in split(text):
            if not t:
                continue
            p.add_run(t, char_pr_id_ref=self.cs["bold" if kind == "b" else "key" if kind == "k" else style])
        if not text:
            p.add_run("", char_pr_id_ref=self.cs[style])
        self._fmt(indent_left_mm=indent, spacing_before_pt=before, spacing_after_pt=after, line_spacing_percent=160,
                  page_break_before=page_break or None, keep_with_next=keep or None)
        return p

    def picture(self, path, width_mm, indent=0):
        from PIL import Image
        w, h = Image.open(path).size
        self.d.add_picture(open(path, "rb").read(), "png", width_mm=width_mm, height_mm=width_mm * h / w)
        self._fmt(indent_left_mm=indent, spacing_after_pt=2)

    def save(self, path):
        self.d.save_to_path(path)


def split(text):
    """md 글 → [(종류, 글)] – b 굵게, k 키, t 보통. {{단추}}는 지우고 "[단추]"를 앞에 붙여요."""
    text = re.sub(r"\{\{.+?\}\}", "", text)
    out, last = [], 0
    for m in re.finditer(r"\*\*(.+?)\*\*|`(.+?)`", text):
        out.append(("t", text[last:m.start()]))
        out.append(("b", m.group(1)) if m.group(1) is not None else ("k", f" {m.group(2)} "))
        last = m.end()
    out.append(("t", text[last:]))
    return out


GUIDE = [
    "이 파일은 매뉴얼의 글만 담은 원고예요. 글을 고쳐 보내 주시면 화면 그림·번호·디자인을 붙여 PDF로 만들어 드려요.",
    "글자 모양·간격은 신경 쓰지 않으셔도 돼요. 매뉴얼 모양은 늘 같은 틀로 다시 만들어요.",
]
RULES = [
    "**[화면]** 줄과 **[기획 의도]**·**[기능별 설명]**·**[상세 설명]**·**[알아 두면 좋은 것]** 줄은 그대로 두세요(구분 표시예요).",
    "①②③… 은 화면 그림의 번호예요. 기능별 설명과 상세 설명 큰 제목에 같은 번호를 써요. 번호를 더하거나 빼려면 그 줄을 지우거나 더하고 \"[그림: 어디를 가리킬지]\"를 적어 주세요.",
    "**■** 로 시작하는 줄은 작은 제목(딸린 기능)이에요.",
    "**1. 2. 3.** 은 따라 하는 순서, **-** 는 알아 둘 것, 그 밖의 줄은 설명 문단이에요.",
    "그림을 넣고 싶은 자리에는 **[그림: 무엇을 보여 줄지]** 를 적어 주세요. 메뉴·창이 열린 모습을 찍어 그 자리에 넣어요.",
    "**[단추]** 가 붙은 줄은 앱의 단추 그림이 줄 앞에 들어가요.",
    "굵은 글자는 매뉴얼에서도 굵게, 회색 바탕 글자( Ctrl+R )는 키 모양으로 나와요.",
    "보내 주실 때: 회사 PC에서 저장했다면 파일을 탐색기에서 우클릭 → 보안 해제한 뒤 보내 주세요.",
]


async def shots(html, n):
    """매뉴얼 HTML에서 장마다 번호가 그려진 화면 그림을 3배로 찍어요."""
    out = os.path.splitext(html)[0] + "_hwpx"
    os.makedirs(out, exist_ok=True)
    paths = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        p = await br.new_page(viewport={"width": 900, "height": 1200}, device_scale_factor=3)
        await p.goto("file://" + os.path.abspath(html))
        await p.evaluate("() => document.fonts.ready")
        for i in range(1, n + 1):
            f = os.path.join(out, f"ch{i:02d}.png")
            await p.locator(f"#ch{i} .shot").first.screenshot(path=f)
            paths.append(f)
        await br.close()
    return paths


def chapter(dr, i, ch, shot):
    dr.para(f"[화면] {ch['title']}", "chapter", page_break=True, after=4)
    dr.para(f"부제목: {ch['def']}", "body", after=10)
    dr.para("(참고) 화면 그림과 번호 위치 – 이 그림은 원고 확인용이에요.", "muted", after=2, keep=True)
    dr.picture(shot, 170)

    dr.para("[기획 의도]", "sec", before=12, after=4, keep=True)
    for t in ch["intent"] or ["(기획 의도를 적어 주세요)"]:
        dr.para(f"- {t}", indent=3)

    dr.para("[기능별 설명]", "sec", before=12, after=4, keep=True)
    for k, m in enumerate(ch["marks"]):
        dr.para(f"{RING[k]} **{m['name']}** – {m['text']}", indent=3)

    dr.para("[상세 설명]", "sec", before=12, after=4, keep=True)
    names = {m["name"]: k for k, m in enumerate(ch["marks"])}
    if ch["detail"]:
        seen = False
        for sub in build.ordered_detail(ch):
            k = names.get(sub["title"])
            if k is not None:
                seen = True
                dr.para(f"{RING[k]} {sub['title']}", "title", before=10, after=3, keep=True)
            else:
                dr.para(f"■ {sub['title']}", "sub", indent=3 if seen and not sub["title"].startswith("설정") else 0,
                        before=8, after=2, keep=True)
            step = 0
            for kind, v in sub["parts"]:
                if kind == "step":
                    step += 1
                    dr.para(f"{step}. {v}", indent=6)
                elif kind == "dot":
                    chip = v.startswith("{{")
                    dr.para(("[단추] " if chip else "- ") + v, indent=6)
                elif kind == "fig":
                    dr.para(f"[그림: {v['cap']}]", "fig", indent=6, before=2, after=4)
                else:
                    dr.para(v, indent=6)
    else:
        # 아직 상세 설명이 없는 장: 번호마다 큰 제목 + 지금 설명을 첫 문단으로 깔아 둬요
        for k, m in enumerate(ch["marks"]):
            dr.para(f"{RING[k]} {m['name']}", "title", before=10, after=3, keep=True)
            dr.para(m["text"], indent=6)
            dr.para("(사용법을 단계로 적어 주세요 – 1. 2. 3.)", "muted", indent=6)
        for o in ch["opens"]:
            dr.para(f"[그림: {o['title']}] {o['text']}", "fig", indent=6, before=4)

    dr.para("[알아 두면 좋은 것]", "sec", before=12, after=4, keep=True)
    for t in ch["tips"] or ["(적을 것이 없으면 이 줄을 지워 주세요)"]:
        dr.para(f"- {t}", indent=3)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    html = args[0] if args else os.path.join(build.DOCS, "기록-매뉴얼.html")
    out = args[1] if len(args) > 1 else os.path.join(build.DOCS, "기록-매뉴얼-원고.hwpx")
    chapters = [build.parse(os.path.join(build.DOCS, k + ".md")) for k, _ in build.ORDER
                if os.path.exists(os.path.join(build.DOCS, k + ".md"))]
    pics = asyncio.run(shots(html, len(chapters)))
    dr = Draft()
    dr.para("기록 사용자 매뉴얼 – 글 원고", "chapter", after=2)
    dr.para(f"{datetime.date.today():%Y-%m-%d} · 화면 {len(chapters)}개", "muted", after=14)
    dr.para("작성 안내", "sec", after=4)
    for t in GUIDE:
        dr.para(t, after=4)
    dr.para("원고 규칙", "sec", before=10, after=4)
    for t in RULES:
        dr.para(f"- {t}", indent=3)
    dr.para("차례", "sec", before=10, after=4)
    for i, c in enumerate(chapters, 1):
        dr.para(f"{i:02d}  **{c['title']}** – {c['def']}", indent=3)
    for i, (c, s) in enumerate(zip(chapters, pics), 1):
        chapter(dr, i, c, s)
    dr.save(out)
    print(f"만듦 {out} ({os.path.getsize(out) // 1024}KB, {len(chapters)}장)")


if __name__ == "__main__":
    main()
