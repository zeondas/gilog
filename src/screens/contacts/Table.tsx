// 업무연락처 목록·카드 – 왼쪽 사업 목록(ProjectList)·보기 카드(ViewCard). 화면 몸통은 Screen.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { BulletView } from "../../BulletParts";
import { koIndex } from "../../journal";
import { api, Contact, Project, ProjectGroup } from "../../api";
import { MemoEditor } from "./Dialogs";
import { MemoLine, parseMemo, projectColor, pjLabel, pjFull, pjStyle, Hl, copyText, koSort, pjSections, useFolded, FoldArrow } from "./parts";

// ---------- 왼쪽 프로젝트 목록 (2026-10-19 사용자 1안, 시안 ProjectFilter) ----------

const SORT_KEY = "contacts.projectSort";

/** 프로젝트가 많아도 한 칸에 세로로 쌓여요. 가나다/많은 순, 찾기, 그룹별로 접고 펴기(2026-10-19 사용자). */
export function ProjectList({ projects, groups, contacts, sel, onSel }: { projects: Project[]; groups: ProjectGroup[]; contacts: Contact[]; sel: number | null; onSel: (id: number | null) => void }) {
  const [sort, setSort] = useState<"name" | "count">("name");
  const [pq, setPq] = useState("");
  const [folded, toggle] = useFolded();
  useEffect(() => {
    api.get(SORT_KEY).then((v) => v === "count" && setSort("count"), () => {});
  }, []);
  const pick = (v: "name" | "count") => {
    setSort(v);
    api.set(SORT_KEY, v).catch(() => {});
  };
  const count = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of contacts) for (const id of c.projects) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  }, [contacts]);
  const ql = pq.trim().toLowerCase();
  const order = (list: Project[]) =>
    list
      .filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.alias.toLowerCase().includes(ql) || (/[ㄱ-ㅎ]/.test(ql) && koIndex(pjLabel(p), ql) >= 0))
      .sort((a, b) => (sort === "count" ? (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) : 0) || koSort(a, b));
  const row = (p: Project, zero: boolean) => (
    <button key={p.id} type="button" className={"ct-pj" + (zero ? " ct-pj-z" : "")} aria-pressed={sel === p.id} title={pjFull(p)} onClick={() => onSel(p.id)}>
      <span className="ct-pj-dot" aria-hidden="true" style={{ background: `var(--pj-${projectColor(p)}-line)` }} />
      <span className="ct-pj-t">{pjLabel(p)}</span>
      <span className="ct-pj-n">{count.get(p.id) ?? 0}</span>
    </button>
  );
  const flat = groups.length === 0;
  const sections = pjSections(projects, groups);
  let shown = 0;
  return (
    <aside className="ct-side" aria-label="사업으로 거르기">
      <div className="ct-side-head">
        <div className="ct-side-top">
          <span className="ct-side-label">사업 {projects.length}</span>
          <span className="ct-sort" role="group" aria-label="정렬">
            <button type="button" aria-pressed={sort === "name"} onClick={() => pick("name")}>가나다</button>
            <button type="button" aria-pressed={sort === "count"} onClick={() => pick("count")}>많은 순</button>
          </span>
        </div>
        <input className="input" aria-label="사업 찾기" placeholder="사업 찾기" value={pq} onChange={(e) => setPq(e.target.value)} onKeyDown={(e) => e.key === "Escape" && pq && (e.preventDefault(), setPq(""))} />
      </div>
      <div className="ct-side-list">
        <button type="button" className="ct-pj ct-pj-all" aria-pressed={sel === null} onClick={() => onSel(null)}>
          <span className="ct-pj-t">전체</span>
          <span className="ct-pj-n">{contacts.length}</span>
        </button>
        <div className="ct-side-div" />
        {sections.map((sec) => {
          const list = order(sec.projects);
          if (!list.length) return null;
          shown += list.length;
          const used = list.filter((p) => count.get(p.id));
          const empty = list.filter((p) => !count.get(p.id));
          if (flat)
            return (
              <div key={sec.key}>
                {used.map((p) => row(p, false))}
                {empty.length > 0 && <div className="ct-side-sub">연락처 없음</div>}
                {empty.map((p) => row(p, true))}
              </div>
            );
          // 찾는 중에는 접힌 그룹도 펴서 보여요.
          const open = !!ql || !folded.has(sec.key);
          const people = contacts.filter((c) => c.projects.some((id) => list.some((p) => p.id === id))).length;
          return (
            <div key={sec.key} className="ct-grp">
              <button type="button" className="ct-grp-h" aria-expanded={open} onClick={() => toggle(sec.key)}>
                <FoldArrow open={open} />
                <span className="ct-pj-t">{sec.name}</span>
                <span className="ct-pj-n">{people}</span>
              </button>
              {open && [...used.map((p) => row(p, false)), ...empty.map((p) => row(p, true))]}
            </div>
          );
        })}
        {shown === 0 && <p className="ct-side-none">맞는 사업이 없어요</p>}
      </div>
    </aside>
  );
}

