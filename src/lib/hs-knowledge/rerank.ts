// Layer: L3
// Module: hs-knowledge-rerank
// Ticket: SPR-W159-02
//
// LLM rerank: gửi top candidates + evidence (chú giải HS + historical) qua
// Gemini Flash, return structured top-3 với confidence + reasoning +
// disambiguation_features (đặc điểm khu biệt cần khai).

import { withRetry } from "@/src/lib/hs-knowledge/embed";
import { searchSimilarFeedback, type SimilarFeedback } from "@/src/lib/hs-knowledge/feedback";
import type { SuggestEvidence } from "@/src/lib/hs-knowledge/suggest";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Default: gemini-2.5-flash (gemini-2.0-flash bị Google deprecate cho new users từ 2026-05).
const RERANK_MODEL = process.env.GEMINI_RERANK_MODEL ?? "models/gemini-2.5-flash";

export type RerankedSuggestion = {
  hsCode: string;
  nameVi: string;
  confidence: number; // 0-100
  reasoning: string; // why this HS code matches
  disambiguationFeatures: string[]; // features that need to be in mô tả khai báo
  excludedAlternatives: Array<{
    hsCode: string;
    reason: string; // why NOT this neighbor
  }>;
};

export type RerankResult = {
  suggestions: RerankedSuggestion[];
  llmModel: string;
  promptTokensApprox: number;
};

export async function rerankSuggestions(
  description: string,
  candidates: SuggestEvidence[],
  options: { topN?: number; maxCandidates?: number } = {},
): Promise<RerankResult> {
  const topN = options.topN ?? 3;
  const maxCandidates = options.maxCandidates ?? 8;

  if (!candidates.length) {
    return { suggestions: [], llmModel: RERANK_MODEL, promptTokensApprox: 0 };
  }

  // Slice top maxCandidates by combinedScore (already sorted from suggest.ts)
  const sliced = candidates.slice(0, maxCandidates);

  // Fetch past CEO feedback for anti-pattern hints (fail-silent — empty array on error)
  const pastFeedback = await searchSimilarFeedback(description, 3).catch(
    () => [] as SimilarFeedback[],
  );

  const prompt = buildPrompt(description, sliced, topN, pastFeedback);
  const tokenEstimate = Math.ceil(prompt.length / 4); // rough char-to-token

  const json = await withRetry(() => callGeminiJson(prompt), { maxRetries: 2, baseDelayMs: 1000 });

  return {
    suggestions: parseResponse(json, topN),
    llmModel: RERANK_MODEL,
    promptTokensApprox: tokenEstimate,
  };
}

