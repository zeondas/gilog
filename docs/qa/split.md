# 큰 화면 쪼개기 – 틀 (정리 3차, 할 일이 첫 화면)

2026-10-27 정리 3차(할 일) 세션이 정했어요. 근거: [CLAUDE.md](https://github.com/zeondas/gilog/blob/main/CLAUDE.md) 공통 결정 로그 2026-10-27 09:03 "정리 ③"·09:26 "검사 속도"·10:48 "parts.tsx".
다음 화면 세션(탐색기 → 민원대장 → 민원처리 → 설정 → 집행현황·예산현황 → 캘린더·업무일지 → 업무연락처)은 **이 문서만 보고** 따라오면 돼요.

## 1. 폴더 모양

```
src/screens/<화면>/
  Screen.tsx   화면 몸통 – 상태·불러오기·저장 함수·머리 줄·카드/표 배치. export default 하나(지금 화면 이름 그대로, 예 TasksScreen)
  Table.tsx    표·목록·줄 – 목록 칸, 한 줄 부품
  Dialogs.tsx  창·띠·입력 – 추가 입력, 그 자리 고치기, 날짜 칸, 창
  Menu.tsx     우클릭·⋯ 메뉴
  keys.ts      키 다루기가 따로 함수로 있을 때만 (줄·칸 안 onKeyDown은 그 부품에 그대로)
  parts.tsx    그 화면 조각끼리만 함께 쓰는 작은 그림·함수 (두 조각 이상이 쓸 때만)
```

- `<화면>`은 영어 소문자: tasks · files · complaints · process · settings · contacts · journal · budget · calendar · bstatus (CSS `src/styles/` 이름과 같게, 탐색기는 files).
- **없는 조각은 만들지 않아요.** 조각 하나에 한 함수만 남으면 그래도 그 이름으로 둬요(할 일 Menu.tsx = ListMenu 하나).
- 폴더 안에 `index.ts`는 두지 않아요 – `src/screens.ts`(화면 목록)와 이름이 겹쳐 헷갈려요. `App.tsx`는 `./screens/<화면>/Screen`을 바로 불러요.

### 보기 – 할 일 (1,146줄 → 5파일)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/tasks/Screen.tsx) | 머리 설명, `CHECK_MS`, `Props`, `TasksScreen` | 411 |
| [Table.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/tasks/Table.tsx) | `ListPanel`(왼쪽 목록 칸), `ItemRow`(항목 한 줄) | 293 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/tasks/Dialogs.tsx) | `Draft`, `AddForm`, `DueField`, `TaskEditor` | 338 |
| [Menu.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/tasks/Menu.tsx) | `ListMenu` | 106 |
| [parts.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/tasks/parts.tsx) | `isComposing`, `Tick`, `Plus` | 23 |

keys는 없어요(키 다루기가 줄·칸마다 안에 있어 따로 뗄 함수가 없음).

