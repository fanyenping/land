/**
 * 照護紀錄導出（PDF）的資料：版面依居家護理所 HIS 匯出的「照護紀錄」拆解（docs/04-care-record-export.md），
 * 再加上本 App 產生的護理計畫與家屬衛教。所有欄位都已是要印出的文字，PDF 版面只負責排版。
 */
export interface CareRecordRow {
  /** 例如「2026-09-16，小夜（16：00～24：00）」。 */
  when: string;
  reason: string;
}

export interface CareRecordData {
  /** 封面與每頁抬頭的「照護紀錄」。 */
  title: string;
  clinicName: string;
  /** 正式紀錄用全名（App 畫面上才遮罩）。 */
  patientName: string;
  /** 收案日期 YYYY-MM-DD；沒有就留空。 */
  intakeDate: string;

  /** 主表格（左欄標籤、右欄內容），依原文件順序。 */
  main: {
    /** 照護日期／時間：「2026-10-03，10:50～11:20」。 */
    visitDateTime: string;
    /** 紀錄來源：家訪、電訪… */
    source: string;
    height: string; // 「152 cm」或空字串
    weight: string; // 「36.4 kg」
    bmi: string; // 「15.8 kg/m²」
    mac: string; // 臂中圍「20.5 cm」
    calf: string; // 小腿圍「27 cm」
    residence: string; // 居住所：在宅(居家)
    area: string; // 居住區域：臺北市文山區
    resource: string; // 使用資源：健保第六類
    serviceItems: string; // 服務項目：留置鼻胃管護理、…
    /** 照護紀錄欄：本 App 的護理紀錄全文（段落以空行分隔）。 */
    record: string;
    recorder: string; // 記錄人員
  };

  /** 【生命徵象紀錄】一列；沒有量測時為 null（版面印「本次未量測」）。值已含單位，未測為「—」。 */
  vitals: {
    measuredAt: string; // 「2026-10-03 10:50」
    temp: string; // 「36.8°C」
    pulse: string; // 「88bpm」
    resp: string; // 「18次/分」
    sbp: string; // 「142mmHg」
    dbp: string; // 「86mmHg」
    glucose: string; // 「168mg/dL」
    spo2: string; // 「96%」
  } | null;

  /** 【發生非計畫性住院】、【個案近期使用急診】；空陣列時版面印「無」。 */
  admissions: CareRecordRow[];
  erVisits: CareRecordRow[];
  /** 事件的查詢範圍說明，例如「2026-09-03 至 2026-10-03」（印在空白時的「無」旁）。 */
  eventRange: string;

  /** 【護理計畫】（本 App 產生）；沒有內容時為 null（整段不印）。 */
  plan: { version: string; text: string; confirmedBy: string } | null;
  /** 【家屬衛教】（本 App 產生）。 */
  edu: { text: string; confirmedBy: string } | null;

  exporter: string; // 匯出人員
  exportedAt: string; // 「2026/10/3 下午 02:15:08」
  /** 示範資料：每頁抬頭加註，避免被當成真實紀錄。 */
  demo: boolean;
}
