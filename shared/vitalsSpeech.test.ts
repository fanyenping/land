import { describe, expect, it } from "vitest";
import { isPlausible } from "./clinical";
import type { VitalKey } from "./types";
import { DEMO_VITALS_UTTERANCE, parseSpokenVitals } from "./vitalsSpeech";

const values = (text: string) => parseSpokenVitals(text).values;
const value = (text: string, key: VitalKey) => parseSpokenVitals(text).values[key]?.value;

describe("parseSpokenVitals：關鍵字", () => {
  it.each(["體溫", "溫度", "耳溫", "額溫", "肛溫", "腋溫"])("%s → 體溫", (kw) => {
    expect(value(`${kw}三十六點八`, "temp")).toBe("36.8");
  });

  it.each(["脈搏", "心跳", "心律", "脈博"])("%s → 脈搏", (kw) => {
    expect(value(`${kw}八十八`, "pulse")).toBe("88");
  });

  it.each(["呼吸", "呼吸次數"])("%s → 呼吸", (kw) => {
    expect(value(`${kw}十八`, "resp")).toBe("18");
  });

  it.each(["血氧", "含氧", "血氧濃度", "SpO2", "spo2", "SPO2", "血氧飽和度", "SpO₂"])("%s → 血氧", (kw) => {
    expect(value(`${kw} 96`, "spo2")).toBe("96");
  });

  it.each(["血糖", "飯前血糖", "飯後血糖"])("%s → 血糖", (kw) => {
    expect(value(`${kw}一百二十六`, "glucose")).toBe("126");
  });

  it("血壓、BP", () => {
    expect(value("血壓142/86", "bp")).toBe("142/86");
    expect(value("BP 142/86", "bp")).toBe("142/86");
  });

  it("意識", () => {
    expect(value("意識清醒", "consciousness")).toBe("清醒");
  });

  it("bpm 是單位不是血壓", () => {
    expect(values("bpm 88")).toEqual({});
  });

  it("英文縮寫 HR／PR → 脈搏、RR → 呼吸", () => {
    expect(values("HR 72")).toEqual({ pulse: { value: "72" } });
    expect(values("PR 88 RR 18")).toEqual({ pulse: { value: "88" }, resp: { value: "18" } });
    expect(values("hrs 72")).toEqual({});
  });

  it("數值後面接 HR：不會被當成時間抹掉，也不會拿心跳頂替前一項", () => {
    expect(values("BP 142/86 HR 72")).toEqual({ bp: { value: "142/86" }, pulse: { value: "72" } });
    expect(value("血壓142/86 HR 72", "bp")).toBe("142/86");
    expect(values("體溫36.8 HR 88")).toEqual({ temp: { value: "36.8" }, pulse: { value: "88" } });
    expect(value("體溫37.5 Hr 92", "temp")).toBe("37.5");
    expect(value("血氧96 HR 88", "spo2")).toBe("96");
    expect(value("體溫36.8 脈搏88 HR", "pulse")).toBe("88");
    expect(values("血壓142/86 hrs")).toEqual({ bp: { value: "142/86" } });
  });
});

