/**
 * dsh-trellis — Trellis workflow integration for DeepSeek Harness.
 *
 * Registers a skill provider that surfaces Trellis workflow commands
 * (start / continue / finish / status / board) as model-invocable skills,
 * plus an HTTP dashboard page for visual task tracking.
 */
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import z from "@deepseek-ai/schemastery";
import { findTrellisRoot, listTasks, renderTaskList } from "./trellis-data.js";

/** Stable Cordis plugin name. */
export const name = "trellis";

/**
 * Injected services: the skill registry for providers, and the web GUI's HTTP
 * route registry for the JSON task API. Both are optional — headless profiles
 * without the web GUI skip the route, compositions without skills skip skills.
 */
export const inject = ["skills", "webServer"];

export const Config = z.object({
	/** Port for the visual dashboard HTTP server. */
	dashboardPort: z.number().default(3210),
	/** Enable the dashboard HTTP server. */
	dashboard: z.boolean().default(true)
});

const DASHBOARD_HTML_CANDIDATES = ["./dashboard.html", "../src/dashboard.html"].map((p) => new URL(p, import.meta.url));

/** Read the dashboard HTML template, preferring the built copy. */
async function readDashboardHtml() {
	for (const url of DASHBOARD_HTML_CANDIDATES) {
		try {
			return await readFile(url, "utf8");
		} catch {
			// try the next candidate
		}
	}
	throw new Error("dashboard.html not found");
}
let dashboardServer;

