# Data Enrichment Report — 2026-04-06

## Summary

Scheduled review of the HS Knowledge API data pipeline. Identified and fixed 2 bugs, rebuilt indexes with +50% more entries.

---

## Current Data State

| Metric | Value |
|--------|-------|
| Total HS codes | 11,871 |
| Chapters | 97 (missing: 77) |
| Risk: GREEN | 3,943 (33.2%) |
| Risk: YELLOW | 5,151 (43.4%) |
| Risk: ORANGE | 2,288 (19.3%) |
| Risk: RED | 489 (4.1%) |

### Layer Completeness (list fields)

| Field | Populated | Empty | Coverage |
|-------|-----------|-------|----------|
| bao_gom | 8,203 | 3,668 | 69.1% |
| khong_bao_gom | 7,303 | 4,568 | 61.5% |
| loai_tru | 7,938 | 3,933 | 66.9% |
| phan_biet | 390 | 11,481 | 3.3% |
| dieu_kien_bat_buoc | 0 | 11,871 | 0.0% |

---

## Bugs Found & Fixed

### BUG 1: bao_gom_index overly strict filter (FIXED)

**File:** `build_indexes.py`
**Issue:** Filter `es[0] == '('` only indexed bao_gom entries starting with parentheses, excluding 2,748 valid entries (33.5% of all bao_gom data).
**Fix:** Removed the `es[0] == '('` condition, keeping only `len(es) > 5`.
**Impact:** bao_gom_index grew from 5,455 to 8,203 entries (+50.4%).

### BUG 2: Search API missing diacritics normalization (FIXED)

**File:** `pages/api/search.js`
**Issue:** `multiKeywordMatch()` only compared lowercase text without stripping Vietnamese diacritics. Searching "ban chai" would NOT match "bàn chải".
**Fix:** Added `removeDiacritics()` helper (matching the one in `api/kg_search.js`) and updated all 4 search sources to use diacritics-insensitive matching.
**Impact:** Non-diacritics queries now correctly match Vietnamese text across all search sources (bieu_thue, tb_tchq, bao_gom, conflict).

---

## Index Rebuild Results

| Index | Before | After | Change |
|-------|--------|-------|--------|
| bao_gom_index | 5,455 entries (6.3 MB) | 8,203 entries (9.8 MB) | +50.4% |
| tb_tchq_index | 529 entries | 529 entries | unchanged |
| conflict_index | 57 entries | 57 entries | unchanged |
| kg_index | 11,871 entries | 11,871 entries | unchanged |

Also fixed encoding issue in `build_indexes.py` (added `sys.stdout.reconfigure(encoding='utf-8')`).

---

## Merge Pipeline Status

All extracted data from the enrichment parser is fully merged into the KG:
- `legal_layers_tap1.json` through `tap5.json`: merged
- `legal_layers_2022.json`: merged
- `fix_chapter_44/45/46/54/56/90.json`: merged
- No pending unmerged data found

---

## Remaining Data Gaps (require new source data)

1. **Chapter 77**: Missing entirely (no PDF source)
2. **Chapter 98**: 457 codes with no legal enrichment (no source material)
3. **phan_biet**: Only 3.3% populated — needs targeted extraction
4. **dieu_kien_bat_buoc**: 0% populated — needs regulatory source
5. **English translations**: 0% — not yet in pipeline

---

## Action Required (post-deploy)

- Deploy to Vercel to activate the search diacritics fix and updated bao_gom_index
