# agent-lab

A lab for coding-agent extensions, skills, prompts, and benchmarks.
Works with multiple agents (Pi, Claude Code) — agent-specific bits live in their
respective directories, shared content (skills, benchmarks, this file) is canonical.

## Repo layout

| Path | Purpose | Used by |
|------|---------|---------|
| `AGENTS.md` | canonical project memory (this file) | all AGENTS.md-aware tools |
| `CLAUDE.md` | symlink → `AGENTS.md` | Claude Code |
| `extensions/` | Pi TypeScript extensions | Pi |
| `skills/` | SKILL.md skill folders (canonical) | Pi + Claude Code |
| `.claude/skills` | symlink → `../../skills` | Claude Code |
| `.claude/commands/` | Claude Code slash commands | Claude Code |
| `prompts/` | Pi slash commands / prompt templates | Pi |
| `benchmarks/` | agent-agnostic benchmark tasks + results | all |
| `docs/` | notes, guides | humans |

## Conventions

- **One source of truth per artifact.** Skills live in `skills/`; both agents read them via symlink or package manifest. Don't duplicate.
- **`AGENTS.md` is canonical.** `CLAUDE.md` is a symlink to it — edit `AGENTS.md`, never `CLAUDE.md`.
- **Benchmarks are agent-agnostic.** A task is a markdown spec; results are JSON with model + metrics. No agent-specific code in tasks.
- **Pi extensions are TypeScript** under `extensions/`, one file per extension. Pi loads `.ts` and `.js`.
- **Skills follow the SKILL.md convention**: a folder with `SKILL.md` (+ optional scripts). Both Pi and Claude Code discover them the same way.

## Working in this repo

- When adding a skill: create `skills/<name>/SKILL.md`. It's automatically available to both Pi (via package manifest) and Claude Code (via `.claude/skills` symlink).
- When adding a Pi slash command: add `prompts/<name>.md`.
- When adding a Claude Code slash command: add `.claude/commands/<name>.md`.
- When adding a benchmark task: add `benchmarks/tasks/<name>.md` and record runs under `benchmarks/results/<date>-<model>.json`.

## Notes for agents

- Prefer canonical paths. If you're tempted to edit `CLAUDE.md`, edit `AGENTS.md` instead.
- Skills are shared — keep them agent-neutral. Agent-specific instructions go in `AGENTS.md` or the respective `commands/` / `prompts/` dirs.
- Before adding a new extension, check the Pi docs at `/home/arens/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`.
