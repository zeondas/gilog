// 화면에서 저장 쪽(Rust)을 부르는 곳이에요.
// 앱(Tauri)에서는 Rust 명령을, 앱 밖(브라우저 미리 보기)에서는 같은 이름으로 미리 보기 저장 모듈(previewCore – 브라우저용 core)을 불러요.
// 규칙은 Rust core 한 벌이에요(2026-10-30 품질 보완 ②-3 2차 – 전엔 여기에 흉내가 따로 있었어요).
import { invoke } from "@tauri-apps/api/core";
import type { RoadLookup } from "./address";
import type { BudgetLevel, BudgetProject, BudgetRowInput } from "./budget";
import type { GridSheet, ImportProject } from "./budgetExcel";
import type { BStatusExport } from "./budgetStatus";
import type { ShareOp } from "./budgetShare";
import { previewCall } from "./previewCore";

export type Status = { exists: boolean; unlocked: boolean; folder: string };
/** 자동 백업(하루 하나, 최근 7개) – 잠겨 있어도 읽어요. latest는 YYYY-MM-DD */
export type BackupInfo = { folder: string; count: number; latest: string | null; latestPath: string | null };

/** 강조색 네 가지. 보라가 기본이에요(tokens.css에 묶음 없음). */
export type Accent = "purple" | "noctua" | "blue" | "ink";
export const ACCENTS: { id: Accent; name: string }[] = [
  { id: "purple", name: "보라" },
  { id: "noctua", name: "녹투아 브라운" },
  { id: "blue", name: "파랑" },
  { id: "ink", name: "먹색" },
];

/** 강조색을 화면 전체에 적용해요(tokens.css의 :root[data-accent] 묶음). */
export function applyAccent(accent: string | undefined) {
  const root = document.documentElement;
  if (accent && accent !== "purple" && ACCENTS.some((a) => a.id === accent)) root.dataset.accent = accent;
  else delete root.dataset.accent;
}

/** 비밀번호 없이도 읽는 앱 설정이에요. */
export type Prefs = {
  dataDir: string;
  theme: "system" | "light" | "dark";
  /** 강조색(2026-10-18 색 테마). 없으면 보라 */
  accent: Accent;
  startScreen: string;
  fontSize: number;
  urgentDays: number;
  askPassword: boolean;
  autoLock: boolean;
  autoLockMin: number;
  /** 사이드바 접힘 */
  sideCollapsed: boolean;
  /** 창 닫기(X) 단추 – 작업표시줄로 / 트레이로(처음 값) / 묻고 끝내기 */
  closeAction: CloseAction;
  /** 윈도우 시작할 때 자동 실행(2026-10-19). 앱이 켤 때 레지스트리 실제 상태로 맞춰 돌려줘요. 미리 보기는 흉내만 */
  autoStart: boolean;
};

export type CloseAction = "minimize" | "tray" | "quit";

export const DEFAULT_PREFS: Prefs = {
  dataDir: "",
  theme: "system",
  accent: "purple",
  startScreen: "journal",
  fontSize: 13,
  urgentDays: 2,
  askPassword: true,
  autoLock: true,
  autoLockMin: 10,
  sideCollapsed: false,
  closeAction: "tray",
  autoStart: false,
};

/** 저장 쪽이 돌려주는 실패 이름이에요. */
export type ErrorCode =
  | "wrong_password"
  | "already_exists"
  | "not_found"
  | "password_too_short"
  | "locked"
  | "keyring"
  | "autostart"
  | "io"
  | "db"
  | "meta"
  | "invalid"
  | "offline"
  | "corrupt"
  | "too_new"
  | "prefs_bad"
  | "hello_unavailable"
  | "hello_canceled"
  | "hello_failed"
  | "pin_stale"
  | "pin_off";

/** 윈도우 PIN으로 잠금 풀기 상태(이 PC만). */
export type PinStatus = { available: boolean; on: boolean };

// ---------- 업무연락처 ----------

export type ContactInput = {
  name: string;
  org: string;
  role: string;
  mobile: string;
  tel: string;
  email: string;
  /** 프로젝트 이름들. 없는 이름은 새로 만들어져요. */
  projects: string[];
};

export type Contact = Omit<ContactInput, "projects"> & {
  id: number;
  /** 메모(JSON 글자). 비어 있으면 메모가 없어요. */
  memo: string;
  /** 붙은 프로젝트 번호 */
  projects: number[];
};

