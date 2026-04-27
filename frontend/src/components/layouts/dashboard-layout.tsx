import { Outlet } from "@tanstack/react-router";

import {
	SIDE_PANEL_WIDTH,
	SidePanelProvider,
	SidePanelSlot,
	SidePanelToggle,
	useSidePanelSlot,
} from "./dashboard-side-panel";
import { DashboardTopbar } from "./dashboard-topbar";

export function DashboardLayout() {
	const sidePanel = useSidePanelSlot();
	const showPanel = sidePanel.hasContent && !sidePanel.collapsed;
	return (
		<div className="isolate flex h-dvh flex-col bg-muted">
			<DashboardTopbar />
			<SidePanelProvider
				value={{
					node: sidePanel.node,
					collapsed: sidePanel.collapsed,
					hasContent: sidePanel.hasContent,
					toggle: sidePanel.toggle,
				}}
			>
				<div
					className="grid flex-1 overflow-hidden p-2 pt-0 transition-[grid-template-columns] duration-300 ease-out"
					style={{
						gridTemplateColumns: showPanel
							? `minmax(0, 1fr) ${SIDE_PANEL_WIDTH}px`
							: "minmax(0, 1fr) 0px",
					}}
				>
					<div className="relative overflow-hidden rounded-xl border bg-card shadow-[0_1px_4px_0_rgba(0,0,0,0.03)]">
						<div className="h-full">
							<Outlet />
						</div>
						<SidePanelToggle />
					</div>
					<SidePanelSlot
						slotRef={sidePanel.setNode}
						collapsed={sidePanel.collapsed}
						onHasContent={sidePanel.setHasContent}
					/>
				</div>
			</SidePanelProvider>
		</div>
	);
}
