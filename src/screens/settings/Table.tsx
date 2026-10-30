// 설정 – 카드·줄 부품: 모듈·키 카드, 구글·탐색기·민원처리·주소 줄, 목록 묶음(ListGroup·KindsGroup), PIN·저장 위치·백업 줄. 화면 몸통은 Screen.tsx.
import { FormEvent, Fragment, Ref, useEffect, useRef, useState } from "react";
import { ChoiceInput } from "../../PlaceInputs";
import { PATH_NAME, setWebKey, testWeb, webKey, webStatus, WebStatus } from "../../addressWeb";
import { api, BackupInfo, errorText, inApp, RoadTableInfo } from "../../api";
import { splitJamo } from "../../journal";
import { DEFAULT_MAIL_BODY, DEFAULT_MAIL_SUBJECT, MAIL_FIELDS, Kind, MEMO_KIND, ProcessSettings, FilesSettings, STATUS_COLORS } from "../../settingsStore";
import { aiGuide, phoneGuide } from "../../process";
import { isOn, MODULE_DESC, ModuleId, Modules, onScreens, SCREENS } from "../../screens";
import { NavIcon, NavIconName } from "../../Icons";
import { DATE_FORMATS, FsDrive, HOME, PC } from "../../files";
import { FastStatus, fsApi } from "../../filesApi";
import { useOutsideClose } from "../../useOutsideClose";
import { Action, appKeyName, conflicts, DEFAULT_KEYS, diffKeys, isRightAlt, KEY_GROUPS, KeyMap, mergeKeys } from "../../keys";
import { AskBand } from "../../AskBand";
import { BusyButton, BusyNote, useBusy } from "../../BusyButton";
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
} from "../../google";
import { Row, Toggle, PIN_CHANGED, X } from "./parts";

// ---------- 모듈 켜고 끄기 (2026-10-18 설정 세션, 시안 Settings) ----------

