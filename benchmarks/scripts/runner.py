#!/usr/bin/env python3
"""Drive a coding agent against a benchmark task and record a result JSON.

This is the real work behind ``run.sh``: it builds the prompt, spawns the
agent, stream-parses its output for timing + token metrics, extracts the
generated code, runs the task's acceptance test, and writes the result.

Usage:
    runner.py --task <id> --model <model> [--agent pi|claude]
              [--provider <name>] [--results-dir <dir>] [--tasks-dir <dir>]

Agent support:
    pi      full metrics via ``pi --mode json`` (ttft, tokens, cost).
    claude  wall + tokens + cost via ``claude -p --output-format json``;
            ttft_ms is null (no per-token stream parsed).

Only ``language: python`` tasks run their acceptance test today. Other
languages produce a clear error result rather than a false pass.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

FENCE_RE = re.compile(r"```([\w+-]*)\n(.*?)```", re.DOTALL)


# --- Task parsing --------------------------------------------------------


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Split ``--- yaml ---`` frontmatter from the markdown body.

    Only the flat ``key: value`` subset we actually use is parsed; nested
    YAML is not needed for task specs.
    """
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw = text[3:end].strip()
    body = text[end + 4 :].lstrip("\n")
    meta: dict[str, str] = {}
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, val = line.partition(":")
        meta[key.strip()] = val.strip().strip("\"'")
    return meta, body


def extract_test_snippet(body: str) -> str | None:
    """Return the code inside the ``## Test cases`` section, if present."""
    # Find the heading, then the first fenced block after it.
    m = re.search(r"^#+\s*Test cases.*$", body, re.MULTILINE | re.IGNORECASE)
    if not m:
        return None
    after = body[m.end() :]
    fence = FENCE_RE.search(after)
    return fence.group(2) if fence else None


def extract_solution_code(text: str, language: str) -> str | None:
    """Pull the solution from an agent's answer.

    Prefer fenced blocks tagged with the task language; fall back to any
    fenced block; pick the longest to avoid grabbing a stray snippet.
    """
    blocks = FENCE_RE.findall(text)
    if not blocks:
        return None
    lang = language.lower()
    tagged = [code for tag, code in blocks if tag.lower() in (lang, "py" if lang == "python" else lang)]
    pool = tagged or [code for _, code in blocks]
    return max(pool, key=len) if pool else None


def build_prompt(body: str, language: str) -> str:
    return (
        f"{body}\n\n"
        "---\n"
        f"Implement the task above in {language}. Respond with EXACTLY ONE "
        f"fenced ```{language} code block containing the complete, runnable "
        "solution and nothing else — no prose, no explanation, no file writes."
    )


# --- Agent drivers -------------------------------------------------------


class AgentResult:
    def __init__(self) -> None:
        self.text: str = ""
        self.input_tokens: int | None = None
        self.output_tokens: int | None = None
        self.cost_usd: float | None = None
        self.ttft_ms: float | None = None
        self.error: str | None = None


def run_pi(prompt: str, model: str, provider: str | None) -> AgentResult:
    """Drive pi in JSON-event mode, streaming stdout for ttft + usage."""
    res = AgentResult()
    cmd = ["pi", "--mode", "json", "-nt", "--no-session", "-p", prompt]
    if provider:
        cmd[1:1] = ["--provider", provider]
    cmd[1:1] = ["--model", model]

    start = time.monotonic()
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    text_parts: list[str] = []
    in_tok = out_tok = 0
    cost = 0.0
    saw_usage = False
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = ev.get("type")
        if etype == "message_update":
            ame = ev.get("assistantMessageEvent") or {}
            if ame.get("type") in ("text_delta", "text") and res.ttft_ms is None:
                res.ttft_ms = (time.monotonic() - start) * 1000.0
        elif etype == "agent_end":
            for msg in ev.get("messages", []):
                if msg.get("role") != "assistant":
                    continue
                for c in msg.get("content", []):
                    if c.get("type") == "text":
                        text_parts.append(c.get("text", ""))
                u = msg.get("usage") or {}
                if u:
                    saw_usage = True
                    in_tok += int(u.get("input", 0) or 0)
                    out_tok += int(u.get("output", 0) or 0)
                    cost += float((u.get("cost") or {}).get("total", 0) or 0)
    err = proc.stderr.read() if proc.stderr else ""
    proc.wait()
    res.text = "\n".join(p for p in text_parts if p)
    if saw_usage:
        res.input_tokens, res.output_tokens, res.cost_usd = in_tok, out_tok, cost
    if proc.returncode != 0 or (not res.text and not saw_usage):
        res.error = err.strip() or f"pi exited {proc.returncode} with no output"
    return res


