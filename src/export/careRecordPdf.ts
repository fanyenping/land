import type { CareRecordData, CareRecordRow } from "./types";

/**
 * 照護紀錄 PDF：版面依居家護理所 HIS 匯出的「照護紀錄」（A4 直式）——
 * 第 1 頁封面；第 2 頁起為抬頭、主表格、【生命徵象紀錄】、【發生非計畫性住院】、【個案近期使用急診】，
 * 再加上本 App 產生的【護理計畫】、【家屬衛教】，最後是匯出人員與時間。
 *
 * 字型為 Noto Serif TC（SIL OFL 1.1，見 public/fonts/OFL.txt）：
 * - 內文：Big5 字集子集。WOFF2 必須「不轉換 glyf 表」（--no-glyf-transform），
 *   pdfkit／fontkit 取子集時直接讀 glyf＋loca，轉換過的 WOFF2 會印出空白字。
 * - 粗體：只含版面固定標題的字，所以只有固定字串可以用粗體，資料文字一律用一般字重。
 */

/** public/fonts/ 下的字型檔名。 */
export const FONT_FILES = {
  regular: "NotoSerifTC-Regular-big5.woff2",
  bold: "NotoSerifTC-Bold-labels.woff2",
} as const;

type Node = Record<string, unknown>;
type Content = Node | string;

// A4（pt）。左右邊界相同，封面文字以頁面置中。
const PAGE_W = 595.28;
const MARGIN_X = 40;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 40;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const FONT_SIZE = 10.5;
const LAVENDER = "#E2D9EE";
const EMPTY = "—";

// 表格：0.5pt 黑色細格線；寬度計算需扣掉左右內距與格線。
const PAD_X = 4;
const LINE_W = 0.5;
const GRID = {
  hLineWidth: () => LINE_W,
  vLineWidth: () => LINE_W,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  paddingLeft: () => PAD_X,
  paddingRight: () => PAD_X,
  paddingTop: () => 2.5,
  paddingBottom: () => 2.5,
};

/** 長文（照護紀錄、計畫、衛教）的行距與段落間距。 */
const LONG_LINE_HEIGHT = 1.22;
const PARA_GAP = 8;

/** 欄寬比例 → pdfmake 欄寬（扣掉內距與格線），最後一欄用 "*" 吸收誤差。 */
function columnWidths(ratios: number[]): (number | string)[] {
  const usable = CONTENT_W - ratios.length * PAD_X * 2 - (ratios.length + 1) * LINE_W;
  const total = ratios.reduce((a, b) => a + b, 0);
  return ratios.map((r, i) => (i === ratios.length - 1 ? "*" : Math.round(((usable * r) / total) * 100) / 100));
}

const MAIN_WIDTHS = columnWidths([24.5, 75.5]);
const SIDE_WIDTHS = columnWidths([14.5, 85.5]);
const VITALS_WIDTHS = columnWidths([15.6, 11.6, 11.3, 11.8, 13, 12.8, 13.2, 10.7]);

function show(value: string): string {
  const v = value.trim();
  return v ? v : EMPTY;
}

/**
 * 字型只有 Big5 範圍（全在 BMP）：表情符號與擴充區罕用字改印「□」（否則印出空白、複製出亂碼），
 * 並去掉零寬連接符、異體字選擇符與控制字元。
 */
function clean(text: string): string {
  return text
    .replace(/[\u{10000}-\u{10FFFF}]/gu, "□")
    .replace(/[\u200B-\u200D\u2060\uFE00-\uFE0F]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** 所有資料字串先經 clean()。 */
function cleanData<T>(value: T): T {
  if (typeof value === "string") return clean(value) as T;
  if (Array.isArray(value)) return value.map(cleanData) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanData(v)])) as T;
  }
  return value;
}

/** 標籤格：淡紫底、置中；上下置中只用在不會被拆頁的列，或有「同頁守門」的長內容列（見 longRow）。 */
function labelCell(text: string, id?: string): Node {
  return { text, id, fillColor: LAVENDER, alignment: "center", verticalAlignment: "middle" };
}

function valueCell(value: string): Node {
  return { text: show(value) };
}

