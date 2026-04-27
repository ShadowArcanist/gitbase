import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { DownloadIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function NewRepoDialog({ trigger }: { trigger: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	const nav = useNavigate();
	const qc = useQueryClient();
	const [namespace, setNamespace] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [defaultBranch, setDefaultBranch] = useState("main");
	const [defaultBranchTouched, setDefaultBranchTouched] = useState(false);
	const [mode, setMode] = useState<"empty" | "import">("empty");
	const [importUrl, setImportUrl] = useState("");
	const [importToken, setImportToken] = useState("");

	const nsQ = useQuery({
		queryKey: ["namespaces"],
		queryFn: () => api.listNamespaces(),
		enabled: open,
	});

	const settingsQ = useQuery({
		queryKey: ["app-settings"],
		queryFn: () => api.getAppSettings(),
		enabled: open,
	});

	useEffect(() => {
		if (!defaultBranchTouched && settingsQ.data?.default_branch) {
			setDefaultBranch(settingsQ.data.default_branch);
		}
	}, [settingsQ.data, defaultBranchTouched]);

	useEffect(() => {
		if (!namespace && nsQ.data?.length) {
			setNamespace(nsQ.data[0].name);
		}
	}, [nsQ.data, namespace]);

	const create = useMutation({
		mutationFn: () =>
			api.createRepo({
				namespace: namespace.trim(),
				name: name.trim(),
				description: description.trim(),
				default_branch: defaultBranch.trim() || "main",
				...(mode === "import" && importUrl.trim()
					? {
							import_url: importUrl.trim(),
							import_token: importToken.trim() || undefined,
						}
					: {}),
			}),
		onSuccess: (r) => {
			toast.success(`Created ${r.slug}`);
			qc.invalidateQueries({ queryKey: ["repos"] });
			setOpen(false);
			nav({ to: "/repos/$", params: { _splat: r.slug } });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="gap-0 p-0 sm:max-w-lg">
				<DialogHeader className="gap-1.5 px-5 pt-5 pb-4">
					<DialogTitle className="text-[0.9375rem]">Create a repository</DialogTitle>
					<DialogDescription className="text-[0.8125rem]">
						{mode === "empty"
							? "Initialize a new bare repository."
							: "Import an existing repository from a URL."}
					</DialogDescription>
				</DialogHeader>
				<div className="flex gap-1 mx-5 mb-3 rounded-lg bg-surface-1 p-1">
					<button
						type="button"
						onClick={() => setMode("empty")}
						className={cn(
							"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
							mode === "empty"
								? "bg-primary text-white shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<PlusIcon size={12} className="inline mr-1.5 -mt-px" />
						Empty repo
					</button>
					<button
						type="button"
						onClick={() => setMode("import")}
						className={cn(
							"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
							mode === "import"
								? "bg-primary text-white shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						<DownloadIcon size={12} className="inline mr-1.5 -mt-px" />
						Import from URL
					</button>
				</div>
				<form
					id="new-repo-form"
					className="flex flex-col gap-4 px-5 pb-5"
					onSubmit={(e) => {
						e.preventDefault();
						if (!name.trim() || !namespace.trim()) return;
						if (mode === "import" && !importUrl.trim()) return;
						create.mutate();
					}}
				>
					{mode === "import" && (
						<>
							<Field label="Repository URL">
								<Input
									required
									value={importUrl}
									onChange={(e) => setImportUrl(e.target.value)}
									placeholder="https://github.com/user/repo.git"
									autoFocus
								/>
							</Field>
							<Field label="Access token">
								<Input
									value={importToken}
									onChange={(e) => setImportToken(e.target.value)}
									placeholder="Optional — for private repos"
									type="password"
								/>
							</Field>
						</>
					)}
					<div className="grid grid-cols-[1fr_2fr] gap-3">
						<Field label="Namespace">
							<Select value={namespace} onValueChange={setNamespace}>
								<SelectTrigger className="h-9 text-sm">
									<SelectValue placeholder="Select namespace" />
								</SelectTrigger>
								<SelectContent>
									{(nsQ.data ?? []).map((ns) => (
										<SelectItem key={ns.name} value={ns.name}>
											{ns.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<Field label="Name">
							<Input
								required
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="parser"
								autoFocus={mode === "empty"}
							/>
						</Field>
					</div>
					<Field label="Description">
						<Input
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</Field>
					{mode === "empty" && (
						<Field label="Default branch">
							<Input
								value={defaultBranch}
								onChange={(e) => {
									setDefaultBranch(e.target.value);
									setDefaultBranchTouched(true);
								}}
							/>
						</Field>
					)}
				</form>
				<DialogFooter className="border-t border-border/70 px-5 py-3.5">
					<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						type="submit"
						size="sm"
						form="new-repo-form"
						disabled={
							create.isPending ||
							!name.trim() ||
							!namespace.trim() ||
							(mode === "import" && !importUrl.trim())
						}
						iconLeft={
							mode === "import" ? (
								<DownloadIcon size={14} strokeWidth={2} />
							) : (
								<PlusIcon size={14} strokeWidth={2} />
							)
						}
					>
						{create.isPending
							? mode === "import"
								? "Importing…"
								: "Creating…"
							: mode === "import"
								? "Import"
								: "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Field({
	label,
	required,
	children,
}: {
	label: string;
	required?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-xs font-medium">
				{label}
				{required && <span className="text-destructive ml-0.5">*</span>}
			</Label>
			{children}
		</div>
	);
}
