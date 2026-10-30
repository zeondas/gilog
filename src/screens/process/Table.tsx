// 민원처리 – 표: 열 제목 줄(HeadRow)·위치 칸(PlaceCell)·고려사항 칸(NoteCell)·사진 줄(PhotoStrip)·공사 칩(WorkTag)·진행 게이지(Gauge)·증거 카드 줄(ProofRow). 화면 몸통은 Screen.tsx.
import { createPortal } from "react-dom";
import { CSSProperties, MouseEvent as ReactMouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Case, ContactsData, Work } from "../../api";
import type { ColHead } from "../../ColHead";
import { BLine, linesToText, parseLines, stringifyLines } from "../../bullets";
import { BulletEditor, Mark } from "../../BulletParts";
import { useOutsideClose } from "../../useOutsideClose";
import { PlaceInput } from "../../PlaceInputs";
import { workColor, COLUMNS, COL_GAP, textWidth, DocPlusIcon, MailIcon, PhoneIcon, CheckIcon, Prog, isPath, WarnIcon } from "./parts";
import { api, WorkInput } from "../../api";
import { workDaysBetween } from "../../workdays";
import { padX, useColHead, widestOf } from "../../ColHead";
import type { ColDef } from "../../cols";
import { todayStr } from "../../journal";
import { md, orderLabel } from "../../process";
import { isAnswered, isClosed } from "../../settingsStore";
import { COLS_KEY, NA_WORK, stamp, shortNo, MoreIcon } from "./parts";
import { AUTO_COLS, PLACE_MAX, SUM_MIN } from "./parts";
import type { useProcessCases } from "./cases";

const UNKNOWN = "주소불명";

// ---------- 열 제목 줄 (끌어서 열 너비, 우클릭 열 너비 초기화 – 민원대장과 같아요) ----------

export function HeadRow({ all, onAll, cols }: { all: "none" | "some" | "all"; onAll: () => void; cols: ColHead }) {
  return (
    <div className="pr-row pr-headrow colh-row" role="row" onContextMenu={cols.onContextMenu}>
      {COLUMNS.map((col, i) => (
        <div role="columnheader" key={col.id} className={i === 0 ? "pr-check" : col.center ? "pr-c" : undefined}>
          {i === 0 ? (
            <input
              type="checkbox"
              aria-label="같은 공사 민원 모두 고르기"
              checked={all === "all"}
              ref={(el) => {
                if (el) el.indeterminate = all === "some";
              }}
              disabled={all === "none"}
              title={all === "none" ? "먼저 한 줄을 고르면 같은 공사 민원을 모두 골라요" : all === "all" ? "모두 풀기" : "같은 공사 민원 모두 고르기"}
              onChange={onAll}
            />
          ) : (
            col.label
          )}
          {/* 고정 열(체크·판단 공사·진행)은 손잡이 없음 – 공통 부품이 걸러요 */}
          {cols.grip(col.id, { last: i === COLUMNS.length - 1 })}
        </div>
      ))}
      {cols.menu()}
    </div>
  );
}

// ---------- 위치 칸: 그 자리에서 고쳐요(법정리·동 + 지번, 리·동을 고르면 지역이 채워져요 – 민원대장 위치 칸과 같은 부품) ----------

