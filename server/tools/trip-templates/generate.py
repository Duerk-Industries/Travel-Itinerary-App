"""Generate itinerary templates for a destination pack.

    python generate.py --pack japan --seed ../../data/trip-templates      # app seed data (JSON)
    python generate.py --pack japan --csv out --start 2027-04-05          # Format C CSV imports
    python generate.py --pack japan --only T04 --csv out --start 2027-10-11

A pack (packs/<name>.py) supplies build_with_meta(); everything else here is destination-agnostic.
Adding a destination means adding a pack, not changing this file.
"""
from __future__ import annotations

import argparse
import importlib
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "packs"))

from emit import emit, emit_seed  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True, help="Destination pack name, e.g. japan")
    ap.add_argument("--only", default=None, help="Template id within the pack, e.g. T04")
    ap.add_argument("--start", default="2027-04-05", help="Arrival date for CSV output, YYYY-MM-DD")
    ap.add_argument("--csv", default=None, help="Write Format C CSV folders here")
    ap.add_argument("--seed", default=None, help="Write app seed JSON here")
    args = ap.parse_args()
    if not (args.csv or args.seed):
        ap.error("give --csv and/or --seed")
    pack = importlib.import_module(args.pack)
    templates = [t for t in pack.build_with_meta() if not args.only or t.id == args.only]
    for t in templates:
        if args.csv:
            print(emit(t, date.fromisoformat(args.start), args.csv))
        if args.seed:
            print(emit_seed(t, args.pack, args.seed))


if __name__ == "__main__":
    main()
