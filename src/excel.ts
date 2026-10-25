// 엑셀(.xlsx) 가져오기·내보내기의 칸 맞추기 규칙이에요(2026-10-17 사용자, docs/excel/README.md 양식).
// 파일을 쓰고 읽는 것은 Rust(core/src/excel.rs)가 하고, 여기서는 앱 자료 ↔ 엑셀 칸 글자를 바꿔요.
// - 여러 줄 칸(내용·조치내용·메모)은 복사 규칙과 같게 □ ○ - 글자와 띄어쓰기(위계 두 칸씩)로 써요.
//   가져올 때는 거꾸로 기호를 알아보고, 빈 줄(묶음 나누기)은 남겨요.
// - 가져오기는 판단하지 않아요: 중복 검사·값 고치기 없이 모든 줄(모든 칸이 빈 줄만 빼고)을 넣어요.
//   다만 날짜 칸은 앱이 읽을 수 있으면 2026-10-15 모양으로 맞춰요(마감 계산이 되게). 읽을 수 없으면 그대로예요.
import { spacePlace } from "./paju";
import type { Complaint, ComplaintInput, Contact, ContactInput, DayInfo, Entry, EntryInput, JournalLine, Project, ProjectGroup } from "./api";
import { splitProjects } from "./projectNames";
import { BKind, BLine, layout, linePrefix, parseLines, stringifyLines } from "./bullets";
import { isMemo, normTime, parseDate, whoNames } from "./journal";

export type SheetKind = "complaints" | "contacts" | "journal";

export const SHEET_TITLE: Record<SheetKind, string> = { complaints: "민원대장", contacts: "업무연락처", journal: "업무일지" };

/** 양식의 열 순서(3행 제목) */
/** 13열(2026-10-21 사용자 ⑧ – 민원인·연락처를 "민원인" 한 칸으로) */
export const COMPLAINT_HEADERS = ["연번", "접수유형", "접수일", "민원유형", "지역", "위치", "민원인", "내용", "조치내용", "마감일", "상태", "조치완료일", "메모"];
export const CONTACT_HEADERS = ["연번", "이름", "소속", "직위", "무선", "유선", "이메일", "프로젝트", "메모", "그룹", "축약 공사명", "색"];

export type ExcelExport = { rows: string[][]; intake: string[]; status: string[]; days?: string[][] };
export type ExcelSheet = { headers: string[]; rows: string[][]; extra?: ExcelSheet[] };
export type ComplaintImport = ComplaintInput & { memo: string };
export type ContactImport = ContactInput & { memo: string };

// ---------- 여러 줄 칸 ----------

/** 앱의 줄 목록 → 엑셀 칸 글자(복사 규칙 그대로: "□ 가", "  ○ 나", "    - 다", 빈 줄은 빈 줄) */
export function cellOfLines(raw: string): string {
  const ls = parseLines(raw);
  const lv = layout(ls);
  const out = ls.map((l, i) => (l.t.trim() ? linePrefix(l, lv[i]) + l.t : ""));
  while (out.length && !out[out.length - 1]) out.pop();
  while (out.length && !out[0]) out.shift();
  return out.join("\n");
}

const SYM = /^([ \t　]*)([□■◻▪○◦●•·∙\-–ㆍ])\s+(.*)$/;

/**
 * 엑셀 칸 글자 → 앱의 줄 목록(저장 글자). □ → □, ○·●·• 등 → ●(기본), - → 작대기.
 * 기호가 하나라도 있는 칸에서 기호 없는 줄은 기호를 지운 줄(none, 앞 띄어쓰기 두 칸이 한 단계)이에요.
 * 기호가 하나도 없는 칸(손으로 적은 엑셀)은 줄마다 기본 ●예요(예전 글자만 있는 기록과 같게).
 */
export function linesOfCell(text: string): string {
  const raw = text.replace(/\r\n?/g, "\n").split("\n");
  const any = raw.some((r) => SYM.test(r));
  const ls: BLine[] = raw.map((r) => {
    if (!r.trim()) return { t: "" };
    const m = SYM.exec(r);
    if (m) {
      const s = m[2];
      const k: BKind = "□■◻▪".includes(s) ? "sq" : "-–".includes(s) ? "da" : "ci";
      return k === "ci" ? { t: m[3].trim() } : { t: m[3].trim(), k };
    }
    if (!any) return { t: r.trim() };
    const sp = /^[ \t　]*/.exec(r)![0].replace(/\t/g, "  ").length;
    return { t: r.trim(), k: "none", lv: Math.min(2, Math.floor(sp / 2)) };
  });
  return stringifyLines(ls);
}