export function PlaceCell({ c, colW, disabled, onSave }: { c: Case; colW: number; disabled: boolean; onSave: (area: string, place: string, road: string) => void }) {
  const start = c.place === UNKNOWN ? "" : c.place;
  const [place, setPlace] = useState(start);
  const [area, setArea] = useState(c.area);
  const [road, setRoad] = useState(c.road);
  const now = useRef({ place, area, road });
  now.current = { place, area, road };
  useEffect(() => {
    setPlace(c.place === UNKNOWN ? "" : c.place);
    setArea(c.area);
    setRoad(c.road);
  }, [c.place, c.area, c.road]);

  const [editing, setEditing] = useState(false);
  // 한 줄(지역 위치)이 위치 열 끝(PLACE_MAX)을 넘으면 이 줄만 두 줄로 – "…"로 줄이지 않아요(2026-10-21 사용자).
  const viewRef = useRef<HTMLDivElement>(null);
  const [two, setTwo] = useState(false);
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    // 열 폭(처음엔 260까지 글자에 맞춘 폭, 끌어서 넓히면 그 폭)보다 길면 그 줄만 두 줄
    const fit = () => setTwo(textWidth(el) + COL_GAP > colW);
    fit();
    let alive = true;
    document.fonts?.ready.then(() => alive && fit());
    return () => {
      alive = false;
    };
  }, [c.area, c.place, editing, colW]);
  if (disabled || !editing) {
    return (
      <div
        ref={viewRef}
        className={"pr-place" + (two ? " two" : " one")}
        title={[`${c.area} ${c.place}`.trim(), c.road ? `원래 주소 ${c.road}` : "", disabled ? "" : "두 번 누르면 주소를 고쳐요"].filter(Boolean).join("\n")}
        onDoubleClick={(e) => {
          if (disabled) return;
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {c.area && <span className="pr-sub">{c.area}</span>}
        <span className={c.place === UNKNOWN ? "pr-unknown" : undefined}>{c.place}</span>
      </div>
    );
  }

  const revert = () => {
    setPlace(start);
    setArea(c.area);
    setRoad(c.road);
  };

  return (
    <div
      className="pr-place pr-place-edit"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.nativeEvent.isComposing) return;
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "Escape") {
          revert();
          now.current = { place: start, area: c.area, road: c.road };
          setEditing(false);
          (e.target as HTMLElement).blur();
        }
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setEditing(false);
        // 위치 칸이 떠날 때 지역을 맞춘 뒤(같은 순간) 저장해요.
        window.setTimeout(() => {
          const { place: p, area: a, road: r } = now.current;
          const np = p.trim();
          // 지역은 위치를 따라 바뀌어요. 위치를 그대로 두고 떠나면 저장하지 않아요.
          if (np !== start) onSave(a, np, r);
        }, 0);
      }}
    >
      <span className="pr-sub">{area || "\u00a0"}</span>
      <PlaceInput value={place} area={area} road={road} onChange={setPlace} onArea={setArea} onRoad={setRoad} placeholder={UNKNOWN} className={place.trim() ? undefined : "pr-unknown-in"} autoFocus />
    </div>
  );
}

// ---------- 고려사항 칸 (2026-10-21 사용자 – 머릿기호 여러 줄) ----------

const NOTE_HINT = "예: 야간 작업, 교통 통제 협의";

/**
 * 줄에는 첫 줄(기호 + 글)만 보여요. 긴 글은 칸 끝에서 "…", 다음 줄이 있으면 첫 줄 뒤에 "…".
 * 마우스를 올리면 전체 글. 두 번 누르면 칸 아래로 펼쳐 여러 줄로 고쳐요(줄 높이 44는 그대로) –
 * 바깥 누르기·Tab은 저장하고 접기, Esc는 버리고 접기. 키는 민원대장 내용 칸과 같아요.
 */
export function NoteCell({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const cellRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState<{ lines: BLine[]; rect: DOMRect } | null>(null);
  const now = useRef<BLine[]>([]);
  if (edit) now.current = edit.lines;

  const ls = parseLines(value);
  const at = ls.findIndex((l) => l.t.trim());
  const first = at >= 0 ? ls[at] : null;
  const more = at >= 0 && ls.slice(at + 1).some((l) => l.t.trim());

  const close = useCallback(
    (save: boolean) => {
      setEdit(null);
      if (!save) return;
      const v = stringifyLines(now.current);
      if (v !== stringifyLines(parseLines(value))) onSave(v);
    },
    [value, onSave],
  );

  // 바깥을 누르거나 표를 굴리면 저장하고 접어요.
  useOutsideClose(edit !== null, [popRef], () => close(true), { on: "window", capture: true });
  useEffect(() => {
    if (!edit) return;
    const scroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) close(true);
    };
    const resize = () => close(true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [edit !== null, close]);

  return (
    <div
      ref={cellRef}
      className={"pr-nc" + (edit ? " editing" : "")}
      title={first ? linesToText(ls.slice(at)) : disabled ? undefined : "두 번 누르면 고려사항을 적어요"}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (disabled || !cellRef.current) return;
        const l = ls.length ? ls : [{ t: "" }];
        // 줄 높이 가운데에 입력 칸(28)을 두고 글 시작을 보기 글자와 맞춰요(칸 안쪽 여백 10 − 입력 칸 여백 6 − 테두리 1).
        const cell = cellRef.current.getBoundingClientRect();
        const row = cellRef.current.closest(".pr-row")?.getBoundingClientRect() ?? cell;
        setEdit({ lines: l, rect: new DOMRect(cell.left + 3, row.top + (row.height - 28) / 2, cell.width - 6, 28) });
      }}
    >
      {first ? (
        <>
          <Mark line={first} lv={0} />
          <span className="pr-nc-t">{first.t + (more ? " …" : "")}</span>
        </>
      ) : (
        !disabled && <span className="pr-nc-ph">{NOTE_HINT}</span>
      )}
      {edit &&
        createPortal(
          <div
            ref={popRef}
            className="pr-nc-pop"
            style={{ top: Math.round(edit.rect.top), left: Math.round(edit.rect.left), width: Math.round(edit.rect.width) }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Tab") {
                e.preventDefault();
                close(true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close(false);
              }
            }}
          >
            <BulletEditor name="note" label="고려사항" placeholder={NOTE_HINT} lines={edit.lines} onChange={(lines) => setEdit((x) => (x ? { ...x, lines } : x))} autoFocusEnd />
          </div>,
          document.body,
        )}
    </div>
  );
}

