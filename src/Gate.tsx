// 앱을 처음 켰을 때 비밀번호를 정하는 화면과, 잠긴 앱을 여는 화면이에요.
// 배치(2026-10-18 사용자 확정, 캔버스 Lock 판): 로고 → 44px → 비밀번호 칸(가운데 글자) → 12px → 열기 → "PIN으로 풀기".
// 경고는 카드 밖 아래 띠로 띄워 카드와 단추가 움직이지 않아요.
// 윈도우 PIN 풀기를 켠 PC에서는 잠금 화면이 뜨면 Hello 창이 저절로 떠요(앱을 켤 때·자동 잠금 뒤 모두 – 2026-10-18 사용자).
// 창이 앞에 있을 때만 띄우고(트레이에 숨어 있거나 다른 창을 보고 있으면 돌아왔을 때), 한 번만 띄워요.
// 취소·실패하면 비밀번호 칸으로 돌아오고, 아래 "PIN으로 풀기"로 다시 띄워요. 꺼진 PC는 비밀번호 칸만이에요.
// 자료 파일이 손상됐으면(2026-10-29 자료 안전 ✔3 1안) 띠 안에 "○월 ○일 백업으로 되살리기" 단추와 "다른 백업 고르기" –
// 방금 친 비밀번호로 그 백업을 열어 보고 맞으면 바꿔 넣고 바로 열려요(손상된 파일은 옆에 남겨요).
import { FormEvent, useEffect, useState } from "react";
import { api, BackupInfo, errorText, inApp } from "./api";
import Logo, { AppIcon } from "./Logo";

type Props = { mode: "setup" | "unlock"; folder: string; onOpen: () => void };
/** 띠 모양: 잘못(붉은 띠, 칸 테두리도 붉게) · 알림(회색 띠 – PIN 취소처럼 잘못이 아닌 것) */
type Note = { text: string; tone: "error" | "info"; field?: boolean } | null;

