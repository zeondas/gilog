"""한글 없이 매뉴얼 PDF 만들기(확인용 – 2026-11-05 사용자 3안). 한글 파일(hwpx)을 읽어 웹 화면으로 그린 뒤 크롬으로 PDF를 찍어요.

  python3 tools/manual/hwpx_pdf.py <매뉴얼.hwpx> <결과.pdf> <앞 그림 폴더(cover.png·toc.png·band_<장>.png)>

- 글자·문단 모양(크기·굵기·색·바탕·자간·위치, 들여쓰기·내어쓰기·줄 간격·문단 위아래)은 header.xml 값을 그대로 옮겨요.
- 그림 틀은 그 크기 그대로, 쪽 나누기는 문단의 쪽 나누기 표시대로. 줄 나눔·쪽 나눔은 크롬이 정해서 한글과 조금 달라요.
- 장마다 따로 찍어 옆 색인 띠(장 그림)를 깔고 쪽 번호(- n -)를 얹은 뒤 하나로 합쳐요. 표지·목차는 그림 그대로.
글꼴: Pretendard(정적 TTF)가 깔려 있어야 해요(~/.fonts).
"""
import asyncio
import base64
import html
import io
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from hwpx_toplevel import top_paras  # noqa: E402
from pypdf import PdfReader, PdfWriter  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.ttfonts import TTFont  # noqa: E402

KEYS = ["overview", "explorer", "complaints", "map", "process", "budget", "bstatus", "calendar", "todo", "journal", "contacts", "settings"]
PW, PH = 59528, 84186
BAND_W = round(17 * 283.46)


def hu(v):  # HWPUNIT → pt
    return int(v) / 100


def styles(header):
    cps, pps = {}, {}
    faces = {}
    for m in re.finditer(r'<hh:fontface lang="HANGUL"[^>]*>(.*?)</hh:fontface>', header, re.S):
        for f in re.finditer(r'<hh:font id="(\d+)" face="([^"]+)"', m.group(1)):
            faces[f.group(1)] = f.group(2)
    for m in re.finditer(r'<hh:charPr id="(\d+)"(.*?)</hh:charPr>', header, re.S):
        a = m.group(2)
        g = lambda pat, d=None: (re.search(pat, a).group(1) if re.search(pat, a) else d)  # noqa: E731
        face = faces.get(g(r'<hh:fontRef hangul="(\d+)"', "0"), "Pretendard")
        st = [f"font-size:{hu(g(r'height=\"(\d+)\"'))}pt", f"color:{g(r'textColor=\"([^\"]+)\"')}"]
        bold = "<hh:bold/>" in a
        st.append("font-weight:" + ("800" if "ExtraBold" in face else "700" if bold else "400"))
        shade = g(r'shadeColor="([^"]+)"')
        if shade and shade != "none":
            st.append(f"background:{shade}")
        sp = int(g(r'<hh:spacing hangul="(-?\d+)"', "0"))
        if sp:
            st.append(f"letter-spacing:{sp / 100}em")
        off = int(g(r'<hh:offset hangul="(-?\d+)"', "0"))
        if off:
            st.append(f"position:relative;top:{off / 100}em")
        if "<hh:italic/>" in a:
            st.append("font-style:italic")
        cps[m.group(1)] = ";".join(st)
    for m in re.finditer(r'<hh:paraPr id="(\d+)"(.*?)</hh:paraPr>', header, re.S):
        a = m.group(2)
        case = re.search(r"<hp:case[^>]*>(.*?)</hp:case>", a, re.S)
        b = case.group(1) if case else a
        g = lambda pat, d="0": (re.search(pat, b).group(1) if re.search(pat, b) else d)  # noqa: E731
        al = re.search(r'<hh:align horizontal="(\w+)"', a).group(1)
        intent, left, prev, nxt = (int(g(rf'<hc:{k} value="(-?\d+)"')) for k in ("intent", "left", "prev", "next"))
        ls = re.search(r'<hh:lineSpacing type="(\w+)" value="(\d+)"', b) or re.search(r'<hh:lineSpacing type="(\w+)" value="(\d+)"', a)
        lt, lv = ls.groups() if ls else ("PERCENT", "160")
        st = [f"text-align:{dict(JUSTIFY='justify', LEFT='left', RIGHT='right', CENTER='center', DISTRIBUTE='justify').get(al, 'left')}",
              f"margin:{hu(prev)}pt 0 {hu(nxt)}pt 0"]
        if intent < 0:
            st.append(f"padding-left:{hu(left - intent)}pt;text-indent:{hu(intent)}pt")
        else:
            st.append(f"padding-left:{hu(left)}pt;text-indent:{hu(intent)}pt")
        st.append(f"line-height:{int(lv) / 100}" if lt == "PERCENT" else f"line-height:{hu(lv)}pt")
        pps[m.group(1)] = (";".join(st), al)
    return cps, pps


