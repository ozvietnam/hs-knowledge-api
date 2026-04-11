"""
Data Pipeline — validate + merge TB-TCHQ records vào KG.
"""
import json
import os
import re


def validate_record(record, existing_ids=None):
    errors = []

    if not record.get('so_hieu'):
        errors.append("Missing so_hieu")

    if existing_ids and record.get('so_hieu') in existing_ids:
        errors.append(f"Duplicate so_hieu: {record.get('so_hieu')}")

    hs = record.get('phan_loai', {}).get('ma_hs', '')
    if hs and not re.fullmatch(r'\d{8}', hs):
        errors.append(f"Invalid HS format: {hs}")

    return (len(errors) == 0), errors


def merge_into_kg(records, kg_dir):
    stats = {'merged': 0, 'skipped': 0, 'errors': []}

    if not records:
        return stats

    # Group records by chapter (first 2 digits of HS code)
    by_chapter = {}
    for rec in records:
        hs = rec.get('phan_loai', {}).get('ma_hs', '')
        if not hs or len(hs) < 2:
            stats['skipped'] += 1
            continue
        ch = int(hs[:2])
        by_chapter.setdefault(ch, []).append(rec)

    for ch_num, recs in by_chapter.items():
        ch = str(ch_num).zfill(2)
        fp = os.path.join(kg_dir, f'chapter_{ch}.json')

        if not os.path.exists(fp):
            stats['skipped'] += len(recs)
            continue

        with open(fp, encoding='utf-8') as f:
            data = json.load(f)

        changed = False
        for rec in recs:
            hs = rec['phan_loai']['ma_hs']
            if hs not in data:
                stats['skipped'] += 1
                continue

            item = data[hs]
            ll = item.setdefault('legal_layer', {})
            history = ll.get('case_history', [])
            existing_ids = {c['so_hieu'] for c in history}

            if rec['so_hieu'] in existing_ids:
                stats['skipped'] += 1
                continue

            history.append({
                'so_hieu': rec.get('so_hieu', ''),
                'ngay': rec.get('ngay_ban_hanh', ''),
                'hang_hoa': rec.get('hang_hoa', {}).get('ten_thuong_mai', ''),
                'noi_dung': (rec.get('noi_dung_tom_tat') or '')[:300],
                'co_tranh_chap': rec.get('tranh_chap', {}).get('co_tranh_chap', False),
                'url': rec.get('url', ''),
            })
            ll['case_history'] = sorted(history, key=lambda x: x.get('ngay', ''), reverse=True)
            stats['merged'] += 1
            changed = True

        if changed:
            with open(fp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

    return stats
