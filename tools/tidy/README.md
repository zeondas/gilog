# CSS 나누기 (tools/tidy)

2026-10-26 정리 2차 세션(사용자 ①~⑤ 1안)이 `src/app.css`(12,043줄)를 `src/styles/`로 나눈 도구예요. 다시 돌릴 일은 거의 없고, **어느 절이 어느 파일로 갔는지 기록**으로 남겨 둬요.

- `split-css.mjs classify <app.css> <map.json>` – 절(맨 위 주석 하나부터 다음 주석 앞까지)마다 이름표를 가장 많이 쓰는 화면으로 자동 판정
- `split-css.mjs split <app.css> <map.json> <out>` – map대로 글자 그대로 잘라 `out/*.css` + `index.css`(불러오는 순서)
- `css-map.json` – 321절의 보낼 곳(손으로 고친 것 포함). `{"to": …, "cuts": [["줄 첫 글자", 파일]]}`는 절 중간에서 잘라 뒷부분을 다른 파일로 보내요.

불러오는 순서(`src/styles/index.css`): base → dialogs → settings → contacts → journal → complaints → tasks → calendar → process → files → budget → bstatus → **late**.
`late.css`는 다른 파일 규칙을 같은 무게로 덮어서 **꼭 맨 뒤에 있어야 하는 것만** 모았어요(한 줄 칸 규칙, 떠 있는 메뉴 한 모양, 창 닫기 ×, 공통 부품 ✔8, 창 크기 등).

확인한 것(나눈 뒤 0이어야 해요):
1. 묶인 CSS 크기·규칙 집합이 전과 같음(187,710바이트, 2,130규칙)
2. `tools/guard/styles.py` – 88장면 모든 요소의 계산된 모양 값이 같음
3. 순서가 뒤집힌 같은 무게 규칙 짝을 상태(마우스 올림·포커스 등)를 떼고 실제 요소에 대어 봄 – 같은 요소에 걸리는 짝 0(값까지 똑같은 짝 하나 `.cm-bullets`·`.bl-list`는 해 없음)
4. 지킴이 사진 비교·동작 시험

다시 재기: `node tools/tidy/pairs.mjs <원래 app.css> tools/tidy/css-map.json /tmp/cand.json` → `python3 tools/tidy/pairs_check.py <기준 빌드> /tmp/cand.json`(원래 app.css는 `git show 0a654b0:src/app.css`).
