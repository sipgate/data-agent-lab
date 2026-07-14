# Extensions

Pi TypeScript extensions live in subdirectories here. Each one has an `index.ts` entry point and a `README.md`.

- `web-distill/` — overrides Pi's `fetch_content` and `web_search` with a local smart-fetch script.
- `cortecs/` — registers the Cortecs AI provider.
- `jira/` — bridges the Jira lifecycle hooks into Pi's session/tool events.
- `slack/` — read-only Slack tools: list channels, read history/threads, look up users, search.

Pi auto-discovers both `*.ts` files and `*/index.ts` entries in this directory via the `pi` manifest in the repo root `package.json`.

See [`../docs/extensions.md`](../docs/extensions.md) for the full guide: loading, dev workflow, and migrating from loose `~/.pi/agent/extensions/` files.
