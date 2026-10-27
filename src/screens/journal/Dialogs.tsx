// 업무일지 적는 칸·창 – 상대 칸(WhoInput)·말 배지(SpeakerButton)·신규 카드(NewCard)·고치는 카드(EditCard), 인쇄 기간 창·종이(PrintDialog·PrintPages, 전엔 src/JournalPrint.tsx). 화면 몸통은 Screen.tsx.
import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DelGlyph } from "../../Icons";
import { useOutsideClose, overlayDown } from "../../useOutsideClose";
import { Contact, DayInfo, Entry, EntryInput, Project } from "../../api";
import { pjFull, pjLabel, projectColor } from "../../screens/contacts/parts";
import { PhoneInput } from "../../PhoneInput";
import { finalizePhone } from "../../phone";
import {
  contactFor,
  contactLabel,
  DraftLine,
  badgeName,
  expandKind,
  findContact,
  firstContact,
  initials,
  isChosung,
  isMemo,
  koIndex,
  normTime,
  nowHM,
  resolveDraft,
  splitJamo,
  sameSpeaker,
  Speaker,
  speakerColor,
  speakers,
  splitWho,
  WHO_SEP,
  parseDate,
} from "../../journal";
import { useJamoGuard } from "../../koInput";
import { isKey, moveField, rowKeys } from "../../keys";
import { isEmptyMemo, MemoEditor, sanitize } from "../../RichMemo";
import { AskBand } from "../../AskBand";
import { DialogX } from "../../DialogX";
import { DateInput } from "../../DateInput";
import { ProjectMenu } from "./Menu";
import { talkAction, insertBreak, lineEdge } from "./keys";
import { badgeStyle, Ctx as JournalCtx } from "./parts";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

// ---------- 상대 칸 (업무연락처에서 찾기) ----------

/**
 * 상대 칸. "/"로 여러 명을 적고(쉼표는 글자 그대로), 마지막으로 적는 이름에 맞는 연락처를 아래에 보여 줘요.
 * ↑↓로 고르고 Enter로 넣어요(고르지 않았으면 Enter는 등록이에요). 이름만 적고 칸을 떠나도 그 사람이 한 명이면 채워요.
 */