/** 多段文字：以空行分段，段內換行保留；中文不需空白也會逐字斷行。 */
function longText(value: string, firstId?: string): Node {
  const paras = value
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t\u3000]*\n/)
    .map((p) => p.replace(/[ \t\u3000]+$/gm, "").replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim());
  if (paras.length === 0) return { text: EMPTY, id: firstId };
  return {
    stack: paras.map((p, i) => ({
      text: p,
      id: i === 0 ? firstId : undefined,
      lineHeight: LONG_LINE_HEIGHT,
      margin: [0, 0, 0, i < paras.length - 1 ? PARA_GAP : 0],
    })),
  };
}

/** 一般列：每列不拆頁（dontBreakRows），標籤可安全上下置中。 */
function rowsTable(widths: (number | string)[], body: Content[][]): Node {
  return { table: { widths, body, dontBreakRows: true }, layout: GRID };
}

/** 緊接在上一張表格下方：上移一條格線寬，讓兩張表的交界只有一條線。 */
function joined(table: Node): Node {
  return { ...table, margin: [0, -LINE_W, 0, 0] };
}

/**
 * 可跨頁的長內容列（照護紀錄、計畫內容、衛教內容）。
 *
 * pdfmake 0.3 的 verticalAlignment 在「整列被擠到下一頁」時會把 save／restore 拆在兩頁（PDF 狀態錯亂）。
 * 因此前面放一個幾乎零高度的守門節點：若標籤或第一段內容沒有和守門節點同頁，
 * pageBreakBefore 就在守門節點前換頁，讓這一列（連同 lead 內容，例如區段標題）從新頁開始。
 */
function longRow(key: string, widths: (number | string)[], label: string, text: string, lead: Content[], join: boolean): Content[] {
  const table: Node = {
    table: { widths, body: [[labelCell(label, `${key}:label`), longText(text, `${key}:first`)]] },
    layout: GRID,
  };
  return [keepNode(key), ...lead, join ? joined(table) : table];
}

/** 守門節點：幾乎零高度、不可見（一個空白字元）。 */
function keepNode(key: string): Node {
  return { text: " ", id: `keep:${key}`, fontSize: 1, lineHeight: 0.01 };
}

/** 【區段標題】：固定字串，粗體。 */
function sectionTitle(text: string): Node {
  return { text, bold: true, fontSize: 11, margin: [0, 30, 0, 9] };
}

function cover(data: CareRecordData): Content[] {
  return [
    {
      // noWrap：讓字距（characterSpacing）作用在整串字上；中文逐字斷詞時字距會被吃掉。
      text: data.title,
      noWrap: true,
      fontSize: 30,
      characterSpacing: 10,
      alignment: "center",
      absolutePosition: { x: MARGIN_X, y: 264 },
    },
    {
      stack: [`個案姓名：${show(data.patientName)}`, `收案日期：${show(data.intakeDate)}`, `機構名稱：${show(data.clinicName)}`],
      fontSize: 12.5,
      lineHeight: 1.45,
      alignment: "center",
      absolutePosition: { x: MARGIN_X, y: 619 },
    },
  ];
}

function mainTable(data: CareRecordData): Content[] {
  const m = data.main;
  const rows: [string, string][] = [
    ["照護日期 / 時間", m.visitDateTime],
    ["紀錄來源", m.source],
    ["身高", m.height],
    ["體重", m.weight],
    ["身體質量指數(BMI)", m.bmi],
    ["臂中圍", m.mac],
    ["小腿圍", m.calf],
    ["居住所", m.residence],
    ["居住區域", m.area],
    ["使用資源", m.resource],
    ["服務項目", m.serviceItems],
  ];
  // 三張欄寬相同的表格上下相接（格線重疊成一條），只有照護紀錄列允許跨頁。
  return [
    rowsTable(MAIN_WIDTHS, rows.map(([label, value]) => [labelCell(label), valueCell(value)])),
    ...longRow("record", MAIN_WIDTHS, "照護紀錄", m.record, [], true),
    joined(rowsTable(MAIN_WIDTHS, [[labelCell("記錄人員"), valueCell(m.recorder)]])),
  ];
}

