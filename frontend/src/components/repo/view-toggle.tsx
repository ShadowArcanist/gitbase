import { LayoutGridIcon, LayoutListIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type RepoView = "list" | "grid";

const STORAGE_KEY = "gitbase:repo-view";

export function getStoredView(): RepoView {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === "grid" ? "grid" : "list";
	} catch {
		return "list";
	}
}

export function storeView(v: RepoView) {
	try {
		localStorage.setItem(STORAGE_KEY, v);
	} catch {}
}

export function ViewToggle({
	view,
	onChange,
}: {
	view: RepoView;
	onChange: (v: RepoView) => void;
}) {
	const btn =
		"flex items-center justify-center size-7 rounded-md transition-colors";
	return (
		<div className="flex items-center rounded-lg border border-border bg-surface-0 p-0.5">
			<button
				type="button"
				onClick={() => onChange("list")}
				className={cn(btn, view === "list" ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground")}
				title="List view"
			>
				<LayoutListIcon size={14} strokeWidth={2} />
			</button>
			<button
				type="button"
				onClick={() => onChange("grid")}
				className={cn(btn, view === "grid" ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground")}
				title="Grid view"
			>
				<LayoutGridIcon size={14} strokeWidth={2} />
			</button>
		</div>
	);
}
