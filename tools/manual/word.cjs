// 기록 사용자 매뉴얼 – 워드(.docx) 만들기. build.py --word 가 만든 model.json을 읽어요.
//   node tools/manual/word.cjs <model.json> <결과.docx>
// HTML 매뉴얼과 같은 글·그림·차례예요. 사용자가 워드에서 글자·간격을 직접 고칠 수 있게 표 대신 문단으로 만들어요.
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, AlignmentType, LevelFormat,
  BorderStyle, ShadingType, PageNumber, TabStopType, HeadingLevel, PageBreak,
} = require("docx");

const [, , modelPath, outPath] = process.argv;
const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));

const FONT = "맑은 고딕";
const INK = "1C1B22", INK2 = "3B3A45", MUTED = "6A6876", LINE = "D6D4DE", BAND = "EDECF1", SOFT = "F6F6F8";
const PX = 15;                       // 1px = 15 DXA (96dpi)
const CONTENT_PX = 794 - 96;         // A4 폭 − 좌우 여백(HTML과 같게)
const IND = 34 * PX;                 // 구분 번호 뒤 들여쓰기
const BODY = IND + 29 * PX;          // 상세 설명 본문 왼쪽 선
const ring = (n) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`);
const img = (path, w, h) => new ImageRun({ type: "png", data: fs.readFileSync(path), transformation: { width: Math.round(w), height: Math.round(h) } });

// md 글 → 글 조각: **굵게**, `키`, {{선택자}}(단추 그림)
function runs(text, base = {}, chips = {}) {
  const out = [];
  const re = /\*\*(.+?)\*\*|`(.+?)`|\{\{(.+?)\}\}/g;
  let last = 0, m;
  const plain = (t) => t && out.push(new TextRun({ text: t, ...base }));
  while ((m = re.exec(text))) {
    plain(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(new TextRun({ text: m[1], ...base, bold: true, color: INK }));
    else if (m[2] !== undefined) out.push(new TextRun({ text: ` ${m[2]} `, ...base, size: 17, bold: true, color: INK,
      shading: { type: ShadingType.CLEAR, fill: SOFT, color: "auto" }, border: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 0 } }));
    else {
      const c = chips[m[3]];
      if (c) { out.push(img(c.img, c.w * 0.9, c.h * 0.9)); out.push(new TextRun({ text: " ", ...base })); }
    }
    last = re.lastIndex;
  }
  plain(text.slice(last));
  return out;
}

const body = { color: INK2, size: 20 };
const P = (children, opts = {}) => new Paragraph({ children, spacing: { after: 60, line: 300 }, ...opts });

function secHead(n, title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 280, after: 120 },
    children: [
      new TextRun({ text: `  ${n}  `, bold: true, size: 20, color: INK, shading: { type: ShadingType.CLEAR, fill: BAND, color: "auto" } }),
      new TextRun({ text: `   ${title}`, bold: true, size: 26, color: INK }),
    ],
  });
}

function header(logo) {
  return new Header({ children: [new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: BAND, color: "auto" },
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_PX * PX }],
    spacing: { before: 60, after: 60 },
    children: [img(logo, 65, 15), new TextRun({ text: "\t사용자 매뉴얼", size: 18, color: INK2 })],
  })] });
}
function footer(label) {
  return new Footer({ children: [new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 6 } },
    tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_PX * PX }],
    children: [new TextRun({ text: "기록 사용자 매뉴얼\t", size: 16, color: MUTED }),
      new TextRun({ text: `${label} · `, size: 16, color: MUTED }),
      new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED })],
  })] });
}

const logo = model.chapters[0] && fs.existsSync(require("path").join(require("path").dirname(model.chapters[0].shot.img), "logo.png"))
  ? require("path").join(require("path").dirname(model.chapters[0].shot.img), "logo.png") : null;
const page = { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1100, left: 720, right: 720, header: 400, footer: 400 } };

// 차례 쪽
const cover = [
  new Paragraph({ spacing: { before: 1800 }, children: logo ? [img(logo, 172, 40)] : [] }),
  new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: "사용자 매뉴얼", bold: true, size: 52, color: INK })] }),
  new Paragraph({ spacing: { after: 800 }, children: [new TextRun({ text: `${model.date} 화면 기준`, size: 20, color: MUTED })] }),
  ...model.chapters.map((c) => new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 8 } },
    tabStops: [{ type: TabStopType.LEFT, position: 700 }, { type: TabStopType.LEFT, position: 2600 }],
    spacing: { before: 120, after: 120 },
    children: [new TextRun({ text: String(c.no).padStart(2, "0"), color: MUTED, size: 20 }),
      new TextRun({ text: `\t${c.title}`, bold: true, size: 23, color: INK }),
      new TextRun({ text: `\t${c.def}`, size: 20, color: INK2 })],
  })),
];

function chapter(c) {
  const ch = [];
  const chips = c.chips || {};
  let sec = 0;
  ch.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 80 }, children: [new TextRun({ text: c.title, bold: true, size: 48, color: INK })] }));
  ch.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 10 } }, spacing: { after: 240 },
    children: [new TextRun({ text: c.def, size: 24, color: INK2 })] }));
  if (c.intent.length) {
    ch.push(secHead(++sec, "기획 의도"));
    c.intent.forEach((t) => ch.push(new Paragraph({ numbering: { reference: "dot", level: 0 }, spacing: { after: 40, line: 300 }, children: runs(t, body, chips) })));
  }
  ch.push(secHead(++sec, "화면"));
  ch.push(new Paragraph({ indent: { left: IND }, keepNext: true, children: [img(c.shot.img, c.shot.w, c.shot.h)] }));
  ch.push(secHead(++sec, "기능별 설명"));
  c.feats.forEach((f) => ch.push(P([new TextRun({ text: `${ring(f.no)}  `, size: 22, color: INK }),
    new TextRun({ text: `${f.name}  `, bold: true, size: 20, color: INK }), ...runs(f.text, body, chips)],
    { indent: { left: IND + 340, hanging: 340 }, spacing: { after: 30, line: 288 } })));
  if (c.detail.length) {
    ch.push(new Paragraph({ children: [new PageBreak()] }));
    ch.push(secHead(++sec, "상세 설명"));
    for (const d of c.detail) {
      if (d.kind === "title") ch.push(new Paragraph({ keepNext: true, spacing: { before: 240, after: 80 }, indent: { left: IND },
        children: [new TextRun({ text: `${ring(d.no)}  `, size: 24, color: INK }), new TextRun({ text: d.text, bold: true, size: 23, color: INK })] }));
      else if (d.kind === "plain") ch.push(new Paragraph({ keepNext: true, spacing: { before: 240, after: 80 }, indent: { left: BODY },
        children: [new TextRun({ text: d.text, bold: true, size: 23, color: INK })] }));
      else if (d.kind === "sub") ch.push(new Paragraph({ keepNext: true, spacing: { before: 160, after: 60 }, indent: { left: BODY },
        children: [new TextRun({ text: d.text, bold: true, size: 21, color: INK })] }));
      else if (d.kind === "step") ch.push(P([new TextRun({ text: `${d.n}.  `, bold: true, size: 20, color: INK }), ...runs(d.text, body, chips)],
        { indent: { left: BODY + 300, hanging: 300 } }));
      else if (d.kind === "dot") ch.push(d.text.startsWith("{{")
        ? P(runs(d.text, body, chips), { indent: { left: BODY } })
        : new Paragraph({ numbering: { reference: "dot2", level: 0 }, spacing: { after: 60, line: 300 }, children: runs(d.text, body, chips) }));
      else if (d.kind === "fig") {
        ch.push(new Paragraph({ keepNext: true, indent: { left: BODY }, spacing: { before: 120 }, children: [img(d.img, d.w, d.h)] }));
        ch.push(P(runs(d.text, { size: 17, color: MUTED }, chips), { indent: { left: BODY }, spacing: { after: 160 } }));
      } else ch.push(P(runs(d.text, body, chips), { indent: { left: BODY } }));
    }
  }
  if (c.opens.length) {
    ch.push(secHead(++sec, "메뉴·창 모습"));
    for (const o of c.opens) {
      ch.push(new Paragraph({ keepNext: true, indent: { left: IND }, spacing: { before: 120 }, children: [img(o.img, o.w, o.h)] }));
      ch.push(P([new TextRun({ text: `${o.title}  `, bold: true, size: 20, color: INK }), ...runs(o.text, body, chips)], { indent: { left: IND }, spacing: { after: 160 } }));
    }
  }
  if (c.tips.length) {
    const box = { shading: { type: ShadingType.CLEAR, fill: SOFT, color: "auto" }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: INK, space: 8 } }, indent: { left: 160 } };
    ch.push(new Paragraph({ ...box, spacing: { before: 280, after: 0 }, keepNext: true, children: [new TextRun({ text: "알아 두면 좋은 것", bold: true, size: 20, color: INK })] }));
    c.tips.forEach((t, i) => ch.push(new Paragraph({ ...box, spacing: { after: i === c.tips.length - 1 ? 120 : 0, line: 300 }, children: runs(t, body, chips) })));
  }
  return ch;
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: { ascii: FONT, eastAsia: FONT, hAnsi: FONT }, size: 20, color: INK } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 48, bold: true }, paragraph: { outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 26, bold: true }, paragraph: { outlineLevel: 1 } },
    ],
  },
  numbering: { config: [
    { reference: "dot", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: IND + 240, hanging: 200 } } } }] },
    { reference: "dot2", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: BODY + 220, hanging: 200 } } } }] },
  ] },
  sections: [
    { properties: { page }, headers: logo ? { default: header(logo) } : undefined, footers: { default: footer("차례") }, children: cover },
    ...model.chapters.map((c) => ({ properties: { page }, headers: logo ? { default: header(logo) } : undefined,
      footers: { default: footer(`${String(c.no).padStart(2, "0")} · ${c.title}`) }, children: chapter(c) })),
  ],
});

Packer.toBuffer(doc).then((buf) => fs.writeFileSync(outPath, buf));
