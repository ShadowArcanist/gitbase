export type FilePatch = {
	filename: string;
	patch: string;
	additions: number;
	deletions: number;
	status: "added" | "deleted" | "renamed" | "modified";
	oldFilename?: string;
};

const DIFF_RE = /^diff --git a\/(.+?) b\/(.+)$/;

export function splitPatch(patch: string): FilePatch[] {
	const out: FilePatch[] = [];
	if (!patch) return out;
	const lines = patch.split("\n");
	let buf: string[] = [];
	let oldName = "";
	let newName = "";
	let status: FilePatch["status"] = "modified";

	const flush = () => {
		if (buf.length === 0) return;
		const text = buf.join("\n");
		let additions = 0;
		let deletions = 0;
		let inHunk = false;
		for (const ln of buf) {
			if (ln.startsWith("@@")) {
				inHunk = true;
				continue;
			}
			if (!inHunk) continue;
			if (ln.startsWith("+") && !ln.startsWith("+++")) additions++;
			else if (ln.startsWith("-") && !ln.startsWith("---")) deletions++;
		}
		out.push({
			filename: newName || oldName,
			oldFilename: oldName !== newName ? oldName : undefined,
			patch: text,
			additions,
			deletions,
			status,
		});
		buf = [];
		status = "modified";
	};

	for (const line of lines) {
		const m = line.match(DIFF_RE);
		if (m) {
			flush();
			oldName = m[1];
			newName = m[2];
			status = oldName !== newName ? "renamed" : "modified";
		} else if (line.startsWith("new file mode")) {
			status = "added";
		} else if (line.startsWith("deleted file mode")) {
			status = "deleted";
		}
		buf.push(line);
	}
	flush();
	return out;
}
