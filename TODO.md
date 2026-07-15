# TODO

Open work for `data-agent-lab`. Items grouped by area, with priority (P0 = next, P1 = soon, P2 = nice to have).

## Migration

- [ ] **P0 — Execute the Pi migration** (`docs/extensions.md` step 1–3)
  - [ ] In a fresh Pi session (not this one): `pi install /home/arens/projects/data-agent-lab`
  - [ ] Remove loose copies: `rm ~/.pi/agent/extensions/web-distill.ts` and `rm -rf ~/.pi/agent/extensions/cortecs`
  - [ ] Restart `pi`, verify `/model` lists Cortecs models and `fetch_content` goes through `web-distill`
  - [ ] Verify no "duplicate tool" errors in Pi startup log

- [ ] **P1 — Decide on `pi-web-access` (npm)**
  - It's installed in `~/.pi/agent/npm/node_modules/` but **not** in `settings.json` → `packages`. Meanwhile `web-distill` overrides the same tools (`fetch_content`, `web_search`).
  - Either `pi remove npm:pi-web-access` (if it was ever pinned) or leave it dormant. Document the decision in `docs/setup.md`.

## Benchmarks

- [x] **P0 — Make `benchmarks/scripts/run.sh` real** (done 2026-07-03)
  - Logic now lives in `benchmarks/scripts/runner.py`; `run.sh` is a thin wrapper.
  - Drives `pi --mode json -nt -p` (full metrics) or `claude -p --output-format json`. Stream-parses `ttft_ms` from the first `text_delta`, sums `input/output_tokens` + `cost_usd` from `agent_end` usage.
  - Extracts the solution code block from the answer, appends the task's `## Test cases` block, runs it under `timeout_s`, sets `pass_at_1`. Exit `0` pass/no-test, `1` fail/error.

- [x] **P0 — Commit a result schema (`benchmarks/results/EXAMPLE.json`)** (done 2026-07-03)
  - Documents all fields incl. `run_id`, `cost_usd`. `summary.py` skips it during aggregation.

- [ ] **P0 — Run the first real benchmark** (the original goal: GLM speed test) — BLOCKED on credentials
  - Harness is ready; verified end-to-end on the error path (no key → clean `error` result + exit 1). Live run needs a provider login.
  - No API key in env or `~/.pi/agent/models.json`, `settings.json` provider is `null`. First: `pi /login` (or set `models.json` for the GLM provider, e.g. `zai`).
  - Then: `bash benchmarks/scripts/run.sh lru-cache glm-4.6 pi zai`, commit the result JSON, compare against `... claude-opus-4-8 claude` to validate.

- [ ] **P1 — Add more benchmark tasks**
  - Only `benchmarks/tasks/lru-cache.md` exists. Add:
    - [ ] `trie.md` — Trie with insert/search/autocomplete
    - [ ] `json-parser.md` — hand-rolled JSON parser (no `json` module)
    - [ ] `binary-search.md` — iterative + recursive variants
  - Each task: frontmatter (`id`, `language`, `difficulty`, `timeout_s`) + spec + acceptance test cases.

- [x] **P2 — `benchmarks/results/.gitkeep` cleanup** (done 2026-07-03)
  - Removed; `EXAMPLE.json` now keeps the dir tracked.

## Skills & Prompts

- [ ] **P1 — Add a `/bench` slash command** (both agents)
  - Pi: `prompts/bench.md` — expands to "run benchmark $1 with model $2"
  - Claude: `.claude/commands/bench.md` — same intent, Claude frontmatter
  - These are intentionally separate files (different frontmatter syntax); document the duplication in `docs/skills.md` under "What is NOT synced".
  - ⚠️ This would be the first canonical content in `.claude/` (currently symlink-only). See the Claude-removability invariant below before adding it.

- [ ] **P2 — Second skill** beyond `benchmark-runner`
  - Candidate: `skills/extension-author/SKILL.md` — how to scaffold a new Pi extension in this repo (layout, `pi` manifest, `/reload` workflow, `check-skills.sh`).

- [x] **P2 — Curated `allowed-tools` in every SKILL.md** (adopted 2026-07-14)
  - Decision: keep a curated `allowed-tools` whitelist on every skill (Claude-Code sandboxing), reconciled with `docs/skills.md` (which no longer forbids it). `model`/`imports` stay out of frontmatter; `disable-model-invocation`/`disallowed-tools` remain available if ever needed.
  - Rolled out across all 17 skills; naming per `docs/skills.md` (built-ins TitleCase, MCP `mcp__server__tool`, extension tools by registered name). Removed the dead `mcp__claude_ai_Slack__*` refs from `pipeline-check`/`pipeline-obr`.

## Extensions

