# UI 모양 일관성 검사 — 0.15.0 (2026-10-18, UI 검사 세션)

기능이 아니라 **모양**(모서리·크기·간격·글자 위치·색)이 화면마다 같은지 봤어요. 코드는 고치지 않았고, 고치는 일은 "UI 통일" 세션 몫이에요(맨 끝 인수인계).

- 잰 것: ① 코드(`src/app.css` 선언 5,313개 + `src/*.tsx` 인라인) — 원자료 [`code-values.md`](./ui-0.15.0-code-values.md) ② 작업 공간 미리 보기 1600×900에서 `tools/align`으로 글자 가운데 맞춤 ③ 집 PC(윈도우 11, 배율 100%, 3년치 흉내 자료) 실제 화면 — 화면 9개 + 뜨는 창 8개 + 설정 5장, 밝게·어둡게 두 벌. 조각 모음은 시안 캔버스 **UIAudit** 판, 통일 뒤 모습은 **UIUnified** 판: https://claude.ai/artifact/JyghMiCyKE5BRDq2C8SmJm
- 기준 우선순위: `docs/brand.md` → 디자인 시스템 https://claude.ai/artifact/GjMv4QEBfeZmmBLqoM7ASZ → `src/tokens.css` → 시안 캔버스 각 판 → CLAUDE.md 공통 결정(글자 가운데 맞춤·관리 창·아이콘 정리·사이드바). 문서끼리 다르면 나중 날짜(공통 결정 로그)가 이겨요.
- PC 조각은 화면을 JPEG로 받아 1px 가장자리가 흐려요. 높이·모서리 값은 코드 표를 기준으로 삼고, PC 조각은 눈으로 차이를 확인하는 용도예요. 글자 1px 처짐은 작업 공간 재기(글꼴은 앱에 든 Pretendard라 PC와 같음)를 써요.

## 1. 기준 표 (디자인 시스템 · tokens.css · 결정 로그)

| 항목 | 기준 | 어디서 | 문서끼리 다른 곳 |
| --- | --- | --- | --- |
| 모서리 | 입력칸·배지·작은 단추 `--radius-sm` 6 · 사이드바 칸·큰 단추 `--radius-md` 8 · 카드·뜨는 창 `--radius-lg` 14 · 원·알약만 예외 · **모두 스퀴클**(`corner-shape: squircle`) | 디자인 시스템 radius, tokens.css 100-102 | 시안 Main 판은 단추 `--r` 8·입력칸 6, Settings 판은 5·6·8 섞임(시안도 흔들려요 — 시안은 기준으로 안 써요) |
| 스퀴클 그리는 법 | `border-radius` + `corner-shape: squircle` (크로미움 139+, 그 전 버전은 그냥 둥근 모서리) | app.css:3 `* { corner-shape: squircle }` | 디자인 시스템은 "스퀴클"이라고만 — 방법은 코드가 정함 |
| 입력칸 높이 | `--size-input` 28 (줄 안) | tokens.css 103 | 디자인 시스템 size 같음 |
| 단추 높이 | `--size-ctrl` 34 (머리 줄 단추·검색창) · 줄 안 단추는 **정한 것 없음** | tokens.css 104 | 관리 창 결정(0.9.4): 줄 높이 45 |
| 배지 높이 | **정한 것 없음** — 글자만 `badge` 11.5/16 굵게 | 디자인 시스템 type | 시안 Icons 판: 상태 배지 22, 칩 28 |
| 표 줄 높이 | `--size-row` 36 | tokens.css 105 | — |
| 사이드바 | 폭 180(결정 2026-10-17, 디자인 시스템 200은 낡음) · 칸 35(결정 0.9.4) | CLAUDE.md 사이드바 | 디자인 시스템 `size-side` 200 → 고쳐야 해요 |
| 카드 안쪽 여백 | 좌우 16 · 머리띠 위아래 12 | 디자인 시스템 spacing | — |
| 글자 크기 | 22 title · 17 time · 14.5 card-title · 13 body · 12.5 button · 12 small · 11.5 badge/hint (줄 높이 30·20·20·18·18·17·16) | 디자인 시스템 type | tokens.css에는 `--fs` 13 하나만 — 단계가 토큰에 없어요 |
| 아이콘 | 사이드바 15(펼침)/17(접힘) · 그 밖은 **정한 것 없음** | CLAUDE.md 사이드바 | — |
| 바깥 여백 | 위아래 24 `--space-6` · 좌우 28 `--space-7` | tokens.css 98-99 | — |
| 사이 간격 | 4·8·12·16·24·28만 (`--space-*`) | tokens.css 94-99 | 6px 토큰 없음 |
| 색 | 토큰만, 화면 코드에 `#` 없음 | brand.md 3절 | — |
| 글자 위치 | 위 여백 − 아래 여백 = 0 또는 −1 | CLAUDE.md 글자 가운데 맞춤 | — |

## 2. 어긋남 표 — 요소 종류마다 "기준 / 지금(화면별) / 어긋남"

값은 `app.css` 줄 번호와 함께 적었어요(자세한 표는 code-values.md 1·2절).

### 2-1. 높이 (가장 큰 어긋남)

