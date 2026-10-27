# 쪼개기 보기 – 캘린더 (정리 9차 `wip/split-calendar`)

틀은 [docs/qa/split.md](https://github.com/zeondas/gilog/blob/main/docs/qa/split.md) 1~4장 그대로예요. 결정 로그 2026-10-27 20:5x(2묶음, 업무일지와 동시). 묶음 빌드 뒤 우두머리가 split.md로 모아요.

### 보기 – 캘린더 (1,929줄 → 4파일)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/calendar/Screen.tsx) | 머리 설명, `EventFocus`(App.tsx가 씀)·`Props`, `CalendarScreen`(몸통 약 530줄 – "화면 몸통 안의 큰 함수"는 쓰지 않음), 몸통만 쓰는 `Tick` | 568 |
| [Table.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/calendar/Table.tsx) | 일정 하나 `ChipActs`·`EventChip`, 주간 보기 `HOUR`·`Slot`·`slotsOf`·`WeekView`, 마감 동그라미 그림 `Circle`·`CheckCircle`(EventChip만 씀), 주 한 줄 배치 `weekLayout` | 312 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/calendar/Dialogs.tsx) | `isComposing`·`plainEnter`(KindsDialog만 씀), 상세 창 값 `Draft`·`Bad`·`toInput`·`draftOf`·`firstKind`·`blankDraft`, 빠른 입력 `QuickRow`, 상세 창 `EventDialog`·`RemindField`, 종류 관리 창 `KindsDialog`, 구글 상태 상자 `GoogleBox`, 알림 확인 창 `NotifyDialog`, `Plus`(QuickRow만 씀) | 900 |
| [Menu.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/calendar/Menu.tsx) | 떠 있는 고르기 상자 `KindPicker`(종류 고르기)·`ColorButton`(색 24가지 펼침) | 172 |

배정 까닭:
- `blankDraft`는 몸통과 `QuickRow`가 함께 써요. Screen에 두면 Dialogs가 Screen을 거꾸로 부르니 `Draft`·`draftOf`와 함께 Dialogs에 두고 Screen이 불러요(`firstKind`는 `blankDraft`·`QuickRow`만 써서 같이 Dialogs).
- `KindPicker`·`ColorButton`은 누르면 떠서 고르는 상자라 메뉴 조각으로 봤어요(민원처리 `Floating`과 같게). Dialogs(`QuickRow`·`EventDialog`·`KindsDialog`)가 Menu를 불러요.
- `GoogleBox`는 창이 아니지만 프롬프트대로 Dialogs에 뒀어요(몸통 왼쪽 맨 아래 상자, 다른 조각은 안 씀).
- parts·keys는 없어요 – `isComposing`·`plainEnter`·`firstKind`·`Circle`·`CheckCircle`·`Tick`·`Plus` 모두 한 조각만 써요(2장 마지막 줄). 따로 뗄 키 함수도 없어요.
- `// ---------- 아이콘 ----------` 절 머리 주석은 첫 아이콘 `Circle`과 함께 Table로 갔어요.
- Screen이 Table·Dialogs를, Dialogs가 Menu를 부르고, 거꾸로 부르는 곳은 없어요. 업무연락처 `Hl`(Table)은 경로만 `../../ContactsScreen`으로.

확인: 줄 견주기(여러 줄 import 덩어리째 빼고) 차이는 새 머리 설명 세 줄뿐 · 캘린더 장면 10개 0점·`styles.py` 0·`behave.py` calendar_dialog·calendar_kindpicker 통과 · 전체 92장면 통과 · `npm run build` · `npm test` 223 · 매뉴얼 글 같음(True) · 긴 줄표 21줄·"기Log" 0줄.
