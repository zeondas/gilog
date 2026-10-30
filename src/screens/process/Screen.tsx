// 민원처리 화면이에요(10단계). 시안 Process.dc.html과 사양서 "민원처리" 절을 따라요.
//
// - 표준 지시부(2026-10-19 사용자 1안, 시안 ProcessOrder.dc.html): 같은 공사 민원을 골라(줄 앞 고르기 칸) [지시부 만들기]
//   → 표준 양식 한 파일(민원 폴더에 지시일_축약 공사명-연번.hwpx, 항목은 접수일 순) + 민원대장 등록(조치내용 "□ 공사명 지시(1지구-03 · 2)")
//   + 쪽마다 JPG(한글). 민원대장에서 완료하면 이 표에서 숨어요.
// - 줄 끝 지시부 칸: "1지구-03 · 1" + 진행 [폰 전송] → 보내는 중 → ✓ 전송 완료(지시부째 함께 바뀌어요).
//   지시부에 든 건의 공사·주소·고려사항을 고치면 그 지시부를 다시 만들어요(같은 연번·같은 파일).
// - [폰 전송] = 지시부의 JPG를 보낼 폴더에 복사 → "보내는 중". Claude가 대화에 올리고 "보냄" 폴더에 써 두면 ✓ 전송 완료(사용자 2안).
// - 대상이 아닌 건은 줄 끝 ×(작은 묻기 창). 불러오기는 접수번호로만 걸러요 – 표에 없는 번호(지운 건 포함)는 다시 와요(2026-10-20 사용자).
// - 공사 관리 창: 현장대리인은 업무연락처에서 골라요(같은 연락처 하나 – 쌍방향), 공사명은 업무연락처 프로젝트로도 등록돼요.
// - 진행 열(2026-10-20 20:42 사용자 1안, 시안 ProcessStatus): 줄 한 줄 44, 맨 끝 "진행" = 글자가 든 게이지 하나(150×22) –
//   접수 20 · 지시부 40 · 보내는 중 40(빗금) · 보냄 60 · 확인 필요 60(주황 빗금) · 답변 80 · 완료 100, 색은 강조색 진하기(토큰 --pg-*).
//   보냄 막대를 누르면 보낸 증거 카드, 지시부 현황 단추 넷은 줄 끝 ⋯ 메뉴·줄 우클릭으로. 끝난 줄은 "완료 N건" 띠 아래(처음엔 접힘).
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { api, Case, Complaint, ContactsData, errorText, inApp, Order, Work } from "../../api";
import { useHolidays } from "../../workdays";
import { DelMark } from "../../Icons";
import { todayStr } from "../../journal";
import { fileName, orderTag, PORTAL_URL, SAMPLE_WORKS } from "../../process";
import { DEFAULT_PROCESS, isClosed, loadSettings, ProcessSettings } from "../../settingsStore";
import { AskBand } from "../../AskBand";
import { SearchBox } from "../../SearchBox";
import { HeadRow, PhotoStrip, WorkTag, ProofRow } from "./Table";
import { WorksDialog, MailDialog } from "./Dialogs";
import { Floating } from "./Menu";
import { FETCHED_KEY, LAST_RUN_KEY, PICK_KEY, LastRun, MAIL_BOX, NA_WORK, errText } from "./parts";
import { workColor, MailDraft, DocPlusIcon, MailIcon, PhoneIcon, CheckIcon, isPath, WarnIcon } from "./parts";
import { useProcessFetch } from "./fetch";
import { useProcessCases } from "./cases";
import { useProcessCols, useProcessRows } from "./Table";

type Props = { urgentDays: number; onOpenComplaint: (id: number) => void };

