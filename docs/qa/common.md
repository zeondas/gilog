# 공통 세션 검토 (2026-10-25, main 082f171)

사용자 요청(2026-10-25 19:36) 일곱 건. 검토 단계라 코드는 안 고쳤어요. 승인되면 CLAUDE.md 대기 목록 "### 공통"에 ✔로 적어요.
코딩 가지: `wip/settings2`(①②⑤⑥) · `wip/installer`(③④) · `wip/google-one`(⑦).

## ① 설정 칸이 영문부터 – 원인 찾음(ⓐ)

규칙(결정 로그 10-18 08:10): 영문이 처음 값인 칸은 메일·암호·`data-ime="en"`만.
`src/ime.ts`의 `isTextField`·`wantsEnglish`는 규칙대로예요(ⓑ 고르기·숫자 칸은 입력기와 상관없음, ⓒ `focusin`은 클릭·Ctrl+F 모두 옴).
원인은 **설정 화면에서 `data-ime="en"`이 붙은 칸 중 규칙상 한글이어야 할 칸**이에요.

| 칸 | 지금 | 규칙 | 고침 |
| --- | --- | --- | --- |
| 민원처리 › 민원 폴더·가져올 폴더·다운로드 폴더·보낼 폴더(1768줄, `PROCESS_DIRS` 네 칸) | en | 폴더 경로 = 한글 | en 뗌 |
| 민원처리 › Claude 실행 파일(1787줄) | en | 경로 = 한글 | en 뗌(대개 "claude" 그대로라 물어봄) |
| 민원대장 › 주소정보누리집 승인키(1645줄) | en | 승인키 = 영문 | 그대로 |
| 집행현황 › 구글 메일·공유 시트 주소(BudgetShareCard) | en | 메일·주소 = 영문 | 그대로 |
| 그 밖의 설정 칸(내 이름·구분·목록 추가·새 탭 폴더·메일 제목/본문·찾기) | 한글 | 한글 | – |

## ② 엑셀 가져오기 – 합치기 / 전부 바꾸기

지금: `src/ExcelMenu.tsx` 한 번 묻고 늘 **더하기**(민원 = 새 연번으로 모두 더함 → 같은 파일을 두 번 가져오면 두 벌, 연락처 = 이름·소속·무선 같으면 프로젝트만 붙임, 일지 = 같은 기록 건너뜀).
그림 `common/excel_import.png`. 고르기·붉은 띠는 `ExcelMenu`에, "같은 것"으로 덮는 일은 각 화면 `onImport(rows, mode)` + core.

| 화면 | 같은 것 | 합치기 때 | core 손볼 곳 |
| --- | --- | --- | --- |
| 민원대장 | 연번 `no` | 같은 연번은 덮음, 연번 없거나 새 연번은 더함 | `import_complaints`에 mode·연번 유지 |
| 업무연락처 | 이름 + 소속 + 무선(지금 `same_person`) | 칸을 파일 값으로 덮음(지금은 프로젝트만) | `import_contacts` |
| 업무일지 | 날짜 + 시각 + 상대 | 덮음(지금은 건너뜀) | 화면 `journalImports` |

전부 바꾸기 = 한 트랜잭션에서 지우고 넣기(실패하면 아무것도 안 바뀜). 집행현황·예산현황 엑셀(`budgetExcel.ts`)은 범위 밖.

## ③ 설치 화면

지금 `tauri.conf.json` nsis: `installMode: currentUser`·`languages: Korean`만. Tauri 기본 틀에 이미 환영·설치 위치·마침(바탕화면 바로 가기·실행 체크)이 있어요 – **빠진 것은 그림·아이콘·문구**.
그림 `common/installer.png`, 실제 BMP `common/installer-header.bmp`(150×57)·`installer-sidebar.bmp`(164×314) — 원본 `installer-images.html`.

| 설정 | 필요 | 비고 |
| --- | --- | --- |
| `headerImage` / `sidebarImage` | ✔ | 위 BMP를 `src-tauri/installer/`에 |
| `installerIcon` | ✔ | `icons/icon.ico` |
| `customLanguageFiles.Korean` | ✔ | 문구 다듬기(.nsh) |
| `installerHooks` | ✔(④) | .nsh 하나 |
| `license` | ✗ | NsisConfig에 없음(번들 공통 `licenseFile`) — 안 씀 |
| `template` | ✗ | 2안(진행 글)일 때만 |

Cargo 변경 없음. 빌드 세션에 "설치 파일 모양 바뀜" 전달.

## ④ 제거 때 자료도 지우기

