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
└── docs/
```

## Use with Pi

Install this repo as a Pi package:

```bash
pi install git:github.com/martjn-net/agent-lab
# or locally:
pi install ./path/to/agent-lab
```

Pi will discover `extensions/`, `skills/`, and `prompts/` via the `pi` manifest in `package.json`.

## Use with Claude Code

Open the repo in Claude Code. It reads `CLAUDE.md` (→ `AGENTS.md`) and discovers skills via `.claude/skills` (→ `skills/`). Slash commands live in `.claude/commands/`.

## Benchmarks

See [`benchmarks/README.md`](benchmarks/README.md). TL;DR:

```bash
bash benchmarks/scripts/run.sh lru-cache glm-4.6 pi
python3 benchmarks/scripts/summary.py
```

## License

MIT
