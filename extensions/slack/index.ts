/**
 * Pi/omp extension: read-only Slack.
 *
 * Exposes a handful of LLM-callable tools that READ from a Slack workspace —
 * list channels, read channel history and threads, look up users, and (with a
 * user token) search messages. It never writes: every call funnels through
 * `slackCall`, which rejects any method not in the `READ_METHODS` allow-list,
 * so read-only is a structural guarantee rather than a convention.
 *
 * Auth: set `SLACK_BOT_TOKEN` (or `SLACK_TOKEN`) in the environment — e.g. via
 * `op run` from an `op://` item. Nothing is hardcoded. A bot token (`xoxb-…`)
 * with `channels:read,channels:history,groups:history,users:read` covers the
 * channel/history/user tools; `search.messages` additionally needs a user
 * token (`xoxp-…`) with `search:read`.
 *
 * Proxy: on networks that require an egress proxy (e.g. the sipgate server),
 * set `HTTPS_PROXY` and run omp under a runtime whose `fetch` honors it
 * (Bun does natively). Workstations with direct egress need nothing.
 *
 * See ./README.md for the full tool reference and setup.
 */

// -- Minimal structural view of the omp ExtensionAPI surface we use ---------
// (kept local so the extension carries no build-time dependency on the SDK
// type package; it is a subset of `ExtensionAPI` from the omp SDK.)

interface ToolTextResult {
	content: { type: "text"; text: string }[];
	details?: Record<string, unknown>;
	isError?: boolean;
}

interface ToolDefinition {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: ((partial: ToolTextResult) => void) | undefined,
		ctx: unknown,
	): Promise<ToolTextResult>;
}

interface PiHost {
	registerTool(def: ToolDefinition): void;
	setLabel?(label: string): void;
}

// -- Configuration ----------------------------------------------------------

const SLACK_API = "https://slack.com/api";

/** The only Slack methods this extension is ever allowed to call. */
const READ_METHODS: ReadonlySet<string> = new Set([
	"auth.test",
	"conversations.list",
	"conversations.history",
	"conversations.replies",
	"conversations.info",
	"users.info",
	"users.list",
	"users.lookupByEmail",
	"search.messages",
]);

// -- Session-scoped caches (id <-> name), cheap and correctness-tolerant ----

const userCache = new Map<string, string>();
const channelByName = new Map<string, string>();
const channelById = new Map<string, string>();

// -- Unknown-input guards ---------------------------------------------------

function rec(v: unknown): Record<string, unknown> {
	// After the object/null guard, widen for property access; not `any`.
	return typeof v === "object" && v !== null
		? (v as Record<string, unknown>)
		: {};
}
function str(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function list(v: unknown): unknown[] {
	return Array.isArray(v) ? v : [];
}
function clamp(v: number | undefined, lo: number, hi: number, dflt: number): number {
	const n = v ?? dflt;
	return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

// -- Errors -----------------------------------------------------------------

class SlackError extends Error {
	readonly code: string;
	readonly scopes: string;
	constructor(code: string, scopes: string) {
		super(code);
		this.name = "SlackError";
		this.code = code;
		this.scopes = scopes;
	}
}

function hintFor(code: string): string | undefined {
	const hints: Record<string, string> = {
		not_in_channel:
			"Bot ist kein Mitglied dieses Channels. Lade es ein (/invite @bot) — diese read-only Extension kann nicht selbst joinen.",
		channel_not_found:
			"Channel-ID/Name nicht gefunden oder das Token hat keinen Zugriff.",
		not_allowed_token_type:
			"search.messages braucht ein USER-Token (xoxp-…) mit search:read; ein Bot-Token (xoxb-…) reicht nicht.",
		missing_scope:
			"Dem Token fehlt ein OAuth-Scope (siehe die aufgefuehrten Token-Scopes).",
		invalid_auth: "Token ungueltig oder abgelaufen.",
		account_inactive: "Token gehoert zu einem deaktivierten Account/Workspace.",
		token_revoked: "Token wurde widerrufen.",
		ratelimited: "Slack Rate-Limit erreicht — kurz warten und erneut versuchen.",
	};
	return hints[code];
}

// -- HTTP -------------------------------------------------------------------

function getToken(): string | undefined {
	const t = process.env.SLACK_BOT_TOKEN ?? process.env.SLACK_TOKEN;
	return t && t.length > 0 ? t : undefined;
}

interface SlackCallResult {
	data: Record<string, unknown>;
	/** Value of the `x-oauth-scopes` response header, for diagnostics. */
	scopes: string;
}

async function slackCall(
	method: string,
	params: Record<string, string | number | boolean | undefined>,
	signal: AbortSignal | undefined,
): Promise<SlackCallResult> {
	if (!READ_METHODS.has(method)) {
		throw new Error(
			`Refused: "${method}" is not an allow-listed read-only Slack method.`,
		);
	}
	const token = getToken();
	if (!token) {
		throw new Error(
			"SLACK_BOT_TOKEN (or SLACK_TOKEN) is not set in the environment. See extensions/slack/README.md.",
		);
	}
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== "") qs.set(k, String(v));
	}
	const res = await fetch(`${SLACK_API}/${method}?${qs.toString()}`, {
		method: "GET",
		headers: { authorization: `Bearer ${token}` },
		signal,
	});
	const scopes = res.headers.get("x-oauth-scopes") ?? "";
	const body: unknown = await res.json();
	const data = rec(body);
	if (data.ok !== true) {
		throw new SlackError(str(data.error) ?? `http_${res.status}`, scopes);
	}
	return { data, scopes };
}

