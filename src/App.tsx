import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, DEFAULT_PREFS, errorText, inApp, Prefs, Reminder, Status } from "./api";
import { measureBullets } from "./bullets";
import CalendarScreen, { EventFocus } from "./CalendarScreen";
import ComplaintsScreen from "./ComplaintsScreen";
import ContactsScreen from "./ContactsScreen";
import Gate from "./Gate";
import Logo from "./Logo";
import { VERSION } from "./version";
import JournalScreen from "./JournalScreen";
import SettingsScreen from "./SettingsScreen";
import TasksScreen from "./TasksScreen";
import { applyNotifyMode, refreshHolidaysDaily, syncReminders } from "./reminders";
import { startGoogleSync } from "./google";
import { SCREENS, SETTINGS, ScreenId } from "./screens";



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
  // 업무일지 "챙길 일"에서 누른 할 일. 할 일 목록이 그 항목으로 가면 비워요.
  const [focusTask, setFocusTask] = useState<number | null>(null);
  const clearTask = useCallback(() => setFocusTask(null), []);
  const openTask = useCallback((id: number) => {
    setFocusTask(id);
    setCurrent("todo");
  }, []);

  // 일정 알림을 누르면 캘린더의 그 일정을 열어요. 캘린더가 열면 비워요.
  const [focusEvent, setFocusEvent] = useState<EventFocus | null>(null);
  const clearEvent = useCallback(() => setFocusEvent(null), []);
  useEffect(() => {
    if (!inApp) return;
    const off = listen<Reminder>("reminder-open", (e) => {
      setFocusEvent({ event: e.payload.event, date: e.payload.date });
      setCurrent("calendar");
    });
    return () => {
      off.then((f) => f());
    };
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

  // 열려 있는 동안: 일정 알림 목록을 앱에 보내고(30분마다 다시), 공휴일을 하루에 한 번 받아요.
  useEffect(() => {
    if (!unlocked) return;
    applyNotifyMode();
    syncReminders();
    refreshHolidaysDaily();
    startGoogleSync();
    const t = window.setInterval(() => {
      syncReminders();
      refreshHolidaysDaily();
    }, 30 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [unlocked]);
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
        <div className="brand">
          <Logo height={28} variant="word" />
        </div>
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
          <JournalScreen urgentDays={prefs.urgentDays} onOpenComplaint={openComplaint} onOpenTask={openTask} />
        ) : current === "complaints" ? (
          <ComplaintsScreen urgentDays={prefs.urgentDays} focusId={focusComplaint} onFocused={clearFocus} />
        ) : current === "calendar" ? (
          <CalendarScreen focus={focusEvent} onFocused={clearEvent} onOpenComplaint={openComplaint} onOpenTask={openTask} />
        ) : current === "todo" ? (
          <TasksScreen urgentDays={prefs.urgentDays} focusId={focusTask} onFocused={clearTask} onOpenComplaint={openComplaint} />
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
