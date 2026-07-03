---
name: benchmark-runner
description: Run a benchmark task from benchmarks/tasks/ and record a result JSON. Use when the user wants to measure a model on a coding task.
---

# Benchmark Runner Skill

When asked to run or record a benchmark:

1. Find the task spec in `benchmarks/tasks/<id>.md`. Read its frontmatter (`id`, `language`, `timeout_s`) and acceptance criteria.
2. Ask (or infer from context) which model and agent to use.
3. Run `bash benchmarks/scripts/run.sh <id> <model> [agent] [provider]`. This is now fully automated — it builds the prompt, drives the agent, captures metrics, extracts the generated code, runs the task's acceptance test, and writes `benchmarks/results/<date>-<model>-<id>.json`. You do **not** hand-fill metrics.
   - `agent=pi` (default): full metrics via `pi --mode json` — `ttft_ms`, `tokens_per_s`, `input_tokens`, `output_tokens`, `cost_usd`.
   - `agent=claude`: wall + tokens + cost via `claude -p --output-format json`; `ttft_ms` is `null`.
   - `provider` (4th arg, pi only) picks the pi provider, e.g. `zai` for GLM.
   - Exit code: `0` on pass/no-test, `1` on fail/error — safe for CI.
4. Read the result JSON. If `result` is `error`, the `notes` field carries the agent's stderr (usually auth/model issues) — surface that to the user.
5. (Optional) run `python3 benchmarks/scripts/summary.py` for the aggregate per-model table (pass%, tok/s, TTFT, wall, cost).

## Conventions

- One result file per `(date, model, task)`. Re-running the same day overwrites it.
- `tokens_per_s` is **decode throughput** — `output_tokens / (wall_s − ttft_s)` — not diluted by tool-call time. See `benchmarks/results/EXAMPLE.json` for the full result schema.
- Only `language: python` tasks run their acceptance test; other languages yield `result: no-test`.
- Keep tasks agent-agnostic. Agent-specific glue lives in `runner.py`, not in the task spec.
- Record failures too — they're useful data.
