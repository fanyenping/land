import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  candidateCorrection,
  computeFlag,
  finalizeVitals,
  numbersInText,
  vitalAlertLines,
} from "../../shared/clinical";
import { demoAnalysis, demoGenerate } from "../../shared/demo";
import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../../shared/demoTranscript";
import { EDU_CLOSING, RECORD_HEADINGS, TRANSLATION_PREFIX, parsePlanProblems } from "../../shared/templates";
import type { AnalyzeRequest, GenerateRequest, PatientContext, VitalReading } from "../../shared/types";
import { outputSchema, toAiError } from "./claude";
import { AnalysisOutputSchema, type AnalysisOutput } from "./schemas";
import {
  buildAllowList,
  deepTraditional,
  finalizeAnalysis,
  finalizeDoc,
  finalizeTranslation,
  locateQuote,
  neutralizeVitalNumbers,
  planWarnings,
  polishText,
  toTraditionalSafe,
} from "./validate";

const patient: PatientContext = {
  displayName: "陳○蘭",
  gender: "女",
  age: 84,
  familyCallsAs: "阿嬤",
  diagnoses: ["腦中風後遺症"],
  tubes: [{ name: "鼻胃管", nextDue: null }],
};

const reading = (over: Partial<VitalReading> & Pick<VitalReading, "key" | "value">): VitalReading => ({
  qualifier: null,
  sourceQuote: null,
  sourceMs: null,
  confidence: 0.95,
  status: "ok",
  suggestion: null,
  reason: null,
  flag: null,
  ...over,
});

/* ------------------------------ 繁體 ------------------------------ */

describe("繁體關卡", () => {
  it("簡體轉為台灣正體", () => {
    expect(toTraditionalSafe("护理问题：皮肤完整性受损，伤口渗液，后续追踪")).toBe("護理問題：皮膚完整性受損，傷口滲液，後續追蹤");
  });

  it("不改動正體中文合法使用的字（OpenCC 會誤轉）", () => {
    const ok = "排泄正常，無干擾；台灣居家護理；同意面板；我了解；准許；儀表板";
    expect(toTraditionalSafe(ok)).toBe(ok);
  });

  it("正體文字中夾雜的單一簡體字也會轉換", () => {
    expect(toTraditionalSafe("飯后血糖偏高，持續追踪。")).toBe("飯後血糖偏高，持續追蹤。");
    expect(toTraditionalSafe("这里面有干净的敷料")).toBe("這裡面有乾淨的敷料");
  });

  it("遞迴轉換，原句欄位保持原樣", () => {
    const v = deepTraditional({ text: "伤口", list: ["护理"], sourceQuote: "伤口原句" }, new Set(["sourceQuote"]));
    expect(v).toEqual({ text: "傷口", list: ["護理"], sourceQuote: "伤口原句" });
  });
});

/* ------------------------------ 格式 ------------------------------ */

describe("polishText（K2／K3）", () => {
  it("去 Markdown、條列改「1. 」、全形標點", () => {
    expect(polishText("## 標題\n**重點**:痰多,需觀察\n- 拍背\n- 翻身")).toBe("標題\n重點：痰多，需觀察\n1. 拍背\n2. 翻身");
    expect(polishText("1、拍背\n2）翻身")).toBe("1. 拍背\n2. 翻身");
  });

  it("數字與單位間距、範圍「～」，℃、%、Fr 維持慣例", () => {
    expect(polishText("固定於55公分，抽痰4-5次，床頭30–45度，血壓142/86mmHg，36.3℃，96%，14Fr，第3頁")).toBe(
      "固定於 55 公分，抽痰 4-5 次，床頭 30～45 度，血壓 142/86 mmHg，36.3℃，96%，14Fr，第 3 頁",
    );
  });

  it("用語表與衛教白話", () => {
    expect(polishText("護理診斷：便秘；水分200西西")).toBe("護理問題：便秘；水分 200 毫升");
    expect(polishText("NG 和 Foley 要固定，薦骨傷口", { edu: true })).toBe("鼻胃管 和 尿管 要固定，屁股尾椎附近傷口");
  });

  it("中文括號、子項 (1) 保留半形、不動電話與日期", () => {
    expect(polishText("措施：(1) 翻身(每 2 小時)。電話 03-000-0000，2026/10/16")).toBe("措施：(1) 翻身（每 2 小時）。電話 03-000-0000，2026/10/16");
  });
});

