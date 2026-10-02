import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "TaiOne Care 居護 AI 記錄助理",
        short_name: "TaiOne Care",
        description: "PDF 或錄音一鍵產出護理計畫、護理紀錄與家屬衛教",
        lang: "zh-Hant-TW",
        theme_color: "#13342e",
        background_color: "#f6f3ec",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2,mjs}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
