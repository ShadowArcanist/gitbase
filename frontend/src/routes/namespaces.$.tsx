import {
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	Link,
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { FolderClosedIcon, FolderIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DashboardContentLoading } from "@/components/layouts/dashboard-content-loading";
import { RepositoryCard } from "@/components/repo/repository-card";
import { RepositoryRow } from "@/components/repo/repository-row";
import { type RepoView, ViewToggle, getStoredView, storeView } from "@/components/repo/view-toggle";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { type Namespace, api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "repos" | "settings";

export const Route = createFileRoute("/namespaces/$")({
	validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({
		tab: s.tab === "settings" ? "settings" : undefined,
	}),
	component: NamespaceDetail,
});

function NamespaceDetail() {
	const { _splat } = Route.useParams();
	const name = _splat ?? "";
	const search = useSearch({ from: Route.id });
	const tab: Tab = search.tab ?? "repos";

	const nsQ = useQuery({
		queryKey: ["namespace", name],
		queryFn: () => api.getNamespace(name),
	});
	const reposQ = useQuery({
		queryKey: ["namespace-repos", name],
		queryFn: () => api.listNamespaceRepos(name),
	});
	const ns = nsQ.data;
	const [view, setView] = useState<RepoView>(getStoredView);

	return (
		<div className="overflow-stable h-full overflow-auto">
			<div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 py-8 md:px-6">
				{ns ? (
					<>
						<NamespaceHeader ns={ns} repoCount={reposQ.data?.length ?? 0} />
						<TabsBar name={name} tab={tab} view={view} onViewChange={(v) => { setView(v); storeView(v); }} />
						<div className="pt-2">
							{tab === "repos" && (
								<ReposPanel repos={reposQ.data ?? []} loading={reposQ.isLoading} view={view} />
							)}
							{tab === "settings" && <SettingsPanel ns={ns} />}
						</div>
					</>
				) : (
					<Skeleton className="h-40 rounded-xl" />
				)}
			</div>
		</div>
	);
}

function NamespaceHeader({
	ns,
	repoCount,
}: {
	ns: Namespace;
	repoCount: number;
}) {
	return (
		<div className="flex flex-col gap-3 border-b border-border pb-4">
			<div className="flex min-w-0 items-center gap-3">
				<div
					className={cn(
						"flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-1 text-muted-foreground",
						ns.description ? "size-14" : "size-9",
					)}
				>
					{ns.image_path ? (
						<img
							src={api.namespaceImageUrl(ns.name)}
							alt=""
							aria-hidden
							className="size-full object-cover"
						/>
					) : (
						<FolderClosedIcon size={ns.description ? 22 : 16} strokeWidth={1.8} />
					)}
				</div>
				<div className="flex min-w-0 flex-col justify-center">
					<div className="flex items-center gap-2">
						<h1 className="text-2xl font-semibold tracking-tight leading-none">
							{ns.name}
						</h1>
						<span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
							{repoCount} {repoCount === 1 ? "repo" : "repos"}
						</span>
					</div>
					{ns.description && (
						<p className="mt-1 truncate text-sm leading-none text-muted-foreground">
							{ns.description}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

function TabsBar({ name, tab, view, onViewChange }: { name: string; tab: Tab; view: RepoView; onViewChange: (v: RepoView) => void }) {
	const nav = useNavigate();
	const items: { id: Tab; label: string; icon: typeof FolderIcon }[] = [
		{ id: "repos", label: "Repositories", icon: FolderIcon },
		{ id: "settings", label: "Settings", icon: SettingsIcon },
	];
	return (
		<div className="flex items-center gap-2">
			{items.map((it) => {
				const active = tab === it.id;
				return (
					<button
						key={it.id}
						type="button"
						onClick={() =>
							nav({
								to: "/namespaces/$",
								params: { _splat: name },
								search: { tab: it.id === "repos" ? undefined : it.id },
							})
						}
						className={cn(
							"inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-[13px] font-medium transition-colors",
							active
								? "bg-surface-2 text-foreground"
								: "bg-surface-1 text-foreground hover:bg-surface-2",
						)}
					>
						<it.icon size={13} strokeWidth={2} className="shrink-0" />
						<span className="optical-center">{it.label}</span>
					</button>
				);
			})}
			{tab === "repos" && (
				<div className="ml-auto">
					<ViewToggle view={view} onChange={onViewChange} />
				</div>
			)}
		</div>
	);
}

function ReposPanel({
	repos,
	loading,
	view,
}: {
	repos: { id: number; slug: string }[] & { [k: string]: unknown }[];
	loading: boolean;
	view: RepoView;
}) {
	if (loading) return <DashboardContentLoading />;
	if (repos.length === 0) {
		return (
			<div className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed bg-surface-1 p-10 text-center text-sm text-muted-foreground">
				<span>No repositories in this namespace.</span>
				<Link
					to="/repos"
					className="text-sm text-foreground underline-offset-4 hover:underline"
				>
					Add repository →
				</Link>
			</div>
		);
	}
	const typed = repos as Parameters<typeof RepositoryRow>[0]["repo"][];
	return (
		<div className="flex flex-col gap-3">
			{view === "list" ? (
				<div className="overflow-hidden rounded-xl border border-border bg-surface-1 divide-y divide-border">
					{typed.map((r) => (
						<RepositoryRow key={r.id} repo={r} />
					))}
				</div>
			) : (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{typed.map((r) => (
						<RepositoryCard key={r.id} repo={r} />
					))}
				</div>
			)}
		</div>
	);
}

function SettingsPanel({ ns }: { ns: Namespace }) {
	const qc = useQueryClient();
	const nav = useNavigate();
	const [name, setName] = useState(ns.name);
	const [description, setDescription] = useState(ns.description);
	const [confirmDel, setConfirmDel] = useState(false);
	const [confirmText, setConfirmText] = useState("");

	const save = useMutation({
		mutationFn: () =>
			api.patchNamespace(ns.name, {
				name: name !== ns.name ? name : undefined,
				description,
			}),
		onSuccess: (n) => {
			toast.success("Saved");
			qc.invalidateQueries({ queryKey: ["namespace"] });
			qc.invalidateQueries({ queryKey: ["namespaces"] });
			qc.invalidateQueries({ queryKey: ["repos"] });
			if (n.name !== ns.name) {
				nav({
					to: "/namespaces/$",
					params: { _splat: n.name },
					search: { tab: "settings" },
				});
			}
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const del = useMutation({
		mutationFn: () => api.deleteNamespace(ns.name),
		onSuccess: () => {
			toast.success("Deleted");
			qc.invalidateQueries({ queryKey: ["namespaces"] });
			nav({ to: "/namespaces" });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const uploadImg = useMutation({
		mutationFn: (file: File) => api.uploadNamespaceImage(ns.name, file),
		onSuccess: () => {
			toast.success("Image updated");
			qc.invalidateQueries({ queryKey: ["namespace"] });
			qc.invalidateQueries({ queryKey: ["namespaces"] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const removeImg = useMutation({
		mutationFn: () => api.deleteNamespaceImage(ns.name),
		onSuccess: () => {
			toast.success("Image removed");
			qc.invalidateQueries({ queryKey: ["namespace"] });
			qc.invalidateQueries({ queryKey: ["namespaces"] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="flex flex-col gap-4">
			<section className="flex flex-col gap-5 rounded-xl border border-border/70 p-6">
				<div className="flex items-start justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h3 className="text-sm font-semibold">General</h3>
						<p className="text-xs text-muted-foreground">
							Namespace identity and metadata.
						</p>
					</div>
					<Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
						{save.isPending ? "Saving…" : "Save changes"}
					</Button>
				</div>
				<Field label="Name">
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="h-8 text-sm"
					/>
				</Field>
				<Field label="Description">
					<Textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						className="text-sm"
					/>
				</Field>
			</section>

			<section className="flex flex-col gap-4 rounded-xl border border-border/70 p-6">
				<div className="flex flex-col gap-1">
					<h3 className="text-sm font-semibold">Image</h3>
					<p className="text-xs text-muted-foreground">
						Square image used as namespace icon.
					</p>
				</div>
				<div className="flex items-center gap-4">
					{ns.image_path ? (
						<img
							src={api.namespaceImageUrl(ns.name)}
							alt=""
							className="size-16 shrink-0 rounded-md border border-border object-cover"
						/>
					) : (
						<div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-surface-1 text-muted-foreground">
							<FolderClosedIcon size={20} strokeWidth={1.8} />
						</div>
					)}
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<label className="inline-flex">
								<input
									type="file"
									accept="image/png,image/jpeg,image/webp,image/gif"
									className="hidden"
									onChange={(e) => {
										const f = e.target.files?.[0];
										if (f) uploadImg.mutate(f);
										e.target.value = "";
									}}
								/>
								<Button
									asChild
									size="sm"
									variant="secondary"
									disabled={uploadImg.isPending}
								>
									<span>{uploadImg.isPending ? "Uploading…" : "Upload image"}</span>
								</Button>
							</label>
							{ns.image_path && (
								<Button
									size="sm"
									variant="ghost"
									disabled={removeImg.isPending}
									onClick={() => removeImg.mutate()}
									className="text-muted-foreground hover:text-destructive"
								>
									Remove
								</Button>
							)}
						</div>
						<p className="text-[11px] text-muted-foreground">
							Recommended PNG, 256×256, max 4 MB.
						</p>
					</div>
				</div>
			</section>

			<section className="flex flex-col gap-4 rounded-xl border border-border/70 p-6">
				<div className="flex items-start justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h3 className="text-sm font-semibold">Danger zone</h3>
						<p className="text-xs text-muted-foreground">
							Permanently delete this namespace. Only allowed if no repositories remain.
						</p>
					</div>
					<AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
						<AlertDialogTrigger asChild>
							<Button variant="destructive" size="sm">
								Delete namespace
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent className="gap-0 p-0 sm:max-w-lg">
							<AlertDialogHeader className="gap-1.5 px-5 pt-5 pb-4">
								<AlertDialogTitle className="text-[0.9375rem]">
									Delete {ns.name}?
								</AlertDialogTitle>
								<AlertDialogDescription className="text-[0.8125rem]">
									Type <code className="font-mono text-foreground">{ns.name}</code> to confirm.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<div className="px-5 pb-5">
								<Input
									value={confirmText}
									onChange={(e) => setConfirmText(e.target.value)}
									className="h-9"
									placeholder={ns.name}
								/>
							</div>
							<AlertDialogFooter className="border-t border-border/70 px-5 py-3.5">
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									disabled={confirmText !== ns.name || del.isPending}
									onClick={(e) => {
										e.preventDefault();
										del.mutate();
									}}
									className="btn-grad-danger text-white shadow-xs"
								>
									Delete
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</section>
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-xs font-medium">{label}</Label>
			{children}
		</div>
	);
}
