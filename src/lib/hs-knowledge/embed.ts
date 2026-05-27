// Layer: L3+Infra
// Module: hs-knowledge-embed
// Ticket: SPR-W158-04
//
// Gemini text-embedding-004 client + retry + batch.
// Idempotent: only embed rows where embedding IS NULL.

import { prisma } from "@/src/lib/prisma";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const EMBED_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? "models/text-embedding-004";
const BATCH = parseInt(process.env.EMBED_BATCH_SIZE ?? "100", 10);
const RATE_LIMIT_MS = parseInt(process.env.EMBED_RATE_LIMIT_MS ?? "4000", 10);

export const EMBED_DIM = 768;

// ─── Text builders ────────────────────────────────────────────────────────────

export function tariffText(r: {
  hsCode: string;
  nameVi: string;
  nameEn?: string | null;
  unitVi?: string | null;
  policyByHs?: string | null;
}): string {
  return [
    r.hsCode,
    r.nameVi,
    r.nameEn ?? "",
    r.unitVi ? `đơn vị ${r.unitVi}` : "",
    r.policyByHs ? `chính sách: ${r.policyByHs}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function noteText(n: {
  level: string;
  code: string;
  titleVi?: string | null;
  noteVi: string;
}): string {
  return `${n.level} ${n.code}: ${n.titleVi ?? ""}. ${n.noteVi}`.replace(/\s+/g, " ").trim();
}

export function historicalText(h: {
  productNameRaw: string;
  brand?: string | null;
  model?: string | null;
  material?: string | null;
  origin?: string | null;
  hsCode: string;
}): string {
  return [
    h.productNameRaw,
    h.brand ?? "",
    h.model ?? "",
    h.material ?? "",
    h.origin ?? "",
    `HS ${h.hsCode}`,
  ]
    .filter(Boolean)
    .join(" ");
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries: number; baseDelayMs: number } = { maxRetries: 3, baseDelayMs: 1000 },
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= opts.maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < opts.maxRetries) {
        const delay = opts.baseDelayMs * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ─── Gemini embed call ────────────────────────────────────────────────────────

export async function geminiEmbed(text: string): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");

  const url = `${GEMINI_API_BASE}/${EMBED_MODEL}:embedContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { embedding: { values: number[] } };
  return json.embedding.values;
}

export async function geminiEmbedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const t of texts) {
    const v = await withRetry(() => geminiEmbed(t), { maxRetries: 3, baseDelayMs: 2000 });
    results.push(v);
  }
  return results;
}

// ─── Table embed runner ───────────────────────────────────────────────────────

/**
 * Logical model names (Prisma client convention) → schema-qualified SQL table.
 * Phase 7: hs-knowledge-api dùng schema `hs_kb` riêng.
 */
const TABLE_SQL: Record<string, string> = {
  Tariff2026: "hs_kb.tariff_2026",
  HsExplanatoryNote: "hs_kb.hs_explanatory_note",
  HistoricalDeclarationItem: "hs_kb.historical_declaration_item",
  HsKnowledgeFeedback: "hs_kb.hs_knowledge_feedback",
};

export type EmbedTableArgs<T> = {
  tableName:
    | "Tariff2026"
    | "HsExplanatoryNote"
    | "HistoricalDeclarationItem"
    | "HsKnowledgeFeedback";
  textBuilder: (row: T) => string;
  limit?: number;
};

export async function embedTable<T extends Record<string, unknown>>(
  args: EmbedTableArgs<T>,
): Promise<{ embedded: number; failed: number }> {
  const idCol = args.tableName === "Tariff2026" ? "hsCode" : "id";
  const sqlTable = TABLE_SQL[args.tableName];
  if (!sqlTable) throw new Error(`Unknown tableName: ${args.tableName}`);

  let embedded = 0;
  let failed = 0;
  const failedIds = new Set<string>();
  const total = args.limit ?? Number.MAX_SAFE_INTEGER;

  while (embedded < total) {
    const remaining = Math.min(BATCH, total - embedded);
    const excludeClause =
      failedIds.size > 0
        ? `AND "${idCol}" NOT IN (${Array.from(failedIds)
            .map((id) => `'${id.replace(/'/g, "''")}'`)
            .join(",")})`
        : "";
    const rows = await prisma.$queryRawUnsafe<T[]>(
      `SELECT * FROM ${sqlTable} WHERE embedding IS NULL ${excludeClause} LIMIT ${remaining}`,
    );
    if (!rows.length) break;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const text = args.textBuilder(row);
      const idVal = row[idCol];
      let embedding: number[];
      try {
        embedding = await withRetry(() => geminiEmbed(text), {
          maxRetries: 3,
          baseDelayMs: 2000,
        });
      } catch (err) {
        console.error(`  Row ${String(idVal)} failed after retries: ${err}`);
        failed += 1;
        failedIds.add(String(idVal));
        continue;
      }
      const vec = `[${embedding.join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE ${sqlTable} SET embedding = $1::vector, "embeddingModel" = $2, "embeddedAt" = NOW() WHERE "${idCol}" = $3`,
        vec,
        EMBED_MODEL,
        idVal,
      );
      embedded += 1;
    }
    console.log(`  ${args.tableName}: embedded ${embedded}, failed ${failed}`);

    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  return { embedded, failed };
}
