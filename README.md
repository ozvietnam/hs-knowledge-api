# HS Knowledge API — v2.0

Service độc lập của Oz Việt Nam — Knowledge graph 9 tầng + AI suggest/describe HS code cho ERP `erp-xnk` gọi qua HTTP với Bearer token.

**Repository**: `ozvietnam/hs-knowledge-api`
**Stack**: Next.js 15 + TypeScript + Prisma 6 + Postgres (Supabase) + pgvector + Gemini API (2.5-flash + embedding-001)
**Hosting**: Vercel (team `thangs-projects-4472c6e9`)
**Production**: https://hs-knowledge-api.vercel.app (alias `hs-kb.uythacnhapkhau.com` — DNS pending Phase 7.4)

---

## Kiến trúc 9 tầng dữ liệu

| Tầng | Tên | Bảng | Nguồn data |
|------|-----|------|------------|
| 1 | Fact (thuế suất) | `tariff_2026` | Excel CEO seed (~12k mã) — qua `scripts/import-tariff-excel.ts` |
| 2 | Legal (chú giải, SEN) | `hs_explanatory_note` | PDF TCHQ + `kg_index.json` + `bao_gom_index.json` |
| 3 | Regulatory (luật hiện hành) | (TBD) | Văn bản pháp luật XNK |
| 4 | Precedent (TB-TCHQ) | `historical_declaration_item` | Excel tờ khai cũ + `tb_tchq_index.json` |
| 5 | Conflict (HS dễ nhầm) | `hs_conflict` | `conflict_index.json` |
| 6 | Classification (GIR) | (TBD) | General Interpretive Rules |
| 7 | Cross-border CN/TH | (TBD) | HS mapping ngoại |
| 8 | Logistics | (TBD) | cửa khẩu, giá tham chiếu |
| 9 | AI (Dynamic + Validation) | `hs_knowledge_feedback` | ERP director feedback |

Tầng 3, 6, 7, 8 dự kiến thêm ở phase sau khi có nhu cầu thực tế.

---

## API endpoints

### Public (no auth)
```
GET /api/health
  → Health check: DB, pgvector, env vars
```

### Authenticated (Bearer token)
```
GET  /api/kg?hs=85167100              ← KG đầy đủ 9 tầng (legacy)
GET  /api/kg_search?q=máy+bơm         ← search 3-tier (exact / FTS / trigram)
GET  /api/kg_chapter?chapter=85       ← list HS chapter
GET  /api/kg_stats                    ← stats coverage

POST /api/suggest                     ← multi-source semantic + LLM rerank
  Body: { description, options? }
  Returns: { suggestions[], evidence[], llmModel, ms }

POST /api/describe                    ← sinh mô tả disambiguation-aware
  Body: { hsCode, productName, brand, model, ... }
  Returns: { customsDescription, structure, warnings, ms }

POST /api/feedback                    ← capture từ ERP director actions
  Body: { feedbackType, hsCodeAtTime, directorNote, ... }
  Returns: { ok: true, feedbackId }
```

Headers cho authenticated endpoints:
```
Authorization: Bearer ${HS_KB_API_TOKEN}
Content-Type: application/json
```

---

## Setup local

```bash
pnpm install
cp .env.local.example .env       # NOTE: .env (không phải .env.local) — Prisma CLI đọc .env
# Fill DATABASE_URL, DIRECT_URL, GEMINI_API_KEY, HS_KB_API_TOKEN, CRON_SECRET
pnpm prisma generate
pnpm prisma db push              # creates schema hs_kb + tables
pnpm dev                         # http://localhost:3000
```

Smoke test:
```bash
curl http://localhost:3000/api/health
# → { service: "hs-knowledge-api", status: "healthy", ... }

source .env
curl -H "Authorization: Bearer $HS_KB_API_TOKEN" \
     http://localhost:3000/api/kg_stats
```

---

## Admin CLI workflow

Tất cả script chạy với env vars load từ `.env`:
```bash
set -a; source .env; set +a
```

### 1. Import legacy JSON (one-time, lần đầu setup)
```bash
# Import 4 JSON: kg_index, bao_gom, conflict, tb_tchq → hs_kb.*
pnpm tsx scripts/import-legacy-json.ts

# Hoặc selective:
pnpm tsx scripts/import-legacy-json.ts --only=conflict,tb_tchq

# Dry run xem stats trước khi commit:
pnpm tsx scripts/import-legacy-json.ts --dry-run
```

