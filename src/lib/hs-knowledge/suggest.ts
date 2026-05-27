// Layer: L3
// Module: hs-knowledge-suggest
// Ticket: SPR-W159-01
//
// Multi-source semantic search: embed query → search 3 tables in parallel →
// merge by HS code → combined score.

import { prisma } from "@/src/lib/prisma";
import { geminiEmbed } from "@/src/lib/hs-knowledge/embed";

export type SuggestEvidence = {
  hsCode: string;
  // Tariff2026 match
  tariffMatch: {
    similarity: number;
    nameVi: string;
    nameEn: string | null;
    unitVi: string | null;
    taxNkPreferential: string | null;
    taxVat: string | null;
    discriminatingFeatures: string[];
  } | null;
  // HsExplanatoryNote matches (multiple notes may match per HS code)
  notesMatch: Array<{
    similarity: number;
    noteType: string;
    noteVi: string;
    level: string;
    code: string; // the note's code (may be a parent of hsCode)
  }>;
  // HistoricalDeclarationItem matches
  historicalMatch: Array<{
    similarity: number;
    productNameRaw: string;
    brand: string | null;
    origin: string | null;
    outcome: string;
  }>;
  // Combined score (weighted)
  combinedScore: number;
};

const WEIGHTS = {
  tariff: 0.5, // strongest signal (direct HS match)
  note: 0.3, // good context (chú giải points to this code)
  historical: 0.2, // good evidence (past use for similar products)
};

export type SuggestOptions = {
  topK?: number; // max candidates returned (default 10)
  perSourceLimit?: number; // top-K per source (default 20)
};

export async function suggestHsCodeCandidates(
  description: string,
  options: SuggestOptions = {},
): Promise<SuggestEvidence[]> {
  const topK = options.topK ?? 10;
  const perSourceLimit = options.perSourceLimit ?? 20;

  if (!description || description.trim().length < 2) return [];

  // Embed query ONCE
  const queryEmbedding = await geminiEmbed(description.trim());
  const vec = `[${queryEmbedding.join(",")}]`;

  // Query 3 tables in parallel
  const [tariffRows, noteRows, historicalRows] = await Promise.all([
    queryTariff(vec, perSourceLimit),
    queryNotes(vec, perSourceLimit),
    queryHistorical(vec, perSourceLimit),
  ]);

  // Merge by HS code
  const byCode = new Map<string, SuggestEvidence>();

  // Tariff matches: each row IS an HS code
  for (const row of tariffRows) {
    byCode.set(row.hsCode, {
      hsCode: row.hsCode,
      tariffMatch: {
        similarity: row.similarity,
        nameVi: row.nameVi,
        nameEn: row.nameEn,
        unitVi: row.unitVi,
        taxNkPreferential: row.taxNkPreferential,
        taxVat: row.taxVat,
        discriminatingFeatures: row.discriminatingFeatures ?? [],
      },
      notesMatch: [],
      historicalMatch: [],
      combinedScore: 0,
    });
  }

  // Notes: a note's code may be parent (e.g., chapter 84 note → applies to all 8413xxx)
  // For now, attach notes only if code prefix matches an existing tariff HS code
  for (const note of noteRows) {
    // Find tariff codes that start with the note's code (for SECTION/CHAPTER/HEADING/SUBHEADING levels)
    const matchingCodes = Array.from(byCode.keys()).filter((c) => c.startsWith(note.code));
    for (const tc of matchingCodes) {
      const entry = byCode.get(tc)!;
      entry.notesMatch.push({
        similarity: note.similarity,
        noteType: note.noteType,
        noteVi: note.noteVi,
        level: note.level,
        code: note.code,
      });
    }
    // If no tariff match, still create entry with note's code if it's a NATIONAL level (8+ digits)
    if (matchingCodes.length === 0 && note.level === "NATIONAL" && /^\d{8,12}$/.test(note.code)) {
      if (!byCode.has(note.code)) {
        byCode.set(note.code, {
          hsCode: note.code,
          tariffMatch: null,
          notesMatch: [
            {
              similarity: note.similarity,
              noteType: note.noteType,
              noteVi: note.noteVi,
              level: note.level,
              code: note.code,
            },
          ],
          historicalMatch: [],
          combinedScore: 0,
        });
      }
    }
  }

  // Historical: each item has hsCode
  for (const hist of historicalRows) {
    let entry = byCode.get(hist.hsCode);
    if (!entry) {
      // Historical evidence for HS not yet in tariff results — add it
      entry = {
        hsCode: hist.hsCode,
        tariffMatch: null,
        notesMatch: [],
        historicalMatch: [],
        combinedScore: 0,
      };
      byCode.set(hist.hsCode, entry);
    }
    entry.historicalMatch.push({
      similarity: hist.similarity,
      productNameRaw: hist.productNameRaw,
      brand: hist.brand,
      origin: hist.origin,
      outcome: hist.outcome,
    });
  }

  // Compute combined score
  for (const entry of byCode.values()) {
    const tariffScore = entry.tariffMatch?.similarity ?? 0;
    const bestNoteScore = entry.notesMatch.reduce((max, n) => Math.max(max, n.similarity), 0);
    // Penalize QUESTIONED/REJECTED historical, boost APPROVED
    const bestHistScore = entry.historicalMatch.reduce((max, h) => {
      const mult =
        h.outcome === "APPROVED"
          ? 1.0
          : h.outcome === "QUESTIONED"
            ? 0.5
            : h.outcome === "REJECTED"
              ? 0.2
              : 0.7; // UNKNOWN
      return Math.max(max, h.similarity * mult);
    }, 0);

    entry.combinedScore =
      WEIGHTS.tariff * tariffScore +
      WEIGHTS.note * bestNoteScore +
      WEIGHTS.historical * bestHistScore;
  }

  // Sort by combinedScore desc, return top K
  return Array.from(byCode.values())
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, topK);
}

type TariffRow = {
  hsCode: string;
  nameVi: string;
  nameEn: string | null;
  unitVi: string | null;
  taxNkPreferential: string | null;
  taxVat: string | null;
  discriminatingFeatures: string[] | null;
  similarity: number;
};

type NoteRow = {
  id: string;
  level: string;
  code: string;
  noteType: string;
  noteVi: string;
  similarity: number;
};

type HistoricalRow = {
  hsCode: string;
  productNameRaw: string;
  brand: string | null;
  origin: string | null;
  outcome: string;
  similarity: number;
};

async function queryTariff(vec: string, limit: number): Promise<TariffRow[]> {
  return prisma.$queryRawUnsafe<TariffRow[]>(
    `SELECT "hsCode", "nameVi", "nameEn", "unitVi", "taxNkPreferential", "taxVat",
            "discriminatingFeatures",
            1 - (embedding <=> $1::vector) AS similarity
     FROM hs_kb.tariff_2026
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    vec,
    limit,
  );
}

async function queryNotes(vec: string, limit: number): Promise<NoteRow[]> {
  return prisma.$queryRawUnsafe<NoteRow[]>(
    `SELECT id, level, code, "noteType", "noteVi",
            1 - (embedding <=> $1::vector) AS similarity
     FROM hs_kb.hs_explanatory_note
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    vec,
    limit,
  );
}

async function queryHistorical(vec: string, limit: number): Promise<HistoricalRow[]> {
  return prisma.$queryRawUnsafe<HistoricalRow[]>(
    `SELECT "hsCode", "productNameRaw", brand, origin, outcome,
            1 - (embedding <=> $1::vector) AS similarity
     FROM hs_kb.historical_declaration_item
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    vec,
    limit,
  );
}
