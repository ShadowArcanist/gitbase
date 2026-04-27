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
import {
	ChevronDownIcon,
	ArrowLeftIcon,
	CircleDotIcon,
	CodeIcon,
	GitPullRequestIcon,
	CopyIcon,
	FileIcon,
	FolderIcon,
	GitBranchIcon,
	GitCommitHorizontalIcon,
	GitMergeIcon,
	PlusIcon,
	SearchIcon,
	SettingsIcon,
	SplitIcon,
	TerminalIcon,
	Trash2Icon,
} from "lucide-react";
import { Suspense, use, useMemo, useState } from "react";
import { toast } from "sonner";

import { CodeFileView } from "@/components/repo/code-file-view";
import { CommitAvatar } from "@/components/repo/commit-avatar";
import { CommitPage } from "@/components/repo/commit-page";
import { IssueDetail } from "@/components/repo/issue-detail";
import { IssuesTab } from "@/components/repo/issues-tab";
import { LabelsPage } from "@/components/repo/labels-page";
import { PullDetail } from "@/components/repo/pull-detail";
import { PullsTab } from "@/components/repo/pulls-tab";
import { RepoFileTree } from "@/components/repo/repo-file-tree";
import { FolderView } from "@/components/repo/folder-view";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { highlightCode, Markdown } from "@/components/ui/markdown";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { type Repo, api, slugToUrl } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn, formatBytes } from "@/lib/utils";

type Tab = "code" | "commits" | "branches" | "issues" | "pulls" | "settings";

type RepoSearch = {
	tab?: Tab;
	rev?: string;
	path?: string;
	sha?: string;
	file?: string;
	issue?: number;
	labels?: boolean;
	pr?: number;
};

type TreeQueryData = { entries: { name: string; type: string }[] };

function showToolbarFor(_tab: Tab, _search: RepoSearch): boolean {
	return true;
}

function isKnownBlob(
	qc: ReturnType<typeof useQueryClient>,
	slug: string,
	rev: string,
	path: string,
): boolean {
	if (!path) return false;
	const slash = path.lastIndexOf("/");
	const parent = slash >= 0 ? path.slice(0, slash) : "";
	const name = slash >= 0 ? path.slice(slash + 1) : path;
	const data = qc.getQueryData<TreeQueryData>(["tree", slug, rev, parent]);
	if (!data?.entries) return false;
	const entry = data.entries.find((e) => e.name === name);
	return entry?.type === "blob";
}

export const Route = createFileRoute("/repos/$")({
	validateSearch: (s: Record<string, unknown>): RepoSearch => ({
		tab: (s.tab as Tab) ?? undefined,
		rev: typeof s.rev === "string" ? s.rev : undefined,
		path: typeof s.path === "string" ? s.path : undefined,
		sha: typeof s.sha === "string" ? s.sha : undefined,
		file: typeof s.file === "string" ? s.file : undefined,
		issue: typeof s.issue === "number" ? s.issue : undefined,
		labels: s.labels === true ? true : undefined,
		pr: typeof s.pr === "number" ? s.pr : undefined,
	}),
	loader: ({ params, context }) => {
		const slug = params._splat ?? "";
		return Promise.all([
			context.queryClient.ensureQueryData({
				queryKey: ["repo", slug],
				queryFn: () => api.getRepo(slug),
			}),
			context.queryClient.ensureQueryData({
				queryKey: ["branches", slug],
				queryFn: () => api.branches(slug),
			}),
		]);
	},
	component: RepoPage,
});

function RepoPage() {
	const { _splat } = Route.useParams();
	const slug = _splat ?? "";
	const search = useSearch({ from: Route.id });
	const repoQ = useQuery({
		queryKey: ["repo", slug],
		queryFn: () => api.getRepo(slug),
	});
	const branchesQ = useQuery({
		queryKey: ["branches", slug],
		queryFn: () => api.branches(slug),
		enabled: Boolean(repoQ.data),
	});
	const isEmpty = branchesQ.isFetched && (branchesQ.data?.branches?.length ?? 0) === 0;
	const requestedTab: Tab = search.tab ?? "code";
	const tab: Tab =
		isEmpty && requestedTab !== "settings" ? "code" : requestedTab;
	return (
		<div className="overflow-stable h-full overflow-auto">
			<div className="mx-auto flex max-w-6xl flex-col gap-3 px-3 py-8 md:px-6">
				{repoQ.data ? (
					<>
						<RepoHeader repo={repoQ.data} />
						{showToolbarFor(tab, search) && (
							<RepoToolbar
								repo={repoQ.data}
								rev={search.rev ?? repoQ.data.default_branch ?? "HEAD"}
								tab={tab}
								isEmpty={isEmpty}
								search={search}
							/>
						)}
						<div>
							{tab === "code" && (
								<CodeTab
									repo={repoQ.data}
									rev={search.rev}
									path={search.path ?? ""}
									isEmpty={isEmpty}
								/>
							)}
							{tab === "commits" && (
								<CommitsTab
									repo={repoQ.data}
									rev={search.rev}
									sha={search.sha}
									file={search.file}
								/>
							)}
							{tab === "branches" && <BranchesTab repo={repoQ.data} />}
							{tab === "issues" && (
								<IssuesTabWrapper repo={repoQ.data} search={search} />
							)}
							{tab === "pulls" && (
								<PullsTabWrapper repo={repoQ.data} search={search} />
							)}
							{tab === "settings" && <SettingsTab repo={repoQ.data} />}
						</div>
					</>
				) : (
					<Skeleton className="h-40 rounded-xl" />
				)}
			</div>
		</div>
	);
}

