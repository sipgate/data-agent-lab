# Setup

Get this repo working with Pi on a fresh Linux machine.

## 1. Clone

```bash
git clone https://github.com/sipgate/data-agent-lab.git ~/projects/data-agent-lab
cd ~/projects/data-agent-lab
```

## 2. Python dependencies (for `web-distill`)

The bundled `extensions/web-distill/bin/web-distill` script needs Python 3 + `beautifulsoup4`:

```bash
sudo apt install python3 python3-pip    # or your distro's equivalent
pip install --user beautifulsoup4
```

Verify:

```bash
./extensions/web-distill/bin/web-distill fetch https://example.com
```

## 3. Browserless (for Chromium fallback + search)

`web-distill` falls back to headless Chromium for JS-heavy / bot-protected pages and for DuckDuckGo search. Run Browserless on `localhost:3000`:

```bash
docker run -d --restart=unless-stopped -p 3000:3000 \
  ghcr.io/browserless/chromium
```

Without Browserless, simple pages still fetch via the fast HTTP path; SPA/search will fail.

## 4. Environment variables

```bash
# Cortecs provider (for the cortecs extension)
export CORTECS_API_KEY="sk-..."

# Optional: override the web-distill binary path
# export WEB_DISTILL_BIN=/path/to/web-distill
```

Add these to `~/.bashrc` / `~/.zshrc` / your shell profile.

## 5. Install the repo as a Pi package

```bash
pi install ~/projects/data-agent-lab
```

This adds the repo to `~/.pi/agent/settings.json` → `packages`. Pi reads the `pi` manifest in `package.json` and loads `extensions/`, `skills/`, `prompts/`.

## 6. Remove any loose copies of migrated extensions

If you previously had these as loose files (the source of this repo), remove them so Pi doesn't load both copies:

```bash
rm ~/.pi/agent/extensions/web-distill.ts
rm -rf ~/.pi/agent/extensions/cortecs
```

Do this in a fresh Pi session, not while an agent is mid-task.

## 7. Configure Pi defaults (optional)

In `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "cortecs",
  "defaultModel": "glm-5.2"
}
```

## 8. Verify

Start Pi and check:

- `/model` lists Cortecs models → `cortecs` extension loaded.
- Ask Pi to fetch a URL → `fetch_content` runs via `web-distill` (stderr shows `[web-distill]` lines).
- `bash scripts/check-skills.sh` → all skill/symlink checks pass.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `web-distill binary not found` in Pi log | binary resolution failed — set `WEB_DISTILL_BIN`, or `pip`/binary issues above |
| `Error executing web-distill search` | Browserless not running on `:3000` |
| Empty model list in `/model` | `CORTECS_API_KEY` unset, or `curl https://api.cortecs.ai/v1/models` fails |
| `duplicate tool` errors on Pi start | you still have the loose copy in `~/.pi/agent/extensions/` — finish step 6 |
| Skills not visible in Claude Code | `.claude/skills` symlink broken — run `scripts/check-skills.sh` |
