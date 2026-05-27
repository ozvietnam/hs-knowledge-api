# CLAUDE.md — hs-knowledge-api

Service độc lập của Oz Việt Nam — Knowledge graph + AI suggest/describe HS code cho ERP gọi qua HTTP với Bearer token.

## Context

- **Owner**: CEO Oz, solo dev với Claude (như erp-xnk).
- **Parent ERP**: `ozvietnam/erp-xnk` (Next.js TS) gọi service này qua HTTP.
- **Tách architecture (Phase 7, 2026-05-27)**: trước đây code sống trong ERP, giờ tách thành microservice để ERP nhẹ + commercialize sau.

## Tech stack

- Next.js 15 (App Router) + TypeScript strict
- Prisma 6 + Postgres (Supabase, **chung instance với ERP**)
- Schema **`hs_kb`** riêng (tách namespace, không lẫn với schema `public` ERP)
- pgvector + HNSW + tsvector
- Gemini API (`gemini-embedding-001` + `gemini-2.5-flash`) — reuse `GEMINI_API_KEY` ERP. NOTE: text-embedding-004 + gemini-2.0-flash bị Google deprecate cho new API users từ 2026-05.
- Vercel Functions cùng team `thangs-projects-4472c6e9`
- Production: https://hs-knowledge-api.vercel.app (alias `hs-kb.uythacnhapkhau.com` — Phase 7.4 DNS pending)

## Workflow

CEO yêu cầu → brainstorm → design → CEO approve → code thẳng (giống erp-xnk). KHÔNG sinh ticket Cursor — Claude full dev.

Commit message convention:
```
<type>(<scope>): <vi-subject>

[body]

Layer: L3
Phase: 7.x
```

## API contract (cho ERP gọi)

Tất cả endpoint trừ `/api/health` cần Bearer token (`HS_KB_API_TOKEN`).

| Endpoint | Method | Mục đích |
|----------|--------|----------|
| `/api/health` | GET | Health check (public) |
| `/api/kg?hs=X` | GET | KG đầy đủ 9 tầng theo mã HS (legacy) |
| `/api/kg_search?q=X` | GET | Tìm kiếm theo từ khoá |
| `/api/kg_chapter?ch=X` | GET | List items theo chapter |
| `/api/kg_stats` | GET | Stats tổng (số HS, tầng đầy đủ %) |
| `/api/suggest` | POST | Multi-source semantic + LLM rerank (Phase 1) |
| `/api/describe` | POST | Sinh mô tả khai báo disambiguation-aware (Phase 2) |
| `/api/feedback` | POST | Capture feedback từ director ERP (Phase 4) |

Response shape backward-compat với ERP HsTaxDialog.

## Schema cấu trúc (`hs_kb`)

| Bảng | Tầng | Nguồn |
|------|------|-------|
| `tariff_2026` | 1 Fact | Excel CEO seed (~12k rows) |
| `hs_explanatory_note` | 2 Legal | PDF TCHQ + kg_index.json + bao_gom_index.json |
| `historical_declaration_item` | 4 Precedent | Excel tờ khai cũ + tb_tchq_index.json |
| `historical_import_batch` | 4 Precedent | metadata import |
| `hs_conflict` | 5 Conflict | conflict_index.json (NEW so với ERP) |
| `hs_knowledge_feedback` | 9 AI | POST từ ERP |

## Repo structure

```
/app/api/            ← Next.js App Router endpoints (TS)
  health/            ← KHÔNG dùng prefix `_` (App Router private folder)
  kg/                ← legacy 4 endpoint port sang TS
  kg_search/
  kg_chapter/
  kg_stats/
  suggest/           ← NEW (Phase 1 ERP port)
  describe/          ← NEW (Phase 2 ERP port)
  feedback/          ← NEW (Phase 4 ERP port)
/src/lib/            ← shared logic
  prisma.ts
  auth.ts
  hs-knowledge/      ← port từ erp-xnk src/lib/hs-knowledge/
    parser.ts
    importer.ts
    embed.ts
    search.ts
    suggest.ts
    rerank.ts
    describe.ts
    feature-extractor.ts
    feedback.ts
/prisma/             ← schema hs_kb
/scripts/            ← CLI cho import + embed
/legacy/             ← code cũ giữ history (Python orchestrator, .js Vercel functions, chatbot Next.js)
```