export function useProcessCore({ urgentDays, onOpenComplaint }: Props) {
  // 공휴일 목록이 바뀌면 남은 날(근무일)을 다시 세요.
  useHolidays();
  const [works, setWorks] = useState<Work[] | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  // 지시부로 묶으려고 고른 줄(같은 공사만)
  const [chosen, setChosen] = useState<string[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [cd, setCd] = useState<ContactsData | null>(null);
  const [ps, setPs] = useState<ProcessSettings>(DEFAULT_PROCESS);
  const [fetched, setFetched] = useState("");
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  // 자동 맞춤으로 잰 폭(열 번호 → 폭)
  const [auto, setAuto] = useState<Record<number, number>>({});
  // 목록 안쪽 폭과 세로 스크롤 막대 폭(열 제목 줄 오른쪽을 그만큼 비워 세로선을 맞춰요)
  const [avail, setAvail] = useState(0);
  const [gutter, setGutter] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState("");
  // Claude가 멈춘 뒤 안내 줄 끝 [로그 열기]가 여는 `_claude.log` 경로
  const [noteLog, setNoteLog] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  // Claude가 신문고를 읽는 중: 가져온 수 / 가져올 수(모르면 null)
  const [run, setRun] = useState<{ n: number; total: number | null } | null>(null);
  // 지시부·JPG를 만드는 중인 지시부(번호, 새로 만드는 중이면 "new")
  const [busy, setBusy] = useState<Record<string, string>>({});
  // 뜨는 목록(공사 고르기)과 지우기 묻기 창
  const [pick, setPick] = useState<{ no: string; rect: DOMRect } | null>(null);
  const [ask, setAsk] = useState<{ no: string; rect: DOMRect } | null>(null);
  // [보내기 ▾] 메뉴 · 메일 확인 창 · 메일 보내는 중(2026-10-20 지시부 메일)
  const [sendMenu, setSendMenu] = useState<{ id: number; rect: DOMRect } | null>(null);
  const [mailAsk, setMailAsk] = useState<MailDraft | null>(null);
  const [mailRun, setMailRun] = useState<{ id: number; label: string; n: number } | null>(null);
  // "해당 없음"을 고른 뒤 민원대장에 넣을지 묻는 창
  const [naAsk, setNaAsk] = useState<{ no: string; rect: DOMRect } | null>(null);
  /** "완료로 이동"인데 민원대장에 없는 건: 등록할지 물어요 */
  const [doneAsk, setDoneAsk] = useState<{ no: string; rect: DOMRect } | null>(null);
  /** 이 화면에서 완료로 바꾼 민원대장 줄의 그 전 상태(완료 풀기용) */
  const [prevStatus, setPrevStatus] = useState<Record<number, string>>({});
  // 줄 끝 ⋯ 메뉴(줄 우클릭도) · 보낸 증거 카드 · 민원 요약에 마우스를 올리면 판단 이유
  const [menu, setMenu] = useState<{ no: string; rect: DOMRect } | null>(null);
  const [proof, setProof] = useState<{ id: number; rect: DOMRect } | null>(null);
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const tipTimer = useRef(0);

  const today = todayStr();

  useEffect(() => {
    (async () => {
      const [pd, cl, cdata, st, f, lr, pk] = await Promise.all([api.processData(), api.complaints(), api.contactsData(), loadSettings(), api.get(FETCHED_KEY), api.get(LAST_RUN_KEY), api.get(PICK_KEY)]);
      try {
        if (pk) setPicks(JSON.parse(pk) as Record<string, string>);
      } catch {
        /* 못 읽으면 이유 없이 */
      }
      try {
        if (lr) setLastRun(JSON.parse(lr) as LastRun);
      } catch {
        /* 예전 자료 – 없는 것으로 */
      }
      setCases(pd.cases);
      setOrders(pd.orders);
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
      list = await api.saveWork(null, { name: s.name, full: s.full, co: s.co, contact: c?.id ?? null, project: p?.id ?? null, scope: s.scope, nextSeq: s.nextSeq, tpl: "" });
    }
    setWorks(list);
    setCd(data);
  }
  return { urgentDays, onOpenComplaint, works, setWorks, cases, setCases, orders, setOrders, chosen, setChosen, complaints, setComplaints, cd, setCd, ps, setPs, fetched, setFetched, lastRun, setLastRun, picks, setPicks, auto, setAuto, avail, setAvail, gutter, setGutter, bodyRef, note, setNote, noteLog, setNoteLog, q, setQ, sel, setSel, showDone, setShowDone, worksOpen, setWorksOpen, run, setRun, busy, setBusy, pick, setPick, ask, setAsk, sendMenu, setSendMenu, mailAsk, setMailAsk, mailRun, setMailRun, naAsk, setNaAsk, doneAsk, setDoneAsk, prevStatus, setPrevStatus, menu, setMenu, proof, setProof, tip, setTip, tipTimer, today, seedPreview };
}

export default function ProcessScreen({ urgentDays, onOpenComplaint }: Props) {
  const c0 = useProcessCore({ urgentDays, onOpenComplaint });
  const c1 = useProcessFetch(c0);
  const c2 = useProcessCases(c1);
  const c3 = useProcessCols(c2);
  const { works, note } = c3;

  if (!works) {
    return (
      <>
        <h1 className="title">국민신문고 민원 불러오기</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }
  const c4 = useProcessRows({ ...c3, works });
  const { setNote, fetchCases, run, setWorksOpen, q, setQ, stopFetch, mailRun, chosen, chosenWork, cd, setChosen, busy, makeOrder, tableStyle, allState, toggleAll, cols, bodyRef, open, cases, renderRow, done, showDone, setShowDone, lastRun, fetched, total, openFile, noteLog, ps, tip, menu, orderOf, isDone, linked, setMenu, setAsk, ask, remove, picks, choosePhoto, remakeOrder, setSendMenu, runOrder, register, prevStatus, undoDone, moveDone, setDoneAsk, proof, orders, recipientOf, setProof, putOrder, openMail, pick, pickCase, setPick, changeWork, naAsk, setNaAsk, doneAsk, sendMenu, send, mailAsk, setMailAsk, mailOrder, worksOpen, saveWork, deleteWork, setCd } = c4;

  return (
    <div className="pr">
      <div className="ct-head tb5">
        <h1 className="title">국민신문고 민원 불러오기</h1>
        <button type="button" className="btn btn-ctrl btn-text" title="업무처리포털을 크롬으로 열어요. 처음 한 번 로그인해 두면 돼요" onClick={() => (inApp ? api.openPortal(PORTAL_URL).catch((e) => setNote(errText(e))) : window.open(PORTAL_URL, "_blank"))}>
          신문고 열기
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
          </svg>
        </button>
        <button type="button" className="btn-primary btn-ctrl pr-fetch" title="Claude가 크롬으로 신문고 민원처리목록을 읽어 이 표에 없는 접수번호의 민원을 가져와요" onClick={fetchCases} disabled={!!run}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />
          </svg>
          {run ? "불러오는 중…" : "민원 불러오기"}
        </button>
        <button type="button" className="btn btn-ctrl btn-text tb-pop pr-push" onClick={() => setWorksOpen(true)}>
          공사 관리
        </button>
        <SearchBox aria-label="민원처리 검색" placeholder="접수번호, 위치, 내용 검색" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} />
        <span className="tb-hole-xl" aria-hidden="true" />
      </div>

      {run && (
        <div className="pr-run" role="status">
          <span className="pr-run-dot" aria-hidden="true" />
          <span>
            Claude가 신문고 민원처리목록을 읽고 있어요{run.total != null ? ` · ${run.n}/${run.total}건` : run.n ? ` · ${run.n}건` : ""}
          </span>
          <span className="pr-run-bar">
            <span style={{ width: run.total ? `${(run.n / run.total) * 100}%` : "8%" }} />
          </span>
          <button type="button" className="btn btn-xs" onClick={stopFetch}>
            멈추기
          </button>
        </div>
      )}

      {mailRun && (
        <div className="pr-run" role="status">
          <span className="pr-run-dot" aria-hidden="true" />
          <span>
            <b>{mailRun.label}</b> 메일 보내는 중 · {MAIL_STEPS[Math.min(mailRun.n, MAIL_STEPS.length - 1)]} ({Math.min(mailRun.n + 1, 4)}/4)
          </span>
          <span className="pr-sub">Claude가 크롬 korea.kr 탭에서 하고 있어요 – 그 탭은 건드리지 말아 주세요</span>
          <span className="pr-run-bar">
            <span style={{ width: `${(Math.min(mailRun.n, 4) / 4) * 100}%` }} />
          </span>
          <button type="button" className="btn btn-xs" onClick={stopFetch}>
            멈추기
          </button>
        </div>
      )}

      {chosen.length > 0 && chosenWork && (
        <div className="pr-pickbar" role="status">
          <WorkTag w={chosenWork} cd={cd} />
          <span>
            <b>{chosen.length}건</b> 골랐어요 · 지시부 <b>{chosenWork.name}-{String(chosenWork.nextSeq).padStart(2, "0")}</b> 로 묶어요
          </span>
          <span className="pr-sub">같은 공사만 함께 고를 수 있어요</span>
          <button type="button" className="btn btn-ctrl btn-text pr-push" onClick={() => setChosen([])}>
            선택 해제
          </button>
          <button type="button" className="btn-primary btn-ctrl" disabled={!!busy.new} onClick={makeOrder}>
            {busy.new ? "만드는 중…" : "지시부 만들기"}
          </button>
        </div>
      )}

      <div className="pr-table" role="table" aria-label="민원처리 목록" style={tableStyle}>
        <div className="pr-hs">
        <HeadRow all={allState} onAll={toggleAll} cols={cols} />
        <div className="pr-body" ref={bodyRef}>
          {open.length === 0 && (
            <p className="pr-empty">{cases.length === 0 ? "[민원 불러오기]를 누르면 Claude가 신문고에서 기록에 없는 민원을 가져와요." : q ? "찾는 민원이 없어요." : "처리할 민원이 없어요."}</p>
          )}
          {open.map(renderRow)}
          {done.length > 0 && (
            <div className="pr-doneband">
              <span className="pr-doneband-t">완료 {done.length}건</span>
              <button type="button" className="btn btn-xs" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
                {showDone ? "숨기기" : "보기"}
              </button>
            </div>
          )}
          {showDone && done.map(renderRow)}
        </div>
        </div>
      </div>

      <div className="pr-foot">
        <span>
          {lastRun ? `마지막 불러오기 ${lastRun.at} · ` : fetched ? `마지막 불러오기 ${fetched} · ` : ""}처리 중 {total}건
        </span>
        {lastRun && (
          <>
            <span className="pr-lastrun">
              새 민원 {lastRun.added}건{lastRun.skipped != null ? ` · 건너뜀 ${lastRun.skipped}건` : ""} · {duration(lastRun.secs)}{lastRun.per ? ` (건당 ${duration(lastRun.per)})` : ""}
            </span>
            {lastRun.log && (
              <button type="button" className="btn btn-xs" title="Claude 실행 기록(_claude.log)을 탐색기에서 보여 줘요" onClick={() => openFile(lastRun.log, true)}>
                로그 열기
              </button>
            )}
          </>
        )}
        {note && (
          <span className="pr-note" role="status">
            {note}
            {noteLog && noteLog !== lastRun?.log && (
              <button type="button" className="btn btn-xs pr-log" title="Claude 실행 기록(_claude.log)을 탐색기에서 보여 줘요" onClick={() => openFile(noteLog, true)}>
                로그 열기
              </button>
            )}
          </span>
        )}
        <span className="pr-folder">저장 폴더 {ps.root}</span>
        <button type="button" className="btn btn-xs" onClick={() => openFile(ps.root)}>
          폴더 열기
        </button>
      </div>

      {tip &&
        createPortal(
          <div className="pr-tip" role="tooltip" style={{ top: Math.round(tip.rect.bottom + 4), left: Math.round(tip.rect.left) }}>
            <span className="pr-tip-k">판단 이유 · </span>
            {tip.text}
          </div>,
          document.body,
        )}

      {menu &&
        (() => {
          const c = cases.find((x) => x.no === menu.no);
          if (!c) return null;
          const o = orderOf(c);
          const w = works.find((x) => x.id === c.work);
          const isD = isDone(c);
          const m = linked(c);
          const close = () => (setMenu(null), setAsk(null));
          if (ask?.no === c.no)
            return (
              <Floating rect={menu.rect} align="right" onClose={close}>
                <div className="dmenu pr-rowmenu pr-rowask">
                  <AskBand className="dmenu-ask" label="민원 지우기 확인" text="이 민원을 지울까요?" onNo={close} onYes={() => (close(), void remove(c.no))} />
                </div>
              </Floating>
            );
          return (
            <Floating rect={menu.rect} align="right" onClose={close} menu>
              <div className="dmenu pr-rowmenu" role="menu" aria-label="이 민원">
                <p className="dmenu-note pr-rowmenu-note">
                  {`사진 ${c.photos.filter(isPath).length}장`}
                  {c.photos.some((x) => !isPath(x)) ? ` (못 찾음 ${c.photos.filter((x) => !isPath(x)).length})` : ""}
                  {` · 위치도 ${isPath(c.map) ? "있음" : c.map ? "못 찾음" : "없음"}`}
                </p>
                {c.photos.filter(isPath).length > 1 && <PhotoStrip c={c} reason={picks[c.no] ?? ""} onPick={(path) => void choosePhoto(c, path)} />}
                {o ? (
                  (() => {
                    // 지시부 띠에 있던 단추를 메뉴 맨 위로(2026-10-21 사용자 1안): 지시부 열기 · 다시 만들기 · 보내기 ▸
                    const ow = works.find((x) => x.id === o.work);
                    const n = cases.filter((x) => x.order === o.id).length;
                    const b = busy[o.id];
                    const sending = mailRun?.id === o.id || o.stage === "queued";
                    return (
                      <>
                        <button type="button" role="menuitem" className="dmenu-item" disabled={!o.file} onClick={() => (close(), openFile(o.file))}>
                          <DocIcon />
                          지시부 열기
                          <span className="pr-rowmenu-sub">
                            {ow ? orderTag(ow.name, o.seq) : o.seq} · {n}건
                          </span>
                        </button>
                        <button type="button" role="menuitem" className="dmenu-item" disabled={!!b} title={o.dirty ? "든 민원을 고쳤어요 · 다시 만들어요" : "같은 연번·같은 파일로 다시 만들어요"} onClick={() => (close(), remakeOrder(o.id))}>
                          <RedoIcon />
                          다시 만들기
                          {o.dirty && <span className="pr-rowmenu-sub warn">고친 것 있음</span>}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="dmenu-item"
                          aria-haspopup="menu"
                          disabled={!!b || o.dirty || sending}
                          title={o.dirty ? "다시 만든 뒤에 보내요" : sending ? "보내는 중이에요" : "메일(현장대리인) 또는 폰으로 보내요"}
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            close();
                            setSendMenu({ id: o.id, rect });
                          }}
                        >
                          <SendIcon />
                          {o.mailedAt || o.stage === "sent" ? "다시 보내기" : "보내기"}
                          <span className="pr-rowmenu-sub">메일 · 폰 ▸</span>
                        </button>
                        <div className="dmenu-sep" />
                      </>
                    );
                  })()
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="dmenu-item"
                    disabled={!w || isD || !!busy[`c${c.no}`]}
                    title={c.work === NA_WORK ? "해당 없음 민원은 지시부를 만들지 않아요" : !w ? "먼저 공사를 골라요" : isD ? "민원대장에서 끝난 건이에요" : `${w.name}-${String(w.nextSeq).padStart(2, "0")}`}
                    onClick={() => {
                      close();
                      setChosen((l) => l.filter((n) => n !== c.no));
                      runOrder({ nos: [c.no], order: null }, `c${c.no}`);
                    }}
                  >
                    <DocPlusIcon />
                    이 건만 지시부 만들기
                  </button>
                )}
                {!o && <div className="dmenu-sep" />}
                <button
                  type="button"
                  role="menuitem"
                  className="dmenu-item"
                  onClick={() => {
                    close();
                    const f = o?.file || c.photos.find(isPath) || (isPath(c.map) ? c.map : "");
                    openFile(f || c.folder || ps.root, !!f);
                  }}
                >
                  <FolderIcon />
                  저장 폴더 열기
                </button>
                <button type="button" role="menuitem" className="dmenu-item" onClick={() => (close(), register(c))}>
                  <TableIcon add={!m} />
                  {m ? `민원대장 ${m.no}번 보기` : "민원대장에 추가"}
                </button>
                {isD ? (
                  <button type="button" role="menuitem" className="dmenu-item" title={`민원대장 ${m?.no ?? ""}번을 ${m && prevStatus[m.id] && !isClosed(prevStatus[m.id]) ? prevStatus[m.id] : "접수"}(으)로 되돌려요`} onClick={() => (close(), undoDone(c))}>
                    <UndoIcon />
                    완료 풀기
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="dmenu-item"
                    title={m ? `민원대장 ${m.no}번을 완료로 바꿔요` : "민원대장에 등록한 뒤 완료로 바꿔요"}
                    onClick={() => {
                      close();
                      if (m) moveDone(c);
                      else setDoneAsk({ no: c.no, rect: menu.rect });
                    }}
                  >
                    <CheckIcon size={14} />
                    완료로 이동
                  </button>
                )}
                <div className="dmenu-sep" />
                <button type="button" role="menuitem" className="dmenu-item danger" onClick={() => setAsk({ no: c.no, rect: menu.rect })}>
                  <DelMark />
                  지우기
                </button>
              </div>
            </Floating>
          );
        })()}

      {proof &&
        (() => {
          const o = orders.find((x) => x.id === proof.id);
          if (!o) return null;
          const r = recipientOf(o);
          const files = [o.file, ...o.jpgs].filter(Boolean).map(fileName);
          const mail = !!o.mailedAt;
          const ok = !mail || o.mailOk !== false;
          const mailLog = `${ps.outbox}\\메일\\_claude.log`;
          const openBox = () => (inApp ? api.openPortal(MAIL_BOX).catch((e) => setNote(errText(e))) : window.open(MAIL_BOX, "_blank"));
          return (
            <Floating rect={proof.rect} align="right" onClose={() => setProof(null)}>
              <div className={"pr-proof" + (ok ? "" : " warn")} role="dialog" aria-label="보낸 증거">
                <div className="pr-proof-h">
                  {ok ? <CheckIcon /> : <WarnIcon />}
                  {mail ? (ok ? "메일 보냄 · 확인됨" : "확인 필요 · 보낸메일함에서 못 찾았어요") : "폰 보냄 · 확인됨"}
                </div>
                {mail ? (
                  <>
                    <ProofRow k="받는 사람" v={[r.name && `${r.name} 현장대리인`, o.mailTo].filter(Boolean).join(" · ")} />
                    <ProofRow k="보낸 시각" v={`${o.mailedAt} (Claude가 보냄)`} />
                    <ProofRow k={`첨부 ${files.length}개`} v={files.join(" · ")} />
                    <ProofRow k="보낸메일함" v={o.mailSubject ? `“${o.mailSubject}” – ${ok ? "맨 위에서 확인" : "같은 제목이 없어요"}` : ok ? "Claude가 확인했어요" : "같은 제목이 없어요"} />
                  </>
                ) : (
                  <>
                    <ProofRow k="보낸 곳" v="Claude 앱 “민원처리” 대화(내 폰)" />
                    <ProofRow k="보낸 시각" v={o.sentAt || "–"} />
                    <ProofRow k={`JPG ${o.jpgs.length}장`} v={o.jpgs.map(fileName).join(" · ")} />
                  </>
                )}
                <div className="pr-proof-b">
                  {mail && !ok ? (
                    <>
                      <button type="button" className="btn-primary btn-sm" onClick={openBox}>
                        보낸메일함 열기
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={async () => {
                          setProof(null);
                          try {
                            putOrder(await api.orderMailed(o.id, o.mailTo ?? "", o.mailedAt ?? "", o.mailSubject, true));
                          } catch (e) {
                            setNote(errText(e));
                          }
                        }}
                      >
                        보냈어요로 표시
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setProof(null);
                          openMail(o);
                        }}
                      >
                        다시 보내기
                      </button>
                    </>
                  ) : mail ? (
                    <>
                      <button type="button" className="btn btn-sm" onClick={openBox}>
                        보낸메일함 열기
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => openFile(mailLog, true)}>
                        로그 열기
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-sm" onClick={() => openFile(o.jpgs[0] || o.file, true)}>
                      폴더 열기
                    </button>
                  )}
                </div>
              </div>
            </Floating>
          );
        })()}
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
            <div className="dmenu-sep" />
            <button type="button" role="option" aria-selected={pickCase.work === NA_WORK} className="pr-opt" onClick={() => changeWork(pickCase, NA_WORK)}>
              <span className="pr-dot na" />
              <span className="pr-opt-name">해당 없음</span>
              <span className="pr-sub">공사 대상 아님</span>
            </button>
          </div>
        </Floating>
      )}

      {naAsk &&
        (() => {
          const c = cases.find((x) => x.no === naAsk.no);
          if (!c) return null;
          return (
            <Floating rect={naAsk.rect} align="left" onClose={() => setNaAsk(null)}>
              <div className="pr-ask" role="dialog" aria-label="민원대장에 추가">
                <span className="pr-ask-t">민원대장에 추가할까요?</span>
                <div className="pr-ask-btns">
                  <button type="button" className="btn" onClick={() => setNaAsk(null)}>
                    아니요
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    autoFocus
                    onClick={() => {
                      setNaAsk(null);
                      register(c);
                    }}
                  >
                    예
                  </button>
                </div>
              </div>
            </Floating>
          );
        })()}

      {doneAsk &&
        (() => {
          const c = cases.find((x) => x.no === doneAsk.no);
          if (!c) return null;
          return (
            <Floating rect={doneAsk.rect} align="right" onClose={() => setDoneAsk(null)}>
              <div className="pr-ask" role="dialog" aria-label="민원대장에 등록">
                <span className="pr-ask-t">민원대장에 등록할까요?</span>
                <div className="pr-ask-btns">
                  <button type="button" className="btn" onClick={() => setDoneAsk(null)}>
                    아니요
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    autoFocus
                    onClick={() => {
                      setDoneAsk(null);
                      moveDone(c, true);
                    }}
                  >
                    예
                  </button>
                </div>
              </div>
            </Floating>
          );
        })()}

      {sendMenu &&
        (() => {
          const o = orders.find((x) => x.id === sendMenu.id);
          if (!o) return null;
          const r = recipientOf(o);
          const why = !r.work?.contact ? "공사 관리에서 현장대리인을 골라 주세요" : !r.email ? "현장대리인 메일 주소가 없어요 – 업무연락처에서 넣어 주세요" : run || mailRun ? "Claude가 다른 일을 하고 있어요" : "";
          return (
            <Floating rect={sendMenu.rect} align="right" onClose={() => setSendMenu(null)} menu>
              <div className="pr-menu pr-sendmenu" role="menu" aria-label="지시부 보내기">
                <button type="button" role="menuitem" className="pr-sopt" disabled={!!why} onClick={() => openMail(o)}>
                  <MailIcon />
                  <span>
                    <span className="pr-sopt-t">{o.mailedAt ? "메일로 다시 보내기" : "메일로 보내기"}</span>
                    <span className={"pr-sopt-s" + (why ? " warn" : "")}>{why || `${r.name} 현장대리인 · ${r.email}`}</span>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="pr-sopt"
                  onClick={() => {
                    setSendMenu(null);
                    send(o);
                  }}
                >
                  <PhoneIcon />
                  <span>
                    <span className="pr-sopt-t">이미지 보내기</span>
                    <span className="pr-sopt-s">내 핸드폰의 Claude 앱으로 사진을 전송해요</span>
                  </span>
                </button>
              </div>
            </Floating>
          );
        })()}

      {mailAsk && (
        <MailDialog
          draft={mailAsk}
          files={(() => {
            const o = orders.find((x) => x.id === mailAsk.id);
            if (!o) return [];
            const jp = o.jpgs.length ? o.jpgs : [o.file.replace(/\.hwpx$/i, ".jpg")];
            return [o.file, ...jp];
          })()}
          from={ps.signer}
          onChange={setMailAsk}
          onSend={() => mailOrder(mailAsk)}
          onClose={() => setMailAsk(null)}
        />
      )}

      {worksOpen && cd && <WorksDialog works={works} cd={cd} onSave={saveWork} onDelete={deleteWork} onContacts={setCd} onClose={() => setWorksOpen(false)} />}
    </div>
  );
}

const MAIL_STEPS = ["메일쓰기 여는 중", "받는 사람·제목·본문 채우는 중", "첨부 붙이는 중", "보내고 보낸 메일함 확인하는 중"];

function DocIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

/** 다시 만들기 – 둥근 화살표 */
function RedoIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
    </svg>
  );
}

/** 완료 풀기 – 되돌리는 화살표 */
function UndoIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}

/** 보내기 – 종이비행기 */
function SendIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />
    </svg>
  );
}

/** 걸린 시간: 42초 · 1분 42초 */
const duration = (secs: number) => (secs < 60 ? `${secs}초` : `${Math.floor(secs / 60)}분${secs % 60 ? ` ${secs % 60}초` : ""}`);

function FolderIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** 민원대장(표) – 아직 없으면 + */
function TableIcon({ add }: { add: boolean }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter">
      <path d={add ? "M3 4h18v7 M3 4v16h9 M3 9h18 M9 9v11 M18 14v8 M14 18h8" : "M3 4h18v16H3z M3 9h18 M3 14.5h18 M9 9v11"} />
    </svg>
  );
}
