// Layer: L3+Infra
// Module: cron-embed-knowledge-base
// Phase 7.1: port từ ERP /api/cron/embed-knowledge-base
// Schedule: weekly Sun 3am UTC (vercel.json)
// Auth: middleware.ts checks CRON_SECRET cho path /api/cron/*

import { NextRequest, NextResponse } from "next/server";
import {
  embedTable,
  tariffText,
  noteText,
  historicalText,
} from "@/src/lib/hs-knowledge/embed";
import { feedbackText } from "@/src/lib/hs-knowledge/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(_req: NextRequest) {
  const results: Record<string, { embedded: number; failed: number }> = {};

  try {
    results.Tariff2026 = await embedTable({
      tableName: "Tariff2026",
      textBuilder: tariffText as never,
      limit: 500,
    });
    results.HsExplanatoryNote = await embedTable({
      tableName: "HsExplanatoryNote",
      textBuilder: noteText as never,
      limit: 500,
    });
    results.HistoricalDeclarationItem = await embedTable({
      tableName: "HistoricalDeclarationItem",
      textBuilder: historicalText as never,
      limit: 500,
    });
    results.HsKnowledgeFeedback = await embedTable({
      tableName: "HsKnowledgeFeedback",
      textBuilder: feedbackText as never,
      limit: 500,
    });
  } catch (e) {
    return NextResponse.json(
      { error: String(e), partial: results },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, results });
}
