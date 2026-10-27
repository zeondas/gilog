# 업무일지 쪼개기 – 보기 (정리 9차 `wip/split-journal`)

틀은 [split.md](https://github.com/zeondas/gilog/blob/main/docs/qa/split.md)(1~4장) 그대로예요. 결정 로그 2026-10-27 20:5x(2묶음)·19:06(split.md는 고치지 않고 화면별 새 파일).

### 보기 – 업무일지 (2,051 + 533줄 → 6파일)

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
