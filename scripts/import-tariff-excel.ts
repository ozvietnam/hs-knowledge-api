// Layer: L3
// Module: import-tariff-excel
// Phase 7.4
//
// Import Biểu thuế 2026 từ file Excel CEO → hs_kb.tariff_2026 (UPSERT idempotent).
//
// Usage:
//   pnpm tsx scripts/import-tariff-excel.ts <path-to-xlsx> [--sheet=Sheet1] [--dry-run] [--mapping=path/to/mapping.json]
//
// Examples:
//   # Smoke test 5 rows đầu, không ghi DB
//   pnpm tsx scripts/import-tariff-excel.ts ./data/bieu-thue-2026.xlsx --dry-run
//
//   # Import production
//   pnpm tsx scripts/import-tariff-excel.ts ./data/bieu-thue-2026.xlsx
//
//   # Custom column mapping (xem DEFAULT_MAPPING bên dưới làm template)
//   pnpm tsx scripts/import-tariff-excel.ts ./data/bieu-thue-2026.xlsx --mapping=./scripts/tariff-mapping-custom.json
//
// HS Code chuẩn hoá: bỏ dấu chấm + dấu cách → 8 chữ số ("8508.11.00" → "85081100").
// Idempotent: UPSERT by hsCode. Embedding NULL — cron weekly sẽ embed sau.

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Column mapping ───────────────────────────────────────────────────────────
//
// CEO's Excel column header → Tariff2026 field name.
// Match Vietnamese OR English (case-insensitive). Override qua --mapping=path.