/** color가 null이면 자동 색이에요. */
/** name = 정식 이름(문서용, 줄인 이름만 적었으면 줄인 이름), alias = 줄인 이름(관리용, 없으면 ""). */
export type Project = { id: number; name: string; alias: string; color: number | null; group: number | null };
export type ProjectGroup = { id: number; name: string };

export type ContactsData = { contacts: Contact[]; projects: Project[]; groups: ProjectGroup[] };

// ---------- 업무일지 ----------

/** 대화 한 줄. me가 참이면 내가 한 말이에요. */
export type JournalLine = { who: string; me: boolean; text: string };

export type EntryInput = {
  /** 2026-10-15 */
  date: string;
  /** 09:10 */
  time: string;
  kind: string;
  /** 상대 (적은 글자 그대로, 여러 명은 쉼표) */
  who: string;
  /** 연락처 (번호나 메일) */
  contact: string;
  /** 업무연락처의 프로젝트 번호 */
  project: number | null;
  lines: JournalLine[];
  /** 메모 본문(편집기 HTML). 구분이 "메모"인 기록은 말 줄 대신 이것을 써요. */
  body: string;
};

export type Entry = EntryInput & { id: number };

/** 날짜마다 하나 있는 머리 줄 */
export type DayInfo = { date: string; arrive: string; transport: string; weather: string; note: string };

export type JournalData = { days: DayInfo[]; entries: Entry[] };

// ---------- 민원대장 ----------

export type ComplaintInput = {
  /** 접수유형 */
  intake: string;
  /** 접수일 2026-10-15 */
  received: string;
  /** 민원유형 */
  ctype: string;
  /** 지역 */
  area: string;
  /** 위치 */
  place: string;
  /** 민원인 */
  person: string;
  /** 연락처 */
  phone: string;
  /** 내용 (여러 줄, 줄바꿈으로 나눠요) */
  body: string;
  /** 조치내용 (여러 줄) */
  action: string;
  /** 마감일. 비어 있으면 마감이 없어요. */
  due: string;
  status: string;
  /** 조치완료일 2026-10-19. 비어 있으면 아직이에요(완료·불가가 되면 오늘 날짜가 들어가고 고칠 수 있어요). */
  done?: string;
  /** 위치를 도로명주소에서 바꿨으면 바꾸기 전 글(마우스를 올리면 보여요). 직접 친 위치면 비어요. */
  road?: string;
};

export type Complaint = ComplaintInput & {
  id: number;
  /** 연번 */
  no: number;
  /** 메모(JSON 글자). 비어 있으면 메모가 없어요. */
  memo: string;
};

// ---------- 할 일 목록 ----------

export type TaskList = {
  id: number;
  name: string;
  /** 체크를 끄면 카드를 숨겨요. */
  visible: boolean;
  /** 처음부터 있는 목록(민원). 지우거나 이름을 바꿀 수 없어요. */
  builtin: boolean;
  ord: number;
};

export type TaskInput = {
  list: number;
  /** 위 항목. 있으면 하위 항목이에요(한 단계까지). */
  parent: number | null;
  title: string;
  /** 세부정보 (머릿기호 줄 목록 JSON) */
  detail: string;
  /** 마감일. 비어 있으면 마감이 없어요. */
  due: string;
};

export type TaskEdit = { title: string; detail: string; due: string };

export type Task = TaskInput & {
  id: number;
  done: boolean;
  /** 완료한 날. 완료가 아니면 비어 있어요. */
  doneOn: string;
};

export type TasksData = { lists: TaskList[]; tasks: Task[] };

// ---------- 캘린더 ----------

/** 캘린더 종류. system은 앱이 만든 종류("complaint"·"task"·"holiday")이고 내 종류는 빈 글자예요. */
export type CalKind = {
  id: number;
  name: string;
  /** 구글 24색 가운데 번호(0~23). null이면 자동 색이에요(내 종류만). */
  color: number | null;
  visible: boolean;
  system: "" | "complaint" | "task" | "holiday";
  ord: number;
};

/** 반복 규칙. 빈 글자는 반복 안 함이에요. */
export type Repeat = "" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";

