# Skills (Pi + Claude Code)

Skills are the one artifact that is **truly portable** between Pi and Claude Code — both discover them the same way: a folder with a `SKILL.md` file. This repo exploits that with a single canonical location and a symlink so both agents read the same bytes.

## Layout

```
skills/                      # canonical — edit here
└── <skill-name>/
    └── SKILL.md

.claude/skills -> ../skills  # symlink, read-only by Claude Code
```

Pi loads `skills/` via the `pi` manifest in `package.json` (`"skills": ["./skills"]`). Claude Code loads `.claude/skills/` — which is a symlink to `../skills`. One source of truth, two consumers.

## Writing a skill

A skill is a folder with a `SKILL.md` containing YAML frontmatter + Markdown body:

```
---
name: my-skill
description: Do X when the user asks for Y. Use when …
---

# My Skill

When invoked, follow these steps:
1. …
2. …
```

### Frontmatter conventions

| Field | Required | Notes |
|-------|----------|-------|
| `name` | **yes** | Must match the folder name. `check-skills.sh` enforces this. |
| `description` | **yes** | Claude Code uses this for **auto-triggering** — phrase it as "Do X. Use when …". Pi shows it in `/help` and skill listings. |

**Keep frontmatter minimal.** Don't use agent-specific fields like `allowed-tools`, `model`, or `imports` — they're either ignored by one agent or interpreted differently. If you truly need agent-specific behavior, put it in the Markdown body as conditional instructions ("If you're Claude Code, also …"), not in frontmatter.

### Body conventions

- Lead with a short **"When to use this skill"** sentence.
- Numbered steps for procedures.
- Reference files by repo-relative path (`benchmarks/tasks/<id>.md`), not absolute paths.
- Keep it agent-neutral. If something is truly Pi-only or Claude-only, say so explicitly in prose — don't split the skill.

## Sync guarantees

Because both agents read the same `SKILL.md` via symlink/package-manifest:

- Edit `skills/<name>/SKILL.md` → both agents see the new version on next load.
- No duplication, no drift, no sync step to forget.

`scripts/check-skills.sh` validates this on every commit (via `.githooks/pre-commit`):

1. Every `skills/*/SKILL.md` has `name` + `description` in frontmatter.
2. `name` matches the folder name.
3. `.claude/skills` is a symlink to `../skills` and resolves.
4. `CLAUDE.md` is a symlink to `AGENTS.md`.
5. The skill set visible via `.claude/skills` matches `skills/` (catches a broken symlink).

Run it manually any time:

```bash
scripts/check-skills.sh
```

## What is NOT synced

These stay agent-specific and are intentionally separate:

- **Slash commands** — Pi uses `prompts/*.md` (Pi template syntax); Claude Code uses `.claude/commands/*.md` (different frontmatter). Keep them in their own dirs.
- **Code extensions** — `extensions/*.ts` is Pi-only. Not portable.
- **Project memory** — `AGENTS.md` is canonical; `CLAUDE.md` is just a symlink to it (this *is* sync, by design).

## Why `bin/` helpers instead of inline logic

Several skills (notably `wiki-ingest`/`wiki-lint`/`wiki-query`) shell out to CLI helpers in `bin/` rather than embedding the logic in the `SKILL.md` body. This is a deliberate architecture decision, not ceremony:

- **Concern split.** `SKILL.md` holds LLM-driven steps (extract insights, synthesize answers, decide cross-references). `bin/` holds *deterministic* logic (grep, regex, date math, log-append). Deterministic code does not belong in a prompt — it belongs in a script that can be tested and pinned.
- **No drift between LLM runs and CI.** The same `bin/wiki-pii-scan` runs in a pre-commit hook *and* when the skill invokes it. If the logic lived in the body, the LLM would re-derive the regex on every run and drift from the hook within a session.
- **Compliance-relevant logic must not be improvised.** `wiki-pii-scan` matches IBAN/phone/email with a repo-local allowlist. The LLM must never "invent" a looser PII rule. Keeping it in a script with a pinned allowlist is the safety property.
- **Cross-repo reuse.** `bin/` helpers resolve paths against the *caller's* repo (`git rev-parse` in the CWD), not the script's location. A wiki skill running in repo A finds `A/wiki/` even though the script lives in `data-agent-lab/bin/`. This is what makes the wiki skills work in etl-scripts, controlling, operations — any repo with `wiki/`+`docs/` — via a per-repo `bin/` symlink (analogous to `.claude/skills`).
- **Portable body.** Because path resolution and deterministic steps go through `bin/`, the `SKILL.md` body stays harness-agnostic: Pi can adopt it 1:1 and only adjust frontmatter.

Trade-off accepted: three of the helpers (`wiki-root`, `docs-root`, `wiki-search`) are thin (~10 lines each). They exist anyway because the four "real" tools (`wiki-pii-scan`, `wiki-broken-links`, `wiki-stale-pages`, `wiki-log-append`) need a shared, consistent path resolver — inlining would duplicate the 3-stage resolution logic across four scripts and re-introduce exactly the drift the layer prevents.

`wiki-pii-scan` keeps its allowlist **repo-local** (`<repo-root>/etc/pii-allowlist`), not in data-agent-lab, because the allowlist content (e.g. `@sipgate.de`, service accounts) is organization-specific. The helper is generic; the data is not. A repo without an allowlist file runs strict (over-blocks rather than under-blocks).

See [`bin/README.md`](../bin/README.md) for the helper reference, setup, and cross-repo path-resolution details.

## Adding a skill

1. `mkdir skills/<name>`
2. Write `skills/<name>/SKILL.md` with `name` + `description` frontmatter.
3. Commit. The pre-commit hook verifies frontmatter + symlinks.
4. In Pi: `/reload` (or restart). In Claude Code: restart or open the project.

That's it — no separate install step for either agent.
