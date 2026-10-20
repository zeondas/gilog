import { merge, parseSheet, rowValues, flatten, Rec, SheetRec, FIELDS } from "../../src/budgetShare";
const assert = (c: unknown, m: string) => { if (!c) { console.error("FAIL", m); process.exitCode = 1; } else console.log("ok", m); };
const P = (uid: string, name: string, extra: Record<string, unknown> = {}) => ({ id: 1, year: 2026, name, budget: 1000, carry: false, open: true, memo: "", items: [], uid, owner: null, ...extra });
const local0 = flatten([[P("p1", "도로", { items: [{ id: 2, name: "시도", budget: null, open: true, memo: "", uid: "i1", rows: [{ id: 3, name: "포장", kind: "공사", co: "", cmt: 100, exp: 10, act: 0, stage: "준비", memo: "", uid: "r1" }] }] })]]);
// 시트 = 내 값 그대로 올린 것
const sheet = (m: Map<string, Rec>, edit?: (r: Rec) => void) => {
  const vals = [...m.values()].map((r) => { const c = structuredClone(r); edit?.(c); return rowValues(c, {}); });
  return parseSheet(vals);
};
let base = new Map(local0);
// 1) 아무것도 안 바뀜
let m = merge(local0, sheet(local0), base, [], 1, "t");
assert(!m.toLocal.length && !m.updates.length && !m.appends.length && !m.conflicts.length, "no change");
// 2) 시트만 바뀜 → 받기
let rs = sheet(local0, (r) => { if (r.uid === "r1") r.f.exp = "50"; });
m = merge(local0, rs, base, [], 1, "t");
assert(m.toLocal.length === 1 && m.toLocal[0].f.exp === "50" && m.receivedCells === 1 && !m.updates.length, "receive");
// 3) 나만 바뀜 → 올리기
const l2 = structuredClone(local0); l2.get("r1")!.f.cmt = "200";
m = merge(l2, sheet(local0), base, [], 1, "t");
assert(m.updates.some((u) => u.col === "L" && u.value === 200 && u.row === 4) && m.sentCells === 1 && !m.toLocal.length, "upload cmt col L row 4");
// 4) 같은 칸 다르게 → 고르기, 내 값 그대로
rs = sheet(local0, (r) => { if (r.uid === "r1") r.f.cmt = "300"; });
m = merge(l2, rs, base, [], 1, "t");
assert(m.conflicts.length === 1 && m.conflicts[0].mine === "200" && m.conflicts[0].theirs === "300" && !m.updates.some(u=>u.col==="L"), "conflict");
// 4b) 고르기 전 다시 새로고침 – 여전히 같은 칸, 올리지 않음
const b2 = m.base;
const m2 = merge(l2, rs, b2, m.conflicts, 1, "t");
assert(m2.conflicts.length === 1 && !m2.updates.some(u=>u.col==="L"), "conflict kept");
// 4c) 내 값으로 고름(pending 지움) → 올림
const m3 = merge(l2, rs, b2, [], 1, "t");
assert(m3.updates.some((u) => u.col === "L" && u.value === 200), "keep mine uploads");
// 5) 새 줄(내 것) → 맨 아래, 다른 사람 새 줄 → 받기
const l3 = structuredClone(local0); l3.set("r2", { ...structuredClone(l3.get("r1")!), uid: "r2" });
m = merge(l3, sheet(local0), base, [], 1, "t");
assert(m.appends.length === 1 && m.appends[0].uid === "r2", "append mine");
const withNew = new Map(local0); withNew.set("r9", { ...structuredClone(local0.get("r1")!), uid: "r9" });
m = merge(local0, sheet(withNew), base, [], 1, "t");
assert(m.toLocal.length === 1 && m.toLocal[0].uid === "r9" && m.received.has("r9"), "receive new row");
// 6) 내가 지움 → 시트 지움 표시, 다른 사람이 지움 → 내 PC에서 지움
const l4 = structuredClone(local0); l4.delete("r1");
m = merge(l4, sheet(local0), base, [], 1, "t");
assert(m.updates.some((u) => u.col === "Q" && u.value === 1), "mark delete");
rs = sheet(local0, (r) => { if (r.uid === "r1") r.del = true; });
m = merge(local0, rs, base, [], 1, "t");
assert(m.toLocal.length === 1 && m.toLocal[0].del, "remote delete");
// 7) 순서는 묻지 않고 시트 따름
const l5 = structuredClone(local0); l5.get("r1")!.f.ord = "5";
rs = sheet(local0, (r) => { if (r.uid === "r1") r.f.ord = "7"; });
m = merge(l5, rs, base, [], 1, "t");
assert(!m.conflicts.length && m.toLocal[0]?.f.ord === "7", "struct takes remote");
// 8) 숫자·이월 왕복
const v = rowValues(local0.get("p1")!, { name: [1, "t"] });
const back = parseSheet([v]).get("p1")!;
assert(FIELDS.every((k) => back.f[k] === local0.get("p1")!.f[k]) && back.meta.name?.[0] === 1, "roundtrip");
// 9) 부하: 3년치 6,000줄
const big = new Map<string, Rec>();
for (let i = 0; i < 6000; i++) big.set("u" + i, { ...structuredClone(local0.get("r1")!), uid: "u" + i, f: { ...local0.get("r1")!.f, name: "공사 " + i, memo: "<ul><li>메모 " + i + "</li></ul>" } });
const sh = sheet(big);
const t0 = performance.now();
m = merge(big, sh, new Map(big), [], 1, "t");
const t1 = performance.now();
const json = JSON.stringify([...big.values()].map((r) => rowValues(r, { name: [1, "2026-10-20 09:12"] })));
console.log("merge 6000 rows ms", Math.round(t1 - t0), "sheet cells", 6000 * 18, "payload KB", Math.round(json.length / 1024));
