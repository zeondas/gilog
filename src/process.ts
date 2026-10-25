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

/** 이미 있는 접수번호(Claude가 같은 민원을 다시 가져오지 않게) */
export type Known = { nos: string[] };

/** 신문고 화면 안에서 돌리는 명령(javascript_tool) – 지침에 그대로 넣어 Claude가 찾지 않고 바로 써요(2026-10-21 22:48 사용자 ②1안 지름길).
 *  화면 구조(2026-10-21 시연): 첫 화면에 숨은 "민원처리" 링크(onclick에 PttnPrcsList) · 목록 줄 첫 칸 = 신청번호(누르면 이력 팝업 – 누르지 않음),
 *  둘째 칸 = 제목 링크(fn_viewPttn) · 상세 [첨부파일일괄다운로드](fn_fileAllDown, 같은 단추가 숨은 것까지 두 벌) · [목록] · 첨부 이름 링크(gfn_fileDownload). */
export const EPEOPLE_JS = {
  /** 첫 화면 → 민원처리 목록 */
  toList: `(()=>{const a=[...document.querySelectorAll('a')].find(a=>a.textContent.trim()==='민원처리'&&/PttnPrcsList/.test(a.getAttribute('onclick')||''));if(!a)return 'NO_LINK';a.click();return 'ok'})()`,
  /** 목록: 전체 건수·이 쪽 신청번호(줄 첫 칸만 – 제목 안의 다른 번호·민원인 열은 읽지 않음)·쪽 번호 링크 */
  readList: (known: string[]) =>
    `(()=>{const known=new Set(${JSON.stringify(known)});const nos=[...document.querySelectorAll('table tbody tr')].map(t=>((t.children[0]&&t.children[0].innerText)||'').match(/1AA-\\d{4}-\\d{7}/)).filter(Boolean).map(m=>m[0]);const total=(document.body.innerText.match(/전체\\s*(\\d+)\\s*건/)||[])[1]||'';const pages=[...document.querySelectorAll('a')].filter(a=>a.offsetParent&&/^\\d{1,3}$/.test(a.textContent.trim())&&!a.closest('table tbody')).map(a=>a.textContent.trim());return {total,new:nos.filter(n=>!known.has(n)),known:nos.filter(n=>known.has(n)).length,pages}})()`,
  /** 목록에서 그 번호의 둘째 칸(제목) 링크 누르기 – 없으면 NO_ROW(다른 쪽에 있음) */
  open: `(()=>{const no='NO';const tr=[...document.querySelectorAll('table tbody tr')].find(t=>((t.children[0]&&t.children[0].innerText)||'').includes(no));const a=tr&&tr.children[1]&&tr.children[1].querySelector('a');if(!a)return 'NO_ROW';a.click();return 'ok'})()`,
  /** 목록 쪽 번호 누르기(쪽이 여럿일 때) */
  page: `(()=>{const a=[...document.querySelectorAll('a')].find(a=>a.offsetParent&&a.textContent.trim()==='P'&&!a.closest('table tbody'));if(!a)return 'NO_PAGE';a.click();return 'ok'})()`,
  /** 상세: 필요한 칸만 읽고 [첨부파일일괄다운로드] 자리를 스크린샷 좌표로(W = 스크린샷 좌표 폭) */
  read: `(()=>{const W=FRAME_W;const T=document.body.innerText;const g=r=>(T.match(r)||[])[1]||'';const att=[...new Set([...document.querySelectorAll('a[onclick*="gfn_fileDownload"]')].map(a=>a.textContent.trim()))];const head=[...document.querySelectorAll('th,td')].find(e=>e.innerText.trim().startsWith('<첨부파일>'));const tr=head&&head.closest('tr');const body=tr?tr.lastElementChild.innerText.trim().slice(0,3000):'';const b=[...document.querySelectorAll('a')].find(a=>a.textContent.replace(/\\s/g,'')==='첨부파일일괄다운로드'&&a.offsetParent);let click=null;if(b){b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();const k=W/innerWidth;click=[Math.round((r.x+r.width/2)*k),Math.round((r.y+r.height/2)*k)]}return {no:g(/(1AA-\\d{4}-\\d{7})/),received:g(/접수일시\\s*(\\d{4}-\\d{2}-\\d{2})/),due:g(/처리완료예정일\\s*:?\\s*(\\d{4}-\\d{2}-\\d{2})/),place:g(/\\[사고발생지역\\]\\s*([^\\n]+)/),safety:/안전신문고|안전제보/.test(T),att,body:body||'(본문 칸을 못 찾음 – get_page_text로 읽기)',click}})()`,
  /** 상세 → [목록] 단추(글자가 정확히 "목록"인 것만 – 바로 옆 [저장]은 누르지 않음) */
  back: `(()=>{const a=[...document.querySelectorAll('a,button')].find(a=>a.offsetParent&&a.textContent.replace(/\\s/g,'')==='목록');if(!a)return 'NO_LIST';a.click();return 'ok'})()`,
};