### 보기 – 탐색기 (3,743줄 → 6파일, 정리 4차 `wip/split-files`)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/files/Screen.tsx) | 머리 설명, `STATE_KEY`·`ZIP_RO`·`VIEW_SIZES`·`SORT_NAME`·`tabSeq`·`withIds`·`toSaved`, `FilesScreen`(창 그리기·키는 Table·keys에 값 묶음을 넘겨 불러요), `dateColMin`·`PANE_MIN_W`·`NEW_DIR`·`mkdirFree`·`ySplitSide`·`LayoutIcon`·`PANE_MIN_H`·`favEntries` | 2,164 |
| [Table.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/files/Table.tsx) | `PaneCtx`, `renderPane`(창 하나 – 탭 줄·드라이브 줄·경로 줄·목록·상태 줄), `LockBadge`, `Thumb`, `dateParts`, `Preview`·`PreviewImage` | 879 |
| [keys.ts](https://github.com/zeondas/gilog/blob/main/src/screens/files/keys.ts) | `typing`, `KeyCtx`, `handleKey`(전에 `keyRef.current` 몸통) | 268 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/files/Dialogs.tsx) | 옛 `FilesDialogs.tsx` 전부(`Overlay`·`Decision`·`ConflictDialog`·`DeleteDialog`·`TransferAsk`·`AskDialog`·`RenameDialog`·`NameDialog`) | 518 |
| [Menu.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/files/Menu.tsx) | `PickMenu`, `TabMenu` | 66 |
| [parts.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/files/parts.tsx) | 타입 `PopItem`·`Pop`·`FindRun`·`RTab`·`RPane`·`RState`·`Listing`·`Sel`·`Row`, `EMPTY_SEL`, `DATE_TIME_GAP` | 33 |

### 보기 – 민원대장 (2,056줄 → 5파일, 정리 5차 `wip/split-complaints`)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/complaints/Screen.tsx) | 머리 설명, `COLS_KEY`·`STATUS_FILTER_KEY`·`DONE_FOLD_KEY`, `ComplaintsScreen`(몸통은 빼내지 않음 – 448줄이라 "화면 몸통 안의 큰 함수"는 쓰지 않았어요), `rowEstimate`·`inputOf`, 열 폭 재기 `PHONE_SAMPLE`·`HEAD_FONT`·`STATUS_BADGE`·`MEMO_BTN`·`FOLD_BTN`·`DUE_GAP`·`useColNeeds`, `same` | 622 |
| [Table.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/complaints/Table.tsx) | `headFilter`·`HeadRow`(열 제목 줄)·`Funnel`, `FilterChips`(상태 칩 줄 – 메뉴가 아니라 줄 부품, 사용자 ①1안), `emptyDraft`·`Cells`(칸 묶음)·`NewRow`·`Plus`·`EditRow`, `Bullets`·`ViewRow`·`MemoButton`·`CopyCell`, 보기 줄 안 고르기 상자 `StatusPick`·`DuePick`·`TakenPick`(사용자 ②1안) | 1,055 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/complaints/Dialogs.tsx) | `normDates`, `DateField`, `focusField`, `useDraft`, `MemoDialog`, `CatsDialog` | 199 |
| [Menu.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/complaints/Menu.tsx) | `HeadMenu`, `RowMenu`, `FilterMenu`·`Check` | 201 |
| [parts.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/complaints/parts.tsx) | `FILTER_LABEL`, `Lists`, `Draft`·`DateKey`·`Bad`, `PlaceStyle`·`placeText` | 23 |

keys는 없어요(따로 뗄 키 함수가 없음). 한 조각만 쓰는 작은 그림(`Check`·`Funnel`·`Plus`)은 parts가 아니라 쓰는 조각 안에 뒀어요(2장 마지막 줄, 사용자 ③1안). Table이 Dialogs(`DateField`·`useDraft`·`focusField`)와 Menu(`HeadMenu`)를 부르고, 거꾸로 부르는 곳은 없어요.

### 보기 – 민원처리 (2,442줄 → 5파일, 정리 6차 `wip/split-process`)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/process/Screen.tsx) | 머리 설명, `Props`, 키 이름 `FETCHED_KEY`·`LAST_RUN_KEY`·`PICK_KEY`·`COLS_KEY`, `LastRun`·`MAIL_BOX`·`NA_WORK`·`FIXED_COLS`·`readWidths`·`errText`·`stamp`, `ProcessScreen`(몸통은 빼내지 않음 – 약 1,330줄이지만 "화면 몸통 안의 큰 함수"는 쓰지 않았어요), 몸통만 쓰는 `MAIL_STEPS`·`shortNo`·`duration`·그림 7개(`DocIcon`·`RedoIcon`·`UndoIcon`·`SendIcon`·`MoreIcon`·`FolderIcon`·`TableIcon`) | 1,476 |
| [Table.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/process/Table.tsx) | `UNKNOWN`, `HeadRow`(열 제목 줄), `PlaceCell`(위치 칸), `NOTE_HINT`·`NoteCell`(고려사항 칸), `PhotoStrip`·`Thumb`, `WorkTag`, `Gauge`(진행 게이지), `ProofRow`(증거 카드 줄) | 378 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/process/Dialogs.tsx) | `phoneOf`, 공사 관리 창 `Draft`·`EMPTY_DRAFT`·`WorksDialog`·`agentOf`·`ProjectPick`·`AgentInputs`·`PersonIcon`, 메일 창 `MailDialog` | 467 |
| [Menu.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/process/Menu.tsx) | `Floating`(떠 있는 상자 – ⋯·우클릭 메뉴, 묻는 띠, 증거 카드, 고르기 목록, 사용자 ①1안) | 40 |
| [parts.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/process/parts.tsx) | `workColor`, 열 폭 재기 `COLUMNS`·`AUTO_COLS`·`COL_GAP`·`PLACE_MAX`·`textWidth`·`PLACE_SPACE`(Screen·Table이 함께 써서 – Screen에 두면 꼬임, 사용자 ②1안), `MailDraft`, `Prog`, `isPath`, 그림 5개(`DocPlusIcon`·`MailIcon`·`PhoneIcon`·`CheckIcon`·`WarnIcon`) | 120 |