const DEFAULT_MAPPING: Record<string, keyof TariffInput> = {
  // HS code (bắt buộc)
  "Mã HS": "hsCode",
  "Ma HS": "hsCode",
  "HS Code": "hsCode",
  "HS": "hsCode",
  Code: "hsCode",

  // Tên hàng (bắt buộc)
  "Mô tả": "nameVi",
  "Mô tả VN": "nameVi",
  "Tên hàng": "nameVi",
  "Tên hàng VN": "nameVi",
  Description: "nameVi",

  // English (optional)
  "Mô tả EN": "nameEn",
  "Tên hàng EN": "nameEn",
  "Description EN": "nameEn",

  // Đơn vị
  "ĐVT": "unitVi",
  "Đơn vị": "unitVi",
  Unit: "unitVi",
  "Đơn vị EN": "unitEn",

  // Thuế (string preserved)
  "Thuế NK TT": "taxNkTt",
  "Thuế NKTT": "taxNkTt",
  "Tax NK TT": "taxNkTt",
  "Thuế NK ưu đãi": "taxNkPreferential",
  "Thuế NK UD": "taxNkPreferential",
  "Thuế NK Ưu Đãi": "taxNkPreferential",
  "MFN": "taxNkPreferential",
  "Thuế ACFTA": "taxAcfta",
  ACFTA: "taxAcfta",
  "Thuế VAT": "taxVat",
  VAT: "taxVat",
  "Thuế TTĐB": "taxTtdb",
  TTDB: "taxTtdb",
  "Thuế XK": "taxXk",
  "Thuế BVMT": "taxBvmt",
  BVMT: "taxBvmt",

  // Chính sách
  "Chính sách": "policyByHs",
  Policy: "policyByHs",
  "Giảm VAT": "vatReduction",
  "VAT Reduction": "vatReduction",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type TariffInput = {
  hsCode: string;
  nameVi: string;
  nameEn?: string | null;
  unitVi?: string | null;
  unitEn?: string | null;
  taxNkTt?: string | null;
  taxNkPreferential?: string | null;
  taxAcfta?: string | null;
  taxVat?: string | null;
  taxTtdb?: string | null;
  taxXk?: string | null;
  taxBvmt?: string | null;
  policyByHs?: string | null;
  vatReduction?: string | null;
  otherFtaRates?: Record<string, string> | null;
};

type ParseResult = {
  rows: TariffInput[];
  errors: string[];
  headers: string[];
  mappedHeaders: Record<string, keyof TariffInput>;
  unmappedHeaders: string[];
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith("--"));
  const sheet = args.find((a) => a.startsWith("--sheet="))?.slice(8) ?? null;
  const dryRun = args.includes("--dry-run");
  const mappingPath = args.find((a) => a.startsWith("--mapping="))?.slice(10);

  if (!filePath) {
    console.error("ERROR: thiếu đường dẫn file Excel");
    console.error("Usage: pnpm tsx scripts/import-tariff-excel.ts <path-to-xlsx> [--dry-run] [--sheet=Sheet1] [--mapping=path]");
    process.exit(1);
  }

  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    console.error(`ERROR: file không tồn tại: ${absPath}`);
    process.exit(1);
  }

  // Optional custom mapping
  let mapping: Record<string, keyof TariffInput> = { ...DEFAULT_MAPPING };
  if (mappingPath) {
    const custom = JSON.parse(readFileSync(mappingPath, "utf-8")) as Record<string, keyof TariffInput>;
    mapping = { ...mapping, ...custom };
  }

  console.log("=".repeat(70));
  console.log("Tariff Excel Import — hs_kb.tariff_2026");
  console.log("=".repeat(70));
  console.log(`File:  ${absPath}`);
  console.log(`Sheet: ${sheet ?? "(first)"}`);
  console.log(`Dry run: ${dryRun ? "YES" : "no"}`);
  console.log("");

  const buffer = readFileSync(absPath);
  const parsed = parseExcel(buffer, mapping, sheet);

  console.log(`Headers found (${parsed.headers.length}):`);
  for (const h of parsed.headers) {
    const target = parsed.mappedHeaders[h];
    console.log(`  ${target ? "✓" : " "} "${h}"${target ? ` → ${target}` : ""}`);
  }
  if (parsed.unmappedHeaders.length > 0) {
    console.log(`\n⚠ Unmapped headers (sẽ bỏ qua): ${parsed.unmappedHeaders.join(", ")}`);
    console.log(`  Override bằng --mapping=path/to/custom.json (xem DEFAULT_MAPPING làm template)`);
  }
  console.log(`\nParsed ${parsed.rows.length} valid rows, ${parsed.errors.length} errors`);
  if (parsed.errors.length > 0) {
    console.log(`  First 5 errors:`);
    for (const err of parsed.errors.slice(0, 5)) console.log(`    - ${err}`);
  }

  if (dryRun) {
    console.log("\n--- DRY RUN ---");
    console.log(`Sample 3 rows đầu:`);
    for (const r of parsed.rows.slice(0, 3)) {
      console.log(JSON.stringify(r, null, 2));
    }
    console.log("\nKhông ghi DB (dry-run). Bỏ --dry-run để thực thi.");
    return;
  }

  if (parsed.rows.length === 0) {
    console.error("\nERROR: 0 valid rows — không có gì để import.");
    process.exit(1);
  }

  // Bulk UPSERT
  console.log(`\n→ UPSERT ${parsed.rows.length} rows vào hs_kb.tariff_2026...`);
  const stats = await bulkUpsert(parsed.rows);

  console.log("\n" + "=".repeat(70));
  console.log(`Done: inserted=${stats.inserted} updated=${stats.updated} errors=${stats.errors}`);
  console.log("=".repeat(70));
  console.log("\nNext step: chạy cron embed weekly để generate vector embeddings.");
  console.log("  pnpm tsx -e \"import('./src/lib/hs-knowledge/embed').then(m => m.embedTable({tableName:'Tariff2026', textBuilder: r => r.hsCode+' '+r.nameVi}))\"");
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseExcel(
  buffer: Buffer,
  mapping: Record<string, keyof TariffInput>,
  sheetName: string | null,
): ParseResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = sheetName ? wb.Sheets[sheetName] : wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) {
    throw new Error(
      sheetName ? `Sheet "${sheetName}" không tồn tại. Available: ${wb.SheetNames.join(", ")}` : "Workbook không có sheet nào",
    );
  }

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  if (raw.length === 0) {
    return { rows: [], errors: ["Sheet trống"], headers: [], mappedHeaders: {}, unmappedHeaders: [] };
  }

  const headers = Object.keys(raw[0]!);
  const mappedHeaders: Record<string, keyof TariffInput> = {};
  const unmappedHeaders: string[] = [];
  const lowerMapping: Record<string, keyof TariffInput> = {};
  for (const [k, v] of Object.entries(mapping)) {
    lowerMapping[k.toLowerCase().trim()] = v;
  }
  for (const h of headers) {
    const target = lowerMapping[h.toLowerCase().trim()];
    if (target) mappedHeaders[h] = target;
    else unmappedHeaders.push(h);
  }

  const rows: TariffInput[] = [];
  const errors: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]!;
    const item: Partial<TariffInput> = {};
    for (const [excelHeader, field] of Object.entries(mappedHeaders)) {
      const v = row[excelHeader];
      if (v == null || v === "") continue;
      const s = String(v).trim();
      if (s === "") continue;
      (item as Record<string, string>)[field] = s;
    }

    // Validate required
    if (!item.hsCode) {
      errors.push(`Row ${i + 2}: thiếu hsCode`);
      continue;
    }
    if (!item.nameVi) {
      errors.push(`Row ${i + 2}: thiếu nameVi`);
      continue;
    }

    // Normalize HS code: bỏ dấu chấm, dấu cách, pad 8 nếu < 8 chữ số
    const normalized = item.hsCode.replace(/[.\s]/g, "");
    if (!/^\d+$/.test(normalized)) {
      errors.push(`Row ${i + 2}: hsCode không phải số: "${item.hsCode}"`);
      continue;
    }
    if (normalized.length < 4 || normalized.length > 12) {
      errors.push(`Row ${i + 2}: hsCode độ dài bất thường ${normalized.length}: "${item.hsCode}"`);
      continue;
    }
    item.hsCode = normalized.length < 8 ? normalized.padEnd(8, "0") : normalized.slice(0, 12);

    rows.push(item as TariffInput);
  }

  return { rows, errors, headers, mappedHeaders, unmappedHeaders };
}

