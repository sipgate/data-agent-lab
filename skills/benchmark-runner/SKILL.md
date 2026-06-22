---
name: benchmark-runner
description: Run a benchmark task from benchmarks/tasks/ and record a result JSON. Use when the user wants to measure a model on a coding task.
---

# Benchmark Runner Skill

When asked to run or record a benchmark:

1. Find the task spec in `benchmarks/tasks/<id>.md`. Read its frontmatter (`id`, `language`, `timeout_s`) and acceptance criteria.
2. Ask (or infer from context) which model and agent to use.
3. Run `bash benchmarks/scripts/run.sh <id> <model> [agent]` — it creates a stub result JSON at `benchmarks/results/<date>-<model>-<id>.json`.
4. Drive the agent against the task spec, capture real metrics:
   - `ttft_ms` (time to first token)
   - `tokens_per_s`
   - `input_tokens` / `output_tokens`
   - `wall_s`
5. Run the task's acceptance test. Set `pass_at_1` and `result` accordingly.
6. Update the result JSON with real numbers. Never leave `null` metrics if you measured them.
7. (Optional) run `python3 benchmarks/scripts/summary.py` to see the aggregate table.

## Conventions

- One result file per `(date, model, task)`. If you re-run the same day, overwrite or suffix `-2`.
- Keep tasks agent-agnostic. Agent-specific glue belongs in `run.sh`, not in the task spec.
- Record failures too — they're useful data.
