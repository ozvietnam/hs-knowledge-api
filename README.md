# HS Knowledge API — v2.0

Service độc lập của Oz Việt Nam — Knowledge graph 9 tầng + AI suggest/describe HS code cho ERP `erp-xnk` gọi qua HTTP với Bearer token.

**Repository**: `ozvietnam/hs-knowledge-api`
**Stack**: Next.js 15 + TypeScript + Prisma 6 + Postgres (Supabase) + pgvector + Gemini API
**Hosting**: Vercel (team `thangs-projects-4472c6e9`)

---

## Kiến trúc 9 tầng dữ liệu

| Tầng | Tên | Bảng | Nguồn data |
|------|-----|------|------------|
| 1 | Fact (thuế suất) | `tariff_2026` | Excel CEO seed (~12k mã) |
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
GET  /api/kg_search?q=máy+bơm         ← search semantic
GET  /api/kg_chapter?ch=85            ← list HS chapter
GET  /api/kg_stats                    ← stats coverage

POST /api/suggest                     ← NEW: multi-source + LLM rerank
  Body: { description, options? }
  Returns: { suggestions[], evidence[], llmModel, ms }

POST /api/describe                    ← NEW: sinh mô tả disambiguation
  Body: { hsCode, productName, brand, model, ... }
  Returns: { customsDescription, structure, warnings, ms }

POST /api/feedback                    ← NEW: capture từ ERP director
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
cp .env.local.example .env.local  # fill DATABASE_URL, GEMINI_API_KEY, HS_KB_API_TOKEN
pnpm prisma generate
pnpm prisma migrate dev            # creates schema hs_kb
pnpm dev                           # http://localhost:3000
```

Test:
```bash
curl http://localhost:3000/api/health
# → { service: "hs-knowledge-api", status: "healthy", ... }

curl -H "Authorization: Bearer $HS_KB_API_TOKEN" \
     http://localhost:3000/api/kg_stats
```

---

## Deployment (Vercel)

```bash
vercel link --project hs-knowledge-api
vercel env add DATABASE_URL production
vercel env add DIRECT_URL production
vercel env add GEMINI_API_KEY production
vercel env add HS_KB_API_TOKEN production
vercel env add CRON_SECRET production
vercel --prod
```

Cron entries trong `vercel.json`:
- Weekly `/api/cron/embed-knowledge-base` (Sun 3am UTC)
- Daily `/api/cron/extract-features-from-feedback` (4am UTC)

---

## Integration với ERP

ERP `erp-xnk` (cùng owner) gọi service này thay vì tự thực hiện logic HS. Pattern:

```typescript
// erp-xnk/src/lib/hs-kb-client.ts
const HS_KB_URL = process.env.HS_KB_API_URL!;
const HS_KB_TOKEN = process.env.HS_KB_API_TOKEN!;

export async function hsKbSuggest(description: string) {
  const res = await fetch(`${HS_KB_URL}/api/suggest`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HS_KB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) throw new Error(`hs-kb suggest ${res.status}`);
  return res.json();
}
```

---

## Migration history

- **v2.0 (2026-05-27)** — Phase 7 rewrite Next.js TS + 3 endpoint mới
- **v1.0 (2026-04-14)** — Python orchestrator + 4 endpoint .js (legacy/)

Legacy code giữ trong `/legacy/` để tham chiếu data + Python enrichment scripts.

---

## Roadmap Phase 7

| Sub-phase | Mục tiêu | Status |
|-----------|----------|--------|
| 7.1.T1 | Scaffold Next.js 15 TS + branch | ✅ |
| 7.1.T2 | Prisma schema `hs_kb` | ✅ |
| 7.1.T3 | Port 4 legacy endpoint sang TS | 🔄 |
| 7.1.T4 | Port lib hs-knowledge từ ERP | ⏳ |
| 7.1.T5 | 3 endpoint mới + token auth | ⏳ |
| 7.1.T6 | Script import 4 legacy JSON | ⏳ |
| 7.1.T7 | Deploy Vercel + smoke test | ⏳ |
| 7.2 | ERP migrate sang API client | ⏳ |
| 7.3 | Validate + cutover | ⏳ |

Tầng 3, 6, 7, 8 ở Phase 8 sau.
