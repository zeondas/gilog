# 시안 판을 그림으로 찍기 (2026-10-19)

사용자 지시: 시안은 "캔버스에서 찾아보세요" 하지 말고 **대화에 그림으로 띄워요**.

1. 판 파일(`project/이름.dc.html`)과 `harness.html`, `src/fonts/PretendardVariable.woff2`를 한 폴더에 두고,
   판 안 글꼴 주소 `/_blob/…`를 `PretendardVariable.woff2`로 바꿔요.
2. 그 폴더에서 `npx http-server . -p 4190 -c-1`.
3. `node shot.mjs 이름.dc.html 결과.png 어둡게 "window.__comp.setState({...})"`(마지막 값은 고른 상태를 보여 줄 때만).
4. SendUserFile(display: render)로 보내요. 캔버스에도 판을 올리는 것은 그대로예요.

`harness.html`은 `{{값}}`·`sc-for`·`sc-if`·on 이벤트만 흉내 내는 작은 그리기 틀이에요.
