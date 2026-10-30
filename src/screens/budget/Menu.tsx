// 집행현황 뜨는 것 – 우클릭 메뉴, 옮기기·단계·지우기, 지울까요 묻기.
import { fitSub } from "../../PopMenu";
import { AskBand } from "../../AskBand";
import { Fragment, ReactNode, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../api";
import { allRows, BudgetLevel, STAGES } from "../../budget";
import { ICON, STAGE_CLASS, CR, PLUS } from "./parts";
import type { useBudgetRows } from "./Table";

export function useBudgetMenu(c: ReturnType<typeof useBudgetRows>) {
  const { pop, findP, findItem, findRow, startAdd, newProject, newItem, newRow, setPop, run, startEdit, bsSent, openSend, list, setToast, setFlash, setSel } = c;

  // ---------- 뜨는 것 그리기 ----------
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!pop || !popRef.current) {
      setPopPos(null);
      return;
    }
    const r = popRef.current.getBoundingClientRect();
    // 떠 있는 메뉴 공통 규칙(✔5): 화면 안 8px, 아래가 모자라면 위로 열어요.
    const top = pop.y + r.height + 8 > innerHeight ? pop.y - r.height : pop.y;
    setPopPos({ left: Math.max(8, Math.min(pop.x, innerWidth - r.width - 8)), top: Math.max(8, Math.min(top, innerHeight - r.height - 8)) });
  }, [pop]);

  const mi = (t: string, onClick: (() => void) | null, o: { cls?: string; icon?: ReactNode; k?: string; sub?: ReactNode } = {}) => (
    <div
      className={"bd-mi" + (o.cls ? " " + o.cls : "") + (!onClick && !o.sub ? " off" : "")}
      role="menuitem"
      aria-disabled={!onClick && !o.sub}
      aria-haspopup={o.sub ? "menu" : undefined}
      onMouseEnter={o.sub ? (e) => fitSub(e.currentTarget) : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <span className="bd-mi-ic">{o.icon}</span>
      <span className="bd-mi-t">{t}</span>
      {o.k && <span className="bd-mi-k">{o.k}</span>}
      {o.sub && ICON(CR, 12, 2.2)}
      {o.sub}
    </div>
  );
  const MD = <div className="bd-mdiv" />;

  function menuBody(level: BudgetLevel, id: number): ReactNode {
    const ic = ICON(PLUS);
    const projOf = level === "project" ? findP(id) : level === "item" ? findItem(id)?.p : findRow(id)?.p;
    const itemOf = level === "item" ? findItem(id)?.it : level === "row" ? findRow(id)?.it : null;
    const add = (
      <>
        {mi("세부사업 추가", projOf ? () => void startAdd(newProject(projOf.id)) : null, { cls: "add", icon: ic, k: "아래에" })}
        {mi("부기사업 추가", projOf ? () => void startAdd(newItem(projOf.id)) : null, { cls: "add", icon: ic })}
        {mi("공사(용역·물품) 추가", itemOf ? () => void startAdd(newRow(itemOf.id)) : null, { cls: itemOf ? "add" : "", icon: ic })}
        {MD}
      </>
    );
    const del = () => setPop({ t: "confirm", x: pop!.x, y: pop!.y, level, id });
    const memo = () => setPop({ t: "memo", x: pop!.x, y: pop!.y, level, id });
    const up = () => void run(() => api.moveBudget(level, id, -1)).then(() => setPop(null));
    const down = () => void run(() => api.moveBudget(level, id, 1)).then(() => setPop(null));
    if (level === "project") {
      const p = findP(id);
      if (!p) return null;
      return (
        <>
          {add}
          {mi("수정", () => void startEdit("project", id), { k: "두 번 누르기" })}
          {mi("메모", memo)}
          {mi("부기사업 모두 펼치기", () => void run(() => api.setBudgetOpen("project", id, true, true)).then(() => setPop(null)))}
          {mi("부기사업 모두 접기", () => void run(() => api.setBudgetOpen("project", id, false, true)).then(() => setPop(null)))}
          {MD}
          {mi("위로 옮기기", up)}
          {mi("아래로 옮기기", down)}
          {MD}
          {mi(bsSent.has(p.name) ? "예산현황 설정" : "예산현황으로 보내기", () => { setPop(null); void openSend(p.name); })}
          {MD}
          {mi("세부사업 지우기", del, { cls: "dg", k: `부기사업 ${p.items.length} · 공사 ${allRows(p).length}` })}
        </>
      );
    }
    if (level === "item") {
      const x = findItem(id);
      if (!x) return null;
      const others = list.filter((q2) => q2.id !== x.p.id);
      const sub = (
        <div className="bd-pop bd-sub" style={{ width: 240 }}>
          {others.length ? others.map((q2) => mi(q2.name, () => moveItem(id, q2.id))) : mi("옮길 세부사업이 없어요", null)}
        </div>
      );
      return (
        <>
          {add}
          {mi("수정", () => void startEdit("item", id), { k: "두 번 누르기" })}
          {mi("메모", memo)}
          {mi("다른 세부사업으로 옮기기", null, { sub })}
          {mi("위로 옮기기", up)}
          {mi("아래로 옮기기", down)}
          {MD}
          {mi("부기사업 지우기", del, { cls: "dg", k: `공사 ${x.it.rows.length}` })}
        </>
      );
    }
    const x = findRow(id);
    if (!x) return null;
    const ssub = (
      <div className="bd-pop bd-sub bd-stlist">
        {STAGES.map((s) => (
          <div key={s} className={"bd-mi" + (s === x.r.stage ? " cur" : "")} onClick={() => setStage(id, s)}>
            <span className={"bd-chip " + STAGE_CLASS[s]}>{s}</span>
          </div>
        ))}
      </div>
    );
    const msub = (
      <div className="bd-pop bd-sub" style={{ width: 260, maxHeight: 360, overflow: "auto" }}>
        {list.map((q2) => (
          <Fragment key={q2.id}>
            <div className="bd-grp">{q2.name}</div>
            {q2.items.filter((i) => i.id !== x.it.id).map((i) => (
              <Fragment key={i.id}>{mi(i.name, () => moveRow(id, i.id))}</Fragment>
            ))}
          </Fragment>
        ))}
      </div>
    );
    return (
      <>
        {add}
        {mi("수정", () => void startEdit("row", id), { k: "두 번 누르기" })}
        {mi("단계", null, { sub: ssub })}
        {mi("메모", memo)}
        {mi("다른 부기사업으로 옮기기", null, { sub: msub })}
        {MD}
        {mi("공사 지우기", del, { cls: "dg", k: "Del" })}
      </>
    );
  }

  const moveItem = async (id: number, to: number) => {
    const x = findItem(id), t = findP(to);
    if (x && t?.items.some((i) => i.name === x.it.name)) {
      setToast("같은 이름의 부기사업이 있어요");
      return;
    }
    setPop(null);
    await run(() => api.moveBudgetItem(id, to), `${t?.name ?? ""}(으)로 옮겼어요`);
  };
  const moveRow = async (id: number, to: number) => {
    setPop(null);
    const t = findItem(to);
    if (await run(() => api.moveBudgetRow(id, to), `${t?.it.name ?? ""}(으)로 옮겼어요`)) setFlash(id);
  };
  const setStage = async (id: number, s: string) => {
    setPop(null);
    await run(() => api.setBudgetStage(id, s));
  };
  const doDelete = async (level: BudgetLevel, id: number) => {
    setPop(null);
    if (await run(() => api.deleteBudget(level, id), "지웠어요")) setSel(null);
  };

  function confirmBody(level: BudgetLevel, id: number): ReactNode {
    let msg: ReactNode = null;
    if (level === "project") {
      const p = findP(id);
      if (!p) return null;
      msg = (
        <>
          <b>{p.name}</b>을(를) 지울까요?
          <br />
          부기사업 {p.items.length}개 · 공사 {allRows(p).length}건도 함께 지워져요.
        </>
      );
    } else if (level === "item") {
      const x = findItem(id);
      if (!x) return null;
      msg = (
        <>
          <b>{x.it.name}</b>을(를) 지울까요?
          {x.it.rows.length > 0 && (
            <>
              <br />공사 {x.it.rows.length}건도 함께 지워져요.
            </>
          )}
        </>
      );
    } else {
      const x = findRow(id);
      if (!x) return null;
      msg = (
        <>
          <b>{x.r.name}</b>을(를) 지울까요?
        </>
      );
    }
    return (
      <AskBand className="dmenu-ask bd-ask" label="지우기 확인" text={msg} onNo={() => setPop(null)} onYes={() => void doDelete(level, id)} />
    );
  }
  return { ...c, popRef, popPos, setPopPos, mi, MD, menuBody, moveItem, moveRow, setStage, doDelete, confirmBody };
}