/* ------------------------------ 數值 ------------------------------ */

describe("中文數字雙讀", () => {
  it.each([
    ["體溫十六點八度", [16.8]],
    ["血壓一百四十二之八十六", [142, 86]],
    ["血氧九十六趴", [96]],
    ["飯前血糖一百六", [160]],
    ["水分加兩百西西", [200]],
    ["體溫一六點三", [16.3]],
    ["一百零八下", [108]],
    ["血壓 142/86", [142, 86]],
  ])("%s", (text, nums) => {
    for (const n of nums) expect(numbersInText(text)).toContain(n);
  });
});

describe("finalizeVitals", () => {
  it("不合理範圍 → implausible，唯一候選才給", () => {
    const [t] = finalizeVitals([reading({ key: "temp", value: "16.8", sourceQuote: "體溫十六點八度" })], {});
    expect(t).toMatchObject({ status: "implausible", suggestion: "36.8", reason: "不在 34–42℃ 合理範圍", flag: null });
    const [p] = finalizeVitals([reading({ key: "pulse", value: "8", sourceQuote: "脈搏八下", suggestion: "88" })], {});
    expect(p.status).toBe("implausible");
    expect(p.suggestion).toBeNull();
    const [b] = finalizeVitals([reading({ key: "bp", value: "86/142", sourceQuote: "血壓八十六之一百四十二" })], {});
    expect(b).toMatchObject({ status: "implausible", reason: "收縮壓應高於舒張壓" });
  });

  it("模型說 ok 但值不合理時以程式為準（只升級不降級）", () => {
    const [t] = finalizeVitals([reading({ key: "spo2", value: "9", sourceQuote: "血氧九", status: "ok" })], {});
    expect(t.status).toBe("implausible");
    const [u] = finalizeVitals([reading({ key: "pulse", value: "88", sourceQuote: "脈搏八十八", status: "uncertain", reason: "模型理由" })], {});
    expect(u).toMatchObject({ status: "uncertain", reason: "模型理由" });
  });

  it("沒有原句、原句不含數值、信心低 → 待確認", () => {
    expect(finalizeVitals([reading({ key: "pulse", value: "88" })], {})[0]).toMatchObject({ status: "uncertain", reason: "找不到原句" });
    expect(finalizeVitals([reading({ key: "pulse", value: "88", sourceQuote: "脈搏七十八" })], {})[0].status).toBe("uncertain");
    expect(finalizeVitals([reading({ key: "pulse", value: "88", sourceQuote: "脈搏八十八", confidence: 0.6 })], {})[0]).toMatchObject({
      status: "uncertain",
      reason: "語音辨識信心偏低",
    });
    expect(finalizeVitals([reading({ key: "pulse", value: "88", sourceQuote: "脈搏八十八" })], {}, { highRiskSource: true })[0].status).toBe("uncertain");
  });

  it("同一項兩個值：有復測線索並列，沒有就衝突", () => {
    const retest = finalizeVitals(
      [
        reading({ key: "spo2", value: "96", sourceQuote: "血氧九十六", sourceMs: 1, qualifier: "未使用氧氣" }),
        reading({ key: "spo2", value: "97", sourceQuote: "血氧九十七", sourceMs: 2, qualifier: "拍痰後" }),
      ],
      {},
    );
    expect(retest.map((r) => r.status)).toEqual(["ok", "ok"]);
    const conflict = finalizeVitals(
      [
        reading({ key: "bp", value: "142/86", sourceQuote: "一百四十二之八十六", sourceMs: 1 }),
        reading({ key: "bp", value: "138/84", sourceQuote: "一百三十八之八十四", sourceMs: 2 }),
      ],
      {},
    );
    expect(conflict.map((r) => r.status)).toEqual(["conflict", "conflict"]);
  });

  it("手動值覆蓋語音並保留量測情境", () => {
    const out = finalizeVitals(
      [reading({ key: "glucose", value: "168", sourceQuote: "一百六十八", qualifier: "飯前" }), reading({ key: "temp", value: "16.8", sourceQuote: "十六點八" })],
      { glucose: "128 mg/dL", temp: "36.8", resp: "18" },
    );
    // 手動值通常是更正同一次量測：沿用唯一一筆語音的量測情境（飯前）
    expect(out.find((r) => r.key === "glucose")).toMatchObject({ value: "128", qualifier: "飯前", status: "ok", confidence: 1, sourceQuote: "護理師手動輸入", flag: null });
    expect(out.find((r) => r.key === "temp")).toMatchObject({ value: "36.8", status: "ok", suggestion: null, reason: null });
    expect(out.find((r) => r.key === "resp")?.value).toBe("18");
  });

  it("臨床判讀門檻", () => {
    expect(computeFlag("temp", "37.5", null)).toBe("high");
    expect(computeFlag("temp", "35.4", null)).toBe("low");
    expect(computeFlag("pulse", "101", null)).toBe("high");
    expect(computeFlag("resp", "11", null)).toBe("low");
    expect(computeFlag("bp", "140/80", null)).toBe("high");
    expect(computeFlag("bp", "130/90", null)).toBe("high");
    expect(computeFlag("bp", "88/50", null)).toBe("low");
    expect(computeFlag("spo2", "93", null)).toBe("low");
    expect(computeFlag("spo2", "94", null)).toBe("low");
    expect(computeFlag("spo2", "95", null)).toBeNull();
    expect(computeFlag("glucose", "130", "飯前")).toBe("high");
    expect(computeFlag("glucose", "170", "飯後")).toBeNull();
    expect(computeFlag("glucose", "180", null)).toBe("high");
    expect(computeFlag("glucose", "65", "飯前")).toBe("low");
    expect(computeFlag("temp", "16.8", null)).toBeNull();
  });

  it("唯一候選值（C8）", () => {
    expect(candidateCorrection("temp", "16.8")).toBe("36.8");
    expect(candidateCorrection("temp", "6.3")).toBe("36.3");
    expect(candidateCorrection("pulse", "18")).toBeNull();
    expect(candidateCorrection("spo2", "9")).toBeNull();
  });

  it("數值異常句依上次確認值比較", () => {
    const prev = { date: "2026-09-18", summary: "", findings: [], vitals: [{ key: "bp" as const, value: "132/78", qualifier: null }] };
    expect(vitalAlertLines([{ key: "bp", value: "142/86", qualifier: null }], prev)).toEqual(["血壓 142/86 mmHg，較前次（09/18，132/78 mmHg）上升。"]);
    expect(vitalAlertLines([{ key: "spo2", value: "92", qualifier: null }], null)).toEqual(["血氧 92%，偏低。"]);
    expect(vitalAlertLines([{ key: "pulse", value: "80", qualifier: null }], null)).toEqual([]);
  });
});