| 요소 | 기준 | 지금 | 어긋남 |
| --- | --- | --- | --- |
| 주 단추(보라) | 34(머리 줄) | `.btn-primary` 34(381) · `.btn-add`·`.cal-add`·`.jbtn-add`·`.pr-save` 28 · `.td-newlist-add` 30(3880) · `.jedit-foot .btn-xs` 26(2355) · `.cal-knew`·`.bd-carry` 32(5070·9316) · `.gate-open` 36(292) | **6가지**. PC에서도 민원대장 + 26~28, 할 일 + 30, 민원처리 불러오기 34, 일정 저장 34로 보여요 |
| 보조 단추 | 34(머리 줄) | `.btn` 30(429) · `.btn-ctrl` 34(795) · `.cal-nav .btn` 34(4637) · `.jcal-today` 30(1587) · `.cal-detail-btn` 28 · `.cal-manage` 24(4503) · `.cal-allday` 32 · `.td-done-toggle` 34 | 설정 머리 줄만 `.btn` 30(다른 8화면은 `.btn-ctrl` 34). 캘린더 ‹오늘› 34인데 업무일지 ‹오늘› 30 |
| 작은 단추·탭 | 없음 | 22(`.memo-add`·`.fx-findband .fx-fk`) · 24(`.jsp-btn`·`.fx-chip button`·`.bd-sumbar button`·`.tool`) · 26(`.btn-xs`·`.fx-fk`·`.seg button`·`.bd-unit button`) · 28(`.cm-hbtn`·`.pr-save`·`.jp-chip`·`.kb`) · `.fx-tab` 34 | 4단계 |
| 입력칸 | 28 | `.cell-input` 28(940) · `.input` 30(479) · `.jday-in` 26(1829) · `.input-sm` 26 · `.td-due-input` 26 · `.cal-dlg-grid .cell-input` 32(4954) · `.cal-select` 32 · `.cm-memo-body .memo-row input` 32 · `.field > input` 34(366) · `.mgr .padd .input` 34(5724) · `.jp-field-box` 35(6098) · `.gate-input` 36(267) · `.cal-dlg-title input` 40 | **7가지**. 업무일지 머리 줄에서 출근(26)·날씨(`.input` 30)가 한 줄에 섞여요 |
| 검색창 | 34 | 모두 34 · 폭 260 / 240(`.jn-search`·`.bd-search`) / 300(`.fx-search`) | 폭만 |
| 배지 | 없음(글자 11.5) | 16(`.td-list-box`·`.cal-kind-box`·`.fx-lock-s`) · 18(`.fx-target`·`.fx-new`·`.fx-lock`·`.pr-d`) · 20(`.kind-key`·`.td-src`·`.td-link-badge`·`.td-due`·`.kb-cap`·`.fx-up`) · 22(`.pbadge`·`.cm-status`·`.jsp`·`.cal-kbadge`·`.cal-ev`·`.cal-more`·`.mod-tag`·`.bd-chip`) · 24(`.cal-num`·`.pr-work`) · 26(`.chip`·`.cm-fpill-open`) · 28(`.pchip`·`.cm-fpill`) · 30(`.kind`) | **8가지**. 같은 뜻인 마감 배지가 민원대장 `.cm-dday`(글자만)·할 일 `.td-due` 20·민원처리 `.pr-d` 18 |
| 사이드바 칸 | 35 | `.side-item` 35(68) · `.side-bottom .side-item` **33**(120) · `.side-folded .side-item` 36(169) | 아래쪽 4칸이 2px 낮아요 |
| 표 머리 줄 | — | `.cm-head` 40 · `.pr-headrow` min 40 · `.bd-hd` 40 · `.fx-hdr` 26 · `.fx-rn-hdr` 28 | 탐색기만 26 |
| 뜨는 창 줄 | 45(관리 창 결정) | `.mgr .prow` min 45 · `.prow` min 44(1457) · `.pr-wrow` min 44 · `.pr-row` min 44 | 1px 차이(반 픽셀 방지 결정과 어긋남) |

### 2-2. 모서리

`border-radius` 229곳 — 토큰 131, 숫자 98. 스퀴클은 전역 `* { corner-shape: squircle }`(app.css:3)로 걸려 있고 원·알약 24곳만 `round`로 되돌렸어요.

| 요소 | 기준 | 지금 | 어긋남 |
| --- | --- | --- | --- |
| 단추 | 작은 것 6(sm)·큰 것 8(md) | 주 단추 `.btn-primary` 8 · `.btn` 6 · `.jbtn-add`·`.pr-save` 6 · `.kb`·`.jp-chip`·`.fx-tab`·`.jp-nav`·`.mod-icon` **7** · `.bd-unit button` **5** · `.cal-views button` calc(8−2) | 같은 보라 단추가 머리 줄 8·줄 안 6(이건 괜찮음) · 7·5는 토큰 밖 |
| 입력칸 | 6 | `.cell-input`·`.input`·`.jday-in` 6 · `.gate-input`·`.field > input`? 8 · `.mgr .padd .input`·`.jp-field-box` 8 · `.td-due-input` 999 · `.bd-in`·`.bd-selk` 6(숫자) | 큰 입력칸은 8 — 단추처럼 "34면 8" 규칙이면 맞음 |
| 배지 | 6 | **5**(`.chip-x` `.kind-key` `.jproj-badge` `.memo-row` `.td-list-box` `.td-link-badge` `.td-src` `.td-due` `.cal-kind-box` `.cal-ev` `.cal-more` `.bd-unit button` `.kb-cap` `.pr-d` `.fx-target` `.fx-lock` `.fx-new` — 16곳) · 6(sm)(`.pbadge` `.cm-status` `.jsp` `.mod-tag` `.chip`) · 6 숫자(`.cal-kbadge` `.bd-chip`) · **4**(`.cal-wk-col .cal-ev` `.jp-kind` `.jp-proj` `.jp-sp` `.fx-up` `.pchip-x`) · 999(`.pchip` `.cm-fpill` `.cal-num`) | 5·4가 토큰 밖 — 가장 많이 어긋남 |
| 뜨는 상자·판 | 8(md) 또는 14(lg) | **10**(`.gate-note` `.cm-fdd` `.td-cal` `.g-box` `.xl-menu` `.jp-cal` `.pr-ask` `.fx-pane` `.fx-tree` `.fx-cf-card`) · `.cal-quick`·`.cal-grid` calc(8+6)=14 | 10은 토큰 밖(10곳) |
| 뜨는 목록·메뉴 | 8 | 8 대부분 · `.cm-fdd`·`.xl-menu` 10 | 2곳 |
| 카드 | 14 | `.card`·`.ccard`·`.jcard`·`.jcal`·`.jn-aside`·`.td-card`·`.gate-card` 14 · `.cm`·`.ct-new`·`.pr-table`·`.bd-tbl`·`.jday` 8 · `.jp-card` 6 | 표 상자는 8 — "표는 8, 카드는 14"로 정하면 맞음 |
| 원·알약 round 빠짐 | 원·알약은 `round` | `.switch`(547) `.switch .knob`(561) `.jcal-dot`(1697) `.rte ul>li::before`(2714) `.cal-now::before`(5342) `.g-dot`(5608) `.pr-run-dot`(6748) `.search-x`(8921) | 8곳 — 스퀴클이 그려지면 동그라미가 네모져요(PC 조각 10-dark 설정 스위치 참고) |

### 2-3. 글자 크기·좌우 여백·간격

| 항목 | 기준 | 지금 | 어긋남 |
| --- | --- | --- | --- |
| 글자 크기 | 13·12.5·12·11.5(+22·17·14.5) | 12px 94곳 · 12.5px 36 · 11.5px 32 · **11px 22** · **13.5px**(`.fx-drv`·`.jcal-mon`·`.pr-ask-t`) · **10.5**(`.cal-cbtn`) · 14(`.jsearch-go`·`.bd-year b`·`.cm-memo-body input`) · 뜨는 창 제목 16(`.dialog-title`)·17(`.xl-ask-title`·`.jp-title`)·19(`.cal-dlg-title input`) | 11px 배지(`.td-src`·`.td-link-badge`·`.jproj-badge`·`.fx-*`·`.pr-d`)는 단계 밖 · 창 제목 3가지 |
| 단추 좌우 여백 | — | `.btn` 12 · `.btn-ctrl.btn-text` 14 · `.btn-primary` 16 · `.btn-xs`·`.pr-save` 10 · `.cal-views button`·`.fx-tab` 14 | 10/12/14/16 |
| 입력칸 좌우 여백 | — | `.cell-input` 6 · `.input` 8 · `.gate-input` 10 · `.search` 12 | 6/8/10/12 |
| 뜨는 창 안쪽 가로 | 20(`.dialog-*`) | 20 · 24(`.xl-ask`) · 18(`.fx-cf-*`·`.fx-rn-*`) · 14(`.pr-ask`·`.fx-findpanel`) | 4가지 |
| gap | 4·8·12·16 | 8을 `var(--space-2)` 53곳·`8px` 29곳 · **6px 59곳**(토큰 없음) · 2·3·5·7·10·14 | 6px은 사실상 표준인데 토큰이 없어요 |
| 화면 바깥 여백 | 24/28 | 9화면 모두 `.main` 24/28 | **통과** |
| 머리 줄과 본문 사이 | 16(`.main` gap) | `.main` 16 · `.pr` 12 · `.fx-root`·`.bd` 14 | 민원처리·탐색기·집행현황이 2~4px 좁아요 |
| 머리 줄 높이 | 34 | 9화면 모두 34 | **통과**(설정 단추만 30) |

