// 端對端走一遍主要流程並截圖（手機與電腦）。
// 用法：先 `npm run dev`，再 `node scripts/e2e-screens.mjs [輸出資料夾]`
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.argv[2] ?? "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const errors = [];

async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile, locale: "zh-TW", ignoreHTTPSErrors: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write", "microphone"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${name}] console: ${m.text()}`));
  const shot = async (label) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: false });
  };
  const full = async (label) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/${name}-${label}-full.png`, fullPage: true });
  };

  await page.goto(`${BASE}/`);
  await page.waitForURL("**/welcome");
  await page.getByPlaceholder("例如 林護理師").fill("林護理師");
  await shot("01-welcome");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "用示範個案開始" }).click();
  await page.waitForURL(`${BASE}/`);
  await page.getByText("今日個案").waitFor();
  await shot("02-today");
  await full("02-today");

  // 個案資料夾
  await page.getByRole("link", { name: "個案" }).first().click();
  await page.getByRole("heading", { name: "個案" }).waitFor();
  await shot("03-patients");

  // 待確認的那位：打開工作台
  await page.getByRole("link", { name: "收尾" }).first().click();
  await page.getByRole("heading", { name: "收尾" }).waitFor();
  await shot("04-queue");
  if (isMobile) {
    await page.locator("a[href^='/v/']").first().click();
  }
  await page.getByText("先看這裡").first().waitFor();
  await shot("05-workspace-review");
  await full("05-workspace-review");

  // 改成建議值、確認異動
  const fix = page.getByRole("button", { name: /^改成/ }).first();
  if (await fix.count()) await fix.click();
  const changes = page.getByRole("button", { name: "異動已確認" }).first();
  if (await changes.count()) await changes.click();
  await page.getByRole("button", { name: /全部確認並複製/ }).first().click();
  await page.waitForTimeout(600);
  await shot("06-workspace-copied");
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  if (!clip.includes("護理紀錄") || !clip.includes("護理計畫")) errors.push(`[${name}] clipboard missing docs: ${clip.slice(0, 80)}`);

  // 回到今天，為陳○蘭開始錄音
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "開始錄音" }).first().click();
  await page.waitForURL("**/rec");
  await page.waitForTimeout(2500);
  await shot("07-recording");
  await page.getByRole("button", { name: "數值速記" }).click();
  await page.getByLabel("體溫").fill("36.8");
  await shot("08-vitals-sheet");
  await page.getByRole("button", { name: "好", exact: true }).click();
  await page.getByRole("button", { name: "完成訪視" }).click();
  await page.waitForURL(/\/v\/[^/]+$/);
  await shot("09-processing");
  await page.getByText(/確認並複製護理紀錄|再複製一次護理紀錄/).first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);
  await shot("10-workspace-new");
  await full("10-workspace-new");

  // 設定
  await page.goto(`${BASE}/settings`);
  await page.getByRole("heading", { name: "設定" }).waitFor();
  await shot("11-settings");

  // 新紀錄面板
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: /新紀錄/ }).first().click();
  await page.getByRole("dialog").waitFor();
  await shot("12-new-record");

  await ctx.close();
}


/** 手機深入操作：各面板與選項都要真的能用。 */
async function deep() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-TW", ignoreHTTPSErrors: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write", "microphone"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[deep] pageerror: ${e.message}`));
  const shot = async (label, fullPage = false) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/deep-${label}.png`, fullPage });
  };
  await page.goto(`${BASE}/welcome`);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "用示範個案開始" }).click();
  await page.getByText("今日個案").waitFor();

  // 新增個案
  await page.getByRole("link", { name: "個案" }).first().click();
  await page.getByRole("button", { name: "新增個案" }).click();
  await page.getByRole("dialog").getByLabel("姓名").fill("周美玉");
  await page.getByRole("dialog").getByPlaceholder("例如 84").fill("79");
  await page.getByRole("dialog").getByRole("radio", { name: "女" }).click();
  await page.getByRole("button", { name: "建立個案" }).click();
  await page.getByText("周○玉").first().waitFor();

  // 個案頁：新增管路、加入今日
  await page.getByText("周○玉").first().click();
  await page.getByRole("button", { name: "新增管路" }).click();
  await page.getByRole("button", { name: "導尿管" }).click();
  await page.getByRole("button", { name: "儲存" }).click();
  await page.getByRole("button", { name: "加入今日" }).click();
  await shot("01-patient-detail", true);

  // 匯入 PDF 到這位個案
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  await page.getByRole("button", { name: "匯入", exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: "選 PDF 檔" }).click()]);
  await chooser.setFiles({ name: "出院病摘.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.waitForURL(/\/v\/[^/]+$/);
  await page.getByText(/確認並複製|再複製一次/).first().waitFor({ timeout: 60_000 });
  await shot("02-pdf-intake", true);

  // 修改 → 版本紀錄
  await page.getByRole("button", { name: "修改" }).first().click();
  const area = page.getByRole("dialog").locator("textarea").first();
  await area.fill((await area.inputValue()) + "（護理師補充）");
  await page.getByRole("button", { name: "完成" }).click();
  await page.getByRole("button", { name: /更多選項/ }).first().click();
  await page.getByRole("button", { name: /版本紀錄/ }).click();
  await shot("03-versions");
  await page.keyboard.press("Escape");

  // 重新產生（已修改 → 新版本可比較）
  await page.getByRole("button", { name: /更多選項/ }).first().click();
  await page.getByRole("button", { name: /^重新產生/ }).click();
  await page.getByRole("button", { name: "更精簡" }).click();
  await page.getByRole("button", { name: "產生新版本" }).click();
  await page.getByText("有新版本可比較").first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "比較" }).first().click();
  await shot("04-compare");
  await page.getByRole("button", { name: "改用新版" }).click();

  // 先看這裡：文件重點對照（若有）
  const docs = page.getByRole("button", { name: "文件重點已對照" }).first();
  if (await docs.count()) await docs.click();
  for (const name of ["異動已確認"]) {
    const btn = page.getByRole("button", { name }).first();
    if (await btn.count()) await btn.click();
  }
  // 衛教：確認中文版後翻譯
  await page.getByRole("button", { name: "翻譯給看護" }).click();
  await page.getByRole("button", { name: "確認中文版" }).click();
  await page.getByRole("button", { name: /翻成印尼文/ }).click();
  await page.getByText("Bahasa Indonesia").first().waitFor({ timeout: 30_000 });
  await shot("05-translate");

  // 照護紀錄導出：補欄位 → 產生 PDF → 下載並檢查內容
  await page.getByRole("button", { name: "照護紀錄導出（PDF）" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("這份 PDF 會包含").waitFor();
  await dlg.getByLabel("身高 cm").fill("155");
  await dlg.getByLabel("身高 cm").press("Tab");
  await dlg.getByLabel("體重 kg").fill("52.3");
  await dlg.getByLabel("體重 kg").press("Tab");
  await dlg.getByRole("button", { name: "在宅(居家)" }).click();
  await dlg.getByRole("radio", { name: "急診" }).click();
  await dlg.getByLabel("發生原因").fill("跌倒送急診，X 光未見骨折後返家。");
  await dlg.getByRole("button", { name: "加入", exact: true }).click();
  await dlg.getByText("跌倒送急診").waitFor();
  await shot("05b-export-form");
  await dlg.getByRole("button", { name: "確認並產生 PDF" }).click();
  await dlg.getByText("PDF 已產生").waitFor({ timeout: 60_000 });
  await shot("05c-export-ready");
  const [dl] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "下載 PDF" }).click()]);
  const pdfPath = `${OUT}/deep-care-record.pdf`;
  await dl.saveAs(pdfPath);
  const bytes = readFileSync(pdfPath);
  if (bytes.subarray(0, 5).toString() !== "%PDF-") errors.push("[deep] export is not a PDF");
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"]).toString();
  for (const want of ["照護紀錄", "周美玉", "生命徵象紀錄", "發生非計畫性住院", "個案近期使用急診", "跌倒送急診", "護理計畫", "家屬衛教", "52.3 kg", "匯出人員"]) {
    if (!text.includes(want)) errors.push(`[deep] PDF missing: ${want}`);
  }
  console.log(`care record PDF: ${(bytes.length / 1024).toFixed(0)} KB, ${(text.match(/\f/g) ?? []).length} pages`);
  await page.keyboard.press("Escape");

  // 設定：深色、大字
  await page.goto(`${BASE}/settings`);
  await page.getByRole("radio", { name: "深色" }).click();
  await page.getByRole("radio", { name: "大字" }).click();
  await shot("06-settings-dark");
  await page.goto(`${BASE}/`);
  await page.getByText("今日個案").waitFor();
  await shot("07-today-dark");
  await page.goto(`${BASE}/patients`);
  await shot("08-patients-dark");
  await ctx.close();
}

try {
  await deep();
  await run("phone", { width: 390, height: 844 }, true);
  await run("desktop", { width: 1440, height: 900 }, false);
} catch (e) {
  errors.push(`FATAL: ${e.message}`);
} finally {
  await browser.close();
}

if (errors.length) {
  console.log("ERRORS:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("OK — screenshots in", OUT);
}