## Env vars

```bash
DATABASE_URL=postgresql://...  # Cùng URL với ERP (Supabase shared)
DIRECT_URL=postgresql://...     # Direct connection (bypass pooler)
GEMINI_API_KEY=AIza...           # Reuse from ERP
HS_KB_API_TOKEN=                 # Bearer token, ERP env cũng có cùng giá trị
CRON_SECRET=                     # cho cron embed weekly
GEMINI_EMBEDDING_MODEL=models/gemini-embedding-001
GEMINI_RERANK_MODEL=models/gemini-2.5-flash
GEMINI_DESCRIBE_MODEL=models/gemini-2.5-flash
GEMINI_EXTRACT_MODEL=models/gemini-2.5-flash
EMBED_BATCH_SIZE=100
EMBED_RATE_LIMIT_MS=4000
```

## Migration history

- v1.0 (2026-04-14): Python orchestrator + 4 endpoint Vercel functions (legacy/)
- v2.0 (2026-05-27): Phase 7.1 rewrite Next.js TS + 3 endpoint mới (suggest/describe/feedback)
- v2.1 (2026-05-27): Phase 7.1 hotfix — gemini-embedding-001 (text-embedding-004 deprecated cho new users), gemini-2.5-flash (gemini-2.0-flash deprecated)
- v2.2 (2026-05-27): Phase 7.2 — ERP cutover HTTP client (`src/lib/hs-kb-client.ts`)
- v2.3 (2026-05-27): Phase 7.3 — ERP cleanup HS lib + Prisma models (xoá ~7,700 dòng khỏi ERP)
- v2.4 (2026-05-27): Phase 7.4 — Tariff Excel import script + custom domain + admin docs

## Tham chiếu ngoài

- ERP spec gốc: https://github.com/ozvietnam/erp-xnk/blob/develop/docs/superpowers/specs/2026-05-26-hs-knowledge-base-phase-0-design.md
- 9-tầng architecture: legacy/README.md
- Lifecycle review từ chatbot cũ: legacy/chatbot/REVIEW-DATA-LIFECYCLE.md

## Admin CLI (CEO + Claude operations)

```bash
# Setup env (lần đầu mỗi session):
set -a; source .env; set +a

# 1. Import legacy JSON (one-time setup):
pnpm tsx scripts/import-legacy-json.ts
# → 3,446 notes + 1,058 hist + 57 conflict

# 2. Import Tariff Excel 2026 (~12k mã HS):
mkdir -p data && cp ~/Downloads/bieu-thue-2026.xlsx data/
pnpm tsx scripts/import-tariff-excel.ts data/bieu-thue-2026.xlsx --dry-run  # kiểm tra mapping
pnpm tsx scripts/import-tariff-excel.ts data/bieu-thue-2026.xlsx            # production
# Custom column mapping nếu Excel khác chuẩn:
#   pnpm tsx scripts/import-tariff-excel.ts data/X.xlsx --mapping=scripts/custom.json

# 3. Smoke test endpoint:
TOKEN=$(grep "^HS_KB_API_TOKEN=" .env | sed -E "s/^HS_KB_API_TOKEN=//; s/^['\"]?//; s/['\"]?$//")
curl -H "Authorization: Bearer $TOKEN" https://hs-knowledge-api.vercel.app/api/kg_stats

# 4. Rotate token: xem README "Rotate token" section
```

Detail trong `README.md` — section "Admin CLI workflow".

## Khi hết context / session mới

Đọc theo thứ tự:
1. `README.md` — picture tổng + admin CLI workflow
2. `CLAUDE.md` — file này
3. `prisma/schema.prisma` — data model
4. `scripts/` — admin tooling (import-legacy-json.ts, import-tariff-excel.ts)
5. `legacy/README.md` — context 9-tầng cũ (chỉ khi cần research)
6. `app/api/*/route.ts` (mới nhất trước)