### 2-4. 색

| 항목 | 지금 | 고칠 것 |
| --- | --- | --- |
| `#` 직접 | `app.css:7938-7939` `.fx-up` #fff3d6/#b7791f(탐색기 "위 폴더" — **어둡게에서도 그대로**) · `FileIcon.tsx:61-85` 파일 아이콘 12색 · `FilesScreen.tsx:1547` #4B9A5B | `.fx-up`은 토큰(`--up-bg/--up-fg`) 두 테마 값으로. 파일 아이콘은 "윈도우 아이콘 색을 흉내 낸 그림"이라 예외로 두되 tokens.css에 `--fi-*`로 모으기(애매함 — 사용자 결정) |
| 그림자 | `.dialog` `rgba(0,0,0,.35)`(1422) · `.pr-menu`·`.pr-ask`·`.fx-menu` `rgba(20,18,38,…)`(7143·7200·7744) — `--shadow-rgb`(28,27,34) 아님 · 뜨는 메뉴 그림자 4종 | `--shadow-rgb`로 통일, 뜨는 메뉴는 `--shadow-pop` 토큰 하나 |
| 어둡게 | 토큰은 세 곳 모두 같은 값(brand.md 4절 확인) · PC 어둡게 조각에서 색 문제 없음 | — |

### 2-5. 글자 가운데 맞춤 (0.9.4 1~8번 + 1600×900 재기)

0.9.4 항목이 코드에 있는지(상세 code-values.md 5절): ① Pretendard 있음 ② body `round(1.4em,1px)` 있음, 숫자 line-height 16곳 남음(모두 정수 px — 민원처리·탐색기·집행현황·엑셀 창 새 코드) ③ 있음 ④ 있음 ⑤ `.jtree-d`만 없음(요소가 없어져 해당 없음) ⑥ 있음, 단 `.side-bottom .side-item` 33·`.side-folded` 36 예외 ⑦ `src/snap.ts` 있음(`main.tsx`에서 설치) ⑧ 있음, 새 화면에 괄호 안내 3곳 재등장(`FilesDialogs.tsx:320` `FilesScreen.tsx:1333` `ProcessScreen.tsx:1250`).

**1600×900 재기 결과(밝게 74.1% = 679곳 중 503 · 어둡게 80.4%)** — 자세한 표는 [`ui-0.15.0-align.md`](./ui-0.15.0-align.md). 0.9.4 때(1920×1080) 54% → 시안 82% 목표였는데 지금 74%예요. 어둡게가 높은 것은 입력칸 글자 대비가 낮아 −2가 덜 잡혀서예요(실제 모양은 같음).

| 어긋남 | 어디 | 몇 곳 | 값 | 고치는 법 |
| --- | --- | --- | --- | --- |
| 입력칸 글자 1px 높음 | `input.cell-input`·`.input`·`.input-sm`·`.pr-in` (민원대장·연락처·설정·관리 창·공사 관리) | 약 70 | −2 | 0.9.4의 `padding-bottom: 2px`(app.css:5768)로도 남아요 → **3px**(또는 `padding-top: 1px`). 숫자 칸 `.num`(+1 20곳, 허용 범위)이 뒤집히지 않는지 함께 봐요 |
| 민원대장 열 제목 글자 1px 낮음 | `button.cm-hbtn` | 19/19 | +1 | `padding-bottom: 1px` |
| 민원처리 남은 날 배지 1px 높음 | `span.pr-d`(·`.urgent`) | 15/15 | −2 | `padding-top: 1px` |
| 캘린더 종류 고르기 단추 | `button.cal-kp-btn` | 4/4 | −2 | `padding-top: 1px` |
| 공사 관리 양식 단추 | `button.pr-tpl` | 3/3 | +1 | `padding-bottom: 1px` |
| 메모 편집기 도구 단추 '가' | `button.tb` | 2/6 | −2 | `padding-top: 1px` |
| 탐색기 아래 상태 줄 | `div.fx-status` | 2/2 | +1 | `padding-bottom: 1px` |
| 눈으로 봐야 하는 곳 | 탐색기 드라이브 단추·빠른 필터·'자세히 ▾'(아이콘 섞임), `select`(리눅스 그림), 키 설정 'Ctrl' 4곳, 일괄 이름 바꾸기 고정폭 칸 | — | — | UI 통일 세션이 윈도우에서 10배 확대로 확인 |

화면별로 어긋남이 없는 곳: 업무일지(본 화면)·할 일 목록·집행현황 전체·잠금·알림 확인·엑셀 가져오기 창. 민원대장 계열이 가장 낮아요(8/20 ~ 12/31) — 입력칸 −2와 열 제목 +1이 모두 거기 있어서예요.

재기 도구 메모: 저장소 `tools/align/measure.py`에 `run2.py`가 부르는 `run()`이 없어 원본은 돌아가지 않아요(0.9.4 세션이 덮어쓴 듯). 이번에 쓴 복사본 `run1600.py`·`measure_ws.py`(1600×900, 창이 떠 있으면 창 안쪽만, 어둡게, 새 화면 49개)를 `tools/align/`에 넣으면 돼요 — 코드 수정 없음 규칙이라 이번엔 저장소에 안 넣었고, UI 통일 세션이 넣어요.

### 2-6. 그 밖에 눈에 띈 것 (PC 실제 화면)

- **사용자 신고(2026-10-18 17:21, 125% 배율 캡처)**: ① 입력칸 글자(placeholder "종료"·"상대 이름")가 위로 2~4px 떠 보임 — 2-5의 입력칸 −2(약 70곳)와 같은 원인이고, 125%에서는 1px이 1.25px로 반올림돼 더 커 보여요. 1순위로 고쳐요(`padding-bottom` 3px). ② 설정 스위치: 트랙이 알약이 아니라 둥근 네모, 노브가 동그라미가 아니라 둥근 네모(스퀴클 전역 적용에 `round`가 빠진 8곳 중 `.switch`·`.switch .knob`), 노브가 1px 위로 보임(`top: 2px`는 100%에서 가운데지만 125%에서 2.5px이 2/3으로 갈림 + 아래쪽 그림자) → `corner-shape: round` + `top: calc(50% - 8px)` + 그림자를 `0 0 2px`로.
- **사용자 신고(17:29)**: ③ 할 일 "할 일 추가" ⊕ 아이콘(약 15px)과 항목 체크 동그라미(`.td-check` 18px)가 크기 다름 → 둘 다 18로. ④ 집행현황 단위(원/천원) 토글: `.bd-unit`(8892) 높이 34·안쪽 3px인데 단추 26이라 아래 2px이 남아 단추가 위로 붙어요 → `align-items: center` 또는 단추 28(결정 ②). ⑤ 스크롤바가 화면마다 달라요: 집행현황만 `.bd-scroll`(8955~8971) 얇은 막대, 탐색기는 `scrollbar-gutter`만, 나머지는 윈도우 기본 → 세로·가로 모두 한 규칙(`body` 전역 `scrollbar-width: thin; scrollbar-color: var(--line) transparent` + `::-webkit-scrollbar` 8px). ⑥ 할 일 "새 목록 만들기" 칸과 + 단추는 재 보니 둘 다 30px로 같아요(채운 보라 네모가 커 보이는 착시) — 결정 ①로 둘 다 28이 돼요.

