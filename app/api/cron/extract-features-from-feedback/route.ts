// Layer: L3+Infra
// Module: cron-extract-features
// Phase 7.1: port từ ERP /api/cron/extract-features-from-feedback
// Schedule: daily 4am UTC (vercel.json)
// Auth: middleware.ts checks CRON_SECRET cho path /api/cron/*

import { NextRequest, NextResponse } from "next/server";
import { extractFeaturesFromAllFeedback } from "@/src/lib/hs-knowledge/feature-extractor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(_req: NextRequest) {
  try {
    const results = await extractFeaturesFromAllFeedback({ dryRun: false });
    const totalPromoted = results.reduce((s, r) => s + r.newlyPromoted.length, 0);
    return NextResponse.json({
      ok: true,
      hsProcessed: results.length,
      totalPromoted,
      details: results.map((r) => ({
        hsCode: r.hsCode,
        feedbackCount: r.feedbackCount,
        newlyPromoted: r.newlyPromoted,
        belowThreshold: r.belowThreshold.map((c) => `${c.feature}×${c.count}`),
        error: r.error,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
