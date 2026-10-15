// 업무일지 화면이에요. 시안 Journal.dc.html과 사양서의 "업무일지" 절을 따라요.
// 누가 언제 무슨 말을 했는지 남기는 곳이라, 손을 키보드에서 떼지 않고 한 건을 끝낼 수 있게 만들었어요.
import { KeyboardEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, Contact, ContactsData, DayInfo, Entry, EntryInput, errorText, JournalData, Project } from "./api";
import { copyText, Hl, projectColor } from "./ContactsScreen";
import { PhoneInput } from "./PhoneInput";
import { finalizePhone } from "./phone";
import {
  contactFor,
  contactLabel,
  dayLabel,
  dayTitle,
  DraftLine,
  expandKind,
  findContact,
  firstContact,
  initials,
  isChosung,
  isMemo,
  koIndex,
  matchEntry,
  parseDate,
  normTime,
  nowHM,
  resolveDraft,
  sameSpeaker,
  sortEntries,
  Speaker,
  speakerColor,
  speakers,
  splitWho,
  todayStr,
} from "./journal";
import { isEmptyMemo, MemoEditor, MemoView, sanitize } from "./RichMemo";
import { DEFAULT_SETTINGS, Kind, loadSettings } from "./settingsStore";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

/**
 * 말 줄의 Tab. 한글을 치는 중(마지막 글자가 아직 조합 중)에 Tab을 누르면 브라우저가 키 이름을
 * "Process"로 줄 때가 있어 실제 키 자리(code)도 봐요. 같은 Tab이 두 번 들어오는 경우도 있어 한 번만 받아요.
 */
function lineTab(e: KeyboardEvent, last: { current: number }): "skip" | "tab" | null {
  if (e.key !== "Tab" && e.nativeEvent.code !== "Tab") return null;
  const now = e.timeStamp;
  if (now - last.current < 25) return "skip";
  last.current = now;
  return "tab";
}

/** 화면 전체가 함께 쓰는 값 */
type Ctx = {
  myName: string;
  kinds: Kind[];
  contacts: Contact[];
  projects: Project[];
  byId: Map<number, Project>;
};

// ---------- 화면 ----------

