# Kiến trúc Data theo 6 Quy tắc GIR (General Interpretation Rules)

**Background**: 6 GIR là chuẩn WCO quốc tế Việt Nam adopt theo Thông tư 103/2015/TT-BTC. Service `hs-code-api-1` muốn tra mã HS đúng pháp luật → data phải hỗ trợ ĐỦ 6 quy tắc, không thiếu cái nào.

**Áp dụng tuần tự**: 1 → 2(a) → 2(b) → 3(a) → 3(b) → 3(c) → 4. Quy tắc 5 và 6 riêng biệt.

---

## QT-1 — Căn cứ Tiêu đề Phần/Chương + Chú giải

> "Tên đề mục Phần, Nhóm chỉ mang tính hướng dẫn. Phân loại dựa nội dung nhóm + chú giải Phần/Chương."

### Data cần

5 cấp notes:

| Level | Code format | Ví dụ | Số entries cần |
|---|---|---|---|
| SECTION | I-XXI La Mã | "VII" (Plastic & cao su) | 21 |
| CHAPTER | 2 số | "39" | 97 |
| HEADING | 4 số | "3926" | ~1,200 |
| SUBHEADING | 6 số | "392610" | ~5,600 |
| NATIONAL | 8 số (đôi khi 10/12) | "39261000" | ~12,000 |

Mỗi entry:
```typescript
{
  level: "SECTION" | "CHAPTER" | "HEADING" | "SUBHEADING" | "NATIONAL",
  code: string,
  parentCode: string | null,
  titleVi: string,
  noteType: "GENERAL" | "INCLUDES" | "EXCLUDES" | "DEFINITION" | "CLASSIFICATION_RULE",
  noteVi: string,
  noteEn: string | null,
  sourceDocument: string,    // "Phụ lục I Biểu thuế 2026 NĐ 26/2023"
  sourcePage: number | null
}
```

### Hiện trạng

- `data/notes.json`: 87 entries (chỉ chapter notes)
- THIẾU 4 cấp khác

### Gap → Issue #18

---

## QT-2(a) — Chưa hoàn chỉnh nhưng có đặc trưng cơ bản

> "Hàng chưa hoàn thiện đã có đặc trưng cơ bản → phân loại như hoàn thiện."

### Data cần

Mỗi HS code có:
```typescript
{
  hsCode: "62052000",
  essentialCharacteristics: [           // Phải có những features này
    { feature: "cấu trúc thân áo", required: true },
    { feature: "vạt áo", required: true },
    { feature: "tay áo", required: true }
  ],
  incompleteVariants: [                 // Các dạng "chưa hoàn chỉnh" vẫn vào HS này
    "chưa may nút",
    "chưa gắn cổ",
    "chưa gắn nhãn"
  ],
  knockdownClause: {                    // Dạng tháo rời (CKD/SKD)
    allowed: true,
    note: "Áo sơ mi đóng gói dạng phôi đã cắt cũng vào nhóm này"
  }
}
```

### Hiện trạng

KHÔNG có. AI suggest thiếu signal này.

### Gap → Issue #19

---

## QT-2(b) — Hỗn hợp/Hợp chất

> "Hỗn hợp được phân loại theo chất nguyên liệu chính (predominant material)."

### Data cần

Chapter-level rules:
```typescript
{
  chapterCode: "28",  // Hóa chất vô cơ
  mixtureRules: [
    {
      threshold: 0.85,     // ≥ 85% theo khối lượng = chất chính
      rule: "predominant_by_mass",
      exceptions: ["alloy steel 7224"]
    }
  ]
}
```

Mỗi HS hợp chất:
```typescript
{
  hsCode: "29051110",
  primarySubstance: "methanol",
  predominantThreshold: 0.90,
  allowedImpurities: ["water", "ethanol < 5%"]
}
```

### Hiện trạng

KHÔNG có. Hàng hóa chất hay sai phân loại.

### Gap → Issue #19 (cùng QT-2a)

---

## QT-3(a) — Mô tả cụ thể nhất

> "Nhóm mô tả cụ thể được ưu tiên hơn nhóm khái quát."

### Data cần