- [ ] **P1 — Slack token/access for the `slack` extension** (blocks read-only Slack usage)
  - The `slack` extension itself works — verified `slack_auth_test` = ok as bot `alarm_report` (U069SKWCW0H) — but that bot is **`not_in_channel`** for the channels it is meant to read: `#data-engineering-monitoring` (C04S1RXASTV) and `#airbyte-monitoring` (C0ASJ07UMRQ). `slack_history`/`slack_replies` return `not_in_channel` there (same limitation as #obr).
  - Token scopes are read-only: `channels:history,channels:read,groups:history,mpim:history,im:history,users:read` — no `channels:join` (cannot self-join) and no user token (so `slack_search` would need `search:read` on an `xoxp-…` token).
  - Fix: (a) invite the bot into the target channels (`/invite @alarm_report`), or (b) provision a dedicated read-scoped Slack app + `SLACK_BOT_TOKEN` (plus an `xoxp-…` user token with `search:read` for `slack_search`).
  - Until fixed, `/pipeline-check`'s Slack steps (1a/1a-2) have no data source and fall back to Loki only.

- [ ] **P1 — Tests for `web-distill`**
  - Mock `execFile` and assert the tool calls the binary with `["fetch", url]` / `["search", query]`.
  - Test binary resolution order: `WEB_DISTILL_BIN` → bundled → `~/.local/bin`.
  - Test the offline/error path returns `isError`-ish content.

- [ ] **P1 — Tests for `cortecs`**
  - Mock `fetch` to return a fixture model list; assert `pi.registerProvider` is called with the right shape.
  - Test the offline fallback (fetch rejects) → provider still registered with empty models.

- [ ] **P2 — Hardened `web-distill` config**
  - `BROWSERLESS_URL` and `COOKIE_FILE` are hardcoded in the Python script. Move to env vars with defaults, document in `extensions/web-distill/README.md`.

- [ ] **P2 — New extension: benchmark-runner as a tool**
  - Pi extension that exposes `run_benchmark(task, model)` as a tool the LLM can call directly, instead of shelling out via `run.sh`. Writes the result JSON itself.

## CI & Tooling

- [ ] **P1 — `CONTRIBUTING.md` + first-time setup for fresh clones**
  - `git config core.hooksPath .githooks` is currently only set on this machine — fresh clones get no hook.
  - Add `CONTRIBUTING.md` covering: clone, `git config core.hooksPath .githooks`, `pi install /path/to/data-agent-lab` (or `git:github.com/sipgate/data-agent-lab`), env vars (`$CORTECS_API_KEY`), the rule that `~/.pi/agent/models.json` is local-only (never committed).
  - Reference it from `README.md` quickstart and `docs/setup.md`.

- [ ] **P2 — GitHub Actions workflow**
  - `.github/workflows/check.yml` — runs `scripts/check-skills.sh` on every PR.
  - Optional: run extension tests once they exist.

- [ ] **P2 — `check-skills.sh` in CI mode**
  - Local mode is colored + exit-code. Add a `--ci` flag (or auto-detect `CI=1`) for plain output, so GH Actions logs are readable.

## Decisions open

- [ ] **P1 — Complete `package.json` to Pi package conventions**
  - Every Pi example `package.json` has `"type": "module"`, `"version"`, `"scripts": {clean,build,check}`, `repository`, `license`, `engines`. Ours has only `name`, `version: 0.0.0`, `private`, `pi` manifest.
  - Add `"type": "module"` (extensions are ESM TS), `"scripts": {"check": "bash scripts/check-skills.sh", "test": "..."}`, `"repository"`, `"license"`, `"engines": {"node": ">=18"}`.
  - Prerequisite for the `npm publish` decision below and for `pi install git:...` to be well-formed for others.

- [ ] **P1 — npm publish or stay local?**
  - `package.json` has `"private": true`. If you want `pi install npm:data-agent-lab` to work for others, flip to `private: false`, add `version`, `repository`, `author`, `license` fields, and `npm publish`.
  - If it stays personal, document that install is `pi install git:github.com/sipgate/data-agent-lab` or local path only.

- [ ] **P1 — Rework `AGENTS.md` to be operations-first**
  - Current `AGENTS.md` is mostly repo-layout description. Research (morphllm AGENTS.md spec, groff 3-tier) warns layout-heavy agent-memory files perform worse — every line should be info the agent can't derive from code/manifest/README.
  - Add: **Build/Test/Lint commands** with exact flags (blocked on tests existing); **Security/Secrets section** (API keys live in `~/.pi/agent/models.json`, never in repo; use `$VAR` substitution; never commit `models.json`); **Boundaries** (add "never commit secrets", "never touch `models.json`" alongside the existing "never edit `CLAUDE.md`").
  - Trim: the "Where things live" table is derivable from the filesystem — shorten to a one-liner pointing at the tree, or defer to `docs/architecture.md` (already there).
  - Keep `CLAUDE.md` as symlink to `AGENTS.md`.

- [ ] **P2 — Add `docs/agent-guides/` (tier-3 deep reference)**
  - groff 3-tier architecture: Tier 1 = `AGENTS.md` (universal, <100 lines), Tier 2 = skills (on-demand), Tier 3 = `docs/agent-guides/` (deep reference loaded only when needed).
  - Candidates: `build-test-verify.md` (every lint/test/build command + expected output), `core-conventions.md` (tab indentation, extension layout, skill frontmatter rules).
  - Skills point to these instead of duplicating content (prevents drift).

- [ ] **P1 — Invariant: keep `.claude/` symlink-only (Claude removability)**
  - Assessed 2026-06-22: Claude is a pure symlink adapter — `CLAUDE.md → AGENTS.md`, `.claude/skills → ../skills`, `.claude/commands/` has no real commands. Removing Claude entirely is a ~45-min adapter-off operation with zero content loss.
  - Guardrail: never put canonical content in `.claude/commands/` or `.claude/skills/`. Portable artifacts go in `skills/`/`prompts/`/`AGENTS.md` (canonical Pi paths); Claude reads via symlink. If a Claude-only artifact is truly needed, document the coupling cost first.
  - Runbook if Claude is dropped for good: `rm -rf .claude CLAUDE.md` + strip the 2 symlink-check blocks from `check-skills.sh` + drop the Claude column from `docs/architecture.md` and the "Used by" table in `AGENTS.md`.
