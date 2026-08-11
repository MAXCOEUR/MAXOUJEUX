import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // On rejoue en développement le routage que le nginx du conteneur `web`
    // assure en production : même origine pour le front, l'API et les
    // WebSockets, donc pas de CORS et un cookie de session qui circule seul.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/socket.io": { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    // Le NAS sert peu de clients : on privilégie un cache long sur des fichiers
    // hachés plutôt qu'un découpage fin.
    chunkSizeWarningLimit: 900,
  },
});