// ---------- 민원대장 ----------

export function complaintRows(list: Complaint[]): string[][] {
  return [...list]
    .sort((a, b) => a.no - b.no || a.id - b.id)
    .map((c) => [
      String(c.no), c.intake, c.received, c.ctype, c.area, c.place, [c.person, c.phone].filter(Boolean).join(" "),
      cellOfLines(c.body), cellOfLines(c.action), c.due, c.status, c.done ?? "", cellOfLines(c.memo),
    ]);
}

/** 3행 제목 이름으로 열을 찾아요(띄어쓰기는 무시). 없는 열은 빈 글자예요. */
function picker(headers: string[]) {
  const idx = new Map<string, number>();
  headers.forEach((h, i) => {
    const k = h.replace(/\s+/g, "");
    if (k && !idx.has(k)) idx.set(k, i);
  });
  return (row: string[], name: string) => {
    const i = idx.get(name);
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
}

const dateOf = (v: string) => (v ? parseDate(v) ?? v : "");

/**
 * 넣을 줄: 연번 말고 모든 칸이 빈 줄은 건너뛰어요(연번은 앱이 매기고 읽지 않아요 –
 * 양식에 연번만 미리 적어 둔 빈 줄이 민원·연락처로 들어가지 않게).
 */
function dataRows(sheet: ExcelSheet): string[][] {
  const skip = sheet.headers.map((h) => h.replace(/\s+/g, "") === "연번");
  return sheet.rows.filter((r) => r.some((v, i) => !skip[i] && (v ?? "").trim()));
}

export function complaintImports(sheet: ExcelSheet): ComplaintImport[] {
  const get = picker(sheet.headers);
  return dataRows(sheet).map((r) => ({
    intake: get(r, "접수유형"),
    received: dateOf(get(r, "접수일")),
    ctype: get(r, "민원유형"),
    area: get(r, "지역"),
    place: spacePlace(get(r, "위치")),
    // 민원인 한 칸 – 예전 두 열(민원인·연락처) 엑셀도 합쳐 읽어요.
    person: [get(r, "민원인"), get(r, "연락처")].filter(Boolean).join(" "),
    phone: "",
    body: linesOfCell(get(r, "내용")),
    action: linesOfCell(get(r, "조치내용")),
    due: dateOf(get(r, "마감일")),
    status: get(r, "상태"),
    done: dateOf(get(r, "조치완료일")),
    memo: linesOfCell(get(r, "메모")),
  }));
}

// ---------- 업무연락처 (양식: 2026-10-19 사용자 파일) ----------
// 한 시트 "업무연락처" A~L. J 그룹·K 축약 공사명·L 색(1~8, 비우면 자동)은 숨긴 열로 그 줄 프로젝트의 정보예요.
// 한 사람 = 한 줄(2026-10-19 사용자: 사람이 중심이라 프로젝트 수만큼 같은 사람이 있으면 안 돼요). 프로젝트가 여러 개면
// 프로젝트 칸에 "쉼표 + 줄바꿈"으로 한 줄에 하나씩, 숨긴 그룹·축약·색도 같은 줄 순서로 적어요(사용자). 행 높이는 프로젝트 줄 수만큼.
// 연락처가 없는 프로젝트는 맨 아래에 이름 칸이 빈 "프로젝트만 있는 줄"로 적어요(사용자 1안, 가져오면 프로젝트만 생겨요).

export type ProjectImport = { group: string; name: string; alias: string; color: number | null };
export type ContactsImport = { contacts: ContactImport[]; projects: ProjectImport[] };

function projectCells(p: Project | undefined, gname: Map<number, string>): string[] {
  if (!p) return ["", "", ""];
  return [p.group !== null ? gname.get(p.group) ?? "" : "", p.alias && p.alias !== p.name ? p.alias : "", p.color !== null ? String(p.color + 1) : ""];
}

/**
 * 가져올 때 같은 사람(2026-10-19 사용자 1안): 이름이 있고 이름·소속이 같고 무선 번호 숫자가 같은 사람 –
 * 새로 만들지 않고 없는 프로젝트만 붙여요(core `same_person`과 같은 규칙).
 */
export function samePerson(a: { name: string; org: string; mobile: string }, b: { name: string; org: string; mobile: string }): boolean {
  const d = (s: string) => (s ?? "").replace(/\D/g, "");
  const name = (a.name ?? "").trim();
  return !!name && name === (b.name ?? "").trim() && (a.org ?? "").trim() === (b.org ?? "").trim() && d(a.mobile) === d(b.mobile);
}

/** 프로젝트 여러 개를 한 칸에: "가,\n나,\n다"(쉼표 + 줄바꿈) */
export const joinLines = (xs: string[]) => xs.join(",\n");

/** joinLines의 거꾸로 – 줄로 나누고 줄 끝 쉼표를 떼요(빈 줄도 자리로 남겨요). */
export function splitLines(v: string): string[] {
  return v.split(/\r?\n/).map((x) => x.trim().replace(/,$/, "").trim());
}

/** 등록한 순서대로, 연번은 사람마다 1부터(앱에는 연번이 없어요). 맨 아래 프로젝트만 있는 줄은 그룹 순서 → 공사명 가나다순. */
export function contactRows(list: Contact[], projects: Project[], groups: ProjectGroup[] = []): string[][] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const gname = new Map(groups.map((g) => [g.id, g.name]));
  const order = new Map(groups.map((g, i) => [g.id, i]));
  const rank = (p: Project) => (p.group !== null && order.has(p.group) ? order.get(p.group)! : groups.length);
  const cmp = (a: Project, b: Project) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ko");
  const rows: string[][] = [];
  const used = new Set<number>();
  [...list]
    .sort((a, b) => a.id - b.id)
    .forEach((c, i) => {
      const base = [String(i + 1), c.name, c.org, c.role, c.mobile, c.tel, c.email];
      const memo = cellOfLines(c.memo);
      // 사람의 프로젝트는 붙인 순서 그대로(첫 프로젝트가 업무일지에 저절로 붙는 프로젝트라 가져와도 같아야 해요).
      const ps = c.projects.map((id) => byId.get(id)).filter((p): p is Project => !!p);
      ps.forEach((p) => used.add(p.id));
      const cells = ps.map((p) => projectCells(p, gname));
      const col = (k: number) => (cells.some((x) => x[k]) ? joinLines(cells.map((x) => x[k])) : "");
      rows.push([...base, joinLines(ps.map((p) => p.name)), memo, col(0), col(1), col(2)]);
    });
  for (const p of [...projects].sort(cmp)) {
    if (!used.has(p.id)) rows.push(["", "", "", "", "", "", "", p.name, "", ...projectCells(p, gname)]);
  }
  return rows;
}

