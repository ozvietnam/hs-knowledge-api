#!/usr/bin/env python3
"""
Phase 3.1b — Enrich Layer 8 bằng vector matching
- 3,164 TB-TCHQ records không có ma_hs
- Dùng all-minilm để embed product description
- So khớp với vector_embeddings.json (11,871 HS codes)
- Auto-assign nếu similarity >= 0.85
- Ghi "suggested" nếu 0.70 <= similarity < 0.85
"""

import json
import os
import math
import urllib.request
import urllib.error

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TB_TCHQ_FILE = os.path.join(BASE_DIR, 'data', 'tb_tchq', 'tb_tchq_full.json')
KG_DIR = os.path.join(BASE_DIR, 'data', 'kg')
EMBEDDINGS_FILE = os.path.join(BASE_DIR, 'data', 'vector_embeddings.json')

OLLAMA_URL = 'http://localhost:11434/api/embed'
EMBED_MODEL = 'all-minilm:l6-v2'

AUTO_ASSIGN_THRESHOLD = 0.85
SUGGEST_THRESHOLD = 0.70

def get_embedding(text):
    """Get embedding from Ollama."""
    payload = json.dumps({'model': EMBED_MODEL, 'input': text[:300]}).encode()
    req = urllib.request.Request(OLLAMA_URL, data=payload,
                                  headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            return data['embeddings'][0]
    except Exception as e:
        return None

def cosine_similarity(a, b):
    if not a or not b or len(a) != len(b):
        return 0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    denom = mag_a * mag_b
    return dot / denom if denom else 0

def find_best_match(query_emb, embeddings, top_k=3):
    """Find top-k HS codes by cosine similarity."""
    scores = []
    for hs_code, emb in embeddings.items():
        sim = cosine_similarity(query_emb, emb)
        if sim >= SUGGEST_THRESHOLD:
            scores.append((hs_code, sim))
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:top_k]

def load_kg_chapter(ch_num):
    ch = str(ch_num).zfill(2)
    kg_file = os.path.join(KG_DIR, f'chapter_{ch}.json')
    if not os.path.exists(kg_file):
        return None, kg_file
    with open(kg_file, encoding='utf-8') as f:
        return json.load(f), kg_file

def save_kg_chapter(kg_data, kg_file):
    with open(kg_file, 'w', encoding='utf-8') as f:
        json.dump(kg_data, f, ensure_ascii=False, separators=(',', ':'))

