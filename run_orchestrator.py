#!/usr/bin/env python3
"""
Entry point — Chạy Scheduler + Orchestrator song song.

Usage:
  python3 run_orchestrator.py              # Chạy full (scheduler + watcher)
  python3 run_orchestrator.py --monitor    # Chỉ snapshot 1 lần rồi thoát
  python3 run_orchestrator.py --scheduler  # Chỉ scheduler
  python3 run_orchestrator.py --watcher    # Chỉ file watcher
"""

import argparse
import threading
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)


def main():
    parser = argparse.ArgumentParser(description='HS Knowledge Graph Orchestrator')
    parser.add_argument('--monitor',   action='store_true', help='Snapshot once')
    parser.add_argument('--scheduler', action='store_true', help='Scheduler only')
    parser.add_argument('--watcher',   action='store_true', help='File watcher only')
    parser.add_argument('--interval',  type=int, default=10, help='Watch poll interval (s)')
    args = parser.parse_args()

    if args.monitor:
        from orchestrator.monitor import snapshot, print_status, save_status
        snap = snapshot()
        print_status(snap)
        save_status(snap)
        return

    if args.scheduler:
        from orchestrator.scheduler import Scheduler
        Scheduler().run()
        return

    if args.watcher:
        from orchestrator.orchestrator import Orchestrator
        Orchestrator(poll_interval=args.interval).run()
        return

    # Default: run both
    print("🚀 Starting HS-KG Orchestrator (scheduler + file watcher)")
    print(f"   Base: {BASE_DIR}\n")

    from orchestrator.scheduler import Scheduler
    from orchestrator.orchestrator import Orchestrator

    scheduler = Scheduler()
    watcher = Orchestrator(poll_interval=args.interval)

    t_sched = threading.Thread(target=scheduler.run, daemon=True, name='scheduler')
    t_watch = threading.Thread(target=watcher.run, daemon=True, name='watcher')

    t_sched.start()
    t_watch.start()

    try:
        t_sched.join()
        t_watch.join()
    except KeyboardInterrupt:
        print("\n⛔ Shutting down...")
        scheduler.running = False
        watcher.running = False


if __name__ == '__main__':
    main()
