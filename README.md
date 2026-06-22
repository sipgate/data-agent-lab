# agent-lab

A lab for coding-agent **extensions, skills, prompts, and benchmarks**.
Built to work with multiple agents — primarily [Pi](https://pi.dev) and [Claude Code](https://code.claude.com).

## Why

Coding-agent customizations (skills, prompts, extensions) tend to live in scattered dotfiles and don't get versioned or shared. Benchmarks are toy and ad-hoc. This repo collects both in one place, with:

- **One source of truth per artifact.** Skills live in `skills/`; both agents read them.
- **`AGENTS.md` as canonical project memory.** `CLAUDE.md` is a symlink (Claude Code reads `CLAUDE.md`, the wider ecosystem reads `AGENTS.md`).
- **Agent-agnostic benchmarks.** A task is a markdown spec; a run is a JSON result with model + metrics.

## Layout

```
agent-lab/
├── AGENTS.md                 # canonical project memory
├── CLAUDE.md → AGENTS.md     # symlink (Claude Code)
├── package.json              # Pi package manifest
├── extensions/               # Pi TypeScript extensions
│   ├── web-distill/          #   overrides fetch_content + web_search
│   └── cortecs/               #   registers the cortecs provider
├── skills/                   # SKILL.md skills (canonical — both agents)
├── .claude/
│   ├── skills → ../skills    # symlink (Claude Code reads SKILL.md too)
│   ├── commands/             # Claude Code slash commands
│   └── settings.json
├── prompts/                  # Pi slash commands / prompt templates
├── benchmarks/
│   ├── tasks/                # task specs (markdown)
│   ├── results/              # run results (JSON)
│   ├── scripts/              # runner + summary
│   └── README.md
├── scripts/check-skills.sh   # pre-commit skill/symlink sanity checks
└── docs/
    ├── setup.md              # full install guide (Python, Browserless, Pi)
    ├── extensions.md         # Pi extension layout + migration from loose files
    └── skills.md             # how to write skills that work on Pi + Claude Code
```

## Getting started

See [`docs/setup.md`](docs/setup.md) for the full install guide. TL;DR:

```bash
pi install ~/projects/agent-lab
```

Pi will discover `extensions/`, `skills/`, and `prompts/` via the `pi` manifest in `package.json`. If you're migrating these extensions out of `~/.pi/agent/extensions/`, follow [`docs/extensions.md`](docs/extensions.md) so you don't end up with duplicate copies loaded.

## Use with Claude Code

Open the repo in Claude Code. It reads `CLAUDE.md` (→ `AGENTS.md`) and discovers skills via `.claude/skills` (→ `skills/`). Slash commands live in `.claude/commands/`. See [`docs/skills.md`](docs/skills.md) for the skill-writing conventions that keep both agents in sync.

## Benchmarks

See [`benchmarks/README.md`](benchmarks/README.md). TL;DR:

```bash
bash benchmarks/scripts/run.sh lru-cache glm-4.6 pi
python3 benchmarks/scripts/summary.py
```

## License

MIT
