# 쪼개기 보기 – 예산현황 (정리 8차 1묶음, `wip/split-bstatus`)

틀은 [split.md](https://github.com/zeondas/gilog/blob/main/docs/qa/split.md). 근거: [CLAUDE.md](https://github.com/zeondas/gilog/blob/main/CLAUDE.md) 공통 결정 로그 2026-10-27 19:2x(파일 단위로 옮기기만). 우두머리가 묶음 빌드 뒤 split.md로 모아요.

### 보기 – 예산현황 (1,051줄 → 1파일)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/bstatus/Screen.tsx) | 머리 설명, 옛 `src/BudgetStatusScreen.tsx` 전부 – `ICON`·`CD`·`CR`·`GEAR`·`UNIT_KEY`·`VIEW_KEY`·`YEAR_KEY`·`ORDER_KEY`, `Col`·`FIXED`·`COLS_KEY`·`SUM_COLS`·`DET_COLS`·`EDIT_FIELDS`, `Pop`·`Ask`·`Form`, `BudgetStatusScreen`(몸통 안 조각 `menuBody`·`numCells`·`seg`·`mi` 등은 떼지 않음) | 1,052 |

바깥 함수가 화면 하나뿐이라 Table·Dialogs·Menu·keys·parts는 만들지 않았어요(함께 쓰는 조각이 없음). `BudgetStatusSend.tsx`는 집행현황도 써서 `src/`에 그대로, 규칙 `budgetStatus.ts`·`budgetStatusImport.ts`·`budget.ts`도 그대로예요. 바뀐 것은 import 경로(`../../`)와 머리 설명 한 줄, `App.tsx` import 한 줄뿐이에요.

확인(split.md 3장 4번·4장): 줄 견주기 머리 설명 줄만 다름 · 예산현황 장면 6개 compare·styles 0, behave `budgetstatus_menu` 통과 · 전체 compare 92장면 통과(허용 셋) · `styles.py` 전체는 `complaints_import_merge` 알림 거품(`.xl-toast`) 한 요소만 달랐고 그 장면만 두 번 다시 돌리면 0이라 흔들림으로 봤어요(예산현황과 상관없는 민원대장 장면) · `behave.py` 전부 통과 · `npm run build`·`npm test` 223 통과 · 매뉴얼 글 같음(True) · 긴 줄표 21줄·"기Log" 0줄 그대로.
