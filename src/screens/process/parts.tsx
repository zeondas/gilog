// 민원처리 – 조각끼리 함께 쓰는 값·그림(열 정의·글자 폭 재기·공사 색·진행 모양·작은 아이콘).
import { ContactsData, errorText, Work } from "../../api";
import { md, processError } from "../../process";
import { todayStr } from "../../journal";
import { projectColor } from "../../screens/contacts/parts";

/** 공사 색 = 업무연락처 프로젝트 색 */
export function workColor(w: Work | undefined, cd: ContactsData | null): number {
  const p = w && cd?.projects.find((x) => x.id === w.project);
  return p ? projectColor(p) : 0;
}

/**
 * 열 제목과 처음 폭. null은 처음 값을 창 폭에 맞추는 긴 글 열(민원 요약)이에요.
 * 끌어서 바꾼 폭은 공통 부품 ColHead가 `process.cols`에 끈 열만 px로 저장해요(헤더 열 조정 통일 2026-10-28).
 * fixed = 손잡이 없는 열(체크·판단 공사·진행), text = 가장 좁게가 처음 값 절반인 글자 열.
 */
export const COLUMNS: { id: string; label: string; w: number | null; center?: boolean; fixed?: boolean; text?: boolean }[] = [
  { id: "check", label: "", w: 36, fixed: true },
  // 번호·접수·기한·위치·판단 공사는 글자에 맞춰 다시 재요(AUTO_COLS) – 아래는 재기 전 처음 폭
  { id: "no", label: "번호", w: 80 },
  { id: "recv", label: "접수", w: 62 },
  { id: "due", label: "기한", w: 105 },
  { id: "place", label: "위치", w: 151, text: true },
  { id: "sum", label: "민원 요약", w: null, text: true },
  { id: "work", label: "판단 공사", w: 164, fixed: true },
  { id: "note", label: "고려사항", w: 300, text: true },
  { id: "prog", label: "진행", w: 190, fixed: true },
];

/** 민원 요약 처음 값의 가장 좁은 폭 */
export const SUM_MIN = 140;

/**
 * 열 폭 자동 맞춤(2026-10-21 사용자 1안): 번호·접수·기한·위치·판단 공사는 그 열의 가장 긴 글자(머리 글자 포함) + COL_GAP –
 * 글자 끝에서 다음 열 글자까지 빈 칸이 모두 같아요. 민원 요약이 나머지, 고려사항·진행은 처음 폭 그대로.
 */
export const AUTO_COLS = [1, 2, 3, 4, 6];

export const COL_GAP = 24;

/** 위치 열 처음 값은 이만큼까지만 넓히고, 열보다 긴 주소는 그 줄만 두 줄(지역 위·위치 아래)로 써요(끌어서 넓히면 그 폭까지 한 줄). */
export const PLACE_MAX = 260;

/** 글자들이 한 줄로 놓일 때의 폭(가로로 늘어놓은 자식들 + 사이 간격). 위치 칸은 지역 + 4 + 위치예요. */
export function textWidth(el: Element): number {
  const rangeW = (n: Node) => {
    const r = document.createRange();
    r.selectNodeContents(n);
    return r.getBoundingClientRect().width;
  };
  if (el.classList.contains("pr-place")) {
    const kids = [...el.children];
    return kids.reduce((a, k) => a + rangeW(k), 0) + (kids.length - 1) * PLACE_SPACE;
  }
  const kids = [...el.children].filter((k) => !k.classList.contains("colh-grip"));
  if (!kids.length) return rangeW(el);
  const left = Math.min(...kids.map((k) => k.getBoundingClientRect().left));
  const right = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
  return right - left;
}

/** 위치 칸 한 줄일 때 지역과 위치 사이(.pr-sub margin-right) */
const PLACE_SPACE = 5;

// ---------- 지시부 메일 (2026-10-20) ----------

export type MailDraft = { id: number; to: string; toName: string; org: string; subject: string; body: string; label: string };

/** 이 건만으로 지시부 만들기 – 문서 + 더하기 */
export function DocPlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v4" />
      <path d="M14 3v5h5M18 15v6M15 18h6" />
    </svg>
  );
}

export function MailIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18v14H3z M3 6l9 7 9-7" />
    </svg>
  );
}

export function PhoneIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h10v18H7z M11 18h2" />
    </svg>
  );
}

export function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

// ---------- 진행 막대 · 보낸 증거 카드 (2026-10-20 사용자 1안, 시안 ProcessStatus) ----------

export type Prog = {
  pct: number;
  /** 색 진하기 1~5(--pg-1~5) */
  step: number;
  label: string;
  icon?: "doc" | "mail" | "phone" | "warn";
  check?: boolean;
  /** 보내는 중·만드는 중 – 빗금 */
  hatch?: boolean;
  /** 확인 필요 – 주황 빗금 */
  warn?: boolean;
  kind: "new" | "busy" | "order" | "sending" | "proof" | "answer" | "done";
};

/** 찾아 둔 파일 경로인지(불러올 때 못 찾은 사진은 이름만 남아요 – 2026-10-21) */
export const isPath = (p: string) => /[\\/]/.test(p);

export function WarnIcon({ size = 13 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l10 18H2z M12 10v5 M12 18v.5" />
    </svg>
  );
}

export const FETCHED_KEY = "process.fetched";

/** 마지막 불러오기 결과(아래 줄 "새 민원 N건 · 건너뜀 N건 · 걸린 시간 · [로그 열기]") */
export const LAST_RUN_KEY = "process.lastRun";

/** AI가 고른 현장사진의 이유(접수번호 → 한 줄) – 지시부엔 사진이 1장만 들어가서 왜 그 사진인지 남겨요(2026-10-21 22:59 사용자) */
export const PICK_KEY = "process.photoPick";

/** 마지막 불러오기 결과. per = 건당 걸린 시간(초) – 빠르게 고친 앞뒤를 견주려고 남겨요(2026-10-21 신속 자동화) */
export type LastRun = { at: string; added: number; skipped: number | null; secs: number; log: string; per?: number };

// 열 폭을 저장하는 이름 – 손으로 끈 열만 px로 남아요(헤더 열 조정 통일 2026-10-28). 옛 `process.colWidths5`(아홉 칸 배열)는 읽지 않아요.
export const COLS_KEY = "process.cols";

export const MAIL_BOX = "https://mail.korea.kr";

/** 판단 공사 "해당 없음"(2026-10-21 사용자) – core NA_WORK와 같은 값 */
export const NA_WORK = 0;

export const errText = (e: unknown) => processError(e) ?? (typeof e === "string" && e.length > 12 ? e : errorText(e));

export const stamp = () => {
  const t = new Date();
  return `${md(todayStr(t))} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};

/** 접수번호 마지막 묶음 7자리(1AA-2610-0527749 → 0527749) */
export const shortNo = (no: string) => no.split(/[\s/]/)[0].split("-").pop() || no;

export function MoreIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}