function RepoHeader({ repo }: { repo: Repo }) {
	const sshQ = useQuery({
		queryKey: ["ssh-status"],
		queryFn: () => api.sshStatus(),
		staleTime: 60_000,
	});
	const publicUrl = sshQ.data?.public_url;
	const base = publicUrl || window.location.origin;
	const httpUrl = `${base}/git/${repo.slug}.git`;
	const sshEnabled = sshQ.data?.enabled ?? false;
	const sshPort = sshQ.data?.port ?? 2222;
	const hostname = publicUrl ? new URL(publicUrl).hostname : window.location.hostname;
	const sshUrl = sshPort === 22
		? `git@${hostname}:${repo.slug}.git`
		: `ssh://git@${hostname}:${sshPort}/${repo.slug}.git`;
	const ownerPath = repo.namespace.split("/").filter(Boolean);
	return (
		<div className="flex flex-col gap-3 border-b border-border pb-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-1 items-center gap-3">
					<div
						className={cn(
							"flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-1 text-muted-foreground",
							repo.description ? "size-14" : "size-9",
						)}
					>
						{repo.image_path ? (
							<img
								src={api.repoImageUrl(repo.slug)}
								alt=""
								aria-hidden
								className="size-full object-cover"
							/>
						) : (
							<FolderIcon size={repo.description ? 22 : 16} strokeWidth={1.8} />
						)}
					</div>
					<div className="flex min-w-0 flex-col justify-center">
						<div className="flex items-center gap-2">
							<h1 className="text-2xl font-semibold tracking-tight leading-none">
								{repo.name}
							</h1>
						</div>
						{repo.description && (
							<p className="mt-1 truncate text-sm leading-none text-muted-foreground">
								{repo.description}
							</p>
						)}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2 self-end">
					<CodeDropdown httpUrl={httpUrl} sshUrl={sshUrl} sshEnabled={sshEnabled} />
				</div>
			</div>
		</div>
	);
}

