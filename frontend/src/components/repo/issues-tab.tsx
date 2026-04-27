import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	CircleDotIcon,
	CircleCheckIcon,
	MessageSquareIcon,
	PlusIcon,
	SearchIcon,
	TagIcon,
	XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { type Issue, type Label, type Repo, api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn } from "@/lib/utils";

export function IssuesTab({
	repo,
	onSelectIssue,
	onOpenLabels,
}: {
	repo: Repo;
	onSelectIssue: (num: number) => void;
	onOpenLabels: () => void;
}) {
	const [stateFilter, setStateFilter] = useState<"open" | "closed">("open");
	const [search, setSearch] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const qc = useQueryClient();

	const issuesQ = useQuery({
		queryKey: ["issues", repo.slug, stateFilter],
		queryFn: () => api.listIssues(repo.slug, stateFilter),
	});

	const issues = issuesQ.data?.issues ?? [];
	const openCount = issuesQ.data?.open_count ?? 0;
	const closedCount = issuesQ.data?.closed_count ?? 0;

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return issues;
		return issues.filter(
			(i) =>
				i.title.toLowerCase().includes(q) ||
				`#${i.number}`.includes(q) ||
				i.labels.some((l) => l.name.toLowerCase().includes(q)),
		);
	}, [issues, search]);

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
						placeholder="Search issues…"
						className="h-9 pl-9 text-sm"
					/>
				</div>
				<Button
					size="sm"
					variant="secondary"
					onClick={onOpenLabels}
					iconLeft={<TagIcon size={14} strokeWidth={2} />}
				>
					Labels
				</Button>
				<Button
					size="sm"
					onClick={() => setCreateOpen(true)}
					iconLeft={<PlusIcon size={14} strokeWidth={2} />}
				>
					New issue
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
						<CircleDotIcon size={14} strokeWidth={2} className="text-green-500" />
						<span className="tabular-nums font-semibold">{openCount}</span> Open
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
						<CircleCheckIcon
							size={14}
							strokeWidth={2}
							className="text-purple-500"
						/>
						<span className="tabular-nums font-semibold">{closedCount}</span>{" "}
						Closed
					</button>
				</div>

				{issuesQ.isLoading ? (
					<div className="p-10 text-center text-sm text-muted-foreground">
						Loading…
					</div>
				) : filtered.length === 0 ? (
					<div className="flex flex-col items-center gap-2 p-10 text-center">
						<CircleDotIcon
							size={24}
							strokeWidth={1.5}
							className="text-muted-foreground"
						/>
						<p className="text-sm text-muted-foreground">
							{search
								? "No matching issues."
								: stateFilter === "open"
									? "No open issues."
									: "No closed issues."}
						</p>
					</div>
				) : (
					<div className="divide-y divide-border">
						{filtered.map((issue) => (
							<IssueRow
								key={issue.id}
								issue={issue}
								onClick={() => onSelectIssue(issue.number)}
							/>
						))}
					</div>
				)}
			</div>

			<NewIssueDialog
				repo={repo}
				open={createOpen}
				onOpenChange={setCreateOpen}
				onCreated={(num) => {
					qc.invalidateQueries({ queryKey: ["issues", repo.slug] });
					onSelectIssue(num);
				}}
			/>
		</div>
	);
}

