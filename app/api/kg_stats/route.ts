// Layer: L3
// Module: api-kg-stats
// GET /api/kg_stats — Thống kê tổng quan knowledge graph
// Phase 7.1.T3: port từ legacy/api/kg_stats.js sang App Router + Prisma
// Auth: Bearer token

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {

  // Parallel count cho mọi tầng
  const [
    tariffCount,
    tariffEmbedded,
    noteCount,
    noteByLevel,
    historicalCount,
    historicalByOutcome,
    conflictCount,
    conflictByRisk,
    feedbackCount,
    feedbackByType,
    chapterCounts,
  ] = await Promise.all([
    prisma.tariff2026.count(),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint as count
      FROM hs_kb.tariff_2026
      WHERE embedding IS NOT NULL
    `,
    prisma.hsExplanatoryNote.count(),
    prisma.hsExplanatoryNote.groupBy({
      by: ["level"],
      _count: { _all: true },
    }),
    prisma.historicalDeclarationItem.count(),
    prisma.historicalDeclarationItem.groupBy({
      by: ["outcome"],
      _count: { _all: true },
    }),
    prisma.hsConflict.count(),
    prisma.hsConflict.groupBy({
      by: ["riskLevel"],
      _count: { _all: true },
    }),
    prisma.hsKnowledgeFeedback.count(),
    prisma.hsKnowledgeFeedback.groupBy({
      by: ["feedbackType"],
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ chapter: string; count: bigint }>>`
      SELECT SUBSTRING("hsCode" FROM 1 FOR 2) AS chapter, COUNT(*)::bigint as count
      FROM hs_kb.tariff_2026
      GROUP BY chapter
      ORDER BY count DESC
      LIMIT 10
    `,
  ]);

  const tariffEmbeddedNum = Number(tariffEmbedded[0]?.count ?? 0n);
  const embeddedCoverage =
    tariffCount > 0 ? Math.round((tariffEmbeddedNum / tariffCount) * 10000) / 100 : 0;

  return NextResponse.json({
    service: "hs-knowledge-api",
    timestamp: new Date().toISOString(),

    // Tầng 1 — Fact
    tang_1_fact: {
      tong_ma_hs: tariffCount,
      embedded: tariffEmbeddedNum,
      embedded_coverage_pct: embeddedCoverage,
      top_10_chapter: chapterCounts.map((c) => ({
        chapter: c.chapter,
        count: Number(c.count),
      })),
    },

    // Tầng 2 — Legal
    tang_2_legal: {
      tong_note: noteCount,
      theo_level: noteByLevel.map((g) => ({
        level: g.level,
        count: g._count._all,
      })),
    },

    // Tầng 4 — Precedent
    tang_4_precedent: {
      tong_item: historicalCount,
      theo_outcome: historicalByOutcome.map((g) => ({
        outcome: g.outcome,
        count: g._count._all,
      })),
    },

    // Tầng 5 — Conflict
    tang_5_conflict: {
      tong_conflict: conflictCount,
      theo_risk: conflictByRisk.map((g) => ({
        risk: g.riskLevel,
        count: g._count._all,
      })),
    },

    // Tầng 9 — AI Feedback
    tang_9_ai_feedback: {
      tong_feedback: feedbackCount,
      theo_type: feedbackByType.map((g) => ({
        type: g.feedbackType,
        count: g._count._all,
      })),
    },
  });
}
