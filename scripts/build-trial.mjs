// 把 `vite build --mode trial` 的輸出組成「單一網頁檔」，給 Claude Artifact 這類分享網頁使用：
// JS 與 CSS 全部內嵌、字型由 Google Fonts 載入；分享網頁會自己包上 <!doctype><head><body>，所以這裡只寫內容。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "dist-trial";
const OUT = join(DIR, "taione-care-trial.html");
const html = readFileSync(join(DIR, "index.html"), "utf8");

const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`index.html 找不到${what}`);
  return m[1];
};
const jsPath = pick(/<script[^>]+src="\.?\/?([^"]+\.js)"/, " JS");
const cssPath = pick(/<link[^>]+rel="stylesheet"[^>]+href="\.?\/?(assets\/[^"]+\.css)"/, " CSS");
const fonts = pick(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/, " Google Fonts");

// 內嵌時不能讓字串裡的 </script 或 <!-- 提早結束 <script>。
// U+FFFD（取代字元）在函式庫的字串裡出現時改寫成跳脫序列，避免被當成編碼錯誤。
const js = readFileSync(join(DIR, jsPath), "utf8")
  .replace(/<\/script/gi, "<\\/script")
  .replace(/<!--/g, "<\\!--")
  .replace(/\uFFFD/g, "\\uFFFD");
const css = readFileSync(join(DIR, cssPath), "utf8").replace(/<\/style/gi, "<\\/style");
if (/url\((?!["']?data:)/.test(css)) throw new Error("CSS 還有外部 url()，分享網頁會擋下");

const page = `<title>TaiOne care · We care</title>
<meta name="description" content="居護師 AI 記錄助理試用版：PDF 或錄音一鍵產出護理紀錄、護理計畫與家屬衛教。">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts.replace(/&amp;/g, "&").replace(/&/g, "&amp;")}">
<style>
/* App 的每個畫面自己處理瀏海與底部安全區（sticky 標題、固定底部導覽都加了 env()），
   分享網頁外殼在 :root 加的安全區留白會重複，所以歸零。 */
:root{padding-top:0!important;padding-bottom:0!important}
${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync(OUT, page);
console.log(`${OUT}  ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB`);