keys는 없어요(따로 뗄 키 함수가 없음). 한 조각만 쓰는 함수·그림·상수는 그 조각 안에(2장, 사용자 ③1안 – 민원대장과 같게). `// ----------` 절 머리 주석은 바로 아래 함수와 함께 옮겼어요. Screen이 나머지 넷을, Table·Dialogs가 Menu·parts를 부르고, 거꾸로 부르는 곳은 없어요.

### 보기 – 설정 (1,860줄 → 4파일, 정리 7차 `wip/split-settings`)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/settings/Screen.tsx) | 머리 설명, `SCREEN_SIZES`·`Props`·`SET_SCREENS`, `SettingsScreen`(몸통), `engineVersion`, 설정 찾기 `squash`·`markIn`·`keysOf`·`applyFind`, 몸통만 쓰는 `FindIcon` | 556 |
| [Table.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/settings/Table.tsx) | 카드·줄 부품 – `ModulesCard`·`ModuleCard`, 키 카드 `KEY_HINT`·`RALT_HINT`·`APP_HINT`·`KeysCard`, 구글 `G_TOGGLES`·`GoogleRows`, 탐색기 `DriveRow`·`FastRow`·`FilesRows`, 목록 묶음 `eulReul`·`ListGroup`·`KindsGroup`·`Plus`, `PinRow`, 저장 위치 `pickFolder`·`FolderRow`, `BackupRow`, 민원처리 `PROCESS_DIRS`·`ProcessRows`, 주소 `hm`·`AddressRows` | 1,174 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/settings/Dialogs.tsx) | 비밀번호 바꾸기 적는 칸 `PasswordChange` | 83 |
| [parts.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/settings/parts.tsx) | `Row`(설정 줄 틀)·`Toggle`(스위치)·`X`·`PIN_CHANGED`(Screen·Table·Dialogs가 함께 써서) | 65 |

표가 없는 화면이라 틀 이름 안에서 나눴어요(사용자 2안 – 적는 칸만 Dialogs, 나머지 카드·줄은 Table, 새 조각 이름은 만들지 않음). 메뉴·따로 뗄 키 함수가 없어 Menu·keys는 없어요. 설정 찾기는 키가 아니라 몸통이 부르는 함수라 Screen에 뒀어요. 파일 가운데 있던 `./google` import 덩어리는 쓰는 Table 맨 위로 옮겼어요. `ListGroup`은 민원대장 `src/screens/complaints/Dialogs.tsx`(분류 관리 창)가 불러 써서 그 파일의 import 경로만 고쳤어요. Screen이 나머지 셋을, Table·Dialogs가 parts를 부르고, 거꾸로 부르는 곳은 없어요.

### 보기 – 집행현황 (1,994 + 138 + 225줄 → 2파일, 정리 8차 `wip/split-budget`)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/budget/Screen.tsx) | 옛 `src/BudgetScreen.tsx` 전부 – 머리 설명, 바깥 상수·타입 `COLS`·`COLS_SOLO`·`FIXED`·`START_W`·키 이름·`Sel`·`selKey`·`Cells`·`NUM_COLS`·`Money`·`Form`·`Pop`·`ICON`·`money`·`moneyOf`·`KIND_CLASS`·`STAGE_CLASS`, `BudgetScreen`(몸통 – `menuBody`·`confirmBody`·`popBody`·`nameRow`·`gunForm` 등 안쪽 조각은 떼지 않음) | 1,993 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/budget/Dialogs.tsx) | 옛 `src/BudgetGot.tsx`(받은 것 창 `gotValue`·`BudgetGot`) + 옛 `src/BudgetSuggest.tsx`(사업명 고르기 칸 `Suggest`·`plainOrg`·`orgsOf`·`projectHits`·`projectSub`·`SuggestInput`) – 두 파일을 이어 붙이고 import만 합침 | 365 |

