// Layer: L3
// Module: hs-knowledge-parser tests

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseHsExplanatoryMarkdown } from "../parser";

const fixture = readFileSync(join(__dirname, "fixtures", "hs-explanatory-sample.md"), "utf-8");

describe("parseHsExplanatoryMarkdown", () => {
  it("detects SECTION level (Phần I)", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    const section = rows.find((r) => r.level === "SECTION" && r.code === "I");
    expect(section).toBeDefined();
    expect(section?.titleVi).toContain("ĐỘNG VẬT");
  });

  it("detects CHAPTER level (Chương 01)", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    const chapter = rows.find((r) => r.level === "CHAPTER" && r.code === "01");
    expect(chapter).toBeDefined();
    expect(chapter?.titleVi).toContain("Động vật sống");
    expect(chapter?.parentCode).toBe("I");
  });

  it("detects HEADING level (01.01, 01.02)", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    const h0101 = rows.find((r) => r.level === "HEADING" && r.code === "0101");
    const h0102 = rows.find((r) => r.level === "HEADING" && r.code === "0102");
    expect(h0101).toBeDefined();
    expect(h0102).toBeDefined();
    expect(h0101?.parentCode).toBe("01");
  });

  it("detects SUBHEADING level (0101.21)", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    const s = rows.find((r) => r.level === "SUBHEADING" && r.code === "010121");
    expect(s).toBeDefined();
    expect(s?.parentCode).toBe("0101");
  });

  it("detects NATIONAL level (01012100)", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    const n = rows.find((r) => r.level === "NATIONAL" && r.code === "01012100");
    expect(n).toBeDefined();
    expect(n?.parentCode).toBe("010121");
  });

  it("detects INCLUDES note type", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    const includes = rows.find((r) => r.code === "01" && r.noteType === "INCLUDES");
    expect(includes).toBeDefined();
    expect(includes?.noteVi).toContain("bao gồm");
  });

  it("detects EXCLUDES note type (critical for disambiguation)", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    const excludes = rows.find((r) => r.code === "01" && r.noteType === "EXCLUDES");
    expect(excludes).toBeDefined();
    expect(excludes?.noteVi).toContain("Loại trừ");
    expect(excludes?.noteVi).toContain("Chương 03");
  });

  it("detects DEFINITION note type", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    const def = rows.find((r) => r.code === "0102" && r.noteType === "DEFINITION");
    expect(def).toBeDefined();
    expect(def?.noteVi).toContain("có nghĩa là");
  });

  it("records sourceFile on every row", () => {
    const rows = parseHsExplanatoryMarkdown(fixture, "hs-explanatory-sample.md");
    expect(rows.every((r) => r.sourceFile === "hs-explanatory-sample.md")).toBe(true);
  });
});
