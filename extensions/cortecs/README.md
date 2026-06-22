# cortecs

A Pi extension that registers the [Cortecs AI](https://cortecs.ai) provider with Pi, fetching the live model list from the Cortecs API on startup.

## What it does

On Pi startup, the extension:

1. `GET https://api.cortecs.ai/v1/models` — fetches the available models.
2. Registers a `cortecs` provider with Pi using the OpenAI-compatible completions API.
3. Maps each model into Pi's model descriptor (`id`, `name`, `contextWindow`, `maxTokens`, cost = 0).

If the fetch fails (offline, no API key set, etc.), it falls back to registering the provider with an empty model list and logs an error — Pi won't crash, but model selection will be empty until the fetch succeeds.

## Requirements

- A Cortecs API key in the environment:

  ```bash
  export CORTECS_API_KEY="sk-..."
  ```

  The extension references it as `$CORTECS_API_KEY`; Pi substitutes env vars at provider construction time.

## Configuration

- **Provider id:** `cortecs`
- **Base URL:** `https://api.cortecs.ai/v1`
- **API flavor:** `openai-completions`
- **Default model:** set in Pi's `~/.pi/agent/settings.json` via `defaultModel`, e.g. `"glm-5.2"`. Make sure the model id you pick actually exists in the Cortecs catalog.
- **Reasoning flag:** hardcoded `false` for all models. Adjust per-model in `index.ts` if Cortecs ships reasoning models.

## Usage

After Pi loads the extension, the provider appears in `/model` selection and can be used as `defaultProvider` in settings:

```json
{
  "defaultProvider": "cortecs",
  "defaultModel": "glm-5.2"
}
```

## Files

- `index.ts` — the provider registration (async factory, fetches models on startup).

## Troubleshooting

- **Empty model list in `/model`** → the fetch failed. Check:
  - `CORTECS_API_KEY` is set (`echo $CORTECS_API_KEY`).
  - `curl https://api.cortecs.ai/v1/models` works from your shell.
  - Pi's stderr log for the `[Cortecs Extension]` error message.
- **Model id not found** → Cortecs renamed/removed it. Pick a current id from the API response.
