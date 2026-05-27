// Layer: L3
// Module: hs-knowledge-importer
// Ticket: SPR-W158-03
//
// Parse Excel/PDF tờ khai cũ → array of HistoricalDeclarationItem rows.

import * as XLSX from "xlsx";

export type ColumnMapping = {
  declarationNo?: string;
  declarationDate?: string;
  importerName?: string;
  productNameRaw: string;
  brand?: string;
  model?: string;
  origin?: string;
  material?: string;
  condition?: string;
  technicalSpec?: string;
  unit?: string;
  hsCode: string;
  outcome?: string;
  outcomeNote?: string;
};

export type ParsedHistoricalItem = {
  sourceRow: number;
  declarationNo: string | null;
  declarationDate: Date | null;
  importerName: string | null;
  productNameRaw: string;
  brand: string | null;
  model: string | null;
  origin: string | null;
  material: string | null;
  condition: string | null;
  technicalSpec: string | null;
  unit: string | null;
  hsCode: string;
  outcome: "UNKNOWN" | "APPROVED" | "QUESTIONED" | "AMENDED" | "REJECTED";
  outcomeNote: string | null;
};

export type ParseResult = {
  items: ParsedHistoricalItem[];
  errors: string[];
  totalRows: number;
};

const VALID_OUTCOMES = ["UNKNOWN", "APPROVED", "QUESTIONED", "AMENDED", "REJECTED"] as const;

export function parseHistoricalExcel(
  buffer: Buffer | ArrayBuffer,
  mapping: ColumnMapping,
): ParseResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { items: [], errors: ["Workbook không có sheet nào"], totalRows: 0 };
  }
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    return { items: [], errors: [`Sheet "${sheetName}" không tồn tại`], totalRows: 0 };
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });

  const items: ParsedHistoricalItem[] = [];
  const errors: string[] = [];

  const getCol = (row: Record<string, unknown>, colName: string | undefined): string | null => {
    if (!colName) return null;
    const v = row[colName];
    if (v === null || v === undefined || v === "") return null;
    return String(v).trim();
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const rowIdx = i + 2; // +1 for 0-index, +1 for header

    const productNameRaw = getCol(row, mapping.productNameRaw);
    const hsCode = getCol(row, mapping.hsCode);

    if (!productNameRaw) {
      errors.push(`Row ${rowIdx}: missing productNameRaw (column "${mapping.productNameRaw}")`);
      continue;
    }
    if (!hsCode) {
      errors.push(`Row ${rowIdx}: missing hsCode (column "${mapping.hsCode}")`);
      continue;
    }

    const cleanHs = hsCode.replace(/\D/g, "");
    if (!/^\d{8,12}$/.test(cleanHs)) {
      errors.push(`Row ${rowIdx}: hsCode "${hsCode}" không phải 8-12 chữ số`);
      continue;
    }

    let declarationDate: Date | null = null;
    const dateRaw = mapping.declarationDate ? row[mapping.declarationDate] : null;
    if (dateRaw) {
      if (dateRaw instanceof Date) declarationDate = dateRaw;
      else {
        const parsed = new Date(String(dateRaw));
        if (!isNaN(parsed.getTime())) declarationDate = parsed;
      }
    }

    let outcome: ParsedHistoricalItem["outcome"] = "UNKNOWN";
    const outRaw = getCol(row, mapping.outcome);
    if (outRaw) {
      const norm = outRaw.toUpperCase();
      if ((VALID_OUTCOMES as readonly string[]).includes(norm)) {
        outcome = norm as ParsedHistoricalItem["outcome"];
      }
    }

    items.push({
      sourceRow: rowIdx,
      declarationNo: getCol(row, mapping.declarationNo),
      declarationDate,
      importerName: getCol(row, mapping.importerName),
      productNameRaw,
      brand: getCol(row, mapping.brand),
      model: getCol(row, mapping.model),
      origin: getCol(row, mapping.origin),
      material: getCol(row, mapping.material),
      condition: getCol(row, mapping.condition),
      technicalSpec: getCol(row, mapping.technicalSpec),
      unit: getCol(row, mapping.unit),
      hsCode: cleanHs,
      outcome,
      outcomeNote: getCol(row, mapping.outcomeNote),
    });
  }

  return { items, errors, totalRows: rows.length };
}
