// 민원처리 화면이에요(10단계). 시안 Process.dc.html과 사양서 "민원처리" 절을 따라요.
//
// - 상태 열이 없어요. 맨 오른쪽 단추 자리 하나가 진행을 보여 줘요: [지시부 만들기] → [폰으로 보내기] → ✓ 전송 완료.
// - [민원 불러오기]는 받은편지함 폴더의 결과 파일(JSON)을 읽어요(AI가 놓아요). 사진은 민원 폴더로 옮겨요.
// - [지시부 만들기] = 양식 채우기(민원 폴더에 접수일_위치_보수내용.pptx/hwpx) + 민원대장 등록(조치내용 "□ 공사명 지시(연번)")
//   + JPG(파워포인트·한글). 민원대장에서 완료하면 이 표에서 숨어요.
// - [폰으로 보내기] = JPG를 보낼편지함에 복사(Claude가 대화에 올려요) → ✓ 전송 완료.
// - 대상이 아닌 건은 줄 끝 ×(작은 묻기 창). 지운 건은 다음 불러오기 때 다시 와요.
// - 공사 관리 창: 현장대리인은 업무연락처에서 골라요(같은 연락처 하나 — 쌍방향), 공사명은 업무연락처 프로젝트로도 등록돼요.
import { CSSProperties, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, Case, Complaint, Contact, ContactsData, errorText, inApp, previewInbox, Work, WorkInput } from "./api";
import { daysBetween } from "./complaints";
import { projectColor } from "./ContactsScreen";
import { DelIcon } from "./Icons";
import { koIndex, todayStr } from "./journal";
import { actionLine, fileName, md, orderDate, PORTAL_URL, processError, SAMPLE_WORKS, SAMPLES, signerText } from "./process";
import { DEFAULT_PROCESS, DONE_STATUS, loadSettings, ProcessSettings } from "./settingsStore";

type Props = { urgentDays: number; onOpenComplaint: (id: number) => void };

/** 공사 색 = 업무연락처 프로젝트 색 */
function workColor(w: Work | undefined, cd: ContactsData | null): number {
  const p = w && cd?.projects.find((x) => x.id === w.project);
  return p ? projectColor(p) : 0;
}

const phoneOf = (c: Contact | undefined) => (c ? c.mobile || c.tel : "");

const FETCHED_KEY = "process.fetched";

const errText = (e: unknown) => processError(e) ?? (typeof e === "string" && e.length > 12 ? e : errorText(e));

