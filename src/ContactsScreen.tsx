// 업무연락처 화면이에요. 시안 Contacts.dc.html과 사양서의 "업무연락처" 절을 따라요.
import { KeyboardEvent, MutableRefObject, RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ExcelMenu } from "./ExcelMenu";
import { ProjectImport, contactImports, contactRows, samePerson } from "./excel";
import { DelIcon, TrashIcon } from "./Icons";
import { VirtualList } from "./VirtualList";
import { overlayDown, useOutsideClose } from "./useOutsideClose";
import { BLine, CYCLE, isBlank, kindOf, layout, newLineFor, NewLineMode, parseLines, stringifyLines, TRIGGERS, withKind } from "./bullets";
import { isKey, keyAction, rowKeys } from "./keys";
import { BulletView, Mark } from "./BulletParts";
import { koIndex } from "./journal";
import { useJamoGuard } from "./koInput";
import { PhoneInput } from "./PhoneInput";
import { finalizePhone } from "./phone";
import { api, Contact, ContactInput, ContactsData, errorText, Project, ProjectGroup } from "./api";
import { AskBand } from "./AskBand";

// ---------- 메모 ----------
// 메모 한 줄은 머릿기호 규칙(bullets.ts)의 줄 모양이에요. b 굵게, s 취소선, k 머릿기호 종류.

export type MemoLine = BLine;

/** 저장된 메모를 줄 목록으로. 예전 모양(nb, 줄바꿈 글자)도 읽어요. */
export const parseMemo = (memo: string): MemoLine[] => parseLines(memo);

export const memoText = (lines: MemoLine[]): string => stringifyLines(lines);

// ---------- 프로젝트 색 ----------

const COLOR_NAMES = ["회색", "파랑", "주황", "초록", "자주", "청록", "분홍", "노랑"];

export function projectColor(p: Project): number {
  return p.color ?? (p.id - 1) % COLOR_NAMES.length;
}

/** 화면에 보이는 이름: 줄인 이름(관리용)이 있으면 그것, 없으면 정식 이름. */
export const pjLabel = (p: Project) => p.alias || p.name;

/** 문서(지시부·엑셀·인쇄)에 쓰는 이름: 정식 이름. 줄인 이름만 적었으면 줄인 이름이 들어 있어요. */
export const pjFull = (p: Project) => p.name;

/** 정식 이름 칸에 보일 글자. 줄인 이름만 적은 프로젝트는 비어 보여요. */
const fullDraft = (p: Project) => (p.alias && p.alias === p.name ? "" : p.name);

/** 정식 이름이 따로 있어서 줄인 이름과 다르면 그 정식 이름(마우스를 올리면 보여요). */
const pjOther = (p: Project) => (p.alias && p.alias !== p.name ? p.name : "");

export function pjStyle(p: Project) {
  const k = projectColor(p);
  return { background: `var(--pj-${k}-bg)`, color: `var(--pj-${k}-fg)`, boxShadow: `inset 0 0 0 1px var(--pj-${k}-line)` };
}

// ---------- 공통 ----------

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

const EMPTY: ContactInput = { name: "", org: "", role: "", mobile: "", tel: "", email: "", projects: [] };


/** 검색에 맞은 글자를 형광으로 칠해요. */
export function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  let at = lower.indexOf(q);
  while (at >= 0 && q) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>);
    i = at + q.length;
    at = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    /* 아래 방법으로 한 번 더 해요 */
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

// ---------- 화면 ----------