// ─── DB writer ────────────────────────────────────────────────────────────────

async function bulkUpsert(rows: TariffInput[]): Promise<{ inserted: number; updated: number; errors: number }> {
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (r) => {
        try {
          const existing = await prisma.tariff2026.findUnique({
            where: { hsCode: r.hsCode },
            select: { hsCode: true },
          });
          await prisma.tariff2026.upsert({
            where: { hsCode: r.hsCode },
            create: {
              hsCode: r.hsCode,
              nameVi: r.nameVi,
              nameEn: r.nameEn ?? null,
              unitVi: r.unitVi ?? null,
              unitEn: r.unitEn ?? null,
              taxNkTt: r.taxNkTt ?? null,
              taxNkPreferential: r.taxNkPreferential ?? null,
              taxAcfta: r.taxAcfta ?? null,
              taxVat: r.taxVat ?? null,
              taxTtdb: r.taxTtdb ?? null,
              taxXk: r.taxXk ?? null,
              taxBvmt: r.taxBvmt ?? null,
              policyByHs: r.policyByHs ?? null,
              vatReduction: r.vatReduction ?? null,
              otherFtaRates: r.otherFtaRates ?? undefined,
              discriminatingFeatures: [],
            },
            update: {
              nameVi: r.nameVi,
              nameEn: r.nameEn ?? null,
              unitVi: r.unitVi ?? null,
              unitEn: r.unitEn ?? null,
              taxNkTt: r.taxNkTt ?? null,
              taxNkPreferential: r.taxNkPreferential ?? null,
              taxAcfta: r.taxAcfta ?? null,
              taxVat: r.taxVat ?? null,
              taxTtdb: r.taxTtdb ?? null,
              taxXk: r.taxXk ?? null,
              taxBvmt: r.taxBvmt ?? null,
              policyByHs: r.policyByHs ?? null,
              vatReduction: r.vatReduction ?? null,
              otherFtaRates: r.otherFtaRates ?? undefined,
              // KHÔNG overwrite discriminatingFeatures (đã được auto-promote từ feedback)
              // KHÔNG overwrite embedding (cron sẽ regenerate khi nameVi đổi)
            },
          });
          if (existing) updated++;
          else inserted++;
        } catch (e) {
          errors++;
          if (errors < 5) console.error(`  err ${r.hsCode}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
    process.stdout.write(`\r  progress: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log("");
  return { inserted, updated, errors };
}

// ─── Entry ────────────────────────────────────────────────────────────────────

main()
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
