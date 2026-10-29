// 민원처리 – 창: 공사 관리 창(WorksDialog·ProjectPick·AgentInputs)과 메일 보내기 창(MailDialog).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, Contact, ContactsData, errorText, Work, WorkInput } from "../../api";
import { projectColor } from "../../screens/contacts/parts";
import { DelMark } from "../../Icons";
import { DialogX } from "../../DialogX";
import { overlayDown, useOutsideClose } from "../../useOutsideClose";
import { koIndex } from "../../journal";
import { fileName } from "../../process";
import { AskBand } from "../../AskBand";
import { Floating } from "./Menu";
import { workColor, MailDraft, MailIcon } from "./parts";

const phoneOf = (c: Contact | undefined) => (c ? c.mobile || c.tel : "");

// ---------- 공사 관리 창 ----------

type Draft = { name: string; full: string; project: number | null; co: string; contact: number | null; agent: string; phone: string; scope: string; nextSeq: string };

const EMPTY_DRAFT: Draft = { name: "", full: "", project: null, co: "", contact: null, agent: "", phone: "", scope: "", nextSeq: "1" };

export function WorksDialog({
  works,
  cd,
  onSave,
  onDelete,
  onContacts,
  onClose,
}: {
  works: Work[];
  cd: ContactsData;
  onSave: (id: number | null, w: WorkInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onContacts: (c: ContactsData) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [selW, setSelW] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [edit, setEdit] = useState<Draft>(EMPTY_DRAFT);
  const [ask, setAsk] = useState<{ id: number; rect: DOMRect } | null>(null);
  const [err, setErr] = useState("");
  const editRef = useRef<HTMLDivElement>(null);

  const contactOf = (id: number | null) => cd.contacts.find((c) => c.id === id);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || ask) return;
      if (editing != null) setEditing(null);
      else onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [editing, ask, onClose]);

  /** 연락처를 잇고(없으면 새로 등록), 공사명 프로젝트를 붙여요. 돌려주는 것: [연락처 번호, 프로젝트 번호, 새 자료] */
  async function link(d: Draft, oldProject: number | null): Promise<[number | null, number | null, ContactsData]> {
    let data = cd;
    let projectId = d.project ?? oldProject;
    const name = d.name.trim();
    const full = d.full.trim();
    // 공사명 = 업무연락처 프로젝트: 정식 공사명이 프로젝트 정식 이름, 축약 공사명이 줄인 이름(바꾸면 따라가요)
    const same = (p: { name: string; alias: string }) => p.name === name || p.alias === name || (!!full && p.name === full);
    if (projectId == null || !data.projects.some((p) => p.id === projectId)) {
      // 줄인 이름(alias)이 같은 프로젝트도 같은 것으로 봐요(core add_project와 같게, 2026-10-18 업무연락처 세션 전달)
      if (!data.projects.some(same)) data = await api.addProject(name);
      projectId = data.projects.find(same)?.id ?? null;
    }
    const p = data.projects.find((x) => x.id === projectId);
    if (p) {
      const want = full && full !== name ? { name: full, alias: name } : { name, alias: "" };
      if (p.name !== want.name || p.alias !== want.alias) data = await api.setProjectNames(p.id, want.name, want.alias);
    }
    const pname = name;
    let contactId = d.contact;
    if (contactId == null && d.agent.trim()) {
      // 업무연락처에 새로 등록(소속 = 시공사)
      data = await api.addContact({ name: d.agent.trim(), org: d.co.trim(), role: "현장대리인", mobile: d.phone, tel: "", email: "", projects: [pname] });
      const made = [...data.contacts].reverse().find((c) => c.name === d.agent.trim());
      contactId = made?.id ?? null;
    } else if (contactId != null) {
      const c = data.contacts.find((x) => x.id === contactId);
      if (c) {
        const names = c.projects.map((id) => data.projects.find((p) => p.id === id)?.name).filter((x): x is string => !!x);
        if (!names.includes(pname)) names.push(pname);
        const phone = d.phone !== phoneOf(c) ? d.phone : null;
        data = await api.updateContact(c.id, {
          name: c.name,
          org: c.org,
          role: c.role,
          mobile: phone != null && (c.mobile || !c.tel) ? phone : c.mobile,
          tel: phone != null && !c.mobile && c.tel ? phone : c.tel,
          email: c.email,
          projects: names,
        });
      }
    }
    onContacts(data);
    return [contactId, projectId, data];
  }

  async function add() {
    setErr("");
    const d = draft.name.trim() ? draft : { ...draft, name: draft.full.trim() };
    if (!d.name.trim()) {
      setErr("공사명을 적거나 업무연락처에서 골라요");
      return;
    }
    try {
      const [contact, project] = await link(d, null);
      await onSave(null, { name: d.name.trim(), full: d.full.trim(), co: d.co.trim(), contact, project, scope: d.scope.trim(), nextSeq: Math.max(1, Number(d.nextSeq) || 1), tpl: "" });
      setDraft(EMPTY_DRAFT);
    } catch (e) {
      setErr(errorText(e));
    }
  }

  function startEdit(w: Work) {
    const c = contactOf(w.contact);
    setEdit({ name: w.name, full: w.full, project: w.project, co: w.co, contact: w.contact, agent: c?.name ?? "", phone: phoneOf(c), scope: w.scope, nextSeq: String(w.nextSeq) });
    setEditing(w.id);
    setSelW(w.id);
  }

  const saveEdit = useCallback(async () => {
    const w = works.find((x) => x.id === editing);
    setEditing(null);
    if (!w || !edit.name.trim()) return;
    try {
      const [contact, project] = await link(edit, w.project);
      await onSave(w.id, { name: edit.name.trim(), full: edit.full.trim(), co: edit.co.trim(), contact, project, scope: edit.scope.trim(), nextSeq: Math.max(1, Number(edit.nextSeq) || w.nextSeq), tpl: w.tpl });
    } catch (e) {
      setErr(errorText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, edit, works, cd]);

  // 고치는 줄 바깥을 누르면 저장해요(누르기 시작한 곳 기준).
  useOutsideClose(editing != null, [editRef], () => saveEdit(), { on: "window", ignore: ".pr-float" });

  return (
    <div className="overlay" onMouseDown={overlayDown(() => editing == null && onClose())}>
      <div className="dialog pr-works" role="dialog" aria-modal="true" aria-label="공사 관리">
        <div className="dialog-head pr-works-head">
          <span className="dialog-title">공사 관리</span>
          <span className="pr-sub">계약된 공사와 시공사예요. 민원을 어느 공사로 보낼지 여기 처리 범위를 보고 판단해요.</span>
        </div>
        <div className="pr-wgrid pr-whead">
          <span>공사명 (지시부 · 업무연락처에서 고르기)</span>
          <span>축약 공사명 (표·파일)</span>
          <span>현장대리인 (업무연락처)</span>
          <span>시공사</span>
          <span>처리 범위 (판단 기준)</span>
          <span>다음 연번</span>
          <span />
        </div>
        <div className="pr-wlist">
          {works.map((w) => {
            const c = contactOf(w.contact);
            const k = workColor(w, cd);
            if (editing === w.id) {
              return (
                <div key={w.id} ref={editRef} className="pr-wgrid pr-wrow pr-wedit" onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === "INPUT" && !document.querySelector(".pr-cmenu")) saveEdit(); }}>
                  <ProjectPick d={edit} cd={cd} onChange={setEdit} />
                  <input className="cell-input" aria-label="축약 공사명" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                  <AgentInputs d={edit} contacts={cd.contacts} onChange={setEdit} />
                  <input className="cell-input" aria-label="시공사" value={edit.co} onChange={(e) => setEdit({ ...edit, co: e.target.value })} />
                  <input className="cell-input" aria-label="처리 범위" value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} />
                  <input className="cell-input pr-in center" aria-label="다음 연번" value={edit.nextSeq} onChange={(e) => setEdit({ ...edit, nextSeq: e.target.value.replace(/\D/g, "") })} />
                  <button type="button" className="pr-save" title="저장 (Enter)" onClick={saveEdit}>
                    저장
                  </button>
                </div>
              );
            }
            return (
              <div
                key={w.id}
                className="pr-wgrid pr-wrow"
                data-sel={selW === w.id ? "1" : undefined}
                title="두 번 누르면 고쳐요"
                onClick={() => setSelW(w.id)}
                onDoubleClick={() => startEdit(w)}
              >
                <span className="pr-wname" title={w.full || w.name}>
                  <span className="pr-dot" style={{ background: `var(--pj-${k}-line)` }} />
                  <span className="pr-ell">{w.full || w.name}</span>
                </span>
                <span className="pr-ell">{w.full && w.full !== w.name ? w.name : <span className="pr-sub">–</span>}</span>
                <span className="pr-agent" title="업무연락처와 같은 연락처예요. 어느 쪽에서 고쳐도 함께 바뀌어요">
                  {c ? (
                    <span className="pr-agent-name">
                      <PersonIcon />
                      {c.name}
                    </span>
                  ) : (
                    <span className="pr-sub">–</span>
                  )}
                </span>
                <span className="pr-ell">{w.co}</span>
                <span className="pr-scope">{w.scope}</span>
                <span className="pr-num">{String(w.nextSeq).padStart(2, "0")}</span>
                <button
                  type="button"
                  className="pr-del del-hit"
                  aria-label={`${w.name} 지우기`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAsk({ id: w.id, rect: e.currentTarget.getBoundingClientRect() });
                  }}
                >
                  <DelMark />
                </button>
              </div>
            );
          })}
          <div className="pr-wgrid pr-wrow pr-wnew">
            <ProjectPick d={draft} cd={cd} onChange={setDraft} placeholder="업무연락처 사업 찾기" />
            <input className="cell-input" placeholder="예: 동부권 도로시설물 1지구" aria-label="새 축약 공사명" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <AgentInputs d={draft} contacts={cd.contacts} onChange={setDraft} />
            <input className="cell-input" placeholder="시공사" aria-label="새 시공사" value={draft.co} onChange={(e) => setDraft({ ...draft, co: e.target.value })} />
            <input className="cell-input" placeholder="예: 반사경, 시선유도봉, 작은 포트홀" aria-label="새 처리 범위" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
            <input className="cell-input pr-in center" title="처음 연번(보통 1)" aria-label="새 다음 연번" value={draft.nextSeq} onChange={(e) => setDraft({ ...draft, nextSeq: e.target.value.replace(/\D/g, "") })} />
            <button type="button" className="pr-add" aria-label="공사 등록" onClick={add}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
        <div className="pr-hints">
          {err && <span className="pr-err">{err}</span>}
          <span>공사명 칸에 치면 업무연락처 사업이 떠요. 고르면 축약 공사명·현장대리인·시공사를 업무연락처에서 채워요(목록에 없으면 새 사업으로 등록돼요). 현장대리인은 업무연락처와 같은 연락처예요(어느 쪽에서 고쳐도 함께 바뀌어요) – 고르면 시공사가 그 사람 소속으로 채워져요. 줄을 두 번 누르면 고치고 [저장]·Enter로 저장해요(Esc 취소).</span>
          <span>지시부는 모든 공사가 표준 양식 하나를 써요(설정 “민원처리”). 정식 공사명은 지시부 맨 위, 축약 공사명은 표의 공사 배지·지시부 번호·파일 이름에 들어가요.</span>
        </div>
        {/* 닫기 = 위 오른쪽 ×(✔7) – 고치는 줄이 있으면 저장하고 닫아요 */}
        <DialogX onClick={() => (editing != null ? saveEdit().then(onClose) : onClose())} />
      </div>
      {ask && (
        <Floating rect={ask.rect} align="right" onClose={() => setAsk(null)}>
          <AskBand
            className="pr-askfloat"
            label="공사 지우기 확인"
            text="이 공사를 지울까요?"
            onNo={() => setAsk(null)}
            onYes={async () => {
              const id = ask.id;
              setAsk(null);
              try {
                await onDelete(id);
              } catch (e) {
                setErr(errorText(e));
              }
            }}
          />
        </Floating>
      )}
    </div>
  );
}