export default function ContactsScreen() {
  const [data, setData] = useState<ContactsData | null>(null);
  const [q, setQ] = useState("");
  // 이름 초성으로 찾을 때 입력기가 자음을 묶지 않게 해요(ㄳ→ㄱㅅ, Shift 없이 친 ㅆ→ㅅㅅ).
  const qGuard = useJamoGuard(setQ);
  const [sel, setSel] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [memoId, setMemoId] = useState<number | null>(null);
  const [askId, setAskId] = useState<number | null>(null);
  const [projOpen, setProjOpen] = useState(false);
  const [note, setNote] = useState("");
  // 카드는 보이는 만큼만 그려요(2026-10-21 속도 최적화 – 연락처가 많으면 스크롤이 밀린다고 함).
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState(0);

  useEffect(() => {
    api.contactsData().then(setData, (e) => setNote(errorText(e)));
  }, []);

  // 카드 폭이 바뀌면(창 크기·왼쪽 목록 폭) 줄바꿈이 달라져 재 둔 높이를 버려요.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setGridW(Math.round(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data === null]);

  /** 저장 쪽을 부르고 돌아온 자료로 다시 그려요. 실패하면 이유를 보여 주고 false를 돌려줘요. */
  const run = useCallback(async (p: Promise<ContactsData>) => {
    try {
      setData(await p);
      setNote("");
      return true;
    } catch (e) {
      setNote(errorText(e));
      return false;
    }
  }, []);

  const projects = data?.projects ?? [];
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const all = data?.contacts ?? [];

  // 고른 프로젝트가 지워졌으면 전체로 돌아가요.
  useEffect(() => {
    if (sel !== null && !byId.has(sel)) setSel(null);
  }, [sel, byId]);

  const query = q.trim().toLowerCase();
  const shown = all.filter((c) => {
    if (sel !== null && !c.projects.includes(sel)) return false;
    if (!query) return true;
    const memo = parseMemo(c.memo).map((l) => l.t).join(" ");
    const hay = [c.name, c.org, c.role, c.mobile, c.tel, c.email, memo, ...c.projects.flatMap((id) => { const p = byId.get(id); return p ? [p.name, p.alias] : []; })]
      .join("\n")
      .toLowerCase();
    if (hay.includes(query)) return true;
    // 이름은 초성으로도 찾아요("ㅂㅈㅎ", "박ㅈ").
    if (/[ㄱ-ㅎ]/.test(query) && koIndex(c.name, query) >= 0) return true;
    // 번호는 줄표 없이 쳐도 찾아요.
    const digits = query.replace(/[^0-9]/g, "");
    return digits.length >= 3 && digits === query.replace(/[-\s]/g, "") && [c.mobile, c.tel].some((n) => n.replace(/[^0-9]/g, "").includes(digits));
  });

  if (!data) {
    return (
      <>
        <h1 className="title">업무연락처</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  return (
    <>
      <div className="ct-head tb5">
        <h1 className="title">업무연락처</h1>
        <button type="button" className="btn btn-ctrl btn-text tb-pop" onClick={() => setProjOpen(true)}>
          사업 관리
        </button>
        <label className="search">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            aria-label="연락처 검색"
            placeholder="이름, 소속, 번호 검색"
            value={q}
            onKeyDown={qGuard.onKeyDown}
            onChange={qGuard.onChange}
            onCompositionEnd={qGuard.onCompositionEnd}
          />
        </label>
        <ExcelMenu
          kind="contacts"
          total={all.length}
          build={() => ({ rows: contactRows(all, projects, data.groups ?? []), intake: [], status: [] })}
          parse={(sheet) => [contactImports(sheet)]}
          count={(rows) => rows[0]?.contacts.length ?? 0}
          note={(sheet) => {
            const r = contactImports(sheet);
            const same = r.contacts.filter((c) => all.some((x) => samePerson(x, c))).length;
            const n = r.projects.length;
            return [same ? `이미 있는 사람 ${same}명은 새로 만들지 않고 프로젝트만 붙여요` : "", n ? `프로젝트 ${n}개의 축약 공사명·그룹·색도 맞춰요` : ""]
              .filter(Boolean)
              .join(" · ");
          }}
          onImport={async ([r]) => {
            // 프로젝트(숨긴 열의 그룹·축약 공사명·색)를 먼저 넣어야 연락처의 프로젝트 칸이 그 프로젝트로 이어져요.
            await importProjects(r.projects);
            await api.importContacts(r.contacts);
            setData(await api.contactsData());
            // "N건을 가져왔어요" – 묻는 창의 N건과 같게(이미 있는 사람에게 프로젝트만 붙인 것도 셈)
            return r.contacts.length;
          }}
        />
      </div>

      <div className="ct-body">
      <ProjectList projects={projects} groups={data.groups ?? []} contacts={all} sel={sel} onSel={setSel} />
      <div className="ct-main">
      {note && <p className="note" role="status">{note}</p>}

      <NewRow projects={projects} groups={data.groups ?? []} onAdd={(c) => run(api.addContact(c))} />

      <div className="ct-grid" ref={gridRef}>
        <VirtualList
          grid
          parentRef={gridRef}
          count={shown.length}
          getKey={(i) => shown[i].id}
          estimate={(i) => cardEstimate(shown[i])}
          pinned={[editId, askId, memoId].map((id) => (id == null ? null : shown.findIndex((c) => c.id === id)))}
          resetKey={gridW}
          render={(i) => {
            const c = shown[i];
            return (
                editId === c.id ? (
                  <EditCard
                    vi={i}
                    groups={data.groups ?? []}
                    contact={c}
                    byId={byId}
                    projects={projects}
                    onCancel={() => setEditId(null)}
                    onSave={async (input) => {
                      if (await run(api.updateContact(c.id, input))) setEditId(null);
                    }}
                  />
                ) : (
                  <ViewCard
                    vi={i}
                    contact={c}
                    byId={byId}
                    q={query}
                    asking={askId === c.id}
                    memoOpen={memoId === c.id}
                    onEdit={() => {
                      setAskId(null);
                      setMemoId(null);
                      setEditId(c.id);
                    }}
                    onAsk={(on) => setAskId(on ? c.id : null)}
                    onRemove={async () => {
                      setAskId(null);
                      if (memoId === c.id) setMemoId(null);
                      await run(api.deleteContact(c.id));
                    }}
                    onMemoOpen={() => {
                      setEditId(null);
                      setMemoId(c.id);
                    }}
                    onMemoClose={() => setMemoId(null)}
                    onMemoSave={async (lines) => {
                      setMemoId(null);
                      const text = memoText(lines);
                      if (text !== c.memo) await run(api.setContactMemo(c.id, text));
                    }}
                  />
                )
            );
          }}
        />
      </div>

      {all.length === 0 ? (
        <p className="muted small">아직 연락처가 없어요. 위 줄에 이름부터 적고 Enter를 눌러 등록해요.</p>
      ) : shown.length === 0 ? (
        <p className="muted small">맞는 연락처가 없어요.</p>
      ) : null}
      </div>
      </div>

      {projOpen && <ProjectDialog data={data} run={run} onClose={() => setProjOpen(false)} />}
    </>
  );
}

// ---------- 왼쪽 프로젝트 목록 (2026-10-19 사용자 1안, 시안 ProjectFilter) ----------

const SORT_KEY = "contacts.projectSort";
const koSort = (a: Project, b: Project) => pjLabel(a).localeCompare(pjLabel(b), "ko", { numeric: true });

/** 프로젝트가 많아도 한 칸에 세로로 쌓여요. 가나다/많은 순, 찾기, 0명은 맨 아래 "연락처 없음". */
/** 그룹 묶음(그룹 순서대로, "그룹 없음"은 맨 뒤). 그룹이 하나도 없으면 묶음 하나(key "none")예요. */
export type PjSection = { key: string; name: string; id: number | null; projects: Project[] };
export function pjSections(projects: Project[], groups: ProjectGroup[]): PjSection[] {
  const known = new Set(groups.map((g) => g.id));
  const out: PjSection[] = groups.map((g) => ({ key: String(g.id), name: g.name, id: g.id, projects: projects.filter((p) => p.group === g.id) }));
  out.push({ key: "none", name: "그룹 없음", id: null, projects: projects.filter((p) => p.group == null || !known.has(p.group)) });
  return out;
}

const FOLD_KEY = "contacts.foldedGroups";
/** 접은 그룹(왼쪽 목록·관리 창이 같이 써요). */
function useFolded(): [Set<string>, (key: string) => void] {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.get(FOLD_KEY).then((v) => {
      try {
        if (v) setFolded(new Set(JSON.parse(v) as string[]));
      } catch {
        /* 예전 값은 무시해요 */
      }
    }, () => {});
  }, []);
  const toggle = (key: string) =>
    setFolded((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      api.set(FOLD_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  return [folded, toggle];
}

const FoldArrow = ({ open }: { open: boolean }) => (
  <svg className="grp-arrow" aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} />
  </svg>
);

/** 프로젝트가 많아도 한 칸에 세로로 쌓여요. 가나다/많은 순, 찾기, 그룹별로 접고 펴기(2026-10-19 사용자). */
function ProjectList({ projects, groups, contacts, sel, onSel }: { projects: Project[]; groups: ProjectGroup[]; contacts: Contact[]; sel: number | null; onSel: (id: number | null) => void }) {
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
    <aside className="ct-side" aria-label="프로젝트로 거르기">
      <div className="ct-side-head">
        <div className="ct-side-top">
          <span className="ct-side-label">프로젝트 {projects.length}</span>
          <span className="ct-sort" role="group" aria-label="정렬">
            <button type="button" aria-pressed={sort === "name"} onClick={() => pick("name")}>가나다</button>
            <button type="button" aria-pressed={sort === "count"} onClick={() => pick("count")}>많은 순</button>
          </span>
        </div>
        <input className="input" aria-label="프로젝트 찾기" placeholder="프로젝트 찾기" value={pq} onChange={(e) => setPq(e.target.value)} onKeyDown={(e) => e.key === "Escape" && pq && (e.preventDefault(), setPq(""))} />
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
        {shown === 0 && <p className="ct-side-none">맞는 프로젝트가 없어요</p>}
      </div>
    </aside>
  );
}

// ---------- 신규 입력 줄 ----------

const FIELDS: { key: Exclude<keyof ContactInput, "projects">; label: string; ph: string; num?: boolean }[] = [
  { key: "name", label: "이름", ph: "이름" },
  { key: "org", label: "소속", ph: "소속" },
  { key: "role", label: "직위", ph: "직위" },
  { key: "mobile", label: "무선", ph: "010-", num: true },
  { key: "tel", label: "유선", ph: "031-", num: true },
  { key: "email", label: "이메일", ph: "이메일" },
];

function NewRow({ projects, groups, onAdd }: { projects: Project[]; groups: ProjectGroup[]; onAdd: (c: ContactInput) => Promise<boolean> }) {
  const [v, setV] = useState({ ...EMPTY, proj: [] as string[] });
  const [warn, setWarn] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const pending = useRef("");

  // 화면을 열면 첫 칸에 커서가 가 있어요.
  useEffect(() => nameRef.current?.focus(), []);

  async function submit() {
    if (!v.name.trim()) {
      setWarn(true);
      nameRef.current?.focus();
      return;
    }
    const { proj, ...rest } = v;
    if (await onAdd({ ...rest, mobile: finalizePhone(rest.mobile), tel: finalizePhone(rest.tel), projects: projectsToSave(projects, proj, pending.current) })) {
      setV({ ...EMPTY, proj: [] });
      setWarn(false);
      nameRef.current?.focus();
    }
  }

  // 엔터규칙: Tab·Enter 다음 칸, 마지막 칸(프로젝트)이면 등록
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    rowKeys(e, e.currentTarget, submit);
  }

  return (
    <div className="ct-new" role="table" aria-label="새 연락처 입력">
      <div className="ct-new-in">
        <div role="row" className="ct-new-head">
          <div role="columnheader" />
          {FIELDS.map((f) => (
            <div role="columnheader" key={f.key}>
              {f.label}
            </div>
          ))}
          <div role="columnheader">프로젝트</div>
          <div role="columnheader" />
        </div>
        <div role="row" className="ct-new-row" onKeyDown={onKeyDown}>
          <div role="cell" className="ct-new-tag">
            신규
          </div>
          {FIELDS.map((f) => (
            <div role="cell" key={f.key}>
              {f.num ? (
                <PhoneInput
                  name={f.key}
                  aria-label={f.label}
                  placeholder={f.ph}
                  className="cell-input num"
                  value={v[f.key]}
                  onChange={(x) => setV((old) => ({ ...old, [f.key]: x }))}
                />
              ) : (
              <input
                ref={f.key === "name" ? nameRef : undefined}
                name={f.key}
                aria-label={f.label}
                placeholder={f.ph}
                className={"cell-input" + (f.num ? " num" : "") + (f.key === "name" && warn ? " invalid" : "")}
                aria-invalid={f.key === "name" && warn ? true : undefined}
                value={v[f.key]}
                onChange={(e) => {
                  if (f.key === "name") setWarn(false);
                  setV({ ...v, [f.key]: e.target.value });
                }}
              />
              )}
            </div>
          ))}
          <div role="cell">
            <ProjectChips projects={projects} groups={groups} value={v.proj} onChange={(proj) => setV((old) => ({ ...old, proj }))} pending={pending} />
          </div>
          <div role="cell" className="ct-new-add">
            <button type="button" className="btn-icon btn-add" aria-label="연락처 등록" tabIndex={-1} onClick={submit}>
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 이름(정식·줄인 이름 어느 쪽이든)으로 프로젝트를 찾아요. */
const findProject = (projects: Project[], label: string) =>
  projects.find((p) => p.name === label) ?? projects.find((p) => p.alias === label);

/** 저장할 때: 붙은 배지 + 칸에 남은 글자가 있는 프로젝트 이름과 똑같으면 그것도 붙여요(새로 만들지는 않아요). */
function projectsToSave(projects: Project[], chips: string[], pending: string): string[] {
  const left = pending.trim();
  const out = [...chips];
  if (left && findProject(projects, left) && !out.includes(left)) out.push(left);
  return out;
}

/**
 * 프로젝트 칸(2026-10-18 사용자 1안, 시안 ProjectChips): 붙은 프로젝트는 배지(× 빼기), 뒤에 치면 후보 목록.
 * 치는 중에는 첫 후보가 골라져 있고 Enter·Tab으로 붙여요(↑↓ 바꾸기). 없는 이름은 "새 프로젝트로 추가".
 * 빈 칸 Backspace = 마지막 배지 빼기, 빈 칸 Enter·Tab = 줄의 다음 칸·등록·저장(rowKeys). 쉼표는 이름의 글자예요.
 */
function ProjectChips({
  projects,
  groups = [],
  stacked,
  value,
  onChange,
  pending,
}: {
  projects: Project[];
  groups?: ProjectGroup[];
  /** 고치는 카드: 붙은 배지 줄과 찾는 칸을 나눠요(2026-10-19 사용자 1안). */
  stacked?: boolean;
  /** 붙은 프로젝트 이름(화면 이름) */
  value: string[];
  onChange: (v: string[]) => void;
  /** 칸에 남은 글자를 부모가 저장할 때 읽어요. */
  pending?: { current: string };
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(-1);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  if (pending) pending.current = q;

  const taken = new Set(value.map((l) => findProject(projects, l)?.id ?? l));
  const query = q.trim();
  const ql = query.toLowerCase();
  const exact = findProject(projects, query);
  const gOrder = new Map(groups.map((g, i) => [g.id, i]));
  const gRank = (p: Project) => (p.group != null && gOrder.has(p.group) ? (gOrder.get(p.group) as number) : groups.length);
  const found = projects
    .filter((p) => !taken.has(p.id) && (!ql || p.name.toLowerCase().includes(ql) || p.alias.toLowerCase().includes(ql) || (/[ㄱ-ㅎ]/.test(ql) && koIndex(pjLabel(p), ql) >= 0)))
    .sort((a, b) => Number(b === exact) - Number(a === exact) || gRank(a) - gRank(b) || koSort(a, b))
    .slice(0, 10);
  const groupTitle = (p: Project) => (groups.length ? groups.find((g) => g.id === p.group)?.name ?? "그룹 없음" : "");
  type Opt = { p: Project } | { label: string };
  const options: Opt[] = found.map((p) => ({ p }));
  if (query && !exact && !value.includes(query)) options.push({ label: query });
  // 치는 중에는 첫 후보가 골라져 있어요.
  const cur = query ? (hi < 0 ? 0 : Math.min(hi, options.length - 1)) : hi;
  const show = open && options.length > 0;

  function pick(o: Opt) {
    const label = "p" in o ? pjLabel(o.p) : o.label;
    if (!value.includes(label)) onChange([...value, label]);
    setQ("");
    setHi(-1);
    inputRef.current?.focus();
  }

  const badges = value.map((label) => {
    const p = findProject(projects, label);
    return (
      <span key={label} className={"pbadge pchip-b" + (p ? "" : " pchip-new")} style={p ? pjStyle(p) : undefined} title={p ? pjFull(p) : `${label} · 저장할 때 새 프로젝트로 만들어요`}>
        <span className="pbadge-t">{label}</span>
        <button
          type="button"
          tabIndex={-1}
          className="pchip-x"
          aria-label={`${label} 빼기`}
          onMouseDown={(e) => {
            e.preventDefault();
            onChange(value.filter((x) => x !== label));
          }}
        >
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </span>
    );
  });
  const input = (
    <input
      ref={inputRef}
      name="proj"
      aria-label="프로젝트"
      placeholder={stacked ? "프로젝트 찾아 붙이기" : value.length ? "더하기" : "프로젝트"}
      autoComplete="off"
      className="pchips-in"
      value={q}
      role="combobox"
      aria-expanded={show}
      aria-autocomplete="list"
      onChange={(e) => {
        setQ(e.target.value);
        setOpen(true);
        setHi(-1);
      }}
      onFocus={() => setOpen(true)}
      onBlur={() => {
        setOpen(false);
        setHi(-1);
      }}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === "ArrowDown" && options.length) {
          e.preventDefault();
          setOpen(true);
          setHi((cur + 1) % options.length);
        } else if (e.key === "ArrowUp" && options.length) {
          e.preventDefault();
          setHi(cur <= 0 ? options.length - 1 : cur - 1);
        } else if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && show && cur >= 0 && options[cur]) {
          // 후보 목록이 열려 있으면 Enter·Tab은 먼저 후보 확정(공통 규칙)
          e.preventDefault();
          pick(options[cur]);
        } else if (e.key === "Backspace" && !q && value.length) {
          e.preventDefault();
          onChange(value.slice(0, -1));
        } else if (e.key === "Escape" && q) {
          // 치던 글자만 지우고, 고치는 카드는 닫지 않아요.
          e.preventDefault();
          e.stopPropagation();
          setQ("");
          setHi(-1);
        }
      }}
    />
  );

  return (
    <div className={"pin" + (stacked ? " pin-stacked" : "")}>
      {stacked ? (
        <>
          {value.length > 0 && <div className="pchips-got">{badges}</div>}
          <div className="pchips pchips-find" onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), inputRef.current?.focus())}>
            <span className="pchips-plus" aria-hidden="true">＋</span>
            {input}
          </div>
        </>
      ) : (
        <div className="pchips" onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), inputRef.current?.focus())}>
          {badges}
          {input}
        </div>
      )}
      {show && (
        <div className="pin-list" role="listbox">
          {options.map((o, i) => [
            "p" in o && groups.length > 0 && (i === 0 || !("p" in options[i - 1]) || groupTitle((options[i - 1] as { p: Project }).p) !== groupTitle(o.p)) && (
              <div key={"h" + i} className="pin-grp" aria-hidden="true">
                {groupTitle(o.p)}
              </div>
            ),
            <div
              key={"p" in o ? o.p.id : "new"}
              role="option"
              aria-selected={i === cur}
              className="pin-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {"p" in o ? (
                <span className="pbadge" style={pjStyle(o.p)} title={pjOther(o.p) || undefined}>
                  <span className="pbadge-t">{pjLabel(o.p)}</span>
                </span>
              ) : (
                <span className="pin-new">
                  <b>＋ 새 프로젝트로 추가</b> <span className="pin-new-t">“{o.label}”</span>
                </span>
              )}
            </div>,
          ])}
        </div>
      )}
    </div>
  );
}

