// 설정 화면이에요. 시안 Settings.dc.html과 사양서 "설정" 절을 따라요 – 몸통(SettingsScreen)·설정 찾기. 카드·줄 부품은 Table.tsx.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BudgetShareRows } from "../../BudgetShareCard";
import { ACCENTS, DEFAULT_PREFS, errorText, Prefs, Status } from "../../api";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from "../../settingsStore";
import { isOn, Modules, onScreens, SCREENS, firstOn } from "../../screens";
import Logo, { AppIcon } from "../../Logo";
import { VERSION } from "../../version";
import { setKeyMap } from "../../keys";
import { ModulesCard, ModuleCard, KeysCard, GoogleRows, FilesRows, ListGroup, KindsGroup, PinRow, FolderRow, BackupRow, AddressRows, ProcessRows } from "./Table";
import { PasswordChange } from "./Dialogs";
import { Row, Toggle, X } from "./parts";

/** 화면 크기 단계(2026-10-21 화면 배율, 사용자 ② 1안) – 값은 prefs.fontSize 그대로, 13 = 100% */
const SCREEN_SIZES: [number, string][] = [
  [12, "작게"],
  [13, "보통"],
  [14, "조금 크게"],
  [15, "크게"],
  [16, "더 크게"],
  [17, "아주 크게"],
];

type Props = {
  prefs: Prefs;
  onPrefs: (p: Prefs) => Promise<void>;
  status: Status;
  onLocked: () => void;
  /** 모듈을 켜고 끄면 사이드바에 알려요. */
  onModules: (m: Modules) => void;
  /** 설정 닫기(× 단추) – 마지막으로 보던 화면으로 */
  onClose: () => void;
};

/** 설정이 있는 모듈만 "모듈별 설정"에 카드를 둬요(사이드바 순서). 없는 모듈(할 일·업무연락처)은 빼요 – 2026-10-18 사용자. 집행현황은 팀 공유(2026-10-20). */
const SET_SCREENS = SCREENS.filter((sc) => (["explorer", "complaints", "process", "budget", "calendar", "journal"] as string[]).includes(sc.id));

