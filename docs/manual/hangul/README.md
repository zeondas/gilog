
## 그림 채우기 (2026-10-29)
1. 글: `python3 tools/manual/hwpx_fill.py <사용자 원고.hwpx> out.hwpx docs/manual/hangul/explorer_rest.txt <화면.txt …>`
2. 그림: `python3 tools/manual/hwpx_pics.py <미리 보기 빌드> out.hwpx final.hwpx docs/manual/hangul/map explorer complaints process budget bstatus calendar tasks journal contacts settings`
   – `map/map_<화면>.json`: 가·나·다 번호가 가리킬 요소와 상세설명 그림(열린 메뉴·창), `map/extra_scenes_*.py`: 덧붙인 장면. 그림은 3배로 찍어 틀 폭에 맞춰요.

## 수정본으로 다시 만들기 (2026-10-29 v3)
1. 글: `python3 tools/manual/hwpx_build.py docs/manual/hangul/사용자-수정본-탐색기_2026-10-29.hwpx text.hwpx docs/manual/hangul/explorer_edits.py docs/manual/hangul/{complaints,process,budget,bstatus,calendar,tasks,journal,contacts,settings}.txt`
   – 탐색기 장은 사용자 수정본 그대로(고칠 문단만 `explorer_edits.py`), 키는 앱 표기 + 굵게·연회색 바탕, 새 줄은 줄 머리 폭만큼 내어쓰기.
2. 그림: `python3 tools/manual/hwpx_pics.py <최신 미리 보기 빌드> text.hwpx final.hwpx docs/manual/hangul/map explorer complaints process budget bstatus calendar tasks journal contacts settings`