export type EventInput = {
  title: string;
  /** 종류 이름. 없는 이름이면 새 종류가 만들어져요. */
  kind: string;
  date: string;
  /** 끝 날짜 (비어 있으면 시작 날짜) */
  end: string;
  allDay: boolean;
  time: string;
  endTime: string;
  repeat: Repeat;
  /** 반복 종료일 (반복이면 꼭 있어야 해요) */
  until: string;
  place: string;
  /** 설명 (머릿기호 줄 목록 JSON) */
  desc: string;
  /** 알림(분 전): -1 없음, 0 정시, 1440 하루 전, 10080 7일 전, 43200 한 달 전, 그 밖에 직접 설정한 값 */
  remind: number;
  /** 종일 일정의 알림 시각 09:00 (비우면 9시). 시간 일정은 비어 있어요. */
  remindTime: string;
};

export type CalEvent = Omit<EventInput, "kind"> & { id: number; kind: number };

export type Holiday = { date: string; name: string };

export type CalendarData = { kinds: CalKind[]; events: CalEvent[]; holidays: Holiday[]; holidaysAt: string };

/** 알림이 실제로 뜨는지 보는 상태 (시험 단추) */
export type NotifyStatus = { pending: number; nextAt: number; shown: number; lastError: string; via: string };

/** 알림 한 건. at은 울릴 때(밀리초)예요. */
export type Reminder = { at: number; title: string; body: string; event: number; date: string };

// ---------- 민원처리(10단계) – core/process.rs와 같은 모양 ----------

export type WorkInput = {
  /** 축약 공사명(표의 공사 배지, 지시부 {축약 공사명}) */
  name: string;
  /** 정식 공사명(지시부 {공사명}) – 비우면 축약 공사명 */
  full: string;
  /** 시공사 */
  co: string;
  /** 현장대리인 = 업무연락처 번호 */
  contact: number | null;
  /** 업무연락처 프로젝트 번호(공사명과 같은 이름) */
  project: number | null;
  /** 처리 범위(AI의 판단 기준) */
  scope: string;
  nextSeq: number;
  /** 예전 공사별 양식(2026-10-19부터 쓰지 않아요 – 표준 양식 하나) */
  tpl: string;
};
export type Work = WorkInput & { id: number };

/** new 지시부 전 · made 지시부 만듦 · queued 보낼 폴더에 넣음(Claude가 올리기 전) · sent 전송 완료 */
export type Stage = "new" | "made" | "queued" | "sent";

export type Case = {
  /** 접수번호 */
  no: string;
  received: string;
  due: string;
  area: string;
  place: string;
  summary: string;
  /** 보수내용 짧은 말(파일 이름) */
  short: string;
  reason: string;
  work: number | null;
  note: string;
  /** 비우면 공사의 다음 연번 */
  seq: string;
  stage: Stage;
  complaint: number | null;
  photos: string[];
  map: string;
  folder: string;
  orderFile: string;
  orderJpg: string;
  /** 보낼 폴더에 넣은 JPG */
  outboxFile: string;
  sentAt: string;
  /** 신문고 위치가 도로명주소라 바꿨으면 바꾸기 전 글 */
  road: string;
  /** 든 지시부와 그 안의 항목 번호(1부터) */
  order: number | null;
  item: number;
};

/** 지시부 하나(같은 공사 민원 여러 건, 표준 양식) */
export type Order = {
  id: number;
  work: number;
  seq: number;
  /** 지시일 YYYY-MM-DD */
  date: string;
  file: string;
  /** 쪽마다 JPG */
  jpgs: string[];
  stage: "made" | "queued" | "sent";
  outbox: string[];
  sentAt: string;
  /** 든 민원을 고쳐 다시 만들어야 해요 */
  dirty: boolean;
  /** 메일로 보낸 받는 사람 주소(2026-10-20 지시부 메일 – 보내지 않았으면 없거나 "") */
  mailTo?: string;
  /** 메일로 보낸 때 "YYYY-MM-DD HH:MM" */
  mailedAt?: string;
  /** 보낸 메일 제목(보낸 증거 카드) */
  mailSubject?: string;
  /** 보낸메일함에서 같은 제목을 찾았는지 – false면 "확인 필요"(2026-10-20 진행 막대) */
  mailOk?: boolean;
};

