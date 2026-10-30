// 할 일 목록 (7단계). 목록마다 카드 하나예요(구글 할 일과 같은 구성). 시안: Todo.dc.html, 사양서 "할 일 목록".
// - 왼쪽: 목록 체크(카드 보이기·숨기기), 우클릭 메뉴(이름 바꾸기·옮기기·지우기), 새 목록 만들기.
// - 카드 맨 위 "할 일 추가"를 누르면 세부정보·날짜 칸이 펼쳐져요. 세부정보는 여러 줄 칸(엔터규칙), 마지막 칸(날짜)에서 Enter·Tab 등록.
// - 항목을 한 번 누르면 골라지고 세부정보가 펼쳐져요. 두 번 누르면(또는 골라 둔 채 Enter) 고쳐요. 삭제는 "지울까요?"를 물어요.
// - "민원" 카드에는 민원대장의 민원(마감일 있는 것)이 함께 보여요. 따로 저장하지 않고 민원을 그대로 읽어요.
//   체크하면 민원대장의 상태가 완료로 바뀌고, 체크를 풀면 그 전 상태로 돌아가요. 제목·마감일은 민원대장에서만 고쳐요.
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { REMOTE_CHANGE } from "../../google";
import { api, Complaint, errorText, Task, TaskEdit, TaskInput, TaskList, TasksData } from "../../api";
import { todayStr } from "../../journal";
import { ANSWER_STATUS, DEFAULT_SETTINGS, isAnswered, loadSettings } from "../../settingsStore";
import { complaintItems, Item, openCount, split, treeOf } from "../../tasks";
import { SearchBox } from "../../SearchBox";
import { ItemRow, ListPanel } from "./Table";
import { ListMenu } from "./Menu";
import { AddForm } from "./Dialogs";


/** 체크 움직임 시간(ms) – styles/*.css `.td-check.pop`의 td-check-pop과 같게 */
const CHECK_MS = 400;


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
  /**
   * 방금 직접 눌러 체크한 항목(key). 체크 움직임(약 0.4초) 동안 남은 일 자리에 두고, 끝나면 지워 "완료됨"으로 내려가요.
   * 저장은 누르자마자 해요 – 이 값은 화면만 바꿔요(2026-10-25 할 일 ①~④ 1안, 시안 Todo.dc.html).
   */
  const [justDone, setJustDone] = useState<string | null>(null);
  const justTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(justTimer.current), []);

  useEffect(() => {
    // 열 때 읽기 셋을 모아 한 번에 그려요(2026-10-30 속도 ① – 민원대장과 같은 방식). 하나가 실패해도 나머지는 지금처럼.
    let alive = true;
    const ok = <T,>(p: Promise<T>) => p.then((v) => ({ v }), (e: unknown) => ({ e }));
    void Promise.all([ok(api.tasksData()), ok(api.complaints()), ok(loadSettings())]).then(([d, cs, s]) => {
      if (!alive) return;
      if ("v" in cs) setComplaints(cs.v);
      if ("v" in s) setStatuses(s.v.status);
      if ("v" in d) setData(d.v);
      else setNote(errorText(d.e));
    });
    // 구글 할 일에서 체크한 것이 들어오면 다시 읽어요.
    const reload = () => {
      api.tasksData().then(setData, () => {});
      api.complaints().then(setComplaints, () => {});
    };
    window.addEventListener(REMOTE_CHANGE, reload);
    return () => {
      alive = false;
      window.removeEventListener(REMOTE_CHANGE, reload);
    };
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

  async function toggleTask(t: Task): Promise<boolean> {
    const r = await run(api.setTaskDone(t.id, !t.done, todayStr()));
    if (r) putTasks(r);
    return !!r;
  }

  /**
   * 체크 상자를 눌렀을 때(마우스·Space 같아요). 체크하는 쪽이면 움직임을 켜고, 저장이 끝나고 움직임 시간이 지나면 내려보내요.
   * 체크를 푸는 쪽·움직임 줄이기 설정이면 움직임 없이 바로 바뀌어요.
   */
  function check(it: Item) {
    const save = () => (it.task ? toggleTask(it.task) : it.complaint ? toggleComplaint(it.complaint) : Promise.resolve(false));
    if (it.done || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      void save();
      return;
    }
    const started = Date.now();
    window.clearTimeout(justTimer.current);
    setJustDone(it.key);
    const clear = () => setJustDone((k) => (k === it.key ? null : k));
    void save().then((ok) => {
      if (!ok) return clear();
      justTimer.current = window.setTimeout(clear, Math.max(0, CHECK_MS - (Date.now() - started)));
    });
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
  async function toggleComplaint(c: Complaint): Promise<boolean> {
    let next: string;
    if (isAnswered(c.status)) {
      next = prevStatus.current.get(c.id) ?? statuses.find((s) => !isAnswered(s)) ?? "접수";
    } else {
      prevStatus.current.set(c.id, c.status);
      next = ANSWER_STATUS;
    }
    const r = await run(api.setComplaintStatus(c.id, next));
    if (r) setComplaints((list) => list.map((x) => (x.id === r.id ? r : x)));
    return !!r;
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
        <SearchBox aria-label="할 일 검색" placeholder="할 일 검색" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} />
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
                const { open, done } = split(itemsOf.get(l.id) ?? [], lq, justDone);
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
                    pop={justDone === it.key}
                    onCheck={() => check(it)}
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
