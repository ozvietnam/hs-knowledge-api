// Layer: L3
// Module: hs-knowledge-suggest tests

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: vi.fn() },
}));

vi.mock("@/src/lib/hs-knowledge/embed", () => ({
  geminiEmbed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

import { prisma } from "@/src/lib/prisma";
import { suggestHsCodeCandidates } from "../suggest";

const prismaMock = prisma as unknown as {
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("suggestHsCodeCandidates", () => {
  it("returns [] for short query", async () => {
    const result = await suggestHsCodeCandidates("a");
    expect(result).toEqual([]);
  });

  it("merges results by HS code from 3 sources", async () => {
    // Tariff returns 1 match for 84137099
    // Notes returns chapter 84 note (parent of 84137099)
    // Historical returns 1 match for 84137099 APPROVED
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        {
          hsCode: "84137099",
          nameVi: "Máy bơm khác",
          nameEn: null,
          unitVi: "Cái",
          taxNkPreferential: "5",
          taxVat: "10",
          discriminatingFeatures: ["ly tâm"],
          similarity: 0.92,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "note1",
          level: "HEADING",
          code: "8413",
          noteType: "INCLUDES",
          noteVi: "Nhóm này bao gồm máy bơm các loại",
          similarity: 0.85,
        },
      ])
      .mockResolvedValueOnce([
        {
          hsCode: "84137099",
          productNameRaw: "Máy bơm 220V Pentax CM50",
          brand: "Pentax",
          origin: "Italy",
          outcome: "APPROVED",
          similarity: 0.88,
        },
      ]);

    const result = await suggestHsCodeCandidates("máy bơm ly tâm inox 220V");

    expect(result).toHaveLength(1);
    expect(result[0]!.hsCode).toBe("84137099");
    expect(result[0]!.tariffMatch?.similarity).toBe(0.92);
    expect(result[0]!.notesMatch).toHaveLength(1);
    expect(result[0]!.notesMatch[0]!.code).toBe("8413"); // chapter prefix match
    expect(result[0]!.historicalMatch).toHaveLength(1);
    expect(result[0]!.historicalMatch[0]!.outcome).toBe("APPROVED");
    expect(result[0]!.combinedScore).toBeGreaterThan(0.5);
  });

  it("penalizes QUESTIONED historical evidence", async () => {
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        {
          hsCode: "11111111",
          nameVi: "A",
          nameEn: null,
          unitVi: null,
          taxNkPreferential: null,
          taxVat: null,
          discriminatingFeatures: [],
          similarity: 0.8,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          hsCode: "11111111",
          productNameRaw: "X",
          brand: null,
          origin: null,
          outcome: "QUESTIONED",
          similarity: 0.9,
        },
      ]);

    const result = await suggestHsCodeCandidates("test");
    // QUESTIONED gets 0.5 multiplier → 0.45 from hist
    // combinedScore = 0.5*0.8 + 0 + 0.2*0.45 = 0.49
    expect(result[0]!.combinedScore).toBeCloseTo(0.49, 2);
  });

  it("respects topK limit", async () => {
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce(
        new Array(15).fill(0).map((_, i) => ({
          hsCode: `${i}`.padStart(8, "0"),
          nameVi: `Item ${i}`,
          nameEn: null,
          unitVi: null,
          taxNkPreferential: null,
          taxVat: null,
          discriminatingFeatures: [],
          similarity: 0.5 - i * 0.01,
        })),
      )
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await suggestHsCodeCandidates("test", { topK: 5 });
    expect(result).toHaveLength(5);
  });

  it("sorts by combinedScore desc", async () => {
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([
        {
          hsCode: "AAAA0000",
          nameVi: "Lower",
          nameEn: null,
          unitVi: null,
          taxNkPreferential: null,
          taxVat: null,
          discriminatingFeatures: [],
          similarity: 0.6,
        },
        {
          hsCode: "BBBB0000",
          nameVi: "Higher",
          nameEn: null,
          unitVi: null,
          taxNkPreferential: null,
          taxVat: null,
          discriminatingFeatures: [],
          similarity: 0.9,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await suggestHsCodeCandidates("test");
    expect(result[0]!.hsCode).toBe("BBBB0000");
    expect(result[1]!.hsCode).toBe("AAAA0000");
  });
});
