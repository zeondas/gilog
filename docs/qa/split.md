# 큰 화면 쪼개기 – 틀 (정리 3차, 할 일이 첫 화면)

2026-10-27 정리 3차(할 일) 세션이 정했어요. 근거: [CLAUDE.md](https://github.com/zeondas/gilog/blob/main/CLAUDE.md) 공통 결정 로그 2026-10-27 09:03 "정리 ③"·09:26 "검사 속도"·10:48 "parts.tsx".
다음 화면 세션(탐색기 → 민원대장 → 민원처리 → 설정 → 나머지)은 **이 문서만 보고** 따라오면 돼요.

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
python3 tools/guard/compare.py /tmp/s_base /tmp/s_cur /tmp/s_diff --allow complaints_newrow_baddate journal_memo
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