/* ------------------------------ 原句 ------------------------------ */

describe("locateQuote", () => {
  const segs = DEMO_SEGMENTS.map((s) => ({ ...s }));
  it("忽略標點與空白；以「……」分段", () => {
    expect(locateQuote("體溫 十六點八度", segs)?.startMs).toBe(70_000);
    expect(locateQuote("我先量生命徵象……脈搏八十八下", segs)?.startMs).toBe(70_000);
  });
  it("模糊比對（相似度 ≥0.9）與找不到", () => {
    expect(locateQuote("鼻胃管今天換新的十四號放在左邊鼻孔固定在五十五公分", segs)?.startMs).toBe(330_000);
    expect(locateQuote("體溫三十六點八度", segs)).toBeNull();
  });
});

/* ------------------------------ 分析 ------------------------------ */

function analyzeReq(over: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    visitDate: "2026-10-02",
    patient,
    transcript: { text: "", segments: DEMO_SEGMENTS.map((s) => ({ ...s })), durationMs: DEMO_DURATION_MS, provider: "azure" },
    documents: [],
    typedVitals: {},
    notes: null,
    previous: null,
    currentPlan: "護理問題 1：便秘",
    ...over,
  };
}

const empty: AnalysisOutput = {
  summary: "",
  speakers: [],
  vitals: [],
  findings: [],
  tubes: [],
  wounds: [],
  interventions: [],
  changes: [],
  planSuggestions: [],
  educationTopics: [],
  redFlags: [],
  docFacts: [],
  documents: [],
  conflicts: [],
  identityConcern: null,
  missingDomains: [],
  languageNotes: [],
};

const out = (over: Partial<AnalysisOutput>): AnalysisOutput => AnalysisOutputSchema.parse({ ...empty, ...over });

