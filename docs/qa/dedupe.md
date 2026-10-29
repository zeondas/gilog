# 정리 ⑥ – 표 열 폭 끌기 공통 부품 · 안 쓰는 CSS (2026-10-28, `wip/dedupe`)

공통 결정 로그 10-28 00:3x(줄인 범위). 00:4x에 재서 표로 보고했고, 사용자가 08:57에 "1안 코딩시작"이라고 해서 ①1안 ②1안으로 코딩했어요. 사용자 눈에 보이는 변화는 없어요.

## 1. 재기 표 (고치기 전 main `cecbc37`)

| 화면 | 저장 키·모양 | 끌기 | 두 번 누르기 / 배치최적화 | 고정 열·자동 열 | 다른 점 |
| --- | --- | --- | --- | --- | --- |
| 민원대장 `complaints/Table.tsx` | `complaints.colRatios` = `{열: 표 폭 비율}` | `.cm-grip` · document · 최소 40 · 최대 `maxDragWidth` · body `col-dragging` · 움직였을 때만 저장 | 없음 / [배치최적화]·우클릭 = 비율 비우기 | 내용·조치내용 남는 폭 · 자동 폭(캔버스 + 28, 줄인 모양 4단계) | 비율 |
| 민원처리 `process/Table.tsx` | `process.colWidths5` = 9칸 `[px\|null]` | `.cm-grip` · document · 최소 40 · 최대 `maxWidthOf` · body `col-dragging` · 바뀌었을 때만 | 없음 / 우클릭 초기화 | 고정 3열 · 민원 요약 남는 폭 · `AUTO_COLS` 5열 | 배열 통째, `fitWidths` |
| 집행현황 `budget/Screen.tsx` | `budget.cols` = `{w, nameFixed}` | `.bd-grip` · window · 손잡이 `.drag` · 최소 36(세부사업 160) · 최대 없음 · 늘 저장 | 내용 폭 맞춤 / [배치최적화] commit 뒤 모든 열 + 알림 · 우클릭 처음대로 | 고정 5열 | `nameFixed` |
| 예산현황 `bstatus/Screen.tsx` | `bstatus.cols` = `{w: {summary, detail}}` | 집행현황과 같음 | 집행현황과 같음(글자 열 +16, `.bs` 안, commit 없음) | 고정 2열 | 보기 둘 |
| 사업 관리 창 `contacts/Dialogs.tsx` `EdgeGrip`·`ColGrip` | 저장 안 함 | window · body `ew-dragging` · 움직인 만큼 ×2(왼쪽 −2) · 반올림·최소 없음 | 가장 긴 이름에 맞춤 | – | 창이 가운데라 2배 |
| 보내기 창 `BudgetStatusSend.tsx` | `bstatus.sendCols` = `{cmt, src, rest}` | `.bd-grip` · window · `.drag` · 최소 72 · 늘 저장 | 없음 | – | (`.bss2-rsz-*`는 창 크기 손잡이 – 열이 아니라 그대로) |

정말 같은 부분: 누름 → 시작 x·시작 폭 → 움직일 때 "시작 폭 + 움직인 만큼"을 최소·최대로 자름 → 떼면 듣기 끄고 저장. 집행현황·예산현황의 칸 복사 재기 10줄은 글자까지 같아요.
화면마다 다른 부분(그 화면에 남김): 저장 모양 5가지, 최소 40/36/160/72·최대, body 클래스 / 손잡이 `.drag`, document / window, 움직였을 때만 / 늘 저장, 자동 재기 3가지, 배치최적화의 뜻.

## 2. 합친 모양 (①1안 · ②1안 – 여섯 곳 모두)

`src/ColGrip.tsx` 하나에 함수 둘만 둬요.
- `startColDrag(e, { base, min?, max?, scale?, round?, bodyClass?, grip?, on?, onMove(px), onEnd?(px | null) })` – 마우스 처리. `onEnd`는 한 번도 움직이지 않았으면 `null`.
- `contentWidth(el, grip = ".bd-grip")` – 칸을 복사해 잰 내용 폭(집행현황·예산현황 `fitOf`).

| 쓰는 곳 | 넘기는 값 |
| --- | --- |
| 민원대장 | `min: COL_MIN, max, bodyClass: "col-dragging", on: "document"`, `onEnd` = 움직였을 때만 `onResized` |
| 민원처리 | 같음, `onMove`가 배열을 만들고 바뀌었을 때만 `onResized` |
| 집행현황 | `min: 160/36, grip`, `onEnd` = 늘 `saveCols` |
| 예산현황 | 같음, 보기별 저장 |
| 사업 관리 창 | `scale: ±2, round: false, bodyClass: "ew-dragging"` |
| 보내기 창 | `min: 72, grip`, `onEnd` = 늘 저장 |

저장 키·저장 모양·DOM·클래스·`data-*`·화면 글자는 그대로예요. 화면 쪽 코드는 6파일에서 129줄 빠지고 64줄 들어갔고(−65), 새 파일이 63줄(주석·빈 줄 빼면 44)이라 **줄 수는 거의 그대로**예요(보고 때 예상 약 −70). 얻은 것은 끌기 처리가 여섯 벌에서 한 벌이 된 것이에요.

## 3. CSS

안 쓰는 클래스 후보 15개 – 코드·Rust·tools·매뉴얼 생성기에서 찾았어요.

