// 앱을 처음 켰을 때 암호를 정하는 화면과, 잠긴 앱을 여는 화면이에요.
import { FormEvent, useState } from "react";
import { api, errorText } from "./api";
import Logo, { AppIcon } from "./Logo";

type Props = { mode: "setup" | "unlock"; folder: string; onOpen: () => void };

export default function Gate({ mode, folder, onOpen }: Props) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setup = mode === "setup";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (setup && password !== again) {
      setError("두 암호가 서로 달라요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (setup) await api.create(password);
      else await api.unlock(password);
      onOpen();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="card gate-card" onSubmit={submit}>
        <div className="gate-brand">
          <AppIcon size={64} />
          <Logo height={23} variant="word" />
        </div>
        <div className="card-body gate-body">
          <p className="gate-lead">{setup ? "잠금 암호를 정해 주세요." : "잠금 암호를 넣어 주세요."}</p>
          <label className="field">
            <span>암호</span>
            <input
              id="gate-password"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {setup && (
            <label className="field">
              <span>암호 확인</span>
              <input id="gate-again" type="password" value={again} onChange={(e) => setAgain(e.target.value)} />
            </label>
          )}
          <p className="gate-error" role="alert">
            {error}
          </p>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "여는 중…" : setup ? "시작하기" : "열기"}
          </button>
          {setup && (
            <p className="muted small">
              암호는 4자 이상이에요. 잊으면 자료를 되찾을 방법이 없어요. 자료는 {folder} 폴더에 암호화해서 저장해요.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
