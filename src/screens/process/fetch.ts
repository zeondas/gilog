// 민원처리 민원 불러오기 – Claude가 신문고를 읽어 가져올 폴더에 놓은 것을 2초마다 표에 넣고, 현장 사진을 골라요.
import { api, Case, inApp, previewInbox, RunStatus } from "../../api";
import { webLookup } from "../../addressWeb";
import { areaFor, looksRoad } from "../../address";
import { aiGuide, SAMPLES } from "../../process";
import { FETCHED_KEY, LAST_RUN_KEY, PICK_KEY, LastRun, errText, stamp } from "./parts";
import { isPath } from "./parts";
import type { useProcessCore } from "./Screen";

export function useProcessFetch(c: ReturnType<typeof useProcessCore>) {
  const { ps, setCases, run, works, setNote, setNoteLog, cases, setRun, setFetched, setLastRun, picks, setPicks } = c;

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
  return { ...c, pullInbox, fetchCases, pickSitePhotos, choosePhoto, stopFetch };
}
