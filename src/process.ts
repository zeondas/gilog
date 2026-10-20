// 민원처리(10단계) 화면의 규칙 함수예요. 사양서 "민원처리" 절, 시안 Process.dc.html.
// 저장은 core/process.rs(표 works·cases), 파일 일은 src-tauri/src/process.rs가 해요.
import type { Case } from "./api";
import { DEFAULT_MAIL_BODY, DEFAULT_MAIL_SUBJECT } from "./settingsStore";

export type { Case, Stage, Work } from "./api";

export const PORTAL_URL = "https://gov.epeople.go.kr";

/** 파일 경로에서 이름만 */
export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** "2026-10-17" → "10-17" */
export const md = (d: string) => (d.length >= 10 ? d.slice(5, 10) : d);

/** 지시부 짧은 이름: 축약 공사명의 끝 낱말 + 두 자리 연번(예: "1지구-03") */
export const orderTag = (workName: string, seq: number) => `${workName.trim().split(/\s+/).pop() ?? ""}-${String(seq).padStart(2, "0")}`;

/** 줄의 지시부 칸: "1지구-03 · 2" (지시부 · 항목 번호) */
export const orderLabel = (workName: string, seq: number, item: number) => `${orderTag(workName, seq)} · ${item}`;

/** 조치내용에 적는 한 줄: "도로시설물 1지구 지시(1지구-03 · 2)" */
export const actionLine = (workName: string, seq: number, item: number) => `${workName} 지시(${orderLabel(workName, seq, item)})`;

/** 앱(Rust)이 돌려주는 민원처리 오류 */
export function processError(e: unknown): string | null {
  switch (e) {
    case "inbox":
      return "가져올 폴더 폴더가 없어요. 설정에서 확인해 주세요.";
    case "template":
      return "지시부 양식 파일이 없어요. 설정 “민원처리”의 지시부 양식을 확인해 주세요.";
    case "nofile":
      return "지시부 파일이 없어요. 다시 만들어 주세요.";
    case "nojpg":
      return "JPG를 만들지 못했어요. 한글이 설치돼 있는지 확인해 주세요.";
    case "windows":
      return "JPG는 윈도우 앱에서 만들어요.";
    case "noclaude":
      return "Claude Code를 찾지 못했어요. 설치했는지, 설정의 Claude 실행 파일을 확인해 주세요.";
    case "nochrome":
      return "크롬을 찾지 못했어요. 신문고는 크롬으로 열어요(엣지는 IE 모드라 Claude가 읽지 못해요).";
    case "running":
      return "이미 민원을 불러오는 중이에요.";
    case "missing":
      return "파일이 없어요. 옮기거나 지웠는지 확인해 주세요.";
  }
  return null;
}

/** 브라우저 미리 보기의 "민원 불러오기"가 가져올 폴더에 넣는 보기 민원.
 *  AI가 가져올 폴더에 놓는 결과 파일과 같은 칸이에요(work는 공사 이름 앞 글자로 찾아요). */
export const SAMPLES: (Partial<Case> & { guess: string })[] = [
  { no: "1AA-2610-0312207", received: "2026-10-17", due: "2026-10-24", area: "조리읍", place: "등원리 230-1", short: "포트홀 보수", summary: "\"보수해주세요\" + 사진 2장", reason: "사진: 차로 가장자리 지름 약 40cm 파임 1곳", photos: ["a.jpg", "b.jpg"], map: "m.png", guess: "도로시설물" },
  { no: "1AA-2610-0311980", received: "2026-10-17", due: "2026-10-23", area: "문산읍", place: "선유리 455", short: "균열 보수", summary: "도로 갈라짐과 침하, 차량 흔들림", reason: "사진: 거북등 균열이 차로 절반, 여러 군데 – 포장 범위", photos: ["a.jpg"], guess: "도로포장" },
  { no: "1AA-2610-0311402", received: "2026-10-16", due: "2026-10-23", area: "탄현면", place: "주소불명", short: "물고임 정비", summary: "비 오면 물이 고여 통행 불편", reason: "원문·사진에 주소가 없어요. 우수받이 막힘인지 확인 필요", guess: "" },
  { no: "1AA-2610-0309895", received: "2026-10-15", due: "2026-10-19", area: "조리읍", place: "봉일천리 209-10", short: "포트홀 보수", summary: "횡단보도 앞 도로 파임", reason: "사진: 횡단보도 정지선 앞 포트홀 1곳", photos: ["a.jpg"], map: "m.png", guess: "도로시설물" },
  { no: "1AA-2610-0309120", received: "2026-10-15", due: "2026-10-22", area: "파주읍", place: "연풍리 18", short: "가드레일 정비", summary: "가드레일 찌그러짐, 지주 기울어짐", reason: "사진: 가드레일 2경간 파손", photos: ["a.jpg"], guess: "가드레일" },
];

