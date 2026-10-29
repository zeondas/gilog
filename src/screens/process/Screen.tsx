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
import { CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, Case, Complaint, ContactsData, errorText, inApp, Order, OrderResult, previewInbox, RunStatus, Work, WorkInput } from "../../api";
import { daysBetween } from "../../complaints";
import { padX, useColHead, widestOf } from "../../ColHead";
import type { ColDef } from "../../cols";
import { plainOf } from "../../bullets";
import { DelMark } from "../../Icons";
import { koIndex, todayStr } from "../../journal";
import { webLookup } from "../../addressWeb";
import { areaFor, looksRoad } from "../../address";
import { actionLine, aiGuide, fileName, mailDraft, mailGuide, md, orderLabel, orderTag, PORTAL_URL, processError, SAMPLE_WORKS, SAMPLES } from "../../process";
import { DEFAULT_PROCESS, DONE_STATUS, isAnswered, isClosed, loadSettings, ProcessSettings } from "../../settingsStore";
import { AskBand } from "../../AskBand";
import { SearchBox } from "../../SearchBox";
import { HeadRow, PlaceCell, NoteCell, PhotoStrip, WorkTag, Gauge, ProofRow } from "./Table";
import { WorksDialog, MailDialog } from "./Dialogs";
import { Floating } from "./Menu";
import { workColor, COLUMNS, AUTO_COLS, COL_GAP, PLACE_MAX, SUM_MIN, textWidth, MailDraft, DocPlusIcon, MailIcon, PhoneIcon, CheckIcon, Prog, isPath, WarnIcon } from "./parts";

type Props = { urgentDays: number; onOpenComplaint: (id: number) => void };

const FETCHED_KEY = "process.fetched";

/** 마지막 불러오기 결과(아래 줄 "새 민원 N건 · 건너뜀 N건 · 걸린 시간 · [로그 열기]") */
const LAST_RUN_KEY = "process.lastRun";

/** AI가 고른 현장사진의 이유(접수번호 → 한 줄, 2026-10-21 22:59 사용자 – 지시부엔 1장만) */
const PICK_KEY = "process.photoPick";

/** per: 건당 걸린 시간(초, 2026-10-21 신속 자동화 – 전후 비교용) */
type LastRun = { at: string; added: number; skipped: number | null; secs: number; log: string; per?: number };

// 끈 열만 px(헤더 열 조정 통일 2026-10-28) – 옛 `process.colWidths5`(아홉 칸 배열)는 읽지 않아요.
const COLS_KEY = "process.cols";

const MAIL_BOX = "https://mail.korea.kr";

/** 판단 공사 "해당 없음"(2026-10-21 사용자) – core NA_WORK와 같은 값 */
const NA_WORK = 0;

const errText = (e: unknown) => processError(e) ?? (typeof e === "string" && e.length > 12 ? e : errorText(e));

