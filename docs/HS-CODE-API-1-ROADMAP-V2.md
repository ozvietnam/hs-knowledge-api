# `hs-code-api-1` — Roadmap V2

**Position:** Service backbone tra cứu HS code + thuế + sinh mô tả + capture feedback cho ERP `erp-xnk`.
**Live:** https://hs-code-api-1-ywbe.vercel.app
**Hiện trạng (2026-05-27):** Issue #1 spec mở rộng đã code xong endpoints. Thiếu env vars Vercel + đào luyện data sâu + UI vận hành.

---

## Triple-axis design — 3 trục song song

```
                   ┌─────────────────────────────────────┐
                   │   hs-code-api-1 (REST service)      │
                   │   /api/{tax,search,notes,kg_*}      │
                   │   /api/{suggest,describe,feedback}  │
                   └──────────────┬──────────────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
        ▼                         ▼                         ▼
  ── TRỤC 1 ──            ── TRỤC 2 ──             ── TRỤC 3 ──
  DATA PIPELINE           OPERATOR UI              ML LOOP
  Thu thập + đào luyện    Giao diện vận hành       Học từ feedback
  ────────────────        ──────────────────       ────────────────
  S0. Env setup           S2. Admin Dashboard      S3. KPI Monitor
  S1. Knowledge merge     S2. Browse HS detail     S3. Confidence tracking
  S1. Policy enricher     S2. Feedback queue       S4. Prompt evolution
  S1. WCO cross-ref       S2. Editor (CEO only)    S4. Auto-promote pattern
  S1. Tariff versioning   S2. Bulk export
```

---

## Sprint 0 — Production blocker (FIX NGAY)

### Trạng thái thực tế
```bash
$ curl https://hs-code-api-1-ywbe.vercel.app/api/health
→ "checks": { "geminiKey": { "ok": false }, "apiToken": { "ok": false } }
```

**ERP sẽ KHÔNG GỌI ĐƯỢC service** cho tới khi:
- `HS_API_TOKEN` set trên Vercel
- `GEMINI_API_KEY` set trên Vercel

→ **Issue #2 — Set production env vars + verify**

---

## Sprint 1 — Data Pipeline (3-4 tuần)

Hiện `tax.json` chỉ có 11,871 mã HS + thuế + chính sách dạng text dài. Để AI suggest/describe có context tốt, cần đào luyện:

### Issue #3 — Merge Knowledge từ `hs-knowledge-api/legacy/data/`

Local có 4 JSON cũ Phase 7.1 đã import (em làm trật):
- `bao_gom_index.json` — Tầng 2 chú giải (3,446 entries)
- `conflict_index.json` — Tầng 5 HS dễ nhầm (57 entries)
- `tb_tchq_index.json` — Tầng 4 TB-TCHQ precedent (1,058 entries)
- `kg_index.json` — risk level cho từng HS

**Action**: Convert 4 JSON → 4 file mới trong `hs-code-api-1/data/`:
- `data/explanatory-notes.json` (chú giải SEN + INCLUDES)
- `data/conflicts.json` (mã dễ nhầm + risk level)
- `data/precedents.json` (TB-TCHQ + tờ khai)
- Update `lib/data.js` + `/api/notes` + tạo `/api/conflicts` + `/api/precedents`

### Issue #4 — Policy Enricher (Gemini 2.5 Pro deep parse)

Hiện `lib/tax-mapper.js` chỉ regex basic (giấy phép/kiểm dịch/kiểm tra/mật mã). Cần:

**Output cho mỗi HS có `cs` text** (~7,928 mã):
```json
"warnings": {
  "requiresLicense": true,
  "licenseType": ["NK", "XK"],
  "requiresInspection": true,
  "inspectionType": ["CR chất lượng", "VSATTP"],
  "requiresQuarantine": false,
  "dualUseControl": true,
  "ministries": ["BCT", "BTTTT", "BCA"],
  "legalDocs": [
    { "code": "08/2023/TT-BCT", "type": "Thông tư", "year": 2023, "section": "PL1.I" },
    { "code": "211/2025/NĐ-CP", "type": "Nghị định", "year": 2025 }
  ],
  "summary": "Hàng tiêu dùng QSD, cần giấy phép NK + kiểm tra CR + sản phẩm mật mã dân sự",
  "severity": "HIGH"   // LOW/MEDIUM/HIGH/CRITICAL — based on số yêu cầu
}
```

