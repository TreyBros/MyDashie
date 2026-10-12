import React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <Toaster position="bottom-center" toastOptions={{ style: { borderRadius: 16, fontFamily: "inherit" } }} />
  </React.StrictMode>
);
