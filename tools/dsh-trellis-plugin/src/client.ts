/**
 * Browser half of dsh-trellis: registers a sidebar panel ("Trellis") whose
 * main page renders the task board. Data is fetched from the plugin's host
 * HTTP endpoint on the DSH webserver origin via the relative path
 * /plugins/dsh-trellis/tasks, which the host registers with dsh-host-webserver.
 */
import { createElement, useCallback, useEffect, useState } from "react";

export const name = "trellis-client";
export const inject = ["slots", "layout"];

const PANEL_ID = "trellis";

/** Small icons (inline SVG, stroke = currentColor). */
const IconBoard = () =>
	createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.8 },
		createElement("rect", { x: 3, y: 3, width: 7, height: 18, rx: 1.5 }),
		createElement("rect", { x: 14, y: 3, width: 7, height: 10, rx: 1.5 }));

function useTrellisTasks() {
	const [state, setState] = useState({ loading: true, error: undefined, tasks: [], root: undefined });
	const refresh = useCallback(() => {
		fetch("/plugins/dsh-trellis/tasks")
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((data) => setState({ loading: false, tasks: data.tasks ?? [], root: data.root }))
			.catch((error) => setState({ loading: false, error: String(error), tasks: [] }));
	}, []);
	useEffect(refresh, [refresh]);
	return { ...state, refresh };
}

const STATUS_LABEL = { planning: "planning", in_progress: "in progress", completed: "completed", archived: "archived" };

function TaskCard({ task }) {
	const docs = [task.hasPrd && "PRD", task.hasDesign && "Design", task.hasImplement && "Impl"].filter(Boolean).join(" · ");
	const cls = task.archived ? "archived" : task.status;
	return createElement("div", { className: `trellis-card ${cls}` },
		createElement("h3", null, task.title || task.name),
		createElement("div", { className: "trellis-meta" },
			createElement("span", { className: `trellis-pill ${cls}` }, STATUS_LABEL[cls] ?? task.status),
			createElement("span", { className: "trellis-pill" }, task.priority || "—"),
			createElement("span", { className: "trellis-pill" }, task.assignee || "unassigned")),
		task.description ? createElement("p", { className: "trellis-desc" }, task.description.slice(0, 240)) : null,
		createElement("div", { className: "trellis-foot" },
			createElement("span", null, task.name),
			createElement("span", null, `${task.createdAt}${docs ? " · " + docs : ""}`)));
}

/** The board page rendered into the layout's root `main` slot. */
function TrellisBoardPage() {
	const { loading, error, tasks, root, refresh } = useTrellisTasks();
	const active = tasks.filter((t) => !t.archived);
	const archived = tasks.filter((t) => t.archived);
	return createElement("div", { className: "trellis-page" },
		createElement("header", { className: "trellis-header" },
			createElement("h1", null, "Trellis Board"),
			createElement("span", { className: "trellis-counts" }, loading ? "loading…" : `${active.length} active · ${archived.length} archived`),
			createElement("span", { className: "trellis-root" }, root ?? ""),
			createElement("button", { className: "trellis-refresh", onClick: refresh, title: "Refresh" }, "⟳")),
		error ? createElement("div", { className: "trellis-error" }, "Failed to load tasks: ", error) : null,
		createElement("main", { className: "trellis-grid" },
			[...active, ...archived].map((t) => createElement(TaskCard, { key: t.dir, task: t }))),
		createElement("style", null, TRELLIS_CSS));
}

const TRELLIS_CSS = `
.trellis-page { height: 100%; overflow-y: auto; padding: 0; }
.trellis-header { display: flex; align-items: baseline; gap: 14px; padding: 18px 24px 10px; position: sticky; top: 0; background: var(--dsh-bg, #0f1117); z-index: 2; }
.trellis-header h1 { margin: 0; font-size: 18px; font-weight: 600; }
.trellis-counts { color: var(--dsh-text-muted, #8b93a7); font-size: 12.5px; }
.trellis-root { margin-left: auto; color: var(--dsh-text-muted, #5b6478); font-size: 11.5px; font-family: Consolas, monospace; }
.trellis-refresh { border: 1px solid var(--dsh-border, #262c3e); background: transparent; color: inherit; border-radius: 6px; width: 26px; height: 26px; cursor: pointer; }
.trellis-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; padding: 10px 24px 24px; }
.trellis-card { border: 1px solid var(--dsh-border, #262c3e); border-radius: 10px; padding: 13px 15px; display: flex; flex-direction: column; gap: 8px; background: var(--dsh-bg-elevated, #171b26); }
.trellis-card h3 { margin: 0; font-size: 14px; line-height: 1.45; font-weight: 600; }
.trellis-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.trellis-pill { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: var(--dsh-bg-inset, #232a3d); color: var(--dsh-text-muted, #aab3c8); }
.trellis-pill.planning { background: #3a3418; color: #e6c85a; }
.trellis-pill.in_progress { background: #16344a; color: #5cb8f0; }
.trellis-pill.completed { background: #163a28; color: #58d68d; }
.trellis-pill.archived { background: #22252e; color: #6a7284; }
.trellis-desc { margin: 0; font-size: 12px; color: var(--dsh-text-muted, #9aa3b8); line-height: 1.5; flex: 1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; }
.trellis-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 10.5px; color: var(--dsh-text-muted, #5b6478); font-family: Consolas, monospace; }
.trellis-card.completed, .trellis-card.archived { opacity: .55; }
.trellis-error { margin: 8px 24px; color: #f08c8c; font-size: 13px; }
`;

/** Register sidebar entry + main panel, following the ui-plugin-manager pattern. */
export function apply(ctx) {
	const register = () => {
		try {
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 50,
					label: "Trellis"
				}, IconBoard));
			ctx.slots.inject("main", () =>
				ctx.slots.register({
					name: "main",
					key: PANEL_ID
				}, TrellisBoardPage));
		} catch (error) {
			console.error("[dsh-trellis] client contribution failed:", error);
		}
	};
	register();
}

export default { name, inject, apply };
