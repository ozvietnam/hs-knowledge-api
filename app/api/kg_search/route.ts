// Layer: L3
// Module: api-kg-search
// GET /api/kg_search?q=máy+bơm&limit=20&chapter=84&risk=ORANGE
// Tìm kiếm trong knowledge graph — DB-backed (Postgres tsvector + trigram + prefix)
// Phase 7.1.T3: port từ legacy/api/kg_search.js (JSON in-memory) sang Prisma + Postgres FTS
// Auth: Bearer token

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchHit = {
  hsCode: string;
  nameVi: string;
  nameEn: string | null;
  unitVi: string | null;
  taxNkPreferential: string | null;
  taxVat: string | null;
  // Tầng 5 risk (nếu có)
  conflictRisk?: string | null;
  // Match metadata
  matchType: "exact_prefix" | "fulltext" | "trigram";
  rank?: number;
};

export async function GET(req: NextRequest) {

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json(
      { error: "Tham số q phải có ít nhất 2 ký tự" },
      { status: 400 },
    );
  }

  const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const chapter = req.nextUrl.searchParams.get("chapter")?.trim();
  const risk = req.nextUrl.searchParams.get("risk")?.trim()?.toUpperCase();

  const validRisks = new Set(["GREEN", "YELLOW", "ORANGE", "RED"]);
  const riskFilter = risk && validRisks.has(risk) ? risk : null;

  const chapterPad = chapter ? chapter.padStart(2, "0") : null;

  // Tier 1: số → exact prefix
  if (/^\d{2,12}$/.test(q)) {
    const code = q.replace(/\./g, "");
    const rows = await prisma.tariff2026.findMany({
      where: {
        hsCode: { startsWith: code },
        ...(chapterPad ? { hsCode: { startsWith: chapterPad } } : {}),
      },
      take: limit,
      orderBy: { hsCode: "asc" },
      select: {
        hsCode: true,
        nameVi: true,
        nameEn: true,
        unitVi: true,
        taxNkPreferential: true,
        taxVat: true,
      },
    });

    if (rows.length > 0) {
      const enriched = await attachConflictRisk(rows);
      const filtered = riskFilter
        ? enriched.filter((r) => r.conflictRisk === riskFilter)
        : enriched;
      return NextResponse.json({
        keyword: q,
        mode: "exact_prefix",
        total: filtered.length,
        filters: { chapter: chapterPad, risk: riskFilter },
        results: filtered.map((r) => ({ ...r, matchType: "exact_prefix" as const })),
      });
    }
  }

  // Tier 2: tsvector FTS (Postgres simple parser cho Vietnamese)
  const fts = await prisma.$queryRaw<
    Array<{
      hsCode: string;
      nameVi: string;
      nameEn: string | null;
      unitVi: string | null;
      taxNkPreferential: string | null;
      taxVat: string | null;
      rank: number;
    }>
  >`
    SELECT
      "hsCode", "nameVi", "nameEn", "unitVi", "taxNkPreferential", "taxVat",
      ts_rank(
        to_tsvector('simple', coalesce("nameVi",'') || ' ' || coalesce("nameEn",'') || ' ' || "hsCode"),
        plainto_tsquery('simple', ${q})
      ) AS rank
    FROM hs_kb.tariff_2026
    WHERE
      to_tsvector('simple', coalesce("nameVi",'') || ' ' || coalesce("nameEn",'') || ' ' || "hsCode")
      @@ plainto_tsquery('simple', ${q})
      ${chapterPad ? prismaSqlChapter(chapterPad) : prismaSqlNoop()}
    ORDER BY rank DESC
    LIMIT ${limit}
  `;

  if (fts.length > 0) {
    const enriched = await attachConflictRisk(fts);
    const filtered = riskFilter
      ? enriched.filter((r) => r.conflictRisk === riskFilter)
      : enriched;
    return NextResponse.json({
      keyword: q,
      mode: "fulltext",
      total: filtered.length,
      filters: { chapter: chapterPad, risk: riskFilter },
      results: filtered.map((r) => ({ ...r, matchType: "fulltext" as const })),
    });
  }

  // Tier 3: ILIKE fallback (cho query có dấu/không dấu mix)
  const fallback = await prisma.tariff2026.findMany({
    where: {
      AND: [
        { OR: [{ nameVi: { contains: q, mode: "insensitive" } }, { nameEn: { contains: q, mode: "insensitive" } }] },
        ...(chapterPad ? [{ hsCode: { startsWith: chapterPad } }] : []),
      ],
    },
    take: limit,
    select: {
      hsCode: true,
      nameVi: true,
      nameEn: true,
      unitVi: true,
      taxNkPreferential: true,
      taxVat: true,
    },
  });

  const enriched = await attachConflictRisk(fallback);
  const filtered = riskFilter
    ? enriched.filter((r) => r.conflictRisk === riskFilter)
    : enriched;

  return NextResponse.json({
    keyword: q,
    mode: "trigram",
    total: filtered.length,
    filters: { chapter: chapterPad, risk: riskFilter },
    results: filtered.map((r) => ({ ...r, matchType: "trigram" as const })),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function attachConflictRisk<
  T extends { hsCode: string; nameVi: string; nameEn: string | null; unitVi: string | null; taxNkPreferential: string | null; taxVat: string | null },
>(rows: T[]): Promise<Array<T & { conflictRisk: string | null }>> {
  if (rows.length === 0) return [];
  const codes = rows.map((r) => r.hsCode);
  const conflicts: Array<{ hsCode: string; riskLevel: string }> = await prisma.hsConflict.findMany({
    where: { hsCode: { in: codes } },
    select: { hsCode: true, riskLevel: true },
  });
  const riskMap = new Map<string, string>(conflicts.map((c) => [c.hsCode, c.riskLevel]));
  return rows.map((r) => ({
    ...r,
    conflictRisk: riskMap.get(r.hsCode) ?? null,
  }));
}

// Prisma tagged template helpers (raw SQL conditional clauses)
import { Prisma } from "@prisma/client";
function prismaSqlChapter(chapterPad: string) {
  return Prisma.sql` AND "hsCode" LIKE ${chapterPad + "%"}`;
}
function prismaSqlNoop() {
  return Prisma.empty;
}
