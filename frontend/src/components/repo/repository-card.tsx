import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { memo } from "react";

import { type Repo, api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";

export const RepositoryCard = memo(function RepositoryCard({ repo }: { repo: Repo }) {
	return (
		<Link
			to="/repos/$"
			params={{ _splat: repo.slug }}
			className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3.5 transition-colors hover:bg-primary/10"
		>
			{repo.image_path ? (
				<img
					src={api.repoImageUrl(repo.slug)}
					alt=""
					aria-hidden
					className="size-8 shrink-0 rounded-lg object-cover"
				/>
			) : (
				<span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
					<FolderIcon size={16} strokeWidth={1.8} aria-hidden />
				</span>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-2">
					<span className="truncate text-sm font-semibold leading-tight" title={repo.slug}>
						{repo.name}
					</span>
					{repo.updated_at && (
						<span
							className="shrink-0 text-[11px] text-muted-foreground"
							title={new Date(repo.updated_at).toLocaleString()}
						>
							{formatRelativeTime(repo.updated_at)}
						</span>
					)}
				</div>
				{repo.description ? (
					<p className="truncate text-xs text-muted-foreground">{repo.description}</p>
				) : (
					<p className="text-xs text-muted-foreground/40">No description</p>
				)}
			</div>
		</Link>
	);
});
