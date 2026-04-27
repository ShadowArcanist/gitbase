import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
	FolderClosedIcon,
	HardDriveIcon,
	PlusIcon,
	SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardContentLoading } from "@/components/layouts/dashboard-content-loading";
import { NewNamespaceDialog } from "@/components/repo/new-namespace-dialog";
import { type RepoView, ViewToggle, getStoredView, storeView } from "@/components/repo/view-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type NamespaceSummary, api } from "@/lib/api";
import { formatBytes } from "@/lib/utils";

export const Route = createFileRoute("/namespaces/")({
	component: NamespacesPage,
});

function NamespacesPage() {
	const q = useQuery({
		queryKey: ["namespaces"],
		queryFn: () => api.listNamespaces(),
	});
	const [search, setSearch] = useState("");
	const [view, setView] = useState<RepoView>(getStoredView);

	const filtered = useMemo(() => {
		const all = q.data ?? [];
		const term = search.trim().toLowerCase();
		if (!term) return all;
		return all.filter(
			(ns) =>
				ns.name.toLowerCase().includes(term) ||
				ns.description.toLowerCase().includes(term),
		);
	}, [q.data, search]);

	const hasAny = (q.data ?? []).length > 0;

	return (
		<div className="overflow-stable h-full overflow-auto py-10">
			<div className="mx-auto flex max-w-6xl flex-col gap-6 px-3 md:px-6">
				<div className="flex items-end justify-between gap-4">
					<div className="flex flex-col gap-1.5">
						<h1 className="text-2xl font-semibold tracking-tight">Namespaces</h1>
						<p className="text-sm text-muted-foreground">
							Folder-based grouping for repositories.
						</p>
					</div>
					<NewNamespaceDialog
						trigger={
							<Button size="sm" iconLeft={<PlusIcon size={14} strokeWidth={2} />}>
								Add namespace
							</Button>
						}
					/>
				</div>

				<div className="flex items-center gap-2">
					<div className="relative flex-1">
						<SearchIcon
							size={14}
							strokeWidth={2}
							className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							type="search"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search namespaces"
							className="h-8 pl-8 text-sm"
						/>
					</div>
					<ViewToggle view={view} onChange={(v) => { setView(v); storeView(v); }} />
				</div>

				{q.isLoading ? (
					<DashboardContentLoading />
				) : !hasAny ? (
					<div className="rounded-xl border border-dashed bg-surface-1 p-10 text-center text-sm text-muted-foreground">
						No namespaces yet. Create a namespace by clicking the{" "}
						<span className="font-medium text-foreground">+ Add namespace</span>{" "}
						button.
					</div>
				) : filtered.length === 0 ? (
					<div className="rounded-xl border border-dashed bg-surface-1 p-10 text-center text-sm text-muted-foreground">
						No result found for{" "}
						<span className="font-medium text-foreground">"{search}"</span>.
					</div>
				) : view === "list" ? (
					<div className="overflow-hidden rounded-xl border bg-surface-1">
						<div className="divide-y divide-border">
							{filtered.map((ns) => (
								<NamespaceRow key={ns.name} ns={ns} />
							))}
						</div>
					</div>
				) : (
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{filtered.map((ns) => (
							<NamespaceCard key={ns.name} ns={ns} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function NamespaceRow({ ns }: { ns: NamespaceSummary }) {
	return (
		<Link
			to="/namespaces/$"
			params={{ _splat: ns.name }}
			className="grid grid-cols-[14rem_minmax(0,1fr)_auto_auto_auto] items-center gap-6 px-4 py-3 text-sm transition-colors hover:bg-primary/10"
		>
			<div className="flex min-w-0 items-center gap-2">
				<NamespaceAvatar ns={ns} />
				<span className="truncate font-medium leading-none">{ns.name}</span>
			</div>
			<span className="truncate text-xs text-muted-foreground">
				{ns.description || <span className="text-muted-foreground/40">—</span>}
			</span>
			<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
				<FolderClosedIcon size={11} strokeWidth={2} className="shrink-0" />
				<span className="leading-none">{ns.repo_count}</span>
			</span>
			<span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
				<HardDriveIcon size={11} strokeWidth={2} className="shrink-0" />
				<span className="leading-none">{formatBytes(ns.size_bytes)}</span>
			</span>
		</Link>
	);
}

function NamespaceCard({ ns }: { ns: NamespaceSummary }) {
	return (
		<Link
			to="/namespaces/$"
			params={{ _splat: ns.name }}
			className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3.5 transition-colors hover:bg-primary/10"
		>
			{ns.image_path ? (
				<img
					src={api.namespaceImageUrl(ns.name)}
					alt=""
					aria-hidden
					className="size-8 shrink-0 rounded-lg object-cover"
				/>
			) : (
				<span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
					<FolderClosedIcon size={16} strokeWidth={1.8} aria-hidden />
				</span>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-semibold leading-tight">{ns.name}</span>
					<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
						{ns.repo_count} {ns.repo_count === 1 ? "repo" : "repos"}
					</span>
					<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
						{formatBytes(ns.size_bytes)}
					</span>
				</div>
				{ns.description ? (
					<p className="truncate text-xs text-muted-foreground">{ns.description}</p>
				) : (
					<p className="text-xs text-muted-foreground/40">No description</p>
				)}
			</div>
		</Link>
	);
}

function NamespaceAvatar({ ns }: { ns: NamespaceSummary }) {
	if (ns.image_path) {
		return (
			<img
				src={api.namespaceImageUrl(ns.name)}
				alt=""
				aria-hidden
				className="size-6 shrink-0 rounded-md object-cover"
			/>
		);
	}
	return (
		<span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
			<FolderClosedIcon size={13} strokeWidth={2} />
		</span>
	);
}
