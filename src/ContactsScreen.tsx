// 업무연락처 화면이에요. 시안 Contacts.dc.html과 사양서의 "업무연락처" 절을 따라요.
import { KeyboardEvent, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExcelMenu } from "./ExcelMenu";
import { contactImports, contactRows } from "./excel";
import { DelIcon } from "./Icons";
import { BLine, CYCLE, isBlank, kindOf, layout, newLineFor, NewLineMode, parseLines, stringifyLines, TRIGGERS, withKind } from "./bullets";
import { isKey, keyAction, rowKeys } from "./keys";
import { BulletView, Mark } from "./BulletParts";
import { koIndex } from "./journal";
import { useJamoGuard } from "./koInput";
import { PhoneInput } from "./PhoneInput";
import { finalizePhone } from "./phone";
import { api, Contact, ContactInput, ContactsData, errorText, Project } from "./api";

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

  useEffect(() => {
    api.contactsData().then(setData, (e) => setNote(errorText(e)));
  }, []);

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
      <div className="ct-head">
        <h1 className="title">업무연락처</h1>
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
        <button type="button" className="btn btn-ctrl btn-text" onClick={() => setProjOpen(true)}>
          프로젝트 관리
        </button>
        <ExcelMenu
          kind="contacts"
          total={all.length}
          build={() => ({ rows: contactRows(all, projects), intake: [], status: [] })}
          parse={contactImports}
          onImport={async (rows) => {
            const n = await api.importContacts(rows);
            setData(await api.contactsData());
            return n;
          }}
        />
      </div>

      <div className="ct-chips" role="group" aria-label="프로젝트로 거르기">
        <span className="ct-chips-label">프로젝트</span>
        <button type="button" className="pchip" aria-pressed={sel === null} onClick={() => setSel(null)}>
          <span>전체</span>
          <span className="pchip-n">{all.length}</span>
        </button>
        {projects.map((p) => (
          <button key={p.id} type="button" className="pchip" aria-pressed={sel === p.id} onClick={() => setSel(p.id)}>
            <span className="pchip-dot" aria-hidden="true" style={{ background: sel === p.id ? undefined : `var(--pj-${projectColor(p)}-line)` }} />
            <span className="pchip-t" title={pjOther(p) || undefined}>{pjLabel(p)}</span>
            <span className="pchip-n">{all.filter((c) => c.projects.includes(p.id)).length}</span>
          </button>
        ))}
      </div>

      {note && <p className="note" role="status">{note}</p>}

      <NewRow projects={projects} onAdd={(c) => run(api.addContact(c))} />

      <div className="ct-grid">
        {shown.map((c) =>
          editId === c.id ? (
            <EditCard
              key={c.id}
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
              key={c.id}
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
          ),
        )}
      </div>

      {all.length === 0 ? (
        <p className="muted small">아직 연락처가 없어요. 위 줄에 이름부터 적고 Enter를 눌러 등록해요.</p>
      ) : shown.length === 0 ? (
        <p className="muted small">맞는 연락처가 없어요.</p>
      ) : null}

      {projOpen && <ProjectDialog data={data} run={run} onClose={() => setProjOpen(false)} />}
    </>
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

