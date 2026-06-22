#!/usr/bin/env bash
# Run a benchmark task against a model/agent and record a result JSON.
#
# Usage: scripts/run.sh <task-id> <model> [agent]
# Example: scripts/run.sh lru-cache glm-4.6 pi
#
# This is a thin wrapper — adapt the agent invocation to your setup.
# It times the run, runs the acceptance check, and writes a result JSON
# to results/<YYYY-MM-DD>-<model>-<task>.json

set -euo pipefail

TASK="${1:?usage: run.sh <task-id> <model> [agent]}"
MODEL="${2:?usage: run.sh <task-id> <model> [agent]}"
AGENT="${3:-pi}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_FILE="$ROOT/tasks/$TASK.md"
RESULTS_DIR="$ROOT/results"
mkdir -p "$RESULTS_DIR"

if [[ ! -f "$TASK_FILE" ]]; then
	echo "Task not found: $TASK_FILE" >&2
	exit 1
fi

DATE="$(date -u +%Y-%m-%d)"
OUT="$RESULTS_DIR/${DATE}-${MODEL}-${TASK}.json"

echo ">> Task: $TASK"
echo ">> Model: $MODEL"
echo ">> Agent: $AGENT"
echo ">> Output: $OUT"
echo

# --- Agent invocation ----------------------------------------------------
# Replace this block with how you actually drive your agent.
# Capture: start time, end time, first-token time, token counts, pass/fail.
START_EPOCH=$(date -u +%s.%N)

# Example (Pi, print mode):
#   pi -p "$(cat $TASK_FILE)" > /tmp/out.txt
# Then run the acceptance test from the task file against the generated code.

echo "TODO: wire up agent invocation for: $AGENT $MODEL"
echo "TODO: run acceptance check, set PASS=[true|false]"
PASS="unknown"

END_EPOCH=$(date -u +%s.%N)
WALL_S=$(awk "BEGIN{printf \"%.2f\", $END_EPOCH - $START_EPOCH}")

cat >"$OUT" <<EOF
{
  "task": "$TASK",
  "model": "$MODEL",
  "agent": "$AGENT",
  "started_at": "$(date -u -d @$START_EPOCH +%Y-%m-%dT%H:%M:%SZ)",
  "ended_at": "$(date -u -d @$END_EPOCH +%Y-%m-%dT%H:%M:%SZ)",
  "metrics": {
    "wall_s": $WALL_S,
    "ttft_ms": null,
    "tokens_per_s": null,
    "input_tokens": null,
    "output_tokens": null
  },
  "result": "$PASS",
  "pass_at_1": null,
  "notes": "TODO: fill in real metrics from the agent run"
}
EOF

echo
echo ">> Wrote $OUT (pass=$PASS). Edit it with real metrics."
