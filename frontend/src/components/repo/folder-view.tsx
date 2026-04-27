import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { type TreeEntry, api, slugToUrl } from "@/lib/api";
import { fileIconUrl } from "@/lib/file-icons";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { prewarmLangs } from "@/lib/shiki-bundle";
import { cn, formatBytes } from "@/lib/utils";
import { detectLang } from "./code-file-view";
import { LatestCommitBar } from "./latest-commit-bar";

type EntryMeta = {
	sha: string;
	time: number;
	author: string;
	subject: string;
};

export function FolderView({
	entries,
	slug,
	currentRef,
	currentPath,
}: {
	entries: TreeEntry[];
	slug: string;
	currentRef: string;
	currentPath: string;
}) {
	const sorted = [...entries].sort((a, b) => {
		if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	useEffect(() => {
		const langs = new Set<string>();
		for (const e of entries) {
			if (e.type === "blob") langs.add(detectLang(e.name));
		}
		prewarmLangs([...langs]);
	}, [entries]);

	const metaQ = useQuery({
		queryKey: ["tree-meta", slug, currentRef, currentPath],
		queryFn: () => api.treeMeta(slug, currentRef, currentPath),
		staleTime: 60_000,
	});
	const meta = metaQ.data?.meta ?? {};

	return (
		<div className="flex flex-col gap-6">
			<div>
				<LatestCommitBar slug={slug} rev={currentRef} />
				<div className="overflow-hidden rounded-b-lg border">
					{sorted.length === 0 && (
						<div className="p-10 text-center text-sm text-muted-foreground">
							Empty repository.
						</div>
					)}
					{sorted.map((entry, index) => (
						<FolderViewRow
							key={entry.sha + entry.path}
							entry={entry}
							slug={slug}
							currentRef={currentRef}
							currentPath={currentPath}
							isLast={index === sorted.length - 1}
							meta={meta[entry.name]}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function FolderViewRow({
	entry,
	slug,
	currentRef,
	currentPath,
	isLast,
	meta,
}: {
	entry: TreeEntry;
	slug: string;
	currentRef: string;
	currentPath: string;
	isLast: boolean;
	meta?: EntryMeta;
}) {
	const isDir = entry.type === "tree";
	const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
	const iconUrl = fileIconUrl(entry.name, isDir);

	return (
		<div
			className={cn(
				"grid h-10 grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(5rem,auto)_minmax(6rem,auto)] items-center gap-4 px-4 text-sm hover:bg-surface-1",
				!isLast && "border-b",
			)}
		>
			<Link
				to="/repos/$"
				params={{ _splat: slug }}
				search={{ tab: undefined, rev: currentRef, path: entryPath }}
				className="flex min-w-0 items-center gap-2.5"
			>
				<img
					src={iconUrl}
					alt=""
					aria-hidden
					className="size-4 shrink-0 select-none"
					draggable={false}
				/>
				<span
					className={cn(
						"optical-center truncate-soft min-w-0",
						isDir ? "font-medium text-accent-foreground" : "text-foreground",
					)}
				>
					{entry.name}
				</span>
			</Link>
			<span
				className="optical-center truncate-soft min-w-0 text-xs text-muted-foreground"
				title={meta?.subject}
			>
				{meta?.subject ?? ""}
			</span>
			<span className="optical-center text-right text-xs text-muted-foreground tabular-nums">
				{entry.type === "blob" ? formatBytes(entry.size) : ""}
			</span>
			<span
				className="optical-center text-right text-xs text-muted-foreground tabular-nums"
				title={meta ? new Date(meta.time * 1000).toLocaleString() : undefined}
			>
				{meta ? formatRelativeTime(new Date(meta.time * 1000).toISOString()) : ""}
			</span>
		</div>
	);
}