function NewRow({ projects, onAdd }: { projects: Project[]; onAdd: (c: ContactInput) => Promise<boolean> }) {
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
            <ProjectChips projects={projects} value={v.proj} onChange={(proj) => setV((old) => ({ ...old, proj }))} pending={pending} />
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
  value,
  onChange,
  pending,
}: {
  projects: Project[];
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
  const found = projects
    .filter((p) => !taken.has(p.id) && (!ql || p.name.toLowerCase().includes(ql) || p.alias.toLowerCase().includes(ql)))
    .sort((a, b) => Number(b === exact) - Number(a === exact))
    .slice(0, 8);
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

  return (
    <div className="pin">
      <div className="pchips" onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), inputRef.current?.focus())}>
        {value.map((label) => {
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
        })}
        <input
          ref={inputRef}
          name="proj"
          aria-label="프로젝트"
          placeholder={value.length ? "더하기" : "프로젝트"}
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
      </div>
      {show && (
        <div className="pin-list" role="listbox">
          {options.map((o, i) => (
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 카드 ----------

type ViewProps = {
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

function ViewCard({ contact: c, byId, q, asking, memoOpen, onEdit, onAsk, onRemove, onMemoOpen, onMemoClose, onMemoSave }: ViewProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // "이 연락처를 지울까요?"가 펼쳐진 동안 그 줄 바깥(다른 카드, 빈 곳 등)을 누르면 접어요.
  const askRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;
  useEffect(() => {
    if (!asking) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (askRef.current?.contains(t) || trashRef.current?.contains(t)) return;
      onAskRef.current(false);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [asking]);

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
          <div
            ref={askRef}
            className="ask-band"
            role="alertdialog"
            aria-label="연락처 지우기 확인"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onAsk(false);
              }
            }}
          >
            <span>이 연락처를 지울까요?</span>
            <button type="button" className="btn btn-xs" autoFocus onClick={() => onAsk(false)}>
              취소
            </button>
            <button type="button" className="btn btn-xs btn-danger" onClick={onRemove}>
              지우기
            </button>
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

function EditCard({
  contact: c,
  byId,
  projects,
  onCancel,
  onSave,
}: {
  contact: Contact;
  byId: Map<number, Project>;
  projects: Project[];
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
  useEffect(() => {
    const down = (e: MouseEvent) => {
      // 누른 것이 그 사이 사라졌어도(배지 × 등) 누를 때의 자리로 판단해요.
      if (ref.current && !e.composedPath().includes(ref.current)) latest.current.save(true);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

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
        <ProjectChips projects={projects} value={v.proj} onChange={(proj) => setV((old) => ({ ...old, proj }))} pending={pending} />
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
}: {
  initial: MemoLine[];
  onCancel: () => void;
  onSave: (l: MemoLine[]) => void;
  boundary?: RefObject<HTMLElement>;
}) {
  const [lines, setLines] = useState<MemoLine[]>(initial.length ? initial.map((l) => ({ ...l })) : [{ t: "" }]);
  const [focus, setFocus] = useState(Math.max(0, initial.length - 1));
  const box = useRef<HTMLDivElement>(null);
  const caret = useRef<number | null>(null);
  const latest = useRef({ lines, onSave });
  latest.current = { lines, onSave };

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
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const inside = boundary?.current ?? box.current;
      if (inside && !inside.contains(e.target as Node)) latest.current.onSave(latest.current.lines);
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

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
        <button
          type="button"
          className="tb tb-del"
          aria-label="줄 삭제"
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
          <DelIcon />
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

// ---------- 프로젝트 관리 창 ----------

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
  const [ask, setAsk] = useState<number | null>(null);
  /** 이름을 고치고 있는 프로젝트 */
  const [editId, setEditId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Esc는 묻는 띠를 먼저 닫고, 없으면 창을 닫아요. 커서가 창 밖에 있어도 들어요.
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      if (askRef.current !== null) setAsk(null);
      else onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  async function add() {
    const name = draft.trim();
    if (!name) return;
    if (await run(api.addProject(name))) setDraft("");
    inputRef.current?.focus();
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dialog mgr" role="dialog" aria-modal="true" aria-label="프로젝트 관리">
        <div className="dialog-head">
          <span className="dialog-title">프로젝트 관리</span>
        </div>
        <div className="dialog-body">
          {data.projects.length === 0 && <p className="muted small">아직 프로젝트가 없어요.</p>}
          {data.projects.map((p) => {
            const k = projectColor(p);
            const users = data.contacts.filter((c) => c.projects.includes(p.id)).length;
            return (
              <div key={p.id} className="prow">
                <div className="prow-name mgr-name pj-mname">
                  {editId === p.id ? (
                    <NamesEdit
                      full={fullDraft(p)}
                      short={p.alias}
                      taken={(n) => data.projects.some((x) => x.id !== p.id && (x.name === n || x.alias === n))}
                      onDone={async (v) => {
                        setEditId(null);
                        if (v && (v.full !== fullDraft(p) || v.short !== p.alias)) await run(api.setProjectNames(p.id, v.full, v.short));
                      }}
                    />
                  ) : (
                    <>
                      <span className="mgr-badge-line">
                        <button type="button" className="pbadge mgr-badge-btn" style={pjStyle(p)} title="눌러서 이름 고치기" onClick={() => setEditId(p.id)}>
                          <span className="pbadge-t">{pjLabel(p)}</span>
                        </button>
                        <span className="mgr-info">{users ? `연락처 ${users}명` : "연락처 없음"}</span>
                      </span>
                      {pjOther(p) && (
                        <span className="mgr-full" title={pjOther(p)}>
                          {pjOther(p)}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <ColorPick
                  name={p.name}
                  current={k}
                  auto={p.color === null}
                  onPick={(c) => run(api.setProjectColor(p.id, c))}
                />
                <button type="button" className="tool-box" aria-label={`${p.name} 지우기`} title="이 프로젝트 지우기" onClick={() => setAsk(p.id)}>
                  <DelIcon />
                </button>
                {ask === p.id && (
                  <div className="ask-band ask-wide" role="alertdialog" aria-label="프로젝트 지우기 확인">
                    <span>{users ? `${users}명에게 붙어 있어요. 지워도 사람은 남고 배지만 빠져요.` : "아무에게도 붙어 있지 않아요. 지울까요?"}</span>
                    <button type="button" className="btn btn-xs" autoFocus onClick={() => setAsk(null)}>
                      취소
                    </button>
                    <button
                      type="button"
                      className="btn btn-xs btn-danger"
                      onClick={async () => {
                        setAsk(null);
                        await run(api.deleteProject(p.id));
                        inputRef.current?.focus();
                      }}
                    >
                      지우기
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="padd">
            <input
              ref={inputRef}
              className="input"
              aria-label="새 프로젝트 이름"
              placeholder="새 프로젝트 이름"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isComposing(e)) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="btn-primary btn-ctrl mgr-add" onClick={add}>
              <Plus size={16} /> 추가
            </button>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-ctrl btn-text" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
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
  taken,
  onDone,
}: {
  full: string;
  short: string;
  taken: (name: string) => boolean;
  onDone: (v: { full: string; short: string } | null) => void;
}) {
  const [full, setFull] = useState(full0);
  const [short, setShort] = useState(short0);
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
    onDone(save && !bad ? { full: f, short: sh } : null);
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
      <label className="mgr-names-l" htmlFor="pj-full">
        정식 이름(문서용)
      </label>
      <input
        id="pj-full"
        className={"input mgr-name-in" + (empty || badFull ? " invalid" : "")}
        aria-invalid={empty || badFull || undefined}
        title={tip(empty || badFull, badFull)}
        autoFocus
        value={full}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setFull(e.target.value)}
        onKeyDown={key}
      />
      <label className="mgr-names-l" htmlFor="pj-short">
        줄인 이름(관리용)
      </label>
      <input
        id="pj-short"
        className={"input mgr-name-in" + (empty || badShort ? " invalid" : "")}
        aria-invalid={empty || badShort || undefined}
        title={tip(empty || badShort, badShort)}
        placeholder="비우면 정식 이름으로 보여요"
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
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    // 창 전체의 Esc(관리 창 닫기)보다 먼저 받아서 펼친 목록만 닫아요.
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open]);
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
        aria-label={`${name} 색: ${auto ? "자동" : COLOR_NAMES[current]} — 눌러서 바꾸기`}
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