Sau import lần đầu (Phase 7.1):
- `hs_explanatory_note`: ~3,446 rows
- `historical_declaration_item`: ~1,058 rows
- `hs_conflict`: 57 rows
- `tariff_2026`: **0 rows** (chờ Excel — bước 2)

### 2. Import Tariff Excel 2026 (~12k HS code)
```bash
# Đặt file vào ./data/
mkdir -p data && cp ~/Downloads/bieu-thue-2026.xlsx data/

# Dry-run kiểm tra column mapping + sample 3 rows:
pnpm tsx scripts/import-tariff-excel.ts data/bieu-thue-2026.xlsx --dry-run

# Nếu mapping chưa match (Excel có cột tên lạ), tạo custom mapping:
echo '{"Cột Lạ Của Anh": "nameVi"}' > scripts/tariff-mapping-custom.json
pnpm tsx scripts/import-tariff-excel.ts data/bieu-thue-2026.xlsx \
  --mapping=scripts/tariff-mapping-custom.json --dry-run

# Production import (UPSERT idempotent):
pnpm tsx scripts/import-tariff-excel.ts data/bieu-thue-2026.xlsx

# Nếu workbook có nhiều sheet, chọn cụ thể:
pnpm tsx scripts/import-tariff-excel.ts data/bieu-thue-2026.xlsx --sheet="Biểu thuế"
```

Default column mapping support cả tiếng Việt + English. Xem `DEFAULT_MAPPING` trong `scripts/import-tariff-excel.ts`.

### 3. Trigger embedding (sau khi nạp data)
Cron weekly tự chạy (Sun 3am UTC) nhưng có thể chạy manual:
```bash
# Tariff:
pnpm tsx -e "
import { embedTable, tariffText } from './src/lib/hs-knowledge/embed';
(async () => {
  const stats = await embedTable({ tableName: 'Tariff2026', textBuilder: tariffText });
  console.log(stats);
})();
"

# Tương tự cho HsExplanatoryNote (noteText) và HistoricalDeclarationItem (historicalText).
```

### 4. Smoke test sau khi nạp data
```bash
TOKEN=$(grep "^HS_KB_API_TOKEN=" .env | sed -E "s/^HS_KB_API_TOKEN=//; s/^['\"]?//; s/['\"]?$//")

# Search:
curl -H "Authorization: Bearer $TOKEN" "https://hs-knowledge-api.vercel.app/api/kg_search?q=máy+bơm"

# Suggest (LLM, ~10-15s):
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"iPhone 15 Pro Max 256GB"}' \
  https://hs-knowledge-api.vercel.app/api/suggest

# Describe (LLM):
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"hsCode":"85171300","productName":"iPhone 15 Pro Max","brand":"Apple"}' \
  https://hs-knowledge-api.vercel.app/api/describe
```

### 5. Rotate token (security)
```bash
# Generate new 64-char hex token:
NEW_TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Update Vercel (both envs):
vercel env rm HS_KB_API_TOKEN production --yes
vercel env rm HS_KB_API_TOKEN preview --yes
vercel env add HS_KB_API_TOKEN production --value "$NEW_TOKEN" --yes --force
vercel env add HS_KB_API_TOKEN preview "" --value "$NEW_TOKEN" --yes --force

# Đồng bộ ERP project (env vars cũng tên HS_KB_API_TOKEN):
cd ../erp-xnk
vercel env rm HS_KB_API_TOKEN production --yes
vercel env rm HS_KB_API_TOKEN preview --yes
vercel env add HS_KB_API_TOKEN production --value "$NEW_TOKEN" --yes --force
vercel env add HS_KB_API_TOKEN preview "" --value "$NEW_TOKEN" --yes --force

# Local .env:
sed -i.bak "s|^HS_KB_API_TOKEN=.*|HS_KB_API_TOKEN=\"$NEW_TOKEN\"|" .env

# Trigger redeploy cả 2 projects (Vercel auto-redeploy on env change KHÔNG đảm bảo —
# trigger thủ công cho chắc):
cd ../hs-knowledge-api && vercel deploy
cd ../erp-xnk && vercel deploy
```

---

## Deployment (Vercel)