// ---------- 카드 ----------

/** 아직 재지 않은 카드의 높이 추정(보이는 만큼만 그리기) – 이름 줄 + 번호 줄 + 프로젝트 줄 + 메모 줄. 그리면 재서 고쳐요. */
function cardEstimate(c: Contact): number {
  const n = [c.mobile, c.tel, c.email].filter(Boolean).length;
  return 92 + 22 * n + (c.projects.length ? 28 : 0) + 20 * parseMemo(c.memo).length;
}

type ViewProps = {
  vi?: number;
  contact: Contact;
  byId: Map<number, Project>;
  q: string;
  asking: boolean;
  memoOpen: boolean;
  onEdit: () => void;
  onAsk: (on: boolean) => void;
  onRemove: () => void;
  onMemoOpen: () => void;
  onMemoClose: () => void;
  onMemoSave: (lines: MemoLine[]) => void;
};

function ViewCard({ vi, contact: c, byId, q, asking, memoOpen, onEdit, onAsk, onRemove, onMemoOpen, onMemoClose, onMemoSave }: ViewProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // "이 연락처를 지울까요?"가 펼쳐진 동안 그 줄 바깥(다른 카드, 빈 곳 등)을 누르면 접어요.
  const askRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);
  useOutsideClose(asking, [askRef, trashRef], () => onAsk(false));

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
        // 복사되는 번호·메일 줄, 메모, 단추, 지우기 확인 줄은 빼고 카드를 두 번 누르면 고치는 카드(2026-10-18 사용자)
        if ((e.target as Element).closest("button, input, textarea, .ccard-memo, .ask-band")) return;
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
            <button type="button" className="tool tool-danger" aria-label={`${c.name} 지우기`} title="이 연락처 지우기" ref={trashRef} onClick={() => onAsk(!asking)}>
              <DelIcon />
            </button>
          </span>
        </div>
        {c.org && (
          <div className="ccard-org">
            <Hl text={c.org} q={q} />
          </div>
        )}
        {asking && (
          <AskBand bandRef={askRef} label="연락처 지우기 확인" text="이 연락처를 지울까요?" onNo={() => onAsk(false)} onYes={onRemove} />
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

function EditCard({
  vi,
  contact: c,
  byId,
  projects,
  groups,
  onCancel,
  onSave,
}: {
  vi?: number;
  contact: Contact;
  byId: Map<number, Project>;
  projects: Project[];
  groups: ProjectGroup[];
  onCancel: () => void;
  onSave: (input: ContactInput) => Promise<void>;
}) {
  const [v, setV] = useState({
    name: c.name,
    org: c.org,
    role: c.role,
    mobile: c.mobile,
    tel: c.tel,
    email: c.email,
    proj: c.projects.flatMap((id) => {
      const p = byId.get(id);
      return p ? [pjLabel(p)] : [];
    }),
  });
  const pending = useRef("");
  const [warn, setWarn] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ v, save, onCancel });
  latest.current = { v, save, onCancel };

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  function save(fromOutside = false) {
    if (!v.name.trim()) {
      // 바깥을 눌렀는데 이름이 비어 있으면 고치기 전으로 돌아가요.
      if (fromOutside) return onCancel();
      setWarn(true);
      nameRef.current?.focus();
      return;
    }
    const { proj, ...rest } = v;
    onSave({ ...rest, mobile: finalizePhone(rest.mobile), tel: finalizePhone(rest.tel), projects: projectsToSave(projects, proj, pending.current) });
  }

  // 바깥을 누르면 저장해요.
  // 누른 것이 그 사이 사라졌어도(배지 × 등) 누를 때의 자리로 판단해요(isInside가 composedPath로 봐요).
  useOutsideClose(true, [ref], () => {
    if (ref.current) latest.current.save(true);
  });

  const field = (key: keyof typeof v, label: string, ph: string, extra = "") => (
    <input
      ref={key === "name" ? nameRef : undefined}
      name={key}
      aria-label={label}
      placeholder={ph}
      className={"cell-input " + extra + (key === "name" && warn ? " invalid" : "")}
      value={v[key]}
      onChange={(e) => {
        if (key === "name") setWarn(false);
        setV({ ...v, [key]: e.target.value });
      }}
    />
  );

  return (
    <div
      ref={ref}
      className="ccard ccard-edit"
      data-vi={vi}
      onKeyDown={(e) => {
        if (e.defaultPrevented) return;
        if (isKey(e, "common.cancel")) {
          e.preventDefault();
          onCancel();
        } else rowKeys(e, ref.current, () => save());
      }}
    >
      <div className="edit-pair">
        {field("name", "이름", "이름", "strong")}
        {field("role", "직위", "직위")}
      </div>
      {field("org", "소속", "소속")}
      <div className="edit-grid">
        <span>무선</span>
        <PhoneInput name="mobile" aria-label="무선" placeholder="010-" className="cell-input num" value={v.mobile} onChange={(x) => setV((old) => ({ ...old, mobile: x }))} />
        <span>유선</span>
        <PhoneInput name="tel" aria-label="유선" placeholder="031-" className="cell-input num" value={v.tel} onChange={(x) => setV((old) => ({ ...old, tel: x }))} />
        <span>메일</span>
        {field("email", "이메일", "이메일")}
        <span>프로젝트</span>
        <ProjectChips projects={projects} groups={groups} stacked value={v.proj} onChange={(proj) => setV((old) => ({ ...old, proj }))} pending={pending} />
      </div>
      <div className="edit-foot">
        <span className="hint">Tab·Enter 다음 칸 · 마지막 칸이면 저장 · Esc 취소</span>
        <button type="button" className="btn btn-xs" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn-primary btn-xs" onClick={() => save()}>
          저장
        </button>
      </div>
    </div>
  );
}

