import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeftIcon,
	PencilIcon,
	PlusIcon,
	TagIcon,
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
import { Label as FormLabel } from "@/components/ui/label";
import { type Label, type Repo, api } from "@/lib/api";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
	"d73a4a", "b60205", "0075ca", "1d76db", "0e8a16",
	"7057ff", "5319e7", "008672", "d876e3", "e36209",
	"c2185b", "6f42c1", "0d47a1", "2e7d32", "795548",
];

export function LabelsPage({
	repo,
	onBack,
}: {
	repo: Repo;
	onBack: () => void;
}) {
	const qc = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<Label | null>(null);

	const labelsQ = useQuery({
		queryKey: ["labels", repo.slug],
		queryFn: () => api.listLabels(repo.slug),
	});

	const labels = labelsQ.data ?? [];

	const deleteMut = useMutation({
		mutationFn: (id: number) => api.deleteLabel(repo.slug, id),
		onSuccess: () => {
			toast.success("Label deleted");
			qc.invalidateQueries({ queryKey: ["labels", repo.slug] });
			setDeleteTarget(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onBack}
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
				>
					<ArrowLeftIcon size={14} strokeWidth={2} />
				</button>
				<h2 className="flex-1 text-lg font-semibold tracking-tight">Labels</h2>
				<Button
					size="sm"
					onClick={() => setCreating(true)}
					iconLeft={<PlusIcon size={14} strokeWidth={2} />}
				>
					New label
				</Button>
			</div>

			<div className="overflow-hidden rounded-xl border bg-surface-1">
				<div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
					{labels.length} {labels.length === 1 ? "label" : "labels"}
				</div>

				{creating && (
					<LabelForm
						repo={repo}
						onDone={() => {
							setCreating(false);
							qc.invalidateQueries({ queryKey: ["labels", repo.slug] });
						}}
						onCancel={() => setCreating(false)}
					/>
				)}

				{labelsQ.isLoading ? (
					<div className="p-10 text-center text-sm text-muted-foreground">
						Loading…
					</div>
				) : labels.length === 0 && !creating ? (
					<div className="flex flex-col items-center gap-2 p-10 text-center">
						<TagIcon size={24} strokeWidth={1.5} className="text-muted-foreground" />
						<p className="text-sm text-muted-foreground">No labels yet.</p>
					</div>
				) : (
					<div className="divide-y divide-border">
						{labels.map((label) =>
							editingId === label.id ? (
								<LabelForm
									key={label.id}
									repo={repo}
									label={label}
									onDone={() => {
										setEditingId(null);
										qc.invalidateQueries({ queryKey: ["labels", repo.slug] });
									}}
									onCancel={() => setEditingId(null)}
								/>
							) : (
								<div
									key={label.id}
									className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-primary/5"
								>
									<LabelBadge label={label} />
									<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
										{label.description || "No description"}
									</span>
									<div className="flex shrink-0 items-center gap-1">
										<button
											type="button"
											onClick={() => setEditingId(label.id)}
											className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
											title="Edit"
										>
											<PencilIcon size={13} strokeWidth={2} />
										</button>
										<button
											type="button"
											onClick={() => setDeleteTarget(label)}
											className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
											title="Delete"
										>
											<Trash2Icon size={13} strokeWidth={2} />
										</button>
									</div>
								</div>
							),
						)}
					</div>
				)}
			</div>

			<AlertDialog
				open={deleteTarget != null}
				onOpenChange={(v) => !v && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete label "{deleteTarget?.name}"?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the label from all issues that use it.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="btn-grad-danger text-white shadow-xs"
							onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function LabelForm({
	repo,
	label,
	onDone,
	onCancel,
}: {
	repo: Repo;
	label?: Label;
	onDone: () => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(label?.name ?? "");
	const [color, setColor] = useState(label?.color?.replace(/^#/, "") ?? randomColor());
	const [description, setDescription] = useState(label?.description ?? "");

	const isEdit = !!label;

	const save = useMutation({
		mutationFn: () => {
			if (isEdit) {
				return api.updateLabel(repo.slug, label.id, {
					name: name.trim(),
					color,
					description,
				});
			}
			return api.createLabel(repo.slug, {
				name: name.trim(),
				color,
				description,
			});
		},
		onSuccess: () => {
			toast.success(isEdit ? "Label updated" : "Label created");
			onDone();
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<form
			className="flex flex-col gap-3 border-b border-border bg-surface-0 p-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (name.trim()) save.mutate();
			}}
		>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_140px]">
				<div className="flex flex-col gap-1.5">
					<FormLabel className="text-xs font-medium">Name</FormLabel>
					<Input
						autoFocus
						required
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Label name"
						className="h-8 text-sm"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<FormLabel className="text-xs font-medium">Description</FormLabel>
					<Input
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Optional description"
						className="h-8 text-sm"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<FormLabel className="text-xs font-medium">Color</FormLabel>
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							onClick={() => setColor(randomColor())}
							className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border transition-colors hover:bg-surface-1"
							style={{ backgroundColor: `#${color}` }}
							title="Random color"
						/>
						<Input
							value={color}
							onChange={(e) => setColor(e.target.value.replace(/^#/, "").slice(0, 6))}
							placeholder="0075ca"
							className="h-8 font-mono text-xs"
							maxLength={6}
						/>
					</div>
				</div>
			</div>
			<div className="flex flex-wrap gap-1.5">
				{PRESET_COLORS.map((c) => (
					<button
						key={c}
						type="button"
						onClick={() => setColor(c)}
						className={cn(
							"size-5 rounded-full border-2 transition-transform hover:scale-110",
							color === c ? "border-foreground" : "border-transparent",
						)}
						style={{ backgroundColor: `#${c}` }}
					/>
				))}
			</div>
			<div className="flex items-center justify-between">
				<LabelBadge label={{ id: 0, repo_id: 0, name: name || "preview", color, description: "", created_at: "" }} />
				<div className="flex items-center gap-2">
					<Button size="sm" variant="ghost" type="button" onClick={onCancel}>
						Cancel
					</Button>
					<Button size="sm" type="submit" disabled={save.isPending || !name.trim()}>
						{save.isPending ? "Saving…" : isEdit ? "Save changes" : "Create label"}
					</Button>
				</div>
			</div>
		</form>
	);
}

function randomColor(): string {
	return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)];
}
