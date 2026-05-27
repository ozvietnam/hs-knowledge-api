// Layer: L3
// Module: hs-knowledge-search tests
// Ticket: SPR-W158-05

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    tariff2026: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock("@/src/lib/hs-knowledge/embed", () => ({
  geminiEmbed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

import { prisma } from "@/src/lib/prisma";
import { searchHsCodes } from "../search";

const prismaMock = prisma as unknown as {
  tariff2026: { findMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchHsCodes", () => {
  it("returns [] when query < 2 chars", async () => {
    const result = await searchHsCodes("a", 10, "auto");
    expect(result).toEqual([]);
  });

  it("Tier 1: numeric query → exact match", async () => {
    prismaMock.tariff2026.findMany.mockResolvedValue([
      {
        hsCode: "84137099",
        nameVi: "Máy bơm",
        nameEn: "Pump",
        unitVi: "Cái",
        taxNkPreferential: "5",
        taxAcfta: "0",
        taxVat: "10",
        discriminatingFeatures: [],
      },
    ]);
    const result = await searchHsCodes("8413", 10, "auto");
    expect(result).toHaveLength(1);
    expect(result[0]?.matchType).toBe("exact");
    expect(result[0]?.code).toBe("84137099");
  });

  it("Tier 2: text query → FTS match", async () => {
    prismaMock.tariff2026.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        hsCode: "84137099",
        nameVi: "Máy bơm",
        nameEn: "Pump",
        unitVi: "Cái",
        taxNkPreferential: "5",
        taxAcfta: "0",
        taxVat: "10",
        discriminatingFeatures: [],
        rank: 0.8,
      },
      {
        hsCode: "84138190",
        nameVi: "Máy bơm khác",
        nameEn: "Other pumps",
        unitVi: "Cái",
        taxNkPreferential: "5",
        taxAcfta: "0",
        taxVat: "10",
        discriminatingFeatures: [],
        rank: 0.6,
      },
      {
        hsCode: "84138100",
        nameVi: "Máy bơm cho chất lỏng",
        nameEn: "",
        unitVi: "Cái",
        taxNkPreferential: "5",
        taxAcfta: "0",
        taxVat: "10",
        discriminatingFeatures: [],
        rank: 0.5,
      },
    ]);
    const result = await searchHsCodes("máy bơm", 10, "auto");
    expect(result).toHaveLength(3);
    expect(result[0]?.matchType).toBe("fulltext");
  });

  it("Tier 3: FTS yields <3 results → semantic fallback", async () => {
    prismaMock.tariff2026.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue([
      {
        hsCode: "11111111",
        nameVi: "Mơ hồ",
        nameEn: "",
        unitVi: null,
        taxNkPreferential: null,
        taxAcfta: null,
        taxVat: null,
        discriminatingFeatures: [],
        rank: 0.1,
      },
    ]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      {
        hsCode: "84137099",
        nameVi: "Máy bơm tương tự",
        nameEn: "",
        unitVi: "Cái",
        taxNkPreferential: "5",
        taxAcfta: "0",
        taxVat: "10",
        discriminatingFeatures: [],
        similarity: 0.92,
      },
    ]);
    const result = await searchHsCodes("thiết bị bơm chất lỏng", 10, "auto");
    expect(result.some((r) => r.matchType === "semantic")).toBe(true);
  });

  it("respects limit clamp", async () => {
    prismaMock.tariff2026.findMany.mockResolvedValue([]);
    prismaMock.$queryRaw.mockResolvedValue(
      new Array(30).fill(0).map((_, i) => ({
        hsCode: `${i}`.padStart(8, "0"),
        nameVi: "x",
        nameEn: "",
        unitVi: null,
        taxNkPreferential: "0",
        taxAcfta: "0",
        taxVat: "0",
        discriminatingFeatures: [],
        rank: 0,
      })),
    );
    const result = await searchHsCodes("test", 100, "auto");
    expect(result.length).toBeLessThanOrEqual(20);
  });
});
