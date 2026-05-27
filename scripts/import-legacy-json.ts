// Layer: L3
// Module: import-legacy-json
// Phase 7.1.T6
//
// Import 4 file JSON legacy (kg_index, bao_gom, conflict, tb_tchq) → DB hs_kb.
//
// Usage:
//   pnpm tsx scripts/import-legacy-json.ts [--only=conflict,tb_tchq,bao_gom,kg_index]
//   pnpm tsx scripts/import-legacy-json.ts --dry-run

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LEGACY_DIR = join(process.cwd(), "legacy", "data");

const SOURCES = {
  kg_index: { path: "kg_index.json", target: "Tariff2026 meta + HsConflict bootstrap" },
  bao_gom: { path: "bao_gom_index.json", target: "HsExplanatoryNote (INCLUDES)" },
  conflict: { path: "conflict_index.json", target: "HsConflict (Tầng 5)" },
  tb_tchq: { path: "tb_tchq_index.json", target: "HistoricalDeclarationItem (Tầng 4 Precedent)" },
} as const;

type SourceKey = keyof typeof SOURCES;

// ─── Types matching legacy JSON ───────────────────────────────────────────────

type KgIndexRow = {
  hs: string;
  vn: string;
  chapter: number;
  muc_canh_bao?: string;
  canh_bao_cs?: boolean;
  la_hang_loai_khac?: boolean;
  status?: string;
};

type BaoGomRow = {
  hs: string;
  t: string; // text "Nhóm này bao gồm..."
};

type ConflictRow = {
  hs: string;
  muc_rui_ro: string; // GREEN | YELLOW | ORANGE | RED
  ma_de_nham?: string[];
  ly_do?: string[];
  mau_thuan?: string[]; // array of stringified objects (legacy quirk)
};

