// Layer: L3+Infra
// Module: hs-knowledge-feature-extractor
// Ticket: SPR-W163-01
//
// Đọc accumulated HsKnowledgeFeedback per HS code → LLM extract candidate
// features từ directorNote → aggregate threshold ≥3 → promote vào
// Tariff2026.discriminatingFeatures.

import { prisma } from "@/src/lib/prisma";
import { withRetry } from "@/src/lib/hs-knowledge/embed";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EXTRACT_MODEL = process.env.GEMINI_EXTRACT_MODEL ?? "models/gemini-2.0-flash";
const DEFAULT_THRESHOLD = 3;

export type CandidateFeature = {
  feature: string; // normalized lowercase trimmed
  rawForms: string[]; // original phrasings
  count: number;
  sourceFeedbackIds: string[];
};

export type HsExtractionResult = {
  hsCode: string;
  feedbackCount: number;
  candidates: CandidateFeature[];
  existingFeatures: string[];
  newlyPromoted: string[];
  alreadyExisted: string[];
  belowThreshold: CandidateFeature[];
  writtenAt: Date | null;
  error?: string;
};

export type ExtractOptions = {
  threshold?: number;
  dryRun?: boolean;
};

/**
 * Process feedback for ONE HS code: LLM extract features từ directorNotes,
 * aggregate, threshold, promote.
 */
