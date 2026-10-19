# 지금 / 1안 / 2안 머리 줄을 화면마다 세 줄로 이어 한 장으로 (상단 정리 세션)
#   python3 topbar_sheet.py <결과.png> <배율> <지금 폴더> <1안 폴더> <2안 폴더>
import sys
from PIL import Image, ImageDraw, ImageFont

out, scale, dirs = sys.argv[1], float(sys.argv[2]), sys.argv[3:]
names = ["탐색기", "민원대장", "민원처리", "캘린더", "할 일", "업무일지", "업무연락처", "집행현황", "예산현황", "설정"]
import os
tags = os.environ.get("TAGS", "지금,1안,2안").split(",")[: len(dirs)]
f = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", int(13 * scale))
fb = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", int(13 * scale))
lab = int(180 * scale)
rows = []
for i, n in enumerate(names):
    rows.append((n, [Image.open(f"{d}/{i:02d}.png") for d in dirs]))
h1 = rows[0][1][0].height
gap, block_gap = int(2 * scale), int(14 * scale)
W = lab + rows[0][1][0].width
H = sum(len(r[1]) * (h1 + gap) + block_gap for r in rows)
sheet = Image.new("RGB", (W, H), (226, 225, 232))
d = ImageDraw.Draw(sheet)
y = 0
for n, imgs in rows:
    d.text((int(16 * scale), y + int(4 * scale)), n, fill=(28, 27, 34), font=fb)
    for t, im in zip(tags, imgs):
        sheet.paste(im, (lab, y))
        d.text((int(100 * scale), y + h1 // 2 - int(9 * scale)), t, fill=(75, 55, 196) if t != "지금" else (94, 92, 106), font=fb if t != "지금" else f)
        y += h1 + gap
    y += block_gap
sheet.save(out)
print(sheet.size)
