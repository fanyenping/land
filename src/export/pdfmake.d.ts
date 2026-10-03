/** pdfmake 沒有內建型別；這裡只宣告本專案用到的部分。 */

/** 瀏覽器版（UMD）：只在 careRecordPdf.ts 動態載入，實際介面在那裡描述。 */
declare module "pdfmake/build/pdfmake" {
  const pdfMake: unknown;
  export default pdfMake;
}

/** 伺服器端（Node）版：scripts/render-care-record-sample.ts 使用。 */
declare module "pdfmake" {
  interface PdfMakeServer {
    virtualfs: { writeFileSync(name: string, content: Uint8Array): void };
    addFonts(fonts: Record<string, Record<string, string>>): void;
    setUrlAccessPolicy(callback: (url: string) => boolean): void;
    setLocalAccessPolicy(callback: (path: string) => boolean): void;
    createPdf(doc: Record<string, unknown>): { getBuffer(): Promise<Uint8Array> };
  }
  const pdfmake: PdfMakeServer;
  export default pdfmake;
}
