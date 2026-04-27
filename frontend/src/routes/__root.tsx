import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";

import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Toaster } from "@/components/ui/sonner";

export interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootLayout,
});

function RootLayout() {
	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<DashboardLayout />
			<Toaster />
		</ThemeProvider>
	);
}
