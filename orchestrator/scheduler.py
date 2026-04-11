"""
Scheduler — Cron-like task runner (pure Python, no deps)
Chạy các task định kỳ: health check, coverage report, pytest, cleanup.
"""

import json
import os
import time
import subprocess
import threading
import signal

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT_DIR = os.path.expanduser('~/Desktop/work/axit/report')
LOG_FILE = os.path.join(BASE_DIR, 'data', 'scheduler.log')


def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')


def run_monitor():
    """Chạy monitor.py → save system_status.json."""
    try:
        result = subprocess.run(
            ['python3', os.path.join(BASE_DIR, 'orchestrator', 'monitor.py')],
            capture_output=True, text=True, timeout=60, cwd=BASE_DIR
        )
        if result.returncode == 0:
            log(f"✅ Health check OK")
        else:
            log(f"⚠️  Health check warning: {result.stderr[:100]}")
    except Exception as e:
        log(f"❌ Health check error: {e}")


def run_coverage_report():
    """Tạo coverage snapshot và lưu báo cáo."""
    try:
        import sys
        sys.path.insert(0, BASE_DIR)
        from orchestrator.monitor import snapshot, print_status
        snap = snapshot()

        # Save JSON status
        status_file = os.path.join(BASE_DIR, 'data', 'system_status.json')
        with open(status_file, 'w') as f:
            json.dump(snap, f, ensure_ascii=False, indent=2)

        # Write hourly markdown report
        os.makedirs(REPORT_DIR, exist_ok=True)
        ts = time.strftime('%Y-%m-%d_%Hh%M')
        report_path = os.path.join(REPORT_DIR, f'{ts}_coverage_snapshot.md')

        layers = snap['kg_coverage']['layers']
        total = snap['kg_coverage']['total_codes']
        services = snap['services']
        procs = snap['processes']

        lines = [
            f"# Coverage Snapshot — {snap['timestamp']}",
            f"\n## Services",
            f"| Service | Status |",
            f"|---------|--------|",
            f"| Ollama | {'✅' if services['ollama']['ok'] else '❌'} |",
            f"| Next.js | {'✅' if services['nextjs']['ok'] else '❌'} |",
            f"\n## KG Coverage ({total} codes)",
            f"| Layer | Count | % |",
            f"|-------|-------|---|",
        ]
        layer_names = {
            'L1': 'fact_layer.vn', 'L2': 'agency_authority',
            'L3': 'KTCN', 'L4': 'chinh_sach',
            'L5': 'conflict', 'L6': 'chu_giai',
            'L7': 'rates', 'L8': 'case_history',
        }
        for k, v in layers.items():
            lines.append(f"| {k} {layer_names[k]} | {v['count']} | {v['pct']}% |")

        lines += [
            f"\n## Processes",
            f"| Process | Running |",
            f"|---------|---------|",
        ]
        for name, running in procs.items():
            lines.append(f"| {name} | {'🟢' if running else '⚪'} |")

        with open(report_path, 'w') as f:
            f.write('\n'.join(lines))

        log(f"📊 Coverage report saved: {os.path.basename(report_path)}")
    except Exception as e:
        log(f"❌ Coverage report error: {e}")


def run_tests():
    """Chạy pytest regression tests."""
    test_dir = os.path.join(BASE_DIR, 'tests')
    if not os.path.exists(test_dir):
        return
    try:
        result = subprocess.run(
            ['python3', '-m', 'pytest', 'tests/test_data_pipeline.py::TestKGCoverage',
             '-q', '--tb=line'],
            capture_output=True, text=True, timeout=120, cwd=BASE_DIR
        )
        passed = result.stdout.count(' passed')
        failed = result.stdout.count(' failed')
        if result.returncode == 0:
            log(f"✅ Tests passed ({result.stdout.strip().split(chr(10))[-1]})")
        else:
            log(f"⚠️  Tests: {result.stdout.strip()[-200:]}")
    except Exception as e:
        log(f"❌ Tests error: {e}")


def cleanup_old_reports():
    """Xóa report cũ hơn 7 ngày."""
    try:
        cutoff = time.time() - 7 * 86400
        deleted = 0
        for fname in os.listdir(REPORT_DIR):
            fpath = os.path.join(REPORT_DIR, fname)
            if os.path.getmtime(fpath) < cutoff and fname.endswith('.md'):
                # Keep final reports, only delete snapshots
                if 'snapshot' in fname or 'coverage' in fname:
                    os.remove(fpath)
                    deleted += 1
        if deleted:
            log(f"🗑️  Cleaned {deleted} old reports")
    except Exception as e:
        log(f"❌ Cleanup error: {e}")


class Scheduler:
    """Simple cron-like scheduler."""

    def __init__(self):
        self.running = True
        self.last_run = {}
        self.tasks = [
            # (interval_seconds, name, func)
            (5  * 60,  'health_check',      run_monitor),
            (60 * 60,  'coverage_report',   run_coverage_report),
            (30 * 60,  'regression_tests',  run_tests),
            (24 * 3600, 'cleanup_reports',  cleanup_old_reports),
        ]
        signal.signal(signal.SIGINT, self._shutdown)
        signal.signal(signal.SIGTERM, self._shutdown)

    def _shutdown(self, *_):
        print("\n⛔ Scheduler shutting down...")
        self.running = False

    def should_run(self, name, interval):
        now = time.time()
        last = self.last_run.get(name, 0)
        return (now - last) >= interval

    def run(self):
        log("⏰ Scheduler started")
        for interval, name, func in self.tasks:
            log(f"  Registered: {name} every {interval//60}min")

        # Run immediately on start
        run_monitor()
        run_coverage_report()

        while self.running:
            for interval, name, func in self.tasks:
                if self.should_run(name, interval):
                    self.last_run[name] = time.time()
                    t = threading.Thread(target=func, daemon=True)
                    t.start()
            time.sleep(30)

        log("Scheduler stopped.")


if __name__ == '__main__':
    s = Scheduler()
    s.run()