/** 줄 ⋯ 메뉴의 현장사진 고르기: 맨 앞 사진이 지시부에 들어가요(2026-10-21 22:59 사용자 – 지시부엔 1장만, AI가 고르고 여기서 바꿈). */
export function PhotoStrip({ c, reason, onPick }: { c: Case; reason: string; onPick: (path: string) => void }) {
  const photos = c.photos.filter(isPath);
  return (
    <div className="pr-photos" role="group" aria-label="지시부에 넣을 현장사진">
      <div className="pr-photos-row">
        {photos.map((p, i) => (
          <button
            key={p}
            type="button"
            className="pr-thumb"
            data-on={i === 0 ? "1" : undefined}
            aria-pressed={i === 0}
            title={i === 0 ? "지시부에 들어가는 사진" : "이 사진을 지시부에 넣어요"}
            onClick={() => i !== 0 && onPick(p)}
          >
            <Thumb path={p} n={i + 1} />
            {i === 0 && <span className="pr-thumb-tag">지시부</span>}
          </button>
        ))}
      </div>
      <p className="pr-photos-why">{reason ? `고른 이유: ${reason}` : "사진을 누르면 지시부에 넣을 사진이 바뀌어요"}</p>
    </div>
  );
}

function Thumb({ path, n }: { path: string; n: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import("@tauri-apps/api/core")
      .then(({ convertFileSrc }) => alive && setSrc("__TAURI_INTERNALS__" in window ? convertFileSrc(path) : null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [path]);
  return src ? <img src={src} alt={`현장사진 ${n}`} loading="lazy" /> : <span className="pr-thumb-ph">{n}</span>;
}

/** 위 띠의 공사 이름표 */
export function WorkTag({ w, cd }: { w: Work; cd: ContactsData | null }) {
  const k = workColor(w, cd);
  return (
    <span className="pr-work" style={{ "--wc": `var(--pj-${k}-line)`, "--wf": `var(--pj-${k}-fg)` } as CSSProperties}>
      {w.name}
    </span>
  );
}

export function Gauge({ p, title, onClick }: { p: Prog; title: string; onClick?: (e: ReactMouseEvent<HTMLElement>) => void }) {
  const cls = "pr-gauge" + (p.step >= 4 ? " strong" : "") + (p.warn ? " warn" : "") + (p.hatch ? " hatch" : "") + (onClick ? " go" : "");
  const inner = (
    <>
      <span className="pr-gauge-fill" style={{ width: `${p.pct}%`, background: p.warn ? undefined : `var(--pg-${p.step})` }} />
      <span className="pr-gauge-t">
        {p.icon === "doc" ? <DocPlusIcon size={12} /> : p.icon === "mail" ? <MailIcon size={12} /> : p.icon === "phone" ? <PhoneIcon size={12} /> : p.icon === "warn" ? <WarnIcon size={12} /> : null}
        {p.label}
        {p.check && <CheckIcon size={12} />}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={cls} title={title} aria-label={`진행 ${p.pct}% · ${p.label}`} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <span className={cls} title={title} role="img" aria-label={`진행 ${p.pct}% · ${p.label}`}>
      {inner}
    </span>
  );
}

export function ProofRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="pr-proof-r">
      <span className="pr-proof-k">{k}</span>
      <span className="pr-proof-v" title={v}>
        {v}
      </span>
    </div>
  );
}

