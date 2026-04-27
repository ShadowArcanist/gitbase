export type Stats = {
	repo_count: number;
	namespace_count: number;
	disk_used: number;
	disk_total: number;
	ram_used: number;
	ram_total: number;
};

export type NamespaceSummary = {
	name: string;
	description: string;
	image_path: string;
	repo_count: number;
	size_bytes: number;
};

export type Namespace = {
	name: string;
	description: string;
	image_path: string;
	created_at: string;
	updated_at: string;
};

export type ActivityKind =
	| "repo.created"
	| "repo.updated"
	| "repo.deleted"
	| "namespace.created"
	| "namespace.updated"
	| "namespace.deleted";

export type ActivityItem = {
	id: number;
	kind: ActivityKind;
	target_kind: "repo" | "namespace" | "";
	target: string;
	message: string;
	status?: string;
	time: string;
};

export type Repo = {
	id: number;
	slug: string;
	namespace: string;
	name: string;
	description: string;
	default_branch: string;
	image_path: string;
	size_bytes: number;
	created_at: string;
	updated_at: string;
};

export type Ref = {
	name: string;
	full: string;
	target: string;
	is_tag: boolean;
};

export type Commit = {
	sha: string;
	parents: string[];
	author: string;
	email: string;
	date: string;
	committer: string;
	subject: string;
	body: string;
};

export type TreeEntry = {
	mode: string;
	type: "blob" | "tree" | "commit";
	sha: string;
	size: number;
	path: string;
	name: string;
};

export type BlobResponse = {
	path: string;
	rev: string;
	sha: string;
	size: number;
	truncated: boolean;
	binary: boolean;
	content: string | null;
};

export type ReadmeResponse = {
	exists: boolean;
	path?: string;
	content?: string;
	truncated?: boolean;
	size?: number;
};

export type BranchesResponse = {
	branches: Ref[];
	head: string;
	default_branch: string;
};

export type Label = {
	id: number;
	repo_id: number;
	name: string;
	color: string;
	description: string;
	created_at: string;
};

export type Issue = {
	id: number;
	repo_id: number;
	number: number;
	title: string;
	body: string;
	state: "open" | "closed";
	state_reason: string;
	labels: Label[];
	comment_count: number;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
};

export type IssueListResponse = {
	issues: Issue[];
	open_count: number;
	closed_count: number;
};

export type IssueDetailResponse = {
	issue: Issue;
	comments: IssueComment[];
};

export type IssueComment = {
	id: number;
	issue_id: number;
	body: string;
	created_at: string;
	updated_at: string;
};

export type PullRequest = {
	id: number;
	repo_id: number;
	number: number;
	title: string;
	body: string;
	state: "open" | "merged" | "closed";
	is_draft: boolean;
	head_branch: string;
	base_branch: string;
	merge_commit_sha: string;
	labels: Label[];
	comment_count: number;
	additions: number;
	deletions: number;
	created_at: string;
	updated_at: string;
	merged_at: string | null;
	closed_at: string | null;
};

export type PRListResponse = {
	pull_requests: PullRequest[];
	open_count: number;
	merged_count: number;
	closed_count: number;
};

export type PRDetailResponse = {
	pull_request: PullRequest;
	comments: PRComment[];
	head_exists: boolean;
	base_exists: boolean;
	can_merge?: boolean;
	diff?: string;
	ahead?: number;
	behind?: number;
	commits?: Commit[];
	additions?: number;
	deletions?: number;
	changed_files?: number;
};

export type PRComment = {
	id: number;
	pr_id: number;
	body: string;
	created_at: string;
	updated_at: string;
};

export function slugToUrl(slug: string) {
	return slug;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		...init,
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
	});
	if (!res.ok) {
		let msg = `${res.status}`;
		try {
			const j = await res.json();
			if (j.error) msg = j.error;
		} catch {}
		throw new Error(msg);
	}
	return res.json();
}

export type AppSettings = {
	default_branch: string;
	commit_avatar: string;
};

export type SSHStatus = {
	enabled: boolean;
	port: number;
	host_fingerprint: string;
	public_url: string;
};

export type SSHKey = {
	id: number;
	name: string;
	fingerprint: string;
	created_at: string;
};

