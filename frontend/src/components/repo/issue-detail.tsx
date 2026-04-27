import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeftIcon,
	CircleCheckIcon,
	CircleDotIcon,
	MessageSquareIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LabelBadge } from "@/components/repo/issues-tab";
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
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { type Repo, api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";

export function IssueDetail({
	repo,
	number,
	onBack,
}: {
	repo: Repo;
	number: number;
	onBack: () => void;
}) {
	const qc = useQueryClient();
	const detailQ = useQuery({
		queryKey: ["issue", repo.slug, number],
		queryFn: () => api.getIssue(repo.slug, number),
	});

	const labelsQ = useQuery({
		queryKey: ["labels", repo.slug],
		queryFn: () => api.listLabels(repo.slug),
	});

	const issue = detailQ.data?.issue;
	const comments = detailQ.data?.comments ?? [];
	const allLabels = labelsQ.data ?? [];

	const [commentBody, setCommentBody] = useState("");
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [editingBody, setEditingBody] = useState(false);
	const [bodyDraft, setBodyDraft] = useState("");
	const [confirmDelete, setConfirmDelete] = useState(false);

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ["issue", repo.slug, number] });
		qc.invalidateQueries({ queryKey: ["issues", repo.slug] });
	};

	const toggleState = useMutation({
		mutationFn: () => {
			const newState = issue?.state === "open" ? "closed" : "open";
			return api.patchIssue(repo.slug, number, { state: newState });
		},
		onSuccess: (updated) => {
			toast.success(
				updated.state === "open" ? "Issue reopened" : "Issue closed",
			);
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const saveTitle = useMutation({
		mutationFn: () =>
			api.patchIssue(repo.slug, number, { title: titleDraft.trim() }),
		onSuccess: () => {
			setEditingTitle(false);
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const saveBody = useMutation({
		mutationFn: () =>
			api.patchIssue(repo.slug, number, { body: bodyDraft }),
		onSuccess: () => {
			setEditingBody(false);
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const addComment = useMutation({
		mutationFn: () =>
			api.createComment(repo.slug, number, { body: commentBody }),
		onSuccess: () => {
			setCommentBody("");
			invalidate();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const setLabels = useMutation({
		mutationFn: (labelIds: number[]) =>
			api.patchIssue(repo.slug, number, { label_ids: labelIds }),
		onSuccess: () => invalidate(),
		onError: (e: Error) => toast.error(e.message),
	});

	const deleteIssue = useMutation({
		mutationFn: () => api.deleteIssue(repo.slug, number),
		onSuccess: () => {
			toast.success("Issue deleted");
			qc.invalidateQueries({ queryKey: ["issues", repo.slug] });
			onBack();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	if (detailQ.isLoading) {
		return (
			<div className="p-10 text-center text-sm text-muted-foreground">
				Loading…
			</div>
		);
	}

	if (!issue) {
		return (
			<div className="p-10 text-center text-sm text-muted-foreground">
				Issue not found.
			</div>
		);
	}

	const isOpen = issue.state === "open";

	return (
		<div className="flex flex-col gap-4">
			{/* Header */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
					>
						<ArrowLeftIcon size={14} strokeWidth={2} />
					</button>
					{editingTitle ? (
						<form
							className="flex flex-1 items-center gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								if (titleDraft.trim()) saveTitle.mutate();
							}}
						>
							<Input
								autoFocus
								value={titleDraft}
								onChange={(e) => setTitleDraft(e.target.value)}
								className="h-8 flex-1 text-lg font-semibold"
							/>
							<Button size="sm" type="submit" disabled={!titleDraft.trim()}>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setEditingTitle(false)}
							>
								Cancel
							</Button>
						</form>
					) : (
						<div className="flex flex-1 items-center gap-2">
							<h2 className="text-lg font-semibold tracking-tight">
								{issue.title}
								<span className="ml-1.5 font-normal text-muted-foreground">
									#{issue.number}
								</span>
							</h2>
							<button
								type="button"
								onClick={() => {
									setTitleDraft(issue.title);
									setEditingTitle(true);
								}}
								className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
							>
								<PencilIcon size={12} strokeWidth={2} />
							</button>
						</div>
					)}
				</div>

				<div className="flex items-center gap-3">
					<span
						className={cn(
							"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
							isOpen
								? "bg-green-500/15 text-green-600 dark:text-green-400"
								: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
						)}
					>
						{isOpen ? (
							<CircleDotIcon size={14} strokeWidth={2} />
						) : (
							<CircleCheckIcon size={14} strokeWidth={2} />
						)}
						{isOpen ? "Open" : "Closed"}
					</span>
					<span className="text-xs text-muted-foreground">
						Opened {formatRelativeTime(issue.created_at)}
					</span>
					{issue.comment_count > 0 && (
						<span className="flex items-center gap-1 text-xs text-muted-foreground">
							<MessageSquareIcon size={12} strokeWidth={2} />
							{issue.comment_count}{" "}
							{issue.comment_count === 1 ? "comment" : "comments"}
						</span>
					)}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_240px]">
				{/* Main content */}
				<div className="flex flex-col gap-4">
					{/* Body */}
					<div className="rounded-xl border bg-surface-1">
						<div className="flex items-center justify-between border-b border-border px-4 py-2">
							<span className="text-xs font-medium text-muted-foreground">
								Description
							</span>
							<button
								type="button"
								onClick={() => {
									setBodyDraft(issue.body);
									setEditingBody(!editingBody);
								}}
								className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
							>
								<PencilIcon size={12} strokeWidth={2} />
							</button>
						</div>
						{editingBody ? (
							<div className="flex flex-col gap-2 p-4">
								<Textarea
									autoFocus
									value={bodyDraft}
									onChange={(e) => setBodyDraft(e.target.value)}
									className="min-h-[120px] text-sm"
								/>
								<div className="flex items-center gap-2">
									<Button
										size="sm"
										onClick={() => saveBody.mutate()}
										disabled={saveBody.isPending}
									>
										Save
									</Button>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => setEditingBody(false)}
									>
										Cancel
									</Button>
								</div>
							</div>
						) : issue.body ? (
							<div className="p-4">
								<Markdown>{issue.body}</Markdown>
							</div>
						) : (
							<div className="p-4 text-sm text-muted-foreground italic">
								No description provided.
							</div>
						)}
					</div>

					{/* Comments */}
					{comments.length > 0 && (
						<div className="flex flex-col gap-3">
							<h3 className="text-sm font-semibold">Comments</h3>
							{comments.map((c) => (
								<CommentCard
									key={c.id}
									comment={c}
									slug={repo.slug}
									issueNumber={number}
									onUpdated={invalidate}
								/>
							))}
						</div>
					)}

					{/* New comment */}
					<div className="rounded-xl border bg-surface-1">
						<div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
							Add a comment
						</div>
						<form
							className="flex flex-col gap-3 p-4"
							onSubmit={(e) => {
								e.preventDefault();
								if (commentBody.trim()) addComment.mutate();
							}}
						>
							<Textarea
								value={commentBody}
								onChange={(e) => setCommentBody(e.target.value)}
								placeholder="Write a comment… (Markdown supported)"
								className="min-h-[80px] text-sm"
							/>
							<div className="flex items-center gap-2">
								<Button
									size="sm"
									type="submit"
									disabled={addComment.isPending || !commentBody.trim()}
								>
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
						<span className="mb-2 block text-xs font-semibold text-muted-foreground">
							Labels
						</span>
						<div className="flex flex-wrap items-center gap-1.5">
							{issue.labels.map((l) => (
								<LabelBadge key={l.id} label={l} />
							))}
							<Popover>
								<PopoverTrigger asChild>
									<button
										type="button"
										className="flex size-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
									>
										<PlusIcon size={12} strokeWidth={2} />
									</button>
								</PopoverTrigger>
								<PopoverContent
									align="start"
									className="w-56 p-0"
									onOpenAutoFocus={(e) => e.preventDefault()}
								>
									{allLabels.length === 0 ? (
										<div className="px-3 py-4 text-center text-xs text-muted-foreground">
											No labels created yet.
										</div>
									) : (
										<div className="max-h-64 overflow-y-auto py-1">
											{allLabels.map((l) => {
												const active = issue.labels.some(
													(il) => il.id === l.id,
												);
												const hex = l.color.replace(/^#/, "");
												return (
													<button
														key={l.id}
														type="button"
														onClick={() => {
															const current = issue.labels.map(
																(il) => il.id,
															);
															const next = active
																? current.filter((id) => id !== l.id)
																: [...current, l.id];
															setLabels.mutate(next);
														}}
														className="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-surface-2"
													>
														<span
															className="size-3 shrink-0 rounded-full"
															style={{
																backgroundColor: `#${hex}`,
															}}
														/>
														<span
															className={cn(
																"flex-1 truncate text-left",
																active
																	? "font-medium text-foreground"
																	: "text-muted-foreground",
															)}
														>
															{l.name}
														</span>
														{active && (
															<XIcon
																size={10}
																strokeWidth={2}
																className="shrink-0 text-muted-foreground"
															/>
														)}
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
						<span className="mb-2 block text-xs font-semibold text-muted-foreground">
							Actions
						</span>
						<div className="flex flex-col gap-1.5">
							<Button
								size="sm"
								variant="secondary"
								className="w-full justify-start"
								onClick={() => toggleState.mutate()}
								disabled={toggleState.isPending}
								iconLeft={
									isOpen ? (
										<CircleCheckIcon size={14} strokeWidth={2} />
									) : (
										<CircleDotIcon size={14} strokeWidth={2} />
									)
								}
							>
								{isOpen ? "Close issue" : "Reopen issue"}
							</Button>
							<Button
								size="sm"
								variant="destructive"
								className="btn-grad-danger w-full justify-start text-white shadow-xs"
								onClick={() => setConfirmDelete(true)}
								iconLeft={<Trash2Icon size={14} strokeWidth={2} />}
							>
								Delete issue
							</Button>
						</div>
					</div>
				</div>
			</div>

			<AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete issue #{number}?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes the issue and all its comments.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="btn-grad-danger text-white shadow-xs"
							onClick={() => deleteIssue.mutate()}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function CommentCard({
	comment,
	slug,
	issueNumber,
	onUpdated,
}: {
	comment: { id: number; body: string; created_at: string; updated_at: string };
	slug: string;
	issueNumber: number;
	onUpdated: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(comment.body);

	const update = useMutation({
		mutationFn: () =>
			api.updateComment(slug, issueNumber, comment.id, { body: draft }),
		onSuccess: () => {
			setEditing(false);
			onUpdated();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const del = useMutation({
		mutationFn: () => api.deleteComment(slug, issueNumber, comment.id),
		onSuccess: () => {
			toast.success("Comment deleted");
			onUpdated();
		},
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
					<button
						type="button"
						onClick={() => {
							setDraft(comment.body);
							setEditing(!editing);
						}}
						className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
					>
						<PencilIcon size={11} strokeWidth={2} />
					</button>
					<button
						type="button"
						onClick={() => del.mutate()}
						className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
					>
						<Trash2Icon size={11} strokeWidth={2} />
					</button>
				</div>
			</div>
			{editing ? (
				<div className="flex flex-col gap-2 p-4">
					<Textarea
						autoFocus
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						className="min-h-[80px] text-sm"
					/>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							onClick={() => update.mutate()}
							disabled={update.isPending || !draft.trim()}
						>
							Save
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setEditing(false)}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<div className="p-4">
					<Markdown>{comment.body}</Markdown>
				</div>
			)}
		</div>
	);
}