describe("parseSpokenVitals：數字", () => {
  it("iOS 聽寫常見的阿拉伯數字", () => {
    expect(values("體溫36.8度 脈搏88")).toEqual({ temp: { value: "36.8" }, pulse: { value: "88" } });
  });

  it("中文數字：小數、百位、兩百", () => {
    expect(value("體溫三十六點八", "temp")).toBe("36.8");
    expect(value("收縮壓一百四十二舒張壓八十六", "bp")).toBe("142/86");
    expect(value("血糖兩百", "glucose")).toBe("200");
    expect(value("飯後血糖兩百零五", "glucose")).toBe("205");
    expect(value("脈搏一百零一下", "pulse")).toBe("101");
    expect(value("血糖隨機一百八", "glucose")).toBe("180");
  });

  it("逐字念法：三六點八", () => {
    expect(value("體溫三六點八", "temp")).toBe("36.8");
  });

  it("阿拉伯與中文混用", () => {
    expect(values("體溫36.8，脈搏八十八，血壓142之八十六，血氧九十六")).toEqual({
      temp: { value: "36.8" },
      pulse: { value: "88" },
      bp: { value: "142/86" },
      spo2: { value: "96" },
    });
  });

  it("單位與贅字：度、下、次、每分鐘、毫米汞柱、mmHg、%、趴、巴仙、毫克、mg/dL", () => {
    expect(value("體溫三十六點八度", "temp")).toBe("36.8");
    expect(value("體溫36.8°C", "temp")).toBe("36.8");
    expect(value("脈搏每分鐘八十八下", "pulse")).toBe("88");
    expect(value("脈搏88下/分鐘", "pulse")).toBe("88");
    expect(value("呼吸每分鐘18次", "resp")).toBe("18");
    expect(value("呼吸十八次/分", "resp")).toBe("18");
    expect(value("血壓一百四十二之八十六毫米汞柱", "bp")).toBe("142/86");
    expect(value("血壓142/86mmHg", "bp")).toBe("142/86");
    expect(value("血壓142毫米汞柱86", "bp")).toBe("142/86");
    expect(value("血氧96%", "spo2")).toBe("96");
    expect(value("血氧九十六趴", "spo2")).toBe("96");
    expect(value("血氧96巴仙", "spo2")).toBe("96");
    expect(value("血氧百分之九十六", "spo2")).toBe("96");
    expect(value("血糖126毫克", "glucose")).toBe("126");
    expect(value("血糖126mg/dL", "glucose")).toBe("126");
  });

  it("口語體溫：三十六度八、36度8、三十七度、三十六度半", () => {
    expect(value("體溫三十六度八", "temp")).toBe("36.8");
    expect(value("體溫36度8", "temp")).toBe("36.8");
    expect(value("體溫 36 度 8", "temp")).toBe("36.8");
    expect(value("體溫三十七度", "temp")).toBe("37");
    expect(value("體溫三十六度半", "temp")).toBe("36.5");
    // 辨識結果用度數符號
    expect(value("體溫36°8", "temp")).toBe("36.8");
    // 「度」後面接的是下一個數（漏說關鍵字）時不併成小數。
    expect(value("體溫三十六度 八十八", "temp")).toBe("36");
  });

  it("不是數值的數字字：有一點、一下、第二次、兩小時", () => {
    expect(value("呼吸有一點喘，二十一下", "resp")).toBe("21");
    expect(value("脈搏量一下，八十八", "pulse")).toBe("88");
    expect(value("血氧第二次九十八", "spo2")).toBe("98");
    expect(value("脈搏量了兩次，八十八", "pulse")).toBe("88");
    expect(value("呼吸二十三次", "resp")).toBe("23");
    expect(values("飯後兩小時血糖兩百")).toEqual({ glucose: { value: "200", qualifier: "飯後" } });
    expect(value("血糖飯後2小時180", "glucose")).toBe("180");
  });

  it("小數照說的位數保留：三十七點零 → 37.0", () => {
    expect(value("體溫三十七點零", "temp")).toBe("37.0");
    expect(value("體溫37.0", "temp")).toBe("37.0");
    expect(value("體溫37點0", "temp")).toBe("37.0");
    expect(value("脈搏088", "pulse")).toBe("88");
  });

  it("時間長度只抹掉單位前那一個數：脈搏八十八一分鐘", () => {
    expect(value("脈搏八十八一分鐘", "pulse")).toBe("88");
    expect(value("脈搏88一分鐘", "pulse")).toBe("88");
    expect(value("呼吸十八一分鐘", "resp")).toBe("18");
    expect(value("脈搏量了一分鐘，八十八", "pulse")).toBe("88");
    expect(value("脈搏數三十秒四十四", "pulse")).toBe("44");
    expect(values("血糖飯後兩個半小時一百八")).toEqual({ glucose: { value: "180", qualifier: "飯後" } });
    // 英文 h／hr 只有在飯後、餐後才是時間
    expect(values("血糖飯後2h 180")).toEqual({ glucose: { value: "180", qualifier: "飯後" } });
    expect(values("血糖飯後2hr180")).toEqual({ glucose: { value: "180", qualifier: "飯後" } });
  });

  it("全形數字與各種標點", () => {
    expect(values("體溫：３６．８，脈搏　８８。呼吸、十八；血氧 ９６％")).toEqual({
      temp: { value: "36.8" },
      pulse: { value: "88" },
      resp: { value: "18" },
      spo2: { value: "96" },
    });
  });

  it("不修正不合理的數值（交給畫面上的範圍提示）", () => {
    expect(value("體溫十六點八", "temp")).toBe("16.8");
    expect(isPlausible("temp", "16.8")).toBe(false);
    expect(value("血壓八十六之一百四十二", "bp")).toBe("86/142");
  });
});

