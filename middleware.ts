// Layer: Infra
// Module: edge-middleware
// Auto-protect /api/* routes (trừ /api/health) với Bearer token check.
// Chạy ở Edge runtime trước khi route handler nhận request.
// Note: dùng "/api/health" (không phải "_health") vì App Router treat
// folder prefix `_` như private, exclude khỏi routing.

import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/api/health"]);
const CRON_PATHS = new Set([
  "/api/cron/embed-knowledge-base",
  "/api/cron/extract-features-from-feedback",
]);

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Public routes: skip auth
  if (PUBLIC_PATHS.has(path)) return NextResponse.next();

  // Cron routes: dùng CRON_SECRET thay vì HS_KB_API_TOKEN
  if (CRON_PATHS.has(path)) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 503 },
      );
    }
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized cron" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Default: HS_KB_API_TOKEN bearer auth
  const apiToken = process.env.HS_KB_API_TOKEN;
  if (!apiToken) {
    return NextResponse.json(
      { error: "HS_KB_API_TOKEN not configured on service" },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${apiToken}`) {
    return NextResponse.json(
      { error: "Unauthorized — invalid or missing Bearer token" },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