| 클래스 | 결과 | 한 일 |
| --- | --- | --- |
| `accent-blue`·`accent-ink`·`accent-noctua`·`accent-purple` | 써요 – `"accent-" + id`(설정 강조색) | 그대로 |
| `bl-ci`·`bl-da`·`bl-sq` | 써요 – `"bl-" + 종류`(머릿기호) | 그대로 |
| `pjm-grip-l`·`pjm-grip-r` | 써요 – `"pjm-grip-" + side` | 그대로 |
| `bl-mark` | 안 써요 | complaints.css 선택자 한 줄 뺌 |
| `ct-pj-zero` | 안 써요(지금은 `ct-pj-z`) | contacts.css 규칙 2개 지움 |
| `pr-icon`·`pr-doc` | 안 써요 | process.css 규칙 4개 지움 |
| `tool-danger` | 안 써요 | dialogs.css 선택자 2곳 뺌 |
| `pr-acts` | 안 써요 | 그대로 – `!important` 규칙 안 |

`late.css` 29규칙 → **14규칙**. 옮긴 15개(옮겨도 계산된 모양이 모든 장면에서 같은 것):

| 옮긴 곳 | 규칙 |
| --- | --- |
| dialogs.css 끝 | `.dialog`(줄 색) · `:has(> .dlg-x)` 3개 · `.dlg-x` · `.dlg-x > svg` |
| calendar.css 끝 | `.dialog .cal-cbtn` |
| contacts.css 끝 | `.pchips-in` · `.dialog .pjm-row .cal-cbtn` |
| base.css 끝 | `.search input` · `.main.vp > :not(…)` · `.main.vp.main-fill` · `.btn-primary/.btn-danger.btn-xs` |
| settings.css 끝 | `.proc-dir .input.proc-mail-subject` · `.btn.btn-primary.g-login` |

남긴 14개: 일부러 뒤에 둔 것(한 줄 칸 규칙 2 · 떠 있는 메뉴 3), 옮기면 달라지는 것(지시부 메일 틀 2 – 설정 7장면에서 줄 높이 18 → 26), 장면에 나오지 않아 styles.py로 잴 수 없는 것(마우스를 올린 상태 4 · 메모 창 줄 · 하위 메뉴 뒤집기 · 검색 × 끝). `!important` 16곳은 건드리지 않았어요.

## 4. 확인

기준 = main `cecbc37` 지킴이 빌드, 고친 뒤 = `wip/dedupe` 지킴이 빌드.

- 사진 비교 전체 **92장면 통과**(허용 `complaints_newrow_baddate`·`journal_memo`·`files_find_baddate` – 이번엔 `journal_memo` 1점만, 늘 흔들리는 장면)
- `styles.py` **92장면 · 다른 장면 0**
- `behave.py` **45개 모두 통과**
- `npm run build` 통과 · `npm test` **223** 통과 · 매뉴얼 두 빌드 글 같음 **True** · 긴 줄표 **21줄**(그대로) · "기Log" **0줄**
- **끌기 시험(Playwright, 지킴이 장면에 없어서 직접)** – 두 빌드에서 같은 손놀림을 하고 결과를 견줬어요. **여섯 곳 모두 기준과 같음.**

| 곳 | 한 일 | 결과(고친 뒤 = 기준) |
| --- | --- | --- |
| 민원대장 | 연번 +40 → 접수유형 −500(최소) → 누르기만 → 다시 켜기 | 저장 `{"no":0.0653…,"intake":0.0293…}` · 끄는 중 body `col-dragging`, 뗀 뒤 없음 · 누르기만은 저장 안 바뀜 · 다시 켜도 폭 그대로 |
| 민원처리 | 번호 +40 → 접수 −500 → 누르기만 → 다시 켜기 | 저장 `[36,120,40,103,140,null,164,300,190]` · body `col-dragging` · **다시 켜면 처음 폭**(아래) |
| 집행현황 | 세부사업 +40 → 업체 −500 → 누르기만 → 원인행위 두 번 누르기 → [배치최적화] → 다시 켜기 | 저장 `{"w":{…},"nameFixed":true}` 모양 그대로 · 손잡이 `.drag` · 다시 켜도 폭 그대로 |
| 예산현황 | 같은 차례 | 저장 `{"w":{"summary":{…}}}` · 다시 켜도 폭 그대로 |
| 사업 관리 창 | 열 손잡이 +30 · 오른쪽 가장자리 +25 · 왼쪽 −20 · 두 번 누르기 | 창 폭 640 → 640 → 640 → 680 → 640 · body `ew-dragging` |
| 보내기 창(재원 둘) | 합계 +30 · 재원 −300 | 저장 `{"cmt":142,"src":124,"rest":96}` → `{"cmt":142,"src":72,"rest":96}` · 손잡이 `.drag` |

**찾은 것(고치지 않음 – 민원처리 대기 목록에 적음)**: 민원처리는 끈 폭이 저장되지만, 다시 켜면 처음 폭으로 돌아가요. 저장 값 첫 칸(체크 열 36)이 `readWidths`의 "≥ `COL_MIN` 40" 검사에 걸리기 때문이에요. main 빌드에서 첫 칸만 40으로 바꿔 넣으면 그 폭으로 읽혀요. 이번 일은 동작을 바꾸지 않는 정리라 그대로 뒀어요.

`tools/guard/__pycache__`는 되돌렸어요.
