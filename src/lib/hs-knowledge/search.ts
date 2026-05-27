// Layer: L3
// Module: hs-knowledge-search
// Ticket: SPR-W158-05
//
// 3-tier search: exact (numeric prefix) → tsvector FTS → pgvector semantic.

import { prisma } from "@/src/lib/prisma";
import { geminiEmbed } from "@/src/lib/hs-knowledge/embed";

export type SearchMode = "exact" | "fulltext" | "semantic" | "auto";

export type SearchResult = {
  code: string;
  description: string;
  descriptionEn: string | null;
  mfnRate: number;
  ftaRate: number;
  unit: string | null;
  vatRate: string | null;
  discriminatingFeatures: string[];
  matchType: "exact" | "fulltext" | "semantic";
  rank?: number;
  similarity?: number;
};

const MAX_LIMIT = 20;

export async function searchHsCodes(
  q: string,
  limit: number,
  mode: SearchMode,
): Promise<SearchResult[]> {
  const query = q.trim();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);

  if (!query || query.length < 2) return [];

  // Tier 1: exact prefix
  if ((mode === "auto" || mode === "exact") && /^\d{4,12}$/.test(query)) {
    const rows = await prisma.tariff2026.findMany({
      where: { hsCode: { startsWith: query } },
      take: lim,
    });
    if (rows.length) {
      return rows.map((r) => toResult(r, "exact"));
    }
  }

  // Tier 2: FTS
  let ftsResults: SearchResult[] = [];
  if (mode === "auto" || mode === "fulltext") {
    const ftsRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT *, ts_rank(search_tsv, plainto_tsquery('simple', ${query})) AS rank
      FROM hs_kb.tariff_2026
      WHERE search_tsv @@ plainto_tsquery('simple', ${query})
      ORDER BY rank DESC
      LIMIT ${lim}
    `;
    ftsResults = ftsRows.map((r) => toResult(r, "fulltext"));
    // In this branch mode is "auto" | "fulltext". If FTS has enough hits,
    // short-circuit (avoid expensive embedding call in auto mode).
    if (ftsResults.length >= 3) {
      return ftsResults.slice(0, lim);
    }
  }

  // Tier 3: semantic
  if (mode === "auto" || mode === "semantic") {
    try {
      const queryEmbedding = await geminiEmbed(query);
      const vec = `[${queryEmbedding.join(",")}]`;
      const semRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
         FROM hs_kb.tariff_2026
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        vec,
        lim,
      );
      const semResults = semRows.map((r) => toResult(r, "semantic"));
      const merged = mergeResults(ftsResults, semResults).slice(0, lim);
      return merged;
    } catch (e) {
      console.warn(`Semantic search failed: ${e}. Falling back to FTS only.`);
      return ftsResults;
    }
  }

  return ftsResults;
}

function toResult(
  r: Record<string, unknown>,
  matchType: "exact" | "fulltext" | "semantic",
): SearchResult {
  return {
    code: String(r.hsCode ?? ""),
    description: String(r.nameVi ?? ""),
    descriptionEn: (r.nameEn as string | null | undefined) ?? null,
    mfnRate: parseFloat((r.taxNkPreferential as string | null | undefined) ?? "0"),
    ftaRate: parseFloat((r.taxAcfta as string | null | undefined) ?? "0"),
    unit: (r.unitVi as string | null | undefined) ?? null,
    vatRate: (r.taxVat as string | null | undefined) ?? null,
    discriminatingFeatures: Array.isArray(r.discriminatingFeatures)
      ? (r.discriminatingFeatures as string[])
      : [],
    matchType,
    rank: typeof r.rank === "number" ? r.rank : undefined,
    similarity: typeof r.similarity === "number" ? r.similarity : undefined,
  };
}

function mergeResults(fts: SearchResult[], sem: SearchResult[]): SearchResult[] {
  const seen = new Set(fts.map((r) => r.code));
  const result: SearchResult[] = [...fts];
  for (const s of sem) {
    if (!seen.has(s.code)) {
      result.push(s);
      seen.add(s.code);
    }
  }
  return result;
}