function vitalsSection(data: CareRecordData): Node {
  const v = data.vitals;
  const table = v
    ? rowsTable(VITALS_WIDTHS, [
        ["量測時間", "體溫", "脈搏", "呼吸", "血壓\n（收縮壓）", "血壓\n（舒張壓）", "血糖", "血氧"].map((t) => labelCell(t)),
        [v.measuredAt, v.temp, v.pulse, v.resp, v.sbp, v.dbp, v.glucose, v.spo2].map((x) => ({
          text: show(x),
          alignment: "center",
          verticalAlignment: "middle",
        })),
      ])
    : rowsTable(["*"], [[{ text: "本次未量測", alignment: "center" }]]);
  // 小表格：標題與表格不分頁。
  return { stack: [sectionTitle("【生命徵象紀錄】"), table], unbreakable: true };
}

function eventSection(key: string, title: string, events: CareRecordRow[], range: string): Content[] {
  const body: Content[][] = [];
  if (events.length === 0) {
    body.push([labelCell("發生時間"), valueCell(range.trim() ? `無（${range.trim()}）` : "無")]);
    body.push([labelCell("發生原因"), valueCell("無")]);
  } else {
    events.forEach((e, i) => {
      body.push([labelCell("發生時間", i === 0 ? `${key}:label` : undefined), { ...valueCell(e.when), id: i === 0 ? `${key}:first` : undefined }]);
      body.push([labelCell("發生原因"), valueCell(e.reason)]);
    });
  }
  const table = rowsTable(SIDE_WIDTHS, body);
  // 事件少時整段不分頁；事件多時每列不拆開，並以守門節點讓標題與第一筆同頁。
  if (events.length <= 3) return [{ stack: [sectionTitle(title), table], unbreakable: true }];
  return [keepNode(key), sectionTitle(title), table];
}

function planSection(plan: NonNullable<CareRecordData["plan"]>): Content[] {
  // 標題＋版本列＋計畫內容開頭一定同頁。
  const lead = [sectionTitle("【護理計畫】"), rowsTable(SIDE_WIDTHS, [[labelCell("計畫版本"), valueCell(plan.version)]])];
  return [
    ...longRow("plan", SIDE_WIDTHS, "計畫內容", plan.text, lead, true),
    joined(rowsTable(SIDE_WIDTHS, [[labelCell("確認人員"), valueCell(plan.confirmedBy)]])),
  ];
}

function eduSection(edu: NonNullable<CareRecordData["edu"]>): Content[] {
  return [
    ...longRow("edu", SIDE_WIDTHS, "衛教內容", edu.text, [sectionTitle("【家屬衛教】")], false),
    joined(rowsTable(SIDE_WIDTHS, [[labelCell("確認人員"), valueCell(edu.confirmedBy)]])),
  ];
}

interface NodeInfo {
  id?: string;
}

/**
 * pdfmake 依 pageBreakBefore 重新排版時，不會清掉上一輪留在表格格子上的 _willBreak／_bottomY
 * （只在 undefined 時才設定），上下置中會沿用舊值而跑位；所以要求換頁前先清掉。
 */
function clearStaleCellState(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(clearStaleCellState);
    return;
  }
  if (!node || typeof node !== "object") return;
  const n = node as Node & { table?: { body?: unknown[][] } };
  delete n._willBreak;
  delete n._bottomY;
  n.table?.body?.forEach((row) => row.forEach(clearStaleCellState));
  if (n.stack) clearStaleCellState(n.stack);
}

/** 守門節點：同頁後面必須有該列的標籤與第一段內容，否則在它之前換頁。 */
function keepTogether(content: Content[]) {
  return (node: NodeInfo, nodes: { getFollowingNodesOnPage: () => NodeInfo[] }): boolean => {
    if (!node.id?.startsWith("keep:")) return false;
    const key = node.id.slice(5);
    const ids = new Set(nodes.getFollowingNodesOnPage().map((n) => n.id));
    if (ids.has(`${key}:label`) && ids.has(`${key}:first`)) return false;
    clearStaleCellState(content);
    return true;
  };
}