function CodeDropdown({
	httpUrl,
	sshUrl,
	sshEnabled,
}: {
	httpUrl: string;
	sshUrl: string;
	sshEnabled: boolean;
}) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="default"
					size="sm"
					iconLeft={<CodeIcon size={14} strokeWidth={2} />}
					iconRight={<ChevronDownIcon size={14} strokeWidth={2} />}
				>
					Code
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-[28rem] p-0"
				onOpenAutoFocus={(e) => e.preventDefault()}
			>
				<div className="flex flex-col">
					<UrlRow label={`Clone with ${httpUrl.startsWith("https") ? "HTTPS" : "HTTP"}`} url={httpUrl} icon={CodeIcon} />
					{sshEnabled && (
						<UrlRow label="Clone with SSH" url={sshUrl} icon={TerminalIcon} />
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function UrlRow({
	label,
	url,
	icon: Icon,
	muted,
}: {
	label: string;
	url: string;
	icon: typeof CodeIcon;
	muted?: boolean;
}) {
	return (
		<div className={cn("flex flex-col gap-1.5 border-b border-border last:border-b-0 px-3 py-3", muted && "bg-surface-1")}>
			<div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
				<Icon size={11} strokeWidth={2} />
				{label}
			</div>
			<div className="flex items-stretch gap-1">
				<div className="border-input flex h-9 w-full min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none">
					<Suspense
						fallback={
							<code className="font-mono text-xs leading-[1.4]">{url}</code>
						}
					>
						<ColoredUrl url={url} />
					</Suspense>
				</div>
				<Button
					variant="outline"
					size="icon"
					className="size-9 shrink-0 bg-transparent"
					onClick={() => {
						navigator.clipboard.writeText(url).then(
							() => toast.success("Copied"),
							() => toast.error("Copy failed"),
						);
					}}
					aria-label="Copy"
				>
					<CopyIcon size={13} strokeWidth={2} />
				</Button>
			</div>
		</div>
	);
}


function TabsBar({
	slug,
	tab,
	hideContent,
}: {
	slug: string;
	tab: Tab;
	hideContent?: boolean;
}) {
	const nav = useNavigate();
	const slugUrl = slug;
	const all: { id: Tab; label: string; icon: typeof FileIcon }[] = [
		{ id: "code", label: "Code", icon: FileIcon },
		{ id: "settings", label: "Settings", icon: SettingsIcon },
	];
	const items = all;
	return (
		<div className="flex items-center gap-0.5 -mt-1">
			{items.map((it) => {
				const active = tab === it.id;
				return (
					<button
						key={it.id}
						type="button"
						onClick={() =>
							nav({
								to: "/repos/$",
								params: { _splat: slugUrl },
								search: { tab: it.id === "code" ? undefined : it.id },
							})
						}
						className={cn(
							"inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
							active
								? "bg-surface-1 text-foreground"
								: "text-muted-foreground hover:bg-surface-1 hover:text-foreground",
						)}
					>
						<it.icon size={14} strokeWidth={2} className="shrink-0" />
						<span className="relative top-px leading-none">{it.label}</span>
					</button>
				);
			})}
		</div>
	);
}

function RepoToolbar({
	repo,
	rev,
	tab,
	isEmpty,
	search,
}: {
	repo: Repo;
	rev: string;
	tab: Tab;
	isEmpty?: boolean;
	search: RepoSearch;
}) {
	const nav = useNavigate();
	const branchesQ = useQuery({
		queryKey: ["branches", repo.slug],
		queryFn: () => api.branches(repo.slug),
		staleTime: 60_000,
	});
	const commitCountQ = useQuery({
		queryKey: ["commit-count", repo.slug, rev],
		queryFn: () => api.commitCount(repo.slug, rev),
		staleTime: 60_000,
	});
	const branches = branchesQ.data?.branches ?? [];
	const commitCount = commitCountQ.data?.count ?? 0;

	const issuesQ = useQuery({
		queryKey: ["issues", repo.slug, "open"],
		queryFn: () => api.listIssues(repo.slug, "open"),
		staleTime: 60_000,
	});
	const openIssueCount = issuesQ.data?.open_count ?? 0;

	const prsQ = useQuery({
		queryKey: ["pulls", repo.slug, "open"],
		queryFn: () => api.listPRs(repo.slug, "open"),
		staleTime: 60_000,
	});
	const openPRCount = prsQ.data?.open_count ?? 0;

	const isOtherTab = tab === "branches" || tab === "settings" || tab === "issues" || tab === "pulls";
	const hasPath = tab === "code" && !!search.path;
	const isCommitsTab = tab === "commits";
	const showBackLink = hasPath || isCommitsTab || isOtherTab;

	if (isEmpty && !isOtherTab) {
		return (
			<div className="flex flex-wrap items-center gap-2">
				<div className="ml-auto">
					<button
						type="button"
						onClick={() =>
							nav({
								to: "/repos/$",
								params: { _splat: repo.slug },
								search: { tab: "settings" },
							})
						}
						className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-surface-1 px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2"
					>
						<SettingsIcon size={13} strokeWidth={2} />
						<span className="optical-center">Settings</span>
					</button>
				</div>
			</div>
		);
	}

	const chipClass = "inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-surface-1 px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2";

	return (
		<div className="flex flex-wrap items-center gap-2">
			{showBackLink && (
				<Link
					to="/repos/$"
					params={{ _splat: repo.slug }}
					search={{ tab: undefined }}
					className={chipClass + " !px-1.5"}
				>
					<ArrowLeftIcon size={14} strokeWidth={2} />
				</Link>
			)}
			{!isOtherTab && !isCommitsTab && (
				<>
					<Select
						value={rev}
						onValueChange={(v) =>
							nav({
								to: "/repos/$",
								params: { _splat: repo.slug },
								search: { tab: undefined, rev: v },
							})
						}
						disabled={branches.length === 0}
					>
						<SelectTrigger className="h-8 w-auto gap-1.5 border-border/70 bg-surface-1 px-2.5 !text-[14px] font-medium [&_[data-slot=select-value]]:!text-[14px] [&_[data-slot=select-value]]:!font-medium">
							<SelectValue placeholder="branch" />
						</SelectTrigger>
						<SelectContent>
							{branches.map((b) => (
								<SelectItem key={b.full} value={b.name}>
									{b.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<button
						type="button"
						onClick={() =>
							nav({
								to: "/repos/$",
								params: { _splat: repo.slug },
								search: { tab: "commits" },
							})
						}
						className={chipClass}
					>
						<GitCommitHorizontalIcon size={13} strokeWidth={2} />
						<span className="optical-center">
							<span className="tabular-nums font-semibold">
								{commitCount.toLocaleString()}
							</span>{" "}
							{commitCount === 1 ? "Commit" : "Commits"}
						</span>
					</button>
						<button
							type="button"
							onClick={() =>
								nav({
									to: "/repos/$",
									params: { _splat: repo.slug },
									search: { tab: "branches" },
								})
							}
							className={chipClass}
						>
							<SplitIcon size={13} strokeWidth={2} />
							<span className="optical-center">
								<span className="tabular-nums font-semibold">{branches.length}</span>{" "}
								{branches.length === 1 ? "Branch" : "Branches"}
							</span>
						</button>
						<button
							type="button"
							onClick={() =>
								nav({
									to: "/repos/$",
									params: { _splat: repo.slug },
									search: { tab: "issues" },
								})
							}
							className={chipClass}
						>
							<CircleDotIcon size={13} strokeWidth={2} />
							<span className="optical-center">
								<span className="tabular-nums font-semibold">{openIssueCount}</span>{" "}
								{openIssueCount === 1 ? "Issue" : "Issues"}
							</span>
						</button>
						<button
							type="button"
							onClick={() =>
								nav({
									to: "/repos/$",
									params: { _splat: repo.slug },
									search: { tab: "pulls" },
								})
							}
							className={chipClass}
						>
							<GitPullRequestIcon size={13} strokeWidth={2} />
							<span className="optical-center">
								<span className="tabular-nums font-semibold">{openPRCount}</span>{" "}
								{openPRCount === 1 ? "PR" : "PRs"}
							</span>
						</button>
				</>
			)}
			<div className="ml-auto flex items-center gap-2">
				<button
					type="button"
					onClick={() =>
						nav({
							to: "/repos/$",
							params: { _splat: repo.slug },
							search: { tab: "settings" },
						})
					}
					className={chipClass}
				>
					<SettingsIcon size={13} strokeWidth={2} />
					<span className="optical-center">Settings</span>
				</button>
			</div>
		</div>
	);
}

function CodeTab({
	repo,
	rev,
	path,
	isEmpty,
}: {
	repo: Repo;
	rev?: string;
	path: string;
	isEmpty: boolean;
}) {
	const actualRev = rev ?? repo.default_branch ?? "HEAD";
	const qc = useQueryClient();
	const knownBlob = isKnownBlob(qc, repo.slug, actualRev, path);
	const treeQ = useQuery({
		queryKey: ["tree", repo.slug, actualRev, path],
		queryFn: () => api.tree(repo.slug, actualRev, path),
		enabled: !isEmpty && !knownBlob,
		retry: false,
		staleTime: 60_000,
	});
	const readmeQ = useQuery({
		queryKey: ["readme", repo.slug, actualRev],
		queryFn: () => api.readme(repo.slug, actualRev),
		enabled: !isEmpty && !path,
	});
	if (isEmpty) {
		return <EmptyRepoGuide repo={repo} />;
	}

	const isFileView =
		!!path &&
		(treeQ.isError || knownBlob || treeQ.data?.kind === "blob");

	const rightPane = isFileView ? (
		<CodeFileView slug={repo.slug} currentRef={actualRev} path={path} />
	) : (
		<div className="flex flex-col gap-4">
			{treeQ.isLoading ? (
				<div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
			) : treeQ.data ? (
				treeQ.data.entries.length === 0 && !path ? (
					<EmptyRepoGuide repo={repo} />
				) : (
					<FolderView
						entries={treeQ.data.entries}
						slug={repo.slug}
						currentRef={actualRev}
						currentPath={path}
					/>
				)
			) : null}
			{!path && readmeQ.data?.exists && readmeQ.data.content && (
				<div className="overflow-hidden rounded-xl border bg-surface-1">
					<div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
						<FileIcon size={12} strokeWidth={2} />
						{readmeQ.data.path}
					</div>
					<div className="p-6">
						<Markdown>{readmeQ.data.content}</Markdown>
					</div>
				</div>
			)}
		</div>
	);

	if (!path) {
		return <div className="min-w-0">{rightPane}</div>;
	}

	return (
		<div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
			<aside className="hidden lg:block">
				<div className="sticky top-3 max-h-[calc(100vh-6rem)] overflow-auto rounded-xl border bg-surface-0 py-2">
					<div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						Files
					</div>
					<RepoFileTree
						slug={repo.slug}
						rev={actualRev}
						currentPath={path}
					/>
				</div>
			</aside>
			<div className="min-w-0">{rightPane}</div>
		</div>
	);
}

function EmptyRepoGuide({ repo }: { repo: Repo }) {
	const sshQ = useQuery({
		queryKey: ["ssh-status"],
		queryFn: () => api.sshStatus(),
		staleTime: 60_000,
	});
	const publicUrl = sshQ.data?.public_url;
	const base = publicUrl || window.location.origin;
	const httpUrl = `${base}/git/${repo.slug}.git`;
	const sshEnabled = sshQ.data?.enabled ?? false;
	const sshPort = sshQ.data?.port ?? 2222;
	const hostname = publicUrl ? new URL(publicUrl).hostname : window.location.hostname;
	const sshUrl = sshPort === 22
		? `git@${hostname}:${repo.slug}.git`
		: `ssh://git@${hostname}:${sshPort}/${repo.slug}.git`;
	const branch = repo.default_branch || "main";
	const newRepo = `cd path/to/your/project
git init
git add .
git commit -m "first commit"
git branch -M ${branch}
git remote add origin ${httpUrl}
git push -u origin ${branch}`;
	const existing = `cd path/to/existing/repo
git remote add origin ${httpUrl}
git branch -M ${branch}
git push -u origin ${branch}`;
	const httpLabel = httpUrl.startsWith("https") ? "HTTPS" : "HTTP";
	const cloneRows = [{ label: httpLabel, value: httpUrl }];
	if (sshEnabled) cloneRows.push({ label: "SSH", value: sshUrl });
	return (
		<div className="flex flex-col gap-4">
			<GuideBlock title="Repository URL(s)" rows={cloneRows} />
			<GuideBlock title="Push an existing folder" command={newRepo} />
			<GuideBlock title="Push an existing repository" command={existing} />
		</div>
	);
}

function HighlightedShell({ code }: { code: string }) {
	const html = use(highlightCode(code, "bash"));
	return (
		<div
			className="overflow-x-auto [&_pre]:p-4 [&_pre]:text-xs [&_pre]:leading-5"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is trusted
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

function ColoredUrl({ url }: { url: string }) {
	const html = use(highlightCode(url, "bash"));
	return (
		<div
			className="overflow-x-auto whitespace-pre font-mono text-xs [&_pre]:m-0 [&_pre]:p-0 [&_pre]:leading-[1.4] [&_code]:leading-[1.4]"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is trusted
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

function GuideBlock({
	title,
	command,
	rows,
}: {
	title: string;
	command?: string;
	rows?: { label: string; value: string }[];
}) {
	return (
		<div className="overflow-hidden rounded-xl border bg-surface-1">
			<div className="flex items-center justify-between border-b border-border bg-surface-0 px-4 py-2 text-xs font-medium text-muted-foreground">
				<span>{title}</span>
				{command && (
					<button
						type="button"
						className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
						onClick={() => {
							navigator.clipboard.writeText(command).then(
								() => toast.success("Copied"),
								() => toast.error("Copy failed"),
							);
						}}
						aria-label="Copy"
					>
						<CopyIcon size={12} strokeWidth={2} />
					</button>
				)}
			</div>
			{command && (
				<Suspense
					fallback={
						<pre className="overflow-x-auto p-4 text-xs leading-5 font-mono">
							<code>{command}</code>
						</pre>
					}
				>
					<HighlightedShell code={command} />
				</Suspense>
			)}
			{rows && (
				<div className="divide-y divide-border">
					{rows.map((r) => (
						<div key={r.label} className="flex items-center gap-3 px-4 py-2.5 text-xs">
							<span className="w-12 shrink-0 font-medium text-muted-foreground">{r.label}</span>
							<div className="flex-1 min-w-0 truncate">
								<Suspense
									fallback={
										<code className="font-mono text-xs leading-none">{r.value}</code>
									}
								>
									<ColoredUrl url={r.value} />
								</Suspense>
							</div>
							<button
								type="button"
								className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
								onClick={() => {
									navigator.clipboard.writeText(r.value).then(
										() => toast.success("Copied"),
										() => toast.error("Copy failed"),
									);
								}}
								aria-label="Copy"
							>
								<CopyIcon size={12} strokeWidth={2} />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function Breadcrumbs({
	slug,
	rev,
	path,
}: {
	slug: string;
	rev: string;
	path: string;
}) {
	const parts = path ? path.split("/") : [];
	const slugUrl = slug;
	return (
		<div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
			<Link
				to="/repos/$"
				params={{ _splat: slug }}
				search={{ tab: undefined, rev }}
				className="hover:text-foreground"
			>
				{slug.split("/").pop()}
			</Link>
			<span className="px-0.5">/</span>
			<span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
				{rev}
			</span>
			{parts.map((p, i) => {
				const sub = parts.slice(0, i + 1).join("/");
				const last = i === parts.length - 1;
				return (
					<span key={sub} className="flex items-center gap-1">
						<span className="px-0.5">/</span>
						{last ? (
							<span className="text-foreground">{p}</span>
						) : (
							<Link
								to="/repos/$"
								params={{ _splat: slug }}
								search={{ tab: undefined, rev, path: sub }}
								className="hover:text-foreground"
							>
								{p}
							</Link>
						)}
					</span>
				);
			})}
		</div>
	);
}

function CommitsTab({
	repo,
	rev,
	sha,
	file,
}: {
	repo: Repo;
	rev?: string;
	sha?: string;
	file?: string;
}) {
	const PAGE_SIZE = 20;
	const [page, setPage] = useState(0);
	const [search, setSearch] = useState("");
	const allQ = useQuery({
		queryKey: ["commits", repo.slug, rev ?? repo.default_branch, "all"],
		queryFn: () => api.commits(repo.slug, rev ?? repo.default_branch, 200),
		staleTime: 60_000,
	});
	const commits = allQ.data ?? [];
	const filtered = useMemo(() => {
		const term = search.trim();
		if (!term) return commits;
		const q = term.toLowerCase();
		return commits.filter(
			(c) =>
				c.subject.toLowerCase().includes(q) ||
				c.author.toLowerCase().includes(q) ||
				c.sha.startsWith(term),
		);
	}, [commits, search]);
	const pageCommits = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
	const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

	if (sha) return <CommitPage slug={repo.slug} sha={sha} scrollToFile={file} />;
	return (
		<div className="flex flex-col gap-3">
			<div className="relative">
				<SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={search}
					onChange={(e) => { setSearch(e.target.value); setPage(0); }}
					placeholder="Search commits by message, author, or SHA…"
					className="pl-9 h-9 text-sm"
				/>
			</div>
			<div className="overflow-hidden rounded-xl border bg-surface-1">
				{allQ.isLoading ? (
					<div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
				) : (
					<div className="divide-y divide-border">
						{pageCommits.map((c) => (
							<Link
								key={c.sha}
								to="/repos/$"
								params={{ _splat: repo.slug }}
								search={{ tab: "commits", sha: c.sha }}
								className="flex h-11 items-center gap-2 px-4 text-sm transition-colors hover:bg-primary/10"
							>
								<CommitAvatar size={18} />
								<span className="optical-center font-medium text-foreground">
									{c.author}
								</span>
								<span className="optical-center text-xs text-muted-foreground">
									committed:
								</span>
								<span className="optical-center truncate-soft min-w-0 flex-1 text-foreground">
									{c.subject}
								</span>
								{c.parents.length > 1 && (
									<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
										<GitMergeIcon size={11} strokeWidth={2} /> merge
									</span>
								)}
								<code className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
									{c.sha.slice(0, 7)}
								</code>
								<span
									className="optical-center shrink-0 text-xs text-muted-foreground"
									title={new Date(c.date).toLocaleString()}
								>
									{formatRelativeTime(c.date)}
								</span>
							</Link>
						))}
						{pageCommits.length === 0 && (
							<div className="p-10 text-center text-sm text-muted-foreground">
								No commits yet.
							</div>
						)}
					</div>
				)}
			</div>
			{totalPages > 1 && (
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span>
						Page {page + 1} of {totalPages}
					</span>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							disabled={page === 0}
							onClick={() => setPage((p) => p - 1)}
						>
							Previous
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={page >= totalPages - 1}
							onClick={() => setPage((p) => p + 1)}
						>
							Next
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

function BranchesTab({ repo }: { repo: Repo }) {
	const PAGE_SIZE = 20;
	const qc = useQueryClient();
	const q = useQuery({
		queryKey: ["branches", repo.slug],
		queryFn: () => api.branches(repo.slug),
	});
	const [createOpen, setCreateOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
	const [page, setPage] = useState(0);
	const [search, setSearch] = useState("");

	const allBranches = q.data?.branches ?? [];
	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return allBranches;
		return allBranches.filter((b) => b.name.toLowerCase().includes(term));
	}, [allBranches, search]);
	const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
	const branches = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-2">
				<h2 className="text-lg font-semibold tracking-tight">Branches</h2>
				<button
					type="button"
					onClick={() => setCreateOpen(true)}
					className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
					title="New branch"
					aria-label="New branch"
				>
					<PlusIcon size={14} strokeWidth={2} />
				</button>
			</div>
			<div className="relative">
				<SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
				<Input
					value={search}
					onChange={(e) => { setSearch(e.target.value); setPage(0); }}
					placeholder="Search branches…"
					className="pl-9 h-9 text-sm"
				/>
			</div>
			<div className="overflow-hidden rounded-xl border bg-surface-1">
				{q.isLoading ? (
					<div className="p-10 text-center text-sm text-muted-foreground">
						Loading…
					</div>
				) : (
					<div className="divide-y divide-border">
						{branches.map((b) => {
							const isDefault = b.name === repo.default_branch;
							return (
								<div
									key={b.full}
									className="flex h-11 items-center gap-2 px-4 text-sm transition-colors hover:bg-primary/10"
								>
									<Link
										to="/repos/$"
										params={{ _splat: repo.slug }}
										search={{ tab: undefined, rev: b.name }}
										className="flex min-w-0 flex-1 items-center gap-2"
									>
										<GitBranchIcon
											size={14}
											strokeWidth={2}
											className="shrink-0 text-muted-foreground"
										/>
										<span className="optical-center truncate-soft min-w-0 font-medium">
											{b.name}
										</span>
										{isDefault && (
											<span className="optical-center shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
												default
											</span>
										)}
										{b.name === q.data?.head && !isDefault && (
											<span className="optical-center shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
												HEAD
											</span>
										)}
									</Link>
									<code className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
										{b.target.slice(0, 7)}
									</code>
									<button
										type="button"
										disabled={isDefault || b.name === q.data?.head}
										onClick={() => setDeleteTarget(b.name)}
										className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
										title={
											isDefault
												? "Default branch"
												: b.name === q.data?.head
													? "Current HEAD"
													: "Delete branch"
										}
									>
										<Trash2Icon size={13} strokeWidth={2} />
									</button>
								</div>
							);
						})}
						{branches.length === 0 && (
							<div className="p-10 text-center text-sm text-muted-foreground">
								No branches yet.
							</div>
						)}
					</div>
				)}
			</div>
			{totalPages > 1 && (
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span>
						Page {page + 1} of {totalPages}
					</span>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							disabled={page === 0}
							onClick={() => setPage((p) => p - 1)}
						>
							Previous
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={page >= totalPages - 1}
							onClick={() => setPage((p) => p + 1)}
						>
							Next
						</Button>
					</div>
				</div>
			)}
			<NewBranchDialog
				repo={repo}
				branches={branches}
				open={createOpen}
				onOpenChange={setCreateOpen}
				onCreated={() =>
					qc.invalidateQueries({ queryKey: ["branches", repo.slug] })
				}
			/>
			<AlertDialog
				open={deleteTarget != null}
				onOpenChange={(v) => !v && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {deleteTarget}?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes the branch ref. Commits remain reachable
							only if other refs point at them.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="btn-grad-danger text-white shadow-xs"
							onClick={async () => {
								if (!deleteTarget) return;
								try {
									await api.deleteBranch(repo.slug, deleteTarget);
									toast.success(`Deleted ${deleteTarget}`);
									qc.invalidateQueries({
										queryKey: ["branches", repo.slug],
									});
								} catch (e) {
									toast.error((e as Error).message);
								} finally {
									setDeleteTarget(null);
								}
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function NewBranchDialog({
	repo,
	branches,
	open,
	onOpenChange,
	onCreated,
}: {
	repo: Repo;
	branches: { name: string; full: string }[];
	open: boolean;
	onOpenChange: (v: boolean) => void;
	onCreated: () => void;
}) {
	const [name, setName] = useState("");
	const [source, setSource] = useState(repo.default_branch || "");
	const create = useMutation({
		mutationFn: () => api.createBranch(repo.slug, { name: name.trim(), source }),
		onSuccess: () => {
			toast.success(`Created ${name.trim()}`);
			onCreated();
			onOpenChange(false);
			setName("");
		},
		onError: (e: Error) => toast.error(e.message),
	});
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-0 sm:max-w-md">
				<DialogHeader className="gap-1.5 px-5 pt-5 pb-4">
					<DialogTitle className="text-[0.9375rem]">
						Create a branch
					</DialogTitle>
					<DialogDescription className="text-[0.8125rem]">
						New branch will point at the selected source ref.
					</DialogDescription>
				</DialogHeader>
				<form
					id="new-branch-form"
					className="flex flex-col gap-4 px-5 pb-5"
					onSubmit={(e) => {
						e.preventDefault();
						if (!name.trim()) return;
						create.mutate();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs font-medium">New branch name</Label>
						<Input
							required
							autoFocus
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="feature/x"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs font-medium">Source</Label>
						<Select value={source} onValueChange={setSource}>
							<SelectTrigger className="h-9 text-sm">
								<SelectValue placeholder="Select branch" />
							</SelectTrigger>
							<SelectContent>
								{branches.map((b) => (
									<SelectItem key={b.full} value={b.name}>
										{b.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</form>
				<DialogFooter className="border-t border-border/70 px-5 py-3.5">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						size="sm"
						form="new-branch-form"
						disabled={create.isPending || !name.trim()}
						iconLeft={<PlusIcon size={14} strokeWidth={2} />}
					>
						{create.isPending ? "Creating…" : "Create new branch"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SettingsTab({ repo }: { repo: Repo }) {
	const qc = useQueryClient();
	const nav = useNavigate();
	const [description, setDescription] = useState(repo.description);
	const [defaultBranch, setDefaultBranch] = useState(repo.default_branch);
	const [namespace, setNamespace] = useState(repo.namespace);
	const [name, setName] = useState(repo.name);
	const [confirmDel, setConfirmDel] = useState(false);
	const [confirmText, setConfirmText] = useState("");

	const save = useMutation({
		mutationFn: () => {
			const body: Record<string, unknown> = {
				description,
				default_branch: defaultBranch,
			};
			if (namespace !== repo.namespace) body.namespace = namespace;
			if (name !== repo.name) body.name = name;
			return api.patchRepo(repo.slug, body);
		},
		onSuccess: (r) => {
			toast.success("Saved");
			qc.invalidateQueries({ queryKey: ["repo"] });
			qc.invalidateQueries({ queryKey: ["repos"] });
			if (r.slug !== repo.slug) {
				nav({
					to: "/repos/$",
					params: { _splat: r.slug },
					search: { tab: "settings" },
				});
			}
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const uploadImg = useMutation({
		mutationFn: (file: File) => api.uploadRepoImage(repo.slug, file),
		onSuccess: () => {
			toast.success("Image updated");
			qc.invalidateQueries({ queryKey: ["repo"] });
			qc.invalidateQueries({ queryKey: ["repos"] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const removeImg = useMutation({
		mutationFn: () => api.deleteRepoImage(repo.slug),
		onSuccess: () => {
			toast.success("Image removed");
			qc.invalidateQueries({ queryKey: ["repo"] });
			qc.invalidateQueries({ queryKey: ["repos"] });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const del = useMutation({
		mutationFn: () => api.deleteRepo(repo.slug),
		onSuccess: () => {
			toast.success("Deleted");
			qc.invalidateQueries({ queryKey: ["repos"] });
			nav({ to: "/" });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const branchesQ = useQuery({
		queryKey: ["branches", repo.slug],
		queryFn: () => api.branches(repo.slug),
	});
	const branchOptions = branchesQ.data?.branches ?? [];

	return (
		<div className="flex flex-col gap-4">
			<section className="flex flex-col gap-5 rounded-xl border border-border/70 p-6">
				<div className="flex items-start justify-between gap-4">
					<SectionHeader title="General" description="Repository identity and metadata." />
					<Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
						{save.isPending ? "Saving…" : "Save changes"}
					</Button>
				</div>
				<div className="grid grid-cols-3 gap-3">
					<FormField label="Namespace">
						<Input
							value={namespace}
							onChange={(e) => setNamespace(e.target.value)}
							className="h-8 text-sm"
						/>
					</FormField>
					<FormField label="Name">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="h-8 text-sm"
						/>
					</FormField>
					<FormField label="Default branch">
						<Select
							value={defaultBranch}
							onValueChange={setDefaultBranch}
							disabled={branchOptions.length === 0}
						>
							<SelectTrigger className="h-8 text-sm">
								<SelectValue
									placeholder={
										branchesQ.isLoading
											? "Loading…"
											: "No branches yet"
									}
								/>
							</SelectTrigger>
							<SelectContent>
								{branchOptions.map((b) => (
									<SelectItem key={b.full} value={b.name}>
										{b.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FormField>
				</div>
				<FormField label="Description">
					<Textarea
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						className="text-sm"
					/>
				</FormField>
			</section>

			<section className="flex flex-col gap-4 rounded-xl border border-border/70 p-6">
				<SectionHeader title="Image" description="Square image used as repository avatar." />
				<div className="flex items-center gap-4">
					{repo.image_path ? (
						<img
							src={api.repoImageUrl(repo.slug)}
							alt=""
							className="size-16 shrink-0 rounded-md border border-border object-cover"
						/>
					) : (
						<div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-surface-1 text-muted-foreground">
							<FolderIcon size={20} strokeWidth={1.8} />
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
							{repo.image_path && (
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
					<SectionHeader
						title="Danger zone"
						description="Permanently delete this repository and all of its Git data."
					/>
					<AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
						<AlertDialogTrigger asChild>
							<Button variant="destructive" size="sm">
								Delete repository
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent className="gap-0 p-0 sm:max-w-lg">
							<AlertDialogHeader className="gap-1.5 px-5 pt-5 pb-4">
								<AlertDialogTitle className="text-[0.9375rem]">
									Delete {repo.name}?
								</AlertDialogTitle>
								<AlertDialogDescription className="text-[0.8125rem]">
									This permanently deletes the repository and all of its Git data. Type{" "}
									<code className="font-mono text-foreground">{repo.name}</code> to confirm.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<div className="px-5 pb-5">
								<Input
									value={confirmText}
									onChange={(e) => setConfirmText(e.target.value)}
									className="h-9"
									placeholder={repo.name}
								/>
							</div>
							<AlertDialogFooter className="border-t border-border/70 px-5 py-3.5">
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									disabled={confirmText !== repo.name || del.isPending}
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

function SectionHeader({
	title,
	description,
}: {
	title: React.ReactNode;
	description?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<h3 className="text-sm font-semibold">{title}</h3>
			{description && <p className="text-xs text-muted-foreground">{description}</p>}
		</div>
	);
}

function FormField({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="flex items-center justify-between text-xs font-medium">
				<span>{label}</span>
				{hint && <span className="text-[10px] font-normal text-muted-foreground">{hint}</span>}
			</Label>
			{children}
		</div>
	);
}

function IssuesTabWrapper({ repo, search }: { repo: Repo; search: RepoSearch }) {
	const nav = useNavigate();
	if (search.labels) {
		return (
			<LabelsPage
				repo={repo}
				onBack={() =>
					nav({
						to: "/repos/$",
						params: { _splat: repo.slug },
						search: { tab: "issues" },
					})
				}
			/>
		);
	}
	if (search.issue) {
		return (
			<IssueDetail
				repo={repo}
				number={search.issue}
				onBack={() =>
					nav({
						to: "/repos/$",
						params: { _splat: repo.slug },
						search: { tab: "issues" },
					})
				}
			/>
		);
	}
	return (
		<IssuesTab
			repo={repo}
			onSelectIssue={(num) =>
				nav({
					to: "/repos/$",
					params: { _splat: repo.slug },
					search: { tab: "issues", issue: num },
				})
			}
			onOpenLabels={() =>
				nav({
					to: "/repos/$",
					params: { _splat: repo.slug },
					search: { tab: "issues", labels: true },
				})
			}
		/>
	);
}

function PullsTabWrapper({ repo, search }: { repo: Repo; search: RepoSearch }) {
	const nav = useNavigate();
	if (search.pr) {
		return (
			<PullDetail
				repo={repo}
				number={search.pr}
				onBack={() =>
					nav({
						to: "/repos/$",
						params: { _splat: repo.slug },
						search: { tab: "pulls" },
					})
				}
			/>
		);
	}
	return (
		<PullsTab
			repo={repo}
			onSelectPR={(num) =>
				nav({
					to: "/repos/$",
					params: { _splat: repo.slug },
					search: { tab: "pulls", pr: num },
				})
			}
		/>
	);
}

function parentPath(p: string) {
	const i = p.lastIndexOf("/");
	return i < 0 ? "" : p.slice(0, i);
}