export type CasePatch = Partial<Pick<Case, "work" | "area" | "place" | "road" | "note" | "short" | "seq" | "stage" | "complaint" | "folder" | "orderFile" | "orderJpg" | "outboxFile" | "sentAt" | "photos">>;
/** AI가 고른 현장사진(pick = 받은 목록 안의 경로) */
export type PhotoPick = { no: string; pick: string; reason: string };
export type ProcessData = { works: Work[]; cases: Case[]; orders: Order[] };
/** held: 첨부가 아직 안 내려와 다음 번으로 미룬 파일 수(hold일 때만, 2026-10-21 신속 자동화) */
export type InboxResult = { added: Case[]; skipped: number; failed: string[]; missingFiles: string[]; held: number };
export type RunStatus = { state: "idle" | "running" | "done" | "login" | "stopped" | "error"; total: number | null; done: number | null; message: string; log: string; skipped: string[]; skipCount?: number | null };
export type OrderResult = { order: Order; cases: Case[]; works: Work[]; missing: string[]; /** 현장사진 없이 들어간 접수번호 */ noPhoto?: string[] };

/** 내장 도로명주소 표 정보 */
export type RoadTableInfo = { count: number; date: string; custom: boolean };
export const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 미리 보기 전용: 가져올 폴더에 보기 민원을 넣어요(Claude 실행 흉내가 하나씩 놓아요). 앱에서는 아무것도 안 해요. */
export function previewInbox(list: Partial<Case>[]) {
  if (!inApp) previewCall("preview_inbox", { list }).catch(() => {});
}

/** 자료를 바꾼 명령이 성공하면 알려 줄 곳(구글 연동이 바뀐 것을 내보내요). */
/** 설정 "자료 지우기"(2026-10-30 설정 ✔1) – core clear.rs */
export type ClearWhat = "complaints" | "contacts" | "journal" | "tasks" | "events" | "budget" | "bstatus" | "all";
export type ClearCounts = {
  complaints: number;
  cases: number;
  contacts: number;
  projects: number;
  entries: number;
  days: number;
  tasks: number;
  lists: number;
  events: number;
  budgetYearProjects: number;
  budgetYearRows: number;
  budgetProjects: number;
  budgetRows: number;
  bstatus: number;
};
export type Cleared = { n: number; backup: string | null };

export const changeHooks = new Set<(cmd: string) => void>();

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = inApp ? await invoke<T>(cmd, args) : ((await previewCall(cmd, args)) as T);
  for (const f of changeHooks) f(cmd);
  return r;
}

