// 집행현황 팀 공유 그리기 – 담당 배지, 받은 것 띠, 겹친 칸.
import { MouseEvent as RMouseEvent } from "react";
import { api, errorText } from "../../api";
import { BudgetProject, BudgetRow, fmt, memoToText } from "../../budget";
import { Conflict, Field, Got, personColor, refreshShare } from "../../budgetShare";
import { ColId, selKey } from "./parts";
import type { useBudgetPick } from "./pick";

export function useBudgetShareView(c: ReturnType<typeof useBudgetPick>) {
  const { share, pop, setPop, setSel, run, setGotOpen, setToast, commit, year, data, setYear, setData, setQ, setFlash, shareOn, VC, bandOff, unit } = c;

  // ---------- 팀 공유 그리기 ----------
  const people = share?.people ?? [];
  const personName = (no: number | null | undefined) => (no == null ? "" : (people.find((x) => x.no === no)?.name ?? ""));
  const ownerBadge = (p: BudgetProject) => {
    const nm = personName(p.owner);
    const c = p.owner != null ? personColor(p.owner) : 0;
    return (
      <button
        type="button"
        data-pick
        className={"bs-own" + (nm ? "" : " none")}
        aria-label={nm ? `담당 ${nm} 바꾸기` : "담당 고르기"}
        title={nm ? `담당 ${nm}` : "담당 고르기"}
        style={nm ? { background: `var(--pj-${c}-bg)`, color: `var(--pj-${c}-fg)`, borderColor: `var(--pj-${c}-line)` } : undefined}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (pop?.t === "owner" && pop.id === p.id) {
            setPop(null);
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          setSel(selKey("project", p.id));
          setPop({ t: "owner", x: r.left, y: r.bottom + 4, id: p.id });
        }}
      >
        {/* 앞 3글자만(2026-10-21 사용자) – 전체 이름은 title */}
        {[...nm].slice(0, 3).join("")}
      </button>
    );
  };
  const setOwner = async (id: number, owner: number | null) => {
    setPop(null);
    await run(() => api.setBudgetOwner(id, owner));
  };
  /** 받은 것 창의 줄 → 표의 그 줄로(해가 다르면 그 해로, 접혀 있으면 펼쳐서) */
  const jumpGot = async (g: Got) => {
    setGotOpen(false);
    if (g.field === "del") {
      setToast("지운 줄이라 표에는 없어요");
      return;
    }
    if (!(await commit())) return;
    const y = Number(g.year) || year;
    let d: BudgetProject[];
    try {
      d = y === year && data ? data : await api.budgetData(y);
    } catch (e) {
      setToast(errorText(e));
      return;
    }
    let p0: BudgetProject | null = null;
    let it0: BudgetProject["items"][number] | null = null;
    let r0: BudgetRow | null = null;
    for (const p of d)
      for (const it of [null, ...p.items])
        for (const r of it ? [null, ...it.rows] : [null]) {
          const u = r ? r.uid : it ? it.uid : p.uid;
          if (u === g.uid) [p0, it0, r0] = [p, it, r];
        }
    if (!p0) {
      setToast("그 줄은 지금 표에 없어요");
      return;
    }
    const P: BudgetProject = p0;
    if (y !== year) setYear(y);
    setData(d);
    setQ("");
    if (it0 && !P.open) await run(() => api.setBudgetOpen("project", P.id, true));
    if (r0 && it0 && !it0.open) {
      const I = it0;
      await run(() => api.setBudgetOpen("item", I.id, true));
    }
    setSel(r0 ? selKey("row", r0.id) : it0 ? selKey("item", it0.id) : selKey("project", P.id));
    if (r0) setFlash(r0.id);
    window.setTimeout(() => document.querySelector(`.bd-body .bd-rw[data-uid="${g.uid}"]`)?.scrollIntoView({ block: "center" }), 60);
  };
  /** 같은 칸 → 표 열 */
  const CF_COL: Partial<Record<Field, ColId>> = { name: "name", budget: "bud", kind: "kind", co: "co", cmt: "cmt", exp: "exp", act: "act", stage: "stage", owner: "owner", memo: "memo" };
  const cfs: Conflict[] = shareOn ? (share?.conflicts ?? []) : [];
  const cfIx = (c: Conflict) => VC.findIndex(([x]) => x === CF_COL[c.field]);
  const last = share?.last ?? null;
  const bandShown = shareOn && !!last && last.at !== bandOff && (last.receivedCells > 0 || !!last.error || !!last.note);
  const fresh = bandShown && last ? last.received : [];
  const shareStyle =
    cfs
      .filter((c) => cfIx(c) >= 0)
      .map((c) => `.bd-body .bd-rw[data-uid="${c.uid}"]>.bd-c:nth-child(${cfIx(c) + 1})`)
      .join(",") +
    (cfs.length ? "{box-shadow:inset 0 0 0 2px var(--cs-reply-bg);background:color-mix(in srgb,var(--cs-reply-bg) 14%,var(--surface));color:var(--ink);font-weight:600;cursor:pointer}" : "") +
    (fresh.length ? fresh.map((u) => `.bd-body .bd-rw[data-uid="${u}"]>.bd-c:first-child`).join(",") + "{box-shadow:inset 3px 0 0 var(--share-new)}" : "");
  /** 같은 칸을 누르면 고르기 상자 */
  const openCf = (e: RMouseEvent): boolean => {
    if (!cfs.length || e.shiftKey || e.ctrlKey || e.metaKey) return false;
    const c = (e.target as Element).closest(".bd-c");
    const rw = c?.parentElement;
    const uid = rw?.getAttribute("data-uid");
    if (!c || !rw || !uid || rw.classList.contains("edit")) return false;
    const ci = Array.prototype.indexOf.call(rw.children, c) as number;
    const hit = cfs.find((x) => x.uid === uid && cfIx(x) === ci);
    if (!hit) return false;
    e.stopPropagation();
    e.preventDefault();
    const r = c.getBoundingClientRect();
    setPop({ t: "cf", x: r.left + r.width / 2 - 150, y: r.bottom + 6, uid, field: hit.field });
    return true;
  };
  const cfValue = (f: Field, v: string) => {
    if (["budget", "cmt", "exp", "act"].includes(f)) return v === "" ? "(빈칸)" : fmt(Number(v), unit) || "0";
    if (f === "owner") return personName(v === "" ? null : Number(v)) || "(없음)";
    if (f === "memo") return memoToText(v).slice(0, 40) || "(빈칸)";
    return v || "(빈칸)";
  };
  const doRefresh = async () => {
    if (!(await commit())) return;
    await refreshShare();
  };
  return { ...c, people, personName, ownerBadge, setOwner, jumpGot, CF_COL, cfs, cfIx, last, bandShown, fresh, shareStyle, openCf, cfValue, doRefresh };
}
