import { describe, expect, it } from "vitest";
import { DEMO_PLAN_DICTATION_TEXT } from "./demoTranscript";
import {
  NOT_MENTIONED_SENTENCE,
  UNVERIFIED_MARK,
  assemblePolishedPlan,
  checkDictationFidelity,
  dictationBasisLine,
  finalizePolishedPlanCore,
  hasUnverifiedText,
} from "./planPolish";
import { PLAN_HEADINGS } from "./templates";
import type { DocSection, PolishPlanRequest } from "./types";

const DATE = "2026-10-03";
const req = (dictation: string, over: Partial<PolishPlanRequest> = {}): PolishPlanRequest => ({
  visitDate: DATE,
  dictation,
  familyCallsAs: null,
  hasCurrentPlan: false,
  options: { instructions: [], custom: null },
  ...over,
});

/** 五段（依模板順序）；沒給的段落寫「口述未提及。」 */
const plan = (parts: Partial<Record<0 | 1 | 2 | 3 | 4, string>>): DocSection[] =>
  PLAN_HEADINGS.map((heading, i) => ({ heading, body: parts[i as 0] ?? NOT_MENTIONED_SENTENCE }));

const bodyOf = (sections: DocSection[], heading: string) => sections.find((s) => s.heading === heading)?.body ?? "";

/** 忠實整理示範口述（數字改成阿拉伯數字、語句稍微書面化）：不應該有任何提醒。 */
const FAITHFUL_PROBLEMS = [
  "問題 1：皮膚完整性受損（本次新增）",
  "　依據：左腳背糖尿病足傷口約 3×2 公分，有少許黃色腐肉。",
  "　目標：2 週內傷口不再擴大，周圍不再發紅。",
  "　措施：(1) 每次訪視以生理食鹽水清潔換藥。(2) 教導先生每天觀察傷口有無紅腫、滲液增加。(3) 外出穿包鞋。",
  "問題 2：血糖控制不穩定（本次新增）",
  "　依據：今天飯前血糖 228。",
  "　目標：1 個月內飯前血糖控制在 180 以下。",
  "　措施：(1) 教導先生每天早上飯前驗血糖並記錄。(2) 胰島素依醫師開立的時間施打，不自行調整。",
  "問題 3：有跌倒的危險（本次新增）",
  "　依據：個案走路需扶助行器。",
  "　目標：本月無跌倒。",
  "　措施：(1) 浴室加裝止滑墊。(2) 晚上留小夜燈。(3) 起床先坐一下再站起來。",
];
const faithful = (problems = FAITHFUL_PROBLEMS) =>
  plan({ 2: problems.join("\n"), 3: "先生金水願意協助驗血糖及施打胰島素。", 4: "下次訪視 2 週後，再看傷口及血糖紀錄。" });

describe("assemblePolishedPlan：依模板組成", () => {
  it("依據行在最前面、五段齊全、沒提到的段落寫「口述未提及。」；不加異常值或「未提供病摘」", () => {
    const { sections, warnings } = assemblePolishedPlan(
      [
        { heading: "依據", body: "依據：AI 自己寫的依據行" },
        { heading: "", body: "依據：全人評估" },
        { heading: "護理問題與計畫", body: "護理問題 3：便秘\n　措施：(1) 每天喝水。\n問題 5：疼痛（沿用）" },
        { heading: "五、整體評值與調整", body: "   " },
      ],
      { visitDate: DATE, hasCurrentPlan: false },
    );
    expect(sections.map((s) => s.heading)).toEqual(["", ...PLAN_HEADINGS]);
    expect(sections[0].body).toBe("依據：護理師口述（2026/10/03）");
    expect(sections[0].body).toBe(dictationBasisLine(DATE));
    expect([1, 2, 4, 5].map((i) => sections[i].body)).toEqual(Array(4).fill(NOT_MENTIONED_SENTENCE));
    // 重新連號；沒有現行計畫時，沒有標記的問題標「（本次新增）」，已有標記的不動
    expect(sections[3].body).toBe("問題 1：便秘（本次新增）\n　措施：(1) 每天喝水。\n問題 2：疼痛（沿用）");
    const all = sections.map((s) => s.body).join("\n");
    expect(all).not.toMatch(/本次未評估|異常值|未提供病摘/);
    expect(warnings).toEqual([]);
  });

  it("已有現行計畫時不自動標「本次新增」", () => {
    const { sections } = assemblePolishedPlan([{ heading: "三、護理問題與計畫", body: "問題 2：便秘。\n　目標：每 3 天解便一次。" }], {
      visitDate: DATE,
      hasCurrentPlan: true,
    });
    expect(sections[3].body).toBe("問題 1：便秘。\n　目標：每 3 天解便一次。");
  });

  it("沒有護理問題時提醒；不在模板中的段落保留在最後並提醒，空的丟掉", () => {
    const { sections, warnings } = assemblePolishedPlan(
      [
        { heading: "評估摘要", body: "個案精神可。" },
        { heading: "三、護理問題與計畫", body: "口述未提及" },
        { heading: "備註", body: "家屬下週出國。" },
        { heading: "其他", body: "" },
      ],
      { visitDate: DATE, hasCurrentPlan: false },
    );
    expect(sections.map((s) => s.heading)).toEqual(["", ...PLAN_HEADINGS, "備註"]);
    expect(sections[1].body).toBe("個案精神可。");
    expect(sections[3].body).toBe(NOT_MENTIONED_SENTENCE);
    expect(warnings).toEqual(["口述沒有提到護理問題。", "護理計畫有不在模板中的段落「備註」，請確認內容。"]);
  });
});

