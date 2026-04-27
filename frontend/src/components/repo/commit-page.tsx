import { PatchDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileIcon, GitCommitHorizontalIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";

import { CommitAvatar } from "@/components/repo/commit-avatar";
import { api } from "@/lib/api";
import { fileIconUrl } from "@/lib/file-icons";
import { type FilePatch, splitPatch } from "@/lib/split-patch";
import { cn } from "@/lib/utils";

const DIFF_THEME = {
	light: "github-light" as const,
	dark: "github-dark" as const,
};

export function CommitPage({
	slug,
	sha,
	scrollToFile,
}: {
	slug: string;
	sha: string;
	scrollToFile?: string;
}) {
	const commitQuery = useQuery({
		queryKey: ["commit", slug, sha],
		queryFn: () => api.commit(slug, sha),
	});

	const commit = commitQuery.data;
	const files = useMemo(
		() => splitPatch(commit?.patch ?? ""),
		[commit?.patch],
	);
	const stats = useMemo(() => {
		let additions = 0;
		let deletions = 0;
		for (const f of files) {
			additions += f.additions;
			deletions += f.deletions;
		}
		return { files: files.length, additions, deletions };
	}, [files]);

	if (commitQuery.error) throw commitQuery.error;

	if (commitQuery.isPending) {
		return (
			<div className="flex h-full items-center justify-center py-12">
				<div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
			</div>
		);
	}

	if (!commit) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
				<p>Commit not found.</p>
				<Link
					to="/repos/$"
					params={{ _splat: slug }}
					className="text-foreground underline-offset-4 hover:underline"
				>
					Back to repository
				</Link>
			</div>
		);
	}

	const titleLine = commit.commit.subject;
	const body = commit.commit.body;

	return (
		<div className="flex h-full flex-col gap-4">
			<CommitToolbar
				slug={slug}
				sha={commit.commit.sha}
				titleLine={titleLine}
				stats={stats}
			/>
			<div className="overflow-hidden rounded-lg border">
				<div className="border-b border-border bg-surface-0 px-4 py-3">
					<div className="text-sm font-medium">{titleLine}</div>
					{body && (
						<pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
							{body}
						</pre>
					)}
					<div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
						<CommitAvatar size={20} />
						<span className="optical-center">{commit.commit.author}</span>
						<span className="optical-center" aria-hidden>
							·
						</span>
						<span className="optical-center">{commit.commit.email}</span>
						<span className="optical-center" aria-hidden>
							·
						</span>
						<span className="optical-center">
							{new Date(commit.commit.date).toLocaleString()}
						</span>
					</div>
				</div>
			</div>
			<div className="flex flex-col gap-4">
				{files.map((f) => (
					<FileDiffBlock
						key={`${f.filename}-${f.patch.length}`}
						file={f}
						scrollIntoView={scrollToFile === f.filename}
					/>
				))}
			</div>
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

function FileDiffBlock({
	file,
	scrollIntoView,
}: {
	file: FilePatch;
	scrollIntoView?: boolean;
}) {
	const { resolvedTheme } = useTheme();
	const themeType = resolvedTheme === "dark" ? "dark" : "light";
	const [ref, seen] = useInViewport<HTMLDivElement>();
	const estimatedLines = useMemo(() => file.patch.split("\n").length, [file.patch]);
	const placeholderHeight = Math.min(estimatedLines * 20, 600);
	useEffect(() => {
		if (!scrollIntoView) return;
		const el = ref.current;
		if (!el) return;
		const id = requestAnimationFrame(() => {
			el.scrollIntoView({ block: "start", behavior: "auto" });
		});
		return () => cancelAnimationFrame(id);
	}, [scrollIntoView, ref]);
	return (
		<div ref={ref} className="diff-block overflow-hidden rounded-lg border">
			<div className="flex items-center gap-2 border-b bg-surface-0 px-4 py-2.5 text-sm">
				<img
					src={fileIconUrl(file.filename, false)}
					alt=""
					aria-hidden
					className="size-4 shrink-0 select-none"
					draggable={false}
				/>
				{file.oldFilename && (
					<>
						<span className="optical-center text-muted-foreground line-through">
							{file.oldFilename}
						</span>
						<span className="optical-center text-muted-foreground" aria-hidden>
							→
						</span>
					</>
				)}
				<span className="optical-center font-medium text-foreground">
					{file.filename}
				</span>
				{file.status !== "modified" && (
					<span
						className={cn(
							"optical-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
							file.status === "added" &&
								"bg-green-500/15 text-green-600 dark:text-green-400",
							file.status === "deleted" &&
								"bg-red-500/15 text-red-600 dark:text-red-400",
							file.status === "renamed" &&
								"bg-blue-500/15 text-blue-600 dark:text-blue-400",
						)}
					>
						{file.status}
					</span>
				)}
				<div className="ml-auto flex items-center gap-2 text-xs">
					<span className="optical-center font-mono tabular-nums font-medium text-green-500">
						+{file.additions}
					</span>
					<span className="optical-center font-mono tabular-nums font-medium text-red-500">
						−{file.deletions}
					</span>
				</div>
			</div>
			{seen ? (
				<PatchDiff
					patch={file.patch}
					disableWorkerPool
					style={
						{
							"--diffs-dark-bg": "var(--card)",
							"--diffs-bg-buffer-override": "var(--card)",
							"--diffs-bg-context-override": "var(--card)",
							"--diffs-bg-separator-override": "var(--surface-0)",
						} as React.CSSProperties
					}
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

function CommitToolbar({
	slug,
	sha,
	titleLine,
	stats,
}: {
	slug: string;
	sha: string;
	titleLine: string;
	stats: { files: number; additions: number; deletions: number };
}) {
	const shortSha = sha.slice(0, 7);
	return (
		<div className="flex shrink-0 items-center gap-2 rounded-lg border bg-surface-0 px-3 py-2 md:gap-3 md:px-4">
			<Link
				to="/repos/$"
				params={{ _splat: slug }}
				search={{ tab: "commits" }}
				className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<span className="font-mono">{shortSha}</span>
			</Link>
			<div className="hidden mx-1 h-4 w-px bg-border md:block" />
			<div className="hidden min-w-0 items-center gap-2 md:flex">
				<GitCommitHorizontalIcon size={14} strokeWidth={2} className="shrink-0" />
				<span className="truncate text-sm font-medium">{titleLine}</span>
			</div>
			<div className="ml-auto flex items-center gap-2 md:gap-3">
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<span className="flex items-center gap-1">
						<FileIcon size={13} strokeWidth={2} />
						<span className="font-mono tabular-nums font-medium text-foreground">
							{stats.files}
						</span>
						<span className="hidden md:inline">
							{stats.files === 1 ? "file" : "files"}
						</span>
					</span>
					<span className="font-mono tabular-nums font-medium text-green-500">
						+{stats.additions}
					</span>
					<span className="font-mono tabular-nums font-medium text-red-500">
						−{stats.deletions}
					</span>
				</div>
			</div>
		</div>
	);
}
