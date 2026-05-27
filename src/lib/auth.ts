// Layer: Infra
// Module: token-auth
// Bearer token check cho mọi API endpoint của hs-knowledge-api

import { NextRequest, NextResponse } from "next/server";

/**
 * Validate Bearer token từ Authorization header.
 * Returns null nếu OK, hoặc NextResponse 401/503 nếu fail.
 */
export function requireApiToken(req: NextRequest): NextResponse | null {
  const expected = process.env.HS_KB_API_TOKEN;
  if (!expected) {
    console.error("[auth] HS_KB_API_TOKEN env var not set");
    return NextResponse.json(
      { error: "HS_KB_API_TOKEN not configured" },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json(
      { error: "Unauthorized — invalid or missing Bearer token" },
      { status: 401 },
    );
  }

  return null;
}
