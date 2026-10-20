// 예산현황으로 보내기 창(2026-10-20 사용자): 집행현황 세부사업 줄 우클릭 "예산현황으로 보내기"와 예산현황 ⚙이 같은 창을 열어요.
// - 사업: 단년도/다년도 + 기간 · 재원(국비·도비·시비·기타) · 이월 사업 잇기
// - 매칭: 재원이 둘 이상이면 이 세부사업의 부기사업마다 재원을 골라요 → 재원 줄 예산·집행액이 그 부기사업에서 자동으로 와요.
//   부기사업이 하나뿐이면 재원별로 나눌 수 없어 직접 적어요(안내).
// - (명시이월)/(사고이월) 세부사업은 "새 사업으로" 또는 "기존 사업에 이월로 잇기"를 골라요.
// - 보낸 사업만 예산현황에 보여요(사용자 2안 – 안 보낸 것은 어디에도 표시하지 않아요). "예산현황에서 빼기"로 되돌려요.
import { useState } from "react";
import { BudgetProject } from "./budget";
import { defaultSetup, isCarryName, Setup, SOURCES } from "./budgetStatus";

const X = "M6 6l12 12M18 6L6 18";
const ICON = (d: string, s = 14, w = 2) => (
  <svg aria-hidden="true" width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="miter">
    <path d={d} />
  </svg>
);

export type SendTarget = {
  name: string;
  /** 이 해의 집행현황 세부사업(부기사업 목록을 보여 주려고) – 없으면 매칭 칸을 안 그려요 */
  project: BudgetProject | null;
  /** 집행현황에 이 세부사업이 있는 해들 */
  years: number[];
  /** 잇기 후보: 보낸 사업 이름(이월 세부사업을 보낼 때) */
  parents: { name: string; setup: Setup }[];
  /** 이월 세부사업 이름(보통 사업을 보낼 때 "이월 사업" 고르기) */
  carries: { name: string; years: number[] }[];
};

