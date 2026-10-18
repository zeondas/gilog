# UI 모양 일관성 검사 — 코드 값 원자료 (0.15.0, main `dd69594`)

읽은 것: `src/app.css`(9,623줄, 선언 5,313개) · `src/tokens.css` · `src/*.tsx` 인라인 style. 코드는 고치지 않았어요. 값은 읽기 쉽게 줄여 적었어요: `6(sm)`=`var(--radius-sm)`=6px, `8(md)`, `14(lg)`, `34(ctrl)`=`var(--size-ctrl)`, `28(input)`=`var(--size-input)`, `36(row)`=`var(--size-row)`, `13(fs)`=`var(--fs)`, 간격 토큰 `var(--space-N)`은 px 숫자(4·8·12·16·24·28)로 적었고 `px`는 뺐어요. 표에서 **굵게**는 같은 묶음 안에서 가장 많은 값과 다른 곳이에요.

## 요약 — 가장 많이 흔들리는 값 5가지
1. **요소 높이**: 단추·입력칸이 26·28·30·32·34(·35·36)으로 섞여요 — `.btn` 30, `.btn-ctrl` 34, `.btn-xs` 26, `.jbtn-add`·`.pr-save`·`.cal-add` 28, `.cal-knew`·`.bd-carry` 32, `.gate-open` 36 / `.input` 30, `.cell-input` 28, `.jday-in` 26, `.cal-dlg-grid .cell-input` 32, `.mgr .padd .input` 34, `.jp-field-box` 35, `.gate-input` 36. 전체 `height` 234곳 중 26px 24곳·28px 24곳·30px 14곳·32px 12곳·`--size-ctrl` 10곳·`--size-input` 6곳.
2. **모서리**: 토큰(`--radius-sm/md/lg`와 그 calc) 131곳 vs 숫자 px 98곳. 숫자 중 `6px` 9곳은 토큰 sm과 같은 값을 직접 적은 것(집행현황 `.bd-*`·`.cal-kbadge`·`.jp-card`), 그 외 5px 16곳·10px 10곳·4px 10곳·7px 6곳·3px 5곳·9px 1곳. 배지 모서리가 5·6(sm)·6·7·4·999로, 뜨는 목록이 `8(md)`와 `10px`로 갈려요.
3. **글자 크기**: 12px 94곳·12.5px 36곳·11.5px 32곳·11px 22곳·13px 8곳(+`--fs` 11곳) — 0.5px 단위가 섞여요. 같은 종류 안에서도 단추 12.5(`.btn`)·13(`.btn-ctrl`)·12(`.btn-xs`·`.pr-*`), 배지 11·11.5·12, 뜨는 창 제목 16(`.dialog-title`)·17(`.xl-ask-title`·`.jp-title`)·19(`.cal-dlg-title input`)·13.5(`.pr-ask-t`).
4. **좌우 안쪽 여백**: 단추 `.btn` 0 12 · `.btn-ctrl.btn-text` 0 14 · `.btn-primary` 0 16 · `.btn-xs` 0 10 · `.pr-save` 0 10; 입력칸 `.cell-input` 0 6 · `.input` 0 8 · `.gate-input` 0 10 · `.search` 0 12; 뜨는 창 안쪽 가로 여백 20(`.dialog-*`)·24(`.xl-ask`)·18(`.fx-cf-*`·`.fx-rn-*`)·14(`.pr-ask`·`.fx-findpanel`).
5. **사이 간격(gap)과 토큰 혼용**: 8px을 `var(--space-2)`로 53곳, `8px`로 29곳 적었고 4px도 토큰 11곳·숫자 17곳. gap 값은 6px 59곳이 가장 많지만 토큰에는 6이 없어요(`--space-1`=4, `--space-2`=8). 2·3·5·7·10·14px도 각각 여러 곳.
- 그 밖에: 스퀴클은 `* { corner-shape: squircle }` 한 줄로 전체에 걸고 동그라미·알약 24곳만 `round`로 되돌렸는데 8곳(`.switch`, `.switch .knob`, `.jcal-dot`, `.rte ul>li::before`, `.cal-now::before`, `.g-dot`, `.pr-run-dot`, `.search-x`)은 되돌리지 않았어요(4번). 토큰 대신 직접 적은 색은 `app.css` 2곳(`.fx-up` #fff3d6·#b7791f)과 `FileIcon.tsx`의 파일 아이콘 색 12개(3번). 글자 가운데 맞춤 1~8번은 ⑤ `.jtree-d`(요소가 없어짐)와 ⑦ 설치 위치(App이 아니라 `main.tsx`)만 빼고 다 들어 있어요(5번). 화면 바깥 여백은 `.main` 하나(24/28px)로 같고, 머리 줄은 설정 화면만 단추가 `.btn`(30px)이에요(6번).

---

## 1·2. 요소 종류별 값 (선택자 · 파일:줄 · 모서리 · 높이 · 안쪽 여백 · 글자 크기 · 줄 높이 · 간격)

높이 칸에 `min 30`은 `min-height`만 있는 경우예요. 안쪽 여백 칸의 `top 1`·`bottom 2`는 `padding-top`·`padding-bottom`만 따로 적은 곳(글자 가운데 맞춤 보정)이에요. 묶음에 넣은 선택자는 이름과 app.css 주석을 보고 고른 것이라, 한 요소가 두 묶음에 들어간 경우(예 `.pr-save`, `.seg button`)도 있어요.

### 인라인 style(.tsx)에 적힌 크기 값
| 파일:줄 | 요소 | 값 |
|---|---|---|
| src/CalendarScreen.tsx:479 | `.cal-grid` | `height: gridH` — 화면이 재서 넣는 달력 높이(바깥 여백 24px까지) |
| src/CalendarScreen.tsx:509 | `.cal-week` | `minHeight: cellH`, `gridTemplateRows: 30px repeat(lanes, 24px) 1fr` — 날짜 머리 30px, 일정 줄 24px(일정 `.cal-ev`는 22px) |
| src/CalendarScreen.tsx:741·874 | `.cal-wk-body` | `HOUR = 44` → 높이 24×44 = 1056px |
| src/CalendarScreen.tsx:899-908 | 주 보기 일정 | `height: max(20, 분×44/60 − 2)`, `left/width calc(%)`, `borderLeft 3px`, `background: color-mix(… 22%, var(--surface))` |
| src/CalendarScreen.tsx:839 | `.cal-wk-head` | `paddingRight: bar`(스크롤 막대 폭을 재서) |
| src/FilesScreen.tsx:1212·1254 | `.fx-up-big`·`.fx-gicon` | `width 88/48, height 66/48`(썸네일/목록) |
| src/BudgetScreen.tsx:807 | `.bd-fill` | `paddingLeft: 40 / 0`(세부사업 들여쓰기) |
| src/BulletParts.tsx:18 | `.bl-m` | `marginLeft: calc(var(--bl-indent, 6.5px) * lv)` |
| src/SettingsScreen.tsx:849 | `.chip.chip-colored` | `background/color: STATUS_COLORS` 값(토큰 `var(--st-*)` 문자열) |
| src/JournalScreen.tsx:1741, ContactsScreen.tsx:430·510·646·1093, JournalPrint.tsx:529, ProcessScreen.tsx:530 | 프로젝트 배지 | `var(--pj-N-bg/-fg/-line)` 토큰만 |
| 나머지 인라인 style | 위치(left/top), 너비, visibility, fontWeight, `--cm-cols`/`--bd-cols` 같은 변수 | 크기 값 없음 |


### 단추 — 주 단추(.btn-primary 계열, 보라 채움)

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.btn-primary` | app.css:381 | **8(md)** | **34(ctrl)** | **0 16** | **12.5** |  |  |
| `.btn-primary.btn-ctrl` | app.css:5002 |  |  | **0 16** | **13(fs)** |  |  |
| `.gate-open` | app.css:292 |  | **36** |  | **13** |  |  |
| `.jbtn-add` | app.css:2331 | 6(sm) | **28(input)** | 0 12 |  |  | 6 |
| `.jedit-foot .btn-primary.btn-xs` | app.css:2355 | 6(sm) | **26** | 0 12 |  |  |  |
| `.mgr-add` | app.css:5729 |  |  |  |  |  | 6 |
| `.pr-fetch` | app.css:6729 |  |  |  |  |  | **8** |
| `.pr-save` | app.css:7436 | 6(sm) | 28 | **0 10** | 12 |  |  |
| `.td-newlist-add` | app.css:3880 |  | **30** |  |  |  |  |
| `.cal-add` | app.css:4669 |  | 28 |  |  |  |  |
| `.btn-add` | app.css:935 |  | 28 |  |  |  |  |
| `.cal-knew` | app.css:5070 |  | **32** |  |  |  |  |
| `.bd-carry` | app.css:9316 |  | **32** | 0 12 | 12 |  |  |

값 분포 — border-radius: 6(sm)×3 · 8(md)×1 / height: 28×3 · 32×2 · 34(ctrl)×1 · 36×1 · 28(input)×1 · 26×1 · 30×1 / padding: 0 12×3 · 0 16×2 · 0 10×1 / font-size: 12×2 · 12.5×1 · 13(fs)×1 · 13×1 / gap: 6×2 · 8×1

### 단추 — 보조 단추(.btn 계열, 테두리)

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.btn` | app.css:429 | 6(sm) | **30** | **0 12** | 12.5 |  | 6 |
| `.btn-sm` | app.css:458 | 6(sm) | **30** |  |  |  | 6 |
| `.btn-ctrl` | app.css:795 | **8(md)** | **34(ctrl)** |  | **13(fs)** |  |  |
| `.btn-ctrl.btn-text` | app.css:791 |  |  | **0 14** |  |  |  |
| `.cal-nav .btn` | app.css:4637 | **8(md)** | **34(ctrl)** | **0 12** | **13(fs)** |  |  |
| `.cal-nav .cal-navbtn` | app.css:4644 |  |  | **0** |  |  |  |
| `.cal-detail-btn` | app.css:4663 |  | **28(input)** |  |  |  |  |
| `.cal-allday` | app.css:4970 | **999** | **32** |  |  |  |  |
| `.cal-cancel` | app.css:5032 |  |  | **0 16** |  |  |  |
| `.jcal-today` | app.css:1587 | 6(sm) | **30** |  |  |  |  |
| `.jcal-today` | app.css:1604 |  |  | **0 10** | **12** |  |  |
| `.td-done-toggle` | app.css:4417 |  | **34** | **0 16** | 12.5 |  | **8** |
| `.td-done-toggle` | app.css:5795 |  |  | **bottom 2** |  |  |  |
| `.cal-manage` | app.css:4503 |  | **24** |  |  |  | **4** |
| `.cm-fall` | app.css:3213 |  | **28** | 0 8 | 12.5 |  |  |
| `.cm-fdd-clear` | app.css:3352 | 6(sm) | 26 | 0 8 | 12.5 |  |  |
| `.jonly` | app.css:2402 | **999** | **28** | **0 12** | 12.5 |  |  |
| `.fx-sq` | app.css:7515 |  |  | **0 10** |  |  |  |
| `.fx-drv` | app.css:7631 | 6(sm) | **28(fx-ctl=input)** | **0 10** | **13.5** |  | **5** |
| `.fx-vb` | app.css:7667 | 6(sm) | **28(fx-ctl=input)** | 0 8 | **12** |  | 6 |
| `.pr-next` | app.css:7030 | 6(sm) | 26 | **0** | **12** |  |  |
| `.pr-sent` | app.css:7062 | 6(sm) | 26 |  | **12** |  | **5** |
| `.pr-tpl` | app.css:7358 | 6(sm) | 26 | 0 8 | **12** |  | 6 |
| `.jsearch-go` | app.css:2435 | 6(sm) |  | **2 6** | **14** |  | **8** |
| `.kb` | app.css:6636 | **7** | **28** | **0 4** |  |  | **3** |

값 분포 — border-radius: 6(sm)×10 · 8(md)×2 · 999×2 · 7×1 / height: 26×4 · 30×3 · 28×3 · 34(ctrl)×2 · 28(fx-ctl=input)×2 · 28(input)×1 · 32×1 · 34×1 · 24×1 / padding: 0 8×4 · 0 12×3 · 0 10×3 · 0×2 · 0 16×2 · 0 14×1 · bottom 2×1 · 2 6×1 · 0 4×1 / font-size: 12.5×5 · 12×5 · 13(fs)×2 · 13.5×1 · 14×1 / gap: 6×4 · 8×2 · 5×2 · 4×1 · 3×1

### 단추 — 작은 단추(xs·mini·fk 류)

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.btn-xs` | app.css:802 |  | 26 | 0 10 | 12 |  |  |
| `.memo-add` | app.css:1248 | 6(sm) | **22** | **0 6** | 12 |  |  |
| `.jsp-btn` | app.css:2310 | 6(sm) | **24** | **0 8** | **11.5** |  |  |
| `.cm-hbtn` | app.css:3118 | 6(sm) | **28(input)** | **0 6** | 12 |  | 4 |
| `.fx-fk` | app.css:7800 | 6(sm) | 26 | 0 10 | 12 |  | **6** |
| `.fx-findband .fx-fk` | app.css:7813 |  | **22** | **0 8** |  |  |  |
| `.fx-chip button` | app.css:8230 |  | **24** | **0 8** | 12 |  |  |
| `.fx-chip button + button` | app.css:8238 |  |  | **0 6** |  |  |  |
| `.pr-save` | app.css:7436 | 6(sm) | **28** | 0 10 | 12 |  |  |
| `.bd-sumbar button` | app.css:9596 | **6** | **24** |  |  |  |  |
| `.bd-unit button` | app.css:8901 | **5** | 26 | 0 10 | **12.5** |  |  |
| `.seg button` | app.css:690 | 6(sm) | 26 | **0 12** | **12.5** |  |  |
| `.cal-views button` | app.css:5129 | **calc(8(md) - 2)** | **calc(34(ctrl) - 8)** | **0 14** |  |  |  |
| `.link-btn` | app.css:5075 |  |  | **0** |  |  |  |
| `.fx-more` | app.css:7501 |  |  | **0** | 12 |  |  |
| `.gate-link` | app.css:305 |  |  | **2 4** | 12 |  |  |

값 분포 — border-radius: 6(sm)×6 · 6×1 · 5×1 · calc(8(md) - 2)×1 / height: 26×4 · 24×3 · 22×2 · 28(input)×1 · 28×1 · calc(34(ctrl) - 8)×1 / padding: 0 10×4 · 0 6×3 · 0 8×3 · 0×2 · 0 12×1 · 0 14×1 · 2 4×1 / font-size: 12×8 · 12.5×2 · 11.5×1 / gap: 4×1 · 6×1

### 단추 — 아이콘 단추(네모·동그라미)

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.btn-icon` | app.css:466 | 6(sm) | 26 | 0 |  |  |  |
| `.tool` | app.css:1080 | 6(sm) | **24** | 0 |  |  |  |
| `.tool-box` | app.css:1098 |  |  |  |  |  |  |
| `.tool-box` | app.css:1493 | 6(sm) | 26 | 0 |  |  |  |
| `.tb` | app.css:1281 | 6(sm) | 26 | 0 | 13 |  |  |
| `.tb-wide` | app.css:2564 |  |  | **0 7** | **12** |  | 4 |
| `.cm-memo` | app.css:3056 | 6(sm) | 26 | 0 |  |  |  |
| `.jtrash` | app.css:2362 | 6(sm) | **28** |  |  |  |  |
| `.jcal-nav` | app.css:1587 | 6(sm) | **30** |  |  |  |  |
| `.jcal-nav` | app.css:1599 |  |  | 0 |  |  |  |
| `.td-cal-btn` | app.css:4051 | 6(sm) | 26 | 0 |  |  |  |
| `.td-cal-nav` | app.css:4130 | 6(sm) | **24** | 0 |  |  |  |
| `.cal-cbtn` | app.css:5358 | **50%** | **24** | 0 | **10.5** |  |  |
| `.cal-cbtn` | app.css:5784 |  |  | **top 1** |  |  |  |
| `.cal-dlg-foot .cal-trash` | app.css:5024 | **8(md)** | **34(ctrl)** |  |  |  |  |
| `.jp-x` | app.css:6018 | **8(md)** | **32** |  |  |  |  |
| `.jp-nav` | app.css:6149 | **7** | **28** |  |  |  |  |
| `.search-x` | app.css:8921 | **50%** | **20** | 0 |  |  |  |
| `.chip-x` | app.css:615 | **5** | **20** | 0 |  |  |  |
| `.pchip-x` | app.css:8663 | **4** | **16** | 0 |  |  |  |
| `.cm-fpill-x` | app.css:3194 | **999** | **24** | 0 |  |  |  |
| `.fx-ib` | app.css:7682 | 6(sm) | **28(fx-ctl=input)** | 0 |  |  |  |
| `.fx-drop` | app.css:8436 | 6(sm) | **28(fx-ctl=input)** | 0 |  |  |  |
| `.pr-icon` | app.css:7077 | 6(sm) | **28** | 0 |  |  |  |
| `.pr-del` | app.css:7095 | 6(sm) | **28** | 0 |  |  |  |
| `.pr-add` | app.css:7382 | 6(sm) | **28** | 0 |  |  |  |
| `.bd-memo` | app.css:9297 | **6** | 26 | 0 |  |  |  |
| `.bd-cr` | app.css:9140 | **4** | **20** | 0 |  |  |  |
| `.td-check` | app.css:4266 | **50%** | **18** | 0 |  |  |  |
| `.cal-ev-check` | app.css:5163 | **50%** | **16** | 0 |  |  |  |
| `.swatch` | app.css:1478 | **50%** | **18** | 0 |  |  |  |
| `.cpick-grid .swatch` | app.css:3734 |  | **22** |  |  |  |  |
| `.cal-cgrid .swatch` | app.css:5408 |  | **22** |  |  |  |  |
| `.bd-year button` | app.css:8869 |  | **32** |  |  |  |  |
| `.mod-icon` | app.css:8744 | **7** | **28** |  |  |  |  |

값 분포 — border-radius: 6(sm)×14 · 50%×5 · 8(md)×2 · 7×2 · 4×2 · 5×1 · 999×1 · 6×1 / height: 26×6 · 28×6 · 24×4 · 20×3 · 32×2 · 16×2 · 28(fx-ctl=input)×2 · 18×2 · 22×2 · 30×1 · 34(ctrl)×1 / padding: 0×23 · 0 7×1 · top 1×1 / font-size: 13×1 · 12×1 · 10.5×1 / gap: 4×1

### 입력칸

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.input` | app.css:479 | 6(sm) | **30** | **0 8** |  |  |  |
| `.input` | app.css:5768 |  |  | **bottom 2** |  |  |  |
| `.input-sm` | app.css:494 |  | **26** |  |  |  |  |
| `.field > input` | app.css:366 | 6(sm) | **34(ctrl)** | **0 8** |  |  |  |
| `.gate-input` | app.css:267 | **8(md)** | **36** | **0 10** |  |  |  |
| `.cell-input` | app.css:940 | 6(sm) | **28(input)** | 0 6 |  |  |  |
| `.cell-input` | app.css:5768 |  |  | **bottom 2** |  |  |  |
| `.cell-input.jtalk` | app.css:2299 |  | **auto** | **calc((28(input) - 20) / 2 - 1) 6 calc((28(input) - 20) / 2 + 1)** |  | 18 |  |
| `.cal-dlg-grid .cell-input` | app.css:4954 |  | **32** |  |  |  |  |
| `.td-newlist .cell-input` | app.css:3875 |  | **30** |  |  |  |  |
| `.edit-grid .cell-input` | app.css:1396 |  |  |  | **13(fs)** |  |  |
| `.search` | app.css:761 | **8(md)** | **34(ctrl)** | **0 12** |  |  | 8 |
| `.search input` | app.css:780 |  |  |  |  |  |  |
| `.search input` | app.css:5775 |  | **20** | **0 0 1** |  |  |  |
| `.jday-in` | app.css:1829 | 6(sm) | **26** | 0 6 | **13(fs)** |  |  |
| `.jday-in` | app.css:5768 |  |  | **bottom 2** |  |  |  |
| `.td-due-input` | app.css:4070 | **999** | **26** | **0 8** | 12.5 |  |  |
| `.td-due-input` | app.css:5768 |  |  | **bottom 2** |  |  |  |
| `.td-add-title` | app.css:4002 | 6(sm) | **calc(36(row) - 8)** | 0 6 |  |  |  |
| `.cal-select` | app.css:4982 | 6(sm) | **32** | 0 6 |  |  |  |
| `.cal-dlg-title input` | app.css:4905 |  | **40** | **0 2** | **19** |  |  |
| `.cal-kp-btn` | app.css:5498 | 6(sm) | **28(input)** | **0 6 0 8** |  |  | **7** |
| `.cal-dlg-grid .cal-kp-btn` | app.css:5549 |  | **32** |  |  |  |  |
| `.cm-area` | app.css:2923 |  | **min 28(input)** | **4 6** |  | **round(1.45em, 1)** |  |
| `.cm-new > .cm-area-auto` | app.css:3368 |  |  | **5 10** |  | **28(input)** |  |
| `.bl-ed` | app.css:3524 |  | **auto** | **3 6** |  |  |  |
| `.bl-ta` | app.css:3543 |  |  | **0** |  | **round(1.5em, 1)** |  |
| `.memo-row input` | app.css:1338 |  | **28(input)** |  | 12.5 |  |  |
| `.cm-memo-body .memo-row input` | app.css:3396 |  | **32** |  | **14** |  |  |
| `.mgr-name-in` | app.css:5812 |  | **28** |  |  |  |  |
| `.mgr .padd .input` | app.css:5724 | **8(md)** | **34(ctrl)** |  |  |  |  |
| `.fx-filter` | app.css:7661 |  | 28(fx-ctl=input) |  | 12.5 |  |  |
| `.fx-path-in` | app.css:7728 |  | 28(fx-ctl=input) |  | **12** |  |  |
| `.fx-crumbs` | app.css:7702 | 6(sm) | 28(fx-ctl=input) | 0 6 | **12** |  | **2** |
| `.fx-grp .input` | app.css:8384 |  | 28(fx-ctl=input) |  | 12.5 |  |  |
| `.fx-grp .input` | app.css:8490 |  |  |  |  |  |  |
| `.fx-fgrid .input` | app.css:8185 |  | 28(fx-ctl=input) |  |  |  |  |
| `.bd-in` | app.css:9330 | **6** | **28** | 0 6 |  |  |  |
| `.bd-selk` | app.css:9357 | **6** | **28** | 0 6 | 12.5 |  | **2** |
| `.pchips` | app.css:8625 | 6(sm) | **min 28(input)** | **2 4** |  |  | **4** |
| `.pchips-in` | app.css:8645 |  | **22** | **0 2 1** |  |  |  |
| `.jp-field-box` | app.css:6098 | **8(md)** | **35** | **0 10** |  |  | 8 |
| `.jp-field-box input` | app.css:6120 |  | **20** | **0 0 1** |  |  |  |
| `.cm-fdd-search` | app.css:3272 | 6(sm) | **30** | **0 8** |  |  | **6** |
| `.rte-area` | app.css:2620 |  | **min 96** | **8 10** |  | **round(1.55em, 1)** |  |
| `.rte-area` | app.css:2641 |  |  |  |  |  |  |
| `.kb-wait` | app.css:6692 |  |  | **0 4** | **12** |  |  |

값 분포 — border-radius: 6(sm)×10 · 8(md)×4 · 6×2 · 999×1 / height: 28(fx-ctl=input)×5 · 32×4 · 30×3 · 26×3 · 34(ctrl)×3 · 28(input)×3 · 28×3 · auto×2 · 20×2 · min 28(input)×2 · 36×1 · calc(36(row) - 8)×1 · 40×1 · 22×1 · 35×1 · min 96×1 / padding: 0 6×7 · 0 8×4 · bottom 2×4 · 0 10×2 · 0 0 1×2 · calc((28(input) - 20) / 2 - 1) 6 calc((28(input) - 20) / 2 + 1)×1 · 0 12×1 · 0 2×1 · 0 6 0 8×1 · 4 6×1 · 5 10×1 · 3 6×1 · 0×1 · 2 4×1 · 0 2 1×1 · 8 10×1 · 0 4×1 / font-size: 12.5×5 · 12×3 · 13(fs)×2 · 19×1 · 14×1 / line-height: 18×1 · round(1.45em, 1)×1 · 28(input)×1 · round(1.5em, 1)×1 · round(1.55em, 1)×1 / gap: 8×2 · 2×2 · 7×1 · 4×1 · 6×1

### 배지 — 상태·종류·프로젝트·마감·칩

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.chip` | app.css:598 | **6(sm)** | **26** | **0 3 0 10** | **12.5** |  | **2** |
| `.chip-colored` | app.css:611 |  |  |  |  |  |  |
| `.kind` | app.css:644 | **6(sm)** | **30** | **0 3 0 10** |  |  | 6 |
| `.kind-key` | app.css:663 | 5 | **20** | 0 6 | **12** |  |  |
| `.pchip` | app.css:831 | **999** | **28** | **0 10** | **12.5** |  | 6 |
| `.pbadge` | app.css:870 | **6(sm)** | 22 | **0 9** | 11.5 |  |  |
| `.pbadge` | app.css:8551 |  |  |  |  |  |  |
| `.pbadge.pchip-b` | app.css:8657 |  | 22 | **right 2** |  |  | **2** |
| `.cm-status` | app.css:3044 | **6(sm)** | 22 | **0 9** | 11.5 |  | 6 |
| `.cm-dday` | app.css:3034 |  |  |  | 11.5 |  |  |
| `.cm-fpill` | app.css:3161 | **999** | **28** |  | **12.5** |  |  |
| `.cm-fpill-open` | app.css:3174 | **999** | **26** | **0 4 0 10** | **12.5** |  | 6 |
| `.jsp` | app.css:2050 | **6(sm)** | 22 |  | 11.5 |  |  |
| `.jproj-badge` | app.css:2184 | 5 | **min 20** | **2 5** | **11** | **round(1.25em, 1)** |  |
| `.jproj-badge` | app.css:5791 |  |  | **top 3** |  |  |  |
| `.jproj-badge` | app.css:9613 |  |  |  |  |  |  |
| `.td-link-badge` | app.css:3952 | 5 | **20** | **0 7** | **11** |  |  |
| `.td-link-badge` | app.css:5784 |  |  | **top 1** |  |  |  |
| `.td-src` | app.css:3952 | 5 | **20** | **0 7** | **11** |  |  |
| `.td-src` | app.css:5784 |  |  | **top 1** |  |  |  |
| `.td-due` | app.css:4347 | 5 | **20** | **0 7** | 11.5 |  | 6 |
| `.cal-kbadge` | app.css:5053 | **6** | 22 | **0 9** | **12** |  |  |
| `.cal-ev` | app.css:4795 | 5 | 22 | 0 6 | **12** |  | **5** |
| `.cal-ev` | app.css:5147 |  |  |  |  |  |  |
| `.cal-daylist .cal-ev` | app.css:5096 |  | **26** |  |  |  |  |
| `.cal-wk-col .cal-ev` | app.css:5310 | **4** |  | **2 6** |  | **round(1.35em, 1)** |  |
| `.cal-more` | app.css:4871 | 5 | 22 | 0 6 | 11.5 |  |  |
| `.cal-num` | app.css:4750 | **999** | **24** | **0 5** |  |  |  |
| `.cal-num` | app.css:5784 |  |  | **top 1** |  |  |  |
| `.mod-tag` | app.css:8804 | **6(sm)** | 22 | **0 8** | **12** |  |  |
| `.bd-chip` | app.css:9261 | **6** | 22 | **0 8** | **12** |  | **3** |
| `.fx-target` | app.css:7604 | 5 | **18** | 0 6 | **11** |  |  |
| `.fx-new` | app.css:8287 | 5 | **18** | 0 6 | **11** |  |  |
| `.fx-lock` | app.css:7944 | 5 | **18** | **0 5** |  |  |  |
| `.fx-lock-s` | app.css:7954 |  | **16** | **0 4** |  |  |  |
| `.fx-up` | app.css:7931 | **4** | **20** |  |  |  |  |
| `.pr-d` | app.css:6944 | 5 | **18** | 0 6 | **11** |  |  |
| `.pr-work` | app.css:6979 | **6(sm)** | **min 24** | **3 9** | 11.5 | **16** |  |
| `.kb-cap` | app.css:6679 | 5 | **20** | **0 6 1** | 11.5 |  |  |
| `.ct-new-row > .ct-new-tag` | app.css:923 |  |  | **0 10** | 11.5 |  |  |
| `.cm-new-tag` | app.css:2908 |  |  |  | 11.5 |  |  |
| `.td-list-box` | app.css:3835 | 5 | **16** |  |  |  |  |
| `.cal-kind-box` | app.css:4532 | 5 | **16** |  |  |  |  |
| `.cal-kind-swatch` | app.css:5008 | **4** | **12** |  |  |  |  |
| `.ask-band` | app.css:1109 | **8(md)** |  | **8 10** | **12.5** |  | **8** |
| `.jp-kind` | app.css:6455 | **4** |  | 0 6 | **11** | 17 |  |
| `.jp-proj` | app.css:6495 | **4** |  | 0 6 | **11** | **15** |  |
| `.jp-sp` | app.css:6516 | **4** |  | **0 5** | **11** | 17 |  |

값 분포 — border-radius: 5×14 · 6(sm)×7 · 4×6 · 999×4 · 6×2 · 8(md)×1 / height: 22×9 · 20×6 · 18×4 · 26×3 · 16×3 · 28×2 · 30×1 · min 20×1 · 24×1 · min 24×1 · 12×1 / padding: 0 6×8 · 0 9×3 · 0 7×3 · top 1×3 · 0 5×3 · 0 3 0 10×2 · 0 10×2 · 0 8×2 · right 2×1 · 0 4 0 10×1 · 2 5×1 · top 3×1 · 2 6×1 · 0 4×1 · 3 9×1 · 0 6 1×1 · 8 10×1 / font-size: 11.5×10 · 11×9 · 12.5×5 · 12×5 / line-height: 17×2 · round(1.25em, 1)×1 · round(1.35em, 1)×1 · 16×1 · 15×1 / gap: 6×5 · 2×2 · 5×1 · 3×1 · 8×1

### 카드·판

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.card` | app.css:198 | **14(lg)** |  |  |  |  |  |
| `.card-head` | app.css:207 |  |  | 12 16 | 14.5 |  |  |
| `.card-body` | app.css:215 |  |  | 12 16 |  |  |  |
| `.ccard` | app.css:1016 | **14(lg)** |  | **12 14** |  |  | 8 |
| `.ccard` | app.css:8621 |  |  |  |  |  |  |
| `.ccard-band` | app.css:1028 |  |  | **10 14** |  |  | **2** |
| `.jcard` | app.css:1896 | **14(lg)** |  |  |  |  |  |
| `.jcal` | app.css:1550 | **14(lg)** |  |  |  |  |  |
| `.jcal-head` | app.css:1558 |  |  | **10 10 10 14** |  |  | **4** |
| `.jn-aside` | app.css:2466 | **14(lg)** |  |  |  |  |  |
| `.jn-aside-head` | app.css:2476 |  |  | **10 14** |  |  | 8 |
| `.td-card` | app.css:3919 | **14(lg)** |  |  |  |  |  |
| `.td-card-head` | app.css:3932 |  |  | 12 16 |  |  | 8 |
| `.gate-card` | app.css:248 | **14(lg)** |  | **40 32 24** |  |  |  |
| `.g-box` | app.css:5640 | **10** |  | **12** |  |  | 8 |
| `.keys-box` | app.css:6608 | 8(md) |  | **8 8 6 12** |  |  | **2** |
| `.fx-cf-card` | app.css:8255 | **10** |  | **12** |  |  | 8 |
| `.fx-grp` | app.css:8376 | 8(md) |  | **10 12 12** |  |  | 8 |
| `.fx-grp` | app.css:8485 |  |  |  |  |  |  |
| `.fx-pane` | app.css:7535 | **10** | min 0 |  |  |  |  |
| `.fx-tree` | app.css:8071 | **10** |  |  |  |  |  |
| `.fx-tree-head` | app.css:8080 |  | **36** | **0 12** | **12** |  |  |
| `.cm` | app.css:2809 | 8(md) |  |  |  |  |  |
| `.ct-new` | app.css:883 | 8(md) |  |  |  |  |  |
| `.pr-table` | app.css:6771 | 8(md) | min 0 |  |  |  |  |
| `.bd-tbl` | app.css:8940 | 8(md) | min 0 |  |  |  |  |
| `.bd-tbl` | app.css:9570 |  |  |  |  |  |  |
| `.jday` | app.css:1808 | 8(md) |  | **10 16** |  |  | **8 20** |
| `.jsearch-bar` | app.css:2386 | 8(md) |  | **10 16** |  |  | **8 12** |
| `.cal-quick` | app.css:4650 | **calc(8(md) + 6)** | **min 46** | **0 8 0 12** |  |  | 8 |
| `.cal-grid` | app.css:4675 | **calc(8(md) + 6)** |  |  |  |  |  |
| `.cal-grid` | app.css:5826 |  |  |  |  |  |  |
| `.pr-run` | app.css:6735 | 8(md) | **38** | **0 14** |  |  | **12** |
| `.jp-card` | app.css:6434 | **6** |  | **7.5** |  |  |  |
| `.jp-cal` | app.css:6138 | **10** |  | **14 12 10** |  |  | **20** |
| `.td-cal` | app.css:4102 | **10** |  | **8** |  |  | **4** |
| `.rte` | app.css:2540 | **6(sm)** |  |  |  |  |  |
| `.rte-bar` | app.css:2553 | **6(sm) 6(sm) 0 0** |  | **3** |  |  | **2** |

값 분포 — border-radius: 8(md)×9 · 14(lg)×7 · 10×6 · calc(8(md) + 6)×2 · 6×1 · 6(sm)×1 · 6(sm) 6(sm) 0 0×1 / height: min 0×3 · 36×1 · min 46×1 · 38×1 / padding: 12 16×3 · 10 14×2 · 12×2 · 10 16×2 · 12 14×1 · 10 10 10 14×1 · 40 32 24×1 · 8 8 6 12×1 · 10 12 12×1 · 0 12×1 · 0 8 0 12×1 · 0 14×1 · 7.5×1 · 14 12 10×1 · 8×1 · 3×1 / font-size: 14.5×1 · 12×1 / gap: 8×7 · 2×3 · 4×2 · 8 20×1 · 8 12×1 · 12×1 · 20×1

### 뜨는 창(.overlay·.dialog·.mgr 등)

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.overlay` | app.css:1401 |  |  | 16 |  |  |  |
| `.dialog` | app.css:1413 | 14(lg) |  |  |  |  |  |
| `.dialog` | app.css:5754 |  |  |  |  |  |  |
| `.dialog-head` | app.css:1426 |  |  | **16 20 12** |  |  | **4** |
| `.dialog-title` | app.css:1433 |  |  |  | **16** |  |  |
| `.dialog-body` | app.css:1438 |  |  | **0 20 12** |  |  |  |
| `.dialog-foot` | app.css:1449 |  |  | **12 20** |  |  |  |
| `.mgr` | app.css:5676 |  |  |  |  |  |  |
| `.mgr-label` | app.css:5714 |  |  | **12 0 6** | 12 |  | 8 |
| `.mgr .prow` | app.css:5699 |  | min 45 |  |  |  |  |
| `.prow` | app.css:1457 |  | **min 44** | **6 0** |  |  | **12** |
| `.cal-dialog` | app.css:4897 |  |  |  |  |  |  |
| `.cal-dlg-title` | app.css:4901 |  |  | **16 20 8** |  |  |  |
| `.cal-dlg-grid` | app.css:4927 |  |  | **12 20 16** |  |  | **10 12** |
| `.cal-daydlg` | app.css:5087 |  |  |  |  |  |  |
| `.cal-notify` | app.css:5467 |  |  |  |  |  |  |
| `.cm-memo-dialog` | app.css:3377 |  |  |  |  |  |  |
| `.cm-memo-head` | app.css:3381 |  |  |  |  |  | 8 |
| `.dialog.xl-ask` | app.css:5948 |  |  |  |  |  |  |
| `.xl-ask-body` | app.css:5952 |  |  | **20 24 4** |  |  | 8 |
| `.xl-ask-title` | app.css:5959 |  |  |  | **17** | 24 |  |
| `.xl-ask-foot` | app.css:5972 |  |  | **16 24 20** |  |  | 8 |
| `.dialog.jp-dlg` | app.css:5999 |  |  |  |  |  |  |
| `.jp-head` | app.css:6005 |  |  | **18 20 0 24** |  |  |  |
| `.jp-title` | app.css:6011 |  |  |  | **17** | 24 |  |
| `.jp-foot` | app.css:6306 |  |  | **14 20 16 24** |  |  | 8 |
| `.dialog.pr-works` | app.css:7221 |  |  |  |  |  |  |
| `.pr-wgrid` | app.css:7231 |  |  | **0 20** |  |  | 8 |
| `.pr-hints` | app.css:7417 |  |  | **10 20 14** | 12 |  | **4** |
| `.pr-ask` | app.css:7191 | **10** |  | **14 14 12** |  |  | 8 |
| `.pr-ask-t` | app.css:7204 |  |  |  | **13.5** |  |  |
| `.fx-cf-head` | app.css:8244 |  |  | **16 18 6** |  |  | **10** |
| `.fx-cf-cards` | app.css:8250 |  |  | **8 18 0** |  |  | **10** |
| `.fx-cf-foot` | app.css:8306 |  |  | **16 18** |  |  | 8 |
| `.fx-rn-head` | app.css:8320 |  |  | **14 18 10** |  |  | **12** |
| `.fx-rn-grid` | app.css:8365 |  |  | **12 18 0** |  |  | **12** |
| `.fx-rn-foot` | app.css:8466 |  |  | **10 18 12** | 12 |  | **10** |
| `.bd-confirm` | app.css:9493 |  |  | **10** |  |  |  |
| `.bd-memopop` | app.css:9516 |  |  | **8** |  |  |  |
| `.fx-findpanel` | app.css:8171 |  |  | **14** | **12.5** |  | **10** |

값 분포 — border-radius: 14(lg)×1 · 10×1 / height: min 45×1 · min 44×1 / padding: 16×1 · 16 20 12×1 · 0 20 12×1 · 12 20×1 · 12 0 6×1 · 6 0×1 · 16 20 8×1 · 12 20 16×1 · 20 24 4×1 · 16 24 20×1 · 18 20 0 24×1 · 14 20 16 24×1 · 0 20×1 · 10 20 14×1 · 14 14 12×1 · 16 18 6×1 · 8 18 0×1 · 16 18×1 · 14 18 10×1 · 12 18 0×1 · 10 18 12×1 · 10×1 · 8×1 · 14×1 / font-size: 12×3 · 17×2 · 16×1 · 13.5×1 · 12.5×1 / line-height: 24×2 / gap: 8×8 · 10×4 · 12×3 · 4×2 · 10 12×1

### 뜨는 목록·메뉴·토스트(position 기준 작은 창)

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.pin-list` | app.css:977 | 8(md) |  | 4 |  |  | **2** |
| `.pin-opt` | app.css:994 | **6(sm)** | **min 28** | **0 6** |  |  |  |
| `.jmenu` | app.css:2082 | 8(md) |  | **3** |  |  |  |
| `.jmenu-opt` | app.css:2102 | **6(sm)** | **min 26** | **3 6** | **11.5** | round(1.2em, 1) | 8 |
| `.dmenu` | app.css:3744 | 8(md) |  | 4 |  |  | **2** |
| `.dmenu-item` | app.css:3759 | **6(sm)** | **30** | **0 10** |  |  |  |
| `.cm-fdd` | app.css:3231 | **10** |  | **10** | **13(fs)** |  | 8 |
| `.cm-fdd-opt` | app.css:3289 | **6(sm)** | min 30 | **0 6** |  |  | 8 |
| `.cm-spick-list` | app.css:3648 | 8(md) |  | 4 |  |  | **2** |
| `.cm-spick-opt` | app.css:3664 | **6(sm)** | min 30 | **0 6** |  |  | 8 |
| `.cpick-pop` | app.css:3715 | 8(md) |  | **10** |  |  | 8 |
| `.cal-cpop` | app.css:5387 | 8(md) |  | **12** |  |  | **10** |
| `.cal-kp-list` | app.css:5553 | 8(md) |  | 4 |  |  | **2** |
| `.cal-kp-opt` | app.css:5569 | **6(sm)** | min 30 | **0 6** |  |  | 8 |
| `.xl-menu` | app.css:5905 | **10** |  | **6** |  |  | **2** |
| `.xl-item` | app.css:5921 | **6(sm)** |  | **8 10** |  |  | **2** |
| `.pr-menu` | app.css:7137 | 8(md) |  | 4 |  |  |  |
| `.pr-opt` | app.css:7146 | **6(sm)** | min 30 | **4 8** | 12.5 |  | 8 |
| `.fx-menu` | app.css:7734 | 8(md) |  | 4 |  |  |  |
| `.fx-mi` | app.css:7750 | **6(sm)** | min 30 | **0 8** | 12.5 |  | 8 |
| `.bd-pop` | app.css:9400 | 8(md) |  | 4 | **13** |  |  |
| `.bd-mi` | app.css:9414 | **6** | **32** | **0 10** |  |  | 8 |
| `.bd-stlist .bd-mi` | app.css:9485 |  | **28** | **0 3** |  |  |  |
| `.xl-toast` | app.css:5979 | 8(md) |  | **10 16** |  |  |  |
| `.bd-toast` | app.css:9554 | 8(md) |  | **10 16** | **13** |  |  |
| `.fx-toast` | app.css:8061 |  |  |  | **12** |  |  |

값 분포 — border-radius: 8(md)×12 · 6(sm)×9 · 10×2 · 6×1 / height: min 30×5 · min 28×1 · min 26×1 · 30×1 · 32×1 · 28×1 / padding: 4×7 · 0 6×4 · 0 10×2 · 10×2 · 10 16×2 · 3×1 · 3 6×1 · 12×1 · 6×1 · 8 10×1 · 4 8×1 · 0 8×1 · 0 3×1 / font-size: 12.5×2 · 13×2 · 11.5×1 · 13(fs)×1 · 12×1 / line-height: round(1.2em, 1)×1 / gap: 8×9 · 2×6 · 10×1

### 탭·토글 묶음

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.seg` | app.css:682 | 8(md) |  | **2** |  |  |  |
| `.seg button` | app.css:690 | **6(sm)** | 26 | **0 12** | 12.5 |  |  |
| `.cal-views` | app.css:5121 | 8(md) |  | 3 |  |  |  |
| `.cal-views button` | app.css:5129 | **calc(8(md) - 2)** | **calc(34(ctrl) - 8)** | **0 14** |  |  |  |
| `.bd-unit` | app.css:8892 | 8(md) | **34(ctrl)** | 3 |  |  | 2 |
| `.bd-unit button` | app.css:8901 | **5** | 26 | **0 10** | 12.5 |  |  |
| `.bd-year` | app.css:8860 | 8(md) | **34(ctrl)** |  |  |  |  |
| `.bd-year button` | app.css:8869 |  | **32** |  |  |  |  |
| `.bd-year b` | app.css:8882 |  |  | **0 10** | **14** | 32 |  |
| `.fx-tabs` | app.css:7549 |  |  | **6 8** |  |  | **4** |
| `.fx-tab` | app.css:7559 | **7** | **34** | **0 14** | **14.5** |  | **7** |
| `.jp-chips` | app.css:6041 | **9** |  | 3 |  |  | **4** |
| `.jp-chip` | app.css:6050 | **7** | **28** | **0 14** | 12.5 |  |  |
| `.jcal-mon` | app.css:1744 | 8(md) | **54** |  | **13.5** |  | 2 |
| `.switch` | app.css:547 | **999** | **20** |  |  |  |  |
| `.switch .knob` | app.css:561 | **50%** | **16** |  |  |  |  |

값 분포 — border-radius: 8(md)×5 · 7×2 · 6(sm)×1 · calc(8(md) - 2)×1 · 5×1 · 9×1 · 999×1 · 50%×1 / height: 26×2 · 34(ctrl)×2 · calc(34(ctrl) - 8)×1 · 32×1 · 34×1 · 28×1 · 54×1 · 20×1 · 16×1 / padding: 3×3 · 0 14×3 · 0 10×2 · 2×1 · 0 12×1 · 6 8×1 / font-size: 12.5×3 · 14×1 · 14.5×1 · 13.5×1 / line-height: 32×1 / gap: 2×2 · 4×2 · 7×1

### 사이드바 칸·왼쪽 목록 줄

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.side` | app.css:37 |  |  | **27 12 20** |  |  |  |
| `.brand` | app.css:49 |  |  | **0 4 32 0** |  |  |  |
| `.side-list` | app.css:62 |  |  |  |  |  | **2** |
| `.side-item` | app.css:68 | 8(md) | **35** | 0 8 |  |  | 8 |
| `.side-bottom .side-item` | app.css:120 |  | **33** |  |  |  |  |
| `.side-folded` | app.css:150 |  |  | **23 10 16** |  |  |  |
| `.side-folded .brand` | app.css:157 |  | **36** | **0** |  |  |  |
| `.side-folded .side-item` | app.css:169 |  | **36** | **0** |  |  |  |
| `.side-kb` | app.css:142 |  |  |  | **11** |  |  |
| `.td-list` | app.css:3812 | 8(md) | 30 | 0 8 | 13(fs) |  | **10** |
| `.cal-kind` | app.css:4509 | 8(md) | 30 | 0 8 | 13(fs) |  | **10** |
| `.cal-up` | app.css:4558 | 8(md) |  | **6 8** |  |  | 8 |
| `.fx-tr` | app.css:8100 | **6(sm)** | **28** | **0 8 0 6** | **12.5** |  |  |
| `.fx-tr-drive` | app.css:8114 |  | 30 |  | **12** |  |  |
| `.jn-due-item` | app.css:3407 |  |  | **9 14** |  |  | **2 10** |

값 분포 — border-radius: 8(md)×4 · 6(sm)×1 / height: 30×3 · 36×2 · 35×1 · 33×1 · 28×1 / padding: 0 8×3 · 0×2 · 27 12 20×1 · 0 4 32 0×1 · 23 10 16×1 · 6 8×1 · 0 8 0 6×1 · 9 14×1 / font-size: 13(fs)×2 · 11×1 · 12.5×1 · 12×1 / gap: 8×2 · 10×2 · 2×1 · 2 10×1

### 표 줄·머리 줄(.row 등)

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.row` | app.css:508 |  |  | **10 16** |  |  | **8 12** |
| `.cm-head` | app.css:2819 | calc(8(md) - 1) calc(8(md) - 1) 0 0 | **calc(36(row) + 4)** |  | 12 |  |  |
| `.cm-hcell` | app.css:2834 |  | **100%** | 0 10 |  |  |  |
| `.cm-c` | app.css:2883 |  |  | 0 10 |  |  |  |
| `.cm-view` | app.css:2937 |  | **min 36(row)** |  |  |  |  |
| `.cm-view` | app.css:3690 |  |  |  |  |  |  |
| `.cm-new > .cm-c` | app.css:2897 |  | **min calc(36(row) + 6)** | **5 4** |  |  |  |
| `.ct-new-head` | app.css:892 |  |  |  |  |  |  |
| `.ct-new-head` | app.css:899 | calc(8(md) - 1) calc(8(md) - 1) 0 0 | **calc(36(row) - 4)** |  | 12 |  |  |
| `.ct-new-head > div` | app.css:909 |  |  | 0 10 |  |  |  |
| `.ct-new-row` | app.css:892 |  |  |  |  |  |  |
| `.ct-new-row` | app.css:913 | **0 0 calc(8(md) - 1) calc(8(md) - 1)** | **min calc(36(row) + 6)** |  |  |  |  |
| `.pr-headrow` | app.css:6794 |  | **min 40** |  | 12 |  |  |
| `.pr-headrow` | app.css:6805 |  |  | **right var(--pr-gutter, 0)** |  |  |  |
| `.pr-row` | app.css:6781 |  | **min 44** |  |  |  |  |
| `.pr-row > div` | app.css:6789 |  |  | **11 10 10** |  |  |  |
| `.pr-wrow` | app.css:7251 |  | **min 44** | **top 8 / bottom 8** |  |  |  |
| `.fx-hdr` | app.css:7821 |  |  | 0 10 |  |  |  |
| `.fx-hdr` | app.css:7827 |  | 26 |  |  |  |  |
| `.fx-hcell` | app.css:7835 |  | **100%** | **0 8 0 0** | **11.5** |  |  |
| `.fx-frow` | app.css:7821 |  |  | 0 10 |  |  |  |
| `.fx-frow` | app.css:7874 |  | **min 28** |  | **12.5** |  |  |
| `.fx-brow` | app.css:7969 |  | 26 | 0 10 | **12.5** |  | **8** |
| `.fx-ncell` | app.css:7903 |  |  | **3 8 3 0** |  |  | **6** |
| `.fx-rn-hdr` | app.css:8347 |  | **28** |  | **11.5** |  |  |
| `.fx-rn-row` | app.css:8332 |  | 26 | 0 10 | **12.5** |  | 10 |
| `.bd-hd` | app.css:8974 |  |  |  |  |  |  |
| `.bd-hd` | app.css:8980 |  | **40** |  | 12 |  |  |
| `.bd-h` | app.css:8992 |  |  | **0 8** |  |  |  |
| `.bd-rw` | app.css:8974 |  |  |  |  |  |  |
| `.bd-rw` | app.css:9038 |  | **min 36** |  |  |  |  |
| `.bd-rw.pj` | app.css:9073 |  | **min 40** |  |  |  |  |
| `.bd-c` | app.css:9044 |  |  | **0 8** |  |  |  |
| `.bd-c.n` | app.css:9058 |  |  | **0 6** |  |  |  |
| `.td-row` | app.css:4218 | **8(md)** |  | **8** |  |  | 10 |
| `.td-items` | app.css:4202 |  |  | **6 8** |  |  |  |
| `.cline` | app.css:1150 | **6(sm)** | **min 24** | **1 6** |  |  | 10 |
| `.memo-row` | app.css:1322 | **5** |  | **0 6** |  |  | **7** |
| `.memo-row` | app.css:3564 |  |  |  |  |  | **0** |
| `.keys-row` | app.css:6622 |  | **min 32** |  |  |  | **8** |
| `.cal-dhead` | app.css:4742 |  | **min 24** | **6 10 0** |  |  | **6** |
| `.cal-wday` | app.css:5205 |  |  | **6 10** |  |  | **4 6** |
| `.cal-dow > div` | app.css:4693 |  |  | **8 10** |  |  |  |

값 분포 — border-radius: calc(8(md) - 1) calc(8(md) - 1) 0 0×2 · 0 0 calc(8(md) - 1) calc(8(md) - 1)×1 · 8(md)×1 · 6(sm)×1 · 5×1 / height: 26×3 · 100%×2 · min calc(36(row) + 6)×2 · min 40×2 · min 44×2 · min 24×2 · calc(36(row) + 4)×1 · min 36(row)×1 · calc(36(row) - 4)×1 · min 28×1 · 28×1 · 40×1 · min 36×1 · min 32×1 / padding: 0 10×7 · 0 8×2 · 0 6×2 · 10 16×1 · 5 4×1 · right var(--pr-gutter, 0)×1 · 11 10 10×1 · top 8 / bottom 8×1 · 0 8 0 0×1 · 3 8 3 0×1 · 8×1 · 6 8×1 · 1 6×1 · 6 10 0×1 · 6 10×1 · 8 10×1 / font-size: 12×4 · 12.5×3 · 11.5×2 / gap: 10×3 · 8×2 · 6×2 · 8 12×1 · 7×1 · 0×1 · 4 6×1

### 화면 머리 줄(제목·검색 줄)·바깥 여백

| 선택자 | 파일:줄 | border-radius | height | padding | font-size | line-height | gap |
|---|---|---|---|---|---|---|---|
| `.main` | app.css:181 |  |  | 24 28 |  |  | **16** |
| `.main.main-fill` | app.css:7453 |  |  |  |  |  |  |
| `.title` | app.css:191 |  |  |  | 22 |  |  |
| `.title-row` | app.css:409 |  | **min 34(ctrl)** |  |  |  | **8 12** |
| `.title-sub` | app.css:418 |  |  |  |  |  |  |
| `.ct-head` | app.css:750 |  |  |  |  |  | 8 |
| `.jn-head` | app.css:1791 |  |  |  |  |  | 8 |
| `.cal-head` | app.css:4617 |  |  |  |  |  | 8 |
| `.cal-month` | app.css:4624 |  |  |  |  |  |  |
| `.fx-top` | app.css:7467 |  |  |  |  |  | 8 |
| `.fx-title` | app.css:7472 |  |  |  |  |  |  |
| `.bd-top` | app.css:8853 |  | 34(ctrl) |  |  |  | 8 |
| `.search` | app.css:761 | 8(md) | 34(ctrl) | **0 12** |  |  | 8 |
| `.search input` | app.css:780 |  |  |  |  |  |  |
| `.search input` | app.css:5775 |  | **20** | **0 0 1** |  |  |  |
| `.jn-search` | app.css:1803 |  |  |  |  |  |  |
| `.jn-search` | app.css:2505 |  |  |  |  |  |  |
| `.fx-search` | app.css:7498 |  |  |  |  |  |  |
| `.bd-search` | app.css:8916 |  |  | **right 6** |  |  |  |
| `.td-summary` | app.css:3907 |  |  |  | **12.5** |  |  |
| `.cal-nav` | app.css:4629 |  |  |  |  |  | **4** |
| `.pr-fetch` | app.css:6729 |  |  |  |  |  | 8 |
| `.td-screen` | app.css:3789 |  |  |  |  |  | **24** |
| `.cal-screen` | app.css:4460 |  |  |  |  |  | **24** |
| `.jn` | app.css:1535 |  |  |  |  |  | **24** |
| `.fx-root` | app.css:7460 |  | **min 0** |  |  |  | **14** |
| `.pr` | app.css:6717 |  | **calc(100vh - 48)** |  |  |  | **12** |
| `.bd` | app.css:8846 |  |  |  |  |  | **14** |
| `.side` | app.css:37 |  |  | **27 12 20** |  |  |  |

값 분포 — border-radius: 8(md)×1 / height: 34(ctrl)×2 · min 34(ctrl)×1 · 20×1 · min 0×1 · calc(100vh - 48)×1 / padding: 24 28×1 · 0 12×1 · 0 0 1×1 · right 6×1 · 27 12 20×1 / font-size: 22×1 · 12.5×1 / gap: 8×7 · 24×3 · 14×2 · 16×1 · 8 12×1 · 4×1 · 12×1

---

## 3. 토큰 사용 검사 — `#` 색 값과 rgba()

`grep -rnE "#[0-9A-Fa-f]{3,8}" src --include=*.tsx --include=*.css | grep -v tokens.css` 결과(SVG `path d=` 안의 숫자 등 색이 아닌 것은 뺐어요):

| 파일:줄 | 값 | 어떤 요소 |
|---|---|---|
| src/app.css:7938 | `#fff3d6` | `.fx-up` 바탕 — 탐색기 "위 폴더" 노란 네모(어둡게 테마에서도 같은 색) |
| src/app.css:7939 | `#b7791f` | `.fx-up` 글자색 |
| src/FileIcon.tsx:61 | `#E3A33A` | 폴더 아이콘 뒤판 |
| src/FileIcon.tsx:62 | `#F7C95C` | 폴더 아이콘 앞판 |
| src/FileIcon.tsx:68 | `#D24726` | ppt·pptx 띠 |
| src/FileIcon.tsx:69 | `#1F7A45` | xls·xlsx·csv 띠(토큰 `--bs-wan-bg` 밝게 값과 우연히 같음) |
| src/FileIcon.tsx:70 | `#2B5797` | doc·docx 띠 |
| src/FileIcon.tsx:71 | `#2B6CC4` | hwp·hwpx 띠 |
| src/FileIcon.tsx:72 | `#C2262E` | pdf 띠 |
| src/FileIcon.tsx:73 | `#2E8B57` | jpg·jpeg·png·gif·bmp 띠 |
| src/FileIcon.tsx:74 | `#8A6D3B` | zip 띠 |
| src/FileIcon.tsx:78 | `#8A88A0` | 그 밖의 확장자 띠(기본) |
| src/FileIcon.tsx:81 | `#FFFFFF` · `#A9A7B8` | 문서 아이콘 종이 흰색·테두리 |
| src/FileIcon.tsx:82 | `#A9A7B8` | 문서 아이콘 접힌 귀 테두리 |
| src/FileIcon.tsx:85 | `#FFFFFF` | 띠 위 글자(P·X·W·한·Z) |
| src/FilesScreen.tsx:1547 | `#4B9A5B` | 썸네일 자리 그림의 초록 막대(rect fill) |
| (참고) src/google.ts:368-369 | 24색 | `GC_HEX` — 구글에 보낼 색 비교용 표(화면에 그리지 않음, tokens.css 밝게 값 복사) |

rgba():

| 파일:줄 | 값 | 어떤 요소 |
|---|---|---|
| src/app.css:569 | `rgba(var(--shadow-rgb), 0.3)` | `.switch .knob` 그림자 |
| src/app.css:705 | `rgba(var(--shadow-rgb), 0.18)` | `.seg button[aria-pressed]` 그림자 |
| src/app.css:1422 | **`rgba(0, 0, 0, 0.35)`** | `.dialog` 그림자 — 토큰(`--shadow-rgb`) 안 씀 |
| src/app.css:4113 | `rgba(var(--shadow-rgb), 0.1)` | `.td-cal` 작은 달력 |
| src/app.css:5143 | `rgba(var(--shadow-rgb), 0.12)` | `.cal-views button[aria-pressed]` |
| src/app.css:5399 | `var(--shadow-card), 0 12px 32px rgba(var(--shadow-rgb), 0.18)` | `.cal-cpop` |
| src/app.css:5566 | 같은 값 | `.cal-kp-list` |
| src/app.css:5918 | `rgba(var(--shadow-rgb), 0.14)` | `.xl-menu` |
| src/app.css:6064 | `rgba(var(--shadow-rgb), 0.14)` | `.jp-chip[aria-pressed]` |
| src/app.css:7143 | **`rgba(20, 18, 38, 0.16)`** | `.pr-menu` — `--shadow-rgb`(28,27,34) 대신 다른 숫자 |
| src/app.css:7200 | **`rgba(20, 18, 38, 0.18), … rgba(20, 18, 38, 0.08)`** | `.pr-ask` |
| src/app.css:7744 | **`rgba(20, 18, 38, 0.16)`** | `.fx-menu` |
| src/app.css:9407 | `rgba(var(--shadow-rgb), 0.16)` | `.bd-pop` |
| src/app.css:9586 | `rgba(var(--shadow-rgb), 0.12)` | `.bd-sumbar` |
| src/tokens.css:35·146·202 | `--scrim` | 토큰 정의(밝게 `rgba(28,27,34,.5)`, 어둡게 `rgba(0,0,0,.62)`) |
| src/tokens.css:112·124·183·239 | `--shadow-card`, `--bd-col-hl` | 토큰 정의 |

뜨는 메뉴 그림자가 네 가지예요: `var(--shadow-card)`(`.pin-list`·`.jmenu`·`.dmenu`·`.cm-fdd`·`.cm-spick-list`·`.cpick-pop`), `shadow-card + 0 12px 32px .18`(`.cal-cpop`·`.cal-kp-list`), `0 8px 24px .14~.16`(`.xl-menu`·`.pr-menu`·`.fx-menu`·`.bd-pop`), `0 24px 64px rgba(0,0,0,.35)`(`.dialog`).

---

## 4. 스퀴클 검사

grep 대상: `corner-shape`, `squircle`, `clip-path`, `mask-image`, `superellipse` (저장소 전체, node_modules·dist 제외).

- `src/app.css:3` — `* { corner-shape: squircle; }` 한 줄로 **모든 요소**에 걸어요. `clip-path`·`mask-image`·`superellipse`는 코드 어디에도 없어요. 문서에는 `CLAUDE.md:361`·`brand/app-icon.svg:2`에 "스퀴클" 말만(앱 아이콘 SVG는 path로 그린 모양).
- 되돌린 곳 `corner-shape: round` 24곳(동그라미·알약): app.css 839 `.pchip`, 860 `.pchip-dot`, 1244 `.memo-dot`, 1485 `.swatch`, 2135 `.jmenu-dot`, 2408 `.jonly`, 3019 `.cm-dot`, 3167 `.cm-fpill`, 3182 `.cm-fpill-open`, 3204 `.cm-fpill-x`, 3499 `.bl-ci`, 3712 `.cpick-dot`, 4077 `.td-due-input`, 4176 `.td-cal-day`, 4277 `.td-check`, 4759 `.cal-num`, 4848 `.cal-ev-dot`, 4973 `.cal-allday`, 5174 `.cal-ev-check`, 5367 `.cal-cbtn`, 5384 `.cal-cbtn-dot`, 5542 `.cal-kp-dot`, 6278 `.jp-dot`.
- **되돌리지 않은 동그라미·알약 8곳**(`border-radius: 50%`/`999px`인데 `corner-shape: round`가 없음 — 스퀴클이 그려지면 동그라미가 네모진 모양이 돼요): app.css 547 `.switch`(999px), 561 `.switch .knob`(50%), 1697 `.jcal-dot`, 2714 `.rte-area ul > li::before, .rte-view ul > li::before`(머릿기호 점), 5342 `.cal-now::before`, 5608 `.g-dot`, 6748 `.pr-run-dot`, 8921 `.search-x`.
- **결론**: 코드는 모서리를 `border-radius`로 주고, 모양만 `corner-shape: squircle`로 바꾸는 방식이에요. 스퀴클이 실제로 그려지는지는 WebView2(엣지 크로미움) 버전에 달려 있어요 — `corner-shape`는 크로미움 139(2025-09)부터이고 그 전 버전이면 그냥 둥근 모서리로 보여요. 스퀴클로 그려지면 같은 `border-radius`라도 눈에 보이는 둥글기가 더 작아 보이니, 집 PC(실제 화면)에서 어느 쪽으로 그려지는지 확인이 필요해요. 작업 공간의 Playwright 미리 보기는 크로미움 버전에 따라 결과가 다를 수 있어요.
- `border-radius` 229곳 중 토큰: `var(--radius-sm)` 65 · `var(--radius-md)` 48 · `var(--radius-lg)` 8 · 토큰을 쓴 calc·조합(`calc(var(--radius-md) - 1px) … 0 0` 2, `0 0 calc(…)` 2, `calc(var(--radius-md) + 6px)` 2, `calc(var(--radius-md) - 2px)` 1, `var(--radius-lg) 0 0 var(--radius-lg)` 1, `var(--radius-sm) var(--radius-sm) 0 0` 1, `0 0 var(--radius-sm) var(--radius-sm)` 1) 10 → **131곳**. 숫자 px: `50%` 22 · `5px` 16 · `10px` 10 · `4px` 10 · `999px` 9 · `6px` 9 · `1px` 6 · `7px` 6 · `3px` 5 · `2px` 2 · `9px` 1 · `8px 0 0 8px` 1 · `0 8px 8px 0` 1 → **98곳**. 전체 목록은 부록 `border-radius`.
  - 숫자 5px(16곳): `.chip-x` `.kind-key` `.jproj-badge` `.memo-row` `.td-list-box` `.td-link-badge,.td-src` `.td-due` `.cal-kind-box` `.cal-ev` `.cal-more` `.bd-unit button` `.kb-cap` `.pr-d` `.fx-target` `.fx-lock` `.fx-new` — 작은 배지 모서리를 토큰(6) 대신 5로 쓴 묶음.
  - 숫자 10px(10곳): `.gate-note` `.cm-fdd` `.td-cal` `.g-box` `.xl-menu` `.jp-cal` `.pr-ask` `.fx-pane` `.fx-tree` `.fx-cf-card` — 뜨는 상자·판 모서리를 토큰(md 8·lg 14) 사이 값으로.
  - 숫자 6px(9곳, 토큰 sm과 같은 값): `.cal-kbadge` `.jp-card` `.fx-up-big` `.bd-chip` `.bd-memo` `.bd-in` `.bd-selk` `.bd-mi` `.bd-sumbar button`.
  - 숫자 7px(6곳): `.jp-chip` `.jp-nav` `.kb` `.fx-tab` `.mod-icon` `.bd-scroll::-webkit-scrollbar-thumb`.

---

## 5. 글자 가운데 맞춤(0.9.4) 1~8번이 코드에 있는지

| 번호 | 항목 | 결과 | 파일:줄 |
|---|---|---|---|
| ① | `tokens.css` `@font-face Pretendard` | **있음** | src/tokens.css:2-8 (`PretendardVariable.woff2`, `font-weight: 45 920`, `font-display: block`), 글꼴 파일 src/fonts/PretendardVariable.woff2·OFL.txt. 글꼴을 읽은 뒤 다시 재기: src/App.tsx:93 `document.fonts?.ready.then(() => measureBullets(...))`(CLAUDE.md에는 `fonts.load`라 적혀 있지만 코드는 `fonts.ready`) |
| ② | `body { line-height: round(1.4em, 1px) }` + 숫자 line-height를 `round(Xem, 1px)` 꼴로 | **일부** — body는 있음(app.css:18). `line-height` 36곳 중 `round(…)` 20곳, 나머지 16곳은 `round` 아님(아래 목록). 다만 모두 정수 px(또는 토큰)이라 "소수 줄 높이" 문제는 없고, 글자 크기 설정을 바꿀 때 따라가지 않는 차이만 있어요 | round 아님(화면): 2075 `.jline-t` 22px · 2306 `.cell-input.jtalk` 18px · 3371 `.cm-new > .cm-area-auto` `var(--size-input)` · 5962 `.xl-ask-title` 24px · 5968 `.xl-ask-path` 20px · 6014 `.jp-title` 24px · 6993 `.pr-work` 16px · 7916 `.fx-nm` 17px · 8885 `.bd-year b` 32px · 9499 `.bd-confirm p` 20px · 9552 `.bd-checks` 18px / 인쇄 종이(px 고정이 맞음): 6246 `.jp-day > span` 16 · 6377 `.jp-page` 17 · 6395 `.jp-phead h1` 24 · 6460 `.jp-kind` 17 · 6501 `.jp-proj` 15 · 6523 `.jp-sp` 17 · 6543 `.jp-memo` 18 · 6554 `.jp-pfoot` 14. 0.9.4 때 바꾼 15곳(`.memo-line` `.jcal-day` `.jtime` `.jtel` `.jmenu-opt` `.jproj-badge` `.rte-area` `.rte-view` `.cm-area` `.cm-bt` `.bl-t` `.bl-ta` `.cal-wk-col .cal-ev` `.g-foot` `.gate-note` 등)은 round 꼴이에요. 그 뒤 새로 들어온 민원처리·탐색기·집행현황·엑셀 창 코드가 숫자로 적었어요 |
| ③ | `.cell-input,.input,.jday-in,.td-due-input { padding-bottom: 2px }`, `.search input { padding: 0 0 1px; height: 20px }` | **있음** | app.css:5768-5777. 인쇄 기간 창 칸도 같은 값(6124 `.jp-field-box input`). `.td-add-title`은 그대로(4002) |
| ④ | `.cm-bullets { gap: 4px }` | **있음** | app.css:5780-5782(원래 자리 3000의 `gap: 3px`은 남아 있고 뒤 규칙이 덮어써요) |
| ⑤ | `.td-src,.td-link-badge,.cal-num,.cal-cbtn { padding-top: 1px }`, `.jproj-badge { padding-top: 3px }`, `.jtree-d,.td-done-toggle { padding-bottom: 2px }` | **일부** — `.jtree-d`만 없음 | app.css:5784-5789(위 1px), 5791-5793(`.jproj-badge` 3px), 5795-5797(`.td-done-toggle` 2px). `.jtree-d`는 app.css·tsx 어디에도 없어요 — 업무일지 날짜 트리(`DateTree`)가 next에서 월 달력으로 바뀌며 요소 자체가 없어졌어요(해당 없음) |
| ⑥ | `.side-item { height: 35px }` | **있음(단, 예외 2곳)** | app.css:72 `.side-item` 35px. 아래쪽 메뉴(업무연락처·설정·잠그기·접기)는 120 `.side-bottom .side-item, .side-toggle .side-item` **33px**, 접힌 사이드바는 169 `.side-folded .side-item` **36px** |
| ⑦ | `src/snap.ts` 존재·App에서 쓰는지 | **있음(설치 위치는 main.tsx)** | src/snap.ts(`.overlay > *`의 위쪽 소수 부분만큼 `top`으로 올림 — translate 아님, MutationObserver·resize), src/main.tsx:6 import · :14 `installSnap()`. App.tsx에는 없어요 |
| ⑧ | 안내 문구 괄호 제거 | **있음(전부)** | JournalScreen.tsx:1273 `placeholder="상대 이름"`, 1316 `` `${s.who || "상대"} 말` ``; "날짜로 가기" 칸은 없어졌어요(해당 없음) / CalendarScreen.tsx:1073 `"일정"`, 1271 `"날짜"` / ContactsScreen.tsx:1142 `"새 프로젝트 이름"` / SettingsScreen.tsx:938 `"새 구분"`, 939 `"초성"` / TasksScreen.tsx:686·1121 `placeholder="세부정보"`. 그 뒤 새 화면에 괄호 안내가 다시 들어왔어요: FilesDialogs.tsx:320 `"바꿀 글자 (비우면 지움)"`, FilesScreen.tsx:1333 `"파일 찾기 (Ctrl+F)"`, ProcessScreen.tsx:1250 `"이름·초성 (업무연락처)"` |

---

## 6. 화면 바깥 여백과 머리 줄 — 화면마다 같은지

바깥 여백은 모든 화면이 `App.tsx:243`의 `<main className="main">` 하나를 써요(탐색기·집행현황은 `main main-fill`로 `overflow: hidden`만 더함). 그래서 **위·아래 24px, 좌·우 28px은 9화면 모두 같아요**. 머리 줄은 화면마다 클래스가 달라요.

| 화면 | 최상위 컨테이너(tsx:줄) | 컨테이너 padding/height/gap | 머리 줄 클래스(app.css:줄) | 머리 줄 높이·gap | 머리 줄 안 요소 높이 |
|---|---|---|---|---|---|
| (공통) | `.main` (App.tsx:243, app.css:181) | `padding: 24px 28px`(`--space-6 --space-7`), `gap: 16px`, `overflow: auto`; `.main.main-fill`(7454) `overflow: hidden` | `.title`(191) 22px/700, line-height round(1.4em)=31px | — | — |
| 민원대장 | `.ct-head` 바로(ComplaintsScreen.tsx:218, 표 `.cm`) | (main 그대로) | `.ct-head`(751) | 높이 지정 없음(내용 34px), gap 8 | `.search` 34 · `.btn.btn-ctrl.btn-text` 34(0 14) · `ExcelMenu` 34 |
| 할 일 | `.td-screen`(TasksScreen.tsx:197, app.css:3790) | gap 24(좌우 열) | `.ct-head`(751) | gap 8 | `.td-summary` 글자 12.5 · `.search` 34 |
| 업무연락처 | `.ct-head` 바로(ContactsScreen.tsx:157) | (main 그대로) | `.ct-head`(751) | gap 8 | `.search` 34 · `.btn.btn-ctrl.btn-text` 34 · `ExcelMenu` 34 |
| 업무일지 | `.jn`(JournalScreen.tsx:267, app.css:1536) | gap 24, 왼쪽 열 `.jn-left` 320px gap 16 | `.jn-head`(1792) | gap 8 | `.btn.btn-ctrl` 34("오늘") · `.search.jn-search` 34, 폭 **240**(1803, 기본 260) · `.btn.btn-ctrl.btn-text.jn-print` 34 |
| 캘린더 | `.cal-screen`(CalendarScreen.tsx:377, app.css:4461) | gap 24, `.cal-side` 200~250px gap 24 | `.cal-head`(4618) | gap 8 | `.title.cal-month` min-width 132 · `.cal-nav .btn` 34(0 12, md) · `.cal-views` 34(3px 안쪽, 단추 26) · `.btn.btn-ctrl` 34 |
| 설정 | `.title-row` 바로(SettingsScreen.tsx:88, app.css:410) | (main 그대로) | `.title-row`(410) | **min-height 34**, **gap 8 12**, max-width 760 | `.title-sub` 글자 12 · **`.btn` 30px(0 12, sm)** — 다른 화면 머리 줄은 모두 `.btn-ctrl` 34(md) |
| 탐색기 | `.fx-root`(FilesScreen.tsx:1321, app.css:7461) | **gap 14**, min-height 0 | `.fx-top`(7468) | gap **8(숫자)** | `.search.fx-search` 34, 폭 **300** · `.btn.btn-ctrl(.fx-sq)` 34 · `.fx-vsep` 22 · `.fx-more` 글자 12 (두 번째 줄 `.fx-row1` 42·`.fx-row2` 44, 그 안 단추는 `--fx-ctl`=28) |
| 민원처리 | `.pr`(ProcessScreen.tsx:431, app.css:6718) | gap 12, **height calc(100vh − 48px)**(바깥 여백 24+24를 뺀 값을 직접 계산), min-height 420 | `.ct-head`(751) | gap 8 | `.search` 34 · `.btn.btn-ctrl.btn-text` 34 ×2 · `.btn-primary.btn-ctrl.pr-fetch` 34, gap 8 |
| 집행현황 | `.bd`(BudgetScreen.tsx:1378, app.css:8847) | **gap 14**, min-height 0 | `.bd-top`(8854) | **height 34 고정**, gap 8 | `.bd-year` 34(안 단추 32, 글자 14·line-height 32) · `.bd-unit` 34(3px 안쪽, 단추 26) · `.search.bd-search` 34, 폭 **240**, padding-right 6 · `.search-x` 20 |

정리: 머리 줄의 실제 높이는 9화면 모두 34px(`--size-ctrl`)로 같아요(설정은 `min-height` 34로 맞춰지고 단추만 30px). 검색창 폭은 260(기본)·240(업무일지·집행현황)·300(탐색기). 컨테이너 세로 gap은 16(`.main`)·12(`.pr`)·14(`.fx-root`·`.bd`)로 달라요 — 머리 줄과 본문 사이 간격이 화면마다 12~16px.


---

## 부록 — 전체 선언 목록 (src/app.css)

1번의 원자료예요. 토큰은 그대로 적었어요.

### 부록 모서리 `border-radius` — 전체 229곳 (값 순, 같은 값은 줄 순)

| 값 | app.css 줄 | 선택자 | @media |
|---|---|---|---|
| `1px` | 2735 | `.rte-area ul > li.k-sq::before, .rte-view ul > li.k-sq::before` |  |
| `1px` | 2746 | `.rte-area ul > li.k-da::before, .rte-view ul > li.k-da::before` |  |
| `1px` | 2864 | `.cm-grip::after` |  |
| `1px` | 3506 | `.bl-sq` |  |
| `1px` | 3513 | `.bl-da` |  |
| `1px` | 9028 | `.bd-grip::after` |  |
| `2px` | 735 | `mark` |  |
| `2px` | 7182 | `.pr-dot` |  |
| `3px` | 2606 | `.rte-grid-cell` |  |
| `3px` | 4579 | `.cal-up-dot` |  |
| `3px` | 6759 | `.pr-run-bar` |  |
| `3px` | 9217 | `.bd-bar` |  |
| `3px` | 9227 | `.bd-bar > span` |  |
| `4px` | 3333 | `.cm-ck` |  |
| `4px` | 5012 | `.cal-kind-swatch` |  |
| `4px` | 5315 | `.cal-wk-col .cal-ev` |  |
| `4px` | 6457 | `.jp-kind` |  |
| `4px` | 6499 | `.jp-proj` |  |
| `4px` | 6520 | `.jp-sp` |  |
| `4px` | 7937 | `.fx-up` |  |
| `4px` | 8018 | `.fx-thumb` |  |
| `4px` | 8672 | `.pchip-x` |  |
| `4px` | 9152 | `.bd-cr` |  |
| `5px` | 623 | `.chip-x` |  |
| `5px` | 668 | `.kind-key` |  |
| `5px` | 1327 | `.memo-row` |  |
| `5px` | 2191 | `.jproj-badge` |  |
| `5px` | 3844 | `.td-list-box` |  |
| `5px` | 3958 | `.td-link-badge, .td-src` |  |
| `5px` | 4353 | `.td-due` |  |
| `5px` | 4541 | `.cal-kind-box` |  |
| `5px` | 4806 | `.cal-ev` |  |
| `5px` | 4879 | `.cal-more` |  |
| `5px` | 6686 | `.kb-cap` |  |
| `5px` | 6949 | `.pr-d` |  |
| `5px` | 7610 | `.fx-target` |  |
| `5px` | 7949 | `.fx-lock` |  |
| `5px` | 8292 | `.fx-new` |  |
| `5px` | 8905 | `.bd-unit button` |  |
| `6px` | 5058 | `.cal-kbadge` |  |
| `6px` | 6438 | `.jp-card` |  |
| `6px` | 7942 | `.fx-up-big` |  |
| `6px` | 9269 | `.bd-chip` |  |
| `6px` | 9305 | `.bd-memo` |  |
| `6px` | 9336 | `.bd-in` |  |
| `6px` | 9364 | `.bd-selk` |  |
| `6px` | 9421 | `.bd-mi` |  |
| `6px` | 9602 | `.bd-sumbar button` |  |
| `7px` | 6054 | `.jp-chip` |  |
| `7px` | 6158 | `.jp-nav` |  |
| `7px` | 6646 | `.kb` |  |
| `7px` | 7567 | `.fx-tab` |  |
| `7px` | 8751 | `.mod-icon` |  |
| `7px` | 8964 | `.bd-scroll::-webkit-scrollbar-thumb` |  |
| `8px 0 0 8px` | 6222 | `.jp-cell.band-l` |  |
| `9px` | 6046 | `.jp-chips` |  |
| `10px` | 328 | `.gate-note` |  |
| `10px` | 3242 | `.cm-fdd` |  |
| `10px` | 4111 | `.td-cal` |  |
| `10px` | 5646 | `.g-box` |  |
| `10px` | 5916 | `.xl-menu` |  |
| `10px` | 6146 | `.jp-cal` |  |
| `10px` | 7198 | `.pr-ask` |  |
| `10px` | 7541 | `.fx-pane` |  |
| `10px` | 8076 | `.fx-tree` |  |
| `10px` | 8263 | `.fx-cf-card` |  |
| `999px` | 552 | `.switch` |  |
| `999px` | 838 | `.pchip` |  |
| `999px` | 2407 | `.jonly` |  |
| `999px` | 3166 | `.cm-fpill` |  |
| `999px` | 3181 | `.cm-fpill-open` |  |
| `999px` | 3203 | `.cm-fpill-x` |  |
| `999px` | 4076 | `.td-due-input` |  |
| `999px` | 4758 | `.cal-num` |  |
| `999px` | 4972 | `.cal-allday` |  |
| `0 0 calc(var(--radius-md) - 1px) calc(var(--radius-md) - 1px)` | 914 | `.ct-new-row` |  |
| `0 0 calc(var(--radius-md) - 1px) calc(var(--radius-md) - 1px)` | 2966 | `.cm-view:last-child, .cm-edit:last-child` |  |
| `0 0 var(--radius-sm) var(--radius-sm)` | 7412 | `.pr-new` |  |
| `0 8px 8px 0` | 6226 | `.jp-cell.band-r` |  |
| `50%` | 567 | `.switch .knob` |  |
| `50%` | 859 | `.pchip-dot` |  |
| `50%` | 1243 | `.memo-dot` |  |
| `50%` | 1484 | `.swatch` |  |
| `50%` | 1700 | `.jcal-dot` |  |
| `50%` | 2134 | `.jmenu-dot` |  |
| `50%` | 2722 | `.rte-area ul > li::before, .rte-view ul > li::before` |  |
| `50%` | 3018 | `.cm-dot` |  |
| `50%` | 3498 | `.bl-ci` |  |
| `50%` | 3711 | `.cpick-dot` |  |
| `50%` | 4175 | `.td-cal-day` |  |
| `50%` | 4276 | `.td-check` |  |
| `50%` | 4847 | `.cal-ev-dot` |  |
| `50%` | 5173 | `.cal-ev-check` |  |
| `50%` | 5349 | `.cal-now::before` |  |
| `50%` | 5366 | `.cal-cbtn` |  |
| `50%` | 5383 | `.cal-cbtn-dot` |  |
| `50%` | 5541 | `.cal-kp-dot` |  |
| `50%` | 5612 | `.g-dot` |  |
| `50%` | 6277 | `.jp-dot` |  |
| `50%` | 6751 | `.pr-run-dot` |  |
| `50%` | 8930 | `.search-x` |  |
| `calc(var(--radius-md) + 6px)` | 4658 | `.cal-quick` |  |
| `calc(var(--radius-md) + 6px)` | 4677 | `.cal-grid` |  |
| `calc(var(--radius-md) - 1px) calc(var(--radius-md) - 1px) 0 0` | 900 | `.ct-new-head` |  |
| `calc(var(--radius-md) - 1px) calc(var(--radius-md) - 1px) 0 0` | 2825 | `.cm-head` |  |
| `calc(var(--radius-md) - 2px)` | 5133 | `.cal-views button` |  |
| `var(--radius-lg)` | 201 | `.card` |  |
| `var(--radius-lg)` | 254 | `.gate-card` |  |
| `var(--radius-lg)` | 1022 | `.ccard` |  |
| `var(--radius-lg)` | 1420 | `.dialog` |  |
| `var(--radius-lg)` | 1552 | `.jcal` |  |
| `var(--radius-lg)` | 1902 | `.jcard` |  |
| `var(--radius-lg)` | 2470 | `.jn-aside` |  |
| `var(--radius-lg)` | 3926 | `.td-card` |  |
| `var(--radius-lg) 0 0 var(--radius-lg)` | 2165 | `.jcard-new > .jpillar, .jcard-edit > .jpillar` |  |
| `var(--radius-md)` | 75 | `.side-item` |  |
| `var(--radius-md)` | 272 | `.gate-input` |  |
| `var(--radius-md)` | 385 | `.btn-primary` |  |
| `var(--radius-md)` | 686 | `.seg` |  |
| `var(--radius-md)` | 770 | `.search` |  |
| `var(--radius-md)` | 797 | `.btn-ctrl` |  |
| `var(--radius-md)` | 885 | `.ct-new` |  |
| `var(--radius-md)` | 989 | `.pin-list` |  |
| `var(--radius-md)` | 1116 | `.ask-band` |  |
| `var(--radius-md)` | 1318 | `.memo-lines` |  |
| `var(--radius-md)` | 1656 | `.jcal-day` |  |
| `var(--radius-md)` | 1752 | `.jcal-mon` |  |
| `var(--radius-md)` | 1815 | `.jday` |  |
| `var(--radius-md)` | 2091 | `.jmenu` |  |
| `var(--radius-md)` | 2393 | `.jsearch-bar` |  |
| `var(--radius-md)` | 2590 | `.rte-grid` |  |
| `var(--radius-md)` | 2811 | `.cm` |  |
| `var(--radius-md)` | 3659 | `.cm-spick-list` |  |
| `var(--radius-md)` | 3723 | `.cpick-pop` |  |
| `var(--radius-md)` | 3754 | `.dmenu` |  |
| `var(--radius-md)` | 3819 | `.td-list` |  |
| `var(--radius-md)` | 4223 | `.td-row` |  |
| `var(--radius-md)` | 4516 | `.cal-kind` |  |
| `var(--radius-md)` | 4564 | `.cal-up` |  |
| `var(--radius-md)` | 4640 | `.cal-nav .btn` |  |
| `var(--radius-md)` | 5028 | `.cal-dlg-foot .cal-trash` |  |
| `var(--radius-md)` | 5125 | `.cal-views` |  |
| `var(--radius-md)` | 5397 | `.cal-cpop` |  |
| `var(--radius-md)` | 5564 | `.cal-kp-list` |  |
| `var(--radius-md)` | 5726 | `.mgr .padd .input` |  |
| `var(--radius-md)` | 5987 | `.xl-toast` |  |
| `var(--radius-md)` | 6025 | `.jp-x` |  |
| `var(--radius-md)` | 6105 | `.jp-field-box` |  |
| `var(--radius-md)` | 6239 | `.jp-day` |  |
| `var(--radius-md)` | 6614 | `.keys-box` |  |
| `var(--radius-md)` | 6742 | `.pr-run` |  |
| `var(--radius-md)` | 6777 | `.pr-table` |  |
| `var(--radius-md)` | 7141 | `.pr-menu` |  |
| `var(--radius-md)` | 7743 | `.fx-menu` |  |
| `var(--radius-md)` | 7999 | `.fx-gcell` |  |
| `var(--radius-md)` | 8329 | `.fx-rn-list` |  |
| `var(--radius-md)` | 8382 | `.fx-grp` |  |
| `var(--radius-md)` | 8866 | `.bd-year` |  |
| `var(--radius-md)` | 8898 | `.bd-unit` |  |
| `var(--radius-md)` | 8946 | `.bd-tbl` |  |
| `var(--radius-md)` | 9406 | `.bd-pop` |  |
| `var(--radius-md)` | 9561 | `.bd-toast` |  |
| `var(--radius-md)` | 9584 | `.bd-sumbar` |  |
| `var(--radius-sm)` | 370 | `.field > input` |  |
| `var(--radius-sm)` | 436 | `.btn` |  |
| `var(--radius-sm)` | 463 | `.btn-sm` |  |
| `var(--radius-sm)` | 474 | `.btn-icon` |  |
| `var(--radius-sm)` | 483 | `.input` |  |
| `var(--radius-sm)` | 605 | `.chip` |  |
| `var(--radius-sm)` | 651 | `.kind` |  |
| `var(--radius-sm)` | 694 | `.seg button` |  |
| `var(--radius-sm)` | 875 | `.pbadge` |  |
| `var(--radius-sm)` | 946 | `.cell-input` |  |
| `var(--radius-sm)` | 999 | `.pin-opt` |  |
| `var(--radius-sm)` | 1088 | `.tool` |  |
| `var(--radius-sm)` | 1158 | `.cline` |  |
| `var(--radius-sm)` | 1216 | `.memo-view` |  |
| `var(--radius-sm)` | 1254 | `.memo-add` |  |
| `var(--radius-sm)` | 1289 | `.tb` |  |
| `var(--radius-sm)` | 1502 | `.tool-box` |  |
| `var(--radius-sm)` | 1575 | `.jcal-title` |  |
| `var(--radius-sm)` | 1594 | `.jcal-nav, .jcal-today` |  |
| `var(--radius-sm)` | 1833 | `.jday-in` |  |
| `var(--radius-sm)` | 2058 | `.jsp` |  |
| `var(--radius-sm)` | 2110 | `.jmenu-opt` |  |
| `var(--radius-sm)` | 2319 | `.jsp-btn` |  |
| `var(--radius-sm)` | 2338 | `.jbtn-add` |  |
| `var(--radius-sm)` | 2358 | `.jedit-foot .btn-primary.btn-xs` |  |
| `var(--radius-sm)` | 2371 | `.jtrash` |  |
| `var(--radius-sm)` | 2442 | `.jsearch-go` |  |
| `var(--radius-sm)` | 2544 | `.rte` |  |
| `var(--radius-sm)` | 3050 | `.cm-status` |  |
| `var(--radius-sm)` | 3064 | `.cm-memo` |  |
| `var(--radius-sm)` | 3127 | `.cm-hbtn` |  |
| `var(--radius-sm)` | 3277 | `.cm-fdd-search` |  |
| `var(--radius-sm)` | 3296 | `.cm-fdd-opt` |  |
| `var(--radius-sm)` | 3356 | `.cm-fdd-clear` |  |
| `var(--radius-sm)` | 3606 | `.cm-copy` |  |
| `var(--radius-sm)` | 3670 | `.cm-spick-opt` |  |
| `var(--radius-sm)` | 3763 | `.dmenu-item` |  |
| `var(--radius-sm)` | 4008 | `.td-add-title` |  |
| `var(--radius-sm)` | 4060 | `.td-cal-btn` |  |
| `var(--radius-sm)` | 4138 | `.td-cal-nav` |  |
| `var(--radius-sm)` | 4329 | `.td-detail` |  |
| `var(--radius-sm)` | 4986 | `.cal-select` |  |
| `var(--radius-sm)` | 5506 | `.cal-kp-btn` |  |
| `var(--radius-sm)` | 5575 | `.cal-kp-opt` |  |
| `var(--radius-sm)` | 5928 | `.xl-item` |  |
| `var(--radius-sm)` | 6989 | `.pr-work` |  |
| `var(--radius-sm)` | 7035 | `.pr-next` |  |
| `var(--radius-sm)` | 7070 | `.pr-sent` |  |
| `var(--radius-sm)` | 7085 | `.pr-icon` |  |
| `var(--radius-sm)` | 7103 | `.pr-del` |  |
| `var(--radius-sm)` | 7155 | `.pr-opt, .pr-copt` |  |
| `var(--radius-sm)` | 7367 | `.pr-tpl` |  |
| `var(--radius-sm)` | 7390 | `.pr-add` |  |
| `var(--radius-sm)` | 7440 | `.pr-save` |  |
| `var(--radius-sm)` | 7640 | `.fx-drv` |  |
| `var(--radius-sm)` | 7676 | `.fx-vb` |  |
| `var(--radius-sm)` | 7691 | `.fx-ib` |  |
| `var(--radius-sm)` | 7711 | `.fx-crumbs` |  |
| `var(--radius-sm)` | 7758 | `.fx-mi` |  |
| `var(--radius-sm)` | 7807 | `.fx-fk` |  |
| `var(--radius-sm)` | 8106 | `.fx-tr` |  |
| `var(--radius-sm)` | 8227 | `.fx-chip` |  |
| `var(--radius-sm)` | 8441 | `.fx-drop` |  |
| `var(--radius-sm)` | 8635 | `.pchips` |  |
| `var(--radius-sm)` | 8810 | `.mod-tag` |  |
| `var(--radius-sm) var(--radius-sm) 0 0` | 2561 | `.rte-bar` |  |

### 부록 높이 `height` — 전체 234곳 (값 순, 같은 값은 줄 순)

| 값 | app.css 줄 | 선택자 | @media |
|---|---|---|---|
| `1px` | 108 | `.side-div` |  |
| `1px` | 7778 | `.fx-sep` |  |
| `1px` | 8733 | `.set-sec::after` |  |
| `1px` | 9201 | `.bd-tl.h1` |  |
| `1px` | 9207 | `.bd-tl.h2` |  |
| `1px` | 9456 | `.bd-mdiv` |  |
| `1.5px` | 2745 | `.rte-area ul > li.k-da::before, .rte-view ul > li.k-da::before` |  |
| `1.5px` | 3512 | `.bl-da` |  |
| `2px` | 5337 | `.cal-now` |  |
| `4px` | 1241 | `.memo-dot` |  |
| `4px` | 2721 | `.rte-area ul > li::before, .rte-view ul > li::before` |  |
| `4px` | 3016 | `.cm-dot` |  |
| `4px` | 3497 | `.bl-ci` |  |
| `4px` | 6276 | `.jp-dot` |  |
| `4px` | 9233 | `.bd-bar.rowbar` |  |
| `5px` | 1699 | `.jcal-dot` |  |
| `5px` | 9230 | `.bd-bar.sm` |  |
| `6px` | 6758 | `.pr-run-bar` |  |
| `6px` | 8739 | `.mod-div` |  |
| `6px` | 9216 | `.bd-bar` |  |
| `7px` | 2732 | `.rte-area ul > li.k-sq::before, .rte-view ul > li.k-sq::before` |  |
| `7px` | 3504 | `.bl-sq` |  |
| `8px` | 858 | `.pchip-dot` |  |
| `8px` | 2133 | `.jmenu-dot` |  |
| `8px` | 4577 | `.cal-up-dot` |  |
| `8px` | 4846 | `.cal-ev-dot` |  |
| `8px` | 5611 | `.g-dot` |  |
| `8px` | 8098 | `.fx-tree-gap` |  |
| `9px` | 5540 | `.cal-kp-dot` |  |
| `9px` | 7181 | `.pr-dot` |  |
| `10px` | 3710 | `.cpick-dot` |  |
| `10px` | 5348 | `.cal-now::before` |  |
| `10px` | 6750 | `.pr-run-dot` |  |
| `12px` | 5011 | `.cal-kind-swatch` |  |
| `14px` | 5382 | `.cal-cbtn-dot` |  |
| `14px` | 8960 | `.bd-scroll::-webkit-scrollbar` |  |
| `16px` | 566 | `.switch .knob` |  |
| `16px` | 2603 | `.rte-grid-cell` |  |
| `16px` | 3331 | `.cm-ck` |  |
| `16px` | 3841 | `.td-list-box` |  |
| `16px` | 4538 | `.cal-kind-box` |  |
| `16px` | 5169 | `.cal-ev-check` |  |
| `16px` | 7958 | `.fx-lock-s` |  |
| `16px` | 8148 | `.fx-chev` |  |
| `16px` | 8669 | `.pchip-x` |  |
| `18px` | 1480 | `.swatch` |  |
| `18px` | 2574 | `.rte-sep` |  |
| `18px` | 3156 | `.cm-fsep` |  |
| `18px` | 4272 | `.td-check` |  |
| `18px` | 6947 | `.pr-d` |  |
| `18px` | 7317 | `.pr-tel` |  |
| `18px` | 7608 | `.fx-target` |  |
| `18px` | 7947 | `.fx-lock` |  |
| `18px` | 8290 | `.fx-new` |  |
| `18px` | 9189 | `.bd-tl.half` |  |
| `20px` | 551 | `.switch` |  |
| `20px` | 620 | `.chip-x` |  |
| `20px` | 666 | `.kind-key` |  |
| `20px` | 3956 | `.td-link-badge, .td-src` |  |
| `20px` | 4351 | `.td-due` |  |
| `20px` | 5777 | `.search input` |  |
| `20px` | 6123 | `.jp-field-box input` |  |
| `20px` | 6682 | `.kb-cap` |  |
| `20px` | 7936 | `.fx-up` |  |
| `20px` | 8923 | `.search-x` |  |
| `20px` | 9143 | `.bd-cr` |  |
| `22px` | 873 | `.pbadge` |  |
| `22px` | 1250 | `.memo-add` |  |
| `22px` | 2056 | `.jsp` |  |
| `22px` | 3048 | `.cm-status` |  |
| `22px` | 3736 | `.cpick-grid .swatch` |  |
| `22px` | 4802 | `.cal-ev` |  |
| `22px` | 4875 | `.cal-more` |  |
| `22px` | 5056 | `.cal-kbadge` |  |
| `22px` | 5410 | `.cal-cgrid .swatch` |  |
| `22px` | 7511 | `.fx-vsep` |  |
| `22px` | 7814 | `.fx-findband .fx-fk` |  |
| `22px` | 8648 | `.pchips-in` |  |
| `22px` | 8660 | `.pbadge.pchip-b` |  |
| `22px` | 8808 | `.mod-tag` |  |
| `22px` | 9266 | `.bd-chip` |  |
| `24px` | 1085 | `.tool` |  |
| `24px` | 2316 | `.jsp-btn` |  |
| `24px` | 3199 | `.cm-fpill-x` |  |
| `24px` | 4135 | `.td-cal-nav` |  |
| `24px` | 4505 | `.cal-manage` |  |
| `24px` | 4755 | `.cal-num` |  |
| `24px` | 5363 | `.cal-cbtn` |  |
| `24px` | 7928 | `.fx-inline` |  |
| `24px` | 8231 | `.fx-chip button` |  |
| `24px` | 9600 | `.bd-sumbar button` |  |
| `26px` | 471 | `.btn-icon` |  |
| `26px` | 496 | `.input-sm` |  |
| `26px` | 602 | `.chip` |  |
| `26px` | 691 | `.seg button` |  |
| `26px` | 803 | `.btn-xs` |  |
| `26px` | 1286 | `.tb` |  |
| `26px` | 1498 | `.tool-box` |  |
| `26px` | 1830 | `.jday-in` |  |
| `26px` | 2356 | `.jedit-foot .btn-primary.btn-xs` |  |
| `26px` | 3061 | `.cm-memo` |  |
| `26px` | 3178 | `.cm-fpill-open` |  |
| `26px` | 3353 | `.cm-fdd-clear` |  |
| `26px` | 4057 | `.td-cal-btn` |  |
| `26px` | 4073 | `.td-due-input` |  |
| `26px` | 5098 | `.cal-daylist .cal-ev` |  |
| `26px` | 7032 | `.pr-next` |  |
| `26px` | 7064 | `.pr-sent` |  |
| `26px` | 7364 | `.pr-tpl` |  |
| `26px` | 7804 | `.fx-fk` |  |
| `26px` | 7831 | `.fx-hdr` |  |
| `26px` | 7973 | `.fx-brow` |  |
| `26px` | 8337 | `.fx-rn-row` |  |
| `26px` | 8902 | `.bd-unit button` |  |
| `26px` | 9302 | `.bd-memo` |  |
| `28px` | 835 | `.pchip` |  |
| `28px` | 937 | `.btn-add` |  |
| `28px` | 2368 | `.jtrash` |  |
| `28px` | 2404 | `.jonly` |  |
| `28px` | 3164 | `.cm-fpill` |  |
| `28px` | 3214 | `.cm-fall` |  |
| `28px` | 4172 | `.td-cal-day` |  |
| `28px` | 4672 | `.cal-add` |  |
| `28px` | 5815 | `.mgr-name-in` |  |
| `28px` | 6051 | `.jp-chip` |  |
| `28px` | 6153 | `.jp-nav` |  |
| `28px` | 6182 | `.jp-mtitle` |  |
| `28px` | 6639 | `.kb` |  |
| `28px` | 7082 | `.pr-icon` |  |
| `28px` | 7100 | `.pr-del` |  |
| `28px` | 7387 | `.pr-add` |  |
| `28px` | 7437 | `.pr-save` |  |
| `28px` | 8038 | `.fx-status` |  |
| `28px` | 8103 | `.fx-tr` |  |
| `28px` | 8348 | `.fx-rn-hdr` |  |
| `28px` | 8750 | `.mod-icon` |  |
| `28px` | 9333 | `.bd-in` |  |
| `28px` | 9361 | `.bd-selk` |  |
| `28px` | 9487 | `.bd-stlist .bd-mi` |  |
| `30px` | 433 | `.btn` |  |
| `30px` | 459 | `.btn-sm` |  |
| `30px` | 480 | `.input` |  |
| `30px` | 648 | `.kind` |  |
| `30px` | 1571 | `.jcal-title` |  |
| `30px` | 1592 | `.jcal-nav, .jcal-today` |  |
| `30px` | 3274 | `.cm-fdd-search` |  |
| `30px` | 3760 | `.dmenu-item` |  |
| `30px` | 3816 | `.td-list` |  |
| `30px` | 3877 | `.td-newlist .cell-input` |  |
| `30px` | 3883 | `.td-newlist-add` |  |
| `30px` | 4513 | `.cal-kind` |  |
| `30px` | 7792 | `.fx-findband` |  |
| `30px` | 8115 | `.fx-tr-drive` |  |
| `32px` | 3398 | `.cm-memo-body .memo-row input` |  |
| `32px` | 4955 | `.cal-dlg-grid .cell-input` |  |
| `32px` | 4971 | `.cal-allday` |  |
| `32px` | 4983 | `.cal-select` |  |
| `32px` | 5072 | `.cal-knew` |  |
| `32px` | 5550 | `.cal-dlg-grid .cal-kp-btn` |  |
| `32px` | 6020 | `.jp-x` |  |
| `32px` | 8050 | `.fx-keys` |  |
| `32px` | 8870 | `.bd-year button` |  |
| `32px` | 9319 | `.bd-carry` |  |
| `32px` | 9419 | `.bd-mi` |  |
| `32px` | 9581 | `.bd-sumbar` |  |
| `33px` | 122 | `.side-bottom .side-item, .side-toggle .side-item` |  |
| `34px` | 4421 | `.td-done-toggle` |  |
| `34px` | 7563 | `.fx-tab` |  |
| `35px` | 72 | `.side-item` |  |
| `35px` | 6074 | `.jp-tilde` |  |
| `35px` | 6102 | `.jp-field-box` |  |
| `36px` | 159 | `.side-folded .brand` |  |
| `36px` | 171 | `.side-folded .side-item` |  |
| `36px` | 268 | `.gate-input` |  |
| `36px` | 293 | `.gate-open` |  |
| `36px` | 6214 | `.jp-cell` |  |
| `36px` | 6231 | `.jp-day` |  |
| `36px` | 8083 | `.fx-tree-head` |  |
| `38px` | 6739 | `.pr-run` |  |
| `40px` | 1653 | `.jcal-day` |  |
| `40px` | 4907 | `.cal-dlg-title input` |  |
| `40px` | 8984 | `.bd-hd` |  |
| `42px` | 7624 | `.fx-row1` |  |
| `44px` | 7628 | `.fx-row2` |  |
| `54px` | 1750 | `.jcal-mon` |  |
| `66px` | 8023 | `.fx-thumb-ph` |  |
| `210px` | 8356 | `.fx-rn-body` |  |
| `100%` | 9 | `html, body, #root` |  |
| `100%` | 34 | `.shell` |  |
| `100%` | 234 | `.gate` |  |
| `100%` | 2836 | `.cm-hcell` |  |
| `100%` | 2853 | `.cm-grip` |  |
| `100%` | 6766 | `.pr-run-bar > span` |  |
| `100%` | 7836 | `.fx-hcell` |  |
| `100%` | 9017 | `.bd-grip` |  |
| `100%` | 9225 | `.bd-bar > span` |  |
| `210mm` | 6358 | `.jp-page` |  |
| `50%` | 2863 | `.cm-grip::after` |  |
| `50%` | 9027 | `.bd-grip::after` |  |
| `auto` | 2301 | `.cell-input.jtalk` |  |
| `auto` | 3525 | `.bl-ed` |  |
| `auto` | 3569 | `.memo-row .bl-m` |  |
| `auto` | 6566 | `html, body` | @media print |
| `calc(100vh - 48px)` | 6721 | `.pr` |  |
| `calc(var(--fs) * 1.5)` | 3485 | `.bl-m` |  |
| `calc(var(--size-ctrl) - 8px)` | 5130 | `.cal-views button` |  |
| `calc(var(--size-row) + 4px)` | 2824 | `.cm-head` |  |
| `calc(var(--size-row) - 4px)` | 901 | `.ct-new-head` |  |
| `calc(var(--size-row) - 8px)` | 4005 | `.td-add-title` |  |
| `var(--fx-ctl)` | 7632 | `.fx-drv` |  |
| `var(--fx-ctl)` | 7664 | `.fx-filter` |  |
| `var(--fx-ctl)` | 7669 | `.fx-vb` |  |
| `var(--fx-ctl)` | 7684 | `.fx-ib` |  |
| `var(--fx-ctl)` | 7705 | `.fx-crumbs` |  |
| `var(--fx-ctl)` | 7731 | `.fx-path-in` |  |
| `var(--fx-ctl)` | 8186 | `.fx-fgrid .input` |  |
| `var(--fx-ctl)` | 8385 | `.fx-grp .input` |  |
| `var(--fx-ctl)` | 8438 | `.fx-drop` |  |
| `var(--size-ctrl)` | 367 | `.field > input` |  |
| `var(--size-ctrl)` | 382 | `.btn-primary` |  |
| `var(--size-ctrl)` | 767 | `.search` |  |
| `var(--size-ctrl)` | 796 | `.btn-ctrl` |  |
| `var(--size-ctrl)` | 4638 | `.cal-nav .btn` |  |
| `var(--size-ctrl)` | 5027 | `.cal-dlg-foot .cal-trash` |  |
| `var(--size-ctrl)` | 5725 | `.mgr .padd .input` |  |
| `var(--size-ctrl)` | 8857 | `.bd-top` |  |
| `var(--size-ctrl)` | 8863 | `.bd-year` |  |
| `var(--size-ctrl)` | 8894 | `.bd-unit` |  |
| `var(--size-input)` | 943 | `.cell-input` |  |
| `var(--size-input)` | 1341 | `.memo-row input` |  |
| `var(--size-input)` | 2336 | `.jbtn-add` |  |
| `var(--size-input)` | 3124 | `.cm-hbtn` |  |
| `var(--size-input)` | 4665 | `.cal-detail-btn` |  |
| `var(--size-input)` | 5503 | `.cal-kp-btn` |  |

### 부록 최소 높이 `min-height` — 전체 52곳 (값 순, 같은 값은 줄 순)

| 값 | app.css 줄 | 선택자 | @media |
|---|---|---|---|
| `18px` | 349 | `.gate-error` |  |
| `20px` | 2188 | `.jproj-badge` |  |
| `24px` | 1154 | `.cline` |  |
| `24px` | 4492 | `.cal-side-head` |  |
| `24px` | 4746 | `.cal-dhead` |  |
| `24px` | 6984 | `.pr-work` |  |
| `26px` | 2107 | `.jmenu-opt` |  |
| `28px` | 997 | `.pin-opt` |  |
| `28px` | 7875 | `.fx-frow` |  |
| `30px` | 3293 | `.cm-fdd-opt` |  |
| `30px` | 3668 | `.cm-spick-opt` |  |
| `30px` | 5573 | `.cal-kp-opt` |  |
| `30px` | 7152 | `.pr-opt, .pr-copt` |  |
| `30px` | 7755 | `.fx-mi` |  |
| `32px` | 6626 | `.keys-row` |  |
| `36px` | 9039 | `.bd-rw` |  |
| `40px` | 6796 | `.pr-headrow` |  |
| `40px` | 9074 | `.bd-rw.pj` |  |
| `44px` | 1462 | `.prow` |  |
| `44px` | 6785 | `.pr-row` |  |
| `44px` | 7252 | `.pr-wrow` |  |
| `45px` | 5700 | `.mgr .prow` |  |
| `46px` | 4655 | `.cal-quick` |  |
| `96px` | 2622 | `.rte-area` |  |
| `120px` | 9528 | `.bd-memopop .rte-area` |  |
| `160px` | 3392 | `.cm-memo-body .memo-lines` |  |
| `420px` | 6722 | `.pr` |  |
| `0` | 727 | `.pw-foot .gate-error` |  |
| `0` | 5838 | `.cal-grid > .cal-wk` |  |
| `0` | 5843 | `.cal-wk-scroll` |  |
| `0` | 6421 | `.jp-cols` |  |
| `0` | 6773 | `.pr-table` |  |
| `0` | 6862 | `.pr-body` |  |
| `0` | 7458 | `.main > .fx-root` |  |
| `0` | 7464 | `.fx-root` |  |
| `0` | 7520 | `.fx-body` |  |
| `0` | 7526 | `.fx-panes` |  |
| `0` | 7537 | `.fx-pane` |  |
| `0` | 7869 | `.fx-list` |  |
| `0` | 8093 | `.fx-tree-list` |  |
| `0` | 8838 | `.pin-ask-msg` |  |
| `0` | 8844 | `.main > .bd` |  |
| `0` | 8942 | `.bd-tbl` |  |
| `0` | 8951 | `.bd-scroll` |  |
| `calc(var(--size-row) + 6px)` | 915 | `.ct-new-row` |  |
| `calc(var(--size-row) + 6px)` | 2900 | `.cm-new > .cm-c, .cm-edit > .cm-c` |  |
| `var(--size-ctrl)` | 415 | `.title-row` |  |
| `var(--size-input)` | 2302 | `.cell-input.jtalk` |  |
| `var(--size-input)` | 2925 | `.cm-area` |  |
| `var(--size-input)` | 3526 | `.bl-ed` |  |
| `var(--size-input)` | 8632 | `.pchips` |  |
| `var(--size-row)` | 2939 | `.cm-view` |  |

### 부록 안쪽 여백 `padding` — 전체 311곳 (값 순, 같은 값은 줄 순)

| 값 | app.css 줄 | 선택자 | @media |
|---|---|---|---|
| `1px 6px` | 1156 | `.cline` |  |
| `2px 4px` | 306 | `.gate-link` |  |
| `2px` | 684 | `.seg` |  |
| `2px 5px` | 2189 | `.jproj-badge` |  |
| `2px 6px` | 2440 | `.jsearch-go` |  |
| `2px 0 2px 10px` | 2671 | `.rte-area blockquote, .rte-view blockquote` |  |
| `2px var(--space-3) var(--space-2) 10px` | 3093 | `.cm-edit-foot` |  |
| `2px 4px` | 3603 | `.cm-copy` |  |
| `2px` | 3895 | `.td-rename` |  |
| `2px 6px` | 5312 | `.cal-wk-col .cal-ev` |  |
| `2px 4px` | 8633 | `.pchips` |  |
| `3px` | 2089 | `.jmenu` |  |
| `3px 6px` | 2108 | `.jmenu-opt` |  |
| `3px` | 2558 | `.rte-bar` |  |
| `3px 6px` | 3530 | `.bl-ed` |  |
| `3px` | 5123 | `.cal-views` |  |
| `3px 0` | 5249 | `.cal-wk-allday` |  |
| `3px` | 6045 | `.jp-chips` |  |
| `3px 9px` | 6986 | `.pr-work` |  |
| `3px 8px 3px 0` | 7908 | `.fx-ncell` |  |
| `3px 0` | 7964 | `.fx-brief` |  |
| `3px` | 8895 | `.bd-unit` |  |
| `3px` | 9412 | `.bd-pop.bd-pop-list` |  |
| `4px 6px` | 1214 | `.memo-view` |  |
| `4px 6px` | 2139 | `.jmenu-hint` |  |
| `4px 7px` | 2768 | `.rte-area td, .rte-view td` |  |
| `4px 6px` | 2926 | `.cm-area` |  |
| `4px 8px 2px` | 3591 | `.pin-hint` |  |
| `4px` | 7139 | `.pr-menu` |  |
| `4px 8px` | 7153 | `.pr-opt, .pr-copt` |  |
| `4px` | 7738 | `.fx-menu` |  |
| `4px 0` | 8095 | `.fx-tree-list` |  |
| `4px` | 9403 | `.bd-pop` |  |
| `5px 0 0` | 1654 | `.jcal-day` |  |
| `5px var(--space-1)` | 2899 | `.cm-new > .cm-c, .cm-edit > .cm-c` |  |
| `5px 10px` | 3370 | `.cm-new > .cm-area-auto, .cm-edit > .cm-area-auto` |  |
| `6px 0` | 1463 | `.prow` |  |
| `6px` | 2588 | `.rte-grid` |  |
| `6px 10px` | 3887 | `.dmenu-note` |  |
| `6px 0 6px 0` | 3986 | `.td-add.sub` |  |
| `6px var(--space-2)` | 4206 | `.td-items, .td-done-list` |  |
| `6px 10px` | 4328 | `.td-detail` |  |
| `6px var(--space-2)` | 4562 | `.cal-up` |  |
| `6px var(--space-2)` | 4603 | `.cal-up-empty` |  |
| `6px 10px 0` | 4747 | `.cal-dhead` |  |
| `6px 10px` | 5211 | `.cal-wday` |  |
| `6px` | 5914 | `.xl-menu` |  |
| `6px 0 8px` | 6388 | `.jp-phead` |  |
| `6px 8px` | 7554 | `.fx-tabs` |  |
| `6px 10px 2px` | 9474 | `.bd-grp` |  |
| `7.5px` | 6436 | `.jp-card` |  |
| `8px 10px` | 2625 | `.rte-area` |  |
| `8px 10px` | 5926 | `.xl-item` |  |
| `8px 8px 6px 12px` | 6612 | `.keys-box` |  |
| `8px` | 7187 | `.pr-menu-empty` |  |
| `8px` | 7986 | `.fx-grid` |  |
| `8px 4px` | 7998 | `.fx-gcell` |  |
| `8px 18px 0` | 8253 | `.fx-cf-cards` |  |
| `8px var(--space-4)` | 8772 | `.mod-note` |  |
| `8px` | 9518 | `.bd-memopop` |  |
| `9px 14px` | 3412 | `.jn-due-item` |  |
| `10px 14px` | 325 | `.gate-note` |  |
| `10px var(--space-4)` | 514 | `.row` |  |
| `10px 14px` | 1033 | `.ccard-band` |  |
| `10px 10px 10px 14px` | 1562 | `.jcal-head` |  |
| `10px var(--space-4)` | 1813 | `.jday` |  |
| `10px var(--space-2)` | 2163 | `.jcard-new > .jpillar, .jcard-edit > .jpillar` |  |
| `10px var(--space-3)` | 2206 | `.jnew-main` |  |
| `10px var(--space-4)` | 2391 | `.jsearch-bar` |  |
| `10px 14px` | 2480 | `.jn-aside-head` |  |
| `10px` | 3240 | `.cm-fdd` |  |
| `10px` | 3721 | `.cpick-pop` |  |
| `10px var(--space-4)` | 5635 | `.g-foot` |  |
| `10px 16px` | 5986 | `.xl-toast` |  |
| `10px 20px 14px` | 7421 | `.pr-hints` |  |
| `10px 18px 0` | 8299 | `.fx-cf-both` |  |
| `10px 12px 12px` | 8380 | `.fx-grp` |  |
| `10px 18px 12px` | 8470 | `.fx-rn-foot` |  |
| `10px` | 9495 | `.bd-confirm` |  |
| `10px 16px` | 9560 | `.bd-toast` |  |
| `11px 10px 10px` | 6791 | `.pr-row > div` |  |
| `12px` | 5395 | `.cal-cpop` |  |
| `12px` | 8261 | `.fx-cf-card` |  |
| `12px 18px 0` | 8369 | `.fx-rn-grid` |  |
| `14px var(--space-3)` | 1924 | `.jpillar` |  |
| `14px 24px 0` | 6038 | `.jp-top` |  |
| `14px 12px 10px` | 6144 | `.jp-cal` |  |
| `14px 20px 16px 24px` | 6311 | `.jp-foot` |  |
| `14px 14px 12px` | 7196 | `.pr-ask` |  |
| `14px` | 8175 | `.fx-findpanel` |  |
| `14px 18px 10px` | 8324 | `.fx-rn-head` |  |
| `16px 24px 20px` | 5976 | `.xl-ask-foot` |  |
| `16px 18px 6px` | 8248 | `.fx-cf-head` |  |
| `16px 18px` | 8310 | `.fx-cf-foot` |  |
| `18px 20px 0 24px` | 6008 | `.jp-head` |  |
| `20px 24px 4px` | 5956 | `.xl-ask-body` |  |
| `23px 10px 16px` | 153 | `.side-folded` |  |
| `24px` | 8027 | `.fx-empty` |  |
| `27px var(--space-3) 20px` | 43 | `.side` |  |
| `40px 32px 24px` | 252 | `.gate-card` |  |
| `40px 0` | 9395 | `.bd-none` |  |
| `96px 0` | 9384 | `.bd-empty` |  |
| `0` | 160 | `.side-folded .brand` |  |
| `0` | 172 | `.side-folded .side-item` |  |
| `0` | 472 | `.btn-icon` |  |
| `0` | 621 | `.chip-x` |  |
| `0` | 1086 | `.tool` |  |
| `0` | 1287 | `.tb` |  |
| `0` | 1482 | `.swatch` |  |
| `0` | 1500 | `.tool-box` |  |
| `0` | 1601 | `.jcal-nav` |  |
| `0` | 2016 | `.jproj` |  |
| `0` | 2604 | `.rte-grid-cell` |  |
| `0` | 3062 | `.cm-memo` |  |
| `0` | 3201 | `.cm-fpill-x` |  |
| `0` | 3547 | `.bl-ta` |  |
| `0` | 4058 | `.td-cal-btn` |  |
| `0` | 4136 | `.td-cal-nav` |  |
| `0` | 4173 | `.td-cal-day` |  |
| `0` | 4274 | `.td-check` |  |
| `0` | 4647 | `.cal-nav .cal-navbtn` |  |
| `0` | 5076 | `.link-btn` |  |
| `0` | 5171 | `.cal-ev-check` |  |
| `0` | 5364 | `.cal-cbtn` |  |
| `0` | 6232 | `.jp-day` |  |
| `0` | 6893 | `.pr-no-link` |  |
| `0` | 7033 | `.pr-next` |  |
| `0` | 7083 | `.pr-icon` |  |
| `0` | 7101 | `.pr-del` |  |
| `0` | 7388 | `.pr-add` |  |
| `0` | 7506 | `.fx-more` |  |
| `0` | 7689 | `.fx-ib` |  |
| `0` | 8439 | `.fx-drop` |  |
| `0` | 8670 | `.pchip-x` |  |
| `0` | 8928 | `.search-x` |  |
| `0` | 9149 | `.bd-cr` |  |
| `0` | 9286 | `.bd-kchip` |  |
| `0` | 9303 | `.bd-memo` |  |
| `0 0 0 18px` | 7318 | `.pr-tel` |  |
| `0 0 1px` | 5776 | `.search input` |  |
| `0 0 1px` | 6124 | `.jp-field-box input` |  |
| `0 0 var(--space-1) var(--space-2)` | 4493 | `.cal-side-head` |  |
| `0 10px` | 270 | `.gate-input` |  |
| `0 10px` | 804 | `.btn-xs` |  |
| `0 10px` | 836 | `.pchip` |  |
| `0 10px` | 910 | `.ct-new-head > div` |  |
| `0 10px` | 924 | `.ct-new-row > .ct-new-tag` |  |
| `0 10px` | 1605 | `.jcal-today` |  |
| `0 10px` | 2839 | `.cm-hcell` |  |
| `0 10px` | 2887 | `.cm-c` |  |
| `0 10px` | 2916 | `.cm-new > .cm-new-tag` |  |
| `0 10px` | 3761 | `.dmenu-item` |  |
| `0 10px` | 6103 | `.jp-field-box` |  |
| `0 10px` | 7438 | `.pr-save` |  |
| `0 10px` | 7516 | `.fx-sq` |  |
| `0 10px` | 7638 | `.fx-drv` |  |
| `0 10px` | 7793 | `.fx-findband` |  |
| `0 10px` | 7805 | `.fx-fk` |  |
| `0 10px` | 7825 | `.fx-hdr, .fx-frow` |  |
| `0 10px` | 7974 | `.fx-brow` |  |
| `0 10px` | 8039 | `.fx-status` |  |
| `0 10px` | 8338 | `.fx-rn-row` |  |
| `0 10px` | 8507 | `.fx-set-drive.chip` |  |
| `0 10px` | 8883 | `.bd-year b` |  |
| `0 10px` | 8903 | `.bd-unit button` |  |
| `0 10px` | 9420 | `.bd-mi` |  |
| `0 12px` | 692 | `.seg button` |  |
| `0 12px` | 8084 | `.fx-tree-head` |  |
| `0 12px` | 9320 | `.bd-carry` |  |
| `0 14px` | 792 | `.btn-ctrl.btn-text` |  |
| `0 14px` | 5131 | `.cal-views button` |  |
| `0 14px` | 6052 | `.jp-chip` |  |
| `0 14px` | 6740 | `.pr-run` |  |
| `0 14px` | 7565 | `.fx-tab` |  |
| `0 18px` | 6336 | `.jp-go` |  |
| `0 20px` | 7236 | `.pr-wgrid` |  |
| `0 20px var(--space-3)` | 1441 | `.dialog-body` |  |
| `0 2px` | 2920 | `.cm-select` |  |
| `0 2px` | 4908 | `.cal-dlg-title input` |  |
| `0 2px 1px` | 8649 | `.pchips-in` |  |
| `0 2px 2px` | 4120 | `.td-cal-head` |  |
| `0 3px` | 7722 | `.fx-crumb` |  |
| `0 3px` | 9488 | `.bd-stlist .bd-mi` |  |
| `0 3px 0 10px` | 603 | `.chip` |  |
| `0 3px 0 10px` | 649 | `.kind` |  |
| `0 4px` | 6640 | `.kb` |  |
| `0 4px` | 6693 | `.kb-wait` |  |
| `0 4px` | 7959 | `.fx-lock-s` |  |
| `0 4px` | 9068 | `.bd-rw > .bd-c:nth-child(2), .bd-rw > .bd-c:nth-child(9), .bd-rw > .bd-c:nth-child(11), .bd-rw > .bd-c:nth-child(12)` |  |
| `0 4px` | 9117 | `.bd-rw.edit > .bd-c, .bd-rw.new > .bd-c` |  |
| `0 4px 0 10px` | 3179 | `.cm-fpill-open` |  |
| `0 4px 0 6px` | 9282 | `.bd-stc` |  |
| `0 4px 32px 0` | 54 | `.brand` |  |
| `0 5px` | 2988 | `.cm-new .cell-input.num, .cm-edit .cell-input.num` |  |
| `0 5px` | 4756 | `.cal-num` |  |
| `0 5px` | 6519 | `.jp-sp` |  |
| `0 5px` | 7948 | `.fx-lock` |  |
| `0 6px` | 667 | `.kind-key` |  |
| `0 6px` | 944 | `.cell-input` |  |
| `0 6px` | 998 | `.pin-opt` |  |
| `0 6px` | 1252 | `.memo-add` |  |
| `0 6px` | 1326 | `.memo-row` |  |
| `0 6px` | 1831 | `.jday-in` |  |
| `0 6px` | 3125 | `.cm-hbtn` |  |
| `0 6px` | 3294 | `.cm-fdd-opt` |  |
| `0 6px` | 3669 | `.cm-spick-opt` |  |
| `0 6px` | 4006 | `.td-add-title` |  |
| `0 6px` | 4804 | `.cal-ev` |  |
| `0 6px` | 4877 | `.cal-more` |  |
| `0 6px` | 4984 | `.cal-select` |  |
| `0 6px` | 5574 | `.cal-kp-opt` |  |
| `0 6px` | 6456 | `.jp-kind` |  |
| `0 6px` | 6497 | `.jp-proj` |  |
| `0 6px` | 6948 | `.pr-d` |  |
| `0 6px` | 7609 | `.fx-target` |  |
| `0 6px` | 7709 | `.fx-crumbs` |  |
| `0 6px` | 8239 | `.fx-chip button + button` |  |
| `0 6px` | 8291 | `.fx-new` |  |
| `0 6px` | 9060 | `.bd-c.n` |  |
| `0 6px` | 9334 | `.bd-in` |  |
| `0 6px` | 9362 | `.bd-selk` |  |
| `0 6px 0 14px` | 9582 | `.bd-sumbar` |  |
| `0 6px 0 8px` | 5504 | `.cal-kp-btn` |  |
| `0 6px 1px` | 6683 | `.kb-cap` |  |
| `0 7px` | 2566 | `.tb-wide` |  |
| `0 7px` | 3957 | `.td-link-badge, .td-src` |  |
| `0 7px` | 4352 | `.td-due` |  |
| `0 8px` | 73 | `.side-item` |  |
| `0 8px` | 481 | `.input` |  |
| `0 8px` | 4074 | `.td-due-input` |  |
| `0 8px` | 7365 | `.pr-tpl` |  |
| `0 8px` | 7621 | `.fx-row1, .fx-row2` |  |
| `0 8px` | 7674 | `.fx-vb` |  |
| `0 8px` | 7756 | `.fx-mi` |  |
| `0 8px` | 7815 | `.fx-findband .fx-fk` |  |
| `0 8px` | 7853 | `.fx-col` |  |
| `0 8px` | 8232 | `.fx-chip button` |  |
| `0 8px` | 8809 | `.mod-tag` |  |
| `0 8px` | 8996 | `.bd-h` |  |
| `0 8px` | 9049 | `.bd-c` |  |
| `0 8px` | 9267 | `.bd-chip` |  |
| `0 8px 0 0` | 7839 | `.fx-hcell` |  |
| `0 8px 0 4px` | 1573 | `.jcal-title` |  |
| `0 8px 0 6px` | 8105 | `.fx-tr` |  |
| `0 9px` | 874 | `.pbadge` |  |
| `0 9px` | 3049 | `.cm-status` |  |
| `0 9px` | 5057 | `.cal-kbadge` |  |
| `0 var(--space-1)` | 920 | `.ct-new-row > div` |  |
| `0 var(--space-1)` | 3115 | `.cm-hcell.cm-hf` |  |
| `0 var(--space-2)` | 368 | `.field > input` |  |
| `0 var(--space-2)` | 2317 | `.jsp-btn` |  |
| `0 var(--space-2)` | 3215 | `.cm-fall` |  |
| `0 var(--space-2)` | 3275 | `.cm-fdd-search` |  |
| `0 var(--space-2)` | 3354 | `.cm-fdd-clear` |  |
| `0 var(--space-2)` | 3817 | `.td-list` |  |
| `0 var(--space-2)` | 4514 | `.cal-kind` |  |
| `0 var(--space-2) 0 var(--space-3)` | 4656 | `.cal-quick` |  |
| `0 var(--space-2) 6px` | 3806 | `.td-lists-head` |  |
| `0 var(--space-3)` | 434 | `.btn` |  |
| `0 var(--space-3)` | 768 | `.search` |  |
| `0 var(--space-3)` | 2337 | `.jbtn-add` |  |
| `0 var(--space-3)` | 2357 | `.jedit-foot .btn-primary.btn-xs` |  |
| `0 var(--space-3)` | 2405 | `.jonly` |  |
| `0 var(--space-3)` | 4639 | `.cal-nav .btn` |  |
| `0 var(--space-4)` | 383 | `.btn-primary` |  |
| `0 var(--space-4)` | 4422 | `.td-done-toggle` |  |
| `0 var(--space-4)` | 5003 | `.btn-primary.btn-ctrl` |  |
| `0 var(--space-4)` | 5034 | `.cal-cancel` |  |
| `5mm 5mm 15mm 25mm` | 6359 | `.jp-page` |  |
| `calc((var(--size-input) - 20px) / 2 - 1px) 6px calc((var(--size-input) - 20px) / 2 + 1px)` | 2307 | `.cell-input.jtalk` |  |
| `var(--space-1)` | 987 | `.pin-list` |  |
| `var(--space-1)` | 1316 | `.memo-lines` |  |
| `var(--space-1)` | 3657 | `.cm-spick-list` |  |
| `var(--space-1)` | 3752 | `.dmenu` |  |
| `var(--space-1)` | 5562 | `.cal-kp-list` |  |
| `var(--space-1) 0 6px` | 2431 | `.jsearch-date` |  |
| `var(--space-2)` | 4109 | `.td-cal` |  |
| `var(--space-2)` | 4222 | `.td-row` |  |
| `var(--space-2) 0 0` | 1949 | `.jtel` |  |
| `var(--space-2) 10px` | 1115 | `.ask-band` |  |
| `var(--space-2) 10px` | 4694 | `.cal-dow > div` |  |
| `var(--space-2) var(--space-3)` | 1509 | `.ask-wide` |  |
| `var(--space-2) var(--space-3)` | 3976 | `.td-add` |  |
| `var(--space-2) var(--space-3) var(--space-3)` | 1616 | `.jcal-body` |  |
| `var(--space-2) var(--space-4)` | 5629 | `.g-msg` |  |
| `var(--space-3)` | 5644 | `.g-box` |  |
| `var(--space-3)` | 6604 | `.keys-grid` |  |
| `var(--space-3) 0 6px` | 5039 | `.cal-kgroup` |  |
| `var(--space-3) 0 6px` | 5718 | `.mgr-label` |  |
| `var(--space-3) 0 var(--space-1)` | 1520 | `.padd` |  |
| `var(--space-3) 14px` | 1020 | `.ccard` |  |
| `var(--space-3) 14px` | 2492 | `.jn-aside-empty` |  |
| `var(--space-3) 20px` | 1452 | `.dialog-foot` |  |
| `var(--space-3) 20px var(--space-4)` | 4932 | `.cal-dlg-grid` |  |
| `var(--space-3) var(--space-4)` | 208 | `.card-head` |  |
| `var(--space-3) var(--space-4)` | 216 | `.card-body` |  |
| `var(--space-3) var(--space-4)` | 581 | `.group` |  |
| `var(--space-3) var(--space-4)` | 3936 | `.td-card-head` |  |
| `var(--space-3) var(--space-4) 10px` | 1989 | `.jhead` |  |
| `var(--space-3) var(--space-4) 14px` | 2037 | `.jlines` |  |
| `var(--space-3) var(--space-4) 14px` | 2518 | `.jmemo-main` |  |
| `var(--space-4)` | 238 | `.gate` |  |
| `var(--space-4)` | 1408 | `.overlay` |  |
| `var(--space-4)` | 5594 | `.about` |  |
| `var(--space-4) 14px` | 3110 | `.cm-empty` |  |
| `var(--space-4) 20px var(--space-2)` | 4902 | `.cal-dlg-title` |  |
| `var(--space-4) 20px var(--space-3)` | 1430 | `.dialog-head` |  |
| `var(--space-6)` | 6880 | `.pr-empty` |  |
| `var(--space-6) var(--space-2)` | 4405 | `.td-empty` |  |
| `var(--space-6) var(--space-4)` | 2461 | `.jsearch-none` |  |
| `var(--space-6) var(--space-7)` | 187 | `.main` |  |

### 부록 글자 크기 `font-size` — 전체 230곳 (값 순, 같은 값은 줄 순)

| 값 | app.css 줄 | 선택자 | @media |
|---|---|---|---|
| `10.5px` | 5369 | `.cal-cbtn` |  |
| `10.5px` | 6553 | `.jp-pfoot` |  |
| `11px` | 144 | `.side-kb` |  |
| `11px` | 1768 | `.jcal-mon-n` |  |
| `11px` | 1974 | `.jtel-note` |  |
| `11px` | 2194 | `.jproj-badge` |  |
| `11px` | 2511 | `.kind-fixed` |  |
| `11px` | 3593 | `.pin-hint` |  |
| `11px` | 3625 | `.cm-copy-note` |  |
| `11px` | 3680 | `.cm-spick-now` |  |
| `11px` | 3961 | `.td-link-badge, .td-src` |  |
| `11px` | 4155 | `.td-cal-week` |  |
| `11px` | 4867 | `.cal-ev-mark` |  |
| `11px` | 5295 | `.cal-wk-hours span` |  |
| `11px` | 6414 | `.jp-phead-me` |  |
| `11px` | 6458 | `.jp-kind` |  |
| `11px` | 6500 | `.jp-proj` |  |
| `11px` | 6521 | `.jp-sp` |  |
| `11px` | 6675 | `.kb-plus` |  |
| `11px` | 6952 | `.pr-d` |  |
| `11px` | 7613 | `.fx-target` |  |
| `11px` | 7775 | `.fx-k` |  |
| `11px` | 8295 | `.fx-new` |  |
| `11px` | 9540 | `.bd-kh` |  |
| `11.5px` | 746 | `.hint` |  |
| `11.5px` | 876 | `.pbadge` |  |
| `11.5px` | 925 | `.ct-new-row > .ct-new-tag` |  |
| `11.5px` | 1176 | `.cline-kind` |  |
| `11.5px` | 1190 | `.cline-note` |  |
| `11.5px` | 1631 | `.jcal-week span` |  |
| `11.5px` | 1721 | `.jcal-foot` |  |
| `11.5px` | 2059 | `.jsp` |  |
| `11.5px` | 2113 | `.jmenu-opt` |  |
| `11.5px` | 2320 | `.jsp-btn` |  |
| `11.5px` | 2910 | `.cm-new-tag` |  |
| `11.5px` | 3035 | `.cm-dday` |  |
| `11.5px` | 3051 | `.cm-status` |  |
| `11.5px` | 3586 | `.pin-sub` |  |
| `11.5px` | 4356 | `.td-due` |  |
| `11.5px` | 4381 | `.td-src-st` |  |
| `11.5px` | 4554 | `.cal-kind-note` |  |
| `11.5px` | 4790 | `.cal-hol` |  |
| `11.5px` | 4882 | `.cal-more` |  |
| `11.5px` | 5258 | `.cal-wk-alllabel` |  |
| `11.5px` | 6193 | `.jp-week` |  |
| `11.5px` | 6688 | `.kb-cap` |  |
| `11.5px` | 6934 | `.pr-lab` |  |
| `11.5px` | 6992 | `.pr-work` |  |
| `11.5px` | 7843 | `.fx-hcell` |  |
| `11.5px` | 8043 | `.fx-status` |  |
| `11.5px` | 8266 | `.fx-cf-cap` |  |
| `11.5px` | 8350 | `.fx-rn-hdr` |  |
| `11.5px` | 8592 | `.mgr-full` |  |
| `11.5px` | 9375 | `.bd-hint` |  |
| `11.5px` | 9452 | `.bd-mi-k` |  |
| `11.5px` | 9475 | `.bd-grp` |  |
| `12px` | 228 | `.small` |  |
| `12px` | 310 | `.gate-link` |  |
| `12px` | 331 | `.gate-note` |  |
| `12px` | 351 | `.gate-error` |  |
| `12px` | 362 | `.field > span` |  |
| `12px` | 671 | `.kind-key` |  |
| `12px` | 741 | `.note` |  |
| `12px` | 805 | `.btn-xs` |  |
| `12px` | 826 | `.ct-chips-label` |  |
| `12px` | 904 | `.ct-new-head` |  |
| `12px` | 1059 | `.ccard-role` |  |
| `12px` | 1257 | `.memo-add` |  |
| `12px` | 1392 | `.edit-grid` |  |
| `12px` | 1606 | `.jcal-today` |  |
| `12px` | 1823 | `.jday-f` |  |
| `12px` | 1937 | `.jkind` |  |
| `12px` | 1953 | `.jtel` |  |
| `12px` | 1999 | `.jrest` |  |
| `12px` | 2005 | `.jhead-tel` |  |
| `12px` | 2020 | `.jproj` |  |
| `12px` | 2263 | `.jwho-rest` |  |
| `12px` | 2270 | `.jwho-tel` |  |
| `12px` | 2455 | `.jsearch-arrow` |  |
| `12px` | 2568 | `.tb-wide` |  |
| `12px` | 2828 | `.cm-head` |  |
| `12px` | 3130 | `.cm-hbtn` |  |
| `12px` | 3262 | `.cm-fdd-head` |  |
| `12px` | 3320 | `.cm-fdd-n` |  |
| `12px` | 3430 | `.jn-due-d` |  |
| `12px` | 3448 | `.jn-due-s` |  |
| `12px` | 3807 | `.td-lists-head` |  |
| `12px` | 3862 | `.td-list-count` |  |
| `12px` | 3888 | `.dmenu-note` |  |
| `12px` | 3966 | `.td-card-count` |  |
| `12px` | 4179 | `.td-cal-day` |  |
| `12px` | 4494 | `.cal-side-head` |  |
| `12px` | 4596 | `.cal-up-when` |  |
| `12px` | 4604 | `.cal-up-empty` |  |
| `12px` | 4688 | `.cal-dow` |  |
| `12px` | 4809 | `.cal-ev` |  |
| `12px` | 4892 | `.cal-summary` |  |
| `12px` | 4937 | `.cal-dlg-label` |  |
| `12px` | 4993 | `.cal-dlg-sub` |  |
| `12px` | 5040 | `.cal-kgroup` |  |
| `12px` | 5059 | `.cal-kbadge` |  |
| `12px` | 5217 | `.cal-wday-name` |  |
| `12px` | 5488 | `.cal-notify-link` |  |
| `12px` | 5658 | `.g-box-sub` |  |
| `12px` | 5693 | `.mgr-info` |  |
| `12px` | 5719 | `.mgr-label` |  |
| `12px` | 5944 | `.xl-item-s` |  |
| `12px` | 6089 | `.jp-field-l` |  |
| `12px` | 6134 | `.jp-wd` |  |
| `12px` | 6296 | `.jp-legend` |  |
| `12px` | 6331 | `.jp-sum2` |  |
| `12px` | 6376 | `.jp-page, .jp-measure` |  |
| `12px` | 6595 | `.keys-status` |  |
| `12px` | 6694 | `.kb-wait` |  |
| `12px` | 6799 | `.pr-headrow` |  |
| `12px` | 6975 | `.pr-sub` |  |
| `12px` | 7038 | `.pr-next` |  |
| `12px` | 7073 | `.pr-sent` |  |
| `12px` | 7241 | `.pr-whead` |  |
| `12px` | 7322 | `.pr-tel` |  |
| `12px` | 7337 | `.pr-scope` |  |
| `12px` | 7370 | `.pr-tpl` |  |
| `12px` | 7422 | `.pr-hints` |  |
| `12px` | 7443 | `.pr-save` |  |
| `12px` | 7505 | `.fx-more` |  |
| `12px` | 7679 | `.fx-vb` |  |
| `12px` | 7712 | `.fx-crumbs` |  |
| `12px` | 7732 | `.fx-path-in` |  |
| `12px` | 7797 | `.fx-findband` |  |
| `12px` | 7810 | `.fx-fk` |  |
| `12px` | 8000 | `.fx-gcell` |  |
| `12px` | 8058 | `.fx-busy` |  |
| `12px` | 8063 | `.fx-toast` |  |
| `12px` | 8088 | `.fx-tree-head` |  |
| `12px` | 8118 | `.fx-tr-drive` |  |
| `12px` | 8236 | `.fx-chip button` |  |
| `12px` | 8278 | `.fx-cf-meta` |  |
| `12px` | 8283 | `.fx-cf-dir` |  |
| `12px` | 8300 | `.fx-cf-both` |  |
| `12px` | 8389 | `.fx-gt` |  |
| `12px` | 8394 | `.fx-lbl` |  |
| `12px` | 8471 | `.fx-rn-foot` |  |
| `12px` | 8609 | `.mgr-names-l` |  |
| `12px` | 8725 | `.set-sec span` |  |
| `12px` | 8813 | `.mod-tag` |  |
| `12px` | 8987 | `.bd-hd` |  |
| `12px` | 9270 | `.bd-chip` |  |
| `12px` | 9324 | `.bd-carry` |  |
| `12px` | 9371 | `.bd-auto` |  |
| `12px` | 9550 | `.bd-checks` |  |
| `12.5px` | 388 | `.btn-primary` |  |
| `12.5px` | 439 | `.btn` |  |
| `12.5px` | 607 | `.chip` |  |
| `12.5px` | 697 | `.seg button` |  |
| `12.5px` | 842 | `.pchip` |  |
| `12.5px` | 1119 | `.ask-band` |  |
| `12.5px` | 1219 | `.memo-view` |  |
| `12.5px` | 1347 | `.memo-row input` |  |
| `12.5px` | 2411 | `.jonly` |  |
| `12.5px` | 3170 | `.cm-fpill` |  |
| `12.5px` | 3185 | `.cm-fpill-open` |  |
| `12.5px` | 3219 | `.cm-fall` |  |
| `12.5px` | 3226 | `.cm-fcount` |  |
| `12.5px` | 3359 | `.cm-fdd-clear` |  |
| `12.5px` | 3908 | `.td-summary` |  |
| `12.5px` | 4081 | `.td-due-input` |  |
| `12.5px` | 4332 | `.td-detail` |  |
| `12.5px` | 4407 | `.td-empty` |  |
| `12.5px` | 4426 | `.td-done-toggle` |  |
| `12.5px` | 6057 | `.jp-chip` |  |
| `12.5px` | 6632 | `.keys-label` |  |
| `12.5px` | 7118 | `.pr-foot` |  |
| `12.5px` | 7158 | `.pr-opt, .pr-copt` |  |
| `12.5px` | 7665 | `.fx-filter` |  |
| `12.5px` | 7761 | `.fx-mi` |  |
| `12.5px` | 7876 | `.fx-frow` |  |
| `12.5px` | 7929 | `.fx-inline` |  |
| `12.5px` | 7975 | `.fx-brow` |  |
| `12.5px` | 8107 | `.fx-tr` |  |
| `12.5px` | 8177 | `.fx-findpanel` |  |
| `12.5px` | 8201 | `.fx-ck` |  |
| `12.5px` | 8339 | `.fx-rn-row` |  |
| `12.5px` | 8386 | `.fx-grp .input` |  |
| `12.5px` | 8687 | `.pin-new` |  |
| `12.5px` | 8908 | `.bd-unit button` |  |
| `12.5px` | 9367 | `.bd-selk` |  |
| `13px` | 295 | `.gate-open` |  |
| `13px` | 1292 | `.tb` |  |
| `13px` | 4125 | `.td-cal-title` |  |
| `13px` | 8719 | `.set-sec` |  |
| `13px` | 9256 | `.bd-dc` |  |
| `13px` | 9408 | `.bd-pop` |  |
| `13px` | 9564 | `.bd-toast` |  |
| `13px` | 9587 | `.bd-sumbar` |  |
| `13.5px` | 1755 | `.jcal-mon` |  |
| `13.5px` | 7205 | `.pr-ask-t` |  |
| `13.5px` | 7643 | `.fx-drv` |  |
| `14px` | 1994 | `.jname` |  |
| `14px` | 2445 | `.jsearch-go` |  |
| `14px` | 3397 | `.cm-memo-body .memo-row input` |  |
| `14px` | 6186 | `.jp-mtitle` |  |
| `14px` | 8884 | `.bd-year b` |  |
| `14px` | 9086 | `.bd-rw.pj .bd-nm` |  |
| `14.5px` | 211 | `.card-head` |  |
| `14.5px` | 1054 | `.ccard-n` |  |
| `14.5px` | 2398 | `.jsearch-title` |  |
| `14.5px` | 2486 | `.jn-aside-title` |  |
| `14.5px` | 3945 | `.td-card-name` |  |
| `14.5px` | 7570 | `.fx-tab` |  |
| `15px` | 1578 | `.jcal-title` |  |
| `15px` | 2664 | `.rte-area h3, .rte-view h3` |  |
| `15px` | 9388 | `.bd-empty b` |  |
| `16px` | 1434 | `.dialog-title` |  |
| `17px` | 1930 | `.jtime` |  |
| `17px` | 5961 | `.xl-ask-title` |  |
| `17px` | 6013 | `.jp-title` |  |
| `18px` | 6394 | `.jp-phead h1` |  |
| `19px` | 4915 | `.cal-dlg-title input` |  |
| `22px` | 193 | `.title` |  |
| `var(--fs)` | 17 | `body` |  |
| `var(--fs)` | 799 | `.btn-ctrl` |  |
| `var(--fs)` | 1397 | `.edit-grid .cell-input` |  |
| `var(--fs)` | 1659 | `.jcal-day` |  |
| `var(--fs)` | 1837 | `.jday-in` |  |
| `var(--fs)` | 3246 | `.cm-fdd` |  |
| `var(--fs)` | 3822 | `.td-list` |  |
| `var(--fs)` | 4456 | `.td-edit .bl-ed, .td-add-form .bl-ed` |  |
| `var(--fs)` | 4519 | `.cal-kind` |  |
| `var(--fs)` | 4641 | `.cal-nav .btn` |  |
| `var(--fs)` | 5005 | `.btn-primary.btn-ctrl` |  |

### 부록 줄 높이 `line-height` — 전체 36곳 (값 순, 같은 값은 줄 순)

| 값 | app.css 줄 | 선택자 | @media |
|---|---|---|---|
| `14px` | 6554 | `.jp-pfoot` |  |
| `15px` | 6501 | `.jp-proj` |  |
| `16px` | 6246 | `.jp-day > span:first-child` |  |
| `16px` | 6993 | `.pr-work` |  |
| `17px` | 6377 | `.jp-page, .jp-measure` |  |
| `17px` | 6460 | `.jp-kind` |  |
| `17px` | 6523 | `.jp-sp` |  |
| `17px` | 7916 | `.fx-nm` |  |
| `18px` | 2306 | `.cell-input.jtalk` |  |
| `18px` | 6543 | `.jp-memo` |  |
| `18px` | 9552 | `.bd-checks` |  |
| `20px` | 5968 | `.xl-ask-path` |  |
| `20px` | 9499 | `.bd-confirm p` |  |
| `22px` | 2075 | `.jline-t` |  |
| `24px` | 5962 | `.xl-ask-title` |  |
| `24px` | 6014 | `.jp-title` |  |
| `24px` | 6395 | `.jp-phead h1` |  |
| `32px` | 8885 | `.bd-year b` |  |
| `round(1.25em, 1px)` | 2196 | `.jproj-badge` |  |
| `round(1.2em, 1px)` | 1661 | `.jcal-day` |  |
| `round(1.2em, 1px)` | 1933 | `.jtime` |  |
| `round(1.2em, 1px)` | 2115 | `.jmenu-opt` |  |
| `round(1.35em, 1px)` | 5316 | `.cal-wk-col .cal-ev` |  |
| `round(1.3em, 1px)` | 1956 | `.jtel` |  |
| `round(1.3em, 1px)` | 8593 | `.mgr-full` |  |
| `round(1.42em, 1px)` | 332 | `.gate-note` |  |
| `round(1.45em, 1px)` | 2929 | `.cm-area` |  |
| `round(1.4em, 1px)` | 18 | `body` |  |
| `round(1.55em, 1px)` | 2629 | `.rte-area` |  |
| `round(1.55em, 1px)` | 2783 | `.rte-view` |  |
| `round(1.5em, 1px)` | 1234 | `.memo-line` |  |
| `round(1.5em, 1px)` | 3024 | `.cm-bt` |  |
| `round(1.5em, 1px)` | 3518 | `.bl-t` |  |
| `round(1.5em, 1px)` | 3553 | `.bl-ta` |  |
| `round(1.5em, 1px)` | 5638 | `.g-foot` |  |
| `var(--size-input)` | 3371 | `.cm-new > .cm-area-auto, .cm-edit > .cm-area-auto` |  |

### 부록 사이 간격 `gap` — 전체 293곳 (값 순, 같은 값은 줄 순)

| 값 | app.css 줄 | 선택자 | @media |
|---|---|---|---|
| `1px` | 7301 | `.pr-agent` |  |
| `2px` | 65 | `.side-list` |  |
| `2px` | 540 | `.row-text` |  |
| `2px` | 601 | `.chip` |  |
| `2px` | 986 | `.pin-list` |  |
| `2px` | 1031 | `.ccard-band` |  |
| `2px` | 1070 | `.ccard-tools` |  |
| `2px` | 1147 | `.ccard-lines` |  |
| `2px` | 1315 | `.memo-lines` |  |
| `2px` | 1645 | `.jcal-grid` |  |
| `2px` | 1749 | `.jcal-mon` |  |
| `2px` | 1922 | `.jpillar` |  |
| `2px var(--space-2)` | 1988 | `.jhead` |  |
| `2px` | 2557 | `.rte-bar` |  |
| `2px 10px` | 3410 | `.jn-due-item` |  |
| `2px` | 3574 | `.memo-view .bl-list` |  |
| `2px` | 3656 | `.cm-spick-list` |  |
| `2px` | 3751 | `.dmenu` |  |
| `2px` | 4151 | `.td-cal-week, .td-cal-grid` |  |
| `2px` | 4484 | `.cal-upcoming` |  |
| `2px` | 5561 | `.cal-kp-list` |  |
| `2px` | 5913 | `.xl-menu` |  |
| `2px` | 5925 | `.xl-item` |  |
| `2px` | 6237 | `.jp-day` |  |
| `2px` | 6319 | `.jp-sum` |  |
| `2px` | 6611 | `.keys-box` |  |
| `2px` | 6970 | `.pr-place, .pr-sum` |  |
| `2px` | 7708 | `.fx-crumbs` |  |
| `2px` | 8658 | `.pbadge.pchip-b` |  |
| `2px` | 8896 | `.bd-unit` |  |
| `2px` | 9360 | `.bd-selk` |  |
| `2px` | 9482 | `.bd-stlist` |  |
| `3px` | 1212 | `.memo-view` |  |
| `3px` | 2285 | `.jlines-in` |  |
| `3px` | 2598 | `.rte-grid-cells` |  |
| `3px` | 3003 | `.cm-bullets` |  |
| `3px` | 3469 | `.bl-list` |  |
| `3px` | 6644 | `.kb` |  |
| `3px` | 6671 | `.kb-part` |  |
| `3px` | 8575 | `.mgr .pj-mname` |  |
| `3px` | 9265 | `.bd-chip` |  |
| `4px` | 635 | `.chip-add` |  |
| `4px` | 1652 | `.jcal-day` |  |
| `4px` | 2567 | `.tb-wide` |  |
| `4px` | 4106 | `.td-cal` |  |
| `4px` | 4119 | `.td-cal-head` |  |
| `4px` | 4301 | `.td-row-main` |  |
| `4px` | 4504 | `.cal-manage` |  |
| `4px` | 5092 | `.cal-daylist` |  |
| `4px 6px` | 5209 | `.cal-wday` |  |
| `4px` | 5781 | `.cm-bullets` |  |
| `4px` | 6044 | `.jp-chips` |  |
| `4px` | 6085 | `.jp-field` |  |
| `4px 14px` | 6403 | `.jp-phead-items` |  |
| `4px` | 6507 | `.jp-lines` |  |
| `4px` | 7349 | `.pr-agent-in` |  |
| `4px` | 7420 | `.pr-hints` |  |
| `4px` | 7553 | `.fx-tabs` |  |
| `4px` | 7990 | `.fx-grid` |  |
| `4px` | 8629 | `.pchips` |  |
| `5px` | 1729 | `.jcal-legend` |  |
| `5px` | 4800 | `.cal-ev` |  |
| `5px` | 5431 | `.cal-holbtn` |  |
| `5px` | 6303 | `.jp-legend-i` |  |
| `5px` | 7069 | `.pr-sent` |  |
| `5px` | 7308 | `.pr-agent-name` |  |
| `5px` | 7637 | `.fx-drv` |  |
| `5px` | 8199 | `.fx-ck` |  |
| `6px` | 432 | `.btn` |  |
| `6px` | 462 | `.btn-sm` |  |
| `6px` | 595 | `.chips` |  |
| `6px` | 641 | `.kinds` |  |
| `6px` | 647 | `.kind` |  |
| `6px` | 678 | `.kind-add` |  |
| `6px` | 821 | `.ct-chips` |  |
| `6px` | 834 | `.pchip` |  |
| `6px` | 1141 | `.ccard-projs` |  |
| `6px var(--space-2)` | 1391 | `.edit-grid` |  |
| `6px` | 1475 | `.swatches` |  |
| `6px` | 1570 | `.jcal-title` |  |
| `6px` | 1740 | `.jcal-months` |  |
| `6px` | 2036 | `.jlines` |  |
| `6px` | 2170 | `.jcard-new > .jpillar` |  |
| `6px` | 2204 | `.jnew-main` |  |
| `6px` | 2335 | `.jbtn-add` |  |
| `6px` | 3047 | `.cm-status` |  |
| `6px` | 3177 | `.cm-fpill-open` |  |
| `6px` | 3276 | `.cm-fdd-search` |  |
| `6px` | 3601 | `.cm-copy` |  |
| `6px` | 3705 | `.cpick-btn` |  |
| `6px` | 3894 | `.td-rename` |  |
| `6px` | 3975 | `.td-add` |  |
| `6px` | 4040 | `.td-add-form` |  |
| `6px` | 4048 | `.td-due-row` |  |
| `6px` | 4307 | `.td-row-title` |  |
| `6px` | 4344 | `.td-badges` |  |
| `6px` | 4350 | `.td-due` |  |
| `6px` | 4389 | `.td-row-acts` |  |
| `6px` | 4745 | `.cal-dhead` |  |
| `6px` | 4951 | `.cal-dlg-line` |  |
| `6px 8px` | 5427 | `.cal-holrow` |  |
| `6px` | 5733 | `.mgr-add` |  |
| `6px` | 5897 | `.xl-btn` |  |
| `6px` | 5996 | `.jn-print` |  |
| `6px` | 6178 | `.jp-month` |  |
| `6px` | 6446 | `.jp-chead` |  |
| `6px` | 6513 | `.jp-line` |  |
| `6px` | 6910 | `.pr-date` |  |
| `6px` | 6941 | `.pr-due` |  |
| `6px` | 7026 | `.pr-acts` |  |
| `6px` | 7213 | `.pr-ask-btns` |  |
| `6px` | 7361 | `.pr-tpl` |  |
| `6px` | 7449 | `.proc-signer, .proc-dir` |  |
| `6px` | 7620 | `.fx-row1, .fx-row2` |  |
| `6px` | 7673 | `.fx-vb` |  |
| `6px` | 7803 | `.fx-fk` |  |
| `6px` | 7906 | `.fx-ncell` |  |
| `6px` | 7996 | `.fx-gcell` |  |
| `6px` | 8049 | `.fx-keys` |  |
| `6px` | 8191 | `.fx-hrow` |  |
| `6px` | 8221 | `.fx-saved` |  |
| `6px` | 8404 | `.fx-rn-pat` |  |
| `6px` | 8410 | `.fx-rn-case` |  |
| `6px` | 8416 | `.fx-rn-fr` |  |
| `6px 12px` | 8422 | `.fx-rn-cks` |  |
| `6px` | 8427 | `.fx-rn-num` |  |
| `6px` | 8503 | `.fx-set-drives` |  |
| `6px` | 8523 | `.fx-set-dir` |  |
| `6px var(--space-2)` | 8604 | `.mgr-names` |  |
| `6px` | 8685 | `.pin-new` |  |
| `6px` | 9545 | `.bd-mbtns` |  |
| `7px` | 1233 | `.memo-line` |  |
| `7px` | 1325 | `.memo-row` |  |
| `7px` | 3010 | `.cm-bullet` |  |
| `7px` | 5501 | `.cal-kp-btn` |  |
| `7px` | 7274 | `.pr-wname` |  |
| `7px` | 7562 | `.fx-tab` |  |
| `8px` | 71 | `.side-item` |  |
| `8px` | 3731 | `.cpick-grid` |  |
| `8px 4px` | 5065 | `.cal-swatches` |  |
| `8px` | 5405 | `.cal-cgrid` |  |
| `8px` | 5472 | `.cal-notify-body` |  |
| `8px` | 5572 | `.cal-kp-opt` |  |
| `8px` | 5600 | `.about-text` |  |
| `8px` | 5955 | `.xl-ask-body` |  |
| `8px` | 6352 | `.jp-measure` |  |
| `8px` | 6431 | `.jp-col` |  |
| `8px` | 6732 | `.pr-fetch` |  |
| `8px` | 7150 | `.pr-opt, .pr-copt` |  |
| `8px` | 7195 | `.pr-ask` |  |
| `8px` | 7234 | `.pr-wgrid` |  |
| `8px` | 7470 | `.fx-top` |  |
| `8px` | 7753 | `.fx-mi` |  |
| `8px` | 7791 | `.fx-findband` |  |
| `8px` | 7972 | `.fx-brow` |  |
| `8px` | 8057 | `.fx-busy` |  |
| `8px` | 8182 | `.fx-fgrid` |  |
| `8px` | 8214 | `.fx-ffoot` |  |
| `8px` | 8260 | `.fx-cf-card` |  |
| `8px` | 8309 | `.fx-cf-foot` |  |
| `8px` | 8316 | `.fx-gap` |  |
| `8px` | 8379 | `.fx-grp` |  |
| `8px` | 8458 | `.fx-rn-side` |  |
| `8px` | 8782 | `.mod-head` |  |
| `8px` | 9418 | `.bd-mi` |  |
| `8px` | 9504 | `.bd-crow` |  |
| `8px` | 9536 | `.bd-mrow` |  |
| `10px` | 1134 | `.ccard-body` |  |
| `10px` | 1153 | `.cline` |  |
| `10px` | 1717 | `.jcal-foot` |  |
| `10px` | 2043 | `.jline` |  |
| `10px` | 3815 | `.td-list` |  |
| `10px` | 4221 | `.td-row` |  |
| `10px` | 4512 | `.cal-kind` |  |
| `10px var(--space-3)` | 4931 | `.cal-dlg-grid` |  |
| `10px` | 5394 | `.cal-cpop` |  |
| `10px` | 6362 | `.jp-page` |  |
| `10px` | 6603 | `.keys-grid` |  |
| `10px` | 7117 | `.pr-foot` |  |
| `10px` | 8037 | `.fx-status` |  |
| `10px` | 8176 | `.fx-findpanel` |  |
| `10px` | 8247 | `.fx-cf-head` |  |
| `10px` | 8252 | `.fx-cf-cards` |  |
| `10px` | 8277 | `.fx-cf-meta` |  |
| `10px` | 8335 | `.fx-rn-row` |  |
| `10px` | 8469 | `.fx-rn-foot` |  |
| `10px` | 8716 | `.set-sec` |  |
| `10px` | 9392 | `.bd-empty-bs` |  |
| `12px` | 7530 | `.fx-panes` |  |
| `12px` | 8323 | `.fx-rn-head` |  |
| `12px` | 8368 | `.fx-rn-grid` |  |
| `12px` | 8374 | `.fx-rn-col` |  |
| `14px` | 263 | `.gate-brand` |  |
| `14px` | 3030 | `.cm-due` |  |
| `14px` | 6294 | `.jp-legend` |  |
| `14px` | 7463 | `.fx-root` |  |
| `14px` | 8849 | `.bd` |  |
| `14px` | 9580 | `.bd-sumbar` |  |
| `16px` | 6387 | `.jp-phead` |  |
| `16px` | 6424 | `.jp-cols` |  |
| `16px` | 9383 | `.bd-empty` |  |
| `20px` | 6142 | `.jp-cal` |  |
| `0` | 3565 | `.memo-row` |  |
| `var(--space-1)` | 358 | `.field` |  |
| `var(--space-1)` | 1278 | `.memo-bar` |  |
| `var(--space-1)` | 1354 | `.memo-foot, .edit-foot` |  |
| `var(--space-1)` | 1429 | `.dialog-head` |  |
| `var(--space-1)` | 1561 | `.jcal-head` |  |
| `var(--space-1)` | 2162 | `.jcard-new > .jpillar, .jcard-edit > .jpillar` |  |
| `var(--space-1)` | 3122 | `.cm-hbtn` |  |
| `var(--space-1)` | 3802 | `.td-lists` |  |
| `var(--space-1)` | 3869 | `.td-newlist` |  |
| `var(--space-1)` | 4480 | `.cal-kinds, .cal-upcoming` |  |
| `var(--space-1)` | 4632 | `.cal-nav` |  |
| `var(--space-2)` | 426 | `.ask-row` |  |
| `var(--space-2)` | 580 | `.group` |  |
| `var(--space-2)` | 588 | `.group-head` |  |
| `var(--space-2)` | 722 | `.pw-foot` |  |
| `var(--space-2)` | 754 | `.ct-head` |  |
| `var(--space-2)` | 764 | `.search` |  |
| `var(--space-2)` | 1019 | `.ccard` |  |
| `var(--space-2)` | 1041 | `.ccard-top` |  |
| `var(--space-2)` | 1113 | `.ask-band` |  |
| `var(--space-2)` | 1199 | `.ccard-memo` |  |
| `var(--space-2)` | 1272 | `.memo-ed` |  |
| `var(--space-2)` | 1367 | `.edit-foot` |  |
| `var(--space-2)` | 1380 | `.edit-pair` |  |
| `var(--space-2)` | 1519 | `.padd` |  |
| `var(--space-2)` | 1795 | `.jn-head` |  |
| `var(--space-2)` | 1822 | `.jday-f` |  |
| `var(--space-2)` | 2105 | `.jmenu-opt` |  |
| `var(--space-2)` | 2212 | `.jnew-top` |  |
| `var(--space-2)` | 2254 | `.jwho-opt` |  |
| `var(--space-2)` | 2277 | `.jnew-bottom` |  |
| `var(--space-2)` | 2291 | `.jline-in` |  |
| `var(--space-2)` | 2344 | `.jedit-foot` |  |
| `var(--space-2)` | 2430 | `.jsearch-date` |  |
| `var(--space-2)` | 2438 | `.jsearch-go` |  |
| `var(--space-2)` | 2479 | `.jn-aside-head` |  |
| `var(--space-2)` | 2522 | `.jcard-memo .jnew-main` |  |
| `var(--space-2)` | 2528 | `.jmemo-foot` |  |
| `var(--space-2)` | 3092 | `.cm-edit-foot` |  |
| `var(--space-2)` | 3239 | `.cm-fdd` |  |
| `var(--space-2)` | 3292 | `.cm-fdd-opt` |  |
| `var(--space-2)` | 3384 | `.cm-memo-head` |  |
| `var(--space-2)` | 3581 | `.pin-place` |  |
| `var(--space-2)` | 3667 | `.cm-spick-opt` |  |
| `var(--space-2)` | 3720 | `.cpick-pop` |  |
| `var(--space-2)` | 3935 | `.td-card-head` |  |
| `var(--space-2)` | 3994 | `.td-add-line` |  |
| `var(--space-2)` | 4420 | `.td-done-toggle` |  |
| `var(--space-2)` | 4561 | `.cal-up` |  |
| `var(--space-2)` | 4621 | `.cal-head` |  |
| `var(--space-2)` | 4654 | `.cal-quick` |  |
| `var(--space-2)` | 5021 | `.cal-dlg-foot` |  |
| `var(--space-2)` | 5050 | `.cal-krow-name` |  |
| `var(--space-2)` | 5102 | `.cal-daydlg .dialog-foot` |  |
| `var(--space-2)` | 5643 | `.g-box` |  |
| `var(--space-2)` | 5652 | `.g-box-head` |  |
| `var(--space-2)` | 5689 | `.mgr-name` |  |
| `var(--space-2)` | 5717 | `.mgr-label` |  |
| `var(--space-2)` | 5975 | `.xl-ask-foot` |  |
| `var(--space-2)` | 6101 | `.jp-field-box` |  |
| `var(--space-2)` | 6309 | `.jp-foot` |  |
| `var(--space-2)` | 6625 | `.keys-row` |  |
| `var(--space-2)` | 8581 | `.mgr-badge-line` |  |
| `var(--space-2)` | 8856 | `.bd-top` |  |
| `var(--space-2) 20px` | 1812 | `.jday` |  |
| `var(--space-2) var(--space-3)` | 413 | `.title-row` |  |
| `var(--space-2) var(--space-3)` | 512 | `.row` |  |
| `var(--space-2) var(--space-3)` | 2390 | `.jsearch-bar` |  |
| `var(--space-3)` | 711 | `.pw-form` |  |
| `var(--space-3)` | 1013 | `.ct-grid` |  |
| `var(--space-3)` | 1461 | `.prow` |  |
| `var(--space-3)` | 1879 | `.jn-cols` |  |
| `var(--space-3)` | 2383 | `.jsearch` |  |
| `var(--space-3)` | 2424 | `.jsearch-day` |  |
| `var(--space-3)` | 6037 | `.jp-top` |  |
| `var(--space-3)` | 6588 | `.keys-head` |  |
| `var(--space-3)` | 6720 | `.pr` |  |
| `var(--space-3)` | 6738 | `.pr-run` |  |
| `var(--space-3)` | 7228 | `.pr-works-head` |  |
| `var(--space-4)` | 186 | `.main` |  |
| `var(--space-4)` | 1546 | `.jn-left` |  |
| `var(--space-4)` | 1788 | `.jn-body` |  |
| `var(--space-4)` | 3904 | `.td-body` |  |
| `var(--space-4)` | 3916 | `.td-cards` |  |
| `var(--space-4)` | 4614 | `.cal-body` |  |
| `var(--space-4)` | 5593 | `.about` |  |
| `var(--space-6)` | 1538 | `.jn` |  |
| `var(--space-6)` | 3792 | `.td-screen` |  |
| `var(--space-6)` | 4463 | `.cal-screen` |  |
| `var(--space-6)` | 4473 | `.cal-side` |  |