- 민원대장 연번 열(처음 폭 44)이 4자리(1546)에서 **두 줄로 꺾여요** — 3년치 자료에서 바로 보임. 연번 열 폭 52 또는 글자 12로.
- 뜨는 창 폭: 분류·종류·프로젝트 관리 480(결정대로) · 일정 추가 590 · 공사 관리 1220(표라 예외) · 일괄 이름 바꾸기 ≈ 1100.
- 뜨는 창 아래 단추: 관리 창은 "닫기" 보라 하나, 일정 창은 취소+저장 — 뜻이 달라 괜찮아요. 다만 "닫기"가 주 단추(보라)인 것은 애매함(1안 보라 그대로 / 2안 보조 단추).
- 업무일지 새 카드: 시각 칸(`.jtime-in`?) 폭이 기둥 120px인데 그 아래 구분 칸은 테두리가 강조색이라 머리 줄 입력칸(테두리 line)과 달라 보여요 — 포커스 때문이면 괜찮음.
- 민원처리 "전송 완료" 단추(초록 바탕, `.pr-sent` 26·sm)는 상태 배지인데 단추 모양 — 배지(22)로 보일지 단추로 보일지 애매함.

## 3. 고칠 방법 — 공통 규칙 하나로

원칙: `tokens.css`·`app.css` 공통 규칙으로 고치고, 화면별 예외는 따로 적어요. 아래 "결정 필요"는 사용자 1안/2안.

### 3-1. tokens.css에 더할 토큰

```css
--size-mini: 28px;        /* 줄 안 단추·입력칸·칩 (size-input과 같은 값 — 이름만 분명히) */
--size-badge-h: 22px;     /* 배지 높이 */
--space-1h: 6px;          /* 6px 간격(59곳) */
--fs-sm: 12.5px; --fs-xs: 12px; --fs-badge: 11.5px;   /* 글자 단계 */
--shadow-pop: 0 8px 24px rgba(var(--shadow-rgb), .16);   /* 뜨는 메뉴 */
--up-bg / --up-fg (밝게 #FFF3D6/#8A6400, 어둡게 #3A3012/#F0CF6A)  /* .fx-up */
```
디자인 시스템 `size-side` 200 → 180, 사이드바 칸 35, 배지 22, 줄 안 28을 디자인 시스템 README·tokens.json에도 적어요.

### 3-2. app.css 공통 규칙 (한 번에 고치는 것)

1. **높이 두 단계**: 머리 줄·창 아래 단추·검색창 = 34(md 8) / 줄 안·카드 안 단추·입력칸·칩 = 28(sm 6). → `.btn` 30→28? 또는 34? (**결정 ①**), `.input` 30→28, `.jday-in`·`.input-sm`·`.td-due-input` 26→28, `.cal-dlg-grid .cell-input`·`.cal-select` 32→28, `.jp-field-box` 35→34, `.td-newlist-add` 30→28, `.cal-knew`·`.bd-carry` 32→34, `.jedit-foot .btn-xs` 26→28, `.side-bottom .side-item` 33→35, `.prow` 44→45.
2. **배지 한 값**: 높이 22 · 모서리 `--radius-sm` · 글자 11.5 · 좌우 8 → `.td-due`·`.td-src`·`.td-link-badge`·`.kind-key`·`.kb-cap`·`.fx-up` 20→22, `.pr-d`·`.fx-target`·`.fx-new`·`.fx-lock` 18→22(또는 줄 안 작은 배지 18 유지 — **결정 ④**), `.cal-num`·`.pr-work` 24→22, 모서리 5·4 → `var(--radius-sm)`, 글자 11 → 11.5.
3. **모서리 숫자 → 토큰**: 5px 16곳·4px 6곳 → sm, 7px 6곳 → sm 또는 md(크기 따라), 10px 10곳 → md(작은 상자)·lg(판), 6px 숫자 9곳 → `var(--radius-sm)`.
4. **round 빠진 원 8곳**에 `corner-shape: round`.
5. **단추 좌우 여백**: 34 단추 14 · 28 단추 10 · 아이콘 단추 0. 입력칸 좌우 8(표 줄 안은 6 허용).
6. **뜨는 창**: 제목 16 하나(`.xl-ask-title`·`.jp-title` 17→16, `.cal-dlg-title input` 19→16 굵게), 안쪽 가로 20 하나, 그림자 `.dialog`→`--shadow-rgb`, 메뉴 그림자 `--shadow-pop`.
7. **line-height 숫자 16곳** → `round(Xem, 1px)` (인쇄 종이 8곳은 px 유지).
8. **간격**: `8px`→`var(--space-2)` 29곳, `6px`→`var(--space-1h)` 59곳, `.pr`·`.fx-root`·`.bd` 세로 gap → 16.
9. **색**: `.fx-up` 토큰, 그림자 rgba 3곳 토큰, (결정) 파일 아이콘 색 모으기.
10. **괄호 안내 3곳** 빼기, 연번 열 폭.

### 3-3. 화면별 예외(그대로 두는 것)

잠금 화면 입력칸·열기 36(얼굴 — 결정 2026-10-18) · 관리 창 추가 칸 34(결정 0.9.4) · 공사 관리 창 폭 1220(표) · 인쇄 종이(`.jp-*`) px 고정 · 캘린더 숫자 칸·시각 칸 1px(사용자 확정) · 파일 아이콘 색(윈도우 흉내).

## 4. 결정 (2026-10-18 17:09 사용자 확정)

