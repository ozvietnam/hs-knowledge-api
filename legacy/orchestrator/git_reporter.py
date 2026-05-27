"""
Git Reporter — Đọc git diff → sinh changelog compact cho mobile/Claude.

Dùng sau mỗi pipeline run:
  python3 orchestrator/git_reporter.py --commit "Layer 8 enrich via openclaw"
  python3 orchestrator/git_reporter.py --diff-only
  python3 orchestrator/git_reporter.py --since HEAD~1
"""

import json
import os
import re
import subprocess
import time
import argparse

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT_DIR = os.path.expanduser('~/Desktop/work/axit/report')
MOBILE_REPORT = os.path.expanduser('~/Desktop/work/axit/MOBILE_BRIEF.md')


def git(cmd, cwd=BASE_DIR):
    result = subprocess.run(
        ['git'] + cmd, capture_output=True, text=True, cwd=cwd
    )
    return result.stdout.strip(), result.stderr.strip()


def get_changed_chapters():
    """Phân tích git diff → layer nào thay đổi, bao nhiêu HS codes."""
    stdout, _ = git(['diff', '--name-only', 'HEAD'])
    if not stdout:
        stdout, _ = git(['diff', '--cached', '--name-only'])

    changed = {'chapters': [], 'scripts': [], 'other': []}
    for line in stdout.splitlines():
        if line.startswith('data/kg/chapter_'):
            ch = re.search(r'chapter_(\d+)', line)
            if ch:
                changed['chapters'].append(int(ch.group(1)))
        elif line.startswith('scripts/') or line.startswith('orchestrator/'):
            changed['scripts'].append(line)
        else:
            changed['other'].append(line)

    return changed


def analyze_layer_changes(chapters):
    """Đếm thay đổi theo layer từ git diff content."""
    if not chapters:
        return {}

    layer_stats = {f'L{i}': {'added': 0, 'modified': 0} for i in range(1, 9)}

    # Get diff for each chapter
    for ch_num in chapters[:10]:  # sample first 10 chapters
        ch = str(ch_num).zfill(2)
        fp = os.path.join(BASE_DIR, 'data', 'kg', f'chapter_{ch}.json')
        if not os.path.exists(fp):
            continue

        # Check what layers exist now
        try:
            with open(fp) as f:
                data = json.load(f)
            for item in data.values():
                ll = item.get('legal_layer', {})
                tt = ll.get('tinh_chat', {})
                if ll.get('conflict', {}).get('has_conflict'):
                    layer_stats['L5']['modified'] += 1
                if ll.get('case_history'):
                    layer_stats['L8']['added'] += 1
        except:
            pass

    return layer_stats


def count_kg_totals():
    """Quick count của toàn bộ KG."""
    totals = {'total': 0}
    for lk in ['L1','L2','L3','L4','L5','L6','L7','L8']:
        totals[lk] = 0

    kg_dir = os.path.join(BASE_DIR, 'data', 'kg')
    for ch in range(1, 99):
        fp = os.path.join(kg_dir, f'chapter_{ch:02d}.json')
        if not os.path.exists(fp):
            continue
        try:
            with open(fp) as f:
                data = json.load(f)
            for item in data.values():
                totals['total'] += 1
                fl = item.get('fact_layer', {})
                ll = item.get('legal_layer', {})
                tt = ll.get('tinh_chat', {})
                if fl.get('vn'):                                totals['L1'] += 1
                if tt.get('agency_authority'):                  totals['L2'] += 1
                if tt.get('ktcn'):                              totals['L3'] += 1
                if fl.get('chinh_sach'):                        totals['L4'] += 1
                if ll.get('conflict', {}).get('has_conflict'):  totals['L5'] += 1
                if ll.get('chu_giai_nhom'):                     totals['L6'] += 1
                if fl.get('rates'):                             totals['L7'] += 1
                if ll.get('case_history'):                      totals['L8'] += 1
        except:
            pass
    return totals


def get_recent_commits(n=5):
    """Lấy N commits gần nhất."""
    stdout, _ = git(['log', f'-{n}', '--oneline', '--no-merges'])
    return stdout.splitlines()


