// Layer: L3 — Hải Quan
// Module: api-suggest
// POST /api/suggest
// Body: { description, options?: { topCandidates?, topReranked?, skipRerank? } }
// Returns: { suggestions, evidence, llmModel?, promptTokensApprox?, ms, skippedRerank?, rerankError? }
//
// Phase 7.1.T5: port từ ERP /api/hs-code/suggest sang service riêng.
// Auth: handled by middleware.ts (Bearer HS_KB_API_TOKEN)

import { NextRequest, NextResponse } from "next/server";
import { suggestHsCodeCandidates } from "@/src/lib/hs-knowledge/suggest";
import { rerankSuggestions } from "@/src/lib/hs-knowledge/rerank";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type RequestBody = {
  description?: unknown;
  options?: {
    topCandidates?: unknown;
    topReranked?: unknown;
    skipRerank?: unknown;
  };
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!description || description.length < 3) {
    return NextResponse.json(
      { error: "description phải ≥3 ký tự" },
      { status: 400 },
    );
  }

  const topCandidates = clampInt(body.options?.topCandidates, 10, 1, 30);
  const topReranked = clampInt(body.options?.topReranked, 3, 1, 10);
  const skipRerank = body.options?.skipRerank === true;

  let evidence;
  try {
    evidence = await suggestHsCodeCandidates(description, { topK: topCandidates });
  } catch (e) {
    return NextResponse.json(
      { error: "Search failed: " + (e instanceof Error ? e.message : String(e)) },
      { status: 500 },
    );
  }

  if (evidence.length === 0) {
    return NextResponse.json({
      suggestions: [],
      evidence: [],
      ms: Date.now() - startMs,
    });
  }

  if (skipRerank) {
    return NextResponse.json({
      suggestions: [],
      evidence,
      ms: Date.now() - startMs,
      skippedRerank: true,
    });
  }

  let rerank;
  try {
    rerank = await rerankSuggestions(description, evidence, { topN: topReranked });
  } catch (e) {
    // Rerank failure → degrade to evidence-only response
    return NextResponse.json({
      suggestions: [],
      evidence,
      ms: Date.now() - startMs,
      rerankError: e instanceof Error ? e.message : String(e),
    });
  }

  return NextResponse.json({
    suggestions: rerank.suggestions,
    evidence,
    llmModel: rerank.llmModel,
    promptTokensApprox: rerank.promptTokensApprox,
    ms: Date.now() - startMs,
  });
}

function clampInt(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.floor(v)));
}
