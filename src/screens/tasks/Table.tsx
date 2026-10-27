// 할 일 목록 – 왼쪽 목록 칸(ListPanel)과 항목 한 줄(ItemRow). 화면 몸통은 Screen.tsx.
import { MouseEvent as ReactMouseEvent, useRef, useState } from "react";
import { DelGlyph } from "../../Icons";
import { useOutsideClose } from "../../useOutsideClose";
import { TaskEdit, TaskList } from "../../api";
import { BulletView } from "../../BulletParts";
import { Hl } from "../../ContactsScreen";
import { dueBadge, Item } from "../../tasks";
import { AskBand } from "../../AskBand";
import { ListMenu } from "./Menu";
import { TaskEditor } from "./Dialogs";
import { isComposing, Plus, Tick } from "./parts";

// ---------- 왼쪽 목록 ----------

export function ListPanel({
  lists,
  counts,
  taskCount,
  onToggle,
  onAdd,
  onRename,
  onMove,
  onDelete,
}: {
  lists: TaskList[];
  counts: (id: number) => number;
  taskCount: (id: number) => number;
  onToggle: (l: TaskList) => void;
  onAdd: (name: string) => Promise<boolean>;
  onRename: (l: TaskList, name: string) => Promise<boolean>;
  onMove: (l: TaskList, dir: number) => void;
  onDelete: (l: TaskList) => void;
}) {
  const [name, setName] = useState("");
  const [menu, setMenu] = useState<{ id: number; x: number; y: number; mode: "menu" | "rename" | "ask" } | null>(null);

  async function add() {
    if (!name.trim()) return;
    if (await onAdd(name)) setName("");
  }

  const ml = menu ? lists.find((l) => l.id === menu.id) : undefined;
  const at = ml ? lists.indexOf(ml) : -1;

  return (
    <nav className="td-lists" aria-label="목록">
      {/* 새 목록 만들기를 맨 위에 두고, 구분선 아래에 목록 (2026-10-19 사용자) */}
      <div className="td-newlist">
        <input
          className="cell-input"
          aria-label="새 목록 이름"
          placeholder="새 목록 만들기"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (isComposing(e)) return;
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            } else if (e.key === "Escape") setName("");
          }}
        />
        <button type="button" className="btn-icon td-newlist-add" aria-label="목록 추가" onClick={add}>
          <Plus />
        </button>
      </div>
      {lists.map((l) => (
        <button
          key={l.id}
          type="button"
          className="td-list"
          aria-pressed={l.visible}
          title="체크하면 카드가 보여요 · 우클릭하면 이름 바꾸기·옮기기·지우기"
          onClick={() => onToggle(l)}
          onContextMenu={(e) => {
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ id: l.id, x: e.clientX || r.right, y: e.clientY || r.top, mode: "menu" });
          }}
        >
          <span className="td-list-box" aria-hidden="true">
            {l.visible && <Tick />}
          </span>
          <span className="td-list-name">{l.name}</span>
          <span className="td-list-count">{counts(l.id)}</span>
        </button>
      ))}
      {menu && ml && (
        <ListMenu
          {...menu}
          list={ml}
          count={taskCount(ml.id)}
          first={at === 0}
          last={at === lists.length - 1}
          onMode={(mode) => setMenu({ ...menu, mode })}
          onClose={() => setMenu(null)}
          onMove={(dir) => {
            onMove(ml, dir);
            setMenu(null);
          }}
          onRename={async (n) => {
            if (await onRename(ml, n)) setMenu(null);
          }}
          onDelete={() => {
            setMenu(null);
            onDelete(ml);
          }}
        />
      )}
    </nav>
  );
}

// ---------- 항목 한 줄 ----------

