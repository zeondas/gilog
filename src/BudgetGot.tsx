/**
 * 집행현황 팀 공유 – "받은 것" 창(2026-10-26 사용자 1안 시안·①2안, 대기 목록 "집행현황" ✔1, 시안 캔버스 BudgetShare ⑦⑧).
 * 관리·보기 창이라 위 오른쪽 ×만. 한 줄 = 누가 · 줄(세부사업 › 공사) · 칸 · 옛 값 → 새 값 · 시각.
 * 위에 사람별 거르기 칩, 줄을 누르면 창을 닫고 표의 그 줄로. 내 PC에 최근 7일까지 둔 것을 보여요.
 */
import { useEffect, useMemo, useState } from "react";
import { DialogX } from "./DialogX";
import { overlayDown } from "./useOutsideClose";
import { memoToText } from "./budget";
import { FIELD_KO, Got, loadGot, Person, personColor, shortTime } from "./budgetShare";

const MONEY = new Set(["budget", "cmt", "exp", "act"]);
const WD = ["일", "월", "화", "수", "목", "금", "토"];

export function gotValue(g: Got, v: string, people: Person[]): string {
  if (v === "") return "(빈칸)";
  if (MONEY.has(g.field) && /^-?\d+$/.test(v)) return Number(v).toLocaleString("ko-KR");
  if (g.field === "owner") return people.find((p) => String(p.no) === v)?.name || "(빈칸)";
  if (g.field === "carry") return v ? "이월" : "(빈칸)";
  if (g.field === "memo") return memoToText(v).replace(/\s+/g, " ").trim() || "(빈칸)";
  return v;
}

const dayHead = (d: string) => {
  const t = new Date(d + "T00:00:00");
  return `${d.slice(5, 7)}-${d.slice(8, 10)} (${WD[t.getDay()]})`;
};

export function BudgetGot({ people, onClose, onJump }: { people: Person[]; onClose: () => void; onJump: (g: Got) => void }) {
  const [list, setList] = useState<Got[] | null>(null);
  const [who, setWho] = useState<number | null>(null);
  useEffect(() => {
    loadGot().then(setList, () => setList([]));
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  // 새로고침 최근 것부터, 같은 새로고침 안에서는 고친 시각 최근 것부터
  const all = useMemo(() => [...(list ?? [])].sort((a, b) => b.at.localeCompare(a.at) || b.when.localeCompare(a.when)), [list]);
  const name = (no: number) => people.find((p) => p.no === no)?.name || "누군가";
  const byWho = useMemo(() => {
    const m = new Map<number, number>();
    for (const g of all) m.set(g.who, (m.get(g.who) ?? 0) + 1);
    return [...m];
  }, [all]);
  const shown = who == null ? all : all.filter((g) => g.who === who);
  // 날짜별 묶음(새로고침한 날 – 최근 것부터)
  const days: [string, Got[]][] = [];
  for (const g of shown) {
    const d = g.at.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last[0] === d) last[1].push(g);
    else days.push([d, [g]]);
  }
  const badge = (no: number) => {
    const c = personColor(no);
    return (
      <span
        className="bs-own bg-who"
        style={{
          background: `var(--pj-${c}-bg)`,
          color: `var(--pj-${c}-fg)`,
          borderColor: `var(--pj-${c}-line)`,
        }}
      >
        {[...name(no)].slice(0, 3).join("")}
      </span>
    );
  };
  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div className="dialog bg-dlg" role="dialog" aria-modal="true" aria-label="받은 것">
        <DialogX onClick={onClose} autoFocus />
        <div className="bg-head">
          <h2 className="dialog-title">받은 것 {all.length}칸</h2>
          <span className="bg-sub">최근 7일 · 다른 사람이 고쳐 새로고침으로 받은 칸</span>
        </div>
        {byWho.length > 1 && (
          <div className="bg-chips" role="group" aria-label="사람별로 보기">
            <button type="button" className={"bg-chip" + (who == null ? " on" : "")} aria-pressed={who == null} onClick={() => setWho(null)}>
              전체 {all.length}
            </button>
            {byWho.map(([no, n]) => (
              <button key={no} type="button" className={"bg-chip" + (who === no ? " on" : "")} aria-pressed={who === no} onClick={() => setWho(no)}>
                {name(no)} {n}
              </button>
            ))}
          </div>
        )}
        <div className="bg-list" role="list">
          {list && !all.length && <div className="bg-empty">최근 7일 동안 받은 것이 없어요</div>}
          {days.map(([d, gs]) => (
            <div key={d} className="bg-day">
              <div className="bg-dh">{dayHead(d)}</div>
              {gs.map((g, i) => (
                <button
                  key={d + i}
                  type="button"
                  role="listitem"
                  className="bg-row"
                  title={g.field === "del" ? "지운 줄 – 표에는 없어요" : "표의 이 줄로 가기"}
                  onClick={() => onJump(g)}
                >
                  {badge(g.who)}
                  <span className="bg-path" title={g.path}>{g.path || "(이름 없음)"}</span>
                  <span className="bg-f">{g.field === "new" ? "" : g.field === "del" ? "" : (FIELD_KO[g.field] ?? g.field)}</span>
                  <span className="bg-v">
                    {g.field === "new" ? (
                      <b className="bg-new">새 줄</b>
                    ) : g.field === "del" ? (
                      <b className="bg-del">지운 줄</b>
                    ) : (
                      <>
                        <span className="bg-old">{gotValue(g, g.old, people)}</span>
                        <span className="bg-ar" aria-label="에서">
                          →
                        </span>
                        <span className="bg-nv">{gotValue(g, g.val, people)}</span>
                      </>
                    )}
                  </span>
                  <span className="bg-t">{shortTime(g.when || g.at)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
