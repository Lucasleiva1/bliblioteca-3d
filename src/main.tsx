import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/app.css";

const storedTheme = window.localStorage.getItem("biblioteca-3d-theme");
document.documentElement.dataset.theme = storedTheme === "light" ? "light" : "dark";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
