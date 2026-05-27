// Layer: L3+Infra
// Module: hs-knowledge-embed tests

import { describe, it, expect, vi } from "vitest";
import { tariffText, noteText, historicalText, withRetry } from "../embed";

describe("text builders", () => {
  it("tariffText composes hsCode + nameVi + nameEn + unit + policy", () => {
    const txt = tariffText({
      hsCode: "84137099",
      nameVi: "Máy bơm khác",
      nameEn: "Other pumps",
      unitVi: "Cái",
      policyByHs: "Áp thuế NK ưu đãi",
    });
    expect(txt).toContain("84137099");
    expect(txt).toContain("Máy bơm khác");
    expect(txt).toContain("Other pumps");
    expect(txt).toContain("Cái");
    expect(txt).toContain("Áp thuế");
  });

  it("noteText composes level + code + title + note", () => {
    const txt = noteText({
      level: "CHAPTER",
      code: "01",
      titleVi: "Động vật sống",
      noteVi: "Chương này bao gồm tất cả động vật sống",
    });
    expect(txt).toContain("CHAPTER");
    expect(txt).toContain("01");
    expect(txt).toContain("Động vật sống");
    expect(txt).toContain("Chương này");
  });

  it("historicalText composes name + brand + model + material + origin + hsCode", () => {
    const txt = historicalText({
      productNameRaw: "Máy bơm ly tâm 220V",
      brand: "Pentax",
      model: "CM50",
      material: "Inox 304",
      origin: "Italy",
      hsCode: "84137099",
    });
    expect(txt).toContain("Máy bơm");
    expect(txt).toContain("Pentax");
    expect(txt).toContain("CM50");
    expect(txt).toContain("Italy");
    expect(txt).toContain("84137099");
  });
});

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient failure then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockRejectedValueOnce(new Error("500 server"))
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after maxRetries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toThrow("persistent");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
