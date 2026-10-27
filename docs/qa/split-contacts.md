# 보기 – 업무연락처 (2,103줄 → 5파일, 정리 10차 `wip/split-contacts`)

근거: [CLAUDE.md](https://github.com/zeondas/gilog/blob/main/CLAUDE.md) 공통 결정 로그 2026-10-27 23:0x, 틀 [split.md](https://github.com/zeondas/gilog/blob/main/docs/qa/split.md). 우두머리가 빌드 뒤 split.md로 모아요.

| 파일 | 들어간 것 | 줄 | 배정 까닭 |
| --- | --- | --- | --- |
| [Screen.tsx](https://github.com/zeondas/gilog/blob/wip/split-contacts/src/screens/contacts/Screen.tsx) | 머리 설명, `ContactsScreen`(몸통 약 190줄 – 안쪽 조각은 떼지 않음), `cardEstimate`(`// ---------- 카드 ----------` 절 머리 주석과 함께), `importProjects`(엑셀 사업 넣기) | 242 | 화면 몸통과 몸통만 쓰는 것 |
| [Table.tsx](https://github.com/zeondas/gilog/blob/wip/split-contacts/src/screens/contacts/Table.tsx) | `SORT_KEY`·`ProjectList`(왼쪽 사업 목록), `ViewProps`·`ViewCard`(보기 카드), `Pencil` | 229 | 목록·카드. `SORT_KEY`는 `ProjectList`만, `Pencil`은 `ViewCard`만 써서 그 안에 |
| [Dialogs.tsx](https://github.com/zeondas/gilog/blob/wip/split-contacts/src/screens/contacts/Dialogs.tsx) | `fullDraft`·`pjOther`·`isComposing`·`EMPTY`, 신규 줄 `FIELDS`·`NewRow`, 사업 칸 `findProject`·`projectsToSave`·`ProjectChips`, `EditCard`, `MemoEditor`(export – 민원대장도 씀), 사업 관리 창 `PJM_N`·`PJM_MIN_NAME`·`PJM_MIN_SHORT`·`pjmFixed`·`pjmMaxW`·`PJM_MIN_W`·`fitCols`·`EdgeGrip`·`ColGrip`·`ProjectDialog`·`GroupInput`·`GroupRename`·`NamesEdit`·`ColorPick`, 그림 `Plus`·`Arrow` | 1,405 | 적는 칸·창. `isComposing`·`fullDraft`·`pjOther`·`Plus`·`Arrow`·`EMPTY`는 이 조각만 써서 parts가 아니라 여기 |
| [Menu.tsx](https://github.com/zeondas/gilog/blob/wip/split-contacts/src/screens/contacts/Menu.tsx) | `PjMenu`(사업 줄 우클릭), `CtxMenu`(작은 우클릭 메뉴) | 142 | 메뉴 부품 – 사업 관리 창(Dialogs)이 불러요 |
| [parts.tsx](https://github.com/zeondas/gilog/blob/wip/split-contacts/src/screens/contacts/parts.tsx) | 메모 `MemoLine`·`parseMemo`·`memoText`, 사업 색·이름 `COLOR_NAMES`·`projectColor`·`pjLabel`·`pjFull`·`pjStyle`, `Hl`·`copyText`, 사업 묶음 `koSort`·`PjSection`·`pjSections`·`FOLD_KEY`·`useFolded`·`FoldArrow` | 109 | 다른 화면 11곳이 부르는 8개 + 두 조각 이상이 쓰는 것(아래) |

배정 까닭:
- **사업 묶음(`koSort`·`pjSections`·`useFolded`·`FoldArrow`)은 Table이 아니라 parts** – 프롬프트는 Table 자리로 적었지만, 왼쪽 목록(Table)과 사업 관리 창·사업 칸(Dialogs)이 함께 써요. Table은 보기 카드에서 `MemoEditor`(Dialogs)를 부르니, Table에 두면 Dialogs가 Table을 거꾸로 불러 꼬여요 → parts(틀 2장 마지막 줄). `PjSection`·`FOLD_KEY`는 이들만 써서 함께.
- `COLOR_NAMES`는 `projectColor`(parts)와 `ColorPick`(Dialogs)이 함께 써서 parts.
- `pjStyle`은 다른 화면이 쓰지 않지만 `ViewCard`(Table)·`ProjectChips`(Dialogs)가 함께 써서 parts.
- `MemoLine`은 민원대장이 부르진 않지만 타입이라 `parseMemo`·`memoText`와 함께 parts(Table `ViewProps`·Dialogs `MemoEditor`가 씀).
- `importProjects`(파일 맨 끝)는 몸통만 써서 Screen.
- **Dialogs가 1,000줄을 넘어요(1,405)** – 사업 관리 창(약 650줄)이 Dialogs에 들어가서예요. 틀 이름 밖 새 조각은 만들지 않는다는 프롬프트대로 한 파일로 두었어요(업무일지 Dialogs 1,352와 같게).
- keys는 없어요(따로 뗄 키 함수가 없음).
- `// ----------` 절 머리 주석은 바로 아래 함수와 함께 옮겼어요(공통 → Dialogs `isComposing`, 카드 → Screen `cardEstimate`, 아이콘 → Dialogs `Plus`).
- 부르는 방향: Screen → Table·Dialogs·parts, Table → Dialogs·parts, Dialogs → Menu·parts. 거꾸로 부르는 곳은 없어요.

## 바깥 11곳 경로

이름·내용은 그대로, import 줄의 경로만 바뀌었어요.

| 파일 | 부르는 것 | 경로 |
| --- | --- | --- |
| `src/App.tsx` | `ContactsScreen`(기본) | `./screens/contacts/Screen` |
| `src/complaints.ts` | `parseMemo` | `./screens/contacts/parts` |
| `src/screens/journal/Table.tsx` | `copyText`·`Hl`·`pjFull`·`pjLabel`·`projectColor` | `../../screens/contacts/parts` |
| `src/screens/journal/Dialogs.tsx` | `pjFull`·`pjLabel`·`projectColor` | `../../screens/contacts/parts` |
| `src/screens/journal/Menu.tsx` | `pjFull`·`projectColor` | `../../screens/contacts/parts` |
| `src/screens/process/parts.tsx` | `projectColor` | `../../screens/contacts/parts` |
| `src/screens/process/Dialogs.tsx` | `projectColor` | `../../screens/contacts/parts` |
| `src/screens/tasks/Table.tsx` | `Hl` | `../../screens/contacts/parts` |
| `src/screens/complaints/Table.tsx` | `copyText`·`Hl`·`parseMemo` | `../../screens/contacts/parts` |
| `src/screens/complaints/Dialogs.tsx` | `MemoEditor` / `memoText`·`parseMemo` | `../../screens/contacts/Dialogs` / `../../screens/contacts/parts` (한 줄이 두 줄로) |
| `src/screens/complaints/Menu.tsx` | `copyText` | `../../screens/contacts/parts` |
| `src/screens/calendar/Table.tsx` | `Hl` | `../../screens/contacts/parts` |

App.tsx는 프롬프트에 `parseMemo`도 적혀 있었지만 실제로는 `ContactsScreen` 한 줄만 불러요. 그래서 바깥 파일은 App.tsx 포함 12개, 결정 로그의 "11곳"은 App.tsx를 뺀 화면·규칙 파일 수와 맞아요.

## 확인

- 줄 견주기(여러 줄 import 덩어리째 빼고): 차이는 새 머리 설명 4줄뿐(Screen은 원래 머리 설명 그대로).
- 바깥 11곳 `git diff`: import 줄만(민원대장 Dialogs는 한 줄 → 두 줄).
- 업무연락처 장면 8개 0점 · `styles.py` 0 · `behave.py` contacts_band·contacts_pjmenu_esc 통과.
- 전체 92장면 통과(허용 3장면) · `behave.py` 전부 · `styles.py` 전체는 `complaints_newrow_baddate` 칸 한 요소의 포커스 테두리(outline 3px → 2px)만 달랐고, 두 번 돌려 둘 다 같은 장면 – 그 장면만 다시 돌리면 0이라 흔들림으로 봤어요(split.md 4장에 적힌 그 장면, 업무연락처와 무관) · `npm run build` · `npm test` 223 · 매뉴얼 글 같음(True) · 긴 줄표 21줄·"기Log" 0줄.
