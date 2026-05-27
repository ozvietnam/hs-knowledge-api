// Layer: L3
// Module: hs-knowledge-feature-extractor tests

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    hsKnowledgeFeedback: { findMany: vi.fn() },
    tariff2026: { findUnique: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
});

import { prisma } from "@/src/lib/prisma";
import { extractFeaturesForHs, extractFeaturesFromAllFeedback } from "../feature-extractor";

const prismaMock = prisma as unknown as {
  hsKnowledgeFeedback: { findMany: ReturnType<typeof vi.fn> };
  tariff2026: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

function geminiResponse(features: string[]) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ features }) }] } }],
    }),
  };
}

describe("extractFeaturesForHs", () => {
  it("returns empty result if no feedback", async () => {
    prismaMock.hsKnowledgeFeedback.findMany.mockResolvedValue([]);
    const result = await extractFeaturesForHs("84137099");
    expect(result.feedbackCount).toBe(0);
    expect(result.newlyPromoted).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("promotes feature when count ≥ threshold", async () => {
    prismaMock.hsKnowledgeFeedback.findMany.mockResolvedValue([
      {
        id: "fb1",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "Thiếu ly tâm",
        customsDescAtTime: "x",
        productNameAtTime: "Máy bơm",
      },
      {
        id: "fb2",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "Phải nói rõ ly tâm",
        customsDescAtTime: "y",
        productNameAtTime: "Máy bơm",
      },
      {
        id: "fb3",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "Cần thêm 'ly tâm' để loại trừ 8413.81",
        customsDescAtTime: "z",
        productNameAtTime: "Máy bơm",
      },
    ]);
    prismaMock.tariff2026.findUnique.mockResolvedValue({
      discriminatingFeatures: ["động cơ điện"],
    });
    prismaMock.tariff2026.update.mockResolvedValue({});

    // All 3 feedback extract returns "ly tâm"
    fetchMock
      .mockResolvedValueOnce(geminiResponse(["ly tâm"]))
      .mockResolvedValueOnce(geminiResponse(["Ly Tâm"])) // different casing — should normalize
      .mockResolvedValueOnce(geminiResponse(["ly  tâm"])); // extra whitespace

    const result = await extractFeaturesForHs("84137099", { threshold: 3 });
    expect(result.feedbackCount).toBe(3);
    expect(result.newlyPromoted).toContain("ly tâm");
    expect(result.alreadyExisted).toEqual([]); // "động cơ điện" not from extraction
    expect(prismaMock.tariff2026.update).toHaveBeenCalledOnce();
    const updateCall = prismaMock.tariff2026.update.mock.calls[0]?.[0];
    expect(updateCall.data.discriminatingFeatures).toContain("động cơ điện");
    expect(updateCall.data.discriminatingFeatures).toContain("ly tâm");
  });

  it("filters below threshold", async () => {
    prismaMock.hsKnowledgeFeedback.findMany.mockResolvedValue([
      {
        id: "fb1",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "Thiếu công suất",
        customsDescAtTime: "",
        productNameAtTime: "x",
      },
      {
        id: "fb2",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "Phải nói rõ ly tâm",
        customsDescAtTime: "",
        productNameAtTime: "x",
      },
    ]);
    prismaMock.tariff2026.findUnique.mockResolvedValue({ discriminatingFeatures: [] });

    fetchMock
      .mockResolvedValueOnce(geminiResponse(["công suất <750W"]))
      .mockResolvedValueOnce(geminiResponse(["ly tâm"]));

    const result = await extractFeaturesForHs("84137099", { threshold: 3 });
    expect(result.newlyPromoted).toEqual([]);
    expect(result.belowThreshold.length).toBe(2);
    expect(prismaMock.tariff2026.update).not.toHaveBeenCalled();
  });

  it("skips already-existing features", async () => {
    prismaMock.hsKnowledgeFeedback.findMany.mockResolvedValue([
      {
        id: "fb1",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "x",
        customsDescAtTime: "",
        productNameAtTime: "",
      },
      {
        id: "fb2",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "x",
        customsDescAtTime: "",
        productNameAtTime: "",
      },
      {
        id: "fb3",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "x",
        customsDescAtTime: "",
        productNameAtTime: "",
      },
    ]);
    prismaMock.tariff2026.findUnique.mockResolvedValue({ discriminatingFeatures: ["ly tâm"] });

    fetchMock
      .mockResolvedValueOnce(geminiResponse(["ly tâm"]))
      .mockResolvedValueOnce(geminiResponse(["ly tâm"]))
      .mockResolvedValueOnce(geminiResponse(["ly tâm"]));

    const result = await extractFeaturesForHs("84137099", { threshold: 3 });
    expect(result.newlyPromoted).toEqual([]);
    expect(result.alreadyExisted).toContain("ly tâm");
    expect(prismaMock.tariff2026.update).not.toHaveBeenCalled();
  });

  it("dryRun does not write", async () => {
    prismaMock.hsKnowledgeFeedback.findMany.mockResolvedValue([
      {
        id: "fb1",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "x",
        customsDescAtTime: "",
        productNameAtTime: "",
      },
      {
        id: "fb2",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "x",
        customsDescAtTime: "",
        productNameAtTime: "",
      },
      {
        id: "fb3",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "x",
        customsDescAtTime: "",
        productNameAtTime: "",
      },
    ]);
    prismaMock.tariff2026.findUnique.mockResolvedValue({ discriminatingFeatures: [] });

    fetchMock.mockResolvedValue(geminiResponse(["new feature"]));

    const result = await extractFeaturesForHs("84137099", { threshold: 3, dryRun: true });
    expect(result.newlyPromoted).toContain("new feature");
    expect(prismaMock.tariff2026.update).not.toHaveBeenCalled();
    expect(result.writtenAt).toBeNull();
  });

  it("handles LLM call failure for individual feedback gracefully", async () => {
    prismaMock.hsKnowledgeFeedback.findMany.mockResolvedValue([
      {
        id: "fb1",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "x",
        customsDescAtTime: "",
        productNameAtTime: "",
      },
      {
        id: "fb2",
        hsCodeAtTime: "84137099",
        correctedHsCode: null,
        directorNote: "x",
        customsDescAtTime: "",
        productNameAtTime: "",
      },
    ]);
    prismaMock.tariff2026.findUnique.mockResolvedValue({ discriminatingFeatures: [] });
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" })
      .mockResolvedValueOnce(geminiResponse(["ly tâm"]));

    const result = await extractFeaturesForHs("84137099", { threshold: 1 });
    // Failed feedback yields empty features; succeeded yields "ly tâm"
    expect(result.feedbackCount).toBe(2);
    // Only 1 feedback returned features (with retry, 1 failure stays failed, other succeeded)
  });
});

describe("extractFeaturesFromAllFeedback", () => {
  it("processes all distinct HS codes", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ hsCode: "84137099" }, { hsCode: "85176200" }]);
    prismaMock.hsKnowledgeFeedback.findMany.mockResolvedValue([]);

    const results = await extractFeaturesFromAllFeedback();
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.hsCode).sort()).toEqual(["84137099", "85176200"]);
  });
});