def run_claude(prompt: str, model: str) -> AgentResult:
    """Drive claude in one-shot JSON mode. ttft is not measured here."""
    res = AgentResult()
    cmd = ["claude", "-p", "--output-format", "json", "--model", model, prompt]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        res.error = proc.stderr.strip() or f"claude exited {proc.returncode}"
        return res
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        res.error = "could not parse claude JSON output"
        res.text = proc.stdout
        return res
    res.text = data.get("result", "") or ""
    usage = data.get("usage") or {}
    if usage:
        res.input_tokens = usage.get("input_tokens")
        res.output_tokens = usage.get("output_tokens")
    cost = data.get("total_cost_usd") or data.get("cost_usd")
    if cost is not None:
        res.cost_usd = float(cost)
    return res


# --- Acceptance test -----------------------------------------------------


def run_python_test(solution: str, test_snippet: str, timeout_s: int) -> tuple[bool, str]:
    program = f"{solution}\n\n# --- acceptance test ---\n{test_snippet}\n"
    try:
        proc = subprocess.run(
            [sys.executable, "-c", program],
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired:
        return False, f"timeout after {timeout_s}s"
    if proc.returncode == 0:
        return True, "acceptance test passed"
    return False, (proc.stderr.strip() or proc.stdout.strip() or "test failed")[-2000:]


# --- Main ----------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--agent", default="pi", choices=["pi", "claude"])
    ap.add_argument("--provider", default=None)
    root = Path(__file__).resolve().parent.parent
    ap.add_argument("--tasks-dir", default=str(root / "tasks"))
    ap.add_argument("--results-dir", default=str(root / "results"))
    args = ap.parse_args()

    task_file = Path(args.tasks_dir) / f"{args.task}.md"
    if not task_file.is_file():
        print(f"Task not found: {task_file}", file=sys.stderr)
        return 2

    meta, body = parse_frontmatter(task_file.read_text())
    language = meta.get("language", "python").lower()
    timeout_s = int(meta.get("timeout_s", 120))
    prompt = build_prompt(body, language)

    run_id = uuid.uuid4().hex[:12]
    started = datetime.now(timezone.utc)
    print(f">> task={args.task} model={args.model} agent={args.agent} run={run_id}")

    wall_start = time.monotonic()
    if args.agent == "pi":
        agent_res = run_pi(prompt, args.model, args.provider)
    else:
        agent_res = run_claude(prompt, args.model)
    wall_s = time.monotonic() - wall_start
    ended = datetime.now(timezone.utc)

    # Acceptance test
    result = "error"
    pass_at_1: bool | None = None
    notes_parts: list[str] = []

    if agent_res.error:
        notes_parts.append(f"agent error: {agent_res.error[:1000]}")
    else:
        if language != "python":
            notes_parts.append(f"acceptance test not implemented for language '{language}'")
            result = "no-test"
        else:
            test_snippet = extract_test_snippet(body)
            solution = extract_solution_code(agent_res.text, language)
            if test_snippet is None:
                notes_parts.append("no '## Test cases' block found in task")
                result = "no-test"
            elif solution is None:
                notes_parts.append("no code block found in agent output")
                result = "fail"
                pass_at_1 = False
            else:
                ok, msg = run_python_test(solution, test_snippet, timeout_s)
                pass_at_1 = ok
                result = "pass" if ok else "fail"
                notes_parts.append(msg)

    # Metrics
    ttft_ms = round(agent_res.ttft_ms, 1) if agent_res.ttft_ms is not None else None
    tokens_per_s: float | None = None
    if agent_res.output_tokens:
        # Decode throughput: generated tokens over generation time
        # (wall minus time-to-first-token). Falls back to wall if no ttft.
        gen_s = wall_s - (agent_res.ttft_ms / 1000.0 if agent_res.ttft_ms else 0.0)
        if gen_s > 0.05:
            tokens_per_s = round(agent_res.output_tokens / gen_s, 1)

    out = {
        "task": args.task,
        "model": args.model,
        "agent": args.agent,
        "run_id": run_id,
        "started_at": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ended_at": ended.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "metrics": {
            "wall_s": round(wall_s, 2),
            "ttft_ms": ttft_ms,
            "tokens_per_s": tokens_per_s,
            "input_tokens": agent_res.input_tokens,
            "output_tokens": agent_res.output_tokens,
            "cost_usd": round(agent_res.cost_usd, 6) if agent_res.cost_usd is not None else None,
        },
        "result": result,
        "pass_at_1": pass_at_1,
        "notes": " | ".join(notes_parts) or None,
    }

    results_dir = Path(args.results_dir)
    results_dir.mkdir(parents=True, exist_ok=True)
    date = started.strftime("%Y-%m-%d")
    out_file = results_dir / f"{date}-{args.model}-{args.task}.json"
    out_file.write_text(json.dumps(out, indent=2) + "\n")

    print(f">> result={result} pass_at_1={pass_at_1} tok/s={tokens_per_s} wall={out['metrics']['wall_s']}s")
    print(f">> wrote {out_file}")
    # Exit non-zero on error/fail so run.sh and CI can react.
    return 0 if result in ("pass", "no-test") else 1


if __name__ == "__main__":
    sys.exit(main())
