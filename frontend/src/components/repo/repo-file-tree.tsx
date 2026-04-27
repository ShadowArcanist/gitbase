import * as Collapsible from "@radix-ui/react-collapsible";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { type TreeEntry, api } from "@/lib/api";
import { fileIconUrl } from "@/lib/file-icons";
import { cn } from "@/lib/utils";

type Props = {
	slug: string;
	rev: string;
	currentPath: string;
};

export function RepoFileTree({ slug, rev, currentPath }: Props) {
	return (
		<TreeLevel
			slug={slug}
			rev={rev}
			currentPath={currentPath}
			parentPath=""
			depth={0}
		/>
	);
}

function TreeLevel({
	slug,
	rev,
	currentPath,
	parentPath,
	depth,
}: {
	slug: string;
	rev: string;
	currentPath: string;
	parentPath: string;
	depth: number;
}) {
	const q = useQuery({
		queryKey: ["tree", slug, rev, parentPath],
		queryFn: () => api.tree(slug, rev, parentPath),
		staleTime: 60_000,
	});

	const entries = [...(q.data?.entries ?? [])].sort((a, b) => {
		if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	return (
		<ul className="flex flex-col">
			{entries.map((entry) => (
				<TreeNode
					key={entry.path}
					entry={entry}
					slug={slug}
					rev={rev}
					currentPath={currentPath}
					parentPath={parentPath}
					depth={depth}
				/>
			))}
		</ul>
	);
}

function TreeNode({
	entry,
	slug,
	rev,
	currentPath,
	parentPath,
	depth,
}: {
	entry: TreeEntry;
	slug: string;
	rev: string;
	currentPath: string;
	parentPath: string;
	depth: number;
}) {
	const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
	const isFile = entry.type === "blob";
	const selected = currentPath === fullPath;
	const isAncestor =
		currentPath === fullPath || currentPath.startsWith(`${fullPath}/`);
	const initialOpen = !isFile && isAncestor;
	const [open, setOpen] = useState(initialOpen);
	const [wasOpened, setWasOpened] = useState(initialOpen);
	useEffect(() => {
		if (isAncestor && !open) {
			setOpen(true);
			setWasOpened(true);
		}
	}, [currentPath]);
	const qc = useQueryClient();
	const handleOpenChange = (v: boolean) => {
		setOpen(v);
		if (v) setWasOpened(true);
	};
	const prefetch = () => {
		if (isFile) return;
		void qc.prefetchQuery({
			queryKey: ["tree", slug, rev, fullPath],
			queryFn: () => api.tree(slug, rev, fullPath),
			staleTime: 60_000,
		});
	};
	const indent = `${depth * 12 + 8}px`;

	if (isFile) {
		return (
			<li>
				<Link
					to="/repos/$"
					params={{ _splat: slug }}
					search={{ tab: undefined, rev, path: fullPath }}
					className={cn(
						"flex h-7 items-center gap-2 pr-2 text-sm leading-none transition-colors hover:bg-surface-1",
						selected
							? "bg-surface-1 font-medium text-foreground"
							: "text-foreground/85",
					)}
					style={{ paddingLeft: indent }}
				>
					<img
						src={fileIconUrl(entry.name, false)}
						alt=""
						aria-hidden
						className="size-4 shrink-0 select-none"
						draggable={false}
					/>
					<span className="optical-center truncate-soft min-w-0">
						{entry.name}
					</span>
				</Link>
			</li>
		);
	}

	return (
		<li>
			<Collapsible.Root open={open} onOpenChange={handleOpenChange}>
				<Collapsible.Trigger asChild>
					<button
						type="button"
						onMouseEnter={prefetch}
						onFocus={prefetch}
						className={cn(
							"flex h-7 w-full items-center gap-1 pr-2 text-sm leading-none transition-colors hover:bg-surface-1",
							isAncestor ? "text-foreground" : "text-foreground/85",
						)}
						style={{ paddingLeft: indent }}
					>
						<ChevronRightIcon
							size={14}
							strokeWidth={2}
							className={cn(
								"shrink-0 text-muted-foreground transition-transform duration-150",
								open && "rotate-90",
							)}
						/>
						<img
							src={fileIconUrl(entry.name, true)}
							alt=""
							aria-hidden
							className="size-4 shrink-0 select-none"
							draggable={false}
						/>
						<span className="optical-center truncate-soft min-w-0 text-left">
							{entry.name}
						</span>
					</button>
				</Collapsible.Trigger>
				{wasOpened && (
					<Collapsible.Content className="tree-collapsible" forceMount>
						<TreeLevel
							slug={slug}
							rev={rev}
							currentPath={currentPath}
							parentPath={fullPath}
							depth={depth + 1}
						/>
					</Collapsible.Content>
				)}
			</Collapsible.Root>
		</li>
	);
}
