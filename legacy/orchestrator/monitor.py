"""
Monitor — Health checks & metrics snapshot
Chạy độc lập hoặc được gọi bởi orchestrator.
"""

import json
import os
import time
import urllib.request
import subprocess
import math

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KG_DIR = os.path.join(BASE_DIR, 'data', 'kg')
STATUS_FILE = os.path.join(BASE_DIR, 'data', 'system_status.json')


def check_ollama():
    try:
        with urllib.request.urlopen('http://localhost:11434/api/tags', timeout=3) as r:
            data = json.loads(r.read())
            models = [m['name'] for m in data.get('models', [])]
            return {'ok': True, 'models': models}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def check_nextjs():
    try:
        with urllib.request.urlopen('http://localhost:3000/api/stats', timeout=3) as r:
            return {'ok': True, 'status': r.status}
    except Exception as e:
        # Try simple GET
        try:
            with urllib.request.urlopen('http://localhost:3000', timeout=3) as r:
                return {'ok': True, 'status': r.status}
        except:
            return {'ok': False, 'error': str(e)}


def check_processes():
    """Kiểm tra các process quan trọng đang chạy."""
    procs = {}
    try:
        result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
        lines = result.stdout
        procs['aider'] = 'aider' in lines and 'grep' not in lines.split('aider')[1][:20] if 'aider' in lines else False
        procs['next_dev'] = 'next dev' in lines
        procs['ollama'] = 'ollama' in lines
        procs['scraper'] = 'scraper_tbtchq' in lines
        procs['embeddings'] = 'build_vector' in lines
    except:
        pass
    return procs


def get_kg_coverage():
    """Đọc coverage stats của KG layers."""
    stats = {
        'total': 0, 'L1': 0, 'L2': 0, 'L3': 0,
        'L4': 0, 'L5': 0, 'L6': 0, 'L7': 0, 'L8': 0,
    }
    try:
        for ch in range(1, 99):
            fp = os.path.join(KG_DIR, f'chapter_{ch:02d}.json')
            if not os.path.exists(fp):
                continue
            with open(fp) as f:
                data = json.load(f)
            for item in data.values():
                stats['total'] += 1
                fl = item.get('fact_layer', {})
                ll = item.get('legal_layer', {})
                tt = ll.get('tinh_chat', {})
                if fl.get('vn'):                          stats['L1'] += 1
                if tt.get('agency_authority'):            stats['L2'] += 1
                if tt.get('ktcn'):                        stats['L3'] += 1
                if fl.get('chinh_sach'):                  stats['L4'] += 1
                if ll.get('conflict', {}).get('has_conflict'): stats['L5'] += 1
                if ll.get('chu_giai_nhom'):               stats['L6'] += 1
                if fl.get('rates'):                       stats['L7'] += 1
                if ll.get('case_history'):                stats['L8'] += 1
    except Exception as e:
        stats['error'] = str(e)
    return stats


def get_data_files():
    """Kiểm tra các file data quan trọng."""
    files_to_check = {
        'vector_embeddings': os.path.join(BASE_DIR, 'data', 'vector_embeddings.json'),
        'tb_tchq_full': os.path.join(BASE_DIR, 'data', 'tb_tchq', 'tb_tchq_full.json'),
        'tb_tchq_new': os.path.join(BASE_DIR, 'data', 'tb_tchq', 'tb_tchq_new.json'),
        'openclaw_output': os.path.join(BASE_DIR, 'data', 'tb_tchq', 'openclaw_output.json'),
    }
    result = {}
    for name, path in files_to_check.items():
        if os.path.exists(path):
            stat = os.stat(path)
            result[name] = {
                'exists': True,
                'size_mb': round(stat.st_size / 1024 / 1024, 2),
                'modified': time.strftime('%Y-%m-%d %H:%M', time.localtime(stat.st_mtime)),
            }
        else:
            result[name] = {'exists': False}
    return result


def snapshot():
    """Tạo snapshot đầy đủ trạng thái hệ thống."""
    ts = time.time()
    coverage = get_kg_coverage()
    t = coverage.get('total', 1) or 1

    snap = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'ts': ts,
        'services': {
            'ollama': check_ollama(),
            'nextjs': check_nextjs(),
        },
        'processes': check_processes(),
        'data_files': get_data_files(),
        'kg_coverage': {
            'total_codes': t,
            'layers': {
                f'L{i}': {
                    'count': coverage[f'L{i}'],
                    'pct': round(coverage[f'L{i}'] / t * 100, 1)
                }
                for i in range(1, 9)
            }
        }
    }
    return snap


def save_status(snap):
    with open(STATUS_FILE, 'w') as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)


def print_status(snap):
    print(f"\n{'='*55}")
    print(f"  SYSTEM STATUS  {snap['timestamp']}")
    print(f"{'='*55}")

    s = snap['services']
    p = snap['processes']
    print(f"\n🔧 Services:")
    print(f"  Ollama:  {'✅' if s['ollama']['ok'] else '❌'}  "
          f"{'models: ' + str(len(s['ollama'].get('models',[]))) if s['ollama']['ok'] else s['ollama'].get('error','')}")
    print(f"  Next.js: {'✅' if s['nextjs']['ok'] else '❌'}")

    print(f"\n⚙️  Processes:")
    for name, running in p.items():
        print(f"  {name:<15} {'🟢 running' if running else '⚪ stopped'}")

    print(f"\n📊 KG Coverage ({snap['kg_coverage']['total_codes']} codes):")
    layer_names = {
        'L1': 'fact (mô tả)',    'L2': 'agency (bộ)',
        'L3': 'KTCN',           'L4': 'chinh_sach',
        'L5': 'conflict',       'L6': 'chu_giai',
        'L7': 'rates (thuế)',   'L8': 'case_history',
    }
    for k, v in snap['kg_coverage']['layers'].items():
        bar_len = int(v['pct'] / 5)
        bar = '█' * bar_len + '░' * (20 - bar_len)
        print(f"  {k} {layer_names[k]:<16} [{bar}] {v['pct']:5.1f}%")

    print(f"\n📁 Data Files:")
    for name, info in snap['data_files'].items():
        if info['exists']:
            print(f"  ✅ {name:<22} {info['size_mb']:>6} MB  {info['modified']}")
        else:
            print(f"  ⬜ {name:<22} (not found)")
    print()


if __name__ == '__main__':
    snap = snapshot()
    print_status(snap)
    save_status(snap)
    print(f"Status saved → {STATUS_FILE}")
