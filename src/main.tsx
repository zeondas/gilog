import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installNoAutofill } from "./autofill";
import { installIme } from "./ime";
import "./tokens.css";
import "./app.css";

installIme();
installNoAutofill();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
