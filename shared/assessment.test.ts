import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_RULES,
  assessmentBasisLabel,
  assessmentFormCount,
  assessmentForWriting,
  assessmentHighlights,
  assessmentRisks,
  parseAssessment,
  splitItems,
} from "./assessment";
import { DEMO_ASSESSMENT } from "./demoAssessment";

/** 規格範例的寫法（多重用藥、高風險藥物沒有括號說明）。 */
const BRIEF = [
  "基本資料：教育程度 國小",
  "Braden 壓傷 12分（高危險）：感知能力 非常受限、潮濕程度 持續潮濕、活動能力 臥床",
  "跌倒 55分（高危險）：過去三個月內曾跌倒 是、使用行走輔具 柺杖／助行器／手杖、步態 軟弱",
  "ADL 35分（嚴重依賴）：進食 需協助切食",
  "IADL 1項（需大量協助）：可獨立 使用電話；需協助 購物、備餐",
  "認知 4分（輕度障礙）：今天是幾號？ 答錯",
  "情緒 6分（輕度）：感覺憂鬱、心情低落 中等、睡眠困難 厲害、有無自殺意念 無",
  "營養 9分（營養不良高風險）：過去三個月食慾是否減少 中度減少",
  "疼痛 5分（中度疼痛）：疼痛位置 右髖部、疼痛性質 刺痛",
  "衰弱 3項（衰弱）：覺得疲憊（做任何事都費力、無法出門） 是",
  "健康習慣：吸菸 已戒菸、飲酒 無",
  "疾病史：既往病史 高血壓、糖尿病",
  "藥物安全：多重用藥 是、高風險藥物 是",
  "身體評估：身高 152 cm、體重 41 kg、體溫 37.9 °C、脈搏 112 次/分、收縮壓 168 mmHg、舒張壓 96 mmHg、意識狀態 清楚（E4V5M6）",
].join("\n");

describe("全人評估摘要解析", () => {
  it("一行一張表：名稱、分數、單位、等級、內容", () => {
    const items = parseAssessment(BRIEF);
    expect(items).toHaveLength(14);
    expect(items[1]).toMatchObject({ form: "braden", name: "Braden 壓傷", score: 12, unit: "分", level: "高危險" });
    expect(items[4]).toMatchObject({ form: "iadl", score: 1, unit: "項", level: "需大量協助" });
    expect(items[3]).toMatchObject({ form: "adl", score: 35 });
    expect(items.find((i) => i.form === "meds")).toMatchObject({ score: null, detail: "多重用藥 是、高風險藥物 是" });
    expect(parseAssessment(null)).toEqual([]);
    expect(parseAssessment("  \n ")).toEqual([]);
  });

  it("完成表數與依據名稱（基本資料不算）", () => {
    expect(assessmentFormCount(DEMO_ASSESSMENT)).toBe(13);
    expect(assessmentBasisLabel(DEMO_ASSESSMENT)).toBe("全人評估（13 項）");
    expect(assessmentBasisLabel("Braden 壓傷 12分（高危險）")).toBe("全人評估（1 項）");
    expect(assessmentBasisLabel("護理師自由輸入的評估重點")).toBe("全人評估");
    expect(assessmentBasisLabel("")).toBeNull();
  });

  it("括號內的頓號不切開", () => {
    expect(splitItems("個人修飾（洗臉、梳頭） 需協助、如廁 需協助")).toEqual(["個人修飾（洗臉、梳頭） 需協助", "如廁 需協助"]);
  });

  it("給撰寫的摘要去掉身體評估中的生命徵象，其他照舊", () => {
    const w = assessmentForWriting(BRIEF)!;
    expect(w).toContain("身體評估：身高 152 cm、體重 41 kg、意識狀態 清楚（E4V5M6）");
    expect(w).not.toMatch(/37\.9|112|168|96 mmHg/);
    expect(w).toContain("Braden 壓傷 12分（高危險）");
    // 其他表單中的「降血糖」不是生命徵象
    expect(assessmentForWriting(DEMO_ASSESSMENT)).toContain("使用高風險藥物（抗凝血、降血糖、鎮靜安眠） 是");
    expect(assessmentForWriting(null)).toBeNull();
  });
});

describe("評估風險 → 護理問題", () => {
  it("依門檻與優先順序列出，依據引用分數與等級", () => {
    const risks = assessmentRisks(BRIEF);
    expect(risks.map((r) => r.rule.problem)).toEqual([
      "皮膚完整性受損的危險性",
      "有跌倒的危險",
      "營養不均衡（少於身體需要）",
      "疼痛",
      "自我照顧能力缺失",
      "記憶障礙",
      "焦慮／憂鬱",
      "衰弱",
      "藥物使用安全",
    ]);
    expect(risks.map((r) => r.cite)).toEqual([
      "Braden 12 分（高危險）",
      "Morse 55 分（高危險）",
      "MNA-SF 9 分（營養不良高風險）",
      "NPRS 5 分（中度疼痛）",
      "ADL 35 分（嚴重依賴）",
      "SPMSQ 4 分（輕度障礙）",
      "BSRS-5 6 分（輕度）",
      "Fried 3 項（衰弱）",
      "藥物安全評估",
    ]);
    // 題目本身有頓號時併回同一項；自殺意念「無」不列
    expect(risks.find((r) => r.rule.form === "emotional")!.items).toEqual(["感覺憂鬱、心情低落 中等", "睡眠困難 厲害"]);
    expect(risks.find((r) => r.rule.form === "meds")!.items).toEqual(["多重用藥 是", "高風險藥物 是"]);
  });

  it("門檻邊界：未達門檻不列；自殺意念最優先", () => {
    const ok = "Braden 壓傷 17分（無明顯風險）\n跌倒 20分（低危險）\nADL 65分（中度依賴）\n認知 2分（正常）\n情緒 5分（正常）：有無自殺意念 無\n營養 12分（正常）\n疼痛 3分（輕度疼痛）\n衰弱 2項（衰弱前期）\n藥物安全：多重用藥 否、高風險藥物 否";
    expect(assessmentRisks(ok)).toEqual([]);
    const edge = "Braden 壓傷 16分（低危險）\n跌倒 25分（中度危險）\nADL 60分（嚴重依賴）\n情緒 2分（正常）：有無自殺意念 有（需立即介入）";
    expect(assessmentRisks(edge).map((r) => r.rule.problem)).toEqual(["有自殺的危險", "皮膚完整性受損的危險性", "有跌倒的危險", "自我照顧能力缺失"]);
  });

  it("每條規則都有提示詞說明", () => {
    for (const r of ASSESSMENT_RULES) expect(r.when.length).toBeGreaterThan(0);
  });

  it("評估摘要的分數重點", () => {
    expect(assessmentHighlights(BRIEF)).toEqual({
      body: ["ADL 35 分（嚴重依賴）", "IADL 1 項（需大量協助）", "Braden 12 分（高危險）", "Morse 55 分（高危險）", "MNA-SF 9 分（營養不良高風險）", "NPRS 5 分（中度疼痛）", "Fried 3 項（衰弱）"],
      mind: ["SPMSQ 4 分（輕度障礙）", "BSRS-5 6 分（輕度）"],
    });
    expect(assessmentHighlights(null)).toEqual({ body: [], mind: [] });
  });
});