class Doc:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.hpf = self.z.read("Contents/content.hpf").decode()
        self.cps, self.pps = styles(self.z.read("Contents/header.xml").decode())
        self.cache = {}

    def img(self, bid):
        if bid not in self.cache:
            href = re.search(rf'<opf:item id="{bid}" href="([^"]+)"', self.hpf).group(1)
            self.cache[bid] = "data:image/png;base64," + base64.b64encode(self.z.read(href)).decode()
        return self.cache[bid]

    def pic(self, p, block=False):
        bid = re.search(r'binaryItemIDRef="([^"]+)"', p).group(1)
        w, h = re.search(r'<hp:sz width="(\d+)" (?:widthRelTo="\w+" )?height="(\d+)"', p).groups()
        return f'<img src="{self.img(bid)}" style="width:{hu(w)}pt;height:{hu(h)}pt;vertical-align:bottom">'

    def table(self, t):
        w = re.search(r'<hp:sz width="(\d+)"', t).group(1)
        h = re.search(r'<hp:sz width="\d+" widthRelTo="\w+" height="(\d+)"', t).group(1)
        rows = []
        for tr in re.findall(r"<hp:tr>(.*?)</hp:tr>", t, re.S):
            cells = []
            for tc in re.findall(r"<hp:tc\b.*?</hp:tc>", tr, re.S):
                cw = re.search(r'<hp:cellSz width="(\d+)"', tc).group(1)
                ml, mr, mt, mb = re.search(r'<hp:cellMargin left="(\d+)" right="(\d+)" top="(\d+)" bottom="(\d+)"', tc).groups()
                sub = re.search(r"<hp:subList[^>]*>(.*)</hp:subList>", tc, re.S).group(1)
                inner = "".join(self.para(sub[a:b]) for a, b in top_paras(sub))
                bord = "none" if "<hp:pic" in tc else "1px solid #C9C9CF"
                cells.append(f'<td style="width:{hu(cw)}pt;padding:{hu(mt)}pt {hu(mr)}pt {hu(mb)}pt {hu(ml)}pt;border:{bord};vertical-align:middle">{inner}</td>')
            rows.append("<tr>" + "".join(cells) + "</tr>")
        pic = "<hp:pic" in t
        return (f'<table class="{"fr" if pic else "tb"}" style="width:{hu(w)}pt;{"height:" + str(hu(h)) + "pt;" if pic else ""}">'
                + "".join(rows) + "</table>")

    def para(self, p):
        head = re.match(r"<hp:p [^>]*>", p).group(0)
        ppid = re.search(r'paraPrIDRef="(\d+)"', head).group(1)
        st, al = self.pps.get(ppid, ("", "LEFT"))
        brk = 'pageBreak="1"' in head
        body = re.sub(r"<hp:linesegarray>.*?</hp:linesegarray>", "", p, flags=re.S)
        out, floats, has_tbl, lead_em = [], [], False, []
        for rm in re.finditer(r'<hp:run charPrIDRef="(\d+)"\s*(/>|>(.*?)</hp:run>)', body, re.S):
            cst = self.cps.get(rm.group(1), "")
            inner = rm.group(3) or ""
            for part in re.finditer(r"<hp:tbl\b.*?</hp:tbl>|<hp:pic\b.*?</hp:pic>|<hp:rect\b.*?</hp:rect>|<hp:t>(.*?)</hp:t>|<hp:t/>|<hp:lineBreak/>|<hp:secPr\b.*?</hp:secPr>|<hp:ctrl>.*?</hp:ctrl>", inner, re.S):
                x = part.group(0)
                if x.startswith("<hp:tbl"):
                    has_tbl = True
                    out.append(self.table(x))
                elif x.startswith("<hp:pic"):
                    if 'treatAsChar="0"' in x:   # 글 뒤 그림(장 밑줄 등) – 그 문단 아래에 얹어요
                        vo = int(re.search(r'vertOffset="(-?\d+)"', x).group(1))
                        floats.append(f'<div style="position:absolute;left:0;top:{hu(vo)}pt">{self.pic(x)}</div>')
                    else:
                        out.append(self.pic(x))
                elif x == "<hp:lineBreak/>":
                    out.append("<br>")
                elif x.startswith("<hp:t>"):
                    t = re.sub(r"<[^>]+>", "", part.group(1) or "")
                    t = html.escape(html.unescape(t))
                    lead = ""
                    if not any(o.startswith("<span") for o in out):   # 문단 앞 띄어쓰기: 한글처럼 반 글자 폭, 양쪽 맞춤에 안 늘어나게
                        n_sp = len(t) - len(t.lstrip(" "))
                        if n_sp:
                            lead_em.append(n_sp * 0.5)
                            t = t[n_sp:]
                    out.append(f'{lead}<span style="{cst}">{t}</span>')
        content = "".join(out) or "&#8203;"
        size = re.search(r"font-size:([\d.]+)pt", self.cps.get(re.search(r'<hp:run charPrIDRef="(\d+)"', body).group(1), "")) if re.search(r'<hp:run charPrIDRef="(\d+)"', body) else None
        fs = f"font-size:{size.group(1)}pt;" if size else ""
        cls = "p" + (" brk" if brk else "") + (" keep" if has_tbl else "")
        if has_tbl:
            st = re.sub(r"text-indent:[^;]+", "text-indent:0", st)
        elif lead_em:   # 앞 띄어쓰기는 첫 줄 들여쓰기로(양쪽 맞춤에 안 늘어나게)
            st = re.sub(r"text-indent:([-\d.]+)pt", lambda m: f"text-indent:calc({m.group(1)}pt + {lead_em[0]}em)", st)
        return f'<div class="{cls}" style="position:relative;{fs}{st}">{"".join(floats)}{content}</div>'

    def section_html(self, k):
        s = self.z.read(f"Contents/section{k}.xml").decode()
        P = [s[a:b] for a, b in top_paras(s)]
        out = []
        for i, p in enumerate(P):
            h = self.para(p)
            nxt = P[i + 1] if i + 1 < len(P) else ""
            if "<hp:tbl" in nxt and "<hp:tbl" not in p:   # 그림 바로 위 제목·글은 그림과 같은 쪽에
                h = h.replace('<div class="p', '<div class="p kn', 1)
            out.append(h)
        # 제목 + 그림을 한 묶음으로(크롬은 break-after만으로는 잘 안 지켜요)
        html_ = "".join(out)
        return re.sub(r'(<div class="p kn[^"]*"[^>]*>.*?</div>)(<div class="p[^"]* keep"[^>]*>.*?</table></div>)',
                      r'<div class="grp">\1\2</div>', html_, flags=re.S)