| 번호 | 항목 | 결정 |
| --- | --- | --- |
| ① | 줄 안 단추 높이 | **1안 28**(모서리 6) — 머리 줄·창 아래 단추만 34(모서리 8) |
| ② | 작은 단추·탭 | **1안 28 하나** — 단추 높이는 34·28 둘뿐 |
| ③ | 큰 입력칸(관리 창 추가·인쇄 기간·잠금) | **1안 34·모서리 8 유지** — 규칙 "34면 8, 28이면 6"을 tokens.css 주석·디자인 시스템에 적기 |
| ④ | 배지 | **1안 22·모서리 6·글자 11.5 하나**(18·20·24·26·30 전부 22로) |
| ⑤ | 고르는 칩(필터·프로젝트 필터·분류 관리·설정 목록) | **2안 전부 네모**(모서리 6, 높이 28 — ①과 같은 키). 알약은 캘린더 날짜 동그라미·스위치 같은 원형만 |
| ⑥ | 관리 창 "닫기" | **2안 흰 보조 단추** — 보라는 저장·등록·추가처럼 무언가를 하는 단추에만 |
| ⑦ | 파일 아이콘 색 12개 | **1안 그대로** — `tokens.css`에 `--fi-*`로 모아 적기만 |
| ⑨ | 배율 | **100%·125% 둘 다 기준**(2026-10-18 17:36) — 반 픽셀이 생기는 값(홀수 여백·2.5px)은 피해요 |
| ⑩ | 2차 H4·H7·H9·H10·H12·H13 | **2026-10-18 19:45 사용자 "제안대로"** — ⊕ r=11 · 125%는 안쪽 자리만 4의 배수 · 125% 보정 0.8px 미디어 쿼리 · 둥근 스크롤바 12px · 아이콘 16/14/10 · 사이드바 36·관리 창 줄 44·일지 배지 22 (6-4절) |
| ⑧ | 스퀴클 확인 | **1안** 설정 "정보" 카드에 WebView2(엔진) 버전 한 줄 — 139 이상이면 스퀴클이 그려져요 |

## 5. "UI 통일" 세션 인수인계 — 고칠 목록 (파일·줄)

규칙: 코드는 가지 `wip/ui`에, 빌드는 허가 뒤 빌드 세션. 순서는 영향이 큰 것부터. 줄 번호는 main `dd69594` 기준 `src/app.css`.

### A. tokens.css
1. `--size-mini: 28px` · `--size-badge-h: 22px` · `--space-1h: 6px` · `--fs-sm: 12.5px` · `--fs-xs: 12px` · `--fs-badge: 11.5px` · `--shadow-pop` · `--up-bg`·`--up-fg`(두 테마 세 곳) 추가. (결정 ⑦이면 `--fi-*` 파일 아이콘 색.)
2. 디자인 시스템 아티팩트 README·tokens.json: `size-side` 200→180, 사이드바 칸 35, 배지 22, 줄 안 28, 글자 단계 → 같이 고쳐요(버전 올림).

### B. app.css — 높이 (결정 ①~④ 뒤)
- 429 `.btn` 30→28(결정 ①) · 479 `.input` 30→28 · 494 `.input-sm` 26→28 · 1829 `.jday-in` 26→28 · 4070 `.td-due-input` 26→28 · 4954 `.cal-dlg-grid .cell-input` 32→28 · 4982 `.cal-select` 32→28 · 5549 `.cal-dlg-grid .cal-kp-btn` 32→28 · 3396 `.cm-memo-body .memo-row input` 32→28 · 6098 `.jp-field-box` 35→34 · 3880 `.td-newlist-add` 30→28 · 5070 `.cal-knew` 32→34 · 9316 `.bd-carry` 32→34 · 2355 `.jedit-foot .btn-xs` 26→28 · 4503 `.cal-manage` 24→28 · 120 `.side-bottom .side-item` 33→35 · 1457 `.prow` min 44→45 · 6781 `.pr-row`·7251 `.pr-wrow` min 44→45 · 7827 `.fx-hdr` 26→(표 머리 줄 통일 값) · 1587 `.jcal-today` 30→34(머리 줄) 또는 28.
- 작은 단추(결정 ②): 1248 `.memo-add` 22 · 7813 `.fx-findband .fx-fk` 22 · 2310 `.jsp-btn` 24 · 8230 `.fx-chip button` 24 · 9596 `.bd-sumbar button` 24 · 1080 `.tool` 24 · 4130 `.td-cal-nav` 24 → 28(또는 22 단계).
- 배지(결정 ④): 3952 `.td-src,.td-link-badge` 20→22 · 4347 `.td-due` 20→22 · 663 `.kind-key` 20→22 · 6679 `.kb-cap` 20→22 · 7931 `.fx-up` 20→22 · 6944 `.pr-d` 18→22 · 7604 `.fx-target`·8287 `.fx-new`·7944 `.fx-lock` 18→22 · 4750 `.cal-num` 24→22 · 6979 `.pr-work` min 24→22 · 598 `.chip` 26→28 · 831 `.pchip`·3161 `.cm-fpill`·3174 `.cm-fpill-open` 999→`var(--radius-sm)`, 높이 28(결정 ⑤ 네모) · 644 `.kind` 30→28.
- 검색창 폭: 1803 `.jn-search` 240→260 · 8916 `.bd-search` 240→260 · 7498 `.fx-search` 300→260(탐색기는 찾기 칸이라 300 유지해도 됨 — 애매함).

### C. app.css — 모서리
- 5px→`var(--radius-sm)`: 623 `.chip-x` · 668 `.kind-key` · 1327 `.memo-row` · 2191 `.jproj-badge` · 3844 `.td-list-box` · 3958 `.td-link-badge,.td-src` · 4353 `.td-due` · 4537 `.cal-kind-box` · 4800 `.cal-ev` · 4876 `.cal-more` · 8906 `.bd-unit button` · 6684 `.kb-cap` · 6949 `.pr-d` · 7609 `.fx-target` · 7949 `.fx-lock` · 8292 `.fx-new`.
- 4px→sm: 5315 `.cal-wk-col .cal-ev` · 7937 `.fx-up` · 8672 `.pchip-x` · 9152 `.bd-cr` · 8018 `.fx-thumb`(인쇄 `.jp-*` 3곳은 그대로).
- 7px→sm/md: 6050 `.jp-chip` · 6149 `.jp-nav` · 6636 `.kb` · 7559 `.fx-tab`(md) · 8744 `.mod-icon`.
- 10px→md 또는 lg: `.gate-note` `.cm-fdd` `.td-cal` `.g-box` `.xl-menu` `.jp-cal` `.pr-ask` `.fx-pane` `.fx-tree` `.fx-cf-card`(판은 lg 14, 메뉴·상자는 md 8).
- 6px 숫자→토큰: 5053 `.cal-kbadge` · 6434 `.jp-card` · 9261 `.bd-chip` · 9297 `.bd-memo` · 9330 `.bd-in` · 9357 `.bd-selk` · 9414 `.bd-mi` · 9596 `.bd-sumbar button` · 8018 `.fx-up-big`.
- `corner-shape: round` 추가(**사용자 신고 — 먼저**): 547 `.switch` · 561 `.switch .knob`(+ `top: calc(50% - 8px)`, 그림자 `0 0 2px`) · 1697 `.jcal-dot` · 2714 `.rte-area ul>li::before,.rte-view ul>li::before` · 5342 `.cal-now::before` · 5608 `.g-dot` · 6748 `.pr-run-dot` · 8921 `.search-x`.

