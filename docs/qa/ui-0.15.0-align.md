# 글자 가운데 맞춤 재기 — 1600×900 (2026-10-18)

- 기준: 박스 안 위 여백 − 아래 여백 = 0 또는 −1 이면 맞음(CLAUDE.md "공통 — 글자 가운데 맞춤"). 뷰포트 1600×900, 배율 1, 글꼴 Pretendard(앱에 든 것, `document.fonts.check` 참).
- 도구: `tools/align/run2.py`·`measure.py`를 바탕으로 작업 폴더에 복사본(`run1600.py`·`measure_ws.py`)을 만들어 돌렸어요. 저장소의 `measure.py`에는 `run2.py`가 부르는 `run()`이 없어 원본 그대로는 돌아가지 않아요(0.9.4 세션이 덮어쓴 듯). 저장소 파일은 고치지 않았어요.
- 복사본에서 바꾼 것: 뷰포트 1600×900, 창(`.overlay`)이 떠 있으면 창 안쪽만 재기(예전엔 뒤 흐려진 요소까지 세어 어긋남이 부풀었어요), 어둡게 테마, `td`·`th`·`select`·`textarea`도 봄, 화면마다 스크린샷 저장, 흉내 자료 날짜를 오늘로.
- 통계에서 뺀 것(박스 안 글자가 아님): 업무일지 왼쪽 달력 날짜 칸 `jcal-day`(40px 칸 위에 숫자, 아래에 점 — 설계상 위 정렬), 캘린더 일정 띠 `cal-ev`(동그라미·점이 섞임), 할 일 "완료됨" 접기 머리줄 `td-done`(아래 테두리가 잡힘), 탐색기 탭 + 단추 `fx-tab-add`, `jtel`·`cal-ev dot`(README).

## 전체

| 테마 | 잰 요소 | 맞음 | 비율 |
| --- | --- | --- | --- |
| 밝게 | 679 | 503 | 74.1% |
| 어둡게 | 680 | 547 | 80.4% |

밝게 분포(위−아래): -8: 2, -7: 4, -6: 2, -5: 2, -4: 2, -2: 106, -1: 351, +0: 152, +1: 49, +2: 6, +7: 1, +11: 1, +15: 1

(참고: 1920×1080 예전 재기 54% → 시안 82%. 이번에는 창 밖 요소를 뺀 방식이라 수치를 바로 비교하긴 어려워요. 어둡게가 더 높은 것은 입력칸 글자 색 대비 차이로 −2가 덜 잡혀서예요.)

## 묶음별 어긋남(밝게, 여러 화면 합계)

