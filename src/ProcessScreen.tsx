// 민원처리 화면이에요(10단계). 시안 Process.dc.html과 사양서 "민원처리" 절을 따라요.
//
// - 표준 지시부(2026-10-19 사용자 1안, 시안 ProcessOrder.dc.html): 같은 공사 민원을 골라(줄 앞 고르기 칸) [지시부 만들기]
//   → 표준 양식 한 파일(민원 폴더에 지시일_축약 공사명-연번.hwpx, 항목은 접수일 순) + 민원대장 등록(조치내용 "□ 공사명 지시(1지구-03 · 2)")
//   + 쪽마다 JPG(한글). 민원대장에서 완료하면 이 표에서 숨어요.
// - 줄 끝 지시부 칸: "1지구-03 · 1" + 진행 [폰 전송] → 보내는 중 → ✓ 전송 완료(지시부째 함께 바뀌어요).
//   지시부에 든 건의 공사·주소·고려사항을 고치면 그 지시부를 다시 만들어요(같은 연번·같은 파일).
// - [폰 전송] = 지시부의 JPG를 보낼 폴더에 복사 → "보내는 중". Claude가 대화에 올리고 "보냄" 폴더에 써 두면 ✓ 전송 완료(사용자 2안).
// - 대상이 아닌 건은 줄 끝 ×(작은 묻기 창). 지운 건은 다음 불러오기 때 다시 와요.
// - 공사 관리 창: 현장대리인은 업무연락처에서 골라요(같은 연락처 하나 — 쌍방향), 공사명은 업무연락처 프로젝트로도 등록돼요.
import { createPortal } from "react-dom";
import { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, Case, Complaint, Contact, ContactsData, errorText, inApp, Order, OrderResult, previewInbox, RunStatus, Work, WorkInput } from "./api";
import { COL_MIN, daysBetween, fitWidths, gridTemplate, maxWidthOf } from "./complaints";
import { projectColor } from "./ContactsScreen";
import { DelIcon } from "./Icons";
import { koIndex, todayStr } from "./journal";
import { PlaceInput } from "./PlaceInputs";
import { actionLine, aiGuide, fileName, mailDraft, mailGuide, md, orderLabel, orderTag, PORTAL_URL, processError, SAMPLE_WORKS, SAMPLES } from "./process";
import { DEFAULT_PROCESS, isClosed, loadSettings, ProcessSettings } from "./settingsStore";

type Props = { urgentDays: number; onOpenComplaint: (id: number) => void };

/** 공사 색 = 업무연락처 프로젝트 색 */
function workColor(w: Work | undefined, cd: ContactsData | null): number {
  const p = w && cd?.projects.find((x) => x.id === w.project);
  return p ? projectColor(p) : 0;
}

const phoneOf = (c: Contact | undefined) => (c ? c.mobile || c.tel : "");

const FETCHED_KEY = "process.fetched";
const COLS_KEY = "process.colWidths";

/** 열 제목과 처음 폭. null은 남는 폭을 쓰는 열(민원 요약)이에요. 끌어서 바꾼 폭은 COLS_KEY에 저장해요. */
const COLUMNS: { label: string; w: number | null; center?: boolean; fixed?: boolean }[] = [
  { label: "", w: 36, fixed: true },
  { label: "접수번호", w: 140 },
  { label: "접수", w: 60 },
  { label: "기한", w: 100 },
  { label: "위치", w: 180 },
  { label: "민원 요약 · 판단 이유", w: null },
  { label: "판단 공사", w: 160 },
  { label: "고려사항", w: 140 },
  { label: "지시부", w: 320 },
];
const defaultWidths = () => COLUMNS.map((c) => c.w);

function readWidths(raw: string | null): (number | null)[] {
  try {
    const v = JSON.parse(raw ?? "");
    if (Array.isArray(v) && v.length === COLUMNS.length && v.every((x, i) => (COLUMNS[i].w === null ? x === null : typeof x === "number" && x >= COL_MIN))) return v;
  } catch {
    /* 처음 폭으로 */
  }
  return defaultWidths();
}

