import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installNoAutofill } from "./autofill";
import { installIme, installImeForTest } from "./ime";
import "./tokens.css";
import "./app.css";

installIme();
// 브라우저 미리 보기에서 한글 조립을 시험할 때만: 주소 끝에 ?imetest
if (location.search.includes("imetest")) installImeForTest();
installNoAutofill();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
