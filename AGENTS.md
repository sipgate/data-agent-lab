# agent-lab

A versioned home for coding-agent **extensions, skills, prompts, and benchmarks**. Pi is the primary agent; Claude Code is a fallback. Both read the same shared artifacts (skills, project memory); agent-specific bits stay separate.

For the *why* behind these rules (portability matrix, sync design, migration rationale), see [`docs/architecture.md`](docs/architecture.md).

## Project decisions

- **Pi primary, Claude fallback.** Canonical paths use Pi conventions; Claude gets symlinks. When in doubt, optimize for Pi.
- **`AGENTS.md` is canonical project memory.** `CLAUDE.md` is a symlink to it — edit `AGENTS.md`, never `CLAUDE.md`. `AGENTS.md` is the cross-agent standard (Cursor, Codex, Gemini, Copilot read it too).
- **Skills are the one portable artifact.** Both agents read the same `SKILL.md` via `skills/` (canonical) and `.claude/skills` (symlink). Don't duplicate skills.
- **Slash commands and code extensions are NOT portable.** Keep Pi prompts in `prompts/`, Claude commands in `.claude/commands/`. `extensions/*.ts` is Pi-only.
- **Benchmarks are agent-agnostic** — a task is a markdown spec, a run is a JSON result with model + metrics.

## Where things live

| Path | Purpose | Used by |
|------|---------|---------|
| `AGENTS.md` | canonical project memory (this file) | all AGENTS.md-aware tools |
| `CLAUDE.md` → `AGENTS.md` | symlink | Claude Code |
| `skills/` | `SKILL.md` skill folders (canonical) | Pi + Claude Code |
| `.claude/skills` → `../skills` | symlink | Claude Code |
| `extensions/` | Pi TypeScript extensions | Pi only |
| `prompts/` | Pi slash commands | Pi only |
| `.claude/commands/` | Claude Code slash commands | Claude only |
| `benchmarks/` | tasks (md) + results (json) + scripts | all |
| `docs/` | deep context | humans |

## Working in this repo

- **Adding a skill:** `skills/<name>/SKILL.md` with `name` + `description` frontmatter. `/reload` Pi; reopen in Claude. See [`docs/skills.md`](docs/skills.md).
- **Adding a Pi extension:** `extensions/<name>/index.ts` + `README.md`. `/reload` Pi. See [`docs/extensions.md`](docs/extensions.md).
- **Adding a slash command:** `prompts/<name>.md` (Pi) or `.claude/commands/<name>.md` (Claude) — they don't share frontmatter, keep separate.
- **Adding a benchmark:** `benchmarks/tasks/<id>.md` (spec) + `benchmarks/results/<date>-<model>-<id>.json` (run).

## Rules for agents

- Never edit `CLAUDE.md` — edit `AGENTS.md`.
- Never duplicate a skill across `skills/` and `.claude/` — the symlink handles it.
- Keep skills agent-neutral. Agent-specific guidance goes here or in the `commands/`/`prompts/` dirs.
- Before deleting/migrating a Pi extension that's still in `~/.pi/agent/extensions/`, do it in a fresh Pi session — never mid-task (live tool overrides break otherwise).
- Pre-commit runs `scripts/check-skills.sh`. It will block commits that break the skill/symlink invariants.
- Pi extension API reference: `/home/arens/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` or [pi.dev/docs/latest/extensions](https://pi.dev/docs/latest/extensions).

## Deeper context

- [`docs/setup.md`](docs/setup.md) — fresh-machine install (Python deps, Browserless, env vars, `pi install`)
- [`docs/extensions.md`](docs/extensions.md) — Pi extension loading + migration from loose files + dev workflow
- [`docs/skills.md`](docs/skills.md) — skill conventions, frontmatter rules, sync guarantees
- [`docs/architecture.md`](docs/architecture.md) — portability matrix, sync design, why this layout
- [`TODO.md`](TODO.md) — open work, P0/P1/P2 priorities
