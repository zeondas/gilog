// app.css 나누기 도구 (정리 2차, 2026-10-26 사용자 ①~⑤ 1안)
//
//   node tools/tidy/split-css.mjs classify <app.css> <map.json>   – 절마다 보낼 파일을 자동으로 정해 map에 써요
//   node tools/tidy/split-css.mjs split    <app.css> <map.json> <out폴더> – map대로 잘라 out/*.css + index.css를 만들어요
//
// 절 = 맨 위 주석 하나부터 다음 맨 위 주석 앞까지(글자 그대로 잘라 붙여요 – 한 글자도 안 바뀌어요).
// 파일 안 순서는 원래 줄 순서 그대로, 파일끼리는 ORDER 순서로 불러와요. "late"는 맨 끝(꼭 뒤에 와야 하는 덮어쓰기만).
// 보낼 곳: 그 절 규칙의 이름표(class)를 어느 화면 파일(.tsx)이 가장 많이 쓰는지. 세 화면 넘게 고루 쓰면 base,
// 창·묻는 띠·메뉴·엑셀 창 이름표는 dialogs, 이름표가 없는 절은 바로 앞 절을 따라가요.
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const postcss = require("postcss");

export const ORDER = ["base", "dialogs", "settings", "contacts", "journal", "complaints", "tasks", "calendar", "process", "files", "budget", "bstatus", "late"];
const FILEMAP = {
  ComplaintsScreen: "complaints", ContactsScreen: "contacts",
  JournalScreen: "journal", JournalPrint: "journal", RichMemo: "journal",
  TasksScreen: "tasks", CalendarScreen: "calendar",
  FilesScreen: "files", FilesDialogs: "files", FileIcon: "files",
  ProcessScreen: "process",
  BudgetScreen: "budget", BudgetShareCard: "budget", BudgetGot: "budget", BudgetSuggest: "budget",
  BudgetStatusScreen: "bstatus", BudgetStatusSend: "bstatus",
  SettingsScreen: "settings",
  AskBand: "dialogs", CloseAsk: "dialogs", DialogX: "dialogs", PopMenu: "dialogs", ExcelMenu: "dialogs",
};
const DIALOG_RE = /^(dialog|overlay|ask-band|dlg-x|close-ask|xl-|dmenu|popmenu|pmenu|mgr|del-hit|del-mark|del-glyph)/;

export function sectionsOf(css) {
  const root = postcss.parse(css);
  const cuts = [];
  for (const n of root.nodes) if (n.type === "comment") cuts.push({ at: n.source.start.offset, line: n.source.start.line, title: n.text.split("\n")[0].replace(/^-+\s*|\s*-+$/g, "").trim().slice(0, 60) });
  if (!cuts.length || cuts[0].at > 0) cuts.unshift({ at: 0, line: 1, title: "(맨 앞)" });
  return cuts.map((c, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1].at : css.length;
    return { ...c, key: `${c.line} ${c.title}`, text: css.slice(c.at, end) };
  });
}

function classify(cssPath, mapPath) {
  const srcDir = path.dirname(cssPath);
  const files = fs.readdirSync(srcDir).filter(f => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"));
  const src = Object.fromEntries(files.map(f => [f.replace(/\.tsx?$/, ""), fs.readFileSync(path.join(srcDir, f), "utf8")]));
  const memo = new Map();
  const owner = cls => {
    if (memo.has(cls)) return memo.get(cls);
    let res = null;
    if (DIALOG_RE.test(cls)) res = "dialogs";
    else {
      const re = new RegExp(`(^|[^\\w-])${cls.replace(/-/g, "\\-")}(?![\\w-])`, "g");
      const cnt = {};
      for (const [n, s] of Object.entries(src)) { const k = (s.match(re) || []).length; if (k) { const d = FILEMAP[n] ?? "base"; cnt[d] = (cnt[d] || 0) + k; } }
      const tot = Object.values(cnt).reduce((a, b) => a + b, 0);
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      if (top) res = Object.keys(cnt).length >= 3 && top[1] / tot < 0.6 ? "base" : top[0];
    }
    memo.set(cls, res);
    return res;
  };
  const css = fs.readFileSync(cssPath, "utf8");
  const map = {};
  let prev = "base";
  for (const s of sectionsOf(css)) {
    const votes = {};
    postcss.parse(s.text).walkRules(r => {
      for (const m of r.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) { const o = owner(m[1]); if (o) votes[o] = (votes[o] || 0) + 1; }
    });
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    prev = top ? top[0] : prev;
    map[s.key] = prev;
  }
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 1) + "\n");
  console.log(`${Object.keys(map).length}절 → ${mapPath}`);
}

const HEAD = {
  base: "공통 – 전역·사이드바·잠금·단추·입력칸·배지·머릿기호 등 여러 화면이 함께 쓰는 모양",
  dialogs: "창·묻는 띠·떠 있는 메뉴·엑셀 창·지우기 휴지통·창 닫기 ×",
  settings: "설정", contacts: "업무연락처(사업 관리 창 포함)", journal: "업무일지(메모 편집기·인쇄 포함)",
  complaints: "민원대장", tasks: "할 일", calendar: "캘린더(구글 연동 상자 포함)", process: "민원처리",
  files: "탐색기", budget: "집행현황(팀 공유 포함)", bstatus: "예산현황",
  late: "꼭 뒤에 와야 하는 덮어쓰기 – 다른 파일 규칙을 같은 무게로 덮는 것만(원래 app.css에서 뒤에 있던 순서 그대로)",
};

function split(cssPath, mapPath, outDir) {
  const css = fs.readFileSync(cssPath, "utf8");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const parts = Object.fromEntries(ORDER.map(k => [k, []]));
  for (const s of sectionsOf(css)) {
    const d = map[s.key];
    // 값이 {"to": 파일, "cuts": [["줄 첫 글자", 파일], ...]}이면 절 중간에서 잘라 뒷부분을 다른 파일로 보내요.
    const to = typeof d === "string" ? d : d?.to;
    if (!to || !parts[to]) throw new Error(`map에 없는 절: ${s.key}`);
    let rest = s.text, dest = to;
    for (const [mark, next] of (typeof d === "object" ? d.cuts : [])) {
      const i = rest.indexOf("\n" + mark);
      if (i < 0 || !parts[next]) throw new Error(`자를 곳 없음: ${s.key} / ${mark}`);
      parts[dest].push(rest.slice(0, i + 1));
      rest = rest.slice(i + 1);
      dest = next;
    }
    parts[dest].push(rest);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const used = ORDER.filter(k => parts[k].length);
  for (const k of used) {
    let body = parts[k].join("");
    if (!body.endsWith("\n")) body += "\n";
    fs.writeFileSync(path.join(outDir, `${k}.css`), `/* ===== ${k}.css – ${HEAD[k]} (원래 app.css 순서 그대로, 정리 2차 2026-10-26) ===== */\n\n${body}`);
  }
  fs.writeFileSync(path.join(outDir, "index.css"),
    "/* 모양 파일을 이 순서로 불러와요 – 순서가 바뀌면 모양이 바뀌어요(계단식 우선순위). 새 규칙은 그 화면 파일 끝에. */\n" +
    used.map(k => `@import "./${k}.css";`).join("\n") + "\n");
  console.log(used.map(k => `${k} ${parts[k].length}`).join(" · "));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "classify") classify(...args);
else if (cmd === "split") split(...args);