CSS = """@page{size:210mm 297mm;margin:%(top)spt %(right)spt %(bottom)spt %(left)spt}
html,body{margin:0;padding:0}
body{font-family:Pretendard;color:#000;white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.p{orphans:1;widows:1}.grp{break-inside:avoid}.kn{break-after:avoid}.brk{break-before:page}.keep{break-inside:avoid;white-space:normal}
table{border-collapse:collapse;display:inline-table;text-indent:0}table.fr td{text-align:center}
table.tb{white-space:pre-wrap}"""


async def render(doc, out_dir):
    from playwright.async_api import async_playwright
    st = CSS % {"top": hu(4251 + 2834), "bottom": hu(2834 + 2834), "left": hu(7086), "right": hu(4252)}
    paths = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        pg = await br.new_page()
        for k in range(1, 13):
            body = doc.section_html(k)
            await pg.set_content(f"<!doctype html><meta charset=utf-8><style>{st}</style><body>{body}</body>")
            await pg.evaluate("() => document.fonts.ready")
            path = os.path.join(out_dir, f"sec{k}.pdf")
            await pg.pdf(path=path, prefer_css_page_size=True, print_background=True)
            paths.append(path)
        await br.close()
    return paths


def stamp(front, key, n):
    """띠 그림(아래 깔기)과 쪽 번호(위에 얹기) 한 쪽씩"""
    b1, b2 = io.BytesIO(), io.BytesIO()
    c = canvas.Canvas(b1, pagesize=(210 * mm, 297 * mm))
    c.drawImage(os.path.join(front, f"band_{key}.png"), 0, 0, width=BAND_W / 100, height=297 * mm)
    c.save()
    c = canvas.Canvas(b2, pagesize=(210 * mm, 297 * mm))
    c.setFont("P", 9)
    c.setFillColorRGB(0.42, 0.41, 0.46)
    x = (hu(7086) + (210 * mm - hu(7086) - hu(4252)) / 2)
    c.drawCentredString(x, hu(2834) * 0.62, f"- {n} -")
    c.save()
    return PdfReader(b1).pages[0], PdfReader(b2).pages[0]


def main():
    src, out, front = sys.argv[1:4]
    font = next((os.path.join(r, f) for r, _, fs in os.walk(os.path.expanduser("~/.fonts")) for f in fs if f == "Pretendard-Regular.ttf"), None)
    pdfmetrics.registerFont(TTFont("P", font))
    doc = Doc(src)
    tmp = os.path.join(os.path.dirname(os.path.abspath(out)), "_pdf_parts")
    os.makedirs(tmp, exist_ok=True)
    parts = asyncio.run(render(doc, tmp))
    w = PdfWriter()
    for name in ("cover.png", "toc.png"):     # 표지·목차
        b = io.BytesIO()
        c = canvas.Canvas(b, pagesize=(210 * mm, 297 * mm))
        c.drawImage(os.path.join(front, name), 0, 0, width=210 * mm, height=297 * mm)
        c.save()
        w.add_page(PdfReader(b).pages[0])
    n = 0
    starts = []
    for k, path in enumerate(parts):
        starts.append(n + 1)
        for page in PdfReader(path).pages:
            n += 1
            under, over = stamp(front, KEYS[k], n)
            under.merge_page(page)
            under.merge_page(over)
            w.add_page(under)
    with open(out, "wb") as f:
        w.write(f)
    print("만듦", out, "쪽", n + 2, "장 시작 쪽", ",".join(map(str, starts)))


if __name__ == "__main__":
    main()