/**
 * 연번은 같은 사람 줄을 묶을 때만 봐요(앱에는 연번이 없어요). 같은 사람 = 연번과 이름이 같은 줄(떨어져 있어도 –
 * 엑셀에서 프로젝트로 정렬해도 돼요), 연번이 비었으면 이름~메모가 모두 같은 줄. 묶인 사람의 소속·번호·메모 등은
 * 처음 나온 줄 것을 쓰고, 그 칸이 비어 있으면 다음 줄 것으로 채워요.
 * 이름~메모가 모두 빈 줄은 프로젝트만 만들어요. 프로젝트 칸은 줄바꿈(쉼표 + 줄바꿈)으로 여러 개, 예전 파일처럼 쉼표만이어도 돼요.
 */
export function contactImports(sheet: ExcelSheet): ContactsImport {
  const get = picker(sheet.headers);
  const contacts: ContactImport[] = [];
  const byKey = new Map<string, ContactImport>();
  const metas = new Map<string, ProjectImport>();
  for (const r of dataRows(sheet)) {
    const c: ContactImport = {
      name: get(r, "이름"),
      org: get(r, "소속"),
      role: get(r, "직위"),
      mobile: get(r, "무선"),
      tel: get(r, "유선"),
      email: get(r, "이메일").replace(/^mailto:/i, ""),
      projects: [],
      memo: linesOfCell(get(r, "메모")),
    };
    const pcell = get(r, "프로젝트");
    const multi = /\n/.test(pcell);
    const plines = multi ? splitLines(pcell) : splitProjects(pcell);
    c.projects = plines.filter(Boolean);
    const no = get(r, "연번");
    // 숨긴 열: 줄바꿈으로 적은 칸은 프로젝트와 같은 줄 순서로, 프로젝트가 한 개면 칸 전체로 읽어요.
    // (쉼표만으로 여러 개 적은 예전 칸은 어느 것의 정보인지 몰라 읽지 않아요.) 같은 프로젝트는 처음 줄 것.
    const hidden = (h: string) => (multi ? splitLines(get(r, h)) : plines.length === 1 ? [splitLines(get(r, h))[0] ?? ""] : []);
    const hg = hidden("그룹"), ha = hidden("축약공사명"), hc = hidden("색");
    plines.forEach((name, i) => {
      if (!name || metas.has(name) || (!multi && plines.length !== 1)) return;
      const n = Number(hc[i] ?? "");
      const alias = ha[i] ?? "";
      metas.set(name, { group: hg[i] ?? "", name, alias: alias !== name ? alias : "", color: Number.isInteger(n) && n >= 1 && n <= 8 ? n - 1 : null });
    });
    const blank = !c.name && !c.org && !c.role && !c.mobile && !c.tel && !c.email && !c.memo;
    for (const p of c.projects) if (!metas.has(p)) metas.set(p, { group: "", name: p, alias: "", color: null });
    if (blank) continue;
    const key = no ? JSON.stringify(["no", no, c.name]) : JSON.stringify([c.name, c.org, c.role, c.mobile, c.tel, c.email, c.memo]);
    const had = byKey.get(key);
    if (!had) {
      byKey.set(key, c);
      contacts.push(c);
      continue;
    }
    for (const p of c.projects) if (!had.projects.includes(p)) had.projects.push(p);
    for (const k of ["org", "role", "mobile", "tel", "email", "memo"] as const) if (!had[k] && c[k]) had[k] = c[k];
  }
  return { contacts, projects: [...metas.values()] };
}

