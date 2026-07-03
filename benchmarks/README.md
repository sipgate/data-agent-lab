# benchmark-runner

A minimal, agent-agnostic benchmark harness. Each task is a markdown spec; each run is a JSON result. No agent-specific code — you run a task with whatever agent/model you like and record the outcome.

## Tasks

A task lives in `tasks/<name>.md` and has:

```
---
id: lru-cache
language: python
difficulty: medium
tags: [data-structure, algorithms]
timeout_s: 120
---

# Task: LRU Cache

Implement an LRU cache ... (clear, unambiguous spec)
```

- `id` matches the filename.
- `timeout_s` is a soft hint for runners.
- Spec describes inputs/outputs and acceptance criteria. No reference solution in the task file.

## Runs

A run lives in `results/<YYYY-MM-DD>-<model>-<task>.json`:

```json
{
  "task": "lru-cache",
  "model": "glm-4.6",
  "agent": "pi",
  "started_at": "2026-06-22T10:30:00Z",
  "ended_at": "2026-06-22T10:31:12Z",
  "run_id": "a1b2c3d4e5f6",
  "metrics": {
    "wall_s": 72.1,
    "ttft_ms": 420.0,
    "tokens_per_s": 87.5,
    "input_tokens": 312,
    "output_tokens": 540,
    "cost_usd": 0.00184
  },
  "result": "pass",
  "pass_at_1": true,
  "notes": "acceptance test passed"
}
```

See `results/EXAMPLE.json` for the canonical schema. `tokens_per_s` is **decode throughput** (`output_tokens / (wall_s − ttft_s)`), so tool-call time doesn't dilute the speed number. `result` is one of `pass` / `fail` / `error` / `no-test`.

## Scripts

`scripts/run.sh <task> <model> [agent] [provider]` — entrypoint. Delegates to `runner.py`, which builds the prompt, drives the agent, stream-parses metrics, extracts the generated code, runs the acceptance test, and writes the result JSON. Exit `0` on pass/no-test, `1` on fail/error.

- `agent`: `pi` (default, full metrics via `--mode json`) or `claude` (`-p --output-format json`, no TTFT).
- `provider`: pi provider for the model, e.g. `scripts/run.sh lru-cache glm-4.6 pi zai`.

`scripts/runner.py` — the real driver. Also callable directly with `--task/--model/--agent/--provider` flags.

`scripts/summary.py` — aggregates `results/*.json` (ignoring `EXAMPLE.json`) into a per-model table: pass rate, mean tokens/s, mean TTFT, mean wall, mean cost.
