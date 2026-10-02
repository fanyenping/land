import * as OpenCC from "opencc-js/cn2t";

// 研究發現歷史轉譯工作曾出現簡體字（F-C1）。所有逐字稿在進入語意分析前
// 一律以 OpenCC 轉為台灣正體（含台灣慣用詞），對已是正體的文字不會改動。
const toTaiwan = OpenCC.Converter({ from: "cn", to: "twp" });

export function toTraditional(text: string): string {
  return toTaiwan(text);
}
