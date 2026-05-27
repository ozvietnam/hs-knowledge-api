// Layer: L3
// Module: hs-knowledge-feedback
// Ticket: SPR-W162-01
//
// Feedback capture + semantic retrieval for the HS knowledge feedback loop.
// CEO returning a CUS check item to NV with a note is gold training signal —
// snapshot it as HsKnowledgeFeedback, embed it via the cron pipeline, then
// surface top-K similar feedback in future LLM prompts as anti-pattern hints.

import { prisma } from "@/src/lib/prisma";
import { geminiEmbed } from "@/src/lib/hs-knowledge/embed";

export type FeedbackType =
  | "RETURNED_BY_DIRECTOR"
  | "DIRECTOR_HS_OVERRIDE"
  | "DIRECTOR_DESCRIPTION_EDIT"
  | "MANUAL_FEEDBACK";

export type RecordFeedbackInput = {
  feedbackType: FeedbackType;
  orderId?: string | null;
  orderItemId?: string | null;
  orderCode?: string | null;
  hsCodeAtTime?: string | null;
  customsDescAtTime?: string | null;
  productNameAtTime?: string | null;
  ministriesAtTime?: string[];
  directorNote?: string | null;
  directorUserId?: string | null;
  correctedHsCode?: string | null;
  correctedDesc?: string | null;
};

export async function recordFeedback(input: RecordFeedbackInput): Promise<string> {
  // Best-effort: caller is responsible for try/catch if they need to swallow.
  const created = await prisma.hsKnowledgeFeedback.create({
    data: {
      feedbackType: input.feedbackType,
      orderId: input.orderId ?? null,
      orderItemId: input.orderItemId ?? null,
      orderCode: input.orderCode ?? null,
      hsCodeAtTime: input.hsCodeAtTime ?? null,
      customsDescAtTime: input.customsDescAtTime ?? null,
      productNameAtTime: input.productNameAtTime ?? null,
      ministriesAtTime: input.ministriesAtTime ?? [],
      directorNote: input.directorNote ?? null,
      directorUserId: input.directorUserId ?? null,
      correctedHsCode: input.correctedHsCode ?? null,
      correctedDesc: input.correctedDesc ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

export type SimilarFeedback = {
  id: string;
  feedbackType: FeedbackType;
  hsCodeAtTime: string | null;
  customsDescAtTime: string | null;
  productNameAtTime: string | null;
  directorNote: string | null;
  correctedHsCode: string | null;
  correctedDesc: string | null;
  similarity: number;
};

/**
 * Semantic search trên HsKnowledgeFeedback bằng cosine similarity.
 * Trả về top-K feedback gần với description query nhất, để inject vào LLM prompt
 * như anti-pattern examples ("Đây là các case CEO đã trả về NV — tránh pattern này").
 *
 * Fail-silent: trả về [] nếu lỗi (embed, DB...) — không block parent flow.
 */
export async function searchSimilarFeedback(
  description: string,
  limit = 3,
): Promise<SimilarFeedback[]> {
  if (!description || description.trim().length < 3) return [];

  try {
    const queryEmbedding = await geminiEmbed(description.trim());
    const vec = `[${queryEmbedding.join(",")}]`;
    const rows = await prisma.$queryRawUnsafe<SimilarFeedback[]>(
      `SELECT id, "feedbackType", "hsCodeAtTime", "customsDescAtTime",
              "productNameAtTime", "directorNote", "correctedHsCode", "correctedDesc",
              1 - (embedding <=> $1::vector) AS similarity
       FROM hs_kb.hs_knowledge_feedback
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vec,
      limit,
    );
    return rows;
  } catch (e) {
    console.warn(`searchSimilarFeedback failed: ${e}`);
    return [];
  }
}

/**
 * Build text representation for embedding. Mirrors tariffText/noteText/historicalText
 * patterns from embed.ts so the cron can re-use embedTable() uniformly.
 */
export function feedbackText(f: {
  productNameAtTime: string | null;
  customsDescAtTime: string | null;
  hsCodeAtTime: string | null;
  directorNote: string | null;
}): string {
  return [
    f.productNameAtTime ?? "",
    f.customsDescAtTime ?? "",
    f.hsCodeAtTime ? `HS ${f.hsCodeAtTime}` : "",
    f.directorNote ? `Note: ${f.directorNote}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
