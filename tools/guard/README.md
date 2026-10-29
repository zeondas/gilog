# 모양 지킴이 (tools/guard)

2026-10-21 공통 부품 세션이 만들었어요(사용자 결정 ⑥ 1안 – 모든 세션이 화면을 고친 뒤 돌려요).
고치기 **전(main)** 과 **뒤(내 가지)** 를 같은 장면으로 찍어 한 점씩 비교해요. 맞춰 둔 간격이 모르는 사이 틀어지는 것을 막는 것이 목적이에요.

- 기준: 1600×900 · 100% · 밝게 · 시계 2026-10-21 10:00(서울) 고정 · 움직임(전환·커서 깜빡임) 끔 · 시험 자료 `seed.js`
- 저장 규칙은 앱과 같은 Rust core를 브라우저용(WASM)으로 써요(2026-10-30 ②-3 2차 – 전엔 `api.ts` 흉내). 빌드 전에 `npm run build:wasm`(`tools/preview/build-wasm.mjs`), `seed.js`는 실제 명령을 같은 순서로 불러 채워요(`window.__previewSeed`).
- 장면: 화면 10개 + 메뉴·지울까요 띠·창·날짜 칸이 열린 모습 33개 + 탐색기 칸 모양 4개(`files_tb`·`files_3l`·`files_3r`·`files_four`, 2026-10-25)(`shoot.py`의 `SCENES`). 새 메뉴·띠·창을 만들면 여기에 장면을 더해요. 매뉴얼 열린 모습 장면 `process_works`·`budgetstatus_settings`·`calendar_event`·`journal_memo`(2026-10-26 매뉴얼 세션 – `tools/manual/`이 같은 장면을 2배로 찍어요).
- 화면 크기 장면(2026-10-21 화면 배율): `zoom15_00`~`zoom17_09` – 설정 "화면 크기" 15·17에서 화면 10개. 앱처럼 CSS 화면을 1600÷z × 900÷z로 줄이고 점 배율 z(15÷13, 17÷13)로 찍어 그림은 1600×900이에요. 13·100% 장면은 그대로 0점이어야 해요.
- 작은 창 장면(2026-10-26 창 크기): `small_00`~`small_09` – 창 1200×700·13에서 화면 10개, 가로 스크롤 막대가 보이게 찍어요(막대 숨김을 끔). 본문만 가로로 밀리고 칸이 줄지 않는지 지켜요([docs/qa/viewport.md](../../docs/qa/viewport.md)).
- 비교: 색이 10 넘게 다른 점만 "다름"(둥근 모서리 가장자리는 찍을 때마다 1~7 흔들려서 빼요).
- 계산된 모양 값 비교 `styles.py`(2026-10-26 정리 2차): 같은 장면을 두 빌드에서 열어 모든 요소(::before·::after 포함)의 `getComputedStyle` 전부를 견줘요 – 사진이 못 잡는 차이까지. CSS를 옮기거나 나눌 때 `python3 tools/guard/styles.py /tmp/g_base /tmp/g_cur` → 0이어야 해요. 알아 둘 것: `complaints_newrow_baddate`·`journal_memo`는 main끼리 찍어도 사진이 조금씩 흔들려요(1,400점·1점).
- 동작 시험 `behave.py`: 메뉴·띠·창을 열고 ① 안에서 눌러 바깥에서 떼면 안 닫힘 ② 바깥 누르면 닫힘 ③ Esc로 닫힘, 지울까요 띠는 열리면 취소에 커서·Esc는 띠만 접힘, 날짜 칸은 보기 값 여덟 개가 떠날 때 8자리·abc는 빨강, 고치는 카드는 바깥 누르면 저장되는지.

## 검사(CI)에서 저절로(2026-10-29 검사 자동화 ✔1)

`check.yml`의 "모양 지킴이 0~3" 네 갈래가 wip 가지 push마다 윈도우 검사와 동시에 돌아요(화면 쪽 `src/`·`tools/guard/` 등을 안 바꾼 가지는 건너뜀).
기준은 main과 갈라진 곳을 같은 러너에서 빌드해요(기준 사진을 저장소에 두지 않아요). 한 갈래 = `ci.py`: 사진 비교 → 계산 모양 → 동작.
- 흔들리는 장면은 `compare.py`의 `TOLERANCE` 점수까지 통과(`journal_memo`·`complaints_newrow_baddate`·`files_find_baddate`) – 그 장면도 계산 모양은 0이어야 해요.
- **일부러 바꾼 장면**은 그 가지 커밋 메시지에 `guard-allow: 장면 장면 …` 줄을 적어요(사진·계산 모양 차이 통과). 새로 더한 장면(기준에 없음)은 찍히는지만 봐요.
- 실패하면 요약이 커밋 댓글로 남고, 다른 장면 그림은 실행 결과 Artifacts(`guard-N`, 7일)에 있어요.
- 손으로 한 갈래만: `python3 tools/guard/ci.py /tmp/g_base /tmp/g_cur /tmp/guard --shard 0/4 --base-tree /tmp/gilog-main --base-ref origin/main`.

## 쓰는 법

```
# 1) 기준(main)과 내 가지를 각각 빌드 – 기준은 main을 다른 폴더에 받아 빌드
git worktree add /tmp/gilog-main origin/main
(cd /tmp/gilog-main && npm ci && { [ -f tools/preview/build-wasm.mjs ] && npm run build:wasm; true; } && npx vite build -c tools/guard/vite.config.ts --outDir /tmp/g_base)
npm run build:wasm
npx vite build -c tools/guard/vite.config.ts --outDir /tmp/g_cur

# 2) 찍기
python3 tools/guard/shoot.py /tmp/g_base /tmp/s_base
python3 tools/guard/shoot.py /tmp/g_cur  /tmp/s_cur

# 3) 비교 – 바뀌기로 한 장면만 --allow 뒤에 적어요
python3 tools/guard/compare.py /tmp/s_base /tmp/s_cur /tmp/s_diff [--allow 장면 ...]

# 4) 동작 시험(고치기 전·뒤 둘 다 전부 통과여야 해요)
python3 tools/guard/behave.py /tmp/g_cur
```

`compare.py`는 `/tmp/s_diff/report.md`에 장면별 다른 점 수를 표로 적고, 다른 장면은 그림(왼쪽 고친 뒤 + 빨간 곳, 오른쪽 기준)을 남겨요.
통과 못 하면 끝 값이 1이에요. 기준 쪽에 새 장면이 없으면(새로 더한 장면) `--allow`에 적어요.

## 빌드 뒤 매뉴얼 다시 만들기

`python3 tools/manual/build.py /tmp/g_cur` → `docs/manual/기록-매뉴얼.html`(같은 빌드·장면을 써요, 자세히는 [docs/manual/README.md](../../docs/manual/README.md)).

## 지킬 것

- 기준 main에 이 폴더가 없으면(0.29.0 이전) 이 폴더를 그 작업 폴더에 복사해서 빌드해요 – `vite.config.ts`가 앱 코드는 건드리지 않아요.
- 장면이 실패하면 `장면.fail.txt`에 까닭이 남아요. 기준에서도 실패하면 장면 쪽을 고쳐요(선택자).
- 윈도우에서만 보이는 것(실제 윈도우 글꼴 그리기·한글 입력)은 못 잡아요 – 빌드 뒤 사용자 시험으로.