export default function JournalScreen() {
  const [data, setData] = useState<JournalData | null>(null);
  const [cdata, setCdata] = useState<ContactsData>({ contacts: [], projects: [] });
  const [myName, setMyName] = useState(DEFAULT_SETTINGS.myName);
  const [kinds, setKinds] = useState<Kind[]>(DEFAULT_SETTINGS.kinds);
  const [today, setToday] = useState(todayStr());
  const [day, setDay] = useState(today);
  const [q, setQ] = useState("");
  const [onlyHits, setOnlyHits] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    api.journalData().then(setData, (e) => setNote(errorText(e)));
    api.contactsData().then(setCdata, () => {});
    loadSettings().then(
      (s) => {
        setMyName(s.myName || DEFAULT_SETTINGS.myName);
        setKinds(s.kinds);
      },
      () => {},
    );
  }, []);

  // 자정을 넘기면 "오늘"을 바꿔요. 오늘을 보고 있었으면 새 날로 넘어가요.
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = todayStr();
      if (now !== today) {
        setDay((d) => (d === today ? now : d));
        setToday(now);
      }
    }, 30_000);
    return () => window.clearInterval(t);
  }, [today]);

  const ctx: Ctx = useMemo(
    () => ({
      myName,
      kinds,
      contacts: cdata.contacts,
      projects: cdata.projects,
      byId: new Map(cdata.projects.map((p) => [p.id, p])),
    }),
    [myName, kinds, cdata],
  );

  /** 저장 쪽을 부르고, 실패하면 이유를 보여 줘요. */
  const run = useCallback(async <T,>(p: Promise<T>): Promise<T | null> => {
    try {
      const r = await p;
      setNote("");
      return r;
    } catch (e) {
      setNote(errorText(e));
      return null;
    }
  }, []);

  const putEntry = useCallback((e: Entry) => {
    setData((d) => d && { ...d, entries: sortEntries([e, ...d.entries.filter((x) => x.id !== e.id)]) });
  }, []);

  const add = useCallback(
    async (input: EntryInput) => {
      const e = await run(api.addEntry(input));
      if (e) putEntry(e);
      return !!e;
    },
    [run, putEntry],
  );

  const update = useCallback(
    async (id: number, input: EntryInput) => {
      const e = await run(api.updateEntry(id, input));
      if (e) putEntry(e);
      return !!e;
    },
    [run, putEntry],
  );

  const remove = useCallback(
    async (id: number) => {
      setEditId(null);
      try {
        await api.deleteEntry(id);
        setNote("");
        setData((d) => d && { ...d, entries: d.entries.filter((x) => x.id !== id) });
      } catch (e) {
        setNote(errorText(e));
      }
    },
    [],
  );

  const saveDay = useCallback(
    async (info: DayInfo) => {
      const r = await run(api.setDay(info));
      if (r) setData((d) => d && { ...d, days: [...d.days.filter((x) => x.date !== r.date), r].filter((x) => x.arrive || x.transport || x.weather || x.note) });
    },
    [run],
  );

  const go = useCallback((date: string) => {
    setDay(date);
    setQ("");
    setEditId(null);
    setMenuId(null);
  }, []);

  if (!data) {
    return (
      <>
        <h1 className="title">업무일지</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  const query = q.trim().toLowerCase();
  const entries = data.entries.filter((e) => e.date === day);
  const info = data.days.find((d) => d.date === day) ?? { date: day, arrive: "", transport: "", weather: "", note: "" };
  const dates = new Set([today, day, ...data.entries.map((e) => e.date), ...data.days.map((d) => d.date)]);

  return (
    <div className="jn">
      <DateTree dates={[...dates].sort().reverse()} day={day} onPick={go} />

      <div className="jn-body">
        <div className="jn-head">
          <h1 className="title">{dayTitle(day)}</h1>
          <DateJump onGo={go} />
          {day !== today && (
            <button type="button" className="btn btn-ctrl" onClick={() => go(today)}>
              오늘
            </button>
          )}
          <label className="search jn-search">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              aria-label="일지 검색"
              placeholder="사람, 내용으로 전체 일지 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && q) {
                  e.preventDefault();
                  setQ("");
                }
              }}
            />
          </label>
        </div>

        <DayHead key={day} info={info} onSave={saveDay} />

        {note && <p className="note" role="status">{note}</p>}

        {query ? (
          <SearchResults entries={data.entries} q={query} raw={q.trim()} onlyHits={onlyHits} ctx={ctx} onToggle={() => setOnlyHits(!onlyHits)} onClose={() => setQ("")} onGo={go} />
        ) : (
          <>
            <NewCard key={day} date={day} ctx={ctx} onAdd={add} />
            <div className="jn-cols">
              {entries.map((e) =>
                editId === e.id ? (
                  <EditCard
                    key={e.id}
                    entry={e}
                    ctx={ctx}
                    onCancel={() => setEditId((cur) => (cur === e.id ? null : cur))}
                    onSave={(input) => {
                      setEditId((cur) => (cur === e.id ? null : cur));
                      return update(e.id, input);
                    }}
                    onRemove={() => remove(e.id)}
                  />
                ) : (
                  <ViewCard
                    key={e.id}
                    entry={e}
                    ctx={ctx}
                    menuOpen={menuId === e.id}
                    onMenu={(on) => setMenuId(on ? e.id : null)}
                    onProject={(project) => {
                      setMenuId(null);
                      if (project !== e.project) update(e.id, { ...e, project });
                    }}
                    onOpen={() => {
                      setMenuId(null);
                      setEditId(e.id);
                    }}
                  />
                ),
              )}
            </div>
            {entries.length === 0 && (
              <p className="muted small">
                {day === today ? "오늘 기록이 아직 없어요. 위 카드에 적고 Enter를 눌러 등록해요." : "이 날 기록이 없어요."}
              </p>
            )}
          </>
        )}
        <div className="muted small">
          {day === today ? "오늘" : "이 날"} 기록 {entries.length}건 · 전체 {data.entries.length}건
        </div>
      </div>

      <aside className="jn-aside" aria-label="챙길 일">
        <div className="jn-aside-head">
          <span className="jn-aside-title">챙길 일</span>
          <span className="muted small">마감 7일 이내</span>
        </div>
        <p className="jn-aside-empty muted small">민원대장과 할 일 목록을 만들면 마감이 가까운 일이 여기에 보여요.</p>
      </aside>
    </div>
  );
}