function IssueRow({
	issue,
	onClick,
}: {
	issue: Issue;
	onClick: () => void;
}) {
	const isOpen = issue.state === "open";
	return (
		<button
			type="button"
			onClick={onClick}
			className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5"
		>
			{isOpen ? (
				<CircleDotIcon
					size={16}
					strokeWidth={2}
					className="mt-0.5 shrink-0 text-green-500"
				/>
			) : (
				<CircleCheckIcon
					size={16}
					strokeWidth={2}
					className={cn(
						"mt-0.5 shrink-0",
						issue.state_reason === "not_planned"
							? "text-muted-foreground"
							: "text-purple-500",
					)}
				/>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm text-foreground leading-tight">
						{issue.title}
					</span>
					{issue.labels.map((l) => (
						<LabelBadge key={l.id} label={l} />
					))}
				</div>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span>#{issue.number}</span>
					<span>·</span>
					<span>
						{isOpen ? "opened" : "closed"}{" "}
						{formatRelativeTime(
							isOpen ? issue.created_at : (issue.closed_at ?? issue.updated_at),
						)}
					</span>
				</div>
			</div>
			{issue.comment_count > 0 && (
				<div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
					<MessageSquareIcon size={12} strokeWidth={2} />
					<span className="tabular-nums">{issue.comment_count}</span>
				</div>
			)}
		</button>
	);
}

export function LabelBadge({ label }: { label: Label }) {
	const hex = label.color.replace(/^#/, "");
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	return (
		<span
			className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-tight"
			style={{
				borderColor: `rgba(${r}, ${g}, ${b}, 0.4)`,
				backgroundColor: `rgba(${r}, ${g}, ${b}, 0.1)`,
				color: `rgb(${Math.min(r + 40, 255)}, ${Math.min(g + 40, 255)}, ${Math.min(b + 40, 255)})`,
			}}
		>
			{label.name}
		</span>
	);
}

function NewIssueDialog({
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
	const [selectedLabels, setSelectedLabels] = useState<number[]>([]);

	const labelsQ = useQuery({
		queryKey: ["labels", repo.slug],
		queryFn: () => api.listLabels(repo.slug),
		enabled: open,
	});

	const create = useMutation({
		mutationFn: () =>
			api.createIssue(repo.slug, {
				title: title.trim(),
				body,
				label_ids: selectedLabels.length > 0 ? selectedLabels : undefined,
			}),
		onSuccess: (iss) => {
			toast.success(`Issue #${iss.number} created`);
			onCreated(iss.number);
			onOpenChange(false);
			setTitle("");
			setBody("");
			setSelectedLabels([]);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const labels = labelsQ.data ?? [];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-0 p-0 sm:max-w-xl">
				<DialogHeader className="gap-1.5 px-5 pt-5 pb-4">
					<DialogTitle className="text-[0.9375rem]">New issue</DialogTitle>
					<DialogDescription className="text-[0.8125rem]">
						Create a new issue for this repository.
					</DialogDescription>
				</DialogHeader>
				<form
					id="new-issue-form"
					className="flex flex-col gap-4 px-5 pb-5"
					onSubmit={(e) => {
						e.preventDefault();
						if (!title.trim()) return;
						create.mutate();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<FormLabel className="text-xs font-medium">Title</FormLabel>
						<Input
							required
							autoFocus
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="Issue title"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<FormLabel className="text-xs font-medium">Description</FormLabel>
						<Textarea
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="Describe the issue… (Markdown supported)"
							className="min-h-[120px] text-sm"
						/>
					</div>
					{labels.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<FormLabel className="text-xs font-medium">Labels</FormLabel>
							<div className="flex flex-wrap gap-1.5">
								{labels.map((l) => {
									const active = selectedLabels.includes(l.id);
									return (
										<button
											key={l.id}
											type="button"
											onClick={() =>
												setSelectedLabels((prev) =>
													active
														? prev.filter((id) => id !== l.id)
														: [...prev, l.id],
												)
											}
											className={cn(
												"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
												active
													? "border-transparent"
													: "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
											)}
											style={
												active
													? {
															backgroundColor: `#${l.color.replace(/^#/, "")}`,
															color:
																getLuma(l.color) > 140
																	? "#1f2328"
																	: "#ffffff",
														}
													: undefined
											}
										>
											<TagIcon size={10} strokeWidth={2} />
											{l.name}
										</button>
									);
								})}
							</div>
						</div>
					)}
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
						form="new-issue-form"
						disabled={create.isPending || !title.trim()}
					>
						{create.isPending ? "Creating…" : "Create issue"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function getLuma(color: string): number {
	const hex = color.replace(/^#/, "");
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	return 0.299 * r + 0.587 * g + 0.114 * b;
}