/** 미리 보기에서 공사가 하나도 없을 때 넣는 보기 공사(앱에서는 쓰지 않아요) */
export const SAMPLE_WORKS = [
  { name: "도로시설물 1지구", full: "2026년 동부권 도로시설물 정비 연간단가 공사(1지구, 하반기)", co: "○○건설(주)", agent: "이현수", phone: "010-0000-0102", scope: "반사경·시선유도봉 등 시설물, 작은 포트홀(지름 50cm 안), 소파보수 소규모", nextSeq: 15, tpl: "" },
  { name: "도로포장 2지구", full: "2026년 도로포장 유지보수 공사(2지구)", co: "△△산업(주)", agent: "정민호", phone: "010-0000-0105", scope: "절삭 후 재포장, 넓게 갈라지거나 여러 군데인 소파보수", nextSeq: 4, tpl: "" },
  { name: "가드레일·맨홀 정비", full: "가드레일·맨홀·도로부속시설 정비공사", co: "□□건설(주)", agent: "김도윤", phone: "010-0000-0188", scope: "가드레일 파손, 맨홀 단차·뚜껑 파손", nextSeq: 2, tpl: "" },
];

/** 이미 있는 기록(Claude가 같은 민원을 다시 가져오지 않게) – 민원인 이름·연락처는 넣지 않아요. */
export type Known = { nos: string[]; records: string[] };

/** Claude에게 줄 지침. [민원 불러오기]가 Claude에게 넘기고, 설정의 [지침 복사]로도 복사해요.
 *  2026-10-20 속도: 화면 생김새와 걸음을 미리 적어 Claude가 매번 화면을 보고 생각하지 않게 해요(사용자 캡처 세 장 기준).
 *  known.nos는 표에 있는 번호 + 전에 본 번호(지운 것·건너뛴 것 포함) – 목록만 보고 걸러 열지 않아요. */
