// Layer: L3
// Module: hs-knowledge-describe
// Ticket: SPR-W160-01
//
// Sinh mô tả khai báo Hải Quan VN with disambiguation features.
// CEO's principle: mô tả phải chứa các đặc điểm khu biệt để loại trừ HS lân cận
// (tránh điểm mù kỹ thuật khi HQ chất vấn).

import { prisma } from "@/src/lib/prisma";
import { withRetry } from "@/src/lib/hs-knowledge/embed";
import { searchSimilarFeedback, type SimilarFeedback } from "@/src/lib/hs-knowledge/feedback";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DESCRIBE_MODEL = process.env.GEMINI_DESCRIBE_MODEL ?? "models/gemini-2.0-flash";

export type CustomsDescriptionInput = {
  hsCode: string; // 8-12 digits
  productName: string;
  brand?: string | null;
  model?: string | null;
  origin?: string | null; // xuất xứ (vd "Italy", "Vietnam")
  material?: string | null; // chất liệu (vd "Inox 304")
  condition?: string | null; // "Mới 100%" / "Đã qua sử dụng" / "Refurbished"
  technicalSpec?: string | null; // đặc tính kỹ thuật (công suất, voltage, kích thước...)
  purpose?: string | null; // công dụng
  customerDescription?: string | null; // raw customer message
};

export type DescriptionStructure = {
  productName: string; // tên hàng chính
  brand: string | null;
  model: string | null;
  material: string | null;
  purpose: string | null;
  origin: string;
  condition: string; // default "Mới 100%"
  technicalSpec: string | null;
};

export type CustomsDescriptionResult = {
  customsDescription: string; // full mô tả khai báo string
  structure: DescriptionStructure;
  disambiguationFeaturesIncluded: string[];
  disambiguationFeaturesMissing: string[];
  warnings: string[];
  llmModel: string;
  contextUsed: {
    tariffFound: boolean;
    explanatoryNoteCount: number;
    historicalExampleCount: number;
  };
};

export async function generateCustomsDescription(
  input: CustomsDescriptionInput,
): Promise<CustomsDescriptionResult> {
  if (!/^\d{6,12}$/.test(input.hsCode)) {
    throw new Error(`HS code không hợp lệ: ${input.hsCode}`);
  }
  if (!input.productName || input.productName.trim().length < 2) {
    throw new Error("productName phải ≥2 ký tự");
  }

  // Pull context in parallel
  const feedbackQuery =
    `${input.productName} ${input.brand ?? ""} ${input.model ?? ""} ${input.customerDescription ?? ""}`.trim();
  const [tariff, notes, historical, pastFeedback] = await Promise.all([
    prisma.tariff2026.findUnique({ where: { hsCode: input.hsCode } }),
    fetchRelevantNotes(input.hsCode),
    fetchHistoricalExamples(input.hsCode, 5),
    searchSimilarFeedback(feedbackQuery, 3).catch(() => [] as SimilarFeedback[]),
  ]);

  const requiredFeatures: string[] = [];
  if (tariff?.discriminatingFeatures) {
    requiredFeatures.push(...tariff.discriminatingFeatures);
  }
  // Extract feature hints from EXCLUDES notes (these define what makes THIS HS different)
  const excludesNotes = notes.filter((n) => n.noteType === "EXCLUDES");

  const prompt = buildPrompt(input, tariff, notes, historical, requiredFeatures, pastFeedback);

  const llmJson = await withRetry(() => callGeminiJson(prompt), {
    maxRetries: 2,
    baseDelayMs: 1000,
  });

  const parsed = parseLlmResponse(llmJson, input);

  // Validate: check disambiguation features are mentioned
  const customsDescLower = parsed.customsDescription.toLowerCase();
  const included: string[] = [];
  const missing: string[] = [];
  for (const f of requiredFeatures) {
    if (!f.trim()) continue;
    if (customsDescLower.includes(f.toLowerCase())) {
      included.push(f);
    } else {
      missing.push(f);
    }
  }

  const warnings: string[] = [];
  if (missing.length > 0) {
    warnings.push(
      `Mô tả thiếu ${missing.length} đặc điểm khu biệt: ${missing.join(", ")}. HQ có thể chất vấn.`,
    );
  }
  if (excludesNotes.length > 0 && requiredFeatures.length === 0) {
    warnings.push(
      `HS này có ${excludesNotes.length} note LOẠI TRỪ nhưng không có discriminatingFeatures trong DB. Cần CEO/admin manual extract.`,
    );
  }
  if (!tariff) {
    warnings.push(`HS ${input.hsCode} không có trong Tariff2026. Mô tả dùng historical fallback.`);
  }

  return {
    customsDescription: parsed.customsDescription,
    structure: parsed.structure,
    disambiguationFeaturesIncluded: included,
    disambiguationFeaturesMissing: missing,
    warnings,
    llmModel: DESCRIBE_MODEL,
    contextUsed: {
      tariffFound: !!tariff,
      explanatoryNoteCount: notes.length,
      historicalExampleCount: historical.length,
    },
  };
}

