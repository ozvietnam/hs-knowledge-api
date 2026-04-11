#!/usr/bin/env python3
"""
Phase 3.1 — Merge TB-TCHQ precedents into Layer 8 (case_history)
Source: /data/tb_tchq/tb_tchq_full.json (4,390 records)
Target: /data/kg/chapter_XX.json -> legal_layer.case_history[]
"""

import json
import os
import sys
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TB_TCHQ_FILE = os.path.join(BASE_DIR, 'data', 'tb_tchq', 'tb_tchq_full.json')
KG_DIR = os.path.join(BASE_DIR, 'data', 'kg')

def load_tb_tchq():
    with open(TB_TCHQ_FILE, encoding='utf-8') as f:
        return json.load(f)

def build_hs_map(records):
    """Group TB-TCHQ records by HS code (8-digit)."""
    hs_map = defaultdict(list)
    skipped = 0

    for rec in records:
        ma_hs = rec.get('phan_loai', {}).get('ma_hs', '').strip()
        if not ma_hs or len(ma_hs) < 6:
            skipped += 1
            continue

        # Normalize to 8-digit
        ma_hs = ma_hs.ljust(8, '0')[:8]

        hang_hoa = rec.get('hang_hoa', {})
        tranh_chap = rec.get('tranh_chap', {})

        case = {
            'so_hieu': rec.get('so_hieu', ''),
            'ngay': rec.get('ngay_ban_hanh', ''),
            'hang_hoa': hang_hoa.get('ten_thuong_mai', '') or hang_hoa.get('ten_ky_thuat', ''),
            'noi_dung': (rec.get('noi_dung_tom_tat', '') or '')[:300],
            'co_tranh_chap': tranh_chap.get('co_tranh_chap', False),
            'ma_hs_ban_dau': tranh_chap.get('ma_hs_ban_dau', ''),
            'url': rec.get('url', '')
        }
        hs_map[ma_hs].append(case)

    print(f"  TB-TCHQ records with valid HS: {sum(len(v) for v in hs_map.values())}")
    print(f"  Skipped (no HS code): {skipped}")
    print(f"  Unique HS codes: {len(hs_map)}")
    return hs_map

def merge_into_kg(hs_map):
    stats = {
        'chapters_processed': 0,
        'codes_enriched': 0,
        'codes_not_found': 0,
        'cases_merged': 0,
    }

    # Track which HS codes were actually found in KG
    matched_hs = set()

    for ch_num in range(1, 99):
        ch = str(ch_num).zfill(2)
        kg_file = os.path.join(KG_DIR, f'chapter_{ch}.json')
        if not os.path.exists(kg_file):
            continue

        with open(kg_file, encoding='utf-8') as f:
            kg_data = json.load(f)

        changed = False

        for hs_code, item in kg_data.items():
            if hs_code in hs_map:
                cases = hs_map[hs_code]
                # Sort by date descending (newest first)
                cases_sorted = sorted(cases, key=lambda x: x.get('ngay', ''), reverse=True)

                # Add/update case_history in legal_layer
                if 'legal_layer' not in item:
                    item['legal_layer'] = {}

                item['legal_layer']['case_history'] = cases_sorted

                matched_hs.add(hs_code)
                stats['codes_enriched'] += 1
                stats['cases_merged'] += len(cases)
                changed = True

        if changed:
            with open(kg_file, 'w', encoding='utf-8') as f:
                json.dump(kg_data, f, ensure_ascii=False, separators=(',', ':'))
            stats['chapters_processed'] += 1

        if ch_num % 10 == 0:
            print(f"  Chapter {ch}: processed (enriched so far: {stats['codes_enriched']})")

    # Count codes in hs_map not found in KG
    stats['codes_not_found'] = len(set(hs_map.keys()) - matched_hs)
    return stats

def generate_report(stats, total_records):
    total_kg_codes = 11871
    coverage_pct = (stats['codes_enriched'] / total_kg_codes) * 100

    report = f"""# Phase 3.1 — Layer 8 Merge Report
Date: 2026-04-10
Source: tb_tchq_full.json ({total_records} records)

## Results
- Chapters updated: {stats['chapters_processed']}
- HS codes enriched: {stats['codes_enriched']} / {total_kg_codes} ({coverage_pct:.1f}%)
- Total cases merged: {stats['cases_merged']}
- TB-TCHQ codes not in KG: {stats['codes_not_found']}

## Coverage
- Layer 8 (case_history): {coverage_pct:.1f}% ({stats['codes_enriched']} codes)
- Previous coverage: 4.2% (498 codes via precedent.js)
- Improvement: +{coverage_pct - 4.2:.1f}%

## Data Schema
```json
"legal_layer": {{
  "case_history": [
    {{
      "so_hieu": "4967/TB-TCHQ",
      "ngay": "12/09/2025",
      "hang_hoa": "Product name",
      "noi_dung": "Summary (300 chars)",
      "co_tranh_chap": false,
      "ma_hs_ban_dau": "",
      "url": "..."
    }}
  ]
}}
```

## Status
✅ Layer 8 merge complete
"""
    return report

def main():
    print("=== Phase 3.1 — Layer 8 Case History Merge ===")
    print()

    print("1. Loading TB-TCHQ data...")
    records = load_tb_tchq()
    print(f"   Total records: {len(records)}")

    print()
    print("2. Building HS code map...")
    hs_map = build_hs_map(records)

    print()
    print("3. Merging into KG chapters...")
    stats = merge_into_kg(hs_map)

    print()
    print("4. Results:")
    print(f"   ✅ Chapters updated: {stats['chapters_processed']}")
    print(f"   ✅ HS codes with case history: {stats['codes_enriched']}")
    print(f"   ✅ Total cases merged: {stats['cases_merged']}")
    print(f"   ⚠️  TB-TCHQ codes not in KG: {stats['codes_not_found']}")

    total = 11871
    pct = (stats['codes_enriched'] / total) * 100
    print(f"   📊 Layer 8 coverage: {pct:.1f}% (was 4.2%)")

    # Save report
    report_dir = os.path.expanduser('~/Desktop/work/axit/report')
    os.makedirs(report_dir, exist_ok=True)
    report_path = os.path.join(report_dir, '2026-04-10_phase3_1_layer8_done.md')
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(generate_report(stats, len(records)))
    print(f"\n   📄 Report saved: {report_path}")

if __name__ == '__main__':
    main()
