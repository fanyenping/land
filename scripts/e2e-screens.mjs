// 端對端走一遍主要流程並截圖（手機與電腦）。
// 用法：先 `npm run dev`，再 `node scripts/e2e-screens.mjs [輸出資料夾]`
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = process.argv[2] ?? "screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const errors = [];

async function run(name, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile, hasTouch: isMobile, locale: "zh-TW" });
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

try {
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
