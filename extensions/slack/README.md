# slack (read-only)

Pi/omp extension that exposes **read-only** Slack tools to the agent: list
channels, read channel history and threads, look up users, and (with a user
token) search messages. It never writes to Slack.

## Read-only guarantee

Every Slack call goes through a single `slackCall` helper that rejects any
method not in a hardcoded allow-list (`auth.test`, `conversations.list`,
`conversations.history`, `conversations.replies`, `conversations.info`,
`users.info`, `users.list`, `users.lookupByEmail`, `search.messages`). There is
no code path that can post, edit, delete, join, or react — read-only is
structural, not a convention. All requests are HTTP `GET`.

## Tools

| Tool | What it does |
|------|--------------|
| `slack_auth_test` | Verify the token; show bot/user identity, workspace, and granted scopes. |
| `slack_list_channels` | List conversations. Filter by `types`, `name_contains`, `member_only`, `limit`. |
| `slack_history` | Read a channel's recent messages (by `#name` or ID), oldest→newest; optional `include_threads`. |
| `slack_replies` | Read one thread: parent + replies (`channel` + `thread_ts`). |
| `slack_user` | Look up a user by `user` ID or by `email`. |
| `slack_search` | Search messages (Slack query syntax). **Needs a user token** — see below. |

Messages are formatted `[YYYY-MM-DD HH:MM] Name: text`, with `<@U…>` mentions,
`<#C…|name>` channel links, and `<url|label>` links resolved to readable form,
plus file and thread markers. User and channel names are cached per session.

## Setup

### 1. Provide a token via the environment

The extension reads `SLACK_BOT_TOKEN` (preferred) or `SLACK_TOKEN`. Nothing is
hardcoded. Set it in the shell that launches omp — e.g. from a 1Password item:

```bash
export SLACK_BOT_TOKEN="op://Private/Slack Bot Token/credential"   # then run under `op run`
# or directly:
export SLACK_BOT_TOKEN="xoxb-…"
```

This workspace already has a **read-scoped** bot (`alarm_report`) used by
`oncall-reports/`; its scopes are `channels:history, channels:read,
groups:history, mpim:history, im:history, users:read`. That token drives every
tool here except `slack_search`.

### 2. Scopes

| Capability | Required scope | Token type |
|------------|----------------|-----------|
| list / history / replies / channel info | `channels:read`, `channels:history` (+ `groups:*`/`im:*`/`mpim:*` for private/DM) | bot `xoxb-…` |
| user lookup | `users:read` (`users:read.email` for email lookup) | bot `xoxb-…` |
| `slack_search` | `search:read` | **user** `xoxp-…` (bots cannot search) |

### 3. Channel membership

`conversations.history`/`replies` only work for channels the token's identity is
a **member** of. For others Slack returns `not_in_channel`; the tool surfaces a
hint. This read-only extension deliberately cannot self-join — invite the bot in
Slack (`/invite @alarm_report`) if you need a channel it isn't in.

### 4. Proxy (only if your network requires one)

On egress-restricted networks (e.g. the sipgate analytics server) set
`HTTPS_PROXY` and run omp under a runtime whose `fetch` honors it (Bun does
natively). Workstations with direct egress need nothing. The extension adds no
proxy dependency of its own.

## Errors

Tool results set `isError` and include the Slack error code plus a hint for the
common ones (`not_in_channel`, `not_allowed_token_type`, `missing_scope`,
`invalid_auth`, `ratelimited`, …) and the token's reported scopes, so setup
problems are self-diagnosing. Verify a fresh setup with `slack_auth_test`.

## Development

Auto-discovered via the `pi.extensions` entry in the repo root `package.json`.
After edits, run `/reload` in omp to hot-reload (jiti, no build step). The tool
logic is covered by a mocked-`fetch` smoke test that also asserts every request
targets an allow-listed read method.
