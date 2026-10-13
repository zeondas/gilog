import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, Status } from "./api";
import Gate from "./Gate";

// 화면 목록. 순서는 사양서의 사이드바 순서와 같아요.
const SCREENS = [
  { id: "journal", name: "업무일지", step: 5 },
  { id: "complaints", name: "민원대장", step: 6 },
  { id: "contacts", name: "업무연락처", step: 4 },
  { id: "calendar", name: "캘린더", step: 8 },
  { id: "todo", name: "할 일 목록", step: 7 },
] as const;

const SETTINGS = { id: "settings", name: "설정", step: 3 } as const;

type ScreenId = (typeof SCREENS)[number]["id"] | typeof SETTINGS.id;

const VERSION = "0.2.0";

// 입력이 없으면 잠그기까지 걸리는 시간이에요. 3단계에서 설정으로 옮겨요.
const AUTO_LOCK_MS = 10 * 60 * 1000;

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [fatal, setFatal] = useState("");
  const [current, setCurrent] = useState<ScreenId>("journal");

  const refresh = useCallback(() => {
    api.status().then(setStatus, (e) => setFatal(errorText(e)));
  }, []);

  useEffect(refresh, [refresh]);

  const lockNow = useCallback(() => {
    api.lock().then(refresh, refresh);
  }, [refresh]);

  // 자동 잠금: 마우스나 키보드 입력이 없으면 잠가요.
  const unlocked = status?.unlocked ?? false;
  useEffect(() => {
    if (!unlocked) return;
    let timer = window.setTimeout(lockNow, AUTO_LOCK_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lockNow, AUTO_LOCK_MS);
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [unlocked, lockNow]);

  if (fatal) return <div className="gate"><p className="gate-error">{fatal}</p></div>;
  if (!status) return <div className="gate" />;
  if (!status.unlocked) {
    return <Gate mode={status.exists ? "unlock" : "setup"} folder={status.folder} onOpen={refresh} />;
  }

  const screen = [...SCREENS, SETTINGS].find((s) => s.id === current)!;

  return (
    <div className="shell">
      <nav className="side" aria-label="모듈">
        <div className="brand">giLog</div>
        <div className="side-list">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="side-item"
              aria-current={current === s.id ? "page" : undefined}
              onClick={() => setCurrent(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <div className="side-list side-bottom">
          <button type="button" className="side-item" onClick={lockNow}>
            잠그기
          </button>
          <button
            type="button"
            className="side-item"
            aria-current={current === SETTINGS.id ? "page" : undefined}
            onClick={() => setCurrent(SETTINGS.id)}
          >
            {SETTINGS.name}
          </button>
        </div>
      </nav>
      <main className="main">
        <h1 className="title">{screen.name}</h1>
        <section className="card">
          <div className="card-head">시험판 {VERSION}</div>
          <div className="card-body">
            <p>이 화면은 {screen.step}단계에서 만들어요.</p>
          </div>
        </section>
        {current === SETTINGS.id && (
          <>
            <SaveTest />
            <PasswordChange />
            <section className="card">
              <div className="card-head">저장 위치</div>
              <div className="card-body">
                <p>{status.folder}</p>
                <p className="muted">gilog.db 파일 하나에 암호화해서 저장해요. 10분 동안 입력이 없으면 자동으로 잠겨요.</p>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

/** 저장이 되는지 확인하는 임시 칸이에요. 3단계에서 없애요. */
function SaveTest() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    api.get("test.note").then((v) => {
      setText(v ?? "");
      loaded.current = true;
    });
  }, []);

  function save() {
    if (!loaded.current) return;
    api.set("test.note", text).then(
      () => setSaved("저장했어요."),
      (e) => setSaved(errorText(e)),
    );
  }

  return (
    <section className="card">
      <div className="card-head">저장 시험</div>
      <div className="card-body">
        <label className="field">
          <span>아무 글이나 적고 Enter를 눌러요. 앱을 껐다 켜도 남아 있어야 해요.</span>
          <input
            id="test-note"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSaved("");
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            onBlur={save}
          />
        </label>
        <p className="muted small" role="status">
          {saved}
        </p>
      </div>
    </section>
  );
}

function PasswordChange() {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setOk(false);
    if (newPw !== again) {
      setMsg("새 암호 두 개가 서로 달라요.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setAgain("");
      setOk(true);
      setMsg("암호를 바꿨어요.");
    } catch (err) {
      setMsg(err === "wrong_password" ? "지금 암호가 맞지 않아요." : errorText(err));
    }
    setBusy(false);
  }

  return (
    <section className="card">
      <div className="card-head">잠금 암호 바꾸기</div>
      <form className="card-body pw-form" onSubmit={submit}>
        <label className="field">
          <span>지금 암호</span>
          <input id="pw-old" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        </label>
        <label className="field">
          <span>새 암호</span>
          <input id="pw-new" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        </label>
        <label className="field">
          <span>새 암호 확인</span>
          <input id="pw-again" type="password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        <div className="pw-foot">
          <p className={ok ? "muted small" : "gate-error"} role="status">
            {msg}
          </p>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "바꾸는 중…" : "암호 바꾸기"}
          </button>
        </div>
      </form>
    </section>
  );
}
