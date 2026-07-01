// @ts-nocheck
/**
 * Pi extension: Jira lifecycle hooks.
 *
 * Mirrors the Claude Code hooks declared in
 *   /usr/local/etl-scripts/.claude/settings.json
 * by shelling out to the SAME Python hook scripts under
 *   /usr/local/etl-scripts/jira/
 *
 * The Python scripts (sessionStart.py, detectTicket.py, onCommit.py,
 * activityReminder.py, sessionEnd.py) and their shared lib.py are the single
 * source of truth for Jira access, session-context tracking, and ADF/github
 * helpers. This extension only adapts the I/O contract:
 *
 *   Claude pipes a JSON payload via stdin and reads `additionalContext` from
 *   stdout. Pi exposes lifecycle events with typed fields instead. So we
 *   synthesize the expected stdin payload from the Pi event, run the script,
 *   parse the `additionalContext` field, and inject it back into Pi via the
 *   appropriate mechanism (before_agent_start message / tool_result append).
 *
 * Scope: active only when the session cwd is under one of ACTIVE_CWDS — this
 * matches Claude's project-local registration in etl-scripts and keeps the
 * hooks silent in unrelated repos (e.g. data-agent-lab itself).
 *
 * Session-context file: because lib.py's `_session_key()` walks the PPID chain
 * looking for a process named `claude`, under Pi it falls back to the literal
 * key `global`. Hooks AND skills (jira/cli.py) share that same file, so the
 * context is coherent within a Pi process. Claude uses `.jira_context.<pid>`
 * filenames, so Pi and Claude do NOT collide.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// -- Configuration ----------------------------------------------------------

const JIRA_DIR = "/usr/local/etl-scripts/jira";
const PYTHON = "/usr/local/etl-scripts/libs/miniconda3/bin/python3";

/** Session cwds where Jira hooks are active (mirrors Claude project scope). */
const ACTIVE_CWDS = ["/usr/local/etl-scripts"];

const SCRIPTS = {
	sessionStart: `${JIRA_DIR}/sessionStart.py`,
	detectTicket: `${JIRA_DIR}/detectTicket.py`,
	onCommit: `${JIRA_DIR}/onCommit.py`,
	activityReminder: `${JIRA_DIR}/activityReminder.py`,
	sessionEnd: `${JIRA_DIR}/sessionEnd.py`,
} as const;

const TIMEOUT = {
	sessionStart: 15000, // one Jira search at session start
	detectTicket: 10000, // one get_issue per prompt
	onCommit: 12000, // one comment POST (fire-and-forget)
	activityReminder: 8000, // throttled to every 5 edits
	sessionEnd: 12000, // one comment POST (fire-and-forget)
} as const;

// -- Helpers ----------------------------------------------------------------

function isActive(): boolean {
	const cwd = process.cwd();
	return ACTIVE_CWDS.some((p) => cwd === p || cwd.startsWith(p + "/"));
}

/**
 * Run a Jira hook script, feeding it the Claude-shaped JSON payload via stdin
 * (lib.py's run_hook reads stdin). Returns trimmed stdout, or "" on any
 * failure — hooks must never break the agent.
 */
async function runHook(
	script: string,
	payload: unknown,
	timeoutMs: number,
): Promise<string> {
	const stdin =
		typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
	try {
		const { stdout } = await execFileAsync(PYTHON, [script], {
			input: stdin,
			timeout: timeoutMs,
			env: process.env, // inherit PATH (op), JIRA_*, etc.
			maxBuffer: 1024 * 1024,
		});
		return (stdout ?? "").trim();
	} catch {
		return "";
	}
}

/** Extract `additionalContext` from a hook's stdout (handles both shapes). */
function parseContext(stdout: string): string | null {
	if (!stdout) return null;
	try {
		const obj = JSON.parse(stdout);
		if (typeof obj.additionalContext === "string") return obj.additionalContext;
		const hso = obj.hookSpecificOutput;
		if (hso && typeof hso.additionalContext === "string")
			return hso.additionalContext;
	} catch {
		// not JSON — ignore
	}
	return null;
}

