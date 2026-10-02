import { describe, expect, it } from "vitest";
import type { Analysis, VitalReading } from "../../shared/types";
import { newVisit } from "./pipeline";
import { confirmedVitalList, formatVital, initialVitals, pendingVitals, vitalsLine } from "./vitals";

const reading = (r: Partial<VitalReading> & Pick<VitalReading, "key" | "value">): VitalReading => ({
  qualifier: null,
  sourceQuote: null,
  sourceMs: null,
  confidence: 0.95,
  status: "ok",
  suggestion: null,
  reason: null,
  flag: null,
  ...r,
});

const analysisWith = (vitals: VitalReading[]) => ({ vitals }) as unknown as Analysis;

describe("formatVital", () => {
  it("puts meal timing before glucose only for meal qualifiers", () => {
    expect(formatVital("glucose", "128", "飯前")).toBe("飯前血糖 128 mg/dL");
    expect(formatVital("glucose", "128", "飯後，復測 180 mg/dL")).toBe("飯後血糖 128 mg/dL（復測 180 mg/dL）");
    expect(formatVital("glucose", "128", "家屬自測")).toBe("血糖 128 mg/dL（家屬自測）");
    expect(formatVital("spo2", "96", "室內空氣")).toBe("血氧 96%（室內空氣）");
  });
});

describe("initialVitals", () => {
  it("keeps the first reading and folds a re-measurement into the note", () => {
    const out = initialVitals(analysisWith([reading({ key: "spo2", value: "92" }), reading({ key: "spo2", value: "96", qualifier: "拍痰後" })]), {}, {});
    expect(out.spo2).toMatchObject({ value: "92", qualifier: "拍痰後 96%", confirmed: true });
  });

  it("does not let an uncertain re-measurement overwrite the first reading", () => {
    const out = initialVitals(analysisWith([reading({ key: "spo2", value: "92" }), reading({ key: "spo2", value: "86", status: "uncertain", confidence: 0.5 })]), {}, {});
    expect(out.spo2).toMatchObject({ value: "92", confirmed: false });
  });

  it("typed values always win", () => {
    const out = initialVitals(analysisWith([reading({ key: "temp", value: "16.8", status: "implausible" })]), { temp: "36.8" }, {});
    expect(out.temp).toMatchObject({ value: "36.8", by: "nurse", confirmed: true });
  });
});

describe("pending and confirmed lists", () => {
  it("lists each pending vital once and never sends unconfirmed values on", () => {
    const v = newVisit("p", "2026-10-02", null);
    v.analysis = analysisWith([
      reading({ key: "temp", value: "16.8", status: "implausible", confidence: 0.6, suggestion: "36.8" }),
      reading({ key: "temp", value: "36.9", status: "uncertain", confidence: 0.7 }),
      reading({ key: "pulse", value: "82" }),
    ]);
    v.vitals = initialVitals(v.analysis, {}, {});
    expect(pendingVitals(v).map((r) => r.key)).toEqual(["temp"]);
    expect(confirmedVitalList(v).map((x) => x.key)).toEqual(["pulse"]);
    expect(vitalsLine(v, ["temp", "pulse"])).toContain("（待確認）");
  });
});
