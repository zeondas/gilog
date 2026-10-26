// 순서가 뒤집히는 같은 무게 규칙 짝 후보 뽑기: node tools/tidy/pairs.mjs <app.css> <css-map.json> <cand.json>
import fs from "fs"; import { createRequire } from "module";
const require = createRequire(import.meta.url);
const postcss = require("postcss");
const { sectionsOf } = await import("./split-css.mjs");
const ORDER = ["base","dialogs","settings","contacts","journal","complaints","tasks","calendar","process","files","budget","bstatus","late"];
const css = fs.readFileSync(process.argv[2],"utf8");
const map = JSON.parse(fs.readFileSync(process.argv[3],"utf8"));
const rules = []; let ord = 0;
for (const s of sectionsOf(css)) {
  const d = map[s.key]; let dest = typeof d === "string" ? d : d.to; const cuts = typeof d === "object" ? d.cuts : [];
  let off = 0, ci = 0; const cutAt = cuts.map(([mk, nx]) => [s.text.indexOf("\n"+mk)+1, nx]);
  postcss.parse(s.text).walkRules(r => {
    const pos = r.source.start.offset;
    let dd = dest; for (const [at, nx] of cutAt) if (pos >= at) dd = nx;
    let media = ""; for (let p = r.parent; p && p.type !== "root"; p = p.parent) if (p.type === "atrule") media += p.params;
    if (r.parent.type === "atrule" && /keyframes/.test(r.parent.name)) return;
    for (const sel of r.selectors) rules.push({ sel, media, props: r.nodes.filter(n=>n.type==="decl").map(n=>n.prop), decl: r.nodes.filter(n=>n.type==="decl").map(n=>n.prop+":"+n.value), file: ORDER.indexOf(dd), ord: ord++ , sec: s.line });
  });
}
function spec(sel) {
  let a=0,b=0,c=0;
  sel = sel.replace(/:(is|not|has|where)\(((?:[^()]|\([^()]*\))*)\)/g, (m, f, inner) => { if (f==="where") return ""; const best = inner.split(/,(?![^(]*\))/).map(spec).sort((x,y)=>y-x)[0]; const v=best; a+=Math.floor(v/10000); b+=Math.floor(v/100)%100; c+=v%100; return ""; });
  a += (sel.match(/#[\w-]+/g)||[]).length;
  b += (sel.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(\([^)]*\))?/g)||[]).length;
  c += (sel.replace(/\[[^\]]*\]/g,"").match(/(^|[\s>+~])[a-zA-Z][\w-]*|::[\w-]+/g)||[]).length;
  return a*10000+b*100+c;
}
const longhand = p => p; // compare via families
const fam = p => p.replace(/^(margin|padding|border|inset|font|background|grid|flex|gap|overflow|outline|transition|animation|place|text-decoration|list-style|columns)(-.*)?$/, "$1").replace(/^(top|right|bottom|left)$/,"inset").replace(/^(width|height|min-.*|max-.*)$/,"$1");
rules.forEach(r => { r.spec = spec(r.sel); r.fams = new Set(r.props.map(fam)); r.pseudo = /::(before|after|placeholder|-webkit-scrollbar[\w-]*|selection|marker)/.exec(r.sel)?.[0] || ""; });
const out = [];
for (let i=0;i<rules.length;i++) for (let j=i+1;j<rules.length;j++) {
  const A=rules[i], B=rules[j];
  if (A.file <= B.file) continue;           // order kept
  if (JSON.stringify(A.decl) === JSON.stringify(B.decl)) continue;
  if (A.spec !== B.spec || A.media !== B.media || A.pseudo !== B.pseudo) continue;
  if (![...B.fams].some(f=>A.fams.has(f))) continue;
  out.push([A.sel, B.sec+"|"+B.sel, A.sec]);
}
fs.writeFileSync(process.argv[4], JSON.stringify(out));
console.log("후보 짝", out.length);