export function useProcessCols(c: ReturnType<typeof useProcessCases>) {
  const { setWorks, setCases, setOrders, orders, putOrder, pick, ask, menu, proof, naAsk, doneAsk, sendMenu, setPick, setAsk, setMenu, setProof, setNaAsk, setDoneAsk, setSendMenu, bodyRef, setGutter, setAvail, works, rows, setAuto, complaints, auto, avail } = c;

  // 공사 관리 창이 쓰는 저장
  const saveWork = useCallback(async (id: number | null, input: WorkInput) => setWorks(await api.saveWork(id, input)), []);
  const deleteWork = useCallback(async (id: number) => {
    setWorks(await api.deleteWork(id));
    const pd = await api.processData();
    setCases(pd.cases);
    setOrders(pd.orders);
  }, []);

  // 보내는 중인 지시부: Claude가 올렸는지 화면을 연 동안 15초마다 봐요.
  const queued = orders.some((o) => o.stage === "queued");
  useEffect(() => {
    if (!queued) return;
    const look = () =>
      api.checkSent(`${todayStr()} ${stamp().slice(6)}`).then(
        (l) => l.forEach(putOrder),
        () => {},
      );
    look();
    const t = window.setInterval(look, 15000);
    return () => window.clearInterval(t);
  }, [queued]);

  // 바깥 누르기·Esc로 뜨는 것 닫기
  useEffect(() => {
    if (!pick && !ask && !menu && !proof && !naAsk && !doneAsk && !sendMenu) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && (setPick(null), setAsk(null), setMenu(null), setProof(null), setNaAsk(null), setDoneAsk(null), setSendMenu(null));
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [pick, ask, menu, proof, naAsk, doneAsk, sendMenu]);

  // 목록 안쪽 폭과 스크롤 막대 폭을 재요(창 크기·줄 수가 바뀌면 다시).
  useEffect(() => {
    const el = bodyRef.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    // 표가 쓸 수 있는 폭 = 가로 스크롤 상자 폭 − 세로 스크롤 막대(목록은 넓힌 열만큼 커지니 상자에서 재요)
    const measure = () => {
      const g = el.offsetWidth - el.clientWidth;
      setGutter(g);
      setAvail(Math.max(0, box.clientWidth - g));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [works === null, rows.length]);

  // 열 폭 자동 맞춤: 그려진 줄의 글자 폭을 재요(줄·민원대장·공사가 바뀌거나 글꼴을 다 받은 뒤 다시).
  useLayoutEffect(() => {
    const measure = () => {
      const body = bodyRef.current;
      const head = body?.parentElement?.querySelector(".pr-headrow");
      if (!body || !head) return;
      const lines = [...body.querySelectorAll(":scope > .pr-row")];
      const next: Record<number, number> = {};
      for (const i of AUTO_COLS) {
        let m = 0;
        const h = head.children[i];
        const t = h && [...h.childNodes].find((n) => n.nodeType === 3);
        if (t) {
          const r = document.createRange();
          r.selectNodeContents(t);
          m = r.getBoundingClientRect().width;
        }
        for (const row of lines) {
          const c = row.children[i];
          if (c && !c.classList.contains("pr-place-edit")) m = Math.max(m, textWidth(c));
        }
        if (m > 0) next[i] = Math.min(i === 4 ? PLACE_MAX : Infinity, Math.ceil(m) + COL_GAP);
      }
      setAuto((old) => (AUTO_COLS.every((i) => old[i] === next[i]) ? old : next));
    };
    measure();
    let alive = true;
    document.fonts?.ready.then(() => alive && measure());
    return () => {
      alive = false;
    };
  }, [rows, complaints, works]);

  // 열 폭(헤더 열 조정 통일 ✔1~3): 처음 값 = 글자에 맞춘 폭(AUTO_COLS)·정해진 폭, 민원 요약은 남는 폭(창에 맞춘 처음 값 – 다른 열을 끌어도 그대로).
  const inits = COLUMNS.map((c, i) => auto[i] ?? c.w);
  const sumInit = Math.max(SUM_MIN, Math.floor(avail - inits.reduce<number>((a, w) => a + (w ?? 0), 0)));
  const colDefs: ColDef[] = COLUMNS.map((c, i) => ({ id: c.id, label: c.label, init: inits[i] ?? sumInit, fixed: c.fixed, text: c.text }));
  /** 내용에 맞춤: 번호·접수·기한·위치는 글자 폭 + 칸 여백(위치도 260 제한 없이), 나머지는 칸을 복사해 잰 폭 – 여유는 cols.ts가 더해요 */
  const measureCol = (id: string): number | null => {
    const i = COLUMNS.findIndex((c) => c.id === id);
    const body = bodyRef.current;
    const head = body?.parentElement?.querySelector(".pr-headrow");
    if (i < 0 || !body || !head) return null;
    const lines = [...body.querySelectorAll<HTMLElement>(":scope > .pr-row")].map((r) => r.children[i] as HTMLElement | undefined).filter((c): c is HTMLElement => !!c && !c.classList.contains("pr-place-edit"));
    if (AUTO_COLS.includes(i)) {
      let m = 0;
      const t = [...(head.children[i]?.childNodes ?? [])].find((n) => n.nodeType === 3);
      if (t) {
        const r = document.createRange();
        r.selectNodeContents(t);
        m = r.getBoundingClientRect().width;
      }
      for (const c of lines) m = Math.max(m, textWidth(c));
      return m > 0 ? Math.ceil(m) + padX(lines[0] ?? (head.children[i] as HTMLElement)) : null;
    }
    return widestOf([head.children[i] as HTMLElement, ...lines]);
  };
  const cols = useColHead({ store: COLS_KEY, cols: colDefs, measure: measureCol });
  const shownWidths = COLUMNS.map((c) => cols.width(c.id));
  const colSum = shownWidths.reduce((a, w) => a + w, 0);
  return { ...c, saveWork, deleteWork, queued, inits, sumInit, colDefs, measureCol, cols, shownWidths, colSum };
}

export function useProcessRows(c: ReturnType<typeof useProcessCols> & { works: Work[] }) {
  const { pick, cases, chosen, works, isDone, setChosen, found, shownWidths, gutter, colSum, linked, orderOf, busy, mailRun, setPick, setAsk, setProof, setMenu, menu, today, cd, sel, ask, setSel, onOpenComplaint, copyNo, urgentDays, cols, saveAddress, tipTimer, setTip, patch, proof, openFile } = c;

  const pickCase = pick && cases.find((c) => c.no === pick.no);
  // 고르기 칸은 "새 지시부로 묶을 민원 고르기" 하나만(2026-10-21 사용자 1안): 지시부에 든 줄·끝난 줄은 고르지 않고
  // 진행 막대나 ⋯ 메뉴로 다뤄요. 같은 공사만 함께 골라요.
  const first = chosen.length ? cases.find((c) => c.no === chosen[0]) : undefined;
  const chosenWork = first ? works.find((w) => w.id === first.work) : undefined;
  const pickable = (c: Case) => c.order == null && c.work != null && c.work !== NA_WORK && !isDone(c);
  const canChoose = (c: Case) => pickable(c) && (!chosenWork || c.work === chosenWork.id);
  const toggle = (c: Case) => setChosen((l) => (l.includes(c.no) ? l.filter((n) => n !== c.no) : canChoose(c) ? [...l, c.no] : l));
  // 머리 줄 전체 고르기(2안): 한 줄을 고른 뒤 누르면 보이는 줄 중 같은 공사의 고를 수 있는 민원을 모두, 다 골랐으면 모두 풀어요.
  const sameWork = chosenWork ? found.filter((c) => pickable(c) && c.work === chosenWork.id) : [];
  const allState: "none" | "some" | "all" = !chosen.length ? "none" : sameWork.every((c) => chosen.includes(c.no)) ? "all" : "some";
  const toggleAll = () => setChosen(allState === "all" ? [] : [...new Set([...chosen, ...sameWork.map((c) => c.no)])]);
  const total = cases.filter((c) => !isDone(c)).length;
  const tableStyle = { "--pr-cols": shownWidths.map((w) => w + "px").join(" "), "--pr-gutter": `${gutter}px`, "--pr-w": `${colSum + gutter}px` } as CSSProperties;

  /** 진행 막대 한 칸(2026-10-20 1안): 채움·단계(색 진하기)·글자·아이콘 – 민원대장 답변·완료가 지시부보다 앞서요. */
  const progOf = (c: Case): Prog => {
    const m = linked(c);
    if (m && isClosed(m.status)) return { pct: 100, step: 5, label: m.status, kind: "done" };
    if (m && isAnswered(m.status)) return { pct: 80, step: 4, label: m.status, kind: "answer" };
    const o = orderOf(c);
    if (o ? busy[o.id] : busy[`c${c.no}`]) return { pct: 40, step: 2, label: "만드는 중", icon: "doc", hatch: true, kind: "busy" };
    if (!o) return { pct: 20, step: 1, label: "접수", kind: "new" };
    if (mailRun?.id === o.id) return { pct: 40, step: 2, label: "보내는 중", icon: "mail", hatch: true, kind: "sending" };
    if (o.stage === "queued") return { pct: 40, step: 2, label: "보내는 중", icon: "phone", hatch: true, kind: "sending" };
    if (o.mailedAt)
      return o.mailOk === false
        ? { pct: 60, step: 3, label: "확인 필요", icon: "warn", warn: true, kind: "proof" }
        : { pct: 60, step: 3, label: `메일 보냄 ${o.mailedAt.slice(5, 10)}`, icon: "mail", check: true, kind: "proof" };
    if (o.stage === "sent") return { pct: 60, step: 3, label: `폰 보냄 ${(o.sentAt || "").slice(5, 10)}`.trim(), icon: "phone", check: true, kind: "proof" };
    return { pct: 40, step: 2, label: "지시부", icon: "doc", kind: "order" };
  };

  const openMenu = (c: Case, rect: DOMRect) => {
    setPick(null);
    setAsk(null);
    setProof(null);
    setMenu(menu?.no === c.no ? null : { no: c.no, rect });
  };

  const renderRow = (c: Case) => {
    const w = works.find((x) => x.id === c.work);
    const na = c.work === NA_WORK;
    const isD = isDone(c);
    const left = c.due ? workDaysBetween(today, c.due) : null;
    const k = workColor(w, cd);
    const o = orderOf(c);
    const b = o ? busy[o.id] : undefined;
    const picked = chosen.includes(c.no);
    const p = progOf(c);
    const m = linked(c);
    const why = [c.reason, c.road ? `원래 주소 ${c.road}` : ""].filter(Boolean).join(" · ");
    const barTitle =
      p.kind === "proof"
        ? "눌러서 보낸 증거 보기"
        : p.kind === "order"
          ? `지시부 열기 · ${orderLabel(works.find((x) => x.id === o?.work)?.name ?? "", o?.seq ?? 0, c.item)}번째 항목${o?.dirty ? " · 다시 만들어야 해요" : " · 보내기 전"}`
          : p.kind === "answer" || p.kind === "done"
            ? `민원대장 ${m?.no ?? ""}번 · 눌러서 그 줄로 가요`
            : p.kind === "sending"
              ? "보내는 중이에요"
              : p.kind === "busy"
                ? "지시부를 만들고 있어요"
                : "가져왔고 아직 지시부 전이에요";
    return (
      <div
        key={c.no}
        className="pr-row"
        role="row"
        data-sel={sel === c.no || ask?.no === c.no || menu?.no === c.no || picked ? "1" : undefined}
        data-done={isD ? "1" : undefined}
        onClick={() => setSel(sel === c.no ? null : c.no)}
        onDoubleClick={() => c.complaint != null && onOpenComplaint(c.complaint)}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest("input, textarea")) return;
          e.preventDefault();
          openMenu(c, new DOMRect(e.clientX, e.clientY, 0, 0));
        }}
      >
        <div className="pr-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`${c.no} 고르기`}
            checked={picked}
            disabled={!picked && !canChoose(c)}
            title={
              c.order != null || isD
                ? "지시부에 든 민원이에요 – 진행 막대나 ⋯ 메뉴로 다뤄요"
                : c.work === NA_WORK
                  ? "해당 없음 민원은 지시부로 묶지 않아요"
                  : c.work == null
                  ? "먼저 공사를 골라요"
                  : !picked && !canChoose(c)
                    ? "같은 공사만 함께 고를 수 있어요"
                    : "지시부로 묶을 민원 고르기"
            }
            onChange={() => toggle(c)}
          />
        </div>
        <div className="pr-no">
          <button
            type="button"
            className="pr-no-link"
            title={`${c.no} · 누르면 전체 번호 복사`}
            onClick={(e) => {
              e.stopPropagation();
              copyNo(c.no);
            }}
          >
            {shortNo(c.no)}
          </button>
        </div>
        <div className="pr-date">{md(c.received)}</div>
        <div className="pr-date pr-due">
          <span className={isD ? "pr-strike" : undefined}>{md(c.due)}</span>
          {!isD && left !== null && (
            <span className={"pr-d" + (left <= urgentDays ? " urgent" : left <= urgentDays + 1 ? " soon" : "")}>
              {left > 0 ? `D-${left}` : left === 0 ? "D-day" : `D+${-left}`}
            </span>
          )}
        </div>
        <PlaceCell c={c} colW={cols.width("place")} disabled={isD || !!b} onSave={(a, pl, r) => saveAddress(c, a, pl, r)} />
        <div
          className="pr-sum"
          onMouseEnter={(e) => {
            if (!why) return;
            const rect = (e.currentTarget.firstElementChild as HTMLElement).getBoundingClientRect();
            window.clearTimeout(tipTimer.current);
            tipTimer.current = window.setTimeout(() => setTip({ text: why, rect }), 250);
          }}
          onMouseLeave={() => {
            window.clearTimeout(tipTimer.current);
            setTip(null);
          }}
        >
          <span className={"pr-sum-t" + (why ? " has-tip" : "")}>{c.summary}</span>
        </div>
        <div>
          <button
            type="button"
            className={"pr-work" + (w ? "" : na ? " na" : " none")}
            style={w ? ({ "--wc": `var(--pj-${k}-line)`, "--wf": `var(--pj-${k}-fg)` } as CSSProperties) : undefined}
            disabled={isD || !!b}
            title={isD ? w?.name : na ? "공사 대상이 아니에요\n눌러서 공사 바꾸기" : c.order == null ? (w ? `${w.name}\n눌러서 공사 바꾸기` : "눌러서 공사 고르기") : `${w?.name ?? ""}\n공사를 바꾸면 이 지시부에서 빠져요(남은 건으로 다시 만들어요)`}
            onClick={(e) => {
              e.stopPropagation();
              setAsk(null);
              setMenu(null);
              setPick(pick?.no === c.no ? null : { no: c.no, rect: e.currentTarget.getBoundingClientRect() });
            }}
          >
            {w ? w.name : na ? "해당 없음" : "– 공사 고르기"}
          </button>
        </div>
        <NoteCell value={c.note} disabled={isD} onSave={(v) => patch(c.no, { note: v })} />
        <div className="pr-prog" onClick={(e) => e.stopPropagation()}>
          <Gauge
            p={p}
            title={barTitle}
            onClick={
              p.kind === "proof" && o
                ? (e) => {
                    setMenu(null);
                    setProof(proof?.id === o.id ? null : { id: o.id, rect: e.currentTarget.getBoundingClientRect() });
                  }
                : p.kind === "order" && o?.file
                  ? () => openFile(o.file)
                  : (p.kind === "answer" || p.kind === "done") && m
                    ? () => onOpenComplaint(m.id)
                    : undefined
            }
          />
          <button type="button" className={"pr-more" + (menu?.no === c.no ? " on" : "")} aria-label="이 민원 메뉴" aria-haspopup="menu" aria-expanded={menu?.no === c.no} title="지시부 · 보내기 · 저장 폴더 · 민원대장 · 완료 · 지우기" onClick={(e) => openMenu(c, e.currentTarget.getBoundingClientRect())}>
            <MoreIcon />
          </button>
        </div>
      </div>
    );
  };
  return { ...c, pickCase, first, chosenWork, pickable, canChoose, toggle, sameWork, allState, toggleAll, total, tableStyle, progOf, openMenu, renderRow };
}
