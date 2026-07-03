#!/usr/bin/env bash
# Run a benchmark task against a model/agent and record a result JSON.
#
# Usage: scripts/run.sh <task-id> <model> [agent] [provider]
# Example: scripts/run.sh lru-cache glm-4.6 pi zai
#          scripts/run.sh lru-cache claude-opus-4-8 claude
#
# Thin wrapper around runner.py, which does the real work: builds the
# prompt, drives the agent, stream-parses metrics, extracts the generated
# code, runs the task's acceptance test, and writes:
#   results/<YYYY-MM-DD>-<model>-<task>.json
#
# Exit code: 0 on pass (or no-test), 1 on fail/error — usable in CI.

set -euo pipefail

TASK="${1:?usage: run.sh <task-id> <model> [agent] [provider]}"
MODEL="${2:?usage: run.sh <task-id> <model> [agent] [provider]}"
AGENT="${3:-pi}"
PROVIDER="${4:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

args=(--task "$TASK" --model "$MODEL" --agent "$AGENT")
[[ -n "$PROVIDER" ]] && args+=(--provider "$PROVIDER")

exec python3 "$ROOT/scripts/runner.py" "${args[@]}"
