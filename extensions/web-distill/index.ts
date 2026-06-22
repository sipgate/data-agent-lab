// @ts-nocheck
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

/**
 * Resolve the web-distill binary path.
 *
 * Resolution order:
 *   1. WEB_DISTILL_BIN env var
 *   2. binary bundled next to this extension (./bin/web-distill)
 *   3. ~/.local/bin/web-distill (XDG-ish user install)
 *
 * Throws if none of the candidates exists.
 */
function resolveBinary(): string {
	const env = process.env.WEB_DISTILL_BIN;
	if (env && existsSync(env)) return env;

	const here = dirname(fileURLToPath(import.meta.url));
	const bundled = join(here, "bin", "web-distill");
	if (existsSync(bundled)) return bundled;

	const userBin = join(homedir(), ".local", "bin", "web-distill");
	if (existsSync(userBin)) return userBin;

	throw new Error(
		`web-distill binary not found. Set WEB_DISTILL_BIN, or place it at ${bundled}, or at ${userBin}.`,
	);
}

export default function (pi: any) {
	let binaryPath: string;
	try {
		binaryPath = resolveBinary();
	} catch (err: any) {
		console.error(`[web-distill] ${err.message} Extension disabled.`);
		return;
	}

	// 1. OVERRIDE fetch_content
	pi.registerTool({
		name: "fetch_content", // Overrides the built-in tool natively
		label: "fetch_content (web-distill)",
		description:
			"Fetch readable content from a URL or YouTube video. Uses web-distill with fast HTTP request, and falls back to headless Chromium (Browserless) for JavaScript-heavy or bot-protected pages. Performs scrolling and cookie sharing.",
		parameters: {
			type: "object",
			properties: {
				url: { type: "string", description: "Single URL to fetch" },
				urls: {
					type: "array",
					items: { type: "string" },
					description: "Multiple URLs to fetch in parallel",
				},
			},
			required: [],
		},
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const url = params.url || (params.urls && params.urls[0]);
			if (!url) {
				return {
					content: [
						{ type: "text", text: "Error: Please provide a 'url' parameter." },
					],
					details: {},
				};
			}

			try {
				const { stdout } = await execFileAsync(binaryPath, ["fetch", url], {
					signal,
				});
				return {
					content: [{ type: "text", text: stdout }],
					details: { url, web_distill: true },
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error executing web-distill: ${err.message}\n${err.stderr || ""}`,
						},
					],
					details: {},
				};
			}
		},
	});

	// 2. OVERRIDE web_search
	pi.registerTool({
		name: "web_search", // Overrides the built-in tool natively
		label: "web_search (web-distill)",
		description:
			"Search the web using DuckDuckGo with Chromium-rendering. Returns highly relevant, clean Markdown results.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Single search query" },
				queries: {
					type: "array",
					items: { type: "string" },
					description: "Multiple queries searched in sequence",
				},
			},
			required: [],
		},
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const query = params.query || (params.queries && params.queries[0]);
			if (!query) {
				return {
					content: [
						{
							type: "text",
							text: "Error: Please provide a 'query' parameter.",
						},
					],
					details: {},
				};
			}

			try {
				const { stdout } = await execFileAsync(binaryPath, ["search", query], {
					signal,
				});
				return {
					content: [{ type: "text", text: stdout }],
					details: { query, web_distill: true },
				};
			} catch (err: any) {
				return {
					content: [
						{
							type: "text",
							text: `Error executing web-distill search: ${err.message}\n${err.stderr || ""}`,
						},
					],
					details: {},
				};
			}
		},
	});
}
