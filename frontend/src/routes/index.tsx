import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
	CpuIcon,
	FolderClosedIcon,
	FolderIcon,
	HardDriveIcon,
	PencilIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { type ActivityItem, type ActivityKind, api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { cn, formatBytes } from "@/lib/utils";

export const Route = createFileRoute("/")({
	component: HomePage,
});

function HomePage() {
	const statsQ = useQuery({
		queryKey: ["stats"],
		queryFn: () => api.stats(),
		refetchInterval: 15_000,
	});
	const activityQ = useQuery({
		queryKey: ["activity"],
		queryFn: () => api.activity(),
	});
	const stats = statsQ.data;

	return (
		<div className="overflow-stable h-full overflow-auto py-10">
			<div className="mx-auto flex max-w-6xl flex-col gap-8 px-3 md:px-6">
				<div className="flex flex-col gap-1.5">
					<h1 className="text-2xl font-semibold tracking-tight">Home</h1>
					<p className="text-sm text-muted-foreground">
						System overview and recent activity.
					</p>
				</div>

				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					<MetricCard
						icon={FolderIcon}
						label="Repositories"
						value={stats?.repo_count}
					/>
					<MetricCard
						icon={FolderClosedIcon}
						label="Namespaces"
						value={stats?.namespace_count}
					/>
					<MetricCard
						icon={HardDriveIcon}
						label="Disk"
						value={stats ? formatBytes(stats.disk_used) : undefined}
					/>
					<MetricCard
						icon={CpuIcon}
						label="RAM"
						value={stats ? formatBytes(stats.ram_used) : undefined}
					/>
				</div>

				<section className="flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold">Recent activity</h2>
						<Link
							to="/repos"
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							All repositories →
						</Link>
					</div>
					<div className="overflow-hidden rounded-xl border bg-surface-1">
						{activityQ.isLoading ? (
							<div className="flex flex-col gap-2 p-4">
								<Skeleton className="h-4 w-2/3 rounded" />
								<Skeleton className="h-4 w-1/2 rounded" />
								<Skeleton className="h-4 w-3/5 rounded" />
							</div>
						) : (activityQ.data ?? []).length === 0 ? (
							<div className="p-10 text-center text-sm text-muted-foreground">
								No activity yet. Create a repository to get started.
							</div>
						) : (
							<div className="divide-y divide-border">
								{(activityQ.data ?? []).map((item) => (
									<ActivityRow key={item.id} item={item} />
								))}
							</div>
						)}
					</div>
				</section>
			</div>
		</div>
	);
}

function activityIcon(kind: ActivityKind) {
	if (kind.endsWith(".deleted")) return Trash2Icon;
	if (kind.endsWith(".updated")) return PencilIcon;
	return PlusIcon;
}

function ActivityRow({ item }: { item: ActivityItem }) {
	const Icon = activityIcon(item.kind);
	const deleted = item.kind.endsWith(".deleted");
	const tone =
		item.status === "error" ? "text-destructive" : "text-muted-foreground";

	const body = (
		<>
			<span
				className={cn(
					"flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2",
					tone,
				)}
			>
				<Icon size={13} strokeWidth={2} />
			</span>
			<div className="min-w-0">
				<div className="truncate">
					<span className="text-foreground">{item.message}</span>{" "}
					<span className="font-mono text-xs text-muted-foreground">
						{item.target}
					</span>
				</div>
			</div>
			<span
				className="shrink-0 text-xs text-muted-foreground"
				title={new Date(item.time).toLocaleString()}
			>
				{formatRelativeTime(item.time)}
			</span>
		</>
	);

	const rowClass =
		"grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 text-sm leading-none transition-colors hover:bg-primary/10";

	if (deleted || !item.target_kind) {
		return <div className={rowClass}>{body}</div>;
	}
	if (item.target_kind === "namespace") {
		return (
			<Link to="/namespaces/$" params={{ _splat: item.target }} className={rowClass}>
				{body}
			</Link>
		);
	}
	return (
		<Link to="/repos/$" params={{ _splat: item.target }} className={rowClass}>
			{body}
		</Link>
	);
}

function MetricCard({
	icon: Icon,
	label,
	value,
}: {
	icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
	label: string;
	value?: number | string;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-surface-1 p-4">
			<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
				<Icon size={14} strokeWidth={2} />
				{label}
			</div>
			<div className="text-2xl font-semibold tabular-nums">
				{value ?? <Skeleton className="h-7 w-16 rounded" />}
			</div>
		</div>
	);
}
