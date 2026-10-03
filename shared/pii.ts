/** 個資樣式（身分證字號、手機、市話）：AI 寫出的文件一律遮蔽。伺服器的輸出檢核與口述計畫的收尾共用。 */
export const PII: [RegExp, string][] = [
  [/\b[A-Z][12]\d{8}\b/g, "身分證字號"],
  [/(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/g, "手機號碼"],
  [/(?<![\d/])0\d{1,2}-\d{3,4}-\d{4}(?!\d)/g, "電話號碼"],
];

export const PII_MASK = "〔已遮蔽〕";

/** 遮蔽個資，回傳遮蔽後的文字與找到的種類（每次用新的 RegExp，不受 lastIndex 影響）。 */
export function maskPii(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  for (const [re, what] of PII) {
    if (!new RegExp(re.source, re.flags.replace("g", "")).test(out)) continue;
    found.push(what);
    out = out.replace(new RegExp(re.source, re.flags), PII_MASK);
  }
  return { text: out, found };
}