export function aiGuide(p: { inbox: string; downloads: string; outbox: string }, works: { id: number; name: string; scope: string }[], known: Known = { nos: [], records: [] }): string {
  const list = works.length ? works.map((w) => `  - ${w.id}: ${w.name} – ${w.scope || "(처리 범위 없음)"}`).join("\n") : "  - (등록된 공사가 없어요 – work는 null)";
  const nos = known.nos.length ? known.nos.join(", ") : "(없음)";
  const recs = known.records.length ? known.records.map((r) => `  - ${r}`).join("\n") : "  - (없음)";
  return `# 기록 민원처리 지침

## 0. 규칙
- **맨 먼저 브라우저를 골라요**: list_connected_browsers로 이어진 브라우저를 보고, 이름에 Chrome(크롬)이 든 것을 select_browser로 골라요(여럿이면 첫 것). 엣지(Edge)는 고르지 않아요 – 회사 정책으로 IE 모드라 읽지 못해요. 크롬이 없으면(엣지만 있거나 하나도 없으면) 아무것도 하지 말고 마지막 답을 정확히 NO_CHROME 한 줄로 끝내요.
- 파일은 Write로만 써요. PowerShell·Bash는 쓰지 않아요(허락받을 사람이 없어 막혀요).
- **누르는 것은 이 지침에 적힌 단추·글자뿐이에요**: 위 메뉴 "민원" → "민원처리", 목록의 제목, 쪽 번호, [첨부파일일괄다운로드], [목록]. 그 밖(검색·조회·초기화·인쇄·저장·엑셀·결재·처리·이송·답변 작성·개인정보·민원인 이름·첨부 파일 이름 하나하나·팝업 단추)은 누르지 않아요. 화면이 생각과 다르면 누르며 찾지 말고 get_page_text로 다시 읽어요.
- 누를 때는 find로 그 글자를 찾아 그 자리(ref)를 한 번 눌러요. 누른 뒤 화면이 바뀌었는지는 get_page_text로 확인하고, 같은 단추를 다시 누르지 않아요. 새 탭을 연 직후에는 페이지가 뜰 때까지 기다린 뒤 읽어요(빈 탭에서 find 하면 오류).
- 크롬(Claude 확장)으로 일해요. 화면은 **글로** 읽어요(get_page_text·find·read_page). 스크린샷은 찍지 않아요 – 느리고 필요 없어요. 사진 파일은 열어 보지 않아요(판단은 본문 글과 파일 이름으로).
- 한 화면에서 할 일이 여럿이면 한 번에 묶어 보내요(browser_batch). 생각은 짧게, 걸음은 아래 순서 그대로.
- 민원인 이름·연락처는 어디에도 쓰지 않아요(목록의 "민원인" 열은 읽지 않아요). 개인정보 창은 열지 않아요. 민원 제목은 담당자가 붙인 것이라 판단에 쓰지 않아요.
- 로그인 화면이 나오거나 로그인이 풀려 있으면 아무것도 쓰지 말고, 마지막 답을 정확히 LOGIN_REQUIRED 한 줄로 끝내요(인증서 로그인은 담당자가 해요).
- 탭이 열렸는데 화면을 읽을 수 없으면(IE 모드, 글 읽기 실패) 아무것도 쓰지 말고, 마지막 답을 정확히 PAGE_UNREADABLE 한 줄로 끝내요. 로그인 문제로 짐작하지 않아요.
- 가져올 폴더: ${p.inbox}

## 1. 목록까지 가는 길
1. 새 탭을 열어 ${PORTAL_URL} 를 열어요(첫 화면만 주소로 열려요 – 목록 주소를 바로 열면 405).
2. 위쪽 파란 메뉴 줄의 **"민원"**을 누르면 아래에 상자들이 펼쳐져요 → **"민원처리"** 상자를 눌러요.
3. "민원처리목록" 화면이 나와요. 검색 조건은 처음 값(처리중) 그대로 두고 아무것도 누르지 않아요 – 목록이 이미 보여요. "전체 N건"이 건수예요.
4. 표의 열: 신청번호 · 민원제목/민원요지(앞에 "안전"·"이송N회" 같은 배지가 붙기도 해요) · 민원인 · 처리유형 · 접수일 · 결재상태 · 자민원건수 · 잔여일. 한 쪽에 10건이에요 – N이 10을 넘으면 표 아래 쪽 번호(2, 3 …)를 눌러 다음 쪽도 읽어요.

## 2. 가져올 것 고르기 – 목록만 보고, 열지 않아요
- 모든 쪽의 신청번호를 모아요.
- 아래 "이미 본 접수번호"에 있는 번호는 **열지 않고** 빼요.
- 남은 번호가 가져올 후보예요. 후보가 없으면 바로 "새 민원 0건"으로 끝내요.
- 가져올 폴더에 "_진행.json"을 {"total": 후보 수, "done": 0} 으로 써요. 한 건을 끝내거나 건너뛸 때마다 done을 올려요.

이미 본 접수번호: ${nos}

## 3. 한 건마다
1. 목록에서 그 줄의 **제목**(민원제목/민원요지 칸)을 눌러요 → "민원처리" 화면. 맨 위에 접수번호(1AA-…, 뒤에 /2AA-…가 붙기도 해요 – 앞 것이 접수번호), 그 아래 단추 [첨부파일일괄다운로드]·[인쇄]·[저장]·[목록].
2. 글로 읽어요: "접수일시"(접수일 = 그 날짜), "민원처리기간" 칸의 **"처리완료예정일"**(기한), "<첨부파일>" 칸의 파일 이름들, 본문(오른쪽 긴 칸 – "[사고발생지역]" 줄이 있으면 그것이 주소예요).
3. 아래 "이미 있는 기록"과 같은 민원(같은 곳·같은 내용)이면 가져오지 않아요 – 그 번호를 가져올 폴더 "_건너뜀.json"의 {"nos":[…]}에 더해 쓰고(파일이 없으면 새로), [목록]으로 돌아가요. 다음부터는 열지 않게 돼요.
4. [첨부파일일괄다운로드]를 눌러요. 파일이 하나씩 내려와요(가끔 zip 하나). 다운로드가 끝날 때까지 기다린 뒤 받은 파일 이름을 확인해요(크롬이 받는 폴더 – 보통 ${p.downloads} 또는 내 폴더의 Downloads).
5. 사진 나누기:
   - **안전신문고로 온 민원** = 목록에서 제목 앞에 빨간 "안전" 배지가 붙은 건(글로 읽으면 제목 칸이 "안전 …"으로 시작해요; 본문 화면에도 "안전제보(신고)"가 보여요): 첨부 목록 **맨 아래 .png = 위치도(map)**, 그 위 .jpg들 = 현장사진(photos).
   - 그 밖(민원인이 직접 올린 것): 그림 파일(jpg·jpeg·png)은 모두 photos, 이름에 지도·위치·map이 든 것만 map. zip이면 zip 이름을 photos에 그대로 적어요(앱이 풀어요). 그림이 아닌 파일은 적지 않아요.
6. 위치는 주소(리·동 + 지번)만 적어요. "앞", "버스정류장 뒤" 같은 말은 빼요. 본문에 주소가 분명하지 않으면 "주소불명".
7. 아래 공사의 처리 범위를 보고 공사 번호를 골라요. 애매하거나 공사 대상이 아니면 null.
${list}
8. 가져올 폴더에 "<접수번호>.json"을 UTF-8로 써요.
{
  "no": "1AA-2610-0309895",
  "received": "2026-10-15",
  "due": "2026-10-19",
  "area": "조리읍",
  "place": "봉일천리 209-10",
  "summary": "횡단보도 앞 도로 파임",
  "short": "포트홀 보수",
  "reason": "본문: 횡단보도 정지선 앞 포트홀 1곳",
  "work": 1,
  "photos": ["받은 사진 파일 이름.jpg"],
  "map": "위치도 파일 이름.png"
}
- received·due는 YYYY-MM-DD, area는 읍면동, short는 공사내용이에요 – 지시부 제목 줄 "1. 공사내용 (주소)"와 파일 이름에 써요. 간결하게 두세 낱말(예: 포트홀 보수, 반사경 교체, 가드레일 정비).
- summary는 민원 요약 한 줄, reason은 판단 이유 한 줄이에요. 민원인 이름·연락처는 쓰지 않아요.
- photos·map은 받은 파일 이름이에요. 없으면 [] 와 "".
9. [목록] 단추로 목록에 돌아가요(쪽이 1쪽으로 돌아가면 보던 쪽 번호를 다시 눌러요). done을 올리고 다음 건.

이미 있는 기록(접수일 · 위치 · 내용):
${recs}

## 4. 끝
- 다 끝나면 마지막 답을 "새 민원 N건" 한 줄로 끝내요(건너뛴 것은 세지 않아요).
`;
}