const UNKNOWN = "주소불명";

/** 민원대장 내용(줄 목록 JSON 또는 글자)을 한 줄 글자로 */
function bodyText(b: string): string {
  try {
    const v = JSON.parse(b);
    if (Array.isArray(v)) return v.map((x) => x?.t ?? "").filter(Boolean).join(" / ");
  } catch {
    /* 글자 그대로 */
  }
  return b.replace(/\s+/g, " ");
}

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
  const [widths, setWidths] = useState<(number | null)[]>(defaultWidths);
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

  const today = todayStr();

  useEffect(() => {
    (async () => {
      const [pd, cl, cdata, st, f, cw] = await Promise.all([api.processData(), api.complaints(), api.contactsData(), loadSettings(), api.get(FETCHED_KEY), api.get(COLS_KEY)]);
      setWidths(readWidths(cw));
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

  function saveWidths(ws: (number | null)[]) {
    setWidths(ws);
    api.set(COLS_KEY, JSON.stringify(ws)).catch((e) => setNote(errorText(e)));
  }

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
    try {
      const m = await api.addComplaint(complaintOf(c, ""));
      setComplaints((l) => [...l, m]);
      putCase(await api.updateCase(c.no, { complaint: m.id }));
      setNote(`민원대장 ${m.no}번에 등록했어요`);
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
    return cases.filter((c) => [c.no, c.area, c.place, c.summary, c.reason, c.note].some((t) => koIndex(t, s) >= 0));
  }, [cases, q]);
  const open = found.filter((c) => !isDone(c));
  const done = found.filter((c) => isDone(c));
  const rows = showDone ? [...open, ...done] : open;

  // ---------- 민원 불러오기: Claude가 신문고를 읽어 가져올 폴더에 놓고, 2초마다 표에 넣어요 ----------
  async function pullInbox(acc: { n: number; failed: Set<string>; missing: number }) {
    const r = await api.readInbox(ps.inbox, ps.downloads, ps.root);
    if (r.added.length) setCases((l) => [...l, ...r.added.filter((a) => !l.some((x) => x.no === a.no))]);
    acc.n += r.added.length;
    r.failed.forEach((f) => acc.failed.add(f));
    acc.missing += r.missingFiles.length;
  }

  async function fetchCases() {
    if (run || !works) return;
    setNote("");
    setNoteLog("");
    // 이미 있는 기록: 이 표의 접수번호 + 민원대장(최근 90일 접수, 민원인 정보는 빼요)
    const since = todayStr(new Date(Date.now() - 90 * 86400000));
    const known = {
      nos: cases.map((c) => c.no),
      records: complaints
        .filter((m) => m.received >= since)
        .map((m) => `${m.received} · ${[m.area, m.place].filter(Boolean).join(" ") || "위치 없음"} · ${bodyText(m.body).slice(0, 80)}`),
    };
    if (!inApp) previewInbox(SAMPLES.map(({ guess, ...c }) => ({ ...c, work: guess ? works.find((w) => w.name.startsWith(guess))?.id ?? null : null })));
    try {
      await api.runClaude({ exe: ps.claude, inbox: ps.inbox, downloads: ps.downloads, guide: aiGuide(ps, works, known) });
    } catch (e) {
      setNote(errText(e));
      return;
    }
    setRun({ n: 0, total: null });
    const acc = { n: 0, failed: new Set<string>(), missing: 0 };
    let st: RunStatus;
    for (;;) {
      await new Promise((r) => setTimeout(r, inApp ? 2000 : 700));
      st = await api.claudeStatus(ps.inbox).catch(() => ({ state: "error", total: null, done: null, message: "", log: "" }) as RunStatus);
      await pullInbox(acc).catch(() => {});
      setRun({ n: st.done ?? acc.n, total: st.total });
      if (st.state !== "running") break;
    }
    await pullInbox(acc).catch(() => {});
    setRun(null);
    const tail = [acc.failed.size ? `못 읽은 파일 ${[...acc.failed].join(", ")}` : "", acc.missing ? `못 찾은 사진 ${acc.missing}개` : ""].filter(Boolean);
    const head =
      st.state === "login"
        ? "신문고 로그인이 풀려 있어요. [신문고 열기]로 로그인한 뒤 다시 눌러 주세요"
        : st.state === "stopped"
          ? `멈췄어요 · 새 민원 ${acc.n}건`
          : st.state === "error"
            ? `Claude가 멈췄어요${st.message ? ` — ${st.message}` : ""} · 새 민원 ${acc.n}건`
            : `새 민원 ${acc.n}건`;
    setNote([head, ...tail].join(" · "));
    if (st.state === "error" || st.state === "stopped") setNoteLog(st.log);
    const f = `${stamp()} · 새 민원 ${acc.n}건`;
    setFetched(f);
    await api.set(FETCHED_KEY, f);
  }

  async function stopFetch() {
    await api.stopClaude().catch(() => {});
  }

  // ---------- 지시부 메일 보내기 (korea.kr, 2026-10-20 사용자 2안·2안 — Claude가 [보내기]까지) ----------

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
      await api.runClaude({ exe: ps.claude, inbox: dir, downloads: ps.downloads, guide: mailGuide({ dir, to: m.to, toName: m.toName, subject: m.subject, body: m.body, files }) });
    } catch (e) {
      setNote(errText(e));
      return;
    }
    setMailRun({ id: o.id, label: m.label, n: 0 });
    let st: RunStatus;
    for (;;) {
      await new Promise((r) => setTimeout(r, inApp ? 2000 : 900));
      st = await api.claudeStatus(dir).catch(() => ({ state: "error", total: null, done: null, message: "", log: "" }) as RunStatus);
      setMailRun({ id: o.id, label: m.label, n: st.done ?? 0 });
      if (st.state !== "running") break;
    }
    setMailRun(null);
    if (st.state === "done") {
      const at = `${todayStr()} ${stamp().slice(6)}`;
      try {
        putOrder(await api.orderMailed(o.id, m.to, at));
        setNote(`${m.label}을 ${m.toName || m.to} 현장대리인에게 메일로 보냈어요 · ${at.slice(11)}`);
      } catch (e) {
        setNote(errText(e));
      }
      return;
    }
    setNote(
      st.state === "login"
        ? "korea.kr 로그인이 풀려 못 보냈어요 — 크롬에서 로그인한 뒤 다시 [보내기 ▾ → 메일]을 눌러 주세요"
        : st.state === "stopped"
          ? "메일 보내기를 멈췄어요 — 크롬의 메일쓰기 탭을 확인해 주세요"
          : `메일을 못 보냈어요${st.message ? ` — ${st.message}` : ""}`,
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
      setNote(`JPG를 만들지 못했어요 — ${errText(e)}`);
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
      const action = JSON.stringify([{ t: actionLine(w?.name ?? "", r.order.seq, c.item), k: "sq" }]);
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
      r = await api.makeOrder({ ...req, root: ps.root, date: today, tpl: ps.tpl });
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
          (r.missing.length ? ` · 양식에 없는 자리 ${r.missing.join(" ")}` : ""),
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

  /** 접수번호 누르기: 신문고는 민원마다 바로 열리는 주소가 없어서(주소에 번호가 없어요), 신문고를 열고 번호를 복사해 둬요. */
  async function openCase(no: string) {
    try {
      await navigator.clipboard.writeText(no);
    } catch {
      /* 복사가 막혀도 신문고는 열어요 */
    }
    try {
      if (inApp) await api.openPortal(PORTAL_URL);
      else window.open(PORTAL_URL, "_blank");
      setNote(`접수번호를 복사했어요(${no}) · 신문고 검색 칸에 붙여 넣으세요`);
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
    setChosen((l) => l.filter((n) => n !== c.no));
    // 지시부에 든 건이면 그 지시부에서 빠지고(남은 건으로 다시 만들어요), 새 공사로 다시 골라 만들어요.
    await patch(c.no, { work: id });
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
    if (!pick && !ask) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && (setPick(null), setAsk(null));
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pick, ask]);

  // 목록 안쪽 폭과 스크롤 막대 폭을 재요(창 크기·줄 수가 바뀌면 다시).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      setAvail(el.clientWidth);
      setGutter(el.offsetWidth - el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [works === null, rows.length]);

  if (!works) {
    return (
      <>
        <h1 className="title">국민신문고 민원 불러오기</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  const pickCase = pick && cases.find((c) => c.no === pick.no);
  // 고른 줄의 공사(같은 공사만 함께 골라요)와 새 지시부 이름
  const chosenWork = chosen.length ? works.find((w) => w.id === cases.find((c) => c.no === chosen[0])?.work) : undefined;
  const canChoose = (c: Case) => c.work != null && c.order == null && !isDone(c) && (!chosenWork || c.work === chosenWork.id);
  const toggle = (c: Case) => setChosen((l) => (l.includes(c.no) ? l.filter((n) => n !== c.no) : canChoose(c) ? [...l, c.no] : l));
  const total = cases.filter((c) => !isDone(c)).length;
  const shownWidths = fitWidths(widths, avail);
  const tableStyle = { "--pr-cols": gridTemplate(shownWidths), "--pr-gutter": `${gutter}px` } as CSSProperties;

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
        <button type="button" className="btn-primary btn-ctrl pr-fetch" title="Claude가 크롬으로 신문고 민원처리목록을 읽어 기록에 없는 민원을 가져와요" onClick={fetchCases} disabled={!!run}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 10l5 5 5-5M4 19h16" />
          </svg>
          {run ? "불러오는 중…" : "민원 불러오기"}
        </button>
        <button type="button" className="btn btn-ctrl btn-text tb-pop pr-push" onClick={() => setWorksOpen(true)}>
          공사 관리
        </button>
        <label className="search">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" aria-label="민원처리 검색" placeholder="접수번호, 위치, 내용 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
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
          <span className="pr-sub">Claude가 크롬 korea.kr 탭에서 하고 있어요 — 그 탭은 건드리지 말아 주세요</span>
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
          <span
            className="pr-work"
            style={{ "--wc": `var(--pj-${workColor(chosenWork, cd)}-line)`, "--wf": `var(--pj-${workColor(chosenWork, cd)}-fg)` } as CSSProperties}
          >
            {chosenWork.name}
          </span>
          <span>
            <b>{chosen.length}건</b> 골랐어요 · 지시부 <b>{chosenWork.name}-{String(chosenWork.nextSeq).padStart(2, "0")}</b> 으로 묶어요
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
        <HeadRow widths={shownWidths} avail={avail} onResize={setWidths} onResized={saveWidths} onReset={() => saveWidths(defaultWidths())} />
        <div className="pr-body" ref={bodyRef}>
          {rows.length === 0 && (
            <p className="pr-empty">{cases.length === 0 ? "[민원 불러오기]를 누르면 Claude가 신문고에서 기록에 없는 민원을 가져와요." : q ? "찾는 민원이 없어요." : "처리할 민원이 없어요."}</p>
          )}
          {rows.map((c) => {
            const w = works.find((x) => x.id === c.work);
            const isD = isDone(c);
            const left = c.due ? daysBetween(today, c.due) : null;
            const k = workColor(w, cd);
            const asking = ask?.no === c.no;
            const o = orderOf(c);
            const ow = o ? works.find((x) => x.id === o.work) : undefined;
            const b = o ? busy[o.id] : undefined;
            const picked = chosen.includes(c.no);
            return (
              <div
                key={c.no}
                className="pr-row"
                role="row"
                data-sel={sel === c.no || asking || picked ? "1" : undefined}
                data-done={isD ? "1" : undefined}
                onClick={() => setSel(sel === c.no ? null : c.no)}
                onDoubleClick={() => c.complaint != null && onOpenComplaint(c.complaint)}
              >
                <div className="pr-check" onClick={(e) => e.stopPropagation()}>
                  {c.order == null && (
                    <input
                      type="checkbox"
                      aria-label={`${c.no} 고르기`}
                      checked={picked}
                      disabled={!picked && !canChoose(c)}
                      title={c.work == null ? "먼저 공사를 골라요" : !picked && !canChoose(c) ? "같은 공사만 함께 고를 수 있어요" : "지시부로 묶을 민원 고르기"}
                      onChange={() => toggle(c)}
                    />
                  )}
                </div>
                <div className="pr-no">
                  <button
                    type="button"
                    className="pr-no-link"
                    title="신문고를 열고 접수번호를 복사해요. 신문고 검색 칸에 붙여 넣으세요(Ctrl+V)"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCase(c.no);
                    }}
                  >
                    {c.no}
                  </button>
                </div>
                <div className="pr-date">{md(c.received)}</div>
                <div className="pr-date pr-due">
                  <span>{md(c.due)}</span>
                  {!isD && left !== null && (
                    <span className={"pr-d" + (left <= urgentDays ? " urgent" : left <= urgentDays + 1 ? " soon" : "")}>
                      {left > 0 ? `D-${left}` : left === 0 ? "D-day" : `D+${-left}`}
                    </span>
                  )}
                </div>
                <PlaceCell c={c} disabled={isD || !!b} onSave={(a, p, r) => saveAddress(c, a, p, r)} />
                <div className="pr-sum">
                  <span>{c.summary}</span>
                  <span className="pr-sub">
                    {c.reason}
                    {c.road && <span className="pr-road">원래 주소 {c.road}</span>}
                  </span>
                </div>
                <div>
                  <button
                    type="button"
                    className={"pr-work" + (w ? "" : " none")}
                    style={w ? ({ "--wc": `var(--pj-${k}-line)`, "--wf": `var(--pj-${k}-fg)` } as CSSProperties) : undefined}
                    disabled={isD || !!b}
                    title={isD ? undefined : c.order == null ? "눌러서 공사 고르기" : "공사를 바꾸면 이 지시부에서 빠져요(남은 건으로 다시 만들어요)"}
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
                <div className="pr-acts" onClick={(e) => e.stopPropagation()}>
                  {/* 지시부 이름 · 진행 · 지시부 열람 · 폴더 열기 · 대장 등록 · × (2026-10-19 표준 지시부) */}
                  {o ? (
                    <span className="pr-chip" title={`${fileName(o.file)} · ${c.item}번째 항목`}>
                      {orderLabel(ow?.name ?? "", o.seq, c.item)}
                    </span>
                  ) : (
                    <span className="pr-chip none">—</span>
                  )}
                  {!o ? (
                    <span className="pr-next-gap" />
                  ) : b ? (
                    <button type="button" className="pr-next go" disabled>
                      {b}
                    </button>
                  ) : o.dirty ? (
                    <button type="button" className="pr-next go" disabled={isD} title="든 민원을 고쳤어요. 같은 연번·같은 파일로 다시 만들어요" onClick={() => remakeOrder(o.id)}>
                      다시 만들기
                    </button>
                  ) : mailRun?.id === o.id ? (
                    <span className="pr-sent pr-queued" title="Claude가 korea.kr 메일로 보내고 있어요">
                      <MailIcon />
                      보내는 중
                    </span>
                  ) : o.stage === "made" ? (
                    <button
                      type="button"
                      className={o.mailedAt ? "pr-sent pr-sent-btn" : "pr-next go pr-send"}
                      disabled={isD}
                      aria-haspopup="menu"
                      aria-expanded={sendMenu?.id === o.id}
                      title={o.mailedAt ? `메일 보냄 · ${o.mailedAt.slice(5)} · ${o.mailTo}\n눌러서 다시 보내기` : "메일(현장대리인) 또는 폰으로 보내요"}
                      onClick={(e) => {
                        setPick(null);
                        setAsk(null);
                        setSendMenu(sendMenu?.id === o.id ? null : { id: o.id, rect: e.currentTarget.getBoundingClientRect() });
                      }}
                    >
                      {o.mailedAt ? (
                        <>
                          <CheckIcon />
                          메일 보냄
                        </>
                      ) : (
                        <>
                          보내기<span className="pr-caret" aria-hidden="true">▾</span>
                        </>
                      )}
                    </button>
                  ) : o.stage === "queued" ? (
                    <span className="pr-sent pr-queued" title="보낼 폴더에 있어요. Claude 앱 “민원처리” 대화에 “보내”라고 하면 내 폰으로 올려 주고 전송 완료로 바뀌어요">
                      <PhoneIcon />
                      보내는 중
                    </span>
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
                    title={o?.file ? `${fileName(o.file)}\n한글로 열어요` : "아직 지시부가 없어요"}
                    disabled={!o?.file}
                    onClick={() => o && openFile(o.file)}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                      const f = o?.file || c.photos[0] || c.map;
                      openFile(f || c.folder || ps.root, !!f);
                    }}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={"pr-icon pr-reg" + (linked(c) ? " on" : "")}
                    aria-label={linked(c) ? `민원대장 ${linked(c)!.no}번 보기` : "민원대장에 등록"}
                    title={linked(c) ? `민원대장 ${linked(c)!.no}번 · 눌러서 그 줄로 가요` : "민원대장에 등록해요(지시부 없이도 돼요. 지시부를 만들면 조치내용이 채워져요)"}
                    onClick={() => register(c)}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="miter">
                      <path d={linked(c) ? "M3 4h18v16H3z M3 9h18 M3 14.5h18 M9 9v11" : "M3 4h18v7 M3 4v16h9 M3 9h18 M9 9v11 M18 14v8 M14 18h8"} />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className={"pr-del" + (asking ? " on" : "")}
                    aria-label="이 민원 지우기"
                    aria-expanded={asking}
                    title={c.order != null ? "지시부를 만들 건이 아니면 지워요(이 지시부에서도 빠져요)" : "지시부를 만들 건이 아니면 지워요"}
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
            {noteLog && (
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

      {sendMenu &&
        (() => {
          const o = orders.find((x) => x.id === sendMenu.id);
          if (!o) return null;
          const r = recipientOf(o);
          const why = !r.work?.contact ? "공사 관리에서 현장대리인을 골라 주세요" : !r.email ? "현장대리인 메일 주소가 없어요 — 업무연락처에서 넣어 주세요" : run || mailRun ? "Claude가 다른 일을 하고 있어요" : "";
          return (
            <Floating rect={sendMenu.rect} align="left" onClose={() => setSendMenu(null)}>
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

// ---------- 열 제목 줄 (끌어서 열 너비, 우클릭 열 너비 초기화 — 민원대장과 같아요) ----------

function HeadRow({
  widths,
  avail,
  onResize,
  onResized,
  onReset,
}: {
  widths: (number | null)[];
  avail: number;
  onResize: (w: (number | null)[]) => void;
  onResized: (w: (number | null)[]) => void;
  onReset: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<DOMRect | null>(null);

  function start(e: ReactMouseEvent, i: number) {
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    const base = widths.map((w, j) => w ?? (row.children[j] as HTMLElement).getBoundingClientRect().width);
    const startX = e.clientX;
    const max = avail > 0 ? maxWidthOf(widths, i, avail, base) : Infinity;
    let last = widths;
    const move = (ev: MouseEvent) => {
      const next = widths.slice();
      next[i] = Math.min(max, Math.max(COL_MIN, Math.round(base[i] + ev.clientX - startX)));
      last = next;
      onResize(next);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("col-dragging");
      if (last !== widths) onResized(last);
    };
    document.body.classList.add("col-dragging");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  return (
    <div
      className="pr-row pr-headrow"
      role="row"
      ref={rowRef}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(new DOMRect(e.clientX, e.clientY, 0, 0));
      }}
    >
      {COLUMNS.map((col, i) => (
        <div role="columnheader" key={col.label} className={col.center ? "pr-c" : undefined}>
          {col.label}
          {/* 남는 폭을 쓰는 열(민원 요약)은 끌지 않아요 — 옆 열을 끌면 따라 바뀌어요. */}
          {i < COLUMNS.length - 1 && col.w !== null && !col.fixed && <span className="cm-grip" aria-hidden="true" title="끌어서 열 너비 바꾸기" onMouseDown={(e) => start(e, i)} />}
        </div>
      ))}
      {menu && (
        <Floating rect={menu} align="left" onClose={() => setMenu(null)}>
          <div className="dmenu pr-hmenu" role="menu" aria-label="열 제목 메뉴">
            <button
              type="button"
              role="menuitem"
              className="dmenu-item"
              onClick={() => {
                setMenu(null);
                onReset();
              }}
            >
              열 너비 초기화
            </button>
          </div>
        </Floating>
      )}
    </div>
  );
}

// ---------- 위치 칸: 그 자리에서 고쳐요(법정리·동 + 지번, 리·동을 고르면 지역이 채워져요 — 민원대장 위치 칸과 같은 부품) ----------

function PlaceCell({ c, disabled, onSave }: { c: Case; disabled: boolean; onSave: (area: string, place: string, road: string) => void }) {
  const start = c.place === UNKNOWN ? "" : c.place;
  const [place, setPlace] = useState(start);
  const [area, setArea] = useState(c.area);
  const [road, setRoad] = useState(c.road);
  const now = useRef({ place, area, road });
  now.current = { place, area, road };
  useEffect(() => {
    setPlace(c.place === UNKNOWN ? "" : c.place);
    setArea(c.area);
    setRoad(c.road);
  }, [c.place, c.area, c.road]);

  const [editing, setEditing] = useState(false);
  if (disabled || !editing) {
    return (
      <div
        className="pr-place"
        title={disabled ? undefined : "두 번 누르면 주소를 고쳐요"}
        onDoubleClick={(e) => {
          if (disabled) return;
          e.stopPropagation();
          setEditing(true);
        }}
      >
        <span className="pr-sub">{c.area || "\u00a0"}</span>
        <span className={c.place === UNKNOWN ? "pr-unknown" : undefined} title={c.road || undefined}>
          {c.place}
        </span>
      </div>
    );
  }

  const revert = () => {
    setPlace(start);
    setArea(c.area);
    setRoad(c.road);
  };

  return (
    <div
      className="pr-place pr-place-edit"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.nativeEvent.isComposing) return;
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "Escape") {
          revert();
          now.current = { place: start, area: c.area, road: c.road };
          setEditing(false);
          (e.target as HTMLElement).blur();
        }
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setEditing(false);
        // 위치 칸이 떠날 때 지역을 맞춘 뒤(같은 순간) 저장해요.
        window.setTimeout(() => {
          const { place: p, area: a, road: r } = now.current;
          const np = p.trim();
          // 지역은 위치를 따라 바뀌어요. 위치를 그대로 두고 떠나면 저장하지 않아요.
          if (np !== start) onSave(a, np, r);
        }, 0);
      }}
    >
      <span className="pr-sub">{area || "\u00a0"}</span>
      <PlaceInput value={place} area={area} road={road} onChange={setPlace} onArea={setArea} onRoad={setRoad} placeholder={UNKNOWN} className={place.trim() ? undefined : "pr-unknown-in"} autoFocus />
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
  // 화면 맨 위(body)에 띄워요 — 가운데 뜨는 창(.overlay) 안에 두면 창 자리 맞추기(snap.ts)가 이 상자까지 옮겨 화면 밖으로 밀려났어요(2026-10-19 공사 지우기 버그).
  return createPortal(
    <div ref={ref} className="pr-float" style={pos} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

// ---------- 공사 관리 창 ----------

type Draft = { name: string; full: string; project: number | null; co: string; contact: number | null; agent: string; phone: string; scope: string; nextSeq: string };
const EMPTY_DRAFT: Draft = { name: "", full: "", project: null, co: "", contact: null, agent: "", phone: "", scope: "", nextSeq: "1" };

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

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && editing == null && onClose()}>
      <div className="dialog pr-works" role="dialog" aria-modal="true" aria-label="공사 관리">
        <div className="dialog-head pr-works-head">
          <span className="dialog-title">공사 관리</span>
          <span className="pr-sub">계약된 공사와 시공사예요. 민원을 어느 공사로 보낼지 여기 처리 범위를 보고 판단해요.</span>
        </div>
        <div className="pr-wgrid pr-whead">
          <span>공사명 (지시부 · 업무연락처에서 고르기)</span>
          <span>축약 공사명 (표·파일)</span>
          <span>시공사</span>
          <span>현장대리인 (업무연락처)</span>
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
                  <input className="cell-input" aria-label="시공사" value={edit.co} onChange={(e) => setEdit({ ...edit, co: e.target.value })} />
                  <AgentInputs d={edit} contacts={cd.contacts} onChange={setEdit} />
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
                <span className="pr-ell">{w.full && w.full !== w.name ? w.name : <span className="pr-sub">—</span>}</span>
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
                <span className="pr-num">{String(w.nextSeq).padStart(2, "0")}</span>
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
            <ProjectPick d={draft} cd={cd} onChange={setDraft} placeholder="업무연락처 프로젝트 찾기" />
            <input className="cell-input" placeholder="예: 동부권 도로시설물 1지구" aria-label="새 축약 공사명" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="cell-input" placeholder="시공사" aria-label="새 시공사" value={draft.co} onChange={(e) => setDraft({ ...draft, co: e.target.value })} />
            <AgentInputs d={draft} contacts={cd.contacts} onChange={setDraft} />
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
          <span>공사명 칸에 치면 업무연락처 프로젝트가 떠요. 고르면 축약 공사명·시공사·현장대리인을 업무연락처에서 채워요(목록에 없으면 새 프로젝트로 등록돼요). 현장대리인은 업무연락처와 같은 연락처예요(어느 쪽에서 고쳐도 함께 바뀌어요). 줄을 두 번 누르면 고치고 [저장]·Enter로 저장해요(Esc 취소).</span>
          <span>지시부는 모든 공사가 표준 양식 하나를 써요(설정 “민원처리”). 정식 공사명은 지시부 맨 위, 축약 공사명은 표의 공사 배지·지시부 번호·파일 이름에 들어가요.</span>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-ctrl btn-text" onClick={() => (editing != null ? saveEdit().then(onClose) : onClose())}>
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
          <div className="pr-menu pr-cmenu pr-pmenu" role="listbox" aria-label="업무연락처 프로젝트">
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
                ＋ "{q}" 새 프로젝트로 추가
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

// ---------- 지시부 메일 (2026-10-20) ----------

type MailDraft = { id: number; to: string; toName: string; org: string; subject: string; body: string; label: string };

const MAIL_STEPS = ["메일쓰기 여는 중", "받는 사람·제목·본문 채우는 중", "첨부 붙이는 중", "보내고 보낸 메일함 확인하는 중"];

function MailIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18v14H3z M3 6l9 7 9-7" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h10v18H7z M11 18h2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/** 메일로 보낼까요? — 받는 사람·제목·본문(고칠 수 있어요)·첨부. [보내기]를 누르면 Claude가 korea.kr에서 보내기까지 해요(사용자 2안). */
function MailDialog({ draft, files, from, onChange, onSend, onClose }: { draft: MailDraft; files: string[]; from: string; onChange: (d: MailDraft) => void; onSend: () => void; onClose: () => void }) {
  const subjectRef = useRef<HTMLInputElement>(null);
  useEffect(() => subjectRef.current?.focus(), []);
  const ok = draft.subject.trim() !== "" && draft.to !== "";
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
