// 在本機模擬分享網頁（Claude Artifact）的檢視框架，用來測試試用版：
// - 外框頁 http://localhost:4320/ 以 sandbox iframe 載入 http://localhost:4321/（不同來源）
// - 框內頁套上與分享網頁相同的 <!doctype><head><body> 外殼與 CSP（只允許內嵌 JS/CSS、Google Fonts）
// - iframe 只開放剪貼簿寫入，不開放麥克風、系統分享、彈出視窗
// 用法：node scripts/trial-frame-server.mjs [dist-trial/taione-care-trial.html]
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const FILE = process.argv[2] ?? "dist-trial/taione-care-trial.html";
const HOST_PORT = Number(process.env.HOST_PORT ?? 4320);
const FRAME_PORT = Number(process.env.FRAME_PORT ?? 4321);

const RESET =
  ":root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif;background:#faf9f7}img{max-width:100%}[hidden]{display:none!important}";
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net/npm/ https://unpkg.com https://cdn.tailwindcss.com https://code.jquery.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
].join("; ");

createServer((req, res) => {
  const theme = new URL(req.url, "http://x").searchParams.get("theme");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><title>frame host</title>
<style>html,body{margin:0;height:100%;background:#222}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe id="artifact" src="http://localhost:${FRAME_PORT}/${theme ? `?theme=${theme}` : ""}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups-to-escape-sandbox" allow="clipboard-write"></iframe></body></html>`);
}).listen(HOST_PORT);

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/") {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  const theme = url.searchParams.get("theme");
  const page = readFileSync(FILE, "utf8");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP });
  res.end(
    `<!doctype html><html${theme ? ` data-theme="${theme}"` : ""}><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${RESET}</style></head><body>${page}</body></html>`,
  );
}).listen(FRAME_PORT);

console.log(`artifact frame emulator: http://localhost:${HOST_PORT}/  (frame http://localhost:${FRAME_PORT}/, file ${FILE})`);
