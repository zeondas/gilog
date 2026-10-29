# 화면 재기 도구 (tools/load)

2026-10-21 최적화 세션이 지워진 `wip/loadtest`의 화면 쪽을 간단히 다시 만들었어요(core·Rust 재기는 없어요).
결과는 [docs/loadtest.md](../../docs/loadtest.md) 아래 "2026-10-21 고친 뒤".

- `seed.js` — 3년치 시험 자료(민원 1,500 · 연락처 800 · 할 일 6,000 · 업무일지 6,264 · 일정 1,576)를 실제 앱 명령으로 채워요(민원·연락처는 엑셀 가져오기와 같은 명령으로 한 번에, 열 때 약 4초).
- `vite.config.ts` — 앱 코드를 손대지 않고 미리 보기 저장 모듈(WASM core)을 끼워 빌드해요(아래 절).
- `measure.py` — Playwright로 화면 전환·스크롤 fps·민원대장 "전체"로 거르기 풀기·검색을 재요(1600×900, 5번 중간값). `--shots 폴더`면 민원대장·업무연락처·할 일을 밝게·어둡게, 100%·125%로 찍어요.
- `report.py` — 결과.json을 기준(전환 0.2초·검색 0.3초·거르기 0.2초·60fps)과 견준 표로 적어요. 기준을 넘어도 끝 값 0(숫자만).
- `check.py` — 보이는 만큼만 그리기 동작 확인(그 줄로 가기·End/Home·PageDown 포커스·고치는 줄 유지·열 폭 끌기·연락처 800장).

## 미리 보기 = WASM core (2026-10-30 품질 보완 ②-3)

브라우저 미리 보기는 흉내 코드 없이 **앱과 같은 Rust 저장 규칙(`src-tauri/core`)을 브라우저용(WASM)으로** 써요(`src-tauri/core-wasm`, 메모리 저장소).
- 만들기: `npm run build:wasm`(`tools/preview/build-wasm.mjs` – rustup 대상 `wasm32-unknown-unknown`·clang·`wasm-bindgen-cli` 0.2.129) → `src/wasm-pkg/`(저장소에 넣지 않아요).
  작업 공간에서 Rust 받기가 막히면 check.yml이 남긴 산출물 **`preview-wasm`**(7일)을 받아 `src/wasm-pkg/`에 풀어요.
- 그다음 이 폴더의 `vite.config.ts`로 빌드해요 – `tools/preview/plugin.ts`가 빈 자리 `src/previewCore.ts`를 `tools/preview/core.ts`(WASM)로 바꿔 끼워요. 앱 빌드(`npm run build`)는 빈 자리 그대로라 설치 파일에는 들어가지 않아요.
- 시험 자료 `seed.js`는 `window.__previewSeed = async (call) => { … }` 하나예요 – 저장 모듈이 준비된 뒤 화면이 처음 부르기 전에 한 번 불려요. `call`은 앱 명령 이름 그대로(`call("add_complaint", { complaint })`)라 연번·정리·검사가 실제 앱과 같아요. 도구에서 나중에 자료를 고칠 때는 `window.__preview.call(…)`(화면은 이미 읽은 사본을 들고 있으니 다시 열거나, 처음부터 seed에 넣어요).
- 윈도우·파일·인터넷이 필요한 명령은 자리 표시자예요(`src-tauri/core-wasm/src/placeholder.rs`). 탐색기 파일 목록(`src/filesApi.ts`)과 집행현황 팀 공유 시트(`src/budgetShare.ts` `__shareFake`)는 core 밖이라 미리 보기 전용 자료를 그대로 써요.

## 쓰는 법

```
npm run build:wasm
npx vite build -c tools/load/vite.config.ts --outDir /tmp/site
python3 tools/load/measure.py /tmp/site 결과.json --runs 5 --shots /tmp/shots
cd tools/load && python3 check.py /tmp/site
```

고치기 전후를 비교하려면 고치기 전 커밋에서 한 번 빌드해 다른 폴더에 두고 같은 명령을 돌려 캡처를 픽셀로 비교해요.
리눅스 작업 공간(2코어) 값이라 사무실 PC와는 달라요.

## 검사(CI)에서(2026-10-29 검사 자동화 ✔2)

`.github/workflows/load.yml`이 주 1회(월요일 08:17, main)·직접 실행·이 폴더를 바꾼 wip push 때 `measure.py --runs 5` → `report.py`로 실행 요약에 표를 남겨요(결과 파일은 Artifacts `load-N`, 90일). 기준을 넘어도 실패로 만들지 않아요.
10-29에 할 일 검색 칸 찾기(검색창 통일 뒤 `type=search`가 없어짐)를 고치고 업무일지 전체 검색 "배수"를 더했어요.
