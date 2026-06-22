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

- [ ] **P2 — Second skill** beyond `benchmark-runner`
  - Candidate: `skills/extension-author/SKILL.md` — how to scaffold a new Pi extension in this repo (layout, `pi` manifest, `/reload` workflow, `check-skills.sh`).

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

- [ ] **P1 — Document pre-commit hook setup for fresh clones**
  - `git config core.hooksPath .githooks` is currently only set on this machine.
  - Add a "First-time setup" note to `docs/setup.md` and `README.md` so clones get the hook.

- [ ] **P2 — GitHub Actions workflow**
  - `.github/workflows/check.yml` — runs `scripts/check-skills.sh` on every PR.
  - Optional: run extension tests once they exist.

- [ ] **P2 — `check-skills.sh` in CI mode**
  - Local mode is colored + exit-code. Add a `--ci` flag (or auto-detect `CI=1`) for plain output, so GH Actions logs are readable.

## Decisions open

- [ ] **P1 — npm publish or stay local?**
  - `package.json` has `"private": true`. If you want `pi install npm:agent-lab` to work for others, flip to `private: false`, add `version`, `repository`, `author`, `license` fields, and `npm publish`.
  - If it stays personal, document that install is `pi install git:github.com/martjn-net/agent-lab` or local path only.

- [ ] **P2 — AGENTS.md content depth**
  - Current `AGENTS.md` is mostly repo-layout description. As the repo grows, add project-specific agent guidance (coding conventions, what to benchmark, how to review extensions). Keep it canonical — `CLAUDE.md` stays a symlink.