/** Race a promise against a timeout; resolves to fallback on expiry/error. */
async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
	try {
		return await Promise.race([
			p,
			new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
		]);
	} catch {
		return fallback;
	}
}

// -- Module state (session-scoped) -----------------------------------------

let sessionStartPromise: Promise<void> | null = null;
let sessionStartCtx: string | null = null;

// -- Extension --------------------------------------------------------------

export default function (pi: any) {
	// 1) SessionStart — inject open Jira tickets as context.
	//    Fire-and-forget so session startup isn't blocked; the result is
	//    consumed (once) on the first before_agent_start.
	pi.on("session_start", async (event: any) => {
		if (!isActive()) return;
		if (event.reason === "reload") return; // avoid re-running on /reload
		sessionStartCtx = null;
		sessionStartPromise = (async () => {
			const out = await runHook(SCRIPTS.sessionStart, {}, TIMEOUT.sessionStart);
			sessionStartCtx = parseContext(out);
		})();
		// don't await — keep startup snappy
	});

	// 2) UserPromptSubmit (detectTicket) + inject cached sessionStart context.
	pi.on("before_agent_start", async (event: any) => {
		if (!isActive()) return;

		// Consume sessionStart context once (await, but bounded).
		let startCtx: string | null = null;
		if (sessionStartPromise) {
			await withTimeout(sessionStartPromise, TIMEOUT.sessionStart, undefined);
			sessionStartPromise = null;
			startCtx = sessionStartCtx;
			sessionStartCtx = null;
		}

		// detectTicket: auto-activate a ticket mentioned in the prompt.
		const out = await runHook(
			SCRIPTS.detectTicket,
			{ prompt: event.prompt ?? "" },
			TIMEOUT.detectTicket,
		);
		const ticketCtx = parseContext(out);

		const combined = [startCtx, ticketCtx].filter(Boolean).join("\n\n");
		if (!combined) return;

		return {
			message: {
				customType: "jira-context",
				content: combined,
				display: false, // silent injection (model-only), like Claude's additionalContext
			},
		};
	});

	// 3+4) PostToolUse — Bash(commit) → onCommit, Edit/Write → activityReminder.
	pi.on("tool_result", async (event: any) => {
		if (!isActive()) return;
		const tool = event.toolName;

		try {
			// onCommit: a successful bash command containing `git commit`.
			if (tool === "bash" && !event.isError) {
				const cmd: string = event.input?.command ?? "";
				if (cmd.includes("git commit")) {
					// side effect only (Jira comment) — fire and forget
					runHook(
						SCRIPTS.onCommit,
						{ tool_input: { command: cmd } },
						TIMEOUT.onCommit,
					).catch(() => {});
				}
				return;
			}

			// activityReminder: throttled nudge every Nth edit/write.
			if (tool === "edit" || tool === "write") {
				const out = await runHook(
					SCRIPTS.activityReminder,
					{ session_id: `pi-${process.pid}` },
					TIMEOUT.activityReminder,
				);
				const nudge = parseContext(out);
				if (!nudge) return;
				// Surface the nudge to the model by appending to the tool result,
				// matching Claude's PostToolUse additionalContext semantics.
				const content = Array.isArray(event.content) ? event.content : [];
				return {
					content: [...content, { type: "text", text: `\n\n[Jira] ${nudge}` }],
				};
			}
		} catch {
			// never break the turn
		}
	});

	// 5) Stop — post session summary to the active Jira ticket. Fire-and-forget.
	pi.on("agent_end", async (_event: any) => {
		if (!isActive()) return;
		runHook(SCRIPTS.sessionEnd, {}, TIMEOUT.sessionEnd).catch(() => {});
	});
}