export const api = {
	stats: () => jsonFetch<Stats>(`/api/stats`),
	activity: () => jsonFetch<ActivityItem[]>(`/api/activity`),
	getAppSettings: () => jsonFetch<AppSettings>(`/api/settings`),
	patchAppSettings: (body: { default_branch?: string }) =>
		jsonFetch<AppSettings>(`/api/settings`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	uploadCommitAvatar: async (file: File) => {
		const fd = new FormData();
		fd.append("image", file);
		const res = await fetch(`/api/settings/commit-avatar`, {
			method: "POST",
			body: fd,
		});
		if (!res.ok) throw new Error(`${res.status}`);
		return (await res.json()) as AppSettings;
	},
	deleteCommitAvatar: async () => {
		const res = await fetch(`/api/settings/commit-avatar`, {
			method: "DELETE",
		});
		if (!res.ok) throw new Error(`${res.status}`);
	},
	commitAvatarUrl: (cacheKey?: string) =>
		`/api/settings/commit-avatar${cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : ""}`,
	listRepos: (q?: string, namespace?: string) => {
		const qs = new URLSearchParams();
		if (q) qs.set("q", q);
		if (namespace) qs.set("namespace", namespace);
		const s = qs.toString();
		return jsonFetch<Repo[]>(`/api/repos${s ? `?${s}` : ""}`);
	},
	listNamespaces: () => jsonFetch<NamespaceSummary[]>(`/api/namespaces`),
	createNamespace: (body: { name: string; description?: string }) =>
		jsonFetch<Namespace>(`/api/namespaces`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	getNamespace: (name: string) => jsonFetch<Namespace>(`/api/namespaces/${name}`),
	patchNamespace: (name: string, body: { description?: string; name?: string }) =>
		jsonFetch<Namespace>(`/api/namespaces/${name}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	deleteNamespace: async (name: string) => {
		const res = await fetch(`/api/namespaces/${name}`, { method: "DELETE" });
		if (!res.ok) {
			let msg = `${res.status}`;
			try {
				const j = await res.json();
				if (j.error) msg = j.error;
			} catch {}
			throw new Error(msg);
		}
	},
	listNamespaceRepos: (name: string) =>
		jsonFetch<Repo[]>(`/api/namespaces/${name}/repos`),
	uploadNamespaceImage: async (name: string, file: File) => {
		const fd = new FormData();
		fd.append("image", file);
		const res = await fetch(`/api/namespaces/${name}/image`, { method: "POST", body: fd });
		if (!res.ok) throw new Error(`${res.status}`);
		return (await res.json()) as Namespace;
	},
	deleteNamespaceImage: async (name: string) => {
		const res = await fetch(`/api/namespaces/${name}/image`, { method: "DELETE" });
		if (!res.ok) throw new Error(`${res.status}`);
	},
	namespaceImageUrl: (name: string) => `/api/namespaces/${name}/image`,
	uploadRepoImage: async (slug: string, file: File) => {
		const fd = new FormData();
		fd.append("image", file);
		const res = await fetch(`/api/repos/${slug}/image`, { method: "POST", body: fd });
		if (!res.ok) throw new Error(`${res.status}`);
		return (await res.json()) as Repo;
	},
	deleteRepoImage: async (slug: string) => {
		const res = await fetch(`/api/repos/${slug}/image`, { method: "DELETE" });
		if (!res.ok) throw new Error(`${res.status}`);
	},
	repoImageUrl: (slug: string) => `/api/repos/${slug}/image`,
	getRepo: (slug: string) => jsonFetch<Repo>(`/api/repos/${slugToUrl(slug)}`),
	createRepo: (body: {
		namespace?: string;
		name: string;
		description?: string;
		default_branch?: string;
		import_url?: string;
		import_token?: string;
	}) =>
		jsonFetch<Repo>(`/api/repos`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	patchRepo: (slug: string, body: Record<string, unknown>) =>
		jsonFetch<Repo>(`/api/repos/${slugToUrl(slug)}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	deleteRepo: async (slug: string) => {
		const res = await fetch(`/api/repos/${slugToUrl(slug)}`, { method: "DELETE" });
		if (!res.ok) throw new Error(`${res.status}`);
	},
	branches: (slug: string) =>
		jsonFetch<BranchesResponse>(`/api/repos/${slugToUrl(slug)}/branches`),
	createBranch: (slug: string, body: { name: string; source?: string }) =>
		jsonFetch<{ name: string; source: string }>(
			`/api/repos/${slugToUrl(slug)}/branches`,
			{ method: "POST", body: JSON.stringify(body) },
		),
	deleteBranch: async (slug: string, name: string) => {
		const res = await fetch(
			`/api/repos/${slugToUrl(slug)}/branches/${encodeURIComponent(name)}`,
			{ method: "DELETE" },
		);
		if (!res.ok) {
			let msg = `${res.status}`;
			try {
				const j = await res.json();
				if (j.error) msg = j.error;
			} catch {}
			throw new Error(msg);
		}
	},
	tags: (slug: string) => jsonFetch<Ref[]>(`/api/repos/${slugToUrl(slug)}/tags`),
	commitCount: (slug: string, rev?: string) => {
		const qs = new URLSearchParams();
		if (rev) qs.set("rev", rev);
		return jsonFetch<{ count: number }>(
			`/api/repos/${slugToUrl(slug)}/commit-count${qs.toString() ? `?${qs}` : ""}`,
		);
	},
	commits: (slug: string, rev?: string, limit = 50, path?: string) => {
		const qs = new URLSearchParams();
		if (rev) qs.set("rev", rev);
		if (limit) qs.set("limit", String(limit));
		if (path) qs.set("path", path);
		return jsonFetch<Commit[]>(
			`/api/repos/${slugToUrl(slug)}/commits?${qs.toString()}`,
		);
	},
	commit: (slug: string, sha: string) =>
		jsonFetch<{ commit: Commit; patch: string }>(
			`/api/repos/${slugToUrl(slug)}/commits/${sha}`,
		),
	treeMeta: (slug: string, rev: string, path?: string) => {
		const qs = new URLSearchParams({ rev });
		if (path) qs.set("path", path);
		return jsonFetch<{
			path: string;
			rev: string;
			meta: Record<
				string,
				{ sha: string; time: number; author: string; subject: string }
			>;
		}>(`/api/repos/${slugToUrl(slug)}/tree-meta?${qs.toString()}`);
	},
	tree: (slug: string, rev: string, path?: string) => {
		const qs = new URLSearchParams({ rev });
		if (path) qs.set("path", path);
		return jsonFetch<{
			path: string;
			rev: string;
			kind?: "tree" | "blob";
			entry?: TreeEntry;
			entries: TreeEntry[];
		}>(`/api/repos/${slugToUrl(slug)}/tree?${qs.toString()}`);
	},
	blob: (slug: string, rev: string, path: string) => {
		const qs = new URLSearchParams({ rev, path });
		return jsonFetch<BlobResponse>(
			`/api/repos/${slugToUrl(slug)}/blob?${qs.toString()}`,
		);
	},
	rawUrl: (slug: string, rev: string, path: string) => {
		const qs = new URLSearchParams({ rev, path });
		return `/api/repos/${slugToUrl(slug)}/raw?${qs.toString()}`;
	},
	readme: (slug: string, rev?: string) => {
		const qs = new URLSearchParams();
		if (rev) qs.set("rev", rev);
		return jsonFetch<ReadmeResponse>(
			`/api/repos/${slugToUrl(slug)}/readme${qs.toString() ? `?${qs}` : ""}`,
		);
	},
	sshStatus: () => jsonFetch<SSHStatus>(`/api/ssh/status`),
	listSSHKeys: () => jsonFetch<SSHKey[]>(`/api/ssh/keys`),
	addSSHKey: (body: { name: string; public_key: string }) =>
		jsonFetch<SSHKey>(`/api/ssh/keys`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	deleteSSHKey: async (id: number) => {
		const res = await fetch(`/api/ssh/keys/${id}`, { method: "DELETE" });
		if (!res.ok) {
			let msg = `${res.status}`;
			try {
				const j = await res.json();
				if (j.error) msg = j.error;
			} catch {}
			throw new Error(msg);
		}
	},

	// Issues
	listIssues: (slug: string, state = "open") =>
		jsonFetch<IssueListResponse>(
			`/api/repos/${slugToUrl(slug)}/issues?state=${encodeURIComponent(state)}`,
		),
	getIssue: (slug: string, number: number) =>
		jsonFetch<IssueDetailResponse>(
			`/api/repos/${slugToUrl(slug)}/issues/${number}`,
		),
	createIssue: (
		slug: string,
		body: { title: string; body?: string; label_ids?: number[] },
	) =>
		jsonFetch<Issue>(`/api/repos/${slugToUrl(slug)}/issues`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	patchIssue: (
		slug: string,
		number: number,
		body: {
			title?: string;
			body?: string;
			state?: string;
			state_reason?: string;
			label_ids?: number[];
		},
	) =>
		jsonFetch<Issue>(`/api/repos/${slugToUrl(slug)}/issues/${number}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	deleteIssue: async (slug: string, number: number) => {
		const res = await fetch(
			`/api/repos/${slugToUrl(slug)}/issues/${number}`,
			{ method: "DELETE" },
		);
		if (!res.ok) throw new Error(`${res.status}`);
	},

	// Issue Comments
	createComment: (slug: string, number: number, body: { body: string }) =>
		jsonFetch<IssueComment>(
			`/api/repos/${slugToUrl(slug)}/issues/${number}/comments`,
			{ method: "POST", body: JSON.stringify(body) },
		),
	updateComment: (slug: string, number: number, commentId: number, body: { body: string }) =>
		jsonFetch<IssueComment>(
			`/api/repos/${slugToUrl(slug)}/issues/${number}/comments/${commentId}`,
			{ method: "PATCH", body: JSON.stringify(body) },
		),
	deleteComment: async (slug: string, number: number, commentId: number) => {
		const res = await fetch(
			`/api/repos/${slugToUrl(slug)}/issues/${number}/comments/${commentId}`,
			{ method: "DELETE" },
		);
		if (!res.ok) throw new Error(`${res.status}`);
	},

	// Labels
	listLabels: (slug: string) =>
		jsonFetch<Label[]>(`/api/repos/${slugToUrl(slug)}/labels`),
	createLabel: (slug: string, body: { name: string; color?: string; description?: string }) =>
		jsonFetch<Label>(`/api/repos/${slugToUrl(slug)}/labels`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	updateLabel: (slug: string, id: number, body: { name?: string; color?: string; description?: string }) =>
		jsonFetch<Label>(`/api/repos/${slugToUrl(slug)}/labels/${id}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	deleteLabel: async (slug: string, id: number) => {
		const res = await fetch(`/api/repos/${slugToUrl(slug)}/labels/${id}`, {
			method: "DELETE",
		});
		if (!res.ok) throw new Error(`${res.status}`);
	},

	// Pull Requests
	listPRs: (slug: string, state = "open") =>
		jsonFetch<PRListResponse>(
			`/api/repos/${slugToUrl(slug)}/pulls?state=${encodeURIComponent(state)}`,
		),
	getPR: (slug: string, number: number) =>
		jsonFetch<PRDetailResponse>(
			`/api/repos/${slugToUrl(slug)}/pulls/${number}`,
		),
	createPR: (
		slug: string,
		body: { title: string; body?: string; head_branch: string; base_branch: string; is_draft?: boolean; label_ids?: number[] },
	) =>
		jsonFetch<PullRequest>(`/api/repos/${slugToUrl(slug)}/pulls`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	patchPR: (
		slug: string,
		number: number,
		body: { title?: string; body?: string; state?: string; is_draft?: boolean; label_ids?: number[] },
	) =>
		jsonFetch<PullRequest>(`/api/repos/${slugToUrl(slug)}/pulls/${number}`, {
			method: "PATCH",
			body: JSON.stringify(body),
		}),
	mergePR: (slug: string, number: number, body?: { message?: string; strategy?: string }) =>
		jsonFetch<{ pull_request: PullRequest; merge_sha: string }>(
			`/api/repos/${slugToUrl(slug)}/pulls/${number}/merge`,
			{ method: "POST", body: JSON.stringify(body ?? {}) },
		),
	updatePRBranch: (slug: string, number: number) =>
		jsonFetch<{ ok: boolean }>(
			`/api/repos/${slugToUrl(slug)}/pulls/${number}/update-branch`,
			{ method: "POST", body: "{}" },
		),
	deletePR: async (slug: string, number: number) => {
		const res = await fetch(
			`/api/repos/${slugToUrl(slug)}/pulls/${number}`,
			{ method: "DELETE" },
		);
		if (!res.ok) throw new Error(`${res.status}`);
	},

	// PR Comments
	createPRComment: (slug: string, number: number, body: { body: string }) =>
		jsonFetch<PRComment>(
			`/api/repos/${slugToUrl(slug)}/pulls/${number}/comments`,
			{ method: "POST", body: JSON.stringify(body) },
		),
	updatePRComment: (slug: string, number: number, commentId: number, body: { body: string }) =>
		jsonFetch<PRComment>(
			`/api/repos/${slugToUrl(slug)}/pulls/${number}/comments/${commentId}`,
			{ method: "PATCH", body: JSON.stringify(body) },
		),
	deletePRComment: async (slug: string, number: number, commentId: number) => {
		const res = await fetch(
			`/api/repos/${slugToUrl(slug)}/pulls/${number}/comments/${commentId}`,
			{ method: "DELETE" },
		);
		if (!res.ok) throw new Error(`${res.status}`);
	},
};
