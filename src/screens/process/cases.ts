// 민원처리 민원 줄·지시부 다루기 – 줄 고치기, 민원대장 넣기·완료·되돌리기, 주소 저장, 찾기·완료 보기 목록,
// 지시부 메일(korea.kr)·지시부·JPG 만들기·폰으로 보내기, 파일 열기·번호 복사·지우기. 줄 고치기와 지시부 다시 만들기가 서로 불러서 한 묶음이에요.
import { useMemo } from "react";
import { api, Case, Complaint, inApp, Order, OrderResult, RunStatus } from "../../api";
import { plainOf } from "../../bullets";
import { koIndex, todayStr } from "../../journal";
import { actionLine, isHiddenStatus, mailDraft, mailGuide, orderTag } from "../../process";
import { DONE_STATUS, isClosed } from "../../settingsStore";
import { NA_WORK, errText, stamp, shortNo } from "./parts";
import { MailDraft } from "./parts";
import type { useProcessFetch } from "./fetch";

export function useProcessCases(c: ReturnType<typeof useProcessFetch>) {
  const { setCases, setOrders, orders, cases, setNote, complaints, onOpenComplaint, setComplaints, setPrevStatus, setSel, prevStatus, q, showDone, works, cd, setSendMenu, ps, setMailAsk, run, mailRun, setNoteLog, setMailRun, setBusy, busy, today, setWorks, chosen, setChosen, pick, setPick, setNaAsk, setAsk } = c;

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
  // 띠 아래로 숨기는 줄: 답변·완료·불가(✔2 1안) – 흐리게·고치기 막기는 isDone(완료·불가)만
  const isHidden = (c: Case) => {
    if (c.complaint == null) return false;
    const m = complaints.find((x) => x.id === c.complaint);
    return !!m && isHiddenStatus(m.status);
  };

  const found = useMemo(() => {
    const s = q.trim();
    if (!s) return cases;
    return cases.filter((c) => [c.no, c.area, c.place, c.summary, c.reason, plainOf(c.note)].some((t) => koIndex(t, s) >= 0));
  }, [cases, q]);
  // 줄 목록은 찾기 결과·완료 보기가 바뀔 때만 새로 만들어요 – 글자 폭 재기(아래 useLayoutEffect)가 줄 목록이 바뀔 때만 돌게(cols 최적화 1).
  const { open, done } = useMemo(() => ({ open: found.filter((c) => !isHidden(c)), done: found.filter((c) => isHidden(c)) }), [found, complaints]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => (showDone ? [...open, ...done] : open), [showDone, open, done]);

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
  return { ...c, putCase, putOrder, orderOf, patch, linked, complaintOf, register, addToLedger, moveDone, undoDone, clearAction, saveAddress, isDone, isHidden, found, open, done, rows, recipientOf, openMail, mailOrder, setBusyOf, makeJpg, writeComplaints, runOrder, makeOrder, remakeOrder, send, copyNo, openFile, changeWork, remove };
}
