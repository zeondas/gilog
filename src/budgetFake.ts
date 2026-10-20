// 브라우저 미리 보기용 집행현황 흉내예요. 저장 쪽(core/budget.rs)과 같은 규칙을 따라요.
// 미리 보기에서 보기 자료를 넣을 때는 window.__budgetFake.import(해, 세부사업들)을 불러요(앱에서는 없어요).
import type { BudgetItem, BudgetLevel, BudgetProject, BudgetRow, BudgetRowInput } from "./budget";
import { KINDS, STAGES } from "./budget";
import type { ImportProject } from "./budgetExcel";
import type { ShareOp } from "./budgetShare";

// uid는 core처럼 넣을 때 정해져요(흉내는 "f"+번호, 팀 공유로 받은 줄은 받은 uid).
type P = Omit<BudgetProject, "items" | "uid" | "owner"> & { ord: number; uid?: string; owner?: number | null };
type I = Omit<BudgetItem, "rows" | "uid"> & { project: number; ord: number; uid?: string };
type R = Omit<BudgetRow, "uid"> & { item: number; ord: number; uid?: string };
const uidOf = (x: { id: number; uid?: string }) => x.uid ?? "f" + x.id;

const db = { p: [] as P[], i: [] as I[], r: [] as R[], id: 1 };

const one = (s: string) => s.replace(/\s+/g, " ").trim();
function nameOf(s: string) {
  const n = one(s);
  if (!n) throw "invalid";
  return n;
}
const won = (v: number | null) => {
  if (v != null && v % 10 !== 0) throw "invalid";
  return v;
};
function cleanRow(r: BudgetRowInput): BudgetRowInput {
  const kind = r.kind?.trim() || "공사";
  const stage = r.stage?.trim() || "준비";
  if (!(KINDS as readonly string[]).includes(kind) || !(STAGES as readonly string[]).includes(stage)) throw "invalid";
  return { name: nameOf(r.name), kind, co: one(r.co ?? ""), cmt: won(r.cmt) ?? 0, exp: won(r.exp) ?? 0, act: won(r.act) ?? 0, stage };
}

const byOrd = <T extends { ord: number; id: number }>(a: T[]) => [...a].sort((x, y) => x.ord - y.ord || x.id - y.id);

function year(y: number): BudgetProject[] {
  const ps = db.p.filter((p) => p.year === y).sort((a, b) => Number(a.carry) - Number(b.carry) || a.ord - b.ord || a.id - b.id);
  return structuredClone(
    ps.map(({ ord: _o, ...p }) => ({
      ...p,
      uid: uidOf(p),
      owner: p.owner ?? null,
      items: byOrd(db.i.filter((i) => i.project === p.id)).map(({ project: _p, ord: _o2, ...i }) => ({
        ...i,
        uid: uidOf(i),
        rows: byOrd(db.r.filter((r) => r.item === i.id)).map(({ item: _i, ord: _o3, ...r }) => ({ ...r, uid: uidOf(r) })),
      })),
    })),
  );
}

const proj = (id: number) => db.p.find((p) => p.id === id) ?? (() => { throw "not_found"; })();
const item = (id: number) => db.i.find((p) => p.id === id) ?? (() => { throw "not_found"; })();
const row = (id: number) => db.r.find((p) => p.id === id) ?? (() => { throw "not_found"; })();
function yearOf(level: BudgetLevel, id: number): number {
  if (level === "project") return proj(id).year;
  if (level === "item") return proj(item(id).project).year;
  return proj(item(row(id).item).project).year;
}
const renumber = <T extends { ord: number }>(list: T[]) => list.forEach((x, i) => (x.ord = i));

/** 저장 쪽 import_budget과 같아요 — 같은 이름은 덮어쓰고 없는 것만 더해요. [덮어쓰기, 새로 더하기] */
function importYear(y: number, list: ImportProject[]): [number, number] {
  let ord = Math.max(-1, ...db.p.filter((p) => p.year === y).map((p) => p.ord)) + 1;
  let upd = 0;
  let add = 0;
  const usedP = new Set<number>();
  for (const p of list) {
    const name = nameOf(p.name);
    const op = db.p.find((x) => x.year === y && x.name === name && !usedP.has(x.id));
    let pid: number;
    if (op) {
      usedP.add(op.id);
      if (p.budget != null) op.budget = won(p.budget);
      op.carry = op.carry || p.carry;
      if (p.memo.trim()) op.memo = p.memo.trim();
      pid = op.id;
    } else {
      pid = db.id++;
      usedP.add(pid); // 이번 파일에서 새로 넣은 것은 다시 맞추지 않아요(저장 쪽은 가져오기 전 자료만 봐요)
      db.p.push({ id: pid, year: y, ord: ord++, name, budget: won(p.budget), carry: p.carry, open: true, memo: p.memo.trim() });
    }
    const usedI = new Set<number>();
    for (const it of p.items) {
      const iname = nameOf(it.name);
      const oi = byOrd(db.i.filter((x) => x.project === pid)).find((x) => x.name === iname && !usedI.has(x.id));
      let iid: number;
      if (oi) {
        usedI.add(oi.id);
        if (it.budget != null) oi.budget = won(it.budget);
        if (it.memo.trim()) oi.memo = it.memo.trim();
        iid = oi.id;
      } else {
        iid = db.id++;
        usedI.add(iid);
        db.i.push({ id: iid, project: pid, ord: Math.max(-1, ...db.i.filter((x) => x.project === pid).map((x) => x.ord)) + 1, name: iname, budget: won(it.budget), open: false, memo: it.memo.trim() });
      }
      const usedR = new Set<number>();
      for (const r of it.rows) {
        const c = cleanRow(r);
        const or = byOrd(db.r.filter((x) => x.item === iid)).find((x) => x.name === c.name && !usedR.has(x.id));
        if (or) {
          usedR.add(or.id);
          Object.assign(or, c);
          if (r.memo.trim()) or.memo = r.memo.trim();
          upd++;
        } else {
          usedR.add(db.id);
          db.r.push({ id: db.id++, item: iid, ord: Math.max(-1, ...db.r.filter((x) => x.item === iid).map((x) => x.ord)) + 1, ...c, memo: r.memo.trim() });
          add++;
        }
      }
    }
  }
  return [upd, add];
}

