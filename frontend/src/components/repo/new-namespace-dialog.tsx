import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

export function NewNamespaceDialog({ trigger }: { trigger: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	const nav = useNavigate();
	const qc = useQueryClient();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const create = useMutation({
		mutationFn: () =>
			api.createNamespace({
				name: name.trim(),
				description: description.trim(),
			}),
		onSuccess: (n) => {
			toast.success(`Created ${n.name}`);
			qc.invalidateQueries({ queryKey: ["namespaces"] });
			setOpen(false);
			nav({ to: "/namespaces/$", params: { _splat: n.name } });
		},
		onError: (e: Error) => toast.error(e.message),
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="gap-0 p-0 sm:max-w-lg">
				<DialogHeader className="gap-1.5 px-5 pt-5 pb-4">
					<DialogTitle className="text-[0.9375rem]">Add namespace</DialogTitle>
					<DialogDescription className="text-[0.8125rem]">
						Folder-style grouping. Use slashes for nested namespaces.
					</DialogDescription>
				</DialogHeader>
				<form
					id="new-ns-form"
					className="flex flex-col gap-4 px-5 pb-5"
					onSubmit={(e) => {
						e.preventDefault();
						if (!name.trim()) return;
						create.mutate();
					}}
				>
					<Field label="Name">
						<Input
							required
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="tools"
							autoFocus
						/>
					</Field>
					<Field label="Description">
						<Textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
						/>
					</Field>
				</form>
				<DialogFooter className="border-t border-border/70 px-5 py-3.5">
					<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						type="submit"
						size="sm"
						form="new-ns-form"
						disabled={create.isPending || !name.trim()}
						iconLeft={<PlusIcon size={14} strokeWidth={2} />}
					>
						{create.isPending ? "Creating…" : "Create"}
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