describe("parseSpokenVitals：血壓", () => {
  it.each([
    "142/86",
    "142 86",
    "142比86",
    "142之86",
    "142對86",
    "142、86",
    "142，86",
    "142 over 86",
    "142 / 86",
    "一百四十二之八十六",
    "一百四十二比八十六",
    "一百四十二 八十六",
    "一百四十二八十六",
    "一百四十二，八十六",
  ])("血壓%s → 142/86", (said) => {
    expect(value(`血壓${said}`, "bp")).toBe("142/86");
  });

  it("收縮壓／舒張壓、高壓／低壓", () => {
    expect(value("收縮壓142舒張壓86", "bp")).toBe("142/86");
    expect(value("收縮壓一百四十二，舒張壓八十六", "bp")).toBe("142/86");
    expect(value("高壓一百四低壓八十", "bp")).toBe("140/80");
  });

  it("只有一個數字或只說收縮壓：不填", () => {
    expect(values("血壓一百四")).toEqual({});
    expect(values("收縮壓142")).toEqual({});
  });

  it("兩個數字之間不是分隔詞時找下一組", () => {
    expect(value("血壓量了兩次142/86", "bp")).toBe("142/86");
    expect(value("量一下血壓142/86", "bp")).toBe("142/86");
    expect(value("血壓上升到一百五十，八十", "bp")).toBe("150/80");
  });
});

describe("parseSpokenVitals：附註", () => {
  it("血氧：室內空氣", () => {
    expect(values("血氧九十六室內空氣")).toEqual({ spo2: { value: "96", qualifier: "室內空氣" } });
    expect(values("血氧96，room air")).toEqual({ spo2: { value: "96", qualifier: "室內空氣" } });
    expect(values("沒有給氧，血氧九十五")).toEqual({ spo2: { value: "95", qualifier: "室內空氣" } });
  });

  it("血氧：氧氣 N 公升／NL → 與選項相同的寫法「氧氣 2L」", () => {
    expect(values("血氧九十六，氧氣兩公升")).toEqual({ spo2: { value: "96", qualifier: "氧氣 2L" } });
    expect(values("血氧96 氧氣3L")).toEqual({ spo2: { value: "96", qualifier: "氧氣 3L" } });
    expect(values("血氧96 氧氣 3 l/分")).toEqual({ spo2: { value: "96", qualifier: "氧氣 3L" } });
    expect(values("SpO2 96% 2L")).toEqual({ spo2: { value: "96", qualifier: "氧氣 2L" } });
    expect(values("血氧九十二鼻導管兩升")).toEqual({ spo2: { value: "92", qualifier: "氧氣 2L" } });
    expect(values("氧氣一點五公升，血氧九十三")).toEqual({ spo2: { value: "93", qualifier: "氧氣 1.5L" } });
    expect(values("O2 2L 血氧95")).toEqual({ spo2: { value: "95", qualifier: "氧氣 2L" } });
    expect(values("氧氣二點零公升，血氧96")).toEqual({ spo2: { value: "96", qualifier: "氧氣 2L" } });
  });

  it("跟給氧無關的公升數（喝水、尿量）不當成氧氣", () => {
    expect(values("喝水兩公升，血氧九十六")).toEqual({ spo2: { value: "96" } });
    expect(values("尿量一公升，血氧九十五")).toEqual({ spo2: { value: "95" } });
    expect(values("血氧九十六，喝水兩公升")).toEqual({ spo2: { value: "96" } });
  });

  it("氧氣公升數不會被當成前一項的數值", () => {
    expect(values("呼吸十八，氧氣兩公升，血氧九十六")).toEqual({ resp: { value: "18" }, spo2: { value: "96", qualifier: "氧氣 2L" } });
    expect(values("呼吸氧氣兩公升十八")).toEqual({ resp: { value: "18" } });
  });

  it("血氧：拍痰後", () => {
    expect(values("拍痰後血氧九十八")).toEqual({ spo2: { value: "98", qualifier: "拍痰後" } });
    expect(values("血氧九十八，拍完痰")).toEqual({ spo2: { value: "98", qualifier: "拍痰後" } });
  });

  it("單獨的「升」不當成給氧（上升）", () => {
    expect(values("血氧九十六，血壓上升兩升")).toEqual({ spo2: { value: "96" } });
  });

  it("血糖：飯前／飯後／隨機，空腹與餐前算飯前", () => {
    expect(values("飯前血糖一百二十六")).toEqual({ glucose: { value: "126", qualifier: "飯前" } });
    expect(values("飯後血糖一百八十")).toEqual({ glucose: { value: "180", qualifier: "飯後" } });
    expect(values("血糖飯前一百二十六")).toEqual({ glucose: { value: "126", qualifier: "飯前" } });
    expect(values("血糖隨機一百五")).toEqual({ glucose: { value: "150", qualifier: "隨機" } });
    expect(values("空腹血糖110")).toEqual({ glucose: { value: "110", qualifier: "飯前" } });
    expect(values("餐後血糖200")).toEqual({ glucose: { value: "200", qualifier: "飯後" } });
    expect(values("意識清醒，飯前測的血糖一百三十")).toEqual({ consciousness: { value: "清醒" }, glucose: { value: "130", qualifier: "飯前" } });
    expect(values("血糖一百三十")).toEqual({ glucose: { value: "130" } });
  });

  it.each([
    ["意識清醒", "清醒"],
    ["意識清楚", "清醒"],
    ["意識清，脈搏八十", "清醒"],
    ["意識可喚醒", "可喚醒"],
    ["意識狀態嗜睡", "嗜睡"],
    ["意識混亂", "混亂"],
    ["意識昏迷", "昏迷"],
  ])("意識：%s → %s", (said, expected) => {
    expect(value(said, "consciousness")).toBe(expected);
  });

  it("意識：否定不算清醒", () => {
    expect(values("意識不清醒")).toEqual({});
    expect(values("意識沒有很清楚")).toEqual({});
    expect(values("意識不太清楚")).toEqual({});
    expect(values("意識不是很清楚")).toEqual({});
    expect(values("意識不清")).toEqual({});
    expect(values("意識還好")).toEqual({});
  });

  it.each([
    ["意識不清，嗜睡", "嗜睡"],
    ["意識不清嗜睡", "嗜睡"],
    ["意識不清楚嗜睡", "嗜睡"],
    ["意識不清、混亂", "混亂"],
    ["意識不清昏迷", "昏迷"],
    ["意識不清，叫得醒", "可喚醒"],
    ["意識還不錯，清醒", "清醒"],
    ["意識沒有混亂，清醒", "清醒"],
  ])("意識：否定只管緊接的詞 %s → %s", (said, expected) => {
    expect(value(said, "consciousness")).toBe(expected);
  });
});

