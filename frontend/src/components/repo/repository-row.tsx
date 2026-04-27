import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { Fragment, memo, type ReactNode } from "react";

import { type Repo, api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";

function RepoAvatar({ repo }: { repo: Repo }) {
	if (repo.image_path) {
		return (
			<img
				src={api.repoImageUrl(repo.slug)}
				alt=""
				aria-hidden
				className="size-6 shrink-0 rounded-md object-cover"
			/>
		);
	}
	return (
		<span
			role="img"
			className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground"
			aria-label="Repository"
		>
			<FolderIcon size={14} strokeWidth={2} aria-hidden />
		</span>
	);
}

export const RepositoryRow = memo(function RepositoryRow({ repo }: { repo: Repo }) {
	const metaEntries: { key: string; node: ReactNode }[] = [];
	if (repo.updated_at) {
		metaEntries.push({
			key: "time",
			node: (
				<span
					className="shrink-0"
					title={new Date(repo.updated_at).toLocaleString()}
				>
					{formatRelativeTime(repo.updated_at)}
				</span>
			),
		});
	}

	return (
		<Link
			to="/repos/$"
			params={{ _splat: repo.slug }}
			className="grid w-full grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-primary/10 md:grid-cols-[14rem_minmax(0,1fr)_minmax(8rem,auto)] md:gap-y-1"
		>
			<div className="flex min-w-0 flex-col gap-0.5">
				<div className="flex min-w-0 max-w-full items-center gap-x-2">
					<RepoAvatar repo={repo} />
					<p
						className="min-w-0 truncate text-sm font-medium leading-none"
						title={repo.slug}
					>
						{repo.name}
					</p>
				</div>
			</div>
			<div className="flex min-w-0 items-center">
				{repo.description ? (
					<p className="truncate text-xs text-muted-foreground">
						{repo.description}
					</p>
				) : (
					<span className="text-xs text-muted-foreground/40">—</span>
				)}
			</div>
			{metaEntries.length > 0 ? (
				<div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs leading-none text-muted-foreground md:justify-end">
					{metaEntries.map((entry, i) => (
						<Fragment key={entry.key}>
							{i > 0 && <span className="shrink-0 text-muted-foreground/60">·</span>}
							{entry.node}
						</Fragment>
					))}
				</div>
			) : (
				<div className="md:text-right">
					<span className="text-xs text-muted-foreground/40">—</span>
				</div>
			)}
		</Link>
	);
});
