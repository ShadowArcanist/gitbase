import { Link } from "@tanstack/react-router";
import {
	ArchiveIcon,
	FolderClosedIcon,
	HomeIcon,
	MoonIcon,
	SettingsIcon,
	SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

function BrandMark({ className = "" }: { className?: string }) {
	return (
		<div
			role="img"
			aria-hidden
			className={`brand-mark bg-cover bg-center ${className}`}
		/>
	);
}

type NavItem = {
	to: string;
	label: string;
	icon: typeof HomeIcon;
	exact?: boolean;
};

const navItems: NavItem[] = [
	{ to: "/", label: "Home", icon: HomeIcon, exact: true },
	{ to: "/repos", label: "Repositories", icon: ArchiveIcon },
	{ to: "/namespaces", label: "Namespaces", icon: FolderClosedIcon },
	{ to: "/settings", label: "Settings", icon: SettingsIcon },
];

function ThemeToggle() {
	const { resolvedTheme, setTheme } = useTheme();
	const isDark = resolvedTheme === "dark";
	return (
		<button
			type="button"
			onClick={() => setTheme(isDark ? "light" : "dark")}
			className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
			aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
		>
			{isDark ? <SunIcon size={16} strokeWidth={2} /> : <MoonIcon size={16} strokeWidth={2} />}
		</button>
	);
}

export function DashboardTopbar() {
	return (
		<nav className="flex min-w-0 items-center gap-3 overflow-hidden px-3 py-2">
			<div className="hidden h-8 shrink-0 items-center gap-2 rounded-md px-1 md:flex">
				<BrandMark className="size-6 rounded-md" />
				<span className="text-sm font-semibold tracking-tight leading-none">Gitbase</span>
			</div>

			<div className="hidden shrink-0 items-center gap-0.5 md:flex">
				{navItems.map((item) => (
					<Button
						key={item.label}
						variant="ghost"
						size="sm"
						asChild
						iconLeft={<item.icon size={15} strokeWidth={2} />}
						className="text-muted-foreground [&.active]:bg-surface-1 [&.active]:text-foreground"
					>
						<Link
							to={item.to}
							activeOptions={{ exact: item.exact ?? false }}
							activeProps={{ className: "active" }}
						>
							{item.label}
						</Link>
					</Button>
				))}
			</div>

			<div className="min-w-0 flex-1 overflow-hidden" />

			<ThemeToggle />
		</nav>
	);
}
