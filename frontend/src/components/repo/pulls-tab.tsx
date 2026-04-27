import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	GitMergeIcon,
	GitPullRequestClosedIcon,
	GitPullRequestDraftIcon,
	GitPullRequestIcon,
	MessageSquareIcon,
	PlusIcon,
	SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { LabelBadge } from "@/components/repo/issues-tab";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label as FormLabel } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type PullRequest, type Repo, api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";

export function PullsTab({
	repo,
	onSelectPR,
}: {
	repo: Repo;
	onSelectPR: (num: number) => void;
}) {
	const [stateFilter, setStateFilter] = useState<"open" | "merged" | "closed">("open");
	const [search, setSearch] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const qc = useQueryClient();

	const prsQ = useQuery({
		queryKey: ["pulls", repo.slug, stateFilter],
		queryFn: () => api.listPRs(repo.slug, stateFilter),
	});

	const prs = prsQ.data?.pull_requests ?? [];
	const openCount = prsQ.data?.open_count ?? 0;
	const mergedCount = prsQ.data?.merged_count ?? 0;
	const closedCount = prsQ.data?.closed_count ?? 0;

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return prs;
		return prs.filter(
			(p) =>
				p.title.toLowerCase().includes(q) ||
				`#${p.number}`.includes(q) ||
				p.head_branch.toLowerCase().includes(q) ||
				p.base_branch.toLowerCase().includes(q),
		);
	}, [prs, search]);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<div className="relative flex-1">
					<SearchIcon
						size={14}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search pull requests…"
						className="h-9 pl-9 text-sm"
					/>
				</div>
				<Button
					size="sm"
					onClick={() => setCreateOpen(true)}
					iconLeft={<PlusIcon size={14} strokeWidth={2} />}
				>
					New pull request
				</Button>
			</div>

			<div className="overflow-hidden rounded-xl border bg-surface-1">
				<div className="flex items-center gap-4 border-b border-border px-4 py-2">
					<button
						type="button"
						onClick={() => setStateFilter("open")}
						className={cn(
							"inline-flex items-center gap-1.5 text-xs font-medium transition-colors",
							stateFilter === "open"
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<GitPullRequestIcon size={14} strokeWidth={2} className="text-green-500" />
						<span className="tabular-nums font-semibold">{openCount}</span> Open
					</button>
					<button
						type="button"
						onClick={() => setStateFilter("merged")}
						className={cn(
							"inline-flex items-center gap-1.5 text-xs font-medium transition-colors",
							stateFilter === "merged"
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<GitMergeIcon size={14} strokeWidth={2} className="text-purple-500" />
						<span className="tabular-nums font-semibold">{mergedCount}</span> Merged
					</button>
					<button
						type="button"
						onClick={() => setStateFilter("closed")}
						className={cn(
							"inline-flex items-center gap-1.5 text-xs font-medium transition-colors",
							stateFilter === "closed"
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<GitPullRequestClosedIcon size={14} strokeWidth={2} className="text-red-500" />
						<span className="tabular-nums font-semibold">{closedCount}</span> Closed
					</button>
				</div>

				{prsQ.isLoading ? (
					<div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
				) : filtered.length === 0 ? (
					<div className="flex flex-col items-center gap-2 p-10 text-center">
						<GitPullRequestIcon size={24} strokeWidth={1.5} className="text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							{search ? "No matching pull requests." : `No ${stateFilter} pull requests.`}
						</p>
					</div>
				) : (
					<div className="divide-y divide-border">
						{filtered.map((pr) => (
							<PRRow key={pr.id} pr={pr} onClick={() => onSelectPR(pr.number)} />
						))}
					</div>
				)}
			</div>

			<NewPRDialog
				repo={repo}
				open={createOpen}
				onOpenChange={setCreateOpen}
				onCreated={(num) => {
					qc.invalidateQueries({ queryKey: ["pulls", repo.slug] });
					onSelectPR(num);
				}}
			/>
		</div>
	);
}

function PRRow({ pr, onClick }: { pr: PullRequest; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5"
		>
			<PRStateIcon pr={pr} className="mt-1 shrink-0" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-foreground leading-tight">
						{pr.title}
					</span>
					{pr.labels.map((l) => (
						<LabelBadge key={l.id} label={l} />
					))}
					<span className="text-xs text-muted-foreground">#{pr.number}</span>
					<div className="ml-auto flex shrink-0 items-center gap-3">
						{pr.comment_count > 0 && (
							<span className="flex items-center gap-1 text-xs text-muted-foreground">
								<MessageSquareIcon size={12} strokeWidth={2} />
								<span className="tabular-nums">{pr.comment_count}</span>
							</span>
						)}
						<span className="text-xs text-muted-foreground">
							{pr.state === "merged"
								? formatRelativeTime(pr.merged_at ?? pr.updated_at)
								: pr.state === "closed"
									? formatRelativeTime(pr.closed_at ?? pr.updated_at)
									: formatRelativeTime(pr.created_at)}
						</span>
					</div>
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span>{pr.head_branch} → {pr.base_branch}</span>
					{(pr.additions > 0 || pr.deletions > 0) && (
						<span className="flex items-center gap-1.5 font-mono tabular-nums">
							{pr.additions > 0 && <span className="font-medium text-green-500">+{pr.additions}</span>}
							{pr.deletions > 0 && <span className="font-medium text-red-500">-{pr.deletions}</span>}
						</span>
					)}
				</div>
			</div>
		</button>
	);
}

export function PRStateIcon({ pr, className }: { pr: PullRequest; className?: string }) {
	if (pr.is_draft) {
		return <GitPullRequestDraftIcon size={16} strokeWidth={2} className={cn("text-muted-foreground", className)} />;
	}
	if (pr.state === "merged") {
		return <GitMergeIcon size={16} strokeWidth={2} className={cn("text-purple-500", className)} />;
	}
	if (pr.state === "closed") {
		return <GitPullRequestClosedIcon size={16} strokeWidth={2} className={cn("text-red-500", className)} />;
	}
	return <GitPullRequestIcon size={16} strokeWidth={2} className={cn("text-green-500", className)} />;
}

function NewPRDialog({
	repo,
	open,
	onOpenChange,
	onCreated,
}: {
	repo: Repo;
	open: boolean;
	onOpenChange: (v: boolean) => void;
	onCreated: (number: number) => void;
}) {
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [headBranch, setHeadBranch] = useState("");
	const [baseBranch, setBaseBranch] = useState(repo.default_branch || "main");

	const branchesQ = useQuery({
		queryKey: ["branches", repo.slug],
		queryFn: () => api.branches(repo.slug),
		enabled: open,
	});

	const branches = branchesQ.data?.branches ?? [];

	const create = useMutation({
		mutationFn: () =>
			api.createPR(repo.slug, {
				title: title.trim(),
				body,
				head_branch: headBranch,
				base_branch: baseBranch,
			}),
		onSuccess: (pr) => {
			toast.success(`PR #${pr.number} created`);
			onCreated(pr.number);
			onOpenChange(false);
			setTitle("");
			setBody("");
			setHeadBranch("");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-0 sm:max-w-xl">
				<DialogHeader className="gap-1.5 px-5 pt-5 pb-4">
					<DialogTitle className="text-[0.9375rem]">New pull request</DialogTitle>
					<DialogDescription className="text-[0.8125rem]">
						Merge changes from one branch into another.
					</DialogDescription>
				</DialogHeader>
				<form
					id="new-pr-form"
					className="flex flex-col gap-4 px-5 pb-5"
					onSubmit={(e) => {
						e.preventDefault();
						if (!title.trim() || !headBranch || !baseBranch) return;
						create.mutate();
					}}
				>
					<div className="grid grid-cols-2 gap-3">
						<div className="flex flex-col gap-1.5">
							<FormLabel className="text-xs font-medium">Head branch</FormLabel>
							<Select value={headBranch} onValueChange={setHeadBranch}>
								<SelectTrigger className="h-9 text-sm">
									<SelectValue placeholder="Select branch" />
								</SelectTrigger>
								<SelectContent>
									{branches
										.filter((b) => b.name !== baseBranch)
										.map((b) => (
											<SelectItem key={b.full} value={b.name}>
												{b.name}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex flex-col gap-1.5">
							<FormLabel className="text-xs font-medium">Base branch</FormLabel>
							<Select value={baseBranch} onValueChange={setBaseBranch}>
								<SelectTrigger className="h-9 text-sm">
									<SelectValue placeholder="Select branch" />
								</SelectTrigger>
								<SelectContent>
									{branches
										.filter((b) => b.name !== headBranch)
										.map((b) => (
											<SelectItem key={b.full} value={b.name}>
												{b.name}
											</SelectItem>
										))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div className="flex flex-col gap-1.5">
						<FormLabel className="text-xs font-medium">Title</FormLabel>
						<Input
							required
							autoFocus
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Pull request title"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<FormLabel className="text-xs font-medium">Description</FormLabel>
						<Textarea
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="Describe the changes… (Markdown supported)"
							className="min-h-[100px] text-sm"
						/>
					</div>
				</form>
				<DialogFooter className="border-t border-border/70 px-5 py-3.5">
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						type="submit"
						size="sm"
						form="new-pr-form"
						disabled={create.isPending || !title.trim() || !headBranch || !baseBranch}
					>
						{create.isPending ? "Creating…" : "Create pull request"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
