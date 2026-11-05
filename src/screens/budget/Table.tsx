// 집행현황 표 – 칸 그리기 도우미, 세부사업·부기사업·공사 줄 만들기, 열 제목 줄.
import { KeyboardEvent as RKeyboardEvent, ReactNode, useEffect, useMemo } from "react";
import { allRows, balance, BudgetLevel, BudgetProject, BudgetRow, FINAL, CMT_LABEL, RATE_LABEL, fmt, matchRow, memoToText, okWon, parseWon, rowRate, sortRows, sums, typing } from "../../budget";
import { keyAction, rowKeys } from "../../keys";
import { isEmptyMemo } from "../../RichMemo";
import { orgsOf, projectHits, projectSub, SuggestInput } from "./Dialogs";
import { selKey, Money, Form, ICON, CD, moneyOf, KIND_CLASS, STAGE_CLASS, CR } from "./parts";
import type { useBudgetExcel } from "./excel";
import type { useBudgetShareView } from "./share";
import type { useBudgetPop } from "./Dialogs";

export function useBudgetCells(c: ReturnType<typeof useBudgetExcel>) {
  const { view, commit, setPop, unit, shareOn, bad, setF, setBad, form, cancel, formRow, pop } = c;

  // ---------- 그리기 ----------
  const cell = (v: ReactNode, cls = "", key?: string | number) => (
    <div className={"bd-c" + cls} role="cell" key={key}>
      {v}
    </div>
  );
  const rateCell = (rate: number | null, sm: boolean) =>
    rate == null
      ? cell("", " n")
      : cell(
          <>
            <span className={"bd-bar" + (sm ? " sm" : "")}>
              <span style={{ width: Math.min(100, Math.max(0, rate)) + "%" }} />
            </span>
            <span className="bd-pct">{Math.round(rate)}%</span>
          </>,
          " n",
        );
  const rowRateCell = (r: BudgetRow) => {
    const sp = rowRate(r, view);
    return sp == null
      ? cell("", " n")
      : cell(
          <>
            <span className="bd-bar rowbar" title={(view === "act" ? "시공량" : "집행액") + " ÷ " + CMT_LABEL[view]}>
              <span style={{ width: Math.min(100, Math.max(0, sp)) + "%" }} />
            </span>
            <span className="bd-pct rowp">{Math.round(sp)}%</span>
          </>,
          " n",
        );
  };
  const memoBtn = (level: BudgetLevel, id: number, memo: string) => {
    const has = !isEmptyMemo(memo);
    return (
      <button
        type="button"
        className={"bd-memo" + (has ? " has" : "")}
        aria-label={has ? "메모 편집" : "메모 쓰기"}
        title={has ? memoToText(memo) : "메모 쓰기"}
        onDoubleClick={(e) => e.stopPropagation()}
        onClick={async (e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          if (!(await commit())) return;
          setPop({ t: "memo", x: Math.max(8, r.right - 440), y: r.bottom + 4, level, id });
        }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={has ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </button>
    );
  };
  /** 합계 칸들(구분·업체 빈칸부터 메모까지) */
  const sumCells = (budget: number | null, rows: BudgetRow[], sm: boolean, memo: ReactNode, budgetCell?: ReactNode, owner?: ReactNode) => {
    const s = sums(budget, rows, view);
    return (
      <>
        {cell("")}
        {cell("")}
        {budgetCell ?? cell(fmt(budget, unit), " n")}
        {cell(fmt(s.cmt, unit), " n")}
        {cell(fmt(s.exp, unit), " n")}
        {cell(fmt(s.act, unit), " n")}
        {cell(fmt(s.bal, unit), " n" + (s.bal < 0 ? " red" : ""))}
        {rateCell(s.rate, sm)}
        {cell(fmt(s.avail, unit), " n" + (s.low ? " red" : ""))}
        {cell(
          <span className="bd-dc">
            {s.done}/{s.n}
          </span>,
        )}
        {shareOn && cell(owner ?? "", " bs-oc")}
        {cell(memo)}
      </>
    );
  };

  const moneyInput = (k: "budget" | "cmt" | "exp" | "act", label: string, m: Money, bold = false) => (
    <input
      className={"fld bd-in n" + (bold ? " b" : "") + (bad === k ? " bad" : "")}
      aria-label={label}
      placeholder={label}
      value={m.text}
      onChange={(e) => {
        const text = typing(e.target.value);
        setF({ [k]: { ...m, text } } as unknown as Partial<Form>);
        setBad(okWon(parseWon(text, unit)) ? null : k);
      }}
    />
  );
  const nameInput = (label: string, bold = false) => (
    <input
      className={"fld bd-in" + (bold ? " b" : "") + (bad === "name" ? " bad" : "")}
      aria-label={label}
      placeholder={label}
      value={form?.name ?? ""}
      onChange={(e) => {
        setF({ name: e.target.value });
        if (bad === "name") setBad(null);
      }}
    />
  );
  const formKeys = (e: RKeyboardEvent) => {
    if (keyAction(e, "common") === "common.cancel" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      cancel();
      return;
    }
    rowKeys(e, formRow.current, () => void commit());
  };
  const stageChip = (st: string, onOpen: (r: DOMRect, from: string) => void, from: string) => (
    <button
      type="button"
      data-pick
      className={"bd-chip bd-stc " + (STAGE_CLASS[st] ?? "")}
      aria-label={`단계 ${st} 바꾸기`}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (pop && "from" in pop && pop.from === from) {
          setPop(null);
          return;
        }
        onOpen(e.currentTarget.getBoundingClientRect(), from);
      }}
    >
      {st}
      {ICON(CD, 10, 2.6)}
    </button>
  );

  // 입력 중에도 바로 계산(2026-10-18 사용자: 자동 계산되는 항목이 없어) – 적고 있는 값으로 그 줄 잔액·집행률과 위 합계를 그려요.
  const live = (m: Money) => {
    const v = moneyOf(m, unit);
    return v == null ? 0 : v;
  };
  const draftRow: BudgetRow | null =
    form?.level === "row"
      ? { id: form.id ?? -1, name: form.name, kind: form.kind, co: form.co, cmt: live(form.cmt), exp: live(form.exp), act: live(form.act), stage: form.stage, memo: "", uid: "" }
      : null;
  const rowsOf = (it: { id: number; rows: BudgetRow[] }) => {
    if (!draftRow || form?.level !== "row") return it.rows;
    if (form.id != null) return it.rows.map((r) => (r.id === form.id ? draftRow : r));
    return form.item === it.id ? [...it.rows, draftRow] : it.rows;
  };
  const budgetOf = (level: "project" | "item", o: { id: number; budget: number | null }) =>
    form && form.level === level && form.id === o.id ? (moneyOf(form.budget, unit) ?? null) : o.budget;
  const pRows = (p: BudgetProject) => p.items.flatMap(rowsOf);
  return { ...c, cell, rateCell, rowRateCell, memoBtn, sumCells, moneyInput, nameInput, formKeys, stageChip, live, draftRow, rowsOf, budgetOf, pRows };
}