describe("finalizeAnalysis", () => {
  const v = (o: Partial<AnalysisOutput["vitals"][number]> & Pick<AnalysisOutput["vitals"][number], "key" | "value">) => ({
    qualifier: null,
    sourceQuote: null,
    sourceMs: null,
    confidence: 0.9,
    status: "ok" as const,
    suggestion: null,
    reason: null,
    ...o,
  });

  it("補 id、講者、原句時間、程式檢核與到期日", () => {
    const a = finalizeAnalysis(
      out({
        summary: "换鼻胃管",
        speakers: [{ id: "S1", role: "護理師" }],
        vitals: [
          v({ key: "temp", value: "16.8", sourceQuote: "體溫十六點八度", sourceMs: 12_345, status: "ok" }),
          v({ key: "pulse", value: "88", sourceQuote: "脈搏八十八下", sourceMs: 70_000 }),
          v({ key: "resp", value: "20", sourceQuote: "呼吸二十次", sourceMs: 70_000 }),
        ],
        tubes: [{ name: "鼻胃管", detail: "今日更換，14Fr", changedToday: true, nextDue: null }],
        changes: [{ kind: "new", text: "痰液增加", evidence: "痰比較多" }],
        planSuggestions: [
          { problem: "呼吸道清除功能失效", basis: "痰多" },
          { problem: "便秘", basis: "3 天未解便" },
        ],
        docFacts: [{ category: "用藥", text: "Metformin 500 mg", page: 3, unclear: false }],
        findings: [{ domain: "呼吸", text: "痰液增加", sourceQuote: "黃黃的，有點黏", sourceMs: 1, origin: "audio" }],
      }),
      analyzeReq(),
    );
    expect(a.summary).toBe("換鼻胃管");
    expect(a.speakers).toEqual({ S1: "護理師" });
    expect(a.vitals[0]).toMatchObject({ key: "temp", status: "implausible", suggestion: "36.8", sourceMs: 70_000 });
    expect(a.vitals[1]).toMatchObject({ status: "ok", sourceMs: 70_000 });
    expect(a.vitals[2]).toMatchObject({ status: "uncertain", reason: "逐字稿中找不到原句，請核對", sourceMs: 70_000 });
    expect(a.findings[0].sourceMs).toBe(32_000);
    expect(a.tubes[0].nextDue).toBe("2026-11-01");
    expect(a.changes[0].id).toBe("c1");
    expect(a.planSuggestions.map((s) => s.problem)).toEqual(["呼吸道清除功能失效"]);
    expect(a.docFacts[0].id).toBe("d1");
    expect(a.conflicts).toEqual([]);
  });

  it("只有文件時，文件數值不進今日生命徵象；手動值保留", () => {
    const a = finalizeAnalysis(
      out({ vitals: [v({ key: "bp", value: "150/88", sourceQuote: "BP 150/88" })], missingDomains: ["疼痛"] }),
      analyzeReq({ transcript: null, typedVitals: { pulse: "76" } }),
    );
    expect(a.vitals.map((r) => [r.key, r.value])).toEqual([["pulse", "76"]]);
    expect(a.missingDomains).toEqual([]);
  });

  it("身分疑慮：模型沒提時由程式補上", () => {
    const a = finalizeAnalysis(out({}), analyzeReq({ patient: { ...patient, gender: "男" } }));
    expect(a.identityConcern).toContain("阿嬤");
  });

  it("數值與上次差很多時加入評估異動", () => {
    const a = finalizeAnalysis(
      out({ vitals: [v({ key: "pulse", value: "88", sourceQuote: "脈搏八十八下" })] }),
      analyzeReq({ previous: { date: "2026-09-18", summary: "", findings: [], vitals: [{ key: "pulse", value: "60", qualifier: null }] } }),
    );
    expect(a.changes).toEqual([expect.objectContaining({ kind: "better", text: "脈搏由 60 次/分 變為 88 次/分（較前次 09/18）" })]);
  });
});

/* ------------------------------ 數字白名單 ------------------------------ */

