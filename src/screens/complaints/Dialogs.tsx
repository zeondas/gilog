// 민원대장 – 창·입력: 날짜 칸(DateField), 입력 상태(useDraft), 메모 창(MemoDialog), 분류 관리 창(CatsDialog).
import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "../../Icons";
import { DialogX } from "../../DialogX";
import { overlayDown } from "../../useOutsideClose";
import { Complaint } from "../../api";
import { parseLines, plainOf, stringifyLines } from "../../bullets";
import { MemoEditor } from "../../screens/contacts/Dialogs";
import { memoText, parseMemo } from "../../screens/contacts/parts";
import { parseDate } from "../../journal";
import { ListGroup, ListMerge } from "../settings/Table";
import { DONE_STATUS } from "../../settingsStore";
import { statusOnSave } from "../../complaints";
import { DateInput } from "../../DateInput";
import { Lists, Draft, DateKey, Bad, PlaceStyle, placeText } from "./parts";

/** 날짜 칸을 떠날 때 "1016" 같은 것을 2026-10-16으로 바꿔요. 읽을 수 없으면 빨간 테두리예요. */
function normDates(d: Draft): { d: Draft; bad: Bad } {
  const bad: Bad = {};
  const r = parseDate(d.received);
  if (!r) bad.received = true;
  const due = d.due.trim() ? parseDate(d.due) : "";
  if (due === null) bad.due = true;
  const done = (d.done ?? "").trim() ? parseDate(d.done ?? "") : "";
  if (done === null) bad.done = true;
  return { d: { ...d, received: r ?? d.received, due: due ?? d.due, done: done ?? d.done }, bad };
}

/**
 * 날짜 칸. 열이 좁아 줄인 모양이면 커서가 없을 때 짧게 보여요(접수일 26-10-16, 마감일 10-28) – 저장 값은 그대로 2026-10-16.
 * 커서가 들어가면 전체 값을 보여 줘요.
 */
export function DateField({
  name,
  label,
  value,
  bad,
  placeholder = "연-월-일",
  shortOf,
  selectAll,
  title,
  onChange,
  onBlur,
}: {
  name: string;
  label: string;
  value: string;
  bad?: boolean;
  placeholder?: string;
  shortOf?: (v: string) => string;
  /** 들어가면 글자 전체를 골라 치는 순간 바뀌게(접수일 – 2026-10-25 사용자: 기본 날짜 뒤에 이어 붙지 않게) */
  selectAll?: boolean;
  onChange: (v: string) => void;
  onBlur: () => void;
  /** 마우스를 올리면 보이는 이름(안내 글만 있는 칸 – 민원대장 처리 칸) */
  title?: string;
}) {
  // 마우스로 눌러 들어오면 떼는 순간 커서가 놓이며 고른 것이 풀려요 – 들어온 뒤 첫 떼기는 막아요.
  const justIn = useRef(false);
  // 공통 날짜 칸(DateInput)이 떠날 때 8자리로 바꿔 쓰고, 빨간 테두리는 이 줄의 규칙(onDateBlur)이 정해요.
  return (
    <DateInput
      name={name}
      label={label}
      invalid={bad}
      placeholder={placeholder}
      title={title}
      shortOf={shortOf}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      onFocus={
        selectAll
          ? (e) => {
              const el = e.currentTarget;
              justIn.current = true;
              requestAnimationFrame(() => el.select());
            }
          : undefined
      }
      onMouseUp={
        selectAll
          ? (e) => {
              if (!justIn.current) return;
              justIn.current = false;
              e.preventDefault();
            }
          : undefined
      }
    />
  );
}

/** 칸 이름으로 그 칸에 커서를 둬요. */
export function focusField(row: HTMLElement | null, name: string) {
  row?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
}