export function useBudgetRows(c: ReturnType<typeof useBudgetShareView>) {
  const { form, formRow, formKeys, cell, nameInput, moneyInput, VC, bad, cdata, setF, setBad, setCoOpts, pop, setPop, coOpts, view, draftRow, unit, rowRateCell, stageChip, shareOn, memoBtn, list, q, sel, rowClick, startEdit, openMenu, toggle, sumCells, budgetOf, pRows, ownerBadge, rowsOf, flash, setSel } = c;

  const rowsOut: ReactNode[] = [];
  let carryShown = false;
  const lines = (parts: string[]) => parts.map((c) => <span key={c} className={"bd-tl " + c} />);

  const nameRow = (key: string, level: "project" | "item") => {
    const f = form as Extract<Form, { level: "project" | "item" }>;
    return (
      <div key={key} ref={formRow} className="bd-rw new" role="row" onKeyDown={formKeys}>
        {cell(
          <span className="bd-fill" style={{ paddingLeft: level === "item" ? 40 : 0 }}>
            {nameInput(level === "project" ? "세부사업 이름" : "부기사업 이름", level === "project")}
          </span>,
        )}
        {cell("")}
        {cell("")}
        {cell(moneyInput("budget", "예산", f.budget, level === "project"))}
        {cell(<span className="bd-hint">Enter 저장 · Esc 취소</span>)}
        {VC.slice(5).map((_, i) => cell("", "", i))}
      </div>
    );
  };

  const gunForm = (key: string, itemLast: boolean, existing: BudgetRow | null) => {
    const f = form as Extract<Form, { level: "row" }>;
    return (
      <div key={key} ref={formRow} className={"bd-rw gun " + (existing ? "edit" : "new")} role="row" onKeyDown={formKeys}>
        {cell(
          <>
            {lines([...(itemLast ? [] : ["v1"]), "v2", "h2"])}
            <span className="bd-gpad bd-fill">
              <SuggestInput
                className={"fld bd-in" + (bad === "name" ? " bad" : "")}
                label="공사명"
                value={f.name}
                options={projectHits(cdata, f.name).map((p) => ({ key: String(p.id), label: p.alias || p.name, sub: projectSub(cdata, p) }))}
                hint="업무연락처 사업 · ↑↓ 고르기 · Tab 확정 · Esc 친 그대로"
                onChange={(v) => {
                  setF({ name: v });
                  if (bad === "name") setBad(null);
                }}
                onPick={(o) => {
                  const orgs = orgsOf(cdata, Number(o.key));
                  if (orgs.length === 1 && !f.co.trim()) setF({ name: o.label, co: orgs[0].label });
                  else setF({ name: o.label });
                  setCoOpts(orgs.length > 1 ? orgs : null);
                }}
              />
            </span>
          </>,
        )}
        {cell(
          <button
            type="button"
            data-pick
            className="bd-selk"
            aria-label={`구분 ${f.kind} 바꾸기`}
            onClick={(e) => {
              if (pop?.t === "kind") {
                setPop(null);
                return;
              }
              const r = e.currentTarget.getBoundingClientRect();
              setPop({ t: "kind", x: r.left, y: r.bottom + 4, from: "form-kind" });
            }}
          >
            {f.kind}
            {ICON(CD, 10, 2.6)}
          </button>,
        )}
        {cell(
          <SuggestInput
            className="fld bd-in"
            label="업체"
            value={f.co}
            options={(coOpts ?? []).filter((o) => !f.co.trim() || (o.label.startsWith(f.co.trim()) && o.label !== f.co.trim()))}
            hint="이 사업의 업체 · ↑↓ 고르기 · Tab 확정 · Esc 친 그대로"
            openOnFocus
            onChange={(v) => setF({ co: v })}
            onPick={(o) => setF({ co: o.label })}
          />,
        )}
        {cell("")}
        {cell(moneyInput("cmt", CMT_LABEL[view], f.cmt))}
        {cell(moneyInput("exp", "집행액", f.exp))}
        {cell(moneyInput("act", "시공량(사용량)", f.act))}
        {draftRow && cell(fmt(balance(draftRow, view), unit), " n" + (balance(draftRow, view) < 0 ? " red" : ""))}
        {draftRow && rowRateCell(draftRow)}
        {cell("")}
        {cell(stageChip(f.stage, (r, from) => setPop({ t: "stage", x: r.left, y: r.bottom + 4, id: "form", from }), "form-stage"))}
        {shareOn && cell("")}
        {cell(existing ? memoBtn("row", existing.id, existing.memo) : "")}
      </div>
    );
  };

  const group = (k: string, id: number, kids: ReactNode[]) => (
    <div key={k + id} className={"bd-" + k} role="presentation">
      {kids}
    </div>
  );
  if (form?.level === "project" && form.id == null && form.after == null) rowsOut.push(nameRow("new-top", "project"));
  for (const p of list) {
    if (p.carry && !carryShown) {
      carryShown = true;
      rowsOut.push(
        <div key="carry" className="bd-carry">
          이월 사업
        </div>,
      );
    }
    const rows = allRows(p);
    if (q && !rows.some((r) => matchRow(r, q))) continue;
    const pOpen = p.open || !!q;
    const pEdit = form?.level === "project" && form.id === p.id;
    const pk = selKey("project", p.id);
    // 위로 굴려도 세부사업·부기사업 이름 줄이 위에 붙어 있게(틀고정) 묶음마다 감싸요 – 감싸야 다음 묶음의 이름 줄이 앞 줄을 밀어 올려요(2026-10-21 사용자 1안).
    const pOut: ReactNode[] = [];
    pOut.push(
      <div
        key={pk}
        ref={pEdit ? formRow : undefined}
        data-sel={pk}
        data-uid={p.uid}
        className={"bd-rw pj" + (sel === pk ? " sel" : "") + (pEdit ? " edit" : "")}
        role="row"
        onClick={() => !pEdit && void rowClick("project", p.id)}
        onDoubleClick={() => !pEdit && void startEdit("project", p.id)}
        onContextMenu={(e) => void openMenu(e, "project", p.id)}
        onKeyDown={pEdit ? formKeys : undefined}
      >
        {cell(
          <>
            {pOpen && <span className="bd-tl v1 dn1" />}
            <button
              type="button"
              className="bd-cr"
              aria-label={pOpen ? "접기" : "펼치기"}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void toggle("project", p.id, p.open);
              }}
            >
              {ICON(pOpen ? CD : CR, 14, 2.2)}
            </button>
            {pEdit ? (
              nameInput("세부사업 이름", true)
            ) : (
              <span className="bd-nm" title={p.name}>
                {p.name}
              </span>
            )}
          </>,
        )}
        {sumCells(budgetOf("project", p), pRows(p), false, memoBtn("project", p.id, p.memo), pEdit && form?.level === "project" ? cell(moneyInput("budget", "예산", form.budget, true)) : undefined, ownerBadge(p))}
      </div>,
    );
    if (form?.level === "project" && form.id == null && form.after === p.id) pOut.push(nameRow("new-after-" + p.id, "project"));
    if (!pOpen) {
      rowsOut.push(group("pg", p.id, pOut));
      continue;
    }
    if (form?.level === "item" && form.id == null && form.project === p.id) pOut.push(nameRow("new-item-" + p.id, "item"));
    let n = 0;
    const items = p.items.filter((it) => !q || it.rows.some((r) => matchRow(r, q)));
    items.forEach((it, j) => {
      const last = j === items.length - 1;
      const iOpen = it.open || !!q;
      n++;
      const ik = selKey("item", it.id);
      const iOut: ReactNode[] = [];
      const iEdit = form?.level === "item" && form.id === it.id;
      iOut.push(
        <div
          key={ik}
          ref={iEdit ? formRow : undefined}
          data-sel={ik}
          data-uid={it.uid}
          className={"bd-rw it" + (n % 2 === 0 ? " alt" : "") + (sel === ik ? " sel" : "") + (iEdit ? " edit" : "")}
          role="row"
          onClick={() => !iEdit && void rowClick("item", it.id)}
          onDoubleClick={() => !iEdit && void startEdit("item", it.id)}
          onContextMenu={(e) => void openMenu(e, "item", it.id)}
          onKeyDown={iEdit ? formKeys : undefined}
        >
          {cell(
            <>
              {lines(["v1" + (last ? " half" : ""), "h1", ...(iOpen && it.rows.length ? ["v2 dn2"] : [])])}
              <button
                type="button"
                className="bd-cr ind1"
                aria-label={iOpen ? "접기" : "펼치기"}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void toggle("item", it.id, it.open);
                }}
              >
                {ICON(iOpen ? CD : CR, 14, 2.2)}
              </button>
              {iEdit ? (
                nameInput("부기사업 이름")
              ) : (
                <span className="bd-nm" title={it.name}>
                  {it.name}
                </span>
              )}
            </>,
          )}
          {sumCells(budgetOf("item", it), rowsOf(it), true, memoBtn("item", it.id, it.memo), iEdit && form?.level === "item" ? cell(moneyInput("budget", "예산", form.budget)) : undefined)}
        </div>,
      );
      if (!iOpen) {
        pOut.push(group("ig", it.id, iOut));
        return;
      }
      if (form?.level === "row" && form.id == null && form.item === it.id) iOut.push(gunForm("new-row-" + it.id, last, null));
      const rs = sortRows(it.rows).filter((r) => matchRow(r, q));
      rs.forEach((r, k) => {
        n++;
        const gk = selKey("row", r.id);
        const rLines = [...(last ? [] : ["v1"]), "v2" + (k === rs.length - 1 ? " half" : ""), "h2"];
        if (form?.level === "row" && form.id === r.id) {
          iOut.push(gunForm(gk, last, r));
          return;
        }
        iOut.push(
          <div
            key={gk}
            data-sel={gk}
            data-uid={r.uid}
            className={"bd-rw gun" + (FINAL(r.stage) ? " done" : "") + (n % 2 === 0 ? " alt" : "") + (sel === gk ? " sel" : "") + (flash === r.id ? " flash" : "")}
            role="row"
            onClick={() => void rowClick("row", r.id)}
            onDoubleClick={() => void startEdit("row", r.id)}
            onContextMenu={(e) => void openMenu(e, "row", r.id)}
          >
            {cell(
              <>
                {lines(rLines)}
                <span className="bd-gpad bd-nm" title={r.name}>
                  {r.name}
                </span>
              </>,
            )}
            {cell(<span className={"bd-chip bd-kchip " + (KIND_CLASS[r.kind] ?? "k-il")}>{r.kind}</span>)}
            {cell(
              <span className="bd-nm" title={r.co}>
                {r.co}
              </span>,
            )}
            {cell("")}
            {cell(fmt(r.cmt, unit), " n")}
            {cell(fmt(r.exp, unit), " n")}
            {cell(fmt(r.act, unit), " n")}
            {cell(fmt(balance(r, view), unit), " n" + (balance(r, view) < 0 ? " red" : ""))}
            {rowRateCell(r)}
            {cell("")}
            {cell(
              stageChip(
                r.stage,
                (rect, from) => {
                  setSel(gk);
                  setPop({ t: "stage", x: rect.left - 3, y: rect.bottom + 4, id: r.id, from });
                },
                "stage-" + r.id,
              ),
            )}
            {shareOn && cell("")}
            {cell(memoBtn("row", r.id, r.memo))}
          </div>,
        );
      });
      pOut.push(group("ig", it.id, iOut));
    });
    rowsOut.push(group("pg", p.id, pOut));
  }
  return { ...c, rowsOut, carryShown, lines, nameRow, gunForm, group };
}