describe("parseSpokenVitals：切段與整句", () => {
  it("示範口述填滿七項", () => {
    expect(parseSpokenVitals(DEMO_VITALS_UTTERANCE)).toEqual({
      values: {
        temp: { value: "36.8" },
        pulse: { value: "88" },
        resp: { value: "18" },
        bp: { value: "142/86" },
        spo2: { value: "96", qualifier: "室內空氣" },
        glucose: { value: "126", qualifier: "飯前" },
        consciousness: { value: "清醒" },
      },
      heard: ["temp", "pulse", "resp", "bp", "spo2", "glucose", "consciousness"],
    });
  });

  it("產品負責人的例句", () => {
    expect(parseSpokenVitals("體溫三十六度八，脈搏八十八，血壓一百四十二之八十六，血氧九十六室內空氣")).toEqual({
      values: { temp: { value: "36.8" }, pulse: { value: "88" }, bp: { value: "142/86" }, spo2: { value: "96", qualifier: "室內空氣" } },
      heard: ["temp", "pulse", "bp", "spo2"],
    });
  });

  it("關鍵字之間沒有標點：脈搏八十八呼吸十八", () => {
    expect(values("脈搏八十八呼吸十八")).toEqual({ pulse: { value: "88" }, resp: { value: "18" } });
    expect(values("體溫36.8脈搏88呼吸18血壓142/86血氧96%")).toEqual({
      temp: { value: "36.8" },
      pulse: { value: "88" },
      resp: { value: "18" },
      bp: { value: "142/86" },
      spo2: { value: "96" },
    });
  });

  it("順序不拘，heard 依說出的先後", () => {
    const r = parseSpokenVitals("血壓142/86，意識清醒，體溫36.8");
    expect(r.heard).toEqual(["bp", "consciousness", "temp"]);
    expect(r.values.temp?.value).toBe("36.8");
  });

  it("同一項說兩次：以後面的為準", () => {
    expect(values("體溫三十六點五，體溫再量一次三十六點八")).toEqual({ temp: { value: "36.8" } });
    expect(values("血壓150/90，血壓復測142/86")).toEqual({ bp: { value: "142/86" } });
    expect(values("耳溫37.2 額溫36.4")).toEqual({ temp: { value: "36.4" } });
    // 後面那次沒有數字：保留前一次。
    expect(values("脈搏八十八，脈搏有點快")).toEqual({ pulse: { value: "88" } });
  });

  it("不屬於任何關鍵字的數字不採用", () => {
    expect(parseSpokenVitals("今天10月3號，體溫36.5")).toEqual({ values: { temp: { value: "36.5" } }, heard: ["temp"] });
    expect(values("九十六，八十八")).toEqual({});
  });

  it("關鍵字後沒有數字就略過", () => {
    expect(parseSpokenVitals("體溫正常，脈搏八十八，血氧室內空氣，血糖飯前")).toEqual({ values: { pulse: { value: "88" } }, heard: ["pulse"] });
  });

  it("每段只取第一個數字", () => {
    expect(values("脈搏八十八九十")).toEqual({ pulse: { value: "88" } });
  });

  it("什麼都沒聽到", () => {
    expect(parseSpokenVitals("今天天氣很好")).toEqual({ values: {}, heard: [] });
    expect(parseSpokenVitals("")).toEqual({ values: {}, heard: [] });
    expect(parseSpokenVitals("   ，。")).toEqual({ values: {}, heard: [] });
  });
});