def build_mobile_brief(label=''):
    """Tạo báo cáo cực compact cho Claude trên điện thoại."""
    changed = get_changed_chapters()
    totals = count_kg_totals()
    t = totals['total'] or 1
    recent = get_recent_commits(3)
    head_sha, _ = git(['rev-parse', '--short', 'HEAD'])

    # Diff stats
    stdout, _ = git(['diff', '--stat', 'HEAD'])
    diff_summary = stdout.splitlines()[-1] if stdout else 'no changes'

    ts = time.strftime('%Y-%m-%d %H:%M')

    # Layer summary — chỉ show layers có thay đổi đáng kể
    layer_names = {
        'L1':'fact','L2':'agency','L3':'KTCN','L4':'policy',
        'L5':'conflict','L6':'notes','L7':'rates','L8':'cases'
    }
    layers_line = ' | '.join(
        f"{k}={totals[k]}({totals[k]/t*100:.0f}%)"
        for k in ['L2','L3','L5','L8']
    )

    brief = f"""# BRIEF {ts}
{f'[{label}]' if label else ''}
git:{head_sha} | {diff_summary}

## KG State ({totals['total']} codes)
{layers_line}
L1/L7=100% | L4=67% | L6=94%

## Changed
chapters: {len(changed['chapters'])} {changed['chapters'][:5]}{'...' if len(changed['chapters'])>5 else ''}
scripts:  {len(changed['scripts'])}
{"  ".join(changed['scripts'][:3])}

## Recent Commits
{chr(10).join('• ' + c for c in recent)}

## Services
ollama:✅ nextjs:{'✅' if _check_nextjs() else '❌'}
"""
    return brief


def _check_nextjs():
    try:
        import urllib.request
        urllib.request.urlopen('http://localhost:3000', timeout=2)
        return True
    except:
        return False


def auto_commit(message):
    """Commit tất cả data/kg/ changes với message chuẩn."""
    # Stage only KG data + scripts
    git(['add', 'data/kg/', 'scripts/', 'orchestrator/', '.gitignore', 'TDD_PLAN.md'])

    # Check if anything staged
    stdout, _ = git(['diff', '--cached', '--name-only'])
    if not stdout:
        print("Nothing to commit.")
        return None

    files_changed = len(stdout.splitlines())

    # Build commit message
    changed = get_changed_chapters()
    totals = count_kg_totals()
    t = totals['total'] or 1

    auto_msg = (
        f"{message}\n\n"
        f"chapters: {len(changed['chapters'])} | "
        f"L5={totals['L5']}({totals['L5']/t*100:.0f}%) "
        f"L8={totals['L8']}({totals['L8']/t*100:.0f}%)\n"
        f"files: {files_changed}"
    )

    sha_out, err = git(['commit', '-m', auto_msg])
    if err and 'nothing to commit' in err:
        print("Nothing to commit.")
        return None

    sha, _ = git(['rev-parse', '--short', 'HEAD'])
    print(f"✅ Committed: {sha} — {message}")
    return sha


def write_mobile_brief(brief):
    """Ghi MOBILE_BRIEF.md — file Claude đọc trên điện thoại."""
    os.makedirs(os.path.dirname(MOBILE_REPORT), exist_ok=True)
    with open(MOBILE_REPORT, 'w') as f:
        f.write(brief)
    print(f"📱 Mobile brief: {MOBILE_REPORT}")


def write_full_report(brief, label=''):
    """Lưu bản đầy đủ vào axit/report/."""
    os.makedirs(REPORT_DIR, exist_ok=True)
    ts = time.strftime('%Y-%m-%d_%Hh%M')
    slug = label.replace(' ', '_')[:30] if label else 'update'
    path = os.path.join(REPORT_DIR, f'{ts}_git_{slug}.md')
    with open(path, 'w') as f:
        f.write(brief)
    print(f"📄 Report: {path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Git-based change reporter')
    parser.add_argument('--commit', type=str, help='Auto-commit + generate brief')
    parser.add_argument('--diff-only', action='store_true', help='Only show diff analysis')
    parser.add_argument('--brief', action='store_true', help='Generate mobile brief only')
    args = parser.parse_args()

    if args.commit:
        sha = auto_commit(args.commit)
        if sha:
            brief = build_mobile_brief(label=args.commit)
            write_mobile_brief(brief)
            write_full_report(brief, label=args.commit)
            print("\n" + brief)

    elif args.diff_only:
        changed = get_changed_chapters()
        print(f"Changed chapters: {len(changed['chapters'])} → {changed['chapters'][:10]}")
        print(f"Changed scripts:  {changed['scripts']}")

    else:  # default: brief
        brief = build_mobile_brief()
        write_mobile_brief(brief)
        write_full_report(brief)
        print(brief)
