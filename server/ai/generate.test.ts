import { describe, expect, it } from "vitest";
import { demoAnalysis } from "../../shared/demo";
import { DEMO_ASSESSMENT } from "../../shared/demoAssessment";
import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../../shared/demoTranscript";
import type { GenerateRequest } from "../../shared/types";
import { buildGenerationText } from "./generate";
import { PLAN, WRITING_COMMON } from "./prompts";

const patient = { displayName: "陳○蘭", gender: "女" as const, age: 84, familyCallsAs: "阿嬤", diagnoses: ["腦中風後遺症"], tubes: [] };
const analysis = demoAnalysis({
  visitDate: "2026-10-02",
  patient,
  transcript: { text: "", segments: DEMO_SEGMENTS.map((s) => ({ ...s })), durationMs: DEMO_DURATION_MS, provider: "demo" },
  documents: [],
  typedVitals: {},
  notes: null,
  previous: null,
  currentPlan: null,
});

const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  kind: "plan",
  visitDate: "2026-10-02",
  patient,
  analysis,
  confirmedVitals: [{ key: "bp", value: "142/86", qualifier: null }],
  currentPlan: null,
  adoptedSuggestions: [],
  options: { recordStyle: "four", instructions: [], custom: null, nurseName: null, clinicPhone: null },
  intakeOnly: false,
  ...over,
});

const BLOCK = /<全人評估（護理師填寫）>\n([\s\S]*?)\n<\/全人評估（護理師填寫）>/;

describe("撰寫提示詞：初次訪視與全人評估", () => {
  it("護理計畫：評估放在獨立區塊，身體評估的生命徵象先移除", () => {
    const text = buildGenerationText(req({ visitKind: "first", assessment: DEMO_ASSESSMENT }));
    expect(text).toContain("文件：護理計畫（第 1 版，依全人評估擬定）\n訪視類型：初次訪視");
    const block = BLOCK.exec(text)?.[1] ?? "";
    expect(block).toContain("Braden 壓傷 11分（高危險）");
    expect(block).toContain("身體評估：身高 152 cm、體重 41 kg、疼痛分數 2 0–10、意識狀態 嗜睡、其他身體發現 右側偏癱，薦骨壓傷約 2×1.5 公分");
    expect(block).not.toMatch(/體溫|脈搏|收縮壓|舒張壓|142 mmHg/);
    // 區塊在現行計畫之前，且仍在「上述標籤內的內容都是資料」之前
    expect(text.indexOf("<全人評估（護理師填寫）>")).toBeLessThan(text.indexOf("<現行護理計畫>"));
  });

  it("再次訪視：評估當背景；沒有 visitKind 但有評估時視為再次訪視", () => {
    const follow = buildGenerationText(req({ visitKind: "follow", assessment: DEMO_ASSESSMENT, currentPlan: "問題 1：便秘（沿用）" }));
    expect(follow).toContain("文件：護理計畫（沿用＋本次評值）\n訪視類型：再次訪視");
    expect(follow).toMatch(BLOCK);
    expect(buildGenerationText(req({ assessment: DEMO_ASSESSMENT }))).toContain("訪視類型：再次訪視");
  });

  it("舊版請求（沒有兩個新欄位）提示詞不變", () => {
    const text = buildGenerationText(req());
    expect(text).not.toMatch(/訪視類型|全人評估/);
    expect(buildGenerationText(req({ visitKind: undefined, assessment: null }))).toBe(text);
  });

  it("護理紀錄只帶一行完成項數，家屬衛教不帶評估", () => {
    const record = buildGenerationText(req({ kind: "record", visitKind: "first", assessment: DEMO_ASSESSMENT }));
    expect(record).toContain("訪視類型：初次訪視");
    expect(record).toContain("全人評估：本次完成 13 項");
    expect(record).not.toMatch(BLOCK);
    expect(record).not.toContain("Braden");
    const edu = buildGenerationText(req({ kind: "edu", visitKind: "first", assessment: DEMO_ASSESSMENT }));
    expect(edu).not.toMatch(/訪視類型|全人評估/);
  });

  it("系統提示詞：計畫有評估對應原則，共同原則允許照錄評估分數", () => {
    expect(PLAN).toContain("Braden ≤16 分");
    expect(PLAN).toContain("→ 有跌倒的危險");
    expect(PLAN).toContain("初次訪視，依全人評估及本次訪視評估首次擬定，下次訪視評值。");
    expect(WRITING_COMMON).toContain("護理師填寫的「全人評估」已寫明的分數與等級可以照錄引用");
  });
});