**Pipeline**:
1. `scripts/enrich-policies.mjs` — chạy Gemini 2.5 Pro batch
2. Output `data/tax-enriched.json` (override `data/tax.json` warnings field)
3. Cost: ~7,928 calls × $0.005 = ~$40 one-time
4. Cron weekly check: nếu `tax.json` thay đổi → re-enrich row đó

### Issue #5 — WCO Cross-Reference (English names)

Hiện 11,871 HS chỉ có `nameVi`. UI tiếng Anh + AI semantic search English query cần `nameEn`.

**Action**:
1. Bundle `datasets/harmonized-system` CSV (6,940 row, 6-digit, public domain WCO)
2. Script `scripts/augment-english.mjs` — match 6-digit prefix → fill nameEn
3. Update `lib/tax-mapper.js` thêm field `nameEn`

### Issue #6 — Tariff Versioning Pipeline

Biểu thuế đổi theo NĐ/TT mới. Cần track changes.

**Schema** `data/versions/`:
```
data/versions/
  2026-01-01-base.json       (snapshot v1)
  2026-04-01-diff.json       (diff vs base: ADDED/REMOVED/RATE_CHANGED)
  2026-07-01-diff.json
  index.json                 (metadata: version, effectiveDate, source, checksum)
```

**Endpoints**:
- `GET /api/versions` — list versions
- `GET /api/version/diff?from=X&to=Y` — diff 2 phiên bản
- `POST /api/version/upload` — admin upload xlsx new tariff → auto-diff + create new version

---

## Sprint 2 — Operator UI (3-4 tuần)

`hs-code-api-1` hiện chỉ là REST API. Admin Oz cần web UI để vận hành.

**Stack đề xuất**: Next.js 14 (App Router) ngay trong cùng repo `hs-code-api-1` (Vercel mono). Route `/admin/*` chỉ auth `HS_API_TOKEN`.

### Issue #7 — Admin Dashboard (read-only)

**Path**: `app/admin/page.tsx`

**Widgets**:
- Total HS codes / chapters / with-warnings
- Recent searches (last 100 from log)
- Top 10 most-queried HS
- Feedback queue size + breakdown by type
- Tariff coverage % (mfn/acfta/vat/bvmt)
- Last enriched at
- Vercel deploy status + Gemini quota remaining

### Issue #8 — HS Browse + Detail

**Path**: `app/admin/hs/[hsCode]/page.tsx`

**Features**:
- Tree view 97 chapters → click → list HS in chapter (paginated)
- Search bar (proxy `/api/search`)
- Detail page mỗi mã HS:
  - Tax rates (table)
  - Policy warnings (parsed structured + raw text)
  - Explanatory notes (Tầng 2)
  - Precedents TB-TCHQ (Tầng 4)
  - Conflicts (Tầng 5)
  - Feedback history (mã này có bao nhiêu director override)
- Print/export 1 mã thành PDF/Excel để training NV

### Issue #9 — Editor UI (CEO only, write access)

**Path**: `app/admin/edit/[hsCode]/page.tsx`

**Permissions**: `HS_API_TOKEN` đủ → cấp full edit. Future: thêm `HS_ADMIN_TOKEN` cho edit, `HS_API_TOKEN` chỉ read.

**Editable fields**:
- `nameVi`, `nameEn` (translation)
- `policyByHs` raw + `warnings` parsed (re-trigger Gemini Pro nếu cần)
- Manual override `discriminatingFeatures` (em tip cho AI rerank)
- Approve/reject precedent từ Tầng 4

**Behavior**:
- Audit log mọi sửa đổi → `data/audit-log.jsonl`
- Optimistic UI + commit qua API `POST /api/admin/update`
- Daily snapshot git commit (cron) — full rollback nếu cần

### Issue #10 — Feedback Review Queue

**Path**: `app/admin/feedback/page.tsx`

**Mục đích**: Đọc `data/feedback.jsonl` từ ERP → CEO review từng feedback → mark resolved + tự promote pattern.

**Table columns**:
- createdAt | type | hsCodeAtTime → correctedHsCode | orderCode | directorNote | status

