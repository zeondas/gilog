# 구글 캘린더 양방향 연동 – 레퍼런스 조사 (캘린더 세션, 2026-11-04)

사용자 요청(11-04 12:01): 설정에서 단방향/양방향을 고르게, 양방향일 때 7일마다 풀리는 로그인 문제 해결.
검토 원문은 현황판 캘린더 줄, 결정 ①~④는 사용자 답을 기다려요. 이 문서는 남들이 어떻게 하는지 정리한 것이에요.

## 1. 다른 앱은 어떻게 하나

| 앱 | 무엇을 맞추나 | 양쪽에서 고쳤을 때 | 한쪽에서 지웠을 때 | 얼마나 자주 |
| --- | --- | --- | --- | --- |
| Daylite(맥 업무 관리) | 구글 캘린더 하나 ↔ 앱의 분류 하나(짝으로). 내가 가진 캘린더만 | "나중에 고친 쪽이 이겨요" | 구글에서 지우면 앱의 **휴지통으로**(되살릴 수 있음), 앱에서 지우면 구글에서도 지움 | 고칠 때마다(정해진 간격 없음) |
| SuiteCRM(업무 관리) | 연결한 캘린더 | 고를 수 있음: 나중 것 이김(기본) / 바깥 캘린더 이김 / 우리 앱 이김 | 기본은 양쪽 다 지움, 끄는 스위치 둘(한쪽 지우기 막기) – 끄면 한쪽에만 남는 일정이 생긴다고 경고 | 정해진 간격 + [지금 맞추기] |
| CalendarBridge(캘린더 잇기 서비스) | 캘린더 짝마다 "한 방향" 또는 "양쪽"(= 한 방향 두 개) | 보내는 쪽이 주인, 받는 쪽 사본은 고쳐도 안 돌아감 | 보내는 쪽에서 취소하면 받는 쪽도 취소 | 서버가 바로 |
| 개발 글(구글 동기화 함정) | – | "나중 것 이김"은 쉽지만 가끔 내용이 사라질 수 있어 **알려 주라**고 권함 | 구글에서 지운 것은 **바로 지우지 말고 표시해 두고 알리기**를 권함 | 알림(웹훅) + 주기 확인 함께 |

공통점
- **고르기 단추**: 한 방향/양쪽을 사용자가 고르게 하는 앱이 많아요(CalendarBridge, SuiteCRM은 지우기만 따로 끄기).
- **맞추는 캘린더는 한정**: 아무 캘린더나가 아니라 짝지은 캘린더 하나(Daylite·CalendarBridge).
- **양쪽에서 고치면 나중 것**이 기본(Daylite·SuiteCRM).
- **지운 것은 되살릴 길**을 둬요(Daylite 휴지통, 개발 글 "표시 + 알림").
- **되돌아오는 메아리 막기**: 우리가 보낸 것을 다시 받아 오지 않게 표시를 달아요(CalendarBridge "사본은 다시 보내지 않음"). 기록은 이미 일정마다 `gilog` 표시와 내용 지문을 달아 보내요(`src/google.ts`).

## 2. 기록에 맞춘 점

- 기록은 윈도우 앱이라 구글이 "바뀌었어요"를 바로 알려 줄 주소(웹훅)를 둘 수 없어요 → **몇 분마다 + 창을 다시 볼 때** 구글에 "지난번 뒤로 바뀐 것"만 물어요(구글 "바뀐 것만 받기" 표 `syncToken`, 오래되면 410 → 처음부터 다시).
- 바뀐 것만 묻기라 요청 양은 아주 적어요.

## 3. 권하는 모양 (결정 ①~④와 같은 방향)