/** 이 프로젝트의 현장대리인: 업무연락처에서 그 프로젝트가 붙은 사람 중 직위가 "현장대리인"인 사람, 없으면 한 사람뿐일 때 그 사람 */
function agentOf(projectId: number, contacts: Contact[]): Contact | undefined {
  const on = contacts.filter((c) => c.projects.includes(projectId));
  return on.find((c) => c.role.includes("현장대리인")) ?? (on.length === 1 ? on[0] : undefined);
}

/** 공사명: 업무연락처 프로젝트를 전체·축약 공사명(초성도)으로 찾아 골라요. 고르면 축약 공사명·시공사·현장대리인을 채워요(2026-10-19 사용자). */
function ProjectPick({ d, cd, onChange, placeholder }: { d: Draft; cd: ContactsData; onChange: (d: Draft) => void; placeholder?: string }) {
  const [openList, setOpenList] = useState<DOMRect | null>(null);
  const [hi, setHi] = useState(0);
  const q = d.full.trim();
  const cands = (q ? cd.projects.filter((p) => koIndex(p.name, q) >= 0 || koIndex(p.alias, q) >= 0) : cd.projects).slice(0, 8);
  const exact = cd.projects.some((p) => p.name === q || p.alias === q);
  const n = cands.length + (q && !exact ? 1 : 0);
  const choose = (p: (typeof cd.projects)[number] | null) => {
    setOpenList(null);
    if (!p) return onChange({ ...d, project: null });
    const a = agentOf(p.id, cd.contacts);
    onChange({
      ...d,
      project: p.id,
      full: p.name,
      name: p.alias || p.name,
      ...(a ? { contact: a.id, agent: a.name, phone: phoneOf(a), co: a.org || d.co } : {}),
    });
  };
  return (
    <span className="pr-agent-in">
      <input
        className="cell-input"
        aria-label="공사명"
        placeholder={placeholder}
        value={d.full}
        onFocus={(e) => setOpenList(e.currentTarget.getBoundingClientRect())}
        onChange={(e) => {
          onChange({ ...d, full: e.target.value, project: null });
          setHi(0);
          setOpenList(e.currentTarget.getBoundingClientRect());
        }}
        onKeyDown={(e) => {
          if (!openList || e.nativeEvent.isComposing || n === 0) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setHi((hi + 1) % n));
          if (e.key === "ArrowUp") (e.preventDefault(), setHi((hi - 1 + n) % n));
          if (e.key === "Enter" || e.key === "Tab") choose(hi < cands.length ? cands[hi] : null);
          if (e.key === "Escape") (e.stopPropagation(), setOpenList(null));
        }}
      />
      {openList && n > 0 && (
        <Floating rect={openList} align="left" onClose={() => setOpenList(null)}>
          <div className="pr-menu pr-cmenu pr-pmenu" role="listbox" aria-label="업무연락처 사업">
            {cands.map((p, i) => {
              const a = agentOf(p.id, cd.contacts);
              return (
                <button key={p.id} type="button" role="option" aria-selected={i === hi} className="pr-copt pr-popt" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(p)}>
                  <span className="pr-dot" style={{ background: `var(--pj-${projectColor(p)}-line)` }} />
                  <span className="pr-popt-t">
                    <span className="pr-ell">{p.name}</span>
                    <span className="pr-sub pr-ell">{[p.alias, a && `${a.name}${a.org ? ` · ${a.org}` : ""}`].filter(Boolean).join(" · ") || "현장대리인 없음"}</span>
                  </span>
                </button>
              );
            })}
            {q && !exact && (
              <button type="button" role="option" aria-selected={hi === cands.length} className="pr-copt pr-new" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)}>
                ＋ "{q}" 새 사업으로 추가
              </button>
            )}
          </div>
        </Floating>
      )}
    </span>
  );
}