function WhoInput({
  value,
  contacts,
  onChange,
  onPick,
  className,
  placeholder,
  inputRef,
}: {
  value: string;
  contacts: Contact[];
  onChange: (v: string) => void;
  onPick: (who: string) => void;
  className: string;
  placeholder: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  // 이름 초성: Shift 없이 같은 자음을 두 번 쳐서 묶인 된소리(ㅆ)는 ㅅㅅ으로 풀어요.
  const guard = useJamoGuard(onChange);
  guard.follow(value);
  const segs = value.split("/");
  const last = segs[segs.length - 1].trim();
  const lastLc = last.toLowerCase();
  // 이름은 초성으로도 찾아요("ㅂㅈㅎ", "박ㅈ"). 소속·직위는 글자 그대로 찾아요. 겹자음(ㅄ)은 풀어서 봐요.
  const nameAt = (c: Contact) => koIndex(c.name, last);
  const lastCho = splitJamo(last);
  const options = lastLc
    ? contacts
        .filter((c) => contactLabel(c) !== last && (nameAt(c) >= 0 || (!isChosung(lastCho) && [c.org, c.role].some((s) => s.toLowerCase().includes(lastLc)))))
        .sort((a, b) => Number(nameAt(b) === 0) - Number(nameAt(a) === 0) || Number(initials(a.name) !== lastCho) - Number(initials(b.name) !== lastCho))
        .slice(0, 8)
    : [];
  const show = open && options.length > 0;

  function pick(c: Contact) {
    const head = segs.slice(0, -1).map((x) => x.trim()).filter(Boolean);
    onPick([...head, contactLabel(c)].join(WHO_SEP));
    setHi(-1);
    setOpen(false);
  }

  /** 이름만 적은 사람들을 "이름 직위 · 소속"으로 채워요. */
  function expand() {
    const next = segs
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const c = findContact(s, contacts);
        return c ? contactLabel(c) : s;
      })
      .join(WHO_SEP);
    if (next !== value.trim()) onPick(next);
  }

  return (
    <div className="pin jwho">
      <input
        ref={inputRef}
        aria-label="상대"
        placeholder={placeholder}
        autoComplete="off"
        className={className}
        value={value}
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        onChange={(e) => {
          guard.onChange(e);
          setOpen(true);
          setHi(-1);
        }}
        onCompositionEnd={guard.onCompositionEnd}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setHi(-1);
          expand();
        }}
        onKeyDown={(e) => {
          guard.onKeyDown(e);
          if (isComposing(e) || !show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((hi + 1) % options.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi(hi <= 0 ? options.length - 1 : hi - 1);
          } else if (e.key === "Enter" && hi >= 0) {
            e.preventDefault();
            e.stopPropagation();
            pick(options[hi]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {show && (
        <div className="pin-list jwho-list" role="listbox">
          {options.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === hi}
              className="pin-opt jwho-opt"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span className="jwho-name">{c.name}</span>
              <span className="jwho-rest">{[c.role, c.org].filter(Boolean).join(" · ")}</span>
              <span className="jwho-tel">{c.mobile || c.tel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SpeakerButton({ s, onClick }: { s: Speaker; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={"jsp-btn" + (s.me ? " me" : "")}
      style={badgeStyle(s)}
      title={(s.me ? "" : s.who + " – ") + "눌러서 말한 사람 바꾸기"}
      aria-label={`말한 사람: ${s.me ? "나" : s.who} (눌러서 변경)`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {s.me ? "나" : badgeName(s.who)}
    </button>
  );
}

// ---------- 신규 입력 카드 ----------

export function NewCard({ date, ctx, onAdd }: { date: string; ctx: JournalCtx; onAdd: (e: EntryInput) => Promise<boolean> }) {
  const [time, setTime] = useState(nowHM());
  const [timeTouched, setTimeTouched] = useState(false);
  const [badTime, setBadTime] = useState(false);
  const [kind, setKind] = useState("");
  const [who, setWho] = useState("");
  const [tel, setTel] = useState("");
  const [telAuto, setTelAuto] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([{ sp: null, t: "" }]);
  const [focus, setFocus] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [memoKey, setMemoKey] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const kindRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const memo = isMemo(expandKind(kind, ctx.kinds));
  const kindGuard = useJamoGuard(setKind);

  // 구분이 메모로 바뀌는 사이 커서를 잃었으면 편집기로 옮겨요.
  useEffect(() => {
    const a = document.activeElement;
    if (memo && (!a || a === document.body)) editorRef.current?.focus();
  }, [memo]);

  // 화면을 열면 구분 칸에 커서가 가 있어요. (시간은 지금 시각으로 채워져 있어요)
  // 검색창 Esc·×로 검색을 지워 이 카드가 다시 나올 때는 커서를 검색창에 둬요(공통 규칙 · 검색, ✔8).
  useEffect(() => {
    if ((document.activeElement as HTMLElement | null)?.closest(".jn-search")) return;
    kindRef.current?.focus();
  }, []);

  // 시간을 직접 고치지 않았으면 지금 시각을 따라가요.
  useEffect(() => {
    if (timeTouched) return;
    const t = window.setInterval(() => setTime(nowHM()), 15_000);
    return () => window.clearInterval(t);
  }, [timeTouched]);

  // 고르고 있는 말 줄에 커서를 둬요. 말을 나눠 새 줄을 만들었으면 줄 맨 앞이에요.
  const caretStart = useRef(false);
  useEffect(() => {
    if (focus === null) return;
    const el = box.current?.querySelector<HTMLTextAreaElement>(`[data-uline="${focus}"]`);
    const start = caretStart.current;
    caretStart.current = false;
    if (el && document.activeElement !== el) {
      el.focus();
      const at = start ? 0 : el.value.length;
      el.setSelectionRange(at, at);
    }
  }, [focus, lines.length]);

  const S = speakers(who, expandKind(kind, ctx.kinds), ctx.myName);
  const resolved = resolveDraft(lines, S.list.length, S.first);

  /** 상대나 구분이 바뀌면 연락처를 채워요. 직접 적은 연락처는 건드리지 않아요. */
  function fill(nextWho: string, nextKind: string) {
    if (!telAuto && tel) return;
    const c = firstContact(nextWho, ctx.contacts);
    if (!c) return;
    setTel(contactFor(c, expandKind(nextKind, ctx.kinds)));
    setTelAuto(true);
  }

  function reset() {
    setKind("");
    kindGuard.sync("");
    setWho("");
    setTel("");
    setTelAuto(true);
    setLines([{ sp: null, t: "" }]);
    setFocus(null);
    setBody("");
    setMemoKey((n) => n + 1);
    setBadTime(false);
    setTimeTouched(false);
    setTime(nowHM());
    kindRef.current?.focus();
  }

  async function submit() {
    const t = normTime(time);
    if (!t) {
      setBadTime(true);
      timeRef.current?.focus();
      return;
    }
    const k = expandKind(kind, ctx.kinds);
    if (memo) {
      // 메모는 상대·연락처·프로젝트 없이 본문만 저장해요.
      if (isEmptyMemo(body)) return editorRef.current?.focus();
      const ok = await onAdd({ date, time: t, kind: k, who: "", contact: "", project: null, lines: [], body: sanitize(body) });
      if (ok) reset();
      return;
    }
    if (!lines.some((l) => l.t.trim())) {
      setFocus(0);
      box.current?.querySelector<HTMLInputElement>('[data-uline="0"]')?.focus();
      return;
    }
    const c = firstContact(who, ctx.contacts);
    const ok = await onAdd({
      date,
      time: t,
      kind: k,
      who: who.trim(),
      contact: finalizePhone(tel),
      // 프로젝트는 상대 연락처의 첫 프로젝트가 자동으로 붙어요. 등록한 뒤 바꿀 수 있어요.
      project: c?.projects[0] ?? null,
      lines: lines.map((l, i) => ({ ...S.list[resolved[i]], text: l.t })),
      body: "",
    });
    if (ok) reset();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLTextAreaElement;
    const at = target.dataset.uline;
    if (at === undefined) {
      // 머리 칸(시간·구분·상대·연락처): Enter·Tab 다음 칸, Shift+Tab 앞 칸, Esc 취소
      if (isKey(e, "common.cancel")) {
        e.preventDefault();
        reset();
        return;
      }
      rowKeys(e, box.current, () => void submit());
      return;
    }
    const i = Number(at);
    const act = talkAction(e);
    if (act) e.preventDefault();
    if (act === "cancel") return reset();
    if (act === "submit") return void submit();
    if (act === "prev") return void moveField(box.current!, target, -1);
    if (act === "br") return insertBreak(target);
    if (act === "next" || act === "same") {
      const v = target.value;
      if (!v.trim()) return;
      const head = v.slice(0, target.selectionStart);
      const tail = v.slice(target.selectionEnd);
      // 다음 줄이 비어 있으면(앞에서 만들어 둔 줄) 거기로 가요.
      if (!tail && act === "next" && i < lines.length - 1 && !lines[i + 1].t) return setFocus(i + 1);
      const next = lines.map((l) => ({ ...l }));
      next[i].t = tail ? head : v;
      // Enter는 다음 사람(자동), Shift+Enter는 같은 사람이 이어서 말해요.
      next.splice(i + 1, 0, { sp: act === "same" ? resolved[i] : null, t: tail });
      setLines(next);
      setFocus(i + 1);
      caretStart.current = true;
      return;
    }
    if (e.key === "Enter") return e.preventDefault();
    const cur = lines[i];
    if (e.key === "Backspace" && cur.t === "" && lines.length > 1) {
      e.preventDefault();
      setLines(lines.filter((_, j) => j !== i));
      setFocus(Math.max(0, i - 1));
    } else if (e.key === "ArrowUp" && i > 0 && lineEdge(target, true)) {
      e.preventDefault();
      setFocus(i - 1);
    } else if (e.key === "ArrowDown" && i < lines.length - 1 && lineEdge(target, false)) {
      e.preventDefault();
      setFocus(i + 1);
    }
  }

  return (
    <div ref={box} className={"jcard jcard-new" + (memo ? " jcard-memo" : "")} role="group" aria-label="새 기록 입력" onKeyDown={onKeyDown}>
      <div className="jpillar">
        <input
          ref={timeRef}
          aria-label="시간"
          className={"cell-input num strong" + (badTime ? " invalid" : "")}
          aria-invalid={badTime || undefined}
          value={time}
          // 칸에 들어가면 전체를 골라요 – 첫 숫자가 지금 시각을 바꿔요(2026-10-25 사용자).
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setTime(e.target.value);
            setTimeTouched(true);
            setBadTime(false);
          }}
          onBlur={() => {
            const t = normTime(time);
            if (t) setTime(t);
            else if (time.trim()) setBadTime(true);
            else {
              // 비우고 떠나면 다시 지금 시각을 따라가요.
              setTime(nowHM());
              setTimeTouched(false);
            }
          }}
        />
        <input
          ref={kindRef}
          aria-label="구분"
          placeholder="구분"
          autoComplete="off"
          className="cell-input"
          title={"초성 단축키: " + ctx.kinds.slice(0, 4).map((k) => `${k.key} ${k.name}`).join(", ") + " …"}
          value={kind}
          onKeyDown={kindGuard.onKeyDown}
          onChange={kindGuard.onChange}
          onCompositionEnd={kindGuard.onCompositionEnd}
          onBlur={() => {
            const k = expandKind(kind, ctx.kinds);
            if (k !== kind) setKind(k);
            fill(who, k);
          }}
        />
      </div>
      {memo ? (
        <div className="jnew-main">
          <MemoEditor
            key={memoKey}
            initial={body}
            editorRef={editorRef}
            placeholder="메모를 적어요. 위 단추로 제목·목록·표를 넣을 수 있어요."
            onChange={setBody}
            onSubmit={submit}
            onCancel={reset}
          />
          <div className="jmemo-foot">
            <span className="hint">Enter 다음 문단 · Shift+Enter 목록 · Tab 등록 · Esc 취소</span>
            <button type="button" className="btn-primary jbtn-add" onClick={submit}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              등록
            </button>
          </div>
        </div>
      ) : (
      <div className="jnew-main">
        <div className="jnew-top">
          <WhoInput
            className="cell-input"
            placeholder="상대 이름"
            value={who}
            contacts={ctx.contacts}
            onChange={setWho}
            onPick={(v) => {
              setWho(v);
              fill(v, kind);
            }}
          />
          <PhoneInput
            aria-label="연락처"
            placeholder="연락처 자동 입력"
            data-ime={expandKind(kind, ctx.kinds).includes("메일") ? "en" : undefined}
            className="cell-input num jnew-tel"
            value={tel}
            onChange={(v) => {
              setTel(v);
              setTelAuto(!v);
            }}
          />
          <span className="hint jnew-hint" title="Enter 다음 말(말한 사람 자동 교대) · Shift+Enter 같은 사람이 이어서 · Alt+Enter 한 말 안 줄 바꿈 · 배지를 누르면 사람 변경 · Tab 등록 · Esc 취소">
            Enter 다음 말 · Shift+Enter 같은 사람 · Tab 등록
          </span>
        </div>
        <div className="jnew-bottom">
          <div className="jlines-in">
            {lines.map((l, i) => {
              const s = S.list[resolved[i]];
              return (
                <div key={i} className="jline-in">
                  <SpeakerButton
                    s={s}
                    onClick={() => {
                      const next = lines.map((x) => ({ ...x }));
                      next[i].sp = (resolved[i] + 1) % S.list.length;
                      setLines(next);
                      setFocus(i);
                    }}
                  />
                  <textarea
                    data-uline={i}
                    rows={1}
                    aria-label={`${s.me ? "내" : s.who + "의"} 말`}
                    placeholder={s.me ? "내가 한 말" : `${s.who || "상대"} 말`}
                    className="cell-input jtalk"
                    value={l.t}
                    onFocus={() => setFocus(i)}
                    onChange={(e) => {
                      const next = lines.map((x) => ({ ...x }));
                      next[i].t = e.target.value;
                      setLines(next);
                    }}
                  />
                </div>
              );
            })}
          </div>
          <button type="button" className="btn-primary jbtn-add" onClick={submit}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            등록
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

/** 예전에 말 줄로 적은 메모를 편집기 본문으로 옮겨요. */
function linesToBody(e: Entry): string {
  if (e.body) return e.body;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return e.lines.map((l) => `<p>${esc(l.me ? l.text : `${l.who}: ${l.text}`).replace(/\n/g, "<br>")}</p>`).join("");
}

// ---------- 고치는 카드 ----------

type EditLine = Speaker & { t: string };

export function EditCard({
  entry: e,
  ctx,
  onCancel,
  onSave,
  onRemove,
}: {
  entry: Entry;
  ctx: JournalCtx;
  onCancel: () => void;
  onSave: (input: EntryInput) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [time, setTime] = useState(e.time);
  const [badTime, setBadTime] = useState(false);
  const [kind, setKind] = useState(e.kind);
  const editKindGuard = useJamoGuard(setKind);
  const [who, setWho] = useState(e.who);
  const [tel, setTel] = useState(e.contact);
  const [project, setProject] = useState(e.project);
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const [lines, setLines] = useState<EditLine[]>(() => {
    if (e.lines.length) return e.lines.map((l) => ({ who: l.who, me: l.me, t: l.text }));
    const S = speakers(e.who, e.kind, ctx.myName);
    return [{ ...S.list[S.first], t: "" }];
  });
  const [focus, setFocus] = useState(Math.max(0, e.lines.length - 1));
  const [body, setBody] = useState(() => (isMemo(e.kind) ? linesToBody(e) : e.body));
  const ref = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const memo = isMemo(expandKind(kind, ctx.kinds));

  // 메모를 열면 본문 끝에 커서를 둬요.
  useEffect(() => {
    const el = editorRef.current;
    if (!memo || !el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memo]);

  // 말할 수 있는 사람들: 상대 칸의 사람들, 나, 그리고 이미 적힌 줄의 사람들
  const names: Speaker[] = speakers(who, kind, ctx.myName).list;
  lines.forEach((l) => {
    if (!names.some((n) => sameSpeaker(n, l))) names.splice(names.length - 1, 0, { who: l.who, me: l.me });
  });
  const nextOf = (s: Speaker) => names[(names.findIndex((n) => sameSpeaker(n, s)) + 1) % names.length];

  function build(): EntryInput | null {
    const t = normTime(time);
    if (!t) return null;
    if (memo) {
      if (isEmptyMemo(body)) return null;
      return { date: e.date, time: t, kind: expandKind(kind, ctx.kinds), who: "", contact: "", project: null, lines: [], body: sanitize(body) };
    }
    const kept = lines.filter((l) => l.t.trim());
    if (!kept.length) return null;
    return {
      date: e.date,
      time: t,
      kind: expandKind(kind, ctx.kinds),
      who: who.trim(),
      contact: finalizePhone(tel),
      project,
      lines: kept.map((l) => ({ who: l.me ? ctx.myName : l.who, me: l.me, text: l.t })),
      body: "",
    };
  }

  function save(fromOutside = false) {
    const input = build();
    if (!input) {
      // 바깥을 눌렀는데 저장할 수 없으면 고치기 전으로 돌아가요.
      if (fromOutside) return onCancel();
      if (!normTime(time)) {
        setBadTime(true);
        timeRef.current?.focus();
      } else if (memo) editorRef.current?.focus();
      else setFocus(0);
      return;
    }
    onSave(input);
  }

  const latest = useRef({ save });
  latest.current = { save };

  // 바깥(다른 카드, 빈 곳)을 누르면 저장해요. "지울까요?"가 펼쳐져 있었으면 지우지 않고 접혀요.
  useOutsideClose(true, [ref], () => {
    if (!ref.current) return;
    setAsking(false);
    latest.current.save(true);
  });

  const caretStart = useRef(false);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLTextAreaElement>(`[data-eline="${focus}"]`);
    const start = caretStart.current;
    caretStart.current = false;
    if (el && document.activeElement !== el) {
      el.focus();
      const at = start ? 0 : el.value.length;
      el.setSelectionRange(at, at);
    }
  }, [focus, lines.length]);

  function fill(nextWho: string, nextKind: string) {
    const c = firstContact(nextWho, ctx.contacts);
    if (c) setTel(contactFor(c, expandKind(nextKind, ctx.kinds)));
  }

  function onKeyDown(ev: KeyboardEvent<HTMLDivElement>) {
    if (ev.defaultPrevented || asking) return;
    const target = ev.target as HTMLTextAreaElement;
    const at = target.dataset.eline;
    if (at === undefined) {
      // 머리 칸: Enter·Tab 다음 칸(마지막이면 저장), Shift+Tab 앞 칸, Esc 취소
      if (isKey(ev, "common.cancel")) {
        ev.preventDefault();
        onCancel();
        return;
      }
      rowKeys(ev, ref.current, () => save());
      return;
    }
    const i = Number(at);
    const act = talkAction(ev);
    if (act) ev.preventDefault();
    if (act === "cancel") return onCancel();
    if (act === "submit") return save();
    if (act === "prev") return void moveField(ref.current!, target, -1);
    if (act === "br") return insertBreak(target);
    if (act === "next" || act === "same") {
      const v = target.value;
      if (!v.trim()) return;
      const cur = { ...lines[i], t: v };
      const head = v.slice(0, target.selectionStart);
      const tail = v.slice(target.selectionEnd);
      if (!tail && act === "next" && i < lines.length - 1 && !lines[i + 1].t) return setFocus(i + 1);
      const s = act === "same" ? cur : nextOf(cur);
      const next = lines.map((l) => ({ ...l }));
      next[i] = { ...cur, t: tail ? head : v };
      next.splice(i + 1, 0, { who: s.who, me: s.me, t: tail });
      setLines(next);
      setFocus(i + 1);
      caretStart.current = true;
      return;
    }
    if (ev.key === "Enter") return ev.preventDefault();
    const cur = lines[i];
    if (ev.key === "Backspace" && cur.t === "" && lines.length > 1) {
      ev.preventDefault();
      setLines(lines.filter((_, j) => j !== i));
      setFocus(Math.max(0, i - 1));
    } else if (ev.key === "ArrowUp" && i > 0 && lineEdge(target, true)) {
      ev.preventDefault();
      setFocus(i - 1);
    } else if (ev.key === "ArrowDown" && i < lines.length - 1 && lineEdge(target, false)) {
      ev.preventDefault();
      setFocus(i + 1);
    }
  }

  const p = project !== null ? ctx.byId.get(project) : undefined;

  return (
    <div ref={ref} className={"jcard jcard-edit" + (memo ? " jcard-memo" : "")} role="group" aria-label="기록 고치기" onKeyDown={onKeyDown}>
      <div className="jpillar">
        <input
          ref={timeRef}
          aria-label="시간"
          className={"cell-input num strong" + (badTime ? " invalid" : "")}
          aria-invalid={badTime || undefined}
          value={time}
          onFocus={(ev) => ev.currentTarget.select()}
          onChange={(ev) => {
            setTime(ev.target.value);
            setBadTime(false);
          }}
          onBlur={() => {
            const t = normTime(time);
            if (t) setTime(t);
          }}
        />
        <input
          aria-label="구분"
          autoComplete="off"
          className="cell-input"
          value={kind}
          onKeyDown={editKindGuard.onKeyDown}
          onChange={editKindGuard.onChange}
          onCompositionEnd={editKindGuard.onCompositionEnd}
          onBlur={() => {
            const k = expandKind(kind, ctx.kinds);
            if (k !== kind) setKind(k);
          }}
        />
        {!memo && (
        <span className="jproj-wrap jproj-pillar">
          <button
            type="button"
            className="jproj-badge"
            style={p ? { background: `var(--pj-${projectColor(p)}-bg)`, color: `var(--pj-${projectColor(p)}-fg)`, borderColor: `var(--pj-${projectColor(p)}-line)` } : undefined}
            title={p ? pjFull(p) : "눌러서 사업 바꾸기"}
            aria-label={`사업: ${p ? pjFull(p) : "없음"}`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {p ? <span className="pbadge-t">{pjLabel(p)}</span> : "+ 사업"}
          </button>
          {menu && (
            <ProjectMenu
              ctx={ctx}
              current={project}
              onPick={(id) => {
                setProject(id);
                setMenu(false);
              }}
              onClose={() => setMenu(false)}
            />
          )}
        </span>
        )}
      </div>
      <div className="jnew-main">
        {memo ? (
          <MemoEditor initial={body} editorRef={editorRef} placeholder="메모 내용" onChange={setBody} onSubmit={() => save()} onCancel={onCancel} />
        ) : (
        <>
        <div className="jnew-top">
          <WhoInput
            className="cell-input"
            placeholder="상대"
            value={who}
            contacts={ctx.contacts}
            onChange={setWho}
            onPick={(v) => {
              setWho(v);
              fill(v, kind);
            }}
          />
          <PhoneInput
            aria-label="연락처"
            placeholder="연락처"
            data-ime={expandKind(kind, ctx.kinds).includes("메일") ? "en" : undefined}
            className="cell-input num jedit-tel"
            value={tel}
            onChange={setTel}
          />
        </div>
        <div className="jlines-in">
          {lines.map((l, i) => (
            <div key={i} className="jline-in">
              <SpeakerButton
                s={l}
                onClick={() => {
                  const n = nextOf(l);
                  const next = lines.map((x) => ({ ...x }));
                  next[i] = { ...next[i], who: n.who, me: n.me };
                  setLines(next);
                  setFocus(i);
                }}
              />
              <textarea
                data-eline={i}
                rows={1}
                aria-label={`${l.me ? "내" : l.who + "의"} 말`}
                className="cell-input jtalk"
                value={l.t}
                onFocus={() => setFocus(i)}
                onChange={(ev) => {
                  const next = lines.map((x) => ({ ...x }));
                  next[i].t = ev.target.value;
                  setLines(next);
                }}
              />
            </div>
          ))}
        </div>
        </>
        )}
        {asking ? (
          <AskBand className="jask" label="기록 지우기 확인" text="이 기록을 지울까요?" onNo={() => setAsking(false)} onYes={onRemove} />
        ) : (
          <div className="jedit-foot">
            {/* 지우기는 맨 왼쪽, 취소·저장은 오른쪽 끝(2026-10-26 사용자 – 저장 옆 바깥에 있으면 잘못 누르기 쉬워요) */}
            <button type="button" className="tool-box jtrash del-btn" aria-label="이 기록 지우기" title="이 기록 지우기" onClick={() => setAsking(true)}>
              <DelGlyph />
            </button>
            {memo ? (
              <span className="hint">Tab 저장 · Esc 취소</span>
            ) : (
              <span className="hint" title="Enter 다음 말 · Shift+Enter 같은 사람 · Alt+Enter 한 말 안 줄 바꿈 · Tab 저장 · Esc 취소">
                Enter 다음 말 · Tab 저장 · Esc 취소
              </span>
            )}
            <button type="button" className="btn btn-xs" onClick={onCancel}>
              취소
            </button>
            <button type="button" className="btn-primary btn-xs" onClick={() => save()}>
              저장
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 업무일지 인쇄 (2026-10-17 사용자 – 시안 JournalPrint.dc.html 기간 창, JournalPdf.dc.html 종이 모양)
// - 검색창 옆 "인쇄" → 기간 창(빠른 선택 · 시작일~끝일 칸 · 두 달 달력, 늘 6주) → 엣지 인쇄 창(window.print).
//   엣지 인쇄 창에서 프린터를 고르거나 목록의 "PDF로 저장"으로 PDF를 만들어요.
// - 종이: A4 가로, 여백은 종이 안쪽(위 5 · 아래 15 · 왼쪽 25 · 오른쪽 5mm). @page 여백이 0이라 엣지가 머리·바닥에 날짜·주소를 찍지 않아요.
// - 날마다 새 쪽, 기록 없는 날은 빼요. 카드는 쪼개지 않고 왼쪽 열을 쪽 높이까지 채운 뒤 오른쪽 열, 그다음 쪽.
//   (한 장이 열 높이보다 크면 그 카드만 줄여 한 열에 맞춰요.)
// - 머리 줄은 출근·교통·날씨·메모만. 메모 카드도 시각·"메모"와 본문을 찍어요. 머릿기호는 화면과 같은 그린 모양(.rte-view 규칙).
// - 아래 여백에 "기록 업무일지"와 쪽 번호 "1 / 2".
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const p2 = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`;
const toDate = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const wd = (k: string | null) => (k ? `(${WEEK[toDate(k).getDay()]})` : "");
const label = (k: string) => {
  const [, m, d] = k.split("-").map(Number);
  return `${m}월 ${d}일 ${wd(k)}`;
};
/** 달 번호(2026년 10월 = 2026*12+9) */
const monthIndex = (k: string) => Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)) - 1;

export type PrintDay = { date: string; info: DayInfo; entries: Entry[] };
type Ctx = { myName: string; byId: Map<number, Project> };

// ---------- 기간 창 ----------

export function PrintDialog({
  day,
  today,
  entries,
  days,
  holidays,
  myName,
  projects,
  onClose,
}: {
  day: string;
  today: string;
  entries: Entry[];
  days: DayInfo[];
  holidays: Set<string>;
  myName: string;
  projects: Project[];
  onClose: () => void;
}) {
  const [from, setFrom] = useState(day);
  const [to, setTo] = useState(day);
  const [chip, setChip] = useState("");
  const [act, setAct] = useState<"from" | "to">("from");
  const [hov, setHov] = useState<string | null>(null);
  // 왼쪽 달(오른쪽은 그다음 달). 처음엔 보고 있는 날의 달이 오른쪽이에요.
  const [base, setBase] = useState(monthIndex(day) - 1);
  const [pages, setPages] = useState(0);
  const [printing, setPrinting] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const a = parseDate(from);
  const b = parseDate(to);
  const ok = !!(a && b && a <= b);

  const rec = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [entries]);

  const printDays: PrintDay[] = useMemo(() => {
    if (!ok) return [];
    return [...rec.keys()]
      .filter((k) => k >= a! && k <= b!)
      .sort()
      .map((date) => ({
        date,
        info: days.find((x) => x.date === date) ?? { date, arrive: "", transport: "", weather: "", note: "" },
        entries: [...rec.get(date)!].sort((x, y) => (x.time !== y.time ? (x.time < y.time ? -1 : 1) : x.id - y.id)),
      }));
  }, [ok, a, b, rec, days]);

  const ctx = useMemo(() => ({ myName, byId: new Map(projects.map((p) => [p.id, p])) }), [myName, projects]);

  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing && !printing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, printing]);

  // 엣지 인쇄 창: 인쇄하는 동안만 밝은 색으로 그리고(어둡게 테마여도 종이는 흰 바탕), 끝나면 되돌려요.
  useEffect(() => {
    if (!printing) return;
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "light");
    root.classList.add("jp-printing");
    let done = false;
    const restore = () => {
      if (done) return;
      done = true;
      root.classList.remove("jp-printing");
      if (prev === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", prev);
    };
    // 엣지 인쇄 창을 닫으면(인쇄·PDF 저장·취소 모두) 기간 창도 닫아요.
    const finish = () => {
      restore();
      setPrinting(false);
      closeRef.current();
    };
    window.addEventListener("afterprint", finish);
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", finish);
      // afterprint가 오지 않은 채 창을 닫아도 테마는 되돌려요.
      restore();
    };
  }, [printing]);

  const pick = (k: string) => {
    setChip("");
    setHov(null);
    if (act === "from" || !a || k < a) {
      setFrom(k);
      setTo(k);
      setAct("to");
    } else {
      setTo(k);
      setAct("from");
    }
  };

  // 끝일을 고르는 중이면 마우스가 올라간 날까지 미리 칠해요.
  const lo = a;
  const hi = act === "to" && a && hov && hov >= a ? hov : b;
  const inRange = (k: string) => !!(lo && hi && lo <= hi && k >= lo && k <= hi);

  const months = [0, 1].map((i) => {
    const mi = base + i;
    const y = Math.floor(mi / 12);
    const m = mi - y * 12;
    const first = new Date(y, m, 1).getDay();
    const len = new Date(y, m + 1, 0).getDate();
    type Cell = { k: string; d: number; dow: number } | null;
    const cells: Cell[] = [];
    for (let j = 0; j < first; j++) cells.push(null);
    for (let d = 1; d <= len; d++) cells.push({ k: key(y, m, d), d, dow: new Date(y, m, d).getDay() });
    // 달력은 늘 6주(42칸) – 달을 넘겨도 창 크기가 바뀌지 않아요.
    while (cells.length < 42) cells.push(null);
    return { title: `${y}년 ${m + 1}월`, cells };
  });

  const t = toDate(today);
  const ty = t.getFullYear();
  const monday = new Date(t);
  monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const ks = (d: Date) => key(d.getFullYear(), d.getMonth(), d.getDate());
  const lastMonth = new Date(ty, t.getMonth() - 1, 1);
  const CHIPS: [string, string, string, string][] = [
    ["today", "오늘", today, today],
    ["week", "이번 주", ks(monday), ks(sunday)],
    ["month", "이번 달", key(ty, t.getMonth(), 1), ks(new Date(ty, t.getMonth() + 1, 0))],
    ["last", "지난달", ks(lastMonth), ks(new Date(ty, t.getMonth(), 0))],
    ["ytd", "연초", `${ty}-01-01`, today],
    ["year", "올해", `${ty}-01-01`, `${ty}-12-31`],
  ];

  const field = (which: "from" | "to", text: string, parsed: string | null) => {
    const active = act === which;
    const bad = !parsed || (which === "to" && !!a && !!b && b < a);
    const set = which === "from" ? setFrom : setTo;
    return (
      <label className={"jp-field" + (active ? " on" : "")}>
        <span className="jp-field-l">{which === "from" ? "시작일" : "끝일"}</span>
        <span className={"jp-field-box" + (bad ? " invalid" : "")}>
          <DateInput
            label={which === "from" ? "시작일" : "끝일"}
            base=""
            placeholder=""
            invalid={bad}
            boxInvalid
            fixOnEnter
            value={text}
            onFocus={() => {
              setAct(which);
              setHov(null);
            }}
            onChange={(v) => {
              set(v);
              setChip("");
              const p = parseDate(v);
              if (p) setBase(monthIndex(p) - (which === "to" ? 1 : 0));
            }}
          />
          <span className="jp-wd">{parsed ? wd(parsed) : ""}</span>
        </span>
      </label>
    );
  };

  const nDays = printDays.length;
  const sum1 = !a || !b ? "날짜를 읽을 수 없어요" : !ok ? "끝일이 시작일보다 앞이에요" : a === b ? label(a) : `${label(a)} ~ ${label(b)}`;
  const sum2 = !ok ? "" : nDays ? `기록 있는 날 ${nDays}일 · ${pages}쪽 · 날마다 새 쪽` : "이 기간에는 기록이 없어요";
  const can = ok && nDays > 0 && pages > 0;

  return (
    <>
      <div className="overlay jp-overlay" onMouseDown={overlayDown(onClose)}>
        <div className="dialog jp-dlg" role="dialog" aria-modal="true" aria-label="업무일지 인쇄">
          <div className="jp-head">
            <h2 className="jp-title" data-dialog-title>
              업무일지 인쇄
            </h2>
          </div>
          <DialogX onClick={onClose} />

          <div className="jp-top">
            <div className="jp-chips" role="group" aria-label="빠른 선택">
              {CHIPS.map(([k, name, f, tt]) => (
                <button
                  key={k}
                  type="button"
                  className="jp-chip"
                  aria-pressed={chip === k}
                  onClick={() => {
                    setChip(k);
                    setFrom(f);
                    setTo(tt);
                    setAct("from");
                    setHov(null);
                    setBase(monthIndex(tt) - 1);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="jp-fields">
              {field("from", from, a)}
              <span className="jp-tilde" aria-hidden="true">
                ~
              </span>
              {field("to", to, b)}
            </div>
          </div>

          <div className="jp-cal" onMouseLeave={() => setHov(null)}>
            <button type="button" className="jp-nav prev" aria-label="이전 달" onClick={() => setBase(base - 1)}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <button type="button" className="jp-nav next" aria-label="다음 달" onClick={() => setBase(base + 1)}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            {months.map((m) => (
              <div key={m.title} className="jp-month">
                <div className="jp-mtitle">{m.title}</div>
                <div className="jp-week" aria-hidden="true">
                  {WEEK.map((w, i) => (
                    <span key={w} className={i === 0 ? "red" : i === 6 ? "sat" : ""}>
                      {w}
                    </span>
                  ))}
                </div>
                <div className="jp-grid">
                  {m.cells.map((c, i) => {
                    if (!c) return <div key={i} className="jp-cell" />;
                    const end = c.k === lo || c.k === hi;
                    const within = inRange(c.k);
                    const left = c.k === lo && lo !== hi && within;
                    const right = c.k === hi && lo !== hi && within;
                    const band = within && lo !== hi ? (left ? " band band-l" : right ? " band band-r" : " band") : "";
                    const tone = c.dow === 0 || holidays.has(c.k) ? " red" : c.dow === 6 ? " sat" : "";
                    const has = rec.has(c.k);
                    return (
                      <div key={i} className={"jp-cell" + band}>
                        <button
                          type="button"
                          className={"jp-day" + tone + (end && within ? " end" : "") + (c.k === today ? " today" : "") + (has ? " has" : "")}
                          aria-label={`${Number(c.k.slice(5, 7))}월 ${c.d}일${has ? ", 기록 있음" : ""}`}
                          aria-pressed={end && within}
                          onClick={() => pick(c.k)}
                          onMouseEnter={() => act === "to" && setHov(c.k)}
                        >
                          <span>{c.d}</span>
                          <span className="jp-dot" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="jp-legend">
            <span className="jp-legend-i">
              <span className="jp-dot" aria-hidden="true" />
              기록 있는 날
            </span>
            <span>{act === "to" ? "끝일을 눌러 주세요" : "시작일을 눌러 주세요"}</span>
          </div>

          <div className="jp-foot">
            <div className="jp-sum">
              <span className={"jp-sum1" + (ok ? "" : " bad")}>{sum1}</span>
              <span className="jp-sum2">{sum2}</span>
            </div>
            <button type="button" className="btn btn-ctrl btn-text" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn-primary btn-ctrl jp-go" disabled={!can || printing} onClick={() => setPrinting(true)}>
              인쇄
            </button>
          </div>
        </div>
      </div>
      <PrintPages days={printDays} ctx={ctx} onPages={setPages} />
    </>
  );
}

// ---------- 종이 ----------

const MM = 96 / 25.4;
const PAGE_H = 210;
const PAD = { top: 5, right: 5, bottom: 15, left: 25 };
const CONTENT_W = 297 - PAD.left - PAD.right; // 267mm
const CONTENT_H = PAGE_H - PAD.top - PAD.bottom; // 190mm
const COL_GAP = 16; // px
const HEAD_GAP = 10; // px
const CARD_GAP = 8; // px
const COL_W = (CONTENT_W * MM - COL_GAP) / 2;

type Page = { day: PrintDay; cols: [Entry[], Entry[]] };

/**
 * 고른 날들을 쪽으로 나눠 그려요. 화면에는 보이지 않고(창 밖), 인쇄할 때만 이것만 찍혀요.
 * 먼저 카드와 머리 줄을 열 폭으로 그려 높이를 재고(측정), 그 높이로 쪽을 나눠요.
 */
export function PrintPages({ days, ctx, onPages }: { days: PrintDay[]; ctx: Ctx; onPages?: (n: number) => void }) {
  const measure = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [scale, setScale] = useState<Map<number, number>>(new Map());
  const [fontTick, setFontTick] = useState(0);

  useEffect(() => {
    let on = true;
    document.fonts?.ready.then(() => on && setFontTick((x) => x + 1));
    return () => {
      on = false;
    };
  }, []);

  useLayoutEffect(() => {
    const box = measure.current;
    if (!box) return;
    const colH = CONTENT_H * MM;
    const out: Page[] = [];
    const sc = new Map<number, number>();
    for (const d of days) {
      const head = box.querySelector<HTMLElement>(`[data-head="${d.date}"]`);
      const avail = colH - (head?.offsetHeight ?? 40) - HEAD_GAP;
      let page: Page = { day: d, cols: [[], []] };
      let col = 0;
      let used = 0;
      for (const e of d.entries) {
        const el = box.querySelector<HTMLElement>(`[data-card="${e.id}"]`);
        let h = el?.offsetHeight ?? 60;
        if (h > avail) {
          sc.set(e.id, avail / h);
          h = avail;
        }
        const need = (used ? CARD_GAP : 0) + h;
        if (used && used + need > avail) {
          if (col === 0) col = 1;
          else {
            out.push(page);
            page = { day: d, cols: [[], []] };
            col = 0;
          }
          used = 0;
        }
        page.cols[col].push(e);
        used += (used ? CARD_GAP : 0) + h;
      }
      out.push(page);
    }
    setPages(out);
    setScale(sc);
    onPages?.(out.length);
  }, [days, ctx, fontTick, onPages]);

  return createPortal(
    <div className="jp-root" aria-hidden="true">
      <div className="jp-measure" ref={measure} style={{ width: COL_W }}>
        {days.map((d) => (
          <div key={d.date}>
            <div style={{ width: CONTENT_W * MM }}>
              <PaperHead day={d} myName={ctx.myName} />
            </div>
            {d.entries.map((e) => (
              <PaperCard key={e.id} entry={e} ctx={ctx} />
            ))}
          </div>
        ))}
      </div>
      <div className="jp-pages">
        {pages.map((p, i) => (
          <section key={i} className="jp-page">
            <PaperHead day={p.day} myName={ctx.myName} />
            <div className="jp-cols">
              {p.cols.map((col, ci) => (
                <div key={ci} className="jp-col">
                  {col.map((e) => (
                    <PaperCard key={e.id} entry={e} ctx={ctx} zoom={scale.get(e.id)} />
                  ))}
                </div>
              ))}
            </div>
            <footer className="jp-pfoot">
              <span>기록 업무일지</span>
              <span>
                {i + 1} / {pages.length}
              </span>
            </footer>
          </section>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function PaperHead({ day, myName }: { day: PrintDay; myName: string }) {
  const [y, m, d] = day.date.split("-").map(Number);
  const it = day.info;
  const items: [string, string][] = [
    ["출근", it.arrive],
    ["교통", it.transport],
    ["날씨", it.weather],
    ["메모", it.note],
  ];
  return (
    <header className="jp-phead" data-head={day.date}>
      <h1>
        업무일지 {y}. {m}. {d}. {wd(day.date)}
      </h1>
      <div className="jp-phead-items">
        {items
          .filter(([, v]) => v.trim())
          .map(([k, v]) => (
            <span key={k}>
              <b>{k}</b> {v}
            </span>
          ))}
      </div>
      <span className="jp-phead-me">{myName}</span>
    </header>
  );
}

function kindTone(kind: string) {
  if (isMemo(kind)) return "memo";
  if (kind.includes("발신")) return "send";
  if (kind.includes("수신")) return "recv";
  return "meet";
}

function PaperCard({ entry: e, ctx, zoom }: { entry: Entry; ctx: Ctx; zoom?: number }) {
  const memo = isMemo(e.kind) && (!!e.body || !e.lines.length);
  const { name, rest } = splitWho(e.who);
  const p = e.project !== null ? ctx.byId.get(e.project) : undefined;
  const pk = p ? projectColor(p) : 0;
  const html = useMemo(() => (memo ? sanitize(e.body) : ""), [memo, e.body]);
  return (
    <article className="jp-card" data-card={e.id} style={zoom ? ({ zoom } as React.CSSProperties) : undefined}>
      <div className="jp-chead">
        <b className="jp-time">{e.time}</b>
        <span className={"jp-kind " + kindTone(e.kind)}>{e.kind}</span>
        {!memo && (
          <>
            {name && <span className="jp-who">{name}</span>}
            {rest && <span className="jp-sub">{rest}</span>}
            {e.contact && <span className="jp-sub jp-num">{e.contact}</span>}
            {p && (
              <span className="jp-proj" style={{ background: `var(--pj-${pk}-bg)`, color: `var(--pj-${pk}-fg)`, borderColor: `var(--pj-${pk}-line)` }}>
                {p.name}
              </span>
            )}
          </>
        )}
      </div>
      {memo ? (
        <div className="rte-view jp-memo" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="jp-lines">
          {e.lines.map((l, i) => {
            const k = speakerColor(l.who);
            return (
              <div key={i} className="jp-line">
                <span className={"jp-sp" + (l.me ? " me" : "")} style={l.me ? undefined : { background: `var(--pj-${k}-bg)`, color: `var(--pj-${k}-fg)` }}>
                  {l.me ? ctx.myName : l.who}
                </span>
                <span className="jp-line-t">{l.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
