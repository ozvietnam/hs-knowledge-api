"""
Orchestrator — File watcher + Auto pipeline trigger
Theo dõi thư mục data/tb_tchq/ → khi có file mới → tự chạy pipeline.

Workflow:
  1. Phát hiện file mới (openclaw_output.json, tb_tchq_new.json, ...)
  2. validate → merge → rebuild_index → report
  3. Ghi kết quả vào axit/report/
"""

import json
import os
import time
import subprocess
import sys
import signal
import hashlib

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WATCH_DIR = os.path.join(BASE_DIR, 'data', 'tb_tchq')
STATE_FILE = os.path.join(BASE_DIR, 'data', 'orchestrator_state.json')
REPORT_DIR = os.path.expanduser('~/Desktop/work/axit/report')
SCRIPTS_DIR = os.path.join(BASE_DIR, 'scripts')

# File patterns to watch for new data
WATCH_PATTERNS = [
    'openclaw_output.json',
    'tb_tchq_new.json',
    'tb_tchq_scraped.json',
]

PIPELINE_STEPS = [
    {
        'name': 'validate',
        'cmd': ['python3', '-c', '''
import json, sys
sys.path.insert(0, "{base}")
try:
    from scripts.data_pipeline import validate_record
    with open("{input_file}") as f:
        records = json.load(f)
    valid = [r for r in records if validate_record(r)[0]]
    print(f"Valid: {{len(valid)}}/{{len(records)}}")
    # Write valid records for next step
    with open("{base}/data/tb_tchq/_pipeline_valid.json", "w") as f:
        json.dump(valid, f, ensure_ascii=False)
    sys.exit(0)
except Exception as e:
    print(f"ERROR: {{e}}", file=sys.stderr)
    sys.exit(1)
'''],
        'input_key': 'input_file',
    },
    {
        'name': 'merge',
        'cmd': ['python3', '-c', '''
import json, sys
sys.path.insert(0, "{base}")
try:
    from scripts.data_pipeline import merge_into_kg
    with open("{base}/data/tb_tchq/_pipeline_valid.json") as f:
        records = json.load(f)
    stats = merge_into_kg(records, kg_dir="{base}/data/kg")
    print(json.dumps(stats))
    sys.exit(0)
except Exception as e:
    print(f"ERROR: {{e}}", file=sys.stderr)
    sys.exit(1)
'''],
    },
    {
        'name': 'rebuild_index',
        'cmd': ['python3', os.path.join(BASE_DIR, 'build_indexes.py')],
    },
]


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {'processed_files': {}, 'last_run': None, 'runs': []}


