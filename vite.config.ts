import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Chiron+GoRound+TC:wght@200..900&family=Noto+Sans+TC:wght@100..900&display=swap";

/**
 * 試用版：字型改由 Google Fonts 載入（分享網頁只允許這個字型來源）、不註冊 Service Worker，
 * 輸出單一 JS 與 CSS，之後由 scripts/build-trial.mjs 組成一個網頁檔。
 */
function trialBuild(): Plugin {
  const EMPTY = "\0trial-empty";
  return {
    name: "taione-trial",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith("@fontsource")) return EMPTY;
      if (id === "virtual:pwa-register") return `${EMPTY}-pwa`;
      return null;
    },
    load(id) {
      if (id === EMPTY) return "";
      if (id === `${EMPTY}-pwa`) return "export function registerSW() { return () => undefined; }";
      return null;
    },
    transformIndexHtml() {
      return [{ tag: "link", attrs: { rel: "stylesheet", href: FONTS_CSS }, injectTo: "head" }];
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    mode === "trial" ? trialBuild() : null,
    mode === "trial" ? null : VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "favicon.svg", "icon-maskable.svg"],
      manifest: {
        name: "TaiOne care · We care you",
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
            // 照護紀錄 PDF 用的明體（約 3 MB）：第一次導出時才下載，之後離線也能產生 PDF。
            urlPattern: ({ url }) => url.pathname.startsWith("/fonts/"),
            handler: "CacheFirst",
            options: { cacheName: "pdf-fonts", expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
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
  build:
    mode === "trial"
      ? { target: "es2022", outDir: "dist-trial", assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 4000, rollupOptions: { output: { inlineDynamicImports: true } } }
      : { target: "es2022", chunkSizeWarningLimit: 1500 },
}));