describe("neutralizeVitalNumbers（N2）", () => {
  const allow = buildAllowList(
    [
      { key: "bp", value: "142/86", qualifier: null },
      { key: "spo2", value: "97", qualifier: "拍痰後" },
    ],
    { date: "2026-09-18", summary: "", findings: [], vitals: [{ key: "bp", value: "132/78", qualifier: null }] },
    ["09/27 血壓 150/88 mmHg"],
  );

  it("找不到依據的數值改為〔見生命徵象〕", () => {
    const r = neutralizeVitalNumbers("今日體溫 16.8 度，脈搏 90 次/分，血壓 160/95 mmHg。", allow);
    expect(r.text).toBe("今日體溫〔見生命徵象〕，脈搏〔見生命徵象〕，血壓〔見生命徵象〕。");
    expect(r.leaks).toEqual(["16.8 度", "90 次/分", "160/95 mmHg"]);
  });

  it("確認值、上次值、文件值、門檻、範圍與其他數字不動", () => {
    const ok = [
      "血壓 142/86 mmHg，較前次（09/18，132/78 mmHg）上升。",
      "拍背後血氧 97%，呼吸音較清楚。",
      "文件紀錄的生命徵象（09/27）：血壓 150/88 mmHg。",
      "發燒超過 38 度、體溫超過 38℃ 請就醫。",
      "目標：飯前血糖維持在 80～130 mg/dL。",
      "灌食時床頭搖高 30～45 度，每 2 小時翻身，呼吸訓練 3 次。",
      "鼻胃管 14Fr，固定於 55 公分；下次更換 2026/11/01。",
    ].join("\n");
    const r = neutralizeVitalNumbers(ok, allow);
    expect(r.leaks).toEqual([]);
    expect(r.text).toBe(ok);
  });
});

/* ------------------------------ 撰寫輸出 ------------------------------ */

function genReq(over: Partial<GenerateRequest> = {}): GenerateRequest {
  const analysis = demoAnalysis({ ...analyzeReq(), previous: null, currentPlan: null, transcript: { ...analyzeReq().transcript!, provider: "demo" } });
  return {
    kind: "record",
    visitDate: "2026-10-02",
    patient,
    analysis,
    confirmedVitals: [
      { key: "temp", value: "36.8", qualifier: null },
      { key: "bp", value: "142/86", qualifier: null },
      { key: "glucose", value: "168", qualifier: "飯前" },
    ],
    currentPlan: null,
    adoptedSuggestions: [],
    options: { recordStyle: "four", instructions: [], custom: null, nurseName: "林護理師", clinicPhone: "03-000-0000" },
    intakeOnly: false,
    ...over,
  };
}

