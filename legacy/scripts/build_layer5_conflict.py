#!/usr/bin/env python3
"""
Layer 5 — Conflict & Gap Detection
Phát hiện xung đột và khoảng trống chính sách từ data hiện có.

Các loại xung đột được phát hiện:
  C1 - Multi-agency conflict: nhiều bộ cùng quản lý, có thể chồng chéo
  C2 - KTCN overlap: cùng 1 mã có nhiều loại kiểm tra cùng cơ quan
  C3 - Policy gap: có chinh_sach nhưng thiếu KTCN cụ thể
  C4 - Rate anomaly: thuế suất bất thường (MFN > 50%, hoặc FTA = 0 mà MFN cao)
  C5 - Missing chu_giai: có KTCN nhưng không có giải thích pháp lý
"""

import json
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KG_DIR = os.path.join(BASE_DIR, 'data', 'kg')

# Agency codes có thể chồng chéo
OVERLAPPING_AGENCIES = {
    frozenset(['BNNPTNT', 'BYT']): 'Chồng chéo BNNPTNT-BYT (thực phẩm/nông sản)',
    frozenset(['BCT', 'BKHCN']): 'Chồng chéo BCT-BKHCN (hàng công nghiệp/KH)',
    frozenset(['BNNPTNT', 'BTNMT']): 'Chồng chéo BNNPTNT-BTNMT (môi trường/nông nghiệp)',
    frozenset(['BCA', 'BQP']): 'Chồng chéo BCA-BQP (an ninh/quốc phòng)',
}

def detect_conflicts(hs_code, item):
    """Phát hiện tất cả xung đột cho 1 HS code."""
    conflicts = []
    fl = item.get('fact_layer', {})
    ll = item.get('legal_layer', {})
    tt = ll.get('tinh_chat', {})
    rates = fl.get('rates', {})

    agencies = tt.get('agency_authority', [])
    ktcn_list = tt.get('ktcn', [])
    chinh_sach = fl.get('chinh_sach', '')

    # C1 - Multi-agency conflict
    if len(agencies) >= 2:
        agency_set = frozenset(agencies)
        for pair, desc in OVERLAPPING_AGENCIES.items():
            if pair.issubset(agency_set):
                conflicts.append({
                    'type': 'C1',
                    'severity': 'HIGH',
                    'desc': desc,
                    'detail': f'Agencies: {", ".join(agencies)}'
                })
                break
        if len(agencies) >= 3:
            conflicts.append({
                'type': 'C1',
                'severity': 'MEDIUM',
                'desc': f'Nhiều bộ quản lý ({len(agencies)} bộ)',
                'detail': f'Agencies: {", ".join(agencies)}'
            })

    # C2 - KTCN overlap: cùng cơ quan, nhiều loại kiểm tra
    if len(ktcn_list) >= 2:
        by_agency = {}
        for k in ktcn_list:
            ag = k.get('co_quan', '')
            if ag:
                by_agency.setdefault(ag, []).append(k.get('loai', ''))
        for ag, types in by_agency.items():
            if len(types) >= 2:
                conflicts.append({
                    'type': 'C2',
                    'severity': 'MEDIUM',
                    'desc': f'{ag} yêu cầu {len(types)} loại kiểm tra khác nhau',
                    'detail': f'Types: {", ".join(str(t) for t in types if t)}'
                })

    # C3 - Policy gap: có chinh_sach nhưng thiếu KTCN
    if chinh_sach and not ktcn_list:
        conflicts.append({
            'type': 'C3',
            'severity': 'LOW',
            'desc': 'Có chính sách nhưng thiếu thông tin KTCN cụ thể',
            'detail': chinh_sach[:150]
        })

    # C4 - Rate anomaly
    try:
        mfn = float(rates.get('mfn', 0) or 0)
        tt_rate = float(rates.get('tt', 0) or 0)
        acfta = rates.get('acfta')
        evfta = rates.get('evfta')

        if mfn > 50:
            conflicts.append({
                'type': 'C4',
                'severity': 'LOW',
                'desc': f'Thuế MFN cao bất thường: {mfn}%',
                'detail': f'MFN={mfn}, TT={tt_rate}'
            })

        # FTA = 0 nhưng MFN cao (>20%) → cần chú ý
        fta_zero = (acfta == '0' or evfta == '0')
        if fta_zero and mfn >= 20:
            conflicts.append({
                'type': 'C4',
                'severity': 'MEDIUM',
                'desc': f'FTA=0% nhưng MFN={mfn}% (chênh lệch lớn)',
                'detail': f'ACFTA={acfta}, EVFTA={evfta}, MFN={mfn}'
            })
    except (ValueError, TypeError):
        pass

    # C5 - Missing chu_giai
    if ktcn_list and not ll.get('chu_giai_nhom'):
        conflicts.append({
            'type': 'C5',
            'severity': 'LOW',
            'desc': 'Có yêu cầu KTCN nhưng thiếu chú giải pháp lý',
            'detail': f'{len(ktcn_list)} KTCN requirements'
        })

    return conflicts