type ViewProps = {
  vi?: number;
  contact: Contact;
  byId: Map<number, Project>;
  q: string;
  memoOpen: boolean;
  onEdit: () => void;
  onMemoOpen: () => void;
  onMemoClose: () => void;
  onMemoSave: (lines: MemoLine[]) => void;
};

export function ViewCard({ vi, contact: c, byId, q, memoOpen, onEdit, onMemoOpen, onMemoClose, onMemoSave }: ViewProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const memo = parseMemo(c.memo);
  const lines = (
    [
      ["무선", c.mobile],
      ["유선", c.tel],
      ["메일", c.email],
    ] as const
  ).filter(([, v]) => v);
  const projs = c.projects.map((id) => byId.get(id)).filter((p): p is Project => !!p);

  async function copy(kind: string, value: string) {
    await copyText(value);
    setCopied(kind);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1400);
  }

  return (
    <article
      className="ccard"
      data-vi={vi}
      aria-label={c.name}
      onDoubleClick={(e) => {
        // 복사되는 번호·메일 줄, 메모, 단추는 빼고 카드를 두 번 누르면 고치는 카드(2026-10-18 사용자)
        if ((e.target as Element).closest("button, input, textarea, .ccard-memo")) return;
        window.getSelection()?.removeAllRanges();
        onEdit();
      }}
    >
      <div className="ccard-band">
        <div className="ccard-top">
          <div className="ccard-name">
            <span className="ccard-n">
              <Hl text={c.name} q={q} />
            </span>
            {c.role && (
              <span className="ccard-role">
                <Hl text={c.role} q={q} />
              </span>
            )}
          </div>
          <span className="ccard-tools">
            <button type="button" className="tool" aria-label={`${c.name} 고치기`} title="이 연락처 고치기" onClick={onEdit}>
              <Pencil />
            </button>
          </span>
        </div>
        {c.org && (
          <div className="ccard-org">
            <Hl text={c.org} q={q} />
          </div>
        )}
      </div>

      {(projs.length > 0 || lines.length > 0) && (
        <div className="ccard-body">
          {projs.length > 0 && (
            <div className="ccard-projs">
              {projs.map((p) => (
                <span key={p.id} className="pbadge" style={pjStyle(p)} title={pjFull(p)}>
                  <span className="pbadge-t">
                    <Hl text={pjLabel(p)} q={q} />
                  </span>
                </span>
              ))}
            </div>
          )}
          {lines.length > 0 && (
            <div className="ccard-lines">
              {lines.map(([kind, value]) => (
                <button
                  key={kind}
                  type="button"
                  className={"cline" + (copied === kind ? " copied" : "")}
                  aria-label={`${kind} ${value} 복사`}
                  title="눌러서 복사"
                  onClick={() => copy(kind, value)}
                >
                  <span className="cline-kind">{kind}</span>
                  <span className="cline-v">
                    <Hl text={value} q={q} />
                  </span>
                  <span className="cline-note" aria-live="polite">
                    {copied === kind ? "복사했어요" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={"ccard-memo" + (memo.length || memoOpen ? " lined" : "")}>
        {memoOpen ? (
          <MemoEditor initial={memo} onCancel={onMemoClose} onSave={onMemoSave} />
        ) : memo.length ? (
          <button type="button" className="memo-view" title="두 번 눌러서 메모 편집" onDoubleClick={onMemoOpen} onKeyDown={(e) => e.key === "Enter" && onMemoOpen()}>
            <BulletView lines={memo} render={(m) => <Hl text={m.t} q={q} />} />
          </button>
        ) : (
          <button type="button" className="memo-add" onClick={onMemoOpen}>
            메모 추가
          </button>
        )}
      </div>
    </article>
  );
}

function Pencil() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
