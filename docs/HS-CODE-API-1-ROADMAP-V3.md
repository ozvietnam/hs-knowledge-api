# Roadmap V3 — Sau khi GOAL 3/3 đạt

**Date**: 2026-05-27 22:25  
**Previous**: [Roadmap V2](./HS-CODE-API-1-ROADMAP-V2.md), [GIR Architecture](./HS-DATA-ARCHITECTURE-PER-6-GIR.md)

---

## 🎯 GOAL STATUS — đã đạt 3/3

| Goal | Endpoint | Verified |
|---|---|---|
| ✅ Xác định mã HS | `POST /api/suggest` | iPhone smartphone → top1 `85171300` conf=98% trong 7.8s |
| ✅ Tra thuế | `GET /api/tax` | Full với warnings parsed (Issue #5 enrich) |
| ✅ Sinh mô tả | `POST /api/describe` | Tiếng Việt chuẩn, Gemini 2.5 Flash 8s |

**Bonus đạt thêm:**
- ✅ `/api/notes` chú giải HS code (Issue #4 wired)
- ✅ `/api/precedents` 242 mã có TB-TCHQ (Issue #4 partial GIR-4)
- ✅ `/api/conflicts` mã dễ nhầm (Issue #4)
- ⚠️ `/api/versions` đã code commit `ce0f0e8` chưa deploy (trigger redeploy)

---

## 📊 Sprint completion sau 4 giờ

Trong 4 giờ làm việc (14:00-18:00 UTC), anh code 9 commit qua các issues:
- ✅ #3 env vars (em làm)
- ✅ #4 merge knowledge legacy (commit `5a23719`)
- ✅ #7 tariff versioning (commit `ce0f0e8`)
- ✅ #15 fix search bug (commit `4a65b6d`)
- ✅ Một phần #5 enrich policy (commit `e043075`)

**Velocity**: 5 issues / 4h = ~50 phút/issue. Outstanding.

---

## 🔭 Path forward — sau GOAL đạt

Có 2 hướng để chọn:

### Hướng A — Bám ERP integration (cutover hôm nay)

ERP đã merge PR #3683+#3684 đêm qua, đã đổi env chĩa qua `hs-code-api-1`. Em chạy validation E2E (Issue #16) ngay khi #15 deploy verified.

**Steps**:
1. ⏳ Đợi deploy commit `ce0f0e8` xong → verify `/api/versions` work
2. Em chạy Issue #16 — ERP cutover validation (15-30 phút)
3. Tạo feedback từ ERP NV CUS check → verify lưu `data/feedback.jsonl`
4. Cleanup Issue #17: move domain `hs-kb.uythacnhapkhau.com` từ `hs-knowledge-api` sang `hs-code-api-1-ywbe`
5. Delete project `hs-knowledge-api` Vercel
6. Archive GitHub repo `hs-knowledge-api`

→ Hết ngày: ERP live qua `hs-code-api-1`, cleanup xong.

### Hướng B — Đẩy chất lượng AI (đa số GIR)

3/3 goal đạt nhưng độ chính xác `/api/suggest` mới ~80%. Để lên 95% theo chuẩn WCO, cần GIR full:

**Priority sub-issues (theo impact accuracy)**:

| Issue | Impact | Effort | ROI |
|---|---|---|---|
| **#18** GIR-1+6 — 5-level notes | High (LLM có context chương/heading) | 8h+curation | 🔥🔥🔥 |
| **#19** GIR-2/3 — Specificity ranking | High (đúng prefer mã cụ thể) | 12h+$25 | 🔥🔥🔥 |
| **#20** GIR-4 — Precedent embedding | Medium (case khó dùng precedent) | 10h | 🔥🔥 |
| **#21** GIR-6 — Indentation tree | Low (mostly UI) | 6h | 🔥 |

### Hướng C — Mở rộng coverage (Sprint 2 UI + ML)

Theo Roadmap V2, sau Sprint 1 data là Sprint 2 Operator UI + Sprint 3 ML Loop:

- #8 Admin Dashboard
- #9 HS Browse + Detail
- #10 Editor UI
- #11 Feedback Review Queue
- #12 ML Confidence Tracking
- #13 Prompt Evolution

---

## 🎯 Em đề xuất ưu tiên

**Combination A → B → C:**

### Tuần này (sau khi GOAL đạt today)
1. **Today**: Hướng A — ERP cutover + cleanup. Goal HOÀN TOÀN production-ready.
2. **Tuần này**: Hướng B Issue #18 + #19 — đẩy AI accuracy từ ~80% → ~92%.

### Tháng tới
3. **Tuần 2-3**: Hướng B Issue #20 (precedent embedding).
4. **Tuần 3-4**: Hướng C Issue #8 + #11 (Admin Dashboard + Feedback Review Queue).

### Quý sau
5. Hướng C còn lại: Editor UI (#10), ML Loop (#12, #13).

**Lý do priority này**:
- A first vì ERP đang chờ tích hợp → unblock workflow vận hành thật
- B next vì GIR chính là yêu cầu pháp lý — nếu Hải quan kiểm tra, phải audit-trail được rule áp dụng
- C cuối vì UI nice-to-have, CEO + Claude vận hành OK qua CLI/API

---

## 🚨 Issues mới cần raise sau khi smoke test

Em phát hiện 3 gap mới qua smoke test này:

### Issue #22 — Verify `/api/versions` endpoint deploy + smoke test

Commit `ce0f0e8` đã code `api/versions.js`, `api/version.js`, `api/version/diff.js` + scripts + data nhưng production trả 404. Có thể:
- Vercel auto-deploy không trigger
- Hoặc commit chưa push (gh shows pushed)
- Hoặc Vercel function nested path `api/version/diff.js` không match pattern

**Acceptance**: 3 endpoint trả 200 + sample test verified.

### Issue #23 — Search behavior với mô tả ERP thực tế

Em test `q=8517` OK 20 results, nhưng `q=điện thoại` URL-encoded fail. Cần:
- Test loạt sample mô tả ERP NV thực tế gõ (vd "máy giặt Toshiba 8kg", "tủ lạnh side-by-side LG")
- Tune `lib/search-utils.js` token scoring nếu cần
- Build test fixture `tests/search-cases.json` chạy regression

### Issue #24 — Audit-trail GIR rule path trong `/api/suggest`

Hiện `/api/suggest` response có `suggestions[i].reasoning` text nhưng KHÔNG có `girRulesApplied[]` structured (theo design GIR doc).

Add:
```json
"suggestions": [
  {
    "hsCode": "85171300",
    "confidence": 98,
    "reasoning": "...",
    "girRulesApplied": ["GIR-1 (chapter 85)", "GIR-3a (specificity 85)", "GIR-6 (subheading 8517.13)"],
    "evidenceTrace": {
      "matchedNotes": ["8517 includes smartphones"],
      "matchedPrecedents": ["TB 3581/TB-TCHQ 2022"],
      "matchedConflicts": []
    }
  }
]
```

→ ERP UI có thể hiển thị "Tại sao mã này" cho NV review.

---

## 📋 Updated issue tracker

| Status | Count |
|---|---|
| ✅ Closed | 3 (#3, #4, #15) |
| 🟡 Open | 16 (incl. meta #14) |
| 🆕 Sẽ open | 3 (#22, #23, #24) |
| **Total** | **22 issues + 1 meta** |

---

## Insight về anh code velocity

Anh đã chứng minh code 5 issues trong 4 giờ. Nếu pace giữ:
- Hướng A: hết hôm nay (em làm cutover)
- Hướng B + Issue #18+19: 1-2 ngày
- Hướng C Sprint 2 UI: 1 tuần

→ ERP production-grade tra HS đầy đủ GIR audit-trail: **1 tuần nữa**.

Sau đó tập trung dataset training để accuracy lên 95%+.
