// Layer: L3
// Module: hs-knowledge-rerank tests

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SuggestEvidence } from "../suggest";

vi.mock("@/src/lib/hs-knowledge/feedback", () => ({
  searchSimilarFeedback: vi.fn().mockResolvedValue([]),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { searchSimilarFeedback } from "@/src/lib/hs-knowledge/feedback";
const feedbackMock = searchSimilarFeedback as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
  feedbackMock.mockResolvedValue([]);
});

import { rerankSuggestions } from "../rerank";

const mockCandidate = (hsCode: string, score: number): SuggestEvidence => ({
  hsCode,
  tariffMatch: {
    similarity: score,
    nameVi: `Tên ${hsCode}`,
    nameEn: null,
    unitVi: "Cái",
    taxNkPreferential: "5",
    taxVat: "10",
    discriminatingFeatures: ["feature1"],
  },
  notesMatch: [],
  historicalMatch: [],
  combinedScore: score,
});

describe("rerankSuggestions", () => {
  it("returns empty when no candidates", async () => {
    const result = await rerankSuggestions("test", []);
    expect(result.suggestions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Gemini with prompt containing description + candidates", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    suggestions: [
                      {
                        hsCode: "84137099",
                        nameVi: "Máy bơm khác",
                        confidence: 90,
                        reasoning: "Match centrifugal pump",
                        disambiguationFeatures: ["ly tâm", "<750W"],
                        excludedAlternatives: [{ hsCode: "84138190", reason: "khác loại bơm" }],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await rerankSuggestions("máy bơm ly tâm 220V", [
      mockCandidate("84137099", 0.92),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const callBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    const promptText = callBody.contents[0].parts[0].text;
    expect(promptText).toContain("máy bơm ly tâm 220V");
    expect(promptText).toContain("84137099");
    expect(promptText).toContain("disambiguation_features");

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.hsCode).toBe("84137099");
    expect(result.suggestions[0]!.confidence).toBe(90);
    expect(result.suggestions[0]!.disambiguationFeatures).toContain("ly tâm");
    expect(result.suggestions[0]!.excludedAlternatives).toHaveLength(1);
  });

  it("clamps confidence to 0-100", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    suggestions: [
                      {
                        hsCode: "84137099",
                        nameVi: "x",
                        confidence: 150,
                        reasoning: "x",
                        disambiguationFeatures: [],
                        excludedAlternatives: [],
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await rerankSuggestions("test", [mockCandidate("84137099", 0.9)]);
    expect(result.suggestions[0]!.confidence).toBe(100);
  });

  it("filters suggestions without hsCode", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    suggestions: [
                      { hsCode: "84137099", nameVi: "x", confidence: 90, reasoning: "x" },
                      { hsCode: "", nameVi: "y", confidence: 50, reasoning: "y" },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await rerankSuggestions("test", [mockCandidate("84137099", 0.9)]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]!.hsCode).toBe("84137099");
  });

  it("respects topN limit", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    suggestions: [
                      { hsCode: "11111111", nameVi: "a", confidence: 90, reasoning: "x" },
                      { hsCode: "22222222", nameVi: "b", confidence: 80, reasoning: "x" },
                      { hsCode: "33333333", nameVi: "c", confidence: 70, reasoning: "x" },
                      { hsCode: "44444444", nameVi: "d", confidence: 60, reasoning: "x" },
                      { hsCode: "55555555", nameVi: "e", confidence: 50, reasoning: "x" },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await rerankSuggestions("test", [mockCandidate("11111111", 0.9)], { topN: 3 });
    expect(result.suggestions).toHaveLength(3);
  });

  it("includes past feedback in prompt when available", async () => {
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
        candidates: [{ content: { parts: [{ text: JSON.stringify({ suggestions: [] }) }] } }],
      }),
    });

    await rerankSuggestions("máy bơm 220V", [mockCandidate("84137099", 0.92)]);
    const prompt = JSON.parse(fetchMock.mock.calls[0]![1].body).contents[0].parts[0].text;
    expect(prompt).toContain("FEEDBACK CŨ TỪ CEO");
    expect(prompt).toContain("Thiếu công suất <750W");
  });

  it("includes EXCLUDES notes in prompt when present", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify({ suggestions: [] }) }],
            },
          },
        ],
      }),
    });

    const candidate: SuggestEvidence = {
      hsCode: "84137099",
      tariffMatch: {
        similarity: 0.9,
        nameVi: "x",
        nameEn: null,
        unitVi: null,
        taxNkPreferential: null,
        taxVat: null,
        discriminatingFeatures: [],
      },
      notesMatch: [
        {
          similarity: 0.8,
          noteType: "EXCLUDES",
          noteVi: "Loại trừ bơm tay",
          level: "HEADING",
          code: "8413",
        },
      ],
      historicalMatch: [],
      combinedScore: 0.9,
    };
    await rerankSuggestions("test", [candidate]);
    const prompt = JSON.parse(fetchMock.mock.calls[0]![1].body).contents[0].parts[0].text;
    expect(prompt).toContain("LOẠI TRỪ");
    expect(prompt).toContain("bơm tay");
  });
});