// ---------- 업무일지 (2026-10-19 사용자 1안·1안) ----------
// 기록 한 건 = 한 줄(연번·날짜·시각·구분·상대·연락처·프로젝트·내용), 둘째 시트 "날짜별"에 출근·교통·날씨·비고.
// 내용 칸: 말 줄은 "나: …" / "이○○: …" 한 줄씩(한 말 안 줄 바꿈은 그 아래 줄에 이어서), 메모는 본문 글자(서식·표 모양은 빠져요).
// 가져오기: 날짜·시각·구분·상대·내용이 모두 같은 기록이 이미 있으면 건너뛰어요(같은 파일 안에서 겹친 줄도 한 번만).

export const JOURNAL_HEADERS = ["연번", "날짜", "시각", "구분", "상대", "연락처", "프로젝트", "내용"];
export const JOURNAL_DAY_HEADERS = ["날짜", "출근", "교통", "날씨", "비고"];

/** 메모 본문(편집기 HTML) → 글자. 문단·제목·인용은 한 줄씩, 글머리 목록은 □ ○ - 기호와 위계 띄어쓰기, 표는 칸을 " | "로 이어요. */
export function memoText(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const txt = (el: Element) => {
    const c = el.cloneNode(true) as Element;
    c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    return (c.textContent ?? "").replace(/[ \t\u00a0]+/g, " ").trim();
  };
  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        Array.from(el.children).forEach((li, i) => {
          const cl = li.classList;
          const lv = cl.contains("lv2") ? 2 : cl.contains("lv1") ? 1 : 0;
          const mark = tag === "ol" ? `${i + 1}. ` : cl.contains("nb") ? "" : cl.contains("k-sq") ? "□ " : cl.contains("k-da") ? "- " : "○ ";
          out.push("  ".repeat(lv) + mark + txt(li));
        });
      } else if (tag === "table") {
        el.querySelectorAll("tr").forEach((tr) => out.push(Array.from(tr.children).map((td) => txt(td)).join(" | ")));
      } else if (tag === "div" && el.querySelector("p,ul,ol,table,h3,blockquote")) {
        walk(el);
      } else {
        const t = txt(el);
        if (t) out.push(t);
      }
    }
  };
  walk(doc.body);
  return out.join("\n").trim();
}

/** 기록 → 내용 칸 글자 */
export function entryContent(e: Pick<EntryInput, "kind" | "lines" | "body">): string {
  if (isMemo(e.kind) || (!e.lines.length && e.body)) return memoText(e.body);
  return e.lines.map((l) => `${l.me ? "나" : l.who || "상대"}: ${l.text}`).join("\n");
}

const keyOf = (date: string, time: string, kind: string, who: string, content: string) =>
  [date, time, kind.trim(), who.trim(), content.replace(/\r\n?/g, "\n").split("\n").map((x) => x.trim()).join("\n").trim()].join("\u0001");