/** 현장대리인: 이름·초성으로 업무연락처에서 골라요. 아래 칸은 번호(고치면 업무연락처도 바뀌어요). */
function AgentInputs({ d, contacts, onChange }: { d: Draft; contacts: Contact[]; onChange: (d: Draft) => void }) {
  const [openList, setOpenList] = useState<DOMRect | null>(null);
  const [hi, setHi] = useState(0);
  const inRef = useRef<HTMLInputElement>(null);
  const q = d.agent.trim();
  const cands = q ? contacts.filter((c) => koIndex(c.name, q) === 0 || koIndex(c.org, q) >= 0).slice(0, 6) : contacts.slice(0, 6);
  const exact = contacts.some((c) => c.name === q);
  const choose = (c: Contact | null) => {
    // 현장대리인을 고르면 시공사는 늘 그 사람 소속으로(소속이 비었으면 그대로) – 2026-10-25 19:33 사용자 1안
    if (c) onChange({ ...d, contact: c.id, agent: c.name, phone: phoneOf(c), co: c.org.trim() || d.co });
    else onChange({ ...d, contact: null });
    setOpenList(null);
  };
  return (
    <span className="pr-agent-in">
      <input
        ref={inRef}
        className="cell-input"
        aria-label="현장대리인"
        placeholder="이름·초성"
        value={d.agent}
        onFocus={(e) => setOpenList(e.currentTarget.getBoundingClientRect())}
        onChange={(e) => {
          onChange({ ...d, agent: e.target.value, contact: null });
          setHi(0);
          setOpenList(e.currentTarget.getBoundingClientRect());
        }}
        onKeyDown={(e) => {
          if (!openList || e.nativeEvent.isComposing) return;
          const n = cands.length + (q && !exact ? 1 : 0);
          if (e.key === "ArrowDown") (e.preventDefault(), setHi((hi + 1) % Math.max(1, n)));
          if (e.key === "ArrowUp") (e.preventDefault(), setHi((hi - 1 + n) % Math.max(1, n)));
          if (e.key === "Enter" || e.key === "Tab") {
            if (hi < cands.length) choose(cands[hi]);
            else choose(null);
          }
          if (e.key === "Escape") (e.stopPropagation(), setOpenList(null));
        }}
      />
      {openList && (cands.length > 0 || q) && (
        <Floating rect={openList} align="left" onClose={() => setOpenList(null)}>
          <div className="pr-menu pr-cmenu" role="listbox" aria-label="업무연락처">
            {cands.map((c, i) => (
              <button key={c.id} type="button" role="option" aria-selected={i === hi} className="pr-copt" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c)}>
                <span className="pr-copt-name">{c.name}</span>
                <span className="pr-sub pr-ell">{c.org}</span>
                <span className="pr-num">{phoneOf(c)}</span>
              </button>
            ))}
            {q && !exact && (
              <button type="button" role="option" aria-selected={hi === cands.length} className="pr-copt pr-new" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(null)}>
                ＋ "{q}" 업무연락처에 새로 등록
              </button>
            )}
          </div>
        </Floating>
      )}
    </span>
  );
}

function PersonIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

/** 메일로 보낼까요? – 받는 사람·제목·본문(고칠 수 있어요)·첨부. [보내기]를 누르면 Claude가 korea.kr에서 보내기까지 해요(사용자 2안). */
export function MailDialog({ draft, files, from, onChange, onSend, onClose }: { draft: MailDraft; files: string[]; from: string; onChange: (d: MailDraft) => void; onSend: () => void; onClose: () => void }) {
  const subjectRef = useRef<HTMLInputElement>(null);
  useEffect(() => subjectRef.current?.focus(), []);
  const ok = draft.subject.trim() !== "" && draft.to !== "";
  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div
        className="dialog pr-mail"
        role="dialog"
        aria-modal="true"
        aria-label="메일로 보내기"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !e.nativeEvent.isComposing && ok) {
            e.preventDefault();
            onSend();
          }
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">메일로 보낼까요?</span>
        </div>
        <DialogX label="닫기(보내지 않음)" onClick={onClose} />
        <div className="pr-mail-grid">
          <span className="pr-mail-k">받는 사람</span>
          <span>
            <b>{draft.toName}</b> 현장대리인{draft.org ? ` · ${draft.org}` : ""} · {draft.to}
          </span>
          <span className="pr-mail-k">보내는 곳</span>
          <span>korea.kr 메일 · {from} (크롬에 로그인해 둔 계정)</span>
          <span className="pr-mail-k">제목</span>
          <input ref={subjectRef} className="input" aria-label="메일 제목" value={draft.subject} onChange={(e) => onChange({ ...draft, subject: e.target.value })} />
          <span className="pr-mail-k top">본문</span>
          <textarea className="input pr-mail-body" aria-label="메일 본문" rows={4} value={draft.body} onChange={(e) => onChange({ ...draft, body: e.target.value })} />
          <span className="pr-mail-k top">첨부 {files.length}개</span>
          <div className="pr-mail-files">
            {files.map((f) => (
              <span key={f} className="pr-mail-file" title={f}>
                {fileName(f)}
              </span>
            ))}
          </div>
        </div>
        <p className="pr-mail-hint">[보내기]를 누르면 Claude가 크롬 korea.kr 탭에서 메일을 써서 바로 보내요.</p>
        <div className="dialog-foot pr-mail-foot">
          <button type="button" className="btn btn-ctrl btn-text" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn-primary btn-ctrl pr-mail-send" disabled={!ok} onClick={onSend}>
            <MailIcon />
            보내기
          </button>
        </div>
      </div>
    </div>
  );
}