// ---------- 메모 편집 ----------

/** 메모 편집기. 바깥을 누르면 저장해요. boundary를 주면 그 상자 안을 누르는 것은 바깥으로 치지 않아요(메모 창). */
export function MemoEditor({
  initial,
  onCancel,
  onSave,
  boundary,
  saveRef,
}: {
  initial: MemoLine[];
  onCancel: () => void;
  onSave: (l: MemoLine[]) => void;
  boundary?: RefObject<HTMLElement>;
  /** 창의 닫기 × 같은 바깥 단추가 "저장하고 닫기"를 부를 곳(민원대장 메모 창 – 2026-10-25 사용자) */
  saveRef?: MutableRefObject<(() => void) | null>;
}) {
  const [lines, setLines] = useState<MemoLine[]>(initial.length ? initial.map((l) => ({ ...l })) : [{ t: "" }]);
  const [focus, setFocus] = useState(Math.max(0, initial.length - 1));
  const box = useRef<HTMLDivElement>(null);
  const caret = useRef<number | null>(null);
  const latest = useRef({ lines, onSave });
  latest.current = { lines, onSave };
  if (saveRef) saveRef.current = () => latest.current.onSave(latest.current.lines);

  // 고르고 있는 줄에 커서를 둬요.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLInputElement>(`[data-line="${focus}"]`);
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    if (caret.current !== null) {
      el.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  }, [focus, lines.length]);

  // 처음 열 때는 마지막 줄 끝에 커서를 둬요.
  useEffect(() => {
    const el = box.current?.querySelector<HTMLInputElement>(`[data-line="${focus}"]`);
    if (el) el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 바깥을 누르면 저장해요.
  useOutsideClose(true, [() => boundary?.current ?? box.current], () => {
    if (boundary?.current ?? box.current) latest.current.onSave(latest.current.lines);
  });

  const cur = lines[focus] ?? { t: "" };
  const lv = layout(lines);

  function edit(fn: (ls: MemoLine[], i: number) => MemoLine[], move?: (i: number) => number) {
    const next = fn(lines.map((l) => ({ ...l })), focus);
    setLines(next);
    const f = move ? move(focus) : focus;
    setFocus(Math.max(0, Math.min(next.length - 1, f)));
  }

  const toggle = (k: "b" | "s") => edit((ls, i) => ((ls[i][k] = !ls[i][k]), ls));
  /** 머릿기호 단추: □ → ● → 작대기 → 없음 */
  const cycle = () => edit((ls, i) => ((ls[i] = withKind(ls[i], CYCLE[(CYCLE.indexOf(kindOf(ls[i])) + 1) % CYCLE.length], lv[i])), ls));
  const swap = (d: -1 | 1) =>
    edit(
      (ls, i) => {
        const j = i + d;
        if (j >= 0 && j < ls.length) [ls[i], ls[j]] = [ls[j], ls[i]];
        return ls;
      },
      (i) => i + d,
    );

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (isComposing(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const input = e.target as HTMLInputElement;
    const inLine = input.tagName === "INPUT";
    // 엔터규칙(keys.ts): 여러 줄 칸 규칙으로 새 줄, Tab은 저장하고 닫기(다음 칸이 없어요), Esc 취소.
    const act = keyAction(e, "multi");
    const mode: NewLineMode | null =
      act === "multi.same" ? "same" : act === "multi.down" ? "down" : act === "multi.up" ? "up" : act === "multi.br" ? "br" : null;
    if (act === "common.cancel") {
      e.preventDefault();
      onCancel();
    } else if (act === "common.next") {
      e.preventDefault();
      onSave(lines);
    } else if (act === "common.prev") {
      e.preventDefault();
    } else if (mode && inLine) {
      // 새 줄. 커서 뒤의 글은 새 줄로 넘겨요.
      e.preventDefault();
      const at = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? at;
      caret.current = 0;
      edit(
        (ls, i) => {
          const rest = ls[i].t.slice(end);
          ls[i].t = ls[i].t.slice(0, at);
          ls.splice(i + 1, 0, { ...newLineFor(ls, i, mode, rest, lv[i]) });
          return ls;
        },
        (i) => i + 1,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
    } else if (e.key === "Backspace" && inLine && input.selectionStart === 0 && input.selectionEnd === 0 && kindOf(cur) !== "none" && !isBlank(cur)) {
      // 머릿기호 규칙: 줄 맨 앞 Backspace는 먼저 머릿기호만 지워요(글 시작 위치는 그대로).
      e.preventDefault();
      caret.current = 0;
      edit((ls, i) => ((ls[i] = withKind(ls[i], "none", lv[i])), ls));
    } else if (e.key === " " && inLine && input.selectionStart === 1 && input.selectionEnd === 1 && TRIGGERS[cur.t[0]]) {
      // 줄 맨 앞 "] " ") " "- " → 네모·동그라미·작대기
      e.preventDefault();
      caret.current = 0;
      edit((ls, i) => ((ls[i] = { ...withKind(ls[i], TRIGGERS[ls[i].t[0]]), t: ls[i].t.slice(1) }), ls));
    } else if (e.key === "Backspace" && inLine && input.selectionStart === 0 && input.selectionEnd === 0 && focus > 0) {
      // 머릿기호 없는 줄 맨 앞에서 한 번 더 지우면 윗줄과 합쳐요.
      e.preventDefault();
      caret.current = lines[focus - 1].t.length;
      edit(
        (ls, i) => {
          ls[i - 1].t += ls[i].t;
          ls.splice(i, 1);
          return ls;
        },
        (i) => i - 1,
      );
    } else if (e.key === "ArrowUp" && inLine && !mod) {
      e.preventDefault();
      setFocus(Math.max(0, focus - 1));
    } else if (e.key === "ArrowDown" && inLine && !mod) {
      e.preventDefault();
      setFocus(Math.min(lines.length - 1, focus + 1));
    } else if (mod && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      toggle("b");
    }
  }

  return (
    <div ref={box} className="memo-ed" onKeyDown={onKeyDown}>
      <div className="memo-bar" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" className="tb" aria-label="굵게" aria-pressed={!!cur.b} onClick={() => toggle("b")}>
          <b>가</b>
        </button>
        <button type="button" className="tb" aria-label="취소선" aria-pressed={!!cur.s} onClick={() => toggle("s")}>
          <s>가</s>
        </button>
        <button type="button" className="tb" aria-label="머릿기호 바꾸기 (네모 → 점 → 작대기 → 없음)" title="머릿기호 바꾸기: □ → ● → 작대기 → 없음" aria-pressed={kindOf(cur) !== "none"} onClick={cycle}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="5" cy="7" r="1.4" fill="currentColor" />
            <circle cx="5" cy="17" r="1.4" fill="currentColor" />
            <path d="M10 7h10M10 17h10" />
          </svg>
        </button>
        <button type="button" className="tb" aria-label="줄 위로" onClick={() => swap(-1)}>
          <Arrow up />
        </button>
        <button type="button" className="tb" aria-label="줄 아래로" onClick={() => swap(1)}>
          <Arrow />
        </button>
        {/* 줄 지우기는 휴지통 그림으로 줄 위·아래 옆에(2026-10-25 사용자 – 오른쪽 끝 ×는 창 닫기로 보였어요) */}
        <button
          type="button"
          className="tb tb-del"
          aria-label="줄 지우기"
          title="이 줄 지우기"
          onClick={() =>
            edit(
              (ls, i) => {
                if (ls.length > 1) ls.splice(i, 1);
                else ls[0] = { t: "" };
                return ls;
              },
              (i) => (i >= lines.length - 1 ? i - 1 : i),
            )
          }
        >
          <TrashIcon />
        </button>
      </div>
      <div className="memo-lines">
        {lines.map((l, i) => (
          <div key={i} className={"memo-row" + (i === focus ? " on" : "")}>
            <Mark line={l} lv={lv[i]} hide={isBlank(l) && i !== focus && lines.length > 1} />
            <input
              data-line={i}
              aria-label={`메모 ${i + 1}번째 줄`}
              placeholder="내용 입력"
              value={l.t}
              style={{ fontWeight: l.b ? 700 : undefined, textDecoration: l.s ? "line-through" : undefined }}
              onFocus={() => i !== focus && setFocus(i)}
              onChange={(e) => {
                const ls = lines.map((x) => ({ ...x }));
                ls[i].t = e.target.value;
                setLines(ls);
              }}
            />
          </div>
        ))}
      </div>
      <div className="memo-foot">
        <span className="hint">Enter 새 줄 · Tab 저장</span>
        <button type="button" className="btn btn-xs" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn-primary btn-xs" onClick={() => onSave(lines)}>
          저장
        </button>
      </div>
    </div>
  );
}

// ---------- 사업 관리 창 (2026-10-20 사용자: "프로젝트 관리" → "사업 관리") ----------

/** 열 폭(2026-10-20 사용자): 창을 열 때 가장 긴 사업명·축약 공사명에 맞추고, 열 제목 경계를 끌어 바꿔요. */
const PJM_N = 56; // 연락처 열
const PJM_MIN_NAME = 160;
const PJM_MIN_SHORT = 96;
/** 사업명·축약 열 밖의 폭: 창 테두리 2 + 몸통 좌우 40 + 줄 좌우(그룹 안 20+4) + 색 22 + 칸 사이 10×4 + 연락처 + 지우기 28 + 스크롤 막대 12 */
const pjmFixed = (grouped: boolean) => 2 + 40 + (grouped ? 24 : 8) + 22 + 40 + PJM_N + 28 + 12;
const pjmMaxW = () => window.innerWidth - 32;
const PJM_MIN_W = 640;

/** 가장 긴 사업명·축약 공사명 글자 폭(줄 글꼴 13px, 축약은 굵게) + 여유 */
function fitCols(projects: Project[]): { name: number; short: number } {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return { name: 360, short: 220 };
  const family = getComputedStyle(document.body).fontFamily;
  const w = (xs: string[], weight: number) => {
    ctx.font = `${weight} 13px ${family}`;
    return Math.max(0, ...xs.filter(Boolean).map((x) => ctx.measureText(x).width));
  };
  return {
    name: Math.max(PJM_MIN_NAME, Math.ceil(w(projects.map(pjFull), 400)) + 8),
    short: Math.max(PJM_MIN_SHORT, Math.ceil(w(projects.map((p) => p.alias), 600)) + 8),
  };
}

/** 창 왼쪽·오른쪽 가장자리 손잡이. 창은 가운데에 있으니 끈 만큼 양쪽이 같이 늘어요(손잡이가 마우스를 따라와요). */
function EdgeGrip({ side, width, onWidth, onFit }: { side: "l" | "r"; width: number; onWidth: (w: number) => void; onFit: () => void }) {
  return (
    <div
      className={"pjm-grip pjm-grip-" + side}
      aria-hidden="true"
      onMouseDown={(e) => {
        e.preventDefault();
        const x0 = e.clientX;
        const w0 = width;
        const move = (ev: MouseEvent) => onWidth(w0 + (ev.clientX - x0) * (side === "r" ? 1 : -1) * 2);
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          document.body.classList.remove("ew-dragging");
        };
        document.body.classList.add("ew-dragging");
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      onDoubleClick={onFit}
      title="끌어서 폭 바꾸기 · 두 번 누르면 가장 긴 이름에 맞춤"
    />
  );
}

/** 열 제목 경계 손잡이: 끌면 그 열이 넓어지고 창도 같이 넓어져요. 두 번 누르면 가장 긴 이름에 맞춰요. */
function ColGrip({ width, onWidth, onFit, label }: { width: number; onWidth: (w: number) => void; onFit: () => void; label: string }) {
  return (
    <span
      className="pjm-colgrip"
      role="separator"
      aria-orientation="vertical"
      aria-label={label + " 열 폭"}
      title="끌어서 열 폭 바꾸기 · 두 번 누르면 가장 긴 이름에 맞춤"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const x0 = e.clientX;
        const w0 = width;
        // 창이 가운데라 열이 d 넓어지면 경계는 d/2만 움직여요 → 2배로 늘려 손잡이가 마우스를 따라와요.
        const move = (ev: MouseEvent) => onWidth(w0 + (ev.clientX - x0) * 2);
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          document.body.classList.remove("ew-dragging");
        };
        document.body.classList.add("ew-dragging");
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFit();
      }}
    />
  );
}

/** 사업 줄 우클릭 메뉴: 수정 · 그룹 변경 ▸ · 지우기 */
function PjMenu({
  x,
  y,
  groups,
  current,
  onEdit,
  onGroup,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  groups: ProjectGroup[];
  current: number | null;
  onEdit: () => void;
  onGroup: (name: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const subBtn = useRef<HTMLButtonElement>(null);
  const [sub, setSub] = useState(false);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useOutsideClose(true, [ref], () => onClose(), {
    escCapture: true,
    onEsc: (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (sub) {
        setSub(false);
        subBtn.current?.focus();
      } else onClose();
    },
  });
  const pick = (f: () => void) => () => {
    onClose();
    f();
  };
  const opts: { id: number | null; name: string }[] = [...groups.map((g) => ({ id: g.id, name: g.name })), { id: null, name: "그룹 없음" }];
  // 하위 메뉴가 화면 오른쪽에 걸리면 왼쪽으로 열어요.
  const left = pos.x + 160 + 4 + 200 > window.innerWidth;
  return (
    <div ref={ref} className="dmenu pjm-menu" role="menu" style={{ position: "fixed", left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <button type="button" role="menuitem" className="dmenu-item" autoFocus onMouseEnter={() => setSub(false)} onClick={pick(onEdit)}>
        수정
      </button>
      <button
        ref={subBtn}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={sub}
        className={"dmenu-item pjm-menu-sub" + (sub ? " on" : "")}
        onMouseEnter={() => setSub(true)}
        onClick={() => setSub(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "Enter") {
            e.preventDefault();
            setSub(true);
            requestAnimationFrame(() => (ref.current?.querySelector(".pjm-submenu .dmenu-item:not(:disabled)") as HTMLElement | null)?.focus());
          }
        }}
      >
        그룹 변경
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <div className="dmenu-sep" role="separator" />
      <button type="button" role="menuitem" className="dmenu-item danger" onMouseEnter={() => setSub(false)} onClick={pick(onDelete)}>
        지우기
      </button>
      {sub && (
        <div className={"dmenu pjm-submenu" + (left ? " pjm-submenu-l" : "")} role="menu" aria-label="그룹 변경">
          {opts.map((o) => (
            <button
              key={o.id ?? "none"}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === current}
              className={"dmenu-item pjm-gopt" + (o.id === null ? " pjm-gnone" : "")}
              disabled={o.id === current}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  setSub(false);
                  subBtn.current?.focus();
                }
              }}
              onClick={pick(() => onGroup(o.id === null ? "" : o.name))}
            >
              <span className="pjm-gcheck" aria-hidden="true">
                {o.id === current ? "✓" : ""}
              </span>
              {o.name}
            </button>
          ))}
          {groups.length === 0 && <p className="dmenu-note">그룹은 위 그룹 칸에 이름을 적어 만들어요.</p>}
        </div>
      )}
    </div>
  );
}