function buildPrompt(
  description: string,
  candidates: SuggestEvidence[],
  topN: number,
  pastFeedback: SimilarFeedback[] = [],
): string {
  const lines: string[] = [];
  lines.push("Bạn là chuyên gia phân loại HS code Việt Nam.");
  lines.push("");
  lines.push(`MÔ TẢ SẢN PHẨM CỦA KHÁCH: "${description}"`);
  lines.push("");
  lines.push("DANH SÁCH HS CODE ỨNG VIÊN (từ semantic search):");
  for (const c of candidates) {
    lines.push("");
    lines.push(`▪ HS ${c.hsCode}`);
    if (c.tariffMatch) {
      lines.push(
        `  Tên: ${c.tariffMatch.nameVi}${c.tariffMatch.nameEn ? " / " + c.tariffMatch.nameEn : ""}`,
      );
      lines.push(
        `  ĐVT: ${c.tariffMatch.unitVi ?? "-"} · NK ưu đãi: ${c.tariffMatch.taxNkPreferential ?? "-"}% · VAT: ${c.tariffMatch.taxVat ?? "-"}`,
      );
      if (c.tariffMatch.discriminatingFeatures.length > 0) {
        lines.push(`  Đặc điểm khu biệt: ${c.tariffMatch.discriminatingFeatures.join(", ")}`);
      }
    } else {
      lines.push(`  (Không có trong biểu thuế 2026 — match qua chú giải/tờ khai cũ)`);
    }
    if (c.notesMatch.length > 0) {
      lines.push(`  Chú giải HS liên quan (${c.notesMatch.length} note):`);
      for (const n of c.notesMatch.slice(0, 3)) {
        const marker = n.noteType === "EXCLUDES" ? "⚠ LOẠI TRỪ" : n.noteType;
        lines.push(
          `    - [${marker}] ${n.noteVi.slice(0, 200)}${n.noteVi.length > 200 ? "..." : ""}`,
        );
      }
    }
    if (c.historicalMatch.length > 0) {
      const approved = c.historicalMatch.filter((h) => h.outcome === "APPROVED").length;
      const questioned = c.historicalMatch.filter((h) => h.outcome === "QUESTIONED").length;
      lines.push(
        `  Tờ khai cũ tương tự: ${c.historicalMatch.length} item (✅ ${approved} APPROVED, ⚠ ${questioned} QUESTIONED)`,
      );
      const best = c.historicalMatch[0];
      if (best) {
        lines.push(
          `    Best match: "${best.productNameRaw}"${best.brand ? " " + best.brand : ""}${best.origin ? " (" + best.origin + ")" : ""} → ${best.outcome}`,
        );
      }
    }
  }
  if (pastFeedback.length > 0) {
    lines.push("");
    lines.push("⚠ FEEDBACK CŨ TỪ CEO (các case đã bị trả về NV — học từ lỗi):");
    for (const fb of pastFeedback) {
      lines.push(
        `- HS đã thử: ${fb.hsCodeAtTime ?? "?"} | Sản phẩm tương tự: "${fb.productNameAtTime ?? "?"}"`,
      );
      if (fb.customsDescAtTime)
        lines.push(`  Mô tả NV đã viết: "${fb.customsDescAtTime.slice(0, 150)}"`);
      if (fb.directorNote) lines.push(`  CEO chỉ ra lỗi: "${fb.directorNote.slice(0, 200)}"`);
      if (fb.correctedHsCode) lines.push(`  HS đúng (CEO sửa): ${fb.correctedHsCode}`);
    }
    lines.push("→ Sử dụng feedback này để tránh chọn HS sai hoặc bỏ sót đặc điểm khu biệt.");
  }
  lines.push("");
  lines.push("NHIỆM VỤ:");
  lines.push(`Chọn TOP ${topN} HS code phù hợp nhất với mô tả sản phẩm.`);
  lines.push("Với mỗi HS được chọn, cung cấp:");
  lines.push("1. confidence: 0-100 (mức tự tin)");
  lines.push("2. reasoning: lý do chọn (≤2 câu)");
  lines.push(
    "3. disambiguation_features: đặc điểm phải nêu trong mô tả khai báo để loại trừ HS lân cận",
  );
  lines.push("4. excluded_alternatives: 1-2 HS lân cận bị loại trừ và lý do");
  lines.push("");
  lines.push("Trả lời CHỈ ở format JSON:");
  lines.push("```json");
  lines.push("{");
  lines.push('  "suggestions": [');
  lines.push("    {");
  lines.push('      "hsCode": "...",');
  lines.push('      "nameVi": "...",');
  lines.push('      "confidence": 85,');
  lines.push('      "reasoning": "...",');
  lines.push('      "disambiguationFeatures": ["..."],');
  lines.push('      "excludedAlternatives": [{"hsCode": "...", "reason": "..."}]');
  lines.push("    }");
  lines.push("  ]");
  lines.push("}");
  lines.push("```");
  return lines.join("\n");
}

async function callGeminiJson(prompt: string): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const url = `${GEMINI_API_BASE}/${RERANK_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        response_mime_type: "application/json",
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini rerank ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response empty");
  return JSON.parse(text);
}

function parseResponse(raw: unknown, topN: number): RerankedSuggestion[] {
  if (typeof raw !== "object" || raw === null) return [];
  const obj = raw as Record<string, unknown>;
  const arr = obj.suggestions;
  if (!Array.isArray(arr)) return [];

  return arr
    .slice(0, topN)
    .map((item): RerankedSuggestion => {
      const it = item as Record<string, unknown>;
      return {
        hsCode: String(it.hsCode ?? ""),
        nameVi: String(it.nameVi ?? ""),
        confidence:
          typeof it.confidence === "number" ? Math.max(0, Math.min(100, it.confidence)) : 0,
        reasoning: String(it.reasoning ?? ""),
        disambiguationFeatures: Array.isArray(it.disambiguationFeatures)
          ? it.disambiguationFeatures.map((f) => String(f))
          : [],
        excludedAlternatives: Array.isArray(it.excludedAlternatives)
          ? (it.excludedAlternatives as unknown[]).map((alt) => {
              const a = alt as Record<string, unknown>;
              return { hsCode: String(a.hsCode ?? ""), reason: String(a.reason ?? "") };
            })
          : [],
      };
    })
    .filter((s) => s.hsCode);
}