**파일 단위로 옮기기만**(결정 로그 2026-10-27 19:2x) – 바깥 함수가 화면 하나뿐이라 몸통 안 조각은 떼지 않고, Table·Menu·keys·parts도 없어요(두 조각 이상이 쓰는 것이 없음). 몸통 줄이기는 정리 ⑥(겹친 표 코드를 공통 부품으로)에서. 두 파일을 합치니 `KeyboardEvent`가 둘(브라우저·React)이라 React 쪽만 `KeyboardEvent as RKeyboardEvent`로 불러 `isComposing`의 타입 이름 한 곳만 바꿨어요 – 줄 견주기 차이는 머리 설명과 이 줄뿐. 그대로 둔 것: `src/BudgetStatusSend.tsx`(예산현황도 씀), `src/BudgetShareCard.tsx`(설정이 씀), 규칙 `budget.ts`·`budgetExcel.ts`·`budgetShare.ts`·`budgetStatus.ts`. 불러 쓰는 곳은 `App.tsx` 하나.

### 보기 – 예산현황 (1,051줄 → 1파일, 정리 8차 `wip/split-bstatus`)

| 파일 | 들어간 것 | 줄 |
| --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/bstatus/Screen.tsx) | 머리 설명, 옛 `src/BudgetStatusScreen.tsx` 전부 – `ICON`·`CD`·`CR`·`GEAR`·`UNIT_KEY`·`VIEW_KEY`·`YEAR_KEY`·`ORDER_KEY`, `Col`·`FIXED`·`COLS_KEY`·`SUM_COLS`·`DET_COLS`·`EDIT_FIELDS`, `Pop`·`Ask`·`Form`, `BudgetStatusScreen`(몸통 안 조각 `menuBody`·`numCells`·`seg`·`mi` 등은 떼지 않음) | 1,052 |

같은 까닭으로 Screen 하나뿐이에요. `BudgetStatusSend.tsx`(집행현황도 씀)·규칙 `budgetStatus.ts`·`budgetStatusImport.ts`·`budget.ts`는 그대로. 바뀐 것은 import 경로(`../../`)·머리 설명·`App.tsx` import 한 줄. 전체 `styles.py`에서 `complaints_import_merge` 알림 거품(`.xl-toast`) 한 요소가 달랐고 그 장면만 다시 돌리면 0이라 흔들림으로 봤어요(예산현황과 무관한 민원대장 장면).

### 보기 – 캘린더 (1,929줄 → 4파일, 정리 9차 `wip/split-calendar`)

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

### 보기 – 업무일지 (2,051 + 533줄 → 6파일, 정리 9차 `wip/split-journal`)

