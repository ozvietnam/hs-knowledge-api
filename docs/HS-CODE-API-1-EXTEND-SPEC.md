# SPEC — Mở rộng `ozvietnam/hs-code-api-1` để ERP `erp-xnk` dùng được

**Repo**: https://github.com/ozvietnam/hs-code-api-1
**Live**: https://hs-code-api-1-ywbe.vercel.app
**Goal**: ERP `erp-xnk` gọi sang để (1) xác định mã HS, (2) tra thuế, (3) sinh mô tả khai báo Hải quan.

---

## A. Hiện trạng — đã có

| Endpoint | Method | Trả về | OK? |
|---|---|---|---|
| `/api/tax?hs=XXXXXXXX` | GET | mã + tên VN + thuế + chính sách | ✅ |
| `/api/search?q=XXX` | GET | (chưa test, có trong repo) | ❓ |
| `/api/notes?hs=XXX` | GET | chú giải HS code | ❓ |

Data:
- `data/tax.json` — 11,871 mã HS 8-digit + thuế NK TT/MFN/ACFTA/VAT/BVMT + chính sách
- `data/search.json` — search index 1 MB
- `data/notes.json` — chú giải 110 KB

Stack: Vercel Functions Node.js, no DB, file-system JSON lookup, no auth.

---

## B. Yêu cầu mở rộng (Priority order)

### B1. **Auth Bearer token** (P0 — bắt buộc trước khi ERP gọi)

**Vấn đề**: Hiện endpoint public — ai cũng gọi được, leak data, ăn quota.

**Yêu cầu**:
- Middleware kiểm tra header `Authorization: Bearer ${HS_API_TOKEN}` trên TẤT CẢ endpoint trừ `/api/health`.
- Lấy token từ `process.env.HS_API_TOKEN` (set qua `vercel env add HS_API_TOKEN production`).
- Nếu thiếu hoặc sai → trả `401 { "error": "Unauthorized" }`.
- Generate token: `openssl rand -hex 32` (64 hex chars).

**Test acceptance**:
```bash
curl https://hs-code-api-1-ywbe.vercel.app/api/tax?hs=85171300
# → 401

curl -H "Authorization: Bearer $TOKEN" https://hs-code-api-1-ywbe.vercel.app/api/tax?hs=85171300
# → 200 + tax data
```

---

### B2. **`POST /api/suggest`** — AI xác định mã HS (P0)

Từ mô tả sản phẩm tiếng Việt → top 3 HS code có thể đúng + reasoning.

**Request**:
```json
POST /api/suggest
Authorization: Bearer $TOKEN
Content-Type: application/json

{
  "description": "iPhone 15 Pro Max 256GB",
  "options": {
    "topCandidates": 10,   // số candidate từ search trước khi rerank
    "topReranked": 3        // số kết quả final
  }
}
```

**Response**:
```json
{
  "suggestions": [
    {
      "hsCode": "85171300",
      "nameVi": "Điện thoại thông minh",
      "confidence": 92,
      "reasoning": "Khớp 'iPhone' → smartphone, dung lượng 256GB không ảnh hưởng phân loại HS",
      "disambiguationFeatures": ["model", "dung lượng", "thương hiệu"]
    },
    { ... },
    { ... }
  ],
  "evidence": [
    { "hsCode": "85171300", "source": "tax.json", "score": 0.95 },
    { "hsCode": "85176200", "source": "tax.json", "score": 0.72 }
  ],
  "llmModel": "models/gemini-2.5-flash",
  "ms": 3200
}
```

**Implementation flow**:
1. Search `tax.json` keyword match trên `vn` field (≥ 5 candidates, có thể dùng tsvector hoặc Fuse.js fuzzy)
2. Gọi Gemini 2.5 Flash với prompt:
   - System: "Bạn là chuyên gia phân loại HS code Việt Nam"
   - Input: description + top 10 candidates đầy đủ
   - Output: JSON top 3 với confidence + reasoning
3. Parse JSON response → return

