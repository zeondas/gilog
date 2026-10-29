// 집행현황 창·칸 – 받은 것 창(BudgetGot, 전엔 src/BudgetGot.tsx)·사업명 고르기 칸(SuggestInput, 전엔 src/BudgetSuggest.tsx). 화면 몸통은 Screen.tsx.
import { KeyboardEvent as RKeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Contact, ContactsData, Project } from "../../api";
import { DialogX } from "../../DialogX";
import { overlayDown } from "../../useOutsideClose";
import { memoToText } from "../../budget";
import { FIELD_KO, Got, loadGot, Person, personColor, shortTime } from "../../budgetShare";
import { useJamoGuard } from "../../koInput";
import { findNames } from "../../paju";

/**
 * 집행현황 팀 공유 – "받은 것" 창(2026-10-26 사용자 1안 시안·①2안, 대기 목록 "집행현황" ✔1, 시안 캔버스 BudgetShare ⑦⑧).
 * 관리·보기 창이라 위 오른쪽 ×만. 한 줄 = 누가 · 줄(세부사업 › 공사) · 칸 · 옛 값 → 새 값 · 시각.
 * 위에 사람별 거르기 칩, 줄을 누르면 창을 닫고 표의 그 줄로. 내 PC에 최근 7일까지 둔 것을 보여요.
 */

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

/**
 * 집행현황 공사 줄 – 업무연락처에서 공사명·업체 불러오기(2026-10-26 사용자 ①1안·②1안·③1안, 대기 목록 "집행현황" ✔2).
 * 목록에 없는 글도 그대로 받는 칸 + 아래 후보 목록. ↑↓ 고르기 · Tab 확정(다음 칸으로) · Enter 확정(머묾) · Esc 친 그대로.
 * 표 칸은 넘치는 것을 잘라서(overflow hidden) 목록은 문서 맨 위(포털)에 화면 기준(fixed)으로 칸 바로 아래에 띄워요.
 * 목록은 줄 밖에 있어 바깥 누르기(저장)가 되지 않게 .bd-pop 표시를 함께 달아요.
 * 글자만 복사해요 – 업무연락처와 이어 두지 않아요.
 */

export type Suggest = { key: string; label: string; sub?: string };

const isComposing = (e: RKeyboardEvent) =>
  e.nativeEvent.isComposing || e.keyCode === 229;

/** "(주)"·"㈜"·"주식회사"를 떼고 띄어쓰기 정리 */
export const plainOrg = (s: string) =>
  s
    .replace(/\(\s*주\s*\)|㈜|주식회사/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** 이 사업에 묶인 연락처의 업체(겹친 것 하나로, 처음 나온 순서) – 오른쪽 작은 글은 "이름 직함" */
export function orgsOf(data: ContactsData | null, pid: number): Suggest[] {
  if (!data) return [];
  const out = new Map<string, Contact[]>();
  for (const c of data.contacts) {
    if (!c.projects.includes(pid)) continue;
    const o = plainOrg(c.org ?? "");
    if (!o) continue;
    out.set(o, [...(out.get(o) ?? []), c]);
  }
  return [...out].map(([o, cs]) => ({
    key: o,
    label: o,
    sub:
      cs
        .slice(0, 2)
        .map((c) => [c.name, c.role].filter(Boolean).join(" "))
        .join(", ") + (cs.length > 2 ? ` 외 ${cs.length - 2}` : ""),
  }));
}

/** 공사명 칸 후보 – 줄인 이름·정식 이름 어느 쪽으로 시작해도(초성도) 맞아요. 12개까지 */
export function projectHits(data: ContactsData | null, q: string): Project[] {
  if (!data || !q.trim()) return [];
  const short = (p: Project) => p.alias || p.name;
  const seen = new Set<number>();
  const out: Project[] = [];
  for (const p of [
    ...findNames(q, data.projects, short),
    ...findNames(q, data.projects, (x) => x.name),
  ]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  // 이미 그 이름 그대로면 띄우지 않아요.
  if (out.length === 1 && short(out[0]) === q.trim()) return [];
  return out.slice(0, 12);
}

export function projectSub(data: ContactsData | null, p: Project): string {
  const orgs = orgsOf(data, p.id);
  const co = orgs.length
    ? `업체 ${orgs[0].label}${orgs.length > 1 ? ` 외 ${orgs.length - 1}` : ""}`
    : "";
  const full = p.alias && p.alias !== p.name ? p.name : "";
  return [co, full].filter(Boolean).join(" · ");
}

export function SuggestInput({
  value,
  label,
  className,
  options,
  hint,
  openOnFocus,
  onChange,
  onPick,
}: {
  value: string;
  label: string;
  className: string;
  options: Suggest[];
  hint: string;
  /** 칸에 들어오면 글이 없어도 목록을 열어요(업체 후보가 여럿일 때) */
  openOnFocus?: boolean;
  onChange: (v: string) => void;
  onPick: (s: Suggest) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    minW: number;
  } | null>(null);
  const inp = useRef<HTMLInputElement>(null);
  const guard = useJamoGuard((v) => {
    onChange(v);
    setOpen(true);
    setHi(0);
  });
  guard.follow(value);
  const show = open && options.length > 0;
  const cur = Math.min(hi, options.length - 1);

  useLayoutEffect(() => {
    if (!show || !inp.current) return;
    const r = inp.current.getBoundingClientRect();
    const next = {
      left: Math.round(r.left),
      top: Math.round(r.bottom + 4),
      minW: Math.round(r.width),
    };
    setBox((b) =>
      b && b.left === next.left && b.top === next.top && b.minW === next.minW
        ? b
        : next,
    );
  });

  // 표를 굴리면 칸이 움직이니 목록은 닫아요.
  useEffect(() => {
    if (!show) return;
    const close = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest(".bd-sug"))) setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [show]);

  function pick(s: Suggest) {
    guard.sync(s.label);
    onPick(s);
    setOpen(false);
  }

  return (
    <>
      <input
        ref={inp}
        className={className}
        aria-label={label}
        placeholder={label}
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        value={value}
        onChange={guard.onChange}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={() => {
          setHi(0);
          if (openOnFocus) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e)) return;
          if (!show) {
            if (e.key === "ArrowDown" && options.length) {
              e.preventDefault();
              setOpen(true);
            }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((cur + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi(cur <= 0 ? options.length - 1 : cur - 1);
          } else if (e.key === "Tab" && !e.shiftKey) {
            // 확정하고 줄의 다음 칸으로(줄 키가 옮겨요)
            pick(options[cur]);
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            pick(options[cur]);
          } else if (e.key === "Escape") {
            // 친 그대로 두고 목록만 닫아요(줄 취소 아님)
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show &&
        box &&
        createPortal(
          <div
            className="pin-list bd-sug bd-pop"
            role="listbox"
            style={{
              left: box.left,
              top: box.top,
              minWidth: Math.max(box.minW, 320),
            }}
          >
            {options.map((o, i) => (
              <div
                key={o.key}
                role="option"
                aria-selected={i === cur}
                className="pin-opt pin-place"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                <b>{o.label}</b>
                {o.sub && <span className="pin-sub">{o.sub}</span>}
              </div>
            ))}
            <div className="pin-hint">{hint}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
