import { describe, expect, it } from "vitest";
import { demoPolishPlan, localPolishPlan, normalizeDictation } from "./demoPolish";
import { DEMO_PLAN_DICTATION_TEXT, demoPlanTranscript } from "./demoTranscript";
import { NOT_MENTIONED_SENTENCE } from "./planPolish";
import { PLAN_HEADINGS } from "./templates";
import type { DocSection, PolishPlanRequest } from "./types";

const req = (dictation: string, over: Partial<PolishPlanRequest> = {}): PolishPlanRequest => ({
  visitDate: "2026-10-03",
  dictation,
  familyCallsAs: null,
  hasCurrentPlan: false,
  options: { instructions: [], custom: null },
  ...over,
});

const bodyOf = (sections: DocSection[], heading: string) => sections.find((s) => s.heading === heading)?.body ?? "";

/** e2e 的打字口述（scripts/e2e-screens.mjs）。 */
const E2E_TEXT = "問題一 皮膚完整性受損，目標兩週內傷口不擴大，措施每次訪視換藥，教女兒每兩小時翻身。家屬的部分，女兒願意學換藥。下次訪視再評值傷口。";

/** 打字或貼上的口述樣本（含半形標點、贅詞、換行、她／他、沒有問題標記）。 */
const SAMPLES: [string, Partial<PolishPlanRequest>][] = [
  [E2E_TEXT, {}],
  ["個案這週食慾比較差，體重好像有掉。要少量多餐，每天量體重。下次訪視再看體重。", {}],
  ["呃 診斷是糖尿病跟高血壓.第一個問題 便秘,沿用.然後目標是每三天解便一次;措施是多喝水,順時鐘按摩肚子.評值是下次看排便紀錄.", { hasCurrentPlan: true }],
  [
    "第一個護理問題是呼吸道清除功能失效，最近痰比較多。目標調整成一週內痰量減少。措施是每天拍背三次，抽痰前先拍背。女兒願意學拍背。第二個問題是營養不足，體重一個月掉兩公斤。目標是體重不要再掉。措施是請營養師評估。追蹤體重變化。",
    { hasCurrentPlan: true },
  ],
  ["問題1：疼痛\n他說膝蓋很痛，晚上睡不好\n目標：一週內疼痛降到三分以下\n措施：熱敷，教家屬按摩\n評值：下次訪視問疼痛分數", {}],
];

const STRIP = /[\s，。、；：！？,.;:!?「」（）()]/g;

/** 計畫內容切成片段：去掉標籤、標記與標點（「口述未提及。」不算）。 */
function fragments(sections: DocSection[]): string[] {
  return sections
    .filter((s) => (PLAN_HEADINGS as readonly string[]).includes(s.heading))
    .flatMap((s) => s.body.split(/\(\d+\)|[。\n]/))
    .map((f) =>
      f
        .replace(/（(?:沿用|調整|本次新增)）/g, "")
        .replace(/^\s*問題 \d+：/, "")
        .replace(/^\s*(?:依據|目標|措施|評值)：/, "")
        .replace(/^\s*\d+\.\s*/, "")
        .replace(STRIP, ""),
    )
    .filter((f) => f && f !== "口述未提及");
}

describe("normalizeDictation", () => {
  it("去贅詞、修同音錯字、半形標點轉全形（數字中間除外）、句首她／他改「個案」、整理空白", () => {
    expect(normalizeDictation("嗯，護理計畫我口述一下。她今天翻生兩次，然後呢換要。")).toBe("個案今天翻身兩次，換藥。");
    expect(normalizeDictation("體溫36.8度,血壓142/86;時間10:30.")).toBe("體溫36.8度，血壓142/86；時間10:30。");
    expect(normalizeDictation("他們很配合。他說\r\n她們  會 幫忙")).toBe("他們很配合。個案說\n她們 會 幫忙");
    expect(normalizeDictation("驗雪糖，就是說要記錄")).toBe("驗血糖，要記錄");
  });
});