- ① 구글 앱 게시 상태 "프로덕션" + 캘린더 상자 [다시 로그인] 안전망
- ② "기Log" 캘린더 안 내 일정만 양쪽(Daylite·CalendarBridge처럼 짝지은 캘린더 하나), 민원·할 일 마감은 한 방향
- ③ 구글에서 지운 일정은 바로 지우지 않고 "구글에서 지워짐 N건" 띠 → [지우기]/[구글에 되살리기] (Daylite 휴지통·개발 글 권고, 기록의 "삭제는 묻기" 규칙)
- ④ 나중에 고친 쪽 이김(Daylite·SuiteCRM 기본) + 덮인 일이 있으면 상자에 한 줄로 알림(개발 글 권고)
- 설정 구글 카드에 "연동 방향: 한 방향 / 양방향"(처음은 한 방향)

## 출처

- [Daylite – Google Calendar sync rules and behaviour](https://docs.daylite.app/help/mac-fundamentals/calendars/google-calendar-sync/google-calendar-sync-rules-and-behaviour)
- [SuiteCRM – Understanding Sync & Troubleshooting](https://docs.suitecrm.com/admin/administration-panel/calendar-sync/understanding-sync-troubleshooting/)
- [CalendarBridge – Manage Syncs](https://help.calendarbridge.com/help/manage-syncs.html)
- [Engineering Google Calendar Sync: The Hidden Complexity](https://codexconversation.substack.com/p/engineering-google-calendar-sync)
- [Google Calendar API – Synchronize resources efficiently](https://developers.google.com/calendar/v3/sync?authuser=2)

## 4. 구글 앱을 "테스트" 상태로 둔 채 양방향 (11-04 16:0x 사용자 질문)

테스트 상태에서는 사용자 로그인(OAuth)으로 받은 허락이 7일 뒤 끊겨요. 이건 기록이 바꿀 수 없어요. 길은 둘이에요.

- **서비스 계정**: 사람 로그인 대신 "기록 전용 로봇 계정"을 콘솔에서 만들고 열쇠 파일을 받아요. 구글 캘린더에서 "기Log" 캘린더를 그 로봇 메일에 "일정 변경" 권한으로 공유하면, 기록은 로그인 없이 그 캘린더를 읽고 써요. 로그인이 없으니 7일 제한도 없고, 앱 게시 상태와도 상관없어요.
  - 걸림: 구글 할 일(Tasks)은 공유가 안 돼 로봇이 못 만져요. "구글 할 일로 보내기"는 지금 로그인 방식 그대로라 7일 제한이 남아요.
  - 걸림: 열쇠 파일은 비밀번호와 같아요. PC에만 암호화해 두고 저장소에는 적지 않아요(앱 정보 파일과 같은 방식).
  - 걸림: 2024-05-03 뒤 만든 "조직" 계정은 열쇠 만들기가 기본으로 막혀 있어요. 개인 gmail 프로젝트는 조직이 없어 대개 해당하지 않지만, 막혀 있으면 이 길은 못 써요.
- **로그인 그대로 + 매주 다시 로그인을 쉽게**: 6일째 "내일 연동이 풀려요" 띠와 캘린더 상자의 [다시 로그인](30초). 풀린 동안 기록에서 고친 것은 쌓였다가 다시 로그인하면 한꺼번에 맞춰요.

어느 쪽이든 양방향에는 같은 안전장치가 필요해요: 일정마다 "고친 시각"을 남겨 공백 뒤에도 "나중 것 이김"이 맞게, 연결이 끊긴 동안 안 보이는 일정을 "지워졌다"로 착각하지 않게(구글 "바뀐 것만 받기"는 지운 것을 따로 알려 줘요).

출처: [CData – 서비스 계정으로 구글 캘린더 읽기(캘린더를 로봇 메일에 공유)](https://lic-test.cdata.com/kb/articles/googlecalendar-service-authentication.rst) · [Google Groups – 서비스 계정에서 캘린더 접근](https://groups.google.com/g/google-calendar-api/c/MySzyAXq12Q) · [Google Cloud – 조직 기본 제약(2024-05-03 뒤 조직)](https://docs.cloud.google.com/resource-manager/docs/manage-baseline-constraints?authuser=4)
