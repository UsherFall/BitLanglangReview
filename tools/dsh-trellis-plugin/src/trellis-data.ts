/**
 * Trellis data layer: reads task data from a project's `.trellis` directory.
 * No python needed — this reads task.json files directly so the plugin works
 * without shelling out, while remaining format-compatible with task.py.
 */
import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

/** @typedef {{id: string, name: string, title: string, description: string, status: string, priority: string, creator: string, assignee: string, createdAt: string, completedAt: string|null, branch: string|null, parent: string|null, dir: string, archived: boolean, hasPrd: boolean, hasDesign: boolean, hasImplement: boolean}} TrellisTask */

/** Find the `.trellis` root for a cwd, walking up. */
export function findTrellisRoot(cwd) {
	let dir = cwd;
	for (;;) {
		if (existsSync(join(dir, ".trellis", "workflow.md"))) return dir;
		const parent = join(dir, "..");
		if (parent === dir) return undefined;
		dir = parent;
	}
}

async function readTaskJson(taskDir) {
	try {
		return JSON.parse(await readFile(join(taskDir, "task.json"), "utf8"));
	} catch {
		return undefined;
	}
}

/** List every task (active + archived) under a Trellis root. @returns {Promise<TrellisTask[]>} */
export async function listTasks(trellisRoot) {
	const tasksDir = join(trellisRoot, ".trellis", "tasks");
	const out = [];
	for (const [sub, archived] of [[".", false], ["archive", true]]) {
		const base = join(tasksDir, sub);
		let entries;
		try {
			entries = await readdir(base, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (archived && !entry.isDirectory()) continue;
			if (entry.isFile() && entry.name.endsWith(".json")) continue;
			const dir = join(base, entry.name);
			if (!(await stat(dir)).isDirectory()) continue;
			const data = await readTaskJson(dir);
			if (!data) continue;
			out.push({
				id: data.id ?? entry.name,
				name: data.name ?? entry.name,
				title: data.title ?? entry.name,
				description: data.description ?? "",
				status: data.status ?? "unknown",
				priority: data.priority ?? "",
				creator: data.creator ?? "",
				assignee: data.assignee ?? "",
				createdAt: data.createdAt ?? "",
				completedAt: data.completedAt ?? null,
				branch: data.branch ?? null,
				parent: data.parent ?? null,
				dir,
				archived,
				hasPrd: existsSync(join(dir, "prd.md")),
				hasDesign: existsSync(join(dir, "design.md")),
				hasImplement: existsSync(join(dir, "implement.md"))
			});
		}
	}
	return out;
}

const STATUS_ORDER = { planning: 0, in_progress: 1, completed: 2, archived: 3 };

/** Render one task as a compact text summary for skill bodies. */
export function renderTask(t) {
	const docs = [
		t.hasPrd ? "prd.md" : null,
		t.hasDesign ? "design.md" : null,
		t.hasImplement ? "implement.md" : null
	].filter(Boolean).join(", ") || "none";
	return [
		`## ${t.name} — ${t.title}`,
		`- status: ${t.status}${t.archived ? " (archived)" : ""} · priority: ${t.priority} · assignee: ${t.assignee || "—"}`,
		`- created: ${t.createdAt}${t.completedAt ? ` · completed: ${t.completedAt}` : ""}${t.branch ? ` · branch: ${t.branch}` : ""}`,
		`- docs: ${docs}`,
		`- dir: ${t.dir}`,
		t.description ? `- description: ${t.description.slice(0, 600)}` : ""
	].filter(Boolean).join("\n");
}

/** Render the full task list for a skill body. */
export function renderTaskList(tasks) {
	const sorted = [...tasks].sort((a, b) =>
		((STATUS_ORDER[a.archived ? "archived" : a.status] ?? 9) - (STATUS_ORDER[b.archived ? "archived" : b.status] ?? 9)) ||
		String(b.createdAt).localeCompare(String(a.createdAt)));
	const active = sorted.filter((t) => !t.archived);
	const archived = sorted.filter((t) => t.archived);
	const lines = [`Total: ${active.length} active, ${archived.length} archived.`];
	if (active.length) lines.push("# Active tasks", ...active.map(renderTask));
	if (archived.length) lines.push("# Archived tasks", ...archived.map(renderTask));
	return lines.join("\n\n");
}
