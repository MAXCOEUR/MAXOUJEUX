import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "favicon.svg",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "maskable-icon-512x512.png",
        "apple-touch-icon-180x180.png",
        "offline.html",
      ],
      manifest: {
        id: "/",
        start_url: "/",
        scope: "/",
        name: "MaxouJeux",
        short_name: "MaxouJeux",
        description: "Mini-jeux multijoueur en ligne",
        lang: "fr-FR",
        display: "standalone",
        theme_color: "#0f1115",
        background_color: "#0f1115",
        categories: ["games", "entertainment"],
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,woff,woff2,webmanifest,png,svg}"],
        globIgnores: ["**/sons/**"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/socket\.io(?:\/|$)/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
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
