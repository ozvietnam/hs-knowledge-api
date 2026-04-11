import json

def validate_record(record, existing_ids=None):
    """Validate TB-TCHQ record."""
    if existing_ids is None:
        existing_ids = set()

    errors = []
    required_keys = ['so_hieu', 'ngay_ban_hanh', 'hang_hoa', 'phan_loai', 'url']

    for key in required_keys:
        if key not in record or not record[key]:
            errors.append(f"Missing {key}")

    hs_code = record['phan_loai'].get('ma_hs')
    if hs_code and len(hs_code) != 8:
        errors.append("Invalid HS code format")

    so_hieu = record.get('so_hieu')
    if so_hieu in existing_ids:
        errors.append(f"Duplicate so_hieu: {so_hieu}")

    return not bool(errors), errors
import os

def merge_into_kg(records, kg_dir):
    """Merge records into knowledge graph."""
    stats = {'merged': 0, 'skipped': 0, 'errors': []}

    for record in records:
        so_hieu = record['so_hieu']
        hs_code = record['phan_loai']['ma_hs'][:2]  # Chapter code
        chapter_file = os.path.join(kg_dir, f'chapter_{hs_code:02d}.json')

        if not os.path.exists(chapter_file):
            with open(chapter_file, 'w') as f:
                json.dump({}, f)

        with open(chapter_file, 'r+') as f:
            data = json.load(f)
            chapter_data = data.get(hs_code, {'legal_layer': {'case_history': []}})
            case_history = chapter_data['legal_layer']['case_history']

            if any(item['so_hieu'] == so_hieu for item in case_history):
                stats['skipped'] += 1
                continue

            case_history.append(record)
            chapter_data['legal_layer']['case_history'] = case_history
            data[hs_code] = chapter_data

            f.seek(0)
            json.dump(data, f, indent=4)
            f.truncate()

        stats['merged'] += 1

    return stats
