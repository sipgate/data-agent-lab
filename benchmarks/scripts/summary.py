#!/usr/bin/env python3
"""Aggregate benchmark results into a per-model summary table.

Usage: scripts/summary.py [results_dir]
Default results_dir: results/ (sibling of this script's parent).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from statistics import mean


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    results_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "results"
    files = sorted(results_dir.glob("*.json"))
    if not files:
        print("No result files found.")
        return 0

    by_model: dict[str, list[dict]] = {}
    for f in files:
        data = json.loads(f.read_text())
        by_model.setdefault(data["model"], []).append(data)

    print(
        f"{'model':<24} {'runs':>4} {'pass':>5} {'pass%':>6} "
        f"{'mean tok/s':>10} {'mean TTFT ms':>12} {'mean wall s':>11}"
    )
    print("-" * 80)
    for model, runs in sorted(by_model.items()):
        passes = sum(1 for r in runs if r.get("pass_at_1"))
        tps = [
            r["metrics"]["tokens_per_s"]
            for r in runs
            if r.get("metrics", {}).get("tokens_per_s") is not None
        ]
        ttft = [
            r["metrics"]["ttft_ms"]
            for r in runs
            if r.get("metrics", {}).get("ttft_ms") is not None
        ]
        wall = [
            r["metrics"]["wall_s"]
            for r in runs
            if r.get("metrics", {}).get("wall_s") is not None
        ]
        print(
            f"{model:<24} {len(runs):>4} {passes:>5} "
            f"{100 * passes / len(runs):>5.0f}% "
            f"{mean(tps) if tps else 0:>10.1f} "
            f"{mean(ttft) if ttft else 0:>12.0f} "
            f"{mean(wall) if wall else 0:>11.2f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