async function fetchRelevantNotes(hsCode: string) {
  // Get notes for this code AND parent chapters (2/4/6 digit prefixes)
  const codes = [hsCode, hsCode.slice(0, 6), hsCode.slice(0, 4), hsCode.slice(0, 2)].filter(
    (c, i, arr) => c.length >= 2 && arr.indexOf(c) === i,
  );

  return prisma.hsExplanatoryNote.findMany({
    where: { code: { in: codes } },
    orderBy: [
      // EXCLUDES first (most important for disambiguation), then DEFINITION
      { noteType: "asc" },
      { code: "desc" }, // most specific first
    ],
    take: 20,
    select: {
      code: true,
      level: true,
      noteType: true,
      noteVi: true,
      titleVi: true,
    },
  });
}

async function fetchHistoricalExamples(hsCode: string, limit: number) {
  // Prefer exact HS match + APPROVED, fallback to heading prefix
  const heading = hsCode.slice(0, 4);
  return prisma.historicalDeclarationItem.findMany({
    where: {
      OR: [
        { hsCode, outcome: "APPROVED" },
        { hsCode: { startsWith: heading }, outcome: "APPROVED" },
      ],
    },
    take: limit,
    orderBy: { createdAt: "desc" },
    select: {
      productNameRaw: true,
      brand: true,
      model: true,
      material: true,
      condition: true,
      technicalSpec: true,
      origin: true,
      hsCode: true,
    },
  });
}

function buildPrompt(
  input: CustomsDescriptionInput,
  tariff: { nameVi: string; nameEn: string | null; unitVi: string | null } | null,
  notes: Array<{ code: string; noteType: string; noteVi: string; titleVi: string | null }>,
  historical: Array<{
    productNameRaw: string;
    brand: string | null;
    model: string | null;
    material: string | null;
    condition: string | null;
    technicalSpec: string | null;
    origin: string | null;
    hsCode: string;
  }>,
  requiredFeatures: string[],
  pastFeedback: SimilarFeedback[] = [],
): string {
  const lines: string[] = [];
  lines.push("Bạn là chuyên gia viết tờ khai Hải Quan Việt Nam.");
  lines.push("Nhiệm vụ: sinh MÔ TẢ KHAI BÁO (customs description) cho 1 mặt hàng.");
  lines.push("");
  lines.push(`### MÃ HS ĐÃ CHỌN: ${input.hsCode}`);
  if (tariff) {
    lines.push(
      `Tên chính thức (Tariff 2026): ${tariff.nameVi}${tariff.nameEn ? " / " + tariff.nameEn : ""}`,
    );
    lines.push(`Đơn vị tính: ${tariff.unitVi ?? "-"}`);
  } else {
    lines.push("(HS không có trong Tariff 2026 — dùng historical context)");
  }
  lines.push("");

  if (requiredFeatures.length > 0) {
    lines.push("### 🚨 ĐẶC ĐIỂM KHU BIỆT BẮT BUỘC (phải xuất hiện trong mô tả):");
    for (const f of requiredFeatures) lines.push(`- ${f}`);
    lines.push("Nếu thiếu các đặc điểm này, HQ có thể chất vấn → phải nêu rõ trong mô tả.");
    lines.push("");
  }

  if (notes.length > 0) {
    lines.push("### CHÚ GIẢI HS LIÊN QUAN:");
    for (const n of notes.slice(0, 10)) {
      const marker = n.noteType === "EXCLUDES" ? "⚠ LOẠI TRỪ" : n.noteType;
      lines.push(
        `- [HS ${n.code}, ${marker}] ${n.noteVi.slice(0, 250)}${n.noteVi.length > 250 ? "..." : ""}`,
      );
    }
    lines.push("");
  }

  if (historical.length > 0) {
    lines.push("### MẪU MÔ TẢ KHAI BÁO ĐÃ ĐƯỢC HQ DUYỆT (style reference):");
    for (const h of historical) {
      lines.push(
        `- "${h.productNameRaw}"${h.brand ? ` | Hiệu: ${h.brand}` : ""}${h.model ? ` | Model: ${h.model}` : ""}${h.material ? ` | Chất liệu: ${h.material}` : ""}${h.origin ? ` | XX: ${h.origin}` : ""}${h.technicalSpec ? ` | KT: ${h.technicalSpec}` : ""}`,
      );
    }
    lines.push("");
  }

  lines.push("### THÔNG TIN KHÁCH CUNG CẤP:");
  lines.push(`- Tên sản phẩm: ${input.productName}`);
  if (input.brand) lines.push(`- Thương hiệu: ${input.brand}`);
  if (input.model) lines.push(`- Model: ${input.model}`);
  if (input.material) lines.push(`- Chất liệu: ${input.material}`);
  if (input.origin) lines.push(`- Xuất xứ: ${input.origin}`);
  if (input.condition) lines.push(`- Tình trạng: ${input.condition}`);
  if (input.technicalSpec) lines.push(`- Đặc tính KT: ${input.technicalSpec}`);
  if (input.purpose) lines.push(`- Công dụng: ${input.purpose}`);
  if (input.customerDescription) lines.push(`- Mô tả gốc khách: ${input.customerDescription}`);
  lines.push("");

  if (pastFeedback.length > 0) {
    lines.push("### ⚠ FEEDBACK TỪ CEO (lỗi NV đã mắc, TRÁNH):");
    for (const fb of pastFeedback) {
      lines.push(
        `- Khi mô tả "${fb.productNameAtTime ?? "?"}" cho HS ${fb.hsCodeAtTime ?? "?"}, CEO chỉ ra: "${(fb.directorNote ?? "").slice(0, 200)}"`,
      );
      if (fb.customsDescAtTime) {
        lines.push(`  (Mô tả NV viết sai: "${fb.customsDescAtTime.slice(0, 150)}")`);
      }
    }
    lines.push("→ Đảm bảo mô tả mới không lặp lại các lỗi trên.");
    lines.push("");
  }

  lines.push("### YÊU CẦU OUTPUT:");
  lines.push("Mô tả khai báo theo CẤU TRÚC 8 PHẦN (mỗi phần ngắn gọn, ghép thành câu):");
  lines.push("1. Tên hàng chính (theo style historical examples)");
  lines.push("2. Thương hiệu");
  lines.push("3. Model");
  lines.push("4. Chất liệu (nếu áp dụng)");
  lines.push("5. Công dụng (nếu cần để phân biệt)");
  lines.push("6. Xuất xứ");
  lines.push("7. Tình trạng (mặc định 'Mới 100%' nếu không nói khác)");
  lines.push("8. Thông số kỹ thuật (chứng minh các đặc điểm khu biệt)");
  lines.push("");
  lines.push("Mô tả phải:");
  lines.push("- Ngắn gọn (1-3 câu)");
  lines.push("- BAO GỒM TẤT CẢ đặc điểm khu biệt trên");
  lines.push("- Tuân theo style của historical examples nếu có");
  lines.push("- KHÔNG dùng từ tiếng Anh trừ khi là tên model/thương hiệu");
  lines.push("");
  lines.push("Trả lời CHỈ ở format JSON:");
  lines.push("```json");
  lines.push("{");
  lines.push('  "customsDescription": "...mô tả full text 1-3 câu...",');
  lines.push('  "structure": {');
  lines.push('    "productName": "Máy bơm ly tâm",');
  lines.push('    "brand": "Pentax",');
  lines.push('    "model": "CM50",');
  lines.push('    "material": null,');
  lines.push('    "purpose": "bơm nước sinh hoạt",');
  lines.push('    "origin": "Italy",');
  lines.push('    "condition": "Mới 100%",');
  lines.push('    "technicalSpec": "Công suất 50W, điện 220V"');
  lines.push("  }");
  lines.push("}");
  lines.push("```");
  return lines.join("\n");
}

