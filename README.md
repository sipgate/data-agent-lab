# data-agent-lab

A versioned home for coding-agent **extensions, skills, prompts, and benchmarks**. Built around [Pi](https://pi.dev) (primary) with [Claude Code](https://code.claude.com) as a fallback — both read the same shared artifacts, agent-specific bits stay separate.

**Why this exists:** coding-agent customizations tend to live as scattered, unversioned dotfiles, and benchmarks are ad-hoc. This repo collects both in one place, with one source of truth per artifact and agent-agnostic benchmarks.

> How the two agents share artifacts (and what doesn't port) is in [`docs/architecture.md`](docs/architecture.md).

## Quick start

```bash
# 1. clone
git clone https://github.com/sipgate/data-agent-lab.git ~/projects/data-agent-lab
cd ~/projects/data-agent-lab

# 2. enable the pre-commit hook (skill/symlink sanity checks)
git config core.hooksPath .githooks

# 3. install python deps for the web-distill extension
pip install --user beautifulsoup4

# 4. install this repo as a Pi package
pi install ~/projects/data-agent-lab

# 5. (if migrating from loose extensions) remove old copies in a fresh Pi session
rm ~/.pi/agent/extensions/web-distill.ts
rm -rf ~/.pi/agent/extensions/cortecs

# 6. start Pi
pi
```

Full setup (Browserless for Chromium fallback, env vars, verification) → [`docs/setup.md`](docs/setup.md).

## What's inside

```
data-agent-lab/
├── AGENTS.md                  # canonical project memory (CLAUDE.md symlinks here)
├── extensions/                # Pi TypeScript extensions
│   ├── web-distill/           #   overrides fetch_content + web_search
│   └── cortecs/               #   registers the cortecs provider
├── skills/                    # SKILL.md skills — portable across both agents
├── prompts/                   # Pi slash commands
├── .claude/
│   ├── skills → ../skills     # symlink (Claude reads the same SKILL.md)
│   └── commands/              # Claude Code slash commands
├── benchmarks/                # agent-agnostic task specs + results + runner
├── scripts/check-skills.sh    # pre-commit skill/symlink validation
└── docs/                      # deep context
```

## Use with Pi

`pi install ~/projects/data-agent-lab` adds the repo to `~/.pi/agent/settings.json` → `packages`. Pi reads the `pi` manifest in `package.json` and auto-discovers `extensions/`, `skills/`, and `prompts/`. TypeScript loads via jiti — edit a `.ts` and `/reload`, no compile step.

## Use with Claude Code

Open the repo in Claude Code. It reads `CLAUDE.md` (→ `AGENTS.md`) and discovers skills via `.claude/skills` (→ `skills/`). Slash commands live in `.claude/commands/`.

## Benchmarks

```bash
bash benchmarks/scripts/run.sh lru-cache glm-5.2 pi
python3 benchmarks/scripts/summary.py
```

Tasks are markdown specs; results are JSON with model + metrics. See [`benchmarks/README.md`](benchmarks/README.md).

## Documentation

| Doc | What it covers |
|-----|----------------|
| [`docs/setup.md`](docs/setup.md) | Fresh-machine install guide |
| [`docs/architecture.md`](docs/architecture.md) | Portability matrix, sync design, why this layout |
| [`docs/extensions.md`](docs/extensions.md) | Pi extension loading + migration from loose files |
| [`docs/skills.md`](docs/skills.md) | Skill-writing conventions for Pi + Claude Code |
| [`TODO.md`](TODO.md) | Open work, P0/P1/P2 priorities |

## License

MIT
