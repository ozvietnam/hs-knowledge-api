// Layer: L3 — Hải Quan
// Module: api-describe
// POST /api/describe
// Body: { hsCode, productName, brand?, model?, origin?, material?, condition?, technicalSpec?, purpose?, customerDescription? }
// Returns: CustomsDescriptionResult + ms
//
// Phase 7.1.T5: port từ ERP /api/hs-code/describe sang service riêng.
// Auth: handled by middleware.ts (Bearer HS_KB_API_TOKEN)

import { NextRequest, NextResponse } from "next/server";
import {
  generateCustomsDescription,
  type CustomsDescriptionInput,
} from "@/src/lib/hs-knowledge/describe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type RequestBody = {
  hsCode?: unknown;
  productName?: unknown;
  brand?: unknown;
  model?: unknown;
  origin?: unknown;
  material?: unknown;
  condition?: unknown;
  technicalSpec?: unknown;
  purpose?: unknown;
  customerDescription?: unknown;
};

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Body JSON không hợp lệ" }, { status: 400 });
  }

  const input = validateBody(body);
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  try {
    const result = await generateCustomsDescription(input);
    return NextResponse.json({
      ...result,
      ms: Date.now() - startMs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

function validateBody(body: RequestBody): CustomsDescriptionInput | { error: string } {
  const hsCode = typeof body.hsCode === "string" ? body.hsCode.trim() : "";
  if (!/^\d{6,12}$/.test(hsCode)) {
    return { error: "hsCode phải là 6-12 chữ số" };
  }
  const productName = typeof body.productName === "string" ? body.productName.trim() : "";
  if (!productName || productName.length < 2) {
    return { error: "productName phải ≥2 ký tự" };
  }
  return {
    hsCode,
    productName,
    brand: getOptString(body.brand),
    model: getOptString(body.model),
    origin: getOptString(body.origin),
    material: getOptString(body.material),
    condition: getOptString(body.condition),
    technicalSpec: getOptString(body.technicalSpec),
    purpose: getOptString(body.purpose),
    customerDescription: getOptString(body.customerDescription),
  };
}

function getOptString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