**Actions**:
- ✓ Approve correction → cập nhật `discriminatingFeatures` của HS gốc (nếu pattern lặp ≥3 lần)
- ✗ Reject → mark "false positive"
- 📋 Bulk export CSV cho ML training

---

## Sprint 3 — ML Loop (4-6 tuần)

### Issue #11 — Confidence Tracking + KPI

Track mỗi `/api/suggest` call:
- Input description, candidates returned, confidence scores
- Outcome (sau khi director duyệt): correct / overridden
- Compute override rate per HS chapter, per confidence bucket

**Output dashboard** `app/admin/ml/page.tsx`:
- Override rate trend (7d/30d/90d)
- Top 10 HS có override rate cao (>30%) — cần đào luyện thêm
- Confidence calibration chart (90% confidence → thực 90% đúng?)

**Storage**: `data/ml-log.jsonl` (append-only)

### Issue #12 — Prompt Evolution + Auto-promote

**Auto-promote pattern**:
- Cron daily đọc `feedback.jsonl` → group by `correctedHsCode`
- Nếu cùng correction lặp ≥3 lần với pattern tương tự (mô tả similarity > 0.8) → suggest update `discriminatingFeatures`
- CEO duyệt qua Editor UI

**Prompt tuning**:
- Issue #11 KPI show top error patterns
- Manual update `SYSTEM_PROMPT` trong `api/suggest.js` để cover edge cases
- A/B test 2 prompt — log accuracy delta

---

## Timeline

| Sprint | Issues | Estimate | Khi cần xong |
|---|---|---|---|
| **S0** (blocker) | #2 | 15 phút | Hôm nay — anh code 1 phút |
| **S1 Data** | #3 #4 #5 #6 | 3-4 tuần (~30h dev) | Phase A: trước khi ERP merge develop → main |
| **S2 UI** | #7 #8 #9 #10 | 3-4 tuần (~40h dev) | Phase B: khi có thêm 1 NV Oz làm CUS check |
| **S3 ML** | #11 #12 | 4-6 tuần (~50h dev) | Phase C: khi có ≥100 feedback records |

**Critical path**: S0 → S1.#3 (merge data Phase 7.1) → S1.#4 (Gemini Pro enrich) → ERP cutover qua `hs-code-api-1` (chỉ cần S0 + S1.#3 là đủ).

S2 + S3 là long-term operations, không block ERP go-live.

---

## Anti-patterns em quan sát

| Pattern | Phòng tránh |
|---|---|
| Build mới khi đã có repo cũ | [[lesson_check_old_repos_first]] |
| Endpoint AI mà chưa set env vars | Health check phải green trước test |
| Edit data trực tiếp file JSON không có audit | Issue #9 bắt buộc audit-log + git commit daily |
| Cron tariff update không có version diff | Issue #6 ép có version history |
| Feedback đổ vào file mà không action | Issue #10 + #12 close loop |

---

## Cleanup obligations sau khi `hs-code-api-1` đầy đủ S0+S1

(Em sẽ làm khi anh OK):
1. Move domain `hs-kb.uythacnhapkhau.com` → `hs-code-api-1` project
2. Đổi ERP env `HS_KB_API_URL` chĩa qua `hs-code-api-1-ywbe.vercel.app` (hoặc alias)
3. Smoke test end-to-end ERP → service
4. Delete Vercel project `hs-knowledge-api` (em xây trật Phase 7)
5. Archive GitHub repo `hs-knowledge-api`
6. Update ERP CLAUDE.md ghi service = `hs-code-api-1`

---

## Note cuối — vai trò mỗi repo

| Repo | Vai trò | Trạng thái |
|---|---|---|
| `erp-xnk` | ERP nội bộ Oz | ✅ Live, đang dùng |
| **`hs-code-api-1`** | Service HS code backbone | 🟡 Endpoints xong, thiếu data sâu + UI vận hành |
| `hs-code-chatbot` | UI chatbot end-user | ⏸ Future — public HS lookup |
| `hs-code-explorer` | UI explorer (Lovable.dev) | ⏸ Có thể reuse cho Admin UI Issue #7-10 |
| `hs-knowledge-api` | (Em xây trật) | ❌ Sẽ archive |

`hs-code-explorer` đáng xem xét reuse cho Sprint 2 — đã có React + Supabase scaffold, có thể adapt thành Admin UI nhanh hơn từ-đầu.