/** 공통 맨 위 "모듈" 카드: 사이드바 순서·묶음대로 스위치. 적어도 하나는 켜져 있어야 해요. 설정은 끌 수 없어 줄이 없어요. */
export function ModulesCard({ value, onChange }: { value: Modules; onChange: (m: Modules) => void }) {
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
export function ModuleCard({ id, name, off, gap, children }: { id: ModuleId; name: string; off: boolean; gap: boolean; children: React.ReactNode }) {
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

const APP_HINT = "Ctrl이나 왼쪽 Alt와 글자 키를 함께 눌러요(예: Ctrl+L)";

/**
 * 동작마다 키를 골라요: 칸을 누르고 키를 직접 눌러요. 쓰는 곳마다 작은 상자(두 단).
 * 같은 키가 "그 묶음 + 공통"에서 겹치면 두 칸 모두 빨간 테두리이고 저장하지 않아요(앱은 그 전 키 그대로).
 */
export function KeysCard({ saved, onSave }: { saved: Partial<Record<string, string>>; onSave: (keys: Partial<KeyMap>) => void }) {
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
    if (a.startsWith("app.")) {
      // 앱 단축키(잠그기)는 Ctrl·왼쪽 Alt + 글자 키(공통 ✔4)
      const k = appKeyName(e);
      return k ? assign(a, k) : setNote(APP_HINT);
    }
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

/** 구글 캘린더 연동 – 설정 "캘린더" 모듈 카드 안에 줄로 들어가요(카드 아님). */
export function GoogleRows() {
  const [g, setG] = useState<GStatus | null>(null);
  const [opts, setOpts] = useState<GOpts>(DEFAULT_OPTS);
  const [msg, setMsg] = useState("");
  const [ask, setAsk] = useState(false);
  // 느린 단추(10-30 22:47): login·cut-keep·cut-del·export·gtasks – 하나가 도는 동안 다른 구글 단추는 잠겨요.
  const b = useBusy();

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
    await b.run("login", () => connectGoogle(opts.gtasks));
    setMsg("");
  }

  async function cut(removeEvents: boolean) {
    // 묻는 띠는 끝날 때까지 그대로 두고, 누른 단추만 "…하는 중"으로 바뀌어요.
    setMsg("");
    await b.run(removeEvents ? "cut-del" : "cut-keep", () => disconnectGoogle(removeEvents), removeEvents ? "연결을 끊고 구글의 giLog 캘린더를 지웠어요" : "연결을 끊었어요 – 구글의 일정은 그대로 있어요");
    setAsk(false);
  }

  async function toggle(k: keyof GOpts) {
    if (b.busy) return;
    const next = { ...opts, [k]: !opts[k] };
    // 구글 할 일을 켜는데 지금 로그인에 할 일 권한이 없으면, 권한을 더 받는 로그인부터 해요.
    if (k === "gtasks" && next.gtasks && (await needsTasksLogin())) {
      setMsg("브라우저에서 구글 할 일 권한을 허용해 주세요.");
      const ok = await b.run("gtasks", () => connectGoogle(true));
      setMsg("");
      if (!ok) return;
    }
    setOpts(next);
    saveOpts(next);
  }

  if (!g) return null;
  const exporting = b.is("export") || g.busy;
  const sub = exporting ? "내보내는 중…" : g.lastError || (g.lastOk ? `기록 → 구글 한 방향 · 마지막 내보내기 ${whenText(g.lastOk)}` : "기록 → 구글 한 방향");
  const cutting = b.is("cut-keep") || b.is("cut-del");
  const note = (keys: string[], noLate = false) => <BusyNote busy={!!b.busy && keys.includes(b.busy)} late={b.late} flash={b.flash && keys.includes(b.flash.key) ? b.flash : null} noLate={noLate} />;

  return (
    <>
      <div className="set-sub" data-k="구글 캘린더 연동 할 일">
        구글 연동
      </div>
      {g.connected ? (
        <div className="row g-row" data-k="구글 연결 끊기 내보내기">
          <span className={"g-dot" + (g.lastError ? " bad" : "")} aria-hidden="true" />
          <span className="row-text">
            <span className="row-label">{g.lastError ? "연결됨 · 내보내지 못했어요" : "연결됨 · 개인 구글 계정"}</span>
            <span className={"small " + (g.lastError && !exporting ? "g-err" : "muted")}>{sub}</span>
          </span>
          {!ask ? (
            <>
              {note(["export", "login", "cut-keep", "cut-del"], b.is("login"))}
              {g.lastError.includes("다시 로그인") && (
                <BusyButton className="btn btn-primary g-login" busy={b.is("login")} busyText="로그인 기다리는 중…" disabled={!!b.busy} onClick={login}>
                  다시 로그인
                </BusyButton>
              )}
              <BusyButton busy={exporting} busyText="내보내는 중…" disabled={!!b.busy} onClick={() => void b.run("export", exportNow)}>
                지금 내보내기
              </BusyButton>
              <button type="button" className="btn g-cut" disabled={!!b.busy || g.busy} onClick={() => setAsk(true)}>
                연결 끊기
              </button>
            </>
          ) : (
            <span className="ask-row">
              <span className="gate-error">구글에 내보낸 일정도 지울까요?</span>
              <button type="button" className="btn" disabled={cutting} onClick={() => setAsk(false)}>
                취소
              </button>
              <BusyButton busy={b.is("cut-keep")} busyText="끊는 중…" disabled={cutting} onClick={() => void cut(false)}>
                일정은 두기
              </BusyButton>
              <BusyButton className="btn btn-danger" busy={b.is("cut-del")} busyText="지우는 중…" disabled={cutting} onClick={() => void cut(true)}>
                일정도 지우기
              </BusyButton>
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
            {note(["cut-keep", "cut-del", "login"], true)}
            <BusyButton className="btn btn-primary g-login" busy={b.is("login")} busyText="로그인 기다리는 중…" disabled={!g.configured || !!b.busy || !inApp} onClick={login}>
              구글 로그인
            </BusyButton>
          </Row>
        </>
      )}
      {ask && cutting && <BusyNote line busy late={b.late} flash={null} />}
      {msg && (
        <p className="g-msg small" role="status">
          {msg}
        </p>
      )}
      {G_TOGGLES.map(([k, label, desc]) => (
        <Toggle key={k} k="구글" label={label} desc={k === "gtasks" && b.is("gtasks") ? "로그인 기다리는 중…" : desc} on={opts[k]} disabled={!!b.busy} onChange={() => void toggle(k)} />
      ))}
      {b.flash?.key === "gtasks" && !b.flash.ok && (
        <p className="g-msg small busy-fail" role="status">
          {b.flash.text}
        </p>
      )}
      <p className="g-foot small" data-k="구글">
        민원인 이름과 연락처는 어떤 경우에도 구글로 내보내지 않아요. 내보낸 일정은 시청 밖 구글 서버에 저장돼요.
      </p>
    </>
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
      <BusyButton className="btn btn-ctrl" busy={busy.endsWith("…")} busyText="설치하는 중…" disabled={f === undefined} onClick={() => void install()}>
        설치
      </BusyButton>
    </Row>
  );
}

export function FilesRows({ value, onChange }: { value: FilesSettings; onChange: (v: FilesSettings) => void }) {
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
      <Toggle
        label="끌 때 열린 탭 비우기"
        desc="켜면 프로그램을 다시 켤 때 고정한 탭만 남아요. 고정 탭이 없는 창은 새 탭 폴더로 열려요."
        on={!!value.clearOnExit}
        onChange={(clearOnExit) => set({ clearOnExit })}
      />
    </>
  );
}

/** 받침이 있으면 "을", 없으면 "를" */
function eulReul(w: string) {
  const c = w.charCodeAt(w.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? "을" : "를";
}

/** 지울 때 합치기(2026-10-28 민원대장 ✔1): 그 값을 쓰는 민원 수와, 다른 값으로 한 번에 바꾸는 일 */
export type ListMerge = { used: (name: string) => number; run: (from: string, to: string) => Promise<void> };

/**
 * 목록 묶음(상태·접수유형·민원유형). ×를 누르면 "지울까요?"를 물어요(2026-10-17 사용자 – 다른 화면과 같게).
 * stack이면 관리 창 모양: 배지 아래 줄에 넓은 추가 칸과 "＋ 추가" 단추.
 * merge가 있으면 그 값을 쓰는 민원이 있을 때 띠가 두 줄 – "어느 값으로 합칠까요?" + 합칠 값 고르기 + [합치고 지우기].
 */
export function ListGroup({
  title,
  desc,
  items,
  keep,
  colored,
  last,
  stack,
  merge,
  onChange,
}: {
  title: string;
  desc?: string;
  items: string[];
  keep?: string;
  colored?: boolean;
  last?: boolean;
  stack?: boolean;
  merge?: ListMerge;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [ask, setAsk] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const askFor = (name: string | null) => {
    setAsk(name);
    setTo("");
  };
  const band = useRef<HTMLDivElement>(null);
  // Esc와 바깥 누르기는 묻는 띠만 접어요(창 전체의 Esc보다 먼저 받아요).
  useOutsideClose(ask !== null, [band], () => askFor(null), {
    onEsc: (e) => {
      if (e.isComposing) return;
      // 합칠 값 목록이 열려 있으면 Esc는 목록만 닫아요(고르기 칸이 받아요).
      if (band.current?.querySelector('[aria-expanded="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      askFor(null);
    },
    escCapture: true,
  });
  /** 지우기(쓰는 민원이 있고 합칠 곳이 있으면 먼저 합치고, 합치기에 실패하면 지우지 않아요) */
  async function confirm() {
    if (ask === null || busy) return;
    const others = items.filter((x) => x !== ask);
    if (merge && merge.used(ask) > 0 && others.length > 0) {
      if (!others.includes(to)) return;
      setBusy(true);
      try {
        await merge.run(ask, to);
      } catch {
        return;
      } finally {
        setBusy(false);
      }
    }
    onChange(others);
    askFor(null);
  }

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
              className={"chip" + (c ? " chip-colored" : "") + (name === keep ? " chip-keep" : "") + (name === ask ? " chip-asking" : "")}
              style={c ? { background: c[0], color: c[1] } : undefined}
            >
              {name}
              {name !== keep && (
                <button type="button" className="chip-x" aria-label={`${name} 삭제`} onClick={() => askFor(name)}>
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
        <ListAsk title={title} name={ask} items={items} merge={merge} to={to} setTo={setTo} busy={busy} bandRef={band} onNo={() => askFor(null)} onYes={confirm} />
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

/** 분류 지우기 띠: 쓰는 민원이 없으면 "지울까요?", 있으면 합칠 값을 고르는 두 줄 띠(2026-10-28 ✔1) */
function ListAsk({
  title,
  name,
  items,
  merge,
  to,
  setTo,
  busy,
  bandRef,
  onNo,
  onYes,
}: {
  title: string;
  name: string;
  items: string[];
  merge?: ListMerge;
  to: string;
  setTo: (v: string) => void;
  busy: boolean;
  bandRef: Ref<HTMLDivElement>;
  onNo: () => void;
  onYes: () => void;
}) {
  const q = `"${name}"${eulReul(name)}`;
  const n = merge?.used(name) ?? 0;
  const others = items.filter((x) => x !== name);
  if (!merge) return <AskBand bandRef={bandRef} className="list-ask" label={`${title} 지우기 확인`} text={`${q} 지울까요? 이미 적은 민원은 그대로예요.`} onNo={onNo} onYes={onYes} />;
  if (n === 0 || others.length === 0) {
    const text = n === 0 ? `${q} 지울까요? 쓰는 민원은 없어요.` : `${q} 지울까요? 쓰던 민원 ${n}건은 값이 그대로 남아요.`;
    return <AskBand bandRef={bandRef} className="list-ask" label={`${title} 지우기 확인`} text={text} onNo={onNo} onYes={onYes} />;
  }
  return (
    <AskBand
      bandRef={bandRef}
      className="list-ask"
      label={`${title} 합치고 지우기 확인`}
      text={`${q} 쓰는 민원이 ${n}건 있어요. 어느 값으로 합칠까요?`}
      yes="합치고 지우기"
      yesDisabled={busy || !others.includes(to)}
      extra={
        <div className="ask-merge-pick">
          합칠 값
          <ChoiceInput name="merge-to" label="합칠 값" placeholder="고르세요" value={to} options={others} stayOnTab onChange={setTo} />
        </div>
      }
      onNo={onNo}
      onYes={onYes}
    />
  );
}

export function KindsGroup({ kinds, onChange }: { kinds: Kind[]; onChange: (k: Kind[]) => void }) {
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

/**
 * "윈도우 PIN으로 잠금 풀기" (2026-10-18 사용자 확정, 캔버스 Lock 판). 이 PC만이고 처음엔 꺼짐.
 * 켜기: 비밀번호 한 번 확인 → Hello 창 → 보관. 끄면 보관한 것을 지워요. 이 PC에서 못 쓰면 흐리게.
 */
export function PinRow() {
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

async function pickFolder(): Promise<string | null> {
  if (!inApp) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, title: "기록 자료를 둘 폴더" });
  return typeof r === "string" ? r : null;
}

export function FolderRow({ folder, onLocked, setNote }: { folder: string; onLocked: () => void; setNote: (s: string) => void }) {
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

/** 자동 백업 줄(2026-10-29 자료 안전 ✔1): 앱을 열 때 하루 한 번, 자료 폴더 옆 backup 폴더에 최근 7개. */
export function AutoBackupRow({ setNote }: { setNote: (s: string) => void }) {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  useEffect(() => {
    api.backupInfo().then(setInfo, () => setInfo(null));
  }, []);
  const last = info?.latest ? ` · 마지막 ${Number(info.latest.slice(5, 7))}월 ${Number(info.latest.slice(8))}일` : "";
  return (
    <Row k="자동 백업 backup 복원 되살리기" label="자동 백업" desc={`앱을 열 때 하루 한 번 저장해요 · 최근 7개${last}`}>
      <button type="button" className="btn" onClick={() => api.openBackupFolder().catch((e) => setNote(errorText(e)))} disabled={!inApp}>
        폴더 열기
      </button>
    </Row>
  );
}

export function BackupRow({ onLocked, setNote }: { onLocked: () => void; setNote: (s: string) => void }) {
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

export function AddressRows() {
  const [key, setKey] = useState<string | null>(null);
  const [st, setSt] = useState<(WebStatus & { cooling: boolean }) | null>(null);
  const [tbl, setTbl] = useState<RoadTableInfo | null>(null);
  const [msg, setMsg] = useState("");
  const [tblMsg, setTblMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

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
    setTesting(true);
    setMsg("");
    const r = await testWeb();
    setTesting(false);
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
          <BusyButton className="btn btn-xs" small busy={testing} busyText="찾는 중…" onClick={test} disabled={busy || !key}>
            시험
          </BusyButton>
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

export function ProcessRows({ p, onChange }: { p: ProcessSettings; onChange: (p: ProcessSettings) => void }) {
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
