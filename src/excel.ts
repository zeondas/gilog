// 엑셀(.xlsx) 가져오기·내보내기의 칸 맞추기 규칙이에요(2026-10-17 사용자, docs/excel/README.md 양식).
// 파일을 쓰고 읽는 것은 Rust(core/src/excel.rs)가 하고, 여기서는 앱 자료 ↔ 엑셀 칸 글자를 바꿔요.
// - 여러 줄 칸(내용·조치내용·메모)은 복사 규칙과 같게 □ ○ - 글자와 띄어쓰기(위계 두 칸씩)로 써요.
//   가져올 때는 거꾸로 기호를 알아보고, 빈 줄(묶음 나누기)은 남겨요.
// - 가져오기는 판단하지 않아요: 중복 검사·값 고치기 없이 모든 줄(모든 칸이 빈 줄만 빼고)을 넣어요.
//   다만 날짜 칸은 앱이 읽을 수 있으면 2026-10-15 모양으로 맞춰요(마감 계산이 되게). 읽을 수 없으면 그대로예요.
import type { Complaint, ComplaintInput, Contact, ContactInput, Project } from "./api";
import { BKind, BLine, layout, linePrefix, parseLines, stringifyLines } from "./bullets";
import { parseDate } from "./journal";

export type SheetKind = "complaints" | "contacts";

export const SHEET_TITLE: Record<SheetKind, string> = { complaints: "민원대장", contacts: "업무연락처" };

/** 양식의 열 순서(3행 제목) */
export const COMPLAINT_HEADERS = ["연번", "접수유형", "접수일", "민원유형", "지역", "위치", "민원인", "연락처", "내용", "조치내용", "마감일", "상태", "메모"];
export const CONTACT_HEADERS = ["연번", "이름", "소속", "직위", "무선", "유선", "이메일", "프로젝트", "메모"];

export type ExcelExport = { rows: string[][]; intake: string[]; status: string[] };
export type ExcelSheet = { headers: string[]; rows: string[][] };
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
      String(c.no), c.intake, c.received, c.ctype, c.area, c.place, c.person, c.phone,
      cellOfLines(c.body), cellOfLines(c.action), c.due, c.status, cellOfLines(c.memo),
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
 * 넣을 줄: 연번 말고 모든 칸이 빈 줄은 건너뛰어요(연번은 앱이 매기고 읽지 않아요 —
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
    place: get(r, "위치"),
    person: get(r, "민원인"),
    phone: get(r, "연락처"),
    body: linesOfCell(get(r, "내용")),
    action: linesOfCell(get(r, "조치내용")),
    due: dateOf(get(r, "마감일")),
    status: get(r, "상태"),
    memo: linesOfCell(get(r, "메모")),
  }));
}

// ---------- 업무연락처 ----------

/** 등록한 순서대로, 연번은 1부터 매겨요(앱에는 연번이 없어요). */
export function contactRows(list: Contact[], projects: Project[]): string[][] {
  const byId = new Map(projects.map((p) => [p.id, p.name]));
  return [...list]
    .sort((a, b) => a.id - b.id)
    .map((c, i) => [
      String(i + 1), c.name, c.org, c.role, c.mobile, c.tel, c.email,
      c.projects.map((id) => byId.get(id) ?? "").filter(Boolean).join(", "),
      cellOfLines(c.memo),
    ]);
}

/** 연번은 읽지 않아요. 프로젝트는 쉼표로 나눠요(없는 이름은 새로 만들어져요). */
export function contactImports(sheet: ExcelSheet): ContactImport[] {
  const get = picker(sheet.headers);
  return dataRows(sheet).map((r) => ({
    name: get(r, "이름"),
    org: get(r, "소속"),
    role: get(r, "직위"),
    mobile: get(r, "무선"),
    tel: get(r, "유선"),
    email: get(r, "이메일").replace(/^mailto:/i, ""),
    projects: get(r, "프로젝트").split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    memo: linesOfCell(get(r, "메모")),
  }));
}

/** 기본 파일 이름: 민원대장_2026-10-17.xlsx */
export const defaultName = (kind: SheetKind, today: string) => `${SHEET_TITLE[kind]}_${today}.xlsx`;
