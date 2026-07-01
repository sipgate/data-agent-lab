# Extensions

This repo ships Pi extensions under `extensions/`. Each extension lives in its own subdirectory with an `index.ts` entry point and a `README.md`:

```
extensions/
├── web-distill/      # overrides fetch_content + web_search
│   ├── index.ts
│   ├── bin/web-distill   # the Python script it shells out to
│   └── README.md
└── cortecs/          # registers the cortecs provider
    ├── index.ts
    └── README.md
```

Pi auto-discovers both layouts under `extensions/`: loose `*.ts` files and `*/index.ts` subdirectory entries.

## How Pi loads these extensions

The repo's `package.json` declares the `pi` manifest:

```json
{
  "name": "data-agent-lab",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  }
}
```

When you install this repo as a Pi package, Pi reads the `pi.extensions` glob and loads every `index.ts` (and `*.ts`) it finds under `extensions/`. TypeScript is loaded via [jiti](https://github.com/unjs/jiti) — no compile step, edits are picked up on `/reload`.

## Migrating from loose `~/.pi/agent/extensions/` to this repo

Pi discovers extensions from several locations in parallel. If the same extension exists in two places, both copies load and **both try to register/override the same tool**, which produces "duplicate tool" errors. You must keep each extension in exactly one place.

The migration is three steps:

### 1. Install this repo as a Pi package

```bash
pi install /home/arens/projects/data-agent-lab
```

This appends the repo path to `packages` in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "npm:pi-subagents",
    "npm:pi-mcp-adapter",
    "npm:pi-lens",
    "/home/arens/projects/data-agent-lab"
  ]
}
```

Local paths are added without copying — Pi reads from the working tree, so `git pull` is enough to get updates.

### 2. Remove the old loose copies

```bash
rm ~/.pi/agent/extensions/web-distill.ts
rm -rf ~/.pi/agent/extensions/cortecs
```

⚠️ Do this in a **fresh** Pi session, not while an agent is mid-task — `web-distill` overrides `fetch_content` / `web_search`, and deleting it mid-session can leave the running agent without those tools until restart.

### 3. Restart Pi

```bash
pi
```

In the new session, verify both extensions loaded:

```
/model          # cortecs provider + its models should be listed
```

And `fetch_content` / `web_search` now come from `extensions/web-distill/index.ts` in the repo.

## Dev workflow

Once the repo is installed as a package:

1. Edit `extensions/<name>/index.ts` in the repo.
2. In Pi, run `/reload`.
3. Pi re-reads the package manifest and hot-reloads the TypeScript via jiti.

No rebuild, no reinstall. The bundled Python binary (`extensions/web-distill/bin/web-distill`) is a plain script — edit it directly, changes apply on the next tool call.

## Adding a new extension

1. Create `extensions/<name>/index.ts` exporting a default factory:

   ```typescript
   import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

   export default function (pi: ExtensionAPI) {
     pi.registerTool({ /* ... */ });
   }
   ```

2. Add `extensions/<name>/README.md` documenting what it does, its requirements, and how to configure it.
3. `/reload` in Pi — the new extension is picked up automatically.

See the [Pi extensions docs](https://pi.dev/docs/latest/extensions) for the full API (`registerTool`, `registerCommand`, `on(event, …)`, `registerProvider`, …).

## Sharing beyond this machine

Because the repo has `keywords: ["pi-package"]` and a `pi` manifest, it can also be installed from a remote:

```bash
pi install git:github.com/sipgate/data-agent-lab
# or after publishing to npm:
pi install npm:data-agent-lab
```

For private use, the local path install above is enough.
