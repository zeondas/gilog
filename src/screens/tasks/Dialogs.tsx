// 할 일 목록 – 입력·고치기 칸: 할 일 추가(AddForm), 날짜 칸(DueField), 그 자리 고치기(TaskEditor).
import { KeyboardEvent, ReactNode, useEffect, useRef, useState } from "react";
import { DelGlyph } from "../../Icons";
import { isInside, useOutsideClose } from "../../useOutsideClose";
import { isKey, rowKeys } from "../../keys";
import { Task, TaskEdit } from "../../api";
import { BLine, parseLines, stringifyLines } from "../../bullets";
import { BulletEditor } from "../../BulletParts";
import { parseDate } from "../../journal";
import { DateInput, MiniCal } from "../../DateInput";
import { AskBand } from "../../AskBand";
import { Tick } from "./parts";

// ---------- 신규 입력 ----------

type Draft = { title: string; detail: string; due: string };

/**
 * 카드 맨 위 "할 일 추가" (sub이면 하위 항목 입력).
 * 제목을 누르면 세부정보·날짜 칸이 펼쳐져요. Tab·Enter 다음 칸, 날짜 칸에서 Enter·Tab 등록, Esc 닫기.
 */
export function AddForm({
  open,
  sub,
  today,
  placeholder,
  onOpen,
  onClose,
  onAdd,
}: {
  open: boolean;
  sub?: boolean;
  today: string;
  placeholder: string;
  onOpen: () => void;
  onClose: () => void;
  onAdd: (v: Draft) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<BLine[]>([{ t: "" }]);
  const [due, setDue] = useState("");
  const [bad, setBad] = useState<"" | "title" | "due">("");
  const box = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sub) titleRef.current?.focus();
  }, [sub]);

  function reset() {
    setTitle("");
    setLines([{ t: "" }]);
    setDue("");
    setBad("");
  }

  const busy = useRef(false);

  /** 등록해요. leave가 참이면(바깥을 눌렀을 때) 등록한 뒤 입력란을 접고, 제목이 비어 있으면 등록하지 않고 접기만 해요. */
  async function submit(leave = false) {
    if (busy.current) return;
    if (!title.trim()) {
      if (leave) return onClose();
      setBad("title");
      titleRef.current?.focus();
      return;
    }
    const d = due.trim() ? parseDate(due) : "";
    if (d === null) {
      // 날짜를 읽을 수 없으면 등록하지 않고 빨간 테두리로 알려요(공통 규칙).
      setBad("due");
      if (!leave) box.current?.querySelector<HTMLInputElement>('input[name="due"]')?.focus();
      return;
    }
    busy.current = true;
    const ok = await onAdd({ title, detail: stringifyLines(lines), due: d });
    busy.current = false;
    if (!ok) return;
    if (leave) {
      reset();
      onClose();
      return;
    }
    // 제목 칸으로 먼저 옮겨요. 날짜 칸이 떠나면서 날짜를 고쳐 쓰는 것(onBlur)이 비우기보다 먼저 일어나야 해요.
    titleRef.current?.focus();
    reset();
  }

  const latest = useRef(submit);
  latest.current = submit;

  // 바깥을 누르면 저장하고 접어요(공통 규칙 "바깥을 누르면 저장"). 제목이 비어 있으면 접기만 해요.
  useOutsideClose(open, [box], () => void latest.current(true));

  // 엔터규칙(keys.ts): 제목 Enter·Tab 다음 칸, 세부정보는 여러 줄 칸 규칙, 마지막 칸(날짜)에서 Enter·Tab 등록, Esc 닫기.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (isKey(e, "common.cancel")) {
      e.preventDefault();
      reset();
      t.blur?.();
      onClose();
    } else rowKeys(e, box.current, () => submit());
  }

  return (
    <div ref={box} className={"td-add" + (open ? " open" : "") + (sub ? " sub" : "")} onKeyDown={onKeyDown}>
      <div className="td-add-line">
        <svg className="td-add-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="11" />
          <path d="M12 7v10M7 12h10" />
        </svg>
        <input
          ref={titleRef}
          name="title"
          className={"fld td-add-title" + (bad === "title" ? " invalid" : "")}
          aria-label={sub ? "하위 항목 제목" : "할 일 제목"}
          placeholder={open && !sub ? "제목" : placeholder}
          value={title}
          onFocus={onOpen}
          onChange={(e) => {
            setTitle(e.target.value);
            if (bad === "title") setBad("");
          }}
        />
      </div>
      {open && (
        <div className="td-add-form">
          <BulletEditor lines={lines} onChange={setLines} name="detail" label="세부정보" placeholder="세부정보" />
          <DueField value={due} onChange={(v) => { setDue(v); if (bad === "due") setBad(""); }} onInvalid={() => setBad("due")} bad={bad === "due"} today={today}>
            <button
              type="button"
              tabIndex={-1}
              className="btn btn-xs td-add-cancel"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              취소
            </button>
            <button type="button" className="btn-primary btn-xs" onClick={() => submit()}>
              등록
            </button>
          </DueField>
        </div>
      )}
    </div>
  );
}

// ---------- 날짜 칸 + 작은 달력 ----------