describe("finalizePolishedPlanCore：對照口述原文", () => {
  it("忠實的整理（2 週、228、180、3×2 改成數字）沒有任何提醒或標記", () => {
    const { doc, warnings } = finalizePolishedPlanCore({ sections: faithful() }, req(DEMO_PLAN_DICTATION_TEXT));
    expect(warnings).toEqual([]);
    expect(doc.kind).toBe("plan");
    expect(doc.sections.map((s) => s.heading)).toEqual(["", ...PLAN_HEADINGS]);
    expect(doc.sections[0].body).toBe("依據：護理師口述（2026/10/03）");
    expect(doc.sections.some((s) => hasUnverifiedText(s.body))).toBe(false);
  });

  it("口述「要常翻身」被寫成「每 2 小時」：數字標〔待核對〕並提醒", () => {
    const dictation = "第一個問題是皮膚完整性受損，薦骨有壓傷。措施是要常翻身，保持皮膚乾燥。";
    const out = plan({ 2: "問題 1：皮膚完整性受損（本次新增）\n　依據：薦骨有壓傷。\n　措施：(1) 每 2 小時翻身。(2) 保持皮膚乾燥。" });
    const { doc, warnings } = finalizePolishedPlanCore({ sections: out }, req(dictation));
    const three = bodyOf(doc.sections, PLAN_HEADINGS[2]);
    expect(three).toContain(`(1) 每 2${UNVERIFIED_MARK} 小時翻身。`);
    expect(three).toContain("問題 1：皮膚完整性受損（本次新增）"); // 問題編號與 (n) 不算
    expect(three.split(UNVERIFIED_MARK)).toHaveLength(2);
    expect(warnings).toContain("護理計畫「三、護理問題與計畫」有口述沒有的數字「2」，已標〔待核對〕。");
    expect(hasUnverifiedText(three)).toBe(true);
  });

  it("自行推算的日期（2026/10/17）要標記；訪視日期的數字不算", () => {
    const dictation = "第一個問題是便秘。下次訪視兩週後再看排便。";
    const { doc, warnings } = finalizePolishedPlanCore(
      { sections: plan({ 2: "問題 1：便秘", 4: "下次訪視 2026/10/17（2 週後）再看排便。" }) },
      req(dictation),
    );
    expect(bodyOf(doc.sections, PLAN_HEADINGS[4])).toBe(`下次訪視 2026/10/17${UNVERIFIED_MARK}（2 週後）再看排便。`);
    expect(warnings).toEqual(["護理計畫「五、整體評值與調整」有口述沒有的數字「17」，已標〔待核對〕。"]);
  });

  it("口述沒有的藥名與劑量：英文用詞與數字都標記；常用單位與乘號不算", () => {
    const dictation = "第一個問題是疼痛，傷口三乘二公分。措施是吃止痛藥。";
    const { doc, warnings } = finalizePolishedPlanCore(
      { sections: plan({ 2: "問題 1：疼痛\n　依據：傷口 3x2 cm。\n　措施：(1) 服用 Aspirin 100 mg。" }) },
      req(dictation),
    );
    const three = bodyOf(doc.sections, PLAN_HEADINGS[2]);
    expect(three).toContain(`Aspirin${UNVERIFIED_MARK} 100${UNVERIFIED_MARK} mg${UNVERIFIED_MARK}`);
    expect(three).toContain("傷口 3x2 cm。");
    expect(warnings).toContain("護理計畫「三、護理問題與計畫」有口述沒有的用詞「Aspirin」，已標〔待核對〕。");
    expect(warnings).toContain("護理計畫「三、護理問題與計畫」有口述沒有的數字「100」，已標〔待核對〕。");
    expect(warnings.join()).not.toMatch(/「x2」|「cm」|「3」/);
  });

  it("量表分數、分期、風險等級：口述沒說就標記；口述有說（含中文數字）就不標", () => {
    const out = plan({ 0: "身體：Braden 12 分，第 2 期壓傷，跌倒高風險。", 2: "問題 1：壓傷" });
    const invented = finalizePolishedPlanCore({ sections: out }, req("第一個問題是壓傷，薦骨有傷口。"));
    // 片語內的英文、數字標記併到片語後面
    const one = bodyOf(invented.doc.sections, PLAN_HEADINGS[0]);
    expect(one).toBe(`身體：Braden 12 分${UNVERIFIED_MARK}，第 2 期${UNVERIFIED_MARK}壓傷，跌倒高風險${UNVERIFIED_MARK}。`);
    expect(invented.warnings).toContain("護理計畫「一、評估摘要」有口述沒有的用詞「Braden」，已標〔待核對〕。");
    expect(invented.warnings).toContain("護理計畫「一、評估摘要」有口述沒有的數字「12」，已標〔待核對〕。");
    for (const what of ["量表分數", "傷口或疾病分期", "風險分級"]) {
      expect(invented.warnings).toContain(`護理計畫「一、評估摘要」疑似加入口述沒有的${what}，已標〔待核對〕。`);
    }

    const said = finalizePolishedPlanCore({ sections: out }, req("身體方面 Braden 十二分，第二期壓傷，跌倒高風險。第一個問題是壓傷。"));
    expect(said.doc.sections.some((s) => hasUnverifiedText(s.body))).toBe(false);
    expect(said.warnings.join()).not.toMatch(/待核對/);
  });

  it("新增的句子提醒（只提醒、不標記）；「（原句）」不檢查", () => {
    const invented = [...FAITHFUL_PROBLEMS.slice(0, -1), "　措施：(1) 浴室加裝止滑墊。(2) 晚上留小夜燈。(3) 協助個案執行被動關節運動並按摩下肢肌肉。"];
    const { doc, warnings } = finalizePolishedPlanCore({ sections: faithful(invented) }, req(DEMO_PLAN_DICTATION_TEXT));
    // 措施逐項比對：同一行其他兩項是口述原文，也會抓到新增的那一項
    expect(warnings).toEqual(["護理計畫「三、護理問題與計畫」這句在口述中找不到明顯對應，請對照口述原文：「協助個案執行被動關節運動並按摩下肢肌肉。」"]);
    expect(doc.sections.some((s) => hasUnverifiedText(s.body))).toBe(false);

    const quoted = [...FAITHFUL_PROBLEMS, "　評值：協助個案執行被動關節運動並按摩下肢肌肉（原句）。"];
    expect(finalizePolishedPlanCore({ sections: faithful(quoted) }, req(DEMO_PLAN_DICTATION_TEXT)).warnings).toEqual([]);
  });

  it("漏掉口述的段落會提醒", () => {
    const dropped = FAITHFUL_PROBLEMS.filter((l) => !l.includes("止滑墊") && !l.includes("本月無跌倒"));
    const { warnings } = finalizePolishedPlanCore({ sections: faithful(dropped) }, req(DEMO_PLAN_DICTATION_TEXT));
    expect(warnings).toEqual(["口述中這段可能沒有放進計畫：「措施是浴室加止滑墊，晚上留小夜燈，起床先…」"]);
  });

  it("提醒去重，最多 8 則（第 8 則是「另有 n 處」）", () => {
    const nums = Array.from({ length: 10 }, (_, i) => i + 11);
    const out = plan({ 2: `問題 1：便秘\n　措施：(1) ${nums.map((n) => `${n} 次`).join("、")}。(2) ${nums[0]} 次。` });
    const { warnings } = finalizePolishedPlanCore({ sections: out }, req("第一個問題是便秘。"));
    expect(warnings).toHaveLength(8);
    expect(warnings.slice(0, 7)).toEqual(nums.slice(0, 7).map((n) => `護理計畫「三、護理問題與計畫」有口述沒有的數字「${n}」，已標〔待核對〕。`));
    expect(warnings[7]).toBe("另有 3 處提醒，請對照口述原文。");
  });

  it("checkDictationFidelity 只檢查五段內容（不看依據行與多出的段落）", () => {
    const sections: DocSection[] = [{ heading: "", body: "依據：護理師口述（2026/10/03）" }, ...plan({ 2: "問題 1：便秘" }), { heading: "備註", body: "每 8 小時。" }];
    const { sections: out, warnings } = checkDictationFidelity("第一個問題是便秘。", sections, DATE);
    expect(out).toEqual(sections);
    expect(warnings).toEqual([]);
  });

  it("hasUnverifiedText", () => {
    expect(hasUnverifiedText(`每 2${UNVERIFIED_MARK} 小時翻身`)).toBe(true);
    expect(hasUnverifiedText("每 2 小時翻身")).toBe(false);
    expect(hasUnverifiedText("")).toBe(false);
  });
});
