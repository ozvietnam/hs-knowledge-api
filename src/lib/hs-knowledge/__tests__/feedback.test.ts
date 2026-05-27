// Layer: L3
// Module: hs-knowledge-feedback tests
// Ticket: SPR-W162-01

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    hsKnowledgeFeedback: { create: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
}));
vi.mock("@/src/lib/hs-knowledge/embed", () => ({
  geminiEmbed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

import { prisma } from "@/src/lib/prisma";
import { recordFeedback, searchSimilarFeedback, feedbackText } from "../feedback";

const prismaMock = prisma as unknown as {
  hsKnowledgeFeedback: { create: ReturnType<typeof vi.fn> };
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordFeedback", () => {
  it("creates feedback record with required fields", async () => {
    prismaMock.hsKnowledgeFeedback.create.mockResolvedValue({ id: "fb-1" });
    const id = await recordFeedback({
      feedbackType: "RETURNED_BY_DIRECTOR",
      orderItemId: "item-1",
      hsCodeAtTime: "84137099",
      directorNote: "Mô tả thiếu công suất, cần thêm <750W để loại trừ 8413.81",
      directorUserId: "u-mgr",
    });
    expect(id).toBe("fb-1");
    const call = prismaMock.hsKnowledgeFeedback.create.mock.calls[0]?.[0];
    expect(call.data.feedbackType).toBe("RETURNED_BY_DIRECTOR");
    expect(call.data.directorNote).toContain("<750W");
  });

  it("defaults optional fields to null/empty", async () => {
    prismaMock.hsKnowledgeFeedback.create.mockResolvedValue({ id: "fb-2" });
    await recordFeedback({ feedbackType: "MANUAL_FEEDBACK" });
    const call = prismaMock.hsKnowledgeFeedback.create.mock.calls[0]?.[0];
    expect(call.data.orderItemId).toBeNull();
    expect(call.data.ministriesAtTime).toEqual([]);
    expect(call.data.directorNote).toBeNull();
  });
});

describe("searchSimilarFeedback", () => {
  it("returns [] for query < 3 chars", async () => {
    const result = await searchSimilarFeedback("ab");
    expect(result).toEqual([]);
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("embeds query + raw SQL cosine search", async () => {
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      {
        id: "fb-1",
        feedbackType: "RETURNED_BY_DIRECTOR",
        hsCodeAtTime: "84137099",
        customsDescAtTime: "Máy bơm 220V",
        productNameAtTime: "Máy bơm",
        directorNote: "Thiếu ly tâm",
        correctedHsCode: null,
        correctedDesc: null,
        similarity: 0.92,
      },
    ]);
    const result = await searchSimilarFeedback("máy bơm ly tâm");
    expect(result).toHaveLength(1);
    expect(result[0]!.similarity).toBeCloseTo(0.92);
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledOnce();
    const call = prismaMock.$queryRawUnsafe.mock.calls[0];
    expect(String(call?.[0])).toContain("embedding <=>");
    expect(String(call?.[0])).toContain("LIMIT $2");
  });

  it("returns [] gracefully when DB throws", async () => {
    prismaMock.$queryRawUnsafe.mockRejectedValue(new Error("connection lost"));
    const result = await searchSimilarFeedback("máy bơm");
    expect(result).toEqual([]);
  });
});

describe("feedbackText", () => {
  it("composes product + desc + HS + note", () => {
    const t = feedbackText({
      productNameAtTime: "Máy bơm",
      customsDescAtTime: "Máy bơm 220V Pentax",
      hsCodeAtTime: "84137099",
      directorNote: "Thiếu công suất",
    });
    expect(t).toContain("Máy bơm");
    expect(t).toContain("Pentax");
    expect(t).toContain("HS 84137099");
    expect(t).toContain("Note: Thiếu công suất");
  });

  it("handles null fields gracefully", () => {
    const t = feedbackText({
      productNameAtTime: null,
      customsDescAtTime: null,
      hsCodeAtTime: null,
      directorNote: "Just a note",
    });
    expect(t).toBe("Note: Just a note");
  });
});
