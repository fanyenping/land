import { describe, expect, it } from "vitest";
import { demoAnalysis, demoGenerate, demoTranslate } from "./demo";
import { DEMO_ASSESSMENT } from "./demoAssessment";
import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "./demoTranscript";
import { EDU_CLOSING, EDU_HEADINGS, INTAKE_HEADINGS, PLAN_HEADINGS, PLAN_MAX_PROBLEMS, RECORD_HEADINGS, TRANSLATION_PREFIX, parsePlanProblems } from "./templates";
import type { Analysis, AnalyzeRequest, GenerateRequest, PatientContext, PreviousVisit, TranslateLang } from "./types";

const patient: PatientContext = {
  displayName: "陳○蘭",
  gender: "女",
  age: 84,
  familyCallsAs: "阿嬤",
  diagnoses: ["腦中風後遺症", "高血壓", "第二型糖尿病"],
  tubes: [
    { name: "鼻胃管", nextDue: "2026-10-02" },
    { name: "導尿管", nextDue: "2026-10-20" },
  ],
};

const previous: PreviousVisit = {
  date: "2026-09-18",
  summary: "飯前血糖偏高；薦骨壓傷換藥，滲液少量",
  vitals: [
    { key: "temp", value: "36.6", qualifier: null },
    { key: "bp", value: "132/78", qualifier: null },
    { key: "glucose", value: "142", qualifier: "飯前" },
  ],
  findings: ["痰液少量白色", "排便兩天一次"],
};

const PLAN_V3 = `護理問題 1：皮膚完整性受損（薦骨壓傷）
相關因素：長期臥床、翻身頻率不足
護理目標：兩週內傷口面積縮小，周圍皮膚無新發紅
護理措施：
1. 每次訪視評估傷口大小、滲液與周圍皮膚
2. 指導家屬與看護每兩小時翻身並記錄
評值：傷口滲液減少，持續追蹤

護理問題 2：營養不均衡（少於身體需要）
相關因素：吞嚥困難、經鼻胃管灌食
護理目標：一個月內體重維持不下降
護理措施：
1. 確認灌食配方與每日總量
2. 灌食時床頭抬高 30–45 度，灌後維持 30 分鐘
評值：家屬可正確執行灌食`;

const transcript = { text: "", segments: DEMO_SEGMENTS.map((s) => ({ ...s })), durationMs: DEMO_DURATION_MS, provider: "demo" };

function analyzeReq(over: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    visitDate: "2026-10-02",
    patient,
    transcript,
    documents: [],
    typedVitals: {},
    notes: null,
    previous,
    currentPlan: PLAN_V3,
    ...over,
  };
}

function genReq(analysis: Analysis, over: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    kind: "record",
    visitDate: "2026-10-02",
    patient,
    analysis,
    confirmedVitals: analysis.vitals.map((v) => ({ key: v.key, value: v.suggestion ?? v.value, qualifier: v.qualifier })),
    currentPlan: PLAN_V3,
    adoptedSuggestions: [],
    options: { recordStyle: "four", instructions: [], custom: null, nurseName: "林護理師", clinicPhone: "03-000-0000" },
    intakeOnly: false,
    previous,
    ...over,
  };
}

const text = (doc: { sections: { heading: string; body: string }[] }) => doc.sections.map((s) => `${s.heading}\n${s.body}`).join("\n");
const chars = (s: string) => s.replace(/\s/g, "").length;