if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
  (window as unknown as { __budgetFake: unknown }).__budgetFake = { import: importYear, db };
}

export function fakeBudget(cmd: string, a: Record<string, unknown>): unknown {
  const n = (k: string) => a[k] as number;
  switch (cmd) {
    case "budget_data":
      return year(n("year"));
    case "save_budget_project": {
      const name = nameOf(a.name as string), budget = won(a.budget as number | null);
      if (a.id != null) {
        Object.assign(proj(n("id")), { name, budget });
        return year(proj(n("id")).year);
      }
      const y = n("year");
      const list = db.p.filter((p) => p.year === y).sort((x, z) => Number(x.carry) - Number(z.carry) || x.ord - z.ord);
      const np: P = { id: db.id++, year: y, ord: 0, name, budget, carry: false, open: true, memo: "" };
      db.p.push(np);
      const at = a.after != null ? list.findIndex((p) => p.id === a.after) + 1 : 0;
      list.splice(Math.max(0, at), 0, np);
      renumber(list);
      return year(y);
    }
    case "save_budget_item": {
      const name = nameOf(a.name as string), budget = won(a.budget as number | null);
      if (a.id != null) {
        Object.assign(item(n("id")), { name, budget });
        return year(yearOf("item", n("id")));
      }
      const p = proj(n("project"));
      const list = byOrd(db.i.filter((i) => i.project === p.id));
      const ni: I = { id: db.id++, project: p.id, ord: 0, name, budget, open: true, memo: "" };
      db.i.push(ni);
      renumber([ni, ...list]);
      p.open = true;
      return year(p.year);
    }
    case "save_budget_row": {
      const r = cleanRow(a.row as BudgetRowInput);
      let id = a.id as number | null;
      if (id != null) Object.assign(row(id), r);
      else {
        const it = item(n("item"));
        id = db.id++;
        db.r.push({ id, item: it.id, ord: Math.max(-1, ...db.r.filter((x) => x.item === it.id).map((x) => x.ord)) + 1, ...r, memo: "" });
        it.open = true;
        proj(it.project).open = true;
      }
      return [year(yearOf("row", id)), id];
    }
    case "set_budget_stage":
      if (!(STAGES as readonly string[]).includes(a.stage as string)) throw "invalid";
      row(n("id")).stage = a.stage as string;
      return year(yearOf("row", n("id")));
    case "set_budget_memo": {
      const l = a.level as BudgetLevel, o = l === "project" ? proj(n("id")) : l === "item" ? item(n("id")) : row(n("id"));
      o.memo = (a.memo as string).trim();
      return year(yearOf(l, n("id")));
    }
    case "set_budget_open": {
      const l = a.level as BudgetLevel;
      if (l === "project" && a.all) {
        db.i.filter((i) => i.project === n("id")).forEach((i) => (i.open = a.open as boolean));
        proj(n("id")).open = true;
      } else if (l === "project") proj(n("id")).open = a.open as boolean;
      else item(n("id")).open = a.open as boolean;
      return year(yearOf(l, n("id")));
    }
    case "move_budget": {
      const l = a.level as BudgetLevel, id = n("id");
      const list =
        l === "project"
          ? byOrd(db.p.filter((p) => p.year === proj(id).year && p.carry === proj(id).carry))
          : l === "item"
            ? byOrd(db.i.filter((i) => i.project === item(id).project))
            : byOrd(db.r.filter((r) => r.item === row(id).item));
      const i = list.findIndex((x) => x.id === id), j = i + Math.sign(n("dir"));
      if (j >= 0 && j < list.length) {
        [list[i], list[j]] = [list[j], list[i]];
        renumber(list as { ord: number }[]);
      }
      return year(yearOf(l, id));
    }
    case "move_budget_item": {
      const it = item(n("id")), to = proj(n("to"));
      if (db.i.some((x) => x.project === to.id && x.name === it.name && x.id !== it.id)) throw "invalid";
      it.project = to.id;
      it.ord = Math.max(-1, ...db.i.filter((x) => x.project === to.id && x.id !== it.id).map((x) => x.ord)) + 1;
      to.open = true;
      return year(to.year);
    }
    case "move_budget_row": {
      const r = row(n("id")), to = item(n("to"));
      r.item = to.id;
      r.ord = Math.max(-1, ...db.r.filter((x) => x.item === to.id && x.id !== r.id).map((x) => x.ord)) + 1;
      to.open = true;
      proj(to.project).open = true;
      return year(proj(to.project).year);
    }
    case "delete_budget": {
      const l = a.level as BudgetLevel, id = n("id"), y = yearOf(l, id);
      if (l === "project") {
        const items = db.i.filter((i) => i.project === id).map((i) => i.id);
        db.r = db.r.filter((r) => !items.includes(r.item));
        db.i = db.i.filter((i) => i.project !== id);
        db.p = db.p.filter((p) => p.id !== id);
      } else if (l === "item") {
        db.r = db.r.filter((r) => r.item !== id);
        db.i = db.i.filter((i) => i.id !== id);
      } else db.r = db.r.filter((r) => r.id !== id);
      return year(y);
    }
    case "copy_budget_year": {
      const src = year(n("from")).filter((p) => !p.carry);
      if (!src.length || year(n("to")).length) throw "invalid";
      importYear(n("to"), src.map((p) => ({ name: p.name, budget: p.budget, carry: false, memo: "", items: p.items.map((i) => ({ name: i.name, budget: i.budget, memo: "", rows: [] })) })));
      return year(n("to"));
    }
    case "budget_years":
      return [...new Set(db.p.map((p) => p.year))].sort((x, z) => x - z);
    case "set_budget_owner":
      proj(n("id")).owner = (a.owner as number | null) ?? null;
      return year(proj(n("id")).year);
    case "budget_share_clear":
      db.p = [];
      db.i = [];
      db.r = [];
      return null;
    case "budget_share_apply":
      return shareApply(a.ops as ShareOp[]);
    case "import_budget": {
      const [u, c] = importYear(n("year"), a.projects as ImportProject[]);
      return [year(n("year")), u, c];
    }
  }
  return undefined;
}

