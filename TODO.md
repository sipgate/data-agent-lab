# TODO

Open work for `agent-lab`. Items grouped by area, with priority (P0 = next, P1 = soon, P2 = nice to have).

## Migration

- [ ] **P0 — Execute the Pi migration** (`docs/extensions.md` step 1–3)
  - [ ] In a fresh Pi session (not this one): `pi install /home/arens/projects/agent-lab`
  - [ ] Remove loose copies: `rm ~/.pi/agent/extensions/web-distill.ts` and `rm -rf ~/.pi/agent/extensions/cortecs`
  - [ ] Restart `pi`, verify `/model` lists Cortecs models and `fetch_content` goes through `web-distill`
  - [ ] Verify no "duplicate tool" errors in Pi startup log

- [ ] **P1 — Decide on `pi-web-access` (npm)**
  - It's installed in `~/.pi/agent/npm/node_modules/` but **not** in `settings.json` → `packages`. Meanwhile `web-distill` overrides the same tools (`fetch_content`, `web_search`).
  - Either `pi remove npm:pi-web-access` (if it was ever pinned) or leave it dormant. Document the decision in `docs/setup.md`.

## Benchmarks

- [ ] **P0 — Make `benchmarks/scripts/run.sh` real**
  - Currently a stub: prints `TODO: wire up agent invocation`, sets `PASS="unknown"`, writes a result JSON with `null` metrics.
  - Wire up actual Pi invocation: `pi -p "$(cat task.md)"` (print mode), capture stdout.
  - Capture real metrics: `ttft_ms`, `tokens_per_s`, `input_tokens`, `output_tokens`, `wall_s`. Pi exposes usage in the assistant message; either parse it or use `pi --json` mode.
  - Run the acceptance test from the task's `## Test cases` block against the generated code; set `pass_at_1` accordingly.

- [ ] **P0 — Commit a result schema (`benchmarks/results/EXAMPLE.json`)**
  - `benchmarks/results/` is empty (only `.gitkeep`); `run.sh` writes JSON but there's no documented shape. SWE-bench has an explicit predictions format — we need one too.
  - Add `EXAMPLE.json` as a schema reference: all fields (`task`, `model`, `agent`, `run_id`, `ttft_ms`, `tokens_per_s`, `input_tokens`, `output_tokens`, `wall_s`, `pass_at_1`, `result`) with example values.
  - Lets `run.sh` and the `benchmark-runner` skill validate output against a fixed contract.

- [ ] **P0 — Run the first real benchmark** (the original goal: GLM speed test)
  - `bash benchmarks/scripts/run.sh lru-cache glm-5.2 pi` once `run.sh` is real.
  - Commit the result JSON under `benchmarks/results/`.
  - Compare against a second model (e.g. Claude) to validate the harness.

- [ ] **P1 — Add more benchmark tasks**
  - Only `benchmarks/tasks/lru-cache.md` exists. Add:
    - [ ] `trie.md` — Trie with insert/search/autocomplete
    - [ ] `json-parser.md` — hand-rolled JSON parser (no `json` module)
    - [ ] `binary-search.md` — iterative + recursive variants
  - Each task: frontmatter (`id`, `language`, `difficulty`, `timeout_s`) + spec + acceptance test cases.

- [ ] **P2 — `benchmarks/results/.gitkeep` cleanup**
  - Remove once the first real result JSON lands.

## Skills & Prompts

- [ ] **P1 — Add a `/bench` slash command** (both agents)
  - Pi: `prompts/bench.md` — expands to "run benchmark $1 with model $2"
  - Claude: `.claude/commands/bench.md` — same intent, Claude frontmatter
  - These are intentionally separate files (different frontmatter syntax); document the duplication in `docs/skills.md` under "What is NOT synced".
  - ⚠️ This would be the first canonical content in `.claude/` (currently symlink-only). See the Claude-removability invariant below before adding it.

- [ ] **P2 — Second skill** beyond `benchmark-runner`
  - Candidate: `skills/extension-author/SKILL.md` — how to scaffold a new Pi extension in this repo (layout, `pi` manifest, `/reload` workflow, `check-skills.sh`).

- [ ] **P2 — Use richer SKILL.md frontmatter (`allowed-tools`/`disallowed-tools`)**
  - Current skills use only `name`+`description`. The fuller schema supports `allowed-tools`/`disallowed-tools` (security: restrict what a skill can invoke), `disable-model-invocation`, `user-invocable`.
  - `benchmark-runner` should declare `allowed-tools: bash,read` so it can't edit files mid-benchmark. See `docs/skills.md` for the frontmatter reference.

## Extensions

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
  - Add `CONTRIBUTING.md` covering: clone, `git config core.hooksPath .githooks`, `pi install /path/to/agent-lab` (or `git:github.com/martjn-net/agent-lab`), env vars (`$CORTECS_API_KEY`), the rule that `~/.pi/agent/models.json` is local-only (never committed).
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
  - `package.json` has `"private": true`. If you want `pi install npm:agent-lab` to work for others, flip to `private: false`, add `version`, `repository`, `author`, `license` fields, and `npm publish`.
  - If it stays personal, document that install is `pi install git:github.com/martjn-net/agent-lab` or local path only.

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
