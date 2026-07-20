import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import "./index.css";

function mount() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// DEV-ONLY browser bridge mock (for vite dev without Electron). The dynamic
// import is guarded by import.meta.env.DEV so it's never bundled in production.
if (import.meta.env.DEV && !(window as any).jcut) {
  import("./dev-mock").then((m) => { m.installDevMockIfNeeded(); mount(); });
} else {
  mount();
}