const stamp = () => {
  const t = new Date();
  return `${md(todayStr(t))} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

export default function ProcessScreen({ urgentDays, onOpenComplaint }: Props) {
  const [works, setWorks] = useState<Work[] | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [cd, setCd] = useState<ContactsData | null>(null);
  const [ps, setPs] = useState<ProcessSettings>(DEFAULT_PROCESS);
  const [fetched, setFetched] = useState("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  const [reading, setReading] = useState(false);
  // 지시부·JPG를 만드는 중인 줄
  const [busy, setBusy] = useState<Record<string, string>>({});
  // 뜨는 목록(공사 고르기)과 지우기 묻기 창
  const [pick, setPick] = useState<{ no: string; rect: DOMRect } | null>(null);
  const [ask, setAsk] = useState<{ no: string; rect: DOMRect } | null>(null);

  const today = todayStr();

  useEffect(() => {
    (async () => {
      const [pd, cl, cdata, st, f] = await Promise.all([api.processData(), api.complaints(), api.contactsData(), loadSettings(), api.get(FETCHED_KEY)]);
      setCases(pd.cases);
      setComplaints(cl);
      setCd(cdata);
      setPs(st.process);
      setFetched(f ?? "");
      // 미리 보기: 공사가 없으면 보기 공사를 넣어요(업무연락처·프로젝트도 함께 생겨요).
      if (!inApp && pd.works.length === 0) await seedPreview(cdata);
      else setWorks(pd.works);
    })().catch((e) => setNote(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function seedPreview(start: ContactsData) {
    let data = start;
    let list: Work[] = [];
    for (const s of SAMPLE_WORKS) {
      data = await api.addContact({ name: s.agent, org: s.co, role: "현장대리인", mobile: s.phone, tel: "", email: "", projects: [s.name] });
      const c = data.contacts.find((x) => x.name === s.agent && x.org === s.co) ?? null;
      const p = data.projects.find((x) => x.name === s.name) ?? null;
      list = await api.saveWork(null, { name: s.name, co: s.co, contact: c?.id ?? null, project: p?.id ?? null, scope: s.scope, nextSeq: s.nextSeq, tpl: s.tpl });
    }
    setWorks(list);
    setCd(data);
  }

  const putCase = (c: Case) => setCases((l) => l.map((x) => (x.no === c.no ? c : x)));
  const patch = async (no: string, p: Parameters<typeof api.updateCase>[1]) => {
    try {
      putCase(await api.updateCase(no, p));
    } catch (e) {
      setNote(errText(e));
    }
  };

  const isDone = (c: Case) => {
    if (c.complaint == null) return false;
    const m = complaints.find((x) => x.id === c.complaint);
    return !!m && m.status === DONE_STATUS;
  };

  const found = useMemo(() => {
    const s = q.trim();
    if (!s) return cases;
    return cases.filter((c) => [c.no, c.area, c.place, c.summary, c.reason, c.note].some((t) => koIndex(t, s) >= 0));
  }, [cases, q]);
  const open = found.filter((c) => !isDone(c));
  const done = found.filter((c) => isDone(c));
  const rows = showDone ? [...open, ...done] : open;

  // ---------- 민원 불러오기: 받은편지함의 결과 파일을 읽어요 ----------
  async function fetchCases() {
    if (reading || !works) return;
    setReading(true);
    setNote("");
    try {
      if (!inApp) {
        // 미리 보기: 보기 민원을 받은편지함에 넣어 둬요(공사는 이름 앞 글자로).
        previewInbox(SAMPLES.map(({ guess, ...c }) => ({ ...c, work: guess ? works.find((w) => w.name.startsWith(guess))?.id ?? null : null })));
      }
      const r = await api.readInbox(ps.inbox, ps.downloads, ps.root);
      setCases((l) => [...l, ...r.added]);
      const msg = [`새 민원 ${r.added.length}건`, r.skipped ? `이미 있는 ${r.skipped}건` : "", r.failed.length ? `못 읽은 파일 ${r.failed.join(", ")}` : "", r.missingFiles.length ? `못 찾은 사진 ${r.missingFiles.length}개` : ""]
        .filter(Boolean)
        .join(" · ");
      setNote(msg);
      const f = `${stamp()} · 새 민원 ${r.added.length}건`;
      setFetched(f);
      await api.set(FETCHED_KEY, f);
    } catch (e) {
      setNote(errText(e));
    } finally {
      setReading(false);
    }
  }

  // ---------- 지시부 만들기 · 폰으로 보내기 ----------
  async function makeJpg(no: string): Promise<Case | null> {
    setBusy((b) => ({ ...b, [no]: "JPG 만드는 중…" }));
    try {
      const c = await api.orderJpg(no);
      putCase(c);
      return c;
    } catch (e) {
      setNote(`JPG를 만들지 못했어요 — ${errText(e)}`);
      return null;
    } finally {
      setBusy(({ [no]: _, ...b }) => b);
    }
  }

  async function makeOrder(c: Case) {
    const w = works?.find((x) => x.id === c.work);
    if (!w || busy[c.no]) return;
    setBusy((b) => ({ ...b, [c.no]: "만드는 중…" }));
    try {
      const r = await api.makeOrder({ no: c.no, root: ps.root, signer: signerText(ps.signer, ps.signerPhone), date: orderDate(today) });
      // 민원대장: 처음이면 등록, 다시 만들면(공사를 바꾼 뒤) 그 줄의 조치내용을 고쳐요.
      const action = JSON.stringify([{ t: actionLine(r.workName, r.seq), k: "sq" }]);
      const old = c.complaint != null ? complaints.find((x) => x.id === c.complaint) : undefined;
      let m: Complaint;
      if (old) {
        const { id, no: _n, memo: _m, ...input } = old;
        m = await api.updateComplaint(id, { ...input, action });
        setComplaints((l) => l.map((x) => (x.id === m.id ? m : x)));
      } else {
        m = await api.addComplaint({
          intake: "국민신문고",
          received: c.received,
          ctype: "",
          area: c.area,
          place: c.place,
          person: "",
          phone: "",
          body: JSON.stringify([{ t: c.summary }]),
          action,
          due: c.due,
          status: "접수",
        });
        setComplaints((l) => [...l, m]);
      }
      putCase(await api.updateCase(c.no, { complaint: m.id }));
      setWorks((l) => l && l.map((x) => (x.id === w.id ? { ...x, nextSeq: Math.max(x.nextSeq, r.seq + 1) } : x)));
      setNote(`지시부를 만들고 민원대장 ${m.no}번에 ${old ? "고쳐 적었어요" : "등록했어요"}` + (r.missing.length ? ` · 양식에 없는 자리 ${r.missing.join(" ")}` : ""));
    } catch (e) {
      setNote(errText(e));
      return;
    } finally {
      setBusy(({ [c.no]: _, ...b }) => b);
    }
    await makeJpg(c.no);
  }

  async function send(c: Case) {
    if (busy[c.no]) return;
    const ready = c.orderJpg ? c : await makeJpg(c.no);
    if (!ready?.orderJpg) return;
    try {
      putCase(await api.sendOrder(c.no, ps.outbox, `${today} ${stamp().slice(6)}`));
      setNote("보낼편지함에 넣었어요. Claude가 대화에 올리면 폰에서 카톡으로 공유해요");
    } catch (e) {
      setNote(errText(e));
    }
  }

  async function openFile(path: string, select = false) {
    try {
      await (select ? api.showInFolder(path) : api.openPath(path));
    } catch (e) {
      setNote(errText(e));
    }
  }

  async function changeWork(c: Case, id: number) {
    setPick(null);
    if (c.work === id) return;
    // 지시부를 만든 뒤 공사를 바꾸면 [지시부 만들기]로 돌아가요(만들면 민원대장 조치내용을 고쳐요).
    await patch(c.no, { work: id });
  }

  async function remove(no: string) {
    setAsk(null);
    try {
      await api.deleteCase(no);
      setCases((l) => l.filter((c) => c.no !== no));
    } catch (e) {
      setNote(errText(e));
    }
  }

  // 공사 관리 창이 쓰는 저장
  const saveWork = useCallback(async (id: number | null, input: WorkInput) => setWorks(await api.saveWork(id, input)), []);
  const deleteWork = useCallback(async (id: number) => {
    setWorks(await api.deleteWork(id));
    setCases((await api.processData()).cases);
  }, []);

  // 바깥 누르기·Esc로 뜨는 것 닫기
  useEffect(() => {
    if (!pick && !ask) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && (setPick(null), setAsk(null));
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pick, ask]);

  if (!works) {
    return (
      <>
        <h1 className="title">민원처리</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  const pickCase = pick && cases.find((c) => c.no === pick.no);
  const total = cases.filter((c) => !isDone(c)).length;

  return (
    <div className="pr">
      <div className="ct-head">
        <h1 className="title">민원처리</h1>
        <label className="search">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" aria-label="민원처리 검색" placeholder="접수번호, 위치, 내용 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ctrl btn-text" onClick={() => setWorksOpen(true)}>
          공사 관리
        </button>
        <button type="button" className="btn btn-ctrl btn-text" title="업무처리포털을 엣지로 열어요. 처음 한 번 로그인해 두면 돼요" onClick={() => window.open(PORTAL_URL, "_blank")}>
          신문고 열기
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
          </svg>
        </button>
        <button type="button" className="btn-primary btn-ctrl pr-fetch" title="받은편지함의 결과 파일을 읽어요" onClick={fetchCases} disabled={reading}>
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />
          </svg>
          {reading ? "불러오는 중…" : "민원 불러오기"}
        </button>
      </div>

      <div className="pr-table" role="table" aria-label="민원처리 목록">
        <div className="pr-row pr-headrow" role="row">
          <div role="columnheader">접수번호</div>
          <div role="columnheader">접수</div>
          <div role="columnheader">기한</div>
          <div role="columnheader">위치</div>
          <div role="columnheader">민원 요약 · 판단 이유</div>
          <div role="columnheader">판단 공사</div>
          <div role="columnheader">고려사항</div>
          <div role="columnheader">연번</div>
          <div role="columnheader" className="pr-c">지시부 작성</div>
        </div>
        <div className="pr-body">
          {rows.length === 0 && (
            <p className="pr-empty">{cases.length === 0 ? "[민원 불러오기]를 누르면 받은편지함의 민원을 가져와요." : q ? "찾는 민원이 없어요." : "처리할 민원이 없어요."}</p>
          )}
          {rows.map((c) => {
            const w = works.find((x) => x.id === c.work);
            const isD = isDone(c);
            const left = c.due ? daysBetween(today, c.due) : null;
            const k = workColor(w, cd);
            const asking = ask?.no === c.no;
            const b = busy[c.no];
            return (
              <div
                key={c.no}
                className="pr-row"
                role="row"
                data-sel={sel === c.no || asking ? "1" : undefined}
                data-done={isD ? "1" : undefined}
                onClick={() => setSel(sel === c.no ? null : c.no)}
                onDoubleClick={() => c.complaint != null && onOpenComplaint(c.complaint)}
              >
                <div className="pr-no">{c.no}</div>
                <div className="pr-date">{md(c.received)}</div>
                <div className="pr-date pr-due">
                  <span>{md(c.due)}</span>
                  {!isD && left !== null && (
                    <span className={"pr-d" + (left <= urgentDays ? " urgent" : left <= urgentDays + 1 ? " soon" : "")}>
                      {left > 0 ? `D-${left}` : left === 0 ? "D-day" : `D+${-left}`}
                    </span>
                  )}
                </div>
                <div className="pr-place">
                  <span className="pr-sub">{c.area || "\u00a0"}</span>
                  <span className={c.place === "주소불명" ? "pr-unknown" : undefined}>{c.place}</span>
                </div>
                <div className="pr-sum">
                  <span>{c.summary}</span>
                  <span className="pr-sub">{c.reason}</span>
                </div>
                <div>
                  <button
                    type="button"
                    className={"pr-work" + (w ? "" : " none")}
                    style={w ? ({ "--wc": `var(--pj-${k}-line)`, "--wf": `var(--pj-${k}-fg)` } as CSSProperties) : undefined}
                    disabled={isD || !!b}
                    title={isD ? undefined : c.stage === "new" ? "눌러서 공사 고르기" : "공사를 바꾸면 지시부를 다시 만들어요"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAsk(null);
                      setPick(pick?.no === c.no ? null : { no: c.no, rect: e.currentTarget.getBoundingClientRect() });
                    }}
                  >
                    {w ? w.name : "— 공사 고르기"}
                  </button>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <TextCell value={c.note} disabled={isD} placeholder={isD ? "" : "예: 야간 작업, 교통 통제 협의"} onSave={(v) => patch(c.no, { note: v })} />
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <TextCell
                    value={c.seq}
                    disabled={isD || c.stage !== "new"}
                    center
                    placeholder={w && !isD ? String(w.nextSeq) : ""}
                    title="비우면 다음 번호가 자동으로 붙어요"
                    clean={(v) => v.replace(/\D/g, "")}
                    onSave={(v) => patch(c.no, { seq: v })}
                  />
                </div>
                <div className="pr-acts" onClick={(e) => e.stopPropagation()}>
                  {b ? (
                    <button type="button" className="pr-next go" disabled>
                      {b}
                    </button>
                  ) : c.stage === "new" ? (
                    <button
                      type="button"
                      className={"pr-next" + (w ? " go" : "")}
                      disabled={!w || isD}
                      title={w ? "지시부 파일·JPG를 만들고 민원대장에 등록해요" : "먼저 공사를 골라요"}
                      onClick={() => makeOrder(c)}
                    >
                      지시부 만들기
                    </button>
                  ) : c.stage === "made" ? (
                    <button type="button" className="pr-next go" disabled={isD} title="JPG를 보낼편지함에 넣어요. Claude가 대화에 올리면 폰에서 카톡으로 공유해요" onClick={() => send(c)}>
                      폰으로 보내기
                    </button>
                  ) : (
                    <span className="pr-sent" title={isD ? "민원대장에서 완료됐어요" : "시공이 끝나면 민원대장에서 완료로 바꿔요. 그러면 이 표에서 숨어요"}>
                      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                      전송 완료
                    </span>
                  )}
                  <button
                    type="button"
                    className="pr-icon"
                    aria-label="지시부 열기"
                    title={c.orderFile ? `${fileName(c.orderFile)}\n파워포인트(한글)로 열어요` : "아직 지시부가 없어요"}
                    disabled={!c.orderFile}
                    onClick={() => openFile(c.orderFile)}
                  >
                    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                      <path d="M14 3v5h5M9 13h6M9 17h6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="pr-icon"
                    aria-label="이 민원 파일 보기"
                    title="탐색기를 열어 이 민원 파일을 보여요"
                    onClick={() => {
                      const f = c.orderFile || c.photos[0] || c.map;
                      openFile(f || c.folder || ps.root, !!f);
                    }}
                  >
                    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={"pr-del" + (asking ? " on" : "")}
                    aria-label="이 민원 지우기"
                    aria-expanded={asking}
                    title="지시부를 만들 건이 아니면 지워요"
                    onClick={(e) => {
                      setPick(null);
                      setAsk(asking ? null : { no: c.no, rect: e.currentTarget.getBoundingClientRect() });
                    }}
                  >
                    <DelIcon />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pr-foot">
        <span>
          {fetched ? `마지막 불러오기 ${fetched} · ` : ""}처리 중 {total}건
        </span>
        {done.length > 0 || showDone ? (
          <button type="button" className="btn btn-xs" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? "완료 숨기기" : `완료 ${done.length}건 보기`}
          </button>
        ) : null}
        {note && (
          <span className="pr-note" role="status">
            {note}
          </span>
        )}
        <span className="pr-folder">저장 폴더 {ps.root} · 파일 이름 접수일_위치_보수내용</span>
        <button type="button" className="btn btn-xs" onClick={() => openFile(ps.root)}>
          폴더 열기
        </button>
      </div>

      {pick && pickCase && (
        <Floating rect={pick.rect} align="left" onClose={() => setPick(null)}>
          <div className="pr-menu" role="listbox" aria-label="공사 고르기">
            {works.map((w) => (
              <button key={w.id} type="button" role="option" aria-selected={w.id === pickCase.work} className="pr-opt" onClick={() => changeWork(pickCase, w.id)}>
                <span className="pr-dot" style={{ background: `var(--pj-${workColor(w, cd)}-line)` }} />
                <span className="pr-opt-name">{w.name}</span>
                <span className="pr-sub">{w.co}</span>
              </button>
            ))}
            {works.length === 0 && <p className="pr-menu-empty">공사 관리에서 공사를 먼저 등록해요.</p>}
          </div>
        </Floating>
      )}

      {ask && (
        <Floating rect={ask.rect} align="right" onClose={() => setAsk(null)}>
          <div className="pr-ask" role="dialog" aria-label="민원 지우기">
            <span className="pr-ask-t">이 민원을 지울까요?</span>
            <div className="pr-ask-btns">
              <button type="button" className="btn" onClick={() => setAsk(null)}>
                취소
              </button>
              <button type="button" className="btn btn-danger" onClick={() => remove(ask.no)}>
                지우기
              </button>
            </div>
          </div>
        </Floating>
      )}

      {worksOpen && cd && <WorksDialog works={works} cd={cd} onSave={saveWork} onDelete={deleteWork} onContacts={setCd} onClose={() => setWorksOpen(false)} />}
    </div>
  );
}

// ---------- 그 자리 글자 칸 (떠날 때 저장) ----------

function TextCell({
  value,
  onSave,
  placeholder,
  disabled,
  center,
  title,
  clean,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  center?: boolean;
  title?: string;
  clean?: (v: string) => string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => {
    const nv = clean ? clean(v) : v.trim();
    setV(nv);
    if (nv !== value) onSave(nv);
  };
  return (
    <input
      className={"cell-input pr-in" + (center ? " center" : "")}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// ---------- 화면 기준으로 띄우는 상자 (표가 스크롤돼도 잘리지 않게) ----------

function Floating({ rect, align, onClose, children }: { rect: DOMRect; align: "left" | "right"; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const below = rect.bottom + 6 + h <= window.innerHeight - 8;
    const top = below ? rect.bottom + 6 : rect.top - 6 - h;
    const left = align === "left" ? rect.left : rect.right - w;
    setPos({ top: Math.round(top), left: Math.round(Math.max(8, Math.min(left, window.innerWidth - w - 8))) });
  }, [rect, align]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // 띄운 그 누르기가 바로 닫지 않게 한 박자 뒤에 들어요.
    const t = window.setTimeout(() => window.addEventListener("mousedown", down), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", down);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="pr-float" style={pos} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

// ---------- 공사 관리 창 ----------

type Draft = { name: string; co: string; contact: number | null; agent: string; phone: string; scope: string; nextSeq: string; tpl: string };
const EMPTY_DRAFT: Draft = { name: "", co: "", contact: null, agent: "", phone: "", scope: "", nextSeq: "1", tpl: "" };

async function chooseTemplate(): Promise<string | null> {
  if (inApp) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const p = await open({ multiple: false, filters: [{ name: "지시부 양식", extensions: ["pptx", "hwpx"] }] });
    return typeof p === "string" ? p : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pptx,.hwpx";
    input.onchange = () => resolve(input.files?.[0] ? `D:\\지시부\\${input.files[0].name}` : null);
    input.click();
  });
}

function WorksDialog({
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
    let projectId = oldProject;
    const name = d.name.trim();
    // 공사명 = 프로젝트 이름(바꾸면 따라가요)
    if (projectId != null && data.projects.some((p) => p.id === projectId)) {
      const p = data.projects.find((x) => x.id === projectId)!;
      if (p.name !== name) data = await api.renameProject(projectId, name);
    } else {
      const same = data.projects.find((p) => p.name === name);
      if (!same) data = await api.addProject(name);
      projectId = data.projects.find((p) => p.name === name)?.id ?? null;
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
    if (!draft.name.trim()) {
      setErr("공사명을 적어요");
      return;
    }
    try {
      const [contact, project] = await link(draft, null);
      await onSave(null, { name: draft.name.trim(), co: draft.co.trim(), contact, project, scope: draft.scope.trim(), nextSeq: Math.max(1, Number(draft.nextSeq) || 1), tpl: draft.tpl });
      setDraft(EMPTY_DRAFT);
    } catch (e) {
      setErr(errorText(e));
    }
  }

  function startEdit(w: Work) {
    const c = contactOf(w.contact);
    setEdit({ name: w.name, co: w.co, contact: w.contact, agent: c?.name ?? "", phone: phoneOf(c), scope: w.scope, nextSeq: String(w.nextSeq), tpl: w.tpl });
    setEditing(w.id);
    setSelW(w.id);
  }

  const saveEdit = useCallback(async () => {
    const w = works.find((x) => x.id === editing);
    setEditing(null);
    if (!w || !edit.name.trim()) return;
    try {
      const [contact, project] = await link(edit, w.project);
      await onSave(w.id, { name: edit.name.trim(), co: edit.co.trim(), contact, project, scope: edit.scope.trim(), nextSeq: Math.max(1, Number(edit.nextSeq) || w.nextSeq), tpl: edit.tpl });
    } catch (e) {
      setErr(errorText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, edit, works, cd]);

  // 고치는 줄 바깥을 누르면 저장해요(누르기 시작한 곳 기준).
  useEffect(() => {
    if (editing == null) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (editRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.(".pr-float")) return;
      saveEdit();
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [editing, saveEdit]);

  async function changeTpl(w: Work) {
    const p = await chooseTemplate();
    if (!p) return;
    const { id, ...input } = w;
    try {
      await onSave(id, { ...input, tpl: p });
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && editing == null && onClose()}>
      <div className="dialog pr-works" role="dialog" aria-modal="true" aria-label="공사 관리">
        <div className="dialog-head pr-works-head">
          <span className="dialog-title">공사 관리</span>
          <span className="pr-sub">계약된 공사와 시공사예요. 민원을 어느 공사로 보낼지 여기 처리 범위를 보고 판단해요.</span>
        </div>
        <div className="pr-wgrid pr-whead">
          <span>공사명</span>
          <span>시공사</span>
          <span>현장대리인 (업무연락처)</span>
          <span>처리 범위 (판단 기준)</span>
          <span>다음 연번</span>
          <span>지시부 양식</span>
          <span />
        </div>
        <div className="pr-wlist">
          {works.map((w) => {
            const c = contactOf(w.contact);
            const k = workColor(w, cd);
            if (editing === w.id) {
              return (
                <div key={w.id} ref={editRef} className="pr-wgrid pr-wrow pr-wedit" onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && (e.target as HTMLElement).tagName === "INPUT" && !document.querySelector(".pr-cmenu")) saveEdit(); }}>
                  <input className="cell-input" aria-label="공사명" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                  <input className="cell-input" aria-label="시공사" value={edit.co} onChange={(e) => setEdit({ ...edit, co: e.target.value })} />
                  <AgentInputs d={edit} contacts={cd.contacts} onChange={setEdit} />
                  <input className="cell-input" aria-label="처리 범위" value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value })} />
                  <input className="cell-input pr-in center" aria-label="다음 연번" value={edit.nextSeq} onChange={(e) => setEdit({ ...edit, nextSeq: e.target.value.replace(/\D/g, "") })} />
                  <TplButton path={edit.tpl} onPick={async () => {
                    const p = await chooseTemplate();
                    if (p) setEdit((d) => ({ ...d, tpl: p }));
                  }} />
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
                <span className="pr-wname">
                  <span className="pr-dot" style={{ background: `var(--pj-${k}-line)` }} />
                  <span>{w.name}</span>
                </span>
                <span className="pr-ell">{w.co}</span>
                <span className="pr-agent" title="업무연락처와 같은 연락처예요. 어느 쪽에서 고쳐도 함께 바뀌어요">
                  {c ? (
                    <span className="pr-agent-name">
                      <PersonIcon />
                      {c.name}
                    </span>
                  ) : (
                    <span className="pr-sub">—</span>
                  )}
                </span>
                <span className="pr-scope">{w.scope}</span>
                <span className="pr-num">{w.nextSeq}</span>
                <TplButton path={w.tpl} onPick={() => changeTpl(w)} />
                <button
                  type="button"
                  className="pr-del"
                  aria-label={`${w.name} 지우기`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAsk({ id: w.id, rect: e.currentTarget.getBoundingClientRect() });
                  }}
                >
                  <DelIcon />
                </button>
              </div>
            );
          })}
          <div className="pr-wgrid pr-wrow pr-wnew">
            <input className="cell-input" placeholder="공사명" aria-label="새 공사명" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="cell-input" placeholder="시공사" aria-label="새 시공사" value={draft.co} onChange={(e) => setDraft({ ...draft, co: e.target.value })} />
            <AgentInputs d={draft} contacts={cd.contacts} onChange={setDraft} />
            <input className="cell-input" placeholder="예: 반사경, 시선유도봉, 작은 포트홀" aria-label="새 처리 범위" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
            <input className="cell-input pr-in center" title="처음 연번(보통 1)" aria-label="새 다음 연번" value={draft.nextSeq} onChange={(e) => setDraft({ ...draft, nextSeq: e.target.value.replace(/\D/g, "") })} />
            <TplButton path={draft.tpl} empty="양식 파일 고르기" onPick={async () => {
              const p = await chooseTemplate();
              if (p) setDraft((d) => ({ ...d, tpl: p }));
            }} />
            <button type="button" className="pr-add" aria-label="공사 등록" onClick={add}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
        <div className="pr-hints">
          {err && <span className="pr-err">{err}</span>}
          <span>현장대리인은 업무연락처에서 골라요(어느 쪽에서 고쳐도 함께 바뀌어요). 공사명은 업무연락처 프로젝트로도 등록되고 현장대리인에게 붙어요. 줄을 두 번 누르면 고치고 [저장]·Enter로 저장해요(Esc 취소).</span>
          <span>양식은 pptx·hwpx 중 골라요. 양식 이름을 누르면 파일을 바꿔요. 양식에 글자 자리 {"{주소} {보수내용} {고려사항} {연번} {지시일} {지시자}"} 와 그림 자리 "위치도"·"현장사진"을 두면 돼요.</span>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn-primary" onClick={() => (editing != null ? saveEdit().then(onClose) : onClose())}>
            닫기
          </button>
        </div>
      </div>
      {ask && (
        <Floating rect={ask.rect} align="right" onClose={() => setAsk(null)}>
          <div className="pr-ask" role="dialog" aria-label="공사 지우기">
            <span className="pr-ask-t">이 공사를 지울까요?</span>
            <div className="pr-ask-btns">
              <button type="button" className="btn" onClick={() => setAsk(null)}>
                취소
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  const id = ask.id;
                  setAsk(null);
                  try {
                    await onDelete(id);
                  } catch (e) {
                    setErr(errorText(e));
                  }
                }}
              >
                지우기
              </button>
            </div>
          </div>
        </Floating>
      )}
    </div>
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
    if (c) onChange({ ...d, contact: c.id, agent: c.name, phone: phoneOf(c) });
    else onChange({ ...d, contact: null });
    setOpenList(null);
  };
  return (
    <span className="pr-agent-in">
      <input
        ref={inRef}
        className="cell-input"
        aria-label="현장대리인"
        placeholder="이름·초성 (업무연락처)"
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

function TplButton({ path, onPick, empty }: { path: string; onPick: () => void; empty?: string }) {
  if (!path && empty) {
    return (
      <button type="button" className="btn btn-xs pr-tpl-pick" title="pptx·hwpx" onClick={onPick}>
        {empty}
      </button>
    );
  }
  return (
    <button type="button" className="pr-tpl" title={`${path}\n눌러서 양식 파일 바꾸기 (pptx·hwpx)`} onClick={(e) => (e.stopPropagation(), onPick())}>
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </svg>
      <span className="pr-ell">{path ? fileName(path) : "양식 없음"}</span>
    </button>
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