describe("demoPolishPlan：示範口述（高○珍）", () => {
  const { doc, warnings } = localPolishPlan(req(DEMO_PLAN_DICTATION_TEXT));
  const all = doc.sections.map((s) => s.body).join("\n");
  const three = bodyOf(doc.sections, PLAN_HEADINGS[2]);

  it("依據行與五段；一、二口述未提及", () => {
    expect(doc.sections.map((s) => s.heading)).toEqual(["", ...PLAN_HEADINGS]);
    expect(doc.sections[0].body).toBe("依據：護理師口述（2026/10/03）");
    expect(bodyOf(doc.sections, PLAN_HEADINGS[0])).toBe(NOT_MENTIONED_SENTENCE);
    expect(bodyOf(doc.sections, PLAN_HEADINGS[1])).toBe(NOT_MENTIONED_SENTENCE);
  });

  it("三個問題依口述順序編號，第 1 版全部標本次新增；依據、目標、措施分開", () => {
    expect(three.split("\n").filter((l) => l.startsWith("問題"))).toEqual([
      "問題 1：皮膚完整性受損（本次新增）",
      "問題 2：血糖控制不穩定（本次新增）",
      "問題 3：有跌倒的危險（本次新增）",
    ]);
    expect(three).toContain("　依據：個案走路要扶助行器。");
    expect(three).toContain("　措施：(1) 浴室加止滑墊。(2) 晚上留小夜燈。(3) 起床先坐一下再站起來。");
    expect(three).toContain("　目標：兩週內傷口不要再變大，周圍不要再紅。");
    // 「不要自己調整」不是這題要調整
    expect(three).toContain("　措施：(1) 教先生每天早上飯前驗血糖並且記錄。(2) 胰島素照醫師開的時間打。(3) 不要自己調整。");
  });

  it("同音錯字修正、家屬分工、下次訪視；沒有贅詞", () => {
    expect(all).not.toContain("雪糖");
    expect(bodyOf(doc.sections, PLAN_HEADINGS[3])).toBe("先生金水願意幫忙驗血糖和打胰島素。");
    expect(bodyOf(doc.sections, PLAN_HEADINGS[4]).startsWith("下次訪視")).toBe(true);
    expect(all).not.toMatch(/嗯|我口述一下/);
  });

  it("數字不改寫，收尾檢查沒有任何提醒", () => {
    expect(three).toContain("兩百二十八");
    expect(three).toContain("三乘二公分");
    expect(warnings).toEqual([]);
  });

  it("示範口述逐字稿：一段、護理師、示範", () => {
    const t = demoPlanTranscript();
    expect(t).toMatchObject({ text: DEMO_PLAN_DICTATION_TEXT, durationMs: 72_000, provider: "demo" });
    expect(t.segments).toEqual([{ startMs: 0, endMs: 72_000, speaker: "S1", text: DEMO_PLAN_DICTATION_TEXT, confidence: 0.9 }]);
  });
});

describe("demoPolishPlan：只輸出口述的片段", () => {
  it.each([[DEMO_PLAN_DICTATION_TEXT, {}] as [string, Partial<PolishPlanRequest>], ...SAMPLES])("每個片段都在正規化後的口述中：%s", (text, over) => {
    const source = normalizeDictation(text).replace(STRIP, "");
    const { sections } = demoPolishPlan(req(text, over));
    const frags = fragments(sections);
    expect(frags.length).toBeGreaterThan(0);
    for (const f of frags) expect(source, f).toContain(f);
    expect(sections.map((s) => s.body).join("\n")).not.toMatch(/嗯|呃|然後/);
  });

  it("e2e 打字口述：目標與措施分開，家屬與下次訪視各自歸段", () => {
    const { doc, warnings } = localPolishPlan(req(E2E_TEXT));
    expect(bodyOf(doc.sections, PLAN_HEADINGS[2])).toBe(
      "問題 1：皮膚完整性受損（本次新增）\n　目標：兩週內傷口不擴大。\n　措施：(1) 每次訪視換藥。(2) 教女兒每兩小時翻身。",
    );
    expect(bodyOf(doc.sections, PLAN_HEADINGS[3])).toBe("女兒願意學換藥。");
    expect(bodyOf(doc.sections, PLAN_HEADINGS[4])).toBe("下次訪視再評值傷口。");
    expect(warnings).toEqual([]);
  });

  it("沒有問題標記：內容依序編號放在三", () => {
    const { sections } = demoPolishPlan(req(SAMPLES[1][0]));
    expect(bodyOf(sections, PLAN_HEADINGS[0])).toBe(NOT_MENTIONED_SENTENCE);
    expect(bodyOf(sections, PLAN_HEADINGS[2])).toBe("1. 個案這週食慾比較差，體重好像有掉。\n2. 要少量多餐，每天量體重。");
    expect(bodyOf(sections, PLAN_HEADINGS[4])).toBe("下次訪視再看體重。");
  });

  it("已有現行計畫：口述說沿用／調整才標；診斷歸二、評值歸題目", () => {
    const a = demoPolishPlan(req(SAMPLES[2][0], SAMPLES[2][1])).sections;
    expect(bodyOf(a, PLAN_HEADINGS[1])).toBe("診斷是糖尿病跟高血壓。");
    expect(bodyOf(a, PLAN_HEADINGS[2])).toBe(
      "問題 1：便秘（沿用）\n　目標：每三天解便一次。\n　措施：(1) 多喝水。(2) 順時鐘按摩肚子。\n　評值：下次看排便紀錄。",
    );
    const b = bodyOf(demoPolishPlan(req(SAMPLES[3][0], SAMPLES[3][1])).sections, PLAN_HEADINGS[2]);
    expect(b.split("\n").filter((l) => l.startsWith("問題"))).toEqual(["問題 1：呼吸道清除功能失效（調整）", "問題 2：營養不足"]);
    const c = bodyOf(demoPolishPlan(req(SAMPLES[4][0])).sections, PLAN_HEADINGS[2]);
    expect(c).toBe("問題 1：疼痛（本次新增）\n　依據：個案說膝蓋很痛，晚上睡不好。\n　目標：一週內疼痛降到三分以下。\n　措施：(1) 熱敷。(2) 教家屬按摩。\n　評值：下次訪視問疼痛分數。");
  });
});
