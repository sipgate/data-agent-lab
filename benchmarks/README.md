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
  "metrics": {
    "ttft_ms": 420,
    "tokens_per_s": 87.5,
    "input_tokens": 312,
    "output_tokens": 540,
    "wall_s": 72.1
  },
  "result": "pass",
  "pass_at_1": true,
  "notes": "..."
}
```

## Scripts

`scripts/run.sh <task> <model>` — thin wrapper. Brings up the agent, feeds the task, captures timing, runs the acceptance check, writes the result JSON. Adapt to your agent/model setup.

`scripts/summary.py` — aggregates `results/*.json` into a table (per-model pass rate, mean tokens/s, mean TTFT).