def main():
    print("=== Phase 3.1b — Vector Match for TB-TCHQ no-HS records ===")
    print()

    # Load embeddings (60MB, ~2s)
    print("1. Loading vector embeddings (60MB)...")
    with open(EMBEDDINGS_FILE, encoding='utf-8') as f:
        embeddings = json.load(f)
    print(f"   Loaded {len(embeddings)} HS code embeddings")

    # Load all KG chapters into memory
    print("2. Loading KG chapters...")
    kg_all = {}
    kg_files = {}
    for ch_num in range(1, 99):
        data, fpath = load_kg_chapter(ch_num)
        if data:
            kg_all.update(data)
            for hs in data:
                kg_files[hs] = fpath

    print(f"   Loaded {len(kg_all)} HS codes from KG")

    # Load TB-TCHQ records without HS
    print("3. Filtering no-HS TB-TCHQ records...")
    with open(TB_TCHQ_FILE, encoding='utf-8') as f:
        all_records = json.load(f)

    no_hs_records = [r for r in all_records
                     if not r.get('phan_loai', {}).get('ma_hs', '').strip()]
    print(f"   Found {len(no_hs_records)} records without HS code")

    # Process each record
    print()
    print("4. Vector matching (may take a few minutes)...")
    stats = {'auto': 0, 'suggested': 0, 'no_match': 0, 'no_embed': 0}
    matched_cases = {}  # hs_code -> list of cases

    for i, rec in enumerate(no_hs_records):
        if i % 100 == 0:
            print(f"   [{i}/{len(no_hs_records)}] auto={stats['auto']} suggest={stats['suggested']} no_match={stats['no_match']}")

        # Build query text from available fields
        hang_hoa = rec.get('hang_hoa', {})
        parts = [
            hang_hoa.get('ten_thuong_mai', ''),
            hang_hoa.get('ten_ky_thuat', ''),
            hang_hoa.get('cong_dung', ''),
            hang_hoa.get('mo_ta', ''),
        ]
        query_text = ' '.join(p for p in parts if p and len(p) > 3).strip()

        if len(query_text) < 5:
            stats['no_embed'] += 1
            continue

        # Get embedding
        query_emb = get_embedding(query_text)
        if not query_emb:
            stats['no_embed'] += 1
            continue

        # Find best matches
        matches = find_best_match(query_emb, embeddings)
        if not matches:
            stats['no_match'] += 1
            continue

        best_hs, best_sim = matches[0]

        # Build case record
        tranh_chap = rec.get('tranh_chap', {})
        case = {
            'so_hieu': rec.get('so_hieu', ''),
            'ngay': rec.get('ngay_ban_hanh', ''),
            'hang_hoa': query_text[:150],
            'noi_dung': (rec.get('noi_dung_tom_tat', '') or '')[:300],
            'co_tranh_chap': tranh_chap.get('co_tranh_chap', False),
            'ma_hs_ban_dau': tranh_chap.get('ma_hs_ban_dau', ''),
            'url': rec.get('url', ''),
            'vector_matched': True,
            'match_confidence': round(best_sim, 4),
            'match_type': 'auto' if best_sim >= AUTO_ASSIGN_THRESHOLD else 'suggested'
        }

        if best_sim >= AUTO_ASSIGN_THRESHOLD:
            stats['auto'] += 1
        else:
            stats['suggested'] += 1

        if best_hs not in matched_cases:
            matched_cases[best_hs] = []
        matched_cases[best_hs].append(case)

    print(f"   [{len(no_hs_records)}/{len(no_hs_records)}] Done!")
    print()
    print(f"   Auto-assigned (>={AUTO_ASSIGN_THRESHOLD:.0%}): {stats['auto']}")
    print(f"   Suggested (>={SUGGEST_THRESHOLD:.0%}): {stats['suggested']}")
    print(f"   No match: {stats['no_match']}")
    print(f"   No embed (empty text): {stats['no_embed']}")
    print(f"   Unique HS codes enriched: {len(matched_cases)}")

    # Merge into KG
    print()
    print("5. Writing to KG chapters...")
    chapters_updated = set()
    codes_enriched = 0
    new_cases_added = 0

    # Load chapters that need updating
    chapters_to_update = {}
    for hs_code in matched_cases:
        if hs_code in kg_files:
            fpath = kg_files[hs_code]
            if fpath not in chapters_to_update:
                with open(fpath, encoding='utf-8') as f:
                    chapters_to_update[fpath] = json.load(f)

    # Add vector-matched cases
    for hs_code, new_cases in matched_cases.items():
        if hs_code not in kg_all:
            continue
        fpath = kg_files[hs_code]
        if fpath not in chapters_to_update:
            continue

        item = chapters_to_update[fpath][hs_code]
        if 'legal_layer' not in item:
            item['legal_layer'] = {}

        existing = item['legal_layer'].get('case_history', [])
        existing_ids = {c['so_hieu'] for c in existing}

        added = 0
        for c in new_cases:
            if c['so_hieu'] not in existing_ids:
                existing.append(c)
                added += 1

        if added > 0:
            item['legal_layer']['case_history'] = sorted(
                existing, key=lambda x: x.get('ngay', ''), reverse=True
            )
            codes_enriched += 1
            new_cases_added += added
            chapters_updated.add(fpath)

    # Save updated chapters
    for fpath, data in chapters_to_update.items():
        if fpath in chapters_updated:
            with open(fpath, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

    print(f"   ✅ Chapters saved: {len(chapters_updated)}")
    print(f"   ✅ HS codes enriched: {codes_enriched}")
    print(f"   ✅ New cases added: {new_cases_added}")

    # Final coverage count
    total_with_history = 0
    for ch_num in range(1, 99):
        ch = str(ch_num).zfill(2)
        fp = os.path.join(KG_DIR, f'chapter_{ch}.json')
        if not os.path.exists(fp):
            continue
        with open(fp, encoding='utf-8') as f:
            d = json.load(f)
        total_with_history += sum(
            1 for v in d.values()
            if v.get('legal_layer', {}).get('case_history')
        )

    coverage_pct = (total_with_history / 11871) * 100
    print()
    print(f"   📊 Final Layer 8 coverage: {total_with_history} codes ({coverage_pct:.1f}%)")

    # Save report
    report_dir = os.path.expanduser('~/Desktop/work/axit/report')
    report = f"""# Phase 3.1b — Vector Match Report
Date: 2026-04-10

## Vector Matching Results
- Records processed: {len(no_hs_records)}
- Auto-assigned (>={AUTO_ASSIGN_THRESHOLD:.0%}): {stats['auto']}
- Suggested (>={SUGGEST_THRESHOLD:.0%}): {stats['suggested']}
- No match: {stats['no_match']}
- No embed text: {stats['no_embed']}
- Unique HS codes with new cases: {len(matched_cases)}

## KG Update
- Chapters updated: {len(chapters_updated)}
- HS codes enriched: {codes_enriched}
- New cases added: {new_cases_added}

## Final Layer 8 Coverage
- Total HS codes with case_history: {total_with_history} / 11,871
- Coverage: {coverage_pct:.1f}%
- Previous (Phase 3.1): 442 codes (3.7%)
"""
    with open(os.path.join(report_dir, '2026-04-10_phase3_1b_vector_match.md'), 'w') as f:
        f.write(report)
    print(f"   📄 Report saved.")

if __name__ == '__main__':
    main()
