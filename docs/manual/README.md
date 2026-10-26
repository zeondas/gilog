# 기록 사용자 매뉴얼 – 정한 것 (매뉴얼 세션)

2026-10-26 21:27 사용자 결정: **①장면 2안 · ②글 틀 1안 · 견본 모양 그대로**("예시 마음에 든다").

## 모양 (견본 [sample.html](sample.html) = 틀)
- A4 세로(794×1123), 회색 머리 띠(로고 `brand/logo-black.svg` + "사용자 매뉴얼"), 아래 줄(왼쪽 "기록 사용자 매뉴얼", 오른쪽 "화면 · 쪽").
- 검정 계열(보라 안 씀). 글꼴 Pretendard, 본문 13px, 해요체, 기술 용어 없음, 긴 줄표 대신 –.
- 맨 위 제목: 화면 이름(32px, 굵게) + 정의 한 줄(16px), 아래 가는 선 (21:30 사용자 – "모듈명 – 기능" 구분 없앰).
- 구분 셋: 1 기획 의도 · 2 화면 · 3 기능별 설명 + "알아 두면 좋은 것".
- 대구분 번호 = **연회색 채운 네모**(24, 모서리 5, 머리 띠와 같은 회색 + 검은 숫자 – 21:34 사용자 1안), 기능 번호 = 속 빈 원(그림 위·설명 같은 모양).
- 번호 숫자는 도형 정가운데: 상자가 아니라 숫자 획(잉크) 가운데를 맞춰요 – 숫자마다 바로잡는 값(`FIX`)을 생성기가 찍을 때 재서 넣어요(0.4px 안).
- 화면 그림: 지킴이 캡처(1600×900)에서 사이드바를 빼고 쓰는 곳만 잘라요. 번호는 그림 밖(위·아래) 여백, 지시선 끝 점은 요소 가장자리(글자를 가리지 않게).
- 화면당 번호 5~9개, 설명은 한두 줄.

## ① 장면 (2안 – 화면 10 + 열린 모습)
| 화면 | 기본 | 열린 모습(지금 있음) | 지킴이에 더할 것(코딩 뒤) |
| --- | --- | --- | --- |
| 탐색기 | `screen_00` | `files_tabmenu` · `files_delete` | |
| 민원대장 | `screen_01` | `complaints_filter` · `complaints_rowmenu` | |
| 민원처리 | `screen_02` | `process_rowmenu` | 공사 관리 창 |
| 집행현황 | `screen_03` | `budget_menu` | |
| 예산현황 | `screen_04` | `budgetstatus_menu` | ⚙ 설정 상자 |
| 캘린더 | `screen_05` | `calendar_kinds` | 일정 상세 창 |
| 할 일 | `screen_06` | `tasks_listmenu` · `tasks_minical` | |
| 업무일지 | `screen_07` | `journal_daymenu` | 메모 편집기 |
| 업무연락처 | `screen_08` | `contacts_pjdialog` | |
| 설정 | `screen_09` | `settings_calendar` | |

열린 모습은 그 화면 쪽 ③ 아래에 작은 그림(번호 없이 한 줄 설명)으로 붙여요.

## ② 글 틀 (1안 – 번호 자리는 화면 요소 이름)
화면마다 `docs/manual/<화면>.md` 하나:

```
제목: 민원대장
정의: 모든 민원을 하나의 플랫폼에 정리하여, …
기획 의도:
- …
장면: screen_01 (자르기: 사이드바 빼고 표까지)
열린 모습: complaints_filter – 한 줄 설명 / complaints_rowmenu – 한 줄 설명
번호:
1. 상태 칩 | <요소 이름> | 위 | 설명 한 줄
…
알아 두면 좋은 것:
- …
```
생성기가 캡처를 찍을 때 요소 위치를 함께 재서 번호를 얹어요. 위치가 안 재지는 요소는 그 화면 대기 목록에 "이름표(`data-help`) 붙여 주세요" 한 줄로 전달해요.

## 만들기 (2026-10-26 매뉴얼 세션 – `tools/manual/`)
빌드 뒤 매뉴얼 다시 만들기 – 지킴이 빌드 하나만 있으면 돼요:
```
npx vite build -c tools/guard/vite.config.ts --outDir /tmp/g_cur
python3 tools/manual/build.py /tmp/g_cur            # → docs/manual/기록-매뉴얼.html (그림·글꼴을 모두 넣은 한 파일, A4 인쇄)
```
- 글은 `docs/manual/<키>.md`(키: explorer·complaints·process·budget·bstatus·calendar·tasks·journal·contacts·settings, 사이드바 순서).
- 번호 선택자를 찾을 때: `python3 tools/manual/probe.py /tmp/g_cur <장면> [찾을 글]`(요소·자리·글을 적고 장면 그림을 남겨요).
- 잴 수 없는 요소나 A4 한 장을 넘는 쪽이 있으면 끝에 목록을 적고 끝 값 1 – 선택자를 고치거나, 화면이 바뀌어 못 찾으면 그 화면 대기 목록에 "이름표(`data-help`) 붙여 주세요" 한 줄.
- 한 장 = 첫 쪽(제목·1 기획 의도·2 화면·3 기능별 설명) + 둘째 쪽(4 열린 모습·알아 두면 좋은 것). 첫 쪽은 A4 한 장 안.
- 번호 숫자 가운데 맞춤 값은 만들 때마다 글꼴로 재요(`measure_fix`).
- 지킴이 장면 넷을 더함(매뉴얼 열린 모습): `process_works`(공사 관리 창)·`budgetstatus_settings`(예산현황 설정 상자)·`calendar_event`(일정 상세 창)·`journal_memo`(메모 편집기).