/** Claude에게 줄 지침. [민원 불러오기]가 Claude에게 넘기고, 설정의 [지침 복사]로도 복사해요.
 *  2026-10-21 2차(사용자 22:48·22:59): 신문고 안은 화면 안 명령(EPEOPLE_JS)으로 바로 다니고, 첨부는 [첨부파일일괄다운로드]를 커서로 진짜 눌러
 *  `접수번호.zip`으로 받아요(앱이 풀어 위치도·현장사진으로 나눔). 나갈 때는 [목록] 단추.
 *  접수번호로만 걸러요(2026-10-20 사용자): known.nos = 지금 민원처리 표에 있는 번호뿐 – 지운 민원은 표에 없으니 다시 와요. */
export function aiGuide(p: { inbox: string; downloads: string; outbox: string }, works: { id: number; name: string; scope: string }[], known: Known = { nos: [] }): string {
  const list = works.length ? works.map((w) => `  - ${w.id}: ${w.name} – ${w.scope || "(처리 범위 없음)"}`).join("\n") : "  - (등록된 공사가 없어요 – work는 null)";
  const J = EPEOPLE_JS;
  return `# 기록 민원처리 지침

## 0. 규칙
- **맨 먼저 브라우저를 골라요**: list_connected_browsers로 이어진 브라우저를 보고, 이름에 Chrome(크롬)이 든 것을 select_browser로 골라요. 이름이 "Browser 1"처럼 종류를 알 수 없으면 첫 것을 골라요. 이름에 Edge(엣지)가 든 것은 고르지 않아요 – 회사 정책으로 IE 모드라 읽지 못해요. 고를 브라우저가 하나도 없으면 아무것도 하지 말고 마지막 답을 정확히 NO_CHROME 한 줄로 끝내요.
- 파일은 Write로만 써요. PowerShell·Bash는 쓰지 않아요(허락받을 사람이 없어 막혀요).
- **신문고 안에서는 아래 "화면 안 명령"을 javascript_tool(action "javascript_exec")로 그대로 돌려요.** 글자를 찾느라 find·get_page_text를 쓰지 않아요 – 명령이 'NO_…'를 돌려주거나 값이 비었을 때만 get_page_text로 한 번 읽어요. 명령 안의 NO·P·FRAME_W 자리만 바꿔 넣고 나머지는 고치지 않아요.
- **누르는 것은 이 지침의 명령과 [첨부파일일괄다운로드] 커서 누르기뿐이에요.** 그 밖(검색·조회·초기화·**인쇄·저장**·엑셀·결재·처리·이송·답변 작성·개인정보·민원인 이름·신청번호(이력 창)·첨부 파일 이름 하나하나·팝업 단추)은 누르지 않아요.
- 화면은 글로 읽어요. 스크린샷은 **딱 한 번**만 – 첫 상세 화면에서 computer screenshot(scale 0.1)으로 결과의 "coordinate frame: W×H"에서 W를 알아내요(커서 좌표 계산용). 그 밖에는 찍지 않아요. 사진 파일은 열어 보지 않아요.
- **받은 첨부 파일은 찾거나 기다리지 않아요** – 기록앱이 받는 폴더(${p.downloads})를 지켜보다 풀어서 붙여요. Glob·Read로 다운로드 폴더를 뒤지지 않아요.
- 한 번에 묶을 수 있는 것은 묶어요(browser_batch, 그리고 Write는 같은 차례에 함께). 생각은 짧게, 걸음은 아래 순서 그대로.
- 민원인 이름·연락처는 어디에도 쓰지 않아요(목록의 "민원인" 열은 읽지 않아요). 개인정보 창은 열지 않아요. 민원 제목은 담당자가 붙인 것이라 판단에 쓰지 않아요.
- 로그인 화면이 나오거나 로그인이 풀려 있으면 아무것도 쓰지 말고, 마지막 답을 정확히 LOGIN_REQUIRED 한 줄로 끝내요(인증서 로그인은 담당자가 해요).
- 탭이 열렸는데 화면을 읽을 수 없으면(IE 모드, 글 읽기 실패) 아무것도 쓰지 말고, 마지막 답을 정확히 PAGE_UNREADABLE 한 줄로 끝내요. 로그인 문제로 짐작하지 않아요.
- 가져올 폴더: ${p.inbox}

## 화면 안 명령
- ㄱ 목록으로(첫 화면에서): ${J.toList}
- ㄴ 목록 읽기: ${J.readList(known.nos)}
- ㄷ 그 민원 열기(NO = 접수번호): ${J.open}
- ㄹ 쪽 번호 누르기(P = 쪽 번호): ${J.page}
- ㅁ 상세 읽기(FRAME_W = 위 W 숫자): ${J.read}
- ㅂ [목록]으로 나가기: ${J.back}

## 1. 목록까지
1. 새 탭을 열어 ${PORTAL_URL} 를 열고(첫 화면만 주소로 열려요 – 목록 주소를 바로 열면 405) 1.5초 기다린 뒤 ㄱ → 1.5초 → ㄴ을 한 browser_batch로 돌려요.
2. ㄱ이 'NO_LINK'면 get_page_text로 한 번 읽어 로그인 화면인지(LOGIN_REQUIRED) 읽을 수 없는지(PAGE_UNREADABLE) 봐요. 로그인돼 있는데 링크만 없으면 화면대로 가요: 위 파란 메뉴 "민원"을 누르면 **"나의 할 일" 화면**이 열리고, 파란 띠 둘째 줄 탭(나의할일 · 민원처리 · 사후관리 · 민원관리 · 민원·정책 질의응답) 중 **"민원처리"**를 눌러요.
3. ㄴ 결과: total = 전체 건수, new = 가져올 후보(이미 있는 번호는 명령이 뺐어요), known = 뺀 수, pages = 쪽 번호. total이 10을 넘으면 ㄹ로 다음 쪽을 열고(1.5초) ㄴ을 다시 돌려 후보를 모아요 – 어느 쪽에서 나온 번호인지 기억해요.
4. 후보가 없으면 바로 "새 민원 0건"으로 끝내요. 있으면 가져올 폴더에 "_진행.json"을 {"total": 후보 수, "done": 0, "skipped": known 합} 로 써요. 한 건을 끝낼 때마다 done을 올려요.

## 2. 한 건마다 (후보 순서대로)
1. ㄷ(그 번호) → 1.5초 → ㅁ 을 한 browser_batch로. ㄷ이 'NO_ROW'면 그 번호가 있던 쪽을 ㄹ로 열고 다시 ㄷ.
2. 첫 건이면 ㅁ 전에 computer screenshot(scale 0.1)을 한 번 찍어 W를 알아내요(그 뒤로는 같은 W).
3. ㅁ 결과로 판단해요: received(접수일), due(처리완료예정일 = 기한), place([사고발생지역] 줄 – 없으면 body에서 주소), att(첨부 이름들), safety(안전신문고 민원), body(본문).
4. 첨부(att)에 그림·zip(jpg·jpeg·png·zip)이 있으면: **click 좌표를 computer left_click(coordinate)로 한 번 눌러** [첨부파일일괄다운로드] – 파일은 "접수번호.zip"으로 내려와요. 2초 기다린 뒤 다음 걸음으로(받은 파일은 보지 않아요). 그림이 없으면 누르지 않아요. click이 null이면 누르지 않고 photos를 []로.
5. 위치는 주소(리·동 + 지번)만 적어요. "앞", "버스정류장 뒤" 같은 말은 빼요. 본문에 주소가 분명하지 않으면 "주소불명".
6. 아래 공사의 처리 범위를 보고 공사 번호를 골라요. 애매하거나 공사 대상이 아니면 null.
${list}
7. 가져올 폴더에 "<접수번호>.json"을 UTF-8로 쓰고 "_진행.json"의 done을 올려요(둘 다 Write – 다음 걸음 browser_batch와 같은 차례에 보내요).
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
  "photos": ["1AA-2610-0309895.zip"],
  "map": ""
}
- received·due는 YYYY-MM-DD, area는 읍면동, short는 공사내용이에요 – 지시부 제목 줄 "1. 공사내용 (주소)"와 파일 이름에 써요. 간결하게 두세 낱말(예: 포트홀 보수, 반사경 교체, 가드레일 정비).
- summary는 민원 요약 한 줄, reason은 판단 이유 한 줄이에요. 민원인 이름·연락처는 쓰지 않아요.
- photos: 일괄 받기를 눌렀으면 ["<접수번호>.zip"](앱이 풀어 위치도와 현장사진으로 나눠요), 안 눌렀으면 []. map은 "".
8. 다음 건으로: [첨부 누르기 → 2초 →] ㅂ → 1.5초 → ㄷ(다음 번호) → 1.5초 → ㅁ 을 한 browser_batch로 보내요. ㅂ이 'NO_LIST'거나 목록이 안 보이면 navigate로 ${PORTAL_URL} 를 다시 열고 1단계처럼 ㄱ부터.
9. 마지막 건은 첨부를 누른 뒤 3초 기다리고 끝내요(받기가 시작되게).

## 3. 끝
- 다 끝나면 마지막 답을 "새 민원 N건" 한 줄로 끝내요.
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
3. [보내기]는 됐는데 보낸메일함에서 같은 제목을 못 찾으면 다시 보내지 말고 마지막 답을 정확히 MAIL_UNCONFIRMED 한 줄로 끝내요(담당자가 확인해요).
4. 보내기가 안 되면(경고 창·받는사람 오류 등) MAIL_FAILED 와 이유 한 줄로 끝내요.

다른 메일을 열거나 지우지 않아요. 민원인 이름·연락처는 쓰지 않아요.
`;
}