**Env vars cần thêm**:
- `GEMINI_API_KEY` — Google AI Studio key
- `GEMINI_RERANK_MODEL` — default `models/gemini-2.5-flash`

**Lý do KHÔNG dùng `gemini-2.0-flash`**: Google deprecate cho new API users từ tháng 5/2026. Đã verify trên `hs-knowledge-api` Phase 7.

---

### B3. **`POST /api/describe`** — AI sinh mô tả khai báo Hải quan (P0)

Từ HS code + tên hàng + thuộc tính → mô tả khai báo chuẩn (có đặc điểm khu biệt tránh chất vấn).

**Request**:
```json
POST /api/describe
Authorization: Bearer $TOKEN

{
  "hsCode": "85171300",
  "productName": "iPhone 15 Pro Max",
  "brand": "Apple",
  "model": "A2848",
  "origin": "China",
  "material": null,
  "condition": "Mới 100%",
  "technicalSpec": "256GB, IP68, A17 Pro chip",
  "purpose": "thiết bị liên lạc di động",
  "customerDescription": "Mua từ Apple Store HK"
}
```

**Response**:
```json
{
  "customsDescription": "Điện thoại di động iPhone 15 Pro Max, thương hiệu Apple, model A2848, dung lượng 256GB, chip A17 Pro, chuẩn kháng nước IP68, xuất xứ Trung Quốc, mới 100%.",
  "structure": {
    "productName": "Điện thoại di động iPhone 15 Pro Max",
    "brand": "Apple",
    "model": "A2848",
    "origin": "Trung Quốc",
    "condition": "Mới 100%",
    "technicalSpec": "256GB, A17 Pro, IP68"
  },
  "disambiguationFeaturesIncluded": ["brand", "model", "dung lượng"],
  "disambiguationFeaturesMissing": [],
  "warnings": [],
  "llmModel": "models/gemini-2.5-flash",
  "contextUsed": {
    "tariffFound": true,
    "policyByHs": "Hàng tiêu dùng QSD cấp NK..."
  },
  "ms": 5800
}
```

**Implementation flow**:
1. Lookup `tax.json[hsCode]` → lấy `vn` name + `cs` chính sách làm context
2. Gọi Gemini 2.5 Flash với prompt:
   - System: "Sinh mô tả khai báo Hải quan Việt Nam có đặc điểm khu biệt"
   - Input: HS + tên + brand/model/origin + tariff context
   - Output: JSON đúng cấu trúc trên
3. Return JSON

**Env vars**:
- `GEMINI_DESCRIBE_MODEL` — default `models/gemini-2.5-flash`

---

### B4. **`GET /api/health`** — Public health check (P0)

```json
GET /api/health  (no auth)

{
  "service": "hs-code-api-1",
  "version": "2.0.0",
  "status": "healthy",
  "checks": {
    "taxData": { "ok": true, "rows": 11871 },
    "geminiKey": { "ok": true },
    "apiToken": { "ok": true }
  },
  "timestamp": "2026-05-27T13:45:00Z"
}
```

Mục đích: ERP test connection + monitor uptime.

---

### B5. **Data filter + đào luyện sâu** (P1 — anh đã nhắc)

Anh nói: *"nhiều cảnh báo, data cần lọc và đào luyện chuyên sâu"*. Em đề xuất:

**B5.1 — Lọc data cảnh báo trong `tax.json`**:
- Hiện `cs` (chính sách) chứa list văn bản pháp luật dài → cần parse thành tags structured:
  - `requiresLicense`: bool (yêu cầu giấy phép)
  - `requiresInspection`: bool (kiểm tra chất lượng/CR)
  - `requiresQuarantine`: bool (kiểm dịch)
  - `dualUseControl`: bool (kiểm soát chuyên dụng — mật mã, vũ khí...)
  - `ministries`: string[] (cơ quan chủ quản: BCT, BNNPTNT, BTTTT, BCA...)