describe("finalizeDoc（⑦ 輸出檢核）", () => {
  it("護理紀錄：程式產生數值異常句、去掉 AI 自寫的數值句、補缺段並提醒", () => {
    const { doc, warnings } = finalizeDoc(
      {
        sections: [
          { heading: "一、今日護理事項及照護重點", body: "**個案**臥床,陳○蘭由女兒陪伴。體溫16.8度。" },
          { heading: "二、異常值提醒", body: "1. 血壓偏高\n2. 痰液增加，呈黃色黏稠" },
          { heading: "四、總結與後續追蹤", body: "持續追蹤。" },
        ],
      },
      genReq(),
    );
    expect(doc.sections.map((s) => s.heading)).toEqual([...RECORD_HEADINGS]);
    expect(doc.sections[0].body).toBe("個案臥床，個案由女兒陪伴。體溫〔見生命徵象〕。");
    expect(doc.sections[1].body).toBe("1. 血壓 142/86 mmHg，偏高。\n2. 飯前血糖 168 mg/dL，偏高。\n3. 痰液增加，呈黃色黏稠");
    expect(doc.sections[2].body).toBe("本次未評估。");
    expect(warnings.some((w) => w.includes("16.8 度"))).toBe(true);
  });

  it("沒有數值異常且都已確認：「本次生命徵象未見異常。」", () => {
    const req = genReq({ confirmedVitals: [{ key: "pulse", value: "80", qualifier: null }] });
    req.analysis = { ...req.analysis, vitals: req.analysis.vitals.filter((v) => v.key === "pulse") };
    const { doc } = finalizeDoc({ sections: [{ heading: "二、異常值提醒", body: "" }] }, req);
    expect(doc.sections[1].body).toBe("本次生命徵象未見異常。");
  });

  it("家屬衛教：固定結語放最後且只出現一次、不含署名、白話、遮蔽電話", () => {
    const { doc, warnings } = finalizeDoc(
      {
        sections: [
          { heading: "", body: "今天護理師幫阿嬤換了 NG。" },
          { heading: "一、今天要注意的事", body: "1. 薦骨的傷口要乾淨。" },
          { heading: "二、每天可以這樣照顧", body: "1. 每 2 小時翻身。" },
          { heading: "三、出現這些情況，請馬上聯絡護理師或就醫", body: `1. 發燒超過 38 度。\n${EDU_CLOSING}` },
          { heading: "", body: `${EDU_CLOSING}\n林護理師 0912-345-678` },
        ],
      },
      genReq({ kind: "edu" }),
    );
    const all = doc.sections.map((s) => s.body).join("\n");
    expect(doc.sections.at(-1)).toEqual({ heading: "", body: EDU_CLOSING });
    expect(all.split(EDU_CLOSING)).toHaveLength(2);
    expect(all).toContain("鼻胃管");
    expect(all).toContain("屁股尾椎附近");
    expect(all).not.toMatch(/0912|林護理師/);
    expect(warnings).toEqual([]);
    const stray = finalizeDoc({ sections: [{ heading: "", body: "開場" }, { heading: "", body: "多出來的一段" }] }, genReq({ kind: "edu" }));
    expect(stray.warnings.some((w) => w.includes("不在模板中"))).toBe(true);
  });

  it("護理計畫：依據行、異常值行由程式產生；沿用內容需逐字保留", () => {
    const current = "問題 1：皮膚完整性受損（沿用）\n　目標：一個月內傷口縮小。\n　措施：(1) 每次訪視換藥。(2) 每 2 小時翻身。";
    const { doc, warnings } = finalizeDoc(
      {
        sections: [
          { heading: "依據", body: "AI 自己寫的依據" },
          { heading: "一、評估摘要", body: "身體：臥床。\n心理：本次未評估。\n社會：女兒照顧。\n靈性：本次未評估。" },
          { heading: "二、疾病診斷與異常值", body: "慢性（依個案資料）：腦中風後遺症。\n異常值：血壓 180/100 mmHg" },
          { heading: "三、護理問題與計畫", body: "問題 2：皮膚完整性受損（沿用）\n　目標：兩週內傷口縮小。\n　措施：(1) 每次訪視換藥。\n問題 5：便秘（本次新增）\n　依據：3 天未解便。" },
          { heading: "四、病人與家庭參與", body: "女兒負責聯絡。" },
          { heading: "五、整體評值與調整", body: "問題 1 沿用；新增問題 2。" },
        ],
      },
      genReq({ kind: "plan", currentPlan: current }),
    );
    expect(doc.sections[0]).toEqual({ heading: "", body: "依據：2026/10/02 訪視評估" });
    expect(doc.sections[2].body).toBe("慢性（依個案資料）：腦中風後遺症。\n異常值：2026/10/02 血壓 142/86 mmHg、飯前血糖 168 mg/dL。");
    expect(doc.sections[3].body).toMatch(/^問題 1：皮膚完整性受損（沿用）[\s\S]*\n問題 2：便秘（本次新增）/);
    expect(warnings.some((w) => w.includes("沿用內容與現行計畫原文不一致"))).toBe(true);
    expect(planWarnings(current, current)).toEqual([]);
  });

  it("收案紀錄：資料來源行由程式產生", () => {
    const req = genReq({ intakeOnly: true });
    req.analysis = { ...req.analysis, documents: [{ title: "出院病歷摘要", date: "2026-09-28", pages: 8, patientHint: null }] };
    const { doc } = finalizeDoc({ sections: [{ heading: "一、個案背景與照護需求", body: "依病摘：臥床。" }] }, req);
    expect(doc.sections[0]).toEqual({ heading: "", body: "資料來源：出院病歷摘要（2026/09/28，共 8 頁）" });
    expect(doc.sections).toHaveLength(5);
  });

  it("示範輸出經過檢核後不變、沒有提醒", () => {
    const a = demoAnalysis({ ...analyzeReq(), transcript: { ...analyzeReq().transcript!, provider: "demo" }, previous: null, currentPlan: null });
    const confirmed = a.vitals.map((v) => ({ key: v.key, value: v.suggestion ?? v.value, qualifier: v.qualifier }));
    for (const kind of ["record", "plan", "edu"] as const) {
      for (const recordStyle of ["four", "narrative"] as const) {
        const req = genReq({ kind, analysis: a, confirmedVitals: confirmed, adoptedSuggestions: ["s1"], options: { ...genReq().options, recordStyle } });
        const demo = demoGenerate(req);
        const { doc, warnings } = finalizeDoc(demo, req);
        expect(warnings, `${kind}/${recordStyle}`).toEqual([]);
        expect(doc, `${kind}/${recordStyle}`).toEqual(demo);
      }
    }
  });
});