| 선택자 | 어긋남/전체 | 위−아래 | 보기 | 풀이 |
| --- | --- | --- | --- | --- |
| `input.cell-input` | 43/71 | -5×1, -2×42 | 기타, 김민수, 도로관리과 | 입력칸 글자 1px 높음 — 0.9.4의 `padding-bottom:2px`로도 남음. 1px 더 내리면(padding-top +1 또는 bottom 3px) 맞을 것 |
| `input.cell-input.num` | 31/53 | -5×1, -2×10, +1×20 | 010-, 010-9999, 031- | 숫자 칸은 1px 차이 허용(사용자 확정) — +1은 그대로 둬도 됨, −2는 cell-input과 같은 원인 |
| `button.cm-hbtn` | 19/19 | +1×19 | 민원유형, 상태, 접수유형 | 민원대장 열 제목 단추 글자 1px 낮음 — padding-bottom 1px |
| `span.pr-d` | 12/12 | -2×12 | D-4, D-5, D-6 | 민원처리 남은 날 배지(D-6) 글자 1px 높음 — padding-top 1px |
| `input.input` | 10/19 | -2×9, +1×1 | 도로관리과 전훈, 바꿀 글자 (비, 새 민원유형 | 설정·관리 창 입력칸 — cell-input과 같은 원인 |
| `input.cell-input.pr-in` | 10/28 | -2×10 | 1, 15, 4 | 공사 관리 창 입력칸 — 같은 원인 |
| `button.fx-drv` | 6/6 | -7×2, -6×2, +2×2 | C:, D:, F: | 탐색기 드라이브 단추: 아이콘 + 글자, 고른 것은 아래 띠 — 도구가 아이콘·띠를 글자로 봄. 눈으로 확인 필요 |
| `select.input` | 5/8 | -2×3, +1×1, +2×1 | 2일 전부터, yyyy-mm-, 보통 (13) | select 는 브라우저 그림 — ±2 섞임, 윈도우에서 다시 봐야 함 |
| `button.cal-kp-btn` | 4/4 | -2×4 | 업무 일정 | 캘린더 종류 고르기 단추 글자 1px 높음(점 + 글자) |
| `span.kb-cap` | 4/52 | -2×4 | Ctrl | 키 설정 'Ctrl' 조각 4곳만 −2(나머지 48곳 맞음) — 글자 모양(대문자만)일 가능성 |
| `span.pr-d.urgent` | 3/3 | -2×3 | D-1 | 위와 같음 |
| `button.pr-tpl` | 3/3 | +1×3 | 지시부_가드레일, 지시부_도로시설, 지시부_도로포장 | 공사 관리 창 양식 단추(아이콘+파일 이름) 1px 낮음 |
| `input.input.fx-mono` | 3/3 | +1×2, +2×1 | *.jpg;*., [e], [n] | 일괄 이름 바꾸기 고정폭 글자 칸 — 글꼴이 달라(모노) 1~2px 낮음 |
| `input.input.input-sm` | 3/3 | -2×3 | 새 항목 | 설정 목록 '새 항목' 칸 — 같은 원인 |
| `button.btn.btn-ctrl` | 2/53 | -2×2 | 오늘 | 53곳 중 '오늘' 2곳만 — 괜찮음 |
| `textarea.cell-input.jtalk` | 2/2 | -4×2 | 설계 변경 검토 | 업무일지 말 줄 textarea −4: 여러 줄 칸이라 위 맞춤 — 박스 기준이 아님(제외해도 됨) |
| `button.tb` | 2/6 | -2×2 | 가 | 메모 편집기 도구 단추 '가' 1px 높음 |
| `button.cm-status.cm-status-btn` | 2/23 | +11×1, +15×1 | 보류, 완료 | 상태 목록이 열린 상태의 배지 2개만 — 펼쳐진 목록이 겹쳐 잘못 잼 |
| `input.input.fx-filter` | 2/2 | -8×2 | 빠른 필터 | 탐색기 빠른 필터(아이콘 포함) — 도구 오차 가능, 눈 확인 |
| `button.fx-vb.fx-menu-btn` | 2/2 | -7×2 | 자세히 ▾ | 탐색기 '자세히 ▾' — ▾ 글자 때문, 눈 확인 |
| `div.fx-status` | 2/2 | +1×2 | 파일 13개 · | 탐색기 아래 상태 줄 1px 낮음 |
| `span.jp-field-box` | 1/2 | +2×1 | (일) |  |
| `button.jp-day.red` | 1/1 | +2×1 | 18 |  |
| `span.fx-target` | 1/1 | -2×1 | 대상 |  |
| `div.ccard-memo` | 1/1 | +7×1 | 메모 추가 |  |
| `button.(없음)` | 1/5 | -2×1 | 월 |  |
| `input.td-add-title` | 1/4 | +1×1 | 제목 |  |

## 화면·창마다 (밝게 / 어둡게)

| 화면·창 | 밝게 맞음/전체 | 어둡게 맞음/전체 | 어긋난 요소(밝게: 선택자 위−아래 ×개수) |
| --- | --- | --- | --- |
| 업무일지 | 13/13 | 13/13 | — |
| 업무일지-고치기 | 18/21 | 18/21 | `input.cell-input` -2×2; `textarea.cell-input.jtalk` -4×1 |
| 업무일지-지우기묻기 | 18/21 | 18/21 | `input.cell-input` -2×2; `textarea.cell-input.jtalk` -4×1 |
| 업무일지-메모편집기 | 16/18 | 16/18 | `input.cell-input` -2×1; `button.tb` -2×1 |
| 업무일지-인쇄창 | 3/5 | 3/5 | `span.jp-field-box` +2×1; `button.jp-day.red` +2×1 |
| 민원대장 | 8/20 | 11/20 | `input.cell-input` -2×5; `button.cm-hbtn` +1×4; `input.cell-input.num` +1×3 |
| 민원대장-분류관리 | 13/16 | 16/16 | `input.input` -2×3 |
| 민원대장-상태목록 | 10/24 | 13/24 | `input.cell-input` -2×5; `button.cm-hbtn` +1×4; `input.cell-input.num` +1×3; `button.cm-status.cm-status-btn` +11×1; `button.cm-status.cm-status-btn` +15×1 |
| 민원대장-고치기 | 10/29 | 13/29 | `input.cell-input` -2×9; `input.cell-input.num` +1×6; `button.cm-hbtn` +1×4 |
| 민원대장-메모 | 3/4 | 3/4 | `button.tb` -2×1 |
| 민원대장-지우기묻기 | 12/31 | 15/31 | `input.cell-input` -2×9; `input.cell-input.num` +1×6; `button.cm-hbtn` +1×4 |
| 민원대장-엑셀메뉴 | 8/19 | 11/19 | `input.cell-input` -2×4; `button.cm-hbtn` +1×3; `input.cell-input.num` +1×2; `input.cell-input.num` -5×1; `input.cell-input` -5×1 |
| 민원대장-엑셀가져오기창 | 2/2 | 2/2 | — |
| 민원처리-빈화면 | 5/5 | 5/5 | — |
| 민원처리 | 21/29 | 24/29 | `span.pr-d` -2×4; `input.cell-input.pr-in` -2×3; `span.pr-d.urgent` -2×1 |
| 민원처리-고치기 | 21/29 | 24/29 | `span.pr-d` -2×4; `input.cell-input.pr-in` -2×3; `span.pr-d.urgent` -2×1 |
| 민원처리-지우기묻기 | 23/31 | 26/31 | `span.pr-d` -2×4; `input.cell-input.pr-in` -2×3; `span.pr-d.urgent` -2×1 |
| 민원처리-공사관리창 | 6/10 | 5/10 | `button.pr-tpl` +1×3; `input.cell-input.pr-in` -2×1 |
| 집행현황 | 5/5 | 5/5 | — |
| 집행현황-펼침 | 11/11 | 11/11 | — |
| 집행현황-엑셀메뉴 | 5/5 | 5/5 | — |
| 집행현황-엑셀가져오기창 | 5/5 | 5/6 | — |
| 집행현황-줄우클릭메뉴 | 9/9 | 9/9 | — |
| 탐색기 | 11/24 | 10/24 | `button.fx-drv` -6×2; `button.fx-drv` +2×2; `button.fx-drv` -7×2; `input.input.fx-filter` -8×2; `button.fx-vb.fx-menu-btn` -7×2; `div.fx-status` +1×2; `span.fx-target` -2×1 |
| 탐색기-일괄이름바꾸기창 | 14/19 | 14/19 | `input.input.fx-mono` +1×2; `input.input` +1×1; `input.input.fx-mono` +2×1; `select.input` +2×1 |
| 업무연락처 | 9/12 | 12/12 | `input.cell-input.num` -2×2; `input.cell-input` -2×1 |
| 업무연락처-프로젝트관리 | 5/6 | 6/6 | `input.input` -2×1 |
| 업무연락처-고치기 | 14/20 | 18/20 | `input.cell-input.num` -2×3; `input.cell-input` -2×3 |
| 업무연락처-지우기묻기 | 11/15 | 14/15 | `input.cell-input.num` -2×2; `input.cell-input` -2×1; `div.ccard-memo` +7×1 |
| 캘린더 | 6/10 | 7/10 | `button.btn.btn-ctrl` -2×1; `button` -2×1; `input.cell-input.num` -2×1; `button.cal-kp-btn` -2×1 |
| 캘린더-관리 | 10/11 | 11/11 | `input.input` -2×1 |
| 캘린더-알림확인 | 2/2 | 2/2 | — |
| 캘린더-상세 | 7/9 | 8/9 | `input.cell-input.num` -2×1; `button.cal-kp-btn` -2×1 |
| 캘린더-주 | 7/10 | 8/10 | `button.btn.btn-ctrl` -2×1; `input.cell-input.num` -2×1; `button.cal-kp-btn` -2×1 |
| 캘린더-일정고치기 | 11/12 | 11/12 | `button.cal-kp-btn` -2×1 |
| 할 일 목록 | 8/8 | 8/8 | — |
| 할 일-추가 | 9/10 | 9/10 | `input.td-add-title` +1×1 |
| 설정 | 3/5 | 3/5 | `input.input` -2×1; `select.input` -2×1 |
| 설정2 | 8/11 | 8/11 | `select.input` -2×2; `select.input` +1×1 |
| 설정3 | 33/35 | 33/35 | `span.kb-cap` -2×2 |
| 설정4-키설정 | 41/43 | 41/43 | `span.kb-cap` -2×2 |
| 설정5 | 20/24 | 23/24 | `input.input.input-sm` -2×3; `input.input` -2×1 |
| 설정6 | 8/9 | 8/9 | `input.input` -2×1 |
| 설정7 | 19/20 | 20/20 | `input.input` -2×1 |
| 잠금 | 2/2 | 2/2 | — |

## 못 잰 것·한계

- 못 연 화면·창은 없어요(밝게·어둡게 각 49장, 실패 0). 스크린샷: `shots-ws/<이름>-light.png`, `-dark.png`.
- 민원처리는 흉내 자료가 비어 있어 '민원 불러오기'(보기 민원 5건)를 누른 뒤 쟀어요(`민원처리-빈화면`은 누르기 전). 집행현황은 `window.__budgetFake.import`로 세부사업 2개를 넣고 쟀어요(seed.js에는 없어요).
- 엑셀 가져오기 창은 브라우저 미리 보기의 '내보내기 → 가져오기'(메모리 흉내)로 열었어요. 집행현황 가져오기 창은 같은 방법으로 열리지 않고 '파일을 열지 못했어요' 안내(bd-toast)만 떠서 그 안내 줄만 쟀어요.
- 업무일지 메모 편집기는 구분 칸에 '메모'를 치고 Tab — 편집기 도구 줄까지 잡혔어요. 설정은 세로로 4,760px이라 7번에 나눠 쟀고 키 설정 카드는 `설정4-키설정`이에요.
- `select`(설정 날짜 모양·시작 화면, 일괄 이름 바꾸기 대소문자 등)는 리눅스 크로미움 그림이라 윈도우 WebView2와 다를 수 있어요. 탐색기 드라이브 단추·빠른 필터·'자세히 ▾'는 아이콘·화살표가 섞여 도구 수치가 믿기 어려워 눈으로 봐야 해요.
- 도구 한계: 글자 색이 배경과 90 미만으로 차이 나면(흐린 placeholder) 안 잡혀요. 1600×900 창은 리눅스 크로미움(Playwright 1.56, chromium-1194)으로 쟀어요 — 윈도우 WebView2에서 글자 그리기(ClearType)가 달라 ±1px 차이가 날 수 있어요.

## 다음에 고치면 좋은 순서(제안)

1. 입력칸 글자 1px 높음(`cell-input`·`input`·`input-sm`·`pr-in`, 밝게 −2 약 70곳): 0.9.4의 `padding-bottom: 2px`를 3px로(또는 `padding-top: 1px` 추가) — 숫자 칸(`num`)이 +1로 뒤집히지 않는지 함께 확인.
2. 민원대장 열 제목 `cm-hbtn` 19곳 +1 → `padding-bottom: 1px`.
3. 민원처리 `pr-d` 배지 15곳 −2 → `padding-top: 1px`. 캘린더 `cal-kp-btn` 4곳, 메모 편집기 `tb` 2곳, 공사 관리 `pr-tpl` 3곳도 같은 1px 손질.
4. 탐색기(`fx-drv`·`fx-filter`·`fx-menu-btn`·`fx-mono`)는 스크린샷을 10배로 확대해 눈으로 확인한 뒤 결정.
