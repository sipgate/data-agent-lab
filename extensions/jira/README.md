# jira

Pi extension that wires the existing Jira lifecycle hooks (originally written
for Claude Code) into Pi's lifecycle events. The Python hook scripts stay in
`/usr/local/etl-scripts/jira/` — this extension only adapts the I/O contract.

## Why

Claude Code declares project-local hooks in
`/usr/local/etl-scripts/.claude/settings.json` (`SessionStart`,
`UserPromptSubmit`, `PostToolUse`, `Stop`). Pi has no `.claude/settings.json`
equivalent; instead it exposes lifecycle events via the extension API. This
extension bridges the two so the same Jira automation (ticket auto-activation,
commit comments, activity nudges, session summaries) runs in Pi too.

The Claude-side hooks are intentionally left untouched — both agents share the
same Python scripts, so behavior stays in sync.

## Mapping

| Claude hook | Pi event | Script | Injects context? |
|-------------|----------|--------|-----------------|
| `SessionStart` | `session_start` (+ `before_agent_start`) | `sessionStart.py` | yes (message, once) |
| `UserPromptSubmit` | `before_agent_start` | `detectTicket.py` | yes (message) |
| `PostToolUse(Bash)` | `tool_result` (bash, success) | `onCommit.py` | no (side effect) |
| `PostToolUse(Edit\|Write)` | `tool_result` (edit/write) | `activityReminder.py` | yes (appended to result) |
| `Stop` | `agent_end` | `sessionEnd.py` | no (side effect) |

## How it adapts the I/O contract

- **Input:** Claude pipes a JSON payload via stdin; `lib.py`'s `run_hook`
  reads it. The extension synthesizes that payload from the Pi event fields
  (e.g. `{prompt: event.prompt}` for `detectTicket`, `{tool_input:{command}}`
  for `onCommit`, `{session_id}` for `activityReminder`).
- **Output:** the scripts print `{"additionalContext": "..."}` (or the
  `hookSpecificOutput` variant) to stdout. The extension parses it and
  injects it back into Pi via a `before_agent_start` message or by appending
  to the `tool_result` content.

## Scope

Active only when `process.cwd()` is under `/usr/local/etl-scripts` (matches
Claude's project-local scope). Edit `ACTIVE_CWDS` to widen.

## Session-context file

`lib.py`'s `_session_key()` walks the PPID chain for a process named `claude`.
Under Pi it falls back to the literal key `global`, so the context file is
`.jira_context.global` in `CONTEXT_DIR`. Hooks **and** the skills
(`jira/cli.py`) share that file, so the context is coherent within a Pi
process. Claude uses `.jira_context.<claude-pid>` filenames, so Pi and Claude
do not collide.

Caveat: two parallel Pi sessions share `global` (no per-session isolation).
Single-session use — the common case — is unaffected.

## Preconditions (same as the skills)

- `op` (1Password CLI) signed in — `etc/claude.env` references `JIRA_EMAIL`
  and `JIRA_API_TOKEN` via `op://` items.
- `/usr/local/etl-scripts/libs/miniconda3/bin/python3` present.
- Run Pi from `/usr/local/etl-scripts` (or another entry in `ACTIVE_CWDS`).

## Development

This extension is auto-discovered via the `pi.extensions` entry in the repo
root `package.json`. After edits, run `/reload` in Pi to hot-reload.
