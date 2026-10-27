# 큰 화면 쪼개기 – 집행현황 (정리 8차 1묶음 `wip/split-budget`)

틀은 [split.md](https://github.com/zeondas/gilog/blob/main/docs/qa/split.md) 1~4장 그대로예요. 근거: [CLAUDE.md](https://github.com/zeondas/gilog/blob/main/CLAUDE.md) 공통 결정 로그 2026-10-27 19:2x(파일 단위로 옮기기만)·19:06(1묶음 동시, 이 문서는 우두머리가 묶음 빌드 뒤 split.md로 모아요)·09:03.

### 보기 – 집행현황 (1,994 + 138 + 225줄 → 2파일)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/budget/Screen.tsx) | 옛 `src/BudgetScreen.tsx` 전부 – 머리 설명, 바깥 상수·타입 `COLS`·`COLS_SOLO`·`FIXED`·`START_W`·키 이름·`Sel`·`selKey`·`Cells`·`NUM_COLS`·`Money`·`Form`·`Pop`·`ICON`·`money`·`moneyOf`·`KIND_CLASS`·`STAGE_CLASS`, `BudgetScreen`(몸통 – `menuBody`·`confirmBody`·`popBody`·`nameRow`·`gunForm` 등 안쪽 조각은 떼지 않음) | 1,993 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/budget/Dialogs.tsx) | 옛 `src/BudgetGot.tsx`(받은 것 창 `gotValue`·`BudgetGot`) + 옛 `src/BudgetSuggest.tsx`(사업명 고르기 칸 `Suggest`·`plainOrg`·`orgsOf`·`projectHits`·`projectSub`·`SuggestInput`) – 두 파일을 이어 붙이고 import만 합침 | 365 |

- Table·Menu·keys·parts는 없어요(바깥 함수가 화면 하나뿐이고, 두 조각 이상이 함께 쓰는 것이 없음 – 결정 로그 19:2x).
- 두 파일을 합치니 `KeyboardEvent`가 둘(받은 것 창은 브라우저 것, 사업명 칸은 React 것)이라 이름이 부딪쳐요. React 쪽만 `KeyboardEvent as RKeyboardEvent`로 불러 `isComposing`의 타입 이름 한 곳만 바꿨어요(Screen.tsx가 이미 쓰는 이름, 실행 코드는 그대로). 줄 견주기 차이는 머리 설명 한 줄과 이 줄뿐이에요.
- 그대로 둔 것: `src/BudgetStatusSend.tsx`(예산현황도 씀), `src/BudgetShareCard.tsx`(설정이 씀), 규칙 `budget.ts`·`budgetExcel.ts`·`budgetShare.ts`·`budgetStatus.ts`, CSS. 이 화면을 불러 쓰는 곳은 `App.tsx` 하나뿐이라 그 import만 고쳤어요.
- 확인: 고치는 동안 `screen_03 budget_confirm budget_menu zoom15_03 zoom17_03 small_03` 0점·styles 0·behave `budget_menu` · 끝낼 때 전체 92장면 0점(허용 셋)·styles 0·behave 전부·npm build·npm test 223·매뉴얼 글 같음(True)·긴 줄표 21줄·"기Log" 0줄.
