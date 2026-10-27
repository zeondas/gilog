// 캘린더 – 창·입력: 빠른 입력 줄(QuickRow), 상세 창(EventDialog·RemindField), 종류 관리 창(KindsDialog), 구글 상태 상자(GoogleBox), 알림 확인 창(NotifyDialog), 상세 창 값(Draft·toInput·draftOf·blankDraft).
import { KeyboardEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { DelGlyph, DelMark } from "../../Icons";
import { DialogX } from "../../DialogX";
import { overlayDown } from "../../useOutsideClose";
import { isKey, keyAction, rowKeys } from "../../keys";
import { api, CalEvent, CalKind, CalendarData, EventInput, NotifyStatus, Repeat } from "../../api";
import { BLine, parseLines, stringifyLines } from "../../bullets";
import { BulletEditor } from "../../BulletParts";
import {
  addDays, colorBg, colorFg, diffDays, hourLater, kindColor, parseTime, REMIND_LABELS, REMIND_MAX, REMIND_UNITS, REPEAT_LABELS, shortDay,
  splitRemind,
} from "../../calendar";
import { parseDate, todayStr } from "../../journal";
import { DateInput } from "../../DateInput";
import { exportNow, GStatus, onGoogleStatus, whenText } from "../../google";
import { loadNotifyMode, saveNotifyMode, stamp, syncReminders } from "../../reminders";
import { AskBand } from "../../AskBand";
import { KindPicker, ColorButton } from "./Menu";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

const plainEnter = (e: KeyboardEvent) => e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;

/** 상세 창이 고치는 값 (날짜·시각은 친 글자 그대로) */
export type Draft = {
  id: number | null;
  title: string;
  kind: string;
  date: string;
  end: string;
  allDay: boolean;
  time: string;
  endTime: string;
  repeat: Repeat;
  until: string;
  place: string;
  desc: BLine[];
  remind: number;
  /** 종일 일정의 알림 시각 (비우면 9시) */
  remindTime: string;
};

type Bad = Partial<Record<"title" | "date" | "end" | "time" | "endTime" | "until" | "remind" | "remindTime", true>>;

/** 상세 창의 값을 저장할 값으로 바꿔요. 틀린 칸이 있으면 그 칸들을 돌려줘요. */
function toInput(d: Draft): { input: EventInput | null; bad: Bad } {
  const bad: Bad = {};
  const date = parseDate(d.date);
  const end = d.end.trim() ? parseDate(d.end) : date;
  const time = d.allDay ? "" : parseTime(d.time);
  const endTime = d.allDay ? "" : d.endTime.trim() ? parseTime(d.endTime) : time ? hourLater(time) : "";
  const until = d.repeat ? parseDate(d.until) : "";
  if (!d.title.trim()) bad.title = true;
  if (!date) bad.date = true;
  if (!end || (date && end < date)) bad.end = true;
  if (!d.allDay && !time) bad.time = true;
  if (!d.allDay && endTime === null) bad.endTime = true;
  if (!d.allDay && time && endTime && date === end && endTime < time) bad.endTime = true;
  if (d.repeat && (!until || (date && until < date))) bad.until = true;
  if (d.remind !== -1 && !(d.remind >= 0 && d.remind <= REMIND_MAX && Number.isInteger(d.remind))) bad.remind = true;
  const remindTime = d.allDay && d.remind >= 0 && d.remindTime.trim() ? parseTime(d.remindTime) : "";
  if (remindTime === null) bad.remindTime = true;
  if (Object.keys(bad).length) return { input: null, bad };
  return {
    input: {
      title: d.title,
      kind: d.kind,
      date: date!,
      end: end!,
      allDay: d.allDay,
      time: time || "",
      endTime: endTime || "",
      repeat: d.repeat,
      until: until || "",
      place: d.place,
      desc: stringifyLines(d.desc),
      remind: d.remind,
      remindTime: remindTime || "",
    },
    bad,
  };
}

export function draftOf(e: CalEvent, kinds: CalKind[]): Draft {
  return {
    id: e.id,
    title: e.title,
    kind: kinds.find((k) => k.id === e.kind)?.name ?? "",
    date: e.date,
    end: e.end,
    allDay: e.allDay,
    time: e.time,
    endTime: e.endTime,
    repeat: e.repeat,
    until: e.until,
    place: e.place,
    desc: parseLines(e.desc),
    remind: e.remind,
    remindTime: e.remindTime,
  };
}

const firstKind = (kinds: CalKind[]) => kinds.find((k) => !k.system)?.name ?? "";

export function blankDraft(date: string, kinds: CalKind[]): Draft {
  return { id: null, title: "", kind: firstKind(kinds), date, end: "", allDay: true, time: "", endTime: "", repeat: "", until: "", place: "", desc: [], remind: -1, remindTime: "" };
}

// ---------- 빠른 입력 줄 ----------

export function QuickRow({
  sel,
  kinds,
  onSel,
  onAdd,
  onDetail,
}: {
  sel: string;
  kinds: CalKind[];
  onSel: (d: string) => void;
  onAdd: (i: EventInput) => Promise<boolean>;
  onDetail: (d: Draft) => void;
}) {
  const [date, setDate] = useState(sel);
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState(firstKind(kinds));
  const [bad, setBad] = useState<"date" | "time" | "endTime" | "title" | "">("");
  const row = useRef<HTMLDivElement>(null);
  const focus = (n: string) => {
    const el = row.current?.querySelector<HTMLInputElement>(`[name="${n}"]`);
    el?.focus();
    el?.select();
  };

  // 달력에서 날을 고르면 날짜 칸이 따라가요.
  useEffect(() => {
    setDate(sel);
    if (bad === "date") setBad("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  // 화면을 열면 첫 칸(날짜)에 커서가 가요.
  useEffect(() => {
    focus("date");
  }, []);

  function draft(): Draft {
    const t = parseTime(time) ?? "";
    return {
      ...blankDraft(parseDate(date) ?? date, kinds),
      title,
      kind: kind.trim() || firstKind(kinds),
      allDay: !t,
      time: t,
      endTime: parseTime(endTime) ?? (t ? hourLater(t) : ""),
      remind: t ? 10 : -1,
    };
  }

  async function submit() {
    const d = parseDate(date);
    if (!d) return setBad("date"), focus("date");
    const t = time.trim() ? parseTime(time) : "";
    if (t === null) return setBad("time"), focus("time");
    const et = endTime.trim() ? parseTime(endTime) : "";
    if (et === null || (t && et && et < t)) return setBad("endTime"), focus("endTime");
    if (!t && et) return setBad("time"), focus("time");
    if (!title.trim()) return setBad("title"), focus("title");
    setBad("");
    const ok = await onAdd({
      title,
      kind: kind.trim() || firstKind(kinds),
      date: d,
      end: d,
      allDay: !t,
      time: t,
      endTime: et || (t ? hourLater(t) : ""),
      repeat: "",
      until: "",
      place: "",
      desc: "",
      remind: t ? 10 : -1,
      remindTime: "",
    });
    if (!ok) return;
    setTime("");
    setEndTime("");
    setTitle("");
    onSel(d);
    focus("date");
  }

  // 엔터규칙(keys.ts): Enter·Tab 다음 칸, 마지막 칸(종류)이면 등록
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    rowKeys(e, row.current, () => void submit());
  }

  const fix = (v: string, set: (s: string) => void) => {
    const t = parseTime(v);
    if (t) set(t);
  };

  return (
    <div className="cal-quick" role="row" ref={row} onKeyDown={onKeyDown}>
      <DateInput
        name="date"
        label="날짜"
        placeholder=""
        invalid={bad === "date"}
        value={date}
        onChange={(v) => {
          setDate(v);
          if (bad === "date") setBad("");
        }}
        // 칸을 떠나면 2026-10-12 꼴로 바꿔 써요(DateInput). 읽을 수 없으면 친 그대로 두고 빨간 테두리.
        onLeave={(d) => {
          if (d === null) setBad("date");
          else if (d && d !== sel) onSel(d);
        }}
      />
      <input
        name="time"
        aria-label="시작 시간"
        placeholder="시작"
        inputMode="numeric"
        className={"cell-input num" + (bad === "time" ? " invalid" : "")}
        value={time}
        onChange={(e) => {
          setTime(e.target.value);
          if (bad === "time") setBad("");
        }}
        onBlur={() => fix(time, setTime)}
      />
      <input
        name="endTime"
        aria-label="종료 시간"
        placeholder="종료"
        inputMode="numeric"
        className={"cell-input num" + (bad === "endTime" ? " invalid" : "")}
        value={endTime}
        onChange={(e) => {
          setEndTime(e.target.value);
          if (bad === "endTime") setBad("");
        }}
        onBlur={() => fix(endTime, setEndTime)}
      />
      <input
        name="title"
        aria-label="일정"
        placeholder="일정"
        className={"cell-input" + (bad === "title" ? " invalid" : "")}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (bad === "title") setBad("");
        }}
      />
      <KindPicker kinds={kinds} value={kind} onChange={setKind} />
      <button
        type="button"
        tabIndex={-1}
        className="btn cal-detail-btn"
        onClick={() => {
          // 적던 것은 상세 창으로 옮겨 가요(날짜·종류는 남겨 둬요).
          onDetail(draft());
          setTime("");
          setEndTime("");
          setTitle("");
          setBad("");
        }}
      >
        상세 입력
      </button>
      <button type="button" className="btn-icon cal-add" aria-label="일정 등록" title="일정 등록" onClick={submit}>
        <Plus />
      </button>
    </div>
  );
}

// ---------- 상세 창 ----------

export function EventDialog({
  draft,
  kinds,
  onChange,
  onSave,
  onDelete,
  onClose,
}: {
  draft: Draft;
  kinds: CalKind[];
  onChange: (d: Draft) => void;
  onSave: (i: EventInput) => Promise<boolean>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [bad, setBad] = useState<Bad>({});
  const [asking, setAsking] = useState(false);
  const start = useRef(JSON.stringify(draft));
  const titleRef = useRef<HTMLInputElement>(null);
  /** 마지막으로 맞게 적은 시작 날짜 (끝 날짜를 같이 옮길 때 써요) */
  const prevDate = useRef(parseDate(draft.date));
  const isNew = draft.id === null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    onChange({ ...draft, [k]: v });
    if (k in bad) setBad((b) => ({ ...b, [k]: undefined }));
  };

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function save() {
    const { input, bad } = toInput(draft);
    setBad(bad);
    if (!input) return;
    await onSave(input);
  }

  /** 바깥을 누르면 저장해요(사용자가 정한 규칙). 고친 것이 없으면 그냥 닫아요. */
  function outside() {
    if (JSON.stringify(draft) === start.current || (isNew && !draft.title.trim())) onClose();
    else save();
  }


  // 엔터규칙(keys.ts): 한 줄 칸 Enter·Tab 다음 칸, 마지막 칸이면 저장. 설명(여러 줄 칸)은 다음 칸이 없는 곳으로 쳐서 Tab = 저장하고 닫기.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    if (isKey(e, "common.cancel")) {
      e.preventDefault();
      if (asking) setAsking(false);
      else onClose();
      return;
    }
    const t = e.target as HTMLElement;
    if (t.closest(".cal-desc") && keyAction(e, "multi") === "common.next") {
      e.preventDefault();
      void save();
      return;
    }
    rowKeys(e, e.currentTarget, () => void save());
  }

  /** 날짜 칸을 떠나면 2026-10-12 꼴로 바꿔 써요. 읽을 수 없으면 친 그대로 두고 빨간 테두리. */
  const dateFix = (k: "date" | "end" | "until") => {
    const d = parseDate(draft[k]);
    if (!d) {
      if (draft[k].trim()) setBad((b) => ({ ...b, [k]: true }));
      return;
    }
    if (k !== "date") return set(k, d);
    // 시작 날짜를 옮기면 끝 날짜도 같은 만큼 옮겨요(여러 날 일정의 길이를 지켜요).
    const prev = prevDate.current;
    const end = parseDate(draft.end);
    prevDate.current = d;
    const next = { ...draft, date: d };
    if (end && prev && end >= prev) next.end = addDays(end, diffDays(prev, d));
    else if (end && end < d) next.end = d;
    onChange(next);
  };

  return (
    <div className="overlay" onMouseDown={overlayDown(outside)}>
      <div className="dialog cal-dialog" role="dialog" aria-modal="true" aria-label="일정 상세" onKeyDown={onKeyDown}>
        {/* × = 바깥 누르기와 같음: 고친 것이 있으면 저장하고 닫기(✔7) */}
        <DialogX label="저장하고 닫기" title="저장하고 닫기 (버리려면 Esc)" onClick={outside} />
        <div className="cal-dlg-title" data-dialog-title>
          <input
            ref={titleRef}
            aria-label="제목"
            placeholder="제목 추가"
            className={bad.title ? "invalid" : undefined}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </div>
        <div className="cal-dlg-grid">
          <span className="cal-dlg-label">일시</span>
          <div className="cal-dlg-line">
            <DateInput label="시작 날짜" placeholder="" className="cal-in-date" invalid={bad.date} value={draft.date} onChange={(v) => set("date", v)} onBlur={() => dateFix("date")} />
            {!draft.allDay && (
              <input
                aria-label="시작 시간"
                placeholder="시작"
                className={"cell-input num cal-in-time" + (bad.time ? " invalid" : "")}
                value={draft.time}
                onChange={(e) => set("time", e.target.value)}
                onBlur={() => {
                  const t = parseTime(draft.time);
                  if (t) onChange({ ...draft, time: t, endTime: draft.endTime.trim() ? draft.endTime : hourLater(t) });
                }}
              />
            )}
            <span className="muted" aria-hidden="true">
              –
            </span>
            {!draft.allDay && (
              <input
                aria-label="종료 시간"
                placeholder="종료"
                className={"cell-input num cal-in-time" + (bad.endTime ? " invalid" : "")}
                value={draft.endTime}
                onChange={(e) => set("endTime", e.target.value)}
                onBlur={() => {
                  const t = parseTime(draft.endTime);
                  if (t) set("endTime", t);
                }}
              />
            )}
            <DateInput
              label="종료 날짜"
              placeholder={draft.date}
              className="cal-in-date"
              invalid={bad.end}
              value={draft.end}
              onChange={(v) => set("end", v)}
              onBlur={() => dateFix("end")}
            />
            <button
              type="button"
              className="btn cal-allday"
              aria-pressed={draft.allDay}
              onClick={() =>
                onChange(
                  draft.allDay
                    ? { ...draft, allDay: false, time: draft.time || "09:00", endTime: draft.endTime || "10:00", remind: draft.remind < 0 ? 10 : draft.remind }
                    : { ...draft, allDay: true },
                )
              }
            >
              종일
            </button>
          </div>

          <span className="cal-dlg-label">반복</span>
          <div className="cal-dlg-line">
            <select aria-label="반복" className="cal-select" value={draft.repeat} onChange={(e) => set("repeat", e.target.value as Repeat)}>
              {REPEAT_LABELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {draft.repeat && (
              <>
                <span className="cal-dlg-sub">종료일</span>
                <DateInput
                  label="반복 종료일"
                  placeholder="날짜"
                  className="cal-in-date"
                  invalid={bad.until || !draft.until.trim()}
                  value={draft.until}
                  onChange={(v) => set("until", v)}
                  onBlur={() => dateFix("until")}
                />
                
              </>
            )}
          </div>

          <span className="cal-dlg-label">장소</span>
          <input aria-label="장소" placeholder="장소 추가" className="cell-input" value={draft.place} onChange={(e) => set("place", e.target.value)} />

          <span className="cal-dlg-label top">설명</span>
          <div className="cal-desc">
            <BulletEditor lines={draft.desc} onChange={(v) => set("desc", v)} name="desc" label="설명" placeholder="설명 추가" />
          </div>

          <span className="cal-dlg-label">캘린더</span>
          <div className="cal-dlg-line">
            <KindPicker kinds={kinds} value={draft.kind} onChange={(v) => set("kind", v)} />
          </div>

          <span className="cal-dlg-label">알림</span>
          <RemindField
            value={draft.remind}
            allDay={draft.allDay}
            time={draft.remindTime}
            bad={!!bad.remind}
            badTime={!!bad.remindTime}
            onChange={(remind, remindTime) => {
              onChange({ ...draft, remind, remindTime });
              if (bad.remind || bad.remindTime) setBad((b) => ({ ...b, remind: undefined, remindTime: undefined }));
            }}
          />
        </div>
        {asking && (
          <AskBand
            className="cal-ask"
            label="일정 지우기 확인"
            text={draft.repeat ? "반복 일정 전체를 지울까요?" : "이 일정을 지울까요?"}
            onNo={() => setAsking(false)}
            onYes={onDelete}
          />
        )}
        <div className="dialog-foot cal-dlg-foot">
          {!isNew && (
            <button type="button" className="tool-box cal-trash del-btn" aria-label="일정 삭제" title="일정 삭제" onClick={() => setAsking(true)}>
              <DelGlyph />
            </button>
          )}
                    <button type="button" className="btn btn-ctrl cal-cancel" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn-primary btn-ctrl" onClick={save}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 알림 고르기 ----------

/**
 * 알림: 정해 둔 값(정시·10분·30분·1시간·1일·7일·한 달 전) 또는 직접 설정(수 + 분·시간·일·주 전).
 * 종일 일정은 그 날(또는 며칠 전)의 몇 시에 알릴지 시각도 정해요(비우면 오전 9시).
 */
function RemindField({
  value,
  allDay,
  time,
  bad,
  badTime,
  onChange,
}: {
  value: number;
  allDay: boolean;
  time: string;
  bad: boolean;
  badTime: boolean;
  onChange: (remind: number, time: string) => void;
}) {
  const preset = REMIND_LABELS.some(([v]) => v === value);
  const [custom, setCustom] = useState(!preset);
  const [n, u] = splitRemind(value < 0 ? 0 : value);
  const [num, setNum] = useState(String(n));
  const [unit, setUnit] = useState(u);
  const setCustomValue = (nn: string, uu: number) => {
    setNum(nn);
    setUnit(uu);
    const k = Number(nn);
    onChange(Number.isFinite(k) && nn.trim() !== "" ? Math.round(k * uu) : NaN, time);
  };
  return (
    <div className="cal-dlg-line">
      <select
        aria-label="알림"
        className="cal-select"
        value={custom ? "custom" : String(value)}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setCustom(true);
            const base = value > 0 ? value : 60;
            const [cn, cu] = splitRemind(base);
            setCustomValue(String(cn), cu);
          } else {
            setCustom(false);
            onChange(Number(e.target.value), time);
          }
        }}
      >
        {REMIND_LABELS.map(([v, l]) => (
          <option key={v} value={v}>
            {allDay && v === 0 ? "당일" : l}
          </option>
        ))}
        <option value="custom">직접 설정</option>
      </select>
      {custom && (
        <>
          <input
            aria-label="알림 수"
            inputMode="numeric"
            className={"cell-input num cal-in-num" + (bad ? " invalid" : "")}
            value={num}
            onChange={(e) => setCustomValue(e.target.value.replace(/[^0-9]/g, ""), unit)}
          />
          <select aria-label="알림 단위" className="cal-select" value={unit} onChange={(e) => setCustomValue(num, Number(e.target.value))}>
            {REMIND_UNITS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </>
      )}
      {allDay && value >= 0 && (
        <>
          <span className="cal-dlg-sub">알림 시각</span>
          <input
            aria-label="알림 시각"
            placeholder="09:00"
            className={"cell-input num cal-in-time" + (badTime ? " invalid" : "")}
            value={time}
            onChange={(e) => onChange(value, e.target.value)}
            onBlur={() => {
              const t = parseTime(time);
              if (t) onChange(value, t);
            }}
          />
        </>
      )}
      {bad && <span className="cal-dlg-sub">62일 전까지 정할 수 있어요</span>}
    </div>
  );
}

