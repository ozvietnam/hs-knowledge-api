// Layer: L3
// Module: hs-knowledge-importer tests

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseHistoricalExcel } from "../importer";

const fixtureBuffer = readFileSync(join(__dirname, "fixtures", "historical-sample.xlsx"));

describe("parseHistoricalExcel", () => {
  const defaultMapping = {
    declarationNo: "Số tờ khai",
    declarationDate: "Ngày",
    hsCode: "Mã HS",
    productNameRaw: "Tên hàng",
    brand: "Hiệu",
    model: "Model",
    origin: "Xuất xứ",
    unit: "ĐVT",
    outcome: "Trạng thái",
  };

  it("parses 3 data rows from fixture", () => {
    const result = parseHistoricalExcel(fixtureBuffer, defaultMapping);
    expect(result.items).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it("maps columns correctly", () => {
    const result = parseHistoricalExcel(fixtureBuffer, defaultMapping);
    const first = result.items[0]!;
    expect(first.hsCode).toBe("84137099");
    expect(first.productNameRaw).toBe("Máy bơm ly tâm 220V");
    expect(first.brand).toBe("Pentax");
    expect(first.origin).toBe("Italy");
    expect(first.outcome).toBe("APPROVED");
  });

  it("parses date correctly", () => {
    const result = parseHistoricalExcel(fixtureBuffer, defaultMapping);
    expect(result.items[0]!.declarationDate).toEqual(new Date("2025-01-15"));
  });

  it("rejects rows missing required hsCode", () => {
    const badMapping = { ...defaultMapping, hsCode: "Không có cột này" };
    const result = parseHistoricalExcel(fixtureBuffer, badMapping);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!).toMatch(/hsCode/i);
  });

  it("rejects rows missing required productNameRaw", () => {
    const badMapping = { ...defaultMapping, productNameRaw: "Không có cột này" };
    const result = parseHistoricalExcel(fixtureBuffer, badMapping);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("defaults outcome to UNKNOWN if not mapped", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { outcome, ...mappingNoOutcome } = defaultMapping;
    const result = parseHistoricalExcel(fixtureBuffer, mappingNoOutcome);
    expect(result.items[0]!.outcome).toBe("UNKNOWN");
  });
});