export async function extractFeaturesForHs(
  hsCode: string,
  options: ExtractOptions = {},
): Promise<HsExtractionResult> {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const dryRun = options.dryRun ?? false;

  // 1. Fetch all feedback for this HS (either hsCodeAtTime OR correctedHsCode)
  const feedbacks = await prisma.hsKnowledgeFeedback.findMany({
    where: {
      OR: [{ hsCodeAtTime: hsCode }, { correctedHsCode: hsCode }],
      directorNote: { not: null },
    },
    select: {
      id: true,
      hsCodeAtTime: true,
      correctedHsCode: true,
      directorNote: true,
      customsDescAtTime: true,
      productNameAtTime: true,
    },
  });

  if (feedbacks.length === 0) {
    return {
      hsCode,
      feedbackCount: 0,
      candidates: [],
      existingFeatures: [],
      newlyPromoted: [],
      alreadyExisted: [],
      belowThreshold: [],
      writtenAt: null,
    };
  }

  // 2. LLM extract features per feedback (parallel with concurrency limit)
  const perFeedback = await Promise.all(
    feedbacks.map(async (fb) => {
      try {
        const features = await withRetry(
          () =>
            callGeminiExtract({
              hsCode,
              directorNote: fb.directorNote ?? "",
              customsDesc: fb.customsDescAtTime ?? "",
              productName: fb.productNameAtTime ?? "",
            }),
          { maxRetries: 2, baseDelayMs: 1000 },
        );
        return { feedbackId: fb.id, features };
      } catch (e) {
        console.warn(`extractFeaturesForHs[${hsCode}]: failed feedback ${fb.id}: ${e}`);
        return { feedbackId: fb.id, features: [] as string[] };
      }
    }),
  );

  // 3. Aggregate by normalized feature
  const map = new Map<string, CandidateFeature>();
  for (const { feedbackId, features } of perFeedback) {
    for (const raw of features) {
      const normalized = normalize(raw);
      if (!normalized) continue;
      const existing = map.get(normalized);
      if (existing) {
        existing.count++;
        if (!existing.rawForms.includes(raw)) existing.rawForms.push(raw);
        if (!existing.sourceFeedbackIds.includes(feedbackId)) {
          existing.sourceFeedbackIds.push(feedbackId);
        }
      } else {
        map.set(normalized, {
          feature: normalized,
          rawForms: [raw],
          count: 1,
          sourceFeedbackIds: [feedbackId],
        });
      }
    }
  }
  const candidates = Array.from(map.values()).sort((a, b) => b.count - a.count);

  // 4. Compare with existing Tariff2026.discriminatingFeatures
  const tariff = await prisma.tariff2026.findUnique({
    where: { hsCode },
    select: { discriminatingFeatures: true },
  });
  const existing = (tariff?.discriminatingFeatures ?? []).map(normalize);

  const newlyPromoted: string[] = [];
  const alreadyExisted: string[] = [];
  const belowThreshold: CandidateFeature[] = [];

  for (const c of candidates) {
    if (existing.includes(c.feature)) {
      alreadyExisted.push(c.feature);
      continue;
    }
    if (c.count < threshold) {
      belowThreshold.push(c);
      continue;
    }
    newlyPromoted.push(c.feature);
  }

  // 5. Write to Tariff2026 (if not dryRun + has new features + tariff exists)
  let writtenAt: Date | null = null;
  if (!dryRun && newlyPromoted.length > 0 && tariff) {
    const updated = [...(tariff.discriminatingFeatures ?? []), ...newlyPromoted];
    // De-dupe (keep original casing of first occurrence)
    const seen = new Set<string>();
    const final = updated.filter((f) => {
      const n = normalize(f);
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    await prisma.tariff2026.update({
      where: { hsCode },
      data: { discriminatingFeatures: final },
    });
    writtenAt = new Date();
  }

  return {
    hsCode,
    feedbackCount: feedbacks.length,
    candidates,
    existingFeatures: tariff?.discriminatingFeatures ?? [],
    newlyPromoted,
    alreadyExisted,
    belowThreshold,
    writtenAt,
  };
}

/**
 * Process all HS codes that have ≥1 feedback record.
 */
export async function extractFeaturesFromAllFeedback(
  options: ExtractOptions = {},
): Promise<HsExtractionResult[]> {
  // Find distinct HS codes from feedback
  const distinct = await prisma.$queryRaw<{ hsCode: string }[]>`
    SELECT DISTINCT "hsCodeAtTime" AS "hsCode"
    FROM hs_kb.hs_knowledge_feedback
    WHERE "hsCodeAtTime" IS NOT NULL AND "directorNote" IS NOT NULL
    UNION
    SELECT DISTINCT "correctedHsCode" AS "hsCode"
    FROM hs_kb.hs_knowledge_feedback
    WHERE "correctedHsCode" IS NOT NULL
  `;
  const hsCodes = distinct.map((r) => r.hsCode).filter(Boolean);

  const results: HsExtractionResult[] = [];
  for (const hs of hsCodes) {
    try {
      results.push(await extractFeaturesForHs(hs, options));
    } catch (e) {
      results.push({
        hsCode: hs,
        feedbackCount: 0,
        candidates: [],
        existingFeatures: [],
        newlyPromoted: [],
        alreadyExisted: [],
        belowThreshold: [],
        writtenAt: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(feature: string): string {
  return feature.trim().toLowerCase().replace(/\s+/g, " ");
}

async function callGeminiExtract(input: {
  hsCode: string;
  directorNote: string;
  customsDesc: string;
  productName: string;
}): Promise<string[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const prompt = buildExtractPrompt(input);
  const url = `${GEMINI_API_BASE}/${EXTRACT_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, response_mime_type: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini extract ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const arr = (parsed as Record<string, unknown>).features;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((f): f is string => typeof f === "string")
    .map((f) => f.trim())
    .filter((f) => f.length > 0 && f.length < 100); // sanity limits
}

function buildExtractPrompt(input: {
  hsCode: string;
  directorNote: string;
  customsDesc: string;
  productName: string;
}): string {
  return [
    "Bạn là chuyên gia phân loại HS code Việt Nam.",
    "",
    "Nhiệm vụ: từ ghi chú CEO/Director (khi trả về tờ khai cho NV), extract các",
    "ĐẶC ĐIỂM KHU BIỆT (discriminating features) cần có để loại trừ HS code lân cận.",
    "",
    `### HS code: ${input.hsCode}`,
    `### Tên sản phẩm: ${input.productName}`,
    `### Mô tả NV đã viết (có lỗi): ${input.customsDesc || "(empty)"}`,
    `### Ghi chú CEO chỉ ra: ${input.directorNote}`,
    "",
    "Hãy extract ngắn gọn các đặc điểm CEO muốn nêu (ví dụ: 'ly tâm', 'động cơ điện', 'công suất <750W').",
    "Mỗi feature 1-5 từ, viết thường, tiếng Việt + ký hiệu kỹ thuật nếu có.",
    "",
    "Trả lời CHỈ JSON:",
    "```json",
    '{ "features": ["...", "..."] }',
    "```",
  ].join("\n");
}
