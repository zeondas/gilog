import { FormEvent, Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BudgetShareRows } from "./BudgetShareCard";
import { PATH_NAME, setWebKey, testWeb, webKey, webStatus, WebStatus } from "./addressWeb";
import { ACCENTS, api, DEFAULT_PREFS, errorText, inApp, Prefs, RoadTableInfo, Status } from "./api";
import { splitJamo } from "./journal";
import { DEFAULT_MAIL_BODY, DEFAULT_MAIL_SUBJECT, DEFAULT_SETTINGS, MAIL_FIELDS, Kind, loadSettings, MEMO_KIND, ProcessSettings, saveSettings, Settings, FilesSettings, STATUS_COLORS } from "./settingsStore";
import { aiGuide, phoneGuide } from "./process";
import { isOn, MODULE_DESC, ModuleId, Modules, onScreens, SCREENS, firstOn } from "./screens";
import { NavIcon, NavIconName } from "./Icons";
import { DATE_FORMATS, FsDrive, HOME, PC } from "./files";
import { FastStatus, fsApi } from "./filesApi";
import Logo, { AppIcon } from "./Logo";
import { VERSION } from "./version";
import { useOutsideClose } from "./useOutsideClose";
import { Action, conflicts, DEFAULT_KEYS, diffKeys, isRightAlt, KEY_GROUPS, KeyMap, mergeKeys, setKeyMap } from "./keys";
import { AskBand } from "./AskBand";
import {
  connectGoogle,
  DEFAULT_OPTS,
  disconnectGoogle,
  exportNow,
  forgetClient,
  GOpts,
  GStatus,
  loadGoogleStatus,
  loadOpts,
  onGoogleStatus,
  parseClientFile,
  saveClient,
  saveOpts,
  whenText,
  BUILTIN_CLIENT,
  needsTasksLogin,
} from "./google";

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
        <Row k="폰트 글꼴" label="글자 크기" desc="모든 화면에 함께 적용돼요.">
          <select
            id="font-size"
            className="input"
            value={prefs.fontSize}
            onChange={(e) => setPref("fontSize", Number(e.target.value))}
          >
            <option value={12}>작게 (12)</option>
            <option value={13}>보통 (13)</option>
            <option value={14}>크게 (14)</option>
            <option value={15}>아주 크게 (15)</option>
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

      <GoogleCard />

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
              <AddressRows />
            </>
          ) : sc.id === "process" ? (
            <ProcessRows p={s.process} onChange={(process) => update({ ...s, process })} />
          ) : sc.id === "budget" ? (
            <BudgetShareRows myName={s.myName} />
          ) : sc.id === "calendar" ? (
            <Toggle
              k="공휴일 토요일 일요일 빨강"
              label="쉬는 날 음영"
              desc="토·일요일과 공휴일 칸을 연한 빨강으로 칠해요."
              on={s.restShade}
              onChange={(restShade) => update({ ...s, restShade })}
            />
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

// ---------- 모듈 켜고 끄기 (2026-10-18 설정 세션, 시안 Settings) ----------

/** 공통 맨 위 "모듈" 카드: 사이드바 순서·묶음대로 스위치. 적어도 하나는 켜져 있어야 해요. 설정은 끌 수 없어 줄이 없어요. */
function ModulesCard({ value, onChange }: { value: Modules; onChange: (m: Modules) => void }) {
  const [note, setNote] = useState("");
  const onCount = onScreens(value).length;
  function flip(id: ModuleId) {
    const on = isOn(value, id);
    if (on && onCount === 1) return setNote("적어도 모듈 하나는 켜 둬야 해요.");
    setNote("");
    const next = { ...value };
    if (on) next[id] = false;
    else delete next[id];
    onChange(next);
  }
  return (
    <section className="card" aria-label="모듈">
      <div className="card-head">
        모듈 <span className="muted small head-sub">끄면 사이드바에서 숨겨요. 자료는 그대로이고 다시 켜면 돌아와요.</span>
      </div>
      {SCREENS.map((sc, i) => {
        const on = isOn(value, sc.id);
        return (
          <Fragment key={sc.id}>
            {i > 0 && SCREENS[i - 1].group !== sc.group && <div className="mod-div" aria-hidden="true" />}
            <button type="button" role="switch" aria-checked={on} className="row row-btn" onClick={() => flip(sc.id)}>
              <span className={"mod-icon" + (on ? "" : " off")}>
                <NavIcon name={sc.id as NavIconName} size={15} />
              </span>
              <span className="row-text">
                <span className="row-label">{sc.side}</span>
                <span className="muted small">{on ? MODULE_DESC[sc.id] : "꺼짐 · 사이드바에서 숨겼어요"}</span>
              </span>
              <span className={"switch" + (on ? " on" : "") + (on && onCount === 1 ? " locked" : "")} aria-hidden="true">
                <span className="knob" />
              </span>
            </button>
          </Fragment>
        );
      })}
      {note && (
        <p className="mod-note small" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

/** 모듈별 카드: 머리에 사이드바 아이콘 + 이름. 끈 모듈은 머리만 남기고 접어요. */
function ModuleCard({ id, name, off, gap, children }: { id: ModuleId; name: string; off: boolean; gap: boolean; children: React.ReactNode }) {
  return (
    <section className={"card mod-card" + (off ? " mod-off" : "") + (gap ? " mod-gap" : "")} aria-label={name}>
      <div className="card-head mod-head">
        <NavIcon name={id as NavIconName} size={16} />
        {name}
        {off && <span className="mod-tag">꺼짐 · 위 모듈 카드에서 켜요</span>}
      </div>
      {!off && children}
    </section>
  );
}

// ---------- 키 설정 (엔터규칙, 2026-10-17 사용자 – 시안 KeySettings.dc.html 키 고르기 1안 · 배치 2안) ----------

const KEY_HINT = "Enter·Tab·Esc와 Shift·Ctrl·왼쪽 Alt만 골라요";
const RALT_HINT = "오른쪽 Alt는 한/영 키라 고를 수 없어요";

/**
 * 동작마다 키를 골라요: 칸을 누르고 키를 직접 눌러요. 쓰는 곳마다 작은 상자(두 단).
 * 같은 키가 "그 묶음 + 공통"에서 겹치면 두 칸 모두 빨간 테두리이고 저장하지 않아요(앱은 그 전 키 그대로).
 */
function KeysCard({ saved, onSave }: { saved: Partial<Record<string, string>>; onSave: (keys: Partial<KeyMap>) => void }) {
  const [keys, setKeys] = useState<KeyMap>(() => mergeKeys(saved));
  const [cap, setCap] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const bad = conflicts(keys);

  function assign(a: Action, k: string) {
    const next = { ...keys, [a]: k };
    setKeys(next);
    setCap(null);
    setNote("");
    if (!conflicts(next).size) onSave(diffKeys(next));
  }

  function onKey(e: React.KeyboardEvent<HTMLButtonElement>, a: Action) {
    if (cap !== a) return;
    e.preventDefault();
    e.stopPropagation();
    if (isRightAlt(e)) return setNote(RALT_HINT);
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    const main = ({ Enter: "Enter", Tab: "Tab", Escape: "Esc" } as Record<string, string>)[e.key];
    if (!main) return setNote(KEY_HINT);
    assign(a, (e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + (e.altKey ? "Alt+" : "") + main);
  }

  const status = note || (bad.size ? "같은 키가 겹쳐요 · 저장하지 않았어요" : "");

  return (
    <section className="card" aria-label="키 설정" data-k="단축키 엔터 Enter Tab">
      <div className="card-head keys-head">
        <span>키 설정</span>
        <span role="status" className="keys-status">
          {status}
        </span>
        <button
          type="button"
          className="btn btn-xs"
          onClick={() => {
            setKeys({ ...DEFAULT_KEYS });
            setCap(null);
            setNote("");
            onSave({});
          }}
        >
          기본값으로
        </button>
      </div>
      <div className="keys-grid">
        {KEY_GROUPS.map((g) => (
          <div key={g.scope} className="keys-box">
            <span className="keys-title">{g.title}</span>
            {g.rows.map(([a, label]) => {
              const on = cap === a;
              return (
                <div key={a} className="keys-row">
                  <span className="keys-label">{label}</span>
                  <button
                    type="button"
                    className={"kb" + (bad.has(a) ? " bad" : on ? " cap" : "")}
                    aria-label={`${g.title} · ${label} 키`}
                    aria-pressed={on}
                    data-action={a}
                    onClick={() => {
                      setCap(on ? null : a);
                      setNote("");
                    }}
                    onKeyDown={(e) => onKey(e, a)}
                    onBlur={() => on && setCap(null)}
                  >
                    {on ? (
                      <span className="kb-wait">키를 누르세요</span>
                    ) : (
                      (keys[a] ? keys[a].split("+") : ["없음"]).map((t, i) => (
                        <span key={i} className="kb-part">
                          {i > 0 && (
                            <span className="kb-plus" aria-hidden="true">
                              +
                            </span>
                          )}
                          <span className="kb-cap">{t}</span>
                        </span>
                      ))
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- 구글 캘린더 연동 (9단계) ----------

const G_TOGGLES: [keyof GOpts, string, string][] = [
  ["events", "내 일정 내보내기", "캘린더에 직접 적은 일정이에요."],
  ["complaints", "민원 마감 내보내기", "민원인 이름과 연락처는 보내지 않아요."],
  ["tasks", "할 일 마감 내보내기", "할 일 목록의 마감일이 구글에 보여요."],
  ["gtasks", "구글 할 일로 보내기", "민원·할 일 마감을 구글 할 일(체크 동그라미)로 보내고 체크를 서로 맞춰요. 켜면 구글 권한을 한 번 더 받아요."],
];

function GoogleCard() {
  const [g, setG] = useState<GStatus | null>(null);
  const [opts, setOpts] = useState<GOpts>(DEFAULT_OPTS);
  const [msg, setMsg] = useState("");
  const [wait, setWait] = useState(false);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    loadGoogleStatus().catch(() => {});
    loadOpts().then(setOpts);
    return onGoogleStatus(setG);
  }, []);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      await saveClient(parseClientFile(await f.text()));
      setMsg("앱 정보 파일을 넣었어요. 이제 구글 로그인을 눌러 주세요.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function login() {
    setMsg("브라우저에서 구글 로그인을 마쳐 주세요.");
    setWait(true);
    try {
      await connectGoogle(opts.gtasks);
      setMsg("");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setWait(false);
    }
  }

  async function cut(removeEvents: boolean) {
    setAsk(false);
    setMsg((await disconnectGoogle(removeEvents)) || (removeEvents ? "연결을 끊고 구글의 giLog 캘린더를 지웠어요." : "연결을 끊었어요. 구글의 일정은 그대로 있어요."));
  }

  async function toggle(k: keyof GOpts) {
    const next = { ...opts, [k]: !opts[k] };
    // 구글 할 일을 켜는데 지금 로그인에 할 일 권한이 없으면, 권한을 더 받는 로그인부터 해요.
    if (k === "gtasks" && next.gtasks && (await needsTasksLogin())) {
      setMsg("브라우저에서 구글 할 일 권한을 허용해 주세요.");
      setWait(true);
      try {
        await connectGoogle(true);
        setMsg("");
      } catch (err) {
        setMsg(err instanceof Error ? err.message : String(err));
        setWait(false);
        return;
      }
      setWait(false);
    }
    setOpts(next);
    saveOpts(next);
  }

  if (!g) return null;
  const sub = g.busy ? "내보내는 중…" : g.lastError || (g.lastOk ? `기록 → 구글 한 방향 · 마지막 내보내기 ${whenText(g.lastOk)}` : "기록 → 구글 한 방향");

  return (
    <section className="card">
      <div className="card-head">구글 캘린더 연동</div>
      {g.connected ? (
        <div className="row g-row">
          <span className={"g-dot" + (g.lastError ? " bad" : "")} aria-hidden="true" />
          <span className="row-text">
            <span className="row-label">{g.lastError ? "연결됨 · 내보내지 못했어요" : "연결됨 · 개인 구글 계정"}</span>
            <span className={"small " + (g.lastError ? "g-err" : "muted")}>{sub}</span>
          </span>
          {!ask ? (
            <>
              {g.lastError.includes("다시 로그인") && (
                <button type="button" className="btn btn-primary" disabled={wait} onClick={login}>
                  {wait ? "로그인 기다리는 중…" : "다시 로그인"}
                </button>
              )}
              <button type="button" className="btn" disabled={g.busy} onClick={() => exportNow()}>
                지금 내보내기
              </button>
              <button type="button" className="btn g-cut" onClick={() => setAsk(true)}>
                연결 끊기
              </button>
            </>
          ) : (
            <span className="ask-row">
              <span className="gate-error">구글에 내보낸 일정도 지울까요?</span>
              <button type="button" className="btn" onClick={() => setAsk(false)}>
                취소
              </button>
              <button type="button" className="btn" onClick={() => cut(false)}>
                일정은 두기
              </button>
              <button type="button" className="btn btn-danger" onClick={() => cut(true)}>
                일정도 지우기
              </button>
            </span>
          )}
        </div>
      ) : (
        <>
          {!BUILTIN_CLIENT && (
          <Row label="앱 정보 파일" desc={g.configured ? "넣었어요. 다른 파일로 바꾸려면 다시 고르세요." : "구글 콘솔에서 받은 client_secret…json 파일을 골라 주세요."}>
            <label className="btn">
              파일 고르기
              <input type="file" accept=".json,application/json" hidden onChange={pickFile} />
            </label>
            {g.configured && (
              <button type="button" className="btn" onClick={() => forgetClient()}>
                지우기
              </button>
            )}
          </Row>
          )}
          <Row label="구글 로그인" desc={g.lastError || "로그인하면 구글 계정에 giLog 캘린더를 만들어 그 안에만 써요."}>
            <button type="button" className="btn btn-primary" disabled={!g.configured || wait || !inApp} onClick={login}>
              {wait ? "로그인 기다리는 중…" : "구글 로그인"}
            </button>
          </Row>
        </>
      )}
      {msg && (
        <p className="g-msg small" role="status">
          {msg}
        </p>
      )}
      {G_TOGGLES.map(([k, label, desc]) => (
        <Toggle key={k} label={label} desc={desc} on={opts[k]} onChange={() => toggle(k)} />
      ))}
      <p className="g-foot small">민원인 이름과 연락처는 어떤 경우에도 구글로 내보내지 않아요. 내보낸 일정은 시청 밖 구글 서버에 저장돼요.</p>
    </section>
  );
}

// ---------- 탐색기 카드 (11단계, 시안 FilesSettings.dc.html) ----------


/** 탐색기 설정: 보일 드라이브 고르기(끈 것은 숨긴 목록에 들어가요) */
function DriveRow({ label, desc, list, drives, onSet }: { label: string; desc: string; list: string[]; drives: { name: string; label: string }[]; onSet: (l: string[]) => void }) {
  return (
    <Row label={label} desc={desc}>
      <span className="fx-set-drives">
        {[{ name: PC, label: "내 PC" }, ...drives.map((d) => ({ name: d.name, label: `${d.name} ${d.label}` })), { name: HOME, label: "즐겨찾기" }].map((d) => {
          const on = !list.includes(d.name);
          return (
            <button key={d.name} type="button" className={"chip fx-set-drive" + (on ? " on" : "")} aria-pressed={on} onClick={() => onSet(on ? [...list, d.name] : list.filter((x) => x !== d.name))}>
              {d.label}
            </button>
          );
        })}
      </span>
    </Row>
  );
}

/** 빠른 찾기(2026-10-20 사용자): 도우미가 설치돼 있으면 켜고 끄는 스위치, 없으면(설치 때 관리자 허용을 거절) [설치] */
function FastRow({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const [f, setF] = useState<FastStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState("");
  const ask = () => void fsApi.fastStatus().then(setF, () => setF(null));
  useEffect(ask, []);
  const desc = "모든 드라이브에서 이름을 바로 찾아요. 드라이브의 파일 목록을 미리 저장해 두는 방식이라 설치할 때 관리자 허용이 필요해요.";
  if (f?.installed)
    return <Toggle label="빠른 찾기" desc={desc} k="에브리띵 everything 모든 드라이브" on={on} onChange={onChange} />;
  const install = async () => {
    setBusy("설치하는 중…");
    try {
      await fsApi.fastSetup("install");
      setBusy("");
    } catch {
      setBusy("관리자 허용을 받지 못했어요.");
    }
    ask();
  };
  return (
    <Row label="빠른 찾기" desc={busy || "모든 드라이브에서 이름을 바로 찾아요. 드라이브의 파일 목록을 미리 저장해 두는 방식이라 관리자 허용이 필요한데, 설치할 때 받지 못해 설치되지 않았어요. [설치]를 누르면 한 번 더 물어요."} k="에브리띵 everything 모든 드라이브">
      <button type="button" className="btn btn-ctrl" disabled={f === undefined || !!busy && busy.endsWith("…")} onClick={() => void install()}>
        설치
      </button>
    </Row>
  );
}

function FilesRows({ value, onChange }: { value: FilesSettings; onChange: (v: FilesSettings) => void }) {
  const [drives, setDrives] = useState<FsDrive[]>([]);
  const [dir, setDir] = useState(value.newTabDir);
  useEffect(() => {
    fsApi.drives().then(setDrives, () => {});
  }, []);
  useEffect(() => setDir(value.newTabDir), [value.newTabDir]);
  const set = (p: Partial<FilesSettings>) => onChange({ ...value, ...p });
  const pick = async () => {
    if (!inApp) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, defaultPath: dir || undefined });
    if (typeof r === "string") set({ newTabDir: r });
  };
  return (
    <>
      <Row label="날짜 형식" desc="목록의 수정한 날 열이에요.">
        <select id="files-date" className="input fx-set-date" value={value.dateFmt} onChange={(e) => set({ dateFmt: e.target.value })}>
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Row>
      <DriveRow label="드라이브 단추" desc="위쪽 드라이브 단추 줄에 보일 것이에요." list={value.hiddenDrives} drives={drives} onSet={(l) => set({ hiddenDrives: l })} />
      <DriveRow label="폴더 트리" desc="왼쪽 폴더 트리에 보일 것이에요." list={value.treeHidden} drives={drives} onSet={(l) => set({ treeHidden: l })} />
      <FastRow on={value.fast} onChange={(fast) => set({ fast })} />
      <Row label="보이는 열" desc="자세히 보기의 열이에요. 이름은 늘 보여요.">
        <span className="fx-set-drives">
          {(
            [
              ["size", "크기"],
              ["modified", "수정한 날"],
              ["type", "파일 형식"],
            ] as const
          ).map(([k, name]) => {
            const on = value.cols[k];
            return (
              <button
                key={k}
                type="button"
                className={"chip fx-set-drive" + (on ? " on" : "")}
                aria-pressed={on}
                onClick={() => set({ cols: { ...value.cols, [k]: !on } })}
              >
                {name}
              </button>
            );
          })}
        </span>
      </Row>
      <Toggle label="숨김 파일 보이기" desc="켜면 흐리게 보여요." on={value.showHidden} onChange={(showHidden) => set({ showHidden })} />
      <Row label="새 탭이 여는 폴더" desc="새 탭과 처음 켤 때 열려요. 비우면 문서 폴더예요.">
        <span className="fx-set-dir">
          <input
            className="input"
            aria-label="새 탭이 여는 폴더"
            value={dir}
            placeholder="문서"
            onChange={(e) => setDir(e.target.value)}
            onBlur={() => dir.trim() !== value.newTabDir && set({ newTabDir: dir.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <button type="button" className="btn btn-ctrl" onClick={() => void pick()}>
            고르기
          </button>
        </span>
      </Row>
      <Toggle
        k="삭제 휴지통"
        label="지울 때 묻기"
        desc="끄면 Delete·F8이 묻지 않고 휴지통으로 보내요. Shift+F8 완전 삭제는 늘 물어요."
        on={value.askDelete}
        onChange={(askDelete) => set({ askDelete })}
      />
    </>
  );
}

// ---------- 부품 ----------

function Row({
  label,
  desc,
  children,
  last,
  k,
}: {
  label: string;
  desc: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
  /** 찾기에만 쓰는 숨은 낱말 */
  k?: string;
}) {
  return (
    <div className={"row" + (last ? " row-last" : "")} data-k={k}>
      <span className="row-text">
        <span className="row-label">{label}</span>
        <span className="muted small">{desc}</span>
      </span>
      {children}
    </div>
  );
}

function Toggle({
  label,
  desc,
  on,
  onChange,
  k,
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
  k?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className="row row-btn" onClick={() => onChange(!on)} data-k={k}>
      <span className="row-text">
        <span className="row-label">{label}</span>
        <span className="muted small">{desc}</span>
      </span>
      <span className={"switch" + (on ? " on" : "")} aria-hidden="true">
        <span className="knob" />
      </span>
    </button>
  );
}

/** 받침이 있으면 "을", 없으면 "를" */
function eulReul(w: string) {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? "을" : "를";
}

/**
 * 목록 묶음(상태·접수유형·민원유형). ×를 누르면 "지울까요?"를 물어요(2026-10-17 사용자 – 다른 화면과 같게).
 * stack이면 관리 창 모양: 배지 아래 줄에 넓은 추가 칸과 "＋ 추가" 단추.
 */
export function ListGroup({
  title,
  desc,
  items,
  keep,
  colored,
  last,
  stack,
  onChange,
}: {
  title: string;
  desc?: string;
  items: string[];
  keep?: string;
  colored?: boolean;
  last?: boolean;
  stack?: boolean;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [ask, setAsk] = useState<string | null>(null);
  const band = useRef<HTMLDivElement>(null);
  // Esc와 바깥 누르기는 묻는 띠만 접어요(창 전체의 Esc보다 먼저 받아요).
  useOutsideClose(ask !== null, [band], () => setAsk(null), {
    onEsc: (e) => {
      if (e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      setAsk(null);
    },
    escCapture: true,
  });
  function add() {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    setDraft("");
    onChange([...items, v]);
  }
  const input = (
    <input
      className={"input" + (stack ? "" : " input-sm")}
      aria-label={`${title} 추가`}
      placeholder={stack ? `새 ${title}` : "새 항목"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          add();
        }
      }}
    />
  );
  return (
    <div className={(stack ? "mgr-group" : "group") + (last ? " row-last" : "")}>
      <div className={stack ? "mgr-label" : "group-head"}>
        {stack ? title : <span className="row-label">{title}</span>}
        {desc && <span className="muted small">{desc}</span>}
      </div>
      <div className="chips">
        {items.map((name) => {
          const c = colored ? STATUS_COLORS[name] ?? ["var(--st-new-bg)", "var(--st-new-fg)"] : null;
          return (
            <span
              key={name}
              className={"chip" + (c ? " chip-colored" : "") + (name === keep ? " chip-keep" : "")}
              style={c ? { background: c[0], color: c[1] } : undefined}
            >
              {name}
              {name !== keep && (
                <button type="button" className="chip-x" aria-label={`${name} 삭제`} onClick={() => setAsk(name)}>
                  <X />
                </button>
              )}
            </span>
          );
        })}
        {!stack && (
          <span className="chip-add">
            {input}
            <button type="button" className="btn-icon" aria-label={`${title} 추가`} onClick={add}>
              <Plus />
            </button>
          </span>
        )}
      </div>
      {ask !== null && (
        <AskBand
          bandRef={band}
          className="list-ask"
          label={`${title} 지우기 확인`}
          text={`"${ask}"${eulReul(ask)} 지울까요? 이미 적은 민원은 그대로예요.`}
          onNo={() => setAsk(null)}
          onYes={() => {
            onChange(items.filter((x) => x !== ask));
            setAsk(null);
          }}
        />
      )}
      {stack && (
        <div className="padd mgr-addrow">
          {input}
          <button type="button" className="btn-primary btn-ctrl mgr-add" onClick={add}>
            <Plus size={16} /> 추가
          </button>
        </div>
      )}
    </div>
  );
}

function KindsGroup({ kinds, onChange }: { kinds: Kind[]; onChange: (k: Kind[]) => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  function add() {
    const n = name.trim();
    if (!n || kinds.some((k) => k.name === n)) return;
    // 초성은 겹자음(ㄳ)으로 묶이지 않게 풀어서 저장해요.
    onChange([...kinds, { name: n, key: splitJamo(key.trim()) }]);
    setName("");
    setKey("");
  }
  return (
    <div className="group row-last">
      <div className="group-head">
        <span className="row-label">구분과 초성 단축키</span>
        <span className="muted small">구분 칸에 초성만 쳐도 바뀌어요.</span>
      </div>
      <div className="kinds">
        {kinds.map((k) => (
          <span key={k.name} className="kind">
            <span className="kind-name">{k.name}</span>
            {k.key && <span className="kind-key">{k.key}</span>}
            {k.name === MEMO_KIND.name ? (
              <span className="kind-fixed" title="메모는 고정 구분이라 지울 수 없어요. 고르면 편집기로 적어요.">고정</span>
            ) : (
              <button type="button" className="chip-x" aria-label={`${k.name} 삭제`} onClick={() => onChange(kinds.filter((x) => x.name !== k.name))}>
                <X />
              </button>
            )}
          </span>
        ))}
      </div>
      <form
        className="kind-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="input" aria-label="새 구분 이름" placeholder="새 구분" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 160px", maxWidth: 220 }} />
        <input className="input" aria-label="새 구분 초성" placeholder="초성" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 120 }} />
        <button type="submit" className="btn-primary btn-sm">
          <Plus /> 추가
        </button>
      </form>
    </div>
  );
}

/** 비밀번호를 바꾼 뒤 PIN 줄이 다시 읽게 알려요. */
const PIN_CHANGED = "gilog-pin-changed";

/**
 * "윈도우 PIN으로 잠금 풀기" (2026-10-18 사용자 확정, 캔버스 Lock 판). 이 PC만이고 처음엔 꺼짐.
 * 켜기: 비밀번호 한 번 확인 → Hello 창 → 보관. 끄면 보관한 것을 지워요. 이 PC에서 못 쓰면 흐리게.
 */
function PinRow() {
  const [st, setSt] = useState<{ available: boolean; on: boolean } | null>(null);
  const [asking, setAsking] = useState(false);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => api.pinStatus().then(setSt, () => setSt({ available: false, on: false }));
    load();
    window.addEventListener(PIN_CHANGED, load);
    return () => window.removeEventListener(PIN_CHANGED, load);
  }, []);

  const available = st?.available ?? false;
  const on = st?.on ?? false;
  const desc = !st
    ? ""
    : !available && !on
      ? "이 PC에서는 쓸 수 없어요"
      : on
        ? "비밀번호를 이 PC의 윈도우 계정에 묶어 두었어요. 끄면 지워요."
        : asking
          ? "비밀번호를 확인한 뒤 윈도우 확인 창이 떠요."
          : "잠금 화면에 \"PIN으로 풀기\"가 생겨요. 이 PC에서만 써요.";

  async function flip() {
    if (busy || !st) return;
    if (on) {
      await api.pinDisable().catch(() => {});
      setSt({ ...st, on: false });
      return;
    }
    if (!available) return;
    setAsking(!asking);
    setPw("");
    setMsg("");
  }

  async function next(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!pw) {
      setMsg("비밀번호를 넣어 주세요.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      await api.pinEnable(pw);
      setAsking(false);
      setPw("");
      setSt({ available: true, on: true });
    } catch (err) {
      if (err === "hello_canceled") {
        setAsking(false);
        setPw("");
      } else setMsg(errorText(err));
      if (err === "hello_unavailable") {
        setAsking(false);
        setSt({ available: false, on: false });
      }
    }
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on || asking}
        className={"row row-btn" + (!available && !on ? " row-off" : "")}
        disabled={!st || (!available && !on)}
        onClick={flip}
      >
        <span className="row-text">
          <span className="row-label">윈도우 PIN으로 잠금 풀기</span>
          <span className="muted small">{desc}</span>
        </span>
        <span className={"switch" + (on || asking ? " on" : "")} aria-hidden="true">
          <span className="knob" />
        </span>
      </button>
      {asking && (
        <form className="row pin-ask" onSubmit={next}>
          <label className="field pin-ask-field">
            <span>비밀번호를 한 번 확인해요</span>
            <input
              id="pin-pw"
              className="input"
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAsking(false);
                }
              }}
            />
          </label>
          <button type="button" className="btn" onClick={() => setAsking(false)}>
            취소
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>
            다음
          </button>
          {msg && (
            <span className="gate-error pin-ask-msg" role="alert">
              {msg}
            </span>
          )}
        </form>
      )}
    </>
  );
}

function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    if (newPw !== again) {
      setMsg("새 비밀번호 두 개가 서로 달라요.");
      return;
    }
    try {
      await api.changePassword(oldPw, newPw);
    } catch (err) {
      setMsg(err === "wrong_password" ? "지금 비밀번호가 맞지 않아요." : errorText(err));
      return;
    }
    // 윈도우 PIN 풀기가 켜져 있으면 Hello를 한 번 더 받고 새 비밀번호로 바꿔 보관해요(꺼져 있으면 그냥 지나가요).
    let done = "비밀번호를 바꿨어요.";
    try {
      const st = await api.pinStatus();
      if (st.on) {
        await api.pinRekey(newPw);
        done = "비밀번호를 바꿨어요. PIN 풀기용도 새것으로 바꿨어요.";
      }
    } catch {
      done = "비밀번호를 바꿨어요. PIN 풀기는 껐어요 – 다시 켜면 새 비밀번호로 보관해요.";
    }
    window.dispatchEvent(new Event(PIN_CHANGED));
    setOldPw("");
    setNewPw("");
    setAgain("");
    setOk(true);
    setMsg(done);
    setOpen(false);
  }

  return (
    <>
      <Row k="암호" label="잠금 비밀번호" desc={ok ? msg : "앱을 열 때 묻는 비밀번호예요. 잊으면 되찾을 수 없어요."}>
        <button type="button" className="btn" onClick={() => setOpen(!open)}>
          비밀번호 바꾸기
        </button>
      </Row>
      {open && (
        <form className="pw-form row" onSubmit={submit}>
          <label className="field">
            <span>지금 비밀번호</span>
            <input id="pw-old" className="input" type="password" autoFocus value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </label>
          <label className="field">
            <span>새 비밀번호</span>
            <input id="pw-new" className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </label>
          <label className="field">
            <span>새 비밀번호 확인</span>
            <input id="pw-again" className="input" type="password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
          <div className="pw-foot">
            <span className="gate-error" role="status">
              {ok ? "" : msg}
            </span>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              취소
            </button>
            <button type="submit" className="btn-primary btn-sm">
              바꾸기
            </button>
          </div>
        </form>
      )}
    </>
  );
}

async function pickFolder(): Promise<string | null> {
  if (!inApp) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, title: "기록 자료를 둘 폴더" });
  return typeof r === "string" ? r : null;
}

function FolderRow({ folder, onLocked, setNote }: { folder: string; onLocked: () => void; setNote: (s: string) => void }) {
  async function change() {
    const dir = await pickFolder();
    if (!dir) return;
    try {
      await api.moveData(dir);
      setNote("자료를 옮겼어요. 다시 열어 주세요.");
      onLocked();
    } catch (e) {
      setNote(errorText(e));
    }
  }
  return (
    <Row k="자료 파일 폴더" label="저장 위치" desc={`${folder} · 암호화해서 이 PC에만 저장해요.`}>
      <button type="button" className="btn" onClick={change} disabled={!inApp}>
        폴더 바꾸기
      </button>
    </Row>
  );
}

function BackupRow({ onLocked, setNote }: { onLocked: () => void; setNote: (s: string) => void }) {
  const [importPath, setImportPath] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");

  async function doExport() {
    if (!inApp) return;
    const { save } = await import("@tauri-apps/plugin-dialog");
    const today = new Date().toISOString().slice(0, 10);
    const path = await save({
      title: "백업 파일 저장",
      defaultPath: `giLog-${today}.gilogbak`,
      filters: [{ name: "기록 백업", extensions: ["gilogbak"] }],
    });
    if (!path) return;
    try {
      await api.exportBackup(path);
      setNote("백업 파일을 저장했어요.");
    } catch (e) {
      setNote(errorText(e));
    }
  }

  async function pickImport() {
    if (!inApp) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ title: "불러올 백업 파일", filters: [{ name: "기록 백업", extensions: ["gilogbak"] }] });
    if (typeof r === "string") {
      setImportPath(r);
      setMsg("");
    }
  }

  async function doImport(e: FormEvent) {
    e.preventDefault();
    try {
      await api.importBackup(importPath, pw);
      setImportPath("");
      setPw("");
      setNote("백업을 불러왔어요. 그 백업의 비밀번호로 다시 열어 주세요.");
      onLocked();
    } catch (err) {
      setMsg(errorText(err));
    }
  }

  return (
    <>
      <Row k="복원" label="백업" desc="암호화된 파일 하나로 내보내고 다시 불러와요. 불러오면 지금 자료가 백업 내용으로 바뀌어요." last={!importPath}>
        <button type="button" className="btn" onClick={doExport} disabled={!inApp}>
          백업 내보내기
        </button>
        <button type="button" className="btn" onClick={pickImport} disabled={!inApp}>
          불러오기
        </button>
      </Row>
      {importPath && (
        <form className="pw-form row row-last" onSubmit={doImport}>
          <span className="small">{importPath}</span>
          <label className="field">
            <span>이 백업을 만들 때의 비밀번호</span>
            <input id="import-pw" className="input" type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <div className="pw-foot">
            <span className="gate-error" role="status">
              {msg}
            </span>
            <button type="button" className="btn" onClick={() => setImportPath("")}>
              취소
            </button>
            <button type="submit" className="btn-primary btn-sm">
              불러오기
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function X() {
  return (
    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Plus({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// ---------- 민원처리 카드 (10단계) ----------

const PROCESS_DIRS: { key: "root" | "inbox" | "downloads" | "outbox"; label: string; desc: string }[] = [
  { key: "root", label: "민원 폴더", desc: "사진·지시부를 이 폴더에 접수일_위치_보수내용 이름으로 둬요." },
  { key: "inbox", label: "가져올 폴더", desc: "Claude가 신문고에서 읽은 민원을 한 건씩 놓는 곳이에요." },
  { key: "downloads", label: "다운로드 폴더", desc: "크롬이 신문고 첨부 사진을 받는 곳이에요." },
  { key: "outbox", label: "보낼 폴더", desc: "[폰 전송]이 지시부 JPG를 두는 곳이에요. Claude 앱 \"민원처리\" 대화가 폰으로 올려요." },
];

// ---------- 주소 변환 (민원대장 · 2026-10-21 주소 변환 웹 세션, docs/qa/address-web.md 8절) ----------

const hm = (iso?: string) => (iso ? iso.slice(5, 10) + " " + new Date(iso).toTimeString().slice(0, 5) : "");

function AddressRows() {
  const [key, setKey] = useState<string | null>(null);
  const [st, setSt] = useState<(WebStatus & { cooling: boolean }) | null>(null);
  const [tbl, setTbl] = useState<RoadTableInfo | null>(null);
  const [msg, setMsg] = useState("");
  const [tblMsg, setTblMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    webKey().then(setKey, () => setKey(""));
    webStatus().then(setSt, () => undefined);
    api.roadTableInfo().then(setTbl, () => undefined);
  }, []);

  async function saveKey(v: string) {
    const t = v.trim();
    if (t === (key ?? "")) return;
    await setWebKey(t);
    setKey(t);
    setMsg("");
    setSt(await webStatus());
  }

  async function test() {
    if (busy) return;
    setBusy(true);
    setMsg("찾는 중…");
    const r = await testWeb();
    setMsg(r.ok ? `됐어요 · ${PATH_NAME[r.path]} · ${(r.ms / 1000).toFixed(1)}초${r.place ? ` · 시청로 50 → ${r.place}` : ""}` : `안 돼요 – ${r.why}`);
    setSt(await webStatus());
    setBusy(false);
  }

  async function pickFile() {
    if (!inApp) {
      setTbl(await api.roadTableImport(""));
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, title: "주소 자료 (경기도 도로명주소 한글 전체자료)", filters: [{ name: "글자 파일", extensions: ["txt"] }] });
    if (typeof r !== "string") return;
    setBusy(true);
    setTblMsg("바꾸는 중…");
    try {
      setTbl(await api.roadTableImport(r));
      setTblMsg("");
    } catch (e) {
      const m = /^few:(\d+)$/.exec(String(e));
      setTblMsg(m ? `파주시 주소가 ${Number(m[1]).toLocaleString()}곳뿐이에요 – 경기도 전체자료가 맞는지 봐 주세요` : errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const state = !key
    ? "승인키가 없으면 내장 표만 써요"
    : st?.cooling
      ? `웹이 안 돼서 10분 동안 내장 표만 써요${st.failWhy ? ` (${st.failWhy})` : ""}`
      : st?.okAt && (!st.failAt || st.okAt > st.failAt)
        ? `마지막 성공 ${hm(st.okAt)} · ${PATH_NAME[st.okPath ?? "fetch"]}`
        : st?.failAt
          ? `마지막 실패 ${hm(st.failAt)}${st.failWhy ? ` – ${st.failWhy}` : ""}`
          : "주소 글만 행안부 주소정보누리집으로 보내요";

  return (
    <>
      <Row label="웹에서 주소 찾기" desc={msg || state} k="주소 변환 도로명 지번 승인키 주소정보누리집 juso">
        <span className="proc-dir">
          {key !== null && (
            <input
              key={key}
              className="input"
              data-ime="en"
              aria-label="주소정보누리집 승인키"
              placeholder="승인키 붙여 넣기"
              spellCheck={false}
              defaultValue={key}
              onBlur={(e) => saveKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          )}
          <button type="button" className="btn btn-xs" onClick={test} disabled={busy || !key}>
            시험
          </button>
        </span>
      </Row>
      <Row
        label="주소 자료"
        desc={tblMsg || (tbl ? `${tbl.custom ? "바꾼 자료" : "앱에 든 자료"} ${tbl.date} · 파주시 ${tbl.count.toLocaleString()}곳 · 웹이 안 될 때 써요` : "")}
        k="주소 자료 갱신 전체자료 경기도"
        last
      >
        <span className="proc-dir">
          <button type="button" className="btn btn-xs" onClick={pickFile} disabled={busy}>
            파일로 바꾸기
          </button>
          {tbl?.custom && (
            <button type="button" className="btn btn-xs" onClick={async () => setTbl(await api.roadTableReset())} disabled={busy}>
              앱 자료로
            </button>
          )}
        </span>
      </Row>
    </>
  );
}

function ProcessRows({ p, onChange }: { p: ProcessSettings; onChange: (p: ProcessSettings) => void }) {
  const [copied, setCopied] = useState<"ai" | "phone" | null>(null);
  async function copyGuide(which: "ai" | "phone") {
    const text = which === "ai" ? aiGuide(p, (await api.processData()).works) : phoneGuide(p);
    await navigator.clipboard.writeText(text);
    setCopied(which);
    window.setTimeout(() => setCopied(null), 2000);
  }
  const text = (k: keyof ProcessSettings, v: string) => {
    const t = v.trim();
    if (t !== p[k]) onChange({ ...p, [k]: t });
  };
  async function pick(k: "root" | "inbox" | "downloads" | "outbox", title: string) {
    if (!inApp) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ directory: true, title, defaultPath: p[k] || undefined });
    if (typeof r === "string") onChange({ ...p, [k]: r });
  }
  async function pickTpl() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const r = await open({ multiple: false, title: "지시부 양식", filters: [{ name: "한글 hwpx", extensions: ["hwpx"] }] });
    if (typeof r === "string") onChange({ ...p, tpl: r });
  }
  return (
    <>
      <Row label="지시부 양식" desc="모든 공사가 표준 양식 하나를 써요(hwpx). 비워 두면 앱에 들어 있는 표준 양식이에요.">
        <span className="proc-dir">
          <span className="proc-tpl" title={p.tpl || undefined}>
            {p.tpl ? p.tpl.split(/[\\/]/).pop() : "표준 양식(앱에 들어 있음)"}
          </span>
          {inApp && (
            <button type="button" className="btn btn-xs" onClick={pickTpl}>
              고르기
            </button>
          )}
          {p.tpl && (
            <button type="button" className="btn btn-xs" onClick={() => onChange({ ...p, tpl: "" })}>
              기본으로
            </button>
          )}
        </span>
      </Row>
      <Row label="메일 제목" desc="{자리}는 그 지시부 값으로 바뀌어요." k="메일 korea">
        <span className="proc-dir">
          <input
            key={p.mailSubject}
            className="input proc-mail-subject"
            aria-label="메일 제목"
            defaultValue={p.mailSubject}
            onBlur={(e) => {
              const t = e.target.value.trim();
              if (t !== p.mailSubject) onChange({ ...p, mailSubject: t || DEFAULT_MAIL_SUBJECT });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </span>
      </Row>
      <Row
        label="메일 본문"
        desc={`자리: ${MAIL_FIELDS.map((f) => `{${f}}`).join(" ")}`}
        k="메일 korea 본문"
      >
        <span className="proc-dir proc-mail">
          <textarea
            key={p.mailBody}
            className="input proc-mail-body"
            aria-label="메일 본문"
            rows={4}
            defaultValue={p.mailBody}
            onBlur={(e) => {
              const t = e.target.value.replace(/\s+$/, "");
              if (t !== p.mailBody) onChange({ ...p, mailBody: t || DEFAULT_MAIL_BODY });
            }}
          />
          {(p.mailSubject !== DEFAULT_MAIL_SUBJECT || p.mailBody !== DEFAULT_MAIL_BODY) && (
            <button type="button" className="btn btn-xs" onClick={() => onChange({ ...p, mailSubject: DEFAULT_MAIL_SUBJECT, mailBody: DEFAULT_MAIL_BODY })}>
              기본으로
            </button>
          )}
        </span>
      </Row>
      {PROCESS_DIRS.map((d) => (
        <Row key={d.key} label={d.label} desc={d.desc}>
          <span className="proc-dir">
            <input
              key={p[d.key]}
              className="input"
              aria-label={d.label}
              data-ime="en"
              defaultValue={p[d.key]}
              onBlur={(e) => text(d.key, e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            {inApp && (
              <button type="button" className="btn btn-xs" onClick={() => pick(d.key, d.label)}>
                고르기
              </button>
            )}
          </span>
        </Row>
      ))}
      <Row label="Claude 실행 파일" desc="[민원 불러오기]가 실행하는 Claude Code예요. 보통 그대로 두면 돼요.">
        <span className="proc-dir">
          <input
            key={p.claude}
            className="input"
            aria-label="Claude 실행 파일"
            data-ime="en"
            defaultValue={p.claude}
            onBlur={(e) => text("claude", e.target.value || "claude")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </span>
      </Row>
      <Row label="Claude 모델" desc="[민원 불러오기]·메일 보내기가 쓰는 모델이에요. 느리면 Sonnet, 판단이 아쉬우면 Opus.">
        <span className="seg" role="radiogroup" aria-label="Claude 모델">
          {(
            [
              ["sonnet", "Sonnet · 빠름"],
              ["opus", "Opus · 꼼꼼"],
              ["haiku", "Haiku · 가장 빠름"],
            ] as const
          ).map(([id, name]) => (
            <button key={id} type="button" role="radio" aria-checked={(p.claudeModel ?? "sonnet") === id} onClick={() => onChange({ ...p, claudeModel: id })}>
              {name}
            </button>
          ))}
        </span>
      </Row>
      <Row label="AI 지침" desc="[민원 불러오기]가 Claude에게 주는 지침이에요. 다른 AI에 붙여 넣어 써도 돼요.">
        <span className="proc-dir">
          {copied === "ai" && <span className="muted small">복사했어요</span>}
          <button type="button" className="btn btn-xs" onClick={() => copyGuide("ai")}>
            지침 복사
          </button>
        </span>
      </Row>
      <Row label="폰 전송 지침" desc="Claude 앱 &quot;민원처리&quot; 대화(PC에 이어진 대화)에 처음 한 번 붙여 넣어요. 그 뒤엔 &quot;보내&quot;라고 하면 지시부 JPG를 올려 줘요." last>
        <span className="proc-dir">
          {copied === "phone" && <span className="muted small">복사했어요</span>}
          <button type="button" className="btn btn-xs" onClick={() => copyGuide("phone")}>
            지침 복사
          </button>
        </span>
      </Row>
    </>
  );
}
