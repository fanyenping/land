/**
 * 產生照護紀錄 PDF 範例（虛構資料），用來檢查版面。
 *
 *   npx tsx scripts/render-care-record-sample.ts out.pdf            完整範例（示範資料）
 *   npx tsx scripts/render-care-record-sample.ts out.pdf --minimal  未量測、無事件、無計畫與衛教
 *
 * 使用 pdfmake 的伺服器端 API 與 public/fonts/ 的 WOFF2 字型（與瀏覽器版相同的文件定義）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pdfmake from "pdfmake";
import { careRecordDocDefinition, FONT_FILES } from "../src/export/careRecordPdf";
import type { CareRecordData } from "../src/export/types";

const RECORD = `生命徵象：體溫36.6°C、脈搏82次/分、呼吸18次/分、血壓138/84mmHg、血氧97%，飯後兩小時血糖186mg/dL。
意識：清醒，可正確回答人、時、地；GCS：E4V5M6。
呼吸型態：平順，雙側呼吸音清晰，無使用輔助呼吸肌；偶有咳嗽，痰液少量、白色稀薄，可自咳。
皮膚完整性：薦骨處第二期壓力性損傷，大小約2.0×1.5cm，傷口基部粉紅、少量漿液性滲液，周圍皮膚無紅腫熱痛。

管路：留置導尿管（16Fr，上次更換為2026-06-01），尿液淡黃清澈、無沉澱物，今日依常規予以更換，過程順利，個案無不適主訴。鼻胃管固定於鼻翼55cm處，反抽胃內容物約5ml、無咖啡色殘渣，管路通暢。
營養：每日灌食配方奶6餐，每餐250ml，另給予溫開水共約1,500ml/天；本週體重較上次訪視下降0.6kg，與家屬討論後建議每日增加一餐並於下次訪視再評估。

傷口處理：以生理食鹽水清潔傷口後覆蓋親水性敷料，教導主要照顧者（女兒）觀察敷料滲液量與周圍皮膚變化，滲液超過敷料一半面積或出現異味時需提早更換並聯絡居家護理所。協助調整翻身時間表，建議白天每兩小時翻身一次並使用減壓床墊，坐輪椅時間每次不超過一小時。

用藥：遵醫囑每日服用降血壓藥與降血糖藥，家屬已使用分裝藥盒，今日核對藥盒內容與處方相符。家屬表示上週曾漏給一次晚餐後藥物，已再次說明按時給藥的重要性，並建議於手機設定提醒。

心理社會：個案情緒平穩，可與家屬簡單對談；主要照顧者表示夜間睡眠常中斷、感到疲累，已提供喘息服務申請資訊並轉介長照個管師評估。下次訪視預計於兩週後，屆時再評估傷口癒合情形、體重變化與照顧者負荷。`;

const PLAN = `一、皮膚完整性受損（薦骨第二期壓力性損傷）
目標：四週內傷口面積縮小一半，傷口周圍無感染徵象。
措施：每次訪視測量並記錄傷口大小；教導家屬每兩小時翻身、使用減壓床墊；以親水性敷料覆蓋並視滲液量更換。

二、營養不均衡：少於身體需要（體重持續下降）
目標：一個月內體重回升至少0.5kg。
措施：每日灌食由6餐增為7餐；每兩週測量體重、臂中圍與小腿圍；必要時轉介營養師調整配方。

三、潛在危險性感染（留置導尿管）
目標：訪視期間無泌尿道感染徵象。
措施：每月更換導尿管；教導會陰清潔與尿袋低於膀胱位置；觀察尿液顏色、量與性狀。

四、血糖控制不穩定
目標：飯後血糖維持於180mg/dL以下。
措施：教導家屬每日測量並記錄血糖；核對用藥與灌食時間；血糖高於300mg/dL或低於70mg/dL時立即聯絡。

五、照顧者角色緊張
目標：照顧者能說出至少兩項可運用的支持資源。
措施：提供喘息服務與長照資源資訊；轉介長照個管師；每次訪視評估照顧者負荷。`;

const EDU = `王先生的家人您好：
這次訪視發現屁股（薦骨）的傷口比上次稍微小一點，表示翻身與傷口照顧有效果，請繼續保持。

一、翻身：白天每兩小時翻身一次，晚上至少每三小時一次；翻身後檢查骨頭突出處皮膚有沒有變紅。
二、傷口：敷料滲液超過一半、有異味或周圍皮膚紅腫發熱時，請提早更換並打電話給我們。
三、灌食：每天增加一餐，灌食時床頭搖高30度以上，灌完後維持半小時再躺平。
四、尿管：尿袋要低於膀胱，不要拉扯或壓到管子；尿液變混濁、有血絲或發燒超過38°C，請立即聯絡。
五、血糖：每天固定時間測量並寫在記錄本上，數值太高或太低請先打電話詢問。

照顧家人很辛苦，也請您照顧好自己的身體，有任何問題都可以隨時與我們聯絡。`;

const FULL: CareRecordData = {
  title: "照護紀錄",
  clinicName: "安心居家護理所",
  patientName: "王小明",
  intakeDate: "2026-03-02",
  main: {
    visitDateTime: "2026-06-15，09:30～10:20",
    source: "家訪",
    height: "165 cm",
    weight: "52.4 kg",
    bmi: "19.2 kg/m²",
    mac: "23.0 cm",
    calf: "29.5 cm",
    residence: "在宅(居家)",
    area: "臺北市大安區",
    resource: "健保居家護理",
    serviceItems: "留置導尿管護理、留置鼻胃管護理、第二期壓力性損傷傷口護理",
    record: RECORD,
    recorder: "林護理師",
  },
  vitals: {
    measuredAt: "2026-06-15 09:40",
    temp: "36.6°C",
    pulse: "82bpm",
    resp: "18次/分",
    sbp: "138mmHg",
    dbp: "84mmHg",
    glucose: "186mg/dL",
    spo2: "97%",
  },
  admissions: [{ when: "2026-05-28，大夜（00：00～08：00）", reason: "個案因發燒、尿液混濁至醫院急診，診斷為泌尿道感染收住院治療，五天後出院返家。" }],
  erVisits: [{ when: "2026-05-28，大夜（00：00～08：00）", reason: "個案發燒至38.7°C且尿液混濁，家屬送醫院急診就醫。" }],
  eventRange: "2026-05-16 至 2026-06-15",
  plan: { version: "第 2 版（2026/06/15 更新）", text: PLAN, confirmedBy: "林護理師" },
  edu: { text: EDU, confirmedBy: "林護理師" },
  exporter: "林護理師",
  exportedAt: "2026/6/15 上午 11:05:12",
  demo: true,
};

const MINIMAL: CareRecordData = {
  ...FULL,
  intakeDate: "",
  main: { ...FULL.main, height: "", weight: "", bmi: "", mac: "", calf: "", record: RECORD.split("\n\n").slice(0, 2).join("\n\n") },
  vitals: null,
  admissions: [],
  erVisits: [],
  plan: null,
  edu: null,
  demo: false,
};

const out = process.argv[2];
if (!out) {
  console.error("用法：npx tsx scripts/render-care-record-sample.ts <out.pdf> [--minimal]");
  process.exit(1);
}
const data = process.argv.includes("--minimal") ? MINIMAL : FULL;

const fontsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public/fonts");
for (const file of Object.values(FONT_FILES)) pdfmake.virtualfs.writeFileSync(file, readFileSync(resolve(fontsDir, file)));
pdfmake.addFonts({
  Serif: { normal: FONT_FILES.regular, bold: FONT_FILES.bold, italics: FONT_FILES.regular, bolditalics: FONT_FILES.bold },
});
// 字型已放進虛擬檔案系統：不需要讀本機檔案或下載網址。
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(() => false);

const started = Date.now();
const buffer = await pdfmake.createPdf(careRecordDocDefinition(data)).getBuffer();
writeFileSync(out, buffer);
console.log(`${out}: ${buffer.length.toLocaleString()} bytes, ${Date.now() - started} ms`);
