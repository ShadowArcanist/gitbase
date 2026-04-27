import { useQuery } from "@tanstack/react-query";
import { UserIcon } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export function CommitAvatar({
	size = 20,
	className = "",
}: {
	size?: number;
	className?: string;
}) {
	const settingsQ = useQuery({
		queryKey: ["app-settings"],
		queryFn: () => api.getAppSettings(),
		staleTime: 5 * 60_000,
	});
	const avatar = settingsQ.data?.commit_avatar ?? "";
	const dim = `${size}px`;
	if (avatar) {
		return (
			<img
				src={api.commitAvatarUrl(avatar)}
				alt=""
				style={{ width: dim, height: dim }}
				className={cn("shrink-0 rounded-full object-cover", className)}
			/>
		);
	}
	return (
		<span
			style={{ width: dim, height: dim }}
			className={cn(
				"flex shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground",
				className,
			)}
		>
			<UserIcon size={Math.max(10, Math.round(size * 0.6))} strokeWidth={2} />
		</span>
	);
}