/** Build the dashboard HTML page for one Trellis root. */
async function renderDashboard(trellisRoot) {
	const tasks = trellisRoot ? await listTasks(trellisRoot) : [];
	let html = await readDashboardHtml();
	const cards = tasks.map((t) => {
		const statusClass = t.archived ? "archived" : t.status;
		const docs = [t.hasPrd && "PRD", t.hasDesign && "Design", t.hasImplement && "Impl"].filter(Boolean).join(" · ");
		return `<div class="card ${statusClass}">
<h3>${escapeHtml(t.title || t.name)}</h3>
<div class="meta"><span class="pill ${statusClass}">${escapeHtml(t.archived ? "archived" : t.status)}</span>
<span class="pill">${escapeHtml(t.priority)}</span>
<span class="pill">${escapeHtml(t.assignee || "unassigned")}</span></div>
<p class="desc">${escapeHtml((t.description || "").slice(0, 220))}</p>
<div class="foot"><span>${escapeHtml(t.name)}</span><span>${escapeHtml(t.createdAt)}${docs ? " · " + docs : ""}</span></div>
</div>`;
	}).join("\n");
	html = html.replace("/*__CARDS__*/", cards)
		.replace("__COUNTS__", `${tasks.filter((t) => !t.archived).length} active · ${tasks.filter((t) => t.archived).length} archived`)
		.replace("__ROOT__", escapeHtml(trellisRoot ?? "(no .trellis project found)"));
	return html;
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Start the dashboard HTTP server (plain node:http, no extra deps). */
function startDashboard(ctx, port) {
	if (dashboardServer) return;
	dashboardServer = createServer(async (req, res) => {
		if (req.url !== "/" && !req.url.startsWith("/?")) {
			res.writeHead(404).end("not found");
			return;
		}
		try {
			const root = findTrellisRoot(process.cwd());
			const html = await renderDashboard(root);
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			res.end(html);
		} catch (error) {
			res.writeHead(500).end(String(error));
		}
	});
	dashboardServer.listen(port, "127.0.0.1", () => {
		ctx.logger.info(`dsh-trellis dashboard at http://127.0.0.1:${port}`);
	});
	dashboardServer.unref?.();
}

/** Plugin apply: register skill provider + dashboard + HTTP routes. */
export function apply(ctx, config = {}) {
	const logger = ctx.logger ?? console;

	// JSON task API served on the DSH webserver origin, consumed by the
	// browser half (/plugins/dsh-trellis/tasks) and the standalone page (/).
	// `webServer` arrives through inject (see below); when absent (headless
	// profiles), the route is simply skipped.
	const tasksHandler = async (req, res) => {
		try {
			const root = findTrellisRoot(process.cwd());
			const tasks = root ? await listTasks(root) : [];
			res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ root: root ?? null, tasks }));
		} catch (error) {
			res.writeHead(500, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: String(error) }));
		}
	};
	if (ctx.webServer) {
		try {
			ctx.effect(() => ctx.webServer.register({
				kind: "exact",
				path: "/plugins/dsh-trellis/tasks",
				handler: tasksHandler
			}), "dsh-trellis: GET /plugins/dsh-trellis/tasks");
		} catch (error) {
			logger.warn?.(`dsh-trellis: webserver route registration failed: ${error}`);
		}
	}

	if (config.dashboard !== false) {
		try {
			startDashboard(ctx, config.dashboardPort ?? 3210);
		} catch (error) {
			logger.warn?.(`dsh-trellis: dashboard failed to start: ${error}`);
		}
	}

	const skills = ctx.get?.("skills");
	if (!skills) {
		logger.info?.("dsh-trellis: no skill registry mounted; skills disabled");
		return;
	}

	skills.registerProvider((control) => ({
		name: "trellis",
		signal: control?.signal,
		/** @returns skill candidates describing the Trellis workflow. */
		async list(options = {}) {
			const root = findTrellisRoot(options.cwd ?? process.cwd());
			const mk = (skillName, description, whenToUse) => ({
				name: skillName,
				description,
				whenToUse,
				invocation: { modelInvocable: true, userInvocable: true },
				provider: "trellis",
				source: "trellis",
				rank: 150,
				locator: { path: DASHBOARD_HTML_PATH.pathname.replace(/^\/([A-Za-z]:)/, "$1"), directory: import.meta.dirname ?? "" },
				resourceBase: { kind: "directory", path: import.meta.dirname ?? "" }
			});
			const base = [
				mk("trellis-status", "List all Trellis tasks (active and archived) with status, assignee and docs. Reads .trellis/tasks directly.", "Use when the user asks about Trellis task status, 进度, 任务列表, or what tasks exist."),
				mk("trellis-board", "Open the Trellis visual task dashboard (HTML board) in the browser.", "Use when the user wants to see the Trellis board / 可视化看板.")
			];
			if (!root) return base;
			const tasks = await listTasks(root);
			const active = tasks.filter((t) => !t.archived);
			return [
				...base,
				mk("trellis-status", "List all Trellis tasks with status.", "Use when the user asks about Trellis tasks or progress."),
				{
					...mk("trellis-continue", "Resume work on the current Trellis task: read the active task's PRD, design and implement docs, then continue the next step.", "Use when the user says continue/resume/继续 the Trellis task."),
					body: buildContinueBody(root, active)
				}
			].filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i).map((s) => s.body ? s : Object.defineProperty(s, "body", { value: s.body, enumerable: false }) ?? s);
		},
		/** Load the full body of a candidate. */
		async get(candidate, options = {}) {
			const root = findTrellisRoot(options.cwd ?? process.cwd());
			if (candidate.name === "trellis-status") {
				if (!root) return noTrellis(candidate);
				const tasks = await listTasks(root);
				return finish(candidate, `# Trellis tasks\nProject: ${root}\n\n${renderTaskList(tasks)}`);
			}
			if (candidate.name === "trellis-board") {
				const port = config.dashboardPort ?? 3210;
				return finish(candidate, `# Trellis board\nOpen http://127.0.0.1:${port} in a browser to see the visual task board. Present the URL to the user; do not fetch it yourself.`);
			}
			if (candidate.name === "trellis-continue") {
				if (!root) return noTrellis(candidate);
				const active = (await listTasks(root)).filter((t) => !t.archived);
				if (!active.length) return finish(candidate, "# Trellis continue\nNo active tasks. Create one with:\npython ./.trellis/scripts/task.py create \"<title>\"");
				return finish(candidate, buildContinueBody(root, active));
			}
			return undefined;
		}
	}));
}

function noTrellis(candidate) {
	return { ...candidate, body: `# ${candidate.name}\nNo .trellis project found at or above the current directory.` };
}

function finish(candidate, body) {
	return { name: candidate.name, description: candidate.description, invocation: candidate.invocation, source: candidate.source, provider: candidate.provider, body };
}

function buildContinueBody(root, active) {
	const lines = [`# Trellis continue\nProject: ${root}\n`];
	if (!active.length) {
		lines.push("No active tasks. Create one:\n```\npython ./.trellis/scripts/task.py create \"<title>\"\n```");
		return lines.join("\n");
	}
	lines.push(`Active tasks: ${active.map((t) => `${t.name} (${t.status})`).join(", ")}`);
	lines.push(`Current task state:\n\n${renderTaskList(active)}`);
	lines.push(`Workflow guide: ${join(root, ".trellis", "workflow.md")} — read it, determine the next phase for the most relevant active task, read that task's prd.md/design.md/implement.md, then continue implementation.`);
	return lines.join("\n");
}