describe("demoAnalysis：示範逐字稿", () => {
  const a = demoAnalysis(analyzeReq());

  it("體溫 16.8 標為不合理，唯一候選 36.8", () => {
    const temp = a.vitals.find((v) => v.key === "temp")!;
    expect(temp).toMatchObject({ value: "16.8", status: "implausible", suggestion: "36.8", reason: "不在 34–42℃ 合理範圍", flag: null });
    expect(temp.sourceQuote).toBe("體溫十六點八度");
  });

  it("其他數值有原句、時間對到段落起點，並有臨床判讀", () => {
    const starts = new Set(DEMO_SEGMENTS.map((s) => s.startMs));
    for (const v of a.vitals) {
      expect(v.sourceQuote, v.key).toBeTruthy();
      expect(DEMO_SEGMENTS.some((s) => s.text.includes(v.sourceQuote!))).toBe(true);
      expect(starts.has(v.sourceMs!)).toBe(true);
    }
    expect(a.vitals.find((v) => v.key === "bp")).toMatchObject({ value: "142/86", status: "ok", flag: "high" });
    expect(a.vitals.find((v) => v.key === "glucose")).toMatchObject({ value: "168", qualifier: "飯前", status: "ok", flag: "high" });
    const spo2 = a.vitals.filter((v) => v.key === "spo2");
    expect(spo2.map((v) => [v.value, v.qualifier, v.status])).toEqual([
      ["96", "未使用氧氣", "ok"],
      ["97", "拍痰後", "ok"],
    ]);
    expect(a.vitals.find((v) => v.key === "consciousness")?.value).toContain("可喚醒");
  });

  it("兩項評估異動、計畫建議、缺漏領域", () => {
    expect(a.changes.map((c) => [c.kind, c.text])).toEqual([
      ["new", "痰液增加、黃黏，每日抽痰 4～5 次"],
      ["new", "3 天未解便、腹脹"],
    ]);
    expect(a.planSuggestions.map((s) => s.problem)).toEqual(["呼吸道清除功能失效", "便秘"]);
    expect(a.planSuggestions[0].basis).toContain("右下肺痰音");
    expect(a.missingDomains).toEqual(["疼痛"]);
    expect(a.languageNotes).toEqual([]);
    expect(a.identityConcern).toBeNull();
    expect(a.tubes.find((t) => t.name === "鼻胃管")).toMatchObject({ changedToday: true, nextDue: "2026-11-01" });
  });

  it("id 不重複", () => {
    const ids = [...a.changes, ...a.planSuggestions, ...a.docFacts].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("沒有上次訪視就沒有異動；現行計畫已有的問題不再建議", () => {
    expect(demoAnalysis(analyzeReq({ previous: null })).changes).toEqual([]);
    const plan = `${PLAN_V3}\n\n護理問題 3：便秘`;
    expect(demoAnalysis(analyzeReq({ currentPlan: plan })).planSuggestions.map((s) => s.problem)).toEqual(["呼吸道清除功能失效"]);
  });

  it("手動輸入勝過語音", () => {
    const b = demoAnalysis(analyzeReq({ typedVitals: { temp: "36.8", bp: "150/92" } }));
    expect(b.vitals.filter((v) => v.key === "temp")).toEqual([
      expect.objectContaining({ value: "36.8", status: "ok", confidence: 1, sourceQuote: "護理師手動輸入", sourceMs: null, suggestion: null }),
    ]);
    expect(b.vitals.find((v) => v.key === "bp")).toMatchObject({ value: "150/92", status: "ok", flag: "high", sourceQuote: "護理師手動輸入" });
  });

  it("稱謂與性別不符時提出身分疑慮", () => {
    const b = demoAnalysis(analyzeReq({ patient: { ...patient, gender: "男" } }));
    expect(b.identityConcern).toContain("阿嬤");
  });
});

describe("demoAnalysis：文件", () => {
  const doc = { name: "出院病摘.pdf", mimeType: "application/pdf", data: "JVBERi0=" };

  it("錄音＋文件：加入文件重點與摘要", () => {
    const a = demoAnalysis(analyzeReq({ documents: [doc] }));
    expect(a.documents).toEqual([{ title: "出院病歷摘要", date: "2026-09-28", pages: 8, patientHint: "84 歲 女" }]);
    expect(a.docFacts.filter((f) => f.unclear)).toHaveLength(2);
    expect(a.docFacts.find((f) => f.category === "過敏")?.text).toBe("文件未載明");
    expect(a.docFacts.filter((f) => f.category === "診斷").map((f) => f.text)).toContain("第二型糖尿病");
  });

  it("只有文件：收案整理，沒有今日數值與異動", () => {
    const a = demoAnalysis(analyzeReq({ transcript: null, documents: [doc], previous: null, currentPlan: null }));
    expect(a.vitals).toEqual([]);
    expect(a.changes).toEqual([]);
    expect(a.interventions).toEqual([]);
    expect(a.findings.every((f) => f.origin === "document")).toBe(true);
    expect(a.documents).toHaveLength(1);
  });

  it("不是示範錄音時不編造內容", () => {
    const other = { text: "", segments: [{ startMs: 0, endMs: 1000, text: "阿公早安，今天血壓一百三。", speaker: "S1" }], durationMs: 1000, provider: "azure" };
    const a = demoAnalysis(analyzeReq({ transcript: other }));
    expect(a.vitals).toEqual([]);
    expect(a.findings).toEqual([]);
    expect(a.languageNotes[0]).toContain("示範模式");
    expect(a.identityConcern).toContain("阿公");
  });
});

describe("demoGenerate", () => {
  const a = demoAnalysis(analyzeReq());

  it("護理紀錄四段式：標題、數值異常句、內文無量測值", () => {
    const doc = demoGenerate(genReq(a));
    expect(doc.sections.map((s) => s.heading)).toEqual([...RECORD_HEADINGS]);
    const [s1, s2, s3, s4] = doc.sections.map((s) => s.body);
    expect(s2.split("\n").slice(0, 2)).toEqual([
      "1. 血壓 142/86 mmHg，較前次（09/18，132/78 mmHg）上升。",
      "2. 飯前血糖 168 mg/dL，較前次（09/18，142 mg/dL）上升。",
    ]);
    for (const body of [s1, s3, s4]) expect(body).not.toMatch(/36\.8|16\.8|142\/86|168|88 次|97%|96%/);
    expect(s3).toContain("下次更換 2026/11/01");
    expect(s4).toContain("下次訪視 2026/10/16");
    expect(chars(doc.sections.map((s) => s.body).join(""))).toBeLessThanOrEqual(600);
  });

  it("沒有異常時寫「本次生命徵象未見異常。」", () => {
    const doc = demoGenerate(genReq(a, { confirmedVitals: [{ key: "pulse", value: "80", qualifier: null }], previous: null }));
    const pending = doc.sections[1].body;
    expect(pending.startsWith("本次生命徵象未見異常。")).toBe(false); // 其他數值尚待確認時不下結論
    const all = demoGenerate(
      genReq(a, {
        analysis: { ...a, vitals: a.vitals.filter((v) => v.key === "pulse") },
        confirmedVitals: [{ key: "pulse", value: "80", qualifier: null }],
        previous: null,
      }),
    );
    expect(all.sections[1].body.split("\n")[0]).toBe("本次生命徵象未見異常。");
  });

  it("敘述式只有「訪視紀錄」一段；改成條列與更精簡", () => {
    const narrative = demoGenerate(genReq(a, { options: { ...genReq(a).options, recordStyle: "narrative" } }));
    expect(narrative.sections.map((s) => s.heading)).toEqual(["訪視紀錄"]);
    expect(narrative.sections[0].body).toContain("至案家訪視");
    const list = demoGenerate(genReq(a, { options: { ...genReq(a).options, instructions: ["改成條列"] } }));
    expect(list.sections[0].body.split("\n").every((l) => /^\d+\. /.test(l))).toBe(true);
    const short = demoGenerate(genReq(a, { options: { ...genReq(a).options, instructions: ["更精簡"] } }));
    expect(chars(text(short))).toBeLessThan(chars(text(demoGenerate(genReq(a)))));
  });

  it("收案紀錄：資料來源行與四段，沒有「今日」", () => {
    const doc = demoAnalysis(analyzeReq({ transcript: null, documents: [{ name: "x.pdf", mimeType: "application/pdf", data: "JVBERi0=" }], previous: null, currentPlan: null }));
    const rec = demoGenerate(genReq(doc, { intakeOnly: true, confirmedVitals: [], currentPlan: null, previous: null }));
    expect(rec.sections.map((s) => s.heading)).toEqual(["", ...INTAKE_HEADINGS]);
    expect(rec.sections[0].body).toBe("資料來源：出院病歷摘要（2026/09/28，共 8 頁）");
    expect(text(rec)).not.toContain("今日");
    expect(rec.sections[4].body).toContain("字跡不清");
  });

  it("護理計畫：沿用＋本次評值，採用的建議為本次新增，未採用的不寫", () => {
    const plan = demoGenerate(genReq(a, { kind: "plan", adoptedSuggestions: ["s1"] }));
    expect(plan.sections.map((s) => s.heading)).toEqual(["", ...PLAN_HEADINGS]);
    expect(plan.sections[0].body).toBe("依據：2026/10/02 訪視評估");
    const problems = plan.sections[3].body;
    expect(problems).toContain("問題 1：皮膚完整性受損（薦骨壓傷）（沿用）");
    expect(problems).toContain("　目標：兩週內傷口面積縮小，周圍皮膚無新發紅。");
    expect(problems).toContain("問題 3：呼吸道清除功能失效（本次新增）");
    expect(problems).not.toContain("便秘");
    expect(plan.sections[2].body).toContain("異常值：2026/10/02 血壓 142/86 mmHg、飯前血糖 168 mg/dL。");
    expect(plan.sections[1].body.split("\n").map((l) => l.slice(0, 3))).toEqual(["身體：", "心理：", "社會：", "靈性："]);
    expect(plan.sections[5].body).toBe("問題 1 沿用並調整措施；問題 2 沿用；新增問題 3。");
  });

  it("沒有現行計畫時擬定第 1 版", () => {
    const plan = demoGenerate(genReq(a, { kind: "plan", currentPlan: null, adoptedSuggestions: ["呼吸道清除功能失效", "便秘"] }));
    expect(plan.sections[5].body).toBe("首次擬定，下次訪視評值。");
    expect((plan.sections[3].body.match(/（本次新增）/g) ?? []).length).toBe(4);
  });

  it("家屬衛教：結構、固定結語、不含署名、白話、400 字內", () => {
    const edu = demoGenerate(genReq(a, { kind: "edu" }));
    const headings = edu.sections.map((s) => s.heading);
    expect(headings).toEqual(["", EDU_HEADINGS.attention, EDU_HEADINGS.daily, EDU_HEADINGS.tubes, EDU_HEADINGS.redFlags, ""]);
    expect(edu.sections.at(-1)).toEqual({ heading: "", body: EDU_CLOSING });
    const all = text(edu);
    expect(all).not.toMatch(/林護理師|03-000-0000|薦骨|\bNG\b|Foley|導尿管/);
    expect(all).toContain("阿嬤");
    expect(chars(edu.sections.map((s) => s.body).join(""))).toBeLessThanOrEqual(400);
    expect(edu.sections[3].body).toContain("11 月 1 日");
  });

  it("家屬衛教的快速指示：更精簡、家屬更好懂", () => {
    const base = demoGenerate(genReq(a, { kind: "edu" }));
    const short = demoGenerate(genReq(a, { kind: "edu", options: { ...genReq(a).options, instructions: ["更精簡"] } }));
    const simple = demoGenerate(genReq(a, { kind: "edu", options: { ...genReq(a).options, instructions: ["家屬更好懂"] } }));
    expect(chars(text(short))).toBeLessThan(chars(text(base)));
    expect(simple.sections[2].body.split("\n").length).toBeGreaterThan(base.sections[2].body.split("\n").length);
  });
});

describe("demoGenerate：全人評估（初次訪視）", () => {
  const first = demoAnalysis(analyzeReq({ previous: null, currentPlan: null }));
  const firstReq = (over: Partial<GenerateRequest> = {}) =>
    genReq(first, { kind: "plan", currentPlan: null, previous: null, visitKind: "first", assessment: DEMO_ASSESSMENT, ...over });

  it("依評估風險擬定問題，與逐字稿的同類問題合併，依據引用分數，最多 5 題", () => {
    const plan = demoGenerate(firstReq());
    expect(plan.sections.map((s) => s.heading)).toEqual(["", ...PLAN_HEADINGS]);
    expect(plan.sections[0].body).toBe("依據：全人評估（13 項）及 2026/10/02 訪視評估");
    const problems = parsePlanProblems(plan.sections[3].body);
    expect(problems.map((p) => p.title)).toEqual(["皮膚完整性受損（薦骨壓傷）", "營養不均衡（少於身體需要）", "自我照顧能力缺失", "記憶障礙", "衰弱"]);
    expect(problems).toHaveLength(PLAN_MAX_PROBLEMS);
    expect(problems.every((p) => p.tag === "本次新增")).toBe(true);
    expect(problems.map((p) => p.basis?.split("；")[0])).toEqual([
      "Braden 11 分（高危險）",
      "MNA-SF 5 分（營養不良）",
      "ADL 10 分（完全依賴）",
      "SPMSQ 5 分（中度障礙）",
      "Fried 5 項（衰弱）",
    ]);
    // 合併的問題保留今天的事實
    expect(problems[0].basis).toContain("薦骨壓傷約 2×1.5 公分");
    expect(problems[1].basis).toContain("過去三個月體重減輕 1～3 公斤");
    expect(problems.every((p) => p.goal && p.measures.length >= 2)).toBe(true);
    // 未達門檻的表不列（跌倒 15 分、疼痛 2 分、情緒 3 分）
    expect(plan.sections[3].body).not.toMatch(/跌倒的危險|疼痛（本次新增）|焦慮/);
  });

  it("「五」說明首次擬定，並列出超過題數而未列入的問題", () => {
    const summary = demoGenerate(firstReq()).sections[5].body.split("\n");
    expect(summary[0]).toBe("初次訪視，依全人評估及本次訪視評估首次擬定，下次訪視評值。");
    expect(summary[1]).toBe("超過 5 題未列入：藥物使用安全（藥物安全評估）、有吸入的危險（鼻胃管灌食），請護理師決定是否納入。");
    // 沒有評估的初次訪視也說明是首次擬定
    expect(demoGenerate(firstReq({ assessment: null })).sections[5].body).toBe("初次訪視，首次擬定，下次訪視評值。");
  });

  it("評估摘要附上分數重點；已採用的建議照常列入", () => {
    const plan = demoGenerate(firstReq({ assessment: "Braden 壓傷 12分（高危險）：活動能力 臥床\n認知 4分（輕度障礙）", adoptedSuggestions: ["呼吸道清除功能失效"] }));
    const [body, mind] = plan.sections[1].body.split("\n");
    expect(body).toMatch(/。依全人評估，Braden 12 分（高危險）。$/);
    expect(mind).toMatch(/。依全人評估，SPMSQ 4 分（輕度障礙）。$/);
    expect(parsePlanProblems(plan.sections[3].body).map((p) => p.title)).toEqual([
      "皮膚完整性受損（薦骨壓傷）",
      "記憶障礙",
      "有吸入的危險（鼻胃管灌食）",
      "呼吸道清除功能失效",
    ]);
    expect(plan.sections[0].body).toBe("依據：全人評估（2 項）及 2026/10/02 訪視評估");
  });

  it("再次訪視（已有計畫）：評估只當背景，不自動新增問題，在「五」提醒", () => {
    const a = demoAnalysis(analyzeReq());
    const plan = demoGenerate(genReq(a, { kind: "plan", visitKind: "follow", assessment: DEMO_ASSESSMENT }));
    const before = demoGenerate(genReq(a, { kind: "plan" }));
    expect(plan.sections[3].body).toBe(before.sections[3].body);
    expect(plan.sections[5].body.split("\n")[0]).toBe(before.sections[5].body);
    expect(plan.sections[5].body).toContain("全人評估另有風險，現行計畫未涵蓋：自我照顧能力缺失（ADL 10 分）、記憶障礙（SPMSQ 5 分）、衰弱（Fried 5 項）、藥物使用安全（藥物安全評估）");
    // 現行計畫已有的同類問題（壓傷、營養）不再提醒
    expect(plan.sections[5].body).not.toMatch(/Braden|MNA-SF/);
  });

  it("只有文件（收案）時評值寫待首次訪視評估", () => {
    const intake = demoAnalysis(analyzeReq({ transcript: null, documents: [{ name: "a.pdf", mimeType: "application/pdf", data: "JVBERi0=" }], previous: null, currentPlan: null }));
    const plan = demoGenerate(genReq(intake, { kind: "plan", currentPlan: null, intakeOnly: true, confirmedVitals: [], visitKind: "first", assessment: DEMO_ASSESSMENT }));
    expect(plan.sections[0].body).toBe("依據：全人評估（13 項）、出院病歷摘要（2026/09/28）");
    expect(plan.sections[3].body).toContain("問題 1：皮膚完整性受損（薦骨壓傷）（本次新增）\n　依據：Braden 11 分（高危險）；依病摘第 5 頁有薦骨壓傷");
    expect(plan.sections[3].body).toContain("評值：待首次訪視評估。");
  });

  it("沒有評估時輸出不變；護理紀錄與衛教不受評估影響", () => {
    for (const kind of ["record", "plan", "edu"] as const) {
      const plain = demoGenerate(genReq(first, { kind, currentPlan: null }));
      expect(demoGenerate(genReq(first, { kind, currentPlan: null, assessment: null, visitKind: "follow" })), kind).toEqual(plain);
      if (kind !== "plan") expect(demoGenerate(genReq(first, { kind, currentPlan: null, assessment: DEMO_ASSESSMENT, visitKind: "first" })), kind).toEqual(plain);
    }
  });
});

describe("demoTranslate", () => {
  const a = demoAnalysis(analyzeReq());
  const edu = demoGenerate(genReq(a, { kind: "edu" }));
  const zh = `【給家屬的照顧小叮嚀】2026/10/02\n${edu.sections.map((s) => (s.heading ? `${s.heading}\n${s.body}` : s.body)).join("\n\n")}\n\n安心居家護理所　林護理師　電話：03-000-0000`;

  it.each(["id", "vi", "th"] as TranslateLang[])("%s：標示行、全文翻譯、含固定結語", (lang) => {
    const out = demoTranslate({ text: zh, lang });
    const lines = out.split("\n");
    expect(lines[0]).toBe(TRANSLATION_PREFIX[lang]);
    expect(lines[1]).toMatch(/02\/10\/2026$/);
    // 除了機構名稱與人名，不應留下中文
    const leftover = out.split("\n").slice(1).filter((l) => /[一-鿿]/.test(l) && !l.includes("03-000-0000"));
    expect(leftover).toEqual([]);
    expect(out).toContain("03-000-0000");
  });

  it("示範以外的句子保留中文並註明", () => {
    const out = demoTranslate({ text: "請記得每天量血壓。", lang: "id" });
    expect(out).toContain("Mode demo");
    expect(out).toContain("請記得每天量血壓。");
  });
});