// ---------- 날짜로 가기 ----------

/** 기록 없는 날로도 가는 칸. "1014"(올해), "10/14", "2026-10-14"를 받아요. 읽을 수 없으면 빨간 테두리예요. */
function DateJump({ onGo }: { onGo: (d: string) => void }) {
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  function go() {
    if (!v.trim()) return;
    const d = parseDate(v);
    if (!d) return setBad(true);
    setV("");
    setBad(false);
    onGo(d);
  }
  return (
    <label className={"jjump" + (bad ? " invalid" : "")} title="1014처럼 숫자 네 자리만 쳐도 올해 그 날로 가요. 10/14, 2026-10-14도 돼요.">
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <input
        aria-label="날짜로 가기"
        aria-invalid={bad || undefined}
        placeholder="날짜로 가기 (1014)"
        inputMode="numeric"
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isComposing(e)) {
            e.preventDefault();
            go();
          } else if (e.key === "Escape") {
            setV("");
            setBad(false);
          }
        }}
      />
    </label>
  );
}

// ---------- 날짜 목록 (연 → 월 → 일) ----------

function DateTree({ dates, day, onPick }: { dates: string[]; day: string; onPick: (d: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([day.slice(0, 7)]));
  useEffect(() => setOpen((s) => (s.has(day.slice(0, 7)) ? s : new Set(s).add(day.slice(0, 7)))), [day]);

  const years = new Map<string, Map<string, string[]>>();
  for (const d of dates) {
    const y = d.slice(0, 4);
    const m = d.slice(0, 7);
    if (!years.has(y)) years.set(y, new Map());
    const months = years.get(y)!;
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(d);
  }

  return (
    <nav className="jtree" aria-label="날짜">
      {[...years].map(([y, months]) => (
        <div key={y} className="jtree-year">
          <div className="jtree-y">{y}년</div>
          {[...months].map(([m, days]) => {
            const on = open.has(m);
            return (
              <div key={m} className="jtree-month">
                <button
                  type="button"
                  className="jtree-m"
                  aria-expanded={on}
                  onClick={() =>
                    setOpen((s) => {
                      const n = new Set(s);
                      if (on) n.delete(m);
                      else n.add(m);
                      return n;
                    })
                  }
                >
                  {Number(m.slice(5))}월
                </button>
                {on &&
                  days.map((d) => (
                    <button key={d} type="button" className="jtree-d" aria-pressed={d === day} onClick={() => onPick(d)}>
                      {dayLabel(d)}
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// ---------- 날짜 머리 줄 (출근 · 교통 · 날씨 · 비고) ----------

function DayHead({ info, onSave }: { info: DayInfo; onSave: (d: DayInfo) => void }) {
  const [v, setV] = useState(info);
  const [bad, setBad] = useState(false);
  const saved = useRef(info);

  function commit(next: DayInfo) {
    let arrive = next.arrive.trim();
    if (arrive) {
      const t = normTime(arrive);
      if (!t) {
        setBad(true);
        return;
      }
      arrive = t;
    }
    setBad(false);
    const fixed = { ...next, arrive };
    setV(fixed);
    const s = saved.current;
    if (fixed.arrive === s.arrive && fixed.transport.trim() === s.transport && fixed.weather.trim() === s.weather && fixed.note.trim() === s.note) return;
    saved.current = { ...fixed, transport: fixed.transport.trim(), weather: fixed.weather.trim(), note: fixed.note.trim() };
    onSave(fixed);
  }

  const field = (key: "arrive" | "transport" | "weather" | "note", label: string, cls: string, ph = "") => (
    <label className={"jday-f " + cls}>
      {label}
      <input
        className={"jday-in" + (key === "arrive" && bad ? " invalid" : "")}
        aria-invalid={key === "arrive" && bad ? true : undefined}
        placeholder={ph}
        value={v[key]}
        onChange={(e) => {
          if (key === "arrive") setBad(false);
          setV({ ...v, [key]: e.target.value });
        }}
        onBlur={() => commit(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !isComposing(e)) {
            e.preventDefault();
            commit(v);
          }
        }}
      />
    </label>
  );

  return (
    <div className="jday" role="group" aria-label="이 날의 머리 줄">
      {field("arrive", "출근", "jday-time", "08:40")}
      {field("transport", "교통", "jday-short")}
      {field("weather", "날씨", "jday-mid")}
      {field("note", "비고", "jday-grow", "비고")}
    </div>
  );
}

// ---------- 상대 칸 (업무연락처에서 찾기) ----------

/**
 * 상대 칸. 쉼표로 여러 명을 적고, 마지막으로 적는 이름에 맞는 연락처를 아래에 보여 줘요.
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
  const segs = value.split(",");
  const last = segs[segs.length - 1].trim();
  const lastLc = last.toLowerCase();
  // 이름은 초성으로도 찾아요("ㅂㅈㅎ", "박ㅈ"). 소속·직위는 글자 그대로 찾아요.
  const nameAt = (c: Contact) => koIndex(c.name, last);
  const options = lastLc
    ? contacts
        .filter((c) => contactLabel(c) !== last && (nameAt(c) >= 0 || (!isChosung(last) && [c.org, c.role].some((s) => s.toLowerCase().includes(lastLc)))))
        .sort((a, b) => Number(nameAt(b) === 0) - Number(nameAt(a) === 0) || Number(initials(a.name) !== last) - Number(initials(b.name) !== last))
        .slice(0, 8)
    : [];
  const show = open && options.length > 0;

  function pick(c: Contact) {
    const head = segs.slice(0, -1).map((x) => x.trim()).filter(Boolean);
    onPick([...head, contactLabel(c)].join(", "));
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
      .join(", ");
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
          onChange(e.target.value);
          setOpen(true);
          setHi(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setHi(-1);
          expand();
        }}
        onKeyDown={(e) => {
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

// ---------- 말 배지 ----------

function badgeStyle(s: Speaker) {
  if (s.me) return undefined;
  const k = speakerColor(s.who);
  return { background: `var(--pj-${k}-bg)`, color: `var(--pj-${k}-fg)`, borderColor: `var(--pj-${k}-bg)` };
}

/** 입력 중의 배지. 누르면 말한 사람이 바뀌어요. */
function SpeakerButton({ s, onClick }: { s: Speaker; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={"jsp-btn" + (s.me ? " me" : "")}
      style={badgeStyle(s)}
      title="눌러서 말한 사람 바꾸기"
      aria-label={`말한 사람: ${s.me ? "나" : s.who} (눌러서 변경)`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {s.me ? "나" : s.who}
    </button>
  );
}

// ---------- 신규 입력 카드 ----------

function NewCard({ date, ctx, onAdd }: { date: string; ctx: Ctx; onAdd: (e: EntryInput) => Promise<boolean> }) {
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

  // 구분이 메모로 바뀌는 사이 커서를 잃었으면 편집기로 옮겨요.
  useEffect(() => {
    const a = document.activeElement;
    if (memo && (!a || a === document.body)) editorRef.current?.focus();
  }, [memo]);

  // 화면을 열면 구분 칸에 커서가 가 있어요. (시간은 지금 시각으로 채워져 있어요)
  useEffect(() => kindRef.current?.focus(), []);

  // 시간을 직접 고치지 않았으면 지금 시각을 따라가요.
  useEffect(() => {
    if (timeTouched) return;
    const t = window.setInterval(() => setTime(nowHM()), 15_000);
    return () => window.clearInterval(t);
  }, [timeTouched]);

  // 고르고 있는 말 줄에 커서를 둬요.
  useEffect(() => {
    if (focus === null) return;
    const el = box.current?.querySelector<HTMLInputElement>(`[data-uline="${focus}"]`);
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
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

  const lastTab = useRef(-1000);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLInputElement;
    const at = target.dataset.uline;
    const tab = at === undefined ? null : lineTab(e, lastTab);
    if (tab === "skip") return e.preventDefault();
    if (tab === "tab") {
      const i = Number(at);
      // 빈 줄에서는 보통처럼 칸을 옮겨요.
      if (!(target.value || lines[i].t).trim()) return;
      e.preventDefault();
      if (!e.shiftKey && i < lines.length - 1) return setFocus(i + 1);
      const next = lines.map((l) => ({ ...l }));
      next[i].t = target.value || next[i].t;
      // Tab은 다음 사람(자동), Shift+Tab은 같은 사람이 이어서 말해요.
      next.splice(i + 1, 0, { sp: e.shiftKey ? resolved[i] : null, t: "" });
      setLines(next);
      setFocus(i + 1);
      return;
    }
    if (isComposing(e)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      reset();
      return;
    }
    if (e.key === "Enter" && target.tagName === "INPUT") {
      e.preventDefault();
      submit();
      return;
    }
    if (at === undefined) return;
    const i = Number(at);
    const cur = lines[i];
    if (e.key === "Backspace" && cur.t === "" && lines.length > 1) {
      e.preventDefault();
      setLines(lines.filter((_, j) => j !== i));
      setFocus(Math.max(0, i - 1));
    } else if (e.key === "ArrowUp" && i > 0) {
      e.preventDefault();
      setFocus(i - 1);
    } else if (e.key === "ArrowDown" && i < lines.length - 1) {
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
          onChange={(e) => {
            setTime(e.target.value);
            setTimeTouched(true);
            setBadTime(false);
          }}
          onBlur={() => {
            const t = normTime(time);
            if (t) setTime(t);
            else if (time.trim()) setBadTime(true);
          }}
        />
        <input
          ref={kindRef}
          aria-label="구분"
          placeholder="구분"
          list="jkind-list"
          autoComplete="off"
          className="cell-input"
          title={"초성 단축키: " + ctx.kinds.slice(0, 4).map((k) => `${k.key} ${k.name}`).join(", ") + " …"}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          onBlur={() => {
            const k = expandKind(kind, ctx.kinds);
            if (k !== kind) setKind(k);
            fill(who, k);
          }}
        />
        <datalist id="jkind-list">
          {ctx.kinds.map((k) => (
            <option key={k.name} value={k.name}>
              {k.key}
            </option>
          ))}
        </datalist>
        {!memo && (
          <span className="jpillar-note" title="프로젝트는 상대의 연락처에서 자동으로 붙어요. 등록한 뒤 눌러서 바꿀 수 있어요.">
            프로젝트 자동
          </span>
        )}
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
            <span className="hint">Enter 등록 · Shift+Enter 새 줄 · 표 안에서 Tab 다음 칸 · Esc 취소</span>
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
            placeholder="상대 이름 (연락처에서 자동 검색 · 여러 명은 쉼표로)"
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
          <span className="hint jnew-hint" title="Tab 다음 말(말한 사람 자동 교대) · Shift+Tab 같은 사람이 이어서 · 배지를 누르면 사람 변경 · Enter 등록 · Esc 취소">
            Tab 다음 말 · Shift+Tab 같은 사람 · Enter 등록
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
                  <input
                    data-uline={i}
                    aria-label={`${s.me ? "내" : s.who + "의"} 말`}
                    placeholder={s.me ? "내가 한 말" : `${s.who}이(가) 한 말`}
                    className="cell-input"
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

// ---------- 등록된 기록 (시간 기둥형 카드) ----------

function stripe(e: Entry, ctx: Ctx) {
  const p = e.project !== null ? ctx.byId.get(e.project) : undefined;
  return p ? { borderLeft: `4px solid var(--pj-${projectColor(p)}-fg)` } : undefined;
}

/** 대화 줄들. q가 있으면 맞은 글자를 칠하고, dim에 든 줄은 흐리게 보여요. */
function Lines({ entry, q = "", show, dim }: { entry: Entry; q?: string; show?: boolean[]; dim?: boolean[] }) {
  return (
    <div className="jlines">
      {entry.lines.map((l, i) =>
        show && !show[i] ? null : (
          <div key={i} className={"jline" + (dim?.[i] ? " dim" : "")}>
            <span className={"jsp" + (l.me ? " me" : "")} style={badgeStyle(l)}>
              {l.me ? "나" : <Hl text={l.who} q={q} />}
            </span>
            <span className="jline-t">
              <Hl text={l.text} q={q} />
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function PillarTel({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const at = value.indexOf("@");
  const parts = at > 0 ? [value.slice(0, at), value.slice(at)] : [value];
  return (
    <button
      type="button"
      className={"jtel" + (copied ? " copied" : "")}
      title={copied ? "복사했어요" : "눌러서 복사"}
      aria-label={`${value} 복사`}
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(value);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
      <span className="jtel-note" aria-live="polite">
        {copied ? "복사했어요" : ""}
      </span>
    </button>
  );
}

/** 프로젝트를 고르는 작은 목록 */
function ProjectMenu({ ctx, current, onPick, onClose }: { ctx: Ctx; current: number | null; onPick: (id: number | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // 프로젝트 버튼을 다시 누르는 것은 버튼이 닫아요. 그 밖을 누르면 여기서 닫아요.
    const down = (e: MouseEvent) => {
      const wrap = ref.current?.parentElement;
      if (!wrap?.contains(e.target as Node)) close.current();
    };
    const key = (e: globalThis.KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    ref.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const opts: (Project | null)[] = [null, ...ctx.projects];
  return (
    <div ref={ref} className="jmenu" role="menu" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      {opts.map((p) => (
        <button key={p?.id ?? 0} type="button" role="menuitemradio" className="jmenu-opt" aria-pressed={(p?.id ?? null) === current} onClick={() => onPick(p?.id ?? null)}>
          <span className="jmenu-dot" aria-hidden="true" style={{ background: p ? `var(--pj-${projectColor(p)}-fg)` : "var(--line)" }} />
          {p?.name ?? "없음"}
        </button>
      ))}
      {ctx.projects.length === 0 && <div className="hint jmenu-hint">프로젝트는 업무연락처의 "프로젝트 관리"에서 만들어요.</div>}
    </div>
  );
}

function ViewCard({
  entry: e,
  ctx,
  menuOpen,
  onMenu,
  onProject,
  onOpen,
}: {
  entry: Entry;
  ctx: Ctx;
  menuOpen: boolean;
  onMenu: (on: boolean) => void;
  onProject: (id: number | null) => void;
  onOpen: () => void;
}) {
  const { name, rest } = splitWho(e.who);
  const p = e.project !== null ? ctx.byId.get(e.project) : undefined;
  const memo = isMemo(e.kind) && (!!e.body || !e.lines.length);
  return (
    <article
      className={"jcard" + (memo ? " jcard-memo" : "")}
      style={memo ? undefined : stripe(e, ctx)}
      title="눌러서 수정"
      tabIndex={0}
      aria-label={`${e.time} ${e.kind} ${e.who}`}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.target === ev.currentTarget && ev.key === "Enter") {
          ev.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="jpillar">
        <span className="jtime">{e.time}</span>
        <span className="jkind">{e.kind}</span>
        {e.contact && !memo && <PillarTel value={e.contact} />}
      </div>
      {memo ? (
        <div className="jmain jmemo-main">
          <MemoView html={e.body} />
        </div>
      ) : (
      <div className="jmain">
        <div className="jhead">
          <span className="jname">{name || "상대 없음"}</span>
          {rest && <span className="jrest">{rest}</span>}
          <span className="jproj-wrap">
            <button
              type="button"
              className={"jproj" + (p ? "" : " none")}
              title="눌러서 프로젝트 바꾸기"
              aria-label={`프로젝트: ${p?.name ?? "없음"}`}
              aria-expanded={menuOpen}
              onClick={(ev) => {
                ev.stopPropagation();
                onMenu(!menuOpen);
              }}
            >
              {p?.name ?? "+ 프로젝트"}
            </button>
            {menuOpen && <ProjectMenu ctx={ctx} current={e.project} onPick={onProject} onClose={() => onMenu(false)} />}
          </span>
        </div>
        <Lines entry={e} />
      </div>
      )}
    </article>
  );
}

/** 예전에 말 줄로 적은 메모를 편집기 본문으로 옮겨요. */
function linesToBody(e: Entry): string {
  if (e.body) return e.body;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return e.lines.map((l) => `<p>${esc(l.me ? l.text : `${l.who}: ${l.text}`)}</p>`).join("");
}

// ---------- 고치는 카드 ----------

type EditLine = Speaker & { t: string };

function EditCard({
  entry: e,
  ctx,
  onCancel,
  onSave,
  onRemove,
}: {
  entry: Entry;
  ctx: Ctx;
  onCancel: () => void;
  onSave: (input: EntryInput) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [time, setTime] = useState(e.time);
  const [badTime, setBadTime] = useState(false);
  const [kind, setKind] = useState(e.kind);
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
  useEffect(() => {
    const down = (ev: MouseEvent) => {
      if (ref.current && !ref.current.contains(ev.target as Node)) {
        setAsking(false);
        latest.current.save(true);
      }
    };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLInputElement>(`[data-eline="${focus}"]`);
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [focus, lines.length]);

  function fill(nextWho: string, nextKind: string) {
    const c = firstContact(nextWho, ctx.contacts);
    if (c) setTel(contactFor(c, expandKind(nextKind, ctx.kinds)));
  }

  const lastTab = useRef(-1000);

  function onKeyDown(ev: KeyboardEvent<HTMLDivElement>) {
    if (ev.defaultPrevented || asking) return;
    const target = ev.target as HTMLInputElement;
    const at = target.dataset.eline;
    const tab = at === undefined ? null : lineTab(ev, lastTab);
    if (tab === "skip") return ev.preventDefault();
    if (tab === "tab") {
      const i = Number(at);
      const cur = { ...lines[i], t: target.value || lines[i].t };
      if (!cur.t.trim()) return;
      ev.preventDefault();
      if (!ev.shiftKey && i < lines.length - 1) return setFocus(i + 1);
      const s = ev.shiftKey ? cur : nextOf(cur);
      const next = lines.map((l) => ({ ...l }));
      next[i] = cur;
      next.splice(i + 1, 0, { who: s.who, me: s.me, t: "" });
      setLines(next);
      setFocus(i + 1);
      return;
    }
    if (isComposing(ev)) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      onCancel();
      return;
    }
    if (ev.key === "Enter" && target.tagName === "INPUT") {
      ev.preventDefault();
      save();
      return;
    }
    if (at === undefined) return;
    const i = Number(at);
    const cur = lines[i];
    if (ev.key === "Backspace" && cur.t === "" && lines.length > 1) {
      ev.preventDefault();
      setLines(lines.filter((_, j) => j !== i));
      setFocus(Math.max(0, i - 1));
    } else if (ev.key === "ArrowUp" && i > 0) {
      ev.preventDefault();
      setFocus(i - 1);
    } else if (ev.key === "ArrowDown" && i < lines.length - 1) {
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
          list="jkind-list-edit"
          autoComplete="off"
          className="cell-input"
          value={kind}
          onChange={(ev) => setKind(ev.target.value)}
          onBlur={() => {
            const k = expandKind(kind, ctx.kinds);
            if (k !== kind) setKind(k);
          }}
        />
        <datalist id="jkind-list-edit">
          {ctx.kinds.map((k) => (
            <option key={k.name} value={k.name}>
              {k.key}
            </option>
          ))}
        </datalist>
        {!memo && (
        <span className="jproj-wrap jproj-pillar">
          <button
            type="button"
            className="jproj-badge"
            style={p ? { background: `var(--pj-${projectColor(p)}-bg)`, color: `var(--pj-${projectColor(p)}-fg)`, borderColor: "transparent" } : undefined}
            title="눌러서 프로젝트 바꾸기"
            aria-label={`프로젝트: ${p?.name ?? "없음"}`}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {p?.name ?? "+ 프로젝트"}
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
              <input
                data-eline={i}
                aria-label={`${l.me ? "내" : l.who + "의"} 말`}
                className="cell-input"
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
          <div
            className="ask-band jask"
            role="alertdialog"
            aria-label="기록 지우기 확인"
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                setAsking(false);
              }
            }}
          >
            <span>이 기록을 지울까요?</span>
            <button type="button" className="btn btn-xs" autoFocus onClick={() => setAsking(false)}>
              취소
            </button>
            <button type="button" className="btn btn-xs btn-danger" onClick={onRemove}>
              지우기
            </button>
          </div>
        ) : (
          <div className="jedit-foot">
            {memo ? (
              <span className="hint">Enter 저장 · Shift+Enter 새 줄 · Esc 취소</span>
            ) : (
              <span className="hint" title="Tab 다음 말 · Shift+Tab 같은 사람 · Enter 저장 · Esc 취소">
                Tab 다음 말 · Shift+Tab 같은 사람 · Enter 저장 · Esc 취소
              </span>
            )}
            <button type="button" className="btn btn-xs" onClick={onCancel}>
              취소
            </button>
            <button type="button" className="btn-primary btn-xs" onClick={() => save()}>
              저장
            </button>
            <button type="button" className="tool-box jtrash" aria-label="이 기록 지우기" title="이 기록 지우기" onClick={() => setAsking(true)}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 검색 결과 ----------

function SearchResults({
  entries,
  q,
  raw,
  onlyHits,
  ctx,
  onToggle,
  onClose,
  onGo,
}: {
  entries: Entry[];
  q: string;
  raw: string;
  onlyHits: boolean;
  ctx: Ctx;
  onToggle: () => void;
  onClose: () => void;
  onGo: (date: string) => void;
}) {
  const groups: { date: string; items: { e: Entry; m: boolean[] }[] }[] = [];
  for (const e of entries) {
    const m = matchEntry(e, q);
    if (!m.hit) continue;
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push({ e, m: m.lines });
    else groups.push({ date: e.date, items: [{ e, m: m.lines }] });
  }
  const total = groups.reduce((a, g) => a + g.items.length, 0);

  let body: ReactNode;
  if (!total) body = <p className="muted jsearch-none">일치하는 기록이 없어요.</p>;
  else
    body = groups.map((g) => (
      <section key={g.date} className="jsearch-day" aria-label={dayTitle(g.date)}>
        <div className="jsearch-date">
          <button type="button" className="jsearch-go" title="이 날짜의 일지로 이동" onClick={() => onGo(g.date)}>
            {dayTitle(g.date)}
            <span className="jsearch-arrow">이 날짜로 이동 →</span>
          </button>
          <span className="muted small">{g.items.length}건</span>
        </div>
        <div className="jn-cols">
          {g.items.map(({ e, m }) => {
            const { name, rest } = splitWho(e.who);
            const anyLine = m.some(Boolean);
            const memo = isMemo(e.kind) && (!!e.body || !e.lines.length);
            return (
              <article key={e.id} className={"jcard jcard-static" + (memo ? " jcard-memo" : "")} style={memo ? undefined : stripe(e, ctx)}>
                <div className="jpillar">
                  <span className="jtime">{e.time}</span>
                  <span className="jkind">{e.kind}</span>
                </div>
                {memo ? (
                  <div className="jmain jmemo-main">
                    <MemoView html={e.body} q={q} />
                  </div>
                ) : (
                <div className="jmain">
                  <div className="jhead">
                    <span className="jname">
                      <Hl text={name || "상대 없음"} q={q} />
                    </span>
                    {rest && (
                      <span className="jrest">
                        <Hl text={rest} q={q} />
                      </span>
                    )}
                    {e.contact && (
                      <span className="jhead-tel">
                        <Hl text={e.contact} q={q} />
                      </span>
                    )}
                  </div>
                  <Lines entry={e} q={q} show={onlyHits && anyLine ? m : undefined} dim={!onlyHits && anyLine ? m.map((x) => !x) : undefined} />
                </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    ));

  return (
    <div className="jsearch">
      <div className="jsearch-bar">
        <span className="jsearch-title">"{raw}" 검색 결과</span>
        <span className="muted small">
          {groups.length}일 · 기록 {total}건
        </span>
        <button type="button" className="jonly" aria-pressed={onlyHits} onClick={onToggle}>
          해당하는 말만 보기
        </button>
        <button type="button" className="btn btn-xs" onClick={onClose}>
          검색 닫기
        </button>
      </div>
      {body}
    </div>
  );
}
