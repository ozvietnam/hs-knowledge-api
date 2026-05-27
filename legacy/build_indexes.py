import json, glob, os, sys
sys.stdout.reconfigure(encoding='utf-8')

base = r'D:\CLAUDE DATA SHARE\hs-knowledge-api\public\kg'
chapters = sorted(glob.glob(os.path.join(base, 'chapter_*.json')))
print(f'Found {len(chapters)} chapter files')

tb_tchq_index = []
bao_gom_index = []
conflict_index = []

for f in chapters:
    with open(f, encoding='utf-8') as fh:
        data = json.load(fh)
    for hs_code, record in data.items():
        prec = record.get('precedent_layer', {})
        if prec:
            for tb in prec.get('tb_tchq', []):
                tb_tchq_index.append({
                    'hs': hs_code,
                    'so_hieu': tb.get('so_hieu',''),
                    'ten_sp': tb.get('ten_san_pham',''),
                    'ten_kt': tb.get('ten_ky_thuat',''),
                    'ma_hs': tb.get('ma_hs',''),
                    'nam': tb.get('nam',''),
                })

        ll = record.get('legal_layer', {})
        if ll:
            bg_list = ll.get('bao_gom', [])
            if isinstance(bg_list, list) and bg_list:
                items = []
                for e in bg_list:
                    es = e.strip() if isinstance(e, str) else ''
                    if len(es) > 5:
                        items.append(es[:150])
                if items:
                    bao_gom_index.append({'hs': hs_code, 't': ' | '.join(items)})

        conf = record.get('conflict_layer', {})
        if conf:
            risk = conf.get('risk_map', {})
            if risk:
                ma_nham = risk.get('ma_de_nham', [])
                mau_thuan = conf.get('mau_thuan', [])
                if ma_nham or mau_thuan:
                    conflict_index.append({
                        'hs': hs_code,
                        'muc_rui_ro': risk.get('muc_rui_ro', ''),
                        'ma_de_nham': ma_nham,
                        'ly_do': risk.get('ly_do_tranh_chap_thuong_gap', []),
                        'mau_thuan': [str(m)[:200] for m in mau_thuan[:3]],
                    })

print(f'tb_tchq: {len(tb_tchq_index)}')
print(f'bao_gom: {len(bao_gom_index)}')
print(f'conflict: {len(conflict_index)}')

# Save
for name, idx_data in [('tb_tchq_index', tb_tchq_index), ('bao_gom_index', bao_gom_index), ('conflict_index', conflict_index)]:
    out_path = os.path.join(base, name + '.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(idx_data, f, ensure_ascii=False)
    size = os.path.getsize(out_path)
    print(f'  Saved {name}: {size//1024}KB')

# Validation
for tb in tb_tchq_index:
    if 'quercetin' in tb.get('ten_sp','').lower():
        print(f"VALIDATE TB: {tb['so_hieu']} | {tb['ten_sp']} | HS {tb['ma_hs']}")
for bg in bao_gom_index:
    t = bg.get('t','').lower()
    if 'ban chai danh rang' in t or 'bàn chải đánh răng' in t:
        snippet_idx = t.find('bàn chải đánh răng') if 'bàn chải đánh răng' in t else t.find('ban chai')
        print(f"VALIDATE BG: HS {bg['hs']} | ...{bg['t'][max(0,snippet_idx-10):snippet_idx+60]}...")

print('DONE')
