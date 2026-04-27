import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { GitCommitHorizontalIcon } from "lucide-react";

import { CommitAvatar } from "@/components/repo/commit-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { api, slugToUrl } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";

export function LatestCommitBar({
	slug,
	rev,
}: {
	slug: string;
	rev: string;
}) {
	const tipQuery = useQuery({
		queryKey: ["latest-commit", slug, rev],
		queryFn: () => api.commits(slug, rev, 1),
	});

	const commit = tipQuery.data?.[0];

	if (tipQuery.isPending && !commit) {
		return (
			<div className="flex items-center gap-3 rounded-t-lg border border-b-0 bg-surface-1 px-4 py-2.5 text-sm">
				<Skeleton className="h-4 w-20 shrink-0 rounded" />
				<Skeleton className="h-4 min-w-0 flex-1 rounded" />
				<Skeleton className="h-4 w-24 shrink-0 rounded" />
			</div>
		);
	}

	if (!commit) return null;

	const shortSha = commit.sha.slice(0, 7);
	const firstLine = commit.subject;

	return (
		<div className="flex h-11 items-center gap-3 rounded-t-lg border border-b-0 bg-surface-1 px-4 text-sm">
			<CommitAvatar size={20} className="self-center" />
			<span className="optical-center font-medium">{commit.author || "Unknown"}</span>
			<Link
				to="/repos/$"
				params={{ _splat: slug }}
				search={{ tab: "commits", sha: commit.sha }}
				className="optical-center truncate-soft min-w-0 flex-1 text-left text-muted-foreground transition-colors hover:text-foreground hover:underline"
			>
				{firstLine}
			</Link>
			<div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="flex items-center gap-1">
							<GitCommitHorizontalIcon size={14} />
							<code className="optical-center">{shortSha}</code>
						</span>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						<code>{commit.sha}</code>
					</TooltipContent>
				</Tooltip>
				<span className="optical-center">{formatRelativeTime(commit.date)}</span>
			</div>
		</div>
	);
}