Setup lần đầu:
```bash
vercel link --project hs-knowledge-api
vercel env add DATABASE_URL production
vercel env add DIRECT_URL production
vercel env add GEMINI_API_KEY production
vercel env add HS_KB_API_TOKEN production
vercel env add CRON_SECRET production
# (lặp với preview)
vercel --prod
```

Auto-deploy: push tới `main` (production) hoặc bất kỳ branch nào (preview).

### Cron entries (`vercel.json`)
- Weekly `/api/cron/embed-knowledge-base` (Sun 3am UTC) — embed rows mới
- Daily `/api/cron/extract-features-from-feedback` (4am UTC) — promote feedback patterns thành `discriminatingFeatures`

### Custom domain — Phase 7.4

Vercel project đã add `hs-kb.uythacnhapkhau.com`. CEO cần setup DNS trên Azdigi:

**Option A (recommended): A record**
```
Type:  A
Name:  hs-kb
Value: 76.76.21.21
TTL:   3600
```

**Option B: CNAME**
```
Type:  CNAME
Name:  hs-kb
Value: cname.vercel-dns.com
TTL:   3600
```

Sau khi DNS propagate (~5-30 phút), Vercel tự verify + cấp SSL. Test:
```bash
curl https://hs-kb.uythacnhapkhau.com/api/health
```

Khi alias hoạt động, update ERP env `HS_KB_API_URL`:
```bash
cd erp-xnk
vercel env rm HS_KB_API_URL production --yes
vercel env add HS_KB_API_URL production --value "https://hs-kb.uythacnhapkhau.com" --yes --force
# (tương tự preview)
```

---

## Integration với ERP

ERP `erp-xnk` gọi service này qua `src/lib/hs-kb-client.ts` (Phase 7.2):

```typescript
// erp-xnk/src/lib/hs-kb-client.ts
import { hsKbSuggest, hsKbDescribe, hsKbSearch, hsKbFeedback, hsKbTariffLookup } from "@/lib/hs-kb-client";

const result = await hsKbSuggest("iPhone 15 Pro Max", { topReranked: 3 });
```

ERP-side env vars:
- `HS_KB_API_URL` = `https://hs-kb.uythacnhapkhau.com` (sau khi DNS active) hoặc `https://hs-knowledge-api.vercel.app`
- `HS_KB_API_TOKEN` = cùng giá trị set ở hs-knowledge-api project

---

## Migration history

- **v2.4 (2026-05-27)** — Phase 7.4: Tariff Excel import script + custom domain + admin docs
- **v2.3 (2026-05-27)** — Phase 7.3: ERP cleanup HS Knowledge Base (xóa lib + UI + Prisma models)
- **v2.2 (2026-05-27)** — Phase 7.2: ERP cutover sang HTTP client
- **v2.1 (2026-05-27)** — Phase 7.1 hotfix: gemini-embedding-001 (text-embedding-004 deprecated)
- **v2.0 (2026-05-27)** — Phase 7.1 rewrite Next.js TS + Prisma schema hs_kb + 9 endpoints
- **v1.0 (2026-04-14)** — Python orchestrator + 4 endpoint .js (legacy/)

Legacy code giữ trong `/legacy/` để tham chiếu data + Python enrichment scripts.

---

## Roadmap Phase 7

| Sub-phase | Mục tiêu | Status |
|-----------|----------|--------|
| 7.1.T1 | Scaffold Next.js 15 TS + branch | ✅ |
| 7.1.T2 | Prisma schema `hs_kb` | ✅ |
| 7.1.T3 | Port 4 legacy endpoint sang TS | ✅ |
| 7.1.T4 | Port lib hs-knowledge từ ERP | ✅ |
| 7.1.T5 | 3 endpoint mới + token auth | ✅ |
| 7.1.T6 | Script import 4 legacy JSON | ✅ |
| 7.1.T7 | Deploy Vercel + smoke test | ✅ |
| 7.2 | ERP migrate sang API client | ✅ (PR #3683) |
| 7.3 | ERP cleanup HS lib + Prisma | ✅ (PR #3684) |
| 7.4.T1 | Tariff Excel import script | ✅ |
| 7.4.T2 | Custom domain + DNS setup | 🟡 (Vercel side done, DNS pending CEO) |
| 7.4.T3 | Admin CLI workflow docs | ✅ |

Tầng 3, 6, 7, 8 ở Phase 8 sau khi có nhu cầu thực tế.
