// 업무일지 카드·목록 – 왼쪽 월 달력(JournalCalendar)·날짜 머리 줄(DayHead)·기록 카드(ViewCard·Lines·PillarTel·stripe)·검색 결과(SearchResults). 화면 몸통은 Screen.tsx.
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { DayInfo, Entry } from "../../api";
import { copyText, Hl, pjFull, pjLabel, projectColor } from "../../screens/contacts/parts";
import { dayTitle, badgeName, isMemo, matchEntry, normTime, splitWho } from "../../journal";
import { rowKeys } from "../../keys";
import { MemoView } from "../../RichMemo";
import { DayMenu, ProjectMenu } from "./Menu";
import { Ctx, CardCols, badgeStyle } from "./parts";

// ---------- 날짜 달력 (시안 JournalCal1.dc.html 1안) ----------

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * 왼쪽 열 위의 월 달력. 칸을 누르면 그날 일지(기록 없는 날도 열리고 그 날로 등록돼요).
 * 머리 "2026년 10월 ▾"를 누르면 12달 고르기(달마다 기록 수, ‹ ›는 해 이동). 날짜 우클릭 = 이 날 열기·이 날 일지 지우기.
 * 기록이 있는 날은 날짜 아래 작은 점이에요(숫자는 날짜와 헷갈려서 빼요 – 2026-10-17 사용자).
 */
