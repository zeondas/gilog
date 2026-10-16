# 글자 가운데 맞춤 재기 (tools/align)

박스·배지·버튼·입력칸 안에서 글자가 칠해진 부분의 위·아래(좌·우) 여백을 픽셀로 재는 도구예요. 2026-10-17 세션이 만들었어요.

- 기준: 1920×1080, 배율 1(사용자 PC 100%). 글꼴은 사용자 PC와 같아야 해요 — Pretendard를 앱에 넣기 전에는 Noto Sans KR(구글 폰트 `NotoSansKR[wght].ttf`를 `~/.fonts`에 넣고 `fc-cache -f`).
- 맞음 = 위 − 아래 가 0 또는 −1 (남는 1px은 아래, 사용자 1안).

## 쓰는 법
1. 브라우저 미리 보기의 흉내 자료를 채우려고 `src/api.ts`의 `fake` 선언 바로 아래에 **잠깐** `(window as any).__fake = fake;`를 넣고 `npx vite build --outDir <작업 폴더>/site`로 빌드한 뒤 되돌려요(올리지 않아요). `seed.js`가 이 자리에 예시 자료를 넣어요.
2. `<작업 폴더>/site`를 `python3 -m http.server 5175`로 띄워요.
3. `python3 run2.py 결과.json [추가.css ...] [추가.js]` — 모든 화면과 창을 열어 재요. `.css`/`.js`를 주면 넣고 재요(시안 시험용, `proposal.css`·`snap.js`).
4. `python3 verify.py 지금.json 시안.json` — 맞는 비율과 아직 어긋난 묶음을 보여 줘요.

`jtel`(업무일지 연락처 글줄)과 `cal-ev dot`(주 보기 여러 줄 일정)은 박스가 아니라 빼고 봐요. 괄호·숫자가 섞인 글은 글자 모양 때문에 1px 차이가 남아도 괜찮아요(사용자 확정).