const stamp = () => {
  const t = new Date();
  return `${md(todayStr(t))} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

export default function ProcessScreen({ urgentDays, onOpenComplaint }: Props) {
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

  const putCase = (c: Case) => setCases((l) => l.map((x) => (x.no === c.no ? c : x)));
  /** 지시부를 바꾸고 든 건의 진행도 같게 맞춰요(앱이 저장할 때 하는 것과 같아요). */
  const putOrder = (o: Order) => {
    setOrders((l) => (l.some((x) => x.id === o.id) ? l.map((x) => (x.id === o.id ? o : x)) : [...l, o]));
    setCases((l) => l.map((c) => (c.order === o.id ? { ...c, stage: o.stage, orderFile: o.file, orderJpg: o.jpgs[0] ?? "", sentAt: o.sentAt } : c)));
  };
  const orderOf = (c: Case) => (c.order != null ? orders.find((o) => o.id === c.order) : undefined);

  const patch = async (no: string, p: Parameters<typeof api.updateCase>[1]): Promise<Case | null> => {
    const before = cases.find((x) => x.no === no);
    try {
      const c = await api.updateCase(no, p);
      putCase(c);
      // 지시부에 든 건이었으면: 지시부에서 빠졌거나 다시 만들어야 해요 → 표를 새로 읽고 그 지시부를 다시 만들어요.
      if (before?.order != null) {
        const pd = await api.processData();
        setCases(pd.cases);
        setOrders(pd.orders);
        const o = pd.orders.find((x) => x.id === before.order);
        if (c.order == null) await clearAction(c);
        if (o?.dirty) await remakeOrder(o.id);
      }
      return c;
    } catch (e) {
      setNote(errText(e));
      return null;
    }
  };

  /** 이어 둔 민원대장 줄(지워졌으면 없음) */
  const linked = (c: Case) => (c.complaint != null ? complaints.find((x) => x.id === c.complaint) : undefined);

  /** 민원대장에 넣을 값: 접수유형 국민신문고, 내용 = 민원 요약, 마감일 = 처리기한, 상태 접수. 민원인 정보는 신문고에서 가져오지 않아요. */
  const complaintOf = (c: Case, action: string) => ({
    intake: "국민신문고",
    received: c.received,
    ctype: "",
    area: c.area,
    place: c.place,
    road: c.road,
    person: "",
    phone: "",
    body: JSON.stringify([{ t: c.summary }]),
    action,
    due: c.due,
    status: "접수",
  });

  /** [대장 등록]: 지시부 없이도 민원대장에 넣어요. 이미 넣었으면 민원대장의 그 줄로 가요. */
  async function register(c: Case) {
    const old = linked(c);
    if (old) return onOpenComplaint(old.id);
    const m = await addToLedger(c);
    if (m) setNote(`민원대장 ${m.no}번에 등록했어요`);
  }

  async function addToLedger(c: Case): Promise<Complaint | null> {
    try {
      const m = await api.addComplaint(complaintOf(c, ""));
      setComplaints((l) => [...l, m]);
      putCase(await api.updateCase(c.no, { complaint: m.id }));
      return m;
    } catch (e) {
      setNote(errText(e));
      return null;
    }
  }

  /**
   * ⋯ 메뉴 "완료로 이동"(2026-10-21 사용자 1안): 민원대장에 이어진 건이면 묻지 않고 그 줄을 완료로,
   * 없으면 "민원대장에 등록할까요?"를 물어 [예]일 때 등록한 뒤 완료로 바꿔요.
   * 조치완료일은 민원대장처럼 오늘(이미 있으면 그대로)이에요.
   */
  async function moveDone(c: Case, add = false) {
    let m = linked(c);
    let added = false;
    if (!m && add) {
      m = (await addToLedger(c)) ?? undefined;
      added = !!m;
    }
    if (!m) return;
    const prev = m.status;
    try {
      const n = await api.setComplaintStatus(m.id, DONE_STATUS, m.done || todayStr());
      setComplaints((l) => l.map((x) => (x.id === n.id ? n : x)));
      setPrevStatus((p) => ({ ...p, [n.id]: prev }));
      setSel(null);
      setNote(added ? `민원대장 ${n.no}번에 등록하고 완료로 바꿨어요` : `민원대장 ${n.no}번을 완료로 바꿨어요`);
    } catch (e) {
      setNote(errText(e));
    }
  }

  /** "완료 풀기": 이번에 완료로 바꾼 건은 그 전 상태로, 모르면 접수로 돌리고 조치완료일을 비워요. */
  async function undoDone(c: Case) {
    const m = linked(c);
    if (!m) return;
    const back = prevStatus[m.id] && !isClosed(prevStatus[m.id]) ? prevStatus[m.id] : "접수";
    try {
      const n = await api.setComplaintStatus(m.id, back, "");
      setComplaints((l) => l.map((x) => (x.id === n.id ? n : x)));
      setPrevStatus((p) => {
        const { [n.id]: _, ...rest } = p;
        return rest;
      });
      setNote(`민원대장 ${n.no}번을 ${back}(으)로 되돌렸어요`);
    } catch (e) {
      setNote(errText(e));
    }
  }

  /** 지시부에서 빠진 건: 민원대장 조치내용의 지시 줄을 지워요(공사를 바꾸면 다시 만들 때 새로 적어요). */
  async function clearAction(c: Case) {
    const old = c.complaint != null ? complaints.find((x) => x.id === c.complaint) : undefined;
    if (!old || !old.action) return;
    const { id, no: _n, memo: _m, ...input } = old;
    const m = await api.updateComplaint(id, { ...input, action: "" });
    setComplaints((l) => l.map((x) => (x.id === m.id ? m : x)));
  }

  /** 주소를 고쳐요. 민원대장에 넣은 건이면 그 줄의 지역·위치도 고치고, 지시부에 든 건은 그 지시부를 다시 만들어요. */
  async function saveAddress(c: Case, area: string, place: string, road: string) {
    const n = await patch(c.no, { area, place, road });
    if (!n) return;
    const old = linked(n);
    try {
      if (old && (old.area !== n.area || old.place !== n.place)) {
        const { id, no: _n, memo: _m, ...input } = old;
        const m = await api.updateComplaint(id, { ...input, area: n.area, place: n.place, road: n.road });
        setComplaints((l) => l.map((x) => (x.id === m.id ? m : x)));
      }
    } catch (e) {
      setNote(errText(e));
      return;
    }
    setNote("주소를 고쳤어요" + (old ? ` · 민원대장 ${old.no}번도 고쳤어요` : "") + (n.order != null ? " · 지시부를 다시 만들었어요" : ""));
  }

  const isDone = (c: Case) => {
    if (c.complaint == null) return false;
    const m = complaints.find((x) => x.id === c.complaint);
    return !!m && isClosed(m.status);
  };

  const found = useMemo(() => {
    const s = q.trim();
    if (!s) return cases;
    return cases.filter((c) => [c.no, c.area, c.place, c.summary, c.reason, plainOf(c.note)].some((t) => koIndex(t, s) >= 0));
  }, [cases, q]);
  // 줄 목록은 찾기 결과·완료 보기가 바뀔 때만 새로 만들어요 – 글자 폭 재기(아래 useLayoutEffect)가 줄 목록이 바뀔 때만 돌게(cols 최적화 1).
  const { open, done } = useMemo(() => ({ open: found.filter((c) => !isDone(c)), done: found.filter((c) => isDone(c)) }), [found, complaints]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (showDone ? [...open, ...done] : open), [showDone, open, done]);

  // ---------- 민원 불러오기: Claude가 신문고를 읽어 가져올 폴더에 놓고, 2초마다 표에 넣어요 ----------
  // hold: 실행 중엔 첨부가 아직 안 내려온 민원을 다음 번으로 미뤄요(Claude는 받기만 누르고 다음 건으로 – 2026-10-21 ②1안).
  async function pullInbox(acc: { n: number; failed: Set<string>; missing: number; added: string[]; got: Case[] }, hold = false) {
    const r = await api.readInbox(ps.inbox, ps.downloads, ps.root, hold);
    if (r.added.length) setCases((l) => [...l, ...r.added.filter((a) => !l.some((x) => x.no === a.no))]);
    // 위치가 도로명주소면 웹 답을 먼저 믿어요(앱은 받을 때 내장 표로 바꿔 둠 – 2026-10-21 사용자 2안).
    for (const a of r.added) {
      const orig = (a.road || a.place).trim();
      if (!looksRoad(orig)) continue;
      webLookup(orig).then(async (w) => {
        if (w?.kind !== "exact" || w.hit.place === a.place) return;
        const c = await api.updateCase(a.no, { area: areaFor(w.hit, a.area), place: w.hit.place, road: orig });
        setCases((l) => l.map((x) => (x.no === c.no ? c : x)));
      }).catch(() => undefined);
    }
    acc.n += r.added.length;
    acc.added.push(...r.added.map((a) => a.no));
    acc.got.push(...r.added);
    r.failed.forEach((f) => acc.failed.add(f));
    acc.missing += r.missingFiles.length;
    return r.held;
  }

  async function fetchCases() {
    if (run || !works) return;
    setNote("");
    setNoteLog("");
    // 접수번호로만 걸러요(2026-10-20 사용자): 지금 이 표에 있는 번호만 넘겨요 – 지운 민원은 다시 와요.
    const known = { nos: cases.map((c) => c.no) };
    if (!inApp) previewInbox(SAMPLES.map(({ guess, ...c }) => ({ ...c, work: guess ? works.find((w) => w.name.startsWith(guess))?.id ?? null : null })));
    try {
      await api.runClaude({ exe: ps.claude, inbox: ps.inbox, downloads: ps.downloads, guide: aiGuide(ps, works, known), model: ps.claudeModel ?? "sonnet" });
    } catch (e) {
      setNote(errText(e));
      return;
    }
    setRun({ n: 0, total: null });
    const t0 = Date.now();
    let skipped: number | null = null;
    const acc = { n: 0, failed: new Set<string>(), missing: 0, added: [] as string[], got: [] as Case[] };
    let st: RunStatus;
    for (;;) {
      await new Promise((r) => setTimeout(r, inApp ? 2000 : 700));
      st = await api.claudeStatus(ps.inbox).catch(() => ({ state: "error", total: null, done: null, message: "", log: "", skipped: [] }) as RunStatus);
      await pullInbox(acc, true).catch(() => 0);
      setRun({ n: st.done ?? acc.n, total: st.total });
      if (st.skipCount != null) skipped = st.skipCount;
      if (st.state !== "running") break;
    }
    const secs = Math.round((Date.now() - t0) / 1000);
    // 끝난 뒤 늦게 내려오는 첨부를 조금 더 기다려요(최대 20초) – 그래도 없으면 이름만 남기고 넣어요.
    for (let i = 0; i < 10; i++) {
      const held = await pullInbox(acc, true).catch(() => 0);
      if (!held) break;
      await new Promise((r) => setTimeout(r, inApp ? 2000 : 300));
    }
    await pullInbox(acc).catch(() => 0);
    setRun(null);
    await pickSitePhotos(acc.got);
    const tail = [
      acc.failed.size ? `못 읽은 파일 ${[...acc.failed].join(", ")}` : "",
      acc.missing ? `못 찾은 사진 ${acc.missing}개 – 크롬이 받는 곳(설정 "다운로드 폴더")과 크롬의 신문고 "자동 다운로드" 허용을 봐 주세요` : "",
    ].filter(Boolean);
    const head =
      st.state === "login"
        ? "신문고 로그인이 풀려 있어요. [신문고 열기]로 로그인한 뒤 다시 눌러 주세요"
        : st.state === "stopped"
          ? `멈췄어요 · 새 민원 ${acc.n}건`
          : st.state === "error"
            ? `Claude가 멈췄어요${st.message ? ` – ${st.message}` : ""} · 새 민원 ${acc.n}건`
            : `새 민원 ${acc.n}건`;
    // 잘 끝났으면 결과는 아래 줄(새 민원 · 건너뜀 · 걸린 시간 · 로그)에 남아요 – 안내 줄은 멈춤·오류·못 읽은 것만.
    setNote(st.state === "done" && !tail.length ? "" : [head, ...tail].join(" · "));
    if (st.state === "error" || st.state === "stopped") setNoteLog(st.log);
    const f = `${stamp()} · 새 민원 ${acc.n}건`;
    setFetched(f);
    const lr: LastRun = { at: stamp(), added: acc.n, skipped, secs, log: st.log, per: acc.n ? Math.round(secs / acc.n) : undefined };
    setLastRun(lr);
    await api.set(FETCHED_KEY, f);
    await api.set(LAST_RUN_KEY, JSON.stringify(lr));
  }

  /** 현장사진이 여러 장인 새 민원은 AI가 열어 보고 1장을 맨 앞으로(지시부엔 맨 앞 1장만 – 2026-10-21 22:59 사용자 ①1안·②1안). 실패하면 순서 그대로. */
  async function pickSitePhotos(got: Case[]) {
    const items = got.map((c) => ({ no: c.no, summary: c.summary, photos: c.photos.filter(isPath) })).filter((i) => i.photos.length > 1);
    if (!items.length) return;
    setNote(`현장사진 고르는 중 · ${items.length}건`);
    try {
      const res = await api.pickPhotos({ exe: ps.claude, model: ps.claudeModel ?? "sonnet", inbox: ps.inbox, items });
      const next = { ...picks };
      for (const r of res) {
        const c = got.find((x) => x.no === r.no);
        if (!c) continue;
        const order = [r.pick, ...c.photos.filter((x) => x !== r.pick)];
        const u = await api.updateCase(c.no, { photos: order });
        setCases((l) => l.map((x) => (x.no === u.no ? u : x)));
        if (r.reason) next[c.no] = r.reason;
      }
      setPicks(next);
      await api.set(PICK_KEY, JSON.stringify(next));
    } catch {
      /* 고르지 못하면 받은 순서 그대로 – 줄 ⋯ 메뉴에서 직접 고를 수 있어요 */
    }
    setNote("");
  }

  /** 줄 ⋯ 메뉴에서 지시부에 넣을 현장사진을 바꿔요(맨 앞으로) */
  async function choosePhoto(c: Case, path: string) {
    const order = [path, ...c.photos.filter((x) => x !== path)];
    try {
      const u = await api.updateCase(c.no, { photos: order });
      setCases((l) => l.map((x) => (x.no === u.no ? u : x)));
      const next = { ...picks, [c.no]: "직접 고름" };
      setPicks(next);
      await api.set(PICK_KEY, JSON.stringify(next));
    } catch (e) {
      setNote(errText(e));
    }
  }

  async function stopFetch() {
    await api.stopClaude().catch(() => {});
  }

  // ---------- 지시부 메일 보내기 (korea.kr, 2026-10-20 사용자 2안·2안 – Claude가 [보내기]까지) ----------

  /** 지시부의 받는 사람: 공사 관리의 현장대리인 → 업무연락처 메일 주소 */
  const recipientOf = (o: Order) => {
    const w = (works ?? []).find((x) => x.id === o.work);
    const c = w?.contact != null ? cd?.contacts.find((x) => x.id === w.contact) : undefined;
    return { work: w, name: c?.name ?? "", org: c?.org ?? "", email: (c?.email ?? "").trim() };
  };

  function openMail(o: Order) {
    setSendMenu(null);
    const r = recipientOf(o);
    if (!r.work || !r.email) return;
    const n = cases.filter((c) => c.order === o.id).length;
    const d = mailDraft(ps, r.work, o.seq, n, r.name);
    setMailAsk({ id: o.id, to: r.email, toName: r.name, org: r.org, subject: d.subject, body: d.body, label: orderTag(r.work.name, o.seq) });
  }

  async function mailOrder(m: MailDraft) {
    if (run || mailRun) return;
    setMailAsk(null);
    setNote("");
    setNoteLog("");
    const o0 = orders.find((x) => x.id === m.id);
    if (!o0) return;
    const o = o0.jpgs.length ? o0 : await makeJpg(o0.id);
    if (!o?.jpgs.length) return;
    const dir = `${ps.outbox}\\메일`;
    const files = [o.file, ...o.jpgs];
    try {
      await api.runClaude({ exe: ps.claude, inbox: dir, downloads: ps.downloads, guide: mailGuide({ dir, to: m.to, toName: m.toName, subject: m.subject, body: m.body, files }), model: ps.claudeModel ?? "sonnet" });
    } catch (e) {
      setNote(errText(e));
      return;
    }
    setMailRun({ id: o.id, label: m.label, n: 0 });
    let st: RunStatus;
    for (;;) {
      await new Promise((r) => setTimeout(r, inApp ? 2000 : 900));
      st = await api.claudeStatus(dir).catch(() => ({ state: "error", total: null, done: null, message: "", log: "", skipped: [] }) as RunStatus);
      setMailRun({ id: o.id, label: m.label, n: st.done ?? 0 });
      if (st.state !== "running") break;
    }
    setMailRun(null);
    if (st.state === "done") {
      const at = `${todayStr()} ${stamp().slice(6)}`;
      // 보내기는 됐는데 보낸메일함에서 같은 제목을 못 찾았으면 "확인 필요"(Claude 마지막 답 MAIL_UNCONFIRMED)
      const ok = st.message !== "unconfirmed";
      try {
        putOrder(await api.orderMailed(o.id, m.to, at, m.subject, ok));
        setNote(ok ? `${m.label}을 ${m.toName || m.to} 현장대리인에게 메일로 보냈어요 · ${at.slice(11)}` : `${m.label} 메일 – 보낸메일함에서 같은 제목을 못 찾았어요 · 진행 막대를 눌러 확인해 주세요`);
      } catch (e) {
        setNote(errText(e));
      }
      return;
    }
    setNote(
      st.state === "login"
        ? "korea.kr 로그인이 풀려 못 보냈어요 – 크롬에서 로그인한 뒤 다시 [보내기 ▾ → 메일]을 눌러 주세요"
        : st.state === "stopped"
          ? "메일 보내기를 멈췄어요 – 크롬의 메일쓰기 탭을 확인해 주세요"
          : `메일을 못 보냈어요${st.message ? ` – ${st.message}` : ""}`,
    );
    setNoteLog(st.log);
  }

  // ---------- 지시부 만들기 · 폰으로 보내기 (지시부째) ----------
  const setBusyOf = (k: string, v: string | null) => setBusy(({ [k]: _, ...b }) => (v ? { ...b, [k]: v } : b));

  async function makeJpg(id: number): Promise<Order | null> {
    setBusyOf(String(id), "만드는 중");
    try {
      const o = await api.orderJpg(id);
      putOrder(o);
      return o;
    } catch (e) {
      setNote(`JPG를 만들지 못했어요 – ${errText(e)}`);
      return null;
    } finally {
      setBusyOf(String(id), null);
    }
  }

  /** 만든(다시 만든) 지시부의 건들을 민원대장에 적어요: 처음이면 등록, 있으면 그 줄의 조치내용·주소를 고쳐요. */
  async function writeComplaints(r: OrderResult): Promise<{ added: number; fixed: number }> {
    const w = r.works.find((x) => x.id === r.order.work);
    let added = 0;
    let fixed = 0;
    const list = [...complaints];
    for (const c of r.cases) {
      // 기본 기호(●)로 적어요(2026-10-21 민원대장 세션 – □는 일부러 친 위계라 빼요).
      const action = JSON.stringify([{ t: actionLine(w?.name ?? "", r.order.seq, c.item) }]);
      const old = c.complaint != null ? list.find((x) => x.id === c.complaint) : undefined;
      let m: Complaint;
      if (old) {
        const { id, no: _n, memo: _m, ...input } = old;
        m = await api.updateComplaint(id, { ...input, area: c.area, place: c.place, road: c.road, action });
        list.splice(list.indexOf(old), 1, m);
        fixed++;
      } else {
        m = await api.addComplaint(complaintOf(c, action));
        list.push(m);
        putCase(await api.updateCase(c.no, { complaint: m.id }));
        added++;
      }
    }
    setComplaints(list);
    return { added, fixed };
  }

  async function runOrder(req: { nos: string[]; order: number | null }, key: string) {
    if (busy[key]) return;
    setBusyOf(key, "만드는 중");
    let r: OrderResult;
    try {
      r = await api.makeOrder({ ...req, root: ps.root, date: today, tpl: ps.tpl, inbox: ps.inbox, downloads: ps.downloads });
      setWorks(r.works);
      setCases((l) => l.map((x) => r.cases.find((y) => y.no === x.no) ?? x));
      putOrder(r.order);
      const w = r.works.find((x) => x.id === r.order.work);
      const n = await writeComplaints(r);
      const tag = w ? orderTag(w.name, r.order.seq) : String(r.order.seq);
      setNote(
        `지시부 ${tag}(${r.cases.length}건)를 ${req.order != null ? "다시 " : ""}만들었어요` +
          (n.added ? ` · 민원대장 ${n.added}건 등록` : "") +
          (n.fixed ? ` · 민원대장 ${n.fixed}건 고침` : "") +
          (r.missing.length ? ` · 양식에 없는 자리 ${r.missing.join(" ")}` : "") +
          (r.noPhoto?.length ? ` · 사진을 못 찾은 민원 ${r.noPhoto.length}건(${r.noPhoto.map(shortNo).join(", ")}) – 사진 없이 넣었어요` : ""),
      );
    } catch (e) {
      setNote(errText(e));
      return;
    } finally {
      setBusyOf(key, null);
    }
    await makeJpg(r.order.id);
  }

  async function makeOrder() {
    if (!chosen.length) return;
    const nos = chosen;
    setChosen([]);
    await runOrder({ nos, order: null }, "new");
  }

  const remakeOrder = (id: number) => runOrder({ nos: [], order: id }, String(id));

  async function send(o: Order) {
    if (busy[o.id]) return;
    const ready = o.jpgs.length ? o : await makeJpg(o.id);
    if (!ready?.jpgs.length) return;
    try {
      putOrder(await api.sendOrder(o.id, ps.outbox));
      setNote(`보낼 폴더에 JPG ${ready.jpgs.length}장을 넣었어요 · Claude 앱 “민원처리” 대화에 “보내”라고 하세요`);
    } catch (e) {
      setNote(errText(e));
    }
  }

  /** 접수번호 누르기: 1AA로 시작하는 전체 번호를 복사만 해요(2026-10-21 사용자 – 신문고는 열지 않아요). */
  async function copyNo(no: string) {
    try {
      await navigator.clipboard.writeText(no);
      setNote(`접수번호를 복사했어요(${no})`);
    } catch {
      setNote(`접수번호를 복사하지 못했어요(${no})`);
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
    const rect = pick?.rect;
    setPick(null);
    if (c.work === id) return;
    setChosen((l) => l.filter((n) => n !== c.no));
    // 지시부에 든 건이면 그 지시부에서 빠지고(남은 건으로 다시 만들어요), 새 공사로 다시 골라 만들어요.
    const n = await patch(c.no, { work: id });
    // 해당 없음: 아직 민원대장에 없으면 넣을지 물어요(2026-10-21 사용자).
    if (n && id === NA_WORK && !linked(n) && rect) setNaAsk({ no: n.no, rect });
  }

  async function remove(no: string) {
    setAsk(null);
    const c = cases.find((x) => x.no === no);
    setChosen((l) => l.filter((n) => n !== no));
    try {
      await api.deleteCase(no);
      setCases((l) => l.filter((x) => x.no !== no));
      if (c?.order != null) {
        const pd = await api.processData();
        setCases(pd.cases);
        setOrders(pd.orders);
        const o = pd.orders.find((x) => x.id === c.order);
        if (o?.dirty) await remakeOrder(o.id);
      }
    } catch (e) {
      setNote(errText(e));
    }
  }

  // 공사 관리 창이 쓰는 저장
  const saveWork = useCallback(async (id: number | null, input: WorkInput) => setWorks(await api.saveWork(id, input)), []);
  const deleteWork = useCallback(async (id: number) => {
    setWorks(await api.deleteWork(id));
    const pd = await api.processData();
    setCases(pd.cases);
    setOrders(pd.orders);
  }, []);

  // 보내는 중인 지시부: Claude가 올렸는지 화면을 연 동안 15초마다 봐요.
  const queued = orders.some((o) => o.stage === "queued");
  useEffect(() => {
    if (!queued) return;
    const look = () =>
      api.checkSent(`${todayStr()} ${stamp().slice(6)}`).then(
        (l) => l.forEach(putOrder),
        () => {},
      );
    look();
    const t = window.setInterval(look, 15000);
    return () => window.clearInterval(t);
  }, [queued]);

  // 바깥 누르기·Esc로 뜨는 것 닫기
  useEffect(() => {
    if (!pick && !ask && !menu && !proof && !naAsk && !doneAsk && !sendMenu) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && (setPick(null), setAsk(null), setMenu(null), setProof(null), setNaAsk(null), setDoneAsk(null), setSendMenu(null));
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pick, ask, menu, proof, naAsk, doneAsk, sendMenu]);

  // 목록 안쪽 폭과 스크롤 막대 폭을 재요(창 크기·줄 수가 바뀌면 다시).
  useEffect(() => {
    const el = bodyRef.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    // 표가 쓸 수 있는 폭 = 가로 스크롤 상자 폭 − 세로 스크롤 막대(목록은 넓힌 열만큼 커지니 상자에서 재요)
    const measure = () => {
      const g = el.offsetWidth - el.clientWidth;
      setGutter(g);
      setAvail(Math.max(0, box.clientWidth - g));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [works === null, rows.length]);

  // 열 폭 자동 맞춤: 그려진 줄의 글자 폭을 재요(줄·민원대장·공사가 바뀌거나 글꼴을 다 받은 뒤 다시).
  useLayoutEffect(() => {
    const measure = () => {
      const body = bodyRef.current;
      const head = body?.parentElement?.querySelector(".pr-headrow");
      if (!body || !head) return;
      const lines = [...body.querySelectorAll(":scope > .pr-row")];
      const next: Record<number, number> = {};
      for (const i of AUTO_COLS) {
        let m = 0;
        const h = head.children[i];
        const t = h && [...h.childNodes].find((n) => n.nodeType === 3);
        if (t) {
          const r = document.createRange();
          r.selectNodeContents(t);
          m = r.getBoundingClientRect().width;
        }
        for (const row of lines) {
          const c = row.children[i];
          if (c && !c.classList.contains("pr-place-edit")) m = Math.max(m, textWidth(c));
        }
        if (m > 0) next[i] = Math.min(i === 4 ? PLACE_MAX : Infinity, Math.ceil(m) + COL_GAP);
      }
      setAuto((old) => (AUTO_COLS.every((i) => old[i] === next[i]) ? old : next));
    };
    measure();
    let alive = true;
    document.fonts?.ready.then(() => alive && measure());
    return () => {
      alive = false;
    };
  }, [rows, complaints, works]);

  // 열 폭(헤더 열 조정 통일 ✔1~3): 처음 값 = 글자에 맞춘 폭(AUTO_COLS)·정해진 폭, 민원 요약은 남는 폭(창에 맞춘 처음 값 – 다른 열을 끌어도 그대로).
  const inits = COLUMNS.map((c, i) => auto[i] ?? c.w);
  const sumInit = Math.max(SUM_MIN, Math.floor(avail - inits.reduce<number>((a, w) => a + (w ?? 0), 0)));
  const colDefs: ColDef[] = COLUMNS.map((c, i) => ({ id: c.id, label: c.label, init: inits[i] ?? sumInit, fixed: c.fixed, text: c.text }));
  /** 내용에 맞춤: 번호·접수·기한·위치는 글자 폭 + 칸 여백(위치도 260 제한 없이), 나머지는 칸을 복사해 잰 폭 – 여유는 cols.ts가 더해요 */
  const measureCol = (id: string): number | null => {
    const i = COLUMNS.findIndex((c) => c.id === id);
    const body = bodyRef.current;
    const head = body?.parentElement?.querySelector(".pr-headrow");
    if (i < 0 || !body || !head) return null;
    const lines = [...body.querySelectorAll<HTMLElement>(":scope > .pr-row")].map((r) => r.children[i] as HTMLElement | undefined).filter((c): c is HTMLElement => !!c && !c.classList.contains("pr-place-edit"));
    if (AUTO_COLS.includes(i)) {
      let m = 0;
      const t = [...(head.children[i]?.childNodes ?? [])].find((n) => n.nodeType === 3);
      if (t) {
        const r = document.createRange();
        r.selectNodeContents(t);
        m = r.getBoundingClientRect().width;
      }
      for (const c of lines) m = Math.max(m, textWidth(c));
      return m > 0 ? Math.ceil(m) + padX(lines[0] ?? (head.children[i] as HTMLElement)) : null;
    }
    return widestOf([head.children[i] as HTMLElement, ...lines]);
  };
  const cols = useColHead({ store: COLS_KEY, cols: colDefs, measure: measureCol });
  const shownWidths = COLUMNS.map((c) => cols.width(c.id));
  const colSum = shownWidths.reduce((a, w) => a + w, 0);

  if (!works) {
    return (
      <>
        <h1 className="title">국민신문고 민원 불러오기</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  const pickCase = pick && cases.find((c) => c.no === pick.no);
  // 고르기 칸은 "새 지시부로 묶을 민원 고르기" 하나만(2026-10-21 사용자 1안): 지시부에 든 줄·끝난 줄은 고르지 않고
  // 진행 막대나 ⋯ 메뉴로 다뤄요. 같은 공사만 함께 골라요.
  const first = chosen.length ? cases.find((c) => c.no === chosen[0]) : undefined;
  const chosenWork = first ? works.find((w) => w.id === first.work) : undefined;
  const pickable = (c: Case) => c.order == null && c.work != null && c.work !== NA_WORK && !isDone(c);
  const canChoose = (c: Case) => pickable(c) && (!chosenWork || c.work === chosenWork.id);
  const toggle = (c: Case) => setChosen((l) => (l.includes(c.no) ? l.filter((n) => n !== c.no) : canChoose(c) ? [...l, c.no] : l));
  // 머리 줄 전체 고르기(2안): 한 줄을 고른 뒤 누르면 보이는 줄 중 같은 공사의 고를 수 있는 민원을 모두, 다 골랐으면 모두 풀어요.
  const sameWork = chosenWork ? found.filter((c) => pickable(c) && c.work === chosenWork.id) : [];
  const allState: "none" | "some" | "all" = !chosen.length ? "none" : sameWork.every((c) => chosen.includes(c.no)) ? "all" : "some";
  const toggleAll = () => setChosen(allState === "all" ? [] : [...new Set([...chosen, ...sameWork.map((c) => c.no)])]);
  const total = cases.filter((c) => !isDone(c)).length;
  const tableStyle = { "--pr-cols": shownWidths.map((w) => w + "px").join(" "), "--pr-gutter": `${gutter}px`, "--pr-w": `${colSum + gutter}px` } as CSSProperties;

  /** 진행 막대 한 칸(2026-10-20 1안): 채움·단계(색 진하기)·글자·아이콘 – 민원대장 답변·완료가 지시부보다 앞서요. */
  const progOf = (c: Case): Prog => {
    const m = linked(c);
    if (m && isClosed(m.status)) return { pct: 100, step: 5, label: m.status, kind: "done" };
    if (m && isAnswered(m.status)) return { pct: 80, step: 4, label: m.status, kind: "answer" };
    const o = orderOf(c);
    if (o ? busy[o.id] : busy[`c${c.no}`]) return { pct: 40, step: 2, label: "만드는 중", icon: "doc", hatch: true, kind: "busy" };
    if (!o) return { pct: 20, step: 1, label: "접수", kind: "new" };
    if (mailRun?.id === o.id) return { pct: 40, step: 2, label: "보내는 중", icon: "mail", hatch: true, kind: "sending" };
    if (o.stage === "queued") return { pct: 40, step: 2, label: "보내는 중", icon: "phone", hatch: true, kind: "sending" };
    if (o.mailedAt)
      return o.mailOk === false
        ? { pct: 60, step: 3, label: "확인 필요", icon: "warn", warn: true, kind: "proof" }
        : { pct: 60, step: 3, label: `메일 보냄 ${o.mailedAt.slice(5, 10)}`, icon: "mail", check: true, kind: "proof" };
    if (o.stage === "sent") return { pct: 60, step: 3, label: `폰 보냄 ${(o.sentAt || "").slice(5, 10)}`.trim(), icon: "phone", check: true, kind: "proof" };
    return { pct: 40, step: 2, label: "지시부", icon: "doc", kind: "order" };
  };

  const openMenu = (c: Case, rect: DOMRect) => {
    setPick(null);
    setAsk(null);
    setProof(null);
    setMenu(menu?.no === c.no ? null : { no: c.no, rect });
  };

  const renderRow = (c: Case) => {
    const w = works.find((x) => x.id === c.work);
    const na = c.work === NA_WORK;
    const isD = isDone(c);
    const left = c.due ? daysBetween(today, c.due) : null;
    const k = workColor(w, cd);
    const o = orderOf(c);
    const b = o ? busy[o.id] : undefined;
    const picked = chosen.includes(c.no);
    const p = progOf(c);
    const m = linked(c);
    const why = [c.reason, c.road ? `원래 주소 ${c.road}` : ""].filter(Boolean).join(" · ");
    const barTitle =
      p.kind === "proof"
        ? "눌러서 보낸 증거 보기"
        : p.kind === "order"
          ? `지시부 열기 · ${orderLabel(works.find((x) => x.id === o?.work)?.name ?? "", o?.seq ?? 0, c.item)}번째 항목${o?.dirty ? " · 다시 만들어야 해요" : " · 보내기 전"}`
          : p.kind === "answer" || p.kind === "done"
            ? `민원대장 ${m?.no ?? ""}번 · 눌러서 그 줄로 가요`
            : p.kind === "sending"
              ? "보내는 중이에요"
              : p.kind === "busy"
                ? "지시부를 만들고 있어요"
                : "가져왔고 아직 지시부 전이에요";
    return (
      <div
        key={c.no}
        className="pr-row"
        role="row"
        data-sel={sel === c.no || ask?.no === c.no || menu?.no === c.no || picked ? "1" : undefined}
        data-done={isD ? "1" : undefined}
        onClick={() => setSel(sel === c.no ? null : c.no)}
        onDoubleClick={() => c.complaint != null && onOpenComplaint(c.complaint)}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("input, textarea")) return;
          e.preventDefault();
          openMenu(c, new DOMRect(e.clientX, e.clientY, 0, 0));
        }}
      >
        <div className="pr-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`${c.no} 고르기`}
            checked={picked}
            disabled={!picked && !canChoose(c)}
            title={
              c.order != null || isD
                ? "지시부에 든 민원이에요 – 진행 막대나 ⋯ 메뉴로 다뤄요"
                : c.work === NA_WORK
                  ? "해당 없음 민원은 지시부로 묶지 않아요"
                  : c.work == null
                  ? "먼저 공사를 골라요"
                  : !picked && !canChoose(c)
                    ? "같은 공사만 함께 고를 수 있어요"
                    : "지시부로 묶을 민원 고르기"
            }
            onChange={() => toggle(c)}
          />
        </div>
        <div className="pr-no">
          <button
            type="button"
            className="pr-no-link"
            title={`${c.no} · 누르면 전체 번호 복사`}
            onClick={(e) => {
              e.stopPropagation();
              copyNo(c.no);
            }}
          >
            {shortNo(c.no)}
          </button>
        </div>
        <div className="pr-date">{md(c.received)}</div>
        <div className="pr-date pr-due">
          <span className={isD ? "pr-strike" : undefined}>{md(c.due)}</span>
          {!isD && left !== null && (
            <span className={"pr-d" + (left <= urgentDays ? " urgent" : left <= urgentDays + 1 ? " soon" : "")}>
              {left > 0 ? `D-${left}` : left === 0 ? "D-day" : `D+${-left}`}
            </span>
          )}
        </div>
        <PlaceCell c={c} colW={cols.width("place")} disabled={isD || !!b} onSave={(a, pl, r) => saveAddress(c, a, pl, r)} />
        <div
          className="pr-sum"
          onMouseEnter={(e) => {
            if (!why) return;
            const rect = (e.currentTarget.firstElementChild as HTMLElement).getBoundingClientRect();
            window.clearTimeout(tipTimer.current);
            tipTimer.current = window.setTimeout(() => setTip({ text: why, rect }), 250);
          }}
          onMouseLeave={() => {
            window.clearTimeout(tipTimer.current);
            setTip(null);
          }}
        >
          <span className={"pr-sum-t" + (why ? " has-tip" : "")}>{c.summary}</span>
        </div>
        <div>
          <button
            type="button"
            className={"pr-work" + (w ? "" : na ? " na" : " none")}
            style={w ? ({ "--wc": `var(--pj-${k}-line)`, "--wf": `var(--pj-${k}-fg)` } as CSSProperties) : undefined}
            disabled={isD || !!b}
            title={isD ? w?.name : na ? "공사 대상이 아니에요\n눌러서 공사 바꾸기" : c.order == null ? (w ? `${w.name}\n눌러서 공사 바꾸기` : "눌러서 공사 고르기") : `${w?.name ?? ""}\n공사를 바꾸면 이 지시부에서 빠져요(남은 건으로 다시 만들어요)`}
            onClick={(e) => {
              e.stopPropagation();
              setAsk(null);
              setMenu(null);
              setPick(pick?.no === c.no ? null : { no: c.no, rect: e.currentTarget.getBoundingClientRect() });
            }}
          >
            {w ? w.name : na ? "해당 없음" : "– 공사 고르기"}
          </button>
        </div>
        <NoteCell value={c.note} disabled={isD} onSave={(v) => patch(c.no, { note: v })} />
        <div className="pr-prog" onClick={(e) => e.stopPropagation()}>
          <Gauge
            p={p}
            title={barTitle}
            onClick={
              p.kind === "proof" && o
                ? (e) => {
                    setMenu(null);
                    setProof(proof?.id === o.id ? null : { id: o.id, rect: e.currentTarget.getBoundingClientRect() });
                  }
                : p.kind === "order" && o?.file
                  ? () => openFile(o.file)
                  : (p.kind === "answer" || p.kind === "done") && m
                    ? () => onOpenComplaint(m.id)
                    : undefined
            }
          />
          <button type="button" className={"pr-more" + (menu?.no === c.no ? " on" : "")} aria-label="이 민원 메뉴" aria-haspopup="menu" aria-expanded={menu?.no === c.no} title="지시부 · 보내기 · 저장 폴더 · 민원대장 · 완료 · 지우기" onClick={(e) => openMenu(c, e.currentTarget.getBoundingClientRect())}>
            <MoreIcon />
          </button>
        </div>
      </div>
    );
  };

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

/** 접수번호 마지막 묶음 7자리(1AA-2610-0527749 → 0527749) */
const shortNo = (no: string) => no.split(/[\s/]/)[0].split("-").pop() || no;

/** 걸린 시간: 42초 · 1분 42초 */
const duration = (secs: number) => (secs < 60 ? `${secs}초` : `${Math.floor(secs / 60)}분${secs % 60 ? ` ${secs % 60}초` : ""}`);

function MoreIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

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