Mỗi HS code:
```typescript
{
  hsCode: "62052000",
  nameVi: "Áo sơ mi cotton dành cho nam",
  specificityScore: 85,           // 0-100, càng cao càng cụ thể
  specificityTags: [              // Keyword cụ thể giúp ưu tiên match
    "áo sơ mi",
    "cotton",
    "nam",
    "may dệt thoi"
  ],
  generalAlternatives: [          // Các HS khái quát hơn cùng phủ được
    "62059000"  // "quần áo cotton khác"
  ]
}
```

### Logic resolver

Khi suggest match cả `62052000` và `62059000`:
- 62052000 specificity = 85 > 62059000 specificity = 40
- → Chọn 62052000

### Hiện trạng

Có thể compute từ indentation `- - - ` (cấp gạch) — Issue #21. Thêm AI extract specificityTags — Issue #19.

---

## QT-3(b) — Đặc tính cơ bản của bộ/hỗn hợp

> "Bộ ≥2 sản phẩm bán chung → phân loại theo thành phần quyết định đặc tính."

### Data cần

Concept "set" detector:
```typescript
{
  isSet: true,                    // Detect "bộ" "set" "combo" trong description
  setComposition: [
    { hsCode: "96082000", role: "primary" },     // bút chì = đặc trưng cơ bản
    { hsCode: "90171000", role: "complement" },  // thước kẻ
    { hsCode: "40169990", role: "complement" }   // gôm xóa
  ],
  essentialComponent: "96082000",
  packagingForSet: "blister pack / hộp giấy nhỏ"
}
```

### Hiện trạng

KHÔNG có. Trường hợp đơn ít nhưng quan trọng (bộ quà tặng, bộ học sinh).

### Gap → Issue #20 (cùng GIR-4 precedent)

---

## QT-3(c) — Số thứ tự sau cùng

> "Không phân loại được 3a/3b → chọn nhóm có HS code số lớn nhất."

### Data cần

KHÔNG cần data riêng — logic resolver:

```javascript
function gir3cResolve(candidates) {
  return candidates.sort((a, b) => b.hsCode.localeCompare(a.hsCode))[0];
}
```

### Hiện trạng

`/api/suggest` chưa có logic này. Thêm vào sau LLM rerank như tiebreaker.

### Gap → Issue #19

---

## QT-4 — Hàng giống nhất (precedent)

> "Không phân loại được 1/2/3 → tìm hàng tương tự đã phân loại."

### Data cần

Precedent database:

```typescript
{
  precedentId: "tb-6439-tchq-2024",
  source: "TB-TCHQ" | "tờ khai cũ" | "đáp án TCHQ" | "AAR (Advance Ruling)",
  tbTchqNumber: "6439/TB-TCHQ",
  productNameRaw: "Máy bơm trục đứng tự mồi Pentax CMT300 220V",
  technicalSpec: "công suất 3kW, lưu lượng 60L/min",
  brand: "Pentax",
  origin: "Italy",
  finalHsCode: "84137099",
  outcome: "APPROVED" | "QUESTIONED" | "REJECTED" | "AMENDED",
  decisionDate: "2024-05-15",
  decisionUrl: "https://customs.gov.vn/...",
  embedding: [...]            // pgvector hoặc Gemini embedding 768-dim
}
```

### Hiện trạng

`hs-knowledge-api/legacy/data/tb_tchq_index.json` có 1,058 precedents. CEO commit `e043075` đã có script `merge-legacy-knowledge.mjs` — chưa chạy production hoặc chưa expose endpoint.

### Search workflow

```
User description "Máy bơm Pentax 220V"
   ↓
Embedding query (Gemini)
   ↓
Cosine similarity vs precedent embeddings
   ↓
Top 5 precedent giống nhất, có outcome=APPROVED
   ↓
Pick HS với confidence cao nhất
```

### Gap → Issue #20

---

## QT-5(a) + 5(b) — Bao bì

> "Bao bì đặc biệt tái sử dụng → cùng nhóm với hàng. Bao bì thông thường → cùng nhóm."

### Data cần

