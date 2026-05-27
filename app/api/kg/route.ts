// Layer: L3
// Module: api-kg
// GET /api/kg?hs=85167100&fields=fact_layer,legal_layer,precedent_layer,conflict_layer
// Aggregate 9-tầng data cho 1 mã HS
// Phase 7.1.T3: port từ legacy/api/kg.js + restructure (query DB thay vì JSON file)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireApiToken } from "@/src/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LayerKey =
  | "fact_layer"
  | "legal_layer"
  | "regulatory_layer"
  | "precedent_layer"
  | "conflict_layer"
  | "classification_layer"
  | "cross_border_layer"
  | "logistics_layer"
  | "ai_layer";

export async function GET(req: NextRequest) {
  const authFail = requireApiToken(req);
  if (authFail) return authFail;

  const hsRaw = req.nextUrl.searchParams.get("hs")?.trim();
  if (!hsRaw) {
    return NextResponse.json(
      {
        error: "Thiếu tham số hs. Ví dụ: /api/kg?hs=85167100",
        tip: "Thêm ?fields=fact_layer,legal_layer để lấy tầng cụ thể",
      },
      { status: 400 },
    );
  }

  // Normalize HS code: bỏ dấu chấm, pad 8
  const hs = hsRaw.replace(/\./g, "").trim().padEnd(8, "0").slice(0, 8);

  const fieldsParam = req.nextUrl.searchParams.get("fields");
  const requestedLayers: Set<LayerKey> | null = fieldsParam
    ? new Set(fieldsParam.split(",").map((s) => s.trim() as LayerKey))
    : null;

  const wants = (l: LayerKey) => requestedLayers === null || requestedLayers.has(l);

  // Parallel query tất cả tầng cần thiết
  const [tariff, notes, precedents, conflict] = await Promise.all([
    wants("fact_layer")
      ? prisma.tariff2026.findUnique({ where: { hsCode: hs } })
      : Promise.resolve(null),

    wants("legal_layer")
      ? prisma.hsExplanatoryNote.findMany({
          where: {
            code: {
              in: [hs, hs.slice(0, 6), hs.slice(0, 4), hs.slice(0, 2)],
            },
          },
          orderBy: [{ noteType: "asc" }, { code: "desc" }],
          take: 30,
          select: {
            code: true,
            level: true,
            noteType: true,
            titleVi: true,
            noteVi: true,
            sourcePage: true,
          },
        })
      : Promise.resolve([]),

    wants("precedent_layer")
      ? prisma.historicalDeclarationItem.findMany({
          where: {
            OR: [{ hsCode: hs }, { hsCode: { startsWith: hs.slice(0, 4) } }],
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            productNameRaw: true,
            brand: true,
            model: true,
            origin: true,
            material: true,
            condition: true,
            technicalSpec: true,
            outcome: true,
            outcomeNote: true,
            tbTchqNumber: true,
            declarationNo: true,
            declarationDate: true,
          },
        })
      : Promise.resolve([]),

    wants("conflict_layer")
      ? prisma.hsConflict.findUnique({ where: { hsCode: hs } }).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Nếu không tìm thấy Tariff entry chính + không request layer khác
  if (!tariff && requestedLayers === null) {
    // Suggest mã gần nhất (cùng 6-digit prefix)
    const related = await prisma.tariff2026.findMany({
      where: { hsCode: { startsWith: hs.slice(0, 6) } },
      take: 5,
      select: { hsCode: true, nameVi: true },
    });

    return NextResponse.json(
      {
        found: false,
        message: `Không tìm thấy mã ${hs}`,
        goi_y_ma_lien_quan: related,
      },
      { status: 404 },
    );
  }

  const response: Record<string, unknown> = {
    hs,
    found: !!tariff,
  };

  if (wants("fact_layer")) {
    response.fact_layer = tariff
      ? {
          hsCode: tariff.hsCode,
          nameVi: tariff.nameVi,
          nameEn: tariff.nameEn,
          unitVi: tariff.unitVi,
          taxNkTt: tariff.taxNkTt,
          taxNkPreferential: tariff.taxNkPreferential,
          taxAcfta: tariff.taxAcfta,
          taxVat: tariff.taxVat,
          taxTtdb: tariff.taxTtdb,
          taxXk: tariff.taxXk,
          taxBvmt: tariff.taxBvmt,
          policyByHs: tariff.policyByHs,
          vatReduction: tariff.vatReduction,
          otherFtaRates: tariff.otherFtaRates,
          discriminatingFeatures: tariff.discriminatingFeatures,
        }
      : null;
  }

  if (wants("legal_layer")) {
    response.legal_layer = {
      tong_note: notes.length,
      notes: notes,
    };
  }

  if (wants("precedent_layer")) {
    response.precedent_layer = {
      tong_precedent: precedents.length,
      items: precedents,
    };
  }

  if (wants("conflict_layer")) {
    response.conflict_layer = conflict
      ? {
          riskLevel: conflict.riskLevel,
          confusedWith: conflict.confusedWith,
          reasonsVi: conflict.reasonsVi,
          precedents: conflict.precedents,
        }
      : null;
  }

  // Stub for tầng 3, 6, 7, 8 (chưa có data model)
  if (wants("regulatory_layer")) response.regulatory_layer = null;
  if (wants("classification_layer")) response.classification_layer = null;
  if (wants("cross_border_layer")) response.cross_border_layer = null;
  if (wants("logistics_layer")) response.logistics_layer = null;

  return NextResponse.json(response);
}