export function JournalCalendar({
  day,
  today,
  counts,
  holidays,
  onPick,
  hasHead,
  onDelete,
}: {
  day: string;
  today: string;
  counts: Map<string, number>;
  holidays: Set<string>;
  onPick: (d: string) => void;
  hasHead: (d: string) => boolean;
  onDelete: (d: string) => void;
}) {
  const [view, setView] = useState(() => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) }));
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState<{ date: string; x: number; y: number; ask: boolean } | null>(null);
  // 다른 날로 가면(오늘 단추, 검색 결과의 "이 날짜로 이동") 그 달을 보여 줘요.
  useEffect(() => setView({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) }), [day]);

  const step = (dir: number) => {
    if (picker) return setView((v) => ({ y: v.y + dir, m: v.m }));
    setView((v) => {
      const d = new Date(v.y, v.m - 1 + dir, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  };

  const off = new Date(view.y, view.m - 1, 1).getDay();
  const dim = new Date(view.y, view.m, 0).getDate();
  const rows = Math.ceil((off + dim) / 7);
  const cells = Array.from({ length: rows * 7 }, (_, i) => {
    const dt = new Date(view.y, view.m - 1, i - off + 1);
    const key = ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const n = counts.get(key) ?? 0;
    const inMonth = dt.getMonth() + 1 === view.m;
    return { key, d: dt.getDate(), w: dt.getDay(), n, inMonth };
  });

  const monthCount = (m: number) => {
    let t = 0;
    const p = ymd(view.y, m, 1).slice(0, 8);
    for (const [k, n] of counts) if (k.startsWith(p)) t += n;
    return t;
  };

  return (
    <section className="jcal" aria-label="날짜 달력">
      <div className="jcal-head">
        <button type="button" className="jcal-title" aria-expanded={picker} title="눌러서 달 고르기" onClick={() => setPicker(!picker)}>
          {picker ? `${view.y}년` : `${view.y}년 ${view.m}월`}
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d={picker ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
          </svg>
        </button>
        <button type="button" className="jcal-nav" aria-label={picker ? "앞 해" : "앞 달"} onClick={() => step(-1)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          className="jcal-today"
          onClick={() => {
            setPicker(false);
            setView({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
            onPick(today);
          }}
        >
          오늘
        </button>
        <button type="button" className="jcal-nav" aria-label={picker ? "다음 해" : "다음 달"} onClick={() => step(1)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {picker ? (
        <div className="jcal-body">
          <div className="jcal-months">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
              const t = monthCount(m);
              const cur = m === view.m;
              return (
                <button
                  key={m}
                  type="button"
                  className={"jcal-mon" + (!t && !cur ? " empty" : "")}
                  aria-pressed={cur}
                  onClick={() => {
                    setView({ y: view.y, m });
                    setPicker(false);
                  }}
                >
                  <span>{m}월</span>
                  <span className="jcal-mon-n">{t ? `${t}건` : "기록 없음"}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="jcal-body">
          <div className="jcal-week" aria-hidden="true">
            {WEEK.map((w, i) => (
              <span key={w} className={i === 0 ? "sun" : i === 6 ? "sat" : ""}>
                {w}
              </span>
            ))}
          </div>
          <div className="jcal-grid" role="grid" aria-label={`${view.y}년 ${view.m}월`}>
            {cells.map((c) => {
              const cls = [
                "jcal-day",
                !c.inMonth && "out",
                c.key === today && "today",
                c.n && "has",
                c.w === 0 || holidays.has(c.key) ? "red" : c.w === 6 ? "sat" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={c.key}
                  type="button"
                  className={cls}
                  aria-pressed={c.key === day}
                  aria-haspopup="menu"
                  aria-label={`${Number(c.key.slice(5, 7))}월 ${c.d}일 ${WEEK[c.w]}요일${c.n ? `, 기록 ${c.n}건` : ""}${c.key === today ? ", 오늘" : ""}`}
                  onClick={() => onPick(c.key)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    // 마우스면 누른 자리, 키보드(메뉴 키)면 날짜 칸 오른쪽에 띄워요.
                    setMenu({ date: c.key, x: e.clientX || r.right, y: e.clientY || r.top, ask: false });
                  }}
                >
                  <span>{c.d}</span>
                  <span className="jcal-dot" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {menu && (
        <DayMenu
          {...menu}
          count={counts.get(menu.date) ?? 0}
          head={hasHead(menu.date)}
          onClose={() => setMenu(null)}
          onOpen={() => {
            setMenu(null);
            onPick(menu.date);
          }}
          onAsk={() => setMenu({ ...menu, ask: true })}
          onDelete={() => {
            setMenu(null);
            onDelete(menu.date);
          }}
        />
      )}
    </section>
  );
}

// ---------- 날짜 머리 줄 (출근 · 교통 · 날씨 · 비고) ----------

export function DayHead({ info, onSave }: { info: DayInfo; onSave: (d: DayInfo) => void }) {
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
        className={"fld jday-in" + (key === "arrive" && bad ? " invalid" : "")}
        aria-invalid={key === "arrive" && bad ? true : undefined}
        placeholder={ph}
        value={v[key]}
        onChange={(e) => {
          if (key === "arrive") setBad(false);
          setV({ ...v, [key]: e.target.value });
        }}
        onBlur={() => commit(v)}
      />
    </label>
  );

  return (
    <div className="jday" role="group" aria-label="이 날의 머리 줄" onKeyDown={(e) => rowKeys(e, e.currentTarget, () => commit(v))}>
      {field("arrive", "출근", "jday-time", "08:40")}
      {field("transport", "교통", "jday-short")}
      {field("weather", "날씨", "jday-mid")}
      {field("note", "비고", "jday-grow", "비고")}
    </div>
  );
}

// ---------- 등록된 기록 (시간 기둥형 카드) ----------

function stripe(e: Entry, ctx: Ctx) {
  const p = e.project !== null ? ctx.byId.get(e.project) : undefined;
  // 띠는 테두리 두께를 바꾸지 않고 카드 안쪽 왼쪽에 겹쳐 그려요(styles/*.css의 .jcard[style*="--stripe"]::before).
  // 테두리를 4px로 두꺼우면 그만큼 시간 기둥이 밀려 띠 없는 카드와 기둥 폭이 달라 보였어요(사용자 신고).
  return p ? ({ "--stripe": `var(--pj-${projectColor(p)}-line)` } as React.CSSProperties) : undefined;
}

/** 대화 줄들. q가 있으면 맞은 글자를 칠하고, dim에 든 줄은 흐리게 보여요. */
function Lines({ entry, q = "", show, dim }: { entry: Entry; q?: string; show?: boolean[]; dim?: boolean[] }) {
  return (
    <div className="jlines">
      {entry.lines.map((l, i) =>
        show && !show[i] ? null : (
          <div key={i} className={"jline" + (dim?.[i] ? " dim" : "")}>
            <span className={"jsp" + (l.me ? " me" : "")} style={badgeStyle(l)} title={l.me ? undefined : l.who}>
              {l.me ? "나" : <Hl text={badgeName(l.who)} q={q} />}
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

export function ViewCard({
  entry: e,
  ctx,
  menuOpen,
  onMenu,
  onProject,
  onOpen,
  selected,
  onSelect,
}: {
  entry: Entry;
  ctx: Ctx;
  menuOpen: boolean;
  onMenu: (on: boolean) => void;
  onProject: (id: number | null) => void;
  onOpen: () => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const { name, rest } = splitWho(e.who);
  const p = e.project !== null ? ctx.byId.get(e.project) : undefined;
  const memo = isMemo(e.kind) && (!!e.body || !e.lines.length);
  return (
    <article
      className={"jcard" + (memo ? " jcard-memo" : "") + (selected ? " sel" : "")}
      style={memo ? undefined : stripe(e, ctx)}
      title="두 번 눌러서 수정"
      tabIndex={0}
      aria-label={`${e.time} ${e.kind} ${e.who}`}
      aria-selected={selected}
      onClick={onSelect}
      onDoubleClick={(ev) => {
        // 카드 안의 단추(연락처 복사, 프로젝트 고르기)를 두 번 누른 것은 수정이 아니에요.
        if ((ev.target as Element).closest("button") ) return;
        window.getSelection()?.removeAllRanges();
        onOpen();
      }}
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
              title={p ? pjFull(p) : "눌러서 사업 바꾸기"}
              aria-label={`사업: ${p ? pjFull(p) : "없음"}`}
              aria-expanded={menuOpen}
              onClick={(ev) => {
                ev.stopPropagation();
                onMenu(!menuOpen);
              }}
            >
              {p ? <span className="pbadge-t">{pjLabel(p)}</span> : "+ 사업"}
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

// ---------- 검색 결과 ----------

/** 검색 결과를 한 번에 그리는 날 수(결과가 있는 날). */
const SEARCH_PAGE = 30;

export function SearchResults({
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
  // 찾기는 찾는 말·기록이 바뀔 때만 해요("해당하는 말만 보기"·더 그리기 때는 그대로).
  const groups = useMemo(() => {
    const out: { date: string; items: { e: Entry; m: boolean[] }[] }[] = [];
    for (const e of entries) {
      const m = matchEntry(e, q);
      if (!m.hit) continue;
      const last = out[out.length - 1];
      if (last && last.date === e.date) last.items.push({ e, m: m.lines });
      else out.push({ date: e.date, items: [{ e, m: m.lines }] });
    }
    return out;
  }, [entries, q]);
  const total = useMemo(() => groups.reduce((a, g) => a + g.items.length, 0), [groups]);

  // 최근 날짜부터 30일(결과가 있는 날 30개)씩 그리고, 아래 끝에 닿으면 다음 30일을 이어 그려요(2026-10-30 속도 ② 1안).
  // 찾는 말이 바뀌면 처음 30일부터. 결과 수("N일 · 기록 N건")는 전체 기준이에요.
  const [page, setPage] = useState({ q, n: SEARCH_PAGE });
  const limit = page.q === q ? page.n : SEARCH_PAGE;
  const more = groups.length > limit;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = endRef.current;
    if (!el || !more) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((x) => x.isIntersecting)) setPage((p) => ({ q, n: (p.q === q ? p.n : SEARCH_PAGE) + SEARCH_PAGE }));
      },
      { root: el.closest(".jn-scroll"), rootMargin: "0px 0px 600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [q, more, limit]);

  let body: ReactNode;
  if (!total) body = <p className="muted jsearch-none">일치하는 기록이 없어요.</p>;
  else
    body = groups.slice(0, limit).map((g) => (
      <section key={g.date} className="jsearch-day" aria-label={dayTitle(g.date)}>
        <div className="jsearch-date">
          <button type="button" className="jsearch-go" title="이 날짜의 일지로 이동" onClick={() => onGo(g.date)}>
            {dayTitle(g.date)}
            <span className="jsearch-arrow">이 날짜로 이동 →</span>
          </button>
          <span className="muted small">{g.items.length}건</span>
        </div>
        <CardCols mode="balance" relayout={`${q}|${onlyHits}`}>
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
        </CardCols>
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
      {more && <div ref={endRef} className="jsearch-more" aria-hidden="true" />}
    </div>
  );
}