export default function SettingsScreen({ prefs, onPrefs, status, onLocked, onModules, onClose }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [ask, setAsk] = useState(false);
  const [note, setNote] = useState("");
  /** 설정 전체를 되돌리면 키 설정 카드도 다시 읽어요. */
  const [resetTick, setResetTick] = useState(0);
  /** 설정 찾기(2026-10-18 사용자, 시안 Settings) */
  const [q, setQ] = useState("");
  const [found, setFound] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const findBox = useRef<HTMLInputElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    setFound(applyFind(body.current, q));
  });
  // 본문을 내리면 오른쪽 아래 "맨 위로" 단추, 머리 줄 아래 선
  useEffect(() => {
    const main = body.current?.closest(".main");
    if (!main) return;
    const on = () => setScrolled(main.scrollTop > 240);
    main.addEventListener("scroll", on, { passive: true });
    return () => main.removeEventListener("scroll", on);
  }, [s === null]);
  // Ctrl+F = 찾기 칸
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === "KeyF") {
        e.preventDefault();
        findBox.current?.focus();
        findBox.current?.select();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    loadSettings().then(setS);
  }, []);

  async function update(next: Settings) {
    setS(next);
    setKeyMap(next.keys);
    try {
      await saveSettings(next);
    } catch (e) {
      setNote(errorText(e));
    }
  }

  async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    try {
      await onPrefs({ ...prefs, [key]: value });
      setNote("");
    } catch (e) {
      setNote(errorText(e));
    }
  }

  async function resetAll() {
    setAsk(false);
    await update(structuredClone(DEFAULT_SETTINGS));
    onModules({});
    setResetTick((n) => n + 1);
    await onPrefs({ ...DEFAULT_PREFS, dataDir: prefs.dataDir, askPassword: prefs.askPassword });
    setNote("기본값으로 되돌렸어요.");
  }

  if (!s) return null;

  return (
    <>
      <div className={"set-head" + (scrolled ? " set-head-line" : "")}>
        <div className="set-head-in">
          <h1 className="title">설정</h1>
          {!ask && (
            <label className="set-find">
              <FindIcon />
              <input
                ref={findBox}
                aria-label="설정 찾기"
                placeholder="설정 찾기 – 잠금, 폴더, 구분…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && !e.nativeEvent.isComposing && q) {
                    e.preventDefault();
                    e.stopPropagation();
                    setQ("");
                  }
                }}
              />
              {q && (
                <button
                  type="button"
                  className="set-find-x"
                  aria-label="찾는 글 지우기"
                  onClick={() => {
                    setQ("");
                    findBox.current?.focus();
                  }}
                >
                  <X />
                </button>
              )}
            </label>
          )}
          {!ask && q.trim() && (
            <span className="muted small set-find-n" role="status">
              {found ? `설정 ${found}개` : "없어요"}
            </span>
          )}
          {!ask ? (
            <button type="button" className="btn btn-ctrl btn-text set-reset" onClick={() => setAsk(true)}>
              기본값으로 되돌리기
            </button>
          ) : (
            <span className="ask-row set-reset">
              <span className="gate-error">설정을 모두 처음 값으로 되돌릴까요? 비밀번호와 저장한 자료는 그대로예요.</span>
              <button type="button" className="btn btn-ctrl btn-text" onClick={() => setAsk(false)}>
                취소
              </button>
              <button type="button" className="btn btn-ctrl btn-text btn-danger" onClick={resetAll}>
                되돌리기
              </button>
            </span>
          )}
          <button type="button" className="btn btn-ctrl set-close" aria-label="설정 닫기" title="닫기 · 보던 화면으로" onClick={onClose}>
            <X />
          </button>
        </div>
      </div>
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}

      <div className="set-body" ref={body}>
      <h2 className="set-sec">
        공통 설정<span>앱 전체에 걸친 것</span>
      </h2>

      <ModulesCard
        value={s.modules}
        onChange={(modules) => {
          update({ ...s, modules });
          onModules(modules);
        }}
      />

      <section className="card" aria-label="일반">
        <div className="card-head">일반</div>
        <Row label="내 이름" desc="대화 기록에서 내 말에 붙는 이름이에요.">
          <input
            id="my-name"
            className="input"
            style={{ width: 140 }}
            defaultValue={s.myName}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== s.myName) update({ ...s, myName: v });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </Row>
        <Row k="다크 라이트 어둡게 밝게 색 강조색" label="테마" desc="시스템은 윈도우의 밝게·어둡게 설정을 따라가요. 동그라미는 강조색이에요.">
          <span className="theme-ctl">
          <span className="seg" role="radiogroup" aria-label="테마">
            {(
              [
                ["system", "시스템"],
                ["light", "밝게"],
                ["dark", "어둡게"],
              ] as const
            ).map(([id, name]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={prefs.theme === id}
                onClick={() => setPref("theme", id)}
              >
                {name}
              </button>
            ))}
          </span>
          <span className="accent-pick" role="radiogroup" aria-label="강조색">
            {ACCENTS.map((a) => {
              const on = (prefs.accent || "purple") === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={a.name}
                  title={a.name}
                  className={"accent-dot accent-" + a.id}
                  onClick={() => setPref("accent", a.id)}
                >
                  {on && (
                    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </span>
          </span>
        </Row>
        <Row k="처음" label="시작 화면" desc="앱을 켰을 때 먼저 보이는 화면이에요. 켜 둔 모듈만 골라요.">
          <select
            id="start-screen"
            className="input"
            value={isOn(s.modules, prefs.startScreen) ? prefs.startScreen : firstOn(s.modules)}
            onChange={(e) => setPref("startScreen", e.target.value)}
          >
            {onScreens(s.modules).map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </Row>
        <Row k="폰트 글꼴 글자 크기 배율 확대" label="화면 크기" desc="글자·칸·아이콘이 함께 커져요. 모든 화면에 적용돼요.">
          <select
            id="font-size"
            className="input"
            value={prefs.fontSize}
            onChange={(e) => setPref("fontSize", Number(e.target.value))}
          >
            {SCREEN_SIZES.map(([v, name]) => (
              <option key={v} value={v}>
                {name} ({Math.round((v / 13) * 100)}%)
              </option>
            ))}
          </select>
        </Row>
        <Row
          label="민원 마감 임박 표시"
          desc="마감이 이 날짜 안으로 들어오면 빨갛게 보여요. 민원대장·민원처리·할 일·업무일지에 함께 적용돼요."
        >
          <select
            id="urgent-days"
            className="input"
            value={prefs.urgentDays}
            onChange={(e) => setPref("urgentDays", Number(e.target.value))}
          >
            <option value={2}>2일 전부터</option>
            <option value={3}>3일 전부터</option>
            <option value={5}>5일 전부터</option>
          </select>
        </Row>
        <Toggle
          k="부팅 시작 프로그램 자동 켜기 트레이"
          label="윈도우 시작할 때 자동 실행"
          desc="컴퓨터를 켜면 트레이에서 조용히 켜져요"
          on={!!prefs.autoStart}
          onChange={(v) => setPref("autoStart", v)}
        />
        <Row
          k="닫기 X 종료 끝내기 트레이 최소화 작업표시줄 창"
          label="닫기(X) 단추"
          desc={
            <>
              창의 X를 누르면 이렇게 해요.
              {prefs.closeAction === "quit" && <span className="row-note">앱이 꺼져 알림이 오지 않아요.</span>}
            </>
          }
          last
        >
          <span className="seg" role="radiogroup" aria-label="닫기(X) 단추">
            {(
              [
                ["minimize", "작업표시줄로 내림"],
                ["tray", "트레이로 보냄"],
                ["quit", "프로그램 종료"],
              ] as const
            ).map(([id, name]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={(prefs.closeAction || "tray") === id}
                onClick={() => setPref("closeAction", id)}
              >
                {name}
              </button>
            ))}
          </span>
        </Row>
      </section>

      <section className="card">
        <div className="card-head">보안 · 저장</div>
        <Toggle
          k="암호 잠금"
          label="앱을 열 때 비밀번호 묻기"
          desc={
            prefs.askPassword
              ? "민원인 개인정보가 들어 있어 켜 두는 것을 권해요."
              : "끄면 열쇠를 윈도우 자격 증명 관리자에 맡겨요. 이 윈도우 계정으로 로그인한 사람만 열 수 있어요."
          }
          on={prefs.askPassword}
          onChange={(v) => setPref("askPassword", v)}
        />
        <PinRow />
        <Toggle
          label="자동 잠금"
          desc="끄면 자리를 오래 비워도 잠기지 않아요."
          on={prefs.autoLock}
          onChange={(v) => setPref("autoLock", v)}
        />
        {prefs.autoLock && (
          <Row k="자동 잠금" label="잠기기까지 시간" desc="자리를 비운 뒤 이 시간이 지나면 잠겨요.">
            <select
              id="auto-lock-min"
              className="input"
              value={prefs.autoLockMin}
              onChange={(e) => setPref("autoLockMin", Number(e.target.value))}
            >
              <option value={5}>5분</option>
              <option value={10}>10분</option>
              <option value={30}>30분</option>
              <option value={60}>1시간</option>
            </select>
          </Row>
        )}
        <PasswordChange />
        <FolderRow folder={status.folder} onLocked={onLocked} setNote={setNote} />
        <BackupRow onLocked={onLocked} setNote={setNote} />
      </section>

      <KeysCard key={resetTick} saved={s.keys} onSave={(keys) => update({ ...s, keys })} />

      <h2 className="set-sec">
        모듈별 설정<span>사이드바 순서 · 끈 모듈은 접혀요</span>
      </h2>

      {SET_SCREENS.map((sc, i) => (
        <ModuleCard key={sc.id} id={sc.id} name={sc.side} off={!isOn(s.modules, sc.id)} gap={i > 0 && SET_SCREENS[i - 1].group !== sc.group}>
          {sc.id === "explorer" ? (
            <FilesRows value={s.files} onChange={(files) => update({ ...s, files })} />
          ) : sc.id === "complaints" ? (
            <>
              <ListGroup title="접수유형" items={s.intake} onChange={(intake) => update({ ...s, intake })} />
              <ListGroup title="민원유형" items={s.ctype} onChange={(ctype) => update({ ...s, ctype })} />
              <Row k="위치 표기 법정동 행정동 지번" label="위치 표기" desc={s.placeStyle === "legal" ? "동 지역은 법정동과 지번만 – 동패동 1234" : "행정동 + 법정동 + 지번 – 운정3동 동패동 1234"}>
                {/* 2026-10-25 사용자 ③1안 – 리 지역은 둘 다 "조리읍 대원리 1234" */}
                <span className="seg" role="radiogroup" aria-label="위치 표기">
                  {(
                    [
                      ["legal", "법정동"],
                      ["admin", "행정동"],
                    ] as const
                  ).map(([id, name]) => (
                    <button key={id} type="button" role="radio" aria-checked={s.placeStyle === id} onClick={() => update({ ...s, placeStyle: id })}>
                      {name}
                    </button>
                  ))}
                </span>
              </Row>
              <AddressRows />
            </>
          ) : sc.id === "process" ? (
            <ProcessRows p={s.process} onChange={(process) => update({ ...s, process })} />
          ) : sc.id === "budget" ? (
            <BudgetShareRows myName={s.myName} />
          ) : sc.id === "calendar" ? (
            <>
              <Toggle
                k="공휴일 토요일 일요일 빨강"
                label="쉬는 날 음영"
                desc="토·일요일과 공휴일 칸을 연한 빨강으로 칠해요."
                on={s.restShade}
                onChange={(restShade) => update({ ...s, restShade })}
              />
              {/* 구글 연동은 캘린더 카드 안 작은 묶음(2026-10-25 사용자 ⑤1안, 공통 ✔3) */}
              <GoogleRows />
            </>
          ) : (
            <KindsGroup kinds={s.kinds} onChange={(kinds) => update({ ...s, kinds })} />
          )}
        </ModuleCard>
      ))}

      <h2 className="set-sec">정보</h2>
      <section className="card" aria-label="정보" data-k="정보 버전 개발자 이메일">
        <div className="about">
          <AppIcon size={56} />
          <Logo height={38} variant="word" />
          <div className="about-ver">
            <span className="muted small">버전 {VERSION}</span>
            <span className="muted small">WebView2 {engineVersion()}</span>
          </div>
          <div className="about-dev">
            <span className="muted small">개발자 전훈민</span>
            <span className="muted small">zeondas@korea.kr</span>
          </div>
        </div>
      </section>
        {q.trim() && found === 0 && <p className="set-none">“{q.trim()}”에 맞는 설정이 없어요.</p>}
      </div>
      {scrolled && (
        <button
          type="button"
          className="set-top"
          aria-label="맨 위로"
          title="맨 위로"
          onClick={() => body.current?.closest(".main")?.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5 M6 11l6-6 6 6" />
          </svg>
        </button>
      )}
    </>
  );
}

/** 화면 엔진(WebView2) 버전 – 139 이상이면 모서리 스퀴클이 그려져요(2026-10-18 결정 ⑧). */
function engineVersion(): string {
  const ua = navigator.userAgent;
  return (ua.match(/Edg\/([\d.]+)/) ?? ua.match(/Chrome\/([\d.]+)/))?.[1] ?? "알 수 없음";
}

// ---------- 설정 찾기 (2026-10-18 사용자, 시안 Settings) ----------
// 화면을 다시 짜지 않고, 그린 뒤 줄마다 글자(이름·설명·숨은 낱말 data-k)를 보고 안 맞는 줄·카드·묶음 머리글을 숨겨요.
// 맞은 글자는 CSS Custom Highlight(::highlight(set-find))로 칠해요 – 글자를 고치지 않아 입력 중인 칸이 흔들리지 않아요.

const squash = (t: string) => t.toLowerCase().replace(/\s+/g, "");

/** el 안 글자에서 n(띄어쓰기 없앤 찾는 글)을 찾아 칠할 자리(Range)를 더해요. 맞았으면 true. */
function markIn(el: Element, n: string, out: Range[]): boolean {
  const pos: [Text, number][] = [];
  let flat = "";
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode() as Text | null; t; t = walk.nextNode() as Text | null) {
    const v = t.data;
    for (let i = 0; i < v.length; i++) {
      if (/\s/.test(v[i])) continue;
      pos.push([t, i]);
      flat += v[i].toLowerCase();
    }
  }
  let hit = false;
  for (let i = flat.indexOf(n); i >= 0; i = flat.indexOf(n, i + n.length)) {
    const [a, ai] = pos[i];
    const [b, bi] = pos[i + n.length - 1];
    const r = document.createRange();
    r.setStart(a, ai);
    r.setEnd(b, bi + 1);
    out.push(r);
    hit = true;
  }
  return hit;
}

const keysOf = (el: Element) => [el.getAttribute("data-k") ?? "", ...[...el.querySelectorAll("[data-k]")].map((x) => x.getAttribute("data-k") ?? "")].join(" ");

/** 찾기를 적용하고 보이는 설정 줄 수를 돌려줘요(찾는 글이 없으면 null). */
function applyFind(root: HTMLElement | null, q: string): number | null {
  const reg = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
  const HL = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!root) return null;
  root.querySelectorAll("[data-find-hide]").forEach((el) => el.removeAttribute("data-find-hide"));
  const n = squash(q);
  if (!n) {
    reg?.delete("set-find");
    return null;
  }
  const ranges: Range[] = [];
  const hide = (el: Element) => el.setAttribute("data-find-hide", "");
  let count = 0;
  let lastHead: Element | null = null;
  let headHasCard = false;
  const closeHead = () => {
    if (lastHead && !headHasCard) hide(lastHead);
  };
  for (const el of [...root.children]) {
    if (el.matches("h2.set-sec")) {
      closeHead();
      lastHead = el;
      headHasCard = false;
      continue;
    }
    if (!el.matches("section.card")) continue;
    const head = el.querySelector(":scope > .card-head");
    const cardHit = (head ? markIn(head, n, ranges) : false) || squash(el.getAttribute("data-k") ?? "").includes(n);
    const keys = el.matches("[aria-label='키 설정']");
    const units = keys ? [...el.querySelectorAll(".keys-row")] : [...el.children].filter((c) => c !== head);
    let shown = 0;
    for (const u of units) {
      const own = markIn(u, n, ranges) || squash(keysOf(u)).includes(n);
      if (own || (cardHit && (u.textContent ?? "").trim())) {
        shown++;
      } else hide(u);
    }
    if (keys) el.querySelectorAll(".keys-box").forEach((b) => !b.querySelector(".keys-row:not([data-find-hide])") && hide(b));
    if (!shown && !cardHit) hide(el);
    else {
      headHasCard = true;
      count += Math.max(shown, 1);
    }
  }
  closeHead();
  if (reg && HL) reg.set("set-find", new HL(...ranges));
  return count;
}

function FindIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M10.5 3a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15z M16 16l5 5" />
    </svg>
  );
}
