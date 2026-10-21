# 모양 지킴이 (tools/guard)

2026-10-21 공통 부품 세션이 만들었어요(사용자 결정 ⑥ 1안 – 모든 세션이 화면을 고친 뒤 돌려요).
고치기 **전(main)** 과 **뒤(내 가지)** 를 같은 장면으로 찍어 한 점씩 비교해요. 맞춰 둔 간격이 모르는 사이 틀어지는 것을 막는 것이 목적이에요.

- 기준: 1600×900 · 100% · 밝게 · 시계 2026-10-21 10:00(서울) 고정 · 움직임(전환·커서 깜빡임) 끔 · 흉내 자료 `seed.js`
- 장면: 화면 10개 + 메뉴·지울까요 띠·창·날짜 칸이 열린 모습 29개(`shoot.py`의 `SCENES`). 새 메뉴·띠·창을 만들면 여기에 장면을 더해요.
- 화면 크기 장면(2026-10-21 화면 배율): `zoom15_00`~`zoom17_09` – 설정 "화면 크기" 15·17에서 화면 10개. 앱처럼 CSS 화면을 1600÷z × 900÷z로 줄이고 점 배율 z(15÷13, 17÷13)로 찍어 그림은 1600×900이에요. 13·100% 장면은 그대로 0점이어야 해요.
- 비교: 색이 10 넘게 다른 점만 "다름"(둥근 모서리 가장자리는 찍을 때마다 1~7 흔들려서 빼요).
- 동작 시험 `behave.py`: 메뉴·띠·창을 열고 ① 안에서 눌러 바깥에서 떼면 안 닫힘 ② 바깥 누르면 닫힘 ③ Esc로 닫힘, 고치는 카드는 바깥 누르면 저장되는지.

## 쓰는 법

```
# 1) 기준(main)과 내 가지를 각각 빌드 – 기준은 main을 다른 폴더에 받아 빌드
git worktree add /tmp/gilog-main origin/main
(cd /tmp/gilog-main && npm ci && npx vite build -c tools/guard/vite.config.ts --outDir /tmp/g_base)
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

## 지킬 것

- 기준 main에 이 폴더가 없으면(0.29.0 이전) 이 폴더를 그 작업 폴더에 복사해서 빌드해요 – `vite.config.ts`가 앱 코드는 건드리지 않아요.
- 장면이 실패하면 `장면.fail.txt`에 까닭이 남아요. 기준에서도 실패하면 장면 쪽을 고쳐요(선택자).
- 윈도우에서만 보이는 것(실제 윈도우 글꼴 그리기·한글 입력)은 못 잡아요 – 빌드 뒤 사용자 시험으로.