// -- Resolution + formatting ------------------------------------------------

async function resolveUserName(
	id: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	if (!id) return "?";
	const cached = userCache.get(id);
	if (cached !== undefined) return cached;
	try {
		const { data } = await slackCall("users.info", { user: id }, signal);
		const u = rec(data.user);
		const name =
			str(u.real_name) ?? str(rec(u.profile).real_name) ?? str(u.name) ?? id;
		userCache.set(id, name);
		return name;
	} catch {
		userCache.set(id, id);
		return id;
	}
}

const CHANNEL_ID = /^[CGD][A-Z0-9]{6,}$/;

async function resolveChannel(
	input: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	const raw = input.trim();
	if (!raw) throw new Error("channel is required");
	if (CHANNEL_ID.test(raw) || channelById.has(raw)) return raw;
	const name = raw.replace(/^#/, "");
	const cached = channelByName.get(name);
	if (cached !== undefined) return cached;
	let cursor = "";
	do {
		const { data } = await slackCall(
			"conversations.list",
			{
				types: "public_channel,private_channel",
				exclude_archived: false,
				limit: 1000,
				cursor,
			},
			signal,
		);
		for (const raw2 of list(data.channels)) {
			const c = rec(raw2);
			const cid = str(c.id);
			const cname = str(c.name);
			if (cid && cname) {
				channelByName.set(cname, cid);
				channelById.set(cid, cname);
			}
		}
		const hit = channelByName.get(name);
		if (hit !== undefined) return hit;
		cursor = str(rec(data.response_metadata).next_cursor) ?? "";
	} while (cursor);
	throw new Error(
		`Channel "#${name}" not found (or the token has no access to it).`,
	);
}

function fmtTs(ts: unknown): string {
	const s = str(ts) ?? "";
	const seconds = Math.floor(Number(s));
	if (!Number.isFinite(seconds) || seconds <= 0) return s || "?";
	const d = new Date(seconds * 1000);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function humanizeText(
	text: string,
	signal: AbortSignal | undefined,
): Promise<string> {
	if (!text) return "";
	let out = text;
	// Links: <url|label> -> label ; <url> -> url
	out = out.replace(/<(https?:[^>|]+)\|([^>]+)>/g, (_m, _u, label) => label);
	out = out.replace(/<(https?:[^>|]+)>/g, (_m, u) => u);
	// Channel mentions: <#C123|name> -> #name
	out = out.replace(/<#[CG][A-Z0-9]+\|([^>]+)>/g, (_m, cname) => `#${cname}`);
	// Special mentions: <!here>, <!channel>, <!everyone>
	out = out.replace(/<!(\w+)(\|[^>]+)?>/g, (_m, word) => `@${word}`);
	// User mentions: <@U123> -> @name (resolved, de-duped)
	const ids = new Set<string>();
	for (const m of out.matchAll(/<@([A-Z0-9]+)>/g)) ids.add(m[1]);
	for (const id of ids) {
		const name = await resolveUserName(id, signal);
		out = out.replaceAll(`<@${id}>`, `@${name}`);
	}
	return out;
}

async function formatMessage(
	m: Record<string, unknown>,
	signal: AbortSignal | undefined,
	indent = "",
): Promise<string> {
	const uid = str(m.user);
	const who = uid
		? await resolveUserName(uid, signal)
		: str(m.username) ?? str(m.bot_id) ?? "system";
	const when = fmtTs(m.ts);
	const text = await humanizeText(str(m.text) ?? "", signal);
	const extras: string[] = [];
	const subtype = str(m.subtype);
	if (subtype) extras.push(`(${subtype})`);
	const files = list(m.files);
	if (files.length) {
		const names = files
			.map((f) => str(rec(f).name) ?? str(rec(f).title) ?? "?")
			.join(", ");
		extras.push(`[${files.length} file(s): ${names}]`);
	}
	const replies = num(m.reply_count);
	if (replies && replies > 0) {
		extras.push(`[thread: ${replies} replies, thread_ts=${str(m.thread_ts) ?? str(m.ts)}]`);
	}
	const tail = extras.length ? ` ${extras.join(" ")}` : "";
	return `${indent}[${when}] ${who}: ${text}${tail}`;
}

// -- Result helpers ---------------------------------------------------------

function ok(text: string, details: Record<string, unknown>): ToolTextResult {
	return { content: [{ type: "text", text }], details };
}

function fail(message: string, details: Record<string, unknown> = {}): ToolTextResult {
	return {
		content: [{ type: "text", text: message }],
		details: { ...details, error: message },
		isError: true,
	};
}

function errResult(e: unknown): ToolTextResult {
	if (e instanceof SlackError) {
		const hint = hintFor(e.code);
		const scopeLine = e.scopes ? `\n(token scopes: ${e.scopes})` : "";
		return fail(
			`Slack error: ${e.code}${hint ? ` — ${hint}` : ""}${scopeLine}`,
			{ slack_error: e.code },
		);
	}
	return fail(`Error: ${e instanceof Error ? e.message : String(e)}`);
}

// -- Extension --------------------------------------------------------------

export default function slackReadOnly(pi: PiHost): void {
	pi.setLabel?.("Slack (read-only)");

	pi.registerTool({
		name: "slack_auth_test",
		label: "Slack Auth Test",
		description:
			"Verify the configured Slack token and show the bot/user identity, workspace, and granted OAuth scopes. Read-only.",
		parameters: { type: "object", properties: {}, required: [] },
		async execute(_id, _params, signal) {
			try {
				const { data, scopes } = await slackCall("auth.test", {}, signal);
				const text = [
					`ok as ${str(data.user) ?? "?"} (${str(data.user_id) ?? "?"})`,
					`team: ${str(data.team) ?? "?"} (${str(data.team_id) ?? "?"})`,
					`url: ${str(data.url) ?? "?"}`,
					`scopes: ${scopes || "(none reported)"}`,
				].join("\n");
				return ok(text, {
					user: str(data.user),
					user_id: str(data.user_id),
					team: str(data.team),
					scopes,
				});
			} catch (e) {
				return errResult(e);
			}
		},
	});

	pi.registerTool({
		name: "slack_list_channels",
		label: "Slack List Channels",
		description:
			"List Slack conversations (channels). Read-only. Filter by type, name substring, or membership.",
		parameters: {
			type: "object",
			properties: {
				types: {
					type: "string",
					description:
						"Comma-separated conversation types: public_channel, private_channel, mpim, im. Default public_channel.",
				},
				name_contains: {
					type: "string",
					description: "Only channels whose name contains this substring (case-insensitive).",
				},
				member_only: {
					type: "boolean",
					description: "Only channels the token's identity is a member of.",
				},
				limit: {
					type: "number",
					description: "Max channels to return (1-1000, default 100).",
				},
			},
			required: [],
		},
		async execute(_id, params, signal) {
			try {
				const types = str(params.types) ?? "public_channel";
				const wantLimit = clamp(num(params.limit), 1, 1000, 100);
				const needle = (str(params.name_contains) ?? "").toLowerCase();
				const memberOnly = params.member_only === true;
				const rows: Record<string, unknown>[] = [];
				let cursor = "";
				do {
					const { data } = await slackCall(
						"conversations.list",
						{ types, exclude_archived: true, limit: 1000, cursor },
						signal,
					);
					for (const raw of list(data.channels)) {
						const c = rec(raw);
						const cid = str(c.id);
						const cname = str(c.name);
						if (cid && cname) {
							channelByName.set(cname, cid);
							channelById.set(cid, cname);
						}
						if (needle && !(cname ?? "").toLowerCase().includes(needle)) continue;
						if (memberOnly && c.is_member !== true) continue;
						rows.push(c);
						if (rows.length >= wantLimit) break;
					}
					cursor =
						rows.length < wantLimit
							? str(rec(data.response_metadata).next_cursor) ?? ""
							: "";
				} while (cursor);
				if (!rows.length) return ok("No channels found.", { count: 0 });
				const text = rows
					.map((c) => {
						const purpose = str(rec(c.purpose).value);
						const flags = [
							c.is_member === true ? "member" : null,
							c.is_private === true ? "private" : null,
						]
							.filter(Boolean)
							.join(",");
						return [
							`#${str(c.name) ?? "?"}`,
							str(c.id) ?? "?",
							`${num(c.num_members) ?? "?"} members`,
							flags ? `[${flags}]` : "",
							purpose ? purpose.replace(/\s+/g, " ").slice(0, 80) : "",
						]
							.filter((s) => s !== "")
							.join("\t");
					})
					.join("\n");
				return ok(text, {
					count: rows.length,
					channels: rows.map((c) => ({
						id: str(c.id),
						name: str(c.name),
						is_member: c.is_member === true,
						is_private: c.is_private === true,
						num_members: num(c.num_members),
					})),
				});
			} catch (e) {
				return errResult(e);
			}
		},
	});

	pi.registerTool({
		name: "slack_history",
		label: "Slack Channel History",
		description:
			"Read recent messages from a Slack channel (by #name or channel ID), oldest-to-newest. Read-only. Optionally expand threads.",
		parameters: {
			type: "object",
			properties: {
				channel: {
					type: "string",
					description: "Channel ID (C…/G…/D…) or #name / name.",
				},
				limit: {
					type: "number",
					description: "Max messages (1-200, default 20).",
				},
				oldest: { type: "string", description: "Only messages after this Unix ts (inclusive)." },
				latest: { type: "string", description: "Only messages before this Unix ts." },
				include_threads: {
					type: "boolean",
					description: "Also fetch and inline thread replies (extra API calls). Default false.",
				},
			},
			required: ["channel"],
		},
		async execute(_id, params, signal) {
			try {
				const channelInput = str(params.channel);
				if (!channelInput) return fail("channel is required");
				const chan = await resolveChannel(channelInput, signal);
				const query: Record<string, string | number | boolean | undefined> = {
					channel: chan,
					limit: clamp(num(params.limit), 1, 200, 20),
					oldest: str(params.oldest),
					latest: str(params.latest),
				};
				const { data } = await slackCall("conversations.history", query, signal);
				const msgs = list(data.messages).map(rec).reverse();
				const lines: string[] = [];
				for (const m of msgs) {
					lines.push(await formatMessage(m, signal));
					const replies = num(m.reply_count);
					const threadTs = str(m.thread_ts) ?? str(m.ts);
					if (params.include_threads === true && replies && threadTs) {
						const { data: rd } = await slackCall(
							"conversations.replies",
							{ channel: chan, ts: threadTs, limit: 50 },
							signal,
						);
						for (const r of list(rd.messages).map(rec).slice(1)) {
							lines.push(await formatMessage(r, signal, "    \u21b3 "));
						}
					}
				}
				const cname = channelById.get(chan);
				const label = cname ? `#${cname}` : chan;
				const header = `${label} — ${msgs.length} message(s)${data.has_more === true ? " (more available)" : ""}`;
				return ok(`${header}\n${lines.join("\n") || "(empty)"}`, {
					channel: chan,
					count: msgs.length,
					has_more: data.has_more === true,
				});
			} catch (e) {
				return errResult(e);
			}
		},
	});

	pi.registerTool({
		name: "slack_replies",
		label: "Slack Thread Replies",
		description:
			"Read a Slack thread: the parent message plus its replies, given a channel and the thread's ts. Read-only.",
		parameters: {
			type: "object",
			properties: {
				channel: { type: "string", description: "Channel ID or #name / name." },
				thread_ts: { type: "string", description: "ts of the thread's parent message." },
				limit: { type: "number", description: "Max messages (1-200, default 100)." },
			},
			required: ["channel", "thread_ts"],
		},
		async execute(_id, params, signal) {
			try {
				const channelInput = str(params.channel);
				const threadTs = str(params.thread_ts);
				if (!channelInput) return fail("channel is required");
				if (!threadTs) return fail("thread_ts is required");
				const chan = await resolveChannel(channelInput, signal);
				const { data } = await slackCall(
					"conversations.replies",
					{ channel: chan, ts: threadTs, limit: clamp(num(params.limit), 1, 200, 100) },
					signal,
				);
				const msgs = list(data.messages).map(rec);
				const lines: string[] = [];
				for (let i = 0; i < msgs.length; i++) {
					lines.push(await formatMessage(msgs[i], signal, i === 0 ? "" : "    \u21b3 "));
				}
				return ok(lines.join("\n") || "(empty thread)", {
					channel: chan,
					thread_ts: threadTs,
					count: msgs.length,
				});
			} catch (e) {
				return errResult(e);
			}
		},
	});

	pi.registerTool({
		name: "slack_user",
		label: "Slack User Lookup",
		description:
			"Look up a Slack user by ID, or by email (needs users:read.email). Returns profile basics. Read-only.",
		parameters: {
			type: "object",
			properties: {
				user: { type: "string", description: "User ID (U…/W…)." },
				email: { type: "string", description: "Email address (uses users.lookupByEmail)." },
			},
			required: [],
		},
		async execute(_id, params, signal) {
			try {
				const userId = str(params.user);
				const email = str(params.email);
				if (!userId && !email) return fail("Provide either 'user' (ID) or 'email'.");
				const { data } = email
					? await slackCall("users.lookupByEmail", { email }, signal)
					: await slackCall("users.info", { user: userId }, signal);
				const u = rec(data.user);
				const p = rec(u.profile);
				const flags = [
					u.is_admin === true ? "admin" : null,
					u.is_owner === true ? "owner" : null,
					u.is_bot === true ? "bot" : null,
					u.deleted === true ? "deleted" : null,
					u.is_restricted === true ? "guest" : null,
				]
					.filter(Boolean)
					.join(", ");
				const text = [
					`${str(u.id) ?? "?"}  ${str(u.real_name) ?? str(p.real_name) ?? str(u.name) ?? "?"}`,
					str(p.title) ? `title: ${str(p.title)}` : null,
					str(u.name) ? `handle: @${str(u.name)}` : null,
					str(p.email) ? `email: ${str(p.email)}` : null,
					str(u.tz) ? `tz: ${str(u.tz)}` : null,
					`flags: ${flags || "—"}`,
				]
					.filter((s): s is string => s !== null)
					.join("\n");
				return ok(text, {
					id: str(u.id),
					name: str(u.name),
					real_name: str(u.real_name),
					is_bot: u.is_bot === true,
					deleted: u.deleted === true,
				});
			} catch (e) {
				return errResult(e);
			}
		},
	});

	pi.registerTool({
		name: "slack_search",
		label: "Slack Search Messages",
		description:
			"Search messages across the workspace (Slack search syntax). Read-only. Requires a USER token (xoxp-…) with search:read — a bot token cannot search.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query (supports in:#channel, from:@user, etc.)." },
				count: { type: "number", description: "Max matches (1-100, default 20)." },
				sort: { type: "string", description: "'timestamp' (default) or 'score'." },
			},
			required: ["query"],
		},
		async execute(_id, params, signal) {
			try {
				const query = str(params.query);
				if (!query) return fail("query is required");
				const { data } = await slackCall(
					"search.messages",
					{ query, count: clamp(num(params.count), 1, 100, 20), sort: str(params.sort) ?? "timestamp" },
					signal,
				);
				const messages = rec(data.messages);
				const matches = list(messages.matches).map(rec);
				if (!matches.length) return ok(`No matches for "${query}".`, { count: 0 });
				const lines: string[] = [];
				for (const m of matches) {
					const ch = rec(m.channel);
					const chLabel = str(ch.name) ? `#${str(ch.name)}` : str(ch.id) ?? "?";
					const uid = str(m.user);
					const who = str(m.username) ?? (uid ? await resolveUserName(uid, signal) : "?");
					lines.push(`[${fmtTs(m.ts)}] ${chLabel} ${who}: ${await humanizeText(str(m.text) ?? "", signal)}`);
				}
				return ok(lines.join("\n"), { count: matches.length, total: num(messages.total) });
			} catch (e) {
				return errResult(e);
			}
		},
	});
}
