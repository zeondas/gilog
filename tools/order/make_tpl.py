# 사용자 양식(작업지시서 양식2)에서 자리 표시 양식을 만들어요: 첫 장만 남기고, 표 둘째 줄에 {자리}, 사진 자리는 이름 붙은 네모.
import sys, copy
from pptx import Presentation
from pptx.util import Pt, Emu
from pptx.enum.shapes import MSO_SHAPE
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
src, out = sys.argv[1:3]
p = Presentation(src)
sld = p.slides._sldIdLst
for sid in list(sld)[1:]:
    p.part.drop_rel(sid.rId); sld.remove(sid)
s = p.slides[0]
def settext(cell, txt):
    tf = cell.text_frame
    ref = None
    for para in tf.paragraphs:
        if para.runs: ref = para; break
    # 첫 문단 서식으로 한 문단만
    paras = tf.paragraphs
    keep = ref or paras[0]
    for para in paras:
        if para._p is not keep._p: para._p.getparent().remove(para._p)
    if keep.runs:
        keep.runs[0].text = txt
        for r in keep.runs[1:]: r._r.getparent().remove(r._r)
    else:
        keep.add_run().text = txt
fmt = None
for sh in list(s.shapes):
    if sh.has_table and len(sh.table.rows) == 2 and sh.table.cell(0,0).text.strip() == '연번':
        row = sh.table.rows[1].cells
        # 고려사항 칸은 비어 있어 서식이 없으니 조치내용 칸 서식을 복사
        row[4].text_frame._txBody.getparent().replace(row[4].text_frame._txBody, copy.deepcopy(row[3].text_frame._txBody))
        for c, k in zip(row, ['{연번}', '{지시자}', '{주소}', '{보수내용}', '{고려사항}']):
            settext(c, k)
    elif sh.shape_type == 13:  # 사진 → 자리 네모
        sh._element.getparent().remove(sh._element)
W, H = p.slide_width, p.slide_height
top = 2136622
split = 5333667
for name, x, w in [('위치도', 0, split), ('현장사진', split, W - split)]:
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, top, w, H - top)
    r.name = name
    r.fill.solid(); r.fill.fore_color.rgb = RGBColor(0xF1, 0xF0, 0xF5)
    r.line.color.rgb = RGBColor(0xCF, 0xCD, 0xD9); r.line.width = Pt(0.75)
    tf = r.text_frame; tf.text = f'그림 자리 "{name}"'
    tf.paragraphs[0].alignment = PP_ALIGN.CENTER; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    run = tf.paragraphs[0].runs[0]; run.font.size = Pt(14); run.font.color.rgb = RGBColor(0x5E, 0x5C, 0x6A)
p.save(out)
