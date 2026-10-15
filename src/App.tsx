import { useCallback, useEffect, useState } from "react";
import { api, DEFAULT_PREFS, errorText, Prefs, Status } from "./api";
import { measureBullets } from "./bullets";
import ComplaintsScreen from "./ComplaintsScreen";
import ContactsScreen from "./ContactsScreen";
import Gate from "./Gate";
import JournalScreen from "./JournalScreen";
import SettingsScreen from "./SettingsScreen";
import { SCREENS, SETTINGS, ScreenId } from "./screens";

const VERSION = "0.6.2";

export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [status, setStatus] = useState<Status | null>(null);
  const [fatal, setFatal] = useState("");
  const [current, setCurrent] = useState<ScreenId | null>(null);
  // 업무일지 "챙길 일"에서 누른 민원. 민원대장이 그 줄로 가면 비워요.
  const [focusComplaint, setFocusComplaint] = useState<number | null>(null);
  const clearFocus = useCallback(() => setFocusComplaint(null), []);
  const openComplaint = useCallback((id: number) => {
    setFocusComplaint(id);
    setCurrent("complaints");
  }, []);

  const refresh = useCallback(() => {
    api.status().then(setStatus, (e) => setFatal(errorText(e)));
  }, []);

  // 처음 켤 때: 설정을 읽고, 암호 묻기가 꺼져 있으면 바로 열어요.
  useEffect(() => {
    (async () => {
      try {
        const p = await api.getPrefs();
        setPrefs(p);
        setCurrent(p.startScreen as ScreenId);
        const st = await api.status();
        if (st.exists && !st.unlocked) await api.autoUnlock();
      } catch (e) {
        setFatal(errorText(e));
      }
      refresh();
    })();
  }, [refresh]);

  // 테마와 글자 크기를 화면 전체에 적용해요.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
    root.style.setProperty("--fs", prefs.fontSize + "px");
    // 머릿기호를 한글 글자 정중앙에, 들여쓰기를 띄어쓰기 두 칸에 맞추려고 그 PC 글꼴로 재요(글꼴을 다 읽은 뒤 한 번 더).
    measureBullets(prefs.fontSize);
    document.fonts?.ready.then(() => measureBullets(prefs.fontSize));
  }, [prefs.theme, prefs.fontSize]);

  const savePrefs = useCallback(async (p: Prefs) => {
    await api.setPrefs(p);
    setPrefs(await api.getPrefs());
  }, []);

  const lockNow = useCallback(() => {
    api.lock().then(refresh, refresh);
  }, [refresh]);

  // 자동 잠금: 마우스나 키보드 입력이 없으면 잠가요.
  const unlocked = status?.unlocked ?? false;
  useEffect(() => {
    if (!unlocked || !prefs.autoLock) return;
    const ms = prefs.autoLockMin * 60 * 1000;
    let timer = window.setTimeout(lockNow, ms);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lockNow, ms);
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [unlocked, prefs.autoLock, prefs.autoLockMin, lockNow]);

  if (fatal) return <div className="gate"><p className="gate-error">{fatal}</p></div>;
  if (!status || current === null) return <div className="gate" />;
  if (!status.unlocked) {
    return <Gate mode={status.exists ? "unlock" : "setup"} folder={status.folder} onOpen={refresh} />;
  }

  const screen = [...SCREENS, SETTINGS].find((s) => s.id === current) ?? SCREENS[0];

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
        {current === SETTINGS.id ? (
          <SettingsScreen prefs={prefs} onPrefs={savePrefs} status={status} onLocked={refresh} />
        ) : current === "contacts" ? (
          <ContactsScreen />
        ) : current === "journal" ? (
          <JournalScreen urgentDays={prefs.urgentDays} onOpenComplaint={openComplaint} />
        ) : current === "complaints" ? (
          <ComplaintsScreen urgentDays={prefs.urgentDays} focusId={focusComplaint} onFocused={clearFocus} />
        ) : (
          <>
            <h1 className="title">{screen.name}</h1>
            <section className="card">
              <div className="card-head">시험판 {VERSION}</div>
              <div className="card-body">
                <p>이 화면은 {screen.step}단계에서 만들어요.</p>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
