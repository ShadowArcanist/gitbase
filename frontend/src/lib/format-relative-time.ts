export function formatRelativeTime(input: string | number | Date): string {
	const d = input instanceof Date ? input : new Date(input);
	const s = (Date.now() - d.getTime()) / 1000;
	if (s < 5) return "just now";
	if (s < 60) return `${Math.floor(s)}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
	if (s < 86400 * 30) return `${Math.floor(s / 86400 / 7)}w ago`;
	if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo ago`;
	return `${Math.floor(s / 86400 / 365)}y ago`;
}