export function useBudgetHead(c: ReturnType<typeof useBudgetPop>) {
  const { pop, memoHtml, memoTarget, hideIx, colHl, VC, setColHl, view, hide, colh } = c;
  // 메모 창을 열 때마다 새로 담아요.
  const memoOpenKey = pop?.t === "memo" ? `${pop.level}${pop.id}` : "";
  useEffect(() => {
    if (pop?.t === "memo") memoHtml.current = memoTarget(pop.level, pop.id)?.memo ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoOpenKey]);

  // 열 머리를 눌러 고른 열은 옅게 칠해요(2026-10-28 집행현황 계산 세션: 기준 단추가 없어져 "기준 세 열" 칠하기는 뺐어요)
  const colStyle = (() => {
    const hl = "linear-gradient(var(--bd-col-hl),var(--bd-col-hl))";
    // 보기에서 숨는 열(폭 0)은 칸 안 글자·테두리도 그리지 않아요
    const hid = hideIx >= 0 ? `.bd-hd>.bd-h:nth-child(${hideIx + 1}),.bd-rw>.bd-c:nth-child(${hideIx + 1}){visibility:hidden;overflow:hidden;padding:0!important;border:0!important;min-width:0}` : "";
    return hid + (colHl == null || colHl < 0 || colHl === hideIx ? "" : `.bd-body .bd-rw>.bd-c:nth-child(${colHl + 1}){background-image:${hl}}`);
  })();
  const head = useMemo(
    () =>
      VC.map(([c, label], i) => (
        <div
          key={c}
          className={"bd-h" + (colHl === i ? " on" : "")}
          role="columnheader"
          title="누르면 이 열을 칠해요"
          onClick={(e) => {
            if ((e.target as Element).closest(".colh-grip")) return;
            setColHl(colHl === i ? null : i);
          }}
        >
          {c === "rate" ? RATE_LABEL[view] : c === "cmt" ? CMT_LABEL[view] : label}
          {c !== hide && colh.grip(c, { last: i === VC.length - 1 })}
        </div>
      )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colHl, colh.saved, VC, view, hide],
  );
  return { ...c, memoOpenKey, colStyle, head };
}
