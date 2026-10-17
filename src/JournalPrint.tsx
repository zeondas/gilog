// 업무일지 인쇄 (2026-10-17 사용자 — 시안 JournalPrint.dc.html 기간 창, JournalPdf.dc.html 종이 모양)
// - 검색창 옆 "인쇄" → 기간 창(빠른 선택 · 시작일~끝일 칸 · 두 달 달력, 늘 6주) → 엣지 인쇄 창(window.print).
//   엣지 인쇄 창에서 프린터를 고르거나 목록의 "PDF로 저장"으로 PDF를 만들어요.
// - 종이: A4 가로, 여백은 종이 안쪽(위 5 · 아래 15 · 왼쪽 25 · 오른쪽 5mm). @page 여백이 0이라 엣지가 머리·바닥에 날짜·주소를 찍지 않아요.
// - 날마다 새 쪽, 기록 없는 날은 빼요. 카드는 쪼개지 않고 왼쪽 열을 쪽 높이까지 채운 뒤 오른쪽 열, 그다음 쪽.
//   (한 장이 열 높이보다 크면 그 카드만 줄여 한 열에 맞춰요.)
// - 머리 줄은 출근·교통·날씨·메모만. 메모 카드도 시각·"메모"와 본문을 찍어요. 머릿기호는 화면과 같은 그린 모양(.rte-view 규칙).
// - 아래 여백에 "기Log 업무일지"와 쪽 번호 "1 / 2".
import { KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DayInfo, Entry, Project } from "./api";
import { projectColor } from "./ContactsScreen";
import { isMemo, parseDate, speakerColor, splitWho } from "./journal";
import { sanitize } from "./RichMemo";

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
    // 달력은 늘 6주(42칸) — 달을 넘겨도 창 크기가 바뀌지 않아요.
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
          <input
            aria-label={which === "from" ? "시작일" : "끝일"}
            aria-invalid={bad || undefined}
            value={text}
            onFocus={() => {
              setAct(which);
              setHov(null);
            }}
            onChange={(e) => {
              const v = e.target.value;
              set(v);
              setChip("");
              const p = parseDate(v);
              if (p) setBase(monthIndex(p) - (which === "to" ? 1 : 0));
            }}
            // 칸을 떠날 때(다른 곳 누르기·Tab·Enter) 읽은 날짜를 2026-10-12 모양으로 바꿔 써요. 치는 도중에는 그대로예요.
            onBlur={(e) => {
              const p = parseDate(e.target.value);
              if (p && p !== e.target.value) set(p);
            }}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                const p = parseDate(e.currentTarget.value);
                if (p) set(p);
              }
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
      <div className="overlay jp-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="dialog jp-dlg" role="dialog" aria-modal="true" aria-label="업무일지 인쇄">
          <div className="jp-head">
            <h2 className="jp-title">업무일지 인쇄</h2>
            <button type="button" className="jp-x" aria-label="닫기" onClick={onClose}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

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
              <span>기Log 업무일지</span>
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
