"""Manage city pipeline runs.

Entry point that dispatches the same argparse interface.
"""

from __future__ import annotations

import argparse

from pipeline.steps.run_city import run_city


def main() -> None:
    parser = argparse.ArgumentParser(prog="pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    step = sub.add_parser("city-step", help="Run one named step for one city.")
    step.add_argument("--city", required=True)
    step.add_argument("--step", required=True)
    step.add_argument("--force", action="store_true")
    args = parser.parse_args()
    run_city(args.city, step=args.step, force=args.force)


if __name__ == "__main__":
    main()