function ProjectDialog({
  data,
  run,
  onClose,
}: {
  data: ContactsData;
  run: (p: Promise<ContactsData>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [draftShort, setDraftShort] = useState("");
  const [ask, setAsk] = useState<number | null>(null);
  /** 이름을 고치고 있는 프로젝트 */
  const [editId, setEditId] = useState<number | null>(null);
  const [pq, setPq] = useState("");
  const [sort, setSort] = useState<"name" | "count">("name");
  const [draftGroup, setDraftGroup] = useState("");
  const [folded, toggle] = useFolded();
  const [groupMenu, setGroupMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [askGroup, setAskGroup] = useState<number | null>(null);
  // 열 폭(2026-10-20 사용자): 열 때 가장 긴 사업명·축약 공사명에 맞추고, 창 폭 = 열 폭의 합이에요.
  const [cols, setCols] = useState(() => fitCols(data.projects));
  const [rowMenu, setRowMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  /** [그룹 추가]를 눌러 새 그룹 이름을 적는 중(2026-10-20 사용자: 처음 쓰는 사람도 그룹 만드는 곳을 알게) */
  const [newGroup, setNewGroup] = useState(false);
  /** 방금 더한 프로젝트 이름(그 줄로 내려가요) */
  const [added, setAdded] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Esc는 묻는 띠를 먼저 닫고, 없으면 창을 닫아요. 커서가 창 밖에 있어도 들어요.
  const askRef = useRef(ask);
  askRef.current = ask;
  const askGroupRef = useRef<number | null>(null);
  askGroupRef.current = askGroup;
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      if (askRef.current !== null) setAsk(null);
      else if (askGroupRef.current !== null) setAskGroup(null);
      else onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const isTaken = (n: string) => data.projects.some((x) => x.name === n || x.alias === n);
  const dFull = draft.trim();
  const dShort = draftShort.trim();
  const badFull = !!dFull && isTaken(dFull);
  const badShort = !!dShort && dShort !== dFull && isTaken(dShort);

  /** 공사명·축약 공사명 중 하나만 적어도 돼요(2026-10-19 사용자). 그룹만 적고 추가하면 빈 그룹을 만들어요. */
  async function add() {
    const name = dFull || dShort;
    const grp = draftGroup.trim();
    if (!name) {
      if (grp && !(data.groups ?? []).some((g) => g.name === grp)) await run(api.addProjectGroup(grp));
      inputRef.current?.focus();
      return;
    }
    if (badFull || badShort) return;
    const ok = await run(
      (async () => {
        let d = await api.addProject(name);
        const p = d.projects.find((x) => x.name === name);
        if (p && dFull && dShort && dShort !== dFull) d = await api.setProjectNames(p.id, dFull, dShort);
        if (p && grp) d = await api.setProjectGroup(p.id, grp);
        return d;
      })(),
    );
    if (ok) {
      // 그룹은 남겨 둬요 – 같은 그룹에 이어서 넣기 쉽게.
      setDraft("");
      setDraftShort("");
      setPq("");
      setAdded(name);
    }
    inputRef.current?.focus();
  }

  const ql = pq.trim().toLowerCase();
  const count = (id: number) => data.contacts.filter((c) => c.projects.includes(id)).length;
  const groups = data.groups ?? [];
  const flat = groups.length === 0;
  const sections = pjSections(data.projects, groups).map((sec) => ({
    ...sec,
    rows: sec.projects
      .filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.alias.toLowerCase().includes(ql) || (/[ㄱ-ㅎ]/.test(ql) && koIndex(pjLabel(p), ql) >= 0))
      .map((p) => ({ p, users: count(p.id) }))
      .sort((x, y) => (sort === "count" ? y.users - x.users : 0) || pjFull(x.p).localeCompare(pjFull(y.p), "ko", { numeric: true })),
  }));
  const nothing = sections.every((s) => s.rows.length === 0);

  // 방금 더한 프로젝트가 보이게 내려가요.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!added) return;
    bodyRef.current?.querySelector(`[data-pj="${CSS.escape(added)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [added, data]);

  const groupName = (id: number | null) => groups.find((g) => g.id === id)?.name ?? "";
  const fixed = pjmFixed(!flat);
  const pjmW = Math.max(PJM_MIN_W, Math.min(fixed + cols.name + cols.short, pjmMaxW()));
  /** 사업명 열: 창이 화면보다 넓어지지 않게 막아요 */
  const setNameW = (w: number) => setCols((c) => ({ ...c, name: Math.round(Math.max(PJM_MIN_NAME, Math.min(w, pjmMaxW() - fixed - c.short))) }));
  const setShortW = (w: number) => setCols((c) => ({ ...c, short: Math.round(Math.max(PJM_MIN_SHORT, Math.min(w, pjmMaxW() - fixed - PJM_MIN_NAME))) }));
  const fit = () => setCols(fitCols(data.projects));
  const colVars = { width: pjmW, "--pjm-short": cols.short + "px" } as React.CSSProperties;

  return (
    <div
      className="overlay"
      onMouseDown={overlayDown(onClose)}
    >
      <div className="dialog mgr pjm" role="dialog" aria-modal="true" aria-label="사업 관리" style={colVars}>
        <EdgeGrip side="l" width={pjmW} onWidth={(w) => setNameW(w - fixed - cols.short)} onFit={fit} />
        <EdgeGrip side="r" width={pjmW} onWidth={(w) => setNameW(w - fixed - cols.short)} onFit={fit} />
        <div className="dialog-head pjm-head">
          <span className="dialog-title">사업 관리</span>
          <span className="mgr-info">{data.projects.length}개</span>
          <button type="button" className="btn pjm-grp-add" onClick={() => setNewGroup(true)} disabled={newGroup}>
            <Plus size={14} /> 그룹 추가
          </button>
          <input
            className="input pjm-find"
            aria-label="프로젝트 찾기"
            placeholder="찾기"
            value={pq}
            onChange={(e) => setPq(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && pq) {
                e.preventDefault();
                e.nativeEvent.stopImmediatePropagation();
                setPq("");
              }
            }}
          />
        </div>
        <div className="pjm-add">
          <GroupInput groups={groups} value={draftGroup} onChange={setDraftGroup} onEnter={add} />
          <input
            ref={inputRef}
            className={"input" + (badFull ? " invalid" : "")}
            aria-label="사업명"
            placeholder="사업명"
            title={badFull ? "같은 이름의 프로젝트가 있어요" : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e)) {
                e.preventDefault();
                add();
              }
            }}
          />
          <input
            className={"input" + (badShort ? " invalid" : "")}
            aria-label="축약 공사명"
            placeholder="축약 공사명"
            title={badShort ? "같은 이름의 프로젝트가 있어요" : "비우면 공사명으로 보여요"}
            value={draftShort}
            onChange={(e) => setDraftShort(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isComposing(e)) {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn-primary pjm-add-btn" onClick={add}>
            <Plus size={14} /> 추가
          </button>
        </div>
        <div className="pjm-row pjm-th" role="row">
          <span>색</span>
          <span className="pjm-thc">
            <button type="button" className="pjm-sort" aria-pressed={sort === "name"} onClick={() => setSort("name")}>
              사업명{sort === "name" ? " ↓" : ""}
            </button>
            <ColGrip label="사업명" width={cols.name} onWidth={setNameW} onFit={fit} />
          </span>
          <span className="pjm-thc">
            <span>축약 공사명</span>
            <ColGrip label="축약 공사명" width={cols.short} onWidth={setShortW} onFit={fit} />
          </span>
          <button type="button" className="pjm-sort pjm-n" aria-pressed={sort === "count"} onClick={() => setSort("count")}>
            {sort === "count" ? "↓ " : ""}연락처
          </button>
          <span />
        </div>
        <div className="dialog-body pjm-body" ref={bodyRef}>
          {newGroup && (
            <div className="pjm-grp-h pjm-grp-new">
              <FoldArrow open />
              <GroupRename
                name=""
                placeholder="새 그룹 이름"
                taken={(n) => groups.some((g) => g.name === n)}
                onDone={async (name) => {
                  setNewGroup(false);
                  if (name) await run(api.addProjectGroup(name));
                }}
              />
              <span className="muted small pjm-grp-tip">Enter 만들기 · Esc 취소</span>
            </div>
          )}
          {data.projects.length === 0 && groups.length === 0 && <p className="muted small pjm-empty">아직 프로젝트가 없어요.</p>}
          {data.projects.length > 0 && nothing && !!ql && <p className="muted small pjm-empty">맞는 프로젝트가 없어요.</p>}
          {sections.map((sec) => {
            // 그룹이 없으면 묶음 머리 없이 예전처럼, 찾는 중에는 맞는 것이 없는 묶음을 숨겨요.
            if (flat || (ql && sec.rows.length === 0) || (sec.id === null && sec.projects.length === 0)) {
              if (flat) return <div key={sec.key}>{sec.rows.map(rowOf)}</div>;
              return null;
            }
            const open = !!ql || !folded.has(sec.key);
            const gi = groups.findIndex((g) => g.id === sec.id);
            return (
              <div key={sec.key} className="pjm-grp">
                <div
                  className="pjm-grp-h"
                  onContextMenu={(e) => {
                    if (sec.id === null) return;
                    e.preventDefault();
                    setGroupMenu({ id: sec.id, x: e.clientX, y: e.clientY });
                  }}
                >
                  {renaming !== null && renaming === sec.id ? (
                    <GroupRename
                      name={sec.name}
                      taken={(n) => groups.some((g) => g.id !== sec.id && g.name === n)}
                      onDone={async (name) => {
                        setRenaming(null);
                        if (name && name !== sec.name && sec.id !== null) await run(api.renameProjectGroup(sec.id, name));
                      }}
                    />
                  ) : (
                    <button type="button" className="pjm-grp-btn" aria-expanded={open} onClick={() => toggle(sec.key)} title={sec.id === null ? undefined : "우클릭: 이름 바꾸기 · 위/아래로 · 지우기"}>
                      <FoldArrow open={open} />
                      <span className="pjm-grp-name">{sec.name}</span>
                      <span className="mgr-info">{sec.projects.length}개</span>
                    </button>
                  )}
                  {askGroup === sec.id && sec.id !== null && (
                    <AskBand
                      className="ask-wide pjm-ask"
                      label="그룹 지우기 확인"
                      text={sec.projects.length ? `그룹만 지워요. 프로젝트 ${sec.projects.length}개는 "그룹 없음"으로 가요.` : "빈 그룹이에요. 지울까요?"}
                      yes="그룹 지우기"
                      onNo={() => setAskGroup(null)}
                      onYes={async () => {
                        const id = sec.id as number;
                        setAskGroup(null);
                        if (groupName(id) === draftGroup) setDraftGroup("");
                        await run(api.deleteProjectGroup(id));
                      }}
                    />
                  )}
                </div>
                {open && sec.rows.map(rowOf)}
                {open && sec.rows.length === 0 && <p className="muted small pjm-grp-empty">비어 있어요 – 사업 줄을 우클릭해 "그룹 변경"으로 넣어요.</p>}
                {groupMenu?.id === sec.id && (
                  <CtxMenu
                    x={groupMenu.x}
                    y={groupMenu.y}
                    onClose={() => setGroupMenu(null)}
                    items={[
                      { label: "이름 바꾸기", run: () => setRenaming(sec.id) },
                      { label: "위로 옮기기", disabled: gi <= 0, run: () => run(api.moveProjectGroup(sec.id as number, -1)) },
                      { label: "아래로 옮기기", disabled: gi >= groups.length - 1, run: () => run(api.moveProjectGroup(sec.id as number, 1)) },
                      { label: "그룹 지우기", danger: true, run: () => setAskGroup(sec.id) },
                    ]}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-ctrl btn-text" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );

  function rowOf({ p, users }: { p: Project; users: number }) {
    return (
      <div key={p.id} className={"pjm-row" + (editId === p.id ? " pjm-editing" : "")} data-pj={p.name}
        aria-selected={rowMenu?.id === p.id}
        title={editId === p.id ? undefined : "우클릭: 수정 · 그룹 변경 · 지우기"}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest("button, input, .ask-band") && setEditId(p.id)}
        onContextMenu={(e) => {
          if (editId === p.id || (e.target as HTMLElement).closest("input, .ask-band")) return;
          e.preventDefault();
          setAsk(null);
          setRowMenu({ id: p.id, x: e.clientX, y: e.clientY });
        }}
      >
        <ColorPick name={p.name} current={projectColor(p)} auto={p.color === null} onPick={(c) => run(api.setProjectColor(p.id, c))} />
        {editId === p.id ? (
          <div className={"pjm-edit" + (flat ? "" : " pjm-edit-g")}>
            <NamesEdit
              full={fullDraft(p)}
              short={p.alias}
              group={flat ? undefined : groupName(p.group)}
              groups={groups}
              taken={(n) => data.projects.some((x) => x.id !== p.id && (x.name === n || x.alias === n))}
              onDone={async (v) => {
                setEditId(null);
                if (!v) return;
                await run(
                  (async () => {
                    let d: ContactsData | null = null;
                    if (v.full !== fullDraft(p) || v.short !== p.alias) d = await api.setProjectNames(p.id, v.full, v.short);
                    if (v.group !== undefined && v.group !== groupName(p.group)) d = await api.setProjectGroup(p.id, v.group);
                    return d ?? (await api.contactsData());
                  })(),
                );
              }}
            />
          </div>
        ) : (
          <>
            <span className="pjm-full" title={pjFull(p)}>
              {pjFull(p)}
            </span>
            <span className={"pjm-short" + (p.alias ? "" : " pjm-same")} title={pjLabel(p)}>{p.alias || "–"}</span>
          </>
        )}
        <span className={"pjm-n" + (users ? "" : " pjm-zero")}>{users}명</span>
        <button type="button" className="tool-box pjm-tool" aria-label={`${p.name} 지우기`} title="이 프로젝트 지우기" onClick={() => setAsk(p.id)}>
          <DelIcon />
        </button>
        {rowMenu?.id === p.id && (
          <PjMenu
            x={rowMenu.x}
            y={rowMenu.y}
            groups={groups}
            current={p.group}
            onClose={() => setRowMenu(null)}
            onEdit={() => setEditId(p.id)}
            onGroup={(g) => run(api.setProjectGroup(p.id, g))}
            onDelete={() => setAsk(p.id)}
          />
        )}
        {ask === p.id && (
          <AskBand
            className="ask-wide pjm-ask"
            label="프로젝트 지우기 확인"
            text={users ? `${users}명에게 붙어 있어요. 지워도 사람은 남고 배지만 빠져요.` : "아무에게도 붙어 있지 않아요. 지울까요?"}
            onNo={() => setAsk(null)}
            onYes={async () => {
              setAsk(null);
              await run(api.deleteProject(p.id));
              inputRef.current?.focus();
            }}
          />
        )}
      </div>
    );
  }
}

// ---------- 그룹 칸 · 그룹 이름 바꾸기 · 우클릭 메뉴 ----------

/** 그룹 고르기 칸: 있는 그룹을 고르거나 새 이름을 쳐요(없는 이름이면 추가할 때 그룹이 생겨요). */
function GroupInput({ groups, value, onChange, onEnter, autoFocus }: { groups: ProjectGroup[]; value: string; onChange: (v: string) => void; onEnter?: () => void; autoFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const q = value.trim();
  const exact = groups.some((g) => g.name === q);
  const opts: { label: string; isNew?: boolean; none?: boolean }[] = [
    { label: "그룹 없음", none: true },
    ...groups.filter((g) => !q || exact || g.name.includes(q)).map((g) => ({ label: g.name })),
  ];
  if (q && !exact) opts.push({ label: q, isNew: true });
  const cur = q && !exact ? (hi < 0 ? opts.findIndex((o) => !o.none) : hi) : hi;
  const choose = (o: (typeof opts)[number]) => {
    onChange(o.none ? "" : o.label);
    setOpen(false);
    setHi(-1);
  };
  return (
    <div className="pin grp-in">
      <input
        className={"input" + (q && !exact ? " grp-new" : "")}
        aria-label="그룹"
        placeholder="그룹"
        autoFocus={autoFocus}
        value={value}
        title={q && !exact ? "새 그룹으로 만들어요" : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHi(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (isComposing(e)) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHi((cur + 1) % opts.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi(cur <= 0 ? opts.length - 1 : cur - 1);
          } else if ((e.key === "Enter" || e.key === "Tab") && open && cur >= 0 && opts[cur]) {
            // 목록이 열려 있으면 Enter·Tab은 먼저 고르기(공통 규칙), Tab은 다음 칸으로도 가요.
            if (e.key === "Enter") e.preventDefault();
            choose(opts[cur]);
          } else if (e.key === "Enter" && onEnter) {
            e.preventDefault();
            onEnter();
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="pin-list" role="listbox">
          {opts.map((o, i) => (
            <div
              key={(o.isNew ? "+" : "") + o.label}
              role="option"
              aria-selected={i === cur}
              className={"pin-opt" + (o.none ? " grp-none" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
            >
              {o.isNew ? (
                <span className="pin-new">
                  <b>＋ 새 그룹</b> <span className="pin-new-t">“{o.label}”</span>
                </span>
              ) : (
                o.label
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupRename({ name, placeholder, taken, onDone }: { name: string; placeholder?: string; taken: (n: string) => boolean; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(name);
  const done = useRef(false);
  const t = v.trim();
  const bad = !t || taken(t);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(save && !bad ? t : null);
  };
  return (
    <input
      className={"input pjm-grp-in" + (bad ? " invalid" : "")}
      aria-label="그룹 이름"
      placeholder={placeholder}
      autoFocus
      value={v}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.nativeEvent.stopImmediatePropagation();
          finish(false);
        }
      }}
    />
  );
}

/** 작은 우클릭 메뉴(화면 기준 자리). 바깥을 누르거나 Esc면 닫혀요. */
function CtxMenu({ x, y, items, onClose }: { x: number; y: number; items: { label: string; run: () => void; disabled?: boolean; danger?: boolean }[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(true, [ref], () => onClose(), {
    escCapture: true,
    onEsc: (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    },
  });
  return (
    <div ref={ref} className="dmenu" role="menu" style={{ position: "fixed", left: x, top: y }}>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={"dmenu-item" + (it.danger ? " danger" : "")}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ---------- 이름 고치기 ----------

/**
 * 관리 창 줄의 이름 칸(2026-10-17 사용자: 등록된 프로젝트를 고칠 수 있어야 해요).
 * Enter·바깥 누르기 = 저장, Esc = 그대로. 같은 이름이 있으면 빨간 테두리로 막아요.
 */
/**
 * 프로젝트 이름 두 칸(정식 이름·줄인 이름). 둘 중 하나만 적어도 돼요(2026-10-18 사용자).
 * Enter·바깥 누르기 = 저장, Esc = 그대로. Tab으로 두 칸을 오가요.
 * 비었거나 다른 프로젝트 이름과 겹치면 빨간 테두리(저장 안 됨, 바깥을 누르면 고치기 전으로).
 */
function NamesEdit({
  full: full0,
  short: short0,
  group: group0,
  groups = [],
  taken,
  onDone,
}: {
  full: string;
  short: string;
  /** 그룹 칸을 보일 때만(그룹이 하나라도 있을 때) */
  group?: string;
  groups?: ProjectGroup[];
  taken: (name: string) => boolean;
  onDone: (v: { full: string; short: string; group?: string } | null) => void;
}) {
  const [full, setFull] = useState(full0);
  const [short, setShort] = useState(short0);
  const [group, setGroup] = useState(group0 ?? "");
  const done = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const f = full.trim();
  const sh = short.trim();
  const empty = !f && !sh;
  const badFull = !!f && taken(f);
  const badShort = !!sh && sh !== f && taken(sh);
  const bad = empty || badFull || badShort;
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(save && !bad ? { full: f, short: sh, group: group0 === undefined ? undefined : group.trim() } : null);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (!bad) finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      finish(false);
    }
  };
  const tip = (b: boolean, wrong: boolean) => (b ? (wrong ? "같은 이름의 프로젝트가 있어요" : "둘 중 하나는 적어 주세요") : undefined);
  return (
    <div
      ref={box}
      className="mgr-names"
      onBlur={(e) => {
        // 두 칸 사이를 오가는 것은 떠난 것이 아니에요.
        if (!box.current?.contains(e.relatedTarget as Node | null)) finish(true);
      }}
    >
      {group0 !== undefined && <GroupInput groups={groups} value={group} onChange={setGroup} onEnter={() => !bad && finish(true)} />}
      <label className="mgr-names-l" htmlFor="pj-full">
        공사명
      </label>
      <input
        id="pj-full"
        className={"input mgr-name-in" + (empty || badFull ? " invalid" : "")}
        aria-invalid={empty || badFull || undefined}
        title={tip(empty || badFull, badFull)}
        autoFocus
        placeholder="공사명"
        value={full}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setFull(e.target.value)}
        onKeyDown={key}
      />
      <label className="mgr-names-l" htmlFor="pj-short">
        축약 공사명
      </label>
      <input
        id="pj-short"
        className={"input mgr-name-in" + (empty || badShort ? " invalid" : "")}
        aria-invalid={empty || badShort || undefined}
        title={tip(empty || badShort, badShort)}
        placeholder="비우면 공사명으로 보여요"
        value={short}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setShort(e.target.value)}
        onKeyDown={key}
      />
    </div>
  );
}

// ---------- 색 고르기 ----------

/** 색 단추. 누르면 8색과 "자동"이 펼쳐져요(0.6.2, 사용자가 정함). Esc나 바깥을 누르면 닫혀요. */
function ColorPick({ name, current, auto, onPick }: { name: string; current: number; auto: boolean; onPick: (c: number | null) => void }) {
  const [open, setOpen] = useState(false);
  // 관리 창 안이 스크롤되는 상자라 목록이 잘리지 않게 화면 기준 자리에 띄워요.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const r = box.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }, [open]);
  // 창 전체의 Esc(관리 창 닫기)보다 먼저 받아서 펼친 목록만 닫아요.
  useOutsideClose(open, [box], () => setOpen(false), {
    escCapture: true,
    onEsc: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    },
  });
  const pick = (c: number | null) => {
    setOpen(false);
    onPick(c);
  };
  return (
    <div className="cpick" ref={box}>
      <button
        type="button"
        className="cal-cbtn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${name} 색: ${auto ? "자동" : COLOR_NAMES[current]} – 눌러서 바꾸기`}
        title={auto ? `${COLOR_NAMES[current]} (자동)` : COLOR_NAMES[current]}
        style={{ background: `var(--pj-${current}-line)` }}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="cpick-pop" role="radiogroup" aria-label={`${name} 색`} style={at ? { top: at.top, right: at.right } : { visibility: "hidden" }}>
          <div className="cpick-grid">
            {COLOR_NAMES.map((cn, j) => (
              <button
                key={j}
                type="button"
                role="radio"
                className="swatch"
                aria-label={`${name} 색: ${cn}`}
                aria-checked={!auto && j === current}
                title={cn}
                style={{ background: `var(--pj-${j}-line)`, color: `var(--pj-${j}-line)` }}
                onClick={() => pick(j)}
              />
            ))}
          </div>
          <button type="button" className="btn btn-xs cpick-auto" aria-pressed={auto} onClick={() => pick(null)}>
            자동 (번호 순서대로)
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 아이콘 ----------

function Plus({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Pencil() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"} />
    </svg>
  );
}

/**
 * 엑셀 숨긴 열(그룹·축약 공사명·색)로 읽은 프로젝트를 넣어요. 같은 프로젝트(공사명·축약 공사명이 맞는 것)가 있으면
 * 비어 있는 것만 채우고(축약 공사명·그룹·색 – 적어 둔 것은 그대로), 없으면 새로 만들어요.
 */
async function importProjects(list: ProjectImport[]) {
  if (!list.length) return;
  let d = await api.contactsData();
  const same = (p: Project, x: ProjectImport) =>
    p.name === x.name || p.alias === x.name || (!!x.alias && (p.name === x.alias || p.alias === x.alias));
  const tryRun = async (f: () => Promise<ContactsData>) => {
    try {
      d = await f();
    } catch {
      // 이름이 겹치는 등 넣지 못한 칸은 건너뛰어요.
    }
  };
  for (const x of list) {
    let p = d.projects.find((q) => same(q, x));
    const isNew = !p;
    if (!p) {
      await tryRun(() => api.addProject(x.name));
      p = d.projects.find((q) => q.name === x.name);
      if (!p) continue;
    }
    const id = p.id;
    if (x.alias && (isNew || !p.alias || p.alias === p.name)) await tryRun(() => api.setProjectNames(id, p!.name, x.alias));
    if (x.group && (isNew || p.group === null)) await tryRun(() => api.setProjectGroup(id, x.group));
    if (x.color !== null && (isNew || p.color === null)) await tryRun(() => api.setProjectColor(id, x.color));
  }
}

