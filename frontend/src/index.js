import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { registerServiceWorker } from "@/registerSW";
import { installViewportGuards } from "@/viewportGuards";

installViewportGuards();
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// PWA auto-update: keeps installed app always on latest deploy
registerServiceWorker();
