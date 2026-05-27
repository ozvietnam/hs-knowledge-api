// Layer: L3
// Module: api-kg-chapter
// GET /api/kg_chapter?chapter=85&page=1&pageSize=50
// Lấy toàn bộ mã HS thuộc 1 chương (paginate vì có chương có >500 mã)
// Phase 7.1.T3: port từ legacy/api/kg_chapter.js (đọc chapter_XX.json) sang Prisma
// Auth: Bearer token

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireApiToken } from "@/src/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authFail = requireApiToken(req);
  if (authFail) return authFail;

  const chapterRaw = req.nextUrl.searchParams.get("chapter")?.trim();
  if (!chapterRaw) {
    return NextResponse.json(
      {
        error: "Thiếu tham số chapter. Ví dụ: /api/kg_chapter?chapter=85",
      },
      { status: 400 },
    );
  }

  const chapterNum = parseInt(chapterRaw, 10);
  if (!Number.isFinite(chapterNum) || chapterNum < 1 || chapterNum > 99) {
    return NextResponse.json(
      { error: "Chapter phải là số 01-99" },
      { status: 400 },
    );
  }

  const chap = String(chapterNum).padStart(2, "0");

  const pageRaw = parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const pageSizeRaw = parseInt(req.nextUrl.searchParams.get("pageSize") ?? "50", 10);
  const pageSize = Number.isFinite(pageSizeRaw)
    ? Math.min(Math.max(pageSizeRaw, 1), 200)
    : 50;
  const skip = (page - 1) * pageSize;

  const [total, records] = await Promise.all([
    prisma.tariff2026.count({
      where: { hsCode: { startsWith: chap } },
    }),
    prisma.tariff2026.findMany({
      where: { hsCode: { startsWith: chap } },
      orderBy: { hsCode: "asc" },
      skip,
      take: pageSize,
      select: {
        hsCode: true,
        nameVi: true,
        nameEn: true,
        unitVi: true,
        taxNkTt: true,
        taxNkPreferential: true,
        taxAcfta: true,
        taxVat: true,
        policyByHs: true,
      },
    }),
  ]);

  if (total === 0) {
    return NextResponse.json(
      { error: `Không có dữ liệu Chapter ${chapterNum}` },
      { status: 404 },
    );
  }

  return NextResponse.json({
    chapter: chapterNum,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    records,
  });
}