/**
 * "민원처리" 세션(Claude 앱, PC에 이어진 대화)에 한 번 붙여 두는 폰 전송 지침이에요.
 * 기록 [폰 전송] = 보낼 폴더에 JPG를 넣음 → 사용자가 이 세션에 "보내"라고 하면 Claude가 올리고 "보냄"에 써 둠 → 기록이 전송 완료.
 */
export function phoneGuide(p: { outbox: string }): string {
  return `# 민원처리 폰 전송 (기록)

이 대화는 기록 지시부 JPG를 폰으로 받는 곳이에요. 내가 "보내" 또는 "폰 전송"이라고 하면:

1. PC의 보낼 폴더(${p.outbox})를 봐요. 그 안의 JPG만 보고, 안쪽 "보냄" 폴더는 보지 않아요.
2. JPG를 하나씩 이 대화에 파일로 올려요(이름 그대로). 글은 "N건 보냈어요"와 파일 이름 목록만 짧게.
3. 올린 파일마다 같은 이름으로 "${p.outbox}\\보냄\\파일이름.jpg"에 써 둬요. 그래야 기록이 전송 완료로 바꾸고 원본을 지워요.
4. 보낼 것이 없으면 "보낼 지시부가 없어요" 한 줄만.

PC에 이어져 있지 않으면 "PC 연결이 끊겨 있어요 – 데스크톱 앱을 켜 주세요" 한 줄로 알려 줘요.
`;
}


