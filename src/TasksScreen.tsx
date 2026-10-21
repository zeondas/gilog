// 할 일 목록 (7단계). 목록마다 카드 하나예요(구글 할 일과 같은 구성). 시안: Todo.dc.html, 사양서 "할 일 목록".
// - 왼쪽: 목록 체크(카드 보이기·숨기기), 우클릭 메뉴(이름 바꾸기·옮기기·지우기), 새 목록 만들기.
// - 카드 맨 위 "할 일 추가"를 누르면 세부정보·날짜 칸이 펼쳐져요. 세부정보는 여러 줄 칸(엔터규칙), 마지막 칸(날짜)에서 Enter·Tab 등록.
// - 항목을 한 번 누르면 골라지고 세부정보가 펼쳐져요. 두 번 누르면(또는 골라 둔 채 Enter) 고쳐요. 삭제는 "지울까요?"를 물어요.
// - "민원" 카드에는 민원대장의 민원(마감일 있는 것)이 함께 보여요. 따로 저장하지 않고 민원을 그대로 읽어요.
//   체크하면 민원대장의 상태가 완료로 바뀌고, 체크를 풀면 그 전 상태로 돌아가요. 제목·마감일은 민원대장에서만 고쳐요.
import { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DelIcon } from "./Icons";
import { isInside, useOutsideClose } from "./useOutsideClose";
import { isKey, rowKeys } from "./keys";
import { REMOTE_CHANGE } from "./google";
import { api, Complaint, errorText, Task, TaskEdit, TaskInput, TaskList, TasksData } from "./api";
import { BLine, parseLines, stringifyLines } from "./bullets";
import { BulletEditor, BulletView } from "./BulletParts";
import { Hl } from "./ContactsScreen";
import { parseDate, todayStr } from "./journal";
import { ANSWER_STATUS, DEFAULT_SETTINGS, isAnswered, loadSettings } from "./settingsStore";
import { complaintItems, dueBadge, Item, openCount, split, treeOf } from "./tasks";

const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;


type Props = {
  urgentDays: number;
  /** 업무일지 "챙길 일"에서 누른 할 일. 그 항목으로 가서 잠깐 칠해요. */
  focusId?: number | null;
  onFocused?: () => void;
  /** 민원 항목을 두 번 누르거나 "민원대장에서 보기"를 누르면 민원대장의 그 줄로 가요. */
  onOpenComplaint?: (id: number) => void;
};

