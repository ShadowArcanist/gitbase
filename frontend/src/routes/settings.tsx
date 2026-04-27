import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CopyIcon,
	KeyIcon,
	TrashIcon,
	UserIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type SSHKey, api } from "@/lib/api";

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
});

function SettingsPage() {
	return (
		<div className="overflow-stable h-full overflow-auto py-10">
			<div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 md:px-6">
				<div className="flex flex-col gap-1.5 pb-4 border-b border-border">
					<h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
					<p className="text-sm text-muted-foreground">
						Application preferences.
					</p>
				</div>

				<GeneralSection />
				<SSHKeysSection />
				<CommitAvatarSection />
			</div>
		</div>
	);
}

function CommitAvatarSection() {
	const qc = useQueryClient();
	const settingsQ = useQuery({
		queryKey: ["app-settings"],
		queryFn: () => api.getAppSettings(),
	});
	const avatar = settingsQ.data?.commit_avatar ?? "";

	const upload = useMutation({
		mutationFn: (file: File) => api.uploadCommitAvatar(file),
		onSuccess: (s) => {
			qc.setQueryData(["app-settings"], s);
			toast.success("Commit avatar updated");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const remove = useMutation({
		mutationFn: () => api.deleteCommitAvatar(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["app-settings"] });
			toast.success("Commit avatar removed");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<section className="flex flex-col gap-4 rounded-xl border border-border/70 p-6">
			<div className="flex flex-col gap-1">
				<h3 className="text-sm font-semibold">Commit avatar</h3>
				<p className="text-xs text-muted-foreground">
					Image shown next to every committer in commit lists.
				</p>
			</div>
			<div className="flex items-center gap-4">
				{avatar ? (
					<img
						src={api.commitAvatarUrl(avatar)}
						alt=""
						className="size-16 shrink-0 rounded-full border border-border object-cover"
					/>
				) : (
					<div className="flex size-16 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-surface-1 text-muted-foreground">
						<UserIcon size={20} strokeWidth={1.8} />
					</div>
				)}
				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<label className="inline-flex">
							<input
								type="file"
								accept="image/png,image/jpeg,image/webp,image/gif"
								className="hidden"
								onChange={(e) => {
									const f = e.target.files?.[0];
									if (f) upload.mutate(f);
									e.target.value = "";
								}}
							/>
							<Button
								asChild
								size="sm"
								variant="secondary"
								disabled={upload.isPending}
							>
								<span>{upload.isPending ? "Uploading…" : "Upload image"}</span>
							</Button>
						</label>
						{avatar && (
							<Button
								size="sm"
								variant="ghost"
								disabled={remove.isPending}
								onClick={() => remove.mutate()}
								className="text-muted-foreground hover:text-destructive"
							>
								Remove
							</Button>
						)}
					</div>
					<p className="text-[11px] text-muted-foreground">
					Recommended PNG, 256×256, max 8 MB.
					</p>
				</div>
			</div>
		</section>
	);
}

function GeneralSection() {
	const qc = useQueryClient();
	const settingsQ = useQuery({
		queryKey: ["app-settings"],
		queryFn: () => api.getAppSettings(),
	});
	const [defaultBranch, setDefaultBranch] = useState("");

	useEffect(() => {
		if (settingsQ.data) setDefaultBranch(settingsQ.data.default_branch);
	}, [settingsQ.data]);

	const save = useMutation({
		mutationFn: () =>
			api.patchAppSettings({ default_branch: defaultBranch.trim() }),
		onSuccess: (s) => {
			qc.setQueryData(["app-settings"], s);
			toast.success("Settings saved");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const dirty =
		settingsQ.data != null &&
		defaultBranch.trim() !== "" &&
		defaultBranch.trim() !== settingsQ.data.default_branch;

	return (
		<section className="flex flex-col gap-5 rounded-xl border border-border/70 p-6">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h3 className="text-sm font-semibold">General</h3>
					<p className="text-xs text-muted-foreground">
						Defaults applied when creating new repositories.
					</p>
				</div>
				<Button
					size="sm"
					disabled={!dirty || save.isPending}
					onClick={() => save.mutate()}
				>
					{save.isPending ? "Saving…" : "Save"}
				</Button>
			</div>
			<div className="flex flex-col gap-1.5 max-w-sm">
				<Label className="text-xs font-medium">Default branch name</Label>
				<Input
					value={defaultBranch}
					onChange={(e) => setDefaultBranch(e.target.value)}
					placeholder="main"
				/>
				<p className="text-xs text-muted-foreground">
					Used as the initial branch for new repositories. You can override
					per repo when creating.
				</p>
			</div>
		</section>
	);
}

function SSHKeysSection() {
	const qc = useQueryClient();
	const statusQ = useQuery({
		queryKey: ["ssh-status"],
		queryFn: () => api.sshStatus(),
	});
	const keysQ = useQuery({
		queryKey: ["ssh-keys"],
		queryFn: () => api.listSSHKeys(),
	});

	const [name, setName] = useState("");
	const [pubKey, setPubKey] = useState("");
	const [adding, setAdding] = useState(false);

	const addKey = useMutation({
		mutationFn: () => api.addSSHKey({ name: name.trim(), public_key: pubKey.trim() }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["ssh-keys"] });
			setName("");
			setPubKey("");
			setAdding(false);
			toast.success("SSH key added");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const removeKey = useMutation({
		mutationFn: (id: number) => api.deleteSSHKey(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["ssh-keys"] });
			toast.success("SSH key removed");
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const enabled = statusQ.data?.enabled ?? false;
	const keys = keysQ.data ?? [];

	return (
		<section className="flex flex-col gap-5 rounded-xl border border-border/70 p-6">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h3 className="text-sm font-semibold">SSH Keys</h3>
					<p className="text-xs text-muted-foreground">
						{enabled
							? `SSH enabled on port ${statusQ.data?.port ?? "—"}.`
							: "SSH is disabled. Set SSH_ENABLED=true to enable."}
					</p>
				</div>
				{enabled && !adding && (
					<Button size="sm" onClick={() => setAdding(true)}>
						Add key
					</Button>
				)}
			</div>

			{enabled && statusQ.data?.host_fingerprint && (
				<div className="flex flex-col gap-1.5">
					<span className="text-xs font-medium text-muted-foreground">Host fingerprint</span>
					<div className="flex items-center gap-2 rounded-lg bg-surface-1 px-3 py-2 text-xs text-muted-foreground">
						<KeyIcon size={13} className="shrink-0" />
						<span className="font-mono truncate">{statusQ.data.host_fingerprint}</span>
						<button
							type="button"
							className="ml-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors"
							onClick={() => {
								navigator.clipboard.writeText(statusQ.data!.host_fingerprint);
								toast.success("Fingerprint copied");
							}}
						>
							<CopyIcon size={13} />
						</button>
					</div>
				</div>
			)}

			{adding && (
				<div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-surface-0 p-4">
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs font-medium">Name</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My laptop"
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label className="text-xs font-medium">Public key</Label>
						<textarea
							value={pubKey}
							onChange={(e) => setPubKey(e.target.value)}
							placeholder="ssh-ed25519 AAAA..."
							rows={3}
							className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
						/>
					</div>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							disabled={!name.trim() || !pubKey.trim() || addKey.isPending}
							onClick={() => addKey.mutate()}
						>
							{addKey.isPending ? "Adding…" : "Add key"}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setAdding(false);
								setName("");
								setPubKey("");
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			)}

			{keys.length > 0 && (
				<div className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/60">
					{keys.map((k: SSHKey) => (
						<div
							key={k.id}
							className="flex items-center gap-3 px-4 py-3"
						>
							<KeyIcon size={14} className="shrink-0 text-muted-foreground" />
							<div className="flex flex-col gap-0.5 min-w-0">
								<span className="text-sm font-medium truncate">{k.name}</span>
								<span className="text-xs font-mono text-muted-foreground truncate">
									{k.fingerprint}
								</span>
							</div>
							<button
								type="button"
								className="ml-auto shrink-0 text-muted-foreground hover:text-destructive transition-colors"
								onClick={() => removeKey.mutate(k.id)}
								disabled={removeKey.isPending}
							>
								<TrashIcon size={14} />
							</button>
						</div>
					))}
				</div>
			)}

			{enabled && keys.length === 0 && !adding && (
				<p className="text-xs text-muted-foreground">
					No SSH keys configured. Add a public key to enable SSH access.
				</p>
			)}
		</section>
	);
}