def save_state(state):
    with open(STATE_FILE, 'w') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def file_hash(path):
    """MD5 hash của file để detect thay đổi."""
    h = hashlib.md5()
    with open(path, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


def detect_new_files(state):
    """Tìm file mới hoặc file đã thay đổi."""
    new_files = []
    for pattern in WATCH_PATTERNS:
        path = os.path.join(WATCH_DIR, pattern)
        if not os.path.exists(path):
            continue
        current_hash = file_hash(path)
        known_hash = state['processed_files'].get(path)
        if known_hash != current_hash:
            new_files.append({
                'path': path,
                'name': pattern,
                'hash': current_hash,
                'size_mb': round(os.path.getsize(path) / 1024 / 1024, 2),
            })
    return new_files


def run_step(step, context):
    """Chạy 1 bước pipeline."""
    cmd = step['cmd']
    # Replace placeholders
    cmd_str = json.dumps(cmd)
    for k, v in context.items():
        cmd_str = cmd_str.replace(f'{{{k}}}', v)
    cmd = json.loads(cmd_str)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=BASE_DIR,
        )
        return {
            'ok': result.returncode == 0,
            'stdout': result.stdout.strip()[-500:],
            'stderr': result.stderr.strip()[-200:],
            'returncode': result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': 'timeout'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def run_pipeline(file_info):
    """Chạy toàn bộ pipeline cho 1 file mới."""
    print(f"\n🚀 Pipeline triggered: {file_info['name']} ({file_info['size_mb']} MB)")
    start_time = time.time()

    context = {
        'base': BASE_DIR,
        'input_file': file_info['path'],
    }

    run_log = {
        'file': file_info['name'],
        'started': time.strftime('%Y-%m-%d %H:%M:%S'),
        'steps': [],
        'success': False,
    }

    for step in PIPELINE_STEPS:
        print(f"  ▶ {step['name']}...", end=' ', flush=True)

        # Skip steps that require scripts not yet implemented
        script_needed = step['cmd'][1] if len(step['cmd']) > 1 else ''
        if 'data_pipeline' in str(step['cmd']):
            pipeline_script = os.path.join(SCRIPTS_DIR, 'data_pipeline.py')
            if not os.path.exists(pipeline_script) or os.path.getsize(pipeline_script) < 100:
                print(f"⏭️  (script not ready)")
                continue

        result = run_step(step, context)
        status = '✅' if result['ok'] else '❌'
        print(f"{status} {result.get('stdout', '')[:80]}")

        run_log['steps'].append({'name': step['name'], **result})

        if not result['ok'] and step['name'] in ('validate', 'merge'):
            print(f"  ❌ Pipeline stopped at {step['name']}: {result.get('stderr', '')[:100]}")
            break
    else:
        run_log['success'] = True

    elapsed = time.time() - start_time
    run_log['elapsed_s'] = round(elapsed, 1)
    run_log['finished'] = time.strftime('%Y-%m-%d %H:%M:%S')

    write_report(file_info, run_log)

    # Auto git commit + mobile brief
    if run_log['success']:
        try:
            from orchestrator.git_reporter import auto_commit, build_mobile_brief, write_mobile_brief
            label = f"data: pipeline {file_info['name']} merged"
            sha = auto_commit(label)
            if sha:
                brief = build_mobile_brief(label=label)
                write_mobile_brief(brief)
                print(f"  📱 Mobile brief updated")
        except Exception as e:
            print(f"  ⚠️  Git reporter error: {e}")

    return run_log


def write_report(file_info, run_log):
    """Ghi báo cáo pipeline vào axit/report/."""
    os.makedirs(REPORT_DIR, exist_ok=True)
    ts = time.strftime('%Y-%m-%d_%Hh%M')
    report_path = os.path.join(REPORT_DIR, f'{ts}_pipeline_{file_info["name"].replace(".json","")}.md')

    steps_md = '\n'.join(
        f"| {s['name']} | {'✅' if s.get('ok') else '❌'} | {s.get('stdout','')[:100]} |"
        for s in run_log['steps']
    )

    report = f"""# Pipeline Run Report
**File:** {file_info['name']} ({file_info['size_mb']} MB)
**Started:** {run_log['started']}
**Elapsed:** {run_log['elapsed_s']}s
**Status:** {'✅ SUCCESS' if run_log['success'] else '❌ FAILED'}

## Steps
| Step | Status | Output |
|------|--------|--------|
{steps_md}
"""
    with open(report_path, 'w') as f:
        f.write(report)
    print(f"  📄 Report: {report_path}")


class Orchestrator:
    def __init__(self, poll_interval=10):
        self.poll_interval = poll_interval
        self.running = True
        self.state = load_state()
        signal.signal(signal.SIGINT, self._shutdown)
        signal.signal(signal.SIGTERM, self._shutdown)

    def _shutdown(self, *_):
        print("\n\n⛔ Orchestrator shutting down...")
        self.running = False

    def run(self):
        print(f"🎯 Orchestrator started (polling every {self.poll_interval}s)")
        print(f"   Watching: {WATCH_DIR}")
        print(f"   Patterns: {WATCH_PATTERNS}")
        print(f"   Press Ctrl+C to stop\n")

        while self.running:
            new_files = detect_new_files(self.state)

            if new_files:
                for file_info in new_files:
                    run_log = run_pipeline(file_info)
                    # Mark as processed
                    self.state['processed_files'][file_info['path']] = file_info['hash']
                    self.state['last_run'] = time.strftime('%Y-%m-%d %H:%M:%S')
                    self.state['runs'].append(run_log)
                    # Keep only last 50 runs
                    self.state['runs'] = self.state['runs'][-50:]
                    save_state(self.state)
            else:
                # Heartbeat every minute
                if int(time.time()) % 60 < self.poll_interval:
                    print(f"  💓 {time.strftime('%H:%M:%S')} watching...", end='\r')

            time.sleep(self.poll_interval)

        print("Orchestrator stopped.")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--interval', type=int, default=10, help='Poll interval seconds')
    parser.add_argument('--once', action='store_true', help='Run once then exit')
    args = parser.parse_args()

    if args.once:
        state = load_state()
        new_files = detect_new_files(state)
        if new_files:
            for f in new_files:
                run_pipeline(f)
                state['processed_files'][f['path']] = f['hash']
            save_state(state)
        else:
            print("No new files detected.")
    else:
        orch = Orchestrator(poll_interval=args.interval)
        orch.run()
