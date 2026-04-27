import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FolderClosedIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardContentLoading } from "@/components/layouts/dashboard-content-loading";
import { NewRepoDialog } from "@/components/repo/new-repo-dialog";
import { RepositoryCard } from "@/components/repo/repository-card";
import { RepositoryRow } from "@/components/repo/repository-row";
import { type RepoView, ViewToggle, getStoredView, storeView } from "@/components/repo/view-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Repo, api } from "@/lib/api";

export const Route = createFileRoute("/repos/")({
	validateSearch: (s: Record<string, unknown>): { namespace?: string } => ({
		namespace: typeof s.namespace === "string" && s.namespace ? s.namespace : undefined,
	}),
	component: RepoList,
});

function RepoList() {
	const { namespace: nsFilter } = Route.useSearch();
	const [q, setQ] = useState("");
	const [view, setView] = useState<RepoView>(getStoredView);
	const { data, isLoading } = useQuery({
		queryKey: ["repos", q, nsFilter ?? ""],
		queryFn: () => api.listRepos(q, nsFilter),
	});
	const nsListQ = useQuery({
		queryKey: ["namespaces"],
		queryFn: () => api.listNamespaces(),
	});
	const nsImages = useMemo(() => {
		const m: Record<string, string> = {};
		for (const ns of nsListQ.data ?? []) {
			if (ns.image_path) m[ns.name] = ns.image_path;
		}
		return m;
	}, [nsListQ.data]);

	const grouped = useMemo(() => {
		const g: Record<string, Repo[]> = {};
		for (const r of data ?? []) {
			const ns = r.namespace || "(root)";
			(g[ns] ??= []).push(r);
		}
		return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
	}, [data]);

	return (
		<div className="overflow-stable h-full overflow-auto py-10">
			<div className="mx-auto flex max-w-6xl flex-col gap-6 px-3 md:px-6">
				<div className="flex items-end justify-between gap-4">
					<div className="flex flex-col gap-1.5">
						<h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
						<p className="text-sm text-muted-foreground">
							Browse and organize your Git repositories.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<NewRepoDialog
							trigger={
								<Button size="sm" iconLeft={<PlusIcon size={14} strokeWidth={2} />}>
									New repository
								</Button>
							}
						/>
					</div>
				</div>

				<div className="flex flex-col gap-6">
					<div className="flex items-center gap-2">
						<div className="relative flex-1">
							<SearchIcon
								size={14}
								strokeWidth={2}
								className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								type="search"
								value={q}
								onChange={(e) => setQ(e.target.value)}
								placeholder="Search repositories"
								className="h-8 pl-8 text-sm"
							/>
						</div>
						<ViewToggle view={view} onChange={(v) => { setView(v); storeView(v); }} />
					</div>

					{isLoading ? (
						<DashboardContentLoading />
					) : grouped.length === 0 ? (
						q.trim() ? <NoResults query={q} /> : <EmptyState />
					) : (
						<div className="flex flex-col gap-6">
							{grouped.map(([ns, repos]) => (
								<section key={ns} className="flex flex-col gap-2">
									<h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-1">
										{nsImages[ns] ? (
											<img
												src={api.namespaceImageUrl(ns)}
												alt=""
												aria-hidden
												className="size-4 shrink-0 rounded-sm object-cover"
											/>
										) : (
											<FolderClosedIcon size={11} strokeWidth={2} />
										)}
										<span className="leading-none">{ns}</span>
									</h2>
									{view === "list" ? (
										<div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
											{repos.map((r) => (
												<RepositoryRow key={r.id} repo={r} />
											))}
										</div>
									) : (
										<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
											{repos.map((r) => (
												<RepositoryCard key={r.id} repo={r} />
											))}
										</div>
									)}
								</section>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="rounded-xl border border-dashed border-border bg-surface-1 p-10 text-center">
			<p className="text-sm text-muted-foreground">
				No repositories yet. Create a new repository by clicking the{" "}
				<span className="font-medium text-foreground">+ New repository</span>{" "}
				button.
			</p>
		</div>
	);
}

function NoResults({ query }: { query: string }) {
	return (
		<div className="rounded-xl border border-dashed border-border bg-surface-1 p-10 text-center">
			<p className="text-sm text-muted-foreground">
				No result found for{" "}
				<span className="font-medium text-foreground">"{query}"</span>.
			</p>
		</div>
	);
}