export const api = {
  getPrefs: () => call<Prefs>("get_prefs"),
  setPrefs: (prefs: Prefs) => call<null>("set_prefs", { prefs }),
  status: () => call<Status>("status"),
  autoUnlock: () => call<boolean>("auto_unlock"),
  create: (password: string) => call<null>("create_store", { password }),
  unlock: (password: string) => call<null>("unlock", { password }),
  lock: () => call<null>("lock"),
  changePassword: (oldPassword: string, newPassword: string) =>
    call<null>("change_password", { oldPassword, newPassword }),
  get: (key: string) => call<string | null>("get_value", { key }),
  set: (key: string, value: string) => call<null>("set_value", { key, value }),
  /** 민원처리 Claude 실행 파일 자리 – 설정 저장(`set`)으로는 못 바꿔요(②-2 ✔2) */
  setProcessExe: (exe: string) => call<null>("set_process_exe", { exe }),
  exportBackup: (path: string) => call<null>("export_backup", { path }),
  importBackup: (path: string, password: string) => call<null>("import_backup", { path, password }),
  moveData: (folder: string) => call<null>("move_data", { folder }),
  backupInfo: () => call<BackupInfo>("backup_info"),
  openBackupFolder: () => call<null>("open_backup_folder"),
  /** 잠금 화면: 손상된 자료를 백업으로 되살리고 바로 열어요(손상된 파일은 옆에 남겨요). */
  restoreAndOpen: (path: string, password: string) => call<null>("restore_and_open", { path, password }),
  pinStatus: () => call<PinStatus>("pin_status"),
  pinEnable: (password: string) => call<null>("pin_enable", { password }),
  pinDisable: () => call<null>("pin_disable"),
  pinUnlock: () => call<null>("pin_unlock"),
  pinRekey: (password: string) => call<null>("pin_rekey", { password }),

  contactsData: () => call<ContactsData>("contacts_data"),
  addContact: (contact: ContactInput) => call<ContactsData>("add_contact", { contact }),
  updateContact: (id: number, contact: ContactInput) => call<ContactsData>("update_contact", { id, contact }),
  setContactMemo: (id: number, memo: string) => call<ContactsData>("set_contact_memo", { id, memo }),
  deleteContact: (id: number) => call<ContactsData>("delete_contact", { id }),
  addProject: (name: string) => call<ContactsData>("add_project", { name }),
  renameProject: (id: number, name: string) => call<ContactsData>("rename_project", { id, name }),
  /** 정식 이름·줄인 이름을 함께 정해요. 둘 중 하나만 있어도 돼요. */
  setProjectNames: (id: number, name: string, alias: string) => call<ContactsData>("set_project_names", { id, name, alias }),
  addProjectGroup: (name: string) => call<ContactsData>("add_project_group", { name }),
  renameProjectGroup: (id: number, name: string) => call<ContactsData>("rename_project_group", { id, name }),
  deleteProjectGroup: (id: number) => call<ContactsData>("delete_project_group", { id }),
  moveProjectGroup: (id: number, dir: number) => call<ContactsData>("move_project_group", { id, dir }),
  setProjectGroup: (id: number, group: string) => call<ContactsData>("set_project_group", { id, group }),
  setProjectColor: (id: number, color: number | null) => call<ContactsData>("set_project_color", { id, color }),
  deleteProject: (id: number) => call<ContactsData>("delete_project", { id }),

  journalData: () => call<JournalData>("journal_data"),
  addEntry: (entry: EntryInput) => call<Entry>("add_journal_entry", { entry }),
  updateEntry: (id: number, entry: EntryInput) => call<Entry>("update_journal_entry", { id, entry }),
  deleteEntry: (id: number) => call<null>("delete_journal_entry", { id }),
  setDay: (day: DayInfo) => call<DayInfo>("set_journal_day", { day }),
  /** 그 날의 기록과 머리 줄을 모두 지워요. 지운 기록 수를 돌려줘요. */
  deleteDay: (date: string) => call<number>("delete_journal_day", { date }),
  /** 엑셀 가져오기 "대체하기" – 모든 기록·날짜 머리 줄을 지워요(공통 ✔5) */
  clearJournal: () => call<number>("clear_journal"),
  /** 설정 "자료 지우기": 화면마다 지금 건수(year = 집행현황 "그 해만"의 해) */
  clearCounts: (year: number) => call<ClearCounts>("clear_counts", { year }),
  /** 설정 "자료 지우기": 지우기 전 백업을 남기고 지워요(year는 집행현황만 – null이면 모든 해). 미리 보기는 백업 없음. */
  clearData: (what: ClearWhat, year: number | null = null) => call<Cleared>("clear_data", { what, year }),

  complaints: () => call<Complaint[]>("complaints"),
  /** 위치 글이 파주시 도로명주소면 법정동 지번으로 (core address.rs) */
  roadToJibun: (text: string): Promise<RoadLookup> => (inApp ? invoke<RoadLookup>("road_to_jibun", { text }) : (previewCall("road_to_jibun", { text }) as Promise<RoadLookup>)),
  /** 내장 도로명주소 표: 곳 수·자료 날짜·바꾼 표인지 (주소 변환 웹 2026-10-21) */
  roadTableInfo: (): Promise<RoadTableInfo> => (inApp ? invoke<RoadTableInfo>("road_table_info") : (previewCall("road_table_info", {}) as Promise<RoadTableInfo>)),
  /** 경기도 전체자료 파일로 표를 바꿔요(파주시 줄만). 실패 "few:N"·"io" */
  roadTableImport: (path: string): Promise<RoadTableInfo> =>
    inApp ? invoke<RoadTableInfo>("road_table_import", { path }) : (previewCall("road_table_import", { path }) as Promise<RoadTableInfo>),
  roadTableReset: (): Promise<RoadTableInfo> => (inApp ? invoke<RoadTableInfo>("road_table_reset") : (previewCall("road_table_reset", {}) as Promise<RoadTableInfo>)),
  addComplaint: (complaint: ComplaintInput) => call<Complaint>("add_complaint", { complaint }),
  updateComplaint: (id: number, complaint: ComplaintInput) => call<Complaint>("update_complaint", { id, complaint }),
  /** done을 주면 조치완료일도 함께 바꿔요(민원대장 배지). 주지 않으면 그대로예요(캘린더·할 일 체크). */
  setComplaintStatus: (id: number, status: string, done?: string) =>
    call<Complaint>("set_complaint_status", done === undefined ? { id, status } : { id, status, done }),
  setComplaintMemo: (id: number, memo: string) => call<Complaint>("set_complaint_memo", { id, memo }),
  deleteComplaint: (id: number) => call<null>("delete_complaint", { id }),
  /** 분류 합치기(✔1): 접수유형·민원유형이 from인 민원을 to로 – 바뀐 뒤 전체 민원(연번이 다시 매겨져요) */
  replaceComplaintField: (field: "intake" | "ctype", from: string, to: string) => call<Complaint[]>("replace_complaint_field", { field, from, to }),
  processData: () => call<ProcessData>("process_data"),

  // 집행현황(12단계) – 바꾸는 명령은 그 해 전체를 돌려줘요.
  budgetData: (year: number) => call<BudgetProject[]>("budget_data", { year }),
  saveBudgetProject: (year: number, id: number | null, after: number | null, name: string, budget: number | null) =>
    call<BudgetProject[]>("save_budget_project", { year, id, after, name, budget }),
  saveBudgetItem: (project: number, id: number | null, name: string, budget: number | null) => call<BudgetProject[]>("save_budget_item", { project, id, name, budget }),
  /** 바뀐 해와 그 공사 번호 */
  saveBudgetRow: (item: number, id: number | null, row: BudgetRowInput) => call<[BudgetProject[], number]>("save_budget_row", { item, id, row }),
  setBudgetStage: (id: number, stage: string) => call<BudgetProject[]>("set_budget_stage", { id, stage }),
  setBudgetMemo: (level: BudgetLevel, id: number, memo: string) => call<BudgetProject[]>("set_budget_memo", { level, id, memo }),
  setBudgetOpen: (level: BudgetLevel, id: number, open: boolean, all = false) => call<BudgetProject[]>("set_budget_open", { level, id, open, all }),
  moveBudget: (level: BudgetLevel, id: number, dir: number) => call<BudgetProject[]>("move_budget", { level, id, dir }),
  moveBudgetItem: (id: number, to: number) => call<BudgetProject[]>("move_budget_item", { id, to }),
  moveBudgetRow: (id: number, to: number) => call<BudgetProject[]>("move_budget_row", { id, to }),
  deleteBudget: (level: BudgetLevel, id: number) => call<BudgetProject[]>("delete_budget", { level, id }),
  copyBudgetYear: (from: number, to: number) => call<BudgetProject[]>("copy_budget_year", { from, to }),
  /** 바뀐 해와 넣은 공사 수 */
  /** 같은 이름은 덮어쓰고 새 것만 더해요. [그 해 전체, 공사 덮어쓰기 수, 공사 새로 더하기 수] */
  importBudget: (year: number, projects: ImportProject[]) => call<[BudgetProject[], number, number]>("import_budget", { year, projects }),
  budgetExcelWrite: (path: string, data: { year: number; unit: number; view: string; date: string; projects: BudgetProject[] }) => call<null>("budget_excel_write", { path, data }),
  budgetExcelRead: (path: string) => call<GridSheet[]>("budget_excel_read", { path }),
  // 집행현황 팀 공유(2026-10-20): 자료가 있는 해, 세부사업 담당, 받은 줄 넣기(uid), 처음 묶일 때 비우기
  budgetYears: () => call<number[]>("budget_years"),
  setBudgetOwner: (id: number, owner: number | null) => call<BudgetProject[]>("set_budget_owner", { id, owner }),
  budgetShareApply: (ops: ShareOp[]) => call<number>("budget_share_apply", { ops }),
  budgetShareClear: () => call<null>("budget_share_clear"),
  // 예산현황(13단계): 세부사업 설정 JSON(core 표 bstatus), 엑셀 쓰기(읽기는 budgetExcelRead)
  bstatusList: () => call<{ name: string; setup: string }[]>("bstatus_list", {}),
  bstatusSet: (name: string, setup: string) => call<null>("bstatus_set", { name, setup }),
  bstatusExcelWrite: (path: string, data: BStatusExport) => call<null>("bstatus_excel_write", { path, data }),
  saveWork: (id: number | null, work: WorkInput) => call<Work[]>("save_work", { id, work }),
  deleteWork: (id: number) => call<Work[]>("delete_work", { id }),
  updateCase: (no: string, patch: CasePatch) => call<Case>("update_case", { no, patch }),
  deleteCase: (no: string) => call<null>("delete_case", { no }),
  readInbox: (inbox: string, downloads: string, root: string, hold = false) => call<InboxResult>("read_inbox", { inbox, downloads, root, hold }),
  makeOrder: (req: { nos: string[]; order: number | null; root: string; date: string; tpl: string; inbox?: string; downloads?: string }) => call<OrderResult>("make_order", { req }),
  orderJpg: (id: number) => call<Order>("order_jpg", { id }),
  sendOrder: (id: number, outbox: string) => call<Order>("send_order", { id, outbox }),
  checkSent: (now: string) => call<Order[]>("check_sent", { now }),
  /** 지시부를 메일로 보냈다고 적어요(Claude가 보낸 메일함에서 확인한 뒤) */
  /** ok: 보낸메일함에서 같은 제목을 찾았는지(false면 "확인 필요") · subject: 보낸 제목 */
  orderMailed: (id: number, to: string, at: string, subject?: string, ok = true) => call<Order>("order_mailed", { id, to, at, subject: subject ?? null, ok }),
  openPath: (path: string) => call<null>("open_path", { path }),
  showInFolder: (path: string) => call<null>("show_in_folder", { path }),
  openPortal: (url: string) => call<null>("open_portal", { url }),
  runClaude: (req: { exe: string; inbox: string; downloads: string; guide: string; model: string }) => call<null>("run_claude", { req }),
  stopClaude: () => call<null>("stop_claude"),
  claudeStatus: (inbox: string) => call<RunStatus>("claude_status", { inbox }),
  pickPhotos: (req: { exe: string; model: string; inbox: string; items: { no: string; summary: string; photos: string[] }[] }) => call<PhotoPick[]>("pick_photos", { req }),
  /** 엑셀에서 읽은 줄을 그대로 넣고 넣은 수를 돌려줘요. */
  /** 엑셀 가져오기 – 돌려주는 값은 [덮은 수, 더한 수]. replace = 대체하기(모두 지우고 넣기, 공통 ✔5) */
  importComplaints: (rows: (ComplaintInput & { memo: string })[], replace = false) => call<[number, number]>("import_complaints", { rows, replace }),
  importContacts: (rows: (ContactInput & { memo: string })[], replace = false) => call<[number, number]>("import_contacts", { rows, replace }),
  /** 엑셀 파일 쓰기·읽기(kind: "complaints" | "contacts") */
  excelWrite: (path: string, kind: string, data: { rows: string[][]; intake: string[]; status: string[]; days?: string[][] }) => call<null>("excel_write", { path, kind, data }),
  excelRead: (path: string, kind: string) => call<{ headers: string[]; rows: string[][]; extra?: { headers: string[]; rows: string[][] }[] }>("excel_read", { path, kind }),

  tasksData: () => call<TasksData>("tasks_data"),
  addTaskList: (name: string) => call<TaskList>("add_task_list", { name }),
  renameTaskList: (id: number, name: string) => call<TaskList>("rename_task_list", { id, name }),
  setTaskListVisible: (id: number, visible: boolean) => call<TaskList>("set_task_list_visible", { id, visible }),
  /** 목록을 앞(-1)·뒤(+1)로 옮기고 모든 목록을 돌려줘요. */
  moveTaskList: (id: number, dir: number) => call<TaskList[]>("move_task_list", { id, dir }),
  /** 목록과 그 안의 할 일을 지워요. 지운 할 일 수를 돌려줘요. */
  deleteTaskList: (id: number) => call<number>("delete_task_list", { id }),
  addTask: (task: TaskInput) => call<Task>("add_task", { task }),
  updateTask: (id: number, task: TaskEdit) => call<Task>("update_task", { id, task }),
  /** 완료하거나 되돌리고, 함께 바뀐 할 일(하위·위 항목)을 돌려줘요. */
  setTaskDone: (id: number, done: boolean, today: string) => call<Task[]>("set_task_done", { id, done, today }),
  deleteTask: (id: number) => call<number>("delete_task", { id }),

  calendarData: () => call<CalendarData>("calendar_data"),
  addEvent: (event: EventInput) => call<CalEvent>("add_event", { event }),
  updateEvent: (id: number, event: EventInput) => call<CalEvent>("update_event", { id, event }),
  deleteEvent: (id: number) => call<null>("delete_event", { id }),
  calKinds: () => call<CalKind[]>("cal_kinds"),
  addCalKind: (name: string) => call<CalKind[]>("add_cal_kind", { name }),
  setCalKindColor: (id: number, color: number | null) => call<CalKind[]>("set_cal_kind_color", { id, color }),
  setCalKindVisible: (id: number, visible: boolean) => call<CalKind[]>("set_cal_kind_visible", { id, visible }),
  /** 종류와 그 종류의 일정을 지워요. 지운 일정 수를 돌려줘요. */
  deleteCalKind: (id: number) => call<number>("delete_cal_kind", { id }),
  /** 공휴일을 인터넷에서 받아 저장해요. 받지 못하면 "offline"으로 실패해요. */
  refreshHolidays: (now: string) => call<Holiday[]>("refresh_holidays", { now }),
  /** 화면이 받아 온 공휴일을 저장해요(받은 해만 바꿔요). */
  saveHolidays: (list: Holiday[], now: string) => call<Holiday[]>("save_holidays", { list, now }),
  /** 앞으로 울릴 알림 목록을 보내요(윈도우 알림은 앱이 띄워요). */
  setReminders: (list: Reminder[]) => call<null>("set_reminders", { list }),
  /** 지금 바로 알림 하나를 띄워 봐요. 실패하면 윈도우가 돌려준 이유로 실패해요. */
  testNotification: () => call<NotifyStatus>("test_notification"),
  notifyStatus: () => call<NotifyStatus>("notify_status"),
  /** 알림을 PowerShell 이름으로 띄울지 (기록 이름으로 안 보이는 PC) */
  setNotifyMode: (powershell: boolean) => call<null>("set_notify_mode", { powershell }),

  /** 윈도우 입력기를 한글(true) 또는 영문(false) 상태로 바꿔요. 앱 밖에서는 아무 일도 안 해요. */
  /** 첫 화면을 그렸다고 알려요. 숨긴 채 만든 창이 이때 보여요(브라우저에서는 아무 일 없음). */
  /** "기록을 끝낼까요?"의 끝내기 – 창 자리·크기를 저장하고 앱을 끝내요. */
  quitApp: () => (inApp ? invoke<null>("quit_app").catch(() => null) : Promise.resolve(null)),
  windowReady: () => (inApp ? invoke<null>("window_ready").catch(() => null) : Promise.resolve(null)),
  setIme: (korean: boolean) => (inApp ? invoke<null>("set_ime", { korean }) : Promise.resolve(null)),
};