/** 메일 틀의 {자리}를 값으로 바꿔요. 자리가 있는데 모두 빈 값인 줄은 빼요(예: 연락처가 없으면 "문의 {연락처}"처럼 직접 넣은 줄). */
export function fillMail(tpl: string, v: Record<string, string>): string {
  return tpl
    .split("\n")
    .map((line) => {
      const keys = [...line.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1].trim());
      if (keys.length && keys.every((k) => k in v && !v[k])) return null;
      return line.replace(/\{([^{}]+)\}/g, (m, k: string) => (k.trim() in v ? v[k.trim()] : m));
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .trim();
}

/** 지시부 메일(korea.kr)의 제목·본문 처음 값 – 설정 "민원처리"의 메일 틀에 그 지시부 값을 넣어요(2026-10-20 사용자 1안, 확인 창에서 한 통만 고칠 수 있어요). */
export function mailDraft(p: { signer: string; signerPhone: string; mailSubject: string; mailBody: string }, w: { name: string; full: string; co: string }, seq: number, count: number, agent: string) {
  const v: Record<string, string> = {
    공사명: w.full || w.name,
    "축약 공사명": w.name,
    연번: String(seq).padStart(2, "0"),
    건수: String(count),
    현장대리인: agent,
    시공사: w.co,
    지시자: p.signer.trim(),
    연락처: p.signerPhone.trim(),
  };
  return { subject: fillMail(p.mailSubject || DEFAULT_MAIL_SUBJECT, v).replace(/\s*\n\s*/g, " "), body: fillMail(p.mailBody || DEFAULT_MAIL_BODY, v) };
}

/**
 * 지시부를 공직자 통합메일(korea.kr)로 보내는 지침이에요(2026-10-20 사용자 2안 – Claude가 [보내기]까지 눌러요).
 * 진행은 dir의 "_진행.json"(신문고 불러오기와 같은 모양), 마지막 답은 MAIL_SENT · LOGIN_REQUIRED · PAGE_UNREADABLE · ATTACH_FAILED · MAIL_FAILED 중 하나.
 */
export function mailGuide(m: { dir: string; to: string; toName: string; subject: string; body: string; files: string[] }): string {
  return `# 기록 지시부 메일

공사 지시부를 현장대리인에게 공직자 통합메일(korea.kr)로 보내요. 이 지침에 적힌 것만 해요.
화면 생김새와 걸음을 미리 적어 뒀어요 – 화면은 글로 읽고(get_page_text·find·read_page) 스크린샷은 찍지 않아요. 한 화면의 칸 채우기는 한 번에 묶어 보내요(browser_batch).

## 0. 시작
- **맨 먼저 브라우저를 골라요**: list_connected_browsers로 이어진 브라우저를 보고, 이름에 Chrome(크롬)이 든 것을 select_browser로 골라요(여럿이면 첫 것). 엣지(Edge)는 고르지 않아요 – 회사 정책으로 IE 모드라 읽지 못해요. 크롬이 없으면(엣지만 있거나 하나도 없으면) 아무것도 하지 말고 마지막 답을 정확히 NO_CHROME 한 줄로 끝내요.
- 파일은 Write로만 써요. PowerShell·Bash는 쓰지 않아요(허락받을 사람이 없어 막혀요).
- 크롬(Claude 확장)으로 일해요. 새 탭에서 https://mail.korea.kr 을 열어요(담당자가 로그인해 둔 상태). 열리면 "받은메일함" 화면이에요 – 왼쪽 위 파란 [메일쓰기]·[내게쓰기] 단추, 그 아래 메일함 목록(받은메일함·보낸메일함·임시보관함…).
- 로그인 화면이 나오면 아무것도 쓰지 말고 마지막 답을 정확히 LOGIN_REQUIRED 한 줄로 끝내요. 비밀번호·인증서는 넣지 않아요.
- 탭이 열렸는데 화면을 읽을 수 없으면 마지막 답을 정확히 PAGE_UNREADABLE 한 줄로 끝내요.
- 진행 폴더(${m.dir})에 "_진행.json"을 {"total": 4, "done": 0} 으로 쓰고, 아래 1·2·3·4를 하나 끝낼 때마다 done을 올려요.

## 1. 메일쓰기 화면 열기
- 왼쪽 위 파란 **[메일쓰기]**를 눌러요 → 위에 "메일쓰기" 탭이 생기고, 탭 아래 [➡ 보내기]·[미리보기]·[임시저장] 단추가 보여요.
- 칸은 위에서부터: 보내는 사람(그대로 둬요) · **받는사람**(그 옆 "개별발송" 체크는 건드리지 않아요) · 참조 · 숨은참조 · **제목**("말머리선택"은 그대로) · 본문 편집기(글꼴 단추 줄 아래 넓은 칸 – 아래쪽에 "====" 서명이 미리 들어 있어요) · 꼬리말선택(그대로) · **첨부파일** 줄([파일선택]·[대용량 파일선택]·[웹폴더 파일첨부]·[파일삭제] + 아래 "마우스로 파일을 끌어서 넣어주세요" 칸).

## 2. 채우기
1. 받는사람 칸: ${m.to} (${m.toName}) – 이 주소 하나만. 참조·숨은참조는 비워요.
2. 제목 칸: ${m.subject}
3. 본문: 편집기 **맨 위**(서명 위)에 커서를 두고 아래 글을 그대로 넣어요. 서명("====" 아래)은 지우지 않아요.
${m.body
  .split("\n")
  .map((l) => `   ${l}`)
  .join("\n")}

## 3. 첨부
- 첨부파일 줄의 [파일선택]이 여는 파일 입력란(숨어 있어요)에 아래 파일을 모두 붙여요(file_upload). 붙으면 아래 "파일명" 표에 줄이 생겨요.
${m.files.map((f) => `   - ${f}`).join("\n")}
- 표에 ${m.files.length}개가 다 보이는지 글로 확인해요. 하나라도 없으면 보내지 말고 마지막 답을 ATTACH_FAILED 와 이유 한 줄로 끝내요.

## 4. 보내기
1. 받는사람·제목·첨부 수를 글로 한 번 더 확인하고 탭 아래 **[➡ 보내기]**를 눌러요.
2. 왼쪽 메일함 목록의 **[보낸메일함]**을 눌러 맨 위에 같은 제목이 있으면 마지막 답을 정확히 MAIL_SENT 한 줄로 끝내요.
3. 보내기가 안 되면(경고 창·받는사람 오류 등) MAIL_FAILED 와 이유 한 줄로 끝내요.

다른 메일을 열거나 지우지 않아요. 민원인 이름·연락처는 쓰지 않아요.
`;
}
