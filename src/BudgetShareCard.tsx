// 설정 › 모듈별 › 집행현황 카드 – 팀 공유(2026-10-20 사용자, 시안 BudgetShare.dc.html ③·④)
// 공유 켜기 · 공유 시트(호스트는 [새로 만들기]·[공유 끝내기], 팀원은 주소 붙여 넣고 [연결]·[공유에서 나가기]) ·
// 함께 쓰는 사람(누구나 더하기·두 번 눌러 고치기, 내보내기는 호스트만 – 2026-10-30 ②2안) · 고친 사람 이름 · 마지막 새로고침.
import { KeyboardEvent, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { inApp } from "./api";
import { BusyButton, BusyNote, useBusy } from "./BusyButton";
import {
  addPerson,
  backupInfo,
  createSheet,
  editPerson,
  endShare,
  grantHostScope,
  joinSheet,
  leaveShare,
  offerHost,
  onShare,
  Person,
  refreshShare,
  reloginShare,
  removePerson,
  restoreBackup,
  setShareOn,
  shareActive,
  shareErrorText,
  ShareState,
  sheetUrl,
  shortTime,
  statusOf,
  STATUS_TEXT,
  takeHost,
} from "./budgetShare";

const errText = (e: unknown) => (e instanceof Error && /[가-힣]/.test(e.message) && !e.message.startsWith("새로고침") ? e.message : shareErrorText(e));

export function BudgetShareRows({ myName }: { myName: string }) {
  const [st, setSt] = useState<ShareState | null>(null);
  const [addr, setAddr] = useState("");
  const [msg, setMsg] = useState("");
  // 느린 단추(10-30 22:47): 누른 단추가 "…하는 중"으로 바뀌고, 하나가 도는 동안 카드의 다른 공유 단추는 잠겨요.
  const b = useBusy();
  const wait = !!b.busy;
  const [edit, setEdit] = useState<{ no: number; name: string; mail: string } | null>(null);
  const [add, setAdd] = useState({ name: "", mail: "" });
  const [ask, setAsk] = useState<{ t: "remove" | "new" | "leave"; no: number } | null>(null);
  const [hostPick, setHostPick] = useState(false);
  const [backup, setBackup] = useState<{ at: string; n: number } | null>(null);
  // 시험용 두 번째 기록(2026-10-25 사용자 – 한 PC에서 두 구글 계정으로 팀 공유 시험): 이 창이 시험 창이면 그 이름("B")
  const [twin, setTwin] = useState<string | null>(null);
  useEffect(() => {
    if (inApp) invoke<string | null>("profile_name").then(setTwin, () => {});
  }, []);
  useEffect(() => onShare(setSt), []);
  // 카드를 열 때 한 번 새로고침해 명단 상태(연결됨·초대함…)를 새로 봐요.
  const active = !!st && shareActive(st.conf);
  useEffect(() => {
    if (active) void refreshShare();
  }, [active]);
  useEffect(() => {
    if (st && !st.conf.on) backupInfo().then(setBackup, () => {});
  }, [st?.conf.on]);
  if (!st) return null;
  const { conf, people } = st;
  const joined = !!conf.sheet;
  const isHost = joined && conf.me === conf.host;
  const shown = people.filter((p) => !p.gone);

  /** key: 어느 단추인지(그 단추만 "…하는 중"), done: 끝나면 ✓ 5초, hint: 도는 동안 아래 안내(브라우저 로그인 기다림). */
  async function act(key: string, f: () => Promise<unknown>, done = "", hint = "") {
    setMsg(hint);
    await b.run(key, f, done, errText);
    setMsg("");
  }
  const LOGIN = "브라우저에서 구글 로그인을 마쳐 주세요";
  const TOP = ["end", "leave", "take"];
  const SHEET = ["join", "create"];
  const PEOPLE = ["add", "edit", "remove", "offer"];
  const placed = [...TOP, ...SHEET, ...PEOPLE];
  const flashOf = (keys: string[]) => (b.flash && keys.includes(b.flash.key) ? b.flash : null);
  const busyIn = (keys: string[]) => !!b.busy && keys.includes(b.busy);
  const otherFlash = b.flash && !placed.includes(b.flash.key) ? b.flash : null;

  const saveEdit = () => {
    if (!edit) return;
    const p = people.find((x) => x.no === edit.no);
    setEdit(null);
    if (!p || (p.name === edit.name.trim() && p.mail === edit.mail.trim())) return;
    void act("edit", () => editPerson(edit.no, edit.name, edit.mail), edit.mail.trim().toLowerCase() !== p.mail.toLowerCase() ? "메일을 바꿨어요 – 호스트 앱이 새 메일로 다시 초대해요" : "");
  };
  const editKeys = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEdit(null);
    }
  };
  const doAdd = () => {
    if (!add.name.trim() && !add.mail.trim()) return;
    if (wait) return;
    void act("add", async () => {
      await addPerson(add.name, add.mail);
      setAdd({ name: "", mail: "" });
    }, isHost ? "더했어요 – 구글이 그 메일로 시트 안내를 보내요" : "더했어요 – 호스트 앱이 다음 새로고침 때 권한을 줘요");
  };

  const tag = (p: Person) => {
    const s = statusOf(p, conf.host);
    return <span className={"bs-tag " + s}>{STATUS_TEXT[s]}</span>;
  };

  const personRow = (p: Person) => {
    if (edit?.no === p.no) {
      return (
        <div key={p.no} className="bs-p bs-edit" onKeyDown={editKeys}>
          <input className="input bs-in-name" aria-label="이름" value={edit.name} autoComplete="off" onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <input
            className="input bs-in-mail"
            aria-label="구글 메일"
            data-ime="en"
            type="email"
            name="email"
            value={edit.mail}
            autoComplete="off"
            autoFocus
            onChange={(e) => setEdit({ ...edit, mail: e.target.value })}
            onBlur={(e) => {
              if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) saveEdit();
            }}
          />
          <span className="bs-st2">
            <span className="bs-tag invited">메일을 바꾸면 다시 초대해요</span>
          </span>
          <span className="bs-act" />
        </div>
      );
    }
    const asking = ask?.t === "remove" && ask.no === p.no;
    return (
      <div key={p.no} className="bs-p" onDoubleClick={() => !wait && setEdit({ no: p.no, name: p.name, mail: p.mail })} title="두 번 누르면 이름·메일을 고쳐요">
        <span className="bs-pn">{p.name || "(이름 없음)"}</span>
        <span className="bs-pm">{p.mail}</span>
        <span className="bs-st2">{asking ? <span className="bs-tag ask">내보낼까요?</span> : tag(p)}</span>
        <span className="bs-act">
          {p.no === conf.host ? (
            isHost && (
              <button type="button" className="btn btn-xs" disabled={wait} onClick={() => setHostPick(!hostPick)} onDoubleClick={(e) => e.stopPropagation()}>
                호스트 넘기기
              </button>
            )
          ) : asking ? (
            <>
              <BusyButton
                className="btn-danger btn-xs"
                small
                busy={b.is("remove")}
                busyText="내보내는 중…"
                disabled={wait}
                onClick={() => void act("remove", () => removePerson(p.no), "내보냈어요 – 시트 권한을 거뒀어요").then(() => setAsk(null))}
              >
                내보내기
              </BusyButton>
              <button type="button" className="btn btn-xs" disabled={wait} onClick={() => setAsk(null)}>
                취소
              </button>
            </>
          ) : (
            isHost && (
              <button type="button" className="bs-x" aria-label={`${p.name} 내보내기`} title="내보내기(시트 권한을 거둬요)" disabled={wait} onClick={() => setAsk({ t: "remove", no: p.no })} onDoubleClick={(e) => e.stopPropagation()}>
                ×
              </button>
            )
          )}
        </span>
      </div>
    );
  };

  const meP = people.find((p) => p.no === conf.me);
  const takeOffered = joined && conf.take > 0 && conf.take !== conf.host;
  const taker = people.find((p) => p.no === conf.take);

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={conf.on}
        className="row row-btn"
        data-k="팀 공유 구글 시트 집행현황"
        disabled={wait}
        onClick={() => void setShareOn(!conf.on).then(() => conf.on || void refreshShare())}
      >
        <span className="row-text">
          <span className="row-label">팀 공유</span>
          <span className="muted small">같은 팀이 집행현황을 구글 시트 하나로 함께 써요. 켤 때 구글 시트 권한을 한 번 더 받아요("확인되지 않은 앱" 경고가 한 번 떠요).</span>
        </span>
        <BusyNote busy={false} late={false} flash={flashOf(TOP)} />
        <span className={"switch" + (conf.on ? " on" : "")} aria-hidden="true">
          <span className="knob" />
        </span>
      </button>

      {!conf.on && !conf.sheet && conf.error && (
        <p className="bs-warn small" role="status">
          {conf.error}
        </p>
      )}
      {!conf.on && msg && !conf.error && (
        <p className="bs-warn small" role="status">
          {msg}
        </p>
      )}
      {!conf.on && <BusyNote line busy={false} late={false} flash={otherFlash} />}
      {!conf.on && backup && (
        <div className="row">
          <span className="row-text">
            <span className="row-label">공유 전 내 집행현황</span>
            <span className="muted small">
              시트에 묶일 때 남긴 백업이에요({backup.at.slice(0, 10)} · 세부사업 {backup.n}개). 되돌리면 지금 집행현황은 지워져요.
            </span>
          </span>
          {ask?.t === "new" && ask.no === -1 ? (
            <span className="bs-dir">
              <BusyButton
                className="btn-danger btn-xs"
                small
                busy={b.is("restore")}
                busyText="되돌리는 중…"
                disabled={wait}
                onClick={() => void act("restore", restoreBackup, "공유 전 집행현황으로 되돌렸어요").then(() => setAsk(null))}
              >
                되돌리기
              </BusyButton>
              <button type="button" className="btn btn-xs" disabled={wait} onClick={() => setAsk(null)}>
                취소
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-xs" disabled={wait} onClick={() => setAsk({ t: "new", no: -1 })}>
              되돌리기
            </button>
          )}
        </div>
      )}

      {conf.on && (
        <>
          <div className="row" data-k="공유 시트 주소 호스트 새로 만들기 연결">
            <span className="row-text">
              <span className="row-label">공유 시트</span>
              <span className="muted small">처음 켠 사람은 [새로 만들기] – 그 사람이 호스트예요. 팀원은 호스트에게 받은 주소를 붙여 넣고 [연결].</span>
            </span>
            <span className="bs-dir">
              {joined ? (
                <input className="input" aria-label="공유 시트 주소" data-ime="en" readOnly value={sheetUrl(conf.sheet)} autoComplete="off" onFocus={(e) => e.currentTarget.select()} />
              ) : (
                <input
                  className="input"
                  aria-label="공유 시트 주소"
                  data-ime="en"
                  placeholder="호스트가 보낸 시트 주소"
                  value={addr}
                  autoComplete="off"
                  onChange={(e) => setAddr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && addr.trim() && !wait) void act("join", () => joinSheet(addr), "연결했어요", LOGIN);
                  }}
                />
              )}
              {joined ? (
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(sheetUrl(conf.sheet)).then(() => setMsg("주소를 복사했어요 – 팀원에게 보내 주세요"));
                  }}
                >
                  주소 복사
                </button>
              ) : (
                <BusyButton className="btn btn-xs" small busy={b.is("join")} busyText="연결하는 중…" disabled={wait || !addr.trim()} onClick={() => void act("join", () => joinSheet(addr), "연결했어요", LOGIN)}>
                  연결
                </BusyButton>
              )}
              {ask?.t === "new" && ask.no === 0 ? (
                <>
                  <BusyButton
                    className="btn-primary btn-xs"
                    small
                    busy={b.is("create")}
                    busyText="만드는 중…"
                    disabled={wait}
                    onClick={() => void act("create", () => createSheet(myName), "새 시트를 만들었어요 – [주소 복사]로 팀원에게 보내 주세요", LOGIN).then(() => setAsk(null))}
                  >
                    만들기
                  </BusyButton>
                  <button type="button" className="btn btn-xs" disabled={wait} onClick={() => setAsk(null)}>
                    취소
                  </button>
                </>
              ) : (
                <BusyButton className="btn btn-xs" small busy={b.is("create")} busyText="만드는 중…" disabled={wait} onClick={() => (joined ? setAsk({ t: "new", no: 0 }) : void act("create", () => createSheet(myName), "새 시트를 만들었어요 – [주소 복사]로 팀원에게 보내 주세요", LOGIN))}>
                  새로 만들기
                </BusyButton>
              )}
            </span>
          </div>
          {ask?.t === "new" && ask.no === 0 && <p className="bs-warn small">새 시트를 만들면 지금 시트와 끊기고 내가 호스트가 돼요. 팀원은 새 주소로 다시 연결해야 해요.</p>}
          <BusyNote line busy={busyIn(SHEET)} late={b.late} flash={flashOf(SHEET)} noLate />

          {joined && (
            <div className="row" data-k="공유 끝내기 공유에서 나가기 연결 끊기">
              <span className="row-text">
                <span className="row-label">{isHost ? "공유 끝내기" : "공유에서 나가기"}</span>
                <span className="muted small">
                  {isHost
                    ? "팀원 모두의 시트 권한을 거두고 공유를 끝내요. 팀이 계속 쓰려면 끝내지 말고 [호스트 넘기기]를 해 주세요."
                    : "명단에서 나를 빼고 이 PC의 공유 연결을 끊어요."}{" "}
                  내 집행현황은 그대로예요.
                </span>
              </span>
              {ask?.t === "leave" ? (
                <span className="bs-dir">
                  <span className="bs-tag ask">{isHost ? (shown.length > 1 ? `공유를 끝낼까요? 팀원 ${shown.length - 1}명도 끊겨요` : "공유를 끝낼까요?") : "공유에서 나갈까요?"}</span>
                  <BusyButton
                    className="btn-danger btn-xs"
                    small
                    autoFocus
                    busy={b.is("end") || b.is("leave")}
                    busyText={isHost ? "끝내는 중…" : "나가는 중…"}
                    disabled={wait}
                    onKeyDown={(e) => e.key === "Escape" && !wait && setAsk(null)}
                    onClick={() => {
                      // 묻는 띠는 끝날 때까지 그대로 두고 누른 단추만 "…하는 중"으로 바뀌어요.
                      const go = isHost
                        ? act("end", endShare, "공유를 끝냈어요")
                        : act(
                            "leave",
                            async () => {
                              const r = await leaveShare();
                              if (!r.marked) throw new Error("나갔어요 – 시트에 표시하지 못했으니 호스트에게 명단에서 빼 달라고 하세요");
                            },
                            "공유에서 나갔어요",
                          );
                      void go.then(() => setAsk(null));
                    }}
                  >
                    {isHost ? "끝내기" : "나가기"}
                  </BusyButton>
                  <button type="button" className="btn btn-xs" disabled={wait} onClick={() => setAsk(null)}>
                    취소
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn-xs" disabled={wait} onClick={() => setAsk({ t: "leave", no: 0 })}>
                  {isHost ? "공유 끝내기" : "나가기"}
                </button>
              )}
            </div>
          )}
          {joined && busyIn(["end", "leave"]) && <BusyNote line busy late={b.late} flash={null} />}

          {takeOffered && conf.take === conf.me && (
            <div className="row bs-take">
              <span className="row-text">
                <span className="row-label">호스트를 넘겨받았어요</span>
                <span className="muted small">[받기]를 누르면 새 시트를 만들어 집행현황·명단을 옮기고, 모두의 앱이 새 시트를 따라와요(구글 권한을 한 번 더 받아요).</span>
              </span>
              <BusyButton className="btn-primary btn-xs" small busy={b.is("take")} busyText="옮기는 중…" disabled={wait} onClick={() => void act("take", takeHost, "호스트가 됐어요 – 새 시트로 옮겼어요", LOGIN)}>
                받기
              </BusyButton>
            </div>
          )}
          {takeOffered && conf.take === conf.me && b.is("take") && <BusyNote line busy late={b.late} flash={null} noLate />}

          {joined && (
            <>
              <div className="row bs-people-row" data-k="함께 쓰는 사람 명단 구글 메일 호스트 넘기기 담당">
                <span className="row-text">
                  <span className="row-label">함께 쓰는 사람</span>
                  <span className="muted small">
                    더한 구글 계정만 시트를 열 수 있어요. 누구나 더하고, 내보내기는 호스트가 해요. 이 명단에서 세부사업 담당(한 명)을 골라요.
                  </span>
                </span>
              </div>
              {hostPick && isHost && (
                <div className="bs-pick">
                  <span className="muted small">누구에게 넘길까요? 받는 사람 앱의 설정에 [받기]가 떠요.</span>
                  {shown
                    .filter((p) => p.no !== conf.host && statusOf(p, conf.host) === "connected")
                    .map((p) => (
                      <BusyButton
                        key={p.no}
                        className="btn btn-xs"
                        small
                        busy={b.is("offer")}
                        busyText="넘기는 중…"
                        disabled={wait}
                        onClick={() => void act("offer", () => offerHost(p.no), `${p.name} 님 앱에 [받기]가 떠요 – 받으면 새 시트로 옮겨요`).then(() => setHostPick(false))}
                      >
                        {p.name}
                      </BusyButton>
                    ))}
                  {!shown.some((p) => p.no !== conf.host && statusOf(p, conf.host) === "connected") && <span className="muted small">연결된 사람이 없어요</span>}
                </div>
              )}
              {takeOffered && isHost && (
                <p className="bs-warn small">
                  {taker?.name ?? "누군가"} 님이 [받기]를 누르면 호스트가 넘어가요.{" "}
                  <button type="button" className="link-btn" disabled={wait} onClick={() => void act("offer", () => offerHost(0), "넘기기를 취소했어요")}>
                    {b.is("offer") ? "취소하는 중…" : "취소"}
                  </button>
                </p>
              )}
              <div className="bs-people">
                {shown.map(personRow)}
                <div className="bs-p bs-add">
                  <input className="input bs-in-name" aria-label="이름" placeholder="이름" disabled={b.is("add")} value={add.name} autoComplete="off" onChange={(e) => setAdd({ ...add, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && doAdd()} />
                  <input
                    className="input bs-in-mail"
                    aria-label="구글 메일"
                    placeholder="구글 메일"
                    data-ime="en"
                    type="email"
                    name="email"
                    disabled={b.is("add")}
                    value={add.mail}
                    autoComplete="off"
                    onChange={(e) => setAdd({ ...add, mail: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && doAdd()}
                  />
                  <BusyButton className="btn btn-xs" small busy={b.is("add")} busyText="더하는 중…" disabled={wait} onClick={doAdd}>
                    ＋ 더하기
                  </BusyButton>
                </div>
              </div>
              <BusyNote line busy={busyIn(PEOPLE)} late={b.late} flash={flashOf(PEOPLE)} />
              <div className="row">
                <span className="row-text">
                  <span className="row-label">고친 사람 이름</span>
                  <span className="muted small">다른 사람 화면에 "○○ 님이 먼저 고쳤어요"로 보여요. 명단에서 내 줄을 두 번 눌러 고쳐요.</span>
                </span>
                <span className="bs-me">{meP?.name || myName}</span>
              </div>
              <div className="row row-last">
                <span className="row-text">
                  <span className="row-label">마지막 새로고침</span>
                  <span className="muted small">집행현황을 열 때·5분마다·[새로고침]을 누를 때 올리고 받아요. 인터넷이 안 되면 내 PC에 두었다가 다음에 올려요.</span>
                </span>
                <span className="bs-me">
                  {conf.up || conf.down ? `올림 ${shortTime(conf.up) || "–"} · 받음 ${shortTime(conf.down) || "–"}` : "아직 새로고침 전"} · 함께 쓰는 사람 {shown.length}명
                </span>
              </div>
              {conf.error && (
                <p className="bs-warn bad small">
                  {conf.error}{" "}
                  {conf.error.includes("다시 로그인") && (
                    <button type="button" className="link-btn" disabled={wait} aria-busy={b.is("relogin") || undefined} onClick={() => void act("relogin", reloginShare, "다시 로그인했어요", LOGIN)}>
                      {b.is("relogin") ? "로그인 기다리는 중…" : "다시 로그인"}
                    </button>
                  )}
                </p>
              )}
              {st.last?.note && (
                <p className="bs-warn small">
                  {st.last.note}{" "}
                  {isHost && (
                    <button type="button" className="link-btn" disabled={wait} aria-busy={b.is("grant") || undefined} onClick={() => void act("grant", grantHostScope, "권한을 받았어요", LOGIN)}>
                      {b.is("grant") ? "로그인 기다리는 중…" : "권한 받기"}
                    </button>
                  )}
                </p>
              )}
            </>
          )}
          {msg && msg !== conf.error && (
            <p className="bs-warn small" role="status">
              {msg}
            </p>
          )}
          <BusyNote line busy={false} late={false} flash={otherFlash} />
          <p className="g-foot small">공유 시트는 시청 밖 구글 서버에 있어요. 집행현황에는 민원인 정보가 없어요.</p>
        </>
      )}
      {inApp && (
        <div className="row" data-k="시험용 두 번째 기록 다른 구글 계정 공유 시험">
          <span className="row-text">
            <span className="row-label">{twin ? `시험용 두 번째 기록 (${twin})` : "시험용 두 번째 기록"}</span>
            <span className="muted small">
              {twin
                ? `지금 창이 시험용이에요 – 자료는 문서\\giLog-${twin}에 따로 있고, 원래 기록과 섞이지 않아요. 구글 로그인 때 다른 계정을 고르세요.`
                : "같은 PC에서 다른 구글 계정으로 팀 공유를 시험할 때 써요. 자료·구글 연결이 따로인 기록 창이 하나 더 떠요(제목 \"기록 · 시험 B\")."}
            </span>
          </span>
          {!twin && (
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => invoke("open_twin").then(() => setMsg("시험용 두 번째 기록을 켰어요 – 새 창에서 비밀번호를 새로 정해요"), () => setMsg("두 번째 기록을 켜지 못했어요"))}
            >
              열기
            </button>
          )}
        </div>
      )}
    </>
  );
}
