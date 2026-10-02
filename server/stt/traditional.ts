import { toTraditionalSafe } from "../ai/validate";

// 研究發現歷史轉譯工作曾出現簡體字（F-C1）。逐字稿在進入語意分析前一律轉台灣正體；
// 使用「只改真正的簡體字」版本，避免把已是正體的字誤轉（排泄→排洩、干擾→幹擾）。
export function toTraditional(text: string): string {
  return toTraditionalSafe(text);
}