/** 날짜 칸. 직접 적거나("1016", "10/16", "261016") 달력 단추를 눌러 작은 달력에서 골라요. children은 같은 줄 오른쪽에 놓여요. */
function DueField({
  value,
  onChange,
  onInvalid,
  bad,
  today,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 칸을 떠날 때 날짜를 읽을 수 없으면 (빨간 테두리) */
  onInvalid: () => void;
  bad: boolean;
  today: string;
  children?: ReactNode;
}) {
  const [cal, setCal] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const picked = parseDate(value) ?? "";
  return (
    <>
      <div className="td-due-row">
        <button
          type="button"
          tabIndex={-1}
          className="td-cal-btn"
          aria-label="달력에서 날짜 고르기"
          aria-expanded={cal}
          title="달력에서 날짜 고르기"
          onClick={() => setCal((c) => !c)}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
        </button>
        <DateInput
          inputRef={input}
          name="due"
          base="fld td-due-input"
          label="마감일"
          invalid={bad}
          placeholder="날짜 1016"
          value={value}
          onChange={onChange}
          // 칸을 떠날 때 8자리로 바꿔 쓰고, 읽을 수 없으면 친 그대로 두고 빨간 테두리(공통 규칙).
          onLeave={(d) => d === null && onInvalid()}
        />
        {children}
      </div>
      {cal && (
        <MiniCal
          value={picked}
          today={today}
          onPick={(d) => {
            onChange(d);
            setCal(false);
            input.current?.focus();
          }}
          onClose={() => setCal(false)}
        />
      )}
    </>
  );
}

// ---------- 고치기 ----------

/** 그 자리에서 고치기. Tab·Enter 다음 칸, 마지막 칸(날짜)이면 저장, Esc 취소, 바깥을 누르면 저장. 휴지통은 저장·취소와 떨어져 있어요. */
export function TaskEditor({
  task,
  sub,
  today,
  onSave,
  onCancel,
  onRemove,
}: {
  task: Task;
  sub: boolean;
  today: string;
  onSave: (e: TaskEdit) => Promise<boolean>;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [lines, setLines] = useState<BLine[]>(() => {
    const ls = parseLines(task.detail);
    return ls.length ? ls : [{ t: "" }];
  });
  const [due, setDue] = useState(task.due);
  const [bad, setBad] = useState<"" | "title" | "due">("");
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLInputElement>('input[name="title"]');
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  async function save() {
    if (busy.current) return;
    if (!title.trim()) {
      setBad("title");
      ref.current?.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
      return;
    }
    const d = due.trim() ? parseDate(due) : "";
    if (d === null) {
      setBad("due");
      ref.current?.querySelector<HTMLInputElement>('input[name="due"]')?.focus();
      return;
    }
    const edit = { title, detail: stringifyLines(lines), due: d };
    if (edit.title.trim() === task.title && edit.detail === task.detail && edit.due === task.due) return onCancel();
    busy.current = true;
    const ok = await onSave(edit);
    busy.current = false;
    if (ok) onCancel();
  }

  const latest = useRef({ save, asking });
  latest.current = { save, asking };

  // 바깥을 누르면 저장해요. 묻는 띠가 펼쳐져 있으면 안쪽 다른 곳을 눌렀을 때 띠만 접어요.
  useOutsideClose(true, [], (e) => {
    if (!isInside(e, ref)) return void latest.current.save();
    if (latest.current.asking && !isInside(e, askRef, trashRef)) setAsking(false);
  });

  return (
    <div
      ref={ref}
      className={"td-row td-edit" + (sub ? " sub" : "")}
      data-key={"t" + task.id}
      onKeyDown={(e) => {
        if (e.defaultPrevented) return;
        if (isKey(e, "common.cancel")) {
          e.preventDefault();
          if (asking) setAsking(false);
          else onCancel();
        } else rowKeys(e, ref.current, () => void save());
      }}
    >
      <span className={"td-check" + (task.done ? " on" : "")} aria-hidden="true">
        {task.done && <Tick />}
      </span>
      <div className="td-row-main">
        <input
          name="title"
          className={"cell-input td-edit-title" + (bad === "title" ? " invalid" : "")}
          aria-label="할 일 제목"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (bad === "title") setBad("");
          }}
        />
        <BulletEditor lines={lines} onChange={setLines} name="detail" label="세부정보" placeholder="세부정보" />
        <DueField value={due} onChange={(v) => { setDue(v); if (bad === "due") setBad(""); }} onInvalid={() => setBad("due")} bad={bad === "due"} today={today}>
          {asking ? (
            <AskBand bandRef={askRef} className="td-ask" label="할 일 지우기 확인" text="이 할 일을 지울까요?" onNo={() => setAsking(false)} onYes={onRemove} />
          ) : (
            <button ref={trashRef} type="button" tabIndex={-1} className="tool-box del-btn" aria-label="이 할 일 지우기" title="이 할 일 지우기" onClick={() => setAsking(true)}>
              <DelGlyph />
            </button>
          )}
          <span className="td-acts-gap" />
          <button type="button" tabIndex={-1} className="btn btn-xs" onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn-primary btn-xs" onClick={save}>
            저장
          </button>
        </DueField>
        <span className="hint">Tab·Enter 다음 칸 · 마지막 칸이면 저장 · Esc 취소 · 바깥을 누르면 저장</span>
      </div>
    </div>
  );
}