/** 칸 묶음이 함께 쓰는 입력 상태. 날짜를 떠날 때 바꾸고, 저장할 때 검사해요. */
export function useDraft(init: () => Draft) {
  const [d, setD] = useState<Draft>(init);
  const [bad, setBad] = useState<Bad>({});
  // 조치완료일을 손으로 적었는지 – 떠날 때 상태를 완료로(2026-10-25 사용자, 불가도 완료).
  const doneTyped = useRef(false);
  const set = (patch: Partial<Draft>) => {
    setD((old) => ({ ...old, ...patch }));
    setBad((b) => {
      const n = { ...b };
      for (const k of Object.keys(patch)) delete n[k as keyof Bad];
      return n;
    });
  };
  const onDateBlur = (k: DateKey) => {
    const v = (d[k] ?? "").trim();
    if (!v && k !== "received") return;
    const p = parseDate(v);
    if (p && k === "done" && doneTyped.current) {
      doneTyped.current = false;
      set({ done: p, status: DONE_STATUS });
    } else if (p) set({ [k]: p });
    else setBad((b) => ({ ...b, [k]: true }));
  };
  const typeDone = (done: string) => {
    doneTyped.current = true;
    set({ done });
  };
  /** 등록·저장할 값. 틀린 칸이 있으면 null이고 그 칸 이름을 돌려줘요. */
  const check = (lists: Lists, orig?: Draft): { input: Draft | null; first?: string } => {
    const { d: n, bad: b } = normDates(d);
    // 접수유형·상태는 목록에 있는 값만 받아요(고치는 줄은 고치기 전 값도). 접수유형은 비워도 돼요.
    const ok = (v: string, list: string[], was?: string) => list.includes(v.trim()) || (!!was && v.trim() === was);
    n.intake = n.intake.trim();
    n.ctype = n.ctype.trim();
    // 조치완료일을 적었으면 어느 길로 저장하든 완료(QC CM-17) – 날짜를 읽을 수 있을 때만.
    n.status = statusOnSave(n.status.trim(), b.done ? "" : n.done ?? "", doneTyped.current);
    if (n.intake && !ok(n.intake, lists.intake, orig?.intake)) b.intake = true;
    // 민원유형은 목록에 없는 값도 받아요 – 등록·저장한 뒤 화면이 설정 목록에 더해요(QC CM-07, 2026-11-02 사용자 1안).
    if (!ok(n.status, lists.status, orig?.status)) b.status = true;
    setD(n);
    setBad(b);
    const first = (["intake", "received", "ctype", "due", "status", "done"] as const).find((k) => b[k]);
    if (first) return { input: null, first };
    // 아무 칸 하나만 적어도 등록(2026-10-25 사용자) – 처음부터 채워지는 접수일·상태는 세지 않아요.
    const filled = [n.intake, n.ctype, n.area, n.place, n.person, n.due, n.done ?? ""].some((v) => v.trim()) || !!plainOf(n.body).trim() || !!plainOf(n.action).trim();
    if (!filled) return { input: null, first: "intake" };
    doneTyped.current = false;
    return { input: { ...n, person: n.person.trim(), phone: "", body: stringifyLines(parseLines(n.body)), action: stringifyLines(parseLines(n.action)) } };
  };
  return { d, setD, bad, setBad, set, onDateBlur, check, typeDone };
}

// ---------- 메모 창 ----------

export function MemoDialog({ c, placeStyle, onClose, onSave }: { c: Complaint; placeStyle: PlaceStyle; onClose: () => void; onSave: (memo: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const save = useRef<(() => void) | null>(null);
  // 메모 머리 위치도 표 칸과 같은 "위치 표기" 설정(법정동/행정동)을 따라요(QC CM-34).
  const who = [`${c.no}번`, placeText(c.area, c.place, placeStyle)].filter(Boolean).join(" · ");
  return (
    <div className="overlay">
      <div ref={box} className="dialog cm-memo-dialog" role="dialog" aria-modal="true" aria-label="메모 편집">
        <div className="dialog-head cm-memo-head">
          <span className="dialog-title">메모</span>
          <span className="muted small">{who}</span>
          {/* 창 닫기 = 저장하고 닫기(2026-10-25 사용자 ⑩ – 바깥 누르기·Tab과 같아요, 버리려면 Esc) */}
          <button type="button" className="dialog-x" aria-label="저장하고 닫기" title="저장하고 닫기 (버리려면 Esc)" onClick={() => save.current?.()}>
            <CloseIcon />
          </button>
        </div>
        <div className="dialog-body cm-memo-body">
          <MemoEditor initial={parseMemo(c.memo)} boundary={box} saveRef={save} onCancel={onClose} onSave={(lines) => onSave(memoText(lines))} />
        </div>
      </div>
    </div>
  );
}

// ---------- 분류 관리 창 ----------

/** 분류 관리 창. mergeFor가 주는 것으로 지울 때 그 값을 쓰는 민원을 다른 값으로 합쳐요(2026-10-28 ✔1). */
export function CatsDialog({
  lists,
  mergeFor,
  onChange,
  onClose,
}: {
  lists: Lists;
  mergeFor: (field: "intake" | "ctype") => ListMerge;
  onChange: (l: Lists) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const cur = { status: lists.status, intake: lists.intake, ctype: lists.ctype };
  return (
    <div className="overlay" onMouseDown={overlayDown(onClose)}>
      <div className="dialog mgr" role="dialog" aria-modal="true" aria-label="분류 관리">
        <div className="dialog-head">
          <span className="dialog-title">분류 관리</span>
        </div>
        <DialogX onClick={onClose} />
        <div className="dialog-body">
          <ListGroup title="접수유형" items={cur.intake} stack merge={mergeFor("intake")} onChange={(intake) => onChange({ ...cur, intake })} />
          <ListGroup title="민원유형" items={cur.ctype} stack merge={mergeFor("ctype")} onChange={(ctype) => onChange({ ...cur, ctype })} last />
        </div>
      </div>
    </div>
  );
}
