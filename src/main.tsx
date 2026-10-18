import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installNoAutofill } from "./autofill";
import { installIme, installImeForTest } from "./ime";
import { installSnap } from "./snap";
import { installRuler } from "./ruler";
import "./tokens.css";
import "./app.css";

installIme();
// 브라우저 미리 보기에서 한글 조립을 시험할 때만: 주소 끝에 ?imetest
if (location.search.includes("imetest")) installImeForTest();
installNoAutofill();
installSnap();
// 입력칸 글자 기준선 재기(숨은 검사 모드): 주소 끝에 ?ruler
if (location.search.includes("ruler")) installRuler();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
