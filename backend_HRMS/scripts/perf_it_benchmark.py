"""
Benchmark IT list endpoints on an in-memory SQLite copy seeded at scale (never touches a real DB).

    cd backend_HRMS
    py scripts/perf_it_benchmark.py --employees 1000
    py scripts/perf_it_benchmark.py --employees 1000 --itam-flags-on
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "tests"))

import warnings  # noqa: E402

warnings.filterwarnings("ignore")

from it_perf_support import LIST_ENDPOINTS, count_queries, it_headers, make_app, seed  # noqa: E402
from website import db  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--employees", type=int, default=500)
    parser.add_argument("--itam-flags-on", action="store_true")
    args = parser.parse_args()

    app = make_app(itam_flags_on=args.itam_flags_on)
    started = time.perf_counter()
    with app.app_context():
        db.create_all()
        seed(n=args.employees)
    print(f"Seeded {args.employees} employees in {time.perf_counter() - started:.1f}s "
          f"(ITAM flags {'on' if args.itam_flags_on else 'off'})\n")

    client = app.test_client()
    headers = it_headers(app)
    print(f"{'endpoint':72} {'ms':>8} {'queries':>8} {'KB':>8}")
    for path in LIST_ENDPOINTS:
        client.get(path, headers=headers)
        with app.app_context():
            engine = db.engine
        with count_queries(engine) as statements:
            t0 = time.perf_counter()
            resp = client.get(path, headers=headers)
            ms = (time.perf_counter() - t0) * 1000
        print(f"{path:72} {ms:8.0f} {len(statements):8d} {len(resp.data) / 1024:8.0f}")


if __name__ == "__main__":
    main()