```typescript
{
  hsCode: "71131900",   // Trang sức bạch kim
  packagingRules: {
    includedPackaging: ["hộp da đặc trưng", "túi velvet"],
    excludedPackaging: ["túi giấy gói tạm"],
    valueRatioThreshold: 0.05,    // Bao bì > 5% giá trị hàng → tách riêng
    standardPackaging: ["plastic blister", "carton box"]   // Auto include
  }
}
```

### Hiện trạng

KHÔNG có. Edge case nhưng có hệ quả thuế (Apple iPhone box giá $20 → tách hay không?).

### Gap → Phase sau, low priority. Defer.

---

## QT-6 — Phân nhóm + chú giải

> "Phân loại phân nhóm theo nội dung + chú giải phân nhóm/chương."

### Data cần

```typescript
{
  hsCode: "39261000",
  indentationLevel: 1,    // "- "  (1 gạch)
  parentSubheading: "392610",
  siblings: ["39262000", "39263000", "39264000", "39269000"],   // Cùng cấp gạch
  childCodes: [],          // Subheading 6-digit không có child 8-digit khác
  subheadingNoteCode: null  // Có note riêng cấp này không?
}
```

Khi compare:
- Cấp 1 gạch chỉ so với 1 gạch khác
- Cấp 2 gạch chỉ so với 2 gạch khác
- Chú giải cấp con override cấp cha nếu có

### Hiện trạng

Indentation có thể parse từ `nameVi` prefix `- - -`. Không có siblings/parent metadata structured.

### Gap → Issue #21

---

## Tổng kết — 4 Issues mới cần open

| Issue | GIR cover | Data added | Effort |
|---|---|---|---|
| **#18** Complete 5-level notes | 1, 6 | Section/Heading/Subheading/National notes | 8h + curation |
| **#19** Specificity + essential chars + tiebreaker | 2a, 2b, 3a, 3c | specificityTags, essentialCharacteristics, predominantThreshold, gir3c resolver | 12h + Gemini Pro cost |
| **#20** Precedent matcher + set detector | 3b, 4 | Migrate 1,058 tb_tchq + embedding + set composition | 10h |
| **#21** Indentation tree + subheading notes | 6 | indentationLevel parser + tree API + sibling metadata | 6h |

QT-5 (bao bì) defer Phase sau, edge case.

---

## Workflow phân loại đúng quy trình WCO

Service `/api/suggest` phải apply tuần tự:

```
Input: description tiếng Việt
  ↓
[QT-1] Match keyword vs nameVi + chapter/section notes (includes/excludes)
  ↓
[QT-2a] Check incompleteVariants → fold dạng chưa hoàn chỉnh vào HS hoàn chỉnh
[QT-2b] Check mixture rules → fold hỗn hợp theo predominant material
  ↓
[QT-3a] Filter prefer specificityScore cao
[QT-3b] Detect set → essentialComponent
  ↓
candidates.length > 1 ?
  ↓ Yes
[QT-3c] tiebreaker: chọn hsCode lớn nhất numerically
  ↓ No (vẫn không quyết được)
[QT-4] Semantic search precedent → top 1 similar
  ↓
[QT-6] Verify indentation cấp đúng + subheading note không exclude
  ↓
Output: top 3 suggestions với confidence + GIR rule áp dụng
```

`/api/suggest` response cải tiến:
```json
{
  "suggestions": [
    {
      "hsCode": "85171300",
      "confidence": 92,
      "girRulesApplied": ["GIR-1", "GIR-3a", "GIR-6"],
      "reasoning": "Match chapter note 85 (radio/điện tử). Specificity 85171300 > 85171200. Subheading 8517.13 chuyên về smartphone.",
      "precedentMatches": [
        { "tbTchqNumber": "...", "similarity": 0.92 }
      ]
    }
  ]
}
```

Output cho ERP/UI hiển thị "Tại sao mã này" — minh bạch, kiểm tra được, kháng cáo Hải quan được.

---

## Note quan trọng

CEO Oz lưu ý: việc tra HS code SAI gây phạt thuế, truy thu, mất uy tín với Hải quan. Service phải audit-trail được:
- Mỗi suggestion ghi log đầy đủ rule path
- Khi NV review, hiển thị evidence (notes/precedent/specificity)
- Director override → feedback → re-train

Đây là khác biệt chuyên nghiệp vs chatbot thông thường.
