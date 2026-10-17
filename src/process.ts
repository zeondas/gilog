// 민원처리(10단계) 화면이 쓰는 자료와 규칙이에요. 사양서 "민원처리" 절, 시안 Process.dc.html.
// 지금은 작동하는 목업이에요: 공사·민원 건은 암호화 파일의 kv(process.works·process.cases)에 JSON으로 두고,
// "민원 불러오기"는 진짜 신문고 대신 보기 민원(SAMPLES)을 넣어요.
import { api } from "./api";

export type Work = {
  id: number;
  name: string;
  /** 시공사 */
  co: string;
  /** 현장대리인 = 업무연락처 번호(쌍방향 — 이름·번호는 늘 업무연락처에서 읽어요) */
  contact: number | null;
  /** 업무연락처 프로젝트 번호(공사명과 같은 이름) */
  project: number | null;
  /** 처리 범위(AI의 판단 기준) */
  scope: string;
  /** 다음 연번 */
  nextSeq: number;
  /** 지시부 양식 파일(pptx·hwpx) 경로 */
  tpl: string;
};

/** new 지시부 전 · made 지시부 만듦 · sent 전송 완료 */
export type Stage = "new" | "made" | "sent";

export type Case = {
  /** 접수번호 */
  no: string;
  received: string;
  due: string;
  area: string;
  place: string;
  summary: string;
  reason: string;
  /** 판단 공사 */
  work: number | null;
  note: string;
  /** 비우면 공사의 다음 연번 */
  seq: string;
  stage: Stage;
  /** 지시부를 만들 때 등록한 민원대장 번호 */
  complaint: number | null;
};

const WORKS_KEY = "process.works";
const CASES_KEY = "process.cases";
const FETCHED_KEY = "process.fetched";

const read = async <T,>(key: string, fallback: T): Promise<T> => {
  try {
    const raw = await api.get(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const loadWorks = () => read<Work[]>(WORKS_KEY, []);
export const loadCases = () => read<Case[]>(CASES_KEY, []);
export const loadFetched = () => read<string>(FETCHED_KEY, "");
export const saveWorks = (w: Work[]) => api.set(WORKS_KEY, JSON.stringify(w));
export const saveCases = (c: Case[]) => api.set(CASES_KEY, JSON.stringify(c));
export const saveFetched = (s: string) => api.set(FETCHED_KEY, JSON.stringify(s));

export const PORTAL_URL = "https://gov.epeople.go.kr";

/** 파일 경로에서 이름만 */
export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** "2026-10-17" → "10-17" */
export const md = (d: string) => (d.length >= 10 ? d.slice(5, 10) : d);

/** 조치내용에 적는 한 줄 */
export const actionLine = (workName: string, seq: number) => `${workName} 지시(${seq})`;

/** 목업의 "민원 불러오기"가 넣는 보기 민원. AI가 받은편지함에 놓는 결과 파일과 같은 칸이에요.
 *  work는 공사 이름의 앞 글자로 찾아요(없으면 비워요 — "공사 고르기"). */
export const SAMPLES: (Omit<Case, "work" | "note" | "seq" | "stage" | "complaint"> & { guess: string })[] = [
  { no: "1AA-2610-0312207", received: "2026-10-17", due: "2026-10-24", area: "조리읍", place: "등원리 230-1 앞", summary: "\"보수해주세요\" + 사진 2장", reason: "사진: 차로 가장자리 지름 약 40cm 파임 1곳", guess: "도로시설물" },
  { no: "1AA-2610-0311980", received: "2026-10-17", due: "2026-10-23", area: "문산읍", place: "선유리 455 교차로", summary: "도로 갈라짐과 침하, 차량 흔들림", reason: "사진: 거북등 균열이 차로 절반, 여러 군데 — 포장 범위", guess: "도로포장" },
  { no: "1AA-2610-0311402", received: "2026-10-16", due: "2026-10-23", area: "탄현면", place: "법흥리 77 버스정류장 뒤", summary: "비 오면 물이 고여 통행 불편", reason: "사진에 마른 바닥만 보여요. 우수받이 막힘인지 확인 필요", guess: "" },
  { no: "1AA-2610-0308771", received: "2026-10-14", due: "2026-10-21", area: "금촌2동", place: "금촌동 301-2 앞 보도", summary: "제초작업 중 차량 파손, 보상 요청", reason: "공사 대상이 아니에요(피해 보상 민원)", guess: "" },
  { no: "1AA-2610-0309895", received: "2026-10-15", due: "2026-10-19", area: "조리읍", place: "봉일천리 209-10", summary: "횡단보도 앞 도로 파임", reason: "사진: 횡단보도 정지선 앞 포트홀 1곳", guess: "도로시설물" },
  { no: "1AA-2610-0309120", received: "2026-10-15", due: "2026-10-22", area: "파주읍", place: "연풍리 18 삼거리", summary: "가드레일 찌그러짐, 지주 기울어짐", reason: "사진: 가드레일 2경간 파손", guess: "가드레일" },
];

/** 처음 열었을 때(공사가 하나도 없을 때) 보여 줄 보기 공사 — 목업에서만 */
export const SAMPLE_WORKS: { name: string; co: string; agent: string; phone: string; scope: string; nextSeq: number; tpl: string }[] = [
  { name: "도로시설물 유지보수", co: "○○건설(주)", agent: "이현수", phone: "010-0000-0102", scope: "반사경·시선유도봉 등 시설물, 작은 포트홀(지름 50cm 안), 소파보수 소규모", nextSeq: 15, tpl: "D:\\지시부\\지시부_도로시설물.pptx" },
  { name: "도로포장 유지보수", co: "△△산업(주)", agent: "정민호", phone: "010-0000-0105", scope: "절삭 후 재포장, 넓게 갈라지거나 여러 군데인 소파보수", nextSeq: 4, tpl: "D:\\지시부\\지시부_도로포장.hwpx" },
  { name: "가드레일·맨홀·도로부속시설 정비공사", co: "□□건설(주)", agent: "김도윤", phone: "010-0000-0188", scope: "가드레일 파손, 맨홀 단차·뚜껑 파손", nextSeq: 2, tpl: "D:\\지시부\\지시부_가드레일맨홀.pptx" },
];
