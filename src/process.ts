// 민원처리(10단계) 화면의 규칙 함수예요. 사양서 "민원처리" 절, 시안 Process.dc.html.
// 저장은 core/process.rs(표 works·cases), 파일 일은 src-tauri/src/process.rs가 해요.
import type { Case } from "./api";

export type { Case, Stage, Work } from "./api";

export const PORTAL_URL = "https://gov.epeople.go.kr";

/** 파일 경로에서 이름만 */
export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** "2026-10-17" → "10-17" */
export const md = (d: string) => (d.length >= 10 ? d.slice(5, 10) : d);

/** 지시부의 {지시일}: "2026. 10. 17." */
export const orderDate = (d: string) => (d.length >= 10 ? `${d.slice(0, 4)}. ${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))}.` : d);

/** 지시부의 {지시자}: 이름, 연락처가 있으면 다음 줄 */
export const signerText = (name: string, phone: string) => [name.trim(), phone.trim()].filter(Boolean).join("\n");

/** 조치내용에 적는 한 줄 */
export const actionLine = (workName: string, seq: number) => `${workName} 지시(${seq})`;

/** 앱(Rust)이 돌려주는 민원처리 오류 */
export function processError(e: unknown): string | null {
  switch (e) {
    case "inbox":
      return "받은편지함 폴더가 없어요. 설정에서 확인해 주세요.";
    case "template":
      return "지시부 양식 파일이 없어요. 공사 관리에서 양식을 골라 주세요.";
    case "nofile":
      return "지시부 파일이 없어요. 다시 만들어 주세요.";
    case "nojpg":
      return "JPG를 만들지 못했어요.";
    case "windows":
      return "JPG는 윈도우 앱에서 만들어요.";
    case "missing":
      return "파일이 없어요. 옮기거나 지웠는지 확인해 주세요.";
  }
  return null;
}

/** 브라우저 미리 보기의 "민원 불러오기"가 받은편지함에 넣는 보기 민원.
 *  AI가 받은편지함에 놓는 결과 파일과 같은 칸이에요(work는 공사 이름 앞 글자로 찾아요). */
export const SAMPLES: (Partial<Case> & { guess: string })[] = [
  { no: "1AA-2610-0312207", received: "2026-10-17", due: "2026-10-24", area: "조리읍", place: "등원리 230-1", short: "포트홀", summary: "\"보수해주세요\" + 사진 2장", reason: "사진: 차로 가장자리 지름 약 40cm 파임 1곳", photos: ["a.jpg", "b.jpg"], map: "m.png", guess: "도로시설물" },
  { no: "1AA-2610-0311980", received: "2026-10-17", due: "2026-10-23", area: "문산읍", place: "선유리 455", short: "균열", summary: "도로 갈라짐과 침하, 차량 흔들림", reason: "사진: 거북등 균열이 차로 절반, 여러 군데 — 포장 범위", photos: ["a.jpg"], guess: "도로포장" },
  { no: "1AA-2610-0311402", received: "2026-10-16", due: "2026-10-23", area: "탄현면", place: "주소불명", short: "물고임", summary: "비 오면 물이 고여 통행 불편", reason: "원문·사진에 주소가 없어요. 우수받이 막힘인지 확인 필요", guess: "" },
  { no: "1AA-2610-0309895", received: "2026-10-15", due: "2026-10-19", area: "조리읍", place: "봉일천리 209-10", short: "포트홀", summary: "횡단보도 앞 도로 파임", reason: "사진: 횡단보도 정지선 앞 포트홀 1곳", photos: ["a.jpg"], map: "m.png", guess: "도로시설물" },
  { no: "1AA-2610-0309120", received: "2026-10-15", due: "2026-10-22", area: "파주읍", place: "연풍리 18", short: "가드레일", summary: "가드레일 찌그러짐, 지주 기울어짐", reason: "사진: 가드레일 2경간 파손", photos: ["a.jpg"], guess: "가드레일" },
];

/** 미리 보기에서 공사가 하나도 없을 때 넣는 보기 공사(앱에서는 쓰지 않아요) */
export const SAMPLE_WORKS = [
  { name: "도로시설물 유지보수", co: "○○건설(주)", agent: "이현수", phone: "010-0000-0102", scope: "반사경·시선유도봉 등 시설물, 작은 포트홀(지름 50cm 안), 소파보수 소규모", nextSeq: 15, tpl: "D:\\지시부\\지시부_도로시설물.pptx" },
  { name: "도로포장 유지보수", co: "△△산업(주)", agent: "정민호", phone: "010-0000-0105", scope: "절삭 후 재포장, 넓게 갈라지거나 여러 군데인 소파보수", nextSeq: 4, tpl: "D:\\지시부\\지시부_도로포장.hwpx" },
  { name: "가드레일·맨홀·도로부속시설 정비공사", co: "□□건설(주)", agent: "김도윤", phone: "010-0000-0188", scope: "가드레일 파손, 맨홀 단차·뚜껑 파손", nextSeq: 2, tpl: "D:\\지시부\\지시부_가드레일맨홀.pptx" },
];