/** 실패 이름을 화면에 보여 줄 문장으로 바꿔요. */
export function errorText(e: unknown): string {
  switch (e as ErrorCode) {
    case "wrong_password":
      return "비밀번호가 맞지 않아요.";
    case "password_too_short":
      return "비밀번호는 4자 이상이어야 해요.";
    case "hello_unavailable":
      return "이 PC에서는 윈도우 PIN을 쓸 수 없어요.";
    case "hello_canceled":
      return "PIN 확인을 취소했어요.";
    case "hello_failed":
      return "윈도우 PIN 확인에 실패했어요.";
    case "pin_stale":
      return "저장해 둔 비밀번호로 열지 못해 PIN 풀기를 껐어요.\n비밀번호를 넣어 주세요.";
    case "pin_off":
      return "PIN 풀기를 껐어요. 다시 켜면 새 비밀번호로 보관해요.";
    case "already_exists":
      return "그 폴더에 자료 파일이 이미 있어요.";
    case "not_found":
      return "자료 파일을 찾지 못했어요.";
    case "locked":
      return "잠겨 있어요. 다시 열어 주세요.";
    case "autostart":
      return "윈도우 시작 프로그램에 등록하지 못했어요.";
    case "keyring":
      return "윈도우 자격 증명 관리자에 열쇠를 맡기지 못했어요.";
    case "meta":
      return "기록 백업 파일이 아니에요.";
    case "invalid":
      return "넣은 값을 확인해 주세요.";
    case "offline":
      return "인터넷에 연결하지 못했어요.";
    case "corrupt":
      return "자료 파일이 손상됐어요.";
    case "too_new":
      return "이 자료는 더 새 버전의 기록으로 만든 거예요.\n기록을 업데이트해 주세요.";
    case "prefs_bad":
      return "설정 파일을 읽을 수 없어요.\n자료는 그대로 있어요. AppData의 kr.gilog.app\\prefs.json을 확인해 주세요.";
    default:
      return "파일을 읽거나 쓰지 못했어요. 자료 폴더를 확인해 주세요.";
  }
}