// ---------- 종류 관리 창 ----------

export function KindsDialog({
  data,
  onKinds,
  onDeleted,
  run,
  holidayLine,
  onRefreshHolidays,
  onNotify,
  onClose,
}: {
  data: CalendarData;
  onKinds: (k: CalKind[]) => void;
  onDeleted: (id: number) => void;
  run: <T>(p: Promise<T>, msg?: string) => Promise<T | null>;
  holidayLine: string;
  onRefreshHolidays: () => Promise<string>;
  onNotify: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  /** 공휴일 다시 받기: 받는 중·결과 */
  const [hol, setHol] = useState<{ busy: boolean; msg: string; ok: boolean } | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const mine = data.kinds.filter((k) => !k.system);
  const sys = data.kinds.filter((k) => k.system);
  const count = (id: number) => data.events.filter((e) => e.kind === id).length;

  async function add() {
    if (!name.trim()) return;
    const r = await run(api.addCalKind(name), "종류 이름이 비었거나 같은 이름의 종류가 있어요.");
    if (r) {
      onKinds(r);
      setName("");
    }
  }

  const row = (k: CalKind, extra: ReactNode) => {
    const c = kindColor(k, data.kinds);
    return (
      <div key={k.id} className="prow cal-krow">
        <div className="prow-name mgr-name">
          <span className="cal-kbadge" style={{ background: colorBg(c), color: colorFg(c) }}>
            {k.name}
          </span>
          <span className="mgr-info">{extra}</span>
        </div>
        <ColorButton
          label={k.name}
          value={c}
          auto={k.color === null}
          autoLabel={k.system ? "처음 색" : "자동"}
          onPick={(i) => run(api.setCalKindColor(k.id, i)).then((r) => r && onKinds(r))}
        />
        {k.system ? (
          <span className="mgr-gap" aria-hidden="true" />
        ) : (
          <button
            type="button"
            className="tool-box del-hit"
            aria-label={k.name + " 삭제"}
            title={mine.length <= 1 ? "종류는 하나 이상 있어야 해요" : k.name + " 삭제"}
            disabled={mine.length <= 1}
            onClick={() => setAsking(k.id)}
          >
            <DelMark />
          </button>
        )}
        {asking === k.id && (
          <AskBand
            className="ask-wide"
            label="종류 지우기 확인"
            text={count(k.id) ? `"${k.name}"과 그 일정 ${count(k.id)}건을 지울까요?` : `"${k.name}"을 지울까요?`}
            onNo={() => setAsking(null)}
            onYes={async () => {
              const n = await run(api.deleteCalKind(k.id));
              setAsking(null);
              if (n !== null) onDeleted(k.id);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div
        className="dialog mgr"
        role="dialog"
        aria-modal="true"
        aria-label="캘린더 종류 관리"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !isComposing(e)) {
            e.preventDefault();
            if (asking !== null) setAsking(null);
            else onClose();
          }
        }}
      >
        <div className="dialog-head">
          <span className="dialog-title">캘린더 종류 관리</span>
        </div>
        <DialogX onClick={onClose} />
        <div className="dialog-body">
          <div className="mgr-label">직접 만든 종류</div>
          {mine.map((k) => row(k, count(k.id) ? `일정 ${count(k.id)}건` : "일정 없음"))}
          <div className="padd">
            <input
              aria-label="새 종류 이름"
              placeholder="새 종류 이름"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (plainEnter(e) && !isComposing(e)) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button type="button" className="btn-primary btn-ctrl mgr-add" onClick={add}>
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              추가
            </button>
          </div>
          <div className="mgr-label">자동으로 들어오는 종류</div>
          {sys.map((k) =>
            row(
              k,
              k.system === "complaint" ? (
                "민원대장 마감일"
              ) : k.system === "task" ? (
                "할 일 마감일"
              ) : (
                <span className="cal-holrow">
                  <span>{holidayLine}</span>
                  <button
                    type="button"
                    className="btn btn-xs cal-holbtn"
                    aria-disabled={hol?.busy || undefined}
                    aria-busy={hol?.busy || undefined}
                    onClick={async () => {
                      if (hol?.busy) return;
                      setHol({ busy: true, msg: "받는 중…", ok: true });
                      const err = await onRefreshHolidays();
                      setHol({ busy: false, msg: err || `받았어요 (${stamp().slice(11)})`, ok: !err });
                    }}
                  >
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={hol?.busy ? "spin" : undefined}>
                      <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" />
                    </svg>
                    {hol?.busy ? "받는 중…" : "다시 받기"}
                  </button>
                  {hol && !hol.busy && (
                    <span className={hol.ok ? "cal-hol-ok" : "cal-hol-fail"} role="status">
                      {hol.ok ? "✓ " : ""}
                      {hol.msg}
                    </span>
                  )}
                </span>
              ),
            ),
          )}
        </div>
        <div className="dialog-foot cal-dlg-foot">
          <button type="button" className="btn btn-ctrl" onClick={onNotify}>
            알림 확인
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- 구글 연동 상태 상자 (9단계, 시안: 캘린더 왼쪽 맨 위) ----------

export function GoogleBox() {
  const [g, setG] = useState<GStatus | null>(null);
  useEffect(() => onGoogleStatus(setG), []);
  if (!g || !g.connected) return null;
  return (
    <div className="g-box">
      <div className="g-box-head">
        <span className={"g-dot" + (g.lastError ? " bad" : "")} aria-hidden="true" />
        <span>{g.lastError ? "구글 내보내기 실패" : "구글 캘린더 연동됨"}</span>
      </div>
      <span className={"g-box-sub" + (g.lastError ? " g-err" : "")}>
        {g.busy ? "내보내는 중…" : g.lastError || "기록 → 구글 한 방향"}
        {!g.busy && g.lastOk && <span className="g-box-at">마지막 성공 {whenText(g.lastOk)}</span>}
      </span>
      <button type="button" className="btn btn-xs" disabled={g.busy} onClick={() => exportNow()}>
        지금 내보내기
      </button>
    </div>
  );
}

// ---------- 알림 확인 창 ----------

/**
 * 윈도우 알림이 뜨는지 확인해요. 시험 알림을 띄워 보고, 안 보이면 PowerShell 이름으로 다시 띄워 봐요
 * (설치 바로가기의 앱 이름이 윈도우에 안 잡힌 PC가 있어요). 보인 쪽을 저장해 두고 그 이름으로 계속 띄워요.
 */
export function NotifyDialog({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<NotifyStatus | null>(null);
  const [ps, setPs] = useState(false);
  const [step, setStep] = useState<"" | "asked" | "done">("");
  const [err, setErr] = useState("");
  const refresh = useCallback(() => api.notifyStatus().then(setSt, () => {}), []);
  useEffect(() => {
    syncReminders().then(refresh);
    loadNotifyMode().then(setPs);
  }, [refresh]);

  async function test(powershell: boolean) {
    setErr("");
    await saveNotifyMode(powershell);
    setPs(powershell);
    try {
      setSt(await api.testNotification());
      setStep("asked");
    } catch (e) {
      setErr(String(e));
    }
  }

  const next = st?.nextAt ? new Date(st.nextAt) : null;
  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div className="dialog cal-notify" role="dialog" aria-modal="true" aria-label="알림 확인" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="dialog-head">
          <span className="dialog-title">알림 확인</span>
        </div>
        <DialogX onClick={onClose} />
        <div className="dialog-body cal-notify-body">
          <p>
            앞으로 7일 동안 울릴 알림 <b>{st?.pending ?? 0}건</b>
            {next && ` · 다음 알림 ${shortDay(todayStr(next))} ${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`}
          </p>
          <p className="hint">
            지금 쓰는 이름: {ps ? "PowerShell" : "기록"}
            {st?.shown ? ` · 켠 뒤 띄운 알림 ${st.shown}건` : ""}
            {st?.lastError ? ` · 마지막 오류: ${st.lastError}` : ""}
          </p>
          {err && <p className="note">윈도우가 알림을 거절했어요: {err}</p>}
          {step === "asked" && (
            <div className="ask-band cal-notify-ask">
              <span>화면 오른쪽 아래에 "기록 알림 시험"이 보였나요?</span>
              <button type="button" className="btn btn-xs" onClick={() => setStep("done")}>
                보였어요
              </button>
              {!ps ? (
                <button type="button" className="btn btn-xs" onClick={() => test(true)}>
                  안 보였어요 (다른 이름으로 다시)
                </button>
              ) : (
                <button type="button" className="btn btn-xs" onClick={() => test(false)}>
                  안 보였어요 (기록 이름으로 다시)
                </button>
              )}
            </div>
          )}
          {step === "done" && <p className="cal-hol-ok">✓ 이 이름({ps ? "PowerShell" : "기록"})으로 알림을 띄워요.</p>}
          <p className="hint">안 보이면 윈도우 설정 → 시스템 → 알림을 확인해 주세요.</p>
        </div>
        <div className="dialog-foot cal-dlg-foot">
          <button type="button" className="btn btn-ctrl cal-cancel" onClick={() => test(ps)}>
            시험 알림 띄우기
          </button>
        </div>
      </div>
    </div>
  );
}

function Plus() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
