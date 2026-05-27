// Layer: L3 — Hải Quan
// Module: api-feedback
// POST /api/feedback
// Body: { feedbackType, orderId?, orderItemId?, orderCode?, hsCodeAtTime?,
//         customsDescAtTime?, productNameAtTime?, ministriesAtTime?,
//         directorNote?, directorUserId?, correctedHsCode?, correctedDesc? }
// Returns: { ok: true, feedbackId }
//
// Phase 7.1.T5 — capture feedback từ ERP director actions (return, override).
// Auth: handled by middleware.ts (Bearer HS_KB_API_TOKEN)

import { NextRequest, NextResponse } from "next/server";
import {
  recordFeedback,
  type RecordFeedbackInput,
  type FeedbackType,
} from "@/src/lib/hs-knowledge/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TYPES = new Set<FeedbackType>([
  "RETURNED_BY_DIRECTOR",
  "DIRECTOR_HS_OVERRIDE",
  "DIRECTOR_DESCRIPTION_EDIT",
  "MANUAL_FEEDBACK",
]);

type RequestBody = Partial<RecordFeedbackInput> & {
  feedbackType?: unknown;
  ministriesAtTime?: unknown;
};

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const feedbackType = body.feedbackType;
  if (typeof feedbackType !== "string" || !VALID_TYPES.has(feedbackType as FeedbackType)) {
    return NextResponse.json(
      {
        error: `feedbackType phải là 1 trong: ${Array.from(VALID_TYPES).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const input: RecordFeedbackInput = {
    feedbackType: feedbackType as FeedbackType,
    orderId: optString(body.orderId),
    orderItemId: optString(body.orderItemId),
    orderCode: optString(body.orderCode),
    hsCodeAtTime: optString(body.hsCodeAtTime),
    customsDescAtTime: optString(body.customsDescAtTime),
    productNameAtTime: optString(body.productNameAtTime),
    ministriesAtTime: Array.isArray(body.ministriesAtTime)
      ? body.ministriesAtTime.filter((m): m is string => typeof m === "string")
      : [],
    directorNote: optString(body.directorNote),
    directorUserId: optString(body.directorUserId),
    correctedHsCode: optString(body.correctedHsCode),
    correctedDesc: optString(body.correctedDesc),
  };

  try {
    const feedbackId = await recordFeedback(input);
    return NextResponse.json({ ok: true, feedbackId });
  } catch (e) {
    console.error("[api/feedback] insert failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

function optString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