type TbTchqRow = {
  hs: string;
  so_hieu: string; // "6439/TB-TCHQ"
  ten_sp: string;
  ten_kt?: string;
  ma_hs: string;
  nam?: number;
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyArg = args.find((a) => a.startsWith("--only="))?.slice(7);
  const only = onlyArg ? new Set(onlyArg.split(",")) : null;

  console.log("=".repeat(70));
  console.log("HS Knowledge API — Legacy Data Import");
  console.log("=".repeat(70));
  if (dryRun) console.log("DRY RUN — no DB writes");
  console.log("");

  const stats: Record<string, { inserted: number; skipped: number; errors: number }> = {};

  for (const [key, info] of Object.entries(SOURCES) as Array<[SourceKey, typeof SOURCES[SourceKey]]>) {
    if (only && !only.has(key)) {
      console.log(`SKIP ${key} (not in --only)`);
      continue;
    }
    const fullPath = join(LEGACY_DIR, info.path);
    if (!existsSync(fullPath)) {
      console.log(`SKIP ${key}: file không tồn tại ${fullPath}`);
      continue;
    }
    console.log(`\n→ ${key}: ${info.path} → ${info.target}`);
    const raw = readFileSync(fullPath, "utf-8");
    const data = JSON.parse(raw);

    switch (key) {
      case "kg_index":
        stats[key] = await importKgIndex(data as KgIndexRow[], dryRun);
        break;
      case "bao_gom":
        stats[key] = await importBaoGom(data as BaoGomRow[], dryRun);
        break;
      case "conflict":
        stats[key] = await importConflict(data as ConflictRow[], dryRun);
        break;
      case "tb_tchq":
        stats[key] = await importTbTchq(data as TbTchqRow[], dryRun);
        break;
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("Tổng kết:");
  for (const [k, s] of Object.entries(stats)) {
    console.log(`  ${k.padEnd(12)} inserted=${s.inserted}  skipped=${s.skipped}  errors=${s.errors}`);
  }
  console.log("=".repeat(70));
}

// ─── Importers ────────────────────────────────────────────────────────────────

async function importKgIndex(rows: KgIndexRow[], dryRun: boolean) {
  // kg_index chứa meta (vn name + risk level) — không có thuế.
  // Dùng để bootstrap HsConflict (riskLevel) cho HS chưa có conflict entry.
  // Tariff2026 sẽ migrate từ ERP ở Phase 7.2 (pg_dump public.Tariff2026 → hs_kb.tariff_2026).

  console.log(`  Read ${rows.length} rows từ kg_index`);
  console.log(`  → Bootstrap HsConflict cho ${rows.length} HS với riskLevel theo muc_canh_bao`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  const validRisks = new Set(["GREEN", "YELLOW", "ORANGE", "RED"]);

  if (dryRun) {
    const sample = rows.slice(0, 3);
    console.log(`  Sample: ${JSON.stringify(sample, null, 2).slice(0, 300)}...`);
    return { inserted: 0, skipped: rows.length, errors: 0 };
  }

  // Batch upsert 500 mỗi đợt
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    for (const r of batch) {
      try {
        const risk = (r.muc_canh_bao ?? "GREEN").toUpperCase();
        if (!validRisks.has(risk)) {
          skipped++;
          continue;
        }
        await prisma.hsConflict.upsert({
          where: { hsCode: r.hs },
          create: {
            hsCode: r.hs,
            riskLevel: risk as any,
            confusedWith: [],
            reasonsVi: [],
          },
          update: {
            // Không overwrite nếu conflict đã được enrich
            riskLevel: risk as any,
          },
        });
        inserted++;
      } catch (e) {
        errors++;
        if (errors < 5) console.error(`    err ${r.hs}: ${e}`);
      }
    }
    process.stdout.write(`\r    progress: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log("");
  return { inserted, skipped, errors };
}

async function importBaoGom(rows: BaoGomRow[], dryRun: boolean) {
  console.log(`  Read ${rows.length} rows từ bao_gom`);

  if (dryRun) {
    const sample = rows.slice(0, 2);
    console.log(`  Sample: ${JSON.stringify(sample, null, 2).slice(0, 400)}...`);
    return { inserted: 0, skipped: rows.length, errors: 0 };
  }

  // De-dup theo hs (1 hs có thể có nhiều entry trong bao_gom — sẽ ghép vào 1 note)
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.hs || !r.t) continue;
    if (!map.has(r.hs)) map.set(r.hs, []);
    map.get(r.hs)!.push(r.t);
  }

  let inserted = 0;
  let errors = 0;
  let processed = 0;
  const total = map.size;

  for (const [hs, texts] of map.entries()) {
    try {
      const level = detectLevel(hs);
      const parentCode = parentCodeFor(hs, level);
      const combinedText = texts.join("\n\n");

      await prisma.hsExplanatoryNote.create({
        data: {
          level,
          code: hs,
          parentCode,
          titleVi: null,
          noteType: "INCLUDES",
          noteVi: combinedText,
          sourceFile: "legacy/data/bao_gom_index.json",
          discriminatingFeatures: [],
        },
      });
      inserted++;
    } catch (e) {
      errors++;
      if (errors < 3) console.error(`    err ${hs}: ${e}`);
    }
    processed++;
    if (processed % 500 === 0) {
      process.stdout.write(`\r    progress: ${processed}/${total}`);
    }
  }
  console.log("");
  return { inserted, skipped: 0, errors };
}

async function importConflict(rows: ConflictRow[], dryRun: boolean) {
  console.log(`  Read ${rows.length} rows từ conflict`);

  if (dryRun) {
    const sample = rows.slice(0, 2);
    console.log(`  Sample: ${JSON.stringify(sample, null, 2).slice(0, 600)}...`);
    return { inserted: 0, skipped: rows.length, errors: 0 };
  }

  const validRisks = new Set(["GREEN", "YELLOW", "ORANGE", "RED"]);
  let inserted = 0;
  let errors = 0;

  for (const r of rows) {
    try {
      const risk = (r.muc_rui_ro ?? "GREEN").toUpperCase();
      if (!validRisks.has(risk)) continue;

      // Parse mau_thuan: legacy lưu mỗi item là string của Python dict
      const precedents = (r.mau_thuan ?? []).map((s) => ({ raw: s }));

      await prisma.hsConflict.upsert({
        where: { hsCode: r.hs },
        create: {
          hsCode: r.hs,
          riskLevel: risk as any,
          confusedWith: r.ma_de_nham ?? [],
          reasonsVi: r.ly_do ?? [],
          precedents: precedents.length > 0 ? precedents : undefined,
        },
        update: {
          riskLevel: risk as any,
          confusedWith: r.ma_de_nham ?? [],
          reasonsVi: r.ly_do ?? [],
          precedents: precedents.length > 0 ? precedents : undefined,
        },
      });
      inserted++;
    } catch (e) {
      errors++;
      if (errors < 5) console.error(`    err ${r.hs}: ${e}`);
    }
  }
  return { inserted, skipped: 0, errors };
}

async function importTbTchq(rows: TbTchqRow[], dryRun: boolean) {
  console.log(`  Read ${rows.length} rows từ tb_tchq`);

  if (dryRun) {
    const sample = rows.slice(0, 2);
    console.log(`  Sample: ${JSON.stringify(sample, null, 2).slice(0, 400)}...`);
    return { inserted: 0, skipped: rows.length, errors: 0 };
  }

  // Create / find batch metadata
  const batch = await prisma.historicalImportBatch.create({
    data: {
      name: `Legacy TB-TCHQ import ${new Date().toISOString().slice(0, 10)}`,
      sourceType: "tb_tchq_json",
      sourceFile: "legacy/data/tb_tchq_index.json",
      status: "imported",
      itemCount: rows.length,
    },
  });

  let inserted = 0;
  let errors = 0;
  let processed = 0;

  for (const r of rows) {
    try {
      await prisma.historicalDeclarationItem.create({
        data: {
          source: "tb-tchq-legacy",
          importBatchId: batch.id,
          sourceFile: "legacy/data/tb_tchq_index.json",
          tbTchqNumber: r.so_hieu,
          productNameRaw: r.ten_sp,
          technicalSpec: r.ten_kt ?? null,
          hsCode: r.ma_hs,
          outcome: "APPROVED", // TB-TCHQ là HQ đã quyết định
          declarationDate: r.nam ? new Date(`${r.nam}-01-01`) : null,
        },
      });
      inserted++;
    } catch (e) {
      errors++;
      if (errors < 3) console.error(`    err ${r.so_hieu}: ${e}`);
    }
    processed++;
    if (processed % 100 === 0) {
      process.stdout.write(`\r    progress: ${processed}/${rows.length}`);
    }
  }
  console.log("");

  // Update batch itemCount với actual inserted
  await prisma.historicalImportBatch.update({
    where: { id: batch.id },
    data: { itemCount: inserted },
  });

  return { inserted, skipped: 0, errors };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectLevel(hs: string): "SECTION" | "CHAPTER" | "HEADING" | "SUBHEADING" | "NATIONAL" {
  const clean = hs.replace(/\./g, "");
  if (clean.length === 2) return "CHAPTER";
  if (clean.length === 4) return "HEADING";
  if (clean.length === 6) return "SUBHEADING";
  return "NATIONAL";
}

function parentCodeFor(hs: string, level: "SECTION" | "CHAPTER" | "HEADING" | "SUBHEADING" | "NATIONAL"): string | null {
  const clean = hs.replace(/\./g, "");
  switch (level) {
    case "SECTION": return null;
    case "CHAPTER": return null; // section roman number — not parseable from hs
    case "HEADING": return clean.slice(0, 2);
    case "SUBHEADING": return clean.slice(0, 4);
    case "NATIONAL": return clean.slice(0, 6);
  }
}

main()
  .catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
