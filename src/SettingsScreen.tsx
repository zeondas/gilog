import { FormEvent, useEffect, useState } from "react";
import { api, DEFAULT_PREFS, errorText, inApp, Prefs, Status } from "./api";
import { DEFAULT_SETTINGS, Kind, loadSettings, saveSettings, Settings, STATUS_COLORS } from "./settingsStore";
import { SCREENS } from "./screens";

type Props = {
  prefs: Prefs;
  onPrefs: (p: Prefs) => Promise<void>;
  status: Status;
  onLocked: () => void;
};

const KEEP_STATUS = "완료";

export default function SettingsScreen({ prefs, onPrefs, status, onLocked }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [ask, setAsk] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    loadSettings().then(setS);
  }, []);

  async function update(next: Settings) {
    setS(next);
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
    await onPrefs({ ...DEFAULT_PREFS, dataDir: prefs.dataDir, askPassword: prefs.askPassword });
    setNote("기본값으로 되돌렸어요.");
  }

  if (!s) return null;

  return (
    <>
      <div className="title-row">
        <h1 className="title">설정</h1>
        <span className="muted small title-sub">바꾸면 바로 저장돼요.</span>
        {!ask ? (
          <button type="button" className="btn" onClick={() => setAsk(true)}>
            기본값으로 되돌리기
          </button>
        ) : (
          <span className="ask-row">
            <span className="gate-error">설정을 모두 처음 값으로 되돌릴까요? 암호와 저장한 자료는 그대로예요.</span>
            <button type="button" className="btn" onClick={() => setAsk(false)}>
              취소
            </button>
            <button type="button" className="btn btn-danger" onClick={resetAll}>
              되돌리기
            </button>
          </span>
        )}
      </div>
      {note && (
        <p className="muted small" role="status">
          {note}
        </p>
      )}

      <section className="card">
        <div className="card-head">
          민원대장 항목 <span className="muted small head-sub">입력 줄의 선택 목록에 그대로 나와요.</span>
        </div>
        <ListGroup
          title="상태"
          desc="색은 자동으로 붙어요. 완료는 지울 수 없어요."
          items={s.status}
          keep={KEEP_STATUS}
          colored
          onChange={(status) => update({ ...s, status })}
        />
        <ListGroup title="접수유형" items={s.intake} onChange={(intake) => update({ ...s, intake })} />
        <ListGroup title="민원유형" items={s.ctype} onChange={(ctype) => update({ ...s, ctype })} last />
      </section>

      <section className="card">
        <div className="card-head">업무일지</div>
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
        <KindsGroup kinds={s.kinds} onChange={(kinds) => update({ ...s, kinds })} />
      </section>

      <section className="card">
        <div className="card-head">구글 캘린더 연동</div>
        <div className="card-body">
          <p className="muted">9단계에서 만들어요. 민원인 이름과 연락처는 어떤 경우에도 구글로 내보내지 않아요.</p>
        </div>
      </section>

      <section className="card">
        <div className="card-head">보안 · 저장</div>
        <Toggle
          label="앱을 열 때 암호 묻기"
          desc={
            prefs.askPassword
              ? "민원인 개인정보가 들어 있어 켜 두는 것을 권해요."
              : "끄면 열쇠를 윈도우 자격 증명 관리자에 맡겨요. 이 윈도우 계정으로 로그인한 사람만 열 수 있어요."
          }
          on={prefs.askPassword}
          onChange={(v) => setPref("askPassword", v)}
        />
        <Toggle
          label="자동 잠금"
          desc="끄면 자리를 오래 비워도 잠기지 않아요."
          on={prefs.autoLock}
          onChange={(v) => setPref("autoLock", v)}
        />
        {prefs.autoLock && (
          <Row label="잠기기까지 시간" desc="자리를 비운 뒤 이 시간이 지나면 잠겨요.">
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

      <section className="card">
        <div className="card-head">화면</div>
        <Row label="테마" desc="시스템은 윈도우의 밝게·어둡게 설정을 따라가요.">
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
        </Row>
        <Row label="시작 화면" desc="앱을 켰을 때 먼저 보이는 화면이에요.">
          <select
            id="start-screen"
            className="input"
            value={prefs.startScreen}
            onChange={(e) => setPref("startScreen", e.target.value)}
          >
            {SCREENS.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </Row>
        <Row label="글자 크기" desc="모든 화면에 함께 적용돼요.">
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
        <Row label="민원 마감 임박 표시" desc="마감이 이 날짜 안으로 들어오면 빨갛게 보여요." last>
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
      </section>
    </>
  );
}

// ---------- 부품 ----------

function Row({
  label,
  desc,
  children,
  last,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={"row" + (last ? " row-last" : "")}>
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
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className="row row-btn" onClick={() => onChange(!on)}>
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

function ListGroup({
  title,
  desc,
  items,
  keep,
  colored,
  last,
  onChange,
}: {
  title: string;
  desc?: string;
  items: string[];
  keep?: string;
  colored?: boolean;
  last?: boolean;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    setDraft("");
    onChange([...items, v]);
  }
  return (
    <div className={"group" + (last ? " row-last" : "")}>
      <div className="group-head">
        <span className="row-label">{title}</span>
        {desc && <span className="muted small">{desc}</span>}
      </div>
      <div className="chips">
        {items.map((name) => {
          const c = colored ? STATUS_COLORS[name] ?? ["var(--st-new-bg)", "var(--st-new-fg)"] : null;
          return (
            <span
              key={name}
              className={"chip" + (c ? " chip-colored" : "")}
              style={c ? { background: c[0], color: c[1] } : undefined}
            >
              {name}
              {name !== keep && (
                <button type="button" className="chip-x" aria-label={`${name} 삭제`} onClick={() => onChange(items.filter((x) => x !== name))}>
                  <X />
                </button>
              )}
            </span>
          );
        })}
        <span className="chip-add">
          <input
            className="input input-sm"
            aria-label={`${title} 추가`}
            placeholder="새 항목"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <button type="button" className="btn-icon" aria-label={`${title} 추가`} onClick={add}>
            <Plus />
          </button>
        </span>
      </div>
    </div>
  );
}

function KindsGroup({ kinds, onChange }: { kinds: Kind[]; onChange: (k: Kind[]) => void }) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  function add() {
    const n = name.trim();
    if (!n || kinds.some((k) => k.name === n)) return;
    onChange([...kinds, { name: n, key: key.trim() }]);
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
            <button type="button" className="chip-x" aria-label={`${k.name} 삭제`} onClick={() => onChange(kinds.filter((x) => x.name !== k.name))}>
              <X />
            </button>
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
        <input className="input" aria-label="새 구분 이름" placeholder="새 구분 (예: 현장확인)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: "1 1 160px", maxWidth: 220 }} />
        <input className="input" aria-label="새 구분 초성" placeholder="초성 (예: ㅎㅈ)" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 120 }} />
        <button type="submit" className="btn-primary btn-sm">
          <Plus /> 추가
        </button>
      </form>
    </div>
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
      setMsg("새 암호 두 개가 서로 달라요.");
      return;
    }
    try {
      await api.changePassword(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setAgain("");
      setOk(true);
      setMsg("암호를 바꿨어요.");
      setOpen(false);
    } catch (err) {
      setMsg(err === "wrong_password" ? "지금 암호가 맞지 않아요." : errorText(err));
    }
  }

  return (
    <>
      <Row label="잠금 암호" desc={ok ? msg : "앱을 열 때 묻는 암호예요. 잊으면 되찾을 수 없어요."}>
        <button type="button" className="btn" onClick={() => setOpen(!open)}>
          암호 바꾸기
        </button>
      </Row>
      {open && (
        <form className="pw-form row" onSubmit={submit}>
          <label className="field">
            <span>지금 암호</span>
            <input id="pw-old" className="input" type="password" autoFocus value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </label>
          <label className="field">
            <span>새 암호</span>
            <input id="pw-new" className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </label>
          <label className="field">
            <span>새 암호 확인</span>
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
  const r = await open({ directory: true, title: "giLog 자료를 둘 폴더" });
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
    <Row label="저장 위치" desc={`${folder} · 암호화해서 이 PC에만 저장해요.`}>
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
      filters: [{ name: "giLog 백업", extensions: ["gilogbak"] }],
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
    const r = await open({ title: "불러올 백업 파일", filters: [{ name: "giLog 백업", extensions: ["gilogbak"] }] });
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
      setNote("백업을 불러왔어요. 그 백업의 암호로 다시 열어 주세요.");
      onLocked();
    } catch (err) {
      setMsg(errorText(err));
    }
  }

  return (
    <>
      <Row label="백업" desc="암호화된 파일 하나로 내보내고 다시 불러와요. 불러오면 지금 자료가 백업 내용으로 바뀌어요." last={!importPath}>
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
            <span>이 백업을 만들 때의 암호</span>
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
    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Plus() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
