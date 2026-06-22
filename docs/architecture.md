# Architecture & Decisions

Deep context on *why* this repo is laid out the way it is, and what's portable between agents. This is the reference behind the short rules in `AGENTS.md`.

## Portability matrix

The core insight from setting this up: **almost nothing is portable between Pi and Claude Code — except skills.**

| Artifact | Portable? | Pi location | Claude Code location | Sync mechanism |
|----------|-----------|-------------|---------------------|----------------|
| Project memory | ✅ | `AGENTS.md` | `CLAUDE.md` → symlink | `CLAUDE.md` is a symlink to `AGENTS.md` |
| Skills (`SKILL.md`) | ✅ | `skills/` | `.claude/skills` → symlink | `.claude/skills` symlinks to `../skills`; both agents read the same `SKILL.md` |
| Slash commands | ❌ | `prompts/*.md` | `.claude/commands/*.md` | none — different frontmatter syntax; keep separate |
| Code extensions | ❌ | `extensions/*.ts` | (none) | not portable — Pi runs TS via jiti, Claude has no equivalent |
| Benchmarks | ✅ (agnostic) | `benchmarks/` | `benchmarks/` | not agent-specific by design |
| Themes | ❌ | `themes/*.json` | (none) | Pi-only |

**Why skills are the exception:** both Pi and Claude Code adopted the same convention — a folder containing a `SKILL.md` with YAML frontmatter (`name`, `description`). The discovery paths differ, but a symlink bridges them. The frontmatter field that matters most is `description` — Claude uses it for **auto-triggering** (decides when to invoke the skill), so phrase it as "Do X. Use when …". See `docs/skills.md` for the conventions.

## Sync strategy

**One source of truth per artifact, exposed to both agents via symlink or package manifest.**

```
AGENTS.md  ◄── canonical              CLAUDE.md → AGENTS.md
skills/    ◄── canonical              .claude/skills → ../skills
extensions/  (Pi-only, no sync needed)
prompts/      (Pi-only)
.claude/commands/  (Claude-only)
```

- Editing `skills/<name>/SKILL.md` → both agents see it on next load. No duplication, no drift, no sync step.
- `AGENTS.md` is canonical; `CLAUDE.md` is just a symlink. Editing `CLAUDE.md` would edit `AGENTS.md` anyway, but the convention is to edit the canonical name directly.
- What is **not** synced (by design): slash commands and code extensions. Don't try to unify them — the formats genuinely differ.

`scripts/check-skills.sh` (run by `.githooks/pre-commit`) enforces the sync invariants:

1. Every `skills/*/SKILL.md` has `name` + `description` in frontmatter.
2. `name` matches the folder name.
3. `.claude/skills` → `../skills` and resolves.
4. `CLAUDE.md` → `AGENTS.md`.
5. The skill set visible via `.claude/skills` matches `skills/` (catches a broken symlink).

## Why this layout (decisions)

- **Pi is primary, Claude Code is fallback.** Canonical paths use Pi conventions (`skills/`, `prompts/`, `extensions/`); Claude gets symlinks. When in doubt, optimize for Pi.
- **Repo over loose dotfiles.** Extensions previously lived as loose files in `~/.pi/agent/extensions/`. Moving them into a versioned repo means: shareable, reviewable, `/reload`-able, and installable via `pi install git:…` or `pi install /path`. See `docs/extensions.md` for the migration.
- **AGENTS.md over CLAUDE.md.** `AGENTS.md` is the emerging cross-agent standard (Cursor, Codex, Gemini CLI, Copilot read it). Claude Code only reads `CLAUDE.md`, so `CLAUDE.md` is a symlink. One file, every agent.
- **Benchmarks agent-agnostic.** A task is a markdown spec; a run is a JSON result with model + metrics. No agent-specific code in tasks — the same task can run on Pi or Claude.

## How Pi loads this repo

Pi reads the `pi` manifest in `package.json`:

```json
{
  "keywords": ["pi-package"],
  "pi": { "extensions": ["./extensions"], "skills": ["./skills"], "prompts": ["./prompts"] }
}
```

- Auto-discovers both loose `*.ts` and `*/index.ts` under `extensions/`.
- TypeScript loaded via [jiti](https://github.com/unjs/jiti) — **no compile step**. Edit a `.ts`, run `/reload`, done.
- `keywords: ["pi-package"]` makes the package appear in the [pi.dev gallery](https://pi.dev/packages) if published to npm.

Install sources Pi accepts (in `settings.json` → `packages`):

```bash
pi install /home/arens/projects/agent-lab       # local path (this repo)
pi install git:github.com/martjn-net/agent-lab  # git
pi install npm:agent-lab                        # npm (after publishing)
```

## Migration footgun

When migrating extensions out of `~/.pi/agent/extensions/` into this repo, **Pi loads both locations in parallel**. If the same extension exists in two places, both copies try to register/override the same tool → "duplicate tool" errors.

Fix: install the repo as a package **and** remove the loose copies **and** restart Pi — in a fresh session, never while an agent is mid-task (`web-distill` overrides `fetch_content`/`web_search` live; removing it mid-session breaks the running agent). Full steps in `docs/extensions.md`.

## Session provenance

This repo was scaffolded in a single Pi session (2026-06-22). Key artifacts migrated from `~/.pi/agent/`:

- `extensions/web-distill/` ← `~/.pi/agent/extensions/web-distill.ts` (Pi tool override, shells out to a Python smart-fetch script)
- `extensions/cortecs/` ← `~/.pi/agent/extensions/cortecs/` (Pi provider registration)

See `docs/setup.md` for the fresh-machine install path, `docs/extensions.md` for extension authoring, `docs/skills.md` for skill conventions.