export function ItemRow({
  it,
  sub,
  inDone,
  q,
  today,
  urgentDays,
  selected,
  flash,
  editing,
  pop,
  onSelect,
  onEdit,
  onCheck,
  onOpenComplaint,
  onSub,
  onSave,
  onCancelEdit,
  onRemove,
}: {
  it: Item;
  sub: boolean;
  inDone: boolean;
  q: string;
  today: string;
  urgentDays: number;
  selected: boolean;
  flash: boolean;
  editing: boolean;
  /** 방금 직접 눌러 체크했어요 – 체크 움직임을 보이고, 끝날 때까지 남은 일 자리에 있어요. */
  pop: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onCheck: () => void;
  onOpenComplaint: () => void;
  onSub: () => void;
  onSave: (e: TaskEdit) => Promise<boolean>;
  onCancelEdit: () => void;
  onRemove: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const askRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // "지울까요?"가 펼쳐진 동안 그 띠 바깥을 누르면 지우지 않고 접어요.
  useOutsideClose(asking, [askRef], () => setAsking(false));

  if (editing && it.task) {
    return <TaskEditor task={it.task} sub={sub} today={today} onSave={onSave} onCancel={onCancelEdit} onRemove={onRemove} />;
  }

  const t = it.task;
  const c = it.complaint;
  const badge = !inDone && it.due ? dueBadge(it.due, today, urgentDays) : null;
  const hasDetail = it.detail.length > 0;
  const childCount = it.children.length;
  // 저장이 돌아오기 전에도 누른 순간부터 체크된 모양이에요.
  const on = it.done || pop;
  // 남은 일 자리에 잠깐 머무는 완료 항목(방금 체크한 것과 함께 완료된 하위 항목): 글자만 완료 모양, 줄 높이는 그대로.
  const settling = !inDone && on;

  return (
    <div
      ref={rowRef}
      data-key={it.key}
      tabIndex={0}
      aria-selected={selected}
      className={"td-row" + (sub ? " sub" : "") + (inDone ? " done" : "") + (settling ? " settling" : "") + (selected ? " sel" : "") + (flash ? " flash" : "")}
      title={c ? "눌러서 내용 보기 · 두 번 누르면 민원대장에서 보기" : "눌러서 세부정보 보기 · 두 번 누르면 고치기"}
      onClick={(e: ReactMouseEvent) => {
        if ((e.target as HTMLElement).closest("button, .td-row-acts, .bl-list")) return;
        onSelect();
        rowRef.current?.focus();
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, .td-row-acts")) return;
        window.getSelection()?.removeAllRanges();
        e.preventDefault();
        onEdit();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || isComposing(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          if (selected) onEdit();
          else onSelect();
        } else if (e.key === "Escape" && selected) onSelect();
      }}
    >
      <button
        type="button"
        className={"td-check" + (on ? " on" : "") + (pop ? " pop" : "") + (c ? " linked" : "")}
        aria-pressed={on}
        aria-label={c ? (on ? "답변 취소 (민원대장 상태를 되돌려요)" : "답변으로 표시 (민원대장 상태가 답변으로 바뀌어요)") : on ? "완료 취소" : "완료로 표시"}
        title={c ? (on ? "체크를 풀면 민원대장의 상태를 그 전으로 되돌려요" : "체크하면 민원대장의 상태가 답변으로 바뀌어요") : undefined}
        onClick={() => {
          // 움직이는 동안 한 번 더 누르면 무시해요(저장이 두 번 가지 않게).
          if (!pop) onCheck();
        }}
      >
        <Tick />
      </button>
      <div className="td-row-main">
        <div className="td-row-title">
          <span className="td-title-t">
            <Hl text={it.title} q={q} />
          </span>
          {hasDetail && !selected && (
            <svg className="td-note-icon" aria-label="세부정보 있음" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          )}
        </div>
        {selected && (
          <div className="td-detail">
            {hasDetail ? (
              <BulletView lines={it.detail} render={(l) => <Hl text={l.t} q={q} />} />
            ) : (
              <span className="td-detail-none">세부정보가 없어요</span>
            )}
          </div>
        )}
        {(badge || c) && (
          <span className="td-badges">
            {badge && (
              <span className={"td-due " + badge.tone}>
                {badge.date}
                <b>{badge.dday}</b>
              </span>
            )}
            {c && <span className="td-src">민원대장</span>}
            {c && !inDone && <span className="td-src-st">{c.status}</span>}
          </span>
        )}
        {!selected && !sub && childCount > 0 && inDone && <span className="hint">하위 항목 {childCount}개</span>}
        {selected && (
          <div className="td-row-acts">
            {c ? (
              <button type="button" className="btn btn-xs" onClick={onOpenComplaint}>
                민원대장에서 보기
              </button>
            ) : (
              <>
                {!sub && !inDone && (
                  <button type="button" className="btn btn-xs" onClick={onSub}>
                    <Plus size={14} />
                    하위 항목 추가
                  </button>
                )}
                {!inDone && (
                  <button type="button" className="btn btn-xs" onClick={onEdit}>
                    고치기
                  </button>
                )}
                <span className="td-acts-gap" />
                {asking ? (
                  <AskBand
                    bandRef={askRef}
                    className="td-ask"
                    label="할 일 지우기 확인"
                    text={childCount && t && !t.parent ? `하위 항목 ${childCount}개도 함께 지워져요. 지울까요?` : "이 할 일을 지울까요?"}
                    onNo={() => setAsking(false)}
                    onYes={onRemove}
                  />
                ) : (
                  <button type="button" className="tool-box del-btn" aria-label="이 할 일 지우기" title="이 할 일 지우기" onClick={() => setAsking(true)}>
                    <DelGlyph />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
