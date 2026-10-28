// 민원대장 – 표: 열 제목 줄(HeadRow)·상태 칩 줄(FilterChips)·칸 묶음(Cells)·신규 줄·고치는 줄·보기 줄과 줄 안 고르기 상자. 화면 몸통은 Screen.tsx.
import {
  Fragment,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { DelMark } from "../../Icons";
import { startColDrag } from "../../ColGrip";
import { isInside, useOutsideClose } from "../../useOutsideClose";
import { onSelection } from "../../noContextMenu";
import { isKey, rowKeys } from "../../keys";
import { Complaint, ComplaintInput } from "../../api";
import {
  COL_MIN,
  COLUMNS,
  ColKey,
  ColFilters,
  daysLeft,
  daysTaken,
  takenText,
  ddayText,
  FILTER_KEYS,
  FilterKey,
  isUrgent,
  maxDragWidth,
  shortDate,
  shortIntake,
} from "../../complaints";
import { parseLines } from "../../bullets";
import { BulletEditor, BulletView } from "../../BulletParts";
import { copyText, Hl, parseMemo } from "../../screens/contacts/parts";
import { parseDate, todayStr } from "../../journal";
import { ChoiceInput, PlaceInput } from "../../PlaceInputs";
import { isAnswered, isClosed, statusColor } from "../../settingsStore";
import { AskBand } from "../../AskBand";
import { DateInput } from "../../DateInput";
import { DateField, focusField, useDraft } from "./Dialogs";
import { HeadMenu } from "./Menu";
import { FILTER_LABEL, Lists, Draft, DateKey, PlaceStyle, placeText, Bad } from "./parts";

/** 열 제목의 거르기 – 지역 거르기는 위치 열 제목에서(지역 열이 위치 칸에 합쳐졌어요) */
const headFilter = (k: ColKey): FilterKey | null => (k === "place" ? "area" : (FILTER_KEYS as string[]).includes(k) ? (k as FilterKey) : null);

// ---------- 열 제목과 너비 끌기 ----------

export function HeadRow({
  widths,
  avail,
  onResize,
  onResized,
  onResetWidths,
  filters,
  open,
  onToggle,
  dropdown,
  doneFolded,
  onFoldDone,
}: {
  widths: (number | null)[];
  avail: number;
  onResize: (k: ColKey, px: number) => void;
  onResized: (k: ColKey, px: number) => void;
  onResetWidths: () => void;
  filters: ColFilters;
  open: FilterKey | null;
  onToggle: (k: FilterKey) => void;
  dropdown: ReactNode;
  doneFolded: boolean;
  onFoldDone: (v: boolean) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // 열 제목 줄 우클릭 메뉴: 열 너비 초기화 (2026-10-17 사용자 2안)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  function start(e: ReactMouseEvent, i: number) {
    e.preventDefault();
    const row = rowRef.current;
    if (!row) return;
    const k = COLUMNS[i].key;
    const base = widths[i] ?? (row.children[i] as HTMLElement).getBoundingClientRect().width;
    // 표 폭을 넘게 넓히지 않아요(내용·조치내용이 80씩은 남게, 가로 스크롤이 생기지 않게).
    const max = avail > 0 ? maxDragWidth(widths, i, avail) : Infinity;
    startColDrag(e, {
      base,
      min: COL_MIN,
      max,
      bodyClass: "col-dragging",
      on: "document",
      onMove: (px) => onResize(k, px),
      onEnd: (px) => px !== null && onResized(k, px),
    });
  }

  return (
    <div
      role="row"
      className="cm-row cm-head"
      ref={rowRef}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {COLUMNS.map((col, i) => {
        const fk = headFilter(col.key);
        const on = fk !== null && filters[fk] !== null;
        return (
          <div role="columnheader" key={col.key} className={"cm-hcell" + (col.key === "no" ? " right" : "") + (fk || col.key === "done" ? " cm-hf" : "")}>
            {col.key === "done" ? (
              <button
                type="button"
                className={"cm-hbtn cm-fold" + (doneFolded ? " folded" : "")}
                aria-expanded={!doneFolded}
                aria-label={doneFolded ? "조치완료일 펼치기" : "조치완료일 접기"}
                title={doneFolded ? "조치완료일 펼치기" : "조치완료일 접기"}
                onClick={() => onFoldDone(!doneFolded)}
              >
                {!doneFolded && <span>{col.label}</span>}
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d={doneFolded ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} />
                </svg>
              </button>
            ) : fk ? (
              <button
                type="button"
                className={"cm-hbtn" + (on ? " on" : "")}
                aria-haspopup="dialog"
                aria-expanded={open === fk}
                aria-label={FILTER_LABEL[fk] + " 거르기" + (on ? " (거르는 중)" : "")}
                title={fk === "area" ? "지역(읍면동)으로 거르기" : undefined}
                onClick={() => onToggle(fk)}
              >
                <span>{col.label}</span>
                {/* 거르기 아이콘은 자리를 잡지 않고 마우스를 올렸을 때·거르는 중일 때만 여유 자리에 겹쳐 보여요(2026-10-21 ⑨ 1안). */}
                <Funnel />
              </button>
            ) : (
              col.label
            )}
            {open === fk && fk && dropdown}
            {i < COLUMNS.length - 1 && col.w !== null && <span className="cm-grip" aria-hidden="true" title="끌어서 열 너비 바꾸기" onMouseDown={(e) => start(e, i)} />}
          </div>
        );
      })}
      {menu && (
        <HeadMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onReset={() => {
            setMenu(null);
            onResetWidths();
          }}
        />
      )}
    </div>
  );
}

// ---------- 열 필터 (시안 ComplaintFilter.dc.html) ----------

/** 상태 칩 줄 + 걸린 필터 알약 (건수 글줄은 2026-10-19 사용자가 뺌) */
export function FilterChips({
  statuses,
  base,
  filters,
  onStatus,
  onOpen,
  onClear,
  onClearAll,
}: {
  statuses: string[];
  /** 상태 필터만 뺀 나머지 필터·검색을 건 민원 (칩 숫자) */
  base: Complaint[];
  filters: ColFilters;
  onStatus: (v: string[] | null) => void;
  onOpen: (k: FilterKey) => void;
  onClear: (k: FilterKey) => void;
  onClearAll: () => void;
}) {
  const sf = filters.status;
  const pills = (["intake", "ctype", "area"] as FilterKey[]).filter((k) => filters[k] !== null);
  const many = pills.length + (sf !== null ? 1 : 0) > 1;
  const label = (v: string) => (v === "" ? "(빈 칸)" : v);
  return (
    <div className="ct-chips" role="group" aria-label="상태로 거르기">
      <span className="ct-chips-label">상태</span>
      <button type="button" className="pchip" aria-pressed={sf === null} onClick={() => onStatus(null)}>
        <span>전체</span>
        <span className="pchip-n">{base.length}</span>
      </button>
      {/* 칩 순서(2026-10-21 사용자): 전체 │ 접수·진행·답변·보류·장기 │ 완료·불가 – 저장 순서·거르기는 그대로 */}
      {statuses.length > 0 && <span className="cm-fsep" aria-hidden="true" />}
      {[...statuses.filter((s) => !isClosed(s)), ...statuses.filter(isClosed)].map((s, i, arr) => {
        const on = sf !== null && sf.includes(s);
        const sep = i > 0 && isClosed(s) && !isClosed(arr[i - 1]);
        return (
          <Fragment key={s}>
            {sep && <span className="cm-fsep" aria-hidden="true" />}
            <button type="button" className="pchip" aria-pressed={on} onClick={() => {
                // 여러 개를 골라요(2026-10-19 사용자): 누르면 넣고·빼고, 다 빠지거나 전부 고르면 전체예요.
                const next = sf === null ? [s] : on ? sf.filter((x) => x !== s) : [...sf, s];
                onStatus(next.length === 0 || next.length === statuses.length ? null : statuses.filter((x) => next.includes(x)));
              }}>
              <span>{s}</span>
              <span className="pchip-n">{base.filter((c) => c.status === s).length}</span>
            </button>
          </Fragment>
        );
      })}
      {pills.length > 0 && (
        <>
          <span className="cm-fsep" aria-hidden="true" />
          {pills.map((k) => {
            const v = filters[k]!;
            const text = v.length === 0 ? "없음" : label(v[0]) + (v.length > 1 ? ` 외 ${v.length - 1}` : "");
            return (
              <span key={k} className="cm-fpill">
                <button type="button" className="cm-fpill-open" onClick={() => onOpen(k)}>
                  <span className="cm-fpill-k">{FILTER_LABEL[k]}</span>
                  <span>{text}</span>
                </button>
                <button type="button" className="cm-fpill-x" aria-label={FILTER_LABEL[k] + " 필터 풀기"} onClick={() => onClear(k)}>
                  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            );
          })}
        </>
      )}
      {many && (
        <button type="button" className="cm-fall" onClick={onClearAll}>
          모두 풀기
        </button>
      )}
    </div>
  );
}

function Funnel() {
  return (
    <svg className="cm-funnel" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />
    </svg>
  );
}

const emptyDraft = (lists: Lists): Draft => ({
  // 접수유형은 비워 두고 접수일은 오늘(2026-10-25 사용자).
  intake: "",
  received: todayStr(),
  ctype: "",
  area: "",
  place: "",
  road: "",
  person: "",
  phone: "",
  body: "",
  action: "",
  due: "",
  status: lists.status[0] ?? "",
  done: "",
});

/** 신규 줄과 고치는 줄이 함께 쓰는 칸 묶음 (사양서 순서, 연번과 메모 칸 빼고) */
function Cells({
  d,
  set,
  bad,
  lists,
  firstRef,
  onDateBlur,
  onDoneType,
  orig,
  short,
}: {
  d: Draft;
  set: (patch: Partial<Draft>) => void;
  bad: Bad;
  lists: Lists;
  firstRef?: React.Ref<HTMLInputElement>;
  onDateBlur: (k: DateKey) => void;
  /** 조치완료일을 손으로 적음(떠날 때 상태 완료) */
  onDoneType: (done: string) => void;
  /** 고치는 줄이면 고치기 전 값. 지금 목록에서 빠진 접수유형·상태도 그대로 받아 줘요. */
  orig?: Draft;
  /** 폭이 모자라 줄인 모양으로 보이는 열(날짜 칸은 커서가 없을 때 짧게 보여요) */
  short: Set<ColKey>;
}) {
  const cell = (k: string, input: ReactNode, cls = "cm-c") => (
    <div role="cell" key={k} className={cls}>
      {input}
    </div>
  );
  return (
    <>
      {cell(
        "intake",
        <ChoiceInput
          inputRef={firstRef}
          name="intake"
          label="접수유형"
          value={d.intake}
          options={lists.intake}
          allow={orig?.intake}
          invalid={bad.intake}
          onChange={(intake) => set({ intake })}
        />,
      )}
      {cell(
        "received",
        <DateField
          name="received"
          label="접수일"
          bad={bad.received}
          value={d.received}
          selectAll
          shortOf={short.has("received") ? shortDate : undefined}
          onChange={(received) => set({ received })}
          onBlur={() => onDateBlur("received")}
        />,
      )}
      {cell(
        "ctype",
        // 민원유형도 접수유형처럼 목록에서 골라요(2026-10-25 사용자 ④1안 – 분류 관리에서 더하기).
        <ChoiceInput name="ctype" label="민원유형" value={d.ctype} options={lists.ctype} allow={orig?.ctype} invalid={bad.ctype} onChange={(ctype) => set({ ctype })} />,
      )}
      {cell("place", <PlaceInput value={d.place} area={d.area} road={d.road} onChange={(place) => set({ place })} onArea={(area) => set({ area })} onRoad={(road) => set({ road })} />)}
      {cell(
        "person",
        // 민원인 한 칸(2026-10-21 사용자): 이름·기관·연락처를 친 그대로 – 번호만, 기관명만, 둘 다 아무거나
        <input name="person" aria-label="민원인" placeholder="민원인" title="이름·기관·연락처를 친 그대로 적어요" className="cell-input" value={d.person} onChange={(e) => set({ person: e.target.value })} />,
      )}
      {cell(
        "body",
        <BulletEditor name="body" label="내용" invalid={bad.body} placeholder="민원 내용" lines={parseLines(d.body)} onChange={(ls) => set({ body: JSON.stringify(ls) })} />,
      )}
      {cell("action", <BulletEditor name="action" label="조치내용" placeholder="조치내용" lines={parseLines(d.action)} onChange={(ls) => set({ action: JSON.stringify(ls) })} />)}
      {cell(
        "due",
        <DateField
          name="due"
          label="마감일"
          bad={bad.due}
          value={d.due}
          placeholder={short.has("due") ? "마감일" : "연-월-일"}
          shortOf={short.has("due") ? (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(5) : v) : undefined}
          onChange={(due) => set({ due })}
          onBlur={() => onDateBlur("due")}
        />,
      )}
      {cell(
        "status",
        <ChoiceInput
          name="status"
          label="상태"
          value={d.status}
          options={lists.status}
          allow={orig?.status}
          invalid={bad.status}
          stayOnTab
          onChange={(status) =>
            // 완료·불가를 고르면 비어 있는 조치완료일에 오늘, 다른 상태로 돌리면 비워요(배지와 같게).
            set({ status, ...(isClosed(status) ? (d.done ? {} : { done: todayStr() }) : isClosed(d.status) ? { done: "" } : {}) })
          }
        />,
      )}
      {cell("done", <DateField name="done" label="조치완료일" bad={bad.done} value={d.done ?? ""} onChange={onDoneType} onBlur={() => onDateBlur("done")} />, "cm-c cm-done-in")}
    </>
  );
}

// ---------- 신규 입력 줄 ----------

export function NewRow({ lists, short, onAdd }: { lists: Lists; short: Set<ColKey>; onAdd: (c: ComplaintInput) => Promise<boolean> }) {
  const f = useDraft(() => emptyDraft(lists));
  const rowRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  // 화면을 열면 첫 칸에 커서가 가 있어요.
  useEffect(() => firstRef.current?.focus(), []);

  // 설정 목록이 늦게 들어오면 비어 있는 상태 칸을 채워요(접수유형은 비워 둬요 – 2026-10-25 사용자).
  useEffect(() => {
    f.setD((old) => ({ ...old, status: old.status || lists.status[0] || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists.status]);

  async function submit() {
    const { input, first } = f.check(lists);
    if (!input) return focusField(rowRef.current, first!);
    if (await onAdd(input)) {
      // 접수일은 그대로 두어 같은 날 여러 건을 잇달아 적기 쉽게 해요.
      f.setD({ ...emptyDraft(lists), received: input.received });
      firstRef.current?.focus();
    }
  }

  return (
    <div
      role="row"
      className="cm-row cm-new"
      ref={rowRef}
      onKeyDown={(e) => rowKeys(e, rowRef.current, submit)}
    >
      <div role="cell" className="cm-c cm-new-tag">
        신규
      </div>
      <Cells d={f.d} set={f.set} bad={f.bad} lists={lists} firstRef={firstRef} onDateBlur={f.onDateBlur} onDoneType={f.typeDone} short={short} />
      <div role="cell" className="cm-c cm-center">
        <button type="button" className="btn-icon btn-add" aria-label="민원 등록" title="등록" tabIndex={-1} onClick={submit}>
          <Plus />
        </button>
      </div>
    </div>
  );
}

// ---------- 고치는 줄 ----------

export function EditRow({
  vi,
  c,
  lists,
  short,
  onCancel,
  onSave,
  onRemove,
  onMemo,
}: {
  vi?: number;
  c: Complaint;
  lists: Lists;
  short: Set<ColKey>;
  onCancel: () => void;
  onSave: (input: ComplaintInput) => void;
  onRemove: () => void;
  onMemo: () => void;
}) {
  const f = useDraft(() => ({
    intake: c.intake,
    received: c.received,
    ctype: c.ctype,
    area: c.area,
    place: c.place,
    road: c.road ?? "",
    // 민원인 한 칸 – 예전에 연락처를 따로 적은 민원도 한 칸으로 보여요(저장하면 합쳐져요).
    person: [c.person, c.phone].filter(Boolean).join(" "),
    phone: "",
    body: c.body,
    action: c.action,
    due: c.due,
    status: c.status,
    done: c.done ?? "",
  }));
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);

  function save(fromOutside = false) {
    const { input, first } = f.check(lists, { ...c });
    if (!input) {
      // 바깥을 눌렀는데 저장할 수 없으면 고치기 전으로 돌아가요.
      if (fromOutside) return onCancel();
      return focusField(ref.current, first!);
    }
    onSave(input);
  }

  const latest = useRef({ save, asking });
  latest.current = { save, asking };

  // "× 이 민원 지우기"의 × 왼쪽 끝을 연번 숫자 왼쪽 끝에 맞춰요(2026-10-19 사용자 – 숫자 자릿수마다 달라 재서 맞춰요).
  useLayoutEffect(() => {
    const row = ref.current;
    const foot = row?.querySelector<HTMLElement>(".cm-edit-foot");
    const no = row?.querySelector<HTMLElement>(".cm-no");
    const mark = foot?.querySelector<HTMLElement>(".del-mark");
    if (!row || !foot || !no || !mark || !no.firstChild) return;
    foot.style.paddingLeft = "";
    const g = document.createRange();
    g.selectNodeContents(no);
    const numLeft = g.getBoundingClientRect().left;
    const delta = numLeft - mark.getBoundingClientRect().left;
    const base = parseFloat(getComputedStyle(foot).paddingLeft) || 0;
    foot.style.paddingLeft = `${Math.max(0, Math.round(base + delta))}px`;
  });

  // 처음에 내용 칸 끝에 커서를 둬요.
  useEffect(() => {
    const all = ref.current?.querySelector(".bl-ed")?.querySelectorAll("textarea");
    const el = all?.[all.length - 1];
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  // 바깥을 누르면 저장해요. 묻는 띠가 펼쳐져 있으면 줄 안의 다른 곳을 눌렀을 때 띠만 접어요.
  useOutsideClose(true, [], (e) => {
    if (!isInside(e, ref)) return latest.current.save(true);
    if (latest.current.asking && !isInside(e, askRef, trashRef)) setAsking(false);
  });

  const hasMemo = parseMemo(c.memo).length > 0;

  return (
    <div
      ref={ref}
      role="row"
      data-cid={c.id}
      data-vi={vi}
      className="cm-row cm-edit"
      onKeyDown={(e) => {
        if (e.defaultPrevented) return;
        if (isKey(e, "common.cancel")) {
          e.preventDefault();
          if (asking) setAsking(false);
          else onCancel();
        } else rowKeys(e, ref.current, () => save());
      }}
    >
      <div role="cell" className="cm-c cm-no">
        {c.no}
      </div>
      <Cells d={f.d} set={f.set} bad={f.bad} lists={lists} onDateBlur={f.onDateBlur} onDoneType={f.typeDone} orig={c} short={short} />
      <div role="cell" className="cm-c cm-center">
        <MemoButton has={hasMemo} memo={c.memo} onClick={onMemo} />
      </div>
      <div className="cm-edit-foot">
        {asking ? (
          <AskBand bandRef={askRef} className="cm-ask" label="민원 지우기 확인" text={<>{c.no}번 민원을 지울까요? 메모도 함께 지워져요.</>} onNo={() => setAsking(false)} onYes={onRemove} />
        ) : (
          <button ref={trashRef} type="button" className="tool-box cm-del" aria-label={`${c.no}번 민원 지우기`} onClick={() => setAsking(true)}>
            <DelMark />
            <span>이 민원 지우기</span>
          </button>
        )}
        <span className="cm-edit-hint" aria-hidden="true" />
        <button type="button" className="btn btn-xs" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn-primary btn-xs" onClick={() => save()}>
          저장
        </button>
      </div>
    </div>
  );
}

// ---------- 보기 줄 ----------

function Bullets({ text, q }: { text: string; q: string }) {
  return <BulletView className="cm-bullets" lines={parseLines(text)} render={(l) => <Hl text={l.t} q={q} />} />;
}

export function ViewRow({
  vi,
  c,
  alt,
  q,
  today,
  urgentDays,
  flash,
  selected,
  statuses,
  short,
  doneFolded,
  placeStyle,
  onSelect,
  onMenu,
  onEdit,
  onMemo,
  onStatus,
  onDone,
  onDue,
}: {
  vi?: number;
  c: Complaint;
  alt: boolean;
  q: string;
  today: string;
  urgentDays: number;
  flash: boolean;
  selected: boolean;
  statuses: string[];
  /** 폭이 모자라 줄인 모양으로 보이는 열 */
  short: Set<ColKey>;
  /** 조치완료일 열을 접어 둠 */
  doneFolded: boolean;
  placeStyle: PlaceStyle;
  onSelect: () => void;
  /** 줄 우클릭 – 메뉴를 열 자리 */
  onMenu: (x: number, y: number) => void;
  /** 고치기: 두 번 누른 칸(null이면 줄 전체) */
  onEdit: () => void;
  onMemo: () => void;
  onStatus: (status: string) => void;
  onDone: (done: string) => void;
  onDue: (due: string) => void;
}) {
  const n = daysLeft(c, today);
  const taken = daysTaken(c);
  const [bg, fg] = statusColor(c.status);
  const hasMemo = parseMemo(c.memo).length > 0;
  const t = (s: string): ReactNode => <Hl text={s} q={q} />;
  // 줄인 모양(2026-10-21 사용자): 접수유형 두 글자 + "…", 접수일 26-10-16, 위치 읍면 생략 – 마우스를 올리면 전체.
  const intake = short.has("intake") ? shortIntake(c.intake) : c.intake;
  const received = short.has("received") ? shortDate(c.received) : c.received;
  // 위치 표기(2026-10-25 사용자 ③1안): 행정동 "운정3동 동패동 1234" · 법정동 "동패동 1234" – 리 지역은 둘 다 "조리읍 대원리 1234".
  const fullPlace = placeText(c.area, c.place, placeStyle);
  const place = short.has("place") ? c.place || c.area : fullPlace;
  const longPlace = [c.area, c.place].filter(Boolean).join(" ");
  const placeTitle = [longPlace !== place ? longPlace : "", c.road ? `바꾸기 전 ${c.road}` : ""].filter(Boolean).join(" · ") || undefined;
  const person = [c.person, c.phone].filter(Boolean).join(" ");
  return (
    <div
      role="row"
      tabIndex={0}
      data-cid={c.id}
      data-vi={vi}
      aria-selected={selected}
      className={"cm-row cm-view" + (alt ? " alt" : "") + (flash ? " flash" : "") + (selected ? " sel" : "") + (isClosed(c.status) ? " done" : "")}
      title="두 번 눌러 고치기 · 위치·민원인은 눌러서 복사 · 우클릭 메뉴: 고치기·복사·지우기"
      onClick={onSelect}
      onContextMenu={(e) => {
        // 글을 골라 두고 우클릭하면 복사 메뉴(앱 공통 – main.tsx)를 그대로 둬요.
        if (onSelection(e.target as Node)) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onDoubleClick={(e) => {
        // 두 번 누를 때 글자가 골라지는 것을 풀어요.
        window.getSelection()?.removeAllRanges();
        e.preventDefault();
        // 줄 어디를 두 번 눌러도 줄 전체를 고쳐요(2026-10-25 23:43 사용자 – 칸 하나 고치기 되돌림).
        onEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onEdit();
        }
      }}
    >
      <div role="cell" className="cm-c cm-no">
        {t(String(c.no))}
      </div>
      <div role="cell" className="cm-c cm-strong" title={intake !== c.intake ? c.intake : undefined}>
        {t(intake)}
      </div>
      <div role="cell" className="cm-c cm-num" title={received !== c.received ? c.received : undefined}>
        {t(received)}
      </div>
      {/* 민원유형은 한 줄 – 넘치면 "…", 마우스를 올리면 전체(2026-10-25 사용자) */}
      <div role="cell" className="cm-c cm-ell" title={c.ctype || undefined}>
        <span className="cm-ell-v">{t(c.ctype)}</span>
      </div>
      <div role="cell" className="cm-c">
        {/* 위치 칸에 지역(읍면동)을 붙여요(2026-10-21 사용자) – 누르면 위치(리·동 지번)만 복사(2026-10-25 23:43 사용자 – 되살림) */}
        {c.place ? <CopyCell value={c.place} shown={place} what="위치" render={t} title={placeTitle} /> : t(place)}
      </div>
      <div role="cell" className="cm-c cm-person">
        {/* 민원인 한 칸 – 넘치면 "…", 마우스를 올리면 전체, 누르면 복사(2026-10-25 23:43 사용자 – 되살림) */}
        {person && <CopyCell value={person} what="민원인" render={t} title={person} />}
      </div>
      <div role="cell" className="cm-c cm-multi">
        <Bullets text={c.body} q={q} />
      </div>
      {/* 조치내용도 내용과 같은 글자색(2026-10-21 사용자 1안) */}
      <div role="cell" className="cm-c cm-multi">
        <Bullets text={c.action} q={q} />
      </div>
      <div role="cell" className={"cm-c cm-num cm-due" + (short.has("due") ? " cm-due-short" : "")}>
        {/* 줄인 모양이면 날짜는 숨기고 D-day만(마우스를 올리면 날짜, 두 번 누르면 날짜 칸 – 2026-10-21 사용자). 답변 끝난 민원은 D-day가 없어 날짜를 그대로 보여요. */}
        {c.due && isAnswered(c.status) ? (
          // 답변 끝난 민원은 날짜 대신 흐린 체크만 – 마우스를 올리면 마감일(2026-10-26 18:55 사용자 1안)
          <span className="cm-due-done" title={`${c.due.slice(5)} 마감 · 답변 끝남`} aria-label={`${c.due} 마감 · 답변 끝남`}>
            <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
              <path d="M3 7.4l2.6 2.6L11 4.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          !(short.has("due") && n !== null) && <span>{t(short.has("due") ? shortDate(c.due) : c.due)}</span>
        )}
        {n !== null &&
          (short.has("due") ? (
            <DuePick c={c} text={ddayText(n)} urgent={isUrgent(n, urgentDays)} onSave={onDue} />
          ) : (
            <span className={"cm-dday" + (isUrgent(n, urgentDays) ? " urgent" : "")}>{ddayText(n)}</span>
          ))}
      </div>
      <div role="cell" className="cm-c">
        <StatusPick status={c.status} statuses={statuses} bg={bg} fg={fg} render={t} onPick={onStatus} />
      </div>
      <div role="cell" className="cm-c cm-num cm-due cm-done-c">
        <span className="cm-done-d">{t(c.done ?? "")}</span>
        {/* 접은 열은 칸을 두 번 누르면 작은 날짜 칸(빈 칸은 마우스를 올리면 "+" – 2026-10-25 사용자 ⑥1안) */}
        {(taken !== null || (doneFolded && !c.done)) && <TakenPick c={c} taken={taken} onSave={onDone} />}
      </div>
      <div role="cell" className="cm-c cm-center">
        <span onDoubleClick={(e) => e.stopPropagation()}>
          <MemoButton
            has={hasMemo}
            memo={c.memo}
            onClick={(e) => {
              e.stopPropagation();
              onMemo();
            }}
          />
        </span>
      </div>
    </div>
  );
}

function MemoButton({ has, memo, onClick }: { has: boolean; memo: string; onClick: (e: ReactMouseEvent) => void }) {
  const preview = has ? parseMemo(memo).map((l) => "· " + l.t).join("\n") : "메모 추가";
  return (
    <button type="button" className={"cm-memo" + (has ? " has" : "")} aria-label={has ? "메모 편집" : "메모 추가"} title={preview} onClick={onClick}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill={has ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    </button>
  );
}


function CopyCell({ value, shown, what, render, title }: { value: string; shown?: string; what: string; render: (s: string) => ReactNode; title?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={"cm-copy" + (copied ? " copied" : "")}
      onDoubleClick={(e) => e.stopPropagation()}
      title={title ?? "눌러서 복사"}
      aria-label={`${what} ${value} 복사`}
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(value);
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      <span className="cm-copy-v">{render(shown ?? value)}</span>
      <span className="cm-copy-note" aria-live="polite">
        {copied ? "복사했어요" : ""}
      </span>
    </button>
  );
}

/**
 * 상태 배지: 누르면 상태 목록이 바로 떠요(줄 고치기로 넘어가지 않아요). 고르면 바로 저장해요.
 * ↑↓로 고르고 Enter, Esc나 바깥을 누르면 닫혀요.
 */
function StatusPick({
  status,
  statuses,
  bg,
  fg,
  render,
  onPick,
}: {
  status: string;
  statuses: string[];
  bg: string;
  fg: string;
  render: (s: string) => ReactNode;
  onPick: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const opts = statuses.includes(status) ? statuses : [...statuses, status];

  useOutsideClose(open, [box], () => setOpen(false));

  function pick(s: string) {
    setOpen(false);
    onPick(s);
  }

  return (
    <span ref={box} className="cm-spick" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="cm-status cm-status-btn"
        style={{ background: bg, color: fg }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="눌러서 상태 바꾸기"
        onClick={() => {
          setHi(Math.max(0, opts.indexOf(status)));
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((hi + 1) % opts.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi(hi <= 0 ? opts.length - 1 : hi - 1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            pick(opts[hi]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        {render(status)}
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <span className="cm-spick-list" role="listbox" aria-label="상태 바꾸기">
          {opts.map((o, i) => {
            const [b, f] = statusColor(o);
            return (
              <span
                key={o}
                role="option"
                aria-selected={o === status}
                className={"cm-spick-opt" + (i === hi ? " hi" : "") + (o === status ? " cur" : "")}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
              >
                <span className="cm-status" style={{ background: b, color: f }}>
                  {o}
                </span>
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}

/**
 * 마감일을 줄여 D-day만 보일 때(2026-10-21 사용자): 마우스를 올리면 날짜, 두 번 누르면 마감일 칸이 떠요.
 * Enter·Tab·바깥 누르기 저장, Esc 그대로. 비우면 마감일을 지워요. 날짜 칸 규칙(parseDate).
 */
function DuePick({ c, text, urgent, onSave }: { c: Complaint; text: string; urgent: boolean; onSave: (due: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef({ v, c });
  live.current = { v, c };

  function commit(): boolean {
    const { v: raw, c: cur } = live.current;
    const d = raw.trim() ? parseDate(raw) : "";
    if (d === null) {
      setBad(true);
      return false;
    }
    setOpen(false);
    if (d !== cur.due) onSave(d);
    return true;
  }

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
  }, [open]);
  useOutsideClose(open, [box], () => {
    if (!commit()) setOpen(false);
  });

  return (
    <span ref={box} className="cm-tpick" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={"cm-dday cm-taken-btn cm-due-btn" + (urgent ? " urgent" : "")}
        title={`마감일 ${c.due} – 두 번 눌러서 고치기`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onDoubleClick={() => {
          setV(c.due);
          setBad(false);
          setOpen(true);
        }}
      >
        {text}
      </button>
      {open && (
        <span className="cm-tpick-pop" role="dialog" aria-label="마감일 고치기">
          <span className="cm-tpick-label">마감일</span>
          <DateInput
            inputRef={input}
            label="마감일"
            invalid={bad}
            value={v}
            onChange={(x) => {
              setV(x);
              setBad(false);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </span>
      )}
    </span>
  );
}

/**
 * 걸린 날 "4d"를 누르면 조치완료일을 고치는 작은 칸(2026-10-19 사용자 – 열을 접어 둔 채로도 고쳐요).
 * Enter·바깥 누르기 저장, Esc 그대로. 날짜 칸 규칙(parseDate)과 같고, 읽을 수 없거나 접수일보다 앞이면 빨간 테두리.
 */
function TakenPick({ c, taken, onSave }: { c: Complaint; taken: number | null; onSave: (done: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef({ v, c });
  live.current = { v, c };

  // 저장하면 true, 못 읽으면 false(칸은 열어 둬요).
  function commit(): boolean {
    const { v: raw, c: cur } = live.current;
    const d = parseDate(raw);
    if (!d || d < cur.received) {
      setBad(true);
      return false;
    }
    setOpen(false);
    if (d !== cur.done) onSave(d);
    return true;
  }

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useOutsideClose(open, [box], () => {
    if (!commit()) setOpen(false);
  });

  return (
    <span ref={box} className="cm-tpick" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {taken === null ? (
        // 접은 열의 빈 칸: 마우스를 올리면 "+", 두 번 누르면 조치완료일 칸(2026-10-25 사용자 ⑥1안)
        <button
          type="button"
          className="cm-done-add"
          title="두 번 눌러서 조치완료일 적기"
          aria-label="조치완료일 적기"
          aria-haspopup="dialog"
          aria-expanded={open}
          onDoubleClick={() => {
            setV(todayStr());
            setBad(false);
            setOpen(true);
          }}
        >
          <span aria-hidden="true">+</span>
        </button>
      ) : (
        <button
          type="button"
          className="cm-dday cm-taken cm-taken-btn"
          title={`조치완료일 ${c.done} · 접수부터 ${taken}일 – 눌러서 고치기`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setV(c.done ?? "");
            setBad(false);
            setOpen(!open);
          }}
        >
          {takenText(c, taken)}
        </button>
      )}
      {open && (
        <span className="cm-tpick-pop" role="dialog" aria-label="조치완료일 고치기">
          <span className="cm-tpick-label">조치완료일</span>
          <DateInput
            inputRef={input}
            label="조치완료일"
            invalid={bad}
            value={v}
            onChange={(x) => {
              setV(x);
              setBad(false);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </span>
      )}
    </span>
  );
}

// ---------- 아이콘 ----------

function Plus() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
