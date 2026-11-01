CLAUDE.md에서 2026-11-01 옮김 – 원문 그대로

## 작업 방법
- 작업 공간이 리눅스라 윈도우 설치 파일은 GitHub Actions가 만들어요. `main`에 올리면 자동으로 Releases에 `giLog_<버전>_x64-setup.exe`가 올라와요. **그래서 코드를 `main`에 올리기 전에 꼭 사용자 허가를 받아요(위 "빌드 규칙").**
- 올리기 전에: `npm test`(규칙 함수 시험 – `src/*.test.ts`, 지금 동작을 고정한 값이라 규칙을 일부러 바꿀 때만 시험 값도 고쳐요, check.yml에도 있어요), `npm run build`(TS 검사 포함), `cargo test --manifest-path src-tauri/core/Cargo.toml`, 가능하면 `cargo check --manifest-path src-tauri/Cargo.toml`(리눅스는 libwebkit2gtk-4.1-dev 필요).
- 화면 확인은 `dist/`를 로컬 서버로 띄워 Playwright로 1920×1080 스크린샷을 찍어 봐요.
- **검사 자동화(2026-10-29 `wip/ci2`, 합친 뒤부터)**: wip push마다 check.yml이 윈도우 검사와 함께 모양 지킴이(사진·계산 모양·동작) 4갈래를 리눅스에서 돌려요(화면 쪽을 바꾼 가지만, 약 4분). 결정 로그 10-27 09:26 ③ "끝낼 때 전체 한 번"은 그대로 하고 CI가 다시 확인해요. 일부러 바꾼 장면은 커밋 메시지에 `guard-allow: 장면 …` 줄(`tools/guard/README.md`). `npm test`에 화면 부품 시험(`src/*.test.tsx`)이, core 시험에 자료 올리기 시험(`migrate_tests.rs` – `SCHEMA_VERSION`을 올리면 `OLD_FORMATS`에 직전 형식을 더해요)이 있어요. 부하 시험은 `load.yml`(주 1회 월요일 아침·직접 실행, 숫자만).
- 단계마다 `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`의 버전을 0.N.0으로 올려요.
- 빌드가 실패하면 오류가 커밋 댓글로 남아요: `gh api repos/zeondas/gilog/commits/<sha>/comments`.
- `[skip ci]`를 커밋 메시지에 넣으면 빌드를 건너뛰어요 (문서만 고칠 때). 메시지 본문 어디에 있어도 건너뛰니, 빌드할 커밋에는 이 글자를 설명으로도 쓰지 않아요. 건너뛰었으면 `gh workflow run build.yml -R zeondas/gilog --ref main`으로 직접 돌려요.

## 빌드 규칙 (2026-10-17 사용자가 정함 — 가장 먼저 지켜요)
- **(2026-10-27 11:32 바뀜 – 공통 결정 로그: 빌드 세션은 빌드 프롬프트를 받으면 허가를 따로 묻지 않고 스스로 판단해 올려요. 아래는 빌드 세션이 아닌 세션에 적용.)** **사용자 허가 없이 빌드하지 않아요.** `main`에 코드를 올리면 바로 빌드되니, 코드 커밋을 `main`에 올리는 것도 허가를 받은 뒤에만 해요. `gh workflow run`으로 직접 돌리는 것도 마찬가지예요.
- 빌드가 필요하면 Claude가 먼저 제안해요: 무엇을 고쳤는지, 왜 지금 빌드가 필요한지 한두 줄로 말하고 "빌드할까요?"라고 물어요. 사용자가 허가하면 그때 올려요.
- 허가 전에는 고친 것을 작업 공간에만 두고(또는 대기 목록에 적고), 화면 확인은 브라우저 미리 보기로 해요.
- 문서만 고친 커밋은 `[skip ci]`를 붙여 빌드 없이 올려도 돼요.
- (계기: 2026-10-17 할 일 입력란 수정을 묻지 않고 0.9.5로 빌드했어요. 다른 세션들이 같은 보관소에서 빌드하던 중이었어요.)