export function journalRows(entries: Entry[], projects: Project[]): string[][] {
  const byId = new Map(projects.map((p) => [p.id, p.name]));
  return [...entries]
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.time !== b.time ? (a.time < b.time ? -1 : 1) : a.id - b.id))
    .map((e, i) => [String(i + 1), e.date, e.time, e.kind, e.who, e.contact, e.project !== null ? byId.get(e.project) ?? "" : "", entryContent(e)]);
}

export function journalDayRows(days: DayInfo[]): string[][] {
  return [...days]
    .filter((d) => d.arrive || d.transport || d.weather || d.note)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => [d.date, d.arrive, d.transport, d.weather, d.note]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 내용 칸 → 말 줄. 줄 앞 "이름: "의 이름이 나·상대 칸의 이름·앞에 나온 말한 사람이면 새 말, 아니면 앞 말에 이어 붙여요(한 말 안 줄 바꿈). */
export function linesOfContent(text: string, who: string, myName: string): JournalLine[] {
  const known = new Set(["나", "상대", ...whoNames(who), ...(myName ? [myName] : [])]);
  const out: JournalLine[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:：]{1,20})[:：]\s*(.*)$/.exec(line);
    const sp = m?.[1].trim();
    if (m && sp && (known.has(sp) || !out.length)) {
      known.add(sp);
      const me = sp === "나" || (!!myName && sp === myName);
      out.push({ who: me ? "" : sp, me, text: m[2] });
    } else if (out.length) {
      out[out.length - 1].text += "\n" + line;
    } else {
      out.push({ who: whoNames(who)[0] ?? "", me: false, text: line });
    }
  }
  return out.filter((l) => l.text.trim());
}

export type JournalImport = { entries: EntryInput[]; days: DayInfo[]; dup: number; bad: number };

/**
 * 읽은 시트 → 넣을 기록. 날짜·시각을 읽지 못한 줄(bad)과 이미 있는 기록·파일 안에서 겹친 줄(dup)은 빼요.
 * 프로젝트는 정식 이름·줄인 이름으로 찾고, 없으면 비워요.
 */
export function journalImports(sheet: ExcelSheet, existing: Entry[], projects: Project[], myName: string): JournalImport {
  const get = picker(sheet.headers);
  const seen = new Set(existing.map((e) => keyOf(e.date, e.time, e.kind, e.who, entryContent(e))));
  const entries: EntryInput[] = [];
  let dup = 0;
  let bad = 0;
  for (const r of dataRows(sheet)) {
    const date = parseDate(get(r, "날짜"));
    const time = normTime(get(r, "시각"));
    const content = (() => {
      const i = sheet.headers.findIndex((h) => h.replace(/\s+/g, "") === "내용");
      return i < 0 ? "" : (r[i] ?? "").replace(/\r\n?/g, "\n").trim();
    })();
    if (!date || !time || !content) {
      bad++;
      continue;
    }
    const kind = get(r, "구분") || "메모";
    const who = get(r, "상대");
    const key = keyOf(date, time, kind, who, content);
    if (seen.has(key)) {
      dup++;
      continue;
    }
    seen.add(key);
    const pn = get(r, "프로젝트");
    const p = pn ? projects.find((x) => x.name === pn || (x.alias ?? "") === pn) : undefined;
    const memo = isMemo(kind);
    entries.push({
      date,
      time,
      kind,
      who: memo ? "" : who,
      contact: memo ? "" : get(r, "연락처"),
      project: memo ? null : p?.id ?? null,
      lines: memo ? [] : linesOfContent(content, who, myName),
      body: memo ? content.split("\n").filter((x) => x.trim()).map((x) => `<p>${esc(x.trim())}</p>`).join("") : "",
    });
  }
  const days: DayInfo[] = [];
  const ds = sheet.extra?.[0];
  if (ds) {
    const g = picker(ds.headers);
    for (const r of ds.rows) {
      const date = parseDate(g(r, "날짜"));
      if (!date) continue;
      const d = { date, arrive: normTime(g(r, "출근")) ?? g(r, "출근"), transport: g(r, "교통"), weather: g(r, "날씨"), note: g(r, "비고") };
      if (d.arrive || d.transport || d.weather || d.note) days.push(d);
    }
  }
  return { entries, days, dup, bad };
}

/** 기본 파일 이름: 민원대장_2026-10-17.xlsx */
export const defaultName = (kind: SheetKind, today: string) => `${SHEET_TITLE[kind]}_${today}.xlsx`;