| 파일 | 들어간 것 | 줄 | 배정 까닭 |
| --- | --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/journal/Screen.tsx) | 머리 설명, `JournalScreen`(몸통 – 몸통 안 조각은 떼지 않음), `DueList`(챙길 일) | 421 | 화면 몸통과 몸통만 쓰는 배치 부품 |
| [Table.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/journal/Table.tsx) | `WEEK`·`ymd`·`JournalCalendar`(왼쪽 월 달력), `DayHead`(날짜 머리 줄), `stripe`·`Lines`·`PillarTel`·`ViewCard`(기록 카드), `SearchResults`(검색 결과) | 488 | 카드·목록. `WEEK`·`ymd`는 달력만 써서 그 안에 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/journal/Dialogs.tsx) | `isComposing`·`WhoInput`(상대 칸), `SpeakerButton`, `NewCard`(신규 카드), `linesToBody`·`EditLine`·`EditCard`(고치는 카드) + 옛 `src/JournalPrint.tsx` 전부(`PrintDialog`·`PrintPages`·`PaperHead`·`PaperCard` 등, 그 머리 설명 주석도 그대로) | 1,352 | 적는 칸·창. `isComposing`은 `WhoInput`만 써서 parts가 아니라 여기 |
| [Menu.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/journal/Menu.tsx) | `DayMenu`(날짜 우클릭), `ProjectMenu`(사업 고르기) | 196 | 메뉴 부품 – 달력(Table)·기록 카드(Table)·고치는 카드(Dialogs)가 불러요 |
| [keys.ts](https://github.com/zeondas/gilog/blob/main/src/screens/journal/keys.ts) | `talkAction`·`insertBreak`·`lineEdge` | 38 | 말 줄 키 함수(엔터규칙 "업무일지 말 줄")가 카드 밖에 따로 있는 함수라 틀대로 keys – `NewCard`·`EditCard`가 불러요 |
| [parts.tsx](https://github.com/zeondas/gilog/blob/main/src/screens/journal/parts.tsx) | `Ctx`(화면 값 묶음), `CardCols`·`splitCards`(카드 두 단), `badgeStyle`(말 배지 색) | 114 | 두 조각 이상이 써서 – `Ctx`는 다섯 조각, `CardCols`는 Screen·Table(검색 결과도 두 단 – Screen에 두면 Table이 Screen을 거꾸로 불러 꼬임), `badgeStyle`은 Table(`Lines`)·Dialogs(`SpeakerButton`) |

- **Dialogs가 1,000줄을 넘어요(1,352)** – 인쇄(533줄)를 Dialogs에 넣어서예요. 틀 이름 밖 새 조각(`Print.tsx` 등)은 만들지 않는다는 프롬프트대로 한 파일로 두었어요(설정 Table 1,174·민원대장 Table 1,055처럼 1,000줄 넘는 조각이 이미 있음). 인쇄를 따로 떼려면 틀에 이름을 더하는 결정이 필요해요.
- **이름 부딪침 한 곳** – 업무일지와 인쇄 둘 다 `type Ctx`가 있어요(업무일지는 5칸, 인쇄는 `myName`·`byId` 2칸). 인쇄 쪽은 그대로 두고, Dialogs가 parts의 업무일지 `Ctx`를 `Ctx as JournalCtx`로 불러 `NewCard`·`EditCard`의 `ctx: Ctx` 두 줄만 `ctx: JournalCtx`로 바꿨어요(집행현황 `RKeyboardEvent`와 같은 방식). `WEEK`도 둘 다 있지만 업무일지 쪽은 Table로 가서 부딪치지 않아요.
- 줄 견주기: 머리 설명 5줄(새 파일)과 위 `JournalCtx` 두 줄만 달라요.
- 부르는 방향: Screen → Table·Dialogs·parts, Table → Menu·parts, Dialogs → Menu·keys·parts, Menu → parts. 거꾸로 부르는 곳은 없어요.
- 그대로 둔 것: 규칙 `src/journal.ts`(+ 시험), `RichMemo`·`BulletParts`·`SearchBox`·`PopMenu` 등 공통 부품, 업무연락처 `src/ContactsScreen.tsx`(`copyText`·`Hl`·`pjFull`·`pjLabel`·`projectColor`를 `../../ContactsScreen`에서 불러 쓰기만), CSS. `splitCards`는 시험 파일이 쓰지 않아 경로를 맞출 곳이 없었어요. 불러 쓰는 곳은 `App.tsx` 하나.

## 2. 조각 이름 규칙

- 어느 조각으로 갈지는 **지금 함수 경계**로만 정해요. 함수를 새로 쪼개거나 합치지 않아요.
- 고르는 순서: 화면 몸통이면 Screen → 메뉴 부품이면 Menu → 창·띠·입력 칸·고치기 부품이면 Dialogs → 표·목록·줄이면 Table → 두 조각 이상이 쓰는 작은 도우미면 parts → 그 조각 하나만 쓰는 도우미는 그 조각 안에.
- 한 조각만 쓰는 상수·타입은 그 조각으로(할 일 `CHECK_MS`는 Screen, `Draft`는 Dialogs).
- 다른 화면이 이 화면의 부품을 불러 쓰면(예: 할 일이 업무연락처의 `Hl`을 씀) 그 부품은 **그 화면이 쪼개질 때** 옮겨요. 내 화면 세션은 남의 화면 파일을 건드리지 않고, 부르는 쪽 경로만 맞춰요.
- 조각끼리 서로 부르는 꼬임(Table → Dialogs → Table)이 생기면 함께 쓰는 쪽을 parts로 빼요.

### 화면 몸통 안의 큰 함수 (2026-10-27 정리 4차 탐색기 – 사용자 ①2안)

화면 몸통이 함수 하나로 아주 길고(탐색기 2,890줄) 그 **안쪽에** 창 그리기·키 같은 큰 함수가 있으면, 그 함수만 밖 조각으로 옮겨도 돼요.

- 어디로: 창·표 그리기는 Table, 키 함수는 keys(이름은 틀 그대로 – 새 이름을 만들지 않아요).
- 어떻게: 함수 몸통 글자는 그대로 두고, 쓰던 화면 값들을 **한 묶음**(`PaneCtx`·`KeyCtx` – 이름·모양을 그 조각 맨 위에 적음)으로 넘겨받아 첫 줄에서 `const { … } = c;`로 꺼내요. 그래서 몸통은 화면 안에 있을 때와 같은 이름으로 같은 값을 봐요. 들여쓰기만 한 단 줄어요.
- 묶음은 **부르는 그 순간에** 만들어요: 그리기 묶음은 `return` 바로 앞(모든 값이 정해진 뒤), 키 묶음은 `keyRef.current = (e) => handleKey(e, { … })`처럼 키를 누를 때. 키 함수 자리(화면 중간)에서 미리 만들면 그 아래에서 정해지는 값을 아직 못 읽어요.
- 넣을 값과 모양은 손으로 고르지 않고 TypeScript가 알려 주는 대로(몸통이 쓰는 화면 값 = 묶음, 그 값의 타입 = 모양) – 빠지면 `npm run build`가 잡아요.
- 상태·기억(useState·useRef·useEffect)을 가진 덩어리를 훅으로 빼는 것(3안)은 **하지 않아요** – 다른 화면을 다 쪼갠 뒤 "나머지"와 함께 정해요(사용자 ②2안).
- 확인(3장 4번)은 들여쓰기가 바뀌니 줄 앞 빈칸을 빼고 견줘요(`sed 's/^\s*//'`). 더해진 것(묶음 모양·꺼내는 줄·머리 설명)만 보여야 해요.

## 3. 옮길 때 지킬 것

1. **옮기기만** – 동작·DOM·클래스 이름·`data-*`·화면 글자·주석 그대로. 바꾸는 것은 ① import 줄 ② 다른 조각이 쓰는 함수 앞 `export` ③ 새 파일 맨 위 한 줄 설명뿐이에요.
2. 규칙 함수 `src/<화면>.ts`, 공통 부품(`SearchBox`·`PopMenu`·`DialogX`·`AskBand`·`DateInput`·`BulletParts` 등), CSS는 손대지 않아요.
3. import는 쓰는 것만(tsconfig `noUnusedLocals`가 남은 것을 잡아요), 원래 순서를 따르고 그 뒤에 같은 폴더 조각(`./Table` 등)을 둬요.
4. 옮긴 뒤 확인 – 원래 파일과 새 파일들을 import·빈 줄·`export `를 빼고 줄 단위로 견주면 머리 설명 줄만 달라야 해요:
   ```
   git show origin/main:src/<원래 파일>.tsx | grep -v '^import ' | grep -v '^\s*$' | sort > /tmp/a.txt
   cat src/screens/<화면>/*.ts* | grep -v '^import ' | grep -v '^\s*$' | sed 's/^export //' | sort > /tmp/b.txt
   diff /tmp/a.txt /tmp/b.txt
   ```
   (`...이름(` 처럼 점 세 개 뒤에 쓰인 함수는 import가 빠지기 쉬워요 – `npm run build`가 잡아요.)
   여러 줄 import(`import {` … `} from`)의 안쪽 줄과 `export default`는 이 명령으로는 빠지지 않아 차이로 보여요 – 민원대장 때는 import 덩어리를 통째로 빼고 견줘 머리 설명 줄만 남는 것을 확인했어요.
5. 커밋은 셋: ① 파일 나누기(원래 파일 지움) ② `App.tsx` import ③ 문서(현황판·이 문서에 그 화면 보기 표 더하기).

## 4. 합격 확인 명령

```
# 기준(main)과 내 가지 빌드
git worktree add /tmp/gilog-main origin/main   # 또는 가지를 만들기 전에 /tmp/g_base를 빌드
(cd /tmp/gilog-main && npm ci && npx vite build -c tools/guard/vite.config.ts --outDir /tmp/g_base)
npx vite build -c tools/guard/vite.config.ts --outDir /tmp/g_cur

# 고치는 동안 – 그 화면 장면만 (할 일 보기)
T="screen_06 tasks_listmenu tasks_listmenu_ask tasks_item_ask tasks_edit_ask tasks_add_baddate tasks_minical zoom15_06 zoom17_06 small_06"
python3 tools/guard/shoot.py /tmp/g_base /tmp/s_base $T
python3 tools/guard/shoot.py /tmp/g_cur  /tmp/s_cur  $T
python3 tools/guard/compare.py /tmp/s_base /tmp/s_cur /tmp/s_diff
python3 tools/guard/styles.py /tmp/g_base /tmp/g_cur $T
python3 tools/guard/behave.py /tmp/g_cur <그 화면 시험 이름들>

# 끝낼 때 한 번 – 전체 91장면 (흔들리는 두 장면만 허용)
python3 tools/guard/shoot.py /tmp/g_base /tmp/s_base
python3 tools/guard/shoot.py /tmp/g_cur  /tmp/s_cur
python3 tools/guard/compare.py /tmp/s_base /tmp/s_cur /tmp/s_diff --allow complaints_newrow_baddate journal_memo files_find_baddate
python3 tools/guard/styles.py /tmp/g_base /tmp/g_cur      # 0
python3 tools/guard/behave.py /tmp/g_cur                  # 전부 통과

npm run build && npm test

# 매뉴얼 – 두 빌드로 만들어 그림을 뺀 글이 같은지 (번호 자리 그대로)
python3 tools/manual/build.py /tmp/g_base /tmp/man_base.html
python3 tools/manual/build.py /tmp/g_cur  /tmp/man_cur.html
python3 -c "import re;f=lambda p:re.sub(r'data:[^\"\')]+','D',open(p,encoding='utf-8').read());print(f('/tmp/man_base.html')==f('/tmp/man_cur.html'))"   # True
```

- 화면 장면 이름: 화면 번호는 `shoot.py`의 `SCREENS` 순서(탐색기 00 · 민원대장 01 · 민원처리 02 · 집행현황 03 · 예산현황 04 · 캘린더 05 · 할 일 06 · 업무일지 07 · 업무연락처 08 · 설정 09) → `screen_NN`·`zoom15_NN`·`zoom17_NN`·`small_NN` + 그 화면 이름으로 시작하는 장면(`tasks_*`, `files_*` …).
- 탐색기 쪼개기 때 `files_find_baddate`가 여러 장면을 한 번에 찍을 때 빨간 테두리 모서리 한 점(색 15 차이)이 달랐어요 – 그 장면 `styles.py` 0, 그 장면만 다시 찍으면 기준과 0점이라 흔들림으로 봤어요. 또 나오면 이렇게 확인해요(이번 전체 돌리기에서 사진이 흔들리는 `complaints_newrow_baddate`는 `styles.py`에서도 칸 한 요소의 포커스 테두리가 달랐어요 – 탐색기와 상관없는 민원대장 장면이고, 그 장면만 다시 돌리면 0).
- `tools/guard/__pycache__/`가 저장소에 들어 있어 도구를 돌리면 바뀌어요 – 커밋 전에 `git checkout tools/guard/__pycache__`.
- 올린 뒤 검사(check.yml)는 기다리지 않아요 – 현황판 "끝(검사 도는 중)"으로 두고 멈춰요(통과 확인은 빌드 세션).