describe("計畫解析", () => {
  it("相容舊版與 §8.2 格式，並帶入調整新增的措施", () => {
    const p = parsePlanProblems("問題 1：皮膚完整性受損（沿用）\n　目標：一個月內縮小。\n　措施：(1) 換藥。(2) 翻身。\n　調整：新增措施 (3) 鬧鐘提醒。");
    expect(p).toEqual([{ title: "皮膚完整性受損", tag: "沿用", basis: null, goal: "一個月內縮小。", measures: ["換藥。", "翻身。", "鬧鐘提醒。"] }]);
  });
});

describe("翻譯輸出", () => {
  it("統一加上語言標示行，去掉模型自加的", () => {
    expect(finalizeTranslation(TRANSLATION_PREFIX.id, "【Bahasa Indonesia｜AI 翻譯】\nHalo  \n")).toBe(`${TRANSLATION_PREFIX.id}\nHalo`);
  });
});

/* ------------------------------ Claude 呼叫 ------------------------------ */

describe("structured outputs schema", () => {
  it("保留 enum，物件不允許額外欄位且全部必填", () => {
    const s = outputSchema(AnalysisOutputSchema) as { properties: Record<string, any>; additionalProperties: boolean; required: string[] };
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toContain("vitals");
    const item = s.properties.vitals.items;
    expect(item.properties.key.enum).toEqual(["temp", "pulse", "resp", "bp", "spo2", "glucose", "consciousness"]);
    expect(item.properties.status.enum).toEqual(["ok", "uncertain", "implausible", "conflict"]);
    expect(item.additionalProperties).toBe(false);
    expect(JSON.stringify(s)).not.toMatch(/"\$schema"|minimum|maximum|"\$ref"/);
  });
});

describe("toAiError", () => {
  const api = (status: number, type = "api_error") =>
    Anthropic.APIError.generate(status, { type: "error", error: { type, message: "x" } }, "x", new Headers());
  it.each([
    [api(429, "rate_limit_error"), "ai_busy", true],
    [api(529, "overloaded_error"), "ai_busy", true],
    [api(500), "ai_busy", true],
    [api(400, "invalid_request_error"), "ai_bad_request", false],
    [api(401, "authentication_error"), "ai_auth", false],
    [api(404, "not_found_error"), "ai_config", false],
    [api(413, "request_too_large"), "ai_too_large", false],
    [new Anthropic.APIConnectionError({ message: "x" }), "ai_unreachable", true],
    [new Anthropic.APIConnectionTimeoutError(), "ai_timeout", true],
    [new Anthropic.APIUserAbortError(), "ai_cancelled", true],
    [new Anthropic.AnthropicError("parse"), "ai_bad_output", true],
  ])("%#", (err, code, retryable) => {
    expect(toAiError(err)).toMatchObject({ code, retryable });
  });
  it("非 AI 錯誤回傳 null", () => {
    expect(toAiError(new Error("x"))).toBeNull();
  });
});

describe("收案計畫", () => {
  it("只有文件時保留依文件寫的異常值行", () => {
    const { doc } = finalizeDoc(
      { sections: [{ heading: "二、疾病診斷與異常值", body: "慢性（依出院病歷摘要 2026/09/28 照錄）：高血壓。\n異常值：依文件 09/27 血壓 150/88 mmHg。" }] },
      genReq({ kind: "plan", intakeOnly: true, confirmedVitals: [], analysis: demoAnalysis({ ...analyzeReq(), transcript: null, documents: [{ name: "a.pdf", mimeType: "application/pdf", data: "JVBERi0=" }] }) }),
    );
    expect(doc.sections[2].body).toBe("慢性（依出院病歷摘要 2026/09/28 照錄）：高血壓。\n異常值：依文件 09/27 血壓 150/88 mmHg。");
    expect(doc.sections[0].body).toBe("依據：出院病歷摘要（2026/09/28）");
  });
});