/** "2026-10-28" → "10월 28일" */
function dayLabel(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${m}월 ${day}일`;
}

export default function Gate({ mode, folder, onOpen }: Props) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [pinOn, setPinOn] = useState(false);
  // 손상 안내 띠(null이면 보통 띠). msg는 되살리기가 안 됐을 때 띠 안 두 번째 줄.
  const [corrupt, setCorrupt] = useState<{ info: BackupInfo | null; msg: string } | null>(null);
  const setup = mode === "setup";

  async function showCorrupt() {
    setNote(null);
    const info = await api.backupInfo().catch(() => null);
    setCorrupt({ info, msg: "" });
  }

  async function restore(path: string) {
    if (busy) return;
    if (!password) {
      setCorrupt((c) => c && { ...c, msg: "비밀번호를 넣고 눌러 주세요." });
      document.getElementById("gate-password")?.focus();
      return;
    }
    setBusy(true);
    try {
      await api.restoreAndOpen(path, password);
      onOpen();
      return;
    } catch (err) {
      const msg = err === "wrong_password" ? "이 백업은 다른 비밀번호로 잠겨 있어요.\n그때 비밀번호를 넣고 다시 눌러 주세요." : errorText(err);
      setCorrupt((c) => c && { ...c, msg });
    }
    setBusy(false);
  }

  async function pickBackup() {
    if (!inApp) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ title: "되살릴 백업 파일", defaultPath: corrupt?.info?.folder, filters: [{ name: "기록 백업", extensions: ["gilogbak"] }] });
    if (typeof r === "string") restore(r);
  }

  useEffect(() => {
    if (setup) return;
    let alive = true;
    let timer = 0;
    const fire = () => {
      window.removeEventListener("focus", onFocus);
      // 창이 막 보이는 참이라 조금 기다렸다 띄워요(Hello 창이 기록 창 위에 뜨게).
      timer = window.setTimeout(() => alive && pinUnlock(), 250);
    };
    const onFocus = () => fire();
    api.pinStatus().then(
      (s) => {
        if (!alive) return;
        setPinOn(s.on);
        if (!s.on) return;
        if (document.hasFocus() && document.visibilityState === "visible") fire();
        else window.addEventListener("focus", onFocus);
      },
      () => setPinOn(false),
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      setNote({ text: "비밀번호를 넣어 주세요.", tone: "error", field: true });
      return;
    }
    if (setup && password !== again) {
      setNote({ text: "두 비밀번호가 서로 달라요.", tone: "error", field: true });
      return;
    }
    setBusy(true);
    setNote(null);
    setCorrupt(null);
    try {
      if (setup) await api.create(password);
      else await api.unlock(password);
      onOpen();
    } catch (err) {
      if (err === "corrupt") await showCorrupt();
      else setNote({ text: errorText(err), tone: "error", field: err === "wrong_password" || err === "password_too_short" });
      if (err === "wrong_password") setPassword("");
      setBusy(false);
    }
  }

  async function pinUnlock() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    // 비밀번호 칸에 커서가 남아 있으면 PIN 창이 떠도 키보드가 이 칸으로 가요(2026-10-20 사용자 신고) – 커서를 빼 둬요.
    (document.activeElement as HTMLElement | null)?.blur();
    try {
      await api.pinUnlock();
      onOpen();
      return;
    } catch (err) {
      if (err === "corrupt") await showCorrupt();
      else if (err === "hello_canceled") setNote({ text: "PIN 확인을 취소했어요. 비밀번호를 넣어 주세요.", tone: "info" });
      else {
        // 보관한 비밀번호가 맞지 않거나(pin_stale) 이 PC에서 더는 못 쓰면 링크를 숨겨요(자리는 그대로).
        if (err === "pin_stale" || err === "hello_unavailable") setPinOn(false);
        setNote({ text: err === "hello_unavailable" ? "이 PC에서는 윈도우 PIN을 쓸 수 없어요.\n비밀번호를 넣어 주세요." : errorText(err), tone: "error" });
      }
    }
    setBusy(false);
    document.getElementById("gate-password")?.focus();
  }

  const fieldClass = "gate-input" + (note?.field ? " bad" : "");

  return (
    <div className="gate">
      <div className="gate-wrap">
        <form className="gate-card" onSubmit={submit}>
          <div className="gate-brand">
            <AppIcon size={64} />
            <Logo height={23} variant="word" />
          </div>
          <input
            id="gate-password"
            className={fieldClass}
            type="password"
            aria-label="비밀번호"
            placeholder="비밀번호"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {setup && (
            <input
              id="gate-again"
              className={fieldClass + " gate-again"}
              type="password"
              aria-label="비밀번호 확인"
              placeholder="비밀번호 확인"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          )}
          <button type="submit" className="btn-primary gate-open" disabled={busy}>
            {busy ? "여는 중…" : setup ? "시작하기" : "열기"}
          </button>
          {setup ? (
            <p className="gate-foot muted small">
              비밀번호는 4자 이상이에요. 잊으면 자료를 되찾을 방법이 없어요. 자료는 {folder} 폴더에 암호화해서 저장해요.
            </p>
          ) : (
            <div className="gate-foot" style={{ visibility: pinOn ? "visible" : "hidden" }}>
              <button type="button" className="gate-link" onClick={pinUnlock} disabled={busy} tabIndex={pinOn ? 0 : -1}>
                PIN으로 풀기
              </button>
            </div>
          )}
        </form>
        {note && !corrupt && (
          <p className={"gate-note" + (note.tone === "info" ? " info" : "")} role="alert">
            {note.text}
          </p>
        )}
        {corrupt && (
          <div className="gate-note gate-corrupt" role="alert">
            {corrupt.info?.latest && corrupt.info.latestPath ? (
              <>
                {`자료 파일이 손상됐어요.\n${dayLabel(corrupt.info.latest)} 자동 백업으로 되살릴 수 있어요.`}
                <button type="button" className="gate-restore" onClick={() => restore(corrupt.info!.latestPath!)} disabled={busy}>
                  {dayLabel(corrupt.info.latest)} 백업으로 되살리기
                </button>
                <button type="button" className="gate-link gate-pick" onClick={pickBackup} disabled={busy}>
                  다른 백업 고르기
                </button>
              </>
            ) : (
              <>
                {"자료 파일이 손상됐어요.\n백업 파일이 있으면 골라 되살려 주세요."}
                <button type="button" className="gate-restore" onClick={pickBackup} disabled={busy}>
                  백업 파일 고르기
                </button>
              </>
            )}
            {corrupt.msg && <span className="gate-corrupt-msg">{corrupt.msg}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
