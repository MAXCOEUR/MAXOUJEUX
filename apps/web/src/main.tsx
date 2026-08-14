import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { bindAmbiance, bindUnlockFeedback } from "./lib/ambiance";
import { queryClient } from "./lib/queryClient";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Élément #root introuvable dans index.html");

// Branché ici et non dans un composant : l'ambiance suit les stores, pas le
// cycle de vie de React. Un `useEffect` la couperait à chaque démontage, et
// `StrictMode` l'abonnerait deux fois.
bindAmbiance();
bindUnlockFeedback();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
