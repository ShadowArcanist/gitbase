import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

// w-72 (288px) + pl-2 (8px)
export const SIDE_PANEL_WIDTH = 296;

type SidePanelState = {
	node: HTMLDivElement | null;
	collapsed: boolean;
	hasContent: boolean;
	toggle: () => void;
};

const SidePanelContext = createContext<SidePanelState>({
	node: null,
	collapsed: false,
	hasContent: false,
	toggle: () => {},
});

export function useSidePanelSlot() {
	const [node, setNode] = useState<HTMLDivElement | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const [hasContent, setHasContent] = useState(false);
	const toggle = useCallback(() => setCollapsed((c) => !c), []);
	return {
		node,
		setNode,
		collapsed,
		hasContent,
		setHasContent,
		toggle,
	} as const;
}

export function SidePanelProvider({
	value,
	children,
}: {
	value: SidePanelState;
	children: React.ReactNode;
}) {
	return (
		<SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>
	);
}

export function SidePanelPortal({ children }: { children: React.ReactNode }) {
	const { node } = useContext(SidePanelContext);
	if (!node) return null;
	return createPortal(children, node);
}

export function SidePanelSlot({
	slotRef,
	collapsed,
	onHasContent,
}: {
	slotRef: (el: HTMLDivElement | null) => void;
	collapsed: boolean;
	onHasContent: (v: boolean) => void;
}) {
	const [hasChildren, setHasChildren] = useState(false);
	const innerRef = useRef<HTMLDivElement | null>(null);

	const refCallback = useCallback(
		(el: HTMLDivElement | null) => {
			innerRef.current = el;
			slotRef(el);
		},
		[slotRef],
	);

	useEffect(() => {
		const el = innerRef.current;
		if (!el) return;
		const check = () => {
			const has = el.childNodes.length > 0;
			setHasChildren(has);
			onHasContent(has);
		};
		check();
		const observer = new MutationObserver(check);
		observer.observe(el, { childList: true });
		return () => observer.disconnect();
	}, [onHasContent]);

	const show = hasChildren && !collapsed;

	return (
		<div className="hidden overflow-hidden xl:block">
			<div
				className="h-full overflow-y-auto overflow-x-hidden pb-2 pl-2 transition-opacity duration-200"
				style={{ opacity: show ? 1 : 0 }}
			>
				<div ref={refCallback} />
			</div>
		</div>
	);
}

export function SidePanelToggle() {
	const { collapsed, toggle, hasContent } = useContext(SidePanelContext);
	if (!hasContent) return null;
	return (
		<button
			type="button"
			onClick={toggle}
			className="absolute right-0 top-1/2 hidden -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 bg-surface-1 py-2.5 pl-0.5 pr-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground xl:flex"
		>
			{collapsed ? (
				<ChevronLeftIcon size={12} strokeWidth={2} />
			) : (
				<ChevronRightIcon size={12} strokeWidth={2} />
			)}
		</button>
	);
}