- Build script `scripts/parse-policies.mjs`:
  - Đọc `tax.json[*].cs`
  - Match regex/keyword (vd `"giấy phép" → requiresLicense`)
  - Output `tax-enriched.json` với extra fields

**B5.2 — Đào luyện chuyên sâu** (`scripts/enrich-policies.mjs`):
- Với mỗi HS có `cs` không rỗng → gọi Gemini 2.5 Pro (chậm hơn nhưng chính xác hơn):
  - Prompt: "Phân tích đoạn chính sách này và rút ra: cần giấy phép gì? cơ quan nào? mã văn bản pháp luật?"
  - Output JSON structured
- Batch process 12k mã → ghi đè `tax-enriched.json`
- Cron weekly chạy lại nếu data có update

**B5.3 — Expose qua API**:
- `/api/tax?hs=X` thêm field:
  ```json
  "warnings": {
    "requiresLicense": true,
    "ministries": ["BTTTT", "BCT"],
    "dualUseControl": true,
    "summary": "Cần giấy phép NK + kiểm tra chất lượng + sản phẩm mật mã dân sự"
  }
  ```
- ERP UI sẽ hiển thị badge cảnh báo NGAY khi user chọn mã HS.

**B5.4 — Lọc duplicate / outdated**:
- Có mã HS có `mo_ta` trùng — kiểm tra: 11,871 mã có bao nhiêu unique?
- Có mã có `vat: ""` rỗng — flag để CEO review
- Có mã `tt: "0"` nhưng `mfn: null` — flag, có thể do thiếu data
- Output report `data-quality-report.md`

---

### B6. **`POST /api/feedback`** — Capture feedback từ ERP director (P1)

Khi quản lý ERP override HS code AI suggest hoặc trả lại note cho NV, ERP POST event sang:

**Request**:
```json
POST /api/feedback
Authorization: Bearer $TOKEN

{
  "feedbackType": "DIRECTOR_HS_OVERRIDE",
  "hsCodeAtTime": "85171200",       // mã NV ghi
  "correctedHsCode": "85171300",    // mã director sửa
  "productName": "iPhone 15 Pro Max",
  "directorNote": "Smartphone phải dùng 85171300 không phải 85171200",
  "orderCode": "OZ-25-04-2348",
  "createdAt": "2026-05-27T..."
}
```

**Response**: `{ "ok": true, "feedbackId": "fb_xxx" }`

**Storage options**:
- Phase 1: append vào file `data/feedback.jsonl` (JSON Lines, mỗi dòng 1 event) → commit định kỳ
- Phase 2 (sau): chuyển sang Neon Postgres (cùng stack hs-code-chatbot)

**Mục đích**: Build dataset đào luyện future — học từ sửa của director.

---

### B7. **`GET /api/kg_chapter?chapter=85`** — List chương HS (P2)

```json
{
  "chapter": "85",
  "total": 234,
  "items": [
    { "hsCode": "85011000", "nameVi": "Động cơ điện một pha < 37.5 W" },
    ...
  ]
}
```

Cho UI ERP TariffTable load theo chương.

---

### B8. **`GET /api/kg_stats`** — Tổng quan (P2)

```json
{
  "totalHsCodes": 11871,
  "chapters": 97,
  "tariffCoverage": { "withMfn": 11871, "withAcfta": 11200, "withVat": 11871 },
  "withWarnings": 4523,
  "lastEnrichedAt": "2026-05-27T10:00:00Z"
}
```

Cho dashboard admin.

---

## C. Env vars (set trên Vercel `hs-code-api-1` project)

```bash
HS_API_TOKEN=<openssl rand -hex 32>           # B1 auth
GEMINI_API_KEY=AIza...                        # B2 + B3
GEMINI_RERANK_MODEL=models/gemini-2.5-flash   # default
GEMINI_DESCRIBE_MODEL=models/gemini-2.5-flash
GEMINI_ENRICH_MODEL=models/gemini-2.5-pro     # B5.2 chậm chính xác hơn
```

---

