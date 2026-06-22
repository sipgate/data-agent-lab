# web-distill

A Pi extension that overrides Pi's built-in `fetch_content` and `web_search` tools to route them through a local `web-distill` Python script. The script does smart fetching: fast HTTP first, with a headless Chromium (Browserless) fallback for JavaScript-heavy or bot-protected pages.

## What it does

- **`fetch_content`** — Fetches a URL and returns clean Markdown.
  - Fast path: plain `urllib` HTTP fetch with a desktop User-Agent.
  - Fallback path: if the page looks like a JS-only SPA, an empty shell, or triggers bot-detection heuristics (`__cf_chl_opt`, "enable javascript", "security challenge", …), it launches a headless Chromium via Browserless, scrolls the page, and extracts the rendered HTML.
  - Distillation: strips `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>`, `<iframe>`, `<form>`, `<svg>`, `<noscript>`, `<aside>`; prunes high-link-density sidebars; converts headings/links/paragraphs/lists/tables to Markdown.
  - Cookie persistence: cookies captured by the browser are saved to `/tmp/web_distill_cookies.json` per-domain and re-injected on subsequent fast fetches.
- **`web_search`** — DuckDuckGo HTML search, rendered via Browserless, parsed into Markdown with title/URL/snippet per result.

## Architecture

```
Pi LLM  ──►  fetch_content / web_search  (this extension)
                    │
                    ▼
        execFile(binaryPath, ["fetch" | "search", arg])
                    │
                    ▼
            extensions/web-distill/bin/web-distill   (Python 3 script)
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
   urllib HTTP             Browserless (localhost:3000)
   (fast path)             (Chromium fallback + search)
```

## Requirements

- **Python 3** on `PATH` (the `web-distill` script has a `#!/usr/bin/env python3` shebang).
- **Python packages:** `beautifulsoup4` (`bs4`). Install with:

  ```bash
  pip install --user beautifulsoup4
  # or: pipx inject ... ; or your venv manager
  ```

- **Browserless** running on `http://localhost:3000`. This is the headless Chromium service used for the fallback and for search. See [browserless.io](https://www.browserless.io/) or run it via Docker:

  ```bash
  docker run -d -p 3000:3000 ghcr.io/browserless/chromium
  ```

  Without Browserless, `fetch` still works for simple pages (fast HTTP path) but `search` and SPA/bot-protected pages will fail.

## Installation (three options)

The extension resolves the binary in this order:

1. **`WEB_DISTILL_BIN` env var** — point to any absolute path:

   ```bash
   export WEB_DISTILL_BIN=/usr/local/bin/web-distill
   ```

2. **Bundled binary** — already shipped in this repo at `extensions/web-distill/bin/web-distill`. Works out of the box once this repo is installed as a Pi package (see `docs/setup.md`).
3. **`~/.local/bin/web-distill`** — your personal install location (legacy/default).

To install the bundled binary into your user `~local/bin` instead (so other tools can use it too):

```bash
cp extensions/web-distill/bin/web-distill ~/.local/bin/web-distill
chmod +x ~/.local/bin/web-distill
```

## Configuration

There is no config file. Tune behavior by editing the script at `extensions/web-distill/bin/web-distill`:

- `BROWSERLESS_URL` — the Browserless endpoint (default `http://localhost:3000/function`).
- `COOKIE_FILE` — where cookies are cached (default `/tmp/web_distill_cookies.json`).
- `DEFAULT_UA` — User-Agent string.
- Scroll limit (5000px) and SPA heuristics — see `smart_fetch()`.

## Usage from Pi

Once the extension is loaded, the model calls `fetch_content` and `web_search` as usual — it doesn't see any difference, except the results come from `web-distill`. No special prompts needed.

## Files

- `index.ts` — the Pi extension (registers/overrides the two tools).
- `bin/web-distill` — the Python script that does the actual fetching and distillation.

## Troubleshooting

- **`web-distill binary not found`** in Pi logs → none of the three resolution paths found it. Set `WEB_DISTILL_BIN` or copy the bundled binary to `~/.local/bin/`.
- **`Error executing web-distill search: …`** → Browserless is not running on `localhost:3000`. Start it.
- **`bs4` import error** → `pip install --user beautifulsoup4`.
- Fast fetch returns an SPA shell → the heuristic should auto-fallback to Browserless. If it doesn't, lower the `visible_text_len < 1000` threshold in `smart_fetch()`.