/** pdfmake 文件定義（純資料＋版面函式，不碰 DOM；伺服器端與瀏覽器都能用）。 */
export function careRecordDocDefinition(raw: CareRecordData): Record<string, unknown> {
  const data = cleanData(raw);
  const content: Content[] = [
    ...cover(data),
    // 第 2 頁起：抬頭只在第一頁內文出現，續頁直接接表格（同原文件）。
    { text: data.title, fontSize: 16, alignment: "center", pageBreak: "before" },
    {
      stack: [`機構名稱：${show(data.clinicName)}`, `個案姓名：${show(data.patientName)}`],
      lineHeight: 1.2,
      margin: [0, 15, 0, 12],
    },
    ...mainTable(data),
    vitalsSection(data),
    ...eventSection("admissions", "【發生非計畫性住院】", data.admissions, data.eventRange),
    ...eventSection("er", "【個案近期使用急診】", data.erVisits, data.eventRange),
  ];
  if (data.plan) content.push(...planSection(data.plan));
  if (data.edu) content.push(...eduSection(data.edu));
  content.push({
    text: `匯出人員：${show(data.exporter)}　　　　匯出時間：${show(data.exportedAt)}`,
    alignment: "right",
    margin: [0, 18, 0, 0],
  });

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [MARGIN_X, MARGIN_TOP, MARGIN_X, MARGIN_BOTTOM],
    language: "zh-Hant-TW",
    info: {
      title: data.patientName ? `${data.title}－${data.patientName}` : data.title,
      author: data.clinicName,
      creator: "TaiOne care · We care you",
      producer: "TaiOne care · We care you",
    },
    defaultStyle: { font: "Serif", fontSize: FONT_SIZE, lineHeight: 1 },
    header: (): Content | null =>
      data.demo
        ? { text: "示範資料・非真實個案", fontSize: 7.5, color: "#9A9A9A", alignment: "center", margin: [0, 12, 0, 0] }
        : null,
    // 頁碼不含封面：內文第 1 頁起算。
    footer: (currentPage: number, pageCount: number): Content | null =>
      currentPage === 1
        ? null
        : {
            text: `第 ${currentPage - 1} 頁／共 ${pageCount - 1} 頁`,
            fontSize: 8,
            color: "#555555",
            alignment: "center",
            margin: [0, 16, 0, 0],
          },
    pageBreakBefore: keepTogether(content),
    content,
  };
}

// ── 瀏覽器端產生 ──────────────────────────────────────────────

interface PdfMakeBrowser {
  virtualfs: { writeFileSync(name: string, content: Uint8Array): void };
  addFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  createPdf(doc: Record<string, unknown>): { getBlob(): Promise<Blob> };
}

/** pdfmake（約 1 MB）與字型只在第一次導出時載入，之後重用同一份。 */
let pdfMakeReady: Promise<PdfMakeBrowser> | null = null;

async function fetchFont(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("PDF 字型下載失敗，請確認網路連線後再試一次。");
  }
  if (!res.ok) throw new Error(`PDF 字型載入失敗（${res.status}），請稍後再試。`);
  return new Uint8Array(await res.arrayBuffer());
}

async function loadPdfMake(fontUrl: (file: string) => string): Promise<PdfMakeBrowser> {
  const [mod, regular, bold] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    fetchFont(fontUrl(FONT_FILES.regular)),
    fetchFont(fontUrl(FONT_FILES.bold)),
  ]);
  const pdfMake = ((mod as { default?: PdfMakeBrowser }).default ?? mod) as PdfMakeBrowser;
  pdfMake.virtualfs.writeFileSync(FONT_FILES.regular, regular);
  pdfMake.virtualfs.writeFileSync(FONT_FILES.bold, bold);
  pdfMake.addFonts({
    Serif: { normal: FONT_FILES.regular, bold: FONT_FILES.bold, italics: FONT_FILES.regular, bolditalics: FONT_FILES.bold },
  });
  // 文件不引用任何外部資源：一律拒絕網址存取。
  pdfMake.setUrlAccessPolicy(() => false);
  return pdfMake;
}

/** 產生照護紀錄 PDF（瀏覽器）。fontUrl 把字型檔名轉成可下載的網址。 */
export async function renderCareRecordPdf(data: CareRecordData, fontUrl: (file: string) => string): Promise<Blob> {
  if (!pdfMakeReady) {
    pdfMakeReady = loadPdfMake(fontUrl);
    // 失敗時清掉快取，下次可重試。
    pdfMakeReady.catch(() => {
      pdfMakeReady = null;
    });
  }
  const pdfMake = await pdfMakeReady;
  const blob = await pdfMake.createPdf(careRecordDocDefinition(data)).getBlob();
  return blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
}
