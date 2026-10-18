import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, DEFAULT_PREFS, errorText, inApp, Prefs, Reminder, Status } from "./api";
import { measureBullets } from "./bullets";
import CalendarScreen, { EventFocus } from "./CalendarScreen";
import ComplaintsScreen from "./ComplaintsScreen";
import ContactsScreen from "./ContactsScreen";
import ProcessScreen from "./ProcessScreen";
import BudgetScreen from "./BudgetScreen";
import FilesScreen from "./FilesScreen";
import Gate from "./Gate";
import Logo, { AppIcon } from "./Logo";
import { NavIcon, NavIconName } from "./Icons";
import { VERSION } from "./version";
import JournalScreen from "./JournalScreen";
import SettingsScreen from "./SettingsScreen";
import TasksScreen from "./TasksScreen";
import { applyNotifyMode, refreshHolidaysDaily, syncReminders } from "./reminders";
import { startGoogleSync } from "./google";
import { firstOn, isOn, Modules, onScreens, SCREENS, SETTINGS, ScreenId } from "./screens";
import { loadSettings } from "./settingsStore";
import { setKeyMap } from "./keys";



export default function App() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [status, setStatus] = useState<Status | null>(null);
  const [fatal, setFatal] = useState("");
  const [current, setCurrent] = useState<ScreenId | null>(null);
  // 모듈 켜고 끄기(설정 "모듈" 카드). 꺼진 모듈은 사이드바에서 빠져요.
  const [modules, setModules] = useState<Modules>({});
  const modulesRef = useRef(modules);
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
    // 앱에 넣은 Pretendard는 처음 쓰일 때 읽혀요. 다 읽은 뒤 머릿기호 위치를 다시 재요.
    document.fonts?.load(`${prefs.fontSize}px Pretendard`, "가").then(() => measureBullets(prefs.fontSize)).catch(() => {});
  }, [prefs.theme, prefs.fontSize]);

  const savePrefs = useCallback(async (p: Prefs) => {
    await api.setPrefs(p);
    setPrefs(await api.getPrefs());
  }, []);

  const lockNow = useCallback(() => {
    api.lock().then(refresh, refresh);
  }, [refresh]);

  // 사이드바 접기·펼치기(Ctrl+B). 글 칸 안의 Ctrl+B는 굵게라 건드리지 않아요.
  const toggleSide = useCallback(() => {
    void savePrefs({ ...prefsRef.current, sideCollapsed: !prefsRef.current.sideCollapsed });
  }, [savePrefs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.code !== "KeyB") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']") || t.isContentEditable)) return;
      e.preventDefault();
      toggleSide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSide]);

  // 보고 있던 화면의 모듈을 끄면 첫 켜진 화면으로 가요. 다른 화면에서 눌러 온 이동(민원·할 일 열기 등)은 막지 않아요(끄기는 메뉴 숨기기, 사용자 1안).
  const changeModules = useCallback((m: Modules) => {
    const before = modulesRef.current;
    modulesRef.current = m;
    setModules(m);
    setCurrent((c) => (c && c !== SETTINGS.id && isOn(before, c) && !isOn(m, c) ? firstOn(m) : c));
  }, []);

  // 자동 잠금: 마우스나 키보드 입력이 없으면 잠가요.
  const unlocked = status?.unlocked ?? false;

  // 열려 있는 동안: 일정 알림 목록을 앱에 보내고(30분마다 다시), 공휴일을 하루에 한 번 받아요.
  useEffect(() => {
    if (!unlocked) return;
    applyNotifyMode();
    // 키 설정(엔터규칙)을 읽어 모든 화면에 적용해요.
    loadSettings().then((s) => {
      setKeyMap(s.keys);
      modulesRef.current = s.modules;
      setModules(s.modules);
      // 시작 화면이 꺼진 모듈이면 첫 켜진 화면으로 열어요(처음 한 번).
      setCurrent((c) => (c && c !== SETTINGS.id && !isOn(s.modules, c) ? firstOn(s.modules) : c));
    }, () => {});
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

  // 첫 화면(잠금 화면이든 앱 화면이든, 오류 글이든)이 그려지면 창을 보여요. 그 전엔 창이 숨어 있어 흰 바탕이 보이지 않아요.
  const firstScreen = !!fatal || (status !== null && current !== null);
  useEffect(() => {
    if (!firstScreen) return;
    // 그림 두 번을 기다려요. 숨긴 창은 그림을 미룰 수 있어 0.1초가 먼저면 그때 알려요(한 번만 불려도 돼요).
    let done = false;
    const ready = () => {
      if (done) return;
      done = true;
      void api.windowReady();
    };
    requestAnimationFrame(() => requestAnimationFrame(ready));
    const t = window.setTimeout(ready, 100);
    return () => window.clearTimeout(t);
  }, [firstScreen]);

  const collapsed = prefs.sideCollapsed;
  const navButton = (id: ScreenId, label: string) => (
    <button
      type="button"
      className="side-item"
      title={collapsed ? label : undefined}
      aria-current={current === id ? "page" : undefined}
      onClick={() => setCurrent(id)}
    >
      <NavIcon name={id as NavIconName} size={collapsed ? 17 : 15} />
      {!collapsed && <span>{label}</span>}
    </button>
  );

  if (fatal) return <div className="gate"><p className="gate-error">{fatal}</p></div>;
  if (!status || current === null) return <div className="gate" />;
  if (!status.unlocked) {
    return <Gate mode={status.exists ? "unlock" : "setup"} folder={status.folder} onOpen={refresh} />;
  }

  const screen = [...SCREENS, SETTINGS].find((s) => s.id === current) ?? SCREENS[0];

  return (
    <div className="shell">
      <nav className={collapsed ? "side side-folded" : "side"} aria-label="모듈">
        <div className="brand">{collapsed ? <AppIcon size={32} /> : <Logo height={28} variant="word" />}</div>
        <div className="side-list">
          {onScreens(modules).filter((s) => s.group !== "bottom").map((s, i, list) => (
            <Fragment key={s.id}>
              {i > 0 && list[i - 1].group !== s.group && <div className="side-div" />}
              {navButton(s.id, s.side)}
            </Fragment>
          ))}
        </div>
        <div className="side-list side-bottom">
          {onScreens(modules).filter((s) => s.group === "bottom").map((s) => (
            <Fragment key={s.id}>{navButton(s.id, s.side)}</Fragment>
          ))}
          {navButton(SETTINGS.id, SETTINGS.side)}
          <button type="button" className="side-item" title={collapsed ? "잠그기" : undefined} onClick={lockNow}>
            <NavIcon name="lock" size={collapsed ? 17 : 15} />
            {!collapsed && <span>잠그기</span>}
          </button>
        </div>
        <div className="side-list side-toggle">
          <button type="button" className="side-item" title={collapsed ? "펼치기 (Ctrl+B)" : "접기 (Ctrl+B)"} onClick={toggleSide}>
            <NavIcon name={collapsed ? "unfold" : "fold"} size={collapsed ? 17 : 15} />
            {!collapsed && (
              <>
                <span>접기</span>
                <span className="side-kb">Ctrl+B</span>
              </>
            )}
          </button>
        </div>
      </nav>
      <main className={current === "explorer" || current === "budget" ? "main main-fill" : "main"}>
        {current === SETTINGS.id ? (
          <SettingsScreen prefs={prefs} onPrefs={savePrefs} status={status} onLocked={refresh} onModules={changeModules} />
        ) : current === "explorer" ? (
          <FilesScreen />
        ) : current === "contacts" ? (
          <ContactsScreen />
        ) : current === "journal" ? (
          <JournalScreen urgentDays={prefs.urgentDays} onOpenComplaint={openComplaint} onOpenTask={openTask} />
        ) : current === "complaints" ? (
          <ComplaintsScreen urgentDays={prefs.urgentDays} focusId={focusComplaint} onFocused={clearFocus} />
        ) : current === "budget" ? (
          <BudgetScreen />
        ) : current === "process" ? (
          <ProcessScreen urgentDays={prefs.urgentDays} onOpenComplaint={openComplaint} />
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