def main():
    print("=== Layer 5 — Conflict & Gap Detection ===")
    print()

    total_codes = 0
    total_conflicts = 0
    codes_with_conflict = 0
    conflict_types = {'C1': 0, 'C2': 0, 'C3': 0, 'C4': 0, 'C5': 0}
    severity_counts = {'HIGH': 0, 'MEDIUM': 0, 'LOW': 0}

    for ch_num in range(1, 99):
        ch = str(ch_num).zfill(2)
        fp = os.path.join(KG_DIR, f'chapter_{ch}.json')
        if not os.path.exists(fp):
            continue

        with open(fp, encoding='utf-8') as f:
            data = json.load(f)

        changed = False

        for hs_code, item in data.items():
            total_codes += 1
            conflicts = detect_conflicts(hs_code, item)

            if conflicts:
                ll = item.setdefault('legal_layer', {})
                ll['conflict'] = {
                    'has_conflict': True,
                    'count': len(conflicts),
                    'items': conflicts
                }
                codes_with_conflict += 1
                total_conflicts += len(conflicts)
                for c in conflicts:
                    conflict_types[c['type']] += 1
                    severity_counts[c['severity']] += 1
                changed = True
            else:
                # Clear old conflict data if no longer detected
                if item.get('legal_layer', {}).get('conflict'):
                    item['legal_layer']['conflict'] = {'has_conflict': False, 'count': 0, 'items': []}
                    changed = True

        if changed:
            with open(fp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

        if ch_num % 20 == 0:
            print(f"  Chapter {ch}: processed (conflicts found so far: {codes_with_conflict})")

    coverage_pct = codes_with_conflict / total_codes * 100

    print()
    print(f"=== KẾT QUẢ ===")
    print(f"Tổng HS codes:          {total_codes:>6}")
    print(f"Codes có conflict:      {codes_with_conflict:>6} ({coverage_pct:.1f}%)")
    print(f"Tổng conflict entries:  {total_conflicts:>6}")
    print()
    print("--- Phân loại xung đột ---")
    type_desc = {
        'C1': 'Multi-agency (chồng chéo bộ)',
        'C2': 'KTCN overlap (trùng kiểm tra)',
        'C3': 'Policy gap (thiếu KTCN)',
        'C4': 'Rate anomaly (thuế bất thường)',
        'C5': 'Missing chu_giai (thiếu chú giải)',
    }
    for ct, n in sorted(conflict_types.items(), key=lambda x: -x[1]):
        print(f"  {ct} - {type_desc[ct]}: {n}")
    print()
    print("--- Severity ---")
    for sev, n in sorted(severity_counts.items(), key=lambda x: -x[1]):
        print(f"  {sev}: {n}")

    # Save report
    report_dir = os.path.expanduser('~/Desktop/work/axit/report')
    os.makedirs(report_dir, exist_ok=True)
    report = f"""# Layer 5 — Conflict Detection Report
Date: 2026-04-10

## Results
- Total HS codes: {total_codes}
- Codes with conflicts: {codes_with_conflict} ({coverage_pct:.1f}%)
- Total conflict entries: {total_conflicts}

## Conflict Types
| Type | Mô tả | Count |
|------|-------|-------|
"""
    for ct, n in sorted(conflict_types.items(), key=lambda x: -x[1]):
        report += f"| {ct} | {type_desc[ct]} | {n} |\n"

    report += f"""
## Severity
| Severity | Count |
|----------|-------|
| HIGH | {severity_counts['HIGH']} |
| MEDIUM | {severity_counts['MEDIUM']} |
| LOW | {severity_counts['LOW']} |

## Status
✅ Layer 5 (conflict) built from existing data
Coverage: {coverage_pct:.1f}% ({codes_with_conflict} codes)
"""
    with open(os.path.join(report_dir, '2026-04-10_layer5_conflict_done.md'), 'w') as f:
        f.write(report)
    print(f"\n📄 Report saved.")
    print(f"✅ Layer 5 DONE — {codes_with_conflict} codes ({coverage_pct:.1f}% coverage)")

if __name__ == '__main__':
    main()