### D. app.css — 글자·여백·간격
- 글자 11→11.5: 3952 `.td-src,.td-link-badge` · 2184 `.jproj-badge` · 6944 `.pr-d` · 7604 `.fx-target` · 8287 `.fx-new` · 6455 `.jp-kind`·6495 `.jp-proj`·6516 `.jp-sp`(인쇄는 그대로 둬도 됨) · 142 `.side-kb`. 13.5→13: 7631 `.fx-drv` · 1744 `.jcal-mon` · 7204 `.pr-ask-t`. 10.5→11.5: 5358 `.cal-cbtn`. 창 제목 5959 `.xl-ask-title`·6011 `.jp-title` 17→16, 4905 `.cal-dlg-title input` 19→16.
- 단추 좌우 여백: 34 단추 14(381 `.btn-primary` 16→14, 4637 `.cal-nav .btn` 12→14), 28 단추 10(429 `.btn` 12→10, 2331 `.jbtn-add` 12→10, 690 `.seg button` 12→10).
- 입력칸 좌우 8: 267 `.gate-input` 10→8(잠금은 예외 가능), 940 `.cell-input` 6 유지(표 줄 예외).
- 뜨는 창 안쪽 가로 20: 5952 `.xl-ask-body` 24→20 · 5972 `.xl-ask-foot` · 6005 `.jp-head` 24→20 · 6306 `.jp-foot` · 8244/8250/8306 `.fx-cf-*` 18→20 · 8320/8365/8466 `.fx-rn-*` 18→20 · 7191 `.pr-ask` 14→20 · 8171 `.fx-findpanel` 14→20.
- line-height 숫자→`round(Xem,1px)`: 2075 `.jline-t` · 2306 `.cell-input.jtalk` · 3371 `.cm-area-auto` · 5962 `.xl-ask-title` · 5968 `.xl-ask-path` · 6014 `.jp-title` · 6993 `.pr-work` · 7916 `.fx-nm` · 8885 `.bd-year b` · 9499 `.bd-confirm p` · 9552 `.bd-checks`.
- gap: `8px`→`var(--space-2)` 29곳, `6px`→`var(--space-1h)` 59곳(부록 gap 표) · 6717 `.pr` gap 12→16, height calc 빼고 `.main` 흐름 따르기 · 7460 `.fx-root`·8846 `.bd` gap 14→16.
- 색: 7938-7939 `.fx-up` → `var(--up-bg)`/`var(--up-fg)` · 1422 `.dialog` 그림자 `rgba(var(--shadow-rgb),.35)` · 7143 `.pr-menu`·7200 `.pr-ask`·7744 `.fx-menu` → `var(--shadow-pop)`.

### E. 글자 가운데 맞춤 1px
- 5768 `.cell-input,.input,.jday-in,.td-due-input { padding-bottom: 3px }`(2→3, `.input-sm`·`.pr-in`도 포함) — 숫자 칸 `.num` 확인.
- 3118 `.cm-hbtn { padding-bottom: 1px }` · 6944 `.pr-d { padding-top: 1px }` · 5498 `.cal-kp-btn { padding-top: 1px }` · 7358 `.pr-tpl { padding-bottom: 1px }` · 1281 `.tb { padding-top: 1px }` · 탐색기 `.fx-status { padding-bottom: 1px }`.
- `tools/align/`에 `run1600.py`·`measure_ws.py` 넣고 README 고치기(1600×900, 창 안쪽만, 어둡게). 고친 뒤 다시 재서 밝게 90% 이상 확인.

### F. tsx
- `FilesDialogs.tsx:320` "바꿀 글자 (비우면 지움)"→"바꿀 글자" · `FilesScreen.tsx:1333` "파일 찾기 (Ctrl+F)"→"파일 찾기" · `ProcessScreen.tsx:1250` "이름·초성 (업무연락처)"→"이름·초성".
- `complaints.ts` 연번 열 처음 폭 44→52(4자리 연번 두 줄 꺾임).
- (결정 ⑦ 2안이면) `FileIcon.tsx:61-85` 색을 토큰으로.

### G. 끝낸 뒤
- 밝게·어둡게 1600×900 스크린샷 두 벌로 UIAudit 판과 같은 자리 다시 잘라 비교 · 디자인 시스템 아티팩트 버전 올림 · CLAUDE.md "공통 — 글자 가운데 맞춤"에 3px·1px 손질 적기 · 현황판.


## 6. 2차 검수 — 보이는 요소 전수조사 (2026-10-18 17:36~, 사용자 신고 뒤)

