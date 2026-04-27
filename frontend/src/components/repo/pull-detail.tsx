import { PatchDiff } from "@pierre/diffs/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	AlertTriangleIcon,
	ArrowLeftIcon,
	CheckCircleIcon,
	FileIcon,
	GitBranchIcon,
	GitCommitHorizontalIcon,
	GitMergeIcon,
	MessageSquareIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CommitAvatar } from "@/components/repo/commit-avatar";
import { LabelBadge } from "@/components/repo/issues-tab";
import { PRStateIcon } from "@/components/repo/pulls-tab";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Markdown } from "@/components/ui/markdown";
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
import { Textarea } from "@/components/ui/textarea";
import { type Commit, type Repo, api } from "@/lib/api";
import { fileIconUrl } from "@/lib/file-icons";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { type FilePatch, splitPatch } from "@/lib/split-patch";
import { cn } from "@/lib/utils";

type PRTab = "conversation" | "commits" | "files";

const DIFF_THEME = {
	light: "github-light" as const,
	dark: "github-dark" as const,
};

export function PullDetail({
	repo,
	number,
	onBack,
}: {
	repo: Repo;
	number: number;
	onBack: () => void;
}) {
	const qc = useQueryClient();
	const [tab, setTab] = useState<PRTab>("conversation");

	const detailQ = useQuery({
		queryKey: ["pr", repo.slug, number],
		queryFn: () => api.getPR(repo.slug, number),
	});

	const labelsQ = useQuery({
		queryKey: ["labels", repo.slug],
		queryFn: () => api.listLabels(repo.slug),
	});

	const pr = detailQ.data?.pull_request;
	const comments = detailQ.data?.comments ?? [];
	const allLabels = labelsQ.data ?? [];
	const canMerge = detailQ.data?.can_merge ?? false;
	const diff = detailQ.data?.diff ?? "";
	const commits = detailQ.data?.commits ?? [];
	const ahead = detailQ.data?.ahead ?? 0;
	const additions = detailQ.data?.additions ?? 0;
	const deletions = detailQ.data?.deletions ?? 0;
	const changedFiles = detailQ.data?.changed_files ?? 0;

	const files = useMemo(() => splitPatch(diff), [diff]);

	const [commentBody, setCommentBody] = useState("");
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [editingBody, setEditingBody] = useState(false);
	const [bodyDraft, setBodyDraft] = useState("");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [mergeOpen, setMergeOpen] = useState(false);

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ["pr", repo.slug, number] });
		qc.invalidateQueries({ queryKey: ["pulls", repo.slug] });
	};

	const merge = useMutation({
		mutationFn: (params: { message: string; strategy: string }) =>
			api.mergePR(repo.slug, number, params),
		onSuccess: () => { toast.success("Pull request merged"); setMergeOpen(false); invalidate(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const updateBranch = useMutation({
		mutationFn: () => api.updatePRBranch(repo.slug, number),
		onSuccess: () => { toast.success("Branch updated"); invalidate(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const closePR = useMutation({
		mutationFn: () => api.patchPR(repo.slug, number, { state: "closed" }),
		onSuccess: () => { toast.success("Pull request closed"); invalidate(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const reopenPR = useMutation({
		mutationFn: () => api.patchPR(repo.slug, number, { state: "open" }),
		onSuccess: () => { toast.success("Pull request reopened"); invalidate(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const saveTitle = useMutation({
		mutationFn: () => api.patchPR(repo.slug, number, { title: titleDraft.trim() }),
		onSuccess: () => { setEditingTitle(false); invalidate(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const saveBody = useMutation({
		mutationFn: () => api.patchPR(repo.slug, number, { body: bodyDraft }),
		onSuccess: () => { setEditingBody(false); invalidate(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const addComment = useMutation({
		mutationFn: () => api.createPRComment(repo.slug, number, { body: commentBody }),
		onSuccess: () => { setCommentBody(""); invalidate(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const setLabels = useMutation({
		mutationFn: (labelIds: number[]) => api.patchPR(repo.slug, number, { label_ids: labelIds }),
		onSuccess: () => invalidate(),
		onError: (e: Error) => toast.error(e.message),
	});

	const deletePR = useMutation({
		mutationFn: () => api.deletePR(repo.slug, number),
		onSuccess: () => {
			toast.success("Pull request deleted");
			qc.invalidateQueries({ queryKey: ["pulls", repo.slug] });
			onBack();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (detailQ.isLoading) {
		return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
	}
	if (!pr) {
		return <div className="p-10 text-center text-sm text-muted-foreground">Pull request not found.</div>;
	}

	const isOpen = pr.state === "open";
	const isMerged = pr.state === "merged";

	return (
		<div className="flex flex-col gap-4">
			{/* Header */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<button type="button" onClick={onBack} className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground">
						<ArrowLeftIcon size={14} strokeWidth={2} />
					</button>
					{editingTitle ? (
						<form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (titleDraft.trim()) saveTitle.mutate(); }}>
							<Input autoFocus value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} className="h-8 flex-1 text-lg font-semibold" />
							<Button size="sm" type="submit" disabled={!titleDraft.trim()}>Save</Button>
							<Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>Cancel</Button>
						</form>
					) : (
						<div className="flex flex-1 items-center gap-2">
							<h2 className="text-lg font-semibold tracking-tight">
								{pr.title}
								<span className="ml-1.5 font-normal text-muted-foreground">#{pr.number}</span>
							</h2>
							<button type="button" onClick={() => { setTitleDraft(pr.title); setEditingTitle(true); }} className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground">
								<PencilIcon size={12} strokeWidth={2} />
							</button>
						</div>
					)}
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<span className={cn(
						"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
						isOpen ? "bg-green-500/15 text-green-600 dark:text-green-400"
							: isMerged ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
								: "bg-red-500/15 text-red-600 dark:text-red-400",
					)}>
						<PRStateIcon pr={pr} />
						{isMerged ? "Merged" : isOpen ? "Open" : "Closed"}
					</span>
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<GitBranchIcon size={12} strokeWidth={2} />
						<code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">{pr.head_branch}</code>
						<span>→</span>
						<code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">{pr.base_branch}</code>
					</span>
				</div>
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-0.5 border-b border-border">
				{([
					{ id: "conversation" as PRTab, label: "Conversation", icon: MessageSquareIcon, count: comments.length },
					{ id: "commits" as PRTab, label: "Commits", icon: GitCommitHorizontalIcon, count: ahead },
					{ id: "files" as PRTab, label: "Files changed", icon: FileIcon, count: changedFiles },
				]).map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => setTab(t.id)}
						className={cn(
							"inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors",
							tab === t.id
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						<t.icon size={14} strokeWidth={2} />
						{t.label}
						{t.count > 0 && (
							<span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
								{t.count}
							</span>
						)}
					</button>
				))}
				{isOpen && (
					<div className="ml-auto">
						<span
							className={cn(
								"inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium",
								canMerge
									? "border-green-500/40 bg-green-500/5 text-green-600 dark:text-green-400"
									: "border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400",
							)}
						>
							{canMerge ? (
								<CheckCircleIcon size={13} strokeWidth={2} />
							) : (
								<AlertTriangleIcon size={13} strokeWidth={2} />
							)}
							{canMerge ? "Merge possible" : "Merge conflict"}
						</span>
					</div>
				)}
			</div>

			{/* Tab content */}
			{tab === "conversation" && (
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
					<div className="flex flex-col gap-4">
						{/* Body */}
						<div className="rounded-xl border bg-surface-1">
							<div className="flex items-center justify-between border-b border-border px-4 py-2">
								<span className="text-xs font-medium text-muted-foreground">Description</span>
								<button type="button" onClick={() => { setBodyDraft(pr.body); setEditingBody(!editingBody); }} className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
									<PencilIcon size={12} strokeWidth={2} />
								</button>
							</div>
							{editingBody ? (
								<div className="flex flex-col gap-2 p-4">
									<Textarea autoFocus value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} className="min-h-[120px] text-sm" />
									<div className="flex items-center gap-2">
										<Button size="sm" onClick={() => saveBody.mutate()} disabled={saveBody.isPending}>Save</Button>
										<Button size="sm" variant="ghost" onClick={() => setEditingBody(false)}>Cancel</Button>
									</div>
								</div>
							) : pr.body ? (
								<div className="p-4"><Markdown>{pr.body}</Markdown></div>
							) : (
								<div className="p-4 text-sm text-muted-foreground italic">No description provided.</div>
							)}
						</div>

						{isMerged && (
							<div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
								<div className="flex items-center gap-2">
									<GitMergeIcon size={16} strokeWidth={2} className="text-purple-500" />
									<span className="text-sm font-medium">Merged into {pr.base_branch}</span>
									<span className="text-xs text-muted-foreground">{formatRelativeTime(pr.merged_at ?? pr.updated_at)}</span>
								</div>
							</div>
						)}

						{isOpen && !canMerge && (
							<div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
								<div className="flex items-center gap-2">
									<AlertTriangleIcon size={16} strokeWidth={2} className="text-red-500" />
									<span className="text-sm font-medium">This branch has conflicts that must be resolved</span>
								</div>
							</div>
						)}

						{/* Comments */}
						{comments.length > 0 && (
							<div className="flex flex-col gap-3">
								{comments.map((c) => (
									<CommentCard key={c.id} comment={c} slug={repo.slug} prNumber={number} onUpdated={invalidate} />
								))}
							</div>
						)}

						{/* New comment */}
						<div className="rounded-xl border bg-surface-1">
							<div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">Add a comment</div>
							<form className="flex flex-col gap-3 p-4" onSubmit={(e) => { e.preventDefault(); if (commentBody.trim()) addComment.mutate(); }}>
								<Textarea value={commentBody} onChange={(e) => setCommentBody(e.target.value)} placeholder="Write a comment… (Markdown supported)" className="min-h-[80px] text-sm" />
								<div className="flex items-center gap-2">
									<Button size="sm" type="submit" disabled={addComment.isPending || !commentBody.trim()}>
										{addComment.isPending ? "Posting…" : "Comment"}
									</Button>
								</div>
							</form>
						</div>
					</div>

					{/* Sidebar */}
					<div className="flex flex-col gap-4">
						{/* Labels */}
						<div className="rounded-xl border bg-surface-1 p-4">
							<span className="mb-2 block text-xs font-semibold text-muted-foreground">Labels</span>
							<div className="flex flex-wrap items-center gap-1.5">
								{pr.labels.map((l) => (
									<LabelBadge key={l.id} label={l} />
								))}
								<Popover>
									<PopoverTrigger asChild>
										<button type="button" className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
											<PlusIcon size={12} strokeWidth={2} />
										</button>
									</PopoverTrigger>
									<PopoverContent align="start" className="w-56 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
										{allLabels.length === 0 ? (
											<div className="px-3 py-4 text-center text-xs text-muted-foreground">No labels created yet.</div>
										) : (
											<div className="max-h-64 overflow-y-auto py-1">
												{allLabels.map((l) => {
													const active = pr.labels.some((pl) => pl.id === l.id);
													const hex = l.color.replace(/^#/, "");
													return (
														<button key={l.id} type="button" onClick={() => {
															const current = pr.labels.map((pl) => pl.id);
															const next = active ? current.filter((id) => id !== l.id) : [...current, l.id];
															setLabels.mutate(next);
														}} className="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-surface-2">
															<span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: `#${hex}` }} />
															<span className={cn("flex-1 truncate text-left", active ? "font-medium text-foreground" : "text-muted-foreground")}>{l.name}</span>
															{active && <XIcon size={10} strokeWidth={2} className="shrink-0 text-muted-foreground" />}
														</button>
													);
												})}
											</div>
										)}
									</PopoverContent>
								</Popover>
							</div>
						</div>

						{/* Actions */}
						<div className="rounded-xl border bg-surface-1 p-4">
							<span className="mb-2 block text-xs font-semibold text-muted-foreground">Actions</span>
							<div className="flex flex-col gap-1.5">
								{isOpen && (
									<Button
										size="sm"
										variant="secondary"
										className="w-full justify-start"
										disabled={!canMerge}
										onClick={() => setMergeOpen(true)}
									>
										{canMerge ? "Merge pull request" : "Cannot merge (conflicts)"}
									</Button>
								)}
								{isOpen && (
									<Button size="sm" variant="secondary" className="w-full justify-start" onClick={() => updateBranch.mutate()} disabled={updateBranch.isPending}>
										{updateBranch.isPending ? "Updating…" : "Update branch"}
									</Button>
								)}
								{isOpen && (
									<Button size="sm" variant="secondary" className="w-full justify-start" onClick={() => closePR.mutate()} disabled={closePR.isPending}>
										Close pull request
									</Button>
								)}
								{pr.state === "closed" && (
									<Button size="sm" variant="secondary" className="w-full justify-start" onClick={() => reopenPR.mutate()} disabled={reopenPR.isPending}>
										Reopen pull request
									</Button>
								)}
								<Button size="sm" variant="destructive" className="btn-grad-danger w-full justify-start text-white shadow-xs" onClick={() => setConfirmDelete(true)}>
									Delete pull request
								</Button>
							</div>
						</div>
					</div>
				</div>
			)}

			{tab === "commits" && (
				<div className="flex flex-col gap-3">
					{commits.length === 0 ? (
						<div className="p-10 text-center text-sm text-muted-foreground">No commits.</div>
					) : (
						<div className="overflow-hidden rounded-xl border bg-surface-1">
							<div className="divide-y divide-border">
								{commits.map((c) => (
									<Link
										key={c.sha}
										to="/repos/$"
										params={{ _splat: repo.slug }}
										search={{ tab: "commits", sha: c.sha }}
										className="flex h-11 items-center gap-2 px-4 text-sm transition-colors hover:bg-primary/10"
									>
										<CommitAvatar size={18} />
										<span className="optical-center font-medium text-foreground">{c.author}</span>
										<span className="optical-center text-xs text-muted-foreground">committed:</span>
										<span className="optical-center truncate-soft min-w-0 flex-1 text-foreground">{c.subject}</span>
										<code className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">{c.sha.slice(0, 7)}</code>
										<span className="optical-center shrink-0 text-xs text-muted-foreground" title={new Date(c.date).toLocaleString()}>
											{formatRelativeTime(c.date)}
										</span>
									</Link>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{tab === "files" && (
				<div className="flex flex-col gap-4">
					{files.length === 0 ? (
						<div className="p-10 text-center text-sm text-muted-foreground">No file changes.</div>
					) : (
						<>
							<div className="flex items-center gap-3 text-xs text-muted-foreground">
								<span className="flex items-center gap-1">
									<FileIcon size={13} strokeWidth={2} />
									<span className="font-mono tabular-nums font-medium text-foreground">{files.length}</span>
									{files.length === 1 ? "file" : "files"}
								</span>
								<span className="font-mono tabular-nums font-medium text-green-500">+{additions}</span>
								<span className="font-mono tabular-nums font-medium text-red-500">−{deletions}</span>
							</div>
							{files.map((f) => (
								<FileDiffBlock key={`${f.filename}-${f.patch.length}`} file={f} />
							))}
						</>
					)}
				</div>
			)}

			{pr && (
			<MergeDialog
				open={mergeOpen}
				onOpenChange={setMergeOpen}
				pr={pr}
				isPending={merge.isPending}
				onMerge={(message, strategy) => merge.mutate({ message, strategy })}
			/>
		)}

		<AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete PR #{number}?</AlertDialogTitle>
						<AlertDialogDescription>This permanently removes the pull request and all its comments.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction className="btn-grad-danger text-white shadow-xs" onClick={() => deletePR.mutate()}>Delete</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function useInViewport<T extends HTMLElement>(rootMargin = "1500px 0px") {
	const ref = useRef<T | null>(null);
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		if (seen) return;
		const el = ref.current;
		if (!el) return;
		const obs = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					setSeen(true);
					obs.disconnect();
				}
			},
			{ rootMargin },
		);
		obs.observe(el);
		return () => obs.disconnect();
	}, [seen, rootMargin]);
	return [ref, seen] as const;
}

function FileDiffBlock({ file }: { file: FilePatch }) {
	const { resolvedTheme } = useTheme();
	const themeType = resolvedTheme === "dark" ? "dark" : "light";
	const [ref, seen] = useInViewport<HTMLDivElement>();
	const estimatedLines = useMemo(() => file.patch.split("\n").length, [file.patch]);
	const placeholderHeight = Math.min(estimatedLines * 20, 600);
	return (
		<div ref={ref} className="diff-block overflow-hidden rounded-lg border">
			<div className="flex items-center gap-2 border-b bg-surface-0 px-4 py-2.5 text-sm">
				<img src={fileIconUrl(file.filename, false)} alt="" aria-hidden className="size-4 shrink-0 select-none" draggable={false} />
				{file.oldFilename && (
					<>
						<span className="optical-center text-muted-foreground line-through">{file.oldFilename}</span>
						<span className="optical-center text-muted-foreground" aria-hidden>→</span>
					</>
				)}
				<span className="optical-center font-medium text-foreground">{file.filename}</span>
				{file.status !== "modified" && (
					<span className={cn(
						"optical-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
						file.status === "added" && "bg-green-500/15 text-green-600 dark:text-green-400",
						file.status === "deleted" && "bg-red-500/15 text-red-600 dark:text-red-400",
						file.status === "renamed" && "bg-blue-500/15 text-blue-600 dark:text-blue-400",
					)}>
						{file.status}
					</span>
				)}
				<div className="ml-auto flex items-center gap-2 text-xs">
					<span className="optical-center font-mono tabular-nums font-medium text-green-500">+{file.additions}</span>
					<span className="optical-center font-mono tabular-nums font-medium text-red-500">−{file.deletions}</span>
				</div>
			</div>
			{seen ? (
				<PatchDiff
					patch={file.patch}
					disableWorkerPool
					style={{
						"--diffs-dark-bg": "var(--card)",
						"--diffs-bg-buffer-override": "var(--card)",
						"--diffs-bg-context-override": "var(--card)",
						"--diffs-bg-separator-override": "var(--surface-0)",
					} as React.CSSProperties}
					options={{
						theme: DIFF_THEME,
						themeType,
						disableFileHeader: true,
					}}
				/>
			) : (
				<div style={{ height: placeholderHeight }} className="bg-surface-1" />
			)}
		</div>
	);
}

function MergeDialog({
	open,
	onOpenChange,
	pr,
	isPending,
	onMerge,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	pr: { number: number; title: string; head_branch: string };
	isPending: boolean;
	onMerge: (message: string, strategy: string) => void;
}) {
	const [strategy, setStrategy] = useState("merge");
	const defaultMsg = `Merge pull request #${pr.number} from ${pr.head_branch}\n\n${pr.title}`;
	const [message, setMessage] = useState(defaultMsg);

	useEffect(() => {
		if (open) setMessage(defaultMsg);
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-0 sm:max-w-lg">
				<DialogHeader className="gap-1.5 px-5 pt-5 pb-4">
					<DialogTitle className="text-[0.9375rem]">Merge pull request</DialogTitle>
					<DialogDescription className="text-[0.8125rem]">
						Choose merge strategy and confirm the commit message.
					</DialogDescription>
				</DialogHeader>
				<form
					id="merge-form"
					className="flex flex-col gap-4 px-5 pb-5"
					onSubmit={(e) => {
						e.preventDefault();
						onMerge(message, strategy);
					}}
				>
					<div className="flex flex-col gap-1.5">
						<FormLabel className="text-xs font-medium">Merge strategy</FormLabel>
						<Select value={strategy} onValueChange={setStrategy}>
							<SelectTrigger className="h-9 text-sm">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="merge">Create a merge commit</SelectItem>
								<SelectItem value="squash">Squash and merge</SelectItem>
								<SelectItem value="rebase">Rebase and merge</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{strategy !== "rebase" && (
						<div className="flex flex-col gap-1.5">
							<FormLabel className="text-xs font-medium">Commit message</FormLabel>
							<Textarea
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								className="min-h-[100px] font-mono text-xs"
							/>
						</div>
					)}
				</form>
				<DialogFooter className="border-t border-border/70 px-5 py-3.5">
					<Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button type="submit" size="sm" form="merge-form" disabled={isPending}>
						{isPending ? "Merging…" : "Confirm merge"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function CommentCard({
	comment,
	slug,
	prNumber,
	onUpdated,
}: {
	comment: { id: number; body: string; created_at: string; updated_at: string };
	slug: string;
	prNumber: number;
	onUpdated: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(comment.body);

	const update = useMutation({
		mutationFn: () => api.updatePRComment(slug, prNumber, comment.id, { body: draft }),
		onSuccess: () => { setEditing(false); onUpdated(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const del = useMutation({
		mutationFn: () => api.deletePRComment(slug, prNumber, comment.id),
		onSuccess: () => { toast.success("Comment deleted"); onUpdated(); },
		onError: (e: Error) => toast.error(e.message),
	});

	const wasEdited = comment.updated_at !== comment.created_at;

	return (
		<div className="rounded-xl border bg-surface-1">
			<div className="flex items-center justify-between border-b border-border px-4 py-2">
				<span className="text-xs text-muted-foreground">
					{formatRelativeTime(comment.created_at)}
					{wasEdited && " (edited)"}
				</span>
				<div className="flex items-center gap-1">
					<button type="button" onClick={() => { setDraft(comment.body); setEditing(!editing); }} className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
						<PencilIcon size={11} strokeWidth={2} />
					</button>
					<button type="button" onClick={() => del.mutate()} className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
						<Trash2Icon size={11} strokeWidth={2} />
					</button>
				</div>
			</div>
			{editing ? (
				<div className="flex flex-col gap-2 p-4">
					<Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[80px] text-sm" />
					<div className="flex items-center gap-2">
						<Button size="sm" onClick={() => update.mutate()} disabled={update.isPending || !draft.trim()}>Save</Button>
						<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
					</div>
				</div>
			) : (
				<div className="p-4"><Markdown>{comment.body}</Markdown></div>
			)}
		</div>
	);
}
