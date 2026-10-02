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
      includeAssets: ["icon.svg", "favicon.svg", "icon-maskable.svg"],
      manifest: {
        name: "TaiOne care · We care",
        short_name: "TaiOne care",
        description: "PDF 或錄音一鍵產出護理計畫、護理紀錄與家屬衛教",
        lang: "zh-Hant-TW",
        theme_color: "#141414",
        background_color: "#f4f0ea",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        // 中文字型切成數百個 unicode-range 檔，只在用到時下載並快取，不預先全部下載。
        globPatterns: ["**/*.{js,css,html,svg,mjs}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "font",
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