## D. Custom domain — Phase 7.4 dở dang

`hs-kb.uythacnhapkhau.com` đang link nhầm sang `hs-knowledge-api` (project em xây Phase 7).

Cần:
1. `vercel domains rm hs-kb.uythacnhapkhau.com` trên project `hs-knowledge-api`
2. `vercel domains add hs-kb.uythacnhapkhau.com` trên project link với repo `hs-code-api-1`
3. CEO setup DNS Azdigi: `A hs-kb → 76.76.21.21`

---

## E. ERP integration — đã sẵn sàng phía ERP

ERP đã có `src/lib/hs-kb-client.ts` (Phase 7.2) với 4 hàm: `hsKbSuggest`, `hsKbDescribe`, `hsKbSearch`, `hsKbFeedback`. Chỉ cần đổi `HS_KB_API_URL` env:

```bash
# Hiện tại
HS_KB_API_URL=https://hs-knowledge-api.vercel.app

# Đổi sang
HS_KB_API_URL=https://hs-kb.uythacnhapkhau.com   # (sau khi DNS active)
# Hoặc tạm:
HS_KB_API_URL=https://hs-code-api-1-ywbe.vercel.app
```

ERP client sẽ tự work vì:
- `hsKbSearch` → `/api/search` (đã match contract)
- `hsKbTariffLookup` → `/api/tax` (đã match contract, chỉ rename field nameVi/nameEn)
- `hsKbSuggest` → cần B2 implement
- `hsKbDescribe` → cần B3 implement
- `hsKbFeedback` → cần B6 implement

Shape rename mapping cần verify:

| hs-code-api-1 trả | ERP client expect |
|---|---|
| `r.hs` | `hsCode` |
| `r.vn` (tax.json key) | `nameVi` |
| `r.dvt` | `unitVi` |
| `r.thue.nk_mfn` | `taxNkPreferential` |
| `r.thue.nk_tt` | `taxNkTt` |
| `r.thue.acfta` | `taxAcfta` |
| `r.thue.vat` | `taxVat` |
| `r.chinh_sach` | `policyByHs` |

Có 2 cách:
- **Cách A**: `hs-code-api-1` đổi shape về camelCase matching → ERP client KHÔNG phải đổi
- **Cách B**: ERP client lib `hs-kb-client.ts` map shape — nhưng vẫn cần đổi field naming

Khuyến nghị: **Cách A** (`hs-code-api-1` đổi naming convention sang camelCase chuẩn) — clean hơn vì service mới start, chưa có client production khác.

---

## F. Priority order khi anh code

| Phase | Items | Estimate |
|---|---|---|
| **1. Bắt buộc trước ERP merge PR #3683** | B1 (auth) + B4 (health) + rename camelCase | 2h |
| **2. Core AI features** | B2 (suggest) + B3 (describe) | 3h |
| **3. Domain + cutover** | D (alias domain) + đổi ERP env | 30 phút |
| **4. Polish + đào luyện** | B5 (data filter + enrich) + B6 (feedback) | 4h |
| **5. Nice-to-have** | B7 (chapter list) + B8 (stats) | 1h |

Sau Phase 1+2+3: ERP có thể merge PR #3683 + #3684 và go-live với `hs-code-api-1`.

---

## G. Sau khi `hs-code-api-1` live đầy đủ

Em sẽ:
1. Delete project `hs-knowledge-api` Vercel (em xây Phase 7 trật hướng).
2. Đóng PR `hs-knowledge-api` GitHub repo (đặt archived).
3. Update ERP CLAUDE.md ghi rõ service là `hs-code-api-1`.

---

**Ghi chú em**:
- Em đã build `hs-knowledge-api` Phase 7 với architecture 9-tầng Prisma + pgvector + Gemini — overengineered cho mục đích "tra HS + thuế + sinh mô tả". `hs-code-api-1` với tax.json flat đủ rồi.
- Tránh tương lai: em sẽ check repo cũ của anh TRƯỚC khi xây mới (lesson learned).