export function BudgetStatusSend({
  target,
  setup,
  onSave,
  onAttach,
  onRemove,
  onClose,
}: {
  target: SendTarget;
  /** 이미 보낸 설정(없으면 처음 값) */
  setup: Setup | null;
  onSave: (s: Setup) => void;
  /** 이월 세부사업을 기존 사업에 잇기: 부모 이름·재원 */
  onAttach: (parent: string, src: string) => void;
  onRemove: (() => void) | null;
  onClose: () => void;
}) {
  const carry = isCarryName(target.name);
  const [s, setS] = useState<Setup>(() => setup ?? defaultSetup(target.years.length ? target.years : [new Date().getFullYear()]));
  const [mode, setMode] = useState<"new" | "attach">(carry && !setup ? "attach" : "new");
  const [parent, setParent] = useState(target.parents[0]?.name ?? "");
  const [other, setOther] = useState("");
  const items = target.project?.items ?? [];
  const multi = s.sources.length > 1;
  const parentSetup = target.parents.find((p) => p.name === parent)?.setup;
  const [parentSrc, setParentSrc] = useState("");

  // 연도 칸: 치는 동안은 글자 그대로 두고(지우다 세 자리가 되면 바로 막혀 "안 고쳐지는" 문제 – 2026-10-20 사용자), 떠날 때 네 자리면 반영
  const [yrText, setYrText] = useState<{ from: string; to: string }>({ from: String(s.from), to: String(s.to) });
  const yr = (k: "from" | "to") => {
    const commit = () => {
      const v = Number(yrText[k]);
      if (/^\d{4}$/.test(yrText[k]) && v >= 2000 && v <= 2100) {
        const ns = { ...s, [k]: v };
        if (ns.from > ns.to) (k === "from" ? (ns.to = v) : (ns.from = v));
        setS(ns);
        setYrText({ from: String(ns.from), to: String(ns.to) });
      } else setYrText((t) => ({ ...t, [k]: String(s[k]) }));
    };
    return (
      <input
        className={"fld bd-in bs-yr" + (/^\d{4}$/.test(yrText[k]) ? "" : " bad")}
        aria-label={k === "from" ? "시작 연도" : "끝 연도"}
        inputMode="numeric"
        data-ime="en"
        value={yrText[k]}
        onChange={(e) => setYrText((t) => ({ ...t, [k]: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
    );
  };
  const toggleSrc = (x: string) => {
    const on = s.sources.includes(x);
    if (on && s.sources.length === 1) return;
    setS({ ...s, sources: on ? s.sources.filter((y) => y !== x) : [...s.sources, x] });
  };
  const matchOf = (item: string) => s.match?.[item] ?? s.sources[0];
  const setMatch = (item: string, src: string) => setS({ ...s, match: { ...(s.match ?? {}), [item]: src } });

  const save = () => {
    if (carry && mode === "attach") {
      if (!parent) return;
      onAttach(parent, parentSrc || parentSetup?.sources[0] || "");
      return;
    }
    const match: Record<string, string> = {};
    if (multi) for (const it of items) match[it.name] = matchOf(it.name);
    onSave({ ...s, sent: true, match: multi ? { ...(s.match ?? {}), ...match } : {} });
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog bss" role="dialog" aria-modal="true" aria-label="예산현황으로 보내기">
        <div className="dialog-head">
          <span className="dialog-title">{setup ? "예산현황 설정" : "예산현황으로 보내기"}</span>
          <span className="bss-sub">{target.name}</span>
        </div>
        <div className="dialog-body bss-body">
          {carry && (
            <div className="bs-row">
              <span className="bs-lab">이월 사업</span>
              <span className="bd-unit">
                <button type="button" className={mode === "attach" ? "on" : ""} aria-pressed={mode === "attach"} onClick={() => setMode("attach")}>기존 사업에 잇기</button>
                <button type="button" className={mode === "new" ? "on" : ""} aria-pressed={mode === "new"} onClick={() => setMode("new")}>새 사업으로</button>
              </span>
            </div>
          )}
          {carry && mode === "attach" ? (
            <>
              <div className="bs-row">
                <span className="bs-lab">잇는 사업</span>
                <select className="fld bd-in bs-sel" aria-label="이을 사업" value={parent} onChange={(e) => setParent(e.target.value)}>
                  {!target.parents.length && <option value="">보낸 사업이 없어요 – 먼저 원래 사업을 보내 주세요</option>}
                  {target.parents.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
                {parentSetup && parentSetup.sources.length > 1 && (
                  <select className="fld bd-in bs-sel2" aria-label="들어갈 재원" value={parentSrc || parentSetup.sources[0]} onChange={(e) => setParentSrc(e.target.value)}>
                    {parentSetup.sources.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="bs-hint">이 세부사업의 예산은 그 사업의 전년도 이월({/^\(사고/.test(target.name) ? "사고" : "명시"}), 집행액은 집행({/^\(사고/.test(target.name) ? "사고" : "명시"}) 칸으로 들어가요.</div>
            </>
          ) : (
            <>
              <div className="bs-row">
                <span className="bs-lab">사업</span>
                <span className="bd-unit" role="group" aria-label="단년도 · 다년도">
                  <button type="button" className={!s.multi ? "on" : ""} aria-pressed={!s.multi} onClick={() => setS({ ...s, multi: false })}>단년도</button>
                  <button type="button" className={s.multi ? "on" : ""} aria-pressed={s.multi} onClick={() => setS({ ...s, multi: true })}>다년도</button>
                </span>
                {s.multi && (
                  <>
                    <span className="bs-lab bs-lab2">기간</span>
                    {yr("from")}
                    <span className="bs-tilde">~</span>
                    {yr("to")}
                  </>
                )}
              </div>
              <div className="bs-row">
                <span className="bs-lab">재원</span>
                <span className="bs-srcs">
                  {SOURCES.filter((x) => x !== "기타").map((x) => {
                    const on = s.sources.includes(x);
                    return (
                      <button key={x} type="button" className={"bs-src" + (on ? " on" : "")} aria-pressed={on} onClick={() => toggleSrc(x)}>
                        {x}
                      </button>
                    );
                  })}
                  {s.sources.filter((x) => !(SOURCES as readonly string[]).includes(x)).map((x) => (
                    <span key={x} className="bs-src on bs-src-x">
                      {x}
                      <button type="button" className="chip-x" aria-label={x + " 빼기"} disabled={s.sources.length === 1} onClick={() => toggleSrc(x)}>
                        {ICON(X, 11)}
                      </button>
                    </span>
                  ))}
                  <input
                    className="fld bd-in bs-other"
                    placeholder="기타 재원 · Enter"
                    aria-label="기타 재원 이름"
                    value={other}
                    onChange={(e) => setOther(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing && other.trim()) {
                        if (!s.sources.includes(other.trim())) setS({ ...s, sources: [...s.sources, other.trim()] });
                        setOther("");
                      }
                    }}
                  />
                </span>
              </div>
              {!carry && (
                <div className="bs-row">
                  <span className="bs-lab">이월 사업</span>
                  <select className="fld bd-in bs-sel" aria-label="이어 붙일 이월 세부사업" value={s.carry} onChange={(e) => setS({ ...s, carry: e.target.value })}>
                    <option value="">없음</option>
                    {target.carries.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} · {c.years.join("·")}
                      </option>
                    ))}
                  </select>
                  {s.carry && multi && (
                    <select className="fld bd-in bs-sel2" aria-label="이월 사업 값이 들어갈 재원" value={s.carrySrc || s.sources[0]} onChange={(e) => setS({ ...s, carrySrc: e.target.value })}>
                      {s.sources.map((x) => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <div className="bss-sec">
                <span className="bs-lab">매칭</span>
                <div className="bss-match">
                  {!multi ? (
                    <div className="bs-hint bss-note">재원이 하나라 집행현황의 예산·집행액이 그대로 {s.sources[0]} 줄에 들어가요.</div>
                  ) : items.length <= 1 ? (
                    <div className="bs-hint bss-note">부기사업이 {items.length ? "하나뿐이라" : "없어서"} 재원별로 나눌 수 없어요 – 예산현황에서 재원 줄의 예산·집행액을 직접 적어요. 집행현황에서 부기사업을 재원별로 나누면 저절로 들어가요.</div>
                  ) : (
                    <>
                      <div className="bs-hint bss-note">부기사업마다 재원을 고르면 그 예산·집행액이 재원 줄에 저절로 들어가요.</div>
                      {items.map((it) => (
                        <div key={it.id} className="bss-item">
                          <span className="bss-item-name" title={it.name}>{it.name}</span>
                          <span className="bss-item-num">{(it.budget ?? 0).toLocaleString("ko-KR")}</span>
                          <span className="bd-unit bss-pick" role="group" aria-label={it.name + " 재원"}>
                            {s.sources.map((x) => (
                              <button key={x} type="button" className={matchOf(it.name) === x ? "on" : ""} aria-pressed={matchOf(it.name) === x} onClick={() => setMatch(it.name, x)}>
                                {x}
                              </button>
                            ))}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        <div className="dialog-foot bss-foot">
          {onRemove ? (
            <button type="button" className="btn btn-ctrl btn-text bss-remove" onClick={onRemove}>예산현황에서 빼기</button>
          ) : (
            <span />
          )}
          <span className="bss-btns">
            <button type="button" className="btn btn-ctrl btn-text" onClick={onClose}>취소</button>
            <button type="button" className="btn-primary btn-ctrl" disabled={carry && mode === "attach" && !parent} onClick={save}>
              {setup ? "저장" : "보내기"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