async function callGeminiJson(prompt: string): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const url = `${GEMINI_API_BASE}/${DESCRIBE_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, response_mime_type: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini describe ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response empty");
  return JSON.parse(text);
}

function parseLlmResponse(
  raw: unknown,
  input: CustomsDescriptionInput,
): { customsDescription: string; structure: DescriptionStructure } {
  if (typeof raw !== "object" || raw === null) {
    return fallbackStructure(input);
  }
  const obj = raw as Record<string, unknown>;
  const desc = typeof obj.customsDescription === "string" ? obj.customsDescription.trim() : "";
  if (!desc) return fallbackStructure(input);

  const struct = obj.structure as Record<string, unknown> | undefined;
  return {
    customsDescription: desc,
    structure: {
      productName: getStringOrFallback(struct?.productName, input.productName),
      brand: getStringOrNull(struct?.brand, input.brand),
      model: getStringOrNull(struct?.model, input.model),
      material: getStringOrNull(struct?.material, input.material),
      purpose: getStringOrNull(struct?.purpose, input.purpose),
      origin: getStringOrFallback(struct?.origin, input.origin ?? "Trung Quốc"),
      condition: getStringOrFallback(struct?.condition, input.condition ?? "Mới 100%"),
      technicalSpec: getStringOrNull(struct?.technicalSpec, input.technicalSpec),
    },
  };
}

function fallbackStructure(input: CustomsDescriptionInput): {
  customsDescription: string;
  structure: DescriptionStructure;
} {
  // Build simple description from input if LLM fails
  const parts: string[] = [input.productName];
  if (input.brand) parts.push(`hiệu ${input.brand}`);
  if (input.model) parts.push(`model ${input.model}`);
  if (input.material) parts.push(`chất liệu ${input.material}`);
  if (input.origin) parts.push(`xuất xứ ${input.origin}`);
  parts.push(input.condition ?? "Mới 100%");
  if (input.technicalSpec) parts.push(input.technicalSpec);

  return {
    customsDescription: parts.join(", "),
    structure: {
      productName: input.productName,
      brand: input.brand ?? null,
      model: input.model ?? null,
      material: input.material ?? null,
      purpose: input.purpose ?? null,
      origin: input.origin ?? "Trung Quốc",
      condition: input.condition ?? "Mới 100%",
      technicalSpec: input.technicalSpec ?? null,
    },
  };
}

function getStringOrFallback(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function getStringOrNull(v: unknown, fallback: string | null | undefined): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return null;
}
