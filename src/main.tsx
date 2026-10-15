import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installIme } from "./ime";
import "./tokens.css";
import "./app.css";

installIme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