export default function TasksScreen({ urgentDays, focusId, onFocused, onOpenComplaint }: Props) {
  const [data, setData] = useState<TasksData | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_SETTINGS.status);
  const [today, setToday] = useState(todayStr());
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  /** 골라 둔(한 번 누른) 항목. 세부정보가 펼쳐져요. */
  const [sel, setSel] = useState<string | null>(null);
  /** 고치는 할 일 */
  const [editId, setEditId] = useState<number | null>(null);
  /** 신규 입력이 펼쳐진 목록 */
  const [addFor, setAddFor] = useState<number | null>(null);
  /** 하위 항목을 적는 중인 위 항목 */
  const [subFor, setSubFor] = useState<number | null>(null);
  /** "완료됨"을 펼친 목록 */
  const [openDone, setOpenDone] = useState<Set<number>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  /** 카드 제목 줄 우클릭 메뉴(목록 지우기) */
  const [cardMenu, setCardMenu] = useState<{ id: number; x: number; y: number; mode: "menu" | "rename" | "ask" } | null>(null);
  /** 이번에 체크한 민원의 그 전 상태. 체크를 풀면 이 상태로 돌려요. */
  const prevStatus = useRef(new Map<number, string>());

  useEffect(() => {
    api.tasksData().then(setData, (e) => setNote(errorText(e)));
    api.complaints().then(setComplaints, () => {});
    loadSettings().then((s) => setStatuses(s.status), () => {});
    // 구글 할 일에서 체크한 것이 들어오면 다시 읽어요.
    const reload = () => {
      api.tasksData().then(setData, () => {});
      api.complaints().then(setComplaints, () => {});
    };
    window.addEventListener(REMOTE_CHANGE, reload);
    return () => window.removeEventListener(REMOTE_CHANGE, reload);
  }, []);

  // 자정을 넘기면 "오늘"을 바꿔요(마감 배지).
  useEffect(() => {
    const t = window.setInterval(() => setToday(todayStr()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  /** 저장 쪽을 부르고, 실패하면 이유를 보여 줘요. */
  const run = useCallback(async <T,>(p: Promise<T>, msg?: string): Promise<T | null> => {
    try {
      const r = await p;
      setNote("");
      return r;
    } catch (e) {
      setNote(e === "invalid" && msg ? msg : errorText(e));
      return null;
    }
  }, []);

  const putTasks = useCallback((ts: Task[]) => {
    setData((d) => {
      if (!d) return d;
      const by = new Map(ts.map((t) => [t.id, t]));
      const kept = d.tasks.map((t) => by.get(t.id) ?? t);
      const added = ts.filter((t) => !d.tasks.some((x) => x.id === t.id));
      return { ...d, tasks: [...kept, ...added] };
    });
  }, []);

  const putList = useCallback((l: TaskList) => {
    setData((d) => (d ? { ...d, lists: d.lists.some((x) => x.id === l.id) ? d.lists.map((x) => (x.id === l.id ? l : x)) : [...d.lists, l] } : d));
  }, []);

  // 업무일지 "챙길 일"에서 온 할 일: 그 카드를 보이게 하고, 항목을 골라 펼친 뒤 잠깐 칠해요.
  useEffect(() => {
    if (!data || focusId == null) return;
    const t = data.tasks.find((x) => x.id === focusId);
    onFocused?.();
    if (!t) return;
    const l = data.lists.find((x) => x.id === t.list);
    if (l && !l.visible) run(api.setTaskListVisible(l.id, true)).then((r) => r && putList(r));
    if (t.done) setOpenDone((s) => new Set(s).add(t.list));
    const key = "t" + t.id;
    setQ("");
    setSel(key);
    setFlash(key);
    window.setTimeout(() => document.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
  }, [data, focusId, onFocused, run, putList]);

  useEffect(() => {
    if (flash === null) return;
    const t = window.setTimeout(() => setFlash(null), 1600);
    return () => window.clearTimeout(t);
  }, [flash]);

  const lq = q.trim().toLowerCase();

  /** 목록마다 항목(민원 목록은 민원 포함) */
  const itemsOf = useMemo(() => {
    const m = new Map<number, Item[]>();
    if (!data) return m;
    const keep = new Set(prevStatus.current.keys());
    for (const l of data.lists) {
      const items = treeOf(data.tasks, l.id);
      m.set(l.id, l.builtin ? [...complaintItems(complaints, today, keep), ...items] : items);
    }
    return m;
  }, [data, complaints, today]);

  // ---------- 바꾸는 일 ----------

  async function addTask(input: TaskInput): Promise<boolean> {
    const t = await run(api.addTask(input), "제목을 적고 날짜를 확인해 주세요.");
    if (!t) return false;
    putTasks([t]);
    return true;
  }

  async function saveTask(id: number, edit: TaskEdit): Promise<boolean> {
    const t = await run(api.updateTask(id, edit), "제목을 적고 날짜를 확인해 주세요.");
    if (!t) return false;
    putTasks([t]);
    return true;
  }

  async function toggleTask(t: Task) {
    const r = await run(api.setTaskDone(t.id, !t.done, todayStr()));
    if (r) putTasks(r);
  }

  async function removeTask(id: number) {
    const n = await run(api.deleteTask(id));
    if (n === null) return;
    setData((d) => (d ? { ...d, tasks: d.tasks.filter((t) => t.id !== id && t.parent !== id) } : d));
    setEditId(null);
    setSel(null);
  }

  /**
   * 민원 체크: 마감일은 법정 답변기한이라 체크 = 상태 "답변"(그 전 상태를 기억해요).
   * 답변이 끝난 민원(답변·완료·보류·장기)은 체크된 것으로 보이고, 풀면 그 전 상태(모르면 답변 전 첫 상태)로 돌려요.
   */
  async function toggleComplaint(c: Complaint) {
    let next: string;
    if (isAnswered(c.status)) {
      next = prevStatus.current.get(c.id) ?? statuses.find((s) => !isAnswered(s)) ?? "접수";
    } else {
      prevStatus.current.set(c.id, c.status);
      next = ANSWER_STATUS;
    }
    const r = await run(api.setComplaintStatus(c.id, next));
    if (r) setComplaints((list) => list.map((x) => (x.id === r.id ? r : x)));
  }

  async function addList(name: string): Promise<boolean> {
    const l = await run(api.addTaskList(name), "목록 이름이 비었거나 같은 이름의 목록이 있어요.");
    if (!l) return false;
    putList(l);
    return true;
  }

  // ---------- 그리기 ----------

  if (!data) {
    return (
      <>
        <h1 className="title">할 일 목록</h1>
        {note && <p className="note" role="status">{note}</p>}
      </>
    );
  }

  const remaining = data.lists.reduce((n, l) => n + openCount(itemsOf.get(l.id) ?? []), 0);
  const shown = data.lists.filter((l) => l.visible);

  async function renameList(l: TaskList, name: string): Promise<boolean> {
    const r = await run(api.renameTaskList(l.id, name), "목록 이름이 비었거나 같은 이름의 목록이 있어요.");
    if (r) putList(r);
    return !!r;
  }

  function moveList(l: TaskList, dir: number) {
    run(api.moveTaskList(l.id, dir)).then((r) => r && setData((d) => (d ? { ...d, lists: r } : d)));
  }

  async function deleteList(l: TaskList) {
    const n = await run(api.deleteTaskList(l.id));
    if (n === null) return;
    setData((d) => (d ? { lists: d.lists.filter((x) => x.id !== l.id), tasks: d.tasks.filter((t) => t.list !== l.id) } : d));
  }

  const menuList = cardMenu ? data.lists.find((l) => l.id === cardMenu.id) : undefined;

  // 제목 줄(제목·남은 일·검색)이 화면 맨 위 전체 폭이고, 그 아래 왼쪽에 목록, 오른쪽에 카드예요(2026-10-19 사용자).
  return (
    <div className="td-page">
      <div className="ct-head">
        <h1 className="title">할 일 목록</h1>
        <span className="td-summary">남은 일 {remaining}건</span>
        <label className="search">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" aria-label="할 일 검색" placeholder="할 일 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {note && <p className="note" role="status">{note}</p>}
      <div className="td-screen">
        <ListPanel
          lists={data.lists}
          counts={(id) => openCount(itemsOf.get(id) ?? [])}
          taskCount={(id) => data.tasks.filter((t) => t.list === id).length}
          onToggle={(l) => run(api.setTaskListVisible(l.id, !l.visible)).then((r) => r && putList(r))}
          onAdd={addList}
          onRename={renameList}
          onMove={moveList}
          onDelete={deleteList}
        />

        <div className="td-body">
          {shown.length ? (
            <div className="td-cards">
              {shown.map((l) => {
                const { open, done } = split(itemsOf.get(l.id) ?? [], lq);
                const doneOpen = openDone.has(l.id) || (!!lq && done.length > 0);
                const row = (it: Item, sub: boolean, inDone: boolean): ReactNode => (
                  <ItemRow
                    key={it.key}
                    it={it}
                    sub={sub}
                    inDone={inDone}
                    q={lq}
                    today={today}
                    urgentDays={urgentDays}
                    selected={sel === it.key}
                    flash={flash === it.key}
                    editing={!!it.task && editId === it.task.id}
                    onSelect={() => setSel((s) => (s === it.key ? null : it.key))}
                    onEdit={() => {
                      if (it.complaint) return onOpenComplaint?.(it.complaint.id);
                      if (it.task) {
                        setSel(it.key);
                        setEditId(it.task.id);
                      }
                    }}
                    onCheck={() => (it.task ? toggleTask(it.task) : it.complaint && toggleComplaint(it.complaint))}
                    onOpenComplaint={() => it.complaint && onOpenComplaint?.(it.complaint.id)}
                    onSub={() => it.task && setSubFor(it.task.id)}
                    onSave={(e) => (it.task ? saveTask(it.task.id, e) : Promise.resolve(false))}
                    onCancelEdit={() => setEditId(null)}
                    onRemove={() => it.task && removeTask(it.task.id)}
                  />
                );
                return (
                  <section key={l.id} className="td-card" aria-label={l.name}>
                    <div
                      className="td-card-head"
                      title="우클릭하면 목록 지우기"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        setCardMenu({ id: l.id, x: e.clientX || r.left + 16, y: e.clientY || r.bottom, mode: "menu" });
                      }}
                    >
                      <h2 className="td-card-name">{l.name}</h2>
                      {l.builtin && <span className="td-link-badge">민원대장 연동</span>}
                      <span className="td-card-count">{openCount(itemsOf.get(l.id) ?? [])}건</span>
                    </div>
                    <AddForm
                      open={addFor === l.id}
                      today={today}
                      placeholder="할 일 추가"
                      onOpen={() => setAddFor(l.id)}
                      onClose={() => setAddFor((a) => (a === l.id ? null : a))}
                      onAdd={(v) => addTask({ list: l.id, parent: null, ...v })}
                    />
                    <div className="td-items">
                      {open.map((it) => (
                        <div key={it.key} className="td-group">
                          {row(it, false, false)}
                          {it.children.map((c) => row(c, true, false))}
                          {it.task && subFor === it.task.id && (
                            <div className="td-subadd">
                              <AddForm
                                open
                                sub
                                today={today}
                                placeholder="하위 항목 제목"
                                onOpen={() => {}}
                                onClose={() => setSubFor(null)}
                                onAdd={(v) => addTask({ list: l.id, parent: it.task!.id, ...v })}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {!open.length && <p className="td-empty">{lq ? "찾는 일이 없어요." : "남은 일이 없어요."}</p>}
                    </div>
                    {done.length > 0 && (
                      <div className="td-done">
                        <button
                          type="button"
                          className="td-done-toggle"
                          aria-expanded={doneOpen}
                          onClick={() =>
                            setOpenDone((s) => {
                              const n = new Set(s);
                              if (n.has(l.id)) n.delete(l.id);
                              else n.add(l.id);
                              return n;
                            })
                          }
                        >
                          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: doneOpen ? "rotate(90deg)" : undefined }}>
                            <path d="M9 5l7 7-7 7" />
                          </svg>
                          완료됨 ({done.reduce((n, it) => n + 1 + it.children.length, 0)}개)
                        </button>
                        {doneOpen && (
                          <div className="td-done-list">
                            {done.map((it) => (
                              <div key={it.key} className="td-group">
                                {row(it, !!it.task?.parent, true)}
                                {it.children.map((c) => row(c, true, true))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <p className="muted small">보이는 목록이 없어요. 왼쪽에서 목록을 체크하면 카드가 나와요.</p>
          )}
        </div>
      </div>
      {cardMenu && menuList && (
        <ListMenu
          {...cardMenu}
          list={menuList}
          count={data.tasks.filter((t) => t.list === menuList.id).length}
          first
          last
          deleteOnly
          onMode={(mode) => setCardMenu({ ...cardMenu, mode })}
          onClose={() => setCardMenu(null)}
          onMove={() => {}}
          onRename={() => {}}
          onDelete={() => {
            setCardMenu(null);
            deleteList(menuList);
          }}
        />
      )}
    </div>
  );
}

// ---------- 왼쪽 목록 ----------

function ListPanel({
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

/** 목록 우클릭 메뉴. 지우기는 딸린 할 일 수를 알려 주고 한 번 더 물어요. Esc나 바깥을 누르면 닫혀요. */
function ListMenu({
  list,
  x,
  y,
  mode,
  count,
  first,
  last,
  onMode,
  onClose,
  onMove,
  onRename,
  onDelete,
  deleteOnly,
}: {
  list: TaskList;
  x: number;
  y: number;
  mode: "menu" | "rename" | "ask";
  count: number;
  first: boolean;
  last: boolean;
  onMode: (m: "menu" | "rename" | "ask") => void;
  onClose: () => void;
  onMove: (dir: number) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** 카드 제목 줄 우클릭: 지우기만 보여요 */
  deleteOnly?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(list.name);
  useOutsideClose(true, [box], () => onClose(), {
    onEsc: (e) => {
      e.preventDefault();
      onClose();
    },
  });
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(mode === "rename" ? "input" : mode === "ask" ? ".dmenu-ask .btn" : ".dmenu-item:not(:disabled)");
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }, [mode]);

  const style = { left: Math.min(x, window.innerWidth - 300), top: Math.min(y, window.innerHeight - 200) };
  return (
    <div ref={box} className="dmenu" role="menu" aria-label={`${list.name} 목록 메뉴`} style={style}>
      {mode === "menu" && (
        <>
          {!deleteOnly && (
            <>
              {!list.builtin && (
                <button type="button" role="menuitem" className="dmenu-item" onClick={() => onMode("rename")}>
                  이름 바꾸기
                </button>
              )}
              <button type="button" role="menuitem" className="dmenu-item" disabled={first} onClick={() => onMove(-1)}>
                위로 옮기기
              </button>
              <button type="button" role="menuitem" className="dmenu-item" disabled={last} onClick={() => onMove(1)}>
                아래로 옮기기
              </button>
            </>
          )}
          {list.builtin ? (
            <span className="dmenu-note">{deleteOnly ? "민원 목록은 지울 수 없어요." : "민원 목록은 지우거나 이름을 바꿀 수 없어요."}</span>
          ) : (
            <button type="button" role="menuitem" className="dmenu-item danger" onClick={() => onMode("ask")}>
              목록 지우기
            </button>
          )}
        </>
      )}
      {mode === "rename" && (
        <div className="td-rename">
          <input
            className="cell-input"
            aria-label="목록 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (isComposing(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                onRename(name);
              }
            }}
          />
          <button type="button" className="btn-primary btn-xs" onClick={() => onRename(name)}>
            바꾸기
          </button>
        </div>
      )}
      {mode === "ask" && (
        <div className="ask-band dmenu-ask" role="alertdialog" aria-label="목록 지우기 확인">
          <span>
            {count ? `할 일 ${count}건이 들어 있어요. 목록과 함께 모두 지울까요?` : `"${list.name}" 목록을 지울까요?`} 되돌릴 수 없어요.
          </span>
          <button type="button" className="btn btn-xs" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-xs btn-danger" onClick={onDelete}>
            지우기
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- 신규 입력 ----------

type Draft = { title: string; detail: string; due: string };

/**
 * 카드 맨 위 "할 일 추가" (sub이면 하위 항목 입력).
 * 제목을 누르면 세부정보·날짜 칸이 펼쳐져요. Tab·Enter 다음 칸, 날짜 칸에서 Enter·Tab 등록, Esc 닫기.
 */
function AddForm({
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
        <input
          ref={input}
          name="due"
          inputMode="numeric"
          className={"fld td-due-input" + (bad ? " invalid" : "")}
          aria-label="마감일"
          aria-invalid={bad || undefined}
          placeholder="날짜 1016"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            // 칸을 떠날 때 8자리로 바꿔 쓰고, 읽을 수 없으면 친 그대로 두고 빨간 테두리(공통 규칙).
            if (!value.trim()) return;
            const d = parseDate(value);
            if (d) onChange(d);
            else onInvalid();
          }}
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

function MiniCal({ value, today, onPick, onClose }: { value: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const base = value || today;
  const [ym, setYm] = useState<[number, number]>([Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1]);
  const first = new Date(ym[0], ym[1], 1);
  const dim = new Date(ym[0], ym[1] + 1, 0).getDate();
  const move = (n: number) => {
    const d = new Date(ym[0], ym[1] + n, 1);
    setYm([d.getFullYear(), d.getMonth()]);
  };
  const cells: ReactNode[] = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(<span key={"e" + i} />);
  for (let n = 1; n <= dim; n++) {
    const key = todayStr(new Date(ym[0], ym[1], n));
    const dow = (first.getDay() + n - 1) % 7;
    cells.push(
      <button
        key={key}
        type="button"
        tabIndex={-1}
        className={"td-cal-day" + (key === value ? " sel" : "") + (key === today ? " today" : "") + (dow === 0 ? " sun" : dow === 6 ? " sat" : "")}
        aria-label={key}
        aria-pressed={key === value}
        onClick={() => onPick(key)}
      >
        {n}
      </button>,
    );
  }
  return (
    <div className="td-cal" role="dialog" aria-label="날짜 고르기" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}>
      <div className="td-cal-head">
        <span className="td-cal-title">
          {ym[0]}년 {ym[1] + 1}월
        </span>
        <button type="button" tabIndex={-1} className="td-cal-nav" aria-label="이전 달" onClick={() => move(-1)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <button type="button" tabIndex={-1} className="td-cal-nav" aria-label="다음 달" onClick={() => move(1)}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      <div className="td-cal-week">
        <span className="sun">일</span>
        <span>월</span>
        <span>화</span>
        <span>수</span>
        <span>목</span>
        <span>금</span>
        <span className="sat">토</span>
      </div>
      <div className="td-cal-grid">{cells}</div>
    </div>
  );
}

// ---------- 항목 한 줄 ----------

function ItemRow({
  it,
  sub,
  inDone,
  q,
  today,
  urgentDays,
  selected,
  flash,
  editing,
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

  return (
    <div
      ref={rowRef}
      data-key={it.key}
      tabIndex={0}
      aria-selected={selected}
      className={"td-row" + (sub ? " sub" : "") + (inDone ? " done" : "") + (selected ? " sel" : "") + (flash ? " flash" : "")}
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
        className={"td-check" + (it.done ? " on" : "") + (c ? " linked" : "")}
        aria-pressed={it.done}
        aria-label={c ? (it.done ? "답변 취소 (민원대장 상태를 되돌려요)" : "답변으로 표시 (민원대장 상태가 답변으로 바뀌어요)") : it.done ? "완료 취소" : "완료로 표시"}
        title={c ? (it.done ? "체크를 풀면 민원대장의 상태를 그 전으로 되돌려요" : "체크하면 민원대장의 상태가 답변으로 바뀌어요") : undefined}
        onClick={onCheck}
      >
        {it.done && <Tick />}
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
                  <div ref={askRef} className="ask-band td-ask" role="alertdialog" aria-label="할 일 지우기 확인">
                    <span>{childCount && t && !t.parent ? `하위 항목 ${childCount}개도 함께 지워져요. 지울까요?` : "이 할 일을 지울까요?"}</span>
                    <button type="button" className="btn btn-xs" autoFocus onClick={() => setAsking(false)}>
                      취소
                    </button>
                    <button type="button" className="btn btn-xs btn-danger" onClick={onRemove}>
                      지우기
                    </button>
                  </div>
                ) : (
                  <button type="button" className="tool-box" aria-label="이 할 일 지우기" title="이 할 일 지우기" onClick={() => setAsking(true)}>
                    <DelIcon />
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

// ---------- 고치기 ----------

/** 그 자리에서 고치기. Tab·Enter 다음 칸, 마지막 칸(날짜)이면 저장, Esc 취소, 바깥을 누르면 저장. 휴지통은 저장·취소와 떨어져 있어요. */
function TaskEditor({
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
            <div ref={askRef} className="ask-band td-ask" role="alertdialog" aria-label="할 일 지우기 확인">
              <span>이 할 일을 지울까요?</span>
              <button type="button" className="btn btn-xs" autoFocus onClick={() => setAsking(false)}>
                취소
              </button>
              <button type="button" className="btn btn-xs btn-danger" onClick={onRemove}>
                지우기
              </button>
            </div>
          ) : (
            <button ref={trashRef} type="button" tabIndex={-1} className="tool-box" aria-label="이 할 일 지우기" title="이 할 일 지우기" onClick={() => setAsking(true)}>
              <DelIcon />
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

// ---------- 아이콘 ----------

function Tick() {
  return (
    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function Plus({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

