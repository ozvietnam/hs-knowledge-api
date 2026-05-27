// Layer: Infra
// Module: api-health
// GET /api/_health — public health check (no auth)

import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // DB ping
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = { ok: true };
  } catch (e) {
    checks.db = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // pgvector available
  try {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    checks.pgvector = { ok: rows.length > 0 };
  } catch (e) {
    checks.pgvector = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }

  // Env vars
  checks.geminiKey = { ok: !!process.env.GEMINI_API_KEY };
  checks.apiToken = { ok: !!process.env.HS_KB_API_TOKEN };

  const allOk = Object.values(checks).every((c) => c.ok);

  return NextResponse.json(
    {
      service: "hs-knowledge-api",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
      status: allOk ? "healthy" : "degraded",
      checks,
    },
    { status: allOk ? 200 : 503 },
  );
}