사용자가 1차에서 놓친 것 여섯 가지(입력칸 글자 위, 스위치 노브 네모·위, ⊕와 체크 동그라미 크기, 집행현황 단위 토글, 스크롤바 다름, 가로 스크롤)를 신고해서 방법을 바꿨어요. 1차가 "코드에 적힌 값"을 세었다면 2차는 **실제로 그려진 결과**를 다 읽었어요 — 화면·창 45개 × 밝게/어둡게 × **100%·125%** + **자료를 채운 상태**(프로젝트 20개·40자 이름·민원 60건·연번 1546·120자 내용·할 일 40·일지 14·일정 12 + 보이는 빈 칸 전부 채움) = 315장, 요소 60,035개(`getBoundingClientRect`·computed style + 글자 픽셀 재기). 전체 표는 [docs/qa/ui-0.15.0-census.md](https://github.com/zeondas/gilog/blob/main/docs/qa/ui-0.15.0-census.md), 원자료·조각은 작업 공간 `scratchpad/audit/`(census.json 78MB·shots2 315장·cells2 200쌍·census.py/analyze.py/report.py).

### 6-1. 사용자 신고 여섯 가지의 판정
| 신고 | 잰 결과 | 고치기 |
| --- | --- | --- |
| ① 입력칸 글자가 위 | 맞아요. placeholder는 −1이지만 **실제 한글을 넣으면 −2**(`.cell-input` 42곳·`.pr-in` 10·`.input` 5·`.input-sm` 3·`select.input` 3, `.jtalk` −4). 125%에서는 −3 | 5-E `padding-bottom: 3px` 그대로 — 실제 글자로도 확인. `.jtalk`(2306)도 넣기 |
| ② 스위치 노브 네모·위 | squircle 맞음(1차 C항). 위치는 100%에서 2/2로 가운데, **125%에서 2.5/2.5 → 한쪽으로 반올림** | `corner-shape: round` + 노브 자리를 4의 배수로(6-5) |
| ③ ⊕ vs 체크 동그라미 | 둘 다 18px 상자. ⊕는 svg 안 원이 r=9/24라 **그려진 지름 13.5px**(`TasksScreen.tsx:666`). 체크 동그라미는 `.td-check { margin-top: 1px }`로 글줄보다 1px 아래(192곳) | r=11로(그려진 18) + margin-top 0 |
| ④ 단위 토글 안쪽 네모 위 | **100%에선 정확히 가운데**(3+1/3+1). 125%에서 34→42.5·26→32.5 물리 px라 아래 가장자리가 반 픽셀에 걸려 흐려지고 내려앉아 보여요 — 둥근 상자 62가지·2,062곳 공통 | 6-7(사용자 결정) |
| ⑤ 스크롤바 다름 | 실제로 막대가 생긴 곳은 `main.main`·`.cal-wk-scroll`·`.fx-rn-body`·`.dialog-body` 넷뿐이고 **모두 브라우저 기본**. 집행현황 `.bd-scroll`의 둥근 14px 막대는 `scrollbar-width: thin`이 `::-webkit-scrollbar`를 무력화해(크로미움 121+) **안 그려지고 있었어요** | 한 규칙으로(6-10, 모양은 사용자 결정) |
| ⑥ 가로 스크롤 | 어느 화면·상태에서도 안 생겨요(민원대장 열은 `fitWidths`가 표 폭에 맞춤). 가로 막대가 생기면 6-10 규칙이 같이 적용돼요 | — |

### 6-2. 1차에 없던 새 발견
1. **머릿기호 칸 글자가 반 픽셀에 떠 있어요** — `.bl-m { height: calc(var(--fs) * 1.5) }` = 19.5px(app.css:3485) → `.bl-line` 위 4.5/아래 3.5. 민원대장 내용·조치내용·할 일 세부정보·메모 창 모든 여러 줄 칸(108곳). `round(1.5em, 1px)`로.
2. **125%에서만 글자가 어긋나는 18가지** — 배지·단추는 +1~2 물리 px 내려가고(`.cm-hbtn` +2 57곳, `.cm-status`·`.chip` +1, `.td-src`·`.bd-chip`·`.btn-xs`·`select.cal-select`·`.fx-drop` +2) 입력칸은 −3. 1px 보정이 1.25 물리 px가 되어 반올림이 갈리기 때문(100%에서 맞는 곳도 125%에서 틀려요).
3. **125%에서 부모 안 자식이 .5에 걸리는 34가지** — 노브(2→2.5), 사이드바 아이콘(10→12.5), `.btn-ctrl` 안 아이콘(9→11.25), `.pbadge` 안 글자(2→2.5), `.cm-c` 안 `.cell-input`(2→2.5). 배경 있는 것(노브·배지)은 눈에 띄고 선 아이콘은 덜 보여요.
4. **홀수 높이** — `.side-item` 35·`.jproj-badge` 21·`.prow` 45 → 125%에서 43.75·26.25·56.25 물리 px로 양쪽이 흐려요(0.9.4 결정값이라 사용자 결정).
5. **세부정보 아이콘** `.td-note-icon { margin-top: 3px }`(4320)도 체크 동그라미와 같은 꼴(108곳) → 2px.
6. **일괄 이름 바꾸기 창의 네이티브 체크박스**(`FilesDialogs.tsx:95·329·330`)는 `accent-color`가 없어 **크롬 기본 파란 체크**로 그려져요 → `input[type=checkbox], input[type=radio] { accent-color: var(--accent) }` 한 줄.
7. **아이콘 svg 크기 15가지**(10~18px)가 섞여 있어요 — 같은 뜻(지우기 ×)이 `.tool` 13·`.tool-danger` 14·`.pr-del` 14·`.tool-box` 14·`.chip-x` 11, 머리 줄 단추 안 아이콘이 화면마다 16/12/14/15. 정한 값은 사이드바 15/17뿐 → 표로 정해요(6-12).
8. 숫자 칸 `.num`(전화·날짜)은 채우면 −2 → −1로 좋아져요(그대로 둠). `.jtel`(업무일지 기둥 전화번호) 위 8/아래 0은 아래에 붙이는 설계로 봐요.

### 6-3. 자료를 채운 상태에서 달라진 것
- 늘어나도 옆 글자 위치가 흔들리지 않은 것: 위치 칸 복사 단추 `.cm-copy` 22→58(세 줄 주소), `.bl-ta` 20→40, `.bl-ed` 28→127(3줄 머릿기호), 프로젝트 칩 20개가 두 줄로 넘어가도 `.pchip` 28 유지, 40자 프로젝트 이름은 `.pbadge-t` 말줄임 유지(배지 높이 그대로).
- 달라진 것: 입력칸 −1 → −2(위 ①), `.jtalk` −4 → 3/−4(말 줄 textarea는 글자 수에 따라 위치가 달라요 — 2306 line-height 숫자를 `round()`로), `.td-due`·`.td-due.today` 1 → 2(배지 22로 맞출 때 같이 봐요), 연번 1546은 두 줄 꺾임(5-F 폭 52).
- 재기 한계: **뜨는 창 뒤에 흐려진(scrim+blur) 요소는 글자 픽셀 재기가 흐린 그림을 읽어 신뢰도가 낮아요** — 위 수치는 창이 없는 화면(민원대장·업무연락처·설정·업무일지 본 화면)에서 같은 값이 나온 것만 적었어요. UI 통일 세션이 다시 잴 때는 `census.py`에 "overlay 아래 요소 제외"를 더해요.

### 6-4. 2차에서 더한 고칠 목록 (5절 A~G에 이어 H)
| | 무엇 | 어디(main `1c8a981` `src/app.css`) | 고치기 |
| --- | --- | --- | --- |
| H1 | 머릿기호 칸 반 픽셀 | 3485 `.bl-m` | `height: round(1.5em, 1px)` — `measureBullets`가 이 높이를 읽는지 확인 |
| H2 | 입력칸 −2 | 5768 | 3px + `.input-sm`·`.pr-in`·`select.input`·`select.cal-select`·`.fx-filter`·`textarea.cell-input.jtalk`(2306) |
| H3 | 체크 동그라미·세부정보 아이콘 | 4273 `.td-check` margin-top 1→0 · 4320 `.td-note-icon` 3→2 | — |
| H4 | ⊕ 크기 | `TasksScreen.tsx:666` `circle r=9` | **확정 1안** — `r=11`(그려진 지름 18, 상자 18 그대로) — 체크 동그라미와 같은 크기 |
| H5 | 스위치 | 547·561·573 | `corner-shape: round` + 트랙 20→**24**·노브 16·`top/left: 4px`·켜짐 `left: 24px`(트랙 폭 44) — 100%·125% 모두 정수. 또는 트랙 20 유지·노브 12·`top: 4px` |
| H6 | `.jcal-dot` squircle | 1697 | `corner-shape: round`(C항과 함께) |
| H7 | 125% 둥근 상자 가장자리 흐림 | 높이 34·26·22·18·30·35·21 | **확정 2안**(2026-10-18 19:45 사용자 "제안대로") — 결정 ①④ 높이는 그대로, 안에 든 것(노브·배지 글자·`.cm-c` 안 입력칸)의 자리만 4의 배수로(H8) |
| H8 | 125% 자식 .5 | 노브·`.pbadge` padding 2→4 또는 0·`.cm-c` 안 입력칸 | 배경 있는 것만 고치고 선 아이콘은 두기 |
| H9 | 125% 글자 +1~2 / −3 | 1px 보정들 | **확정 1안** — `@media (min-resolution: 1.25dppx)` 안에서 1px 보정값(5768 블록·`.cm-hbtn`·`.pr-d`·`.cal-kp-btn`·`.pr-tpl`·`.tb`·`.td-src`·`.jproj-badge` 등 E항)을 `0.8px`(=1 물리 px)로 바꾸는 규칙 한 묶음. 100%는 그대로 |
| H10 | 스크롤바 한 규칙 | 8955~8971 `.bd-scroll` · 188 `.main` · 1442 `.dialog-body` · 5277 `.cal-wk-scroll` · 8357 `.fx-rn-body` · 7870 `.fx-list` | **확정 2안** — 전역 `::-webkit-scrollbar { width: 12px; height: 12px }` + `::-webkit-scrollbar-thumb { background: var(--line); border: 3px solid transparent; background-clip: padding-box; border-radius: 6px }` + track 투명, `scrollbar-width` 선언은 모두 삭제(있으면 webkit 규칙이 무시됨). 세로·가로 같은 규칙, 주 보기 `scrollbar-gutter`는 그대로 |
| H11 | 네이티브 체크박스 | `FilesDialogs.tsx:95·329·330` | app.css 공통에 `accent-color: var(--accent)` |
| H12 | 아이콘 크기 표 | `Icons.tsx`·각 화면 svg | **확정 1안 세 단계** — 머리 줄(34) 단추 안 **16**, 줄 안·작은(28) 단추 안 **14**, 배지(22) 안 **10**. 지금 13(`.tool`·`.fx-drv`·`.fx-ib`)·15(`.pr-icon`·`.bd-memo`·`.mod-icon`)·11(`.chip-x`·`.cal-kind-box`)·12(`.fx-up`·`.td-done-toggle`)·`.btn-ctrl` 안 12/14/15를 이 표로. 사이드바 15/17은 H13과 함께 16(펼침)·18(접힘) |
| H13 | 홀수 높이 | 68 `.side-item` 35 · 2184/5791 `.jproj-badge` 21 · 1457 `.prow` 45 · 6781 `.pr-row`·7251 `.pr-wrow` | **확정 2안** — 사이드바 메뉴 **36**(`.side-bottom .side-item`도), 관리 창 줄 **44**(`.prow`·`.pr-row`·`.pr-wrow`), 일지 프로젝트 배지 **22**(④와 같게). 100% 글자 맞춤은 아이콘 16·여백으로 다시 재서 맞춰요(0.9.4 결정 6번 35px은 이것으로 바뀜) |

**결정 끝(2026-10-18 19:45 사용자 "제안대로": H4 1안·H7 2안·H9 1안·H10 2안·H12 1안·H13 2안)** — 적용 순서(권함): H2 → H1 → H3·H4 → H5·H6 → H10 → H11 → H13 → H12 → H8·H7 → H9(맨 끝, 125%만 다시 재기). 고친 뒤 `census.py light 1`·`census.py light 1.25`·`census.py light 1 "" filled` → `analyze.py` → `report.py`로 다시 재서 글자 맞춤 90% 이상·자식 치우침 0·125% 전용 어긋남 0을 확인해요(`census.py`에 overlay 아래 요소 제외를 먼저 더해요).

### 6-5. 도구 메모(UI 통일 세션용)
- `tools/align/measure.py`에 `run()`이 없어 `run2.py`가 안 돌아요 → 작업 공간 `run1600.py`·`measure_ws.py`·`census.py`를 `tools/align/`에 넣고 README를 고쳐요.
- `tools/align/seed.js`는 업무연락처 프로젝트 칸에서 `p.alias`가 없어 멈춰요(`wip/contacts` 뒤 구조) — `alias: ""` 보정 필요(`census.py`의 `BIG_JS`에 있음).
- 헤드리스 크로미움은 스크롤바를 숨기니 `ignore_default_args=["--hide-scrollbars"]`로 켜요. 125%는 `device_scale_factor=1.25`.


## 7. 적용 결과 (2026-10-18 UI 통일 세션, 가지 `wip/ui` `6701218` — 빌드 전)

A~G·H1~H13을 차례로 넣었어요. 문서와 다르게 한 것(재 보고 정함):
- **E·H2 입력칸**: `padding-bottom 3px`은 글자를 더 띄워요(여백 1px = 위−아래 2 변화). 그래서 0.9.4의 2px을 지우고 위아래 여백 0 — 100% 칸 채움에서 한글 0, 숫자 +1(허용). `.jtalk`도 위아래 4/4로.
- **B 묶음 단추**: `.seg`·`.bd-unit`·`.cal-views`는 34 상자(테두리 1 + 안쪽 3) 안 26 — 28이면 상자가 36이 돼요. 사용자 신고 ④는 100%에서 정확히 가운데라 125% 흐림 문제(H7, 높이 유지 결정)예요.
- **B `.fx-hdr`**: 표 머리 줄 통일 값이 정해지지 않아 28(`size-mini`). **`.jcal-nav`·`.jcal-today`**: 카드 안이라 28. **`.pr` 높이 계산**은 `.main` 안쪽 높이와 같아 그대로 두고 gap만 16.
- **E 나머지**: `.cm-hbtn`·`.pr-d`는 1600×900에서 어긋나지 않아 그대로. `.td-src`·`.td-link-badge` 위 1px은 배지 22로 바뀌며 빼야 맞았어요. `.cal-kp-btn`·`.cal-nav .btn` 위 1px, `.fx-drv` 위 2px, `.pr-tpl` 28. `.tb` '가'·`kb-cap` 'Ctrl'은 고치면 다른 쪽이 어긋나 그대로.
- **H9 125%**: `@media (min-resolution: 1.25dppx)` — 입력칸 `padding-bottom 1.6px`, `.cm-hbtn`·`.fx-tab`·`.fx-vb` 1.2px, `.fx-drv` 위 0.4px, `.cal-kp-btn` 위 0. 배지(`.td-src` 등 +1)는 0.8px은 안 움직이고 1.2px부터 −3으로 넘어가 그대로 뒀어요.
- **H12**: 검색칸 지우기 ×(12)·탐색기 탭 핀(11)·트리 꺾쇠(10)·`cal-kp-btn` 꺾쇠(10)·민원처리 "전송 완료" 아이콘은 단추 안 아이콘이 아니라 그대로.
- **⑥ 닫기**: 관리 창 셋 + 공사 관리 + 캘린더 하루 창·알림 확인 + 민원대장 필터 창 모두 흰 보조 단추.
- **⑧**: 설정 정보 카드에 "WebView2 버전" 한 줄.
- A2: 디자인 시스템 v10(토큰 size-mini·size-badge-h·space-1h·shadow-pop·up-bg/fg, size-side 180, README "간격과 모양").

재기(`tools/align/census.py`, 1600×900, 빈 칸에 한글·숫자 채움): 100% 밝게 90.4%(271곳 중 245) · 어둡게 90.4% · 125% 68.8%(272곳 중 187, 고치기 전 45.6%). 남은 것은 숫자·괄호 든 글 +1(허용), 아이콘 섞인 단추(재기 한계), 125% 배지 +1.

윈도우에서 사용자가 볼 것(100%·125% 둘 다): ① 입력칸 한글이 가운데인지(업무일지 상대 이름·민원대장 신규 줄) ② 설정 스위치가 알약·동그라미이고 노브가 가운데인지 ③ ⊕와 체크 동그라미 크기 ④ 스크롤바가 모든 화면에서 둥근 12px인지 ⑤ 설정 정보의 WebView2 버전(139 이상) ⑥ 사이드바 메뉴 36·아이콘 16 ⑦ 창의 "닫기"가 흰 단추.