## 시안 두는 곳 (2026-10-17 사용자 1안)
- **새 시안은 모두 화면 시안 캔버스 https://claude.ai/artifact/JyghMiCyKE5BRDq2C8SmJm 에 판(`이름.dc.html`)으로 더해요.** 따로 아티팩트를 만들지 않아요. 사용자가 찾기 힘들어했어요. 캔버스는 사이드바에 고정해 뒀어요(이름 "giLog 시안").
- 시안을 말할 때는 늘 캔버스 주소와 판 이름을 함께 적어요.
- **시안을 올리기 전 확인(2026-10-17 사용자 지적 — 인쇄 기간 시안에서 날짜 칸이 `261012`를 2000년대로 읽지 못했어요)**: 시안에 입력칸·머릿기호·Enter·한글 등 공통 규칙이 닿는 곳이 있으면, 아래 "공통 입력 규칙"을 칸마다 대어 보고, 규칙을 흉내 낼 때는 **새로 짜지 말고 앱의 함수를 그대로 옮겨** 와요(날짜 `journal.ts`의 `parseDate`, 머릿기호 `bullets.ts`·`BulletRule.dc.html`의 `layout`). 옮긴 뒤 규칙에 적힌 보기 값(`261015`, `26-10-15`, `1015`, `10/15`, `20261015` 등)을 한 번 돌려 봐요. 뜨는 창의 "바깥을 누르면 닫기"도 앱처럼 **누르기 시작한 곳이 바깥일 때만**(`onMouseDown` + `e.target === e.currentTarget`) 닫아요 — 시안을 `onClick`으로 만들었더니 날짜 칸 글자를 끌어 고르다 창 밖에서 떼면 닫혔어요(2026-10-17 사용자 신고, 앱은 이미 바른 방식).
- **캔버스 판은 화면당 기준판 하나(2026-10-20 21:53 사용자 1안 — 69판 → 16판으로 정리)**: Main(민원대장)·Todo·Contacts·Journal·Calendar·Settings·Files(탐색기)·Process(민원처리)·Budget(집행현황)·BudgetStatus(예산현황)·Theme·Lock + 결정 기다림 ProcessStatus(진행 막대)·BudgetShare·ProcessMail·AddressWeb(주소 변환 웹)·PartsLook(공통 부품 메뉴·지울까요 모양)·Installer(설치·제거 창 – 3안 보라 띠 확정)·BudgetLink(집행·예산 연동 – 이월 재원 나눔 지금/고친 뒤, 결정되면 BudgetStatus에 반영하고 지움)·RuleFix(공통 부품 ✔8 지금/고친 뒤, 코딩 뒤 지움). **규칙**: 비교·고르기 판(1안/2안, 지금/고친 뒤)은 결정되면 그 화면 기준판에 반영하고 지워요 — 새 판을 더하면 여기에 이름을, 지운 판은 [docs/history.md](https://github.com/zeondas/gilog/blob/main/docs/history.md) "시안 판 목록"에 적어요(판마다 정한 것은 그 절·공통 결정 로그에 남아 있고, 캔버스 이전 판본으로 되살릴 수 있어요).
- 예전에 따로 만든 시안(새로 더하지 않아요): 종류 칸 https://claude.ai/artifact/EUZJjsJEZqPnCy9sv5y4qS · 글자 가운데 맞춤 비교 https://claude.ai/artifact/6f6FBiSo7unEMt8qJzE5SQ · 관리 창 https://claude.ai/artifact/ALMvrTHi4RGFHvBikN9srq · 쉬는 날 음영 https://claude.ai/artifact/ND2V6G1gFkb3TWnuC8GyTD

## 기준 문서 (이 순서로 우선해요)
1. 개발 사양서: https://claude.ai/code/artifact/8a776f73-e26c-4e2c-9735-3dc7cd0885f4 (동작·저장·연동) — 2026-10-17 지금 결정에 맞게 전체를 고쳤어요(확정했지만 앱에 없는 것은 "(다음 빌드)" 표시). **동작을 새로 정하거나 바꾸면 이 파일과 함께 사양서도 고쳐요**, 빌드에 들어가면 그 항목의 "(다음 빌드)"를 지워요.
2. 화면 시안(Claude Design 캔버스): https://claude.ai/artifact/JyghMiCyKE5BRDq2C8SmJm — 파일 `project/*.dc.html` (배치·칸 순서·문구)
3. 디자인 시스템: https://claude.ai/artifact/GjMv4QEBfeZmmBLqoM7ASZ — `src/tokens.css`에 옮겨져 있어요. 화면 코드에 색 값을 직접 쓰지 않고 토큰만 써요.
- **이름·로고·색은 `docs/brand.md`가 위 세 문서보다 우선해요**(2026-10-16 확정: 기Log, 각진 ㄱL 심볼, 보라 강조색 — 시안·디자인 시스템도 보라로 고쳤어요).
