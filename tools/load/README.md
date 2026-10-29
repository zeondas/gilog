# 화면 재기 도구 (tools/load)

2026-10-21 최적화 세션이 지워진 `wip/loadtest`의 화면 쪽을 간단히 다시 만들었어요(core·Rust 재기는 없어요).
결과는 [docs/loadtest.md](../../docs/loadtest.md) 아래 "2026-10-21 고친 뒤".

- `seed.js` — 3년치 흉내 자료(민원 1,500 · 연락처 800 · 할 일 6,000 · 업무일지·일정 같은 비율)를 미리 보기 메모리 흉내(`window.__fake`)에 넣어요.
- `vite.config.ts` — 앱 코드를 손대지 않고, 빌드할 때만 `src/api.ts` 끝에 `window["__fake"] = fake` 한 줄을 붙여요.
- `measure.py` — Playwright로 화면 전환·스크롤 fps·민원대장 "전체"로 거르기 풀기·검색을 재요(1600×900, 5번 중간값). `--shots 폴더`면 민원대장·업무연락처·할 일을 밝게·어둡게, 100%·125%로 찍어요.
- `report.py` — 결과.json을 기준(전환 0.2초·검색 0.3초·거르기 0.2초·60fps)과 견준 표로 적어요. 기준을 넘어도 끝 값 0(숫자만).
- `check.py` — 보이는 만큼만 그리기 동작 확인(그 줄로 가기·End/Home·PageDown 포커스·고치는 줄 유지·열 폭 끌기·연락처 800장).

## 쓰는 법

```
npx vite build -c tools/load/vite.config.ts --outDir /tmp/site
python3 tools/load/measure.py /tmp/site 결과.json --runs 5 --shots /tmp/shots
cd tools/load && python3 check.py /tmp/site
```

고치기 전후를 비교하려면 고치기 전 커밋에서 한 번 빌드해 다른 폴더에 두고 같은 명령을 돌려 캡처를 픽셀로 비교해요.
리눅스 작업 공간(2코어) 값이라 사무실 PC와는 달라요.

## 검사(CI)에서(2026-10-29 검사 자동화 ✔2)

`.github/workflows/load.yml`이 주 1회(월요일 08:17, main)·직접 실행·이 폴더를 바꾼 wip push 때 `measure.py --runs 5` → `report.py`로 실행 요약에 표를 남겨요(결과 파일은 Artifacts `load-N`, 90일). 기준을 넘어도 실패로 만들지 않아요.
10-29에 할 일 검색 칸 찾기(검색창 통일 뒤 `type=search`가 없어짐)를 고치고 업무일지 전체 검색 "배수"를 더했어요.