Tauri 제거기에는 이미 "앱 데이터 삭제" 체크(`$DeleteAppDataCheckboxState`, 처음 꺼짐)가 있고, 켜면 `%APPDATA%\kr.gilog.app`(prefs.json·window.json·pin.bin·roadaddr.txt·강조 아이콘)·`%LOCALAPPDATA%\kr.gilog.app`(WebView2 자료)를 지워요. 시작 프로그램(HKCU Run "giLog")은 체크와 상관없이 지워요(업데이트 때 빼고).
**빠진 것: 문서\giLog(gilog.db·백업)와 자격 증명("giLog" data-key).**
→ `installerHooks`의 `NSIS_HOOK_PREUNINSTALL`에서 체크가 켜졌고 `$UpdateMode <> 1`이면 확인 창(MB_YESNO, 아니요 = 체크 끔), `NSIS_HOOK_POSTUNINSTALL`에서 `RMDir /r "$DOCUMENTS\giLog"` + `cmdkey /delete`(keyring 대상 이름은 윈도우에서 확인). 체크 문구는 Korean .nsh로 "기록 자료도 지우기 …". 민원 폴더는 안 지움.
주의: 앱이 켜져 있으면 gilog.db가 잠겨 있어요 — Tauri 제거기는 먼저 앱을 끄게 해요(확인 필요).

## ⑤ 구글 연동 카드 → 캘린더 쪽

그림 `common/google_card.png`. 1안 설정 "캘린더" 모듈 카드 안(쉬는 날 음영 아래 "구글 연동" 머리글), 2안 캘린더 관리 창 탭.
1안이면 `GoogleCard` 몸통을 `ModuleCard id="calendar"` 안으로 옮기고 `data-k="구글 캘린더 연동 할 일"`로 찾기 유지. 캘린더 모듈을 끄면 카드가 접혀요(구글 맞추기는 그대로 돎 — 끄면 멈출지 물음).

## ⑥ 잠그기 단축키

`keys.ts` `KEY_GROUPS`는 지금 입력 칸 키만(Enter·Tab·Esc + Shift/Ctrl/왼Alt, `KEY_HINT`). 잠그기는 글자 키(L)가 필요해 **고르기 허용 키를 넓혀야** 해요(이 줄만 Ctrl/Alt + 글자). App.tsx 창 keydown(capture)에서 `lockNow()`, 조합 중(`isComposing`)·잠금 화면이면 무시, `preventDefault`로 WebView 기본 Ctrl+L 막음. 2안 윈도우 전역 단축키(`tauri-plugin-global-shortcut` — Cargo 바뀜, 다른 앱 Ctrl+L(브라우저 주소창)과 부딪힘).

## ⑦ 두 PC 구글 섞임

원인: `src/google.ts` `runSync`의 full 맞추기(843~856줄)가 "giLog 캘린더에 있는데 내 `state.items`에 없는 것은 지움" — PC마다 DB·state가 따로라 서로의 일정을 지우고 다시 보내요. 더 나쁜 점: 일정에 붙인 이름표 `e12`·`c5`·`t3`은 **PC마다 따로 매긴 번호**라, 회사 PC의 `e12`를 집 PC가 자기 `e12`로 알고 내용을 덮어써요(848줄 `r.key`). 할 일 목록도 같은 구조(`titems`). 그래서 2안(꼬리표)은 이름표에 PC 표시를 붙여야 해요.
정리 순서(지금 섞인 시험 자료): 한 PC에서 설정 › 구글 › 연결 끊기 › **일정도 지우기** → 다른 PC도 연결 끊기(일정은 두기) → 보낼 PC 하나만 다시 연결.

## 결정 (2026-10-25 20:01 사용자)

| 건 | 결정 |
| --- | --- |
| ① | 2안 – 폴더 네 칸만 한글, Claude 실행 파일은 영문 그대로 → ✔1 |
| ② | 3안 – 파일을 고르면 "덮어쓰기 / 대체하기" 고르는 별도 창(그림 `common/excel_import2.png`) – 시안 확인 기다림 |
| ③ | 시안으로 확인 – 설치 중 화면 1안/2안 그림 `common/installer_progress.png` |
| ④ | 1안 → ✔2 |
| ⑤ | 1안 → ✔3 |
| ⑥ | 1안 → ✔4 |
| ⑦ | 현행 유지 |

## ③ 설치 화면 다시 (2026-10-25 20:09 – 크롬식 레퍼런스)

참고: 크롬(작은 창 하나·가운데 로고·"설치하는 중" 한 줄·얇은 진행 막대·고를 것 없음·끝나면 저절로 열림), 디스코드·슬랙(Squirrel – 질문 없이 내 폴더에 설치·브랜드 그림 하나·끝나면 실행). 그림 `common/installer_oneclick.png` – 설치 중 / 마침(2초 뒤 열림) / 제거 확인 / 자료도 지우기 붉은 띠 / 어둡게.
만드는 방식: 1안 Tauri 기본 틀 + 그림(`installer.png`) · 2안 Tauri 설치 틀(`template` .nsi)을 복사해 쪽을 하나로(nsDialogs 흰 바탕·아이콘·글·진행 막대, 단추 숨김, 끝나면 실행) · 3안 기록이 직접 그린 작은 설치 창이 NSIS를 조용히(`/S`) 돌림.