/** core budget_share_apply와 같아요 – uid로 찾아 넣고·바꾸고·지워요. */
function shareApply(ops: ShareOp[]): number {
  const rank = (l: string) => (l === "project" ? 0 : l === "item" ? 1 : 2);
  const list = [...ops].sort((x, y) => Number(x.del) - Number(y.del) || (x.del ? rank(y.level) - rank(x.level) : rank(x.level) - rank(y.level)));
  let n = 0;
  for (const o of list) {
    const name = one(o.name) || "(이름 없음)";
    if (o.level === "project") {
      const p = db.p.find((x) => uidOf(x) === o.uid);
      if (o.del) {
        if (!p) continue;
        const items = db.i.filter((i) => i.project === p.id).map((i) => i.id);
        db.r = db.r.filter((r) => !items.includes(r.item));
        db.i = db.i.filter((i) => i.project !== p.id);
        db.p = db.p.filter((x) => x !== p);
      } else if (p) Object.assign(p, { year: o.year, ord: o.ord, name, budget: o.budget, carry: o.carry, memo: o.memo.trim(), owner: o.owner });
      else db.p.push({ id: db.id++, uid: o.uid, year: o.year, ord: o.ord, name, budget: o.budget, carry: o.carry, open: true, memo: o.memo.trim(), owner: o.owner });
    } else if (o.level === "item") {
      const it = db.i.find((x) => uidOf(x) === o.uid);
      if (o.del) {
        if (!it) continue;
        db.r = db.r.filter((r) => r.item !== it.id);
        db.i = db.i.filter((x) => x !== it);
      } else {
        const p = db.p.find((x) => uidOf(x) === o.parent);
        if (!p) continue;
        if (it) Object.assign(it, { project: p.id, ord: o.ord, name, budget: o.budget, memo: o.memo.trim() });
        else db.i.push({ id: db.id++, uid: o.uid, project: p.id, ord: o.ord, name, budget: o.budget, open: false, memo: o.memo.trim() });
      }
    } else {
      const r = db.r.find((x) => uidOf(x) === o.uid);
      if (o.del) {
        if (!r) continue;
        db.r = db.r.filter((x) => x !== r);
      } else {
        const it = db.i.find((x) => uidOf(x) === o.parent);
        if (!it) continue;
        const kind = (KINDS as readonly string[]).includes(o.kind.trim()) ? o.kind.trim() : "공사";
        const stage = (STAGES as readonly string[]).includes(o.stage.trim()) ? o.stage.trim() : "준비";
        const v = { item: it.id, ord: o.ord, name, kind, co: one(o.co), cmt: o.cmt, exp: o.exp, act: o.act, stage, memo: o.memo.trim() };
        if (r) Object.assign(r, v);
        else db.r.push({ id: db.id++, uid: o.uid, ...v });
      }
    }
    n++;
  }
  return n;
}
