// Layer: L3
// Module: hs-knowledge-describe tests

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    tariff2026: { findUnique: vi.fn() },
    hsExplanatoryNote: { findMany: vi.fn() },
    historicalDeclarationItem: { findMany: vi.fn() },
  },
}));

vi.mock("@/src/lib/hs-knowledge/feedback", () => ({
  searchSimilarFeedback: vi.fn().mockResolvedValue([]),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { prisma } from "@/src/lib/prisma";
import { searchSimilarFeedback } from "@/src/lib/hs-knowledge/feedback";
import { generateCustomsDescription } from "../describe";

const prismaMock = prisma as unknown as {
  tariff2026: { findUnique: ReturnType<typeof vi.fn> };
  hsExplanatoryNote: { findMany: ReturnType<typeof vi.fn> };
  historicalDeclarationItem: { findMany: ReturnType<typeof vi.fn> };
};

const feedbackMock = searchSimilarFeedback as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
  feedbackMock.mockResolvedValue([]);
});

describe("generateCustomsDescription", () => {
  it("throws on invalid HS code", async () => {
    await expect(
      generateCustomsDescription({ hsCode: "123", productName: "test" }),
    ).rejects.toThrow("HS code");
  });

  it("throws on empty productName", async () => {
    await expect(
      generateCustomsDescription({ hsCode: "84137099", productName: "" }),
    ).rejects.toThrow("productName");
  });

  it("happy path: LLM returns valid description with all features", async () => {
    prismaMock.tariff2026.findUnique.mockResolvedValue({
      hsCode: "84137099",
      nameVi: "Máy bơm khác",
      nameEn: "Other pumps",
      unitVi: "Cái",
      discriminatingFeatures: ["ly tâm", "động cơ điện", "<750W"],
    });
    prismaMock.hsExplanatoryNote.findMany.mockResolvedValue([]);
    prismaMock.historicalDeclarationItem.findMany.mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    customsDescription:
                      "Máy bơm ly tâm, dùng động cơ điện công suất 50W (<750W), hiệu Pentax, model CM50, xuất xứ Italy, mới 100%",
                    structure: {
                      productName: "Máy bơm ly tâm",
                      brand: "Pentax",
                      model: "CM50",
                      material: null,
                      purpose: null,
                      origin: "Italy",
                      condition: "Mới 100%",
                      technicalSpec: "Công suất 50W",
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await generateCustomsDescription({
      hsCode: "84137099",
      productName: "Máy bơm",
      brand: "Pentax",
      model: "CM50",
      origin: "Italy",
      technicalSpec: "Công suất 50W, điện 220V",
    });

    expect(result.customsDescription).toContain("ly tâm");
    expect(result.disambiguationFeaturesIncluded).toEqual(
      expect.arrayContaining(["ly tâm", "động cơ điện"]),
    );
    expect(result.disambiguationFeaturesMissing).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.contextUsed.tariffFound).toBe(true);
  });

  it("detects missing disambiguation features in warnings", async () => {
    prismaMock.tariff2026.findUnique.mockResolvedValue({
      hsCode: "84137099",
      nameVi: "x",
      nameEn: null,
      unitVi: null,
      discriminatingFeatures: ["ly tâm", "động cơ điện", "<750W"],
    });
    prismaMock.hsExplanatoryNote.findMany.mockResolvedValue([]);
    prismaMock.historicalDeclarationItem.findMany.mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    customsDescription: "Máy bơm, hiệu Pentax, xuất xứ Italy, mới 100%", // missing ly tâm + động cơ điện + <750W
                    structure: {
                      productName: "Máy bơm",
                      brand: "Pentax",
                      model: null,
                      material: null,
                      purpose: null,
                      origin: "Italy",
                      condition: "Mới 100%",
                      technicalSpec: null,
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await generateCustomsDescription({
      hsCode: "84137099",
      productName: "Máy bơm",
      brand: "Pentax",
      origin: "Italy",
    });

    expect(result.disambiguationFeaturesMissing.length).toBe(3);
    expect(result.warnings[0]).toContain("3 đặc điểm khu biệt");
  });

  it("warns when HS not in Tariff2026", async () => {
    prismaMock.tariff2026.findUnique.mockResolvedValue(null);
    prismaMock.hsExplanatoryNote.findMany.mockResolvedValue([]);
    prismaMock.historicalDeclarationItem.findMany.mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    customsDescription: "Mô tả gì đó",
                    structure: {
                      productName: "x",
                      brand: null,
                      model: null,
                      material: null,
                      purpose: null,
                      origin: "VN",
                      condition: "Mới 100%",
                      technicalSpec: null,
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await generateCustomsDescription({
      hsCode: "99999999",
      productName: "Sản phẩm lạ",
    });

    expect(result.warnings.some((w) => w.includes("không có trong Tariff2026"))).toBe(true);
    expect(result.contextUsed.tariffFound).toBe(false);
  });

  it("includes EXCLUDES notes in prompt", async () => {
    prismaMock.tariff2026.findUnique.mockResolvedValue({
      hsCode: "84137099",
      nameVi: "x",
      nameEn: null,
      unitVi: null,
      discriminatingFeatures: [],
    });
    prismaMock.hsExplanatoryNote.findMany.mockResolvedValue([
      {
        code: "8413",
        level: "HEADING",
        noteType: "EXCLUDES",
        noteVi: "Loại trừ bơm tay",
        titleVi: null,
      },
    ]);
    prismaMock.historicalDeclarationItem.findMany.mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    customsDescription: "x",
                    structure: {
                      productName: "x",
                      brand: null,
                      model: null,
                      material: null,
                      purpose: null,
                      origin: "VN",
                      condition: "Mới 100%",
                      technicalSpec: null,
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    await generateCustomsDescription({ hsCode: "84137099", productName: "test" });

    const prompt = JSON.parse(fetchMock.mock.calls[0]![1].body).contents[0].parts[0].text;
    expect(prompt).toContain("LOẠI TRỪ");
    expect(prompt).toContain("bơm tay");
  });

  it("includes past CEO feedback in prompt when available", async () => {
    prismaMock.tariff2026.findUnique.mockResolvedValue({
      hsCode: "84137099",
      nameVi: "x",
      nameEn: null,
      unitVi: null,
      discriminatingFeatures: [],
    });
    prismaMock.hsExplanatoryNote.findMany.mockResolvedValue([]);
    prismaMock.historicalDeclarationItem.findMany.mockResolvedValue([]);
    feedbackMock.mockResolvedValue([
      {
        id: "fb-1",
        feedbackType: "RETURNED_BY_DIRECTOR",
        hsCodeAtTime: "84137099",
        customsDescAtTime: "Máy bơm 220V",
        productNameAtTime: "Máy bơm",
        directorNote: "Thiếu công suất <750W",
        correctedHsCode: null,
        correctedDesc: null,
        similarity: 0.9,
      },
    ]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    customsDescription: "x",
                    structure: {
                      productName: "x",
                      brand: null,
                      model: null,
                      material: null,
                      purpose: null,
                      origin: "VN",
                      condition: "Mới 100%",
                      technicalSpec: null,
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    await generateCustomsDescription({ hsCode: "84137099", productName: "Máy bơm" });

    const prompt = JSON.parse(fetchMock.mock.calls[0]![1].body).contents[0].parts[0].text;
    expect(prompt).toContain("FEEDBACK TỪ CEO");
    expect(prompt).toContain("Thiếu công suất <750W");
  });

  it("fetches notes for parent chapters (2/4/6 digit prefixes)", async () => {
    prismaMock.tariff2026.findUnique.mockResolvedValue(null);
    prismaMock.hsExplanatoryNote.findMany.mockResolvedValue([]);
    prismaMock.historicalDeclarationItem.findMany.mockResolvedValue([]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    customsDescription: "x",
                    structure: {
                      productName: "x",
                      brand: null,
                      model: null,
                      material: null,
                      purpose: null,
                      origin: "VN",
                      condition: "Mới 100%",
                      technicalSpec: null,
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    await generateCustomsDescription({ hsCode: "84137099", productName: "test" });

    const noteCall = prismaMock.hsExplanatoryNote.findMany.mock.calls[0]![0];
    expect(noteCall.where.code.in).toEqual(
      expect.arrayContaining(["84137099", "841370", "8413", "84"]),
    );
  });
});
